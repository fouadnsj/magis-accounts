// Bringing a Comptapro FDC workbook (a Jesuit's monthly sheets) into a book.
// The FDC holds one total per line and per month, not the individual expenses, so
// each filled cell becomes one entry dated the last day of its month.
//  - "Reçu de l'Econome" (row 4)  → money from the econome's cash to this book (taken as received);
//  - "Rendu à l'Econome" (row 47) → money from this book back to the econome's cash;
//  - income rows 8–13 and expense rows 17–44 → entries on the line of the chart (FDC_ROWS);
//  - "Entré / Sorti par change" (rows 5 / 48) → one exchange, when the month has one of each;
//  - October's "Report" (row 3) → the book's opening, if the book has nothing before.
// Each cell is remembered by its place (source), so importing the same sheet twice adds nothing.

import ExcelJS from 'exceljs';
import type { Db, Stmt } from '../db/db';
import { nowIso, one, uuid } from '../db/db';
import { auditStmt } from '../db/repo';
import { m, type Msg } from '../i18n';
import { FDC_MONTHS, FDC_ROWS } from './chart';
import { r2, type CtyEntry, type Cur } from './domain';
import { writeEntryStmts, loadAccounts, loadBooks } from './repo';

export interface FdcImportResult {
  /** the name written at the top of the sheet (C1), to check it is the right person */
  name: string | null;
  added: number;
  skipped: number;
  problems: Msg[];
}

const COLS: [string, Cur][] = [['C', 'LOC'], ['D', 'USD'], ['E', 'EUR']];

/** The number in a cell: typed, or the result Excel computed for a formula. */
function num(cell: ExcelJS.Cell): number {
  const v = cell.value as unknown;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'result' in v && typeof (v as { result: unknown }).result === 'number') return (v as { result: number }).result;
  return 0;
}
function text(cell: ExcelJS.Cell): string | null {
  const v = cell.value as unknown;
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object' && 'result' in v && typeof (v as { result: unknown }).result === 'string') return ((v as { result: string }).result).trim() || null;
  return null;
}

/** YYYY-MM of the i-th tab (0 = October of `year`). */
const ymOf = (year: number, i: number) => {
  const mo = ((9 + i) % 12) + 1;
  return `${mo >= 10 ? year : year + 1}-${String(mo).padStart(2, '0')}`;
};
const lastDate = (ym: string) => {
  const [y, mo] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
};

