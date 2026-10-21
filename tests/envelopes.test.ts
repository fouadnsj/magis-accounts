// MAGIS centres: envelopes (Fouad, 19 October 2026) — a book holder hands part of his cash to a
// helper. The envelope is a small book inside his, kept by him, seen by the office; money between
// his book and its envelopes needs no confirmation; they close their month together.
import { describe, expect, it, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { runOp, type DataPayload, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { applySeed, readWorkbook } from '../src/io/importWorkbook';
import { blankTrx } from '../src/db/repo';
import type { Db } from '../src/db/db';
import type { Lists, Trx } from '../src/domain/types';
import { holders } from '../src/domain/reports';
import { nodeDb } from './nodeDb';

const WORKBOOK = decodeURIComponent(new URL('../../template/Master Sup.xlsx', import.meta.url).pathname);
const files = {} as OpCtx['files'];
let db: Db;
let sup: OpCtx;
let roula: OpCtx;
let L: Lists;
let roulaId: number;
const ctxOf = async (name: string): Promise<OpCtx> => {
  const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
  return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
};
const DAY = '2026-11-05';

beforeAll(async () => {
  db = nodeDb();
  await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);
  await applySeed(db, readWorkbook(wb), 'test', 'Master Sup.xlsx');
  sup = await ctxOf('Sup');
  L = ((await runOp(sup, 'data', {})) as DataPayload).lists;
  roulaId = L.books.find((b) => b.name === 'Roula')!.id;
  await runOp(sup, 'user.save', { name: 'Roula', access_id: 3, books: [roulaId], pin: 'roula-pass-1' });
  roula = await ctxOf('Roula');
}, 60000);

const row = (book: number, over: Partial<Trx>): Trx => ({
  ...blankTrx(), city_id: L.cities[0].id, account_id: L.accounts.find((a) => a.name === 'Center')!.id, book_id: book, date: DAY,
  explanation: 'for the workshop', ...over,
});

describe('envelopes', () => {
  it('the holder makes one, gives to it, the helper spends, the rest comes back; no confirmation needed', async () => {
    const env = (await runOp(roula, 'envelope.save', { parentId: roulaId, helper: 'Facilitator' })) as number;
    roula = await ctxOf('Roula'); // he keeps the envelope too
    expect(roula.profile.books).toContain(env);
    // someone else's book: refused
    const nagham = L.books.find((b) => b.name === 'Nagham')!.id;
    await expect(runOp(roula, 'envelope.save', { parentId: nagham, helper: 'X' })).rejects.toThrow();

    const g = crypto.randomUUID();
    await runOp(roula, 'trx.save', { rows: [row(roulaId, { type: 'Transfer', trf_syp: -10000, transfer_group: g }), row(env, { type: 'Transfer', trf_syp: 10000, transfer_group: g })] });
    const exp = L.lines.find((l) => l.name === 'Consumables for workshops')!;
    await runOp(roula, 'trx.save', { rows: [row(env, { type: 'Exp', heading_id: exp.heading_id, line_id: exp.id, exp_syp: 6000 })] });
    const g2 = crypto.randomUUID();
    await runOp(roula, 'trx.save', { rows: [row(env, { type: 'Transfer', trf_syp: -4000, transfer_group: g2, explanation: 'what was left' }), row(roulaId, { type: 'Transfer', trf_syp: 4000, transfer_group: g2, explanation: 'what was left' })] });

    const d = (await runOp(sup, 'data', {})) as DataPayload;
    const mine = d.transfers.filter((t) => t.key === g || t.key === g2);
    expect(mine.every((t) => t.receivedAt)).toBe(true);
    // the office sees the envelope: empty again; the expense counts in the centre's expenses
    const envLine = holders(d.rows, d.lists.books, 'SYP').find((l) => l.book?.id === env)!;
    expect(envLine.shouldHold).toBe(0);
    expect(envLine.expenses).toBe(6000);
    expect(d.lists.books.find((b) => b.id === env)!.parent_id).toBe(roulaId);
  });

  it('closing the holder\'s month closes its envelopes too', async () => {
    const bal = (await runOp(roula, 'bookMonth.balance', { bookId: roulaId, ym: '2026-11' })) as { syp: number; usd: number };
    await runOp(roula, 'bookMonth.close', { bookId: roulaId, ym: '2026-11', counted_syp: bal.syp, counted_usd: bal.usd });
    const closed = await db.query<{ book_id: number }>("SELECT book_id FROM book_month WHERE ym = '2026-11'");
    const envId = (await db.query<{ id: number }>('SELECT id FROM book WHERE parent_id = ?', [roulaId]))[0].id;
    expect(closed.map((x) => x.book_id).sort()).toEqual([roulaId, envId].sort());
  });

  it('the count made in the closing window (note by note) is kept with the month, and is the book\'s latest count', async () => {
    await db.batch([{ sql: "INSERT INTO book (name, keeper_name, is_main, sort) VALUES ('Counter', 'Counter', 0, 99)" }]);
    const counter = (await db.query<{ id: number }>("SELECT id FROM book WHERE name = 'Counter'"))[0].id;
    await runOp(sup, 'user.save', { name: 'Counter', access_id: 3, books: [counter], pin: 'counter-pass-1' });
    const cnt = await ctxOf('Counter');
    const inc = L.lines.find((l) => l.name === 'Donation')!;
    await runOp(cnt, 'trx.save', { rows: [row(counter, { type: 'Income', date: '2026-10-05', heading_id: inc.heading_id, line_id: inc.id, inc_syp: 3000, explanation: 'gift' }), row(counter, { type: 'Income', date: '2026-10-06', heading_id: inc.heading_id, line_id: inc.id, inc_usd: 20, explanation: 'gift in dollars' })] });
    const counts = [{ currency: 'SYP' as const, denomination: 1000, qty: 3 }, { currency: 'USD' as const, denomination: 10, qty: 2 }];
    // the notes must add up to what is declared
    await expect(runOp(cnt, 'bookMonth.close', { bookId: counter, ym: '2026-10', counted_syp: 999, counted_usd: 20, note: 'x', counts })).rejects.toThrow(/add up/);
    await runOp(cnt, 'bookMonth.close', { bookId: counter, ym: '2026-10', counted_syp: 3000, counted_usd: 20, counts });
    const bm = (await db.query<{ count_detail: string }>('SELECT count_detail FROM book_month WHERE book_id = ? AND ym = ?', [counter, '2026-10']))[0];
    expect(JSON.parse(bm.count_detail)).toEqual(counts);
    const latest = await db.query<{ currency: string; denomination: number; qty: number }>('SELECT currency, denomination, qty FROM cash_count WHERE book_id = ? ORDER BY currency', [counter]);
    expect(latest.map((x) => `${x.currency}${x.denomination}x${x.qty}`)).toEqual(['SYP1000x3', 'USD10x2']);
  });

  it('envelopes exist for any book: Main\'s (made by the Accountant) and a private book\'s, which stays private', async () => {
    const mainId = L.books.find((b) => b.is_main)!.id;
    const com = await ctxOf('Com');
    const envMain = (await runOp(com, 'envelope.save', { parentId: mainId, helper: 'Driver' })) as number;
    expect((await db.query<{ parent_id: number; private: number }>('SELECT parent_id, private FROM book WHERE id = ?', [envMain]))[0]).toMatchObject({ parent_id: mainId, private: 0 });
    // a private book (the Superior's) and its envelope
    const fouad = (await db.query<{ id: number }>("SELECT id FROM book WHERE name = 'Fouad'"))[0]?.id ?? roulaId;
    await db.batch([{ sql: 'UPDATE book SET private = 1 WHERE id = ?', params: [fouad] }]);
    await runOp(sup, 'user.save', { id: sup.profile.id, name: 'Sup', access_id: 1, books: [fouad] });
    sup = await ctxOf('Sup');
    const envPriv = (await runOp(sup, 'envelope.save', { parentId: fouad, helper: 'Helper' })) as number;
    expect((await db.query<{ private: number }>('SELECT private FROM book WHERE id = ?', [envPriv]))[0].private).toBe(1);
    // an expense in that envelope is not shown line by line to the Accountant: one total only
    const exp = L.lines.find((l) => l.name === 'Consumables for workshops')!;
    await runOp(sup, 'trx.save', { rows: [row(envPriv, { type: 'Exp', heading_id: exp.heading_id, line_id: exp.id, exp_syp: 1234, explanation: 'secret' })] });
    const seen = (await runOp(com, 'data', {})) as DataPayload;
    expect(seen.rows.filter((r) => r.book_id === envPriv && r.explanation === 'secret')).toHaveLength(0);
    expect(seen.rows.some((r) => r.book_id === envPriv && r.private_total && r.exp_syp === 1234)).toBe(true);
    // the office's month closing takes the open envelopes (Main's) with it
    await runOp(com, 'trx.save', { rows: [row(envMain, { type: 'Exp', heading_id: exp.heading_id, line_id: exp.id, exp_syp: 100, explanation: 'fuel' })] });
    await runOp(sup, 'month.close', { ym: '2026-11' });
    const closedEnv = await db.query<{ book_id: number }>("SELECT book_id FROM book_month WHERE ym = '2026-11'");
    expect(closedEnv.map((x) => x.book_id)).toContain(envMain);
  });
});
