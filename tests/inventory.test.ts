// The inventory (Fouad, 21 November 2026): purchases on furniture / equipment lines must be listed as items; serial numbers;
// gifts with an estimated value; history instead of deletion; a Snipe-IT table brought in.
import { describe, expect, it, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { runOp, type DataPayload, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { applySeed, readWorkbook } from '../src/io/importWorkbook';
import { blankTrx } from '../src/db/repo';
import type { Db } from '../src/db/db';
import type { Lists } from '../src/domain/types';
import { nextCodes, parseCsv, pendingEntries, tableToImport, type InvData } from '../src/inventory/inv';
import { nodeDb } from './nodeDb';

const WORKBOOK = decodeURIComponent(new URL('../../template/Master Sup.xlsx', import.meta.url).pathname);
const files = {} as OpCtx['files'];
let db: Db;
let sup: OpCtx;
let keeper: OpCtx;
let L: Lists;
let book: number;
const ctxOf = async (name: string): Promise<OpCtx> => {
  const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
  return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
};
const get = async (c: OpCtx = sup) => (await runOp(c, 'inv.get', undefined)) as InvData;
const data = async (c: OpCtx = sup) => (await runOp(c, 'data', {})) as DataPayload;

beforeAll(async () => {
  db = nodeDb();
  await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);
  await applySeed(db, readWorkbook(wb), 'test', 'Master Sup.xlsx');
  // the workbook has no inventory heading: tick one, as the keeper would
  await db.batch([{ sql: "INSERT INTO book (name, keeper_name, is_main, sort) VALUES ('Keeper', 'Keeper', 0, 99)" }]);
  book = (await db.query<{ id: number }>("SELECT id FROM book WHERE name = 'Keeper'"))[0].id;
  sup = await ctxOf('Sup');
  await runOp(sup, 'user.save', { name: 'Keeper', access_id: 3, books: [book], pin: 'keeper-pass-1' });
  keeper = await ctxOf('Keeper');
  L = (await data()).lists;
}, 60000);

describe('the inventory', () => {
  it('the Superior and the Accountant keep it, a book holder does not even see it', async () => {
    expect(sup.profile.perms).toContain('inventory.manage');
    expect((await ctxOf('Com')).profile.perms).toContain('inventory.manage');
    await expect(runOp(keeper, 'inv.get', undefined)).rejects.toThrow();
    await expect(runOp(keeper, 'inv.item.add', { name: 'Chair' })).rejects.toThrow();
    expect((await data(keeper)).inv).toBeNull();
  });

  it('a purchase on a ticked heading is "to register" until it has an item (or is marked "not an item")', async () => {
    // a heading of its own (the workbook's lines are salaries and so on), as a centre has "Furniture and equipment"
    await db.batch([{ sql: "INSERT INTO heading (id, name, code, sort) VALUES (900, 'Furniture and equipment', 'E90', 90)" }, { sql: "INSERT INTO heading_type (heading_id, type) VALUES (900, 'Exp')" }, { sql: "INSERT INTO budget_line (id, heading_id, name, code) VALUES (900, 900, 'Equipment', 'E90.1')" }]);
    const head = { id: 900 };
    const line = { id: 900 };
    await runOp(sup, 'inv.source', { kind: 'heading', ref: head.id, on: true });
    const row = (n: string, usd: number) => ({ ...blankTrx(), city_id: L.cities[0].id, account_id: L.accounts[0].id, book_id: book, date: '2026-11-03', type: 'Exp' as const, heading_id: head.id, line_id: line.id, exp_usd: usd, explanation: n });
    await runOp(sup, 'trx.save', { rows: [row('2 laptops', 1000), row('delivery', 20), row('table', 300)] });
    let p = await data();
    let pend = pendingEntries(p.rows, p.lists, p.inv);
    expect(pend.map((r) => r.explanation).sort()).toEqual(['2 laptops', 'delivery', 'table']);

    // the laptops: two items, a serial number each; the value is the entry's, one unit each
    const lap = pend.find((r) => r.explanation === '2 laptops')!;
    const cat = (await get()).categories.find((c) => c.serial === 1)!;
    const r = (await runOp(sup, 'inv.register', { trx_id: lap.id, items: [
      { name: 'Laptop', category_id: cat.id, serial: 'SN-1', value_usd: 500 },
      { name: 'Laptop', category_id: cat.id, serial: 'SN-2', value_usd: 500 },
    ] })) as { ids: number[] };
    expect(r.ids).toHaveLength(2);
    // the same serial twice is refused (here and against the first)
    await expect(runOp(sup, 'inv.item.add', { name: 'Laptop', serial: 'sn-1', origin: 'gift' })).rejects.toThrow(/serial/i);
    // the delivery is not an item
    await runOp(sup, 'inv.skip', { trx_id: pend.find((x) => x.explanation === 'delivery')!.id, reason: 'delivery fee' });
    p = await data();
    pend = pendingEntries(p.rows, p.lists, p.inv);
    expect(pend.map((x) => x.explanation)).toEqual(['table']);
    // and a purchase entry of someone who may not see the inventory is never listed by him
    await expect(runOp(keeper, 'inv.register', { trx_id: lap.id, items: [{ name: 'x' }] })).rejects.toThrow();
  });

  it('labels follow each other; a gift keeps an estimated value; the history stays; an item with a history is not deleted', async () => {
    const d0 = await get();
    expect(d0.items.map((i) => i.code)).toEqual(['INV-0001', 'INV-0002']);
    const { id } = (await runOp(sup, 'inv.item.add', { name: 'Piano', origin: 'gift', value_usd: 800, value_note: 'estimated by the teacher' })) as { id: number };
    let it = (await get()).items.find((i) => i.id === id)!;
    expect(it).toMatchObject({ code: 'INV-0003', origin: 'gift', value_usd: 800, trx_id: null });
    const place = ((await runOp(sup, 'inv.list.save', { table: 'place', name: 'Hall' })) as { id: number }).id;
    await runOp(sup, 'inv.item.save', { id, name: 'Piano', qty: 1, origin: 'gift', value_usd: 800, place_id: place, holder: 'Maria', condition: 'repair' });
    const kinds = (await get()).moves.filter((x) => x.item_id === id).map((x) => x.kind);
    expect(kinds).toEqual(['added', 'given', 'repair']);
    await expect(runOp(sup, 'inv.item.delete', { id })).rejects.toThrow(/history/);
    await runOp(sup, 'inv.count', { ids: [id], date: '2026-11-20' });
    it = (await get()).items.find((i) => i.id === id)!;
    expect(it.counted_on).toBe('2026-11-20');
    await runOp(sup, 'inv.item.out', { id, status: 'disposed', why: 'broken beyond repair', date: '2026-11-21' });
    expect((await get()).items.find((i) => i.id === id)).toMatchObject({ status: 'disposed', holder: null });
    await runOp(sup, 'inv.item.back', { id });
    expect((await get()).items.find((i) => i.id === id)!.status).toBe('in_use');
    // an item entered by mistake (only "added") can go
    const w = ((await runOp(sup, 'inv.item.add', { name: 'Mistake' })) as { id: number }).id;
    await runOp(sup, 'inv.item.delete', { id: w });
    expect((await get()).items.some((i) => i.id === w)).toBe(false);
  });

  it('a Snipe-IT export is brought in; a label or serial already used is skipped, never doubled', async () => {
    const csv = [
      'Asset Tag,Name,Category,Model,Manufacturer,Serial,Purchase Date,Purchase Cost,Location,Status,Supplier,Notes',
      'JAR-0100,"Projector, Epson",Audio-visual,EB-X06,Epson,PRJ-9,14/03/2023,420.50,Hall,Ready to Deploy,,"for the hall"',
      'JAR-0101,Desk,Furniture,,,,2022-01-05,90,Office,Broken - Not Fixable,,',
      'INV-0001,Duplicate label,Furniture,,,,,,,,,',
      'JAR-0102,Duplicate serial,IT equipment,,,SN-1,,,,,,',
    ].join('\n');
    const { rows, unknown } = tableToImport(parseCsv(csv));
    expect(unknown).toEqual([]);
    expect(rows[0]).toMatchObject({ code: 'JAR-0100', name: 'Projector, Epson', serial: 'PRJ-9', acquired_on: '2023-03-14', value_usd: 420.5, place: 'Hall', condition: 'good' });
    expect(rows[1].condition).toBe('broken');
    const res = (await runOp(sup, 'inv.import', { rows })) as { added: number; skipped: string[] };
    expect(res.added).toBe(2);
    expect(res.skipped).toHaveLength(2);
    const d = await get();
    expect(d.items.find((i) => i.code === 'JAR-0100')).toMatchObject({ origin: 'old', value_usd: 420.5 });
    expect(d.places.map((x) => x.name)).toContain('Office');
    // the next label goes on after the highest of its own prefix
    expect(nextCodes(['JAR-0100', 'INV-0003'], 'JAR', 2)).toEqual(['JAR-0101', 'JAR-0102']);
  });
});
