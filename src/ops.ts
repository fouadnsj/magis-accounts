// Every action the screens can ask for, with the PERMISSION it needs.
// The same functions run in two places:
//  - in the desktop app, directly on the local database file;
//  - on the network server, after it has identified the person logged in.
// The server never trusts the screen: each operation checks the person's
// permissions here, and every register row is validated again before writing.

import ExcelJS from 'exceljs';
import { type Db, type Stmt, nowIso, one, uuid } from './db/db';
import {
  addHeading, addLine, addNamed, auditStmt, blankTrx, closedMonths, deleteRule, deleteUnused, getMeta, loadLists, loadTrx, setMetaStmt,
  moveRow, renameRow, saveBook, saveDonor, saveRule, saveSettings, saveTrxRows, setActive, setHeadingTypes, setProjectFund,
  UserError, type SimpleList,
} from './db/repo';
import { changePin, checkSecretShape, hashSecret, has, listProfiles, roleFor, type Profile } from './auth';
import { cleanPerms, type Perm } from './perms';
import { validateTrx } from './domain/validate';
import { ENTRY_FIELDS, compareRows } from './domain/compare';
import { billCode, computeAll } from './domain/compute';
import {
  addMonths, cellsOf, defaultBudgetName, itemTotal, periodEnd, proposeFromSpending, prorateItems, spentInRange, totalsOf,
  type Budget,
  type AllocStatus, type BudgetAccount, type BudgetAlloc, type BudgetAmount, type BudgetItem, type BudgetVersion,
} from './domain/budget';
import { buildTransfers, transferKey, type TransferInfo } from './domain/transfers';
import { holders } from './domain/reports';
import { GRANT_STEPS, type GrantCard, type GrantPart, type GrantStep } from './domain/grants';
import type { Book, Lists, Settings, Trx, TrxType } from './domain/types';
import {
  applyListsPackage, buildEntriesFile, exportListsPackage, importEntries, markSent, type EntriesFile, type EntriesImportResult, type ListsPackage,
} from './io/keeperFiles';
import { applySeed, readWorkbook, type ImportReport } from './io/importWorkbook';
import { m, type Msg } from './i18n';
import { CTY_OPS, CTY_READ_ONLY } from './community/ops';
import { COUNTRY_OPS, COUNTRY_READ_ONLY } from './community/country';

export type Install = 'office' | 'holder';

export interface BackupFile {
  name: string;
  path: string;
  size: number;
  modified: number;
}

/** Backups and attached documents are files: the desktop app and the server each provide their own way. */
export interface FileOps {
  backupNow(reason: string): Promise<string | null>;
  list(): Promise<BackupFile[]>;
  restore(path: string): Promise<void>;
  /** the register rows of a backup copy, read without changing it */
  backupRows(path: string): Promise<Trx[]>;
  /** attached documents, by a path relative to the database's attachments folder */
  docWrite(rel: string, bytes: Uint8Array): Promise<void>;
  docRead(rel: string): Promise<Uint8Array>;
  docExists(rel: string): Promise<boolean>;
}

export interface AttachmentRow {
  id: string;
  trx_id: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
  created_by: string | null;
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
  /** at closing: what the book said, what was counted, and why they differ */
  book_syp?: number | null;
  book_usd?: number | null;
  counted_syp?: number | null;
  counted_usd?: number | null;
  count_note?: string | null;
}

/** USD of an expense row, all currencies counted (as in the reports). */
const expUsdOf = (comp: Map<string, { expUsdTot: number }>, r: Trx) => comp.get(r.id)?.expUsdTot ?? 0;
const CONTROL_KEYS = ['doc_required_usd', 'approval_on', 'approval_usd', 'approval_profile_id', 'doc_since', 'approval_since'];

/** The rules concern entries made after they were switched on, never the past. */
export const needsApproval = (s: Settings, r: Trx, usd: number) =>
  !!s.approval_on && s.approval_usd > 0 && r.type === 'Exp' && !r.private_total && usd >= s.approval_usd && !r.approved_at && (!s.approval_since || (r.created_at ?? '') >= s.approval_since);
export const needsDoc = (s: Settings, r: Trx, usd: number) =>
  s.doc_required_usd > 0 && r.type === 'Exp' && !r.private_total && usd >= s.doc_required_usd && (!s.doc_since || (r.created_at ?? '') >= s.doc_since);

/** May this person approve large expenses? The profile named in the settings, or whoever manages users. */
const mayApprove = (c: OpCtx, s: Settings) => (s.approval_profile_id ? c.profile.access_id === s.approval_profile_id : can(c, 'users.manage'));

/** What a book holds at the end of a month (SYP and USD). */
function balanceAt(rows: Trx[], books: Book[], bookId: number, month: string) {
  const end = `${month}-31`;
  const syp = holders(rows, books, 'SYP', end).find((l) => l.book?.id === bookId)?.shouldHold ?? 0;
  const usd = holders(rows, books, 'USD', end).find((l) => l.book?.id === bookId)?.shouldHold ?? 0;
  return { syp, usd };
}

