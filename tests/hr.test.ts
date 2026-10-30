// The HR database, stage 1 (Fouad, 30 October 2026): people, agreements, stipend letters, code of conduct, the vault and its log.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';

let srv: Running;
let base: string;
let dir: string;
let cookie = '';

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-hr-'));
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  base = `http://127.0.0.1:${srv.httpPort}`;
}, 60000);
afterAll(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(url: string, body?: unknown, ck = cookie) {
  const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie().find((c) => c.startsWith('magis_sid='));
  if (set && !ck) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null), set: set ? set.split(';')[0] : null };
}
const op = (name: string, args: unknown = {}, ck = cookie) => call(`/api/op/${name}`, args, ck);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');

describe('HR database', () => {
  it('people, papers, conduct, vault with its log, reader limits, alerts', async () => {
    const made = await call('/api/dbs/create', { organisation: 'HR', centre: 'other', kind: 'hr' });
    const slug = made.body.slug;
    expect((await call('/api/setup/hr', { db: slug, organisation: 'HR', people: [{ name: 'Fouad', password: 'fouad-hr-1' }], mustChange: false })).status).toBe(200);
    const profiles = (await call(`/api/profiles?db=${slug}`)).body;
    const login = await call('/api/login', { db: slug, profileId: profiles[0].id, password: 'fouad-hr-1' }, '');
    cookie = login.set!;
    const keeper = cookie;
    expect(login.status).toBe(200);

    const pid = (await op('hr.person.save', { name: 'Salma', father_name: 'Ahmad', national_id: '01234567890', birth_place: 'Aleppo', birth_date: '1999-04-02', address: 'Aleppo', role: 'Reception', started: '2026-01-01' })).body.id;
    expect(pid).toBeGreaterThan(0);

    // alerts: no agreement, code of conduct not signed (once there is a version)
    const d0 = (await op('hr.data', { today: '2026-11-15' })).body;
    expect(d0.alerts.map((a: { kind: string }) => a.kind)).toEqual(['agreement_missing']);

    // a yearly agreement, ending on 31 December: "ending" within 60 days; its scan arrives later
    const ag = (await op('hr.paper.save', { personId: pid, kind: 'agreement', start: '2026-01-01', end: '2026-12-31', amount: 180, currency: 'USD' })).body.id;
    const kinds = (await op('hr.data', { today: '2026-11-15' })).body.alerts.map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(['agreement_ending', 'unsigned_paper']);
    expect((await op('hr.file.add', { kind: 'paper', id: ag, base64: PNG, mime: 'image/png', name: 'Salma agreement.png' })).status).toBe(200);
    // the next year's agreement removes the "ending" alert
    await op('hr.paper.save', { personId: pid, kind: 'agreement', start: '2027-01-01', end: '2027-12-31' });
    expect((await op('hr.data', { today: '2026-11-15' })).body.alerts.map((a: { kind: string }) => a.kind)).toEqual(['unsigned_paper']);

    // a stipend letter must say which service
    expect((await op('hr.paper.save', { personId: pid, kind: 'stipend', amount: 50 })).status).toBe(400);
    expect((await op('hr.paper.save', { personId: pid, kind: 'stipend', service: 'Workshop animation', amount: 50, paidOn: '2026-10-15' })).status).toBe(200);

    // the code of conduct: a version, signed by the person
    const cv = (await op('hr.conduct.save', { version: '1.0', validFrom: '2026-01-01' })).body.id;
    expect((await op('hr.data', { today: '2026-11-15' })).body.alerts.some((a: { kind: string }) => a.kind === 'conduct_unsigned')).toBe(true);
    expect((await op('hr.conduct.sign', { conductId: cv, personId: pid, signedOn: '2026-02-01' })).status).toBe(200);
    expect((await op('hr.conduct.sign', { conductId: cv, personId: pid, signedOn: '2026-02-02' })).status).toBe(400); // already
    expect((await op('hr.data', { today: '2026-11-15' })).body.alerts.some((a: { kind: string }) => a.kind === 'conduct_unsigned')).toBe(false);

    // the vault: add, expiry alert, opening is logged
    const doc = (await op('hr.vault.add', { personId: pid, label: 'ID card', expiresOn: '2026-11-20', base64: PNG, mime: 'image/png', name: 'id.png' })).body.id;
    expect((await op('hr.vault.add', { personId: pid, label: 'x', base64: PNG, mime: 'text/html' })).status).toBe(400); // only PDF or pictures
    expect((await op('hr.data', { today: '2026-11-15' })).body.alerts.some((a: { kind: string; days: number }) => a.kind === 'doc_expiring' && a.days === 5)).toBe(true);
    const got = await op('hr.file.get', { kind: 'doc', id: doc });
    expect(got.body.base64).toBe(PNG);
    const log = (await op('hr.access.list')).body as { action: string; what: string }[];
    expect(log.map((l) => `${l.action} ${l.what}`)).toEqual(expect.arrayContaining(['open doc', 'add doc', 'open doc'.replace('open', 'add')]));
    expect(log.filter((l) => l.action === 'open' && l.what === 'doc')).toHaveLength(1);

    // a reader (hr.view only): sees people and papers, never the vault, cannot change anything
    expect((await op('user.save', { name: 'Reader', access_id: 2, books: [], pin: 'reader-pass-1' })).status).toBe(200);
    const rp = (await call(`/api/profiles?db=${slug}`)).body.find((p: { name: string }) => p.name === 'Reader');
    const rl = await call('/api/login', { db: slug, profileId: rp.id, password: 'reader-pass-1' }, '');
    const rc = rl.set!;
    expect((await op('profile.setPin', { id: rp.id, pin: 'reader-own-2' }, rc)).status).toBe(200); // the first password is replaced
    const rd = (await op('hr.data', {}, rc)).body;
    expect(rd.people).toHaveLength(1);
    expect(rd.docs).toBeNull();
    expect((await op('hr.file.get', { kind: 'doc', id: doc }, rc)).status).toBe(400);
    expect((await op('hr.person.save', { name: 'Nope' }, rc)).status).toBe(400);
    expect((await op('hr.access.list', {}, rc)).status).toBe(400);
    expect((await op('hr.file.get', { kind: 'paper', id: ag }, rc)).status).toBe(200); // a reader may open a signed paper

    cookie = keeper; // (the reader's sign-in replaced it)
    // the person leaves: inactive, no longer in the alerts
    await op('hr.person.save', { id: pid, name: 'Salma', ended: '2026-10-31' });
    expect((await op('hr.data', { today: '2026-12-05' })).body.alerts).toEqual([]);
  });
});
