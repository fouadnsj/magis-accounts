// A budget allocated to several accounts (Fouad, 30 October 2026).
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

describe('budget allocation', () => {
  it('splits the budget of an account between several accounts', async () => {
    const slug = (await call('/api/dbs/create', { organisation: 'Alloc', centre: 'aleppo' })).body.slug;
    await call('/api/setup/new', { db: slug, organisation: 'Alloc', supName: 'Boss', supPin: 'boss-alloc-1', comName: 'Clerk', comPin: 'clerk-alloc-1' });
    const id = (await call(`/api/profiles?db=${slug}`)).body.find((p: { name: string }) => p.name === 'Boss').id;
    await call('/api/login', { db: slug, profileId: id, password: 'boss-alloc-1' }, '');
    for (const n of ['CEI', 'SZ', 'CJF']) await op('list.add', { table: 'account', name: n });
    await op('heading.add', { name: 'Staff', types: ['Exp'] });
    const lists0 = (await op('data')).body.lists;
    const h = lists0.headings.find((x: { name: string }) => x.name === 'Staff').id;
    await op('line.add', { headingId: h, name: 'Reception' });
    await op('line.add', { headingId: h, name: 'Cleaner' });
    const lists = (await op('data')).body.lists;
    const acc = (n: string) => lists.accounts.find((a: { name: string }) => a.name === n).id;
    const line = (n: string) => lists.lines.find((l: { name: string }) => l.name === n).id;
    await op('budget.create', { name: 'B', start_ym: '2027-01', months: 6, rate_syp: 130, rate_eur: 0.89, from: 'empty' });
    const v = (await op('budget.get', {})).body.versions[0].id;
    await op('budget.importItems', { versionId: v, account_id: acc('CEI'), contingency_pct: 0, items: [
      { account_id: acc('CEI'), line_id: line('Reception'), name: 'Reception', unit: 'person', qty: 2, times: 6, unit_cost: 200, note: null },
      { account_id: acc('CEI'), line_id: line('Cleaner'), name: 'Cleaner', unit: 'person', qty: 2, times: 6, unit_cost: 180, note: null },
    ] });
    const cells = async () => ((await op('budget.get', {})).body.amounts as { account_id: number; line_id: number; amount_usd: number }[]).map((x) => [x.account_id, x.line_id, x.amount_usd]);
    expect(await cells()).toEqual(expect.arrayContaining([[acc('CEI'), line('Reception'), 2400], [acc('CEI'), line('Cleaner'), 2160]]));

    // must make 100, no account twice, nothing to move
    const parts = (a: [string, number][]) => a.map(([n, pct]) => ({ account_id: acc(n), pct }));
    const go = (p: [string, number][]) => op('budget.allocate', { versionId: v, fromAccountId: acc('CEI'), parts: parts(p) });
    expect((await go([['SZ', 50], ['CJF', 40]])).status).toBe(400);
    expect((await go([['SZ', 50], ['SZ', 50]])).status).toBe(400);
    expect((await go([['CEI', 100]])).status).toBe(400);
    expect((await op('budget.allocate', { versionId: v, fromAccountId: acc('SZ'), parts: parts([['CJF', 100]]) })).status).toBe(400); // SZ has no budget yet

    // CEI keeps 50%, SZ 30%, CJF 20%
    expect((await go([['CEI', 50], ['SZ', 30], ['CJF', 20]])).status).toBe(200);
    const after = await cells();
    const at = (a: string, l: string) => after.find((x) => x[0] === acc(a) && x[1] === line(l))![2];
    expect([at('CEI', 'Reception'), at('SZ', 'Reception'), at('CJF', 'Reception')]).toEqual([1200, 720, 480]);
    expect([at('CEI', 'Cleaner'), at('SZ', 'Cleaner'), at('CJF', 'Cleaner')]).toEqual([1080, 648, 432]);
    expect(after.reduce((s, x) => s + (x[2] as number), 0)).toBe(2400 + 2160); // the total did not change
    const b = (await op('budget.get', {})).body;
    const sz = b.items.filter((i: { account_id: number }) => i.account_id === acc('SZ'));
    expect(sz.map((i: { name: string; unit_cost: number; qty: number }) => [i.name, i.qty, i.unit_cost])).toEqual([['Reception', 2, 60], ['Cleaner', 2, 54]]);
    expect(sz[0].note).toContain('30% of CEI');

    // a second allocation adds to what an account already has
    expect((await op('budget.allocate', { versionId: v, fromAccountId: acc('SZ'), parts: parts([['CJF', 100]]) })).status).toBe(200);
    const again = await cells();
    expect(again.find((x) => x[0] === acc('CJF') && x[1] === line('Reception'))![2]).toBe(480 + 720);
    expect(again.some((x) => x[0] === acc('SZ'))).toBe(false);

    // an account with one lump amount is refused
    await op('budget.setAccount', { versionId: v, account_id: acc('SZ'), lump_usd: 100 });
    expect((await go([['CEI', 50], ['SZ', 50]])).status).toBe(400);
  });
});
