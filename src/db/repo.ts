// Reading and writing the database. Every write goes through db.batch(),
// so it is one transaction, and every change to the register is audited.

import { m, type Msg } from '../i18n';
import type { Book, BudgetLine, Donor, Heading, Lists, Named, ProjectRule, Settings, Trx, TrxType } from '../domain/types';
import { type Db, type SqlValue, type Stmt, nowIso, one, uuid } from './db';

// ---------------------------------------------------------------- meta / settings

export async function getMeta(db: Db, key: string): Promise<string | null> {
  const r = await one<{ value: string }>(db, 'SELECT value FROM meta WHERE key = ?', [key]);
  return r?.value ?? null;
}

export const setMetaStmt = (key: string, value: string | null): Stmt => ({
  sql: 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  params: [key, value],
});

export const setSettingStmt = (key: keyof Settings, value: SqlValue): Stmt => ({
  sql: 'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  params: [key, value == null ? null : String(value)],
});

export const DEFAULT_SETTINGS: Settings = {
  usd_rate: 130,
  def_city_id: null,
  def_account_id: null,
  def_book_id: null,
  fiscal_start: null,
  exchange_tolerance: 0.25,
};

async function loadSettings(db: Db): Promise<Settings> {
  const rows = await db.query<{ key: string; value: string | null }>('SELECT key, value FROM setting');
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (value == null || value === '') continue;
    switch (key) {
      case 'usd_rate':
      case 'exchange_tolerance':
        s[key] = Number(value);
        break;
      case 'def_city_id':
      case 'def_account_id':
      case 'def_book_id':
        s[key] = Number(value);
        break;
      case 'fiscal_start':
        s.fiscal_start = value;
        break;
    }
  }
  return s;
}

// ---------------------------------------------------------------- lists

export async function loadLists(db: Db): Promise<Lists> {
  const named = (t: string) => db.query<Named>(`SELECT id, name, active, sort FROM ${t} ORDER BY sort, name`);
  const [cities, accounts, projects, parties, books, headings, headingTypes, lines, donors, rules, settings] = await Promise.all([
    named('city'),
    named('account'),
    named('project'),
    named('party'),
    db.query<Book>('SELECT * FROM book ORDER BY is_main DESC, sort, name'),
    db.query<Heading>('SELECT * FROM heading ORDER BY code'),
    db.query<{ heading_id: number; type: TrxType }>('SELECT heading_id, type FROM heading_type'),
    db.query<BudgetLine>('SELECT * FROM budget_line ORDER BY code'),
    db.query<Donor>('SELECT * FROM donor ORDER BY sort, name'),
    db.query<ProjectRule>('SELECT * FROM project_rule ORDER BY id'),
    loadSettings(db),
  ]);
  return { cities, accounts, projects, parties, books, headings, headingTypes, lines, donors, rules, settings };
}

/** Which table + column of the register uses each list (to refuse deleting a used value). */
const USED_IN: Record<string, { sql: string }[]> = {
  city: [{ sql: 'SELECT 1 FROM trx WHERE city_id = ? LIMIT 1' }, { sql: 'SELECT 1 FROM book WHERE city_id = ? LIMIT 1' }],
  account: [
    { sql: 'SELECT 1 FROM trx WHERE account_id = ? LIMIT 1' },
    { sql: 'SELECT 1 FROM project_rule WHERE account_id = ? LIMIT 1' },
    { sql: 'SELECT 1 FROM book WHERE account_id = ? LIMIT 1' },
  ],
  project: [
    { sql: 'SELECT 1 FROM project_rule WHERE project_id = ? LIMIT 1' },
    { sql: 'SELECT 1 FROM donor WHERE default_project_id = ? LIMIT 1' },
    { sql: 'SELECT 1 FROM grant_row WHERE project_id = ? LIMIT 1' },
  ],
  party: [{ sql: 'SELECT 1 FROM trx WHERE party_id = ? LIMIT 1' }],
  book: [{ sql: 'SELECT 1 FROM trx WHERE book_id = ? LIMIT 1' }, { sql: 'SELECT 1 FROM profile WHERE book_id = ? LIMIT 1' }],
  heading: [{ sql: 'SELECT 1 FROM trx WHERE heading_id = ? LIMIT 1' }, { sql: 'SELECT 1 FROM budget_line WHERE heading_id = ? LIMIT 1' }],
  budget_line: [{ sql: 'SELECT 1 FROM trx WHERE line_id = ? LIMIT 1' }],
  donor: [{ sql: 'SELECT 1 FROM grant_row WHERE donor_id = ? LIMIT 1' }],
};

