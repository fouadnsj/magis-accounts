// The network server: setup, logins, and above all PERMISSIONS checked by the
// server itself (a browser can send anything; the server must refuse).
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';
import { blankTrx } from '../src/db/repo';
import type { DataPayload } from '../src/ops';
import type { Trx } from '../src/domain/types';

const WORKBOOK = decodeURIComponent(new URL('../../template/Master Sup.xlsx', import.meta.url).pathname);

let srv: Running;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-test-'));
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  base = `http://127.0.0.1:${srv.httpPort}`;
}, 60000);

afterAll(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(url: string, body?: unknown, cookie?: string) {
  const r = await fetch(base + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

async function loginAs(name: string, password: string) {
  const ps = (await call('/api/profiles')).body as { id: number; name: string }[];
  const p = ps.find((x) => x.name === name)!;
  const r = await call('/api/login', { profileId: p.id, password });
  expect(r.status).toBe(200);
  return r.cookie!;
}

const op = (name: string, args: unknown, cookie: string) => call(`/api/op/${name}`, args ?? {}, cookie);

describe('server: first setup', () => {
  it('needs setup, from this computer only', async () => {
    const h = (await call('/api/hello')).body;
    expect(h).toMatchObject({ server: true, setupNeeded: true, local: true });
  });

  it('creates the office database from Master Sup.xlsx', async () => {
    const r = await call('/api/setup/new', {
      organisation: 'Test centre', supName: 'Fouad', supPin: 'sup-secret', comName: 'Comptable', comPin: 'com-secret',
      workbook: fs.readFileSync(WORKBOOK).toString('base64'), workbookName: 'Master Sup.xlsx',
    });
    expect(r.status).toBe(200);
    expect(r.body.report.rows).toBe(586);
  }, 60000);

  it('cannot be set up twice', async () => {
    const r = await call('/api/setup/new', { organisation: 'x', supName: 'a', supPin: '123456', comName: 'b', comPin: '123456' });
    expect(r.status).toBe(409);
  });
});

describe('server: logins', () => {
  it('refuses a wrong password, and anything without a session', async () => {
    const ps = (await call('/api/profiles')).body as { id: number }[];
    expect((await call('/api/login', { profileId: ps[0].id, password: 'nope' })).status).toBe(400);
    expect((await call('/api/op/data', {})).status).toBe(401);
  });

  it('logs in with an HttpOnly cookie', async () => {
    const ps = (await call('/api/profiles')).body as { id: number; name: string }[];
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: ps.find((p) => p.name === 'Comptable')!.id, password: 'com-secret' }) });
    expect(r.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict/);
  });
});

describe('server: permissions are checked by the server', () => {
  let sup: string;
  let com: string;
  let holder: string;
  let roulaId: number;
  let naghamId: number;

  beforeAll(async () => {
    sup = await loginAs('Fouad', 'sup-secret');
    com = await loginAs('Comptable', 'com-secret');
    const d = (await op('data', {}, sup)).body as DataPayload;
    roulaId = d.lists.books.find((b) => b.name === 'Roula')!.id;
    naghamId = d.lists.books.find((b) => b.name === 'Nagham')!.id;
    expect((await op('profile.add', { name: 'Roula', role: 'holder', pin: 'roula-secret', book_id: roulaId }, sup)).status).toBe(200);
    holder = await loginAs('Roula', 'roula-secret');
  });

  it('the accountant sees no donors and no grants', async () => {
    const d = (await op('data', {}, com)).body as DataPayload;
    expect(d.rows.length).toBe(586);
    expect(d.lists.donors).toEqual([]);
    expect((await op('grant.add', { date: '2026-10-01', donor_id: 1, project_id: null, amount_usd: 100, reference: null, note: null }, com)).status).toBe(400);
  });

  it('the superior sees the donors', async () => {
    const d = (await op('data', {}, sup)).body as DataPayload;
    expect(d.lists.donors.length).toBeGreaterThan(0);
  });

  it('only the superior adds users', async () => {
    expect((await op('profile.add', { name: 'X', role: 'sup', pin: '12345678', book_id: null }, com)).status).toBe(400);
  });

  it('a holder sees only his own book', async () => {
    const d = (await op('data', {}, holder)).body as DataPayload;
    expect(d.rows.length).toBeGreaterThan(0);
    expect(d.rows.every((r) => r.book_id === roulaId)).toBe(true);
  });

  it('a holder cannot write in another book, nor book a transfer, nor manage lists', async () => {
    const d = (await op('data', {}, holder)).body as DataPayload;
    const L = d.lists;
    const row = (over: Partial<Trx>): Trx => ({
      ...blankTrx(), city_id: L.cities[0].id, account_id: L.accounts.find((a) => a.name === 'Center')!.id, book_id: roulaId, date: '2026-10-12', type: 'Exp',
      heading_id: L.headings.find((h) => h.name === 'Operations')!.id, line_id: L.lines.find((l) => l.name === 'Internet')!.id, explanation: 'test', exp_syp: 1234, ...over,
    });
    expect((await op('trx.save', { rows: [row({ book_id: naghamId })] }, holder)).body.error.en).toMatch(/own book/);
    expect((await op('trx.save', { rows: [row({ type: 'Transfer', exp_syp: 0, trf_syp: 100 })] }, holder)).status).toBe(400);
    expect((await op('list.add', { table: 'party', name: 'hack' }, holder)).status).toBe(400);

    // a correct row is saved and numbered by the server
    const before = (await call('/api/version', undefined, holder)).body.v;
    const ok = await op('trx.save', { rows: [row({})] }, holder);
    expect(ok.status).toBe(200);
    const after = (await op('data', {}, com)).body as DataPayload;
    expect(after.rows.length).toBe(587);
    expect(Math.max(...after.rows.map((r) => r.n ?? 0))).toBe(587);
    expect((await call('/api/version', undefined, holder)).body.v).toBeGreaterThan(before);
  });

  it('the server validates rows itself (a blank date is refused even if the screen is bypassed)', async () => {
    const d = (await op('data', {}, com)).body as DataPayload;
    const bad = { ...d.rows.find((r) => !r.review)!, id: crypto.randomUUID(), n: null, date: null };
    const r = await op('trx.save', { rows: [bad] }, com);
    expect(r.status).toBe(400);
    expect(r.body.error.en).toMatch(/Date is required/);
  });
});

