// The two files that travel between a holder's computer and the office.
//
//  Holder → office : ENTRIES file  (<book>-entries-<date>.json)
//    Every row carries its Entry_ID. The office skips any ID it already has,
//    so importing the same file twice adds nothing.
//
//  Office → holder : LISTS package (lists-<date>.json)
//    Books, budget, parties, cities, accounts, settings — never donors or
//    grants. Plus, for each book, the transfers the office booked, so the
//    holder can compare them with what he noted as received.

import { type Db, type Stmt, nowIso, one } from '../db/db';
import { auditStmt, insertTrxStmt, loadLists, loadTrx, nextN, setMetaStmt, UserError } from '../db/repo';
import { validateTrx } from '../domain/validate';
import type { Trx } from '../domain/types';
import { m } from '../i18n';

const ENTRIES = 'magis-entries';
const LISTS = 'magis-lists';

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- entries

export interface EntriesFile {
  kind: typeof ENTRIES;
  version: 1;
  exported_at: string;
  book: { id: number; name: string };
  lists_version: string | null;
  rows: (Trx & { _names: Record<string, string | null> })[];
}

/** Holder side: every row of my book, as a file. Nothing is marked yet. */
export async function buildEntriesFile(db: Db, bookId: number): Promise<{ file: EntriesFile; unsentIds: string[] }> {
  const lists = await loadLists(db);
  const book = lists.books.find((b) => b.id === bookId);
  if (!book) throw new UserError(m('الدفتر غير موجود', 'Book not found'));
  const rows = (await loadTrx(db)).filter((r) => r.book_id === bookId);
  const name = (arr: { id: number; name: string }[], id: number | null) => (id == null ? null : arr.find((x) => x.id === id)?.name ?? null);
  const file: EntriesFile = {
    kind: ENTRIES,
    version: 1,
    exported_at: nowIso(),
    book: { id: book.id, name: book.name },
    lists_version: (await one<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'lists_version'"))?.value ?? null,
    rows: rows.map((r) => ({
      ...r,
      // Names travel too, so a mismatch of lists can be seen and explained.
      _names: {
        city: name(lists.cities, r.city_id),
        account: name(lists.accounts, r.account_id),
        book: name(lists.books, r.book_id),
        heading: name(lists.headings, r.heading_id),
        line: name(lists.lines, r.line_id),
        party: name(lists.parties, r.party_id),
      },
    })),
  };
  return { file, unsentIds: rows.filter((r) => !r.sent_at).map((r) => r.id) };
}

/** Once the file is safely written: these rows are sent (then read-only for the holder). */
export async function markSent(db: Db, ids: string[], total: number, who: string): Promise<void> {
  const at = nowIso();
  await db.batch([
    ...ids.map((id) => ({ sql: 'UPDATE trx SET sent_at = ? WHERE id = ?', params: [at, id] })),
    auditStmt(who, 'export_entries', 'trx', null, null, { rows: total, newlySent: ids.length }),
  ]);
}

export async function exportEntries(db: Db, bookId: number, who: string): Promise<{ file: EntriesFile; newlySent: number }> {
  const { file, unsentIds } = await buildEntriesFile(db, bookId);
  await markSent(db, unsentIds, file.rows.length, who);
  return { file, newlySent: unsentIds.length };
}

export function entriesFileName(bookName: string) {
  return `${bookName}-entries-${today()}.json`;
}

export interface EntriesImportResult {
  added: number;
  skipped: string[]; // Entry_IDs already present
  toReview: number;
  book: string;
}

/** Office side. IDs already present are skipped and listed — double import is impossible. */
export async function importEntries(db: Db, text: string, fileName: string, who: string): Promise<EntriesImportResult> {
  let file: EntriesFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new UserError(m('الملف ليس ملف قيود صالحاً', 'This is not a valid entries file'));
  }
  if (file.kind !== ENTRIES) throw new UserError(m('الملف ليس ملف قيود من دفتر أمين', "This is not a holder's entries file"));

  const lists = await loadLists(db);
  const book = lists.books.find((b) => b.id === file.book.id);
  if (!book || book.name.toLowerCase() !== file.book.name.toLowerCase())
    throw new UserError(
      m(`الدفتر "${file.book.name}" لا يطابق دفاتر هذه القاعدة`, `Book "${file.book.name}" does not match this database's books`),
    );

  const existing = new Set((await db.query<{ id: string }>('SELECT id FROM trx')).map((r) => r.id));
  const rows = await loadTrx(db);
  const closed = new Set((await db.query<{ ym: string }>('SELECT ym FROM closed_month')).map((r) => r.ym));
  const skipped: string[] = [];
  const stmts: Stmt[] = [];
  let n = await nextN(db);
  let toReview = 0;
  const added: Trx[] = [];

  for (const raw of file.rows) {
    if (existing.has(raw.id)) {
      skipped.push(raw.id);
      continue;
    }
    const { _names, ...rest } = raw;
    const t: Trx = { ...rest, n: n++, sent_at: null, review: null, source_file: fileName };
    if (t.book_id !== book.id) {
      // a holder file only carries its own book
      skipped.push(raw.id);
      continue;
    }
    // Check again with the office's lists and register: they may have changed.
    const reasons: string[] = [];
    const nameCheck: [string, { id: number; name: string }[], number | null][] = [
      ['city', lists.cities, t.city_id],
      ['account', lists.accounts, t.account_id],
      ['heading', lists.headings, t.heading_id],
      ['line', lists.lines, t.line_id],
      ['party', lists.parties, t.party_id],
    ];
    for (const [k, arr, id] of nameCheck) {
      if (id == null) continue;
      const here = arr.find((x) => x.id === id)?.name;
      if (!here || (_names[k] && here.toLowerCase() !== _names[k]!.toLowerCase())) {
        reasons.push(`${k}: "${_names[k]}" in the holder's file is "${here ?? 'missing'}" here`);
      }
    }
    const { errors } = validateTrx(t, { lists, rows: [...rows, ...added], closedMonths: closed, today: '9999-12-31' });
    reasons.push(...errors.map((e) => e.en));
    if (reasons.length) {
      t.review = reasons.join(' | ');
      toReview++;
    }
    added.push(t);
    stmts.push(insertTrxStmt(t));
  }

  stmts.push(auditStmt(who, 'import_entries', 'trx', null, null, { file: fileName, added: added.length, skipped: skipped.length }));
  stmts.push({
    sql: 'INSERT INTO import_log (at, who, kind, file_name, added, skipped, detail) VALUES (?,?,?,?,?,?,?)',
    params: [nowIso(), who, 'entries', fileName, added.length, skipped.length, JSON.stringify({ book: book.name, skipped, toReview })],
  });
  await db.batch(stmts);
  return { added: added.length, skipped, toReview, book: book.name };
}

