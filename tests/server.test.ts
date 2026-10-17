// The network server: setup, logins, and above all PERMISSIONS checked by the
// server itself (a browser can send anything; the server must refuse).
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
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
/** the database used by most tests (created in "first setup") */
let DB = '';

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
  const ps = (await call(`/api/profiles?db=${DB}`)).body as { id: number; name: string }[];
  const p = ps.find((x) => x.name === name)!;
  const r = await call('/api/login', { db: DB, profileId: p.id, password });
  expect(r.status).toBe(200);
  // An account made by the Superior: the person chooses his own password first (here, he keeps the same one).
  if (r.body.mustChange) expect((await call('/api/op/profile.setPin', { id: r.body.profile.id, pin: password }, r.cookie!)).status).toBe(200);
  return r.cookie!;
}

const op = (name: string, args: unknown, cookie: string) => call(`/api/op/${name}`, args ?? {}, cookie);

describe('server: first setup', () => {
  it('starts with no database; this computer may create one', async () => {
    const h = (await call('/api/hello')).body;
    expect(h).toMatchObject({ server: true, local: true, canCreate: true, dbs: [] });
  });

  it('creates a database, then sets it up from Master Sup.xlsx', async () => {
    const c = await call('/api/dbs/create', { organisation: 'Test centre', centre: 'homs' });
    expect(c.status).toBe(200);
    DB = c.body.slug;
    expect(DB).toBe('test-centre');
    expect((await call('/api/hello')).body.dbs).toEqual([{ slug: DB, organisation: 'Test centre', centre: 'homs', color: null, logo: null, setupNeeded: true }]);
    const r = await call('/api/setup/new', {
      db: DB,
      organisation: 'Test centre', supName: 'Fouad', supPin: 'sup-secret', comName: 'Comptable', comPin: 'com-secret',
      workbook: fs.readFileSync(WORKBOOK).toString('base64'), workbookName: 'Master Sup.xlsx',
    });
    expect(r.status).toBe(200);
    expect(r.body.report.rows).toBe(586);
  }, 60000);

  it('cannot be set up twice', async () => {
    const r = await call('/api/setup/new', { db: DB, organisation: 'x', supName: 'a', supPin: '123456', comName: 'b', comPin: '123456' });
    expect(r.status).toBe(409);
  });
});

describe('server: logins', () => {
  it('refuses a wrong password, and anything without a session', async () => {
    const ps = (await call(`/api/profiles?db=${DB}`)).body as { id: number }[];
    expect((await call('/api/login', { db: DB, profileId: ps[0].id, password: 'nope' })).status).toBe(400);
    expect((await call('/api/op/data', {})).status).toBe(401);
  });

  it('logs in with an HttpOnly cookie', async () => {
    const ps = (await call(`/api/profiles?db=${DB}`)).body as { id: number; name: string }[];
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ db: DB, profileId: ps.find((p) => p.name === 'Comptable')!.id, password: 'com-secret' }) });
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
    expect((await op('user.save', { name: 'Roula', access_id: 3, books: [roulaId], pin: 'roula-secret' }, sup)).status).toBe(200);
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
    expect((await op('user.save', { name: 'X', access_id: 1, books: [], pin: '12345678' }, com)).status).toBe(400);
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
    // a transfer is recorded by the giver: Roula cannot record money leaving Nagham's book
    const transfer = (book: number, amount: number) => row({ type: 'Transfer', book_id: book, exp_syp: 0, trf_syp: amount, heading_id: L.headings.find((h) => h.name === 'Other / Unallocated')!.id, line_id: L.lines.find((l) => l.name === 'Unallocated')!.id });
    expect((await op('trx.save', { rows: [transfer(naghamId, -100)] }, holder)).status).toBe(400);
    // nor record money given by Main (the office gives it)
    expect((await op('trx.save', { rows: [transfer(roulaId, 100)] }, holder)).status).toBe(400);
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

  it('the accountant sees every book but writes only in Main; the superior writes everywhere', async () => {
    const d = (await op('data', {}, com)).body as DataPayload;
    const L = d.lists;
    const mainId = L.books.find((b) => b.is_main)!.id;
    expect(d.rows.some((r) => r.book_id === roulaId)).toBe(true); // sees Roula's book
    const row = (book: number): Trx => ({
      ...blankTrx(), city_id: L.cities[0].id, account_id: L.accounts.find((a) => a.name === 'Center')!.id, book_id: book, date: '2026-10-13', type: 'Exp',
      heading_id: L.headings.find((h) => h.name === 'Operations')!.id, line_id: L.lines.find((l) => l.name === 'Internet')!.id, explanation: 'acc test', exp_syp: 500,
    });
    expect((await op('trx.save', { rows: [row(roulaId)] }, com)).status).toBe(400);
    // nor change or delete an old row of Roula's book
    const old = d.rows.find((r) => r.book_id === roulaId && r.type !== 'Transfer' && !r.review)!;
    expect((await op('trx.save', { rows: [{ ...old, explanation: 'changed' }] }, com)).status).toBe(400);
    expect((await op('trx.delete', { ids: [old.id] }, com)).status).toBe(400);
    const inMain = row(mainId);
    expect((await op('trx.save', { rows: [inMain] }, com)).status).toBe(200);
    expect((await op('trx.delete', { ids: [inMain.id] }, com)).status).toBe(200);
    // the superior may write in any book
    const bySup = row(roulaId);
    expect((await op('trx.save', { rows: [bySup] }, sup)).status).toBe(200);
    expect((await op('trx.delete', { ids: [bySup.id] }, sup)).status).toBe(200);
  });

  it('the server validates rows itself (a blank date is refused even if the screen is bypassed)', async () => {
    const d = (await op('data', {}, com)).body as DataPayload;
    const bad = { ...d.rows.find((r) => !r.review)!, id: crypto.randomUUID(), n: null, date: null };
    const r = await op('trx.save', { rows: [bad] }, sup);
    expect(r.status).toBe(400);
    expect(r.body.error.en).toMatch(/Date is required/);
  });
});

