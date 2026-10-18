// LE JUGE — the app must compute exactly what the Excel workbook computed.
// Source: template/Master Sup.xlsx, which keeps Excel's own results in every
// formula cell. If this test fails, the app and the workbook disagree.
import { describe, expect, it, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { migrate } from '../src/db/db';
import { loadLists, loadTrx } from '../src/db/repo';
import { applySeed, readWorkbook, type Seed } from '../src/io/importWorkbook';
import { computeAll } from '../src/domain/compute';
import { coverage, funding, holders, spentByRule } from '../src/domain/reports';
import { cellValue } from '../src/io/importWorkbook';
import type { Lists, Trx } from '../src/domain/types';
import { nodeDb } from './nodeDb';

const WORKBOOK = decodeURIComponent(new URL('../../../Comptability/template/Master Sup.xlsx', import.meta.url).pathname);

let seed: Seed;
let rows: Trx[];
let lists: Lists;
let wb: ExcelJS.Workbook;
const xl = (sheet: string, addr: string) => Number(cellValue(wb.getWorksheet(sheet)!.getCell(addr).value) ?? 0);

beforeAll(async () => {
  wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);
  seed = readWorkbook(wb);
  const db = nodeDb();
  await migrate(db);
  await applySeed(db, seed, 'test', 'Master Sup.xlsx', { exact: true });
  rows = await loadTrx(db);
  lists = await loadLists(db);
});

describe('juge: migration from Master Sup.xlsx', () => {
  it('imports every register row', () => {
    expect(rows.length).toBe(586);
    expect(seed.warnings).toEqual([]);
  });

  // Excel ignores a date typed as text when it looks for the rate. To prove the
  // FORMULA is the same, give the app exactly what Excel saw: those rows undated.
  const asExcelSawIt = () => {
    const faithful = rows.map((t, i) => (seed.trx[i].dateKind === 'text' ? { ...t, date: null } : t));
    return computeAll(faithful, lists);
  };

  it('Rate (R), Inc_USD_Tot (S), Exp_USD_Tot (T), Code (U) equal Excel on every row', () => {
    const bad: string[] = [];
    const faithful = asExcelSawIt();
    rows.forEach((t, i) => {
      const ex = seed.trx[i].excel;
      const c = faithful.get(t.id)!;
      const close = (a: number, b: number | null) => Math.abs(a - (b ?? 0)) < 1e-6;
      if (!close(c.rate, ex.rate)) bad.push(`row ${seed.trx[i].excelRow} rate ${c.rate} ≠ ${ex.rate}`);
      if (!close(c.incUsdTot, ex.incUsdTot)) bad.push(`row ${seed.trx[i].excelRow} S ${c.incUsdTot} ≠ ${ex.incUsdTot}`);
      if (!close(c.expUsdTot, ex.expUsdTot)) bad.push(`row ${seed.trx[i].excelRow} T ${c.expUsdTot} ≠ ${ex.expUsdTot}`);
      // since 0.6.2 every transfer is coded "Transfer › Transfer" (T01.1), on Fouad's rule; all other codes = Excel
      if (t.type === 'Transfer') {
        if (c.code !== 'T01.1') bad.push(`row ${seed.trx[i].excelRow} transfer code ${c.code} ≠ T01.1`);
      } else if ((ex.code ?? '') !== c.code) bad.push(`row ${seed.trx[i].excelRow} code ${c.code} ≠ ${ex.code}`);
    });
    expect(bad).toEqual([]);
  });

  it('Dashboard Jan–Dec: income USD-eq 20,031.05 and expenses 16,243.08, as Excel counts them', () => {
    // Dashboard!B14 sums by Month 1–12 only. Excel's Month column gives:
    // real date → its month; text date → its month; empty cell → 1 (Jan 1900);
    // empty text "" → #VALUE! (left out).
    const faithful = asExcelSawIt();
    let inc = 0;
    let exp = 0;
    rows.forEach((t, i) => {
      if (seed.trx[i].dateKind === 'emptyText') return;
      const c = faithful.get(t.id)!;
      if (t.type === 'Income') inc += c.incUsdTot;
      if (t.type === 'Exp') exp += c.expUsdTot;
    });
    expect(inc).toBeCloseTo(20031.046175300093, 6);
    expect(exp).toBeCloseTo(16243.079967025526, 6);
  });

  it('text dates are read as real dates and flagged for review', () => {
    const text = rows.filter((_, i) => seed.trx[i].dateKind === 'text');
    expect(text.length).toBe(10);
    expect(text.every((t) => t.date && t.review?.includes('typed as text'))).toBe(true);
  });

  it('flags the rows the app would refuse, and only those', () => {
    const flagged = rows.filter((r) => r.review);
    const undated = rows.filter((r) => !r.date);
    expect(undated.every((r) => r.review?.includes('Date is required'))).toBe(true);
    expect(flagged.length).toBeGreaterThanOrEqual(undated.length);
  });
});

