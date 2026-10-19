// The juge of the community databases: Fouad's real Comptapro FDC (Oct–Dec 2025),
// brought into a community database, must give EXACTLY what Excel computed, cell
// by cell: every month tab (carried over, received, income, expenses, totals, kept)
// and every formula of the "Total" tab. If this fails, the program is wrong, not Excel.
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import type { Db } from '../src/db/db';
import { importFdc } from '../src/community/importFdc';
import { loadAccounts, loadBooks, loadEntries } from '../src/community/repo';
import { FDC_MONTHS, FDC_ROWS } from '../src/community/chart';
import { monthSheet, yearSheet, monthsOfYear, type Cur, type CtyBook, type CtyEntry, type Sheet } from '../src/community/domain';
import { nodeDb } from './nodeDb';
import { makeCommunity } from './ctyHelpers';

const FILE = decodeURIComponent(new URL('../../Cty/FN-Comptapro-FDC.xlsx', import.meta.url).pathname);
const YEAR = 2025; // the sheet's October is October 2025 (Fouad, 18 October 2026)
const COLS: [string, Cur][] = [['C', 'LOC'], ['D', 'USD'], ['E', 'EUR']];

let db: Db;
let wb: ExcelJS.Workbook;
let book: CtyBook;
let entries: CtyEntry[];
let codeId: Map<string, number>;
let result: Awaited<ReturnType<typeof importFdc>>;

const num = (c: ExcelJS.Cell) => {
  const v = c.value as unknown;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'result' in v && typeof (v as { result: unknown }).result === 'number') return (v as { result: number }).result;
  return 0;
};

/** What the program says for a row of a FDC month tab, in one currency. */
function programValue(s: Sheet, row: number, cur: Cur): number | undefined {
  const line = FDC_ROWS.find((x) => x.row === row);
  if (line) return (row <= 13 ? s.income : s.expenses).get(codeId.get(line.code)!)?.[cur] ?? 0;
  const fixed: Record<number, (s: Sheet) => number> = {
    3: (s) => s.carried[cur], 4: (s) => s.received[cur], 5: (s) => s.inByExchange[cur], 14: (s) => s.totalIncome[cur],
    45: (s) => s.totalExpenses[cur], 47: (s) => s.givenBack[cur], 48: (s) => s.outByExchange[cur], 49: (s) => s.kept[cur],
  };
  return fixed[row]?.(s);
}

beforeAll(async () => {
  db = nodeDb();
  await makeCommunity(db, 'Test community', ['Superior', 'Econome', 'FN'], { superior: 'Superior', econome: 'Econome', minister: 'Econome', admin: 'Superior' });
  book = (await loadBooks(db)).find((b) => b.name === 'FN')!;
  const bytes = new Uint8Array(readFileSync(FILE));
  result = await importFdc(db, { bookId: book.id, year: YEAR, bytes, fileName: 'FN-Comptapro-FDC.xlsx', who: 'test' });
  entries = await loadEntries(db);
  codeId = new Map((await loadAccounts(db)).map((a) => [a.code, a.id]));
  wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
});

describe('juge — Comptapro FDC (Oct–Dec 2025)', () => {
  it('imports without problems', () => {
    expect(result.problems).toEqual([]);
    expect(result.added).toBeGreaterThan(0);
  });

  it('every month tab: each cell equals Excel', () => {
    const months = monthsOfYear(YEAR);
    let checked = 0;
    FDC_MONTHS.forEach((tab, i) => {
      const ws = wb.getWorksheet(tab)!;
      const s = monthSheet(entries, book, months[i]);
      for (const row of [3, 4, 5, 14, 45, 47, 48, 49, ...FDC_ROWS.map((x) => x.row)]) {
        for (const [col, cur] of COLS) {
          expect(programValue(s, row, cur), `${tab}!${col}${row}`).toBe(num(ws.getCell(`${col}${row}`)));
          checked++;
        }
      }
    });
    expect(checked).toBe(12 * 42 * 3);
  });

  it('the "Total" tab: each formula equals Excel', () => {
    const ws = wb.getWorksheet('Total')!;
    const s = yearSheet(entries, book, YEAR);
    let checked = 0;
    ws.eachRow((r) => r.eachCell((cell) => {
      const f = (cell.value as { formula?: string } | null)?.formula;
      if (!f || !['C', 'D', 'E'].includes(cell.address[0])) return;
      const cur = COLS.find(([c]) => c === cell.address[0])![1];
      // "Oct!C17+Nov!C17+…" adds a month row over the year; "C4+C5+…" is the kept line
      const ref = /^Oct!([CDE])(\d+)/.exec(f);
      if (ref && Number(ref[2]) === 1) return; // the name (Oct!C1), not a number
      const row = ref ? Number(ref[2]) : 49;
      const mine = row === 3 ? s.carried[cur] : programValue(s, row, cur);
      expect(mine, `Total!${cell.address} (${f.slice(0, 20)}…)`).toBe(num(cell));
      checked++;
    }));
    expect(checked).toBeGreaterThan(100);
  });

  it('the known figures', () => {
    const s = yearSheet(entries, book, YEAR);
    expect(s.received).toEqual({ LOC: 4150000, USD: 100, EUR: 0 });
    expect(s.totalExpenses).toEqual({ LOC: -4150000, USD: -100, EUR: 0 });
    expect(monthSheet(entries, book, '2025-10').kept.LOC).toBe(750000);
    expect(monthSheet(entries, book, '2025-12').kept).toEqual({ LOC: 0, USD: 0, EUR: 0 });
  });

  it('importing the same sheet again adds nothing', async () => {
    const again = await importFdc(db, { bookId: book.id, year: YEAR, bytes: new Uint8Array(readFileSync(FILE)), fileName: 'FN-Comptapro-FDC.xlsx', who: 'test' });
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(result.added);
    expect((await loadEntries(db)).length).toBe(entries.length);
  });
});
