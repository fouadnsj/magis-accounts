// Password-protected copies of a database (Fouad, 21 November 2026: "if someone gets the file, he reads everything").
//
// A copy that leaves the server (the downloaded one, the one sent to the mirror folder) is encrypted with ONE password
// that the owner decides (Admin → Backups). The server keeps only the key derived from it, never the password; the same
// key opens every copy because the file carries its own salt. Whoever holds the password can open a copy anywhere
// (restore, or bring it to another server); nobody else can, not even us.
//
// Format:  "MAGISBAK1" (9 bytes) · iterations (4, big endian) · salt (16) · iv (12) · AES-256-GCM(ciphertext + tag)
// The header is authenticated too (a changed header makes the copy refuse to open). Works in the browser, in Node
// and in the tests: the Web Crypto API only.

const MAGIC = new TextEncoder().encode('MAGISBAK1');
const HEAD = MAGIC.length + 4 + 16 + 12;
/** PBKDF2-SHA256 rounds: slow on purpose, to make guessing the password expensive */
export const PROTECT_ITERATIONS = 600_000;

const subtle = () => globalThis.crypto.subtle;
const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

/** is this file one of our protected copies? */
export function isProtected(bytes: Uint8Array): boolean {
  if (bytes.length < HEAD) return false;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) return false;
  return true;
}

/** The key a password gives with this salt (what the server keeps instead of the password). */
export async function deriveKey(password: string, salt: Uint8Array, iterations = PROTECT_ITERATIONS): Promise<Uint8Array> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}

/** A new salt, for a new password. */
export const newSalt = () => rand(16);

/** Encrypts a copy with a key already derived (salt and rounds are written in the file). */
export async function protectWithKey(plain: Uint8Array, key: Uint8Array, salt: Uint8Array, iterations = PROTECT_ITERATIONS): Promise<Uint8Array> {
  const iv = rand(12);
  const head = new Uint8Array(HEAD);
  head.set(MAGIC, 0);
  new DataView(head.buffer).setUint32(MAGIC.length, iterations);
  head.set(salt, MAGIC.length + 4);
  head.set(iv, MAGIC.length + 4 + 16);
  const k = await subtle().importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: head }, k, plain));
  const out = new Uint8Array(HEAD + body.length);
  out.set(head, 0);
  out.set(body, HEAD);
  return out;
}

/** Encrypts with a password (a new salt): for the tests and for a one-off. */
export async function protect(plain: Uint8Array, password: string, iterations = PROTECT_ITERATIONS): Promise<Uint8Array> {
  const salt = newSalt();
  return protectWithKey(plain, await deriveKey(password, salt, iterations), salt, iterations);
}

export class WrongPassword extends Error {
  constructor() { super('Wrong password, or the copy was changed'); this.name = 'WrongPassword'; }
}

/** Opens a protected copy with the password; throws WrongPassword if it is not the right one (or the file was touched). */
export async function unprotect(file: Uint8Array, password: string): Promise<Uint8Array> {
  if (!isProtected(file)) throw new Error('Not a protected copy');
  const head = file.slice(0, HEAD);
  const iterations = new DataView(head.buffer).getUint32(MAGIC.length);
  if (iterations < 1000 || iterations > 5_000_000) throw new Error('Not a protected copy');
  const salt = head.slice(MAGIC.length + 4, MAGIC.length + 20);
  const iv = head.slice(MAGIC.length + 20, HEAD);
  const key = await subtle().importKey('raw', await deriveKey(password, salt, iterations), 'AES-GCM', false, ['decrypt']);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: head }, key, file.slice(HEAD)));
  } catch {
    throw new WrongPassword();
  }
}
