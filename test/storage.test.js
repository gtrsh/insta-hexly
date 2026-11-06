import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { storageConfigFromEnv } from '../src/config.js';
import { createS3Storage } from '../src/storage/s3.js';
import { count, createTestApp, PNG } from './helpers.js';

class FakeS3 {
  constructor() {
    this.objects = new Map();
    this.calls = [];
    this.failDeletes = false;
  }

  async send(command) {
    const name = command.constructor.name;
    const input = command.input;
    this.calls.push({ name, input });
    const id = `${input.Bucket}/${input.Key}`;

    switch (name) {
      case 'PutObjectCommand': {
        const body = Buffer.from(input.Body);
        const etag = `"${createHash('md5').update(body).digest('hex')}"`;
        this.objects.set(id, { body, etag, contentType: input.ContentType, cacheControl: input.CacheControl });
        return { ETag: etag };
      }
      case 'GetObjectCommand': {
        const obj = this.objects.get(id);
        if (!obj) throw Object.assign(new Error('The specified key does not exist.'), {
          name: 'NoSuchKey',
          $metadata: { httpStatusCode: 404 },
        });
        if (input.IfNoneMatch && input.IfNoneMatch === obj.etag) {
          throw Object.assign(new Error('Not Modified'), { name: '304', $metadata: { httpStatusCode: 304 } });
        }
        return {
          Body: Readable.from([obj.body]),
          ContentType: obj.contentType,
          ContentLength: obj.body.length,
          CacheControl: obj.cacheControl,
          ETag: obj.etag,
          LastModified: new Date('2026-01-01T00:00:00Z'),
        };
      }
      case 'DeleteObjectCommand':
        if (this.failDeletes) throw Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } });
        this.objects.delete(id);
        return {};
      default:
        throw new Error(`unexpected command ${name}`);
    }
  }

  keys() {
    return [...this.objects.keys()];
  }
}

const fakeStorage = (fake, extra = {}) =>
  createS3Storage({ bucket: 'test-bucket', prefix: 'uploads/', client: fake, ...extra });

describe('storage configuration', () => {
  test('defaults to local storage', () => {
    const cfg = storageConfigFromEnv({}, { uploadsDir: '/tmp/x' });
    assert.deepEqual(cfg, { driver: 'local', local: { dir: '/tmp/x' } });
  });

  test('reads S3 settings with sensible defaults', () => {
    const cfg = storageConfigFromEnv(
      {
        STORAGE: 's3',
        S3_ENDPOINT: 'https://s3.example',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: 'secret',
      },
      { uploadsDir: '/tmp/x' },
    );
    assert.equal(cfg.driver, 's3');
    assert.equal(cfg.s3.region, 'us-east-1');
    assert.equal(cfg.s3.forcePathStyle, true);
    assert.equal(cfg.s3.prefix, 'uploads/');
    assert.equal(cfg.s3.publicUrl, '');
  });

  test('normalises the key prefix', () => {
    const base = { STORAGE: 's3', S3_ENDPOINT: 'e', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'i', S3_SECRET_ACCESS_KEY: 's' };
    assert.equal(storageConfigFromEnv({ ...base, S3_PREFIX: '/media/img/' }, {}).s3.prefix, 'media/img/');
    assert.equal(storageConfigFromEnv({ ...base, S3_PREFIX: '' }, {}).s3.prefix, '');
  });

  test('fails fast on missing S3 settings or an unknown driver', () => {
    assert.throws(() => storageConfigFromEnv({ STORAGE: 's3', S3_BUCKET: 'b' }, {}), /S3_ENDPOINT, S3_ACCESS_KEY_ID/);
    assert.throws(() => storageConfigFromEnv({ STORAGE: 'ftp' }, {}), /must be "local" or "s3"/);
  });
});