describe('server: backups', () => {
  it('makes a backup and refuses paths outside the backups folder', async () => {
    const sup = await loginAs('Fouad', 'sup-secret');
    expect((await op('backup.now', {}, sup)).status).toBe(200);
    const list = (await op('backup.list', {}, sup)).body as { path: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((b) => !b.path.includes('/') && !b.path.includes('\\'))).toBe(true);
    expect((await op('backup.restore', { path: '../magis.db' }, sup)).status).toBe(400);
  });
});

describe('server: moving the desktop database in', () => {
  it('takes the office .db made by the desktop app, with its users; refuses a holder file', async () => {
    const { nodeDb } = await import('./nodeDb');
    const { createOffice, createHolder } = await import('../src/setup');
    const { exportListsPackage } = await import('../src/io/keeperFiles');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-up-'));
    const officeFile = path.join(tmp, 'office.db');
    const office = nodeDb(officeFile);
    await createOffice(office, { organisation: 'Desk', supName: 'S', supPin: 'sup-pass', comName: 'C', comPin: 'com-pass' });
    const holderFile = path.join(tmp, 'holder.db');
    await createHolder(nodeDb(holderFile), await exportListsPackage(office, 'x'), 1, 'H', 'holder-pass');

    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-srv2-'));
    const srv2 = await startServer({ dataDir: dir2, webRoot: dir2, config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
    const post = (body: unknown) => fetch(`http://127.0.0.1:${srv2.httpPort}/api/setup/upload-db`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      expect((await post({ base64: fs.readFileSync(holderFile).toString('base64') })).status).toBe(400);
      expect((await post({ base64: fs.readFileSync(officeFile).toString('base64') })).status).toBe(200);
      const hello = await (await fetch(`http://127.0.0.1:${srv2.httpPort}/api/hello`)).json();
      expect(hello).toMatchObject({ setupNeeded: false, organisation: 'Desk' });
      const ps = await (await fetch(`http://127.0.0.1:${srv2.httpPort}/api/profiles`)).json();
      expect(ps.map((p: { name: string }) => p.name).sort()).toEqual(['C', 'S']);
    } finally {
      await srv2.close();
      fs.rmSync(dir2, { recursive: true, force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('server: restore from an uploaded file (Superior only)', () => {
  it('replaces the data after a safety copy; the accountant may not', async () => {
    const { nodeDb } = await import('./nodeDb');
    const { createOffice } = await import('../src/setup');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-rs-'));
    const file = path.join(tmp, 'other.db');
    await createOffice(nodeDb(file), { organisation: 'Restored', supName: 'S2', supPin: 'sup2-pass', comName: 'C2', comPin: 'com2-pass' });
    const body = { base64: fs.readFileSync(file).toString('base64'), fileName: 'other.db' };

    const com = await loginAs('Comptable', 'com-secret');
    expect((await call('/api/server/restore-upload', body, com)).status).toBe(403);

    const sup = await loginAs('Fouad', 'sup-secret');
    const before = ((await op('backup.list', {}, sup)).body as { name: string }[]).length;
    expect((await call('/api/server/restore-upload', { base64: 'bm90IGEgZGF0YWJhc2U=', fileName: 'x.db' }, sup)).status).toBe(400);
    expect((await call('/api/server/restore-upload', body, sup)).status).toBe(200);
    expect((await call('/api/hello')).body.organisation).toBe('Restored');
    expect((await call('/api/op/data', {}, sup)).status).toBe(401); // everybody logs in again
    const sup2 = await loginAs('S2', 'sup2-pass');
    expect(((await op('backup.list', {}, sup2)).body as { name: string }[]).length).toBeGreaterThan(before); // safety copies kept
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

// Last: it blocks this computer's address for 5 minutes.
describe('server: too many wrong passwords', () => {
  it('blocks the address for 5 minutes after 8 failures', async () => {
    const ps = (await call('/api/profiles')).body as { id: number }[];
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await call('/api/login', { profileId: ps[0].id, password: 'wrong' })).status;
    expect(last).toBe(429);
  });
});