/** Everything a screen needs, already cut to what this person may see. */
export interface DataPayload {
  lists: Lists;
  rows: Trx[];
  closed: string[];
  bookMonths: BookMonth[];
  closedYears: number[];
  transfers: TransferInfo[];
  /** books that have at least one active person keeping them */
  keptBooks: number[];
  /** grants and what they are for (only for those who see the donors) */
  grants: GrantCard[];
  grantParts: GrantPart[];
  receipts: HolderReceipt[];
  officeTransfers: Record<string, OfficeTransfer[]>;
  listsVersion: string | null;
  attachments: AttachmentRow[];
  /** the Respo book: grants and the Province's money arrive there (outside the centre's reports) */
  grantsBookId: number | null;
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
/** May write in this book: one he keeps, or Main with "writes in the Main book". */
const writes = (c: OpCtx, bookId: number | null, mainId: number | null) => keeps(c, bookId) || (bookId != null && bookId === mainId && can(c, 'register.main'));
const mainOf = async (db: Db) => (await one<{ id: number }>(db, 'SELECT id FROM book WHERE is_main = 1'))?.id ?? null;

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

/** The rows of one book that differ from a backup (and the other legs of its two-book transfers). */
export function bookChanges(then: Trx[], now: Trx[], bookId: number): string[] {
  const diff = compareRows(then, now);
  const ids = new Set<string>([
    ...diff.added.filter((r) => r.book_id === bookId).map((r) => r.id),
    ...diff.deleted.filter((r) => r.book_id === bookId).map((r) => r.id),
    ...diff.changed.filter((x) => x.before.book_id === bookId || x.after.book_id === bookId).map((x) => x.after.id),
  ]);
  // a transfer between two books moves as one: its other leg goes back with it
  const groups = new Set([...then, ...now].filter((r) => ids.has(r.id) && r.transfer_group).map((r) => r.transfer_group));
  const changedIds = new Set([...diff.added, ...diff.deleted].map((r) => r.id).concat(diff.changed.map((x) => x.after.id)));
  for (const r of [...then, ...now]) if (r.transfer_group && groups.has(r.transfer_group) && changedIds.has(r.id)) ids.add(r.id);
  return [...ids];
}

/** One row back as in a backup (thenAll: the backup's rows, when already read). */
async function putBackRow(c: OpCtx, a: { path: string; id: string; reason: string }, thenAll: Trx[] | null) {
  if (!(a.reason ?? '').trim()) throw new UserError(m('اكتب السبب', 'Write the reason'));
  const then = (thenAll ?? (await c.files.backupRows(a.path))).find((r) => r.id === a.id) ?? null;
  const now = await one<Trx>(c.db, 'SELECT * FROM trx WHERE id = ?', [a.id]);
  const reason = `${a.reason.trim()} (${m('كما في النسخة', 'as in the backup').en} ${a.path.split(/[\\/]/).pop()})`;
  if (!then && now) return saveRows(c, { rows: [], deletes: [a.id], reason });
  if (!then) throw new UserError(m('السطر غير موجود', 'Row not found'));
  const back: Trx = { ...(now ?? { ...blankTrx(), ...then, approved_at: null, approved_by: null }), id: a.id };
  for (const f of ENTRY_FIELDS) (back as unknown as Record<string, unknown>)[f] = (then as unknown as Record<string, unknown>)[f] ?? null;
  back.transfer_group = then.transfer_group ?? null;
  await saveRows(c, { rows: [back], reason, restoring: true });
  // a row brought back keeps its old number, if nobody has it
  if (!now && then.n != null && !(await one(c.db, 'SELECT 1 FROM trx WHERE n = ? AND id <> ?', [then.n, a.id])))
    await c.db.batch([{ sql: 'UPDATE trx SET n = ? WHERE id = ?', params: [then.n, a.id] }]);
}

/** Rows as this person may see them: a private book's rows only for its keepers (others: its transfers, without explanation). */
function privateView(c: OpCtx, lists: Lists, rows: Trx[]): Trx[] {
  const priv = new Set(lists.books.filter((b) => b.private).map((b) => b.id));
  const all = can(c, 'register.view');
  return rows.flatMap((r): Trx[] => {
    if (!all && !keeps(c, r.book_id)) return [];
    if (r.book_id == null || !priv.has(r.book_id) || keeps(c, r.book_id)) return [r];
    return r.type === 'Transfer' ? [{ ...r, explanation: null, receipt: null, party_id: null, private_book: true }] : [];
  });
}

async function loadData(c: OpCtx): Promise<DataPayload> {
  const { db } = c;
  const [lists, allRows, closed, bm, kept] = await Promise.all([loadLists(db), loadTrx(db), closedMonths(db), bookMonths(db), keptBooks(db)]);
  const all = can(c, 'register.view');
  // A private book (the Superior's) is seen only by its keepers; others see only its
  // transfers (marked), so the receiver can confirm and Main's balance stays right.
  const priv = new Set(lists.books.filter((b) => b.private).map((b) => b.id));
  const shown = allRows.flatMap((r): Trx[] => {
    if (r.book_id == null || !priv.has(r.book_id) || keeps(c, r.book_id)) return [r];
    return r.type === 'Transfer' ? [{ ...r, explanation: null, receipt: null, party_id: null, private_book: true }] : [];
  });
  // ...and its expenses as one total a month (no detail)
  const totals = new Map<string, Trx>();
  for (const r of allRows) {
    if (r.type !== 'Exp' || r.book_id == null || !r.date || !priv.has(r.book_id) || keeps(c, r.book_id)) continue;
    const key = `private-total:${r.book_id}:${r.date.slice(0, 7)}`;
    const book = lists.books.find((b) => b.id === r.book_id);
    const tot = totals.get(key) ?? {
      ...blankTrx(), id: key, book_id: r.book_id, type: 'Exp', date: r.date, created_at: r.created_at,
      account_id: book?.account_id ?? null, city_id: book?.city_id ?? null,
      explanation: `${t2('مصاريف خاصة', 'Private expenses')} (${book?.name ?? ''})`, private_book: true, private_total: true,
    };
    tot.exp_syp += r.exp_syp;
    tot.exp_usd += r.exp_usd;
    if (r.date > tot.date!) tot.date = r.date;
    totals.set(key, tot);
  }
  shown.push(...totals.values());
  // Without "see every book", a person sees only the books he keeps.
  const rows = all ? shown : shown.filter((r) => keeps(c, r.book_id));
  // a private book's transfer: the other side sees the amount, not its explanation
  const allTransfers = buildTransfers(allRows, lists.books).map((t) =>
    [t.from, t.to].some((id) => id != null && priv.has(id) && !keeps(c, id)) ? { ...t, explanation: null } : t);
  const transfers = all ? allTransfers : allTransfers.filter((t) => keeps(c, t.from) || keeps(c, t.to));
  const donors = can(c, 'lists.donors');
  if (!donors) lists.donors = [];
  const grants = donors ? await db.query<GrantCard>('SELECT * FROM grant_card ORDER BY COALESCE(hand_on, bank_on, transferred_on, approved_on, promised_on, created_at) DESC') : [];
  const grantParts = donors ? await db.query<GrantPart>('SELECT * FROM grant_part') : [];
  const receipts = c.install === 'holder' ? await db.query<HolderReceipt>('SELECT * FROM holder_receipt ORDER BY date') : [];
  const ot = await getMeta(db, 'office_transfers');
  const visible = new Set(rows.map((r) => r.id));
  const attachments = (await db.query<AttachmentRow>('SELECT id, trx_id, name, mime, size, created_at, created_by FROM attachment WHERE deleted_at IS NULL ORDER BY created_at'))
    .filter((a) => visible.has(a.trx_id));
  return {
    lists, rows, closed: [...closed], bookMonths: all ? bm : bm.filter((b) => keeps(c, b.book_id)), transfers, keptBooks: kept,
    closedYears: (await c.db.query<{ year: number }>('SELECT year FROM closed_year')).map((x) => x.year),
    grants, grantParts, receipts, officeTransfers: ot ? JSON.parse(ot) : {}, listsVersion: await getMeta(db, 'lists_version'), attachments,
    grantsBookId: Number(await getMeta(db, 'grants_book_id')) || null,
  };
}

// ---------------------------------------------------------------- writing register rows

/**
 * Save register rows: permission checks, then the same validation as the form, then write.
 * A person without "write in every book" may only:
 *  - write income, expenses and exchanges in a book he keeps (or Main, with "writes in the Main book");
 *  - record a transfer he GIVES from such a book, while it is not yet confirmed;
 *  - change nothing in a month he (or the office) has closed for that book.
 */
async function saveRows(c: OpCtx, a: { rows: Trx[]; deletes?: string[]; reason?: string | null; restoring?: boolean }) {
  const deletes = a.deletes ?? [];
  const all = await loadTrx(c.db);
  const byId = new Map(all.map((r) => [r.id, r]));
  const lists = await loadLists(c.db);
  const editAll = can(c, 'register.edit');
  if (!editAll) need(c, 'book.own', 'register.main');

  const mainId = lists.books.find((b) => b.is_main)?.id ?? null;
  const touched = [...a.rows, ...deletes.map((id) => byId.get(id)).filter((r): r is Trx => !!r)];
  const oldTransfers = buildTransfers(all, lists.books);
  const transferOf = (r: Trx) => oldTransfers.find((t) => t.key === transferKey(r));

  if (c.install === 'holder') {
    for (const r of touched) if (byId.get(r.id)?.sent_at) throw new UserError(m('أُرسل إلى المكتب ولا يُعدَّل', 'Already sent to the office: cannot be changed'));
  }

  // a transfer is always under the heading and line "Transfer"
  const th = lists.headings.find((h) => h.name.toLowerCase() === 'transfer');
  const tl = th ? lists.lines.find((l) => l.heading_id === th.id && l.name.toLowerCase() === 'transfer') : undefined;
  if (th && tl) a = { ...a, rows: a.rows.map((r) => (r.type === 'Transfer' ? { ...r, heading_id: th.id, line_id: tl.id } : r)) };

  if (!editAll) {
    const w = (bookId: number | null) => writes(c, bookId, mainId);
    // What the rows will be (new) and were (old), seen as transfers or as ordinary rows.
    const newTransfers = buildTransfers(a.rows.filter((r) => r.type === 'Transfer'), lists.books);
    for (const t of newTransfers) {
      if (!w(t.from)) throw new UserError(m('يسجّل التحويلَ من يعطي المال، من دفتره', 'A transfer is recorded by the giver, from his own book'));
    }
    for (const r of a.rows) if (r.type !== 'Transfer' && !w(r.book_id)) throw new UserError(m('دفترك فقط', 'Your own book only'));
    for (const r of touched) {
      const old = byId.get(r.id);
      if (!old) continue;
      if (old.type === 'Transfer') {
        const t = transferOf(old);
        if (!t || !w(t.from)) throw new UserError(m('يعدّل التحويلَ من أعطى المال فقط', 'Only the giver can change a transfer'));
        if (t.receivedAt) throw new UserError(m('أكّد المستلم هذا التحويل: اطلب من المكتب تصحيحه', 'The receiver confirmed this transfer: ask the office to correct it'));
      } else if (!w(old.book_id)) throw new UserError(m('دفترك فقط', 'Your own book only'));
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
    const old = byId.get(r.id);
    // rows written before this rule, kept without an explanation, and rows put back from a backup, stay as they were
    const explainAll = !a.restoring && !(old && old.type === r.type && !(old.explanation ?? '').trim());
    const v = validateTrx(r, { lists, rows: others, closedMonths: closed, today: '9999-12-31', previousDate: old?.date ?? null, explainAll });
    errors.push(...v.errors);
  }
  for (const id of deletes) {
    const d = byId.get(id)?.date;
    if (d && closed.has(d.slice(0, 7))) errors.push(m(`الشهر ${d.slice(0, 7)} مغلق`, `Month ${d.slice(0, 7)} is closed`));
  }
  if (errors.length) throw new UserError({ ar: errors.map((e) => e.ar).join(' · '), en: errors.map((e) => e.en).join(' · ') });

  // Changing or deleting a row already saved: say why (kept in the audit log).
  const SAME = (x: Trx, y: Trx) => (['date', 'type', 'book_id', 'account_id', 'city_id', 'heading_id', 'line_id', 'party_id', 'explanation', 'receipt', 'inc_syp', 'exp_syp', 'inc_usd', 'exp_usd', 'trf_syp', 'trf_usd'] as const).every((k) => (x[k] ?? null) === (y[k] ?? null));
  const changesOld = deletes.some((id) => byId.has(id)) || a.rows.some((r) => byId.has(r.id) && !SAME(byId.get(r.id)!, r));
  const reason = (a.reason ?? '').trim() || null;
  if (changesOld && !reason) throw new UserError(m('اكتب سبب التعديل أو الحذف', 'Write the reason for this change or deletion'));

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
      // an approval stays only while the amount, date, book and line stay the same
      approved_at: old && SAME(old, r) ? old.approved_at ?? null : null,
      approved_by: old && SAME(old, r) ? old.approved_by ?? null : null,
    };
  });
  // If one leg of a two-row transfer changed, the other leg loses its confirmation too.
  for (const r of clean) {
    if (r.type === 'Transfer' && r.transfer_group && !r.received_at)
      for (const x of clean) if (x.transfer_group === r.transfer_group) Object.assign(x, { received_at: null, received_by: null, disputed_at: null, dispute_note: null });
  }
  await saveTrxRows(c.db, clean, c.who, c.install === 'office', deletes, reason);
}

const reopenMonth = (c: OpCtx, a: { ym: string }) =>
  c.db.batch([{ sql: 'DELETE FROM closed_month WHERE ym = ?', params: [a.ym] }, auditStmt(c.who, 'reopen', 'closed_month', a.ym, null, null)]);

/** Large expenses waiting for approval, and expenses missing their document. */
async function controlProblems(c: OpCtx, rows: Trx[], lists: Lists): Promise<Msg[]> {
  const s = lists.settings;
  const out: Msg[] = [];
  const exps = rows.filter((r) => r.type === 'Exp');
  if (!exps.length) return out;
  const comp = computeAll(await loadTrx(c.db), lists);
  {
    const n = exps.filter((r) => needsApproval(s, r, expUsdOf(comp, r))).length;
    if (n) out.push(m(`${n} نفقة كبيرة تنتظر الموافقة`, `${n} large expenses waiting for approval`));
  }
  if (s.doc_required_usd > 0) {
    const withDoc = new Set((await c.db.query<{ trx_id: string }>('SELECT DISTINCT trx_id FROM attachment WHERE deleted_at IS NULL')).map((x) => x.trx_id));
    const n = exps.filter((r) => needsDoc(s, r, expUsdOf(comp, r)) && !withDoc.has(r.id)).length;
    if (n) out.push(m(`${n} نفقة بلا مستند (من ${s.doc_required_usd}$)`, `${n} expenses without their document (from $${s.doc_required_usd})`));
  }
  return out;
}

