// The operations of a community database, with the permission each one needs.
// They join the MAGIS rulebook (src/ops.ts): the desktop app and the server run
// the same checks. Same rules as the MAGIS centres for changes: every change of
// an existing entry asks a reason, and a deletion keeps the whole entry in the audit.

import type { Db, Stmt } from '../db/db';
import { nowIso, one, uuid } from '../db/db';
import { auditStmt, getMeta, UserError } from '../db/repo';
import { has } from '../auth';
import type { Perm } from '../perms';
import { m, type Msg } from '../i18n';
import type { OpCtx } from '../ops';
import {
  CURS, approvalOf, balance, lastDay, leafAccounts, r2,
  type CtyAccount, type CtyBook, type CtyEntry, type Cur, type Limits, type Money,
} from './domain';
import { importFdc, type FdcImportResult } from './importFdc';
import { loadAccounts, loadBooks, loadEntries, loadLimits, loadMonths, loadNotes, saveLimitsStmts, writeEntryStmts } from './repo';

export { loadAccounts, loadBooks, loadEntries, loadMonths, writeEntryStmts };

/** A question or comment of the Superior, or an answer. Private: see mayReadNotes. */
export interface CtyNote {
  id: string;
  book_id: number;
  ym: string | null;
  entry_id: string | null;
  parent_id: string | null;
  author_id: number | null;
  author: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface CtyMonth {
  book_id: number;
  ym: string;
  closed_at: string;
  closed_by: string | null;
  book_loc: number | null; book_usd: number | null; book_eur: number | null;
  counted_loc: number | null; counted_usd: number | null; counted_eur: number | null;
  count_note: string | null;
  seen_at: string | null;
  seen_by: string | null;
}

export interface CtyData {
  kind: string | null;
  accounts: CtyAccount[];
  books: CtyBook[];
  entries: CtyEntry[];
  months: CtyMonth[];
  closed: string[];
  /** the books this person keeps */
  kept: number[];
  /** the Superior's private notes this person may read */
  notes: CtyNote[];
  limits: Limits;
}

/** What the screen sends to save an entry (id absent = a new one). */
export type EntryInput = Pick<CtyEntry, 'book_id' | 'date' | 'type' | 'cur' | 'amount'> &
  Partial<Pick<CtyEntry, 'id' | 'account_id' | 'cur2' | 'amount2' | 'to_book_id' | 'note' | 'claim' | 'claim_note'>>;

// ---------------------------------------------------------------- permissions

const can = (c: OpCtx, p: Perm) => has(c.profile, p);
const keeps = (c: OpCtx, bookId: number | null | undefined) => bookId != null && c.profile.books.includes(bookId);
const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
function need(c: OpCtx, ...perms: Perm[]) {
  if (!perms.some((p) => can(c, p))) throw refuse();
}
/** May write in this book: his own one, or any book with "writes for any member" (the econome). */
const writes = (c: OpCtx, bookId: number) => (keeps(c, bookId) && can(c, 'book.own')) || can(c, 'cty.write_all');
/** May read this book. A Jesuit's detail is seen by himself, his Superior and the community econome only. */
const reads = (c: OpCtx, bookId: number | null) => keeps(c, bookId) || can(c, 'cty.view_all');

/**
 * The Superior's notes are private (Fouad, 18 October 2026): only the Jesuit who keeps
 * the book and the Superior read them, not the econome (who sees every book).
 */
const mayReadNotes = (c: OpCtx, bookId: number) => keeps(c, bookId) || can(c, 'cty.month_seen');
/** The Superior approves; what he records himself needs no other approval. */
const approves = (c: OpCtx) => can(c, 'cty.month_seen');

async function requireCommunity(db: Db) {
  if ((await getMeta(db, 'kind')) !== 'community') throw new UserError(m('هذه ليست قاعدة بيانات جماعة', 'This is not a community database', "Ce n'est pas une base de données de communauté"));
}

// ---------------------------------------------------------------- checking an entry

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: string) => ISO.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const cents = (x: number) => Math.abs(Math.round(x * 100) - x * 100) < 1e-6;

