// The history of the cash counts of each book (Fouad, 21 October 2026): every count saved by hand and
// every closing stays, with date and hour, who counted, the notes, the book at that moment and the difference.
import { describe, expect, it, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { runOp, type CashCountLog, type DataPayload, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { applySeed, readWorkbook } from '../src/io/importWorkbook';
import { blankTrx } from '../src/db/repo';
import type { Db } from '../src/db/db';
import type { Lists } from '../src/domain/types';
import { nodeDb } from './nodeDb';

const WORKBOOK = decodeURIComponent(new URL('../../template/Master Sup.xlsx', import.meta.url).pathname);
const files = {} as OpCtx['files'];
let db: Db;
let sup: OpCtx;
let L: Lists;
const ctxOf = async (name: string): Promise<OpCtx> => {
  const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
  return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
};

beforeAll(async () => {
  db = nodeDb();
  await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);
  await applySeed(db, readWorkbook(wb), 'test', 'Master Sup.xlsx');
  sup = await ctxOf('Sup');
  L = ((await runOp(sup, 'data', {})) as DataPayload).lists;
}, 60000);

describe('history of the counts', () => {
  it('a manual count is kept every time (nothing is replaced), then the closing adds its own', async () => {
    await db.batch([{ sql: "INSERT INTO book (name, keeper_name, is_main, sort) VALUES ('Keeper', 'Keeper', 0, 99)" }]);
    const book = (await db.query<{ id: number }>("SELECT id FROM book WHERE name = 'Keeper'"))[0].id;
    await runOp(sup, 'user.save', { name: 'Keeper', access_id: 3, books: [book], pin: 'keeper-pass-1' });
    const keeper = await ctxOf('Keeper');
    const inc = L.lines.find((l) => l.name === 'Donation')!;
    await runOp(keeper, 'trx.save', { rows: [{ ...blankTrx(), city_id: L.cities[0].id, account_id: L.accounts[0].id, book_id: book, date: '2026-10-05', type: 'Income', heading_id: inc.heading_id, line_id: inc.id, inc_syp: 5000, explanation: 'gift' }] });

    const count = (qty: number) => [{ currency: 'SYP' as const, denomination: 1000, qty }, { currency: 'USD' as const, denomination: 10, qty: 0 }];
    await runOp(keeper, 'cash.saveCount', { bookId: book, counts: count(4) });
    await runOp(keeper, 'cash.saveCount', { bookId: book, counts: count(5) });
    let h = (await runOp(keeper, 'cash.history', { bookId: book })) as CashCountLog[];
    expect(h).toHaveLength(2); // both kept, newest first
    expect(h[0]).toMatchObject({ kind: 'count', who: 'Keeper', counted_syp: 5000, book_syp: 5000 });
    expect(h[1]).toMatchObject({ counted_syp: 4000, book_syp: 5000 });
    expect(h[0].at).toMatch(/T\d\d:\d\d/); // date AND hour

    // the closing is automatic and adds its entry
    await runOp(keeper, 'bookMonth.close', { bookId: book, ym: '2026-10', counted_syp: 5000, counted_usd: 0, counts: [{ currency: 'SYP', denomination: 1000, qty: 5 }] });
    h = (await runOp(keeper, 'cash.history', { bookId: book })) as CashCountLog[];
    expect(h).toHaveLength(3);
    expect(h[0]).toMatchObject({ kind: 'close', ym: '2026-10', who: 'Keeper' });
  });

  it('the closings made before are the first entries (migration)', async () => {
    // a closing that already existed gets a history line
    const rows = await db.query<{ n: number }>("SELECT COUNT(*) n FROM cash_count_log WHERE kind = 'close'");
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("a private book's history is for its keepers only", async () => {
    const com = await ctxOf('Com');
    await db.batch([{ sql: "INSERT INTO book (name, keeper_name, is_main, private, sort) VALUES ('Secret', 'Sup', 0, 1, 98)" }]);
    const secret = (await db.query<{ id: number }>("SELECT id FROM book WHERE name = 'Secret'"))[0].id;
    await expect(runOp(com, 'cash.history', { bookId: secret })).rejects.toThrow();
  });
});