describe('server: transfers recorded once by the giver, confirmed by the receiver', () => {
  let sup: string, com: string, roula: string, nagham: string;
  let L: DataPayload['lists'];
  let roulaId: number, naghamId: number;
  const NOV = '2026-11-05';

  beforeAll(async () => {
    sup = await loginAs('Fouad', 'sup-secret');
    com = await loginAs('Comptable', 'com-secret');
    roula = await loginAs('Roula', 'roula-secret');
    L = ((await op('data', {}, sup)).body as DataPayload).lists;
    roulaId = L.books.find((b) => b.name === 'Roula')!.id;
    naghamId = L.books.find((b) => b.name === 'Nagham')!.id;
    expect((await op('user.save', { name: 'Nagham', access_id: 3, books: [naghamId], pin: 'nagham-secret' }, sup)).status).toBe(200);
    nagham = await loginAs('Nagham', 'nagham-secret');
  });

  const leg = (book: number, amount: number, group: string | null, over: Partial<Trx> = {}): Trx => ({
    ...blankTrx(), city_id: L.cities[0].id, account_id: L.accounts.find((a) => a.name === 'Center')!.id, book_id: book, date: NOV, type: 'Transfer',
    heading_id: L.headings.find((h) => h.name === 'Other / Unallocated')!.id, line_id: L.lines.find((l) => l.name === 'Unallocated')!.id,
    trf_syp: amount, transfer_group: group, ...over,
  });
  const transfersOf = async (cookie: string) => ((await op('data', {}, cookie)).body as DataPayload).transfers;

  it('Main → Roula by the office appears in Roula\'s book, to confirm; only Roula confirms', async () => {
    const t1 = leg(roulaId, 25000, null);
    expect((await op('trx.save', { rows: [t1] }, com)).status).toBe(200);
    const mine = (await transfersOf(roula)).find((x) => x.rowIds.includes(t1.id))!;
    expect(mine).toMatchObject({ to: roulaId, amount: 25000, receivedAt: null });
    expect((await op('transfer.answer', { id: t1.id, ok: true }, nagham)).status).toBe(400);
    expect((await op('transfer.answer', { id: t1.id, ok: true }, roula)).status).toBe(200);
    expect((await transfersOf(roula)).find((x) => x.rowIds.includes(t1.id))!.receivedBy).toBe('Roula');
  });

  it('Roula → Nagham: recorded once by Roula, seen by both, confirmed by Nagham; then Roula cannot change it', async () => {
    const g = crypto.randomUUID();
    const out = leg(roulaId, -7000, g);
    const inn = leg(naghamId, 7000, g);
    expect((await op('trx.save', { rows: [out, inn] }, roula)).status).toBe(200);
    const seenByNagham = (await transfersOf(nagham)).find((x) => x.key === g)!;
    expect(seenByNagham).toMatchObject({ from: roulaId, to: naghamId, amount: 7000 });
    // Nagham's own register now has the + row, without having typed anything
    expect(((await op('data', {}, nagham)).body as DataPayload).rows.some((r) => r.id === inn.id)).toBe(true);
    expect((await op('transfer.answer', { id: inn.id, ok: true }, nagham)).status).toBe(200);
    const r = await op('trx.save', { rows: [{ ...out, trf_syp: -8000 }, { ...inn, trf_syp: 8000 }] }, roula);
    expect(r.status).toBe(400);
    expect(r.body.error.en).toMatch(/confirmed/);
  });

  it('"Not received" is shown to everyone concerned', async () => {
    const t2 = leg(roulaId, -3000, null); // Roula hands 3,000 back to Main
    expect((await op('trx.save', { rows: [t2] }, roula)).status).toBe(200);
    expect((await op('transfer.answer', { id: t2.id, ok: false, note: 'received 2,000 only' }, com)).status).toBe(200);
    const x = (await transfersOf(roula)).find((t) => t.rowIds.includes(t2.id))!;
    expect(x.disputedAt).not.toBeNull();
    expect(x.disputeNote).toBe('received 2,000 only');
  });

  it('month closing: book first (blocked while a transfer is unanswered), then the office; only the Superior reopens', async () => {
    // Roula's November: the disputed transfer blocks her closing
    let r = await op('bookMonth.close', { bookId: roulaId, ym: '2026-11' }, roula);
    expect(r.status).toBe(400);
    expect(r.body.error.en).toMatch(/not received/);
    // the giver fixes it (the accountant writes only in Main): delete the disputed transfer, record the right amount, Main confirms
    const disputed = (await transfersOf(com)).find((x) => x.disputedAt)!;
    expect((await op('trx.delete', { ids: disputed.rowIds }, com)).status).toBe(400);
    expect((await op('trx.delete', { ids: disputed.rowIds }, roula)).status).toBe(200);
    const fixed = leg(roulaId, -2000, null);
    expect((await op('trx.save', { rows: [fixed] }, roula)).status).toBe(200);
    expect((await op('transfer.answer', { id: fixed.id, ok: true }, com)).status).toBe(200);
    expect((await op('bookMonth.close', { bookId: roulaId, ym: '2026-11' }, roula)).status).toBe(200);

    // after closing, Roula cannot write in November any more
    const late = { ...leg(roulaId, 0, null), type: 'Exp' as const, trf_syp: 0, exp_syp: 500, explanation: 'late', heading_id: L.headings.find((h) => h.name === 'Operations')!.id, line_id: L.lines.find((l) => l.name === 'Internet')!.id };
    r = await op('trx.save', { rows: [late] }, roula);
    expect(r.body.error.en).toMatch(/closed this month/);

    // the office cannot close November while Nagham's book is open
    r = await op('month.close', { ym: '2026-11' }, com);
    expect(r.body.error.en).toMatch(/Books not closed yet: .*Nagham/);
    expect((await op('bookMonth.close', { bookId: naghamId, ym: '2026-11' }, nagham)).status).toBe(200);
    expect((await op('month.close', { ym: '2026-11' }, com)).status).toBe(200);

    // closed for everybody, the Superior included
    r = await op('trx.save', { rows: [{ ...late, id: crypto.randomUUID(), book_id: L.books.find((b) => b.is_main)!.id }] }, sup);
    expect(r.body.error.en).toMatch(/Month 2026-11 is closed/);
    expect((await op('month.reopen', { ym: '2026-11' }, com)).status).toBe(400);
    expect((await op('month.reopen', { ym: '2026-11' }, sup)).status).toBe(200);
  });
});