/** Every reason this entry cannot be saved (empty = it can). */
export function entryProblems(e: EntryInput, accounts: CtyAccount[], books: CtyBook[]): Msg[] {
  const out: Msg[] = [];
  const book = books.find((b) => b.id === e.book_id);
  if (!book) out.push(m('الدفتر غير موجود', 'Unknown book', 'Compte inconnu'));
  else if (!book.active) out.push(m('هذا الدفتر موقوف', 'This book is switched off', 'Ce compte est désactivé'));
  if (!e.date || !validDate(e.date)) out.push(m('التاريخ مطلوب (سنة-شهر-يوم)', 'A valid date is required', 'Une date valide est requise'));
  if (!(CURS as readonly string[]).includes(e.cur)) out.push(m('العملة غير معروفة', 'Unknown currency', 'Monnaie inconnue'));
  if (!(e.amount > 0) || !cents(e.amount)) out.push(m('المبلغ أكبر من صفر، بخانتين عشريتين على الأكثر', 'The amount must be above zero, with at most 2 decimals', 'Le montant doit être positif, avec 2 décimales au plus'));
  if (e.claim && e.type !== 'Exp') out.push(m('المطالبة للنفقات فقط', 'Only an expense can be claimed', 'Seule une dépense peut être réclamée'));

  if (e.type === 'Income' || e.type === 'Exp') {
    const acc = accounts.find((a) => a.id === e.account_id);
    if (!acc) out.push(m('اختر البند', 'Choose the line', 'Choisissez la ligne'));
    else {
      if (acc.type !== e.type) out.push(m('هذا البند لا يناسب هذا النوع', 'This line does not belong to this type', 'Cette ligne ne correspond pas à ce type'));
      if (!leafAccounts(accounts).some((a) => a.id === acc.id)) out.push(m('اختر بنداً تفصيلياً', 'Choose a detailed line', 'Choisissez une ligne détaillée'));
      if (book?.cty_kind === 'personal' && acc.scope !== 'P') out.push(m('هذا البند لدفتر البيت', 'This line belongs to the house book', 'Cette ligne est pour le compte de la maison'));
    }
    if (e.to_book_id || e.cur2) out.push(m('حقول زائدة', 'Fields that do not belong to this type', "Champs qui n'appartiennent pas à ce type"));
  } else if (e.type === 'Transfer') {
    const to = books.find((b) => b.id === e.to_book_id);
    if (!to) out.push(m('إلى أي دفتر؟', 'To which book?', 'Vers quel compte ?'));
    else if (to.id === e.book_id) out.push(m('لا تحويل إلى نفس الدفتر', 'A book cannot give to itself', 'Un compte ne peut pas se donner à lui-même'));
    else if (!to.active) out.push(m('هذا الدفتر موقوف', 'This book is switched off', 'Ce compte est désactivé'));
    if (e.account_id || e.cur2) out.push(m('حقول زائدة', 'Fields that do not belong to this type', "Champs qui n'appartiennent pas à ce type"));
  } else if (e.type === 'Exchange') {
    if (!e.cur2 || !(CURS as readonly string[]).includes(e.cur2) || e.cur2 === e.cur) out.push(m('اختر العملة المستلمة (غير المعطاة)', 'Choose the currency received (not the one given)', 'Choisissez la monnaie reçue (pas celle donnée)'));
    if (!(Number(e.amount2) > 0) || !cents(Number(e.amount2))) out.push(m('المبلغ المستلم أكبر من صفر', 'The amount received must be above zero', 'Le montant reçu doit être positif'));
    if (e.account_id || e.to_book_id) out.push(m('حقول زائدة', 'Fields that do not belong to this type', "Champs qui n'appartiennent pas à ce type"));
  } else out.push(m('النوع غير معروف', 'Unknown type', 'Type inconnu'));
  return out;
}

async function closedFor(db: Db, bookIds: number[], ym: string): Promise<boolean> {
  if (await one(db, 'SELECT 1 AS x FROM closed_month WHERE ym = ?', [ym])) return true;
  for (const id of bookIds) if (await one(db, 'SELECT 1 AS x FROM cty_month WHERE book_id = ? AND ym = ?', [id, ym])) return true;
  return false;
}
const monthClosed = (ym: string) => new UserError(m(`الشهر ${ym} مغلق`, `Month ${ym} is closed`, `Le mois ${ym} est clôturé`));
const booksOf = (e: { book_id: number; to_book_id?: number | null }) => [e.book_id, ...(e.to_book_id ? [e.to_book_id] : [])];
const fail = (msgs: Msg[]) => new UserError(msgs.length === 1 ? msgs[0] : m(msgs.map((x) => x.ar).join(' · '), msgs.map((x) => x.en).join(' · '), msgs.map((x) => x.fr ?? x.en).join(' · ')));

