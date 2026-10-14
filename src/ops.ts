// Every action the screens can ask for, with the PERMISSION it needs.
// The same functions run in two places:
//  - in the desktop app, directly on the local database file;
//  - on the network server, after it has identified the person logged in.
// The server never trusts the screen: each operation checks the person's
// permissions here, and every register row is validated again before writing.

import ExcelJS from 'exceljs';
import { type Db, type Stmt, nowIso, one, uuid } from './db/db';
import {
  addHeading, addLine, addNamed, auditStmt, closedMonths, deleteRule, deleteUnused, getMeta, loadLists, loadTrx,
  moveRow, renameRow, saveBook, saveDonor, saveRule, saveSettings, saveTrxRows, setActive, setHeadingTypes, setProjectFund,
  UserError, type SimpleList,
} from './db/repo';
import { changePin, checkSecretShape, hashSecret, has, listProfiles, roleFor, type Profile } from './auth';
import { cleanPerms, type Perm } from './perms';
import { validateTrx } from './domain/validate';
import { buildTransfers, transferKey, type TransferInfo } from './domain/transfers';
import type { GrantRow } from './domain/reports';
import type { Book, Lists, Settings, Trx, TrxType } from './domain/types';
import {
  applyListsPackage, buildEntriesFile, exportListsPackage, importEntries, markSent, type EntriesFile, type EntriesImportResult, type ListsPackage,
} from './io/keeperFiles';
import { applySeed, readWorkbook, type ImportReport } from './io/importWorkbook';
import { m, type Msg } from './i18n';

export type Install = 'office' | 'holder';

export interface BackupFile {
  name: string;
  path: string;
  size: number;
  modified: number;
}

/** Backups are files: the desktop app and the server each provide their own way. */
export interface FileOps {
  backupNow(reason: string): Promise<string | null>;
  list(): Promise<BackupFile[]>;
  restore(path: string): Promise<void>;
}

export interface OpCtx {
  db: Db;
  profile: Profile;
  who: string;
  install: Install;
  files: FileOps;
}

export interface HolderReceipt {
  id: string;
  date: string;
  amount_syp: number;
  amount_usd: number;
  receipt: string | null;
  note: string | null;
}

export interface OfficeTransfer {
  date: string | null;
  trf_syp: number;
  trf_usd: number;
  explanation: string | null;
  n: number | null;
}

export interface BookMonth {
  book_id: number;
  ym: string;
  closed_at: string;
  closed_by: string | null;
}

/** Everything a screen needs, already cut to what this person may see. */
export interface DataPayload {
  lists: Lists;
  rows: Trx[];
  closed: string[];
  bookMonths: BookMonth[];
  transfers: TransferInfo[];
  /** books that have at least one active person keeping them */
  keptBooks: number[];
  grants: GrantRow[];
  receipts: HolderReceipt[];
  officeTransfers: Record<string, OfficeTransfer[]>;
  listsVersion: string | null;
}

export interface CashCountRow {
  book_id: number;
  currency: 'SYP' | 'USD';
  denomination: number;
  qty: number;
  counted_at: string | null;
}

export interface UserRow { id: number; name: string; access_id: number | null; access_name: string; books: number[]; active: number }
export interface AccessRow { id: number; name: string; perms: Perm[]; users: number }
export interface AuditRow { id: number; at: string; who: string; action: string; tbl: string; row_id: string | null; before: string | null; after: string | null }
export interface ImportLogRow { id: number; at: string; who: string; kind: string; file_name: string; added: number; skipped: number }

// ---------------------------------------------------------------- permission helpers

const can = (c: OpCtx, p: Perm) => has(c.profile, p);
const keeps = (c: OpCtx, bookId: number | null) => bookId != null && c.profile.books.includes(bookId);

const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user'));

/** Needs at least one of these permissions. */
function need(c: OpCtx, ...perms: Perm[]) {
  if (!perms.some((p) => can(c, p))) throw refuse();
}

const SIMPLE: SimpleList[] = ['city', 'account', 'project', 'party'];
const LIST_TABLES = ['city', 'account', 'project', 'party', 'book', 'heading', 'budget_line', 'donor'] as const;
type ListTable = (typeof LIST_TABLES)[number];
function listTable(c: OpCtx, t: string): ListTable {
  if (!(LIST_TABLES as readonly string[]).includes(t)) throw new UserError(m('قائمة غير معروفة', 'Unknown list'));
  need(c, t === 'donor' ? 'lists.donors' : 'lists.manage');
  return t as ListTable;
}

const ym = (d: string | null | undefined) => (d ? d.slice(0, 7) : null);

// ---------------------------------------------------------------- reading

async function bookMonths(db: Db) {
  return db.query<BookMonth>('SELECT * FROM book_month');
}

