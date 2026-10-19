// The people of a community and their roles, which can change during the year (Fouad,
// 18 October 2026: "a Jesuit becomes econome instead of another"). The books follow the
// roles: the minister keeps the house book, the econome the cash, the bank (if the
// community has one) and the account at the économat. A new econome sees all the old
// records at once: his role gives him every book.
// Also the community's settings: a bank or not, closing by quarter or by month, the
// banknotes counted at closing.

import { type Db, type Stmt, one } from '../db/db';
import { auditStmt, getMeta, UserError } from '../db/repo';
import { has, hashSecret, checkSecretShape } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import type { Perm } from '../perms';
import { CURS, type Cur } from './domain';
import { accessFor, type CtyRole } from './setup';

export type ClosePeriod = 'quarter' | 'month';
export interface CtySettings {
  /** the community has a bank account (Syria: usually not) */
  hasBank: boolean;
  /** members close their accounts every quarter (Fouad's suggestion) or every month */
  closePeriod: ClosePeriod;
  /** the banknotes of each currency, largest first, to count the cash */
  notes: Record<Cur, number[]>;
}

/**
 * Banknotes by default. The pound: the notes of the new Syrian pound (to confirm with
 * Fouad); the econome can change any list in the settings.
 */
export const DEFAULT_NOTES: Record<Cur, number[]> = {
  LOC: [500, 200, 100, 50, 25, 10],
  USD: [100, 50, 20, 10, 5, 2, 1],
  EUR: [500, 200, 100, 50, 20, 10, 5],
};

export async function loadSettings(db: Db): Promise<CtySettings> {
  const rows = await db.query<{ key: string; value: string | null }>("SELECT key, value FROM setting WHERE key LIKE 'cty_%'");
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const notes = { ...DEFAULT_NOTES };
  for (const c of CURS) {
    try {
      const v = JSON.parse(get(`cty_notes_${c}`) ?? 'null');
      if (Array.isArray(v) && v.every((x) => Number(x) > 0)) notes[c] = v.map(Number).sort((a, b) => b - a);
    } catch { /* keep the default */ }
  }
  return { hasBank: get('cty_has_bank') === '1', closePeriod: get('cty_close_period') === 'month' ? 'month' : 'quarter', notes };
}

const settingStmt = (key: string, value: string): Stmt => ({ sql: 'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', params: [key, value] });

// ---------------------------------------------------------------- people

export interface CtyPersonRow { id: number; name: string; roles: CtyRole[]; active: number; hasBank: boolean; mustChange: number; bookId: number | null }

export async function loadPeople(db: Db): Promise<CtyPersonRow[]> {
  const ps = await db.query<{ id: number; name: string; cty_roles: string | null; active: number; must_change: number }>('SELECT id, name, cty_roles, active, must_change FROM profile ORDER BY active DESC, name');
  const out: CtyPersonRow[] = [];
  for (const p of ps) {
    const books = await db.query<{ id: number; cty_kind: string; active: number }>('SELECT b.id, b.cty_kind, b.active FROM user_book ub JOIN book b ON b.id = ub.book_id WHERE ub.profile_id = ?', [p.id]);
    let roles: CtyRole[] = [];
    try { roles = JSON.parse(p.cty_roles ?? '[]'); } catch { roles = []; }
    out.push({ id: p.id, name: p.name, roles, active: p.active, mustChange: p.must_change, hasBank: books.some((b) => b.cty_kind === 'personal_bank' && b.active), bookId: books.find((b) => b.cty_kind === 'personal')?.id ?? null });
  }
  return out;
}

/** Gives each person the books of his roles (and takes away those of roles he no longer has). */
export async function syncBooksStmts(db: Db): Promise<Stmt[]> {
  const people = await loadPeople(db);
  const settings = await loadSettings(db);
  const books = await db.query<{ id: number; cty_kind: string; keeper_name: string | null }>('SELECT id, cty_kind, keeper_name FROM book WHERE cty_kind IS NOT NULL');
  const stmts: Stmt[] = [];
  for (const p of people) {
    const want = new Set<number>();
    for (const b of books) {
      if ((b.cty_kind === 'house' || b.cty_kind === 'envelope') && p.roles.includes('minister')) want.add(b.id);
      if (['cash', 'economat'].includes(b.cty_kind) && p.roles.includes('econome')) want.add(b.id);
      if (b.cty_kind === 'bank' && settings.hasBank && p.roles.includes('econome')) want.add(b.id);
    }
    const shared = books.filter((b) => ['house', 'envelope', 'cash', 'bank', 'economat'].includes(b.cty_kind)).map((b) => b.id);
    for (const id of shared) {
      stmts.push({ sql: 'DELETE FROM user_book WHERE profile_id = ? AND book_id = ?', params: [p.id, id] });
      if (want.has(id) && p.active) stmts.push({ sql: 'INSERT OR IGNORE INTO user_book (profile_id, book_id) VALUES (?, ?)', params: [p.id, id] });
    }
  }
  return stmts;
}

