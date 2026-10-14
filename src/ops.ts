// Every action the screens can ask for, with WHO may do it.
// The same functions run in two places:
//  - in the desktop app, directly on the local database file;
//  - on the network server, after it has identified the person logged in.
// The server never trusts the screen: each operation checks the role here,
// and every register row is validated again before it is written.

import ExcelJS from 'exceljs';
import { type Db, nowIso, one, uuid } from './db/db';
import {
  addHeading, addLine, addNamed, auditStmt, closedMonths, deleteRule, deleteUnused, getMeta, loadLists, loadTrx,
  moveRow, renameRow, saveBook, saveDonor, saveRule, saveSettings, saveTrxRows, setActive, setHeadingTypes, setProjectFund,
  UserError, type SimpleList,
} from './db/repo';
import { changePin, listProfiles, profileStmt, type Profile } from './auth';
import { validateTrx } from './domain/validate';
import type { GrantRow } from './domain/reports';
import type { Book, Lists, Role, Settings, Trx, TrxType } from './domain/types';
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

/** Everything a screen needs, already cut to what this person may see. */
export interface DataPayload {
  lists: Lists;
  rows: Trx[];
  closed: string[];
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

export interface AuditRow { id: number; at: string; who: string; action: string; tbl: string; row_id: string | null; before: string | null; after: string | null }
export interface ImportLogRow { id: number; at: string; who: string; kind: string; file_name: string; added: number; skipped: number }

const SUP: Role[] = ['sup'];
const OFFICE: Role[] = ['sup', 'com'];
const ALL: Role[] = ['sup', 'com', 'holder'];

function need(c: OpCtx, roles: Role[]) {
  if (!roles.includes(c.profile.role)) throw new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user'));
}

const isHolder = (c: OpCtx) => c.profile.role === 'holder';

const SIMPLE: SimpleList[] = ['city', 'account', 'project', 'party'];
const LIST_TABLES = ['city', 'account', 'project', 'party', 'book', 'heading', 'budget_line', 'donor'] as const;
type ListTable = (typeof LIST_TABLES)[number];
function listTable(c: OpCtx, t: string): ListTable {
  if (!(LIST_TABLES as readonly string[]).includes(t)) throw new UserError(m('قائمة غير معروفة', 'Unknown list'));
  if (t === 'donor') need(c, SUP);
  return t as ListTable;
}

async function loadData(c: OpCtx): Promise<DataPayload> {
  const { db, profile } = c;
  const [lists, allRows, closed] = await Promise.all([loadLists(db), loadTrx(db), closedMonths(db)]);
  const holder = profile.role === 'holder';
  // A holder sees his own book only; donors and grants are for the Superior only.
  const rows = holder ? allRows.filter((r) => r.book_id === profile.book_id) : allRows;
  if (profile.role !== 'sup') lists.donors = [];
  const grants = profile.role === 'sup' ? await db.query<GrantRow>('SELECT * FROM grant_row ORDER BY date') : [];
  const receipts = c.install === 'holder' ? await db.query<HolderReceipt>('SELECT * FROM holder_receipt ORDER BY date') : [];
  const ot = await getMeta(db, 'office_transfers');
  return { lists, rows, closed: [...closed], grants, receipts, officeTransfers: ot ? JSON.parse(ot) : {}, listsVersion: await getMeta(db, 'lists_version') };
}

/** Save register rows: role checks, then the same validation as the form, then write. */
async function saveRows(c: OpCtx, a: { rows: Trx[]; deletes?: string[] }) {
  need(c, ALL);
  const deletes = a.deletes ?? [];
  const all = await loadTrx(c.db);
  const byId = new Map(all.map((r) => [r.id, r]));
  if (isHolder(c)) {
    for (const r of a.rows) {
      if (r.book_id !== c.profile.book_id) throw new UserError(m('دفترك فقط', 'Your own book only'));
      if (r.type === 'Transfer') throw new UserError(m('التحويل يسجّله المكتب', 'Transfers are booked by the office'));
    }
    for (const id of [...a.rows.map((r) => r.id), ...deletes]) {
      const old = byId.get(id);
      if (old && old.book_id !== c.profile.book_id) throw new UserError(m('دفترك فقط', 'Your own book only'));
      if (old?.sent_at) throw new UserError(m('أُرسل إلى المكتب ولا يُعدَّل', 'Already sent to the office: cannot be changed'));
    }
  }
  const lists = await loadLists(c.db);
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
  // The server keeps the row as the person sent it, but never their review notes or numbers.
  const clean = a.rows.map((r) => ({ ...r, review: null, n: byId.get(r.id)?.n ?? null, sent_at: byId.get(r.id)?.sent_at ?? null }));
  await saveTrxRows(c.db, clean, c.who, c.install === 'office', deletes);
}

async function deleteRows(c: OpCtx, a: { ids: string[] }) {
  return saveRows(c, { rows: [], deletes: a.ids });
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

export const OPS = {
  // ---------------------------------------------------------------- reading
  data: { roles: ALL, run: (c: OpCtx) => loadData(c) },
  'cash.counts': {
    roles: ALL,
    run: async (c: OpCtx) => {
      const rows = await c.db.query<CashCountRow>('SELECT * FROM cash_count');
      return isHolder(c) ? rows.filter((r) => r.book_id === c.profile.book_id) : rows;
    },
  },
  'audit.list': { roles: OFFICE, run: (c: OpCtx) => c.db.query<AuditRow>('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500') },
  'importLog.list': { roles: OFFICE, run: (c: OpCtx) => c.db.query<ImportLogRow>('SELECT * FROM import_log ORDER BY id DESC LIMIT 30') },
  'profiles.list': {
    roles: ALL,
    run: async (c: OpCtx) => (await listProfiles(c.db)).filter((p) => c.profile.role === 'sup' || p.id === c.profile.id),
  },

  // ---------------------------------------------------------------- register
  'trx.save': { roles: ALL, run: (c: OpCtx, a: { rows: Trx[]; deletes?: string[] }) => saveRows(c, a) },
  'trx.delete': { roles: ALL, run: (c: OpCtx, a: { ids: string[] }) => deleteRows(c, a) },

  // ---------------------------------------------------------------- lists
  'party.add': {
    roles: OFFICE,
    run: async (c: OpCtx, a: { name: string }) => {
      await addNamed(c.db, 'party', a.name, c.who);
      return (await one<{ id: number }>(c.db, 'SELECT id FROM party WHERE name = ?', [a.name.trim()]))?.id ?? null;
    },
  },
  'list.add': {
    roles: OFFICE,
    run: (c: OpCtx, a: { table: SimpleList; name: string }) => {
      if (!SIMPLE.includes(a.table)) throw new UserError(m('قائمة غير معروفة', 'Unknown list'));
      return addNamed(c.db, a.table, a.name, c.who);
    },
  },
  'list.rename': { roles: OFFICE, run: (c: OpCtx, a: { table: string; id: number; name: string }) => renameRow(c.db, listTable(c, a.table), a.id, a.name, c.who) },
  'list.setActive': { roles: OFFICE, run: (c: OpCtx, a: { table: string; id: number; active: boolean }) => setActive(c.db, listTable(c, a.table), a.id, a.active, c.who) },
  'list.delete': { roles: OFFICE, run: (c: OpCtx, a: { table: string; id: number }) => deleteUnused(c.db, listTable(c, a.table), a.id, c.who) },
  'list.move': { roles: OFFICE, run: (c: OpCtx, a: { table: SimpleList; id: number; dir: -1 | 1 }) => moveRow(c.db, listTable(c, a.table), a.id, a.dir, c.who) },
  'heading.add': { roles: OFFICE, run: (c: OpCtx, a: { name: string; types: TrxType[] }) => addHeading(c.db, a.name, a.types, c.who) },
  'heading.types': { roles: OFFICE, run: (c: OpCtx, a: { id: number; types: TrxType[] }) => setHeadingTypes(c.db, a.id, a.types, c.who) },
  'line.add': { roles: OFFICE, run: (c: OpCtx, a: { headingId: number; name: string }) => addLine(c.db, a.headingId, a.name, c.who) },
  'line.fund': { roles: OFFICE, run: (c: OpCtx, a: { id: number; on: boolean }) => setProjectFund(c.db, a.id, a.on, c.who) },
  'book.save': { roles: OFFICE, run: (c: OpCtx, a: Partial<Book> & { name: string }) => saveBook(c.db, a, c.who) },
  'donor.save': { roles: SUP, run: (c: OpCtx, a: { id?: number; name: string; default_project_id: number | null }) => saveDonor(c.db, a, c.who) },
  'rule.save': { roles: OFFICE, run: (c: OpCtx, a: { id?: number; project_id: number; account_id: number; heading_id: number | null }) => saveRule(c.db, a, c.who) },
  'rule.delete': { roles: OFFICE, run: (c: OpCtx, a: { id: number }) => deleteRule(c.db, a.id, c.who) },
  'settings.save': { roles: OFFICE, run: (c: OpCtx, a: Partial<Settings>) => saveSettings(c.db, a, c.who) },

  // ---------------------------------------------------------------- cash
  'cash.saveCount': {
    roles: ALL,
    run: async (c: OpCtx, a: { bookId: number; counts: { currency: 'SYP' | 'USD'; denomination: number; qty: number }[] }) => {
      if (isHolder(c) && a.bookId !== c.profile.book_id) throw new UserError(m('دفترك فقط', 'Your own book only'));
      const at = nowIso();
      await c.db.batch([
        { sql: 'DELETE FROM cash_count WHERE book_id = ?', params: [a.bookId] },
        ...a.counts.map((x) => ({ sql: 'INSERT INTO cash_count (book_id, currency, denomination, qty, counted_at) VALUES (?,?,?,?,?)', params: [a.bookId, x.currency, x.denomination, x.qty, at] })),
        auditStmt(c.who, 'count', 'cash_count', String(a.bookId), null, a.counts),
      ]);
    },
  },
  'receipt.add': {
    roles: ['holder'] as Role[],
    run: async (c: OpCtx, a: { date: string; syp: number; usd: number; note: string | null }) => {
      const id = uuid();
      await c.db.batch([
        { sql: 'INSERT INTO holder_receipt (id, date, amount_syp, amount_usd, note, created_at) VALUES (?,?,?,?,?,?)', params: [id, a.date, a.syp, a.usd, a.note, nowIso()] },
        auditStmt(c.who, 'add', 'holder_receipt', id, null, a),
      ]);
    },
  },
  'receipt.delete': {
    roles: ['holder'] as Role[],
    run: (c: OpCtx, a: { id: string }) =>
      c.db.batch([{ sql: 'DELETE FROM holder_receipt WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'holder_receipt', a.id, null, null)]),
  },

  // ---------------------------------------------------------------- grants (Superior)
  'grant.add': {
    roles: SUP,
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
    roles: SUP,
    run: async (c: OpCtx, a: { id: string }) => {
      const before = await one(c.db, 'SELECT * FROM grant_row WHERE id = ?', [a.id]);
      await c.db.batch([{ sql: 'DELETE FROM grant_row WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'grant_row', a.id, before, null)]);
    },
  },

  // ---------------------------------------------------------------- months
  'month.close': {
    roles: OFFICE,
    run: (c: OpCtx, a: { ym: string }) =>
      c.db.batch([
        { sql: 'INSERT OR IGNORE INTO closed_month (ym, closed_at, closed_by) VALUES (?, ?, ?)', params: [a.ym, nowIso(), c.who] },
        auditStmt(c.who, 'close', 'closed_month', a.ym, null, null),
      ]),
  },
  'month.reopen': {
    roles: SUP,
    run: (c: OpCtx, a: { ym: string }) =>
      c.db.batch([{ sql: 'DELETE FROM closed_month WHERE ym = ?', params: [a.ym] }, auditStmt(c.who, 'reopen', 'closed_month', a.ym, null, null)]),
  },

  // ---------------------------------------------------------------- users
  'profile.add': {
    roles: SUP,
    run: async (c: OpCtx, a: { name: string; role: Role; pin: string; book_id: number | null }) => {
      if (!a.name.trim()) throw new UserError(m('الاسم فارغ', 'The name is empty'));
      if (a.role === 'holder' && a.book_id == null) throw new UserError(m('اختر دفتر الأمين', "Choose the holder's book"));
      await c.db.batch([await profileStmt(a), auditStmt(c.who, 'add', 'profile', null, null, { name: a.name, role: a.role, book_id: a.book_id })]);
    },
  },
  'profile.setPin': {
    roles: ALL,
    run: (c: OpCtx, a: { id: number; pin: string }) => {
      if (a.id !== c.profile.id) need(c, SUP);
      return changePin(c.db, a.id, a.pin, c.who);
    },
  },
  'profile.deactivate': {
    roles: SUP,
    run: (c: OpCtx, a: { id: number }) => {
      if (a.id === c.profile.id) throw new UserError(m('لا توقف نفسك', 'You cannot deactivate yourself'));
      return c.db.batch([{ sql: 'UPDATE profile SET active = 0 WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'deactivate', 'profile', String(a.id), null, null)]);
    },
  },

  // ---------------------------------------------------------------- files between holders and the office
  'entries.import': {
    roles: OFFICE,
    run: async (c: OpCtx, a: { text: string; fileName: string }): Promise<EntriesImportResult> => {
      await c.files.backupNow('before-import');
      return importEntries(c.db, a.text, a.fileName, c.who);
    },
  },
  'lists.export': { roles: OFFICE, run: (c: OpCtx): Promise<ListsPackage> => exportListsPackage(c.db, c.who) },
  'lists.apply': {
    roles: ['holder'] as Role[],
    run: async (c: OpCtx, a: { pkg: ListsPackage }) => {
      await c.files.backupNow('before-lists');
      await applyListsPackage(c.db, a.pkg, c.who);
    },
  },
  'entries.build': {
    roles: ['holder'] as Role[],
    run: (c: OpCtx): Promise<{ file: EntriesFile; unsentIds: string[] }> => buildEntriesFile(c.db, c.profile.book_id!),
  },
  'entries.markSent': { roles: ['holder'] as Role[], run: (c: OpCtx, a: { ids: string[]; total: number }) => markSent(c.db, a.ids, a.total, c.who) },
  'workbook.import': {
    roles: OFFICE,
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
  'backup.list': { roles: OFFICE, run: (c: OpCtx) => c.files.list() },
  'backup.now': { roles: OFFICE, run: (c: OpCtx) => c.files.backupNow('manual') },
  'backup.restore': { roles: SUP, run: (c: OpCtx, a: { path: string }) => c.files.restore(a.path) },
} as const;

export type OpName = keyof typeof OPS;
type Def = { roles: readonly Role[]; run: (c: OpCtx, a: never) => unknown };
export type OpArgs<K extends OpName> = (typeof OPS)[K]['run'] extends (c: OpCtx, a: infer A) => unknown ? A : undefined;
export type OpResult<K extends OpName> = Awaited<ReturnType<(typeof OPS)[K]['run']>>;

/** Operations that only read (the server does not count them as changes). */
export const READ_ONLY: ReadonlySet<string> = new Set(['data', 'cash.counts', 'audit.list', 'importLog.list', 'profiles.list', 'backup.list', 'entries.build', 'lists.export']);

/** Runs one operation with the role check. Used by the desktop app and by the server. */
export async function runOp(c: OpCtx, name: string, args: unknown): Promise<unknown> {
  const def = (OPS as Record<string, Def>)[name];
  if (!def) throw new UserError(m('عملية غير معروفة', 'Unknown operation'));
  need(c, def.roles as Role[]);
  return def.run(c, args as never);
}

/** How the screens reach the operations: locally or over the network. */
export interface Api {
  call<K extends OpName>(name: K, args?: OpArgs<K>): Promise<OpResult<K>>;
}

export function localApi(ctx: OpCtx): Api {
  return { call: (name, args) => runOp(ctx, name, args) as never };
}
