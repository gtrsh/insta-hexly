import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildApp } from '../src/app.js';

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function createTestApp(overrides = {}, deps = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hexlygram-test-'));
  const app = await buildApp(
    {
      dataDir: dir,
      dbPath: ':memory:',
      cookieSecret: 'test-secret-test-secret-test-secret',
      logger: false,
      storage: { driver: 'local', local: { dir: join(dir, 'uploads') } },
      ...overrides,
    },
    deps,
  );
  await app.ready();

  return {
    app,
    uploadsDir: app.storage.dir,
    client: () => new Client(app),
    async close() {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export class Client {
  constructor(app) {
    this.app = app;
    this.cookies = new Map();
  }

  async request({ headers = {}, ...options }) {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
    const res = await this.app.inject({ ...options, headers: { ...headers, ...(cookie ? { cookie } : {}) } });

    for (const c of res.cookies) {
      const expired = c.value === '' || (c.expires && c.expires.getTime() <= Date.now()) || c.maxAge === 0;
      if (expired) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  get(url, headers) {
    return this.request({ method: 'GET', url, headers });
  }

  post(url, form = {}, headers = {}) {
    return this.request({
      method: 'POST',
      url,
      payload: new URLSearchParams(form).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    });
  }

  upload(url, fields = {}, file = null) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    if (file) {
      form.append(file.field, new Blob([file.buffer], { type: file.type ?? 'application/octet-stream' }), file.name);
    }
    return this.request({ method: 'POST', url, payload: form });
  }

  async register(username, { email = `${username}@example.com`, password = 'password123' } = {}) {
    const res = await this.post('/register', { username, email, password, passwordConfirm: password });
    if (res.statusCode !== 302) throw new Error(`registration failed: ${res.statusCode}\n${res.body}`);
    return res;
  }

  async createPost(caption = '', buffer = PNG) {
    const res = await this.upload('/posts', { caption }, { field: 'image', buffer, name: 'photo.png', type: 'image/png' });
    if (res.statusCode !== 302) throw new Error(`post creation failed: ${res.statusCode}\n${res.body}`);
    return Number(res.headers.location.split('/').pop());
  }
}

export const count = (haystack, needle) => haystack.split(needle).length - 1;

export const decodeEq = (html) => html.replaceAll('&#x3D;', '=');
