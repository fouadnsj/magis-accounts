// Password-protected copies (21 November 2026).
import { describe, expect, it } from 'vitest';
import { deriveKey, isProtected, newSalt, protect, protectWithKey, unprotect, WrongPassword } from '../src/io/protect';

const FAST = 2000; // rounds, to keep the tests quick (the program uses 600 000)
const sample = new TextEncoder().encode('SQLite format 3\0 and then the whole finance of a centre, readable');

describe('a protected copy', () => {
  it('opens with the password, and only with it', async () => {
    const f = await protect(sample, 'correct horse', FAST);
    expect(isProtected(f)).toBe(true);
    expect(isProtected(sample)).toBe(false);
    expect(new TextDecoder().decode(f)).not.toContain('SQLite format');
    expect(await unprotect(f, 'correct horse')).toEqual(sample);
    await expect(unprotect(f, 'wrong password')).rejects.toBeInstanceOf(WrongPassword);
    await expect(unprotect(f, '')).rejects.toBeInstanceOf(WrongPassword);
  });

  it('one key opens every copy: the server keeps the key, never the password', async () => {
    const salt = newSalt();
    const key = await deriveKey('the owner password', salt, FAST);
    const a = await protectWithKey(sample, key, salt, FAST);
    const b = await protectWithKey(new TextEncoder().encode('another copy'), key, salt, FAST);
    expect(await unprotect(a, 'the owner password')).toEqual(sample);
    expect(new TextDecoder().decode(await unprotect(b, 'the owner password'))).toBe('another copy');
    // two copies of the same data are not the same bytes (a new iv each time)
    expect(toStr(await protectWithKey(sample, key, salt, FAST))).not.toBe(toStr(a));
  });

  it('a touched copy refuses to open (the body, the header, the end)', async () => {
    const f = await protect(sample, 'pw-12345', FAST);
    for (const at of [f.length - 1, 40, 12]) {
      const t = Uint8Array.from(f);
      t[at] ^= 1;
      await expect(unprotect(t, 'pw-12345')).rejects.toThrow();
    }
    await expect(unprotect(f.slice(0, f.length - 5), 'pw-12345')).rejects.toThrow();
  });

  it('a big file (a few MB) goes through', async () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) % 251);
    const f = await protect(big, 'a long enough password', FAST);
    expect((await unprotect(f, 'a long enough password')).length).toBe(big.length);
  });
});

const toStr = (b: Uint8Array) => Buffer.from(b).toString('hex');
