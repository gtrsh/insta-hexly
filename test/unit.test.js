import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPagination, parsePage } from '../src/lib/pagination.js';
import { detectImageType } from '../src/lib/images.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { safeLocalPath, validateCaption, validateRegistration } from '../src/lib/validation.js';
import { plural } from '../src/lib/view-helpers.js';
import { PNG } from './helpers.js';

describe('pagination', () => {
  test('parsePage falls back to 1 for invalid input', () => {
    assert.equal(parsePage('3'), 3);
    for (const value of [undefined, '', '0', '-2', 'abc']) assert.equal(parsePage(value), 1);
  });

  test('single page has no links', () => {
    const p = buildPagination({ page: 1, pageSize: 9, total: 5, baseUrl: '/u/a' });
    assert.equal(p.hasPages, false);
    assert.equal(p.totalPages, 1);
  });

  test('builds prev/next links and an ellipsis window', () => {
    const p = buildPagination({ page: 6, pageSize: 9, total: 9 * 12, baseUrl: '/u/a' });
    assert.equal(p.prev, '/u/a?page=5');
    assert.equal(p.next, '/u/a?page=7');
    const labels = p.items.map((i) => (i.ellipsis ? '…' : i.number));
    assert.deepEqual(labels, [1, '…', 4, 5, 6, 7, 8, '…', 12]);
    assert.equal(p.items.find((i) => i.active).number, 6);
    assert.equal(p.items[0].href, '/u/a', 'page 1 uses the bare URL');
  });

  test('clamps to the last page', () => {
    const p = buildPagination({ page: 50, pageSize: 10, total: 25, baseUrl: '/feed' });
    assert.equal(p.page, 3);
    assert.equal(p.next, null);
  });
});

describe('image detection', () => {
  test('recognises supported formats by magic bytes', () => {
    assert.equal(detectImageType(PNG), 'png');
    assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(12).fill(0)])), 'jpg');
    assert.equal(detectImageType(Buffer.from('GIF89a\0\0\0\0\0\0\0\0')), 'gif');
    assert.equal(detectImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  });

  test('rejects everything else', () => {
    assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(detectImageType(Buffer.from('short')), null);
    assert.equal(detectImageType(Buffer.alloc(0)), null);
  });
});

describe('passwords', () => {
  test('hash and verify', async () => {
    const hash = await hashPassword('s3cret-pass');
    assert.notEqual(hash, await hashPassword('s3cret-pass'), 'salted');
    assert.equal(await verifyPassword('s3cret-pass', hash), true);
    assert.equal(await verifyPassword('wrong', hash), false);
    assert.equal(await verifyPassword('s3cret-pass', 'garbage'), false);
  });
});

describe('validation', () => {
  test('normalises registration input', () => {
    const { values, errors } = validateRegistration({
      username: '  john.doe ',
      email: ' John@Example.COM ',
      password: 'password123',
      passwordConfirm: 'password123',
    });
    assert.deepEqual(values, { username: 'john.doe', email: 'john@example.com' });
    assert.deepEqual(errors, {});
  });

  test('rejects badly placed dots in usernames', () => {
    for (const username of ['.john', 'john.', 'jo..hn']) {
      const { errors } = validateRegistration({ username, email: 'a@b.cc', password: 'x'.repeat(8), passwordConfirm: 'x'.repeat(8) });
      assert.ok(errors.username, username);
    }
  });

  test('caption length counts characters, not UTF-16 units', () => {
    assert.equal(validateCaption('🙂'.repeat(10), 10).error, null);
    assert.ok(validateCaption('a'.repeat(11), 10).error);
    assert.equal(validateCaption('  line1\r\nline2  ', 100).caption, 'line1\nline2');
  });

  test('safeLocalPath only allows same-site paths', () => {
    assert.equal(safeLocalPath('/feed?page=2'), '/feed?page=2');
    assert.equal(safeLocalPath('//evil.example'), '/');
    assert.equal(safeLocalPath('https://evil.example', '/x'), '/x');
    assert.equal(safeLocalPath(undefined, '/x'), '/x');
  });
});

describe('russian plurals', () => {
  test('picks the right form', () => {
    const f = (n) => plural(n, 'подписчик', 'подписчика', 'подписчиков');
    assert.equal(f(1), 'подписчик');
    assert.equal(f(21), 'подписчик');
    assert.equal(f(3), 'подписчика');
    assert.equal(f(5), 'подписчиков');
    assert.equal(f(11), 'подписчиков');
    assert.equal(f(0), 'подписчиков');
  });
});