describe('server: permission profiles', () => {
  it('a profile can be changed, but someone must always keep "manage users"', async () => {
    const sup = await loginAs('Fouad', 'sup-secret');
    const list = (await op('access.list', {}, sup)).body as { id: number; name: string; perms: string[] }[];
    const supProfile = list.find((a) => a.id === 1)!;
    const r = await op('access.save', { id: 1, name: supProfile.name, perms: supProfile.perms.filter((p) => p !== 'users.manage') }, sup);
    expect(r.status).toBe(400);
    expect(((await op('access.list', {}, sup)).body as { id: number; perms: string[] }[]).find((a) => a.id === 1)!.perms).toContain('users.manage');
    // a new profile "Reader": sees everything, writes nothing
    expect((await op('access.save', { name: 'Reader', perms: ['register.view', 'reports.summary'] }, sup)).status).toBe(200);
    const reader = ((await op('access.list', {}, sup)).body as { id: number; name: string }[]).find((a) => a.name === 'Reader')!;
    expect((await op('user.save', { name: 'Auditor', access_id: reader.id, books: [], pin: 'auditor-pass' }, sup)).status).toBe(200);
    const aud = await loginAs('Auditor', 'auditor-pass');
    expect(((await op('data', {}, aud)).body as DataPayload).rows.length).toBeGreaterThan(586);
    const d = (await op('data', {}, aud)).body as DataPayload;
    expect((await op('trx.save', { rows: [{ ...d.rows[0], explanation: 'changed' }] }, aud)).status).toBe(400);
  });
});

