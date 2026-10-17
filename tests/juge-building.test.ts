// LE JUGE for building sites — the app must compute exactly what Homs compte.xlsx computed:
// on every row the conv (Syp / Rate), the Code BOQ and the Code Bill; the cash balances;
// and, per heading, the USD paid and the pounds converted (sheet Data).
// One difference by design (Fouad, 17 Oct 2026): an exchange is not spending.
import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { migrate } from '../src/db/db';
import { blankTrx, loadLists, loadTrx } from '../src/db/repo';
import { localApi } from '../src/ops';
import type { Db } from '../src/db/db';
import { applySeed, cellValue, readWorkbook, type Seed } from '../src/io/importWorkbook';
import { computeAll, lastTypedRate } from '../src/domain/compute';
import { buildingBudget, holders } from '../src/domain/reports';
import type { Computed, Lists, Trx } from '../src/domain/types';
import { nodeDb } from './nodeDb';

// Fouad's workbook stays outside the code (private): next to the app's project folder.
const WORKBOOK = decodeURIComponent(new URL('../../../Building comp/Homs compte.xlsx', import.meta.url).pathname);
const here = existsSync(WORKBOOK);

let seed: Seed;
let rows: Trx[];
let lists: Lists;
let comp: Map<string, Computed>;
let wb: ExcelJS.Workbook;
let db: Db;
const data = (addr: string) => Number(cellValue(wb.getWorksheet('Data')!.getCell(addr).value) ?? 0);

