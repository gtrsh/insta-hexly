import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestApp } from './helpers.js';

describe('landing page', () => {
  let ctx;
  before(async () => (ctx = await createTestApp()));
  after(() => ctx.close());

  test('describes the service and invites guests to register', async () => {
    const res = await ctx.client().get('/');
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /Создать аккаунт/);
    assert.match(res.body, /href="\/register"/);
  });

  test('redirects signed-in users to the feed', async () => {
    const client = ctx.client();
    await client.register('landing_user');
    const res = await client.get('/');
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/feed');
  });

  test('serves Bootstrap and app assets', async () => {
    const client = ctx.client();
    for (const url of ['/vendor/bootstrap/css/bootstrap.min.css', '/static/css/app.css', '/static/favicon.svg']) {
      const res = await client.get(url);
      assert.equal(res.statusCode, 200, url);
    }
  });
});

describe('registration', () => {
  let ctx;
  before(async () => (ctx = await createTestApp()));
  after(() => ctx.close());

  test('creates an account, signs the user in and shows a welcome message', async () => {
    const client = ctx.client();
    const res = await client.register('alice');
    assert.equal(res.headers.location, '/feed');
    assert.ok(client.cookies.has('sid'), 'session cookie is set');

    const feed = await client.get('/feed');
    assert.match(feed.body, /Добро пожаловать, alice/);
    assert.match(feed.body, /href="\/u\/alice"/);

    const again = await client.get('/feed');
    assert.doesNotMatch(again.body, /Добро пожаловать/);
  });

  test('stores a password hash, never the password', async () => {
    await ctx.client().register('hash_check', { password: 'super-secret-pass' });
    const row = ctx.app.db.prepare('SELECT password_hash FROM users WHERE username = ?').get('hash_check');
    assert.match(row.password_hash, /^scrypt\$/);
    assert.doesNotMatch(row.password_hash, /super-secret-pass/);
  });

  test('rejects a username that already exists (case-insensitive)', async () => {
    await ctx.client().register('bob');
    const res = await ctx.client().post('/register', {
      username: 'BOB',
      email: 'other-bob@example.com',
      password: 'password123',
      passwordConfirm: 'password123',
    });
    assert.equal(res.statusCode, 422);
    assert.match(res.body, /Это имя пользователя уже занято/);
    assert.match(res.body, /value="other-bob@example.com"/, 'keeps entered values');
  });

  test('rejects an email that already exists (case-insensitive)', async () => {
    await ctx.client().register('carol', { email: 'carol@example.com' });
    const res = await ctx.client().post('/register', {
      username: 'carol2',
      email: 'Carol@Example.com',
      password: 'password123',
      passwordConfirm: 'password123',
    });
    assert.equal(res.statusCode, 422);
    assert.match(res.body, /почтой уже зарегистрирован/);
  });

  test('validates username, email and password', async () => {
    const res = await ctx.client().post('/register', {
      username: 'a b',
      email: 'not-an-email',
      password: 'short',
      passwordConfirm: 'short',
    });
    assert.equal(res.statusCode, 422);
    assert.match(res.body, /3-30 символов, латинские буквы/);
    assert.match(res.body, /корректный адрес/);
    assert.match(res.body, /от 8 до 128 символов/);
  });

  test('requires matching password confirmation', async () => {
    const res = await ctx.client().post('/register', {
      username: 'dave',
      email: 'dave@example.com',
      password: 'password123',
      passwordConfirm: 'password124',
    });
    assert.equal(res.statusCode, 422);
    assert.match(res.body, /Пароли не совпадают/);
  });

  test('escapes user input when re-rendering the form', async () => {
    const res = await ctx.client().post('/register', { username: '<script>x</script>', email: '' });
    assert.equal(res.statusCode, 422);
    assert.doesNotMatch(res.body, /<script>x<\/script>/);
    assert.match(res.body, /&lt;script&gt;/);
  });
});

describe('login and logout', () => {
  let ctx;
  before(async () => {
    ctx = await createTestApp();
    await ctx.client().register('erin', { email: 'erin@example.com', password: 'correct-horse' });
  });
  after(() => ctx.close());

  test('signs in with username', async () => {
    const client = ctx.client();
    const res = await client.post('/login', { login: 'erin', password: 'correct-horse' });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/feed');
    assert.ok(client.cookies.has('sid'));
  });

  test('signs in with email', async () => {
    const res = await ctx.client().post('/login', { login: 'ERIN@example.com', password: 'correct-horse' });
    assert.equal(res.statusCode, 302);
  });

  test('rejects a wrong password and an unknown user with the same message', async () => {
    for (const login of ['erin', 'nobody']) {
      const res = await ctx.client().post('/login', { login, password: 'wrong-password' });
      assert.equal(res.statusCode, 401);
      assert.match(res.body, /Неверное имя пользователя, почта или пароль/);
    }
  });

  test('redirects to a local `next` page but never to another site', async () => {
    const ok = await ctx.client().post('/login', { login: 'erin', password: 'correct-horse', next: '/posts/new' });
    assert.equal(ok.headers.location, '/posts/new');

    for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
      const res = await ctx.client().post('/login', { login: 'erin', password: 'correct-horse', next });
      assert.equal(res.headers.location, '/feed', next);
    }
  });

  test('protected pages redirect guests to login with a return path', async () => {
    const res = await ctx.client().get('/posts/new');
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/login?next=%2Fposts%2Fnew');
  });

  test('logout ends the session server-side', async () => {
    const client = ctx.client();
    await client.post('/login', { login: 'erin', password: 'correct-horse' });
    const stolenSid = client.cookies.get('sid');

    const res = await client.post('/logout');
    assert.equal(res.headers.location, '/');
    assert.ok(!client.cookies.has('sid'));

    const replay = ctx.client();
    replay.cookies.set('sid', stolenSid);
    const page = await replay.get('/posts/new');
    assert.equal(page.statusCode, 302);
  });

  test('ignores tampered session cookies', async () => {
    const client = ctx.client();
    client.cookies.set('sid', 'forged.value');
    const res = await client.get('/settings');
    assert.equal(res.statusCode, 302);
  });

  test('rejects cross-origin form posts', async () => {
    const client = ctx.client();
    await client.post('/login', { login: 'erin', password: 'correct-horse' });
    const res = await client.post('/logout', {}, { origin: 'https://evil.example' });
    assert.equal(res.statusCode, 403);

    const sameOrigin = await client.post('/logout', {}, { origin: 'http://localhost' });
    assert.equal(sameOrigin.statusCode, 302);
  });
});
