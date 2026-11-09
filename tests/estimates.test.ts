// Building sites: expenses still to come (estimates, USD) — the budget page and its Excel export.
import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { migrate, type Db } from '../src/db/db';
import { loadLists, loadTrx } from '../src/db/repo';
import { applySeed, readWorkbook } from '../src/io/importWorkbook';
import { computeAll } from '../src/domain/compute';
import { buildingBudget } from '../src/domain/reports';
import { exportBuildingBudget, readEstimates } from '../src/io/budgetExport';
import { localApi } from '../src/ops';
import type { EstimateItem } from '../src/domain/types';
import { nodeDb } from './nodeDb';

const WORKBOOK = decodeURIComponent(new URL('../../Homs compte.xlsx', import.meta.url).pathname);
const FROM_TABLE = decodeURIComponent(new URL('../../Estimates-from-your-table.xlsx', import.meta.url).pathname);
const files = { backupNow: async () => null, list: async () => [], restore: async () => undefined, backupRows: async () => [], docWrite: async () => undefined, docRead: async () => new Uint8Array(), docExists: async () => false };

describe.skipIf(!existsSync(WORKBOOK))('estimates (still to spend)', () => {
  let db: Db;
  const com = () => localApi({ db, profile: { id: 2, name: 'Com', role: 'com', book_id: null, active: 1, access_id: 2, access_name: 'Accountant', books: [], perms: ['register.view', 'register.main', 'lists.manage'] }, who: 'Com (com)', install: 'office', files });
  const viewer = () => localApi({ db, profile: { id: 3, name: 'V', role: 'com', book_id: null, active: 1, access_id: 2, access_name: 'V', books: [], perms: ['register.view'] }, who: 'V', install: 'office', files });
  const estimates = async () => (await com().call('data')).estimates as EstimateItem[];

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(WORKBOOK);
    db = nodeDb();
    await migrate(db);
    await applySeed(db, readWorkbook(wb), 'test', 'Homs compte.xlsx');
  });

  it('items are added, changed, postponed and removed; expected = spent + still to spend', async () => {
    const lists = await loadLists(db);
    const upvc = lists.headings.find((h) => h.code === 'D')!;
    await com().call('estimate.save', { heading_id: upvc.id, description: 'باقي دفعة', amount_usd: 27000 });
    await com().call('estimate.save', { heading_id: upvc.id, description: 'later', amount_usd: 500, postponed: 1 });
    await expect(com().call('estimate.save', { heading_id: upvc.id, description: '', amount_usd: 1 })).rejects.toThrow(/Write what/);
    await expect(com().call('estimate.save', { heading_id: upvc.id, description: 'x', amount_usd: -1 })).rejects.toThrow(/not valid/);
    await expect(viewer().call('estimate.save', { heading_id: upvc.id, description: 'x', amount_usd: 1 })).rejects.toThrow();
    const rows = await loadTrx(db);
    let b = buildingBudget(rows, computeAll(rows, lists), lists, null, await estimates()).find((x) => x.heading.code === 'D')!;
    expect([b.total, b.still, b.postponed, b.expected, b.expectedLeft]).toEqual([25675, 27000, 500, 52675, b.budget - 52675]);
    const first = (await estimates()).find((e) => e.description === 'باقي دفعة')!;
    await com().call('estimate.save', { ...first, amount_usd: 26000 });
    await com().call('estimate.delete', { id: (await estimates()).find((e) => e.description === 'later')!.id });
    b = buildingBudget(rows, computeAll(rows, lists), lists, null, await estimates()).find((x) => x.heading.code === 'D')!;
    expect([b.still, b.postponed]).toEqual([26000, 0]);
  });

  it.skipIf(!existsSync(FROM_TABLE))("Fouad's table comes in: 178,395.21 still to spend, 3 postponed items", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(FROM_TABLE);
    const items = readEstimates(wb);
    expect((await com().call('estimate.import', { rows: items, fileName: 'table.xlsx' })).items).toBe(83);
    const rows = await loadTrx(db);
    const lists = await loadLists(db);
    const b = buildingBudget(rows, computeAll(rows, lists), lists, null, await estimates());
    expect(b.reduce((a, x) => a + x.still, 0)).toBeCloseTo(178395.21, 2);
    expect(b.reduce((a, x) => a + x.postponed, 0)).toBe(3175);
    await expect(com().call('estimate.import', { rows: [{ code: 'ZZ', description: 'x', amount_usd: 1, postponed: false }], fileName: 'x' })).rejects.toThrow(/Unknown heading/);
  });

  it('the export: General in USD with formulas, Estimates read back the same, one sheet per heading', async () => {
    const rows = await loadTrx(db);
    const lists = await loadLists(db);
    const comp = computeAll(rows, lists);
    const ests = await estimates();
    const lines = buildingBudget(rows, comp, lists, null, ests);
    const bytes = await exportBuildingBudget(lines, rows, comp, lists, { title: 'Homs Building · Budget', date: '2026-11-09' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(wb.worksheets.length).toBe(2 + lines.length);
    const g = wb.getWorksheet('General')!;
    expect(g.getRow(4).values).toEqual([, 'Code', 'Heading', 'Budget', 'Spent', 'Left', 'Still to spend', 'Postponed', 'Expected total', 'Expected left', 'Expected used']);
    const total = g.getRow(5 + lines.length);
    const res = (n: number) => (total.getCell(n).value as ExcelJS.CellFormulaValue).result as number;
    expect(res(3)).toBeCloseTo(606764.66, 2);
    expect(res(6)).toBeCloseTo(178395.21, 2);
    expect(res(8)).toBeCloseTo(lines.reduce((a, x) => a + x.total, 0) + 178395.21, 2);
    // the Estimates sheet comes back as it went out
    expect(readEstimates(wb).length).toBe(ests.length);
    // a heading's sheet: its expenses add up to what it spent
    const l = lines.find((x) => x.heading.code === 'L')!;
    const ws = wb.worksheets.find((w) => w.name.startsWith('L '))!;
    let last = ws.rowCount;
    expect(ws.getRow(last).getCell(1).value).toBe('Total');
    expect(((ws.getRow(last).getCell(7).value as ExcelJS.CellFormulaValue).result as number)).toBeCloseTo(l.total, 6);
    last = 0;
  });
});
