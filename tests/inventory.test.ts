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
import { blankLabelCodes, codeFromScan, nextCodes, parseCsv, qrText, pendingEntries, tableToImport, type InvData } from '../src/inventory/inv';
import { nodeDb } from './nodeDb';
import { inventoryPack, inventorySummary } from '../src/inventory/ops';
import { labelsPdf, qrMatrix } from '../src/io/invLabels';
import { phoneInvCount, phoneInvNew, phoneInvPhoto, mayPhone } from '../server/phone';
import { inventoryTemplate, readTable } from '../src/io/invFile';

const WORKBOOK = decodeURIComponent(new URL('../../template/Master Sup.xlsx', import.meta.url).pathname);
const store = new Map<string, Uint8Array>();
const files = { docWrite: async (r: string, b: Uint8Array) => { store.set(r, b); }, docRead: async (r: string) => store.get(r)!, docExists: async (r: string) => store.has(r) } as unknown as OpCtx['files'];
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
    expect(d.items.find((i) => i.code === 'JAR-0100')).toMatchObject({ origin_id: 3, value_usd: 420.5 });
    expect(d.places.map((x) => x.name)).toContain('Office');
    // the next label goes on after the highest of its own prefix
    expect(nextCodes(['JAR-0100', 'INV-0003'], 'JAR', 2)).toEqual(['JAR-0101', 'JAR-0102']);
  });

  it('photos are kept as files, listed, read back and removed (the file stays)', async () => {
    const id = (await get()).items[0].id;
    const png = btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3));
    const { id: pid } = (await runOp(sup, 'inv.photo.add', { itemId: id, base64: png, mime: 'image/png' })) as { id: string };
    expect([...store.keys()].some((k) => /^inventory\/INV-0001-1\.png$/.test(k))).toBe(true);
    expect((await get()).photos).toMatchObject([{ id: pid, item_id: id }]);
    expect(((await runOp(sup, 'inv.photo.get', { id: pid })) as { mime: string }).mime).toBe('image/png');
    await expect(runOp(sup, 'inv.photo.add', { itemId: id, base64: png, mime: 'application/pdf' })).rejects.toThrow(/JPEG/);
    await expect(runOp(keeper, 'inv.photo.add', { itemId: id, base64: png, mime: 'image/png' })).rejects.toThrow();
    await runOp(sup, 'inv.photo.delete', { id: pid });
    expect((await get()).photos).toHaveLength(0);
    expect(store.size).toBe(1);
  });

  it('the phone counts: one count never counts twice, a photo never comes twice, the pack holds the items', async () => {
    const pack = await inventoryPack(db);
    expect(pack.items.length).toBeGreaterThan(0);
    const ids = pack.items.slice(0, 2).map((i) => i.id);
    const a = await phoneInvCount(sup, { key: 'count-0001-abcdefgh', ids, placeId: null, date: '2026-11-21' });
    expect(a).toMatchObject({ ok: true, counted: 2 });
    expect(await phoneInvCount(sup, { key: 'count-0001-abcdefgh', ids, placeId: null, date: '2026-11-21' })).toMatchObject({ already: true });
    expect((await get()).items.find((i) => i.id === ids[0])!.counted_on).toBe('2026-11-21');
    const png = btoa('xxxx');
    expect(await phoneInvPhoto(sup, { key: 'photo-0001-abcdefgh', itemId: ids[0], base64: png, mime: 'image/jpeg' })).toMatchObject({ ok: true });
    expect(await phoneInvPhoto(sup, { key: 'photo-0001-abcdefgh', itemId: ids[0], base64: png, mime: 'image/jpeg' })).toMatchObject({ already: true });
    await expect(phoneInvCount(keeper, { key: 'count-0002-abcdefgh', ids, placeId: null, date: '2026-11-21' })).rejects.toThrow();
    expect(mayPhone(sup.profile)).toBe(true);
  });

  it('the Coordinator sees totals: items, purchases not registered, no serial, not counted — and no value', async () => {
    const x = await inventorySummary(db);
    expect(x.items).toBeGreaterThan(0);
    expect(x.toRegister).toBe(1); // the table
    expect(x.lines).toBe(1);
    expect(x.noSerial).toBeGreaterThanOrEqual(0);
    expect(Object.keys(x).some((k) => /value/i.test(k))).toBe(false);
  });

  it('labels: a QR that holds the label, on a PDF of A4 pages', async () => {
    const m1 = qrMatrix('JAR-0001');
    expect(m1.length).toBeGreaterThanOrEqual(21);
    expect(m1.every((r) => r.length === m1.length)).toBe(true);
    expect(m1[0].slice(0, 7).every(Boolean)).toBe(true); // the finder pattern
    const pdf = await labelsPdf(Array.from({ length: 30 }, (_, i) => { const c = `JAR-${String(i + 1).padStart(4, '0')}`; return { code: c, qr: `${c} | Laptop` }; }), 'MAGIS');
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
  });

  it('the origins are the centre\'s own list; "bought" comes from a purchase entry and cannot be switched off', async () => {
    let d = await get();
    expect(d.origins.map((o) => o.name.split(' · ')[0])).toEqual(['Bought', 'Gift', 'Old']);
    const { id } = (await runOp(sup, 'inv.list.save', { table: 'origin', name: 'From a donor' })) as { id: number };
    const it = ((await runOp(sup, 'inv.item.add', { name: 'Projector', origin_id: id })) as { id: number }).id;
    d = await get();
    expect(d.items.find((i) => i.id === it)).toMatchObject({ origin_id: id, origin: 'gift', trx_id: null });
    await expect(runOp(sup, 'inv.item.add', { name: 'X', origin_id: 1 })).rejects.toThrow(/comes from/);
    await expect(runOp(sup, 'inv.list.save', { table: 'origin', id: 1, name: 'Bought', active: false })).rejects.toThrow(/Bought/);
    await runOp(sup, 'inv.list.save', { table: 'origin', id, name: 'From a donor', active: false });
    await expect(runOp(sup, 'inv.item.add', { name: 'Y' })).resolves.toBeTruthy(); // no origin chosen: the first one that is on
    const purchased = d.items.find((i) => i.trx_id);
    expect(purchased).toMatchObject({ origin: 'bought', origin_id: 1 });
  });

  it('what the QR holds is chosen in the settings; a scan always finds the label', async () => {
    expect((await get()).qr).toEqual([]);
    await runOp(sup, 'inv.qr', { fields: ['serial', 'name', 'nonsense'] });
    const d = await get();
    expect(d.qr.sort()).toEqual(['name', 'serial']);
    const i = d.items.find((x) => x.serial)!;
    expect(qrText(i, d.qr, { category: 'IT' })).toBe(`${i.code} | ${i.name} | ${i.serial}`);
    expect(qrText(i, [])).toBe(i.code);
    expect(codeFromScan(`${i.code} | ${i.name} | ${i.serial}`)).toBe(i.code);
    expect(codeFromScan('JAR-0001\nLaptop')).toBe('JAR-0001');
    await expect(runOp(keeper, 'inv.qr', { fields: [] })).rejects.toThrow();
  });

  it('a centre full of things: many items at once, a walk-through on the phone, numbered blank labels, an Excel template', async () => {
    const before = (await get()).items.length;
    const r = (await runOp(sup, 'inv.item.many', { items: [
      { name: 'Chair', qty: 40 }, { name: 'Table', qty: 6 }, { name: '', qty: 1 }, { name: 'Laptop HP', serial: 'HP-77', qty: 1 },
    ] })) as { ids: number[] };
    expect(r.ids).toHaveLength(3); // the empty one is left out
    let d = await get();
    expect(d.items).toHaveLength(before + 3);
    expect(d.items.find((i) => i.name === 'Chair')).toMatchObject({ qty: 40, value_usd: null, origin: 'gift' });
    // one wrong row stops the whole table: nothing is half written
    await expect(runOp(sup, 'inv.item.many', { items: [{ name: 'Lamp' }, { name: 'Laptop HP 2', serial: 'hp-77' }] })).rejects.toThrow(/serial/i);
    expect((await get()).items).toHaveLength(before + 3);

    // the phone: a new item with its sticker and its photo; again = nothing new; a sticker already used comes back refused
    const sticker = 'INV-V001';
    const a = await phoneInvNew(sup, { key: 'new-0001-abcdefgh', item: { name: 'Piano', qty: 1, code: sticker, place_id: null }, photo: { base64: btoa('jpg'), mime: 'image/jpeg' } });
    expect(a).toMatchObject({ ok: true, code: sticker });
    expect(await phoneInvNew(sup, { key: 'new-0001-abcdefgh', item: { name: 'Piano' }, photo: null })).toMatchObject({ already: true });
    await expect(phoneInvNew(sup, { key: 'new-0002-abcdefgh', item: { name: 'Organ', code: sticker }, photo: null })).rejects.toThrow(/already used/);
    d = await get();
    expect(d.photos.some((p) => p.item_id === a.id)).toBe(true);
    // with no sticker the server gives the next plain number: it never meets a V sticker
    const b = await phoneInvNew(sup, { key: 'new-0003-abcdefgh', item: { name: 'Cupboard', qty: 2 }, photo: null });
    expect(b.code).toMatch(/^INV-\d{4}$/);
    await expect(phoneInvNew(keeper, { key: 'new-0004-abcdefgh', item: { name: 'x' }, photo: null })).rejects.toThrow();

    // blank labels: a series of their own, after the highest V already used
    expect(blankLabelCodes(['INV-0001', 'INV-V003'], 'INV', 3)).toEqual(['INV-V004', 'INV-V005', 'INV-V006']);
    expect(blankLabelCodes([], 'JAR', 1)).toEqual(['JAR-V001']);

    // the template can be read back by the import
    const bytes = await inventoryTemplate(d.categories, d.places);
    const table = await readTable(bytes, 'inventory-template.xlsx');
    expect(table[0].slice(0, 4)).toEqual(['Name', 'Category', 'Place', 'Qty']);
    const parsed = tableToImport(table);
    expect(parsed.rows[0]).toMatchObject({ qty: 20 });
  });
});