describe('server: accounts for all book keepers', () => {
  it('creates one account per book nobody keeps, each must choose his own password at first login', async () => {
    const sup = await loginAs('Fouad', 'sup-secret');
    const made = (await op('users.createKeepers', {}, sup)).body as { name: string; book: string; password: string }[];
    expect(made.length).toBeGreaterThan(0);
    expect(made.some((x) => x.book === 'Roula')).toBe(false); // Roula already has her account
    const first = made[0];
    const ps = (await call(`/api/profiles?db=${DB}`)).body as { id: number; name: string }[];
    const r = await call('/api/login', { db: DB, profileId: ps.find((p) => p.name === first.name)!.id, password: first.password });
    expect(r.body.mustChange).toBe(true);
    expect((await op('data', {}, r.cookie!)).status).toBe(403); // nothing before choosing a password
    expect((await op('profile.setPin', { id: r.body.profile.id, pin: 'my-own-pass' }, r.cookie!)).status).toBe(200);
    expect((await op('data', {}, r.cookie!)).status).toBe(200);
    // a second run creates nobody
    expect(((await op('users.createKeepers', {}, sup)).body as unknown[]).length).toBe(0);
  });
});

describe('server: attached documents', () => {
  it('a holder attaches a PDF to his own row; it is named after the Bill_Code; only allowed people open it', async () => {
    const roula = await loginAs('Roula', 'roula-secret');
    const nagham = await loginAs('Nagham', 'nagham-secret');
    const com = await loginAs('Comptable', 'com-secret');
    const mine = ((await op('data', {}, roula)).body as DataPayload).rows.find((r) => r.type === 'Exp' && r.date?.startsWith('2026-10') && r.line_id != null)!;
    const pdf = Buffer.from('%PDF-1.4\n% test document\n').toString('base64');
    const r = await op('doc.add', { trxId: mine.id, base64: pdf, mime: 'application/pdf' }, roula);
    expect(r.status).toBe(200);
    expect(r.body.name).toMatch(new RegExp(`_N${String(mine.n).padStart(4, '0')}\\.pdf$`));
    // the file is on disk, next to the database
    expect(fs.existsSync(path.join(dir, 'dbs', DB, 'attachments', '2026', r.body.name))).toBe(true);
    // listed with the row
    expect(((await op('data', {}, roula)).body as DataPayload).attachments.some((a) => a.id === r.body.id)).toBe(true);
    // Nagham (another book) can neither see nor open it; the accountant can
    expect((await op('doc.get', { id: r.body.id }, nagham)).status).toBe(400);
    const got = await op('doc.get', { id: r.body.id }, com);
    expect(Buffer.from(got.body.base64, 'base64').toString()).toContain('test document');
    // not a PDF or picture: refused
    expect((await op('doc.add', { trxId: mine.id, base64: pdf, mime: 'text/html' }, roula)).status).toBe(400);
    // removing only marks it: the file stays
    expect((await op('doc.delete', { id: r.body.id }, roula)).status).toBe(200);
    expect(((await op('data', {}, roula)).body as DataPayload).attachments.some((a) => a.id === r.body.id)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'dbs', DB, 'attachments', '2026', r.body.name))).toBe(true);
  });
});

