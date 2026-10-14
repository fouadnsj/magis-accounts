// PIN profiles. A PIN is never stored: only a salted SHA-256 of it.
// This keeps honest people out of screens they should not use; it is not
// encryption — whoever has the database file can read it.
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

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPin(salt: string, pin: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)));
}

export function checkPinShape(pin: string) {
  if (!/^\d{4,8}$/.test(pin)) throw new UserError(m('الرمز من 4 إلى 8 أرقام', 'The PIN must be 4 to 8 digits'));
}

export async function profileStmt(p: { name: string; role: Role; pin: string; book_id?: number | null }) {
  checkPinShape(p.pin);
  const salt = crypto.randomUUID();
  return {
    sql: 'INSERT INTO profile (name, role, pin_salt, pin_hash, book_id) VALUES (?, ?, ?, ?, ?)',
    params: [p.name, p.role, salt, await hashPin(salt, p.pin), p.book_id ?? null],
  };
}

export async function listProfiles(db: Db): Promise<Profile[]> {
  return db.query<Profile>('SELECT id, name, role, book_id, active FROM profile WHERE active = 1 ORDER BY role DESC, name');
}

export async function login(db: Db, profileId: number, pin: string): Promise<Profile> {
  const r = await one<Profile & { pin_salt: string; pin_hash: string }>(db, 'SELECT * FROM profile WHERE id = ? AND active = 1', [profileId]);
  if (!r || (await hashPin(r.pin_salt, pin)) !== r.pin_hash) throw new UserError(m('الرمز غير صحيح', 'Wrong PIN'));
  return { id: r.id, name: r.name, role: r.role, book_id: r.book_id, active: r.active };
}

export async function changePin(db: Db, profileId: number, pin: string, who: string) {
  checkPinShape(pin);
  const salt = crypto.randomUUID();
  await db.batch([
    { sql: 'UPDATE profile SET pin_salt = ?, pin_hash = ? WHERE id = ?', params: [salt, await hashPin(salt, pin), profileId] },
    auditStmt(who, 'pin', 'profile', String(profileId), null, null),
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
