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
      confidential: true, grants: [], grantParts: [], organisation: null,
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

describe('desktop app path (local operations)', () => {
  it('reads and saves through the same operations as the server', async () => {
    const { localApi } = await import('../src/ops');
    const mem = new Map<string, Uint8Array>();
    const files = {
      backupNow: async () => null, list: async () => [], restore: async () => undefined,
      docWrite: async (rel: string, b: Uint8Array) => void mem.set(rel, b), docRead: async (rel: string) => mem.get(rel)!, docExists: async (rel: string) => mem.has(rel),
    };
    const api = localApi({ db: office, profile: { id: 1, name: 'Com', role: 'com', book_id: null, active: 1, access_id: 2, access_name: 'Accountant', books: [], perms: ['register.view', 'register.edit', 'book.own', 'reports.summary'] }, who: 'Com (com)', install: 'office', files });
    const before = (await api.call('data')).rows.length;
    await api.call('trx.save', { rows: [expense({ exp_syp: 4321 })] });
    const after = await api.call('data');
    expect(after.rows.length).toBe(before + 1);
    expect(after.lists.donors).toEqual([]); // the accountant never receives the donors
    await expect(api.call('grant.save', { donor_id: 1, amount: 5, currency: 'USD', parts: [] })).rejects.toThrow(/Not allowed/);
  });
});

describe('cash month by month', () => {
  it('the end of a month is the start of the next, and the last end equals the total', async () => {
    const { holders, holdersMonth, monthsOf } = await import('../src/domain/reports');
    const rows = (await loadTrx(office)).filter((r) => r.date); // dated rows only
    const L = await loadLists(office);
    const months = monthsOf(rows);
    for (const cur of ['SYP', 'USD'] as const) {
      let prev: number[] | null = null;
      for (const ym of months) {
        const ls = holdersMonth(rows, L.books, cur, ym);
        if (prev) ls.forEach((l, i) => expect(l.start).toBeCloseTo(prev![i], 6));
        prev = ls.map((l) => l.end);
      }
      const total = holders(rows, L.books, cur);
      total.forEach((t, i) => expect(prev![i]).toBeCloseTo(t.shouldHold, 6));
    }
  });
});

