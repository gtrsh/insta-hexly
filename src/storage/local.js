import { mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { newImageName } from '../lib/images.js';

export function createLocalStorage({ dir }) {
  mkdirSync(dir, { recursive: true });

  return {
    driver: 'local',
    dir,
    servesThroughApp: false,

    async save(buffer, ext) {
      const name = newImageName(ext);
      await writeFile(join(dir, name), buffer, { flag: 'wx' });
      return name;
    },

    async remove(name) {
      if (!name) return;
      try {
        await unlink(join(dir, basename(name)));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    },

    url: (name) => `/uploads/${name}`,
  };
}