export async function isUsed(db: Db, table: string, id: number): Promise<boolean> {
  for (const q of USED_IN[table] ?? []) if ((await db.query(q.sql, [id])).length) return true;
  return false;
}

export type SimpleList = 'city' | 'account' | 'project' | 'party';

export async function addNamed(db: Db, table: SimpleList, name: string, who: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new UserError(m('الاسم فارغ', 'The name is empty'));
  const exists = await one(db, `SELECT id FROM ${table} WHERE name = ?`, [clean]);
  if (exists) throw new UserError(m(`"${clean}" موجود مسبقاً`, `"${clean}" already exists`));
  const max = await one<{ s: number | null }>(db, `SELECT MAX(sort) AS s FROM ${table}`);
  await db.batch([
    { sql: `INSERT INTO ${table} (name, sort) VALUES (?, ?)`, params: [clean, (max?.s ?? 0) + 1] },
    auditStmt(who, 'add', table, null, null, { name: clean }),
  ]);
}

export async function renameRow(db: Db, table: string, id: number, name: string, who: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new UserError(m('الاسم فارغ', 'The name is empty'));
  const clash = await one(db, `SELECT id FROM ${table} WHERE name = ? AND id <> ?`, [clean, id]);
  if (clash) throw new UserError(m(`"${clean}" موجود مسبقاً`, `"${clean}" already exists`));
  const before = await one(db, `SELECT name FROM ${table} WHERE id = ?`, [id]);
  await db.batch([
    { sql: `UPDATE ${table} SET name = ? WHERE id = ?`, params: [clean, id] },
    auditStmt(who, 'rename', table, String(id), before, { name: clean }),
  ]);
}

export async function setActive(db: Db, table: string, id: number, active: boolean, who: string): Promise<void> {
  await db.batch([
    { sql: `UPDATE ${table} SET active = ? WHERE id = ?`, params: [active ? 1 : 0, id] },
    auditStmt(who, active ? 'activate' : 'deactivate', table, String(id), null, null),
  ]);
}

/** Delete only a value nobody has used; otherwise the user must deactivate it. */
export async function deleteUnused(db: Db, table: string, id: number, who: string): Promise<void> {
  if (await isUsed(db, table, id))
    throw new UserError(m('مستعمل في السجل — أوقفه بدل حذفه', 'Already used — deactivate it instead of deleting'));
  const before = await one(db, `SELECT * FROM ${table} WHERE id = ?`, [id]);
  const extra: Stmt[] = table === 'heading' ? [{ sql: 'DELETE FROM heading_type WHERE heading_id = ?', params: [id] }] : [];
  await db.batch([...extra, { sql: `DELETE FROM ${table} WHERE id = ?`, params: [id] }, auditStmt(who, 'delete', table, String(id), before, null)]);
}

export async function moveRow(db: Db, table: string, id: number, dir: -1 | 1, who: string): Promise<void> {
  const rows = await db.query<{ id: number }>(`SELECT id FROM ${table} ORDER BY sort, name`);
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await db.batch([
    ...rows.map((r, k) => ({ sql: `UPDATE ${table} SET sort = ? WHERE id = ?`, params: [k + 1, r.id] })),
    auditStmt(who, 'reorder', table, String(id), null, null),
  ]);
}

// ---- books

export async function saveBook(db: Db, b: Partial<Book> & { name: string }, who: string): Promise<void> {
  const name = b.name.trim();
  if (!name) throw new UserError(m('الاسم فارغ', 'The name is empty'));
  const clash = await one(db, 'SELECT id FROM book WHERE name = ? AND id <> ?', [name, b.id ?? -1]);
  if (clash) throw new UserError(m(`"${name}" موجود مسبقاً`, `"${name}" already exists`));
  const vals: SqlValue[] = [name, b.keeper_name ?? null, b.city_id ?? null, b.account_id ?? null, b.opening_syp ?? 0, b.opening_usd ?? 0];
  if (b.id) {
    const before = await one(db, 'SELECT * FROM book WHERE id = ?', [b.id]);
    await db.batch([
      { sql: 'UPDATE book SET name=?, keeper_name=?, city_id=?, account_id=?, opening_syp=?, opening_usd=? WHERE id=?', params: [...vals, b.id] },
      auditStmt(who, 'edit', 'book', String(b.id), before, b),
    ]);
  } else {
    const max = await one<{ s: number | null }>(db, 'SELECT MAX(sort) AS s FROM book');
    await db.batch([
      { sql: 'INSERT INTO book (name, keeper_name, city_id, account_id, opening_syp, opening_usd, sort) VALUES (?,?,?,?,?,?,?)', params: [...vals, (max?.s ?? 0) + 1] },
      auditStmt(who, 'add', 'book', null, null, b),
    ]);
  }
}