// ---------------------------------------------------------------- saving

async function saveEntry(c: OpCtx, a: { entry: EntryInput; reason?: string | null }): Promise<string> {
  await requireCommunity(c.db);
  const e = a.entry;
  const [accounts, books] = [await loadAccounts(c.db), await loadBooks(c.db)];
  const old = e.id ? await one<CtyEntry>(c.db, 'SELECT * FROM cty_entry WHERE id = ?', [e.id]) : undefined;
  if (e.id && !old) throw new UserError(m('القيد غير موجود', 'Entry not found', 'Écriture introuvable'));
  if (!writes(c, e.book_id) || (old && !writes(c, old.book_id))) throw refuse();
  const problems = entryProblems(e, accounts, books);
  if (problems.length) throw fail(problems);
  if (await closedFor(c.db, booksOf(e), e.date.slice(0, 7))) throw monthClosed(e.date.slice(0, 7));
  const reason = (a.reason ?? '').trim();
  if (old) {
    if (!reason) throw new UserError(m('اكتب سبب التعديل', 'Write the reason for this change', 'Écrivez la raison de cette modification'));
    if (await closedFor(c.db, booksOf(old), old.date.slice(0, 7))) throw monthClosed(old.date.slice(0, 7));
  }
  const at = nowIso();
  const row: CtyEntry = {
    id: old?.id ?? uuid(),
    n: old?.n ?? null,
    book_id: e.book_id,
    date: e.date,
    type: e.type,
    account_id: e.type === 'Income' || e.type === 'Exp' ? e.account_id ?? null : null,
    cur: e.cur,
    amount: r2(e.amount),
    cur2: e.type === 'Exchange' ? e.cur2 ?? null : null,
    amount2: e.type === 'Exchange' ? r2(Number(e.amount2)) : null,
    to_book_id: e.type === 'Transfer' ? e.to_book_id ?? null : null,
    note: (e.note ?? '').trim() || null,
    claim: e.type === 'Exp' ? e.claim ?? null : null,
    claim_note: e.type === 'Exp' && e.claim ? (e.claim_note ?? '').trim() || null : null,
    // a changed transfer must be confirmed again by the receiver
    received_at: null, received_by: null, disputed_at: null, dispute_note: null,
    source: old?.source ?? null,
    approval_needed: 0,
    approval_usd: null,
    approved_at: null,
    approved_by: null,
    created_at: old?.created_at ?? at,
    created_by: old?.created_by ?? c.who,
    updated_at: old ? at : null,
  };
  if (old && old.type === 'Transfer' && row.type === 'Transfer' && old.to_book_id === row.to_book_id && old.amount === row.amount && old.cur === row.cur && old.date === row.date) {
    // only the note changed: the confirmation stands
    Object.assign(row, { received_at: old.received_at, received_by: old.received_by, disputed_at: old.disputed_at, dispute_note: old.dispute_note });
  }
  // The limit of the moment decides; an approved expense keeps its approval while amount and currency stay.
  const appr = approvalOf(row, books.find((b) => b.id === row.book_id), await loadLimits(c.db), await loadEntries(c.db));
  row.approval_needed = appr.needed ? 1 : 0;
  row.approval_usd = appr.usd;
  if (row.approval_needed) {
    if (old?.approved_at && old.amount === row.amount && old.cur === row.cur && old.type === row.type) Object.assign(row, { approved_at: old.approved_at, approved_by: old.approved_by });
    else if (approves(c)) Object.assign(row, { approved_at: at, approved_by: c.who });
  }
  await c.db.batch([...writeEntryStmts(row, !old), auditStmt(c.who, old ? 'edit' : 'add', 'cty_entry', row.id, old ?? null, old ? { ...row, reason } : row)]);
  return row.id;
}

