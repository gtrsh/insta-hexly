import { createLocalStorage } from './local.js';
import { createS3Storage } from './s3.js';

export function createStorage(config) {
  const { driver, local, s3 } = config.storage;
  if (driver === 's3') return createS3Storage(s3);
  return createLocalStorage(local);
}

export async function removeQuietly(storage, name, log) {
  if (!name) return;
  try {
    await storage.remove(name);
  } catch (err) {
    log.warn({ err, name }, 'failed to remove stored image');
  }
}