async function keptBooks(db: Db): Promise<number[]> {
  return (await db.query<{ book_id: number }>('SELECT DISTINCT ub.book_id FROM user_book ub JOIN profile p ON p.id = ub.profile_id WHERE p.active = 1')).map((r) => r.book_id);
}

async function loadData(c: OpCtx): Promise<DataPayload> {
  const { db } = c;
  const [lists, allRows, closed, bm, kept] = await Promise.all([loadLists(db), loadTrx(db), closedMonths(db), bookMonths(db), keptBooks(db)]);
  const all = can(c, 'register.view');
  // Without "see every book", a person sees only the books he keeps.
  const rows = all ? allRows : allRows.filter((r) => keeps(c, r.book_id));
  const allTransfers = buildTransfers(allRows, lists.books);
  const transfers = all ? allTransfers : allTransfers.filter((t) => keeps(c, t.from) || keeps(c, t.to));
  const donors = can(c, 'lists.donors') || can(c, 'reports.funds');
  if (!donors) lists.donors = [];
  const grants = donors ? await db.query<GrantRow>('SELECT * FROM grant_row ORDER BY date') : [];
  const receipts = c.install === 'holder' ? await db.query<HolderReceipt>('SELECT * FROM holder_receipt ORDER BY date') : [];
  const ot = await getMeta(db, 'office_transfers');
  return {
    lists, rows, closed: [...closed], bookMonths: all ? bm : bm.filter((b) => keeps(c, b.book_id)), transfers, keptBooks: kept,
    grants, receipts, officeTransfers: ot ? JSON.parse(ot) : {}, listsVersion: await getMeta(db, 'lists_version'),
  };
}

// ---------------------------------------------------------------- writing register rows

/**
 * Save register rows: permission checks, then the same validation as the form, then write.
 * A person without "write in every book" may only:
 *  - write income, expenses and exchanges in a book he keeps;
 *  - record a transfer he GIVES from a book he keeps, while it is not yet confirmed;
 *  - change nothing in a month he (or the office) has closed for that book.
 */
async function saveRows(c: OpCtx, a: { rows: Trx[]; deletes?: string[] }) {
  const deletes = a.deletes ?? [];
  const all = await loadTrx(c.db);
  const byId = new Map(all.map((r) => [r.id, r]));
  const lists = await loadLists(c.db);
  const editAll = can(c, 'register.edit');
  if (!editAll) need(c, 'book.own');

  const mainId = lists.books.find((b) => b.is_main)?.id ?? null;
  const touched = [...a.rows, ...deletes.map((id) => byId.get(id)).filter((r): r is Trx => !!r)];
  const oldTransfers = buildTransfers(all, lists.books);
  const transferOf = (r: Trx) => oldTransfers.find((t) => t.key === transferKey(r));

  if (c.install === 'holder') {
    for (const r of touched) if (byId.get(r.id)?.sent_at) throw new UserError(m('أُرسل إلى المكتب ولا يُعدَّل', 'Already sent to the office: cannot be changed'));
  }

  if (!editAll) {
    // What the rows will be (new) and were (old), seen as transfers or as ordinary rows.
    const newTransfers = buildTransfers(a.rows.filter((r) => r.type === 'Transfer'), lists.books);
    for (const t of newTransfers) {
      if (!keeps(c, t.from) || t.from === mainId) throw new UserError(m('يسجّل التحويلَ من يعطي المال، من دفتره', 'A transfer is recorded by the giver, from his own book'));
    }
    for (const r of a.rows) if (r.type !== 'Transfer' && !keeps(c, r.book_id)) throw new UserError(m('دفترك فقط', 'Your own book only'));
    for (const r of touched) {
      const old = byId.get(r.id);
      if (!old) continue;
      if (old.type === 'Transfer') {
        const t = transferOf(old);
        if (!t || !keeps(c, t.from)) throw new UserError(m('يعدّل التحويلَ من أعطى المال فقط', 'Only the giver can change a transfer'));
        if (t.receivedAt) throw new UserError(m('أكّد المستلم هذا التحويل: اطلب من المكتب تصحيحه', 'The receiver confirmed this transfer: ask the office to correct it'));
      } else if (!keeps(c, old.book_id)) throw new UserError(m('دفترك فقط', 'Your own book only'));
    }
    // Step 1 of month closing: a closed book-month is locked for the holder.
    const bm = await bookMonths(c.db);
    const closedBook = (bookId: number | null, d: string | null) => bm.some((x) => x.book_id === bookId && x.ym === ym(d));
    for (const r of touched) {
      const old = byId.get(r.id);
      if (closedBook(r.book_id, r.date) || (old && closedBook(old.book_id, old.date)))
        throw new UserError(m('أغلقتَ هذا الشهر لدفترك', 'You closed this month for your book'));
    }
  }

  const closed = await closedMonths(c.db);
  const others = all.filter((r) => !a.rows.some((x) => x.id === r.id) && !deletes.includes(r.id));
  const errors: Msg[] = [];
  for (const r of a.rows) {
    const v = validateTrx(r, { lists, rows: others, closedMonths: closed, today: '9999-12-31', previousDate: byId.get(r.id)?.date ?? null });
    errors.push(...v.errors);
  }
  for (const id of deletes) {
    const d = byId.get(id)?.date;
    if (d && closed.has(d.slice(0, 7))) errors.push(m(`الشهر ${d.slice(0, 7)} مغلق`, `Month ${d.slice(0, 7)} is closed`));
  }
  if (errors.length) throw new UserError({ ar: errors.map((e) => e.ar).join(' · '), en: errors.map((e) => e.en).join(' · ') });

  // The server keeps numbers, "sent" marks and confirmations itself. A transfer
  // whose date, books or amount change must be confirmed again by the receiver.
  const sig = (r: Trx) => [r.date, r.book_id, r.trf_syp, r.trf_usd].join('|');
  const clean = a.rows.map((r) => {
    const old = byId.get(r.id);
    const sameTransfer = old && old.type === 'Transfer' && r.type === 'Transfer' && sig(old) === sig(r);
    return {
      ...r,
      review: null,
      n: old?.n ?? null,
      sent_at: old?.sent_at ?? null,
      received_at: sameTransfer ? old.received_at ?? null : null,
      received_by: sameTransfer ? old.received_by ?? null : null,
      disputed_at: sameTransfer ? old.disputed_at ?? null : null,
      dispute_note: sameTransfer ? old.dispute_note ?? null : null,
    };
  });
  // If one leg of a two-row transfer changed, the other leg loses its confirmation too.
  for (const r of clean) {
    if (r.type === 'Transfer' && r.transfer_group && !r.received_at)
      for (const x of clean) if (x.transfer_group === r.transfer_group) Object.assign(x, { received_at: null, received_by: null, disputed_at: null, dispute_note: null });
  }
  await saveTrxRows(c.db, clean, c.who, c.install === 'office', deletes);
}

