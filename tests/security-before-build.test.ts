// The security findings of the review before the build of 0.13.0 (REVIEW-BEFORE-BUILD.md): M2 M3 M4 (the Respo book through the
// month balance, the month closing and the audit trail), M5 ("sign in as"), M6 (the server's own controls), S1 (users.manage as an
// exception), S2 (the controls on large expenses). Every scenario failed before the fix; all go through the real server.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccessRow, AuditRow } from '../src/ops';
import { blankTrx } from '../src/db/repo';
import { startServer, type Running } from '../server/server';
import type { Trx } from '../src/domain/types';
import type { DataPayload } from '../src/ops';

/** an address of this computer that is not the loopback: the server then sees a request "from another computer" */
const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

describe('review before 0.13.0: the Respo book, "sign in as", the server controls', () => {
  let srv: Running;
  let dir: string;
  let local: string;
  let remote: string;
  let slug: string;
  let respoId: number;
  let mainId: number;
  let roles: AccessRow[];
  const ck: Record<string, string> = {};
  const ids: Record<string, number> = {};

  const call = async (url: string, body?: unknown, cookie?: string, base = local) => {
    const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  const op = (who: string) => (name: string, a: unknown = {}) => call(`/api/op/${name}`, a, ck[who]);
  const must = async (r: Promise<{ status: number; body: unknown }>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x; };
  const refused = (r: { status: number; body: unknown }, what: string) => { expect(r.status, `${what}: ${JSON.stringify(r.body)}`).toBeGreaterThanOrEqual(400); };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-secbuild-'));
    srv = await startServer({ dataDir: dir, webRoot: dir, config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
    local = `http://127.0.0.1:${srv.httpPort}`;
    remote = lan ? `http://${lan}:${srv.httpPort}` : local;
    slug = (await call('/api/dbs/create', { organisation: 'Secure centre', centre: 'homs' })).body.slug;
    await must(call('/api/setup/new', { db: slug, organisation: 'Secure centre', supName: 'Fouad', supPin: 'sup-secret', comName: 'Com', comPin: 'com-secret' }));
    const people = async () => (await call(`/api/profiles?db=${slug}`)).body as { id: number; name: string }[];
    const login = async (name: string, password: string, base = local) => {
      const id = (await people()).find((p) => p.name === name)!.id;
      ids[name] = id;
      const r = await call('/api/login', { db: slug, profileId: id, password }, undefined, base);
      if (r.body.mustChange) await call('/api/op/profile.setPin', { id, pin: password }, r.cookie!, base);
      return r.cookie!;
    };
    ck.Fouad = await login('Fouad', 'sup-secret');
    const F = op('Fouad');
    roles = (await F('access.list')).body as AccessRow[];
    const kind = (k: string) => roles.find((r) => r.kind === k)!.id;
    await F('list.add', { table: 'city', name: 'Homs' });
    await F('heading.add', { name: 'Income', types: ['Income'] });
    await F('heading.add', { name: 'Staff', types: ['Exp'] });
    let L = (await F('data')).body.lists;
    await F('line.add', { headingId: L.headings.find((h: { name: string }) => h.name === 'Income').id, name: 'Donation' });
    await F('line.add', { headingId: L.headings.find((h: { name: string }) => h.name === 'Staff').id, name: 'Reception' });
    L = (await F('data')).body.lists;
    respoId = L.books.find((b: { name: string }) => b.name === 'Respo').id;
    mainId = L.books.find((b: { is_main: number }) => b.is_main).id;
    await must(F('book.save', { id: respoId, name: 'Respo', keeper_name: 'Fouad', opening_usd: 777 }));
    const fid = (await F('users.list')).body.find((u: { name: string }) => u.name === 'Fouad').id;
    await must(F('user.save', { id: fid, name: 'Fouad', roles: [kind('administrator')], books: [respoId] }));
    for (const [name, k] of [['Dina', 'director'], ['Dora', 'director'], ['Assem', 'accountant']] as const) await must(F('user.save', { name, roles: [kind(k)], books: [], pin: `${name.toLowerCase()}-secret` }));
    // Hana is a book holder who keeps a private book (the Respo book, given by the Administrator)
    await must(F('user.save', { name: 'Hana', roles: [kind('holder')], books: [respoId], pin: 'hana-secret' }));
    for (const n of ['Dina', 'Dora', 'Assem', 'Hana']) ck[n] = await login(n, `${n.toLowerCase()}-secret`);
    // the Respo book holds $4,321 in May
    const line = L.lines.find((l: { name: string }) => l.name === 'Donation');
    const inc: Trx = { ...blankTrx(), id: 'inc-respo', type: 'Income', date: '2026-05-05', book_id: respoId, city_id: L.cities[0].id, heading_id: line.heading_id, line_id: line.id, inc_usd: 4321, explanation: 'Gift' };
    await must(F('trx.save', { rows: [inc] }));
  }, 120000);

  afterAll(async () => {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('M2: the balance and the closing problems of the Respo book are refused to a Director and an Accountant; the Administrator has them', async () => {
    for (const who of ['Dina', 'Assem']) {
      refused(await op(who)('bookMonth.balance', { bookId: respoId, ym: '2026-05' }), `${who} balance`);
      refused(await op(who)('closing.problems', { ym: '2026-05', bookId: respoId }), `${who} problems`);
    }
    const ok = await must(op('Fouad')('bookMonth.balance', { bookId: respoId, ym: '2026-05' }));
    expect((ok.body as { usd: number }).usd).toBe(5098);
    // the Main book stays open to them
    await must(op('Assem')('bookMonth.balance', { bookId: mainId, ym: '2026-05' }));
    // the whole-centre list of problems does not name the private book
    const all = await must(op('Assem')('closing.problems', { ym: '2026-05', bookId: null }));
    expect(JSON.stringify(all.body)).not.toContain('Respo');
  });

  it('M3: the Accountant cannot close the month of the Respo book, nor count its cash', async () => {
    refused(await op('Assem')('bookMonth.close', { bookId: respoId, ym: '2026-05', counted_syp: 0, counted_usd: 5098 }), 'close');
    refused(await op('Dina')('bookMonth.close', { bookId: respoId, ym: '2026-05', counted_syp: 0, counted_usd: 5098 }), 'close by the Director');
    refused(await op('Assem')('cash.saveCount', { bookId: respoId, counts: [{ currency: 'USD', denomination: 100, qty: 50 }] }), 'count');
    const bm = (await op('Fouad')('data')).body as DataPayload;
    expect(bm.bookMonths.some((b) => b.book_id === respoId)).toBe(false);
    expect(((await op('Fouad')('cash.history', { bookId: respoId })).body as unknown[]).length).toBe(0);
  });

  it('M4: after the Administrator closes the Respo month, no audit line of Respo reaches a Director or an Accountant', async () => {
    await must(op('Fouad')('bookMonth.close', { bookId: respoId, ym: '2026-05', counted_syp: 0, counted_usd: 5098, counts: [{ currency: 'USD', denomination: 100, qty: 50 }, { currency: 'USD', denomination: 1, qty: 98 }] }));
    await must(op('Fouad')('cash.saveCount', { bookId: respoId, counts: [{ currency: 'USD', denomination: 100, qty: 50 }] }));
    const mine = (await must(op('Fouad')('audit.list'))).body as AuditRow[];
    expect(mine.some((r) => r.tbl === 'book_month')).toBe(true); // the Administrator still sees them
    expect(mine.some((r) => r.tbl === 'cash_count')).toBe(true);
    for (const who of ['Dina', 'Assem']) {
      const rows = (await must(op(who)('audit.list'))).body as AuditRow[];
      expect(rows.filter((r) => ['book_month', 'cash_count', 'cash_count_log'].includes(r.tbl)), `${who}: month and count lines`).toEqual([]);
      expect(rows.filter((r) => r.tbl === 'book' && (r.row_id === String(respoId) || /Respo/.test(`${r.before}${r.after}`))), `${who}: lines of the book`).toEqual([]);
      const text = JSON.stringify(rows);
      expect(text).not.toContain('4321');
      expect(text).not.toContain('5098');
      expect(text).not.toContain('"opening_usd":777');
    }
    // a book that is not private stays in the trail: the Main book's month can be counted by the Accountant
    refused(await op('Dina')('cash.history', { bookId: respoId }), 'history');
  });

  it('M5: a Director never signs in as another Director, as the Administrator, nor as a person who keeps a private book, and never to act', async () => {
    const as = (who: string, name: string, mode: string) => call('/api/as', { profileId: ids[name], mode }, ck[who]);
    refused(await as('Dina', 'Dora', 'act'), 'Director as Director (act)');
    refused(await as('Dina', 'Dora', 'view'), 'Director as Director (see)');
    refused(await as('Dina', 'Fouad', 'view'), 'Director as the Administrator');
    refused(await as('Dina', 'Hana', 'view'), 'Director as a keeper of the Respo book');
    refused(await as('Dina', 'Assem', 'act'), 'Director acting as the Accountant');
    // the Director may look as the Accountant
    await must(as('Dina', 'Assem', 'view'));
    const me = (await call('/api/me', undefined, ck.Dina)).body;
    expect(me.as).toMatchObject({ mode: 'view' });
    await call('/api/as/back', {}, ck.Dina);
    // the Administrator keeps what he had: look and act, as a Director, as a keeper of a private book
    await must(call('/api/as', { profileId: ids.Dora, mode: 'act' }, ck.Fouad));
    await call('/api/as/back', {}, ck.Fouad);
    await must(call('/api/as', { profileId: ids.Hana, mode: 'view' }, ck.Fouad));
    await call('/api/as/back', {}, ck.Fouad);
  });

  it('M5: no password is changed while signed in as someone else (the Administrator acting as a person included)', async () => {
    await must(call('/api/as', { profileId: ids.Assem, mode: 'act' }, ck.Fouad));
    const r = await op('Fouad')('profile.setPin', { id: ids.Assem, pin: 'taken-over-1' });
    refused(r, 'setPin as someone');
    const own = await op('Fouad')('profile.setPin', { id: ids.Fouad, pin: 'other-1234' });
    refused(own, 'setPin of the real person');
    await call('/api/as/back', {}, ck.Fouad);
    // Assem still signs in with his own password
    expect((await call('/api/login', { db: slug, profileId: ids.Assem, password: 'assem-secret' })).status).toBe(200);
  });

  it.skipIf(!lan)('M6: a Director cannot reach the server controls (backup folder, copy password, the list of databases, creating, switching off); the Administrator can', async () => {
    const rem = (who: string) => async (url: string, body?: unknown) => call(url, body, ck[who], remote);
    // the Director and the Administrator come from another computer (the server sees a request that is not its own)
    const dinaR = await call('/api/login', { db: slug, profileId: ids.Dina, password: 'dina-secret' }, undefined, remote);
    expect(dinaR.status).toBe(200);
    ck.DinaR = dinaR.cookie!;
    const fouadR = await call('/api/login', { db: slug, profileId: ids.Fouad, password: 'sup-secret' }, undefined, remote);
    expect(fouadR.status).toBe(200);
    ck.FouadR = fouadR.cookie!;
    const D = rem('DinaR');
    const A = rem('FouadR');
    refused(await D('/api/server/config', { backupMirror: '/tmp/shared-folder' }), 'backup folder');
    refused(await D('/api/server/config', { idleMinutes: 400 }), 'idle');
    refused(await D('/api/server/copy-password', { password: 'a-long-enough-pass' }), 'copy password');
    refused(await D('/api/server/status'), 'server status');
    refused(await D('/api/dbs/manage'), 'list of databases');
    refused(await D('/api/dbs/state', { db: slug, active: false, password: 'dina-secret' }), 'switch off');
    refused(await D('/api/dbs/delete', { db: slug, name: 'Secure centre', password: 'dina-secret' }), 'delete');
    refused(await D('/api/dbs/restore', { folder: 'x_2026-01-01_000000' }), 'restore');
    refused(await D('/api/dbs/create', { organisation: 'Another', centre: 'homs' }), 'create');
    const hello = (await D('/api/hello')).body;
    expect(hello.canManage).toBe(false);
    expect(hello.canCreate).toBe(false);
    // the Administrator does all of it
    await must(A('/api/server/config', { idleMinutes: 30 }));
    expect((await A('/api/hello')).body.canManage).toBe(true);
    await must(A('/api/dbs/manage'));
    await must(A('/api/server/status'));
    // the Director's own database password does not open the switch either (it is the Administrator's password that counts)
    refused(await A('/api/dbs/state', { db: slug, active: false, password: 'dina-secret' }), 'a Director\'s password does not switch a database off');
  });

  it('S1: a Director cannot give "manages the users" (or the other two) as an exception, nor in a Custom role; the Administrator can', async () => {
    const hana = (await op('Fouad')('users.list')).body.find((u: { name: string }) => u.name === 'Hana') as { id: number; roles: number[] };
    for (const tick of ['users.manage', 'users.holders', 'users.passwords']) {
      refused(await op('Dina')('user.save', { id: hana.id, name: 'Hana', roles: hana.roles, extra: [tick], books: [respoId] }), `exception ${tick}`);
    }
    // ...but the Director still gives the ready-made roles (the Accountant has "gives book holders")
    await must(op('Dina')('user.save', { name: 'Newcomer', roles: [roles.find((r) => r.kind === 'accountant')!.id], books: [], pin: 'newcomer-secret' }));
    // the Administrator does give it
    await must(op('Fouad')('user.save', { id: hana.id, name: 'Hana', roles: hana.roles, extra: ['users.holders'], books: [respoId] }));
    await must(op('Fouad')('user.save', { id: hana.id, name: 'Hana', roles: hana.roles, extra: [], books: [respoId] }));
  });

  it('S2: the controls on large expenses are the Administrator\'s: a Director cannot switch the rule off nor approve', async () => {
    refused(await op('Dina')('settings.save', { approval_on: 1, approval_usd: 100 }), 'approval on');
    refused(await op('Dina')('settings.save', { doc_required_usd: 50 }), 'documents');
    await must(op('Fouad')('settings.save', { approval_on: 1, approval_usd: 100, approval_profile_id: null }));
    const L = ((await op('Fouad')('data')).body as DataPayload).lists;
    const line = L.lines.find((l) => l.name === 'Reception')!;
    const big: Trx = { ...blankTrx(), id: 'big-exp', type: 'Exp', date: '2026-06-02', book_id: mainId, city_id: L.cities[0].id, heading_id: line.heading_id, line_id: line.id, exp_usd: 500, explanation: 'Big' };
    await must(op('Fouad')('trx.save', { rows: [big] }));
    refused(await op('Dina')('settings.save', { approval_on: 0 }), 'approval off');
    refused(await op('Dina')('trx.approve', { ids: ['big-exp'] }), 'approve');
    await must(op('Fouad')('trx.approve', { ids: ['big-exp'] }));
  });
});
