// Brief §11: unit tests for validation, rate logic, export column order, duplicate-ID import.
import { describe, expect, it, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { migrate, type Db } from '../src/db/db';
import { blankTrx, loadLists, loadTrx, saveTrxRows, addLine, addHeading, saveBook } from '../src/db/repo';
import { applySeed, readWorkbook } from '../src/io/importWorkbook';
import { validateTrx } from '../src/domain/validate';
import { computeAll } from '../src/domain/compute';
import { exportWorkbook, TRX_HEADERS } from '../src/io/exportExcel';
import { applyListsPackage, exportEntries, exportListsPackage, importEntries } from '../src/io/keeperFiles';
import type { Lists, Trx } from '../src/domain/types';
import { nodeDb } from './nodeDb';

const WORKBOOK = decodeURIComponent(new URL('../../template/Master Sup.xlsx', import.meta.url).pathname);

let office: Db;
let lists: Lists;

beforeAll(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);
  office = nodeDb();
  await migrate(office);
  await applySeed(office, readWorkbook(wb), 'test', 'Master Sup.xlsx');
  lists = await loadLists(office);
});

const id = (arr: { id: number; name: string }[], name: string) => arr.find((x) => x.name === name)!.id;
const line = (heading: string, l: string) =>
  lists.lines.find((x) => x.name === l && x.heading_id === id(lists.headings, heading))!.id;

function expense(over: Partial<Trx> = {}): Trx {
  return {
    ...blankTrx(),
    city_id: id(lists.cities, 'Homs'),
    account_id: id(lists.accounts, 'Center'),
    book_id: id(lists.books, 'Roula'),
    date: '2026-10-01',
    type: 'Exp',
    heading_id: id(lists.headings, 'Operations'),
    line_id: line('Operations', 'Internet'),
    explanation: 'internet package',
    exp_syp: 5000,
    ...over,
  };
}

const ctx = () => ({ lists, rows: [] as Trx[], closedMonths: new Set<string>(), today: '2026-10-14' });
const errs = (t: Trx, c = ctx()) => validateTrx(t, c).errors.map((e) => e.en);

describe('validation — impossible to save', () => {
  it('a clean expense passes', () => expect(errs(expense())).toEqual([]));
  it('blank date', () => expect(errs(expense({ date: null }))).toContain('Date is required'));
  it('heading not matching type', () =>
    expect(errs(expense({ type: 'Income' }))).toContain('This heading does not belong to this type'));
  it('line not under heading', () =>
    expect(errs(expense({ line_id: line('Salary', 'Cleaner') }))).toContain('This line does not belong to this heading'));
  it('two amounts', () => expect(errs(expense({ exp_usd: 10 }))[0]).toMatch(/Only one amount/));
  it('no amount', () => expect(errs(expense({ exp_syp: 0 }))).toContain('Enter an amount'));
  it('amount in the wrong column', () => expect(errs(expense({ exp_syp: 0, inc_syp: 5000 }))[0]).toMatch(/wrong column/));
  it('expense without explanation', () => expect(errs(expense({ explanation: ' ' }))).toContain('Explanation is required for an expense'));
  it('transfer booked on Main (one-legged)', () =>
    expect(
      errs(expense({ type: 'Transfer', book_id: id(lists.books, 'Main'), heading_id: id(lists.headings, 'Other / Unallocated'), line_id: line('Other / Unallocated', 'Unallocated'), exp_syp: 0, trf_syp: 1000 })),
    ).toContain("A transfer is booked on the keeper's book, not on Main"));
  it('closed month', () => {
    const c = ctx();
    c.closedMonths.add('2026-10');
    expect(errs(expense(), c)).toContain('Month 2026-10 is closed');
  });
  it('exchange far from the last rate warns "check the zeros"', () => {
    const rows = [expense({ id: 'x1', type: 'Exchange', heading_id: id(lists.headings, 'Exchange'), line_id: line('Exchange', 'Currency exchange'), exp_syp: 0, trf_syp: 130000, trf_usd: 1000, date: '2026-09-01' })];
    const t = expense({ type: 'Exchange', heading_id: id(lists.headings, 'Exchange'), line_id: line('Exchange', 'Currency exchange'), exp_syp: 0, trf_syp: 1300000, trf_usd: 1000 });
    const r = validateTrx(t, { ...ctx(), rows });
    expect(r.errors).toEqual([]);
    expect(r.warnings[0].en).toMatch(/check the zeros/);
  });
});