/** The receiver of a transfer confirms (or says it did not arrive). */
async function answerTransfer(c: OpCtx, a: { id: string; ok: boolean; note?: string | null }) {
  const lists = await loadLists(c.db);
  const all = await loadTrx(c.db);
  const row = all.find((r) => r.id === a.id);
  if (!row || row.type !== 'Transfer') throw new UserError(m('تحويل غير موجود', 'Transfer not found'));
  const t = buildTransfers(all, lists.books).find((x) => x.key === transferKey(row))!;
  const mainId = lists.books.find((b) => b.is_main)?.id ?? null;
  const kept = await keptBooks(c.db);
  // The receiver answers. For Main, the office does; for a book nobody uses, the office may answer for it.
  const allowed = t.to === mainId ? can(c, 'register.edit') : keeps(c, t.to) || (can(c, 'register.edit') && !kept.includes(t.to!));
  if (!allowed) throw new UserError(m('يؤكد المستلم فقط', 'Only the receiver can answer'));
  const closed = await closedMonths(c.db);
  if (t.date && closed.has(t.date.slice(0, 7))) throw new UserError(m(`الشهر ${t.date.slice(0, 7)} مغلق`, `Month ${t.date.slice(0, 7)} is closed`));
  const at = nowIso();
  const stmts: Stmt[] = t.rowIds.map((id) => ({
    sql: 'UPDATE trx SET received_at = ?, received_by = ?, disputed_at = ?, dispute_note = ? WHERE id = ?',
    params: a.ok ? [at, c.who, null, null, id] : [null, null, at, (a.note ?? '').trim() || null, id],
  }));
  stmts.push(auditStmt(c.who, a.ok ? 'confirm' : 'dispute', 'trx', t.key, null, { note: a.note ?? null }));
  await c.db.batch(stmts);
}

// ---------------------------------------------------------------- month closing (two steps)