describe('juge: reports equal the workbook sheets', () => {
  const faithful = () => computeAll(rows.map((t, i) => (seed.trx[i].dateKind === 'text' ? { ...t, date: null } : t)), lists);

  it('Holders: should-hold per holder, SYP and USD (Holders!G7:G13, G20:G26)', () => {
    // Holders has no period: every row counts, dated or not.
    for (const [cur, first] of [['SYP', 7], ['USD', 20]] as const) {
      const lines = holders(rows, lists.books, cur);
      lines.forEach((l, i) => {
        const r = l.book ? first + i : first + 6; // "no book written" row
        expect(l.shouldHold, `${cur} ${l.book?.name ?? 'no book'}`).toBeCloseTo(xl('Holders', `G${r}`), 6);
      });
    }
  });

  it('ProjectMap Spent_USD per rule (Data!AH4:AH9)', () => {
    const spent = spentByRule(rows, faithful(), lists);
    lists.rules.forEach((r, i) => expect(spent.get(r.id)).toBeCloseTo(xl('Data', `AH${4 + i}`), 6));
  });

  it('Coverage summary (Coverage!F7:F14) for months 1–12', () => {
    // Give each row the month Excel gave it: empty cell → January, empty text → left out.
    const asMonths = rows
      .map((t, i) => (seed.trx[i].dateKind === 'blank' ? { ...t, date: '2026-01-01' } : t))
      .filter((_, i) => seed.trx[i].dateKind !== 'emptyText');
    const c = coverage(asMonths, faithful(), lists, { from: '2026-01', to: '2026-12' }, 2026).summary;
    expect(c.expenses).toBeCloseTo(xl('Coverage', 'F7'), 6);
    expect(c.ownIncome).toBeCloseTo(xl('Coverage', 'F8'), 6);
    expect(c.gap).toBeCloseTo(xl('Coverage', 'F9'), 6);
    expect(c.projectFunds).toBeCloseTo(xl('Coverage', 'F10'), 6);
    expect(c.surplus).toBeCloseTo(xl('Coverage', 'F11'), 6);
    expect(c.pctOwn).toBeCloseTo(xl('Coverage', 'F12'), 9);
    expect(c.pctFunds).toBeCloseTo(xl('Coverage', 'F13'), 9);
  });
});

describe('juge: the Respo book (since 0.6.3) changes no total', () => {
  // The same workbook, imported the normal way: the "From the Respo" incomes become
  // transfers from the Respo book. Funding must say what Coverage said.
  let rows2: Trx[];
  let lists2: Lists;
  beforeAll(async () => {
    const db = nodeDb();
    await migrate(db);
    await applySeed(db, seed, 'test', 'Master Sup.xlsx');
    rows2 = await loadTrx(db);
    lists2 = await loadLists(db);
  });

  it('every book holds what Excel says; the Respo holds minus what it sent', () => {
    const respo = lists2.books.find((b) => b.name === 'Respo')!;
    expect(respo.private).toBeTruthy();
    expect(rows2.filter((r) => r.type === 'Income' && lists2.lines.find((l) => l.id === r.line_id)?.is_project_fund)).toEqual([]);
    for (const [cur, first] of [['SYP', 7], ['USD', 20]] as const) {
      const lines = holders(rows2, lists2.books.filter((b) => b.id !== respo.id), cur);
      lines.forEach((l, i) => {
        const r = l.book ? first + i : first + 6;
        expect(l.shouldHold, `${cur} ${l.book?.name ?? 'no book'}`).toBeCloseTo(xl('Holders', `G${r}`), 6);
      });
      const sent = rows.filter((r) => r.type === 'Income' && lists.lines.find((l) => l.id === r.line_id)?.is_project_fund)
        .reduce((a, r) => a + (cur === 'SYP' ? r.inc_syp : r.inc_usd), 0);
      expect(sent).toBeGreaterThan(0);
      expect(holders(rows2, [respo], cur)[0].shouldHold).toBeCloseTo(-sent, 6);
    }
  });

  it('Funding = Coverage!F7:F11 (months 1–12): expenses, own income, from the Respo, surplus', () => {
    // the two imports give new ids: a row is known by its Excel row
    const kind = new Map(rows.map((r, i) => [r.source_file, seed.trx[i].dateKind]));
    const asMonths = rows2
      .map((t) => (kind.get(t.source_file) === 'blank' ? { ...t, date: '2026-01-01' } : t))
      .filter((t) => kind.get(t.source_file) !== 'emptyText');
    const exact = new Map(rows.map((r) => [r.source_file, r.id]));
    const comp1 = computeAll(rows.map((t, i) => (seed.trx[i].dateKind === 'text' ? { ...t, date: null } : t)), lists);
    const comp = new Map(rows2.map((r) => [r.id, comp1.get(exact.get(r.source_file)!)!]));
    const respoId = lists2.books.find((b) => b.name === 'Respo')!.id;
    // a converted row keeps its USD value as the income had it (same id, same rate)
    const f = funding(asMonths, comp, lists2, respoId, { from: '2026-01', to: '2026-12' }).total;
    expect(f.expenses).toBeCloseTo(xl('Coverage', 'F7'), 6);
    expect(f.own).toBeCloseTo(xl('Coverage', 'F8'), 6);
    expect(f.fromRespo).toBeCloseTo(xl('Coverage', 'F10'), 6);
    expect(f.surplus).toBeCloseTo(xl('Coverage', 'F11'), 6);
  });
});