describe('S3 storage served through the app (private bucket)', () => {
  let ctx;
  let fake;
  let alice;
  before(async () => {
    fake = new FakeS3();
    ctx = await createTestApp({}, { storage: fakeStorage(fake) });
    alice = ctx.client();
    await alice.register('alice');
  });
  after(() => ctx.close());

  test('uploads posts to the bucket under the prefix with the right content type', async () => {
    const id = await alice.createPost('в облаке');
    const { image } = ctx.app.db.prepare('SELECT image FROM posts WHERE id = ?').get(id);

    const put = fake.calls.findLast((c) => c.name === 'PutObjectCommand').input;
    assert.equal(put.Bucket, 'test-bucket');
    assert.equal(put.Key, `uploads/${image}`);
    assert.equal(put.ContentType, 'image/png');
    assert.match(put.CacheControl, /immutable/);
    assert.deepEqual(fake.keys(), [`test-bucket/uploads/${image}`]);
  });

  test('pages link to the app, which streams the object from the bucket', async () => {
    const id = await alice.createPost('proxy');
    const { image } = ctx.app.db.prepare('SELECT image FROM posts WHERE id = ?').get(id);

    const page = await alice.get(`/p/${id}`);
    assert.match(page.body, new RegExp(`src="/uploads/${image}"`));

    const res = await ctx.client().get(`/uploads/${image}`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.match(res.headers['cache-control'], /immutable/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(res.rawPayload, PNG);

    const cached = await ctx.client().get(`/uploads/${image}`, { 'if-none-match': res.headers.etag });
    assert.equal(cached.statusCode, 304);
  });

  test('missing objects and malformed names return 404 (the latter without touching S3)', async () => {
    const missing = await ctx.client().get('/uploads/00000000-0000-4000-8000-000000000000.png');
    assert.equal(missing.statusCode, 404);

    const before = fake.calls.length;
    for (const name of ['..%2F..%2Fetc%2Fpasswd', 'evil.svg', 'abc.png']) {
      const res = await ctx.client().get(`/uploads/${name}`);
      assert.equal(res.statusCode, 404, name);
    }
    assert.equal(fake.calls.length, before, 'no S3 requests for invalid names');
  });

  test('rejected uploads never reach the bucket', async () => {
    const before = fake.calls.length;
    const res = await alice.upload(
      '/posts',
      {},
      { field: 'image', buffer: Buffer.from('not an image at all'), name: 'x.png', type: 'image/png' },
    );
    assert.equal(res.statusCode, 422);
    assert.equal(fake.calls.length, before);
  });

  test('deleting a post deletes the object', async () => {
    const id = await alice.createPost('to delete');
    const { image } = ctx.app.db.prepare('SELECT image FROM posts WHERE id = ?').get(id);
    assert.ok(fake.keys().includes(`test-bucket/uploads/${image}`));

    await alice.post(`/p/${id}/delete`);
    assert.ok(!fake.keys().includes(`test-bucket/uploads/${image}`));
  });

  test('a failing bucket delete does not break the request', async () => {
    const id = await alice.createPost('sticky');
    fake.failDeletes = true;
    try {
      const res = await alice.post(`/p/${id}/delete`);
      assert.equal(res.statusCode, 302);
      assert.equal((await alice.get(`/p/${id}`)).statusCode, 404, 'post is gone from the DB');
    } finally {
      fake.failDeletes = false;
    }
  });

  test('avatars are stored in the bucket and replaced objects are removed', async () => {
    const avatarKey = () => `test-bucket/uploads/${ctx.app.db.prepare("SELECT avatar FROM users WHERE username = 'alice'").get().avatar}`;
    const upload = () =>
      alice.upload('/settings/avatar', {}, { field: 'avatar', buffer: PNG, name: 'a.png', type: 'image/png' });

    await upload();
    const first = avatarKey();
    assert.ok(fake.keys().includes(first));

    await upload();
    assert.ok(!fake.keys().includes(first), 'old avatar deleted');
    assert.ok(fake.keys().includes(avatarKey()));
  });
});

describe('S3 storage with a public URL', () => {
  let ctx;
  let fake;
  before(async () => {
    fake = new FakeS3();
    ctx = await createTestApp({}, { storage: fakeStorage(fake, { publicUrl: 'https://cdn.example/bucket/' }) });
  });
  after(() => ctx.close());

  test('pages link straight to the public URL and the app does not proxy', async () => {
    const client = ctx.client();
    await client.register('bob');
    const id = await client.createPost('direct');
    const { image } = ctx.app.db.prepare('SELECT image FROM posts WHERE id = ?').get(id);

    const page = (await client.get('/u/bob')).body;
    assert.equal(count(page, `src="https://cdn.example/bucket/uploads/${image}"`), 1);

    const res = await client.get(`/uploads/${image}`);
    assert.equal(res.statusCode, 404);
  });
});
