// The register's data is computed once and kept until the next write (21 November 2026, many users at once).
// The kept part holds nothing that depends on the person: a person never gets what another may see, and a write is seen at once.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type DataPayload, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import type { Db, Stmt } from '../src/db/db';
import { nodeDb } from './nodeDb';

const files = {} as OpCtx['files'];
let db: Db;
let writes = 0;
let seq = 0;
let sup: OpCtx;
let com: OpCtx;
const ctx = async (name: string): Promise<OpCtx> => {
  const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
  return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
};
const insertRow = (id: string, book: number, type: 'Income' | 'Exp', usd: number, why: string): Stmt => ({
  sql: 'INSERT INTO trx (id, n, date, type, book_id, inc_usd, exp_usd, explanation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  params: [id, 7000 + (seq += 1), '2026-12-05', type, book, type === 'Income' ? usd : 0, type === 'Exp' ? usd : 0, why, new Date().toISOString()],
});

beforeAll(async () => {
  const raw = nodeDb();
  // the server's database counts its writes: the same here
  db = {
    query: (sql, params) => { if (!/^\s*(select|with|pragma)\b/i.test(sql)) writes++; return raw.query(sql, params); },
    batch: async (stmts) => { writes++; try { await raw.batch(stmts); } finally { writes++; } },
    gen: () => writes,
  };
  await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
  sup = await ctx('Sup');
  com = await ctx('Com');
}, 60000);

describe('the data kept between two writes', () => {
  it('a write is seen at once; the same data twice is the same', async () => {
    const a = (await runOp(sup, 'data', {})) as DataPayload;
    const b = (await runOp(sup, 'data', {})) as DataPayload;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const main = a.lists.books.find((x) => x.is_main)!.id;
    await db.batch([insertRow('dc-1', main, 'Income', 50, 'first')]);
    const c = (await runOp(sup, 'data', {})) as DataPayload;
    expect(c.rows.map((r) => r.id)).toContain('dc-1');
    await db.batch([insertRow('dc-2', main, 'Income', 60, 'second')]);
    expect(((await runOp(sup, 'data', {})) as DataPayload).rows.map((r) => r.id)).toEqual(expect.arrayContaining(['dc-1', 'dc-2']));
  });

  it("what the Superior may see is never given to the Accountant from the kept data (a private book)", async () => {
    await db.batch([{ sql: "INSERT INTO book (name, keeper_name, is_main, private, sort) VALUES ('Secret', 'Sup', 0, 1, 98)" }]);
    const secret = (await db.query<{ id: number }>("SELECT id FROM book WHERE name = 'Secret'"))[0].id;
    await db.batch([insertRow('dc-s1', secret, 'Income', 900, 'secret income'), insertRow('dc-s2', secret, 'Exp', 100, 'secret expense')]);
    // the Superior first (his view is computed and kept), then the Accountant with no write in between
    const bySup = (await runOp(sup, 'data', {})) as DataPayload;
    expect(bySup.rows.filter((r) => r.book_id === secret).map((r) => r.id).sort()).toEqual(['dc-s1', 'dc-s2']);
    const byCom = (await runOp(com, 'data', {})) as DataPayload;
    expect(JSON.stringify(byCom)).not.toContain('secret income');
    expect(JSON.stringify(byCom)).not.toContain('secret expense');
    expect(byCom.rows.some((r) => r.id === 'dc-s1')).toBe(false);
    // and the other way round: the Accountant's view does not hide anything from the Superior afterwards
    const again = (await runOp(sup, 'data', {})) as DataPayload;
    expect(again.rows.filter((r) => r.book_id === secret)).toHaveLength(2);
  });

  it("one person's changes to his copy (no donors for him) do not reach another", async () => {
    const a = (await runOp(com, 'data', {})) as DataPayload;
    const b = (await runOp(sup, 'data', {})) as DataPayload;
    // the Accountant has no donors tick: his copy of the lists has none; the Superior's is whole
    expect(a.lists.donors).toEqual([]);
    expect(Array.isArray(b.lists.donors)).toBe(true);
  });
});