describe('someone else keeps the inventory (22 November 2026)', () => {
  it('a keeper with no book and no view of the register still gets the purchases to register, and can register them', async () => {
    await runOp(sup, 'access.save', { name: 'Stock keeper', perms: ['inventory.manage'] });
    const access = (await db.query<{ id: number }>("SELECT id FROM access_profile WHERE name = 'Stock keeper'"))[0].id;
    await runOp(sup, 'user.save', { name: 'Stock', access_id: access, books: [], pin: 'stock-pass-1' });
    const stock = await ctxOf('Stock');
    expect(stock.profile.perms).toEqual(expect.arrayContaining(['inventory.manage', 'inventory.view']));
    expect(stock.profile.perms).not.toContain('register.view');

    // a purchase on an inventory line, in somebody else's book
    const row = { ...blankTrx(), city_id: L.cities[0].id, account_id: L.accounts[0].id, book_id: book, date: '2026-11-20', type: 'Exp' as const, heading_id: 900, line_id: 900, exp_usd: 450, explanation: 'Two wardrobes' };
    await runOp(sup, 'trx.save', { rows: [row] });

    const p = await data(stock);
    // he sees no part of the register...
    expect(p.rows).toEqual([]);
    // ...only the purchases on inventory lines, as plain figures
    const mine = p.inv!.entries!.find((e) => e.explanation === 'Two wardrobes')!;
    expect(mine).toMatchObject({ exp_usd: 450, usd: 450 });
    expect(mine.bill).not.toBe('');
    expect(p.inv!.entries!.every((e) => e.exp_usd > 0 || e.exp_syp > 0)).toBe(true);
    // the Accountant, who sees every book, gets no such list
    expect((await data(sup)).inv!.entries).toBeUndefined();

    // the screens' own rule finds it "to register", and he can list it
    const { invEntries, pendingEntries } = await import('../src/inventory/inv');
    const er = invEntries({ rows: p.rows, comp: new Map(), inv: p.inv });
    const pend = pendingEntries(er.rows, p.lists, p.inv);
    expect(pend.map((r) => r.explanation)).toContain('Two wardrobes');
    expect(er.usd(mine.id)).toBe(450);
    await runOp(stock, 'inv.register', { trx_id: mine.id, items: [{ name: 'Wardrobe', qty: 2, category_id: null, place_id: null }] });
    const after = await data(stock);
    expect(pendingEntries(invEntries({ rows: after.rows, comp: new Map(), inv: after.inv }).rows, after.lists, after.inv).map((r) => r.explanation)).not.toContain('Two wardrobes');
    // he may not touch the register itself
    await expect(runOp(stock, 'trx.save', { rows: [row] })).rejects.toThrow();
  });
});
