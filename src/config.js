import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MB = 1024 * 1024;

function resolveCookieSecret(dataDir) {
  if (process.env.COOKIE_SECRET) return process.env.COOKIE_SECRET;

  const secretPath = join(dataDir, '.cookie-secret');
  if (existsSync(secretPath)) return readFileSync(secretPath, 'utf8').trim();

  const secret = randomBytes(32).toString('hex');
  writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(overrides = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const dataDir = resolve(overrides.dataDir ?? process.env.DATA_DIR ?? 'data');
  const uploadsDir = resolve(overrides.uploadsDir ?? join(dataDir, 'uploads'));

  mkdirSync(dataDir, { recursive: true });

  return {
    isProduction,
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
    dataDir,
    dbPath: overrides.dbPath ?? join(dataDir, 'app.db'),
    storage: overrides.storage ?? { driver: 'local', local: { dir: uploadsDir } },
    cookieSecret: overrides.cookieSecret ?? resolveCookieSecret(dataDir),
    secureCookies: overrides.secureCookies ?? process.env.SECURE_COOKIES === 'true',
    trustProxy: process.env.TRUST_PROXY === 'true',
    logger: overrides.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    maxUploadBytes: overrides.maxUploadBytes ?? 10 * MB,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    feedPageSize: 10,
    profilePageSize: 9,
    captionMaxLength: 1000,
  };
}
