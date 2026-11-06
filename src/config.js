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

function normalisePrefix(value) {
  const trimmed = String(value ?? '').replace(/^\/+|\/+$/g, '');
  return trimmed ? `${trimmed}/` : '';
}

export function storageConfigFromEnv(env, { uploadsDir }) {
  const driver = (env.STORAGE ?? 'local').toLowerCase();
  if (driver !== 'local' && driver !== 's3') {
    throw new Error(`STORAGE must be "local" or "s3", got "${env.STORAGE}"`);
  }

  const storage = { driver, local: { dir: uploadsDir } };
  if (driver !== 's3') return storage;

  const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
  if (missing.length > 0) throw new Error(`STORAGE=s3 requires: ${missing.join(', ')}`);

  storage.s3 = {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || 'us-east-1',
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    prefix: normalisePrefix(env.S3_PREFIX ?? 'uploads'),
    publicUrl: env.S3_PUBLIC_URL ?? '',
  };
  return storage;
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
    storage: overrides.storage ?? storageConfigFromEnv(process.env, { uploadsDir }),
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
