// The main list on the server (Fouad, 2026-11-03): the administrator starts it from Homs, changes a draft, publishes;
// every centre on the server follows (with its rows); a centre takes what it needs; a file goes to another server.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';
import { blankTrx } from '../src/db/repo';
import { newUid, type MainList } from '../src/io/mainList';

const dirs: string[] = [];
const servers: Running[] = [];
async function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-main-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  const srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.httpPort}`;
  const call = async (url: string, body: unknown, cookie: string) => {
    const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.getSetCookie().find((c) => c.startsWith('magis_sid='));
    return { status: r.status, body: await r.json().catch(() => null), set: set?.split(';')[0] };
  };
  /** a centre with Staff › Reception and one expense on it */
  const centre = async (org: string, key: 'aleppo' | 'homs') => {
    const slug = (await call('/api/dbs/create', { organisation: org, centre: key }, '')).body.slug;
    await call('/api/setup/new', { db: slug, organisation: org, supName: 'Boss', supPin: 'boss-main-1', comName: 'Clerk', comPin: 'clerk-main-1' }, '');
    const profiles = (await call(`/api/profiles?db=${slug}`, undefined, '')).body;
    const login = async (n: string, pin: string) => (await call('/api/login', { db: slug, profileId: profiles.find((p: { name: string }) => p.name === n).id, password: pin }, '')).set!;
    const ck = await login('Boss', 'boss-main-1');
    const op = (n: string, a: unknown = {}) => call(`/api/op/${n}`, a, ck);
    await op('list.add', { table: 'city', name: org });
    await op('heading.add', { name: 'Staff', types: ['Exp'] });
    let L = (await op('data')).body.lists;
    await op('line.add', { headingId: L.headings.find((h: { name: string }) => h.name === 'Staff').id, name: 'Reception' });
    L = (await op('data')).body.lists;
    const line = L.lines.find((l: { name: string }) => l.name === 'Reception');
    expect((await op('trx.save', { rows: [{ ...blankTrx(), id: `e-${key}`, date: '2026-05-01', type: 'Exp', book_id: L.books[0].id, city_id: L.cities[0].id, account_id: null, heading_id: line.heading_id, line_id: line.id, exp_usd: 100, explanation: 'x' }] })).status).toBe(200);
    return { ck, op, call: (url: string, body?: unknown) => call(url, body, ck), clerk: await login('Clerk', 'clerk-main-1') };
  };
  return { call, centre };
}

beforeAll(() => undefined);
afterAll(async () => {
  for (const s of servers) await s.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('the main list on the server', () => {
  it('started from Homs, changed as a draft, published: every centre follows with its rows; another server takes the file', async () => {
    const one = await server();
    const homs = await one.centre('MAGIS Homs', 'homs');
    const aleppo = await one.centre('MAGIS Aleppo', 'aleppo');
    let info = (await homs.call('/api/main-list')).body;
    expect(info).toMatchObject({ list: null, draft: null, admin: true, editable: true });
    // not for the accountant
    expect((await one.call('/api/main-list/start', {}, homs.clerk)).status).toBe(403);
    const draft: MainList = (await homs.call('/api/main-list/start', {})).body.draft;
    expect(draft.lines.some((l) => l.name === 'Reception')).toBe(true);
    expect((await homs.call('/api/main-list/publish', {})).status).toBe(200); // version 1, as it is
    // the draft: a new heading "Activities", Reception renamed and moved under it
    const act = { uid: newUid(), code: 'E90', name: 'Activities', types: ['Exp' as const], active: 1 };
    const next: MainList = { ...draft, headings: [...draft.headings, act], lines: draft.lines.map((l) => (l.name === 'Reception' ? { ...l, name: 'Receptionist', heading_uid: act.uid } : l)) };
    expect((await homs.call('/api/main-list/draft', { list: next })).status).toBe(200);
    const preview = (await homs.call('/api/main-list/preview', {})).body.centres;
    expect(preview.find((c: { organisation: string }) => c.organisation === 'MAGIS Homs')).toMatchObject({ moved: 1, rows: 1 });
    const pub = await homs.call('/api/main-list/publish', {});
    expect(pub.status).toBe(200);
    expect(pub.body.list.version).toBe(2);
    // both centres: Aleppo's "Staff › Reception" was the same by its name (version 1), and follows
    for (const c of [homs, aleppo]) {
      const L = (await c.op('data')).body.lists;
      const rec = L.lines.find((l: { name: string }) => l.name === 'Receptionist');
      expect(L.headings.find((h: { id: number }) => h.id === rec.heading_id).name).toBe('Activities');
      expect(rec.in_main).toBe(1);
      const row = (await c.op('data')).body.rows.find((r: { id: string }) => r.id.startsWith('e-'));
      expect(row.heading_id).toBe(rec.heading_id);
      // a centre does not rename what came from the main list
      expect((await c.op('list.rename', { table: 'budget_line', id: rec.id, name: 'Front desk' })).status).toBe(400);
    }
    // Aleppo cannot add a line any more: it asks; the administrator adds it; once published, Aleppo takes it and moves its waiting row
    const aL = (await aleppo.op('data')).body.lists;
    const recA = aL.lines.find((l: { name: string }) => l.name === 'Receptionist');
    expect((await aleppo.op('line.add', { headingId: recA.heading_id, name: 'Night guard' })).status).toBe(400);
    const pubList = (await aleppo.call('/api/main-list')).body.list as MainList;
    const ask = await aleppo.call('/api/main-list/request', { kind: 'line', name: 'Night guard', heading_uid: act.uid, why: 'a guard at night', meanwhile_line_uid: recA.uid });
    expect(ask.status).toBe(200);
    expect((await aleppo.call('/api/main-list/requests')).body.map((r: { name: string }) => r.name)).toEqual(['Night guard']);
    expect((await homs.call('/api/main-list/requests')).body).toHaveLength(1); // the administrator sees all
    expect((await one.call('/api/main-list/answer', { id: ask.body.id, how: 'add' }, aleppo.clerk)).status).toBe(403);
    const ans = await homs.call('/api/main-list/answer', { id: ask.body.id, how: 'add', name: 'Night guard' });
    expect(ans.status).toBe(200);
    expect(ans.body.draft.lines.some((l: { name: string }) => l.name === 'Night guard')).toBe(true);
    expect(pubList.lines.some((l) => l.name === 'Night guard')).toBe(false); // not before publishing
    expect((await homs.call('/api/main-list/publish', {})).status).toBe(200);
    const v3 = (await aleppo.call('/api/main-list')).body.list as MainList;
    expect((await aleppo.op('main.take', { list: v3, take: [ans.body.request.answer_uid] })).status).toBe(200);
    const guard = (await aleppo.op('data')).body.lists.lines.find((l: { name: string }) => l.name === 'Night guard');
    expect((await aleppo.op('main.moveRows', { ids: ['e-aleppo'], toLineId: guard.id })).status).toBe(200);
    expect((await aleppo.op('data')).body.rows.find((r: { id: string }) => r.id === 'e-aleppo').line_id).toBe(guard.id);

    // this server makes the list: it does not take a file
    const file = (await homs.call('/api/main-list')).body.list as MainList;
    expect((await homs.call('/api/main-list/import', { list: file })).status).toBe(400);

    // another city's server: takes the file, cannot change it, refuses an older one
    const two = await server();
    const damascus = await two.centre('MAGIS Damascus', 'aleppo');
    expect((await damascus.call('/api/main-list/import', { list: file })).status).toBe(200);
    info = (await damascus.call('/api/main-list')).body;
    expect(info).toMatchObject({ editable: false, list: { version: 3 } });
    expect((await damascus.call('/api/main-list/draft', { list: file })).status).toBe(400);
    expect((await damascus.call('/api/main-list/import', { list: { ...file, version: 2 } })).status).toBe(400);
    // a centre there takes a line it did not have
    const sal = file.lines.find((l) => l.name !== 'Receptionist' && l.active)!;
    expect((await damascus.op('main.take', { list: file, take: [sal.uid] })).status).toBe(200);
    expect((await damascus.op('data')).body.lists.lines.some((l: { uid: string; active: number }) => l.uid === sal.uid && l.active)).toBe(true);
  }, 120000);
});
