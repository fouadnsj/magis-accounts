// Users and passwords. A password is never stored: only a slow salted hash
// (PBKDF2-SHA256), so a stolen database does not give the passwords away.
// Older databases hold a quick SHA-256 of a 4-digit PIN: still accepted, but
// reported as "weak" so the network server asks for a new password.
import { type Db, one } from './db/db';
import { auditStmt, getMeta, UserError } from './db/repo';
import { m } from './i18n';
import type { Role } from './domain/types';
import { cleanPerms, type Perm } from './perms';
import { cleanExtra, rolePerms, unionPerms, withEveryone, type RoleLike } from './roles';

/** A person who can log in: his permission profile's ticks and the books he keeps. */
export interface Profile {
  id: number;
  name: string;
  role: Role; // kept for older files; permissions now come from the profile
  book_id: number | null; // first book kept (older files)
  active: number;
  access_id: number | null;
  access_name: string;
  perms: Perm[];
  books: number[];
  /** a community office this account is: superior | econome | minister | admin (null = a person) */
  office?: string | null;
  /** the person who holds the office now */
  held_by?: string | null;
  /** in the HR database: the centres this person sees (codes: jaramana, aleppo, homs, other); null = every centre */
  hrCentres?: string[] | null;
  /** (roles step 1) every role this person holds: his first role (access_id) and the others; perms = all their ticks together */
  roles?: { id: number; name: string; kind: string | null }[];
  /** the "Advanced" exceptions on this person (ticks added to his roles) */
  extra?: Perm[];
  /** holds the Administrator role (only he gives Administrator or Director) */
  admin?: boolean;
}

export const has = (p: Pick<Profile, 'perms'>, perm: Perm) => p.perms.includes(perm);

/** Reads a person with his permissions and books; null if unknown or deactivated. */
export async function loadProfile(db: Db, id: number): Promise<Profile | null> {
  const r = await one<{ id: number; name: string; role: Role; book_id: number | null; active: number; access_id: number | null; access_name: string | null; perms: string | null; office: string | null; held_by: string | null; hr_centres: string | null }>(
    db,
    `SELECT p.id, p.name, p.role, p.book_id, p.active, p.access_id, a.name AS access_name, a.perms, p.cty_office AS office, p.held_by, p.hr_centres
       FROM profile p LEFT JOIN access_profile a ON a.id = p.access_id WHERE p.id = ? AND p.active = 1`,
    [id],
  );
  if (!r) return null;
  const books = (await db.query<{ book_id: number }>('SELECT book_id FROM user_book WHERE profile_id = ? ORDER BY book_id', [id])).map((b) => b.book_id);
  const { hr_centres, ...rest } = r;
  const hrCentres = hr_centres ? (JSON.parse(hr_centres) as string[]).filter((x) => typeof x === 'string') : null;
  const base = { ...rest, access_name: r.access_name ?? '', perms: cleanPerms(r.perms ? JSON.parse(r.perms) : []), books, book_id: books[0] ?? r.book_id, hrCentres: hrCentres?.length ? hrCentres : null };
  const more = await rolesOf(db, id, r.access_id);
  // (26 November 2026) in a centre's database every person with an account looks at the calendar (src/roles.ts EVERYONE)
  const kind = await getMeta(db, 'kind');
  const everyone = (ps: Perm[]) => (kind === 'community' || kind === 'country' || kind === 'hr' || kind === 'province' ? ps : withEveryone(ps));
  if (!more) return { ...base, perms: everyone(base.perms) }; // a database from before update 77
  return { ...base, perms: everyone(unionPerms(more.roles, more.extra)), roles: more.roles.map(({ id: rid, name, kind }) => ({ id: rid, name, kind })), extra: more.extra, admin: more.roles.some((x) => x.kind === 'administrator') };
}

/**
 * A person's roles (his first role and the others) and exceptions; null for a database from before update 77.
 * Does not look at "active" (the screens also ask about people switched off).
 */
