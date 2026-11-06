import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

import { storageConfigFromEnv } from '../src/config.js';
import { createS3Storage } from '../src/storage/s3.js';
import { createTestApp, PNG } from './helpers.js';

const env = process.env;
const configured = Boolean(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);

describe('S3 storage against a real bucket', { skip: !configured && 'S3_* variables are not set' }, () => {
  let ctx;
  let storage;
  let prefix;

  const exists = async (name) => {
    try {
      await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: `${prefix}${name}` }));
      return true;
    } catch (err) {
      if (err.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  };

  before(async () => {
    const { s3 } = storageConfigFromEnv({ ...env, STORAGE: 's3' }, {});
    prefix = `${s3.prefix}test-runs/${randomUUID()}/`;
    storage = createS3Storage({ ...s3, prefix, publicUrl: '' });
    ctx = await createTestApp({}, { storage });
  });

  after(async () => {
    try {
      const listed = await storage.client.send(new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: prefix }));
      const objects = (listed.Contents ?? []).map(({ Key }) => ({ Key }));
      if (objects.length > 0) {
        await storage.client.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: objects } }));
      }
    } finally {
      await ctx.close();
      storage.client.destroy();
    }
  });

  test('upload, serve, replace and delete images', async () => {
    const client = ctx.client();
    await client.register('s3_user');

    const id = await client.createPost('из бакета');
    const { image } = ctx.app.db.prepare('SELECT image FROM posts WHERE id = ?').get(id);
    assert.ok(await exists(image), 'object written to the bucket');

    const res = await client.get(`/uploads/${image}`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.deepEqual(res.rawPayload, PNG, 'bytes round-trip unchanged');

    const cached = await client.get(`/uploads/${image}`, { 'if-none-match': res.headers.etag });
    assert.equal(cached.statusCode, 304);

    const missing = await client.get(`/uploads/${randomUUID()}.png`);
    assert.equal(missing.statusCode, 404);

    await client.upload('/settings/avatar', {}, { field: 'avatar', buffer: PNG, name: 'a.png', type: 'image/png' });
    const avatar = ctx.app.db.prepare("SELECT avatar FROM users WHERE username = 's3_user'").get().avatar;
    assert.ok(await exists(avatar));
    await client.post('/settings/avatar/delete');
    assert.equal(await exists(avatar), false, 'avatar removed from the bucket');

    await client.post(`/p/${id}/delete`);
    assert.equal(await exists(image), false, 'post image removed from the bucket');
  });
});