/** The person who approves marks large expenses as approved. */
async function approveRows(c: OpCtx, a: { ids: string[] }) {
  const lists = await loadLists(c.db);
  if (!lists.settings.approval_on) throw new UserError(m('قاعدة الموافقة غير مفعّلة', 'The approval rule is not on'));
  if (!mayApprove(c, lists.settings)) throw refuse();
  const closed = await closedMonths(c.db);
  const at = nowIso();
  const stmts: Stmt[] = [];
  for (const id of a.ids) {
    const r = await one<Trx>(c.db, 'SELECT * FROM trx WHERE id = ?', [id]);
    if (!r) continue;
    if (r.date && closed.has(r.date.slice(0, 7))) throw new UserError(m(`الشهر ${r.date.slice(0, 7)} مغلق`, `Month ${r.date.slice(0, 7)} is closed`));
    stmts.push({ sql: 'UPDATE trx SET approved_at = ?, approved_by = ? WHERE id = ?', params: [at, c.who, id] }, auditStmt(c.who, 'approve', 'trx', id, null, null));
  }
  await c.db.batch(stmts);
  return a.ids.length;
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
  const allowed = t.to === mainId ? can(c, 'register.edit') || can(c, 'register.main') : keeps(c, t.to) || (can(c, 'register.edit') && !kept.includes(t.to!));
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
  out.push(...(await controlProblems(c, inMonth, lists)));
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

// ---------------------------------------------------------------- budget

/** A budget's current cells, for deciding which budget each expense belongs to. */
export interface BudgetBookRow { budget: Budget; cells: BudgetAmount[]; lumped: number[] }

export interface BudgetPayload {
  /** every budget, oldest first */
  budgets: Budget[];
  /** the budget shown, or null if none yet */
  budget: Budget | null;
  versions: BudgetVersion[];
  /** the current version (latest revision) of the budget shown */
  current: BudgetVersion | null;
  amounts: BudgetAmount[];
  items: BudgetItem[];
  accounts: BudgetAccount[];
  /** the original amounts, when the current budget is a revision */
  original: BudgetAmount[] | null;
  /** donor allocations: only for those who see the donors */
  allocs: BudgetAlloc[];
  /** all budgets with what they hold (overlapping budgets share the spending, first in first out) */
  books: BudgetBookRow[];
}

const latestOf = (c: OpCtx, budgetId: number) => one<BudgetVersion>(c.db, 'SELECT * FROM budget_version WHERE budget_id = ? ORDER BY rev DESC LIMIT 1', [budgetId]);

async function bookOf(c: OpCtx, b: Budget): Promise<BudgetBookRow> {
  const v = await latestOf(c, b.id);
  if (!v) return { budget: b, cells: [], lumped: [] };
  const amounts = await c.db.query<BudgetAmount>('SELECT * FROM budget_amount WHERE version_id = ?', [v.id]);
  const accounts = await c.db.query<BudgetAccount>('SELECT * FROM budget_account WHERE version_id = ?', [v.id]);
  return { budget: b, cells: cellsOf(amounts, accounts), lumped: accounts.filter((x) => x.lump_usd != null && x.lump_usd > 0).map((x) => x.account_id) };
}

/** One budget (by default: the one running this month, else the latest), and all the others for the shared spending. */
async function loadBudget(c: OpCtx, budgetId: number | null | undefined): Promise<BudgetPayload> {
  const budgets = await c.db.query<Budget>('SELECT * FROM budget ORDER BY start_ym, id');
  const now = nowIso().slice(0, 7);
  const budget = budgets.find((b) => b.id === budgetId)
    ?? (budgetId == null ? [...budgets].reverse().find((b) => now >= b.start_ym && now <= addMonths(b.start_ym, b.months - 1)) ?? budgets[budgets.length - 1] : undefined)
    ?? null;
  const versions = budget ? await c.db.query<BudgetVersion>('SELECT * FROM budget_version WHERE budget_id = ? ORDER BY rev', [budget.id]) : [];
  const current = versions[versions.length - 1] ?? null;
  const amountsOf = (id: number) => c.db.query<BudgetAmount>('SELECT * FROM budget_amount WHERE version_id = ?', [id]);
  const amounts = current ? await amountsOf(current.id) : [];
  const items = current ? await c.db.query<BudgetItem>('SELECT * FROM budget_item WHERE version_id = ? ORDER BY account_id, line_id, sort, id', [current.id]) : [];
  const accounts = current ? await c.db.query<BudgetAccount>('SELECT * FROM budget_account WHERE version_id = ?', [current.id]) : [];
  const original = current && current.rev > 0 ? await amountsOf(versions[0].id) : null;
  const allocs = budget && can(c, 'lists.donors') ? await c.db.query<BudgetAlloc>('SELECT * FROM budget_alloc WHERE budget_id = ? ORDER BY id', [budget.id]) : [];
  const books = await Promise.all(budgets.map((b) => bookOf(c, b)));
  return { budgets, budget, versions, current, amounts, items, accounts, original, allocs, books };
}

const goodRate = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const goodNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const goodYm = (x: unknown) => typeof x === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);

/** The latest revision of its budget: the only one that may still change. */
async function latestVersion(c: OpCtx, versionId: number): Promise<BudgetVersion> {
  const v = await one<BudgetVersion>(c.db, 'SELECT * FROM budget_version WHERE id = ?', [versionId]);
  if (!v) throw new UserError(m('الموازنة غير موجودة', 'Budget not found'));
  const last = await one<{ rev: number }>(c.db, 'SELECT MAX(rev) AS rev FROM budget_version WHERE budget_id = ?', [v.budget_id]);
  if (last && last.rev !== v.rev) throw new UserError(m('هذه نسخة سابقة: تُحفظ كما هي', 'This is an earlier version: it is kept as it was'));
  return v;
}
const budgetOfVersion = async (c: OpCtx, v: BudgetVersion) => (await one<Budget>(c.db, 'SELECT * FROM budget WHERE id = ?', [v.budget_id]))!;

// (budget_version.year holds the budget's number: (year, rev) is unique per budget)
const VID = '(SELECT id FROM budget_version WHERE budget_id = ? AND rev = ?)';