export async function rolesOf(db: Db, id: number, accessId?: number | null): Promise<{ roles: RoleLike[]; extra: Perm[] } | null> {
  let rows: { id: number; name: string; kind: string | null; perms: string }[];
  let extra: string | null;
  try {
    const first = accessId === undefined ? (await one<{ access_id: number | null }>(db, 'SELECT access_id FROM profile WHERE id = ?', [id]))?.access_id ?? null : accessId;
    rows = await db.query(
      `SELECT a.id, a.name, a.kind, a.perms FROM access_profile a
        WHERE a.id = ? OR a.id IN (SELECT access_id FROM profile_role WHERE profile_id = ?) ORDER BY a.id = ? DESC, a.sort, a.id`,
      [first ?? -1, id, first ?? -1],
    );
    extra = (await one<{ extra_perms: string | null }>(db, 'SELECT extra_perms FROM profile WHERE id = ?', [id]))?.extra_perms ?? null;
  } catch (e) {
    if (/no such (table|column)/i.test(String((e as Error)?.message ?? e))) return null;
    throw e;
  }
  let ex: Perm[] = [];
  try { ex = extra ? cleanExtra(JSON.parse(extra)) : []; } catch { ex = []; }
  return { roles: rows.map((x) => ({ id: x.id, name: x.name, kind: x.kind, perms: rolePerms(x.kind, cleanPerms(JSON.parse(x.perms))) })), extra: ex };
}

/** A person's rights (all roles and exceptions together), active or not; null if unknown. */
export async function personPerms(db: Db, id: number): Promise<Perm[] | null> {
  const p = await one<{ access_id: number | null }>(db, 'SELECT access_id FROM profile WHERE id = ?', [id]);
  if (!p) return null;
  const more = await rolesOf(db, id, p.access_id);
  if (more) return unionPerms(more.roles, more.extra);
  const a = p.access_id == null ? null : await one<{ perms: string }>(db, 'SELECT perms FROM access_profile WHERE id = ?', [p.access_id]);
  return a ? cleanPerms(JSON.parse(a.perms)) : [];
}

/** The old role column, guessed from the ticks (only older parts of the program read it). */
export function roleFor(perms: Perm[]): Role {
  return perms.includes('users.manage') ? 'sup' : perms.includes('register.view') ? 'com' : 'holder';
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

/** Statement creating a person. access_id: his permission profile (1 Superior, 2 Accountant, 3 Book holder by default). */
export async function profileStmt(p: { name: string; role: Role; pin: string; book_id?: number | null; access_id?: number }) {
  checkSecretShape(p.pin);
  const salt = crypto.randomUUID();
  const access = p.access_id ?? (p.role === 'sup' ? 1 : p.role === 'com' ? 2 : 3);
  return {
    sql: 'INSERT INTO profile (name, role, pin_salt, pin_hash, book_id, access_id) VALUES (?, ?, ?, ?, ?, ?)',
    params: [p.name.trim(), p.role, salt, await hashSecret(salt, p.pin), p.book_id ?? null, access],
  };
}

/** Names on the login screen: name and permission profile only. */
/** The people shown on the sign-in page: name, role, profile, and the books they keep. */
export interface LoginPerson { id: number; name: string; role: Role; access_id?: number | null; access_name: string; books?: string | null; office?: string | null; held_by?: string | null }

export async function listProfiles(db: Db): Promise<LoginPerson[]> {
  return db.query(
    `SELECT p.id, p.name, p.role, p.access_id, COALESCE(a.name, '') AS access_name, p.cty_office AS office, p.held_by,
            (SELECT group_concat(b.name, ' · ') FROM user_book ub JOIN book b ON b.id = ub.book_id WHERE ub.profile_id = p.id) AS books
       FROM profile p LEFT JOIN access_profile a ON a.id = p.access_id
      WHERE p.active = 1 ORDER BY a.sort, p.name`,
  );
}

export async function login(db: Db, profileId: number, secret: string): Promise<{ profile: Profile; weak: boolean; given: boolean }> {
  const r = await one<{ pin_salt: string; pin_hash: string; must_change: number }>(db, 'SELECT pin_salt, pin_hash, must_change FROM profile WHERE id = ? AND active = 1', [profileId]);
  const v = r ? await verifySecret(r.pin_salt, secret, r.pin_hash) : { ok: false, weak: false };
  const profile = r && v.ok ? await loadProfile(db, profileId) : null;
  if (!profile) throw new UserError(m('كلمة السر غير صحيحة', 'Wrong password'));
  // weak: an old-style 4-digit PIN (must change on the network).
  // given: a password set by the Superior (must change everywhere: only the person knows his own).
  return { profile, weak: v.weak, given: !!r!.must_change };
}

/** mustChange: set by the Superior for someone else — that person will choose his own at the next login. */
export async function changePin(db: Db, profileId: number, secret: string, who: string, mustChange = false) {
  checkSecretShape(secret);
  const salt = crypto.randomUUID();
  await db.batch([
    { sql: 'UPDATE profile SET pin_salt = ?, pin_hash = ?, must_change = ? WHERE id = ?', params: [salt, await hashSecret(salt, secret), mustChange ? 1 : 0, profileId] },
    auditStmt(who, 'password', 'profile', String(profileId), null, null),
  ]);
}