export async function readFdc(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

export async function importFdc(db: Db, a: { bookId: number; year: number; bytes: Uint8Array; fileName: string; who: string }): Promise<FdcImportResult> {
  const wb = await readFdc(a.bytes);
  const books = await loadBooks(db);
  const book = books.find((b) => b.id === a.bookId);
  if (!book) throw new Error('unknown book');
  const cash = books.find((b) => b.cty_kind === 'cash' && b.active);
  const codes = new Map((await loadAccounts(db)).map((x) => [x.code, x.id]));
  const problems: Msg[] = [];
  const rows: CtyEntry[] = [];
  const at = nowIso();
  const base = (ym: string, src: string): CtyEntry => ({
    id: uuid(), n: null, book_id: a.bookId, date: lastDate(ym), type: 'Exp', account_id: null, cur: 'LOC', amount: 0,
    cur2: null, amount2: null, to_book_id: null, note: null, claim: null, claim_note: null,
    received_at: null, received_by: null, disputed_at: null, dispute_note: null,
    source: `fdc:b${a.bookId}:y${a.year}:${src}`, approval_needed: 0, approval_usd: null, approved_at: null, approved_by: null, created_at: at, created_by: a.who, updated_at: null,
  });

  const missing = FDC_MONTHS.filter((t) => !wb.getWorksheet(t));
  if (missing.length) throw new Error(`Not a Comptapro FDC workbook: no tab ${missing.join(', ')}`);
  const name = text(wb.getWorksheet('Oct')!.getCell('C1'));

  FDC_MONTHS.forEach((tab, i) => {
    const ws = wb.getWorksheet(tab)!;
    const ym = ymOf(a.year, i);
    const where = (cell: string) => `${tab}!${cell}`;
    const exIn: [Cur, number, string][] = [];
    const exOut: [Cur, number, string][] = [];
    for (const [col, cur] of COLS) {
      const v = (row: number) => r2(num(ws.getCell(`${col}${row}`)));
      // from the econome / back to the econome
      for (const [row, dir] of [[4, 1], [47, -1]] as const) {
        const x = v(row) * dir;
        if (!x) continue;
        if (!cash) { problems.push(m(`${where(col + row)}: لا صندوق للقيم`, `${where(col + row)}: no econome cash book`, `${where(col + row)} : pas de caisse de l'économe`)); continue; }
        if (x < 0) { problems.push(m(`${where(col + row)}: إشارة خاطئة`, `${where(col + row)}: wrong sign`, `${where(col + row)} : mauvais signe`)); continue; }
        rows.push({
          ...base(ym, where(col + row)), type: 'Transfer', cur, amount: x,
          book_id: dir === 1 ? cash.id : a.bookId, to_book_id: dir === 1 ? a.bookId : cash.id,
          received_at: at, received_by: 'import', note: dir === 1 ? "Reçu de l'Econome (FDC)" : "Rendu à l'Econome (FDC)",
        });
      }
      for (const { row, code } of FDC_ROWS) {
        const x = v(row);
        if (!x) continue;
        const accountId = codes.get(code);
        if (accountId == null) { problems.push(m(`${where(col + row)}: الرمز ${code} غير موجود`, `${where(col + row)}: code ${code} not in the chart`, `${where(col + row)} : code ${code} absent du plan`)); continue; }
        const isIncome = row <= 13;
        if (isIncome ? x < 0 : x > 0) { problems.push(m(`${where(col + row)}: إشارة خاطئة`, `${where(col + row)}: wrong sign`, `${where(col + row)} : mauvais signe`)); continue; }
        rows.push({ ...base(ym, where(col + row)), type: isIncome ? 'Income' : 'Exp', account_id: accountId, cur, amount: Math.abs(x) });
      }
      if (v(5) > 0) exIn.push([cur, v(5), col + 5]);
      if (v(48) < 0) exOut.push([cur, -v(48), col + 48]);
      if (v(5) < 0 || v(48) > 0) problems.push(m(`${tab}: إشارة خاطئة في الصرافة`, `${tab}: wrong sign in an exchange`, `${tab} : mauvais signe dans un change`));
    }
    if (exIn.length === 1 && exOut.length === 1 && exIn[0][0] !== exOut[0][0]) {
      rows.push({ ...base(ym, where(exOut[0][2])), type: 'Exchange', cur: exOut[0][0], amount: exOut[0][1], cur2: exIn[0][0], amount2: exIn[0][1], note: 'Change (FDC)' });
    } else if (exIn.length || exOut.length) {
      problems.push(m(`${tab}: الصرافة غير واضحة، أدخلها يدوياً`, `${tab}: the exchange cannot be matched, enter it by hand`, `${tab} : le change ne peut être apparié, saisissez-le à la main`));
    }
  });

  // October's carried-over amount: the opening of the book, if nothing came before
  const stmts: Stmt[] = [];
  const oct = wb.getWorksheet('Oct')!;
  const opening = COLS.map(([col]) => r2(num(oct.getCell(`${col}3`))));
  if (opening.some((x) => x !== 0)) {
    const earlier = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM cty_entry WHERE (book_id = ? OR to_book_id = ?) AND date < ?', [a.bookId, a.bookId, `${a.year}-10-01`]);
    const same = opening[0] === book.opening_syp && opening[1] === book.opening_usd && opening[2] === book.opening_eur;
    if (!earlier?.n && !same) {
      stmts.push({ sql: 'UPDATE book SET opening_syp = ?, opening_usd = ?, opening_eur = ? WHERE id = ?', params: [...opening, a.bookId] });
      stmts.push(auditStmt(a.who, 'edit', 'book', String(a.bookId), { opening: [book.opening_syp, book.opening_usd, book.opening_eur] }, { opening, from: a.fileName }));
    } else if (!same) {
      problems.push(m('رصيد تشرين الأول لا يساوي ما في الدفتر', "October's carried-over amount differs from the book", 'Le report d’octobre diffère du compte'));
    }
  }

  const known = new Set((await db.query<{ source: string }>('SELECT source FROM cty_entry WHERE source LIKE ?', [`fdc:b${a.bookId}:y${a.year}:%`])).map((r) => r.source));
  const fresh = rows.filter((r) => !known.has(r.source!));
  for (const r of fresh) stmts.push(...writeEntryStmts(r, true));
  stmts.push({
    sql: 'INSERT INTO import_log (at, who, kind, file_name, added, skipped) VALUES (?, ?, ?, ?, ?, ?)',
    params: [at, a.who, 'fdc', a.fileName, fresh.length, rows.length - fresh.length],
  });
  await db.batch(stmts);
  return { name, added: fresh.length, skipped: rows.length - fresh.length, problems };
}