/** What still prevents closing a month for a book (or for the whole centre when bookId is null). */
async function closingProblems(c: OpCtx, month: string, bookId: number | null): Promise<Msg[]> {
  const lists = await loadLists(c.db);
  const all = await loadTrx(c.db);
  const inMonth = all.filter((r) => ym(r.date) === month && (bookId == null || r.book_id === bookId));
  const out: Msg[] = [];
  const review = inMonth.filter((r) => r.review).length;
  if (review) out.push(m(`${review} سطراً للمراجعة`, `${review} rows to review`));
  const transfers = buildTransfers(all, lists.books).filter((t) => ym(t.date) === month && (bookId == null || t.from === bookId || t.to === bookId));
  const waiting = transfers.filter((t) => !t.receivedAt && !t.disputedAt).length;
  const disputed = transfers.filter((t) => t.disputedAt).length;
  if (waiting) out.push(m(`${waiting} تحويلاً لم يؤكَّد استلامه`, `${waiting} transfers not yet confirmed by the receiver`));
  if (disputed) out.push(m(`${disputed} تحويلاً قيل إنه لم يصل`, `${disputed} transfers marked "not received"`));
  if (bookId == null) {
    const bm = await bookMonths(c.db);
    const open = lists.books
      .filter((b) => !b.is_main && all.some((r) => r.book_id === b.id && ym(r.date) === month))
      .filter((b) => !bm.some((x) => x.book_id === b.id && x.ym === month));
    if (open.length) out.push(m(`دفاتر لم تُغلق بعد: ${open.map((b) => b.name).join('، ')}`, `Books not closed yet: ${open.map((b) => b.name).join(', ')}`));
  }
  return out;
}

const throwIf = (problems: Msg[]) => {
  if (problems.length) throw new UserError({ ar: problems.map((p) => p.ar).join(' · '), en: problems.map((p) => p.en).join(' · ') });
};

// ---------------------------------------------------------------- users and permission profiles

async function usersList(c: OpCtx): Promise<UserRow[]> {
  const rows = await c.db.query<Omit<UserRow, 'books'>>(
    `SELECT p.id, p.name, p.access_id, COALESCE(a.name, '') AS access_name, p.active FROM profile p
       LEFT JOIN access_profile a ON a.id = p.access_id ORDER BY p.active DESC, a.sort, p.name`,
  );
  const ub = await c.db.query<{ profile_id: number; book_id: number }>('SELECT * FROM user_book');
  const users = rows.map((r) => ({ ...r, books: ub.filter((x) => x.profile_id === r.id).map((x) => x.book_id) }));
  return can(c, 'users.manage') ? users : users.filter((u) => u.id === c.profile.id);
}

/** At least one active person must keep the right to manage users, or nobody could ever fix anything. */
async function keepAManager(c: OpCtx) {
  const r = await one<{ c: number }>(
    c.db,
    `SELECT COUNT(*) AS c FROM profile p JOIN access_profile a ON a.id = p.access_id WHERE p.active = 1 AND a.perms LIKE '%"users.manage"%'`,
  );
  if (!r?.c) throw new UserError(m('يجب أن يبقى مستخدم واحد على الأقل يدير المستخدمين', 'At least one active user must keep "Users and permission profiles"'));
}

async function saveUser(c: OpCtx, a: { id?: number; name: string; access_id: number; books: number[]; pin?: string }) {
  need(c, 'users.manage');
  const name = a.name.trim();
  if (!name) throw new UserError(m('الاسم فارغ', 'The name is empty'));
  const acc = await one<{ perms: string }>(c.db, 'SELECT perms FROM access_profile WHERE id = ?', [a.access_id]);
  if (!acc) throw new UserError(m('اختر ملف الصلاحيات', 'Choose a permission profile'));
  if (await one(c.db, 'SELECT 1 FROM profile WHERE name = ? AND active = 1 AND id <> ?', [name, a.id ?? -1]))
    throw new UserError(m(`"${name}" موجود مسبقاً`, `"${name}" already exists`));
  const role = roleFor(cleanPerms(JSON.parse(acc.perms)));
  const books = [...new Set(a.books)];
  const stmts: Stmt[] = [];
  let id = a.id;
  if (id) {
    stmts.push({ sql: 'UPDATE profile SET name = ?, access_id = ?, role = ?, book_id = ? WHERE id = ?', params: [name, a.access_id, role, books[0] ?? null, id] });
    if (a.pin) {
      checkSecretShape(a.pin);
      const salt = crypto.randomUUID();
      stmts.push({ sql: 'UPDATE profile SET pin_salt = ?, pin_hash = ? WHERE id = ?', params: [salt, await hashSecret(salt, a.pin), id] });
    }
  } else {
    if (!a.pin) throw new UserError(m('كلمة السر مطلوبة', 'A password is required'));
    checkSecretShape(a.pin);
    id = ((await one<{ m: number | null }>(c.db, 'SELECT MAX(id) AS m FROM profile'))?.m ?? 0) + 1;
    const salt = crypto.randomUUID();
    stmts.push({
      sql: 'INSERT INTO profile (id, name, role, pin_salt, pin_hash, book_id, access_id) VALUES (?,?,?,?,?,?,?)',
      params: [id, name, role, salt, await hashSecret(salt, a.pin), books[0] ?? null, a.access_id],
    });
  }
  stmts.push({ sql: 'DELETE FROM user_book WHERE profile_id = ?', params: [id] });
  for (const b of books) stmts.push({ sql: 'INSERT INTO user_book (profile_id, book_id) VALUES (?, ?)', params: [id, b] });
  stmts.push(auditStmt(c.who, a.id ? 'edit' : 'add', 'profile', String(id), null, { name, access_id: a.access_id, books }));
  await c.db.batch(stmts);
  await keepAManager(c);
}

