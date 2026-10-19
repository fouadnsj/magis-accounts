// The accounts of a community (Fouad, 19 October 2026): a PERSON (every Jesuit, the Superior
// included) has a personal account that never changes; an OFFICE (Superior, Econome, Minister,
// Administrator) is an account of its own, with its own password and its own books. An office
// is held by a person (held_by); when it is handed over, the holder's name and the password
// change, and the office keeps its books and its whole history.
//  - the minister's office keeps the house and its envelopes;
//  - the econome's office keeps the cash, the bank (if the community has one) and the économat;
//  - the Superior's office keeps no book: he sees, approves or refuses, comments;
//  - the administrator's office keeps no book and sees no record: it manages accounts,
//    passwords, permissions and settings.
// Also the community's settings: a bank or not, closing by quarter or by month, banknotes.

import { type Db, type Stmt, one } from '../db/db';
import { auditStmt, getMeta, UserError } from '../db/repo';
import { has, hashSecret, checkSecretShape } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import type { Perm } from '../perms';
import { CURS, type Cur } from './domain';

export type Office = 'superior' | 'econome' | 'minister' | 'admin';
export const OFFICES: Office[] = ['superior', 'econome', 'minister', 'admin'];
/** The short name of an office in the audit and in the profile name ("Econome (Fouad)"). */
export const OFFICE_SHORT: Record<Office, string> = { superior: 'Superior', econome: 'Econome', minister: 'Minister', admin: 'Administrator' };

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

// ---------------------------------------------------------------- reading

export interface PersonRow { id: number; name: string; active: number; hasBank: boolean; mustChange: number; bookId: number | null }
export interface OfficeRow { office: Office; profileId: number; heldBy: string; mustChange: number }
export interface PeoplePayload { persons: PersonRow[]; offices: OfficeRow[] }

export async function loadPeople(db: Db): Promise<PeoplePayload> {
  const ps = await db.query<{ id: number; name: string; cty_office: string | null; held_by: string | null; active: number; must_change: number }>('SELECT id, name, cty_office, held_by, active, must_change FROM profile ORDER BY active DESC, name');
  const persons: PersonRow[] = [];
  const offices: OfficeRow[] = [];
  for (const p of ps) {
    if (p.cty_office) {
      offices.push({ office: p.cty_office as Office, profileId: p.id, heldBy: p.held_by ?? '', mustChange: p.must_change });
      continue;
    }
    const books = await db.query<{ id: number; cty_kind: string; active: number }>('SELECT b.id, b.cty_kind, b.active FROM user_book ub JOIN book b ON b.id = ub.book_id WHERE ub.profile_id = ?', [p.id]);
    persons.push({ id: p.id, name: p.name, active: p.active, mustChange: p.must_change, hasBank: books.some((b) => b.cty_kind === 'personal_bank' && b.active), bookId: books.find((b) => b.cty_kind === 'personal')?.id ?? null });
  }
  offices.sort((a, b) => OFFICES.indexOf(a.office) - OFFICES.indexOf(b.office));
  return { persons, offices };
}

/** Gives the shared books to their office: the house and envelopes to the minister's, the cash, the bank and the économat to the econome's. */
export async function officeBooksStmts(db: Db): Promise<Stmt[]> {
  const offices = await db.query<{ id: number; cty_office: string }>('SELECT id, cty_office FROM profile WHERE cty_office IS NOT NULL AND active = 1');
  const of = (o: Office) => offices.find((x) => x.cty_office === o)?.id;
  const books = await db.query<{ id: number; cty_kind: string; active: number }>("SELECT id, cty_kind, active FROM book WHERE cty_kind IN ('house', 'envelope', 'cash', 'bank', 'economat')");
  const stmts: Stmt[] = [];
  for (const b of books) {
    stmts.push({ sql: 'DELETE FROM user_book WHERE book_id = ?', params: [b.id] });
    const keeper = b.cty_kind === 'house' || b.cty_kind === 'envelope' ? of('minister') : of('econome');
    if (keeper != null && b.active) stmts.push({ sql: 'INSERT INTO user_book (profile_id, book_id) VALUES (?, ?)', params: [keeper, b.id] });
  }
  return stmts;
}

const can = (c: OpCtx, p: Perm) => has(c.profile, p);
const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
async function requireCommunity(db: Db) {
  if ((await getMeta(db, 'kind')) !== 'community') throw new UserError(m('هذه ليست قاعدة بيانات جماعة', 'This is not a community database', "Ce n'est pas une base de données de communauté"));
}

// ---------------------------------------------------------------- persons

