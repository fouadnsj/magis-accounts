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
  it('an income or a transfer without explanation (new rows; rows written before the rule may stay without)', () => {
    const inc = expense({ type: 'Income', heading_id: id(lists.headings, 'Income'), line_id: lists.lines.find((l) => l.heading_id === id(lists.headings, 'Income'))!.id, exp_syp: 0, inc_syp: 5000, explanation: null });
    expect(errs(inc, { ...ctx(), explainAll: true } as never)[0]).toMatch(/income: where does the money come from/);
    expect(errs(inc)).toEqual([]);
  });
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
    expect(head).toEqual(TRX_HEADERS.map((h) => (h === 'Account' ? 'Project' : h)));
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
    // the lines keep their identity on the holder's computer (the same list everywhere)
    expect(hl.lines.map((l) => l.uid).sort()).toEqual((await loadLists(office)).lines.map((l) => l.uid).sort());

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
      backupNow: async () => null, list: async () => [], restore: async () => undefined, backupRows: async () => [],
      docWrite: async (rel: string, b: Uint8Array) => void mem.set(rel, b), docRead: async (rel: string) => mem.get(rel)!, docExists: async (rel: string) => mem.has(rel),
    };
    const api = localApi({ db: office, profile: { id: 1, name: 'Com', role: 'com', book_id: null, active: 1, access_id: 2, access_name: 'Accountant', books: [], perms: ['register.view', 'register.edit', 'book.own', 'reports.summary'] }, who: 'Com (com)', install: 'office', files });
    const before = (await api.call('data')).rows.length;
    await api.call('trx.save', { rows: [expense({ exp_syp: 4321 })] });
    const after = await api.call('data');
    expect(after.rows.length).toBe(before + 1);
    expect(after.lists.donors).toEqual([]); // the accountant never receives the donors
    await expect(api.call('grant.save', { donor: 'X', amount: 5, currency: 'USD', here: null, shares: [], fund_id: 1 })).rejects.toThrow(/Not allowed/);
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
  it('proposes from the 12 months before (as is, or scaled), follows the pace line by line, each line with its fund', async () => {
    const { proposeFromSpending, followUp, paceOf, usedBand, prorateItems, itemTotal, contingencyOf, NOFUND } = await import('../src/domain/budget');
    const row = (id: string, date: string, usd: number, line = 7): Trx => ({ ...blankTrx(), id, date, type: 'Exp', account_id: 1, line_id: line, exp_usd: usd });
    const rows = [row('a', '2026-10-05', 100), row('b', '2026-11-05', 100), row('c', '2026-12-05', 100)];
    const comp = new Map(rows.map((r) => [r.id, { expUsdTot: r.exp_usd, incUsdTot: 0 } as never]));
    expect(proposeFromSpending(rows, comp, '2027-01', 12, { scale: false, pct: 0 })[0].amount_usd).toBe(300);
    expect(proposeFromSpending(rows, comp, '2027-01', 12, { scale: true, pct: 0 })[0].amount_usd).toBe(1200); // 3 months → 12
    expect(proposeFromSpending(rows, comp, '2027-01', 12, { scale: true, pct: 10 })[0].amount_usd).toBe(1320);
    expect(proposeFromSpending(rows, comp, '2027-01', 18, { scale: true, pct: 0 })[0].amount_usd).toBe(1800); // an 18-month budget

    // staff 13 months, for 6 months: 6.5
    const staff = { line_id: 7, name: 'Director', unit: 'person', qty: 1, times: 13, unit_cost: 350, note: null };
    expect(prorateItems([staff], 6)[0].times).toBe(6.5);
    expect(itemTotal(prorateItems([staff], 6)[0])).toBe(2275);

    // pace: a 1200 budget for the year
    expect(paceOf(1200, 200, 1)).toBe('under'); // December, only 200 spent
    expect(paceOf(1200, 1250, 1)).toBe('over'); // more than the budget: uses the contingency
    expect(paceOf(1200, 1200, 1)).toBe('ontrack');
    expect(paceOf(1200, 900, 0.5)).toBe('ahead'); // 900 by June
    expect(paceOf(1200, 600, 0.5)).toBe('ontrack');
    expect(paceOf(0, 50, 0.5)).toBe('nobudget');
    expect([usedBand(0.3), usedBand(0.6), usedBand(0.8), usedBand(0.95), usedBand(1.2)]).toEqual([0, 50, 75, 90, 100]);

    // a budget from July for 6 months: by the end of September half of it is gone. Line 7 has the fund 1, line 8 none.
    const amounts = [{ version_id: 1, account_id: 1, line_id: 7, amount_usd: 1000 }, { version_id: 1, account_id: NOFUND, line_id: 8, amount_usd: 400 }];
    const headingOf = new Map([[7, 3], [8, 4], [9, 3]]);
    const version = { id: 1, start_ym: '2027-07', months: 6 };
    const later = [...rows, row('d', '2027-08-01', 800), { ...row('d2', '2027-08-02', 100), account_id: 2 }, row('e', '2027-08-01', 50, 9), { ...row('f', '2027-08-01', 70), account_id: 5 }];
    const comp2 = new Map([...comp, ['d', { expUsdTot: 800 } as never], ['d2', { expUsdTot: 100 } as never], ['e', { expUsdTot: 50 } as never], ['f', { expUsdTot: 70 } as never]]);
    const fu = followUp({ rows: later, comp: comp2, budget: version, upToYm: '2027-09', amounts, original: null, headingOf, outside: new Set([5]) });
    const l7 = fu.find((x) => x.line_id === 7)!;
    // the line counts all its spending, whatever was written on the row (d2), never a fund outside the budget (f: Deir)
    expect([l7.account_id, l7.spent, l7.left, l7.used, l7.lastYear, l7.pace]).toEqual([1, 900, 100, 0.9, 0, 'ahead']);
    expect(fu.find((x) => x.line_id === 8)!.account_id).toBe(NOFUND);
    expect(fu.find((x) => x.line_id === 9)!.pace).toBe('nobudget'); // spent without any budget: shown

    const cont = contingencyOf([{ ...l7, spent: 1100 }], 10);
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

describe('budgets with their own period, overlapping', () => {
  it('names and months: a calendar year, or July for 18 months', async () => {
    const { defaultBudgetName, periodEnd, addMonths, periodShare, prorateItems } = await import('../src/domain/budget');
    expect(defaultBudgetName('2027-01', 12)).toBe('2027');
    expect(defaultBudgetName('2026-07', 18)).toBe('Jul 2026 – Dec 2027');
    expect(periodEnd({ start_ym: '2026-07', months: 18 })).toBe('2027-12');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(periodShare({ start_ym: '2026-07', months: 18 }, '2027-03')).toBeCloseTo(9 / 18);
    expect(prorateItems([{ line_id: 1, name: 'x', unit: null, qty: 1, times: 13, unit_cost: 100, note: null }], 18)[0].times).toBe(19.5);
  });

  it('first in, first out: the first donation is finished, then the new one; the leftover is carried over', async () => {
    const { assignExpenses, leftoverOf, followUp } = await import('../src/domain/budget');
    const row = (id: string, date: string, usd: number, line = 7): Trx => ({ ...blankTrx(), id, date, type: 'Exp', account_id: 1, line_id: line, heading_id: 3, exp_usd: usd });
    // A: Jan–Dec 2027, 1000 on the line. B: from Oct 2027 for 12 months, 2000, continues A.
    const A = { budget: { id: 1, name: 'A', start_ym: '2027-01', months: 12, carry_from_id: null }, cells: [{ version_id: 1, account_id: 1, line_id: 7, amount_usd: 1000 }] };
    const B = { budget: { id: 2, name: 'B', start_ym: '2027-10', months: 12, carry_from_id: 1 }, cells: [{ version_id: 2, account_id: 1, line_id: 7, amount_usd: 2000 }] };
    const rows = [
      row('jan', '2027-01-10', 600), // A
      row('oct', '2027-10-05', 300), // A still has 400: A
      row('nov', '2027-11-05', 300), // A has 100 left (> 0): A, which goes over by 200
      row('dec', '2027-12-05', 250), // A is used up: B
      row('jan28', '2028-01-05', 100), // only B runs
      row('x', '2027-05-01', 40, 9), // a line in no budget: none
    ];
    const comp = new Map(rows.map((r) => [r.id, { expUsdTot: r.exp_usd } as never]));
    const assigned = assignExpenses(rows, comp, [B, A]);
    expect(Object.fromEntries(assigned)).toEqual({ jan: 1, oct: 1, nov: 1, dec: 2, jan28: 2 });
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
    expect(await migrate(db)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]);
    expect(await db.query('SELECT id, name, start_ym, months FROM budget ORDER BY id')).toEqual([
      { id: 2026, name: 'Jul 2026 – Dec 2026', start_ym: '2026-07', months: 6 },
      { id: 2027, name: '2027', start_ym: '2027-01', months: 12 },
    ]);
    expect((await db.query<{ budget_id: number }>('SELECT budget_id FROM budget_version ORDER BY id')).map((x) => x.budget_id)).toEqual([2026, 2027, 2027]);
    expect((await db.query<{ budget_id: number }>('SELECT budget_id FROM budget_alloc'))[0].budget_id).toBe(2027);
  });
});

describe('one budget for the centre (migration 41)', () => {
  it('a line under several accounts becomes one line: amounts added, the fund with the largest amount; Deir (outside) leaves the budget', async () => {
    const { MIGRATIONS } = await import('../src/db/migrations');
    const { splitSql, migrate } = await import('../src/db/db');
    const db = nodeDb();
    await db.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
    for (const mg of MIGRATIONS.filter((x) => x.n <= 40)) {
      await db.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
    }
    await db.batch([
      { sql: "INSERT INTO account (id, name, outside_budget) VALUES (1, 'Deir', 1), (2, 'Center', 0), (3, 'harat', 0)" },
      { sql: "INSERT INTO heading (id, name, code) VALUES (50, 'Operations', 'O50')" },
      { sql: "INSERT INTO budget_line (id, heading_id, name, code) VALUES (501, 50, 'General maintenance', 'O50.1'), (502, 50, 'Kitchenette', 'O50.2')" },
      { sql: "INSERT INTO budget (id, name, start_ym, months, created_at) VALUES (1, 'B', '2026-07', 6, 'x')" },
      { sql: "INSERT INTO budget_version (id, year, budget_id, rev, rate_syp, rate_eur, created_at) VALUES (1, 1, 1, 0, 130, 0.9, 'x')" },
      { sql: 'INSERT INTO budget_amount (version_id, account_id, line_id, amount_usd) VALUES (1, 1, 501, 30), (1, 2, 501, 200), (1, 3, 501, 100), (1, 2, 502, 40), (1, 3, 502, 90)' },
      { sql: "INSERT INTO budget_item (version_id, account_id, line_id, name, qty, times, unit_cost) VALUES (1, 3, 502, 'Fridge', 1, 1, 90), (1, 1, 501, 'Deir paint', 1, 1, 30)" },
      { sql: 'INSERT INTO budget_account (version_id, account_id, contingency_pct) VALUES (1, 2, 10)' },
    ]);
    expect(await migrate(db)).toEqual([41, 42, 43, 44, 45, 46, 47]);
    expect(await db.query('SELECT line_id, account_id, amount_usd FROM budget_amount ORDER BY line_id')).toEqual([
      { line_id: 501, account_id: 2, amount_usd: 300 }, // Center 200 + harat 100; Deir's 30 left out
      { line_id: 502, account_id: 3, amount_usd: 130 }, // harat had more
    ]);
    expect(await db.query('SELECT line_id, name FROM budget_item')).toEqual([{ line_id: 502, name: 'Fridge' }]);
    expect((await db.query<{ contingency_pct: number }>('SELECT contingency_pct FROM budget_version'))[0].contingency_pct).toBe(10);
  });
});

describe('the centre by project', () => {
  it('each project with its grant, spent in the period and since the beginning, what is left; not funded; line by line; an Excel', async () => {
    const { projectReport } = await import('../src/domain/projects');
    const { projectXlsx } = await import('../src/io/projectExcel');
    const row = (id: string, date: string, acc: number | null, line: number, usd: number): Trx => ({ ...blankTrx(), id, date, type: 'Exp', account_id: acc, line_id: line, heading_id: 3, exp_usd: usd });
    const rows = [row('a', '2026-12-01', 2, 7, 100), row('b', '2027-01-05', 2, 7, 50), row('c', '2027-01-06', 2, 8, 30), row('d', '2027-01-07', null, 9, 20), row('e', '2027-01-08', 1, 9, 5)];
    const comp = new Map(rows.map((r) => [r.id, { expUsdTot: r.exp_usd, billCode: `B-${r.id}` } as never]));
    const lists = { accounts: [{ id: 1, name: 'Deir', active: 1, sort: 0, outside_budget: 1 }, { id: 2, name: 'SEN running', active: 1, sort: 1 }, { id: 3, name: 'Network', active: 1, sort: 2 }], lines: [{ id: 7, heading_id: 3, name: 'Rent', code: 'x', is_project_fund: 0, active: 1 }] } as never;
    const grant = { id: 'g', donor_id: 1, amount: 9000, currency: 'EUR' as const, reference: 'SEN-1', note: null, status: 'hand' as const, promised_on: null, approved_on: null, transferred_on: null, bank_on: null, hand_on: '2026-11-01', hand_usd: 6000 };
    const rep = projectReport({ rows, comp, lists, grants: [grant], grantParts: [{ grant_id: 'g', account_id: 2, amount: 6000 }], grantShares: [{ grant_id: 'g', centre: 'homs', amount: 6000 }, { grant_id: 'g', centre: 'aleppo', amount: 3000 }], period: { from: '2027-01', to: '2027-12' } });
    const sen = rep.find((x) => x.id === 2)!;
    expect([sen.spent, sen.spentAll, sen.received, sen.left, sen.share]).toEqual([80, 180, 6000, 5820, 6000]);
    expect(sen.lines.map((l) => [l.line_id, l.spent, l.rows])).toEqual([[7, 50, 1], [8, 30, 1]]);
    expect(rep.find((x) => x.id == null)!.spent).toBe(20); // not funded
    expect(rep.find((x) => x.id === 1)!.outside).toBe(true); // Deir, apart
    expect(rep.some((x) => x.id === 3)).toBe(false); // nothing on it: not shown
    const bytes = await projectXlsx({ project: sen, period: { from: '2027-01', to: '2027-12' }, organisation: 'MAGIS Homs', comp, docs: new Map([['b', ['B-b.pdf']]]),
      lists: { headings: [{ id: 3, name: 'Operations' }], lines: [{ id: 7, name: 'Rent' }], books: [], parties: [], donors: [{ id: 1, name: 'SEN' }] } as never });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'By line', 'Expenses']);
    expect(wb.getWorksheet('Summary')!.getRow(3).values).toContain('SEN');
    expect(wb.getWorksheet('Expenses')!.getRow(2).getCell(11).value).toBe('B-b.pdf');
  });
});

