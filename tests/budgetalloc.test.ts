// One budget for the centre, each line with one fund (Fouad, 2026-11-01).
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';

let srv: Running, base: string, dir: string, ck = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-ba-'));
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  base = `http://127.0.0.1:${srv.httpPort}`;
}, 60000);
afterAll(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
async function call(url: string, body?: unknown, cookie = ck) {
  const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie().find((c) => c.startsWith('magis_sid='));
  if (set && !cookie) ck = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}
const op = (n: string, a: unknown = {}) => call(`/api/op/${n}`, a);

describe('budget funds', () => {
  it('a global budget: lines not funded until a fund is given to a heading or a line; one fund per line; kept by a new budget', async () => {
    const slug = (await call('/api/dbs/create', { organisation: 'Alloc', centre: 'aleppo' })).body.slug;
    await call('/api/setup/new', { db: slug, organisation: 'Alloc', supName: 'Boss', supPin: 'boss-alloc-1', comName: 'Clerk', comPin: 'clerk-alloc-1' });
    const id = (await call(`/api/profiles?db=${slug}`)).body.find((p: { name: string }) => p.name === 'Boss').id;
    await call('/api/login', { db: slug, profileId: id, password: 'boss-alloc-1' }, '');
    for (const n of ['Running SEN', 'Furniture', 'Deir']) expect((await op('list.add', { table: 'account', name: n })).status).toBe(200);
    await op('heading.add', { name: 'Staff', types: ['Exp'] });
    await op('heading.add', { name: 'Furnishing', types: ['Exp'] });
    const lists0 = (await op('data')).body.lists;
    const h = (n: string) => lists0.headings.find((x: { name: string }) => x.name === n).id;
    await op('line.add', { headingId: h('Staff'), name: 'Reception' });
    await op('line.add', { headingId: h('Staff'), name: 'Cleaner' });
    await op('line.add', { headingId: h('Furnishing'), name: 'Chairs' });
    const lists = (await op('data')).body.lists;
    const acc = (n: string) => lists.accounts.find((a: { name: string }) => a.name === n).id;
    const line = (n: string) => lists.lines.find((l: { name: string }) => l.name === n).id;
    await op('account.setOutside', { id: acc('Deir'), outside: true });
    await op('budget.create', { name: 'B', start_ym: '2027-01', months: 6, rate_syp: 130, rate_eur: 0.89, from: 'empty' });
    const v = (await op('budget.get', {})).body.versions[0].id;
    expect((await op('budget.importItems', { versionId: v, contingency_pct: 10, items: [
      { line_id: line('Reception'), name: 'Reception', unit: 'person', qty: 2, times: 6, unit_cost: 200, note: null },
      { line_id: line('Cleaner'), name: 'Cleaner', unit: 'person', qty: 2, times: 6, unit_cost: 180, note: null },
      { line_id: line('Chairs'), name: 'Chairs', unit: 'piece', qty: 50, times: 1, unit_cost: 20, note: null },
    ] })).status).toBe(200);
    const cells = async () => ((await op('budget.get', {})).body.amounts as { account_id: number; line_id: number; amount_usd: number }[]).map((x) => [x.account_id, x.line_id, x.amount_usd]);
    // everything in the budget, nothing funded yet
    expect(await cells()).toEqual(expect.arrayContaining([[0, line('Reception'), 2400], [0, line('Cleaner'), 2160], [0, line('Chairs'), 1000]]));
    expect((await op('budget.get', {})).body.current.contingency_pct).toBe(10);

    // the running grant covers the staff heading; the chairs wait for their grant
    expect((await op('budget.setFund', { versionId: v, line_ids: [line('Reception'), line('Cleaner')], account_id: acc('Running SEN') })).status).toBe(200);
    expect((await op('budget.setFund', { versionId: v, line_ids: [line('Chairs')], account_id: acc('Deir') })).status).toBe(400); // outside the budget
    let now = await cells();
    expect(now.find((x) => x[1] === line('Chairs'))![0]).toBe(0);
    expect(now.filter((x) => x[0] === acc('Running SEN')).length).toBe(2);
    // a line moves to another fund: it leaves the first (one fund per line)
    expect((await op('budget.setFund', { versionId: v, line_ids: [line('Cleaner')], account_id: acc('Furniture') })).status).toBe(200);
    now = await cells();
    expect(now.filter((x) => x[1] === line('Cleaner'))).toEqual([[acc('Furniture'), line('Cleaner'), 2160]]);
    // changing the items keeps the line's fund
    expect((await op('budget.saveItems', { versionId: v, line_id: line('Cleaner'), items: [{ name: 'Cleaner', unit: 'person', qty: 1, times: 6, unit_cost: 180, note: null }] })).status).toBe(200);
    expect((await cells()).find((x) => x[1] === line('Cleaner'))).toEqual([acc('Furniture'), line('Cleaner'), 1080]);
    // back to "not funded"
    expect((await op('budget.setFund', { versionId: v, line_ids: [line('Cleaner')], account_id: null })).status).toBe(200);
    expect((await cells()).find((x) => x[1] === line('Cleaner'))![0]).toBe(0);

    // a revision and a new budget keep the funds
    expect((await op('budget.revise', { budgetId: 1, note: 'r' })).status).toBe(200);
    expect((await cells()).find((x) => x[1] === line('Reception'))![0]).toBe(acc('Running SEN'));
    const next = (await op('budget.create', { start_ym: '2027-07', months: 6, rate_syp: 130, rate_eur: 0.89, from: 'empty' })).body;
    const v2 = (await op('budget.get', { budgetId: next })).body.current.id;
    expect((await op('budget.saveAmounts', { versionId: v2, cells: [{ line_id: line('Reception'), amount_usd: 2500 }, { line_id: line('Chairs'), amount_usd: 300 }] })).status).toBe(200);
    const b2 = (await op('budget.get', { budgetId: next })).body.amounts as { account_id: number; line_id: number }[];
    expect(b2.find((x) => x.line_id === line('Chairs'))!.account_id).toBe(0);
    const copy = (await op('budget.create', { start_ym: '2028-01', months: 12, rate_syp: 130, rate_eur: 0.89, from: 'budget', fromBudgetId: 1 })).body;
    const b3 = (await op('budget.get', { budgetId: copy })).body;
    expect(b3.amounts.find((x: { line_id: number }) => x.line_id === line('Reception'))).toMatchObject({ account_id: acc('Running SEN'), amount_usd: 4800 });
    expect(b3.current.contingency_pct).toBe(10);
  });
});