/** The administrator adds a Jesuit, renames him, marks that he left, or gives him a bank account. */
async function savePerson(c: OpCtx, a: { id?: number | null; name: string; active?: number; password?: string | null; hasBank?: boolean }) {
  await requireCommunity(c.db);
  const name = (a.name ?? '').trim();
  if (!name) throw new UserError(m('الاسم فارغ', 'The name is empty', 'Le nom est vide'));
  const { persons } = await loadPeople(c.db);
  const old = a.id ? persons.find((p) => p.id === a.id) : undefined;
  if (a.id && !old) throw new UserError(m('الشخص غير موجود', 'Unknown person', 'Personne inconnue'));
  if (persons.some((p) => p.id !== a.id && p.name.toLowerCase() === name.toLowerCase())) throw new UserError(m('هذا الاسم موجود', 'This name already exists', 'Ce nom existe déjà'));
  const active = a.active ?? old?.active ?? 1;
  const stmts: Stmt[] = [];
  let pid = old?.id;
  if (!old) {
    const pw = a.password ?? '';
    checkSecretShape(pw);
    const salt = crypto.randomUUID();
    await c.db.batch([
      { sql: "INSERT INTO book (name, keeper_name, cty_kind, is_main, sort) VALUES (?, ?, 'personal', 0, (SELECT COALESCE(MAX(sort), 0) + 1 FROM book))", params: [name, name] },
      { sql: "INSERT INTO profile (name, role, pin_salt, pin_hash, access_id, must_change) VALUES (?, 'holder', ?, ?, (SELECT id FROM access_profile WHERE name LIKE '%Jesuit%' LIMIT 1), 1)", params: [name, salt, await hashSecret(salt, pw)] },
      { sql: "INSERT INTO user_book (profile_id, book_id) SELECT (SELECT MAX(id) FROM profile), (SELECT MAX(id) FROM book WHERE cty_kind = 'personal')" },
    ]);
    pid = (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM profile'))!.id;
  } else {
    stmts.push({ sql: 'UPDATE profile SET name = ?, active = ? WHERE id = ?', params: [name, active, old.id] });
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
  stmts.push(auditStmt(c.who, old ? 'edit' : 'add', 'profile', String(pid), old ? { name: old.name, active: old.active } : null, { name, active, hasBank: a.hasBank, password: a.password ? 'new' : undefined }));
  await c.db.batch(stmts);
  return pid;
}

// ---------------------------------------------------------------- offices

/** The administrator says who holds an office now (and may give it a new password). */
async function saveOffice(c: OpCtx, a: { office: Office; heldBy: string; password?: string | null }) {
  await requireCommunity(c.db);
  if (!OFFICES.includes(a.office)) throw new UserError(m('منصب غير معروف', 'Unknown office', 'Fonction inconnue'));
  const heldBy = (a.heldBy ?? '').trim();
  if (!heldBy) throw new UserError(m('من يتولّى هذا المنصب؟', 'Who holds this office?', 'Qui tient cette fonction ?'));
  const row = await one<{ id: number; held_by: string | null }>(c.db, 'SELECT id, held_by FROM profile WHERE cty_office = ?', [a.office]);
  if (!row) throw new UserError(m('المنصب غير موجود', 'Office not found', 'Fonction introuvable'));
  const stmts: Stmt[] = [{ sql: 'UPDATE profile SET held_by = ?, name = ? WHERE id = ?', params: [heldBy, `${OFFICE_SHORT[a.office]} (${heldBy})`, row.id] }];
  if (a.password) {
    checkSecretShape(a.password);
    const salt = crypto.randomUUID();
    stmts.push({ sql: 'UPDATE profile SET pin_salt = ?, pin_hash = ?, must_change = 1 WHERE id = ?', params: [salt, await hashSecret(salt, a.password), row.id] });
  }
  stmts.push(auditStmt(c.who, 'handover', 'profile', String(row.id), { heldBy: row.held_by }, { heldBy, password: a.password ? 'new' : undefined, office: a.office }));
  await c.db.batch(stmts);
}

/**
 * A password reset for a person or an office (Fouad, 19 October 2026: "from the econome's
 * account and from the administrator's"). Only the administrator resets the administrator's.
 * The person chooses his own at his next sign-in.
 */
async function resetPassword(c: OpCtx, a: { profileId: number; password: string }) {
  await requireCommunity(c.db);
  if (!can(c, 'cty.passwords') && !can(c, 'users.manage')) throw refuse();
  const target = await one<{ id: number; name: string; cty_office: string | null }>(c.db, 'SELECT id, name, cty_office FROM profile WHERE id = ? AND active = 1', [a.profileId]);
  if (!target) throw new UserError(m('الحساب غير موجود', 'Account not found', 'Compte introuvable'));
  if (target.cty_office === 'admin' && !can(c, 'users.manage')) throw refuse();
  checkSecretShape(a.password);
  const salt = crypto.randomUUID();
  await c.db.batch([
    { sql: 'UPDATE profile SET pin_salt = ?, pin_hash = ?, must_change = 1 WHERE id = ?', params: [salt, await hashSecret(salt, a.password), target.id] },
    auditStmt(c.who, 'password', 'profile', String(target.id), null, { for: target.name }),
  ]);
}

// ---------------------------------------------------------------- settings

/** The econome (or the administrator) sets: a bank or not, closing by quarter or month, the banknotes. */
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
  await c.db.batch(await officeBooksStmts(c.db));
}

export const PEOPLE_OPS = {
  'cty.people': {
    check: (c: OpCtx) => { if (!can(c, 'users.manage') && !can(c, 'cty.passwords') && !can(c, 'cty.view_all')) throw refuse(); },
    run: async (c: OpCtx): Promise<PeoplePayload> => { await requireCommunity(c.db); return loadPeople(c.db); },
  },
  'cty.person.save': {
    check: (c: OpCtx) => { if (!can(c, 'users.manage')) throw refuse(); },
    run: (c: OpCtx, a: { id?: number | null; name: string; active?: number; password?: string | null; hasBank?: boolean }) => savePerson(c, a),
  },
  'cty.office.save': {
    check: (c: OpCtx) => { if (!can(c, 'users.manage')) throw refuse(); },
    run: (c: OpCtx, a: { office: Office; heldBy: string; password?: string | null }) => saveOffice(c, a),
  },
  'cty.password.reset': {
    check: (c: OpCtx) => { if (!can(c, 'users.manage') && !can(c, 'cty.passwords')) throw refuse(); },
    run: (c: OpCtx, a: { profileId: number; password: string }) => resetPassword(c, a),
  },
  'cty.settings.save': {
    check: (c: OpCtx) => { if (!can(c, 'users.manage') && !can(c, 'cty.limits')) throw refuse(); },
    run: (c: OpCtx, a: Partial<CtySettings>) => saveSettings(c, a),
  },
};
export const PEOPLE_READ_ONLY = ['cty.people'];