const can = (c: OpCtx, p: Perm) => has(c.profile, p);
const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
async function requireCommunity(db: Db) {
  if ((await getMeta(db, 'kind')) !== 'community') throw new UserError(m('هذه ليست قاعدة بيانات جماعة', 'This is not a community database', "Ce n'est pas une base de données de communauté"));
}

/** The Superior adds a person, changes his roles, marks that he left, or gives a new password. */
async function savePerson(c: OpCtx, a: { id?: number | null; name: string; roles: CtyRole[]; active?: number; password?: string | null; hasBank?: boolean }) {
  await requireCommunity(c.db);
  const name = (a.name ?? '').trim();
  if (!name) throw new UserError(m('الاسم فارغ', 'The name is empty', 'Le nom est vide'));
  const roles = (a.roles ?? []).filter((r): r is CtyRole => ['superior', 'econome', 'minister'].includes(r));
  const people = await loadPeople(c.db);
  const old = a.id ? people.find((p) => p.id === a.id) : undefined;
  if (a.id && !old) throw new UserError(m('الشخص غير موجود', 'Unknown person', 'Personne inconnue'));
  if (people.some((p) => p.id !== a.id && p.name.toLowerCase() === name.toLowerCase())) throw new UserError(m('هذا الاسم موجود', 'This name already exists', 'Ce nom existe déjà'));
  const active = a.active ?? old?.active ?? 1;
  // the community always has a Superior, an econome and a minister among those present
  const after = [...people.filter((p) => p.id !== a.id && p.active), ...(active ? [{ roles }] : [])];
  for (const [r, msg] of [
    ['superior', m('يبقى رئيس واحد على الأقل', 'There must still be a Superior', 'Il faut toujours un Supérieur')],
    ['econome', m('يبقى قيم واحد على الأقل', 'There must still be an econome', 'Il faut toujours un économe')],
    ['minister', m('يبقى مدبر واحد على الأقل', 'There must still be a minister', 'Il faut toujours un ministre')],
  ] as const) if (!after.some((p) => p.roles.includes(r))) throw new UserError(msg);
  const access = await accessFor(c.db, roles.length ? roles : ['jesuit']);
  const role = roles.includes('superior') ? 'sup' : roles.includes('econome') ? 'com' : 'holder';
  const stmts: Stmt[] = [];
  let pid = old?.id;
  if (!old) {
    const pw = a.password ?? '';
    checkSecretShape(pw);
    const salt = crypto.randomUUID();
    await c.db.batch([
      { sql: "INSERT INTO book (name, keeper_name, cty_kind, is_main, sort) VALUES (?, ?, 'personal', 0, (SELECT COALESCE(MAX(sort), 0) + 1 FROM book))", params: [name, name] },
      { sql: 'INSERT INTO profile (name, role, pin_salt, pin_hash, access_id, cty_roles, must_change) VALUES (?, ?, ?, ?, ?, ?, 1)', params: [name, role, salt, await hashSecret(salt, pw), access, JSON.stringify(roles)] },
      { sql: "INSERT INTO user_book (profile_id, book_id) SELECT (SELECT MAX(id) FROM profile), (SELECT MAX(id) FROM book WHERE cty_kind = 'personal')" },
    ]);
    pid = (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM profile'))!.id;
  } else {
    stmts.push({ sql: 'UPDATE profile SET name = ?, role = ?, access_id = ?, cty_roles = ?, active = ? WHERE id = ?', params: [name, role, access, JSON.stringify(roles), active, old.id] });
    if (old.bookId) stmts.push({ sql: 'UPDATE book SET name = ?, keeper_name = ?, active = ? WHERE id = ?', params: [name, name, active, old.bookId] });
    if (a.password) {
      checkSecretShape(a.password);
      const salt = crypto.randomUUID();
      stmts.push({ sql: 'UPDATE profile SET pin_salt = ?, pin_hash = ?, must_change = 1 WHERE id = ?', params: [salt, await hashSecret(salt, a.password), old.id] });
    }
  }
  // his own bank account, if he has one
  if (a.hasBank !== undefined) {
    const bank = await one<{ id: number }>(c.db, "SELECT b.id FROM user_book ub JOIN book b ON b.id = ub.book_id WHERE ub.profile_id = ? AND b.cty_kind = 'personal_bank'", [pid!]);
    if (bank) stmts.push({ sql: 'UPDATE book SET active = ?, name = ?, keeper_name = ? WHERE id = ?', params: [a.hasBank && active ? 1 : 0, `${name} · bank`, name, bank.id] });
    else if (a.hasBank) stmts.push(
      { sql: "INSERT INTO book (name, keeper_name, cty_kind, is_main, sort) VALUES (?, ?, 'personal_bank', 0, (SELECT COALESCE(MAX(sort), 0) + 1 FROM book))", params: [`${name} · bank`, name] },
      { sql: "INSERT INTO user_book (profile_id, book_id) SELECT ?, (SELECT MAX(id) FROM book WHERE cty_kind = 'personal_bank')", params: [pid!] },
    );
  }
  stmts.push(auditStmt(c.who, old ? 'edit' : 'add', 'profile', String(pid), old ? { name: old.name, roles: old.roles, active: old.active } : null, { name, roles, active, hasBank: a.hasBank, password: a.password ? 'new' : undefined }));
  if (stmts.length) await c.db.batch(stmts);
  await c.db.batch(await syncBooksStmts(c.db));
  return pid;
}

/** The econome (or the Superior) sets: a bank or not, closing by quarter or month, the banknotes. */
async function saveSettings(c: OpCtx, a: Partial<CtySettings>) {
  await requireCommunity(c.db);
  const before = await loadSettings(c.db);
  const stmts: Stmt[] = [];
  if (a.hasBank !== undefined) {
    stmts.push(settingStmt('cty_has_bank', a.hasBank ? '1' : '0'));
    const bank = await one<{ id: number }>(c.db, "SELECT id FROM book WHERE cty_kind = 'bank'");
    if (bank) stmts.push({ sql: 'UPDATE book SET active = ? WHERE id = ?', params: [a.hasBank ? 1 : 0, bank.id] });
    else if (a.hasBank) stmts.push({ sql: "INSERT INTO book (name, cty_kind, is_main, sort) VALUES ('Bank · المصرف · Banque', 'bank', 0, 2)" });
  }
  if (a.closePeriod) stmts.push(settingStmt('cty_close_period', a.closePeriod === 'month' ? 'month' : 'quarter'));
  if (a.notes) for (const cur of CURS) {
    const list = (a.notes[cur] ?? []).map(Number).filter((x) => x > 0);
    if (!list.length) throw new UserError(m('أوراق نقدية واحدة على الأقل', 'At least one banknote', 'Au moins un billet'));
    stmts.push(settingStmt(`cty_notes_${cur}`, JSON.stringify([...new Set(list)].sort((x, y) => y - x))));
  }
  stmts.push(auditStmt(c.who, 'edit', 'setting', 'cty_settings', before, a));
  await c.db.batch(stmts);
  await c.db.batch(await syncBooksStmts(c.db));
}

export const PEOPLE_OPS = {
  'cty.people': {
    check: (c: OpCtx) => { if (!can(c, 'users.manage') && !can(c, 'cty.view_all')) throw refuse(); },
    run: async (c: OpCtx) => { await requireCommunity(c.db); return loadPeople(c.db); },
  },
  'cty.person.save': {
    check: (c: OpCtx) => { if (!can(c, 'users.manage')) throw refuse(); },
    run: (c: OpCtx, a: { id?: number | null; name: string; roles: CtyRole[]; active?: number; password?: string | null; hasBank?: boolean }) => savePerson(c, a),
  },
  'cty.settings.save': {
    check: (c: OpCtx) => { if (!can(c, 'users.manage') && !can(c, 'cty.limits')) throw refuse(); },
    run: (c: OpCtx, a: Partial<CtySettings>) => saveSettings(c, a),
  },
};
export const PEOPLE_READ_ONLY = ['cty.people'];