function itemStmts(budgetId: number, rev: number, items: BudgetItem[]): Stmt[] {
  return items.map((i, k) => ({
    sql: `INSERT INTO budget_item (version_id, account_id, line_id, name, unit, qty, times, unit_cost, note, sort) VALUES (${VID}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [budgetId, rev, i.account_id, i.line_id, i.name, i.unit ?? null, i.qty, i.times, i.unit_cost, i.note ?? null, i.sort ?? k],
  }));
}
function amountStmts(budgetId: number, rev: number, cells: { account_id: number; line_id: number; amount_usd: number }[]): Stmt[] {
  return cells.filter((x) => x.amount_usd > 0).map((x) => ({
    sql: `INSERT INTO budget_amount (version_id, account_id, line_id, amount_usd) VALUES (${VID}, ?, ?, ?)`,
    params: [budgetId, rev, x.account_id, x.line_id, Math.round(x.amount_usd * 100) / 100],
  }));
}

function checkItems(items: BudgetItem[]) {
  for (const i of items) {
    if (!String(i.name ?? '').trim()) throw new UserError(m('لكل عنصر اسم', 'Every item needs a name'));
    if (!goodNum(i.qty) || !goodNum(i.times) || !goodNum(i.unit_cost)) throw new UserError(m(`أرقام غير صحيحة في «${i.name}»`, `Wrong numbers in "${i.name}"`));
    if (!i.account_id || !i.line_id) throw new UserError(m(`اختر خط الموازنة لـ«${i.name}»`, `Choose the budget line for "${i.name}"`));
  }
}

interface CreateArgs {
  /** default: its dates ("2027", "Jul 2026 – Dec 2027") */
  name?: string | null;
  start_ym: string;
  months: number;
  rate_syp: number;
  rate_eur: number;
  /** empty; last = from the spending of the 12 months before; budget = from another budget, for this length */
  from: 'empty' | 'last' | 'budget';
  fromBudgetId?: number | null;
  scale?: boolean;
  pct?: number;
  /** the budget it continues: its leftover is carried over */
  carry_from_id?: number | null;
  note?: string | null;
}

async function checkPeriod(c: OpCtx, start_ym: unknown, months: unknown, carry: number | null | undefined, self: number | null) {
  if (!goodYm(start_ym)) throw new UserError(m('اختر شهر البداية', 'Choose the starting month'));
  if (!(Number.isInteger(months) && (months as number) >= 1 && (months as number) <= 36)) throw new UserError(m('عدد الأشهر بين 1 و36', 'The number of months is between 1 and 36'));
  if (carry != null) {
    if (carry === self) throw new UserError(m('لا تكمل الموازنة نفسها', 'A budget cannot continue itself'));
    const prev = await one<Budget>(c.db, 'SELECT * FROM budget WHERE id = ?', [carry]);
    if (!prev) throw new UserError(m('الموازنة السابقة غير موجودة', 'The earlier budget does not exist'));
    if (prev.start_ym > (start_ym as string)) throw new UserError(m('الموازنة التي تكملها يجب أن تبدأ قبلها', 'The budget it continues must start before it'));
  }
}

async function createBudget(c: OpCtx, a: CreateArgs) {
  await checkPeriod(c, a.start_ym, a.months, a.carry_from_id, null);
  if (!goodRate(a.rate_syp) || !goodRate(a.rate_eur)) throw new UserError(m('اكتب سعري التصريف التقديريين', 'Write both estimated exchange rates'));
  const id = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(id), 0) AS n FROM budget'))?.n ?? 0) + 1;
  const name = (a.name ?? '').trim() || defaultBudgetName(a.start_ym, a.months);
  let cells: { account_id: number; line_id: number; amount_usd: number }[] = [];
  let items: BudgetItem[] = [];
  let accounts: { account_id: number; contingency_pct: number; lump_usd: number | null }[] = [];
  if (a.from === 'last') {
    const lists = await loadLists(c.db);
    const rows = await loadTrx(c.db);
    cells = proposeFromSpending(rows, computeAll(rows, lists), a.start_ym, a.months, { scale: !!a.scale, pct: Number(a.pct) || 0 });
  } else if (a.from === 'budget') {
    const srcB = await one<Budget>(c.db, 'SELECT * FROM budget WHERE id = ?', [a.fromBudgetId ?? -1]);
    const src = srcB ? await latestOf(c, srcB.id) : null;
    if (!srcB || !src) throw new UserError(m('الموازنة المصدر غير موجودة', 'The budget to copy does not exist'));
    const f = a.months / srcB.months; // e.g. 6 months out of 12, or 18 out of 12
    items = prorateItems(await c.db.query<BudgetItem>('SELECT * FROM budget_item WHERE version_id = ?', [src.id]), 12 * f);
    const withItems = new Set(items.map((i) => `${i.account_id}|${i.line_id}`));
    const totals = totalsOf(items);
    cells = (await c.db.query<BudgetAmount>('SELECT * FROM budget_amount WHERE version_id = ?', [src.id])).map((x) => {
      const k = `${x.account_id}|${x.line_id}`;
      return { account_id: x.account_id, line_id: x.line_id, amount_usd: withItems.has(k) ? totals.get(k)! : x.amount_usd * f };
    });
    accounts = (await c.db.query<BudgetAccount>('SELECT account_id, contingency_pct, lump_usd FROM budget_account WHERE version_id = ?', [src.id]))
      .map((x) => ({ ...x, lump_usd: x.lump_usd != null ? Math.round(x.lump_usd * f * 100) / 100 : null }));
  }
  await c.db.batch([
    { sql: 'INSERT INTO budget (id, name, start_ym, months, carry_from_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [id, name, a.start_ym, a.months, a.carry_from_id ?? null, nowIso(), c.who] },
    { sql: 'INSERT INTO budget_version (year, budget_id, rev, rate_syp, rate_eur, start_month, months, note, created_at, created_by) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)', params: [id, id, a.rate_syp, a.rate_eur, Number(a.start_ym.slice(5, 7)), Math.min(12, a.months), a.note ?? null, nowIso(), c.who] },
    ...amountStmts(id, 0, cells),
    ...itemStmts(id, 0, items),
    ...accounts.map((x) => ({ sql: `INSERT INTO budget_account (version_id, account_id, contingency_pct, lump_usd) VALUES (${VID}, ?, ?, ?)`, params: [id, 0, x.account_id, x.contingency_pct, x.lump_usd] })),
    auditStmt(c.who, 'add', 'budget', String(id), null, { name, start_ym: a.start_ym, months: a.months, from: a.from, fromBudgetId: a.fromBudgetId ?? null, carry: a.carry_from_id ?? null, lines: cells.length, items: items.length }),
  ]);
  return id;
}

/** A budget's name, period, or the budget it continues. */
async function setBudgetPeriod(c: OpCtx, a: { budgetId: number; name?: string; start_ym?: string; months?: number; carry_from_id?: number | null }) {
  const b = await one<Budget>(c.db, 'SELECT * FROM budget WHERE id = ?', [a.budgetId]);
  if (!b) throw new UserError(m('الموازنة غير موجودة', 'Budget not found'));
  const next = { name: (a.name ?? b.name).trim() || defaultBudgetName(a.start_ym ?? b.start_ym, a.months ?? b.months), start_ym: a.start_ym ?? b.start_ym, months: a.months ?? b.months, carry_from_id: a.carry_from_id === undefined ? b.carry_from_id : a.carry_from_id };
  await checkPeriod(c, next.start_ym, next.months, next.carry_from_id, b.id);
  await c.db.batch([
    { sql: 'UPDATE budget SET name = ?, start_ym = ?, months = ?, carry_from_id = ? WHERE id = ?', params: [next.name, next.start_ym, next.months, next.carry_from_id, b.id] },
    auditStmt(c.who, 'edit', 'budget', String(b.id), b, next),
  ]);
}

async function reviseBudget(c: OpCtx, a: { budgetId: number; note?: string | null }) {
  const last = await latestOf(c, a.budgetId);
  if (!last) throw new UserError(m('لا موازنة', 'No budget'));
  const rev = last.rev + 1;
  const B = a.budgetId;
  await c.db.batch([
    { sql: 'INSERT INTO budget_version (year, budget_id, rev, rate_syp, rate_eur, start_month, months, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, 1, 12, ?, ?, ?)', params: [B, B, rev, last.rate_syp, last.rate_eur, a.note ?? null, nowIso(), c.who] },
    { sql: `INSERT INTO budget_amount (version_id, account_id, line_id, amount_usd) SELECT ${VID}, account_id, line_id, amount_usd FROM budget_amount WHERE version_id = ?`, params: [B, rev, last.id] },
    { sql: `INSERT INTO budget_item (version_id, account_id, line_id, name, unit, qty, times, unit_cost, note, sort) SELECT ${VID}, account_id, line_id, name, unit, qty, times, unit_cost, note, sort FROM budget_item WHERE version_id = ?`, params: [B, rev, last.id] },
    { sql: `INSERT INTO budget_account (version_id, account_id, contingency_pct, lump_usd) SELECT ${VID}, account_id, contingency_pct, lump_usd FROM budget_account WHERE version_id = ?`, params: [B, rev, last.id] },
    auditStmt(c.who, 'revise', 'budget_version', String(B), { rev: last.rev }, { rev, note: a.note ?? null }),
  ]);
}

/** An account budgeted as one amount has no line amounts. */
async function refuseIfWhole(c: OpCtx, versionId: number, accountIds: number[]) {
  for (const id of new Set(accountIds))
    if (await one(c.db, 'SELECT 1 FROM budget_account WHERE version_id = ? AND account_id = ? AND lump_usd IS NOT NULL', [versionId, id]))
      throw new UserError(m('لهذا الحساب مبلغ واحد لكل مصاريفه: ألغِه أولاً لتكتب حسب الخطوط', 'This account has one amount for all its spending: remove it first to budget line by line'));
}

/** Amounts typed directly (lines without items). */
async function saveBudgetAmounts(c: OpCtx, a: { versionId: number; cells: { account_id: number; line_id: number; amount_usd: number }[] }) {
  const v = await latestVersion(c, a.versionId);
  await refuseIfWhole(c, v.id, a.cells.map((x) => x.account_id));
  const stmts: Stmt[] = [];
  for (const x of a.cells) {
    const usd = Number(x.amount_usd);
    if (!Number.isFinite(usd) || usd < 0) throw new UserError(m('مبلغ غير صحيح', 'Wrong amount'));
    if (await one(c.db, 'SELECT 1 FROM budget_item WHERE version_id = ? AND account_id = ? AND line_id = ?', [v.id, x.account_id, x.line_id]))
      throw new UserError(m('لهذا الخط عناصر: عدّل العناصر', 'This line has items: change the items'));
    stmts.push(usd === 0
      ? { sql: 'DELETE FROM budget_amount WHERE version_id = ? AND account_id = ? AND line_id = ?', params: [v.id, x.account_id, x.line_id] }
      : { sql: 'INSERT INTO budget_amount (version_id, account_id, line_id, amount_usd) VALUES (?, ?, ?, ?) ON CONFLICT (version_id, account_id, line_id) DO UPDATE SET amount_usd = excluded.amount_usd', params: [v.id, x.account_id, x.line_id, usd] });
  }
  stmts.push(auditStmt(c.who, 'edit', 'budget_amount', `${v.budget_id}/${v.rev}`, null, a.cells));
  await c.db.batch(stmts);
}

/** The items of one line (account + line): replaced, and the line's amount = their total. */
async function saveBudgetItems(c: OpCtx, a: { versionId: number; account_id: number; line_id: number; items: BudgetItem[] }) {
  const v = await latestVersion(c, a.versionId);
  await refuseIfWhole(c, v.id, [a.account_id]);
  const items = a.items.map((i) => ({ ...i, account_id: a.account_id, line_id: a.line_id }));
  checkItems(items);
  const total = items.reduce((s, i) => s + itemTotal(i), 0);
  const before = await c.db.query('SELECT * FROM budget_item WHERE version_id = ? AND account_id = ? AND line_id = ?', [v.id, a.account_id, a.line_id]);
  await c.db.batch([
    { sql: 'DELETE FROM budget_item WHERE version_id = ? AND account_id = ? AND line_id = ?', params: [v.id, a.account_id, a.line_id] },
    { sql: 'DELETE FROM budget_amount WHERE version_id = ? AND account_id = ? AND line_id = ?', params: [v.id, a.account_id, a.line_id] },
    ...itemStmts(v.budget_id, v.rev, items),
    ...amountStmts(v.budget_id, v.rev, [{ account_id: a.account_id, line_id: a.line_id, amount_usd: total }]),
    auditStmt(c.who, 'edit', 'budget_item', `${v.budget_id}/${v.rev}/${a.account_id}/${a.line_id}`, before, items),
  ]);
}

/** A whole account from a budget sheet (e.g. "Homs 2027"): its items replace what the account had. */
async function importBudgetItems(c: OpCtx, a: { versionId: number; account_id: number; contingency_pct: number; items: (BudgetItem & { new_line?: { heading_id: number; name: string } })[]; source?: string }) {
  const v = await latestVersion(c, a.versionId);
  // an item whose line does not exist yet: the line is added to the lists (same heading), to match the budget's wording
  for (const i of a.items) {
    if (i.line_id || !i.new_line) continue;
    need(c, 'lists.manage');
    const name = i.new_line.name.trim();
    let line = await one<{ id: number }>(c.db, 'SELECT id FROM budget_line WHERE heading_id = ? AND name = ?', [i.new_line.heading_id, name]);
    if (!line) {
      await addLine(c.db, i.new_line.heading_id, name, c.who);
      line = await one<{ id: number }>(c.db, 'SELECT id FROM budget_line WHERE heading_id = ? AND name = ?', [i.new_line.heading_id, name]);
    }
    i.line_id = line!.id;
  }
  const items = a.items.map(({ new_line: _, ...i }) => ({ ...i, account_id: a.account_id }));
  checkItems(items);
  if (!goodNum(a.contingency_pct) || a.contingency_pct > 100) throw new UserError(m('نسبة الاحتياط غير صحيحة', 'Wrong contingency percentage'));
  const totals = totalsOf(items);
  await c.db.batch([
    { sql: 'DELETE FROM budget_item WHERE version_id = ? AND account_id = ?', params: [v.id, a.account_id] },
    { sql: 'DELETE FROM budget_amount WHERE version_id = ? AND account_id = ?', params: [v.id, a.account_id] },
    ...itemStmts(v.budget_id, v.rev, items),
    ...amountStmts(v.budget_id, v.rev, [...totals].map(([k, amount_usd]) => {
      const [account_id, line_id] = k.split('|').map(Number);
      return { account_id, line_id, amount_usd };
    })),
    { sql: 'INSERT INTO budget_account (version_id, account_id, contingency_pct) VALUES (?, ?, ?) ON CONFLICT (version_id, account_id) DO UPDATE SET contingency_pct = excluded.contingency_pct, lump_usd = NULL', params: [v.id, a.account_id, a.contingency_pct] },
    auditStmt(c.who, 'import', 'budget_item', `${v.budget_id}/${v.rev}/${a.account_id}`, null, { source: a.source ?? null, items: items.length, contingency: a.contingency_pct }),
  ]);
  return items.length;
}

/** An account's budget = what was really spent on it during the budget's period (e.g. furniture already bought). */
async function fillFromActual(c: OpCtx, a: { versionId: number; account_id: number }) {
  const v = await latestVersion(c, a.versionId);
  const lists = await loadLists(c.db);
  const rows = await loadTrx(c.db);
  const b = await budgetOfVersion(c, v);
  const { spent } = spentInRange(rows, computeAll(rows, lists), b.start_ym, periodEnd(b));
  const cells = [...spent].filter(([k, x]) => x > 0 && Number(k.split('|')[0]) === a.account_id).map(([k, amount_usd]) => ({ account_id: a.account_id, line_id: Number(k.split('|')[1]), amount_usd: Math.round(amount_usd) }));
  await c.db.batch([
    { sql: 'DELETE FROM budget_item WHERE version_id = ? AND account_id = ?', params: [v.id, a.account_id] },
    { sql: 'DELETE FROM budget_amount WHERE version_id = ? AND account_id = ?', params: [v.id, a.account_id] },
    ...amountStmts(v.budget_id, v.rev, cells),
    { sql: 'UPDATE budget_account SET lump_usd = NULL WHERE version_id = ? AND account_id = ?', params: [v.id, a.account_id] },
    auditStmt(c.who, 'fill-actual', 'budget_amount', `${v.budget_id}/${v.rev}/${a.account_id}`, null, cells),
  ]);
  return cells.length;
}

// ---------------------------------------------------------------- grants: following the money

const STEP_DATE: Record<GrantStep, keyof GrantCard> = { promised: 'promised_on', approved: 'approved_on', transferred: 'transferred_on', bank: 'bank_on', hand: 'hand_on' };
const goodDate = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

/** A grant: donor, amount (USD or EUR), what it is for. A new one starts "promised" today. */
async function saveGrant(c: OpCtx, a: { id?: string; donor_id: number; amount: number; currency: 'USD' | 'EUR'; reference?: string | null; note?: string | null; parts: { account_id: number | null; amount: number }[]; promised_on?: string | null }) {
  if (!a.donor_id) throw new UserError(m('اختر المانح', 'Choose the donor'));
  if (!(a.amount > 0)) throw new UserError(m('مبلغ غير صحيح', 'Wrong amount'));
  if (a.currency !== 'USD' && a.currency !== 'EUR') throw new UserError(m('دولار أو يورو', 'USD or EUR'));
  const parts = (a.parts ?? []).filter((p) => p.amount > 0);
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  if (parts.length && Math.abs(sum - a.amount) > 0.01) throw new UserError(m(`مجموع الحسابات (${sum}) لا يساوي المبلغ (${a.amount})`, `The accounts add up to ${sum}, not ${a.amount}`));
  const id = a.id ?? uuid();
  const before = a.id ? await one<GrantCard>(c.db, 'SELECT * FROM grant_card WHERE id = ?', [a.id]) : null;
  if (a.id && !before) throw new UserError(m('المنحة غير موجودة', 'Grant not found'));
  const finalParts = parts.length ? parts : [{ account_id: null, amount: a.amount }];
  await c.db.batch([
    before
      ? { sql: 'UPDATE grant_card SET donor_id = ?, amount = ?, currency = ?, reference = ?, note = ? WHERE id = ?', params: [a.donor_id, a.amount, a.currency, a.reference ?? null, a.note ?? null, id] }
      : { sql: "INSERT INTO grant_card (id, donor_id, amount, currency, reference, note, status, promised_on, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'promised', ?, ?, ?)", params: [id, a.donor_id, a.amount, a.currency, a.reference ?? null, a.note ?? null, a.promised_on ?? nowIso().slice(0, 10), nowIso(), c.who] },
    { sql: 'DELETE FROM grant_part WHERE grant_id = ?', params: [id] },
    ...finalParts.map((p) => ({ sql: 'INSERT INTO grant_part (grant_id, account_id, amount) VALUES (?, ?, ?)', params: [id, p.account_id ?? null, p.amount] })),
    auditStmt(c.who, before ? 'edit' : 'add', 'grant_card', id, before, { ...a, parts: finalParts }),
  ]);
  return id;
}

/** The book where grants arrive in hand: the Respo book (private). */
async function grantsBook(c: OpCtx, lists: Lists): Promise<Book> {
  const set = await getMeta(c.db, 'grants_book_id');
  const byId = (id: number | null | undefined) => lists.books.find((b) => b.id === id && b.active);
  const book = byId(set ? Number(set) : null)
    ?? lists.books.find((b) => b.private && b.active && keeps(c, b.id))
    ?? lists.books.find((b) => b.private && b.active);
  if (!book) throw new UserError(m('لا دفتر خاص للرئيس: اجعل دفتره «خاصاً» في القوائم ← الدفاتر', "No private book for the Superior: make his book \"private\" in Lists → Books"));
  return book;
}

/**
 * A grant moves to a step (forward or back), with its date. "In hand": the dollars
 * received become an income in the Superior's book, linked to the grant; leaving
 * "in hand" removes it (while nothing was transferred from it and the month is open).
 */
async function stepGrant(c: OpCtx, a: { id: string; status: GrantStep; date: string; hand_usd?: number | null }) {
  const g = await one<GrantCard>(c.db, 'SELECT * FROM grant_card WHERE id = ?', [a.id]);
  if (!g) throw new UserError(m('المنحة غير موجودة', 'Grant not found'));
  if (!GRANT_STEPS.includes(a.status)) throw new UserError(m('مرحلة غير صحيحة', 'Wrong step'));
  if (!goodDate(a.date)) throw new UserError(m('اختر التاريخ', 'Choose the date'));
  const closed = await closedMonths(c.db);
  const stmts: Stmt[] = [];
  const income = await one<Trx>(c.db, "SELECT * FROM trx WHERE grant_id = ? AND type = 'Income'", [g.id]);
  const lists = await loadLists(c.db);
  if (a.status === 'hand') {
    if (!(Number(a.hand_usd) > 0)) throw new UserError(m('اكتب الدولارات المستلمة باليد', 'Write the dollars received in hand'));
    if (closed.has(a.date.slice(0, 7)) || (income?.date && closed.has(income.date.slice(0, 7)))) throw new UserError(m('الشهر مغلق', 'The month is closed'));
    const book = await grantsBook(c, lists);
    const parts = await c.db.query<GrantPart>('SELECT * FROM grant_part WHERE grant_id = ?', [g.id]);
    const accounts = [...new Set(parts.map((p) => p.account_id).filter((x): x is number => x != null))];
    const incomeHeading = lists.headings.find((h) => lists.headingTypes.some((t) => t.heading_id === h.id && t.type === 'Income'));
    const line = lists.lines.find((l) => l.heading_id === incomeHeading?.id && l.active && /donation|grant|منحة|تبرع/i.test(l.name))
      ?? lists.lines.find((l) => l.heading_id === incomeHeading?.id && l.active);
    if (!incomeHeading || !line) throw new UserError(m('لا خط إيرادات: أضف خطاً «Donation» تحت بند الإيرادات', 'No income line: add a "Donation" line under the Income heading'));
    const donor = lists.donors.find((d) => d.id === g.donor_id)?.name ?? '';
    const row: Trx = {
      ...(income ?? blankTrx()), type: 'Income', date: a.date, book_id: book.id,
      account_id: (accounts.length === 1 ? accounts[0] : null) ?? lists.settings.def_account_id ?? book.account_id ?? lists.accounts[0]?.id ?? null,
      city_id: book.city_id ?? lists.settings.def_city_id ?? lists.cities[0]?.id ?? null,
      heading_id: incomeHeading.id, line_id: line.id, inc_usd: Number(a.hand_usd), inc_syp: 0,
      explanation: `${t2('منحة', 'Grant')} ${donor}${g.reference ? ` · ${g.reference}` : ''}`, grant_id: g.id,
    };
    await saveTrxRows(c.db, [row], c.who, c.install === 'office', [], income ? 'grant: in hand changed' : null);
    stmts.push({ sql: 'UPDATE grant_card SET status = ?, hand_on = ?, hand_usd = ? WHERE id = ?', params: ['hand', a.date, Number(a.hand_usd), g.id] });
  } else {
    if (income) {
      if (await one(c.db, "SELECT 1 FROM trx WHERE grant_id = ? AND type = 'Transfer'", [g.id])) throw new UserError(m('حُوّل من هذه المنحة: تبقى «باليد»', 'Money from this grant was transferred: it stays "in hand"'));
      if (income.date && closed.has(income.date.slice(0, 7))) throw new UserError(m('الشهر مغلق', 'The month is closed'));
      stmts.push({ sql: 'DELETE FROM trx WHERE id = ?', params: [income.id] }, auditStmt(c.who, 'delete', 'trx', income.id, income, { reason: 'grant no longer in hand' }));
    }
    stmts.push({ sql: `UPDATE grant_card SET status = ?, ${STEP_DATE[a.status]} = ?, hand_usd = CASE WHEN ? = 'hand' THEN hand_usd ELSE NULL END, hand_on = CASE WHEN ? = 'hand' THEN hand_on ELSE NULL END WHERE id = ?`, params: [a.status, a.date, a.status, a.status, g.id] });
  }
  stmts.push(auditStmt(c.who, 'step', 'grant_card', g.id, { status: g.status }, { status: a.status, date: a.date, hand_usd: a.hand_usd ?? null }));
  await c.db.batch(stmts);
}
const t2 = (ar: string, en: string) => `${en} · ${ar}`;

const STATUSES: AllocStatus[] = ['requested', 'promised', 'received'];

async function saveAlloc(c: OpCtx, a: Partial<BudgetAlloc> & { budget_id: number; donor_id: number; account_id: number | null; status: AllocStatus }) {
  const b = await one<Budget>(c.db, 'SELECT * FROM budget WHERE id = ?', [a.budget_id]);
  if (!b) throw new UserError(m('اختر الموازنة', 'Choose the budget'));
  const pct = a.pct ?? null;
  const amount = a.amount_usd ?? null;
  const rest = a.rest ? 1 : 0;
  if ((pct != null ? 1 : 0) + (amount != null ? 1 : 0) + rest !== 1) throw new UserError(m('اكتب نسبة أو مبلغاً أو «الباقي»', 'Write a percentage, an amount, or "the rest"'));
  if (pct != null && !(pct > 0 && pct <= 100)) throw new UserError(m('النسبة بين 1 و100', 'The percentage is between 1 and 100'));
  if (amount != null && !(amount > 0)) throw new UserError(m('مبلغ غير صحيح', 'Wrong amount'));
  if (!STATUSES.includes(a.status)) throw new UserError(m('حالة غير صحيحة', 'Wrong status'));
  if (!a.donor_id) throw new UserError(m('اختر المانح', 'Choose the donor'));
  let heading = a.heading_id ?? null;
  const line = a.line_id ?? null;
  if (a.account_id == null && (heading != null || line != null)) throw new UserError(m('اختر الحساب', 'Choose the account'));
  if (line != null) heading = (await one<{ heading_id: number }>(c.db, 'SELECT heading_id FROM budget_line WHERE id = ?', [line]))?.heading_id ?? null;
  // (year: the budget's first year, kept for the record; the link is budget_id)
  const vals = [Number(b.start_ym.slice(0, 4)), b.id, a.donor_id, a.account_id ?? null, heading, line, pct, amount, rest, a.status, a.note ?? null];
  await c.db.batch([
    a.id
      ? { sql: 'UPDATE budget_alloc SET year = ?, budget_id = ?, donor_id = ?, account_id = ?, heading_id = ?, line_id = ?, pct = ?, amount_usd = ?, rest = ?, status = ?, note = ? WHERE id = ?', params: [...vals, a.id] }
      : { sql: 'INSERT INTO budget_alloc (year, budget_id, donor_id, account_id, heading_id, line_id, pct, amount_usd, rest, status, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', params: vals },
    auditStmt(c.who, a.id ? 'edit' : 'add', 'budget_alloc', a.id ? String(a.id) : null, null, a),
  ]);
}

// ---------------------------------------------------------------- attached documents

const MAX_DOC = 15 * 1024 * 1024;
const DOC_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** May this person see (and, with write, change) the documents of this row? Same rules as the row itself. */
async function docRights(c: OpCtx, trxId: string, write: boolean): Promise<Trx> {
  const r = await one<Trx>(c.db, 'SELECT * FROM trx WHERE id = ?', [trxId]);
  if (!r) throw new UserError(m('السطر غير موجود', 'Row not found'));
  if (!can(c, 'register.view') && !keeps(c, r.book_id)) throw refuse();
  if (!write) return r;
  const month = ym(r.date);
  if (month && (await closedMonths(c.db)).has(month)) throw new UserError(m(`الشهر ${month} مغلق`, `Month ${month} is closed`));
  if (!can(c, 'register.edit')) {
    need(c, 'book.own', 'register.main');
    if (!writes(c, r.book_id, await mainOf(c.db))) throw refuse();
    if ((await bookMonths(c.db)).some((b) => b.book_id === r.book_id && b.ym === month))
      throw new UserError(m('أغلقتَ هذا الشهر لدفترك', 'You closed this month for your book'));
  }
  return r;
}

const bytesToB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Stores a document under the row's Bill_Code (e.g. E03.5-751-0826_N0587.pdf). */
async function addDocument(c: OpCtx, a: { trxId: string; base64: string; mime: string }) {
  const r = await docRights(c, a.trxId, true);
  const ext = DOC_TYPES[a.mime];
  if (!ext) throw new UserError(m('نوع الملف غير مقبول (PDF أو صورة)', 'File type not accepted (PDF or picture)'));
  const bytes = b64ToBytes(a.base64);
  if (bytes.length > MAX_DOC) throw new UserError(m('الملف أكبر من 15 م.ب', 'The file is larger than 15 MB'));
  const lists = await loadLists(c.db);
  const code = lists.lines.find((l) => l.id === r.line_id)?.code ?? '';
  const month = r.date ? Number(r.date.slice(5, 7)) : null;
  const year = r.date ? Number(r.date.slice(0, 4)) : null;
  const base = `${billCode(r, code, month, year)}${r.n != null ? `_N${String(r.n).padStart(4, '0')}` : ''}`.replace(/[^\w.-]/g, '_');
  const folder = year ? String(year) : 'undated';
  let rel = `${folder}/${base}.${ext}`;
  for (let i = 2; await c.files.docExists(rel); i++) rel = `${folder}/${base}-${i}.${ext}`;
  await c.files.docWrite(rel, bytes);
  const id = uuid();
  const name = rel.split('/').pop()!;
  await c.db.batch([
    { sql: 'INSERT INTO attachment (id, trx_id, file, name, mime, size, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)', params: [id, r.id, rel, name, a.mime, bytes.length, nowIso(), c.who] },
    auditStmt(c.who, 'attach', 'trx', r.id, null, { name, size: bytes.length }),
  ]);
  return { id, name };
}

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
      stmts.push({ sql: 'UPDATE profile SET pin_salt = ?, pin_hash = ?, must_change = ? WHERE id = ?', params: [salt, await hashSecret(salt, a.pin), id === c.profile.id ? 0 : 1, id] });
    }
  } else {
    if (!a.pin) throw new UserError(m('كلمة السر مطلوبة', 'A password is required'));
    checkSecretShape(a.pin);
    id = ((await one<{ m: number | null }>(c.db, 'SELECT MAX(id) AS m FROM profile'))?.m ?? 0) + 1;
    const salt = crypto.randomUUID();
    stmts.push({
      sql: 'INSERT INTO profile (id, name, role, pin_salt, pin_hash, book_id, access_id, must_change) VALUES (?,?,?,?,?,?,?,1)',
      params: [id, name, role, salt, await hashSecret(salt, a.pin), books[0] ?? null, a.access_id],
    });
  }
  stmts.push({ sql: 'DELETE FROM user_book WHERE profile_id = ?', params: [id] });
  for (const b of books) stmts.push({ sql: 'INSERT INTO user_book (profile_id, book_id) VALUES (?, ?)', params: [id, b] });
  stmts.push(auditStmt(c.who, a.id ? 'edit' : 'add', 'profile', String(id), null, { name, access_id: a.access_id, books }));
  await c.db.batch(stmts);
  await keepAManager(c);
}

/**
 * One account for every active book that nobody keeps yet: the keeper's name, his book,
 * the "Book holder" profile, and a temporary password he must change at first login.
 * The temporary passwords are returned ONCE, for the Superior to hand out.
 */
async function createKeepers(c: OpCtx): Promise<{ name: string; book: string; password: string }[]> {
  const lists = await loadLists(c.db);
  const kept = new Set((await c.db.query<{ book_id: number }>('SELECT ub.book_id FROM user_book ub JOIN profile p ON p.id = ub.profile_id WHERE p.active = 1')).map((r) => r.book_id));
  const holderProfile =
    (await accessList(c)).find((a) => a.perms.includes('book.own') && !a.perms.includes('register.view')) ??
    (() => {
      throw new UserError(m('لا ملف صلاحيات «أمين صندوق»', 'No "Book holder" permission profile'));
    })();
  const taken = new Set((await c.db.query<{ name: string }>('SELECT name FROM profile WHERE active = 1')).map((r) => r.name.toLowerCase()));
  const out: { name: string; book: string; password: string }[] = [];
  for (const b of lists.books.filter((x) => x.active && !x.is_main && !kept.has(x.id))) {
    let name = (b.keeper_name || b.name).trim();
    if (taken.has(name.toLowerCase())) name = `${name} (${b.name})`;
    taken.add(name.toLowerCase());
    // 6 digits, easy to read aloud or write on paper
    const password = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    await saveUser(c, { name, access_id: holderProfile.id, books: [b.id], pin: password });
    out.push({ name, book: b.name, password });
  }
  return out;
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
  // the community databases (Jesuit communities): src/community/ops.ts
  ...CTY_OPS,
  // the country econome's database: src/community/country.ts
  ...COUNTRY_OPS,
  // ---------------------------------------------------------------- reading
  data: { check: anyone, run: (c: OpCtx) => loadData(c) },
  'cash.counts': {
    check: anyone,
    run: async (c: OpCtx) => {
      const rows = await c.db.query<CashCountRow>('SELECT * FROM cash_count');
      const priv = new Set((await c.db.query<{ id: number }>('SELECT id FROM book WHERE private = 1')).map((x) => x.id));
      const mayAll = can(c, 'reports.cash') || can(c, 'register.edit');
      return rows.filter((r) => keeps(c, r.book_id) || (mayAll && !priv.has(r.book_id)));
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
  'trx.save': { check: (c: OpCtx) => need(c, 'register.edit', 'register.main', 'book.own'), run: (c: OpCtx, a: { rows: Trx[]; deletes?: string[]; reason?: string | null }) => saveRows(c, { rows: a.rows, deletes: a.deletes, reason: a.reason }) },
  'trx.delete': { check: (c: OpCtx) => need(c, 'register.edit', 'register.main', 'book.own'), run: (c: OpCtx, a: { ids: string[]; reason?: string | null }) => saveRows(c, { rows: [], deletes: a.ids, reason: a.reason }) },
  'trx.approve': { check: anyone, run: (c: OpCtx, a: { ids: string[] }) => approveRows(c, a) },
  'transfer.answer': {
    check: (c: OpCtx) => need(c, 'register.edit', 'register.main', 'book.own'),
    run: (c: OpCtx, a: { id: string; ok: boolean; note?: string | null }) => answerTransfer(c, a),
  },

  // ---------------------------------------------------------------- the look of this database
  'brand.get': {
    check: anyone,
    run: async (c: OpCtx) => ({
      organisation: (await getMeta(c.db, 'organisation')) ?? '',
      centre: (await getMeta(c.db, 'centre')) ?? 'other',
      color: await getMeta(c.db, 'brand_color'),
      logo: await getMeta(c.db, 'brand_logo'),
    }),
  },
  'brand.save': {
    check: (c: OpCtx) => need(c, 'users.manage'),
    run: async (c: OpCtx, a: { organisation: string; centre: string; color: string | null; logo: string | null }) => {
      const name = a.organisation.trim();
      if (!name) throw new UserError(m('الاسم فارغ', 'The name is empty'));
      if (a.color && !/^#[0-9a-f]{6}$/i.test(a.color)) throw new UserError(m('لون غير صالح', 'Invalid colour'));
      if (a.logo && (!a.logo.startsWith('data:image/png;base64,') || a.logo.length > 400_000)) throw new UserError(m('شعار غير صالح', 'Invalid logo'));
      await c.db.batch([
        setMetaStmt('organisation', name), setMetaStmt('centre', a.centre), setMetaStmt('brand_color', a.color), setMetaStmt('brand_logo', a.logo),
        auditStmt(c.who, 'edit', 'meta', 'brand', null, { organisation: name, centre: a.centre, color: a.color, logo: a.logo ? 'yes' : 'no' }),
      ]);
    },
  },

  // ---------------------------------------------------------------- attached documents
  'doc.add': { check: (c: OpCtx) => need(c, 'register.edit', 'register.main', 'book.own'), run: (c: OpCtx, a: { trxId: string; base64: string; mime: string }) => addDocument(c, a) },
  'doc.get': {
    check: anyone,
    run: async (c: OpCtx, a: { id: string }) => {
      const d = await one<{ trx_id: string; file: string; name: string; mime: string }>(c.db, 'SELECT trx_id, file, name, mime FROM attachment WHERE id = ? AND deleted_at IS NULL', [a.id]);
      if (!d) throw new UserError(m('الملف غير موجود', 'Document not found'));
      await docRights(c, d.trx_id, false);
      return { name: d.name, mime: d.mime, base64: bytesToB64(await c.files.docRead(d.file)) };
    },
  },
  'doc.delete': {
    check: (c: OpCtx) => need(c, 'register.edit', 'register.main', 'book.own'),
    run: async (c: OpCtx, a: { id: string }) => {
      const d = await one<{ trx_id: string; name: string }>(c.db, 'SELECT trx_id, name FROM attachment WHERE id = ? AND deleted_at IS NULL', [a.id]);
      if (!d) throw new UserError(m('الملف غير موجود', 'Document not found'));
      await docRights(c, d.trx_id, true);
      // the file stays on disk: only marked as removed, and the audit says by whom
      await c.db.batch([
        { sql: 'UPDATE attachment SET deleted_at = ?, deleted_by = ? WHERE id = ?', params: [nowIso(), c.who, a.id] },
        auditStmt(c.who, 'detach', 'trx', d.trx_id, { name: d.name }, null),
      ]);
    },
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
  'settings.save': {
    check: (c: OpCtx) => need(c, 'lists.manage', 'users.manage'),
    run: (c: OpCtx, a: Partial<Settings>) => {
      // the controls (documents, approval) are the Superior's; the rest is the lists'
      if (Object.keys(a).some((k) => CONTROL_KEYS.includes(k))) need(c, 'users.manage');
      if (Object.keys(a).some((k) => !CONTROL_KEYS.includes(k))) need(c, 'lists.manage');
      if (a.approval_profile_id !== undefined && a.approval_profile_id !== null && !Number.isInteger(a.approval_profile_id)) throw new UserError(m('اختر من يوافق', 'Choose who approves'));
      for (const k of ['doc_required_usd', 'approval_usd'] as const) if (a[k] !== undefined && !(Number(a[k]) >= 0)) throw new UserError(m('مبلغ غير صحيح', 'Wrong amount'));
      // switching a rule on: it starts now (the past is not asked for again)
      return (async () => {
        const cur = (await loadLists(c.db)).settings;
        const b = { ...a };
        delete b.doc_since;
        delete b.approval_since;
        if (b.approval_on && !cur.approval_on) b.approval_since = nowIso();
        if (b.doc_required_usd != null && b.doc_required_usd > 0 && !(cur.doc_required_usd > 0)) b.doc_since = nowIso();
        return saveSettings(c.db, b, c.who);
      })();
    },
  },

  // ---------------------------------------------------------------- cash
  'cash.saveCount': {
    check: anyone,
    run: async (c: OpCtx, a: { bookId: number; counts: { currency: 'SYP' | 'USD'; denomination: number; qty: number }[] }) => {
      if (!writes(c, a.bookId, await mainOf(c.db))) need(c, 'register.edit');
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
  'grant.save': { check: (c: OpCtx) => need(c, 'lists.donors'), run: (c: OpCtx, a: Parameters<typeof saveGrant>[1]) => saveGrant(c, a) },
  'grant.step': { check: (c: OpCtx) => need(c, 'lists.donors'), run: (c: OpCtx, a: Parameters<typeof stepGrant>[1]) => stepGrant(c, a) },
  'grant.delete': {
    check: (c: OpCtx) => need(c, 'lists.donors'),
    run: async (c: OpCtx, a: { id: string }) => {
      const g = await one<GrantCard>(c.db, 'SELECT * FROM grant_card WHERE id = ?', [a.id]);
      if (!g) return;
      if (await one(c.db, "SELECT 1 FROM trx WHERE grant_id = ? AND type = 'Transfer'", [a.id])) throw new UserError(m('حُوّل من هذه المنحة: لا تُحذف', 'Money from this grant was transferred: it cannot be deleted'));
      const income = await one<Trx>(c.db, "SELECT * FROM trx WHERE grant_id = ? AND type = 'Income'", [a.id]);
      if (income?.date && (await closedMonths(c.db)).has(income.date.slice(0, 7))) throw new UserError(m('الشهر مغلق', 'The month is closed'));
      await c.db.batch([
        ...(income ? [{ sql: 'DELETE FROM trx WHERE id = ?', params: [income.id] }, auditStmt(c.who, 'delete', 'trx', income.id, income, { reason: 'grant deleted' })] : []),
        { sql: 'DELETE FROM grant_part WHERE grant_id = ?', params: [a.id] },
        { sql: 'DELETE FROM grant_card WHERE id = ?', params: [a.id] },
        auditStmt(c.who, 'delete', 'grant_card', a.id, g, null),
      ]);
    },
  },

  // ---------------------------------------------------------------- months: step 1 (book), step 2 (office)
  'bookMonth.close': {
    check: anyone,
    /** The cash is counted at closing; a difference with the book must be explained. */
    run: async (c: OpCtx, a: { bookId: number; ym: string; counted_syp?: number | null; counted_usd?: number | null; note?: string | null }) => {
      if (!keeps(c, a.bookId)) need(c, 'month.close'); // the office may close a book for its keeper
      if (!keeps(c, a.bookId) && !can(c, 'register.edit') && !can(c, 'register.view')) throw refuse();
      if ((await closedMonths(c.db)).has(a.ym)) throw new UserError(m('الشهر مغلق مسبقاً', 'The month is already closed'));
      throwIf(await closingProblems(c, a.ym, a.bookId));
      const ok = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
      if (!ok(a.counted_syp) || !ok(a.counted_usd)) throw new UserError(m('عُدّ النقد أولاً: الليرة والدولار', 'Count the cash first: pounds and dollars'));
      const lists = await loadLists(c.db);
      const bal = balanceAt(await loadTrx(c.db), lists.books, a.bookId, a.ym);
      const note = (a.note ?? '').trim() || null;
      const differs = Math.abs(a.counted_syp! - bal.syp) >= 0.5 || Math.abs(a.counted_usd! - bal.usd) >= 0.005;
      if (differs && !note) throw new UserError(m('النقد المعدود يختلف عن الدفتر: اكتب السبب', 'The cash counted differs from the book: write why'));
      await c.db.batch([
        {
          sql: 'INSERT OR IGNORE INTO book_month (book_id, ym, closed_at, closed_by, book_syp, book_usd, counted_syp, counted_usd, count_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          params: [a.bookId, a.ym, nowIso(), c.who, bal.syp, bal.usd, a.counted_syp!, a.counted_usd!, note],
        },
        auditStmt(c.who, 'close', 'book_month', `${a.bookId}|${a.ym}`, null, { book: bal, counted: { syp: a.counted_syp, usd: a.counted_usd }, note }),
      ]);
    },
  },
  /** What a book should hold at the end of a month (to compare with the cash counted). */
  'bookMonth.balance': {
    check: anyone,
    run: async (c: OpCtx, a: { bookId: number; ym: string }) => {
      if (!keeps(c, a.bookId)) need(c, 'register.view', 'month.close');
      const lists = await loadLists(c.db);
      return balanceAt(await loadTrx(c.db), lists.books, a.bookId, a.ym);
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
  /** A year is closed once every month that has rows is closed; nothing of it changes any more. */
  'year.close': {
    check: (c: OpCtx) => need(c, 'month.close'),
    run: async (c: OpCtx, a: { year: number }) => {
      const thisYear = Number(nowIso().slice(0, 4));
      if (!(a.year < thisYear)) throw new UserError(m('تُغلق السنة بعد انتهائها', 'A year is closed once it is over'));
      const closed = await closedMonths(c.db);
      const months = [...new Set((await loadTrx(c.db)).filter((r) => r.date?.startsWith(String(a.year))).map((r) => r.date!.slice(0, 7)))].sort();
      const open = months.filter((x) => !closed.has(x));
      if (open.length) throw new UserError(m(`أشهر غير مغلقة: ${open.join('، ')}`, `Months not closed yet: ${open.join(', ')}`));
      await c.db.batch([
        { sql: 'INSERT OR IGNORE INTO closed_year (year, closed_at, closed_by) VALUES (?, ?, ?)', params: [a.year, nowIso(), c.who] },
        auditStmt(c.who, 'close', 'closed_year', String(a.year), null, { months }),
      ]);
    },
  },
  'year.reopen': {
    check: (c: OpCtx) => need(c, 'month.reopen'),
    run: (c: OpCtx, a: { year: number }) =>
      c.db.batch([{ sql: 'DELETE FROM closed_year WHERE year = ?', params: [a.year] }, auditStmt(c.who, 'reopen', 'closed_year', String(a.year), null, null)]),
  },
  'month.reopen': {
    check: (c: OpCtx) => need(c, 'month.reopen'),
    run: async (c: OpCtx, a: { ym: string }) => {
      if (await one(c.db, 'SELECT 1 FROM closed_year WHERE year = ?', [Number(a.ym.slice(0, 4))]))
        throw new UserError(m('السنة مغلقة: أعد فتح السنة أولاً', 'The year is closed: reopen the year first'));
      return reopenMonth(c, a);
    },
  },

  // ---------------------------------------------------------------- users and permission profiles
  'user.save': { check: (c: OpCtx) => need(c, 'users.manage'), run: (c: OpCtx, a: { id?: number; name: string; access_id: number; books: number[]; pin?: string }) => saveUser(c, a) },
  'users.createKeepers': { check: (c: OpCtx) => need(c, 'users.manage'), run: (c: OpCtx) => createKeepers(c) },
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
      return changePin(c.db, a.id, a.pin, c.who, a.id !== c.profile.id);
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

  // ---------------------------------------------------------------- budget
  'budget.get': { check: (c: OpCtx) => need(c, 'budget.view'), run: (c: OpCtx, a: { budgetId?: number | null }) => loadBudget(c, a?.budgetId) },
  'budget.create': { check: (c: OpCtx) => need(c, 'budget.manage'), run: (c: OpCtx, a: CreateArgs) => createBudget(c, a) },
  'budget.setPeriod': { check: (c: OpCtx) => need(c, 'budget.manage'), run: (c: OpCtx, a: Parameters<typeof setBudgetPeriod>[1]) => setBudgetPeriod(c, a) },
  'budget.revise': { check: (c: OpCtx) => need(c, 'budget.manage'), run: (c: OpCtx, a: { budgetId: number; note?: string | null }) => reviseBudget(c, a) },
  /** Delete the latest revision (back to the one before), or the whole budget. A backup is taken first. */
  'budget.delete': {
    check: (c: OpCtx) => need(c, 'budget.manage'),
    run: async (c: OpCtx, a: { budgetId: number; onlyLatest?: boolean }) => {
      const versions = await c.db.query<BudgetVersion>('SELECT * FROM budget_version WHERE budget_id = ? ORDER BY rev', [a.budgetId]);
      if (!versions.length) throw new UserError(m('لا موازنة', 'No budget'));
      const gone = a.onlyLatest ? versions.slice(-1) : versions;
      if (a.onlyLatest && gone[0].rev === 0) throw new UserError(m('هذه الموازنة الأصلية: احذف الموازنة كلها', 'This is the original budget: delete the whole budget instead'));
      await c.files.backupNow('before-budget-delete');
      const stmts: Stmt[] = [];
      for (const v of gone) {
        for (const t of ['budget_item', 'budget_amount', 'budget_account']) stmts.push({ sql: `DELETE FROM ${t} WHERE version_id = ?`, params: [v.id] });
        stmts.push({ sql: 'DELETE FROM budget_version WHERE id = ?', params: [v.id] });
      }
      if (!a.onlyLatest) {
        // the budget itself goes; one that continued it no longer carries anything; its allocations are kept, unlinked
        stmts.push({ sql: 'UPDATE budget SET carry_from_id = NULL WHERE carry_from_id = ?', params: [a.budgetId] });
        stmts.push({ sql: 'UPDATE budget_alloc SET budget_id = NULL WHERE budget_id = ?', params: [a.budgetId] });
        stmts.push({ sql: 'DELETE FROM budget WHERE id = ?', params: [a.budgetId] });
      }
      stmts.push(auditStmt(c.who, 'delete', 'budget', String(a.budgetId), { revs: gone.map((v) => v.rev) }, null));
      await c.db.batch(stmts);
    },
  },
  'budget.saveAmounts': { check: (c: OpCtx) => need(c, 'budget.manage'), run: (c: OpCtx, a: Parameters<typeof saveBudgetAmounts>[1]) => saveBudgetAmounts(c, a) },
  'budget.saveItems': { check: (c: OpCtx) => need(c, 'budget.manage'), run: (c: OpCtx, a: Parameters<typeof saveBudgetItems>[1]) => saveBudgetItems(c, a) },
  'budget.importItems': { check: (c: OpCtx) => need(c, 'budget.manage'), run: (c: OpCtx, a: Parameters<typeof importBudgetItems>[1]) => importBudgetItems(c, a) },
  'budget.fillActual': { check: (c: OpCtx) => need(c, 'budget.manage'), run: (c: OpCtx, a: { versionId: number; account_id: number }) => fillFromActual(c, a) },
  'budget.setAccount': {
    check: (c: OpCtx) => need(c, 'budget.manage'),
    /** contingency %; and lump_usd: one amount for the whole account (null: line by line) */
    run: async (c: OpCtx, a: { versionId: number; account_id: number; contingency_pct?: number; lump_usd?: number | null }) => {
      if (a.contingency_pct !== undefined && (!goodNum(a.contingency_pct) || a.contingency_pct > 100)) throw new UserError(m('نسبة الاحتياط غير صحيحة', 'Wrong contingency percentage'));
      if (a.lump_usd != null && !(a.lump_usd > 0)) throw new UserError(m('مبلغ غير صحيح', 'Wrong amount'));
      const v = await latestVersion(c, a.versionId);
      const cur = await one<BudgetAccount>(c.db, 'SELECT * FROM budget_account WHERE version_id = ? AND account_id = ?', [v.id, a.account_id]);
      const cont = a.contingency_pct ?? cur?.contingency_pct ?? 0;
      const lump = a.lump_usd === undefined ? cur?.lump_usd ?? null : a.lump_usd;
      const stmts: Stmt[] = [
        { sql: 'INSERT INTO budget_account (version_id, account_id, contingency_pct, lump_usd) VALUES (?, ?, ?, ?) ON CONFLICT (version_id, account_id) DO UPDATE SET contingency_pct = excluded.contingency_pct, lump_usd = excluded.lump_usd', params: [v.id, a.account_id, cont, lump] },
        auditStmt(c.who, 'edit', 'budget_account', `${v.budget_id}/${v.rev}/${a.account_id}`, cur ?? null, { contingency_pct: cont, lump_usd: lump }),
      ];
      // one amount for the whole account replaces its line amounts
      if (lump != null) stmts.unshift(
        { sql: 'DELETE FROM budget_item WHERE version_id = ? AND account_id = ?', params: [v.id, a.account_id] },
        { sql: 'DELETE FROM budget_amount WHERE version_id = ? AND account_id = ?', params: [v.id, a.account_id] },
      );
      await c.db.batch(stmts);
    },
  },
  'budget.setRates': {
    check: (c: OpCtx) => need(c, 'budget.manage'),
    run: async (c: OpCtx, a: { versionId: number; rate_syp: number; rate_eur: number }) => {
      if (!goodRate(a.rate_syp) || !goodRate(a.rate_eur)) throw new UserError(m('اكتب سعري التصريف التقديريين', 'Write both estimated exchange rates'));
      const v = await latestVersion(c, a.versionId);
      await c.db.batch([
        { sql: 'UPDATE budget_version SET rate_syp = ?, rate_eur = ? WHERE id = ?', params: [a.rate_syp, a.rate_eur, v.id] },
        auditStmt(c.who, 'edit', 'budget_version', `${v.budget_id}/${v.rev}`, { rate_syp: v.rate_syp, rate_eur: v.rate_eur }, { rate_syp: a.rate_syp, rate_eur: a.rate_eur }),
      ]);
    },
  },
  /** Once the budget is set: the expense lines with no budget leave the lists (they stay in old rows). */
  'budget.deactivateLines': {
    check: (c: OpCtx) => { need(c, 'budget.manage'); need(c, 'lists.manage'); },
    run: async (c: OpCtx, a: { lineIds: number[] }) => {
      for (const id of a.lineIds) await setActive(c.db, 'budget_line', id, false, c.who);
      return a.lineIds.length;
    },
  },
  /** A private book (the Superior's): only its keepers see it; others see only the transfers it makes. */
  'book.setPrivate': {
    check: (c: OpCtx) => need(c, 'users.manage'),
    run: (c: OpCtx, a: { id: number; private: boolean }) =>
      c.db.batch([
        { sql: 'UPDATE book SET private = ? WHERE id = ? AND is_main = 0', params: [a.private ? 1 : 0, a.id] },
        auditStmt(c.who, 'edit', 'book', String(a.id), null, { private: a.private }),
      ]),
  },
  'account.setOutside': {
    check: (c: OpCtx) => need(c, 'lists.manage'),
    run: (c: OpCtx, a: { id: number; outside: boolean }) =>
      c.db.batch([
        { sql: 'UPDATE account SET outside_budget = ? WHERE id = ?', params: [a.outside ? 1 : 0, a.id] },
        auditStmt(c.who, 'edit', 'account', String(a.id), null, { outside_budget: a.outside }),
      ]),
  },
  'alloc.save': { check: (c: OpCtx) => { need(c, 'budget.manage'); need(c, 'lists.donors'); }, run: (c: OpCtx, a: Parameters<typeof saveAlloc>[1]) => saveAlloc(c, a) },
  'alloc.delete': {
    check: (c: OpCtx) => { need(c, 'budget.manage'); need(c, 'lists.donors'); },
    run: async (c: OpCtx, a: { id: number }) => {
      const before = await one(c.db, 'SELECT * FROM budget_alloc WHERE id = ?', [a.id]);
      await c.db.batch([{ sql: 'DELETE FROM budget_alloc WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'budget_alloc', String(a.id), before, null)]);
    },
  },

  // ---------------------------------------------------------------- backups
  'backup.list': { check: (c: OpCtx) => need(c, 'data.backup', 'data.restore'), run: (c: OpCtx) => c.files.list() },
  'backup.now': { check: (c: OpCtx) => need(c, 'data.backup'), run: (c: OpCtx) => c.files.backupNow('manual') },
  /** The register of a backup copy, as this person may see it (to compare with now). */
  'backup.compare': {
    check: (c: OpCtx) => need(c, 'data.restore'),
    run: async (c: OpCtx, a: { path: string }) => {
      const lists = await loadLists(c.db);
      return privateView(c, lists, await c.files.backupRows(a.path));
    },
  },
  /** One row back as it was in a backup: changed back, added again, or (if it is new since) deleted. */
  'trx.putBack': {
    check: (c: OpCtx) => need(c, 'data.restore'),
    run: (c: OpCtx, a: { path: string; id: string; reason: string }) => putBackRow(c, a, null),
  },
  /**
   * A whole book back as it was in a backup: every row of that book added, changed or
   * deleted since (and the other leg of its transfers between two books). Rows that
   * cannot change (a closed month…) are listed, the others are put back.
   */
  'book.putBack': {
    check: (c: OpCtx) => need(c, 'data.restore'),
    run: async (c: OpCtx, a: { path: string; bookId: number; reason: string }) => {
      if (!(a.reason ?? '').trim()) throw new UserError(m('اكتب السبب', 'Write the reason'));
      const thenAll = await c.files.backupRows(a.path);
      const nowAll = await loadTrx(c.db);
      const ids = bookChanges(thenAll, nowAll, a.bookId);
      await c.files.backupNow('before-book-putback');
      const failed: { id: string; n: number | null; error: Msg }[] = [];
      let done = 0;
      for (const id of ids) {
        try {
          await putBackRow(c, { path: a.path, id, reason: a.reason }, thenAll);
          done++;
        } catch (e) {
          const r = nowAll.find((x) => x.id === id) ?? thenAll.find((x) => x.id === id);
          failed.push({ id, n: r?.n ?? null, error: e instanceof UserError ? e.msg : m(String(e), String(e)) });
        }
      }
      return { done, failed };
    },
  },
  'backup.restore': { check: (c: OpCtx) => need(c, 'data.restore'), run: (c: OpCtx, a: { path: string }) => c.files.restore(a.path) },
} as const;

export type OpName = keyof typeof OPS;
type Def = { check: (c: OpCtx) => void; run: (c: OpCtx, a: never) => unknown };
export type OpArgs<K extends OpName> = (typeof OPS)[K]['run'] extends (c: OpCtx, a: infer A) => unknown ? A : undefined;
export type OpResult<K extends OpName> = Awaited<ReturnType<(typeof OPS)[K]['run']>>;

/** Operations that only read (the server does not count them as changes). */
export const READ_ONLY: ReadonlySet<string> = new Set([
  'data', 'doc.get', 'brand.get', 'budget.get', 'backup.compare', 'cash.counts', 'audit.list', 'importLog.list', 'users.list', 'access.list', 'closing.problems', 'backup.list', 'entries.build', 'lists.export', ...CTY_READ_ONLY, ...COUNTRY_READ_ONLY,
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
  /** `background`: an automatic reload by the screen (on the server it does not count as activity). */
  call<K extends OpName>(name: K, args?: OpArgs<K>, opts?: { background?: boolean }): Promise<OpResult<K>>;
}

export function localApi(ctx: OpCtx): Api {
  return { call: (name, args) => runOp(ctx, name, args) as never };
}

export { listProfiles };
