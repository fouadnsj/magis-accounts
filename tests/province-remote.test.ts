// A centre on another server (Fouad, 2026-11-07): Aleppo's backup brought to the Coordinator's server as a read-only
// copy; a grant split between Homs and Aleppo; a send to Aleppo travels as a file, Aleppo accepts it on its own server,
// and the answer comes back with its next copy. The grant's report counts both centres.
import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';

const servers: Running[] = [];
const dirs: string[] = [];
afterAll(async () => { for (const s of servers) await s.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

async function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-remote-'));
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
  /** a centre with its Superior signed in, an Income line and a project */
  const centre = async (org: string, key: string, project: string) => {
    const b = browser();
    const slug = (await b('/api/dbs/create', { organisation: org, centre: key })).body.slug;
    await b('/api/setup/new', { db: slug, organisation: org, supName: 'Boss', supPin: 'boss-remote-1', comName: 'Clerk', comPin: 'clerk-remote-1' });
    const profiles = (await b(`/api/profiles?db=${slug}`)).body;
    await b('/api/login', { db: slug, profileId: profiles.find((x: { name: string }) => x.name === 'Boss').id, password: 'boss-remote-1' });
    await b('/api/op/list.add', { table: 'city', name: org });
    await b('/api/op/heading.add', { name: 'Income', types: ['Income'] });
    const L = (await b('/api/op/data', {})).body.lists;
    await b('/api/op/line.add', { headingId: L.headings.find((h: { name: string }) => h.name === 'Income').id, name: 'Donation' });
    await b('/api/op/list.add', { table: 'account', name: project });
    // the project: its dates, and one line of the budget given to it (a send goes only to such a project)
    const L2 = (await b('/api/op/data', {})).body.lists;
    const pid = L2.accounts.find((a: { name: string }) => a.name === project).id;
    await b('/api/op/account.setDates', { id: pid, start_date: '2026-01-01', end_date: '2027-12-31' });
    await b('/api/op/heading.add', { name: 'Art Workshops', types: ['Exp'] });
    await b('/api/op/line.add', { headingId: (await b('/api/op/data', {})).body.lists.headings.find((h: { name: string }) => h.name === 'Art Workshops').id, name: 'Hospitality' });
    const line = (await b('/api/op/data', {})).body.lists.lines.find((l: { name: string }) => l.name === 'Hospitality');
    await b('/api/op/budget.create', { start_ym: '2026-01', months: 12, rate_syp: 13000, rate_eur: 0.9, from: 'empty' });
    await b('/api/op/budget.create', { start_ym: '2027-01', months: 12, rate_syp: 13000, rate_eur: 0.9, from: 'empty' });
    for (const x of (await b('/api/op/budget.get', {})).body.budgets as { id: number }[]) {
      const v = (await b('/api/op/budget.get', { budgetId: x.id })).body.current.id;
      await b('/api/op/budget.saveAmounts', { versionId: v, cells: [{ line_id: line.id, amount_usd: 500 }] });
      await b('/api/op/budget.setFund', { versionId: v, line_ids: [line.id], account_id: pid });
    }
    return { b, slug, dir };
  };
  return { browser, centre, dir };
}

describe('a centre on another server', () => {
  it('a copy, a shared grant, a send by file, the answer back with the next copy, the report', async () => {
    const one = await server();
    const two = await server();
    const homs = await one.centre('Homs', 'homs', 'SEN Library');
    const aleppo = await two.centre('Aleppo', 'aleppo', 'SEN Arts');
    const admin = one.browser();
    expect((await admin('/api/dir/setup', { name: 'Fouad', password: 'fouad-pass-1' })).status).toBe(200);
    const fileOf = () => fs.readFileSync(path.join(two.dir, 'dbs', aleppo.slug, 'magis.db')).toString('base64');

    // Aleppo's backup comes as a copy: read only, not offered to sign in
    const copy = await admin('/api/province/copy', { base64: fileOf() });
    expect(copy.body).toMatchObject({ organisation: 'Aleppo' });
    expect((await admin('/api/hello')).body.dbs.map((d: { slug: string }) => d.slug)).toEqual([homs.slug]);
    expect((await admin('/api/dir/enter', { db: copy.body.slug })).status).toBe(404);
    // nor given to anybody in People & access
    expect((await admin('/api/dir/people')).body.dbs.map((d: { slug: string }) => d.slug)).toEqual([homs.slug]);
    const projects = (await admin('/api/province/projects')).body as { slug: string; copy: string | null; projects: { id: number; name: string }[] }[];
    const ap = projects.find((x) => x.slug === copy.body.slug)!;
    expect(ap.copy).toBeTruthy();
    const hp = projects.find((x) => x.slug === homs.slug)!;

    // a grant split between Homs and Aleppo
    const pid = (c: typeof ap, n: string) => c.projects.find((x) => x.name === n)!.id;
    expect((await admin('/api/province/grant', { id: 'sen', donor: 'SEN', reference: 'SEN-2027', amount: 10000, currency: 'USD', start_date: '2026-01-01', end_date: '2027-12-31', note: null,
      parts: [{ centre: homs.slug, project_id: pid(hp, 'SEN Library'), amount: 6000, pct: null, centre_name: null, project_name: null }, { centre: copy.body.slug, project_id: pid(ap, 'SEN Arts'), amount: 4000, pct: null, centre_name: null, project_name: null }] })).status).toBe(200);

    // a send to Aleppo: nothing is written in the copy; the file goes to Aleppo
    const sent = await admin('/api/province/send', { date: '2026-11-05', centre: copy.body.slug, project_id: pid(ap, 'SEN Arts'), grant_id: 'sen', cur: 'USD', amount: 2000 });
    expect(sent.status).toBe(200);
    const file = (await admin(`/api/province/send-file?centre=${copy.body.slug}`)).body;
    expect(file.sends).toHaveLength(1);
    // Aleppo, on its own server, takes it and accepts (no Province's account is made there)
    expect((await aleppo.b('/api/province-take', file)).body).toEqual({ taken: 1 });
    expect((await aleppo.b('/api/op/province.sends', {})).body[0]).toMatchObject({ id: sent.body.id, usd: 2000, status: 'waiting' });
    expect((await aleppo.b('/api/province-answer', { id: sent.body.id, ok: true })).status).toBe(200);
    expect(fs.existsSync(path.join(two.dir, 'province'))).toBe(false);
    // the answer comes back with the next copy
    expect((await admin('/api/province/sends')).body[0].received_at).toBeNull();
    const again = await admin('/api/province/copy', { base64: fileOf(), slug: copy.body.slug });
    expect(again.body).toMatchObject({ slug: copy.body.slug, answers: 1 });
    expect((await admin('/api/province/sends')).body[0].received_at).toBeTruthy();

    // the grant's report: both centres, Aleppo's from its copy
    const rep = (await admin('/api/province/grant-report?id=sen')).body.report;
    expect(rep.parts.map((x: { centre_name: string; planned: number; accepted_usd: number }) => [x.centre_name, x.planned, x.accepted_usd])).toEqual([['Homs', 6000, 0], ['Aleppo', 4000, 2000]]);
    expect(rep.parts[1].copy_at).toBeTruthy();
    // its budget: both of Aleppo's budgets in the grant's period (2026 and 2027), not only the first
    expect(rep.parts[1].budget).toBe(1000);
    // a correction of a send to a copy works; a project is never made inside a copy
    const s2 = await admin('/api/province/send', { date: '2026-11-06', centre: copy.body.slug, project_id: pid(ap, 'SEN Arts'), grant_id: 'sen', cur: 'SYP', amount: 1_000_000 });
    expect((await admin('/api/province/send', { id: s2.body.id, date: '2026-11-06', centre: copy.body.slug, project_id: pid(ap, 'SEN Arts'), grant_id: 'sen', cur: 'SYP', amount: 1_200_000 })).status).toBe(200);
    expect((await admin('/api/province/grant-report?id=sen')).body.report.total.sent_syp).toBe(1_200_000);
    expect((await admin('/api/province/project', { centre: copy.body.slug, name: 'New' })).status).toBe(400);
    // a server with a Province account does not take a file of sends; Aleppo's does
    expect((await homs.b('/api/province-here')).body).toEqual({ here: true });
    expect((await aleppo.b('/api/province-here')).body).toEqual({ here: false });
    // a deleted copy leaves no mark: a database brought again under that name is not hidden
    expect((await admin('/api/dbs/delete', { db: copy.body.slug, name: 'Aleppo' })).status).toBe(200);
    expect((await admin('/api/dbs/manage')).body.dbs.some((d: { copy: unknown }) => d.copy)).toBe(false);
    expect(rep.total).toMatchObject({ planned: 10000, sent_usd: 2000, accepted_usd: 2000 });
  });
});
