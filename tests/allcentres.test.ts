// All centres together on one server (Fouad, 2026-11-01): the same grant in Aleppo and Homs, matched by its contract.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';
import { blankTrx } from '../src/db/repo';

let srv: Running, base: string, dir: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-all-'));
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  base = `http://127.0.0.1:${srv.httpPort}`;
}, 60000);
afterAll(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
async function call(url: string, body: unknown, cookie: string) {
  const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie().find((c) => c.startsWith('magis_sid='));
  return { status: r.status, body: await r.json().catch(() => null), set: set?.split(';')[0] };
}

/** a centre with a budget line, the grant SEN-1 (9,000: Aleppo 3,000, Homs 6,000) and one expense */
async function centre(org: string, key: 'aleppo' | 'homs', funded: boolean) {
  const slug = (await call('/api/dbs/create', { organisation: org, centre: key }, '')).body.slug;
  await call('/api/setup/new', { db: slug, organisation: org, supName: 'Boss', supPin: 'boss-all-1', comName: 'Clerk', comPin: 'clerk-all-1' }, '');
  const profiles = (await call(`/api/profiles?db=${slug}`, undefined, '')).body;
  const login = async (n: string, pin: string) => (await call('/api/login', { db: slug, profileId: profiles.find((p: { name: string }) => p.name === n).id, password: pin }, '')).set!;
  const ck = await login('Boss', 'boss-all-1');
  const op = (n: string, a: unknown = {}) => call(`/api/op/${n}`, a, ck);
  await op('list.add', { table: 'city', name: org });
  await op('heading.add', { name: 'Staff', types: ['Exp'] });
  let L = (await op('data')).body.lists;
  await op('line.add', { headingId: L.headings.find((h: { name: string }) => h.name === 'Staff').id, name: 'Reception' });
  expect((await op('grant.save', { donor: 'SEN', amount: 9000, currency: 'USD', reference: 'SEN-1', here: key, shares: [{ centre: 'aleppo', amount: 3000 }, { centre: 'homs', amount: 6000 }], fund_id: null, new_fund: `SEN ${key}` })).status).toBe(200);
  L = (await op('data')).body.lists;
  const line = L.lines.find((l: { name: string }) => l.name === 'Reception');
  await op('budget.create', { start_ym: '2026-01', months: 12, rate_syp: 13000, rate_eur: 0.9, from: 'empty' });
  const v = (await op('budget.get', {})).body.current.id;
  await op('budget.saveAmounts', { versionId: v, cells: [{ line_id: line.id, amount_usd: 1000 }] });
  if (funded) await op('budget.setFund', { versionId: v, line_ids: [line.id], account_id: L.accounts.find((a: { name: string }) => a.name === `SEN ${key}`).id });
  expect((await op('trx.save', { rows: [{ ...blankTrx(), id: `e-${key}`, date: '2026-05-01', type: 'Exp', book_id: L.books[0].id, city_id: L.cities[0].id, account_id: null, heading_id: line.heading_id, line_id: line.id, exp_usd: 100, explanation: 'x' }] })).status).toBe(200);
  return { ck, clerk: await login('Clerk', 'clerk-all-1') };
}

describe('all centres together', () => {
  it('each centre, and the same grant across the centres by its contract number; only for who keeps the grants', async () => {
    const a = await centre('MAGIS Aleppo', 'aleppo', true);
    await centre('MAGIS Homs', 'homs', false);
    const r = await call('/api/all-centres', { from: '2026-01', to: '2026-12' }, a.ck);
    expect(r.status).toBe(200);
    expect(r.body.centres.map((c: { centre: string; spent: number; withProject: number; notFunded: number }) => [c.centre, c.spent, c.withProject, c.notFunded])).toEqual([['aleppo', 100, 100, 0], ['homs', 100, 0, 100]]);
    expect(r.body.grants).toHaveLength(1);
    const g = r.body.grants[0];
    expect([g.donor, g.reference, g.amount, g.shares.length]).toEqual(['SEN', 'SEN-1', 9000, 2]);
    expect(g.centres.map((c: { centre: string; project: string; spentAll: number }) => [c.centre, c.project, c.spentAll])).toEqual([['aleppo', 'SEN aleppo', 100], ['homs', 'SEN homs', 0]]);
    expect((await call('/api/all-centres', {}, a.clerk)).status).toBe(403);
  });
});