describe('server: several databases', () => {
  it('a second database is fully separate: its own users, its own data, its own sessions', async () => {
    const c = await call('/api/dbs/create', { organisation: 'Jaramana 2027', centre: 'jaramana' });
    const J = c.body.slug;
    expect((await call('/api/setup/new', { db: J, organisation: 'Jaramana 2027', supName: 'Supj', supPin: 'supj-pass', comName: 'Comj', comPin: 'comj-pass' })).status).toBe(200);
    const ps = (await call(`/api/profiles?db=${J}`)).body as { id: number; name: string }[];
    expect(ps.map((p) => p.name).sort()).toEqual(['Comj', 'Supj']);
    // a user of the first database cannot log in to this one
    const fouadId = ((await call(`/api/profiles?db=${DB}`)).body as { id: number; name: string }[]).find((p) => p.name === 'Fouad')!.id;
    expect((await call('/api/login', { db: J, profileId: fouadId, password: 'sup-secret' })).status).toBe(400);
    const r = await call('/api/login', { db: J, profileId: ps.find((p) => p.name === 'Supj')!.id, password: 'supj-pass' });
    const d = (await op('data', {}, r.cookie!)).body as DataPayload;
    expect(d.rows.length).toBe(0);
    expect((await call('/api/me', undefined, r.cookie!)).body.db).toBe(J);
  });

  it('a database can have its own colour and logo (e.g. the scouts), changed later by the Superior', async () => {
    const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const c = await call('/api/dbs/create', { organisation: 'Scouts', centre: 'other', color: '#2E7D32', logo });
    const info = ((await call('/api/hello')).body.dbs as { slug: string; color: string; logo: string }[]).find((x) => x.slug === c.body.slug)!;
    expect(info).toMatchObject({ color: '#2E7D32', logo });
    // the Superior of the first database changes its look; the accountant may not
    const com = await loginAs('Comptable', 'com-secret');
    expect((await op('brand.save', { organisation: 'Test centre', centre: 'homs', color: '#123456', logo: null }, com)).status).toBe(400);
    const sup = await loginAs('Fouad', 'sup-secret');
    expect((await op('brand.save', { organisation: 'Test centre', centre: 'homs', color: '#123456', logo: null }, sup)).status).toBe(200);
    expect(((await call('/api/hello')).body.dbs as { slug: string; color: string }[]).find((x) => x.slug === DB)!.color).toBe('#123456');
    expect((await op('brand.save', { organisation: 'Test centre', centre: 'homs', color: null, logo: null }, sup)).status).toBe(200);
  });

  it('a number N is never given twice, even after deleting the last row', async () => {
    const com = await loginAs('Comptable', 'com-secret');
    const d = (await op('data', {}, com)).body as DataPayload;
    const L = d.lists;
    const row = (): Trx => ({
      ...blankTrx(), city_id: L.cities[0].id, account_id: L.accounts.find((a) => a.name === 'Center')!.id, book_id: L.books.find((b) => b.is_main)!.id,
      date: '2026-12-01', type: 'Exp', heading_id: L.headings.find((h) => h.name === 'Operations')!.id, line_id: L.lines.find((l) => l.name === 'Internet')!.id,
      explanation: 'n test', exp_syp: 111,
    });
    const a = row();
    await op('trx.save', { rows: [a] }, com);
    const nA = ((await op('data', {}, com)).body as DataPayload).rows.find((x) => x.id === a.id)!.n!;
    await op('trx.delete', { ids: [a.id] }, com);
    const b = row();
    await op('trx.save', { rows: [b] }, com);
    const nB = ((await op('data', {}, com)).body as DataPayload).rows.find((x) => x.id === b.id)!.n!;
    expect(nB).toBe(nA + 1);
  });
});

