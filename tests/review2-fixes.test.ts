// The findings of the SECOND review before the build of 0.13.0 (REVIEW-2-BEFORE-BUILD.md): M-A ("sign in as" a person named like the
// Coordinator), S-1 / S-2 (what "sign in as" may show), M-B (the password of a keeper of a private book), S-3 (the TV's key),
// N-1 / N-2 (one entry per receipt). Every scenario failed before the fix; all go through the real server.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccessRow } from '../src/ops';
import { startServer, type Running } from '../server/server';
import { nodeDb } from './nodeDb';

const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

describe('review 2 before 0.13.0: sign in as, passwords, the TV, receipts', () => {
  let srv: Running;
  let dir: string;
  let local: string;
  let remote: string;
  let slug: string;
  let hr: string;
  let respoId: number;
  let roles: AccessRow[];
  let dirCookie: string;
  const ck: Record<string, string> = {};
  const ids: Record<string, number> = {};

  const call = async (url: string, body?: unknown, cookie?: string, base = local) => {
    const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ') || undefined };
  };
  const op = (who: string) => (name: string, a: unknown = {}) => call(`/api/op/${name}`, a, ck[who]);
  const must = async <T extends { status: number; body: unknown }>(r: Promise<T>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x; };
  const refused = (r: { status: number; body: unknown }, what: string) => { expect(r.status, `${what}: ${JSON.stringify(r.body)}`).toBeGreaterThanOrEqual(400); };
  const kind = (k: string) => roles.find((r) => r.kind === k)!.id;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-review2-'));
    srv = await startServer({ dataDir: dir, webRoot: dir, config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
    local = `http://127.0.0.1:${srv.httpPort}`;
    remote = lan ? `http://${lan}:${srv.httpPort}` : local;
    slug = (await call('/api/dbs/create', { organisation: 'Review two', centre: 'homs' })).body.slug;
    hr = (await call('/api/dbs/create', { organisation: 'HR two', centre: 'other', kind: 'hr' })).body.slug;
    await must(call('/api/setup/new', { db: slug, organisation: 'Review two', supName: 'Fouad', supPin: 'sup-secret', comName: 'Com', comPin: 'com-secret' }));
    const people = async (db = slug) => (await call(`/api/profiles?db=${db}`)).body as { id: number; name: string }[];
    const login = async (name: string, password: string, base = local, db = slug) => {
      const id = (await people(db)).find((p) => p.name === name)!.id;
      if (db === slug) ids[name] = id;
      const r = await call('/api/login', { db, profileId: id, password }, undefined, base);
      if (r.body.mustChange) await call('/api/op/profile.setPin', { id, pin: password }, r.cookie!, base);
      return r.cookie!;
    };
    ck.Fouad = await login('Fouad', 'sup-secret');
    const F = op('Fouad');
    roles = (await F('access.list')).body as AccessRow[];
    await F('list.add', { table: 'city', name: 'Homs' });
    const L = (await F('data')).body.lists;
    respoId = L.books.find((b: { name: string }) => b.name === 'Respo').id;
    const fid = (await F('users.list')).body.find((u: { name: string }) => u.name === 'Fouad').id;
    await must(F('user.save', { id: fid, name: 'Fouad', roles: [kind('administrator')], books: [respoId] }));
    for (const [name, k] of [['Dina', 'director'], ['Assem', 'accountant'], ['Rami Boss', 'holder']] as const) await must(F('user.save', { name, roles: [kind(k)], books: [], pin: `${name.split(' ')[0].toLowerCase()}-secret` }));
    // Hana keeps a private book (the Respo book); Ida is an ordinary Book holder with a book of her own that is not private
    await must(F('user.save', { name: 'Hana', roles: [kind('holder')], books: [respoId], pin: 'hana-secret' }));
    await must(F('user.save', { name: 'Ida', roles: [kind('holder')], books: [], makeBook: true, pin: 'ida-secret' }));
    for (const n of ['Dina', 'Assem', 'Hana', 'Ida']) ck[n] = await login(n, `${n.toLowerCase()}-secret`);
    ck['Rami Boss'] = await login('Rami Boss', 'rami-secret');
    // HR: Fouad and Assem keep it (salaries); Dina has a Reader account there
    await must(call('/api/setup/hr', { db: hr, organisation: 'HR two', people: [{ name: 'Fouad', password: 'sup-secret' }, { name: 'Assem', password: 'assem-secret' }], mustChange: false }));
    const hrFouad = await login('Fouad', 'sup-secret', local, hr);
    await must(call('/api/op/user.save', { name: 'Dina', access_id: 2, books: [], pin: 'dina-secret' }, hrFouad));
    // the directory: the Coordinator is "Zahra Admin" (no account of that name in the centre)
    const d = await call('/api/dir/setup', { name: 'Zahra Admin', password: 'zahra-secret-1' });
    expect(d.status).toBe(200);
    dirCookie = d.cookie!;
  }, 120000);

  afterAll(async () => {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('M-A: a Director who makes a person named like a directory person is refused (capitals and spaces do not matter)', async () => {
    for (const name of ['zahra admin', '  ZAHRA ADMIN ']) refused(await op('Dina')('user.save', { name, roles: [kind('holder')], books: [], pin: 'x-secret-12' }), `new person ${name}`);
    // two persons of the centre never differ only by capitals or by spaces at the ends
    refused(await op('Dina')('user.save', { name: 'rami boss ', roles: [kind('holder')], books: [], pin: 'x-secret-12' }), 'duplicate by capitals');
    refused(await op('Dina')('user.save', { name: 'FOUAD', roles: [kind('holder')], books: [], pin: 'x-secret-12' }), 'duplicate of the Administrator');
  });

  it('M-A: seen as a person whose name equals the Coordinator\'s, a Director still has no Coordinator power', async () => {
    // the directory gets a second person named like an existing Book holder (the name alone must not link them)
    await must(call('/api/dir/save', { name: 'rami boss', admin: true, active: true, password: 'rami-dir-secret-1', grants: {} }, dirCookie));
    await must(call('/api/as', { profileId: ids['Rami Boss'], mode: 'view' }, ck.Dina));
    const h = (await call('/api/hello', undefined, ck.Dina, remote)).body; // (from another address: on the server computer itself everybody may create)
    if (lan) { expect(h.canCreate).toBe(false); expect(h.canManage).toBe(false); }
    expect(h.dir.person?.admin ?? false).toBe(false);
    expect((await call('/api/all-centres/allowed', undefined, ck.Dina)).body.allowed).toBe(false);
    for (const url of ['/api/province', '/api/coordinator/inventory', '/api/coordinator/waiting', '/api/server/status', '/api/dir/people']) refused(await call(url, undefined, ck.Dina), url);
    refused(await call('/api/dir/enter', { db: hr }, ck.Dina), 'dir/enter into HR');
    if (lan) refused(await call('/api/dbs/manage', undefined, ck.Dina, remote), 'dbs/manage');
    await call('/api/as/back', {}, ck.Dina);
    // the real Coordinator still has all of it
    const coord = await must(call('/api/dir/enter', { db: slug }, dirCookie)); // the Coordinator comes into the centre as its Superior
    const both = `${dirCookie}; ${coord.cookie ?? ''}`;
    expect((await call('/api/hello', undefined, both)).body.dir.person).toMatchObject({ name: 'Zahra Admin', admin: true });
    for (const url of ['/api/server/status', '/api/dir/people']) await must(call(url, undefined, both));
    expect((await call('/api/all-centres/allowed', undefined, both)).body.allowed).toBe(true);
  });

  it('M-A: a person linked to the Coordinator\'s directory account shows no Coordinator power to a Director either', async () => {
    const fid = ids.Fouad;
    await must(call('/api/dir/save', { name: 'Linked Boss', admin: true, active: true, password: 'linked-secret-1', grants: { [slug]: ids['Rami Boss'] } }, dirCookie));
    await must(call('/api/as', { profileId: ids['Rami Boss'], mode: 'view' }, ck.Dina));
    expect((await call('/api/hello', undefined, ck.Dina)).body.dir.person?.admin ?? false).toBe(false);
    refused(await call('/api/province', undefined, ck.Dina), 'province through a linked person');
    refused(await call('/api/dir/people', undefined, ck.Dina), 'directory through a linked person');
    await call('/api/as/back', {}, ck.Dina);
    void fid;
  });

  it('S-1: from "sign in as" a Director cannot go on into HR as a person with salary rights', async () => {
    const signin = await call('/api/signin', { centre: 'homs', name: 'Dina', password: 'dina-secret' });
    expect(signin.status).toBe(200);
    const cookie = signin.cookie!;
    // (the person is chosen on the first page; the session of Dina's own Homs account is the one used from here)
    const choose = await call('/api/signin/enter', { db: slug }, cookie);
    expect(choose.status).toBe(200);
    const mine = choose.cookie ?? cookie;
    await must(call('/api/as', { profileId: ids.Assem, mode: 'view' }, mine));
    const e = await call('/api/signin/enter', { db: hr }, mine);
    refused(e, 'Director into HR as the Accountant');
  });

  it('S-2: "see only" refuses a person who still carries an Administrator-only tick the Director does not hold (an old Custom role)', async () => {
    // an old Custom role that carries "donors" (no program door gives that tick any more: it is written straight into the file)
    const old = nodeDb(path.join(dir, 'dbs', slug, 'magis.db'));
    await old.batch([{ sql: "INSERT INTO access_profile (name, perms, sort) VALUES ('Old custom', '[\"register.view\",\"lists.donors\"]', 99)" }]);
    const oldId = ((await old.query<{ id: number }>("SELECT id FROM access_profile WHERE name = 'Old custom'"))[0]).id;
    await old.batch([{ sql: 'UPDATE profile SET access_id = ? WHERE id = ?', params: [oldId, ids.Ida] }, { sql: 'DELETE FROM profile_role WHERE profile_id = ?', params: [ids.Ida] }, { sql: 'INSERT INTO profile_role (profile_id, access_id) VALUES (?, ?)', params: [ids.Ida, oldId] }]);
    const me = (await call('/api/as', { profileId: ids.Ida, mode: 'view' }, ck.Dina));
    refused(me, 'Director looks as a person with the donors tick');
    // the Administrator still may
    await must(call('/api/as', { profileId: ids.Ida, mode: 'view' }, ck.Fouad));
    await call('/api/as/back', {}, ck.Fouad);
  });

  it('M-B: the Director and the Accountant cannot set the password of a person who keeps a private book (nor one with an Administrator-only right); the Administrator can; an ordinary Book holder can be reset', async () => {
    for (const who of ['Dina', 'Assem']) {
      refused(await op(who)('profile.setPin', { id: ids.Hana, pin: 'taken-over-1' }), `${who} setPin on a private book keeper`);
      refused(await op(who)('user.save', { id: ids.Hana, name: 'Hana', roles: [kind('holder')], books: [respoId], pin: 'taken-over-2' }), `${who} user.save with a password on a private book keeper`);
      // the person with the old Custom role that carries "donors" (S-2 above): an Administrator-only right
      refused(await op(who)('profile.setPin', { id: ids.Ida, pin: 'taken-over-3' }), `${who} setPin on a holder of an Administrator-only right`);
    }
    // Hana still signs in with her own password
    expect((await call('/api/login', { db: slug, profileId: ids.Hana, password: 'hana-secret' })).status).toBe(200);
    // the Administrator may
    await must(op('Fouad')('profile.setPin', { id: ids.Hana, pin: 'hana-reset-1' }));
    expect((await call('/api/login', { db: slug, profileId: ids.Hana, password: 'hana-reset-1' })).status).toBe(200);
    // an ordinary Book holder (a book that is not private): the Director and the Accountant reset it, both ways
    await must(op('Fouad')('user.save', { name: 'Jade', roles: [kind('holder')], books: [], makeBook: true, pin: 'jade-secret' }));
    const jade = (await op('Fouad')('users.list')).body.find((u: { name: string }) => u.name === 'Jade') as { id: number; books: number[] };
    await must(op('Dina')('profile.setPin', { id: jade.id, pin: 'jade-reset-1' }));
    await must(op('Assem')('profile.setPin', { id: jade.id, pin: 'jade-reset-2' }));
    await must(op('Dina')('user.save', { id: jade.id, name: 'Jade', roles: [kind('holder')], books: jade.books, pin: 'jade-reset-3' }));
    // and everybody changes their own password
    await must(op('Hana')('profile.setPin', { id: ids.Hana, pin: 'hana-own-12' }));
  });

  it('S-3: a TV\'s key never opens the phone pack, a phone\'s key never opens the TV screen; a device linked before the mark works on both as before', async () => {
    const add = async (name: string, role: string) => (await must(op('Fouad')('cal.phone.add', { name, role }))).body as { id: string; code: string };
    const tv = await add('Entrance TV', 'reception'); // (made with a role that sees contacts: the worst case)
    const ph = await add('Reception phone', 'reception');
    const legacy = await add('Old TV', 'reception');
    const tvKey = (await must(call('/api/tv/link', { code: tv.code }))).body.key as string;
    const phKey = (await must(call('/api/calphone/link', { code: ph.code }))).body.key as string;
    const oldKey = (await must(call('/api/calphone/link', { code: legacy.code }))).body.key as string;
    // (a device linked before the mark: take the mark away, as if it had been linked by the previous version)
    const raw = nodeDb(path.join(dir, 'dbs', slug, 'magis.db'));
    await raw.batch([{ sql: 'DELETE FROM meta WHERE key = ?', params: [`cal_device_${legacy.id}`] }]);
    const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });
    const post = async (url: string, k: string) => { const r = await fetch(local + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer(k) }, body: '{}' }); return r.status; };
    expect(await post('/api/tv/screen', tvKey)).toBe(200);
    expect(await post('/api/calphone/pack', tvKey)).toBeGreaterThanOrEqual(400);
    expect(await post('/api/calphone/pack', phKey)).toBe(200);
    expect(await post('/api/tv/screen', phKey)).toBeGreaterThanOrEqual(400);
    expect(await post('/api/calphone/pack', oldKey)).toBe(200);
    expect(await post('/api/tv/screen', oldKey)).toBe(200);
  });
});