async function deleteEntry(c: OpCtx, a: { id: string; reason: string }) {
  await requireCommunity(c.db);
  const old = await one<CtyEntry>(c.db, 'SELECT * FROM cty_entry WHERE id = ?', [a.id]);
  if (!old) throw new UserError(m('القيد غير موجود', 'Entry not found', 'Écriture introuvable'));
  if (!writes(c, old.book_id)) throw refuse();
  const reason = (a.reason ?? '').trim();
  if (!reason) throw new UserError(m('اكتب سبب الحذف', 'Write the reason for this deletion', 'Écrivez la raison de cette suppression'));
  if (await closedFor(c.db, booksOf(old), old.date.slice(0, 7))) throw monthClosed(old.date.slice(0, 7));
  await c.db.batch([{ sql: 'DELETE FROM cty_entry WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'cty_entry', a.id, old, { reason })]);
}

/** The receiver of money answers: received ✓, or not received (with a note). */
async function answerTransfer(c: OpCtx, a: { id: string; ok: boolean; note?: string | null }) {
  await requireCommunity(c.db);
  const t = await one<CtyEntry>(c.db, 'SELECT * FROM cty_entry WHERE id = ?', [a.id]);
  if (!t || t.type !== 'Transfer') throw new UserError(m('تحويل غير موجود', 'Transfer not found', 'Transfert introuvable'));
  if (!keeps(c, t.to_book_id)) throw new UserError(m('يؤكد المستلم فقط', 'Only the receiver can answer', 'Seul celui qui reçoit peut répondre'));
  if (await closedFor(c.db, booksOf(t), t.date.slice(0, 7))) throw monthClosed(t.date.slice(0, 7));
  const note = (a.note ?? '').trim() || null;
  if (!a.ok && !note) throw new UserError(m('اكتب ملاحظة: ماذا حدث؟', 'Write a note: what happened?', "Écrivez une note : que s'est-il passé ?"));
  const at = nowIso();
  await c.db.batch([
    { sql: 'UPDATE cty_entry SET received_at = ?, received_by = ?, disputed_at = ?, dispute_note = ? WHERE id = ?', params: a.ok ? [at, c.who, null, null, a.id] : [null, null, at, note, a.id] },
    auditStmt(c.who, a.ok ? 'confirm' : 'dispute', 'cty_entry', a.id, null, { note }),
  ]);
}

// ---------------------------------------------------------------- the end of the month

/** What prevents closing a book's month. */
export async function closingProblems(db: Db, bookId: number, ym: string): Promise<Msg[]> {
  const out: Msg[] = [];
  const end = lastDay(ym);
  const waiting = await db.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM cty_entry WHERE type = 'Transfer' AND date <= ? AND (book_id = ? OR to_book_id = ?) AND received_at IS NULL AND disputed_at IS NULL`,
    [end, bookId, bookId],
  );
  if (waiting[0].n) out.push(m(`${waiting[0].n} مبلغاً لم يؤكَّد استلامه`, `${waiting[0].n} transfers not yet confirmed by the receiver`, `${waiting[0].n} transferts pas encore confirmés par celui qui reçoit`));
  const disputed = await db.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM cty_entry WHERE type = 'Transfer' AND date <= ? AND (book_id = ? OR to_book_id = ?) AND disputed_at IS NOT NULL`,
    [end, bookId, bookId],
  );
  const approval = await db.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM cty_entry WHERE type = 'Exp' AND book_id = ? AND date <= ? AND approval_needed = 1 AND approved_at IS NULL`,
    [bookId, end],
  );
  if (approval[0].n) out.push(m(`${approval[0].n} نفقة تنتظر موافقة الرئيس`, `${approval[0].n} expenses wait for the Superior's approval`, `${approval[0].n} dépenses attendent l'accord du Supérieur`));
  if (disputed[0].n) out.push(m(`${disputed[0].n} مبلغاً قيل إنه لم يصل`, `${disputed[0].n} transfers marked "not received"`, `${disputed[0].n} transferts marqués « non reçu »`));
  return out;
}

const curKey = { LOC: 'loc', USD: 'usd', EUR: 'eur' } as const;

/** The keeper closes his month after counting his cash in each currency. A difference needs a note. */
async function closeMonth(c: OpCtx, a: { bookId: number; ym: string; counted: Money; note?: string | null }) {
  await requireCommunity(c.db);
  if (!/^\d{4}-\d{2}$/.test(a.ym)) throw new UserError(m('شهر غير صالح', 'Invalid month', 'Mois invalide'));
  if (!(keeps(c, a.bookId) && can(c, 'book.own')) && !can(c, 'cty.write_all')) throw refuse();
  if (await one(c.db, 'SELECT 1 AS x FROM cty_month WHERE book_id = ? AND ym = ?', [a.bookId, a.ym])) throw monthClosed(a.ym);
  const problems = await closingProblems(c.db, a.bookId, a.ym);
  if (problems.length) throw fail(problems);
  const book = (await loadBooks(c.db)).find((b) => b.id === a.bookId);
  if (!book) throw new UserError(m('الدفتر غير موجود', 'Unknown book', 'Compte inconnu'));
  const held = balance(await loadEntries(c.db), book, lastDay(a.ym));
  const counted = Object.fromEntries(CURS.map((k) => [k, r2(Number(a.counted?.[k] ?? 0))])) as Money;
  const differs = CURS.some((k) => counted[k] !== held[k]);
  const note = (a.note ?? '').trim() || null;
  if (differs && !note) throw new UserError(m('النقد المعدود لا يساوي الدفتر: اكتب ملاحظة أو أضف ما نُسي', 'The cash counted is not what the book says: write a note or add what was forgotten', "L'argent compté ne correspond pas au compte : écrivez une note ou ajoutez l'oubli"));
  const params = [a.bookId, a.ym, nowIso(), c.who, ...CURS.map((k) => held[k]), ...CURS.map((k) => counted[k]), note];
  await c.db.batch([
    {
      sql: `INSERT INTO cty_month (book_id, ym, closed_at, closed_by, ${CURS.map((k) => 'book_' + curKey[k]).join(', ')}, ${CURS.map((k) => 'counted_' + curKey[k]).join(', ')}, count_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params,
    },
    auditStmt(c.who, 'close', 'cty_month', `${a.bookId}:${a.ym}`, null, { held, counted, note }),
  ]);
}

