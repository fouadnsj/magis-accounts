// The Coordinator's first page (Fouad, 2026-11-12): what is waiting — requests, sends, months, copies, grants, projects.
import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';
import { blankTrx } from '../src/db/repo';

const servers: Running[] = [];
const dirs: string[] = [];
afterAll(async () => { for (const s of servers) await s.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

async function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-wait-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  const srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.httpPort}`;
  const browser = () => {
    const jar = new Map<string, string>();
    return async (url: string, body?: unknown) => {
      const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      return { status: r.status, body: await r.json().catch(() => null) };
    };
  };
  return { browser, dir };
}

type Group = { key: string; area: string; items: { text: string; days?: number; note?: string | null; usd?: number; state?: string }[] };
const keys = (w: { groups: Group[] }) => w.groups.map((g) => g.key);

describe('the Coordinator: what is waiting', () => {
  it('gathers what needs the administrator, and says so when nothing does', async () => {
    const { browser, dir } = await server();
    const admin = browser();
    expect((await browser()('/api/coordinator/waiting')).status).toBe(403);
    expect((await admin('/api/dir/setup', { name: 'Fouad', password: 'fouad-pass-1' })).status).toBe(200);
    // an empty server: nothing is waiting
    expect((await admin('/api/coordinator/waiting')).body).toMatchObject({ count: 0, groups: [] });

    // a centre with a row in a month never closed, a project with no dates, a request for a line
    const homs = browser();
    const made = await homs('/api/dbs/create', { organisation: 'Homs', centre: 'homs' });
    const slug = made.body.slug;
    await homs('/api/setup/new', { db: slug, organisation: 'Homs', supName: 'Boss', supPin: 'boss-wait-1', comName: 'Clerk', comPin: 'clerk-wait-1' });
    const pid = (await homs(`/api/profiles?db=${slug}`)).body.find((p: { name: string }) => p.name === 'Boss').id;
    await homs('/api/login', { db: slug, profileId: pid, password: 'boss-wait-1' });
    await homs('/api/op/list.add', { table: 'city', name: 'Homs' });
    await homs('/api/op/heading.add', { name: 'Staff', types: ['Exp'] });
    await homs('/api/op/list.add', { table: 'account', name: 'SEN Library' });
    const L = (await homs('/api/op/data', {})).body.lists;
    await homs('/api/op/line.add', { headingId: L.headings.find((h: { name: string }) => h.name === 'Staff').id, name: 'Reception' });
    const L2 = (await homs('/api/op/data', {})).body.lists;
    const line = L2.lines.find((l: { name: string }) => l.name === 'Reception');
    const proj = L2.accounts.find((a: { name: string }) => a.name === 'SEN Library').id;
    expect((await homs('/api/op/trx.save', { rows: [{ ...blankTrx(), id: 'old-row', date: '2026-01-15', type: 'Exp', book_id: L2.books[0].id, city_id: L2.cities[0].id, heading_id: line.heading_id, line_id: line.id, exp_usd: 10, explanation: 'x' }] })).status).toBe(200);
    await homs('/api/main-list/new', { title: 'Centres', from: 'db', source: slug });
    await admin('/api/main-list/new', { title: 'Centres', from: 'db', source: slug });
    await admin('/api/main-list/publish', { id: 'centres' });
    await homs('/api/main-list/request', { kind: 'line', name: 'Night guard', heading_uid: (await admin('/api/main-list?id=centres')).body.list.headings[0].uid, why: 'a guard' });

    // a grant ending in 20 days, not split, with money in the account not yet sent; a loose income
    const end = new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10);
    await admin('/api/province/grant', { id: 'g1', donor: 'SEN', reference: 'SEN-1', amount: 10000, currency: 'USD', start_date: '2026-01-01', end_date: end, note: null,
      parts: [{ centre: slug, project_id: proj, amount: 4000, pct: null, centre_name: null, project_name: null }] });
    const p = (await admin('/api/province')).body;
    const inc = p.lists.headings.find((h: { name: string }) => h.name === 'Income');
    const gl = p.lists.lines.find((l: { heading_id: number; name: string }) => l.heading_id === inc.id && l.name === 'Grant');
    const row = { ...blankTrx(), book_id: p.bookId, city_id: p.lists.cities[0].id, date: '2026-09-02', type: 'Income', heading_id: inc.id, line_id: gl.id, explanation: 'x' };
    await admin('/api/province/op/trx.save', { rows: [{ ...row, id: 'in-g', inc_usd: 3000, grant_id: 'g1' }, { ...row, id: 'in-loose', inc_usd: 200 }] });

    const w = (await admin('/api/coordinator/waiting')).body as { count: number; groups: Group[] };
    const g = (k: string) => w.groups.find((x) => x.key === k)!;
    expect(keys(w)).toEqual(expect.arrayContaining(['requests', 'months', 'unsent', 'ending', 'unsplit', 'notready', 'loose']));
    expect(g('requests').items[0]).toMatchObject({ text: expect.stringContaining('Night guard') });
    expect(g('months').items.some((x) => x.text === 'Homs' && x.note?.includes('2026-01'))).toBe(true);
    expect(g('months').items.some((x) => x.state === 'province')).toBe(true); // September is behind us: the Province's month is open too
    expect(g('unsent').items[0]).toMatchObject({ text: 'SEN · SEN-1', usd: 3000 });
    expect(g('ending').items[0]).toMatchObject({ days: 20 });
    expect(g('unsplit').items[0]).toMatchObject({ usd: 6000 });
    expect(g('notready').items[0]).toMatchObject({ text: 'Homs › SEN Library', note: 'dates+line' });
    expect(g('loose').items[0]).toMatchObject({ text: '1', usd: 200 });
    expect(w.count).toBe(w.groups.reduce((a, x) => a + x.items.length, 0));

    // the project gets its dates and a budget line: it is ready to receive a send; then a send waits for the centre
    await homs('/api/op/account.setDates', { id: proj, start_date: '2026-01-01', end_date: end });
    await homs('/api/op/budget.create', { start_ym: '2026-01', months: 12, rate_syp: 13000, rate_eur: 0.9, from: 'empty' });
    const v = (await homs('/api/op/budget.get', {})).body.current.id;
    await homs('/api/op/budget.saveAmounts', { versionId: v, cells: [{ line_id: line.id, amount_usd: 100 }] });
    await homs('/api/op/budget.setFund', { versionId: v, line_ids: [line.id], account_id: proj });
    expect((await admin('/api/province/send', { date: '2026-09-03', centre: slug, project_id: proj, grant_id: 'g1', cur: 'USD', amount: 1000 })).status).toBe(200);
    const w2 = (await admin('/api/coordinator/waiting')).body as { groups: Group[] };
    expect(keys(w2)).not.toContain('notready');
    expect(w2.groups.find((x) => x.key === 'sends')!.items[0]).toMatchObject({ text: 'Homs › SEN Library', usd: 1000, state: 'waiting' });
    expect(w2.groups.find((x) => x.key === 'unsent')!.items[0].usd).toBe(2000);

    // a copy brought just now is not old (the 30 days rule itself is read from the date it was brought)
    const file = fs.readFileSync(path.join(dir, 'dbs', slug, 'magis.db')).toString('base64');
    const copy = await admin('/api/province/copy', { base64: file });
    expect(keys((await admin('/api/coordinator/waiting')).body)).not.toContain('copies');
    const cfgFile = path.join(dir, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    expect(cfg.copies[copy.body.slug]).toBeTruthy();
  });
});
