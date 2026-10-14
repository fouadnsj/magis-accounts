// Users and passwords. A password is never stored: only a slow salted hash
// (PBKDF2-SHA256), so a stolen database does not give the passwords away.
// Older databases hold a quick SHA-256 of a 4-digit PIN: still accepted, but
// reported as "weak" so the network server asks for a new password.
import { type Db, one } from './db/db';
import { auditStmt, UserError } from './db/repo';
import { m } from './i18n';
import type { Role } from './domain/types';

export interface Profile {
  id: number;
  name: string;
  role: Role;
  book_id: number | null;
  active: number;
}

const ITER = 120_000;
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(salt: string, secret: string, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: iter }, key, 256);
  return hex(bits);
}

export async function hashSecret(salt: string, secret: string): Promise<string> {
  return `pbkdf2$${ITER}$${await pbkdf2(salt, secret, ITER)}`;
}

/** true/false, and whether the stored hash is of the old weak kind. */
export async function verifySecret(salt: string, secret: string, stored: string): Promise<{ ok: boolean; weak: boolean }> {
  if (stored.startsWith('pbkdf2$')) {
    const [, iter, h] = stored.split('$');
    return { ok: (await pbkdf2(salt, secret, Number(iter))) === h, weak: false };
  }
  const legacy = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + secret)));
  return { ok: legacy === stored, weak: true };
}

export function checkSecretShape(secret: string) {
  if (secret.length < 6) throw new UserError(m('كلمة السر 6 أحرف أو أرقام على الأقل', 'The password must have at least 6 characters'));
}

export async function profileStmt(p: { name: string; role: Role; pin: string; book_id?: number | null }) {
  checkSecretShape(p.pin);
  const salt = crypto.randomUUID();
  return {
    sql: 'INSERT INTO profile (name, role, pin_salt, pin_hash, book_id) VALUES (?, ?, ?, ?, ?)',
    params: [p.name.trim(), p.role, salt, await hashSecret(salt, p.pin), p.book_id ?? null],
  };
}

export async function listProfiles(db: Db): Promise<Profile[]> {
  return db.query<Profile>('SELECT id, name, role, book_id, active FROM profile WHERE active = 1 ORDER BY role DESC, name');
}

export async function login(db: Db, profileId: number, secret: string): Promise<{ profile: Profile; weak: boolean }> {
  const r = await one<Profile & { pin_salt: string; pin_hash: string }>(db, 'SELECT * FROM profile WHERE id = ? AND active = 1', [profileId]);
  const v = r ? await verifySecret(r.pin_salt, secret, r.pin_hash) : { ok: false, weak: false };
  if (!r || !v.ok) throw new UserError(m('كلمة السر غير صحيحة', 'Wrong password'));
  return { profile: { id: r.id, name: r.name, role: r.role, book_id: r.book_id, active: r.active }, weak: v.weak };
}

export async function changePin(db: Db, profileId: number, secret: string, who: string) {
  checkSecretShape(secret);
  const salt = crypto.randomUUID();
  await db.batch([
    { sql: 'UPDATE profile SET pin_salt = ?, pin_hash = ? WHERE id = ?', params: [salt, await hashSecret(salt, secret), profileId] },
    auditStmt(who, 'password', 'profile', String(profileId), null, null),
  ]);
}

/** What each role may open. Com = everything except donors, grants and coverage. */
export const can = {
  confidential: (r: Role) => r === 'sup',
  manageLists: (r: Role) => r === 'sup' || r === 'com',
  register: (r: Role) => r === 'sup' || r === 'com',
  reopenMonth: (r: Role) => r === 'sup',
  profiles: (r: Role) => r === 'sup',
};