async function reopenMonth(c: OpCtx, a: { bookId: number; ym: string; reason: string }) {
  const reason = (a.reason ?? '').trim();
  if (!reason) throw new UserError(m('اكتب السبب', 'Write the reason', 'Écrivez la raison'));
  const old = await one<CtyMonth>(c.db, 'SELECT * FROM cty_month WHERE book_id = ? AND ym = ?', [a.bookId, a.ym]);
  if (!old) return;
  await c.db.batch([
    { sql: 'DELETE FROM cty_month WHERE book_id = ? AND ym = ?', params: [a.bookId, a.ym] },
    auditStmt(c.who, 'reopen', 'cty_month', `${a.bookId}:${a.ym}`, old, { reason }),
  ]);
}

/** The Superior has read a member's closed month. */
async function monthSeen(c: OpCtx, a: { bookId: number; ym: string }) {
  const r = await one<CtyMonth>(c.db, 'SELECT * FROM cty_month WHERE book_id = ? AND ym = ?', [a.bookId, a.ym]);
  if (!r) throw new UserError(m('هذا الشهر لم يُغلق بعد', 'This month is not closed yet', "Ce mois n'est pas encore clôturé"));
  await c.db.batch([
    { sql: 'UPDATE cty_month SET seen_at = ?, seen_by = ? WHERE book_id = ? AND ym = ?', params: [nowIso(), c.who, a.bookId, a.ym] },
    auditStmt(c.who, 'seen', 'cty_month', `${a.bookId}:${a.ym}`, null, null),
  ]);
}

// ---------------------------------------------------------------- the chart of codes

export type AccountInput = Partial<Pick<CtyAccount, 'id' | 'parent_id' | 'type' | 'scope' | 'claim' | 'active' | 'sort'>> &
  Pick<CtyAccount, 'code' | 'name_en' | 'name_fr' | 'name_ar'>;