// ---- budget: headings and lines. Codes are given once, never renumbered.

const HEADING_PREFIX: Record<TrxType, string> = { Income: 'I', Exp: 'E', Transfer: 'T', Exchange: 'X' };

export async function addHeading(db: Db, name: string, types: TrxType[], who: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new UserError(m('الاسم فارغ', 'The name is empty'));
  if (!types.length) throw new UserError(m('اختر نوعاً واحداً على الأقل', 'Choose at least one type'));
  if (await one(db, 'SELECT id FROM heading WHERE name = ?', [clean]))
    throw new UserError(m(`"${clean}" موجود مسبقاً`, `"${clean}" already exists`));
  const prefix = HEADING_PREFIX[types[0]];
  const codes = await db.query<{ code: string }>('SELECT code FROM heading WHERE code LIKE ?', [prefix + '%']);
  const next = Math.max(0, ...codes.map((c) => Number(c.code.slice(1)) || 0)) + 1;
  const code = prefix + String(next).padStart(2, '0');
  const id = await nextId(db, 'heading');
  await db.batch([
    { sql: 'INSERT INTO heading (id, name, code) VALUES (?, ?, ?)', params: [id, clean, code] },
    ...types.map((t) => ({ sql: 'INSERT INTO heading_type (heading_id, type) VALUES (?, ?)', params: [id, t] })),
    auditStmt(who, 'add', 'heading', String(id), null, { name: clean, code, types }),
  ]);
}

export async function setHeadingTypes(db: Db, headingId: number, types: TrxType[], who: string): Promise<void> {
  if (!types.length) throw new UserError(m('اختر نوعاً واحداً على الأقل', 'Choose at least one type'));
  const before = await db.query('SELECT type FROM heading_type WHERE heading_id = ?', [headingId]);
  // A type may only be removed if no register row of that type uses the heading.
  for (const b of before as { type: TrxType }[]) {
    if (!types.includes(b.type) && (await one(db, 'SELECT 1 FROM trx WHERE heading_id = ? AND type = ? LIMIT 1', [headingId, b.type])))
      throw new UserError(m(`سطور من نوع ${b.type} تستعمل هذا البند`, `Rows of type ${b.type} already use this heading`));
  }
  await db.batch([
    { sql: 'DELETE FROM heading_type WHERE heading_id = ?', params: [headingId] },
    ...types.map((t) => ({ sql: 'INSERT INTO heading_type (heading_id, type) VALUES (?, ?)', params: [headingId, t] })),
    auditStmt(who, 'types', 'heading', String(headingId), before, types),
  ]);
}

export async function addLine(db: Db, headingId: number, name: string, who: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new UserError(m('الاسم فارغ', 'The name is empty'));
  if (await one(db, 'SELECT id FROM budget_line WHERE heading_id = ? AND name = ?', [headingId, clean]))
    throw new UserError(m(`"${clean}" موجود مسبقاً في هذا البند`, `"${clean}" already exists under this heading`));
  const h = await one<{ code: string }>(db, 'SELECT code FROM heading WHERE id = ?', [headingId]);
  if (!h) throw new UserError(m('البند غير موجود', 'Heading not found'));
  const codes = await db.query<{ code: string }>('SELECT code FROM budget_line WHERE code LIKE ?', [h.code + '.%']);
  const next = Math.max(0, ...codes.map((c) => Number(c.code.split('.')[1]) || 0)) + 1;
  const code = `${h.code}.${next}`;
  await db.batch([
    { sql: 'INSERT INTO budget_line (heading_id, name, code) VALUES (?, ?, ?)', params: [headingId, clean, code] },
    auditStmt(who, 'add', 'budget_line', null, null, { heading_id: headingId, name: clean, code }),
  ]);
}