describe('budget arithmetic', () => {
  it('proposes from the 12 months before (as is, or scaled), shares lines between donors, follows the pace', async () => {
    const { proposeFromSpending, cover, effectivePct, followUp, paceOf, usedBand, prorateItems, itemTotal, contingencyOf } = await import('../src/domain/budget');
    const row = (id: string, date: string, usd: number, line = 7): Trx => ({ ...blankTrx(), id, date, type: 'Exp', account_id: 1, line_id: line, exp_usd: usd });
    const rows = [row('a', '2026-10-05', 100), row('b', '2026-11-05', 100), row('c', '2026-12-05', 100)];
    const comp = new Map(rows.map((r) => [r.id, { expUsdTot: r.exp_usd, incUsdTot: 0 } as never]));
    expect(proposeFromSpending(rows, comp, '2027-01', 12, { scale: false, pct: 0 })[0].amount_usd).toBe(300);
    expect(proposeFromSpending(rows, comp, '2027-01', 12, { scale: true, pct: 0 })[0].amount_usd).toBe(1200); // 3 months → 12
    expect(proposeFromSpending(rows, comp, '2027-01', 12, { scale: true, pct: 10 })[0].amount_usd).toBe(1320);
    expect(proposeFromSpending(rows, comp, '2027-01', 18, { scale: true, pct: 0 })[0].amount_usd).toBe(1800); // an 18-month budget

    // staff 13 months, for 6 months: 6.5
    const staff = { account_id: 1, line_id: 7, name: 'Director', unit: 'person', qty: 1, times: 13, unit_cost: 350, note: null };
    expect(prorateItems([staff], 6)[0].times).toBe(6.5);
    expect(itemTotal(prorateItems([staff], 6)[0])).toBe(2275);

    const amounts = [{ version_id: 1, account_id: 1, line_id: 7, amount_usd: 1000 }, { version_id: 1, account_id: 1, line_id: 8, amount_usd: 1000 }, { version_id: 1, account_id: 2, line_id: 7, amount_usd: 41730 }];
    const headingOf = new Map([[7, 3], [8, 4], [9, 3]]);
    const allocs = [
      { id: 1, budget_id: 1, donor_id: 1, account_id: 1, heading_id: null, line_id: null, pct: 50, amount_usd: null, rest: 0, status: 'promised' as const, note: null }, // whole account
      { id: 2, budget_id: 1, donor_id: 2, account_id: 1, heading_id: 3, line_id: null, pct: 30, amount_usd: null, rest: 0, status: 'requested' as const, note: null }, // heading 3
      { id: 3, budget_id: 1, donor_id: 3, account_id: 2, heading_id: null, line_id: null, pct: null, amount_usd: 10000, rest: 0, status: 'promised' as const, note: null }, // Belfast: $10,000 of furniture
    ];
    const eff = effectivePct(allocs, amounts, headingOf);
    const c = cover(allocs, eff, 1, 7, 3, 1000);
    expect(c.donors.map((d) => d.usd)).toEqual([500, 300]);
    expect(c.toFind).toBe(200);
    expect(cover(allocs, eff, 1, 8, 4, 1000).toFind).toBe(500); // heading 4: only the account's 50 %
    expect(Math.round(cover(allocs, eff, 2, 7, 3, 41730).covered)).toBe(10000);

    // pace: a 1200 budget for the year
    expect(paceOf(1200, 200, 1)).toBe('under'); // December, only 200 spent
    expect(paceOf(1200, 1250, 1)).toBe('over'); // more than the budget: uses the contingency
    expect(paceOf(1200, 1200, 1)).toBe('ontrack');
    expect(paceOf(1200, 900, 0.5)).toBe('ahead'); // 900 by June
    expect(paceOf(1200, 600, 0.5)).toBe('ontrack');
    expect(paceOf(0, 50, 0.5)).toBe('nobudget');
    expect([usedBand(0.3), usedBand(0.6), usedBand(0.8), usedBand(0.95), usedBand(1.2)]).toEqual([0, 50, 75, 90, 100]);

    // a budget from July for 6 months: by the end of September half of it is gone
    const version = { id: 1, start_ym: '2027-07', months: 6 };
    const later = [...rows, { ...row('d', '2027-08-01', 900), id: 'd' }, { ...row('e', '2027-08-01', 50, 9), id: 'e' }, { ...row('f', '2027-08-01', 70), id: 'f', account_id: 5 }];
    const comp2 = new Map([...comp, ['d', { expUsdTot: 900 } as never], ['e', { expUsdTot: 50 } as never], ['f', { expUsdTot: 70 } as never]]);
    const fu = followUp({ rows: later, comp: comp2, budget: version, upToYm: '2027-09', amounts: amounts.slice(0, 1), original: null, headingOf, outside: new Set([5]) });
    const l7 = fu.find((x) => x.line_id === 7)!;
    expect([l7.spent, l7.left, l7.used, l7.lastYear, l7.pace]).toEqual([900, 100, 0.9, 0, 'ahead']);
    expect(fu.find((x) => x.line_id === 9)!.pace).toBe('nobudget'); // spent without any budget: shown
    expect(fu.some((x) => x.account_id === 5)).toBe(false); // an account outside the centre (Deir)
    // SJ takes the rest, everywhere in the centre: what the other donors leave
    const sj = { id: 9, budget_id: 1, donor_id: 9, account_id: null, heading_id: null, line_id: null, pct: null, amount_usd: null, rest: 1, status: 'promised' as const, note: null };
    const withSj = [...allocs, sj];
    const eff2 = effectivePct(withSj, amounts, headingOf);
    const c7 = cover(withSj, eff2, 1, 7, 3, 1000);
    expect(c7.toFind).toBe(0);
    expect(c7.donors.find((d) => d.donor_id === 9)!.usd).toBe(200); // 50 % + 30 % by others → SJ 20 %
    expect(cover(withSj, eff2, 2, 7, 3, 41730).donors.find((d) => d.donor_id === 9)!.usd).toBeCloseTo(31730); // furniture: Belfast 10,000, SJ the rest

    // Harat: one amount for all its spending, whatever the line
    const { cellsOf, WHOLE } = await import('../src/domain/budget');
    const harat = [{ version_id: 1, account_id: 6, contingency_pct: 0, lump_usd: 5000 }];
    const hRows = [{ ...row('h1', '2027-08-01', 300, 7), account_id: 6 }, { ...row('h2', '2027-08-02', 200, 9), account_id: 6 }];
    const hComp = new Map([['h1', { expUsdTot: 300 } as never], ['h2', { expUsdTot: 200 } as never]]);
    const hf = followUp({ rows: hRows, comp: hComp, budget: version, upToYm: '2027-09', amounts: [], original: null, headingOf, outside: new Set(), accounts: harat });
    expect(hf).toHaveLength(1);
    expect(hf[0]).toMatchObject({ account_id: 6, line_id: WHOLE, budget: 5000, spent: 500 });
    const undp = { id: 10, budget_id: 1, donor_id: 7, account_id: 6, heading_id: null, line_id: null, pct: 100, amount_usd: null, rest: 0, status: 'promised' as const, note: null };
    const cells = cellsOf([], harat);
    expect(cover([undp, sj], effectivePct([undp, sj], cells, headingOf), 6, WHOLE, WHOLE, 5000).donors.map((d) => d.usd)).toEqual([5000, 0]);

    const cont = contingencyOf([{ ...l7, spent: 1100 }], [{ version_id: 1, account_id: 1, contingency_pct: 10, lump_usd: null }]).get(1)!;
    expect([cont.reserve, cont.used]).toEqual([100, 100]);
  });

  it('reads MAGIS 2027 Budget.xlsx exactly: Homs 71,710 + 10 %, furniture 41,730', async () => {
    const { readBudgetSheet, itemTotal, guessLine } = await import('../src/domain/budget');
    const file = decodeURIComponent(new URL('../../template/MAGIS 2027 Budget.xlsx', import.meta.url).pathname);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const grid = (name: string) => {
      const ws = wb.getWorksheet(name)!;
      const out: (string | number | null)[][] = [];
      ws.eachRow({ includeEmpty: true }, (r, i) => {
        const vals: (string | number | null)[] = [];
        for (let c = 1; c <= ws.columnCount; c++) {
          const v = r.getCell(c).value as unknown;
          vals.push(v == null ? null : typeof v === 'object' ? ((v as { result?: unknown }).result as number ?? ((v as { richText?: { text: string }[] }).richText?.map((x) => x.text).join('') ?? null)) : (v as string | number));
        }
        out[i - 1] = vals;
      });
      return out;
    };
    const homs = readBudgetSheet('Homs 2027', grid('Homs 2027'));
    const sum = (xs: { qty: number; times: number; unit_cost: number }[]) => xs.reduce((s, i) => s + itemTotal(i), 0);
    expect(sum(homs.items)).toBe(71710);
    expect(homs.sheetBase).toBe(71710);
    expect(homs.contingencyPct).toBe(10);
    expect(homs.items.length).toBe(25);
    expect(homs.items.every((i) => Math.abs(itemTotal(i) - i.total) < 0.01)).toBe(true);
    const furn = readBudgetSheet('Homs Furniture 2027', grid('Homs Furniture 2027'));
    expect(sum(furn.items)).toBe(41730);
    expect(furn.contingencyPct).toBe(0);
    expect(furn.items.length).toBe(13);

    // matching with the register's lines
    const headings = [{ id: 1, name: 'Salary' }, { id: 16, name: 'Furniture' }, { id: 5, name: 'Weekends & Retreats' }];
    const lines = [
      { id: 10, name: 'Coordinator', heading_id: 1, active: 1 }, { id: 11, name: 'Centre Director', heading_id: 1, active: 1 },
      { id: 20, name: 'Chairs', heading_id: 16, active: 1 }, { id: 21, name: 'Tables', heading_id: 16, active: 1 }, { id: 22, name: 'Screens for video projector *', heading_id: 16, active: 1 }, { id: 23, name: 'Library shelving units *', heading_id: 16, active: 1 },
      { id: 30, name: 'Weekend & spiritual retreats', heading_id: 5, active: 1 }, { id: 31, name: 'Transportation', heading_id: 5, active: 1 },
    ];
    expect(guessLine({ category: 'Staff', name: 'Workshop Coordinator' }, lines, headings)).toBe(10);
    expect(guessLine({ category: 'Staff', name: 'Centre Director' }, lines, headings)).toBe(11);
    expect(guessLine({ category: 'Theatre', name: 'Chairs, foldable' }, lines, headings, 'Furniture')).toBe(20);
    expect(guessLine({ category: 'Library', name: 'Study tables, foldable' }, lines, headings, 'Furniture')).toBe(21);
    expect(guessLine({ category: 'Library', name: 'Library shelving units *' }, lines, headings, 'Furniture')).toBe(23);
    expect(guessLine({ category: 'Weekends & Retreats', name: 'Spiritual retreats' }, lines, headings)).toBe(30);
  });
});