describe('one list for every centre (migration 42)', () => {
  it('each heading and line has an identity of its own, unique; a new one gets its own', async () => {
    const { splitSql } = await import('../src/db/db');
    expect(splitSql('CREATE TABLE a (x);\nCREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = 1; END;\nSELECT 1;')).toEqual(['CREATE TABLE a (x)', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = 1; END', 'SELECT 1']);
    const L = await loadLists(office);
    expect(L.headings.every((h) => h.uid) && L.lines.every((l) => l.uid)).toBe(true);
    expect(new Set(L.lines.map((l) => l.uid)).size).toBe(L.lines.length);
    await addLine(office, L.headings.find((h) => h.name === 'Operations')!.id, 'A brand new line', 'test');
    const fresh = (await loadLists(office)).lines.find((l) => l.name === 'A brand new line')!;
    expect(fresh.uid).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('the common list between two databases', () => {
  it('new lines go both ways; the leading names win; what a centre switched off stays off; same name = same line', async () => {
    const { applyCommonList, exportCommonList, joinCommonList } = await import('../src/io/commonList');
    const fresh = async () => {
      const db = nodeDb();
      await migrate(db);
      return db;
    };
    const homs = await fresh();
    await addHeading(homs, 'Salary', ['Exp'], 't');
    const sal = (await loadLists(homs)).headings.find((h) => h.name === 'Salary')!;
    for (const n of ['Reception', 'Cleaner']) await addLine(homs, sal.id, n, 't');
    await joinCommonList(homs, 't', true);
    const aleppo = await fresh();
    await joinCommonList(aleppo, 't', false);
    expect(await applyCommonList(aleppo, await exportCommonList(homs), 't', { lead: true })).toEqual({ headings: 1, lines: 2, renamed: 0 });
    // (every database also has the Transfer heading and line: the same name, so they become the same too)
    const lines = async (db: Db) => {
      const L = await loadLists(db);
      return L.lines.filter((l) => L.headings.find((h) => h.id === l.heading_id)?.name === 'Salary').map((l) => [l.name, l.code, l.active, l.uid]);
    };
    expect((await lines(aleppo)).map((x) => x[3]).sort()).toEqual((await lines(homs)).map((x) => x[3]).sort()); // the same lines, by identity

    // Aleppo adds a Cook and switches off the Cleaner; Homs adds a Driver (the same code E01.3) and renames Reception
    const aSal = (await loadLists(aleppo)).headings.find((h) => h.name === 'Salary')!;
    await addLine(aleppo, aSal.id, 'Cook', 't');
    await aleppo.batch([{ sql: "UPDATE budget_line SET active = 0 WHERE name = 'Cleaner'" }]);
    await addLine(homs, sal.id, 'Driver', 't');
    await homs.batch([{ sql: "UPDATE budget_line SET name = 'Receptionist' WHERE name = 'Reception'" }]);
    // Aleppo gives its new line to Homs (Homs keeps its names), then takes the common list (Homs's names win)
    expect(await applyCommonList(homs, await exportCommonList(aleppo), 't', { lead: false })).toEqual({ headings: 0, lines: 1, renamed: 0 });
    const common = await exportCommonList(homs);
    expect(common.lead).toBe(true);
    expect(await applyCommonList(aleppo, common, 't', { lead: true })).toMatchObject({ lines: 1, renamed: 1 });
    const a = await lines(aleppo);
    expect(a.map((x) => x[0]).sort()).toEqual(['Cleaner', 'Cook', 'Driver', 'Receptionist']);
    expect(a.find((x) => x[0] === 'Cleaner')![2]).toBe(0); // still off in Aleppo
    expect(a.find((x) => x[0] === 'Driver')![2]).toBe(0); // what comes from another centre arrives switched off
    expect((await lines(homs)).find((x) => x[0] === 'Cook')![2]).toBe(0);
    expect(a.find((x) => x[0] === 'Driver')![1]).toBe('E01.3-2'); // its code was Cook's here: the next free one
    expect((await lines(homs)).map((x) => x[0]).sort()).toEqual(['Cleaner', 'Cook', 'Driver', 'Receptionist']);

    // a database with a heading and a line of the same names under other identities: they become the same
    const jaramana = await fresh();
    await addHeading(jaramana, 'Salary', ['Exp'], 't');
    await addLine(jaramana, (await loadLists(jaramana)).headings.find((h) => h.name === 'Salary')!.id, 'Cook', 't');
    expect(await applyCommonList(jaramana, common, 't', { lead: true })).toMatchObject({ headings: 0, lines: 3 });
    expect((await loadLists(jaramana)).lines.find((l) => l.name === 'Cook')!.uid).toBe(common.lines.find((l) => l.name === 'Cook')!.uid);
  });
});

describe('a centre joins the common list', () => {
  it('lines per person merged into the line of the position, with their rows and budget; a line of its own kept; the rest comes in', async () => {
    const { exportCommonList, joinCommonList, joinWithMatching, commonListState } = await import('../src/io/commonList');
    const fresh = async () => { const db = nodeDb(); await migrate(db); return db; };
    // Homs leads: Salary with Reception and Cleaner
    const homs = await fresh();
    await addHeading(homs, 'Salary', ['Exp'], 't');
    const hs = (await loadLists(homs)).headings.find((h) => h.name === 'Salary')!;
    for (const n of ['Reception', 'Cleaner']) await addLine(homs, hs.id, n, 't');
    await joinCommonList(homs, 't', true);
    const common = await exportCommonList(homs);
    // Aleppo: E01 Staff_Salary with Salim and Fatima (both reception), E02 Stationary with Paper
    const aleppo = await fresh();
    await addHeading(aleppo, 'Staff_Salary', ['Exp'], 't');
    await addHeading(aleppo, 'Stationary', ['Exp'], 't');
    let A = await loadLists(aleppo);
    const hid = (n: string) => A.headings.find((h) => h.name === n)!.id;
    await addLine(aleppo, hid('Staff_Salary'), 'Salim', 't');
    await addLine(aleppo, hid('Staff_Salary'), 'Fatima', 't');
    await addLine(aleppo, hid('Stationary'), 'Paper', 't');
    A = await loadLists(aleppo);
    const lid = (n: string) => A.lines.find((l) => l.name === n)!.id;
    await aleppo.batch([
      { sql: "INSERT INTO trx (id, type, date, heading_id, line_id, exp_usd, created_at) VALUES ('s1', 'Exp', '2026-05-01', ?, ?, 100, 'x'), ('f1', 'Exp', '2026-05-02', ?, ?, 80, 'x'), ('p1', 'Exp', '2026-05-03', ?, ?, 5, 'x')", params: [hid('Staff_Salary'), lid('Salim'), hid('Staff_Salary'), lid('Fatima'), hid('Stationary'), lid('Paper')] },
      { sql: "INSERT INTO budget (id, name, start_ym, months, created_at) VALUES (1, 'B', '2026-01', 12, 'x')" },
      { sql: "INSERT INTO budget_version (id, year, budget_id, rev, rate_syp, rate_eur, created_at) VALUES (1, 1, 1, 0, 1, 1, 'x')" },
      { sql: 'INSERT INTO budget_amount (version_id, line_id, amount_usd) VALUES (1, ?, 1200), (1, ?, 960)', params: [lid('Salim'), lid('Fatima')] },
    ]);
    const reception = common.lines.find((l) => l.name === 'Reception')!.uid;
    const salary = common.headings.find((h) => h.name === 'Salary')!.uid;
    const r = await joinWithMatching(aleppo, common, {
      headings: { [hid('Staff_Salary')]: salary, [hid('Stationary')]: null },
      lines: { [lid('Salim')]: reception, [lid('Fatima')]: reception, [lid('Paper')]: null },
    }, 't');
    expect(r).toMatchObject({ matched: 2, kept: 1 });
    expect(await commonListState(aleppo)).toBe('yes');
    A = await loadLists(aleppo);
    const rec = A.lines.find((l) => l.uid === reception)!;
    expect([rec.name, rec.code, A.headings.find((h) => h.id === rec.heading_id)!.name]).toEqual(['Reception', 'E01.1', 'Salary']);
    // the rows of Salim and Fatima are now on Reception, under Salary; the budget amounts added
    const rows = await aleppo.query<{ id: string; line_id: number; heading_id: number }>('SELECT id, line_id, heading_id FROM trx ORDER BY id');
    expect(rows.filter((x) => x.id !== 'p1').every((x) => x.line_id === rec.id && x.heading_id === rec.heading_id)).toBe(true);
    expect((await aleppo.query<{ amount_usd: number }>('SELECT amount_usd FROM budget_amount WHERE line_id = ?', [rec.id]))[0].amount_usd).toBe(2160);
    // Cleaner came from the common list; Stationary and Paper are kept, with codes that do not clash
    expect(A.lines.some((l) => l.name === 'Cleaner')).toBe(true);
    const st = A.headings.find((h) => h.name === 'Stationary')!;
    expect(common.headings.some((h) => h.code === st.code)).toBe(false);
    expect(A.lines.find((l) => l.name === 'Paper')!.code).toBe(`${st.code}.1`);
    expect(A.headings.some((h) => h.name === 'Staff_Salary')).toBe(false);
    // the lines merged stay, switched off, pointing to Reception (a keeper's file written on them still comes in)
    expect(A.lines.filter((l) => l.merged_into === rec.id).map((l) => [l.name, l.active])).toEqual([['Fatima → Reception', 0]]);

    // the Transfer heading is the same one everywhere now
    const tr = (db: Db) => db.query<{ uid: string }>("SELECT uid FROM heading WHERE name = 'Transfer'");
    expect((await tr(aleppo))[0].uid).toBe((await tr(homs))[0].uid);
  });
});

describe('the bill code', () => {
  it('the centre, the register number, the receipt, the day and month: HO-0123-345-0910', async () => {
    const { billCode } = await import('../src/domain/compute');
    const t = { ...blankTrx(), type: 'Exp' as const, n: 123, receipt: 'F-12345', date: '2026-10-09' };
    expect(billCode(t, 'HO')).toBe('HO-0123-345-0910');
    expect(billCode({ ...t, n: null, receipt: null }, 'AL')).toBe('AL-····-000-0910'); // not numbered yet, no receipt
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
      // Respo → a holder's book: two rows (− and +), counted once
      r('t3', '2027-03-02', 'Transfer', 0, 500, { grant_id: 'eu', transfer_group: 'g3', received_at: '2027-03-02' }),
      r('t3b', '2027-03-02', 'Transfer', 0, -500, { grant_id: 'eu', transfer_group: 'g3', received_at: '2027-03-02' }),
    ];
    const comp = new Map(rows.map((x) => [x.id, { expUsdTot: x.exp_usd, rate: 1 } as never]));
    const f = grantFlows(cards, parts, rows, comp);
    expect(f.get('belfast')).toMatchObject({ inHand: 10000, sent: 6000, sentWaiting: 1000, withSup: 3000, spent: 4000, left: 6000 });
    expect(f.get('undp')).toMatchObject({ spent: 5000, left: 0 });
    expect(f.get('eu')!.inHand).toBe(4400);
    expect(f.get('eu')!.sent).toBe(500);
    expect(f.get('eu')!.spent).toBe(500);
    expect(f.get('later')).toMatchObject({ inHand: 0, spent: 0 });
  });
});
