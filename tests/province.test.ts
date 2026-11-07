// The Province account (Fouad, 2026-11-07): the Coordinator's own book — money in, exchange USD → SYP, its months.
// Only the Coordinator (the directory's administrator) reaches it; it is never listed with the centres.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';
import { blankTrx } from '../src/db/repo';

let srv: Running;
let base: string;
let dir: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-prov-'));
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  base = `http://127.0.0.1:${srv.httpPort}`;
}, 60000);
afterAll(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function browser() {
  const jar = new Map<string, string>();
  return async (url: string, body?: unknown) => {
    const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

describe('the Province account', () => {
  it('money in, an exchange, the balance, the month; for the Coordinator only', async () => {
    const admin = browser();
    const made = await admin('/api/dbs/create', { organisation: 'Homs', centre: 'homs' });
    await admin('/api/setup/new', { db: made.body.slug, organisation: 'Homs', supName: 'Boss', supPin: 'boss-prov-1', comName: 'Clerk', comPin: 'clerk-prov-1' });
    const stranger = browser();
    expect((await stranger('/api/province')).status).toBe(403);
    expect((await admin('/api/dir/setup', { name: 'Fouad', password: 'fouad-pass-1' })).status).toBe(200);
    const p = (await admin('/api/province')).body;
    expect(p.balance).toEqual({ syp: 0, usd: 0 });
    const L = p.lists;
    const head = (n: string) => L.headings.find((h: { name: string }) => h.name === n);
    const line = (n: string) => L.lines.find((l: { heading_id: number }) => l.heading_id === head(n).id);
    const row = { ...blankTrx(), book_id: p.bookId, city_id: L.cities[0].id, date: '2026-11-02' };
    expect((await admin('/api/province/op/trx.save', { rows: [{ ...row, id: 'in-1', type: 'Income', heading_id: head('Income').id, line_id: line('Income').id, inc_usd: 10000, explanation: 'SEN-2027, first part' }] })).status).toBe(200);
    expect((await admin('/api/province/op/trx.save', { rows: [{ ...row, id: 'ex-1', type: 'Exchange', heading_id: head('Exchange').id, line_id: line('Exchange').id, trf_usd: 2000, trf_syp: 26_000_000 }] })).status).toBe(200);
    expect((await admin('/api/province')).body.balance).toEqual({ syp: 26_000_000, usd: 8000 });
    // only its rows and months: nothing else
    expect((await admin('/api/province/op/users.save', {})).status).toBe(400);
    expect((await admin('/api/province/op/month.close', { ym: '2026-11' })).status).toBe(200);
    expect((await admin('/api/province')).body.closed).toEqual(['2026-11']);
    expect((await admin('/api/province/op/trx.save', { rows: [{ ...row, id: 'in-2', type: 'Income', heading_id: head('Income').id, line_id: line('Income').id, inc_usd: 5, explanation: 'late' }] })).status).toBe(400);
    // never among the centres
    expect((await admin('/api/hello')).body.dbs.map((d: { slug: string }) => d.slug)).toEqual([made.body.slug]);
    expect((await admin('/api/dbs/manage')).body.dbs.map((d: { slug: string }) => d.slug)).toEqual([made.body.slug]);
    expect(fs.existsSync(path.join(dir, 'province', 'magis.db'))).toBe(true);
  });
});