// ---------------------------------------------------------------- lists package

const LIST_TABLES = ['city', 'account', 'project', 'party', 'book', 'heading', 'heading_type', 'budget_line'] as const;

export interface ListsPackage {
  kind: typeof LISTS;
  version: 1;
  lists_version: string;
  organisation: string | null;
  tables: Record<(typeof LIST_TABLES)[number], Record<string, unknown>[]>;
  settings: { key: string; value: string | null }[];
  /** transfers the office booked, per book id: what the holder should have received */
  transfers: Record<string, { date: string | null; trf_syp: number; trf_usd: number; explanation: string | null; n: number | null }[]>;
}

export async function exportListsPackage(db: Db, who: string): Promise<ListsPackage> {
  const tables = {} as ListsPackage['tables'];
  for (const t of LIST_TABLES) tables[t] = await db.query(`SELECT * FROM ${t}`);
  const settings = await db.query<{ key: string; value: string | null }>('SELECT key, value FROM setting');
  const transfers: ListsPackage['transfers'] = {};
  for (const r of await db.query<Trx>("SELECT * FROM trx WHERE type = 'Transfer' ORDER BY date")) {
    const k = String(r.book_id);
    (transfers[k] ??= []).push({ date: r.date, trf_syp: r.trf_syp, trf_usd: r.trf_usd, explanation: r.explanation, n: r.n });
  }
  const version = nowIso();
  await db.batch([setMetaStmt('lists_version', version), auditStmt(who, 'export_lists', 'meta', null, null, { version })]);
  return {
    kind: LISTS,
    version: 1,
    lists_version: version,
    organisation: (await one<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'organisation'"))?.value ?? null,
    tables,
    settings,
    transfers,
  };
}

export function listsFileName() {
  return `lists-${today()}.json`;
}

export function parseListsPackage(text: string): ListsPackage {
  let p: ListsPackage;
  try {
    p = JSON.parse(text);
  } catch {
    throw new UserError(m('الملف ليس حزمة قوائم صالحة', 'This is not a valid lists package'));
  }
  if (p.kind !== LISTS) throw new UserError(m('الملف ليس حزمة قوائم من المكتب', 'This is not a lists package from the office'));
  return p;
}

/**
 * Holder side: bring my lists in line with the office. Values are matched by id
 * (they all come from the office), updated in place, and a value the office no
 * longer sends is deactivated — never deleted, my rows may use it.
 */
export async function applyListsPackage(db: Db, p: ListsPackage, who: string): Promise<void> {
  const stmts: Stmt[] = [];
  for (const t of LIST_TABLES) {
    const rows = p.tables[t] ?? [];
    if (t === 'heading_type') {
      stmts.push({ sql: 'DELETE FROM heading_type' });
      for (const r of rows) stmts.push({ sql: 'INSERT INTO heading_type (heading_id, type) VALUES (?, ?)', params: [r.heading_id as number, r.type as string] });
      continue;
    }
    const ids = rows.map((r) => r.id as number);
    if (ids.length) stmts.push({ sql: `UPDATE ${t} SET active = 0 WHERE id NOT IN (${ids.map(() => '?').join(',')})`, params: ids });
    for (const r of rows) {
      const cols = Object.keys(r);
      stmts.push({
        sql: `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
              ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
        params: cols.map((c) => r[c] as string | number | null),
      });
    }
  }
  stmts.push({ sql: 'DELETE FROM setting' });
  for (const s of p.settings) stmts.push({ sql: 'INSERT INTO setting (key, value) VALUES (?, ?)', params: [s.key, s.value] });
  stmts.push(setMetaStmt('lists_version', p.lists_version));
  stmts.push(setMetaStmt('office_transfers', JSON.stringify(p.transfers)));
  if (p.organisation) stmts.push(setMetaStmt('organisation', p.organisation));
  stmts.push(auditStmt(who, 'import_lists', 'meta', null, null, { version: p.lists_version }));
  // Order matters for foreign keys: parents (city, account, heading) come first in LIST_TABLES.
  await db.batch([{ sql: 'PRAGMA defer_foreign_keys = ON' }, ...stmts]);
}