describe('rate logic', () => {
  it('same book first, then any book, then fallback', () => {
    const ex = (bookName: string, date: string, syp: number, usd: number) =>
      expense({ id: `${bookName}${date}`, book_id: id(lists.books, bookName), type: 'Exchange', exp_syp: 0, trf_syp: syp, trf_usd: usd, date });
    const rows = [
      ex('Main', '2026-01-10', 140000, 1000),
      ex('Roula', '2026-01-05', 130000, 1000),
      ex('Roula', '2026-01-05', 132000, 1000), // same day: averaged
      expense({ id: 'a', date: '2026-01-20' }), // Roula → her latest: avg(130,132) = 131
      expense({ id: 'b', date: '2026-01-20', book_id: id(lists.books, 'Nagham') }), // no Nagham exchange → latest any book = Main 140
      expense({ id: 'c', date: '2026-01-01' }), // before any exchange → fallback
    ];
    const c = computeAll(rows, lists);
    expect(c.get('a')!.rate).toBe(131);
    expect(c.get('b')!.rate).toBe(140);
    expect(c.get('c')!.rate).toBe(lists.settings.usd_rate);
    expect(c.get('a')!.expUsdTot).toBeCloseTo(5000 / 131, 9);
  });
});

describe('lists', () => {
  it('a new budget line gets the next code of its heading and never renumbers', async () => {
    const before = (await loadLists(office)).lines.find((l) => l.name === 'Internet')!.code;
    await addLine(office, id(lists.headings, 'Operations'), 'Water', 'test');
    const after = await loadLists(office);
    expect(after.lines.find((l) => l.name === 'Water')!.code).toBe('E03.10');
    expect(after.lines.find((l) => l.name === 'Internet')!.code).toBe(before);
  });
  it('a new heading gets the next code of its type', async () => {
    await addHeading(office, 'Youth camp', ['Exp'], 'test');
    expect((await loadLists(office)).headings.find((h) => h.name === 'Youth camp')!.code).toBe('E17');
  });
});

describe('Excel export', () => {
  it('TRX columns exactly in the brief order, as a Table named TRX', async () => {
    const rows = await loadTrx(office);
    const bytes = await exportWorkbook(rows, computeAll(rows, lists), lists, {
      period: null, bookId: null, accountId: null, registerOnly: false, withLists: true, withReports: true,
      confidential: true, grants: [], organisation: null,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.getWorksheet('Transactions')!;
    const head = (ws.getRow(2).values as unknown[]).slice(1);
    expect(head).toEqual([...TRX_HEADERS]);
    expect(Object.keys((ws as unknown as { tables: object }).tables)).toEqual(['TRX']);
    expect(ws.rowCount).toBe(2 + rows.length);
  });
});

describe('holder ↔ office files', () => {
  it('importing the same entries file twice adds nothing and lists the skipped IDs', async () => {
    // Holder install, fed by the office lists package
    const holder = nodeDb();
    await migrate(holder);
    const pkg = await exportListsPackage(office, 'com');
    await applyListsPackage(holder, JSON.parse(JSON.stringify(pkg)), 'roula');
    const hl = await loadLists(holder);
    expect(hl.lines.length).toBe((await loadLists(office)).lines.length);

    const roula = id(hl.books, 'Roula');
    await saveTrxRows(holder, [expense({ book_id: roula }), expense({ book_id: roula, exp_syp: 7000 })], 'roula', false);
    const { file } = await exportEntries(holder, roula, 'roula');
    expect(file.rows.length).toBe(2);
    expect((await loadTrx(holder)).every((r) => r.sent_at)).toBe(true);

    const text = JSON.stringify(file);
    const first = await importEntries(office, text, 'Roula-entries.json', 'com');
    expect(first.added).toBe(2);
    expect(first.skipped).toEqual([]);
    const second = await importEntries(office, text, 'Roula-entries.json', 'com');
    expect(second.added).toBe(0);
    expect(second.skipped.sort()).toEqual(file.rows.map((r) => r.id).sort());
  });

  it('a new book is immediately available', async () => {
    await saveBook(office, { name: 'Maya', keeper_name: 'مايا' }, 'test');
    expect((await loadLists(office)).books.some((b) => b.name === 'Maya')).toBe(true);
  });
});
