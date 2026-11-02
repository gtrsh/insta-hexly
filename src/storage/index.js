import { createLocalStorage } from './local.js';

export function createStorage(config) {
  return createLocalStorage(config.storage.local);
}

export async function removeQuietly(storage, name, log) {
  if (!name) return;
  try {
    await storage.remove(name);
  } catch (err) {
    log.warn({ err, name }, 'failed to remove stored image');
  }
}