async function accessList(c: OpCtx): Promise<AccessRow[]> {
  const rows = await c.db.query<{ id: number; name: string; perms: string; users: number }>(
    `SELECT a.id, a.name, a.perms, (SELECT COUNT(*) FROM profile p WHERE p.access_id = a.id AND p.active = 1) AS users
       FROM access_profile a ORDER BY a.sort, a.name`,
  );
  return rows.map((r) => ({ ...r, perms: cleanPerms(JSON.parse(r.perms)) }));
}

async function saveAccess(c: OpCtx, a: { id?: number; name: string; perms: string[] }) {
  need(c, 'users.manage');
  const name = a.name.trim();
  if (!name) throw new UserError(m('الاسم فارغ', 'The name is empty'));
  if (await one(c.db, 'SELECT 1 FROM access_profile WHERE name = ? AND id <> ?', [name, a.id ?? -1]))
    throw new UserError(m(`"${name}" موجود مسبقاً`, `"${name}" already exists`));
  const perms = JSON.stringify(cleanPerms(a.perms));
  const before = a.id ? await one(c.db, 'SELECT * FROM access_profile WHERE id = ?', [a.id]) : null;
  if (a.id) {
    await c.db.batch([
      { sql: 'UPDATE access_profile SET name = ?, perms = ? WHERE id = ?', params: [name, perms, a.id] },
      auditStmt(c.who, 'edit', 'access_profile', String(a.id), before, { name, perms }),
    ]);
  } else {
    const sort = ((await one<{ s: number | null }>(c.db, 'SELECT MAX(sort) AS s FROM access_profile'))?.s ?? 0) + 1;
    await c.db.batch([
      { sql: 'INSERT INTO access_profile (name, perms, sort) VALUES (?, ?, ?)', params: [name, perms, sort] },
      auditStmt(c.who, 'add', 'access_profile', null, null, { name, perms }),
    ]);
  }
  try {
    await keepAManager(c);
  } catch (e) {
    if (before) await c.db.batch([{ sql: 'UPDATE access_profile SET name = ?, perms = ? WHERE id = ?', params: [before.name, before.perms, a.id!] }]);
    throw e;
  }
}

// ---------------------------------------------------------------- the operations

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
const anyone = (_c: OpCtx) => undefined;
const fileHolderOnly = (c: OpCtx) => {
  if (c.install !== 'holder') throw refuse();
};