describe('server: a database from an earlier version is moved in', () => {
  it('magis.db at the top of the data folder becomes one database of the list', async () => {
    const { nodeDb } = await import('./nodeDb');
    const { createOffice } = await import('../src/setup');
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-old-'));
    await createOffice(nodeDb(path.join(dir3, 'magis.db')), { organisation: 'MAGIS Homs', supName: 'S', supPin: 'sup-pass', comName: 'C', comPin: 'com-pass' });
    fs.mkdirSync(path.join(dir3, 'backups'));
    fs.writeFileSync(path.join(dir3, 'backups', 'old-copy.db'), 'x');
    const srv3 = await startServer({ dataDir: dir3, webRoot: dir3, config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
    try {
      const hello = await (await fetch(`http://127.0.0.1:${srv3.httpPort}/api/hello`)).json();
      expect(hello.dbs).toEqual([{ slug: 'magis-homs', organisation: 'MAGIS Homs', centre: 'homs', color: null, logo: null, setupNeeded: false }]);
      expect(fs.existsSync(path.join(dir3, 'magis.db'))).toBe(false);
      expect(fs.existsSync(path.join(dir3, 'dbs', 'magis-homs', 'backups', 'old-copy.db'))).toBe(true);
    } finally {
      await srv3.close();
      fs.rmSync(dir3, { recursive: true, force: true });
    }
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
    const create = await (await fetch(`http://127.0.0.1:${srv2.httpPort}/api/dbs/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organisation: 'From desktop', centre: 'aleppo' }) })).json();
    const post = (body: Record<string, unknown>) => fetch(`http://127.0.0.1:${srv2.httpPort}/api/setup/upload-db`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ db: create.slug, ...body }) });
    try {
      expect((await post({ base64: fs.readFileSync(holderFile).toString('base64') })).status).toBe(400);
      expect((await post({ base64: fs.readFileSync(officeFile).toString('base64') })).status).toBe(200);
      const hello = await (await fetch(`http://127.0.0.1:${srv2.httpPort}/api/hello`)).json();
      // the desktop file's own name comes in; the colour chosen for the database stays
      expect(hello.dbs[0]).toMatchObject({ setupNeeded: false, organisation: 'Desk', centre: 'aleppo' });
      const ps = await (await fetch(`http://127.0.0.1:${srv2.httpPort}/api/profiles?db=${create.slug}`)).json();
      expect(ps.map((p: { name: string }) => p.name).sort()).toEqual(['C', 'S']);
    } finally {
      await srv2.close();
      fs.rmSync(dir2, { recursive: true, force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('server: the yearly budget (Superior and Accountant only)', () => {
  it('builds 2027 from what was spent in 2026, revises it, keeps the original, and hides it from holders', async () => {
    const sup = await loginAs('Fouad', 'sup-secret');
    const com = await loginAs('Comptable', 'com-secret');
    const roula = await loginAs('Roula', 'roula-secret');
    expect((await op('budget.get', { year: 2027 }, roula)).status).toBe(400);
    expect((await op('budget.create', { year: 2027, rate_syp: 13000, rate_eur: 0.92, from: 'empty' }, roula)).status).toBe(400);

    // as is, then the same scaled to 12 months: scaling never gives less
    expect((await op('budget.create', { year: 2027, rate_syp: 0, rate_eur: 0.92, from: 'last' }, com)).status).toBe(400);
    const made = await op('budget.create', { year: 2027, rate_syp: 13000, rate_eur: 0.92, from: 'last', scale: false, pct: 0 }, com);
    expect(made.status).toBe(200);
    expect(made.body).toBeGreaterThan(10);
    let b = (await op('budget.get', { year: 2027 }, com)).body;
    expect(b.current.rev).toBe(0);
    expect(b.allocs).toEqual([]); // the accountant does not see donors
    const total0 = b.amounts.reduce((s: number, x: { amount_usd: number }) => s + x.amount_usd, 0);
    expect(total0).toBeGreaterThan(1000);
    expect((await op('budget.create', { year: 2027, rate_syp: 13000, rate_eur: 0.92, from: 'empty' }, com)).status).toBe(400); // only once

    const cell = b.amounts[0];
    expect((await op('budget.saveAmounts', { versionId: b.current.id, cells: [{ ...cell, amount_usd: 5000 }] }, com)).status).toBe(200);
    // a revision: the original stays as it was, only the latest changes
    expect((await op('budget.revise', { year: 2027, note: 'mid-year' }, sup)).status).toBe(200);
    b = (await op('budget.get', { year: 2027 }, com)).body;
    expect(b.current.rev).toBe(1);
    expect((await op('budget.saveAmounts', { versionId: b.versions[0].id, cells: [{ ...cell, amount_usd: 1 }] }, com)).status).toBe(400);
    expect((await op('budget.saveAmounts', { versionId: b.current.id, cells: [{ ...cell, amount_usd: 6500 }] }, com)).status).toBe(200);
    b = (await op('budget.get', { year: 2027 }, com)).body;
    const find = (xs: { account_id: number; line_id: number; amount_usd: number }[]) => xs.find((x) => x.account_id === cell.account_id && x.line_id === cell.line_id)!.amount_usd;
    expect(find(b.original)).toBe(5000);
    expect(find(b.amounts)).toBe(6500);

    // items: quantity × times × cost; the line's amount follows
    const lineId = b.amounts[1].line_id;
    const acc = b.amounts[1].account_id;
    const items = [
      { name: 'Centre Director', unit: 'person', qty: 1, times: 13, unit_cost: 350, note: null },
      { name: 'Reception', unit: 'person', qty: 2, times: 13, unit_cost: 200, note: null },
    ];
    expect((await op('budget.saveItems', { versionId: b.current.id, account_id: acc, line_id: lineId, items: [{ ...items[0], qty: -1 }] }, com)).status).toBe(400);
    expect((await op('budget.saveItems', { versionId: b.current.id, account_id: acc, line_id: lineId, items }, com)).status).toBe(200);
    b = (await op('budget.get', { year: 2027 }, com)).body;
    expect(b.amounts.find((x: { line_id: number; account_id: number }) => x.line_id === lineId && x.account_id === acc).amount_usd).toBe(4550 + 5200);
    expect(b.items.length).toBe(2);
    // a line with items is changed through its items only
    expect((await op('budget.saveAmounts', { versionId: b.current.id, cells: [{ account_id: acc, line_id: lineId, amount_usd: 1 }] }, com)).status).toBe(400);
    expect((await op('budget.setAccount', { versionId: b.current.id, account_id: acc, contingency_pct: 10 }, com)).status).toBe(200);

    // 2026 from the 2027 budget, July–December: items for 6 months (staff 13 → 6.5)
    expect((await op('budget.create', { year: 2026, rate_syp: 130, rate_eur: 0.92, start_month: 7, months: 6, from: 'budget', fromYear: 2027 }, com)).status).toBe(200);
    const b26 = (await op('budget.get', { year: 2026 }, com)).body;
    expect(b26.current).toMatchObject({ start_month: 7, months: 6 });
    expect(b26.items.find((i: { name: string }) => i.name === 'Centre Director').times).toBe(6.5);
    expect(b26.amounts.find((x: { line_id: number; account_id: number }) => x.line_id === lineId && x.account_id === acc).amount_usd).toBe((4550 + 5200) / 2);
    expect(b26.accounts.find((x: { account_id: number }) => x.account_id === acc).contingency_pct).toBe(10);
    expect((await op('budget.create', { year: 2025, rate_syp: 130, rate_eur: 0.92, start_month: 9, months: 6, from: 'empty' }, com)).status).toBe(400); // past December

    // donors: the Superior allocates; the accountant may not
    const L = ((await op('data', {}, sup)).body as DataPayload).lists;
    const alloc = { year: 2027, donor_id: L.donors[0].id, account_id: cell.account_id, heading_id: null, line_id: null, pct: 40, amount_usd: null, status: 'promised' };
    expect((await op('alloc.save', alloc, com)).status).toBe(400);
    expect((await op('alloc.save', { ...alloc, pct: 140 }, sup)).status).toBe(400);
    expect((await op('alloc.save', { ...alloc, amount_usd: 5000 }, sup)).status).toBe(400); // a % or an amount, not both
    expect((await op('alloc.save', alloc, sup)).status).toBe(200);
    expect((await op('alloc.save', { ...alloc, pct: null, amount_usd: 10000 }, sup)).status).toBe(200);
    // SJ is always a donor, and takes "the rest" of the whole centre
    const sjId = L.donors.find((x) => x.name === 'SJ')!.id;
    expect((await op('alloc.save', { year: 2027, donor_id: sjId, account_id: null, heading_id: null, line_id: null, rest: 1, status: 'promised' }, sup)).status).toBe(200);
    expect((await op('alloc.save', { year: 2027, donor_id: sjId, account_id: null, heading_id: null, line_id: null, rest: 1, pct: 5, status: 'promised' }, sup)).status).toBe(400);
    // Harat: one amount for all its spending; its line amounts go, and lines cannot be typed while it has one
    const other = L.accounts.find((x) => x.id !== cell.account_id && x.id !== acc)!.id;
    await op('budget.saveAmounts', { versionId: b.current.id, cells: [{ account_id: other, line_id: cell.line_id, amount_usd: 300 }] }, com);
    expect((await op('budget.setAccount', { versionId: b.current.id, account_id: other, lump_usd: 5000 }, com)).status).toBe(200);
    const bh = (await op('budget.get', { year: 2027 }, com)).body;
    expect(bh.amounts.some((x: { account_id: number }) => x.account_id === other)).toBe(false);
    expect(bh.accounts.find((x: { account_id: number }) => x.account_id === other).lump_usd).toBe(5000);
    expect((await op('budget.saveAmounts', { versionId: b.current.id, cells: [{ account_id: other, line_id: cell.line_id, amount_usd: 1 }] }, com)).status).toBe(400);
    expect((await op('budget.get', { year: 2027 }, sup)).body.allocs.length).toBe(3);
    expect((await op('budget.get', { year: 2027 }, com)).body.allocs).toEqual([]);
  });
});

describe('server: signed out after 15 minutes without activity', () => {
  it('the screen\'s automatic checks do not keep the session open; what the person does does', async () => {
    const sup = await loginAs('Fouad', 'sup-secret');
    expect((await call('/api/hello')).body.idleMinutes).toBe(15);
    const bg = (url: string, body?: unknown) =>
      fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: sup, 'X-Magis-Background': '1' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.status);
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    try {
      // 10 minutes later the person does something: the session goes on
      vi.setSystemTime(t0 + 10 * 60e3);
      expect((await op('data', {}, sup)).status).toBe(200);
      // then only automatic checks, for 14 more minutes: still open (24 min since login)
      vi.setSystemTime(t0 + 24 * 60e3);
      expect(await bg('/api/version')).toBe(200);
      expect(await bg('/api/op/data', {})).toBe(200);
      // 16 minutes after the last real action: out, even for the automatic check
      vi.setSystemTime(t0 + 26 * 60e3);
      expect(await bg('/api/version')).toBe(401);
      expect((await op('data', {}, sup)).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the time can be changed by someone who manages users, between 1 and 480 minutes', async () => {
    const sup = await loginAs('Fouad', 'sup-secret');
    const com = await loginAs('Comptable', 'com-secret');
    expect((await call('/api/server/config', { idleMinutes: 30 }, com)).status).toBe(403);
    expect((await call('/api/server/config', { idleMinutes: 0 }, sup)).status).toBe(400);
    expect((await call('/api/server/config', { idleMinutes: 30 }, sup)).status).toBe(200);
    expect((await call('/api/hello')).body.idleMinutes).toBe(30);
    expect((await call('/api/server/config', { idleMinutes: 15 }, sup)).status).toBe(200);
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
    expect((await call('/api/hello')).body.dbs.find((d: { slug: string }) => d.slug === DB).organisation).toBe('Restored');
    expect((await call('/api/op/data', {}, sup)).status).toBe(401); // everybody logs in again
    const sup2 = await loginAs('S2', 'sup2-pass');
    expect(((await op('backup.list', {}, sup2)).body as { name: string }[]).length).toBeGreaterThan(before); // safety copies kept
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

// Last: it blocks this computer's address for 5 minutes.
describe('server: too many wrong passwords', () => {
  it('blocks the address for 5 minutes after 8 failures', async () => {
    const ps = (await call(`/api/profiles?db=${DB}`)).body as { id: number }[];
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await call('/api/login', { db: DB, profileId: ps[0].id, password: 'wrong' })).status;
    expect(last).toBe(429);
  });
});
