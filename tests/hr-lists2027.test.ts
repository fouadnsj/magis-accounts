// The gaps of the review (Fouad, 2026-11-12): HR with the list by activity (2027) — people placed on their line keep it
// after a Renumber (even when two codes swap); the salary lines when no heading is named; and the budget lists on a server
// that has no administrator (so no Coordinator yet).
import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';
import { renumber, type MainList } from '../src/io/mainList';
import { salaryLines } from '../src/hr/link';

const servers: Running[] = [];
const dirs: string[] = [];
afterAll(async () => { for (const s of servers) await s.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

async function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-l27-'));
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
  return { browser };
}

const LIST_FILE = decodeURIComponent(new URL('../../MD/list-centres-by-activity-2027.json', import.meta.url).pathname);

describe('the list by activity (2027) with HR, and a server with no administrator', () => {
  it('people keep their line after a Renumber that swaps two codes; the salary lines when no heading is named', async () => {
    const { browser } = await server();
    const admin = browser();
    expect((await admin('/api/dir/setup', { name: 'Fouad', password: 'fouad-pass-1' })).status).toBe(200);
    const file = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8')) as MainList;
    const made = await admin('/api/main-list/new', { title: 'Centres by activity 2027', from: 'file', list: file });
    const listId = made.body.id as string;
    expect((await admin('/api/main-list/publish', { id: listId })).status).toBe(200);

    // Aleppo 2027 on that list: every line comes in, switched on
    const c = await admin('/api/dbs/create', { organisation: 'Aleppo 2027', centre: 'aleppo', mainList: listId });
    await admin('/api/setup/new', { db: c.body.slug, organisation: 'Aleppo 2027', supName: 'Boss', supPin: 'boss-l27-1', comName: 'Clerk', comPin: 'clerk-l27-1' });
    // HR, with its keeper
    const hr = await admin('/api/dbs/create', { organisation: 'HR', centre: 'other', kind: 'hr' });
    await admin('/api/setup/hr', { db: hr.body.slug, organisation: 'HR', people: [{ name: 'Keeper', password: 'keeper-l27-1' }], mustChange: false });
    const keeper = browser();
    const kp = (await keeper(`/api/profiles?db=${hr.body.slug}`)).body[0].id;
    expect((await keeper('/api/login', { db: hr.body.slug, profileId: kp, password: 'keeper-l27-1' })).status).toBe(200);
    expect((await keeper('/api/hr/import-lists', { from: c.body.slug })).status).toBe(200);
    type Item = { id: number; kind: string; name: string; code: string | null; heading: string | null; source: string | null; salary_heading: string | null };
    const items = async () => (await keeper('/api/op/hr.data', {})).body.lists as Item[];
    const lines = (await items()).filter((x) => x.kind === 'line');
    // HR pays on expense lines only: no income, transfer or exchange line is offered
    expect(lines.some((x) => ['Income', 'Transfer', 'Exchange'].includes(x.heading ?? ''))).toBe(false);
    expect(lines.filter((x) => x.name === 'Reception')).toHaveLength(3);
    const cen = (await items()).find((x) => x.kind === 'centre')!;
    // no heading names the staff here: none is set (every expense line may carry a salary) ...
    expect(cen.salary_heading).toBeNull();
    // ... and set to the five headings of the list, only their lines are salary lines (the furniture is not)
    const five = ['Art Workshops', 'Academic Section', 'Library (study hall)', 'Spiritual Activities', 'Operational (direction and finance)'];
    expect((await keeper('/api/op/hr.list.save', { id: cen.id, kind: 'centre', name: cen.name, code: 'aleppo', salary_heading: five.join(' | ') })).status).toBe(200);
    const withHeadings = await items();
    const sal = salaryLines(withHeadings as never, { centre: cen.name });
    expect(sal.some((x) => x.heading === 'Furniture & equipment')).toBe(false);
    expect(sal.length).toBe(lines.filter((x) => five.includes(x.heading ?? '')).length);

    // two people, on two different "Reception" lines (Art Workshops E01.2, Academic Section E02.2)
    const art = lines.find((x) => x.name === 'Reception' && x.heading === 'Art Workshops')!;
    const aca = lines.find((x) => x.name === 'Reception' && x.heading === 'Academic Section')!;
    const lab = (l: Item) => `${l.code} · ${l.name}`;
    for (const [name, l] of [['Rima', art], ['Salma', aca]] as const)
      expect((await keeper('/api/op/hr.person.save', { name, role: 'Reception', centre: cen.name, budget_line: lab(l), started: '2026-01-01' })).status).toBe(200);
    const lineOf = async (n: string) => ((await keeper('/api/op/hr.data', {})).body.people as { name: string; budget_line: string | null }[]).find((p) => p.name === n)!.budget_line;
    expect([await lineOf('Rima'), await lineOf('Salma')]).toEqual(['E01.2 · Reception', 'E02.2 · Reception']);

    // the administrator puts Academic Section first and renumbers: the two Receptions swap codes
    const draft = (await admin(`/api/main-list?id=${listId}`)).body.draft as MainList;
    const acaH = draft.headings.find((h) => h.name === 'Academic Section')!;
    const rest = draft.headings.filter((h) => h !== acaH);
    expect((await admin('/api/main-list/draft', { id: listId, list: renumber({ ...draft, headings: [acaH, ...rest] }) })).status).toBe(200);
    expect((await admin('/api/main-list/publish', { id: listId })).status).toBe(200);
    // HR copies again by itself: each person keeps THEIR line (Rima: Art Workshops, now E02.2; Salma: Academic, now E01.2)
    const rf = await keeper('/api/hr/refresh-lists', {});
    expect(rf.body).toEqual({ refreshed: ['Aleppo 2027'] });
    expect([await lineOf('Rima'), await lineOf('Salma')]).toEqual(['E02.2 · Reception', 'E01.2 · Reception']);
    const now = (await items()).filter((x) => x.kind === 'line');
    expect(now.find((x) => lab(x) === 'E02.2 · Reception')!.heading).toBe('Art Workshops');
    expect(now.find((x) => lab(x) === 'E01.2 · Reception')!.heading).toBe('Academic Section');
  });

  it('a server with no administrator: the budget lists are reached, changed and published from a centre', async () => {
    const { browser } = await server();
    const b = browser();
    const made = await b('/api/dbs/create', { organisation: 'Homs', centre: 'homs' });
    await b('/api/setup/new', { db: made.body.slug, organisation: 'Homs', supName: 'Boss', supPin: 'boss-nodir-1', comName: 'Clerk', comPin: 'clerk-nodir-1' });
    const profiles = (await b(`/api/profiles?db=${made.body.slug}`)).body;
    expect((await b('/api/login', { db: made.body.slug, profileId: profiles.find((p: { name: string }) => p.name === 'Boss').id, password: 'boss-nodir-1' })).status).toBe(200);
    // (no sign-in directory: no Coordinator; the screen sees "admin" and "no directory" and shows the lists in Admin)
    expect((await b('/api/main-lists')).body).toMatchObject({ admin: true, dir: false, lists: [] });
    const first = await b('/api/main-list/new', { title: 'Centres', from: 'db', source: made.body.slug });
    expect(first.body.id).toBe('centres');
    expect((await b('/api/main-list/publish', { id: 'centres' })).status).toBe(200);
    expect((await b('/api/main-lists')).body.lists.map((l: { id: string; version: number }) => [l.id, l.version])).toEqual([['centres', 1]]);
    // the keeper (not the Superior) of that server does not reach them
    const clerk = browser();
    const cp = (await clerk(`/api/profiles?db=${made.body.slug}`)).body.find((p: { name: string }) => p.name === 'Clerk').id;
    await clerk('/api/login', { db: made.body.slug, profileId: cp, password: 'clerk-nodir-1' });
    expect((await clerk('/api/main-lists')).body.lists).toEqual([]);
    expect((await clerk('/api/main-list/new', { title: 'X', from: 'empty' })).status).toBe(403);
  });
});