describe.skipIf(!here)('juge: Homs compte.xlsx (building site)', () => {
  beforeAll(async () => {
    wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(WORKBOOK);
    seed = readWorkbook(wb);
    db = nodeDb();
    await migrate(db);
    await applySeed(db, seed, 'test', 'Homs compte.xlsx');
    rows = await loadTrx(db);
    lists = await loadLists(db);
    comp = computeAll(rows, lists);
  });

  it('is read as a building site, every row imported, numbers as in Excel', () => {
    expect(seed.kind).toBe('building');
    expect(seed.warnings).toEqual([]);
    expect(lists.settings.building).toBe(1);
    expect(rows.length).toBe(681);
    rows.forEach((t, i) => expect(t.n).toBe(seed.trx[i].excel.n));
    // no Respo book, one cash box
    expect(lists.books.map((b) => b.name)).toEqual(['Main']);
  });

  it('conv, Code BOQ and Code Bill equal Excel on every row', () => {
    const bad: string[] = [];
    rows.forEach((t, i) => {
      const ex = seed.trx[i].excel;
      const c = comp.get(t.id)!;
      const conv = c.expUsdTot - t.exp_usd;
      if (Math.abs(conv - (ex.conv ?? 0)) > 1e-9) bad.push(`row ${seed.trx[i].excelRow} conv ${conv} ≠ ${ex.conv}`);
      if (c.code !== ex.code) bad.push(`row ${seed.trx[i].excelRow} code ${c.code} ≠ ${ex.code}`);
      if (c.billCode !== ex.billCode) bad.push(`row ${seed.trx[i].excelRow} bill code ${c.billCode} ≠ ${ex.billCode}`);
    });
    expect(bad).toEqual([]);
  });

  it('the cash box: 8,476 USD and 15,198,700 SYP, as Record!U2 and W2', () => {
    const main = lists.books[0];
    expect(holders(rows, lists.books, 'USD').find((h) => h.book?.id === main.id)!.shouldHold).toBe(8476);
    expect(holders(rows, lists.books, 'SYP').find((h) => h.book?.id === main.id)!.shouldHold).toBe(15198700);
  });

  it('budget per heading: USD paid (G) and pounds converted (H) as sheet Data, budget total 606,764.66', () => {
    const b = buildingBudget(rows, comp, lists);
    const bad: string[] = [];
    for (let r = 2; r <= 20; r++) {
      const name = String(cellValue(wb.getWorksheet('Data')!.getCell(`B${r}`).value) ?? '');
      const line = b.find((x) => x.heading.name === name);
      if (!name || name === 'Exchange') continue;
      if (!line) { bad.push(`heading ${name} missing`); continue; }
      if (Math.abs(line.usd - data(`G${r}`)) > 1e-9) bad.push(`${name} usd ${line.usd} ≠ ${data(`G${r}`)}`);
      if (Math.abs(line.conv - data(`H${r}`)) > 1e-6) bad.push(`${name} conv ${line.conv} ≠ ${data(`H${r}`)}`);
      if (Math.abs(line.budget - data(`D${r}`)) > 1e-6) bad.push(`${name} budget ${line.budget} ≠ ${data(`D${r}`)}`);
    }
    expect(bad).toEqual([]);
    expect(b.reduce((a, x) => a + x.budget, 0)).toBeCloseTo(data('D21'), 6);
  });

  it('the one difference by design: Excel counted the dollars exchanged as spending', () => {
    const b = buildingBudget(rows, comp, lists);
    const appUsd = b.reduce((a, x) => a + x.usd, 0);
    // Data!G16 "Exchange" 40,030 + G17 "Fr. Fouad" 1,500 (row 0670: 1,500 USD → 20,850,000 SYP, probably an
    // exchange; under an income heading it is no building spending, and it waits "to review")
    expect(data('G16')).toBe(40030);
    expect(data('G17')).toBe(1500);
    expect(data('G21') - appUsd).toBe(40030 + 1500);
    expect(b.reduce((a, x) => a + x.conv, 0)).toBeCloseTo(data('H21'), 6);
  });

  it('rows with no amount are cancelled, keeping their number; two exchanges to correct are flagged', () => {
    const cancelled = rows.filter((t) => t.cancelled_at);
    expect(cancelled.length).toBe(32);
    expect(cancelled.every((t) => t.cancel_reason && t.n != null)).toBe(true);
    const review = rows.filter((t) => t.review).map((t) => t.n);
    expect(review).toEqual(expect.arrayContaining([317, 670, 678]));
  });

  it('the accountant cancels (with a reason) and cannot delete; a new row gets the next number and its bill code', async () => {
    const mem = new Map<string, Uint8Array>();
    const files = {
      backupNow: async () => null, list: async () => [], restore: async () => undefined, backupRows: async () => [],
      docWrite: async (rel: string, b: Uint8Array) => void mem.set(rel, b), docRead: async (rel: string) => mem.get(rel)!, docExists: async (rel: string) => mem.has(rel),
    };
    const com = localApi({ db, profile: { id: 2, name: 'Com', role: 'com', book_id: null, active: 1, access_id: 2, access_name: 'Accountant', books: [], perms: ['register.view', 'register.edit', 'book.own'] }, who: 'Com (com)', install: 'office', files });
    const sup = localApi({ db, profile: { id: 1, name: 'Sup', role: 'sup', book_id: null, active: 1, access_id: 1, access_name: 'Superior', books: [], perms: ['register.view', 'register.edit', 'book.own', 'users.manage'] }, who: 'Sup (sup)', install: 'office', files });
    const target = rows.find((t) => t.n === 3)!; // 0003 TO 24 2, 1,950,000 SYP
    await expect(com.call('trx.delete', { ids: [target.id], reason: 'test' })).rejects.toThrow(/cancel it/);
    await expect(com.call('trx.cancel', { id: target.id, reason: '' })).rejects.toThrow(/Write why/);
    await com.call('trx.cancel', { id: target.id, reason: 'paid twice' });
    let now = await loadTrx(db);
    const c = now.find((t) => t.id === target.id)!;
    expect([c.n, c.exp_syp, c.cancel_reason, c.cancelled_by]).toEqual([3, 0, 'paid twice', 'Com (com)']);
    expect(computeAll(now, lists).get(c.id)!.billCode).toBe('0003 TO 24 2');
    await expect(com.call('trx.save', { rows: [{ ...c, exp_syp: 5 }], reason: 'x' })).rejects.toThrow(/cancelled/);

    // the rate offered: the last one typed (row 0681, 17 Oct: 13,800), not the last exchange (10 Oct: 14,025)
    expect(lastTypedRate(rows, '2026-10-18', 1)).toBe(13800);
    // a new expense, paid in both currencies, rate filled by the form (last exchange) and kept
    const h = lists.headings.find((x) => x.name === 'Iron')!;
    const line = lists.lines.find((l) => l.heading_id === h.id && l.name === 'Wages')!;
    const fresh = { ...blankTrx(), type: 'Exp' as const, date: '2026-10-18', bill_date: '2026-10-16', book_id: lists.books[0].id, city_id: lists.cities[0].id, account_id: lists.accounts[0].id,
      heading_id: h.id, line_id: line.id, explanation: 'test', exp_usd: 100, exp_syp: 138000, rate: 13800 };
    await com.call('trx.save', { rows: [fresh] });
    now = await loadTrx(db);
    const f = now.find((t) => t.id === fresh.id)!;
    expect(f.n).toBe(682);
    const fc = computeAll(now, lists).get(f.id)!;
    expect(fc.billCode).toBe('0682 LW 16 10');
    expect(fc.expUsdTot).toBe(110);

    // only the Superior deletes
    await sup.call('trx.delete', { ids: [f.id], reason: 'test row' });
    expect((await loadTrx(db)).some((t) => t.id === f.id)).toBe(false);
  });
});