export async function setProjectFund(db: Db, lineId: number, on: boolean, who: string): Promise<void> {
  await db.batch([
    { sql: 'UPDATE budget_line SET is_project_fund = ? WHERE id = ?', params: [on ? 1 : 0, lineId] },
    auditStmt(who, 'project_fund', 'budget_line', String(lineId), null, on),
  ]);
}

// ---- donors and spending rules

export async function saveDonor(db: Db, d: { id?: number; name: string; default_project_id: number | null }, who: string): Promise<void> {
  const name = d.name.trim();
  if (!name) throw new UserError(m('الاسم فارغ', 'The name is empty'));
  if (await one(db, 'SELECT id FROM donor WHERE name = ? AND id <> ?', [name, d.id ?? -1]))
    throw new UserError(m(`"${name}" موجود مسبقاً`, `"${name}" already exists`));
  if (d.id)
    await db.batch([
      { sql: 'UPDATE donor SET name = ?, default_project_id = ? WHERE id = ?', params: [name, d.default_project_id, d.id] },
      auditStmt(who, 'edit', 'donor', String(d.id), null, d),
    ]);
  else {
    const max = await one<{ s: number | null }>(db, 'SELECT MAX(sort) AS s FROM donor');
    await db.batch([
      { sql: 'INSERT INTO donor (name, default_project_id, sort) VALUES (?, ?, ?)', params: [name, d.default_project_id, (max?.s ?? 0) + 1] },
      auditStmt(who, 'add', 'donor', null, null, d),
    ]);
  }
}

export async function saveRule(db: Db, r: { id?: number; project_id: number; account_id: number; heading_id: number | null }, who: string): Promise<void> {
  const clash = await one(
    db,
    'SELECT id FROM project_rule WHERE account_id = ? AND heading_id IS ? AND id <> ?',
    [r.account_id, r.heading_id, r.id ?? -1],
  );
  if (clash) throw new UserError(m('قاعدة لنفس الحساب والبند موجودة', 'A rule for this account and heading already exists'));
  await db.batch([
    r.id
      ? { sql: 'UPDATE project_rule SET project_id=?, account_id=?, heading_id=? WHERE id=?', params: [r.project_id, r.account_id, r.heading_id, r.id] }
      : { sql: 'INSERT INTO project_rule (project_id, account_id, heading_id) VALUES (?,?,?)', params: [r.project_id, r.account_id, r.heading_id] },
    auditStmt(who, r.id ? 'edit' : 'add', 'project_rule', r.id ? String(r.id) : null, null, r),
  ]);
}

export async function deleteRule(db: Db, id: number, who: string): Promise<void> {
  const before = await one(db, 'SELECT * FROM project_rule WHERE id = ?', [id]);
  await db.batch([{ sql: 'DELETE FROM project_rule WHERE id = ?', params: [id] }, auditStmt(who, 'delete', 'project_rule', String(id), before, null)]);
}

export async function saveSettings(db: Db, s: Partial<Settings>, who: string): Promise<void> {
  const stmts = Object.entries(s).map(([k, v]) => setSettingStmt(k as keyof Settings, v as SqlValue));
  await db.batch([...stmts, auditStmt(who, 'edit', 'setting', null, null, s)]);
}

// ---------------------------------------------------------------- register

const TRX_COLS = [
  'id', 'n', 'city_id', 'account_id', 'book_id', 'date', 'type', 'heading_id', 'line_id', 'explanation', 'party_id', 'receipt',
  'inc_syp', 'exp_syp', 'inc_usd', 'exp_usd', 'trf_syp', 'trf_usd', 'transfer_group', 'review', 'sent_at',
  'created_at', 'created_by', 'updated_at', 'source_file',
  'received_at', 'received_by', 'disputed_at', 'dispute_note',
] as const;

export async function loadTrx(db: Db): Promise<Trx[]> {
  return db.query<Trx>('SELECT * FROM trx ORDER BY n IS NULL, n, date, created_at');
}

export function insertTrxStmt(t: Trx): Stmt {
  return {
    sql: `INSERT INTO trx (${TRX_COLS.join(',')}) VALUES (${TRX_COLS.map(() => '?').join(',')})`,
    params: TRX_COLS.map((c) => (t[c] ?? null) as SqlValue),
  };
}

