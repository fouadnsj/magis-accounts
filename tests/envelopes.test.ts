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
});
