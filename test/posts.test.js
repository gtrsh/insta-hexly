import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { count, createTestApp, decodeEq, PNG } from './helpers.js';

describe('creating posts', () => {
  let ctx;
  let alice;
  before(async () => {
    ctx = await createTestApp();
    alice = ctx.client();
    await alice.register('alice');
  });
  after(() => ctx.close());

  test('shows the upload form to signed-in users', async () => {
    const res = await alice.get('/posts/new');
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /enctype="multipart\/form-data"/);
    assert.match(res.body, /maxlength="1000"/);
  });

  test('stores the image and caption, then opens the post', async () => {
    const id = await alice.createPost('Закат над морем');
    const page = await alice.get(`/p/${id}`);
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Закат над морем/);

    const { image } = ctx.app.db.prepare('SELECT image FROM posts WHERE id = ?').get(id);
    assert.match(image, /^[0-9a-f-]{36}\.png$/);
    assert.ok(existsSync(join(ctx.uploadsDir, image)));

    const file = await alice.get(`/uploads/${image}`);
    assert.equal(file.statusCode, 200);
    assert.deepEqual(file.rawPayload, PNG);
  });

  test('escapes HTML in captions', async () => {
    const id = await alice.createPost('<img src=x onerror=alert(1)>');
    const page = await alice.get(`/p/${id}`);
    assert.doesNotMatch(page.body, /<img src=x onerror/);
    assert.match(decodeEq(page.body), /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  test('accepts a caption of exactly 1000 characters (counting code points)', async () => {
    const id = await alice.createPost('😀'.repeat(1000));
    assert.ok(id > 0);
  });

  test('rejects captions longer than 1000 characters', async () => {
    const res = await alice.upload(
      '/posts',
      { caption: 'a'.repeat(1001) },
      { field: 'image', buffer: PNG, name: 'p.png', type: 'image/png' },
    );
    assert.equal(res.statusCode, 422);
    assert.match(res.body, /не должно превышать 1000 символов/);
  });

  test('requires an image', async () => {
    const res = await alice.upload('/posts', { caption: 'no picture' });
    assert.equal(res.statusCode, 422);
    assert.match(res.body, /Выберите изображение/);
    assert.match(res.body, /no picture/, 'keeps the caption');
  });

  test('rejects files that are not images, whatever their name or MIME type claims', async () => {
    const before = await readdir(ctx.uploadsDir);
    const res = await alice.upload(
      '/posts',
      { caption: '' },
      { field: 'image', buffer: Buffer.from('<?php echo 1; ?>  padding'), name: 'evil.png', type: 'image/png' },
    );
    assert.equal(res.statusCode, 422);
    assert.match(res.body, /JPEG, PNG, GIF и WebP/);
    assert.deepEqual(await readdir(ctx.uploadsDir), before, 'nothing is written to disk');
  });

  test('rejects files above the size limit', async () => {
    const small = await createTestApp({ maxUploadBytes: 1024 });
    try {
      const client = small.client();
      await client.register('big');
      const huge = Buffer.concat([PNG, Buffer.alloc(4096)]);
      const res = await client.upload('/posts', {}, { field: 'image', buffer: huge, name: 'big.png', type: 'image/png' });
      assert.equal(res.statusCode, 422);
      assert.match(res.body, /Файл слишком большой/);
    } finally {
      await small.close();
    }
  });

  test('guests cannot post', async () => {
    const res = await ctx
      .client()
      .upload('/posts', { caption: 'x' }, { field: 'image', buffer: PNG, name: 'p.png', type: 'image/png' });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/login');
  });
});

describe('deleting posts', () => {
  let ctx;
  let owner;
  let stranger;
  before(async () => {
    ctx = await createTestApp();
    owner = ctx.client();
    stranger = ctx.client();
    await owner.register('owner');
    await stranger.register('stranger');
  });
  after(() => ctx.close());

  test('only the author sees the delete button and can delete', async () => {
    const id = await owner.createPost('mine');
    const { image } = ctx.app.db.prepare('SELECT image FROM posts WHERE id = ?').get(id);

    assert.match((await owner.get(`/p/${id}`)).body, /action="\/p\/\d+\/delete"/);
    assert.doesNotMatch((await stranger.get(`/p/${id}`)).body, /\/delete"/);

    const denied = await stranger.post(`/p/${id}/delete`);
    assert.equal(denied.statusCode, 404);
    assert.equal((await owner.get(`/p/${id}`)).statusCode, 200);

    const ok = await owner.post(`/p/${id}/delete`);
    assert.equal(ok.statusCode, 302);
    assert.equal(ok.headers.location, '/u/owner');
    assert.equal((await owner.get(`/p/${id}`)).statusCode, 404);
    assert.ok(!existsSync(join(ctx.uploadsDir, image)), 'image file removed');
  });

  test('unknown posts return 404', async () => {
    for (const url of ['/p/999999', '/p/abc', '/p/-1']) {
      const res = await owner.get(url);
      assert.equal(res.statusCode, 404, url);
      assert.match(res.body, /Страница не найдена/);
    }
  });
});

describe('feed', () => {
  let ctx;
  let alice;
  let bob;
  before(async () => {
    ctx = await createTestApp();
    alice = ctx.client();
    bob = ctx.client();
    await alice.register('alice');
    await bob.register('bob');
  });
  after(() => ctx.close());

  test('is empty initially', async () => {
    const res = await ctx.client().get('/feed');
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Здесь пока пусто/);
  });

  test('shows posts of all users, newest first', async () => {
    await alice.createPost('first from alice');
    await bob.createPost('second from bob');
    await alice.createPost('third from alice');

    const body = (await ctx.client().get('/feed')).body;
    const order = ['third from alice', 'second from bob', 'first from alice'].map((t) => body.indexOf(t));
    assert.ok(order.every((pos) => pos >= 0), 'all posts present');
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'sorted by creation time, desc');
  });

  test('offers a follow button for other authors only', async () => {
    const body = (await alice.get('/feed')).body;
    assert.match(body, /action="\/u\/bob\/follow"/);
    assert.doesNotMatch(body, /action="\/u\/alice\/follow"/);
  });

  test('guests get a sign-in link instead of a follow form', async () => {
    const body = (await ctx.client().get('/feed')).body;
    assert.doesNotMatch(body, /\/follow"/);
    assert.match(body, /href="\/login\?next=%2Ffeed"/);
  });

  test('following from the feed returns to the feed and updates the button', async () => {
    const res = await alice.post('/u/bob/follow', { back: '/feed' });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/feed');

    const body = (await alice.get('/feed')).body;
    assert.match(body, /action="\/u\/bob\/unfollow"/);
    assert.match(body, /Вы подписаны/);

    await alice.post('/u/bob/unfollow', { back: '/feed' });
  });

  test('is paginated by 10 posts', async () => {
    const paged = await createTestApp();
    try {
      const client = paged.client();
      await client.register('paginator');
      for (let i = 1; i <= 12; i += 1) await client.createPost(`post #${i}`);

      const first = decodeEq((await client.get('/feed')).body);
      assert.equal(count(first, 'class="card post-card'), 10);
      assert.match(first, /href="\/feed\?page=2"/);

      const second = (await client.get('/feed?page=2')).body;
      assert.equal(count(second, 'class="card post-card'), 2);
      assert.match(second, /post #1\b/);
    } finally {
      await paged.close();
    }
  });
});