/** Change a code or a name, add a line, switch one off. Past entries follow: they point to the row. */
async function saveAccount(c: OpCtx, a: { account: AccountInput; reason?: string | null }) {
  await requireCommunity(c.db);
  const x = a.account;
  const all = await loadAccounts(c.db);
  const old = x.id ? all.find((r) => r.id === x.id) : undefined;
  if (x.id && !old) throw new UserError(m('البند غير موجود', 'Line not found', 'Ligne introuvable'));
  const code = (x.code ?? '').trim();
  if (!/^\d{3,8}$/.test(code)) throw new UserError(m('الرمز أرقام فقط', 'The code is digits only', 'Le code ne contient que des chiffres'));
  if (all.some((r) => r.code === code && r.id !== x.id)) throw new UserError(m(`الرمز ${code} مستعمل`, `Code ${code} is already used`, `Le code ${code} est déjà utilisé`));
  const names = [x.name_en, x.name_fr, x.name_ar].map((s) => (s ?? '').trim());
  if (names.some((s) => !s)) throw new UserError(m('الاسم بالعربية والإنكليزية والفرنسية', 'The name in English, French and Arabic', 'Le nom en anglais, français et arabe'));
  const parentId = x.parent_id ?? old?.parent_id ?? null;
  const parent = parentId != null ? all.find((r) => r.id === parentId) : undefined;
  if (parentId != null && !parent) throw new UserError(m('البند الأعلى غير موجود', 'Unknown parent', 'Parent inconnu'));
  for (let p = parent; p; p = all.find((r) => r.id === p!.parent_id)) if (p.id === x.id) throw new UserError(m('حلقة في الدليل', 'A line cannot be under itself', 'Une ligne ne peut être sous elle-même'));
  const type = parent?.type ?? x.type ?? old?.type;
  if (type !== 'Income' && type !== 'Exp') throw new UserError(m('دخل أم نفقة؟', 'Income or expense?', 'Revenu ou dépense ?'));
  // a new line under a heading that already has entries: they stay on the heading (its total)
  const reason = (a.reason ?? '').trim();
  if (old && !reason) throw new UserError(m('اكتب سبب التعديل', 'Write the reason for this change', 'Écrivez la raison de cette modification'));
  const row = {
    code, parent_id: parentId, type, name_en: names[0], name_fr: names[1], name_ar: names[2],
    scope: x.scope ?? old?.scope ?? parent?.scope ?? 'H', claim: x.claim !== undefined ? x.claim : old?.claim ?? parent?.claim ?? null,
    active: x.active ?? old?.active ?? 1, sort: x.sort ?? old?.sort ?? (Math.max(0, ...all.map((r) => r.sort)) + 1),
  };
  const keys = Object.keys(row) as (keyof typeof row)[];
  const stmt: Stmt = old
    ? { sql: `UPDATE cty_account SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, params: [...keys.map((k) => row[k]), old.id] }
    : { sql: `INSERT INTO cty_account (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, params: keys.map((k) => row[k]) };
  await c.db.batch([stmt, auditStmt(c.who, old ? 'edit' : 'add', 'cty_account', old ? String(old.id) : code, old ?? null, old ? { ...row, reason } : row)]);
}

// ---------------------------------------------------------------- the Superior's approval and notes

async function approveEntries(c: OpCtx, a: { ids: string[] }) {
  await requireCommunity(c.db);
  const stmts: Stmt[] = [];
  for (const id of a.ids) {
    const e = await one<CtyEntry>(c.db, 'SELECT * FROM cty_entry WHERE id = ?', [id]);
    if (!e || !e.approval_needed) throw new UserError(m('هذه النفقة لا تحتاج موافقة', 'This expense needs no approval', "Cette dépense n'a pas besoin d'accord"));
    if (e.approved_at) continue;
    stmts.push({ sql: 'UPDATE cty_entry SET approved_at = ?, approved_by = ? WHERE id = ?', params: [nowIso(), c.who, id] }, auditStmt(c.who, 'approve', 'cty_entry', id, null, null));
  }
  if (stmts.length) await c.db.batch(stmts);
}

/** One line of the Superior's "needs approval" list: the expense with everything about it. */
export interface ApprovalItem {
  entry: CtyEntry;
  book: string;
  keeper: string | null;
  bookKind: string | null;
  account: Pick<CtyAccount, 'code' | 'name_en' | 'name_fr' | 'name_ar'> | null;
  /** the limit of that book, in dollars */
  limit: number;
  /** what the Jesuit wrote on it (its note), and the private notes about it */
  notes: CtyNote[];
  /** receipts or photos attached */
  documents: number;
}

/** The Superior's list: every expense still waiting for his approval, oldest first. */
async function approvals(c: OpCtx): Promise<ApprovalItem[]> {
  await requireCommunity(c.db);
  const [books, accounts, limits, notes] = [await loadBooks(c.db), await loadAccounts(c.db), await loadLimits(c.db), await loadNotes(c.db)];
  const waiting = await c.db.query<CtyEntry>("SELECT * FROM cty_entry WHERE type = 'Exp' AND approval_needed = 1 AND approved_at IS NULL ORDER BY date, n");
  const out: ApprovalItem[] = [];
  for (const e of waiting) {
    const b = books.find((x) => x.id === e.book_id);
    const acc = accounts.find((x) => x.id === e.account_id);
    const docs = await one<{ n: number }>(c.db, 'SELECT COUNT(*) AS n FROM attachment WHERE trx_id = ? AND deleted_at IS NULL', [e.id]);
    out.push({
      entry: e,
      book: b?.name ?? '',
      keeper: b?.keeper_name ?? null,
      bookKind: b?.cty_kind ?? null,
      account: acc ? { code: acc.code, name_en: acc.name_en, name_fr: acc.name_fr, name_ar: acc.name_ar } : null,
      limit: b?.cty_kind === 'house' ? limits.house : limits.personal,
      notes: notes.filter((n) => n.entry_id === e.id),
      documents: docs?.n ?? 0,
    });
  }
  return out;
}

async function saveLimits(c: OpCtx, a: { limits: Limits }) {
  await requireCommunity(c.db);
  for (const book of ['house', 'personal'] as const) {
    const x = Number(a.limits?.[book] ?? 0);
    if (!(x >= 0) || !Number.isFinite(x)) throw new UserError(m('حد غير صالح', 'Invalid limit', 'Limite invalide'));
  }
  const before = await loadLimits(c.db);
  await c.db.batch([...saveLimitsStmts(a.limits), auditStmt(c.who, 'edit', 'setting', 'cty_limits', before, a.limits)]);
}

/** The Superior writes a question or a comment (on a month or an entry); the Jesuit answers. */
async function addNote(c: OpCtx, a: { bookId: number; ym?: string | null; entryId?: string | null; parentId?: string | null; body: string }) {
  await requireCommunity(c.db);
  if (!mayReadNotes(c, a.bookId)) throw refuse();
  const body = (a.body ?? '').trim();
  if (!body) throw new UserError(m('الملاحظة فارغة', 'The note is empty', 'La note est vide'));
  if (a.entryId) {
    const e = await one<CtyEntry>(c.db, 'SELECT book_id, to_book_id FROM cty_entry WHERE id = ?', [a.entryId]);
    if (!e || (e.book_id !== a.bookId && e.to_book_id !== a.bookId)) throw new UserError(m('القيد غير موجود', 'Entry not found', 'Écriture introuvable'));
  }
  if (a.parentId && !(await one(c.db, 'SELECT 1 AS x FROM cty_note WHERE id = ? AND book_id = ?', [a.parentId, a.bookId]))) throw new UserError(m('الملاحظة غير موجودة', 'Note not found', 'Note introuvable'));
  const id = uuid();
  await c.db.batch([{
    sql: 'INSERT INTO cty_note (id, book_id, ym, entry_id, parent_id, author_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    params: [id, a.bookId, a.ym ?? null, a.entryId ?? null, a.parentId ?? null, c.profile.id, c.who, body, nowIso()],
  }]);
  // the audit says a note was written, not what it says: it stays private
  await c.db.batch([auditStmt(c.who, 'note', 'cty_note', id, null, { bookId: a.bookId })]);
  return id;
}

async function readNotes(c: OpCtx, a: { ids: string[] }) {
  const stmts: Stmt[] = [];
  for (const id of a.ids) {
    const n = await one<CtyNote>(c.db, 'SELECT * FROM cty_note WHERE id = ?', [id]);
    if (n && !n.read_at && n.author_id !== c.profile.id && mayReadNotes(c, n.book_id)) stmts.push({ sql: 'UPDATE cty_note SET read_at = ? WHERE id = ?', params: [nowIso(), id] });
  }
  if (stmts.length) await c.db.batch(stmts);
}

// ---------------------------------------------------------------- the operations

async function data(c: OpCtx): Promise<CtyData> {
  const books = await loadBooks(c.db);
  const visible = new Set(books.filter((b) => reads(c, b.id)).map((b) => b.id));
  const entries = (await loadEntries(c.db)).filter((e) => visible.has(e.book_id) || (e.to_book_id != null && visible.has(e.to_book_id)));
  return {
    kind: await getMeta(c.db, 'kind'),
    accounts: await loadAccounts(c.db),
    books,
    entries,
    months: (await loadMonths(c.db)).filter((x) => visible.has(x.book_id)),
    closed: (await c.db.query<{ ym: string }>('SELECT ym FROM closed_month')).map((r) => r.ym),
    kept: c.profile.books,
    notes: (await loadNotes(c.db)).filter((n) => mayReadNotes(c, n.book_id)),
    limits: await loadLimits(c.db),
  };
}

const anyone = (_c: OpCtx) => undefined;

export const CTY_OPS = {
  'cty.data': { check: anyone, run: (c: OpCtx) => data(c) },
  'cty.entry.save': { check: (c: OpCtx) => need(c, 'book.own', 'cty.write_all'), run: (c: OpCtx, a: { entry: EntryInput; reason?: string | null }) => saveEntry(c, a) },
  'cty.entry.delete': { check: (c: OpCtx) => need(c, 'book.own', 'cty.write_all'), run: (c: OpCtx, a: { id: string; reason: string }) => deleteEntry(c, a) },
  'cty.transfer.answer': { check: (c: OpCtx) => need(c, 'book.own', 'cty.write_all'), run: (c: OpCtx, a: { id: string; ok: boolean; note?: string | null }) => answerTransfer(c, a) },
  'cty.month.problems': {
    check: anyone,
    run: async (c: OpCtx, a: { bookId: number; ym: string }) => {
      if (!reads(c, a.bookId)) throw refuse();
      return closingProblems(c.db, a.bookId, a.ym);
    },
  },
  'cty.month.close': { check: (c: OpCtx) => need(c, 'book.own', 'cty.write_all'), run: (c: OpCtx, a: { bookId: number; ym: string; counted: Money; note?: string | null }) => closeMonth(c, a) },
  'cty.month.reopen': { check: (c: OpCtx) => need(c, 'month.reopen'), run: (c: OpCtx, a: { bookId: number; ym: string; reason: string }) => reopenMonth(c, a) },
  'cty.month.seen': { check: (c: OpCtx) => need(c, 'cty.month_seen'), run: (c: OpCtx, a: { bookId: number; ym: string }) => monthSeen(c, a) },
  'cty.approvals': { check: (c: OpCtx) => need(c, 'cty.month_seen'), run: (c: OpCtx) => approvals(c) },
  'cty.entry.approve': { check: (c: OpCtx) => need(c, 'cty.month_seen'), run: (c: OpCtx, a: { ids: string[] }) => approveEntries(c, a) },
  'cty.limits.save': { check: (c: OpCtx) => need(c, 'cty.limits'), run: (c: OpCtx, a: { limits: Limits }) => saveLimits(c, a) },
  'cty.note.add': { check: anyone, run: (c: OpCtx, a: { bookId: number; ym?: string | null; entryId?: string | null; parentId?: string | null; body: string }) => addNote(c, a) },
  'cty.note.read': { check: anyone, run: (c: OpCtx, a: { ids: string[] }) => readNotes(c, a) },
  'cty.account.save': { check: (c: OpCtx) => need(c, 'cty.chart'), run: (c: OpCtx, a: { account: AccountInput; reason?: string | null }) => saveAccount(c, a) },
  'cty.import.fdc': {
    check: (c: OpCtx) => need(c, 'data.import', 'cty.write_all'),
    run: async (c: OpCtx, a: { bookId: number; year: number; base64: string; fileName: string }): Promise<FdcImportResult> => {
      await requireCommunity(c.db);
      const bytes = Uint8Array.from(atob(a.base64), (ch) => ch.charCodeAt(0));
      return importFdc(c.db, { bookId: a.bookId, year: a.year, bytes, fileName: a.fileName, who: c.who });
    },
  },
};

export const CTY_READ_ONLY = ['cty.data', 'cty.month.problems', 'cty.approvals'];
export type { Cur };