export const OPS = {
  // ---------------------------------------------------------------- reading
  data: { check: anyone, run: (c: OpCtx) => loadData(c) },
  'cash.counts': {
    check: anyone,
    run: async (c: OpCtx) => {
      const rows = await c.db.query<CashCountRow>('SELECT * FROM cash_count');
      return can(c, 'reports.cash') || can(c, 'register.edit') ? rows : rows.filter((r) => keeps(c, r.book_id));
    },
  },
  'audit.list': { check: (c: OpCtx) => need(c, 'audit.view'), run: (c: OpCtx) => c.db.query<AuditRow>('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500') },
  'importLog.list': { check: (c: OpCtx) => need(c, 'data.import'), run: (c: OpCtx) => c.db.query<ImportLogRow>('SELECT * FROM import_log ORDER BY id DESC LIMIT 30') },
  'users.list': { check: anyone, run: (c: OpCtx) => usersList(c) },
  'access.list': { check: (c: OpCtx) => need(c, 'users.manage'), run: (c: OpCtx) => accessList(c) },
  'closing.problems': {
    check: anyone,
    run: (c: OpCtx, a: { ym: string; bookId: number | null }) => {
      if (a.bookId != null && !keeps(c, a.bookId)) need(c, 'register.view');
      if (a.bookId == null) need(c, 'month.close', 'register.view');
      return closingProblems(c, a.ym, a.bookId);
    },
  },

  // ---------------------------------------------------------------- register
  'trx.save': { check: (c: OpCtx) => need(c, 'register.edit', 'book.own'), run: (c: OpCtx, a: { rows: Trx[]; deletes?: string[] }) => saveRows(c, a) },
  'trx.delete': { check: (c: OpCtx) => need(c, 'register.edit', 'book.own'), run: (c: OpCtx, a: { ids: string[] }) => saveRows(c, { rows: [], deletes: a.ids }) },
  'transfer.answer': {
    check: (c: OpCtx) => need(c, 'register.edit', 'book.own'),
    run: (c: OpCtx, a: { id: string; ok: boolean; note?: string | null }) => answerTransfer(c, a),
  },

  // ---------------------------------------------------------------- lists
  'party.add': {
    check: (c: OpCtx) => need(c, 'lists.manage'),
    run: async (c: OpCtx, a: { name: string }) => {
      await addNamed(c.db, 'party', a.name, c.who);
      return (await one<{ id: number }>(c.db, 'SELECT id FROM party WHERE name = ?', [a.name.trim()]))?.id ?? null;
    },
  },
  'list.add': {
    check: (c: OpCtx) => need(c, 'lists.manage'),
    run: (c: OpCtx, a: { table: SimpleList; name: string }) => {
      if (!SIMPLE.includes(a.table)) throw new UserError(m('قائمة غير معروفة', 'Unknown list'));
      return addNamed(c.db, a.table, a.name, c.who);
    },
  },
  'list.rename': { check: anyone, run: (c: OpCtx, a: { table: string; id: number; name: string }) => renameRow(c.db, listTable(c, a.table), a.id, a.name, c.who) },
  'list.setActive': { check: anyone, run: (c: OpCtx, a: { table: string; id: number; active: boolean }) => setActive(c.db, listTable(c, a.table), a.id, a.active, c.who) },
  'list.delete': { check: anyone, run: (c: OpCtx, a: { table: string; id: number }) => deleteUnused(c.db, listTable(c, a.table), a.id, c.who) },
  'list.move': { check: anyone, run: (c: OpCtx, a: { table: SimpleList; id: number; dir: -1 | 1 }) => moveRow(c.db, listTable(c, a.table), a.id, a.dir, c.who) },
  'heading.add': { check: (c: OpCtx) => need(c, 'lists.manage'), run: (c: OpCtx, a: { name: string; types: TrxType[] }) => addHeading(c.db, a.name, a.types, c.who) },
  'heading.types': { check: (c: OpCtx) => need(c, 'lists.manage'), run: (c: OpCtx, a: { id: number; types: TrxType[] }) => setHeadingTypes(c.db, a.id, a.types, c.who) },
  'line.add': { check: (c: OpCtx) => need(c, 'lists.manage'), run: (c: OpCtx, a: { headingId: number; name: string }) => addLine(c.db, a.headingId, a.name, c.who) },
  'line.fund': { check: (c: OpCtx) => need(c, 'lists.manage'), run: (c: OpCtx, a: { id: number; on: boolean }) => setProjectFund(c.db, a.id, a.on, c.who) },
  'book.save': { check: (c: OpCtx) => need(c, 'lists.manage'), run: (c: OpCtx, a: Partial<Book> & { name: string }) => saveBook(c.db, a, c.who) },
  'donor.save': { check: (c: OpCtx) => need(c, 'lists.donors'), run: (c: OpCtx, a: { id?: number; name: string; default_project_id: number | null }) => saveDonor(c.db, a, c.who) },
  'rule.save': { check: (c: OpCtx) => need(c, 'lists.manage'), run: (c: OpCtx, a: { id?: number; project_id: number; account_id: number; heading_id: number | null }) => saveRule(c.db, a, c.who) },
  'rule.delete': { check: (c: OpCtx) => need(c, 'lists.manage'), run: (c: OpCtx, a: { id: number }) => deleteRule(c.db, a.id, c.who) },
  'settings.save': { check: (c: OpCtx) => need(c, 'lists.manage'), run: (c: OpCtx, a: Partial<Settings>) => saveSettings(c.db, a, c.who) },

  // ---------------------------------------------------------------- cash
  'cash.saveCount': {
    check: anyone,
    run: async (c: OpCtx, a: { bookId: number; counts: { currency: 'SYP' | 'USD'; denomination: number; qty: number }[] }) => {
      if (!keeps(c, a.bookId)) need(c, 'register.edit');
      const at = nowIso();
      await c.db.batch([
        { sql: 'DELETE FROM cash_count WHERE book_id = ?', params: [a.bookId] },
        ...a.counts.map((x) => ({ sql: 'INSERT INTO cash_count (book_id, currency, denomination, qty, counted_at) VALUES (?,?,?,?,?)', params: [a.bookId, x.currency, x.denomination, x.qty, at] })),
        auditStmt(c.who, 'count', 'cash_count', String(a.bookId), null, a.counts),
      ]);
    },
  },
  'receipt.add': {
    check: fileHolderOnly,
    run: async (c: OpCtx, a: { date: string; syp: number; usd: number; note: string | null }) => {
      const id = uuid();
      await c.db.batch([
        { sql: 'INSERT INTO holder_receipt (id, date, amount_syp, amount_usd, note, created_at) VALUES (?,?,?,?,?,?)', params: [id, a.date, a.syp, a.usd, a.note, nowIso()] },
        auditStmt(c.who, 'add', 'holder_receipt', id, null, a),
      ]);
    },
  },
  'receipt.delete': {
    check: fileHolderOnly,
    run: (c: OpCtx, a: { id: string }) =>
      c.db.batch([{ sql: 'DELETE FROM holder_receipt WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'holder_receipt', a.id, null, null)]),
  },

  // ---------------------------------------------------------------- grants (confidential)
  'grant.add': {
    check: (c: OpCtx) => need(c, 'lists.donors'),
    run: async (c: OpCtx, a: { date: string; donor_id: number; project_id: number | null; amount_usd: number; reference: string | null; note: string | null }) => {
      if (!a.date || !a.donor_id || !(a.amount_usd > 0)) throw new UserError(m('التاريخ والمانح والمبلغ مطلوبة', 'Date, donor and amount are required'));
      const id = uuid();
      await c.db.batch([
        { sql: 'INSERT INTO grant_row (id, date, donor_id, project_id, amount_usd, reference, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)', params: [id, a.date, a.donor_id, a.project_id, a.amount_usd, a.reference, a.note, nowIso(), c.who] },
        auditStmt(c.who, 'add', 'grant_row', id, null, a),
      ]);
    },
  },
  'grant.delete': {
    check: (c: OpCtx) => need(c, 'lists.donors'),
    run: async (c: OpCtx, a: { id: string }) => {
      const before = await one(c.db, 'SELECT * FROM grant_row WHERE id = ?', [a.id]);
      await c.db.batch([{ sql: 'DELETE FROM grant_row WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'grant_row', a.id, before, null)]);
    },
  },

  // ---------------------------------------------------------------- months: step 1 (book), step 2 (office)
  'bookMonth.close': {
    check: anyone,
    run: async (c: OpCtx, a: { bookId: number; ym: string }) => {
      if (!keeps(c, a.bookId)) need(c, 'month.close'); // the office may close a book for its keeper
      if (!keeps(c, a.bookId) && !can(c, 'register.edit')) throw refuse();
      if ((await closedMonths(c.db)).has(a.ym)) throw new UserError(m('الشهر مغلق مسبقاً', 'The month is already closed'));
      throwIf(await closingProblems(c, a.ym, a.bookId));
      await c.db.batch([
        { sql: 'INSERT OR IGNORE INTO book_month (book_id, ym, closed_at, closed_by) VALUES (?, ?, ?, ?)', params: [a.bookId, a.ym, nowIso(), c.who] },
        auditStmt(c.who, 'close', 'book_month', `${a.bookId}|${a.ym}`, null, null),
      ]);
    },
  },
  'bookMonth.reopen': {
    check: (c: OpCtx) => need(c, 'month.reopen'),
    run: async (c: OpCtx, a: { bookId: number; ym: string }) => {
      if ((await closedMonths(c.db)).has(a.ym)) throw new UserError(m('أعد فتح شهر المكتب أولاً', "Reopen the office's month first"));
      await c.db.batch([
        { sql: 'DELETE FROM book_month WHERE book_id = ? AND ym = ?', params: [a.bookId, a.ym] },
        auditStmt(c.who, 'reopen', 'book_month', `${a.bookId}|${a.ym}`, null, null),
      ]);
    },
  },
  'month.close': {
    check: (c: OpCtx) => need(c, 'month.close'),
    run: async (c: OpCtx, a: { ym: string }) => {
      throwIf(await closingProblems(c, a.ym, null));
      await c.db.batch([
        { sql: 'INSERT OR IGNORE INTO closed_month (ym, closed_at, closed_by) VALUES (?, ?, ?)', params: [a.ym, nowIso(), c.who] },
        auditStmt(c.who, 'close', 'closed_month', a.ym, null, null),
      ]);
    },
  },
  'month.reopen': {
    check: (c: OpCtx) => need(c, 'month.reopen'),
    run: (c: OpCtx, a: { ym: string }) =>
      c.db.batch([{ sql: 'DELETE FROM closed_month WHERE ym = ?', params: [a.ym] }, auditStmt(c.who, 'reopen', 'closed_month', a.ym, null, null)]),
  },

  // ---------------------------------------------------------------- users and permission profiles
  'user.save': { check: (c: OpCtx) => need(c, 'users.manage'), run: (c: OpCtx, a: { id?: number; name: string; access_id: number; books: number[]; pin?: string }) => saveUser(c, a) },
  'user.deactivate': {
    check: (c: OpCtx) => need(c, 'users.manage'),
    run: async (c: OpCtx, a: { id: number }) => {
      if (a.id === c.profile.id) throw new UserError(m('لا توقف نفسك', 'You cannot deactivate yourself'));
      await c.db.batch([{ sql: 'UPDATE profile SET active = 0 WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'deactivate', 'profile', String(a.id), null, null)]);
    },
  },
  'profile.setPin': {
    check: anyone,
    run: (c: OpCtx, a: { id: number; pin: string }) => {
      if (a.id !== c.profile.id) need(c, 'users.manage');
      return changePin(c.db, a.id, a.pin, c.who);
    },
  },
  'access.save': { check: (c: OpCtx) => need(c, 'users.manage'), run: (c: OpCtx, a: { id?: number; name: string; perms: string[] }) => saveAccess(c, a) },
  'access.delete': {
    check: (c: OpCtx) => need(c, 'users.manage'),
    run: async (c: OpCtx, a: { id: number }) => {
      if (await one(c.db, 'SELECT 1 FROM profile WHERE access_id = ?', [a.id])) throw new UserError(m('مستعمل لمستخدمين', 'Some users have this profile'));
      await c.db.batch([{ sql: 'DELETE FROM access_profile WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'access_profile', String(a.id), null, null)]);
    },
  },

  // ---------------------------------------------------------------- files (desktop app, and moving old files in)
  'entries.import': {
    check: (c: OpCtx) => need(c, 'data.import'),
    run: async (c: OpCtx, a: { text: string; fileName: string }): Promise<EntriesImportResult> => {
      await c.files.backupNow('before-import');
      return importEntries(c.db, a.text, a.fileName, c.who);
    },
  },
  'lists.export': { check: (c: OpCtx) => need(c, 'data.import'), run: (c: OpCtx): Promise<ListsPackage> => exportListsPackage(c.db, c.who) },
  'lists.apply': {
    check: fileHolderOnly,
    run: async (c: OpCtx, a: { pkg: ListsPackage }) => {
      await c.files.backupNow('before-lists');
      await applyListsPackage(c.db, a.pkg, c.who);
    },
  },
  'entries.build': { check: fileHolderOnly, run: (c: OpCtx): Promise<{ file: EntriesFile; unsentIds: string[] }> => buildEntriesFile(c.db, c.profile.book_id!) },
  'entries.markSent': { check: fileHolderOnly, run: (c: OpCtx, a: { ids: string[]; total: number }) => markSent(c.db, a.ids, a.total, c.who) },
  'workbook.import': {
    check: (c: OpCtx) => need(c, 'data.import'),
    run: async (c: OpCtx, a: { base64: string; fileName: string }): Promise<ImportReport> => {
      const n = await one<{ c: number }>(c.db, 'SELECT COUNT(*) AS c FROM trx');
      if (n && n.c > 0) throw new UserError(m('السجل ليس فارغاً', 'The register is not empty'));
      await c.files.backupNow('before-migration');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(b64ToBytes(a.base64));
      return applySeed(c.db, readWorkbook(wb), c.who, a.fileName);
    },
  },

  // ---------------------------------------------------------------- backups
  'backup.list': { check: (c: OpCtx) => need(c, 'data.backup', 'data.restore'), run: (c: OpCtx) => c.files.list() },
  'backup.now': { check: (c: OpCtx) => need(c, 'data.backup'), run: (c: OpCtx) => c.files.backupNow('manual') },
  'backup.restore': { check: (c: OpCtx) => need(c, 'data.restore'), run: (c: OpCtx, a: { path: string }) => c.files.restore(a.path) },
} as const;

export type OpName = keyof typeof OPS;
type Def = { check: (c: OpCtx) => void; run: (c: OpCtx, a: never) => unknown };
export type OpArgs<K extends OpName> = (typeof OPS)[K]['run'] extends (c: OpCtx, a: infer A) => unknown ? A : undefined;
export type OpResult<K extends OpName> = Awaited<ReturnType<(typeof OPS)[K]['run']>>;

/** Operations that only read (the server does not count them as changes). */
export const READ_ONLY: ReadonlySet<string> = new Set([
  'data', 'cash.counts', 'audit.list', 'importLog.list', 'users.list', 'access.list', 'closing.problems', 'backup.list', 'entries.build', 'lists.export',
]);

/** Runs one operation with its permission check. Used by the desktop app and by the server. */
export async function runOp(c: OpCtx, name: string, args: unknown): Promise<unknown> {
  const def = (OPS as Record<string, Def>)[name];
  if (!def) throw new UserError(m('عملية غير معروفة', 'Unknown operation'));
  def.check(c);
  return def.run(c, args as never);
}

/** How the screens reach the operations: locally or over the network. */
export interface Api {
  call<K extends OpName>(name: K, args?: OpArgs<K>): Promise<OpResult<K>>;
}

export function localApi(ctx: OpCtx): Api {
  return { call: (name, args) => runOp(ctx, name, args) as never };
}

export { listProfiles };