function updateTrxStmt(t: Trx): Stmt {
  const cols = TRX_COLS.filter((c) => c !== 'id' && c !== 'created_at' && c !== 'created_by');
  return {
    sql: `UPDATE trx SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    params: [...cols.map((c) => (t[c] ?? null) as SqlValue), t.id],
  };
}

/**
 * Office databases number rows 0001…; a holder's rows get their number when imported.
 * A number is NEVER reused: the last one given is kept in meta.last_n, so a row deleted
 * at the end of the register leaves a gap instead of lending its number to the next row.
 * Every row also has its permanent identity, Entry_ID (a UUID), whatever its number.
 */
export async function nextN(db: Db): Promise<number> {
  const r = await one<{ n: number | null }>(db, 'SELECT MAX(n) AS n FROM trx');
  const last = Number((await getMeta(db, 'last_n')) ?? 0) || 0;
  return Math.max(r?.n ?? 0, last) + 1;
}

export function blankTrx(): Trx {
  return {
    id: uuid(), n: null, city_id: null, account_id: null, book_id: null, date: null, type: null,
    heading_id: null, line_id: null, explanation: null, party_id: null, receipt: null,
    inc_syp: 0, exp_syp: 0, inc_usd: 0, exp_usd: 0, trf_syp: 0, trf_usd: 0,
    transfer_group: null, review: null, sent_at: null, created_at: nowIso(), created_by: null, updated_at: null, source_file: null,
    received_at: null, received_by: null, disputed_at: null, dispute_note: null,
  };
}

/** Insert new rows / update existing ones (and remove `deleteIds`), in ONE transaction, with the audit trail. */
export async function saveTrxRows(db: Db, rows: Trx[], who: string, numbered: boolean, deleteIds: string[] = []): Promise<void> {
  const stmts: Stmt[] = [];
  for (const id of deleteIds) {
    const before = await one(db, 'SELECT * FROM trx WHERE id = ?', [id]);
    if (before) stmts.push({ sql: 'DELETE FROM trx WHERE id = ?', params: [id] }, auditStmt(who, 'delete', 'trx', id, before, null));
  }
  let n = numbered ? await nextN(db) : 0;
  for (const t of rows) {
    const before = await one<Trx>(db, 'SELECT * FROM trx WHERE id = ?', [t.id]);
    if (before) {
      const after = { ...t, updated_at: nowIso() };
      stmts.push(updateTrxStmt(after), auditStmt(who, 'edit', 'trx', t.id, before, after));
    } else {
      const fresh = { ...t, created_by: t.created_by ?? who, n: numbered && t.n == null ? n++ : t.n };
      stmts.push(insertTrxStmt(fresh), auditStmt(who, 'add', 'trx', t.id, null, fresh));
    }
  }
  if (numbered) stmts.push(setMetaStmt('last_n', String(n - 1)));
  await db.batch(stmts);
}

export async function deleteTrxRows(db: Db, ids: string[], who: string): Promise<void> {
  const stmts: Stmt[] = [];
  for (const id of ids) {
    const before = await one(db, 'SELECT * FROM trx WHERE id = ?', [id]);
    if (!before) continue;
    stmts.push({ sql: 'DELETE FROM trx WHERE id = ?', params: [id] }, auditStmt(who, 'delete', 'trx', id, before, null));
  }
  await db.batch(stmts);
}

export async function closedMonths(db: Db): Promise<Set<string>> {
  return new Set((await db.query<{ ym: string }>('SELECT ym FROM closed_month')).map((r) => r.ym));
}

// ---------------------------------------------------------------- audit + helpers

export function auditStmt(who: string, action: string, tbl: string, rowId: string | null, before: unknown, after: unknown): Stmt {
  return {
    sql: 'INSERT INTO audit_log (at, who, action, tbl, row_id, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)',
    params: [nowIso(), who, action, tbl, rowId, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  };
}

async function nextId(db: Db, table: string): Promise<number> {
  const r = await one<{ m: number | null }>(db, `SELECT MAX(id) AS m FROM ${table}`);
  return (r?.m ?? 0) + 1;
}

/** An error meant for the user, with a bilingual message. */
export class UserError extends Error {
  constructor(public msg: Msg) {
    super(msg.en);
  }
}