describe('donor report', () => {
  it("gives each donor his share of every expense he covers, with grants and missing documents", async () => {
    const { donorReportData, donorReportXlsx } = await import('../src/io/donorReport');
    const lists = {
      accounts: [{ id: 1, name: 'Center', active: 1 }, { id: 2, name: 'Furniture', active: 1 }, { id: 3, name: 'harat', active: 1 }, { id: 4, name: 'Deir', active: 1, outside_budget: 1 }],
      headings: [{ id: 10, name: 'Operations' }, { id: 16, name: 'Furniture' }],
      lines: [{ id: 100, heading_id: 10, name: 'Internet' }, { id: 160, heading_id: 16, name: 'Chairs' }],
      donors: [{ id: 1, name: 'UNDP' }, { id: 2, name: 'Belfast' }, { id: 3, name: 'SJ' }],
      projects: [], parties: [],
    } as never;
    const row = (id: string, acc: number, line: number, usd: number): Trx => ({ ...blankTrx(), id, date: '2027-03-01', type: 'Exp', account_id: acc, line_id: line, heading_id: line === 100 ? 10 : 16, exp_usd: usd });
    const rows = [row('a', 1, 100, 100), row('b', 2, 160, 4000), row('c', 3, 100, 300), row('d', 4, 100, 999)];
    const comp = new Map(rows.map((r) => [r.id, { expUsdTot: r.exp_usd, billCode: `B-${r.id}` } as never]));
    const base = {
      budget: { id: 1, name: '2027', start_ym: '2027-01', months: 12, carry_from_id: null }, organisation: 'MAGIS Homs', lists, rows, comp,
      amounts: [{ version_id: 1, account_id: 1, line_id: 100, amount_usd: 1200 }, { version_id: 1, account_id: 2, line_id: 160, amount_usd: 20000 }],
      accounts: [{ version_id: 1, account_id: 3, contingency_pct: 0, lump_usd: 5000 }],
      allocs: [
        { id: 1, budget_id: 1, donor_id: 1, account_id: 3, heading_id: null, line_id: null, pct: 100, amount_usd: null, rest: 0, status: 'promised' as const, note: null },
        { id: 2, budget_id: 1, donor_id: 2, account_id: 2, heading_id: null, line_id: null, pct: null, amount_usd: 10000, rest: 0, status: 'promised' as const, note: null },
        { id: 3, budget_id: 1, donor_id: 3, account_id: null, heading_id: null, line_id: null, pct: null, amount_usd: null, rest: 1, status: 'promised' as const, note: null },
      ],
      grants: [{ id: 'g', donor_id: 2, amount: 6000, currency: 'USD' as const, reference: null, note: null, status: 'hand' as const, promised_on: null, approved_on: null, transferred_on: null, bank_on: null, hand_on: '2027-02-01', hand_usd: 6000 }],
      docs: new Map([['b', ['B-b.pdf']]]),
    };
    const undp = donorReportData({ ...base, donorId: 1 });
    expect([undp.allocated, undp.spentShare, undp.lines.length]).toEqual([5000, 300, 1]); // Harat only, all of it
    const belfast = donorReportData({ ...base, donorId: 2 });
    expect([belfast.allocated, belfast.received, belfast.spentShare]).toEqual([10000, 6000, 2000]); // half of the furniture
    expect(belfast.lines[0].doc).toBe(true);
    const sj = donorReportData({ ...base, donorId: 3 });
    expect(sj.spentShare).toBe(100 + 2000); // the rest of Center and of Furniture; never Deir (outside)
    const bytes = await donorReportXlsx({ ...base, donorId: 2 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Grants', 'Expenses']);
    expect(wb.getWorksheet('Expenses')!.getRow(2).getCell(13).value).toBe('B-b.pdf');
  });
});

describe('budgets with their own period, overlapping', () => {
  it('names and months: a calendar year, or July for 18 months', async () => {
    const { defaultBudgetName, periodEnd, addMonths, periodShare, prorateItems } = await import('../src/domain/budget');
    expect(defaultBudgetName('2027-01', 12)).toBe('2027');
    expect(defaultBudgetName('2026-07', 18)).toBe('Jul 2026 – Dec 2027');
    expect(periodEnd({ start_ym: '2026-07', months: 18 })).toBe('2027-12');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(periodShare({ start_ym: '2026-07', months: 18 }, '2027-03')).toBeCloseTo(9 / 18);
    expect(prorateItems([{ account_id: 1, line_id: 1, name: 'x', unit: null, qty: 1, times: 13, unit_cost: 100, note: null }], 18)[0].times).toBe(19.5);
  });

  it('first in, first out: the first donation is finished, then the new one; the leftover is carried over', async () => {
    const { assignExpenses, leftoverOf, followUp } = await import('../src/domain/budget');
    const row = (id: string, date: string, usd: number, acc = 1): Trx => ({ ...blankTrx(), id, date, type: 'Exp', account_id: acc, line_id: 7, heading_id: 3, exp_usd: usd });
    // A: Jan–Dec 2027, 1000 on the line. B: from Oct 2027 for 12 months, 2000, continues A.
    const A = { budget: { id: 1, name: 'A', start_ym: '2027-01', months: 12, carry_from_id: null }, cells: [{ version_id: 1, account_id: 1, line_id: 7, amount_usd: 1000 }], lumped: new Set<number>() };
    const B = { budget: { id: 2, name: 'B', start_ym: '2027-10', months: 12, carry_from_id: 1 }, cells: [{ version_id: 2, account_id: 1, line_id: 7, amount_usd: 2000 }], lumped: new Set<number>() };
    const C = { budget: { id: 3, name: 'Harat', start_ym: '2027-01', months: 12, carry_from_id: null }, cells: [{ version_id: 3, account_id: 6, line_id: -1, amount_usd: 5000 }], lumped: new Set([6]) };
    const rows = [
      row('jan', '2027-01-10', 600), // A
      row('oct', '2027-10-05', 300), // A still has 400: A
      row('nov', '2027-11-05', 300), // A has 100 left (> 0): A, which goes over by 200
      row('dec', '2027-12-05', 250), // A is used up: B
      row('jan28', '2028-01-05', 100), // only B runs
      row('h', '2027-05-01', 70, 6), // Harat: its own budget, whatever the line
      row('x', '2027-05-01', 40, 9), // an account in no budget: none
    ];
    const comp = new Map(rows.map((r) => [r.id, { expUsdTot: r.exp_usd } as never]));
    const assigned = assignExpenses(rows, comp, [B, A, C]);
    expect(Object.fromEntries(assigned)).toEqual({ jan: 1, oct: 1, nov: 1, dec: 2, jan28: 2, h: 3 });
    expect(leftoverOf(A, rows, comp, assigned)).toBe(-200);
    expect(leftoverOf(B, rows, comp, assigned)).toBe(1650);
    // each expense counts once: B's follow-up sees only its own
    const headingOf = new Map([[7, 3]]);
    const fb = followUp({ rows, comp, budget: B.budget, upToYm: '2028-09', amounts: B.cells, original: null, headingOf, outside: new Set(), assigned });
    expect(fb.find((x) => x.line_id === 7)!.spent).toBe(350);
    const fa = followUp({ rows, comp, budget: A.budget, upToYm: '2027-12', amounts: A.cells, original: null, headingOf, outside: new Set(), assigned });
    expect(fa.find((x) => x.line_id === 7)!.spent).toBe(1200);
  });

  it('the budgets made before (one per year) become budgets with their period, with no loss', async () => {
    const { MIGRATIONS } = await import('../src/db/migrations');
    const { splitSql, migrate } = await import('../src/db/db');
    const db = nodeDb();
    await db.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
    for (const mg of MIGRATIONS.filter((x) => x.n <= 7)) {
      await db.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
    }
    await db.batch([
      { sql: "INSERT INTO account (id, name) VALUES (1, 'Center')" },
      { sql: "INSERT INTO donor (name) VALUES ('Belfast')" },
      { sql: "INSERT INTO budget_version (year, rev, rate_syp, rate_eur, start_month, months, created_at) VALUES (2026, 0, 130, 0.89, 7, 6, 'x'), (2027, 0, 130, 0.89, 1, 12, 'x'), (2027, 1, 130, 0.89, 1, 12, 'x')" },
      { sql: "INSERT INTO budget_alloc (year, donor_id, account_id, pct, status) VALUES (2027, (SELECT id FROM donor WHERE name = 'Belfast'), 1, 50, 'promised')" },
    ]);
    expect(await migrate(db)).toEqual([8, 9]);
    expect(await db.query('SELECT id, name, start_ym, months FROM budget ORDER BY id')).toEqual([
      { id: 2026, name: 'Jul 2026 – Dec 2026', start_ym: '2026-07', months: 6 },
      { id: 2027, name: '2027', start_ym: '2027-01', months: 12 },
    ]);
    expect((await db.query<{ budget_id: number }>('SELECT budget_id FROM budget_version ORDER BY id')).map((x) => x.budget_id)).toEqual([2026, 2027, 2027]);
    expect((await db.query<{ budget_id: number }>('SELECT budget_id FROM budget_alloc'))[0].budget_id).toBe(2027);
  });
});

describe('grants follow the money', () => {
  it('in hand, sent to Main, spent on its account (oldest grant first), what is left; EUR changed to USD', async () => {
    const { grantFlows } = await import('../src/domain/grants');
    const card = (id: string, donor: number, amount: number, hand_on: string, hand_usd: number, currency: 'USD' | 'EUR' = 'USD') =>
      ({ id, donor_id: donor, amount, currency, reference: null, note: null, status: 'hand' as const, promised_on: null, approved_on: null, transferred_on: null, bank_on: null, hand_on, hand_usd });
    const cards = [
      card('belfast', 2, 10000, '2027-01-10', 10000), // Furniture
      card('undp', 7, 5000, '2027-02-01', 5000), // Harat
      card('eu', 9, 4000, '2027-03-01', 4400, 'EUR'), // € 4,000 → $4,400; the whole centre
      { ...card('later', 2, 3000, '', 0), status: 'approved' as const, hand_on: null, hand_usd: null },
    ];
    const parts = [
      { grant_id: 'belfast', account_id: 4, amount: 10000 },
      { grant_id: 'undp', account_id: 6, amount: 5000 },
      { grant_id: 'eu', account_id: null, amount: 4000 },
    ];
    const r = (id: string, date: string, type: Trx['type'], acc: number, usd: number, extra: Partial<Trx> = {}): Trx => ({ ...blankTrx(), id, date, type, account_id: acc, exp_usd: type === 'Exp' ? usd : 0, trf_usd: type === 'Transfer' ? -usd : 0, ...extra });
    const rows = [
      r('t1', '2027-01-15', 'Transfer', 0, 6000, { grant_id: 'belfast', received_at: '2027-01-16' }), // to Main, confirmed
      r('t2', '2027-01-20', 'Transfer', 0, 1000, { grant_id: 'belfast' }), // waiting
      r('e1', '2027-01-25', 'Exp', 4, 4000), // furniture: Belfast
      r('e2', '2027-03-10', 'Exp', 6, 5500), // Harat: UNDP 5,000, then the whole-centre grant 500
      r('e3', '2026-12-01', 'Exp', 4, 900), // before Belfast was in hand: no grant
    ];
    const comp = new Map(rows.map((x) => [x.id, { expUsdTot: x.exp_usd, rate: 1 } as never]));
    const f = grantFlows(cards, parts, rows, comp);
    expect(f.get('belfast')).toMatchObject({ inHand: 10000, sent: 6000, sentWaiting: 1000, withSup: 3000, spent: 4000, left: 6000 });
    expect(f.get('undp')).toMatchObject({ spent: 5000, left: 0 });
    expect(f.get('eu')!.inHand).toBe(4400);
    expect(f.get('eu')!.spent).toBe(500);
    expect(f.get('later')).toMatchObject({ inHand: 0, spent: 0 });
  });
});
