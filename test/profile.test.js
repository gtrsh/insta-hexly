import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { count, createTestApp, decodeEq, PNG } from './helpers.js';

const stat = (body, name) => Number(body.match(new RegExp(`data-stat="${name}">(\\d+)<`))[1]);

describe('profile page', () => {
  let ctx;
  let alice;
  let bob;
  let carol;
  before(async () => {
    ctx = await createTestApp();
    alice = ctx.client();
    bob = ctx.client();
    carol = ctx.client();
    await alice.register('alice');
    await bob.register('Bob');
    await carol.register('carol');
  });
  after(() => ctx.close());

  test('returns 404 for unknown users', async () => {
    const res = await alice.get('/u/nobody');
    assert.equal(res.statusCode, 404);
  });

  test('redirects to the canonical username casing', async () => {
    const res = await alice.get('/u/bob');
    assert.equal(res.statusCode, 301);
    assert.equal(res.headers.location, '/u/Bob');
  });

  test('shows a placeholder avatar and zero counters for a new user', async () => {
    const body = (await ctx.client().get('/u/carol')).body;
    assert.match(body, /avatar-placeholder/);
    assert.equal(stat(body, 'posts'), 0);
    assert.equal(stat(body, 'followers'), 0);
    assert.equal(stat(body, 'following'), 0);
    assert.match(body, /Публикаций пока нет/);
  });

  test('shows 9 photos per page with pagination', async () => {
    for (let i = 1; i <= 11; i += 1) await bob.createPost(`bob #${i}`);

    const first = decodeEq((await alice.get('/u/Bob')).body);
    assert.equal(stat(first, 'posts'), 11);
    assert.equal(count(first, 'class="photo-tile"'), 9);
    assert.match(first, /href="\/u\/Bob\?page=2"/);
    assert.match(first, /title="bob #11"/, 'newest first');

    const second = (await alice.get('/u/Bob?page=2')).body;
    assert.equal(count(second, 'class="photo-tile"'), 2);
    assert.match(second, /title="bob #1"/);
    assert.match(second, /aria-current="page"/);

    const beyond = (await alice.get('/u/Bob?page=99')).body;
    assert.equal(count(beyond, 'class="photo-tile"'), 2, 'out-of-range page clamps to the last one');

    const garbage = await alice.get('/u/Bob?page=abc');
    assert.equal(count(garbage.body, 'class="photo-tile"'), 9);
  });

  test('does not paginate when everything fits on one page', async () => {
    await carol.createPost('only one');
    const body = (await alice.get('/u/carol')).body;
    assert.equal(count(body, 'class="photo-tile"'), 1);
    assert.doesNotMatch(body, /class="pagination/);
  });

  test('follow and unfollow update follower counts', async () => {
    let res = await alice.post('/u/Bob/follow', { back: '/u/Bob' });
    assert.equal(res.headers.location, '/u/Bob');
    await carol.post('/u/Bob/follow');
    await alice.post('/u/Bob/follow');

    let body = (await alice.get('/u/Bob')).body;
    assert.equal(stat(body, 'followers'), 2);
    assert.match(body, /action="\/u\/Bob\/unfollow"/);

    body = (await alice.get('/u/alice')).body;
    assert.equal(stat(body, 'following'), 1);

    res = await alice.post('/u/Bob/unfollow', { back: '/u/Bob' });
    assert.equal(res.statusCode, 302);
    body = (await alice.get('/u/Bob')).body;
    assert.equal(stat(body, 'followers'), 1);
    assert.match(body, /action="\/u\/Bob\/follow"/);
  });

  test('cannot follow yourself', async () => {
    const res = await alice.post('/u/alice/follow', { back: '/u/alice' });
    assert.equal(res.statusCode, 302);
    const body = (await alice.get('/u/alice')).body;
    assert.match(body, /Нельзя подписаться на самого себя/);
    assert.equal(stat(body, 'followers'), 0);
  });

  test('guests must sign in to follow', async () => {
    const res = await ctx.client().post('/u/Bob/follow');
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/login');
  });

  test('follow ignores external `back` redirects', async () => {
    const res = await alice.post('/u/Bob/follow', { back: 'https://evil.example' });
    assert.equal(res.headers.location, '/u/Bob');
  });

  test('own profile shows settings link instead of follow button', async () => {
    const body = (await alice.get('/u/alice')).body;
    assert.match(body, /href="\/settings"/);
    assert.doesNotMatch(body, /\/u\/alice\/follow"/);
  });
});

describe('avatar settings', () => {
  let ctx;
  let dana;
  before(async () => {
    ctx = await createTestApp();
    dana = ctx.client();
    await dana.register('dana');
  });
  after(() => ctx.close());

  const avatarOf = () => ctx.app.db.prepare('SELECT avatar FROM users WHERE username = ?').get('dana').avatar;

  test('uploads, replaces and removes the avatar', async () => {
    let res = await dana.upload('/settings/avatar', {}, { field: 'avatar', buffer: PNG, name: 'me.png', type: 'image/png' });
    assert.equal(res.statusCode, 302);
    const first = avatarOf();
    assert.ok(first);

    const profile = (await ctx.client().get('/u/dana')).body;
    assert.match(profile, new RegExp(`src="/uploads/${first}"`));

    await dana.upload('/settings/avatar', {}, { field: 'avatar', buffer: PNG, name: 'me2.png', type: 'image/png' });
    const second = avatarOf();
    assert.notEqual(second, first);
    assert.ok(!existsSync(join(ctx.uploadsDir, first)), 'old avatar file removed');

    res = await dana.post('/settings/avatar/delete');
    assert.equal(res.statusCode, 302);
    assert.equal(avatarOf(), null);
    assert.ok(!existsSync(join(ctx.uploadsDir, second)));
  });

  test('rejects non-image avatars', async () => {
    const res = await dana.upload(
      '/settings/avatar',
      {},
      { field: 'avatar', buffer: Buffer.from('definitely not an image'), name: 'a.jpg', type: 'image/jpeg' },
    );
    assert.equal(res.statusCode, 422);
    assert.match(res.body, /JPEG, PNG, GIF и WebP/);
  });

  test('settings require sign-in', async () => {
    const res = await ctx.client().get('/settings');
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/login?next=%2Fsettings');
  });
});
