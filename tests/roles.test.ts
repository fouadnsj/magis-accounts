// Roles as data (roles step 1, 25 November 2026; ROLES-AND-SIGNIN-ANALYSIS.md §9.1): the ready-made roles stored in each
// centre database, several roles per person (rights = all their ticks together, plus "Advanced" exceptions), the limits
// checked by the server, and nobody locked out by update 77.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOp, type AccessRow, type OpCtx, type UserRow } from '../src/ops';
import { loadProfile, profileStmt } from '../src/auth';
import { createOffice } from '../src/setup';
import { MIGRATIONS } from '../src/db/migrations';
import { migrate, splitSql, type Db } from '../src/db/db';
import { doorsOf } from '../src/doors';
import { ROLE_KINDS, sensitiveOf, unionPerms, whyNotGive } from '../src/roles';
import { startServer, type Running } from '../server/server';
import { nodeDb } from './nodeDb';

const files = {} as OpCtx['files'];

async function atUpdate(n: number, kind?: string): Promise<Db> {
  const db = nodeDb();
  await db.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
  for (const mg of MIGRATIONS.filter((x) => x.n <= n)) await db.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
  if (kind) await db.batch([{ sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('kind', ?)", params: [kind] }]);
  return db;
}
const rightsOf = async (db: Db, id: number) => [...(await loadProfile(db, id))!.perms].sort();
const idOf = async (db: Db, name: string) => (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0].id;

describe('update 77: nobody is locked out', () => {
  it('every built-in role and a custom one keep exactly the same rights; the ready-made roles are added', async () => {
    const db = await atUpdate(76);
    // a custom role made by hand before (with donors and prices: kept as it was, a "Custom" role)
    await db.batch([{ sql: "INSERT INTO access_profile (name, perms, sort) VALUES ('Secretary', '[\"cal.view\",\"cal.prices\",\"lists.donors\",\"reports.summary\"]', 9)" }]);
    const custom = (await db.query<{ id: number }>("SELECT id FROM access_profile WHERE name = 'Secretary'"))[0].id;
    await db.batch([
      await profileStmt({ name: 'Sup', role: 'sup', pin: 'sup-pass-1', access_id: 1 }),
      await profileStmt({ name: 'Com', role: 'com', pin: 'com-pass-1', access_id: 2 }),
      await profileStmt({ name: 'Holder', role: 'holder', pin: 'hol-pass-1', access_id: 3 }),
      await profileStmt({ name: 'Sec', role: 'holder', pin: 'sec-pass-1', access_id: custom }),
    ]);
    const names = ['Sup', 'Com', 'Holder', 'Sec'];
    const before = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await rightsOf(db, await idOf(db, n))])));
    const rolesBefore = await db.query('SELECT id, perms FROM access_profile ORDER BY id');

    expect(await migrate(db)).toEqual([77]);
    for (const n of names) expect(await rightsOf(db, await idOf(db, n))).toEqual(before[n]);
    // no tick of an old role changed
    expect(await db.query('SELECT id, perms FROM access_profile WHERE id <= ? ORDER BY id', [custom])).toEqual(rolesBefore);
    // the Superior is the Administrator role; Accountant and Book holder are the ready-made ones; the secretary's role is Custom
    const kinds = await db.query<{ id: number; name: string; kind: string | null }>('SELECT id, name, kind FROM access_profile ORDER BY id');
    expect(kinds.filter((k) => k.id <= custom)).toEqual([
      { id: 1, name: 'المشرف · Administrator', kind: 'administrator' },
      { id: 2, name: 'المحاسب · Accountant', kind: 'accountant' },
      { id: 3, name: 'أمين صندوق · Book holder', kind: 'holder' },
      { id: custom, name: 'Secretary', kind: null },
    ]);
    expect(kinds.filter((k) => k.id > custom).map((k) => k.kind)).toEqual(['director', 'reception', 'coordinator', 'keeper']);
    const sup = await loadProfile(db, await idOf(db, 'Sup'));
    expect(sup!.admin).toBe(true);
    expect(sup!.roles!.map((r) => r.kind)).toEqual(['administrator']);
    // the Director has no donors, no Respo
    const dir = (await db.query<{ perms: string }>("SELECT perms FROM access_profile WHERE kind = 'director'"))[0];
    expect(JSON.parse(dir.perms)).not.toContain('lists.donors');
    expect(JSON.parse(dir.perms)).not.toContain('register.private');
    expect(JSON.parse(dir.perms)).toContain('users.manage');
    expect(await migrate(db)).toEqual([]);
  });

  it('an Accountant role changed by hand stays Custom (a ready-made Accountant is added); HR, a community and the country get nothing', async () => {
    const db = await atUpdate(76);
    await db.batch([{ sql: "UPDATE access_profile SET perms = '[\"book.own\",\"register.view\",\"users.manage\"]' WHERE id = 2" }]);
    await migrate(db);
    const ks = await db.query<{ id: number; kind: string | null; name: string }>('SELECT id, kind, name FROM access_profile ORDER BY id');
    expect(ks.find((k) => k.id === 2)!.kind).toBe(null);
    expect(ks.filter((k) => k.kind === 'accountant')).toEqual([{ id: expect.any(Number), kind: 'accountant', name: 'المحاسب · Accountant (2)' }]);
    for (const kind of ['hr', 'community', 'country']) {
      const other = await atUpdate(76, kind);
      const rows = JSON.stringify(await other.query('SELECT id, name, perms FROM access_profile ORDER BY id'));
      expect(await migrate(other)).toEqual([77]);
      expect(JSON.stringify(await other.query('SELECT id, name, perms FROM access_profile ORDER BY id'))).toBe(rows);
      expect((await other.query<{ n: number }>('SELECT COUNT(*) AS n FROM access_profile WHERE kind IS NOT NULL'))[0].n).toBe(0);
    }
  });
});

describe('several roles per person, and the limits', () => {
  let db: Db;
  let sup: OpCtx;
  let roles: AccessRow[];
  const ctxOf = async (name: string): Promise<OpCtx> => ({ db, profile: (await loadProfile(db, await idOf(db, name)))!, who: name, install: 'office', files });
  const role = (kind: string) => roles.find((r) => r.kind === kind)!;
  const users = async () => (await runOp(sup, 'users.list', {})) as UserRow[];

  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    sup = await ctxOf('Sup');
    roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
    await runOp(sup, 'user.save', { name: 'Dina', roles: [role('director').id], books: [], pin: 'dina-pass-1' });
  });

  it('rights = all the ticks of all the roles; doors from the union; "Exceptions" on the person', async () => {
    await runOp(sup, 'user.save', { name: 'Rita', roles: [role('reception').id, role('keeper').id], books: [], pin: 'rita-pass-1' });
    const rita = await ctxOf('Rita');
    expect(rita.profile.perms).toContain('cal.outside');
    expect(rita.profile.perms).toContain('inventory.manage');
    // Reception + Store keeper: still no prices
    expect(rita.profile.perms).not.toContain('cal.prices');
    expect(doorsOf({ can: (p) => rita.profile.perms.includes(p), hasBook: false, inventoryOn: true, hr: false })).toEqual(['calendar', 'inventory']);
    // her first role is access_id; the second is in profile_role
    const row = (await users()).find((u) => u.name === 'Rita')!;
    expect(row.access_id).toBe(role('reception').id);
    expect(row.roles).toEqual([role('reception').id, role('keeper').id]);
    // Reception + Coordinator sees prices, because of the Coordinator
    await runOp(sup, 'user.save', { name: 'Sami', roles: [role('reception').id, role('coordinator').id], books: [], pin: 'sami-pass-1' });
    const sami = await ctxOf('Sami');
    expect(sami.profile.perms).toContain('cal.prices');
    const why = sensitiveOf(roles.filter((r) => [role('reception').id, role('coordinator').id].includes(r.id)), []);
    expect(why.map((w) => [w.key, w.roles.map((r) => r.kind)])).toEqual([['prices', ['coordinator']]]);
    // an exception: one tick on Rita only, with what it brings
    await runOp(sup, 'user.save', { id: rita.profile.id, name: 'Rita', roles: row.roles, extra: ['audit.view', 'cal.programme'], books: [] });
    const r2 = await ctxOf('Rita');
    expect(r2.profile.perms).toEqual(expect.arrayContaining(['audit.view', 'cal.programme', 'cal.outside', 'inventory.manage']));
    expect((await users()).find((u) => u.name === 'Rita')!.extra).toEqual(['audit.view', 'cal.programme']);
    expect(unionPerms([{ perms: ['cal.view'] }], ['cal.orgs'])).toEqual(expect.arrayContaining(['cal.view', 'cal.orgs', 'cal.contacts']));
    // the exceptions stay when the roles change without them
    await runOp(sup, 'user.save', { id: rita.profile.id, name: 'Rita', roles: [role('reception').id], books: [] });
    expect((await ctxOf('Rita')).profile.perms).not.toContain('inventory.manage');
    expect((await ctxOf('Rita')).profile.perms).toContain('audit.view');
  });

  it('only the Administrator gives Administrator or Director; a Director gives the other ready-made roles', async () => {
    const dina = await ctxOf('Dina');
    expect(dina.profile.admin).toBe(false);
    await expect(runOp(dina, 'user.save', { name: 'Rafi', roles: [role('director').id], books: [], pin: 'rafi-pass-1' })).rejects.toThrow(/Administrator only/);
    await expect(runOp(dina, 'user.save', { name: 'Rafi', roles: [role('administrator').id], books: [], pin: 'rafi-pass-1' })).rejects.toThrow(/Administrator only/);
    await runOp(dina, 'user.save', { name: 'Rafi', roles: [role('accountant').id, role('reception').id], books: [], pin: 'rafi-pass-1' });
    const rafi = await idOf(db, 'Rafi');
    // he cannot take the Director's role away from another Director, nor switch him off
    await runOp(sup, 'user.save', { name: 'Dani', roles: [role('director').id], books: [], pin: 'dani-pass-1' });
    const dani = await idOf(db, 'Dani');
    await expect(runOp(dina, 'user.save', { id: dani, name: 'Dani', roles: [role('reception').id], books: [] })).rejects.toThrow(/Administrator only/);
    await expect(runOp(dina, 'user.deactivate', { id: dani })).rejects.toThrow(/Administrator only/);
    // nor give himself a role
    await expect(runOp(dina, 'user.save', { id: dina.profile.id, name: 'Dina', roles: [role('director').id, role('keeper').id], books: [] })).rejects.toThrow();
    // never the Administrator: not his roles, not his password, not switched off, not "sign in as" (server test below)
    await expect(runOp(dina, 'user.save', { id: sup.profile.id, name: 'Sup', roles: [role('administrator').id], books: [1] })).rejects.toThrow(/Administrator only/);
    await expect(runOp(dina, 'profile.setPin', { id: sup.profile.id, pin: 'taken-over-1' })).rejects.toThrow(/Administrator only/);
    await expect(runOp(dina, 'user.deactivate', { id: sup.profile.id })).rejects.toThrow(/Administrator only/);
    // a Director resets the password of someone of the centre
    await runOp(dina, 'profile.setPin', { id: rafi, pin: 'rafi-pass-2' });
  });

  it('a Director cannot give more than he has (exceptions, Custom roles, ticks of a role)', async () => {
    const dina = await ctxOf('Dina');
    const rafi = await idOf(db, 'Rafi');
    const rafiRoles = (await users()).find((u) => u.name === 'Rafi')!.roles;
    // an exception he does not have himself (keeping a book), refused; one he has, given
    await expect(runOp(dina, 'user.save', { id: rafi, name: 'Rafi', roles: rafiRoles, extra: ['data.restore'], books: [] })).rejects.toThrow(/more than you have/);
    await runOp(dina, 'user.save', { id: rafi, name: 'Rafi', roles: rafiRoles, extra: ['cal.prices'], books: [] });
    // a Custom role: within his ticks only
    await expect(runOp(dina, 'access.save', { name: 'Restorer', perms: ['data.restore'] })).rejects.toThrow(/more than you have/);
    await runOp(dina, 'access.save', { name: 'Hall helper', perms: ['cal.view', 'cal.whole'] });
    await runOp(sup, 'access.save', { name: 'Petty cash', perms: ['book.own', 'month.reopen'] });
    roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
    expect(roles.find((r) => r.name === 'Hall helper')!.kind).toBe(null);
    await runOp(dina, 'user.save', { name: 'Hiba', roles: [roles.find((r) => r.name === 'Hall helper')!.id], books: [], pin: 'hiba-pass-1' });
    await expect(runOp(dina, 'user.save', { name: 'Pete', roles: [roles.find((r) => r.name === 'Petty cash')!.id], books: [], pin: 'pete-pass-1' })).rejects.toThrow(/more than you have/);
    // the ticks of a role: only what he has; never the Administrator's nor the Director's role
    await runOp(dina, 'access.save', { id: role('reception').id, name: role('reception').name, perms: [...role('reception').perms, 'cal.whole'] });
    await expect(runOp(dina, 'access.save', { id: role('reception').id, name: role('reception').name, perms: [...role('reception').perms, 'register.main'] })).rejects.toThrow(/more than you have/);
    await expect(runOp(dina, 'access.save', { id: role('director').id, name: role('director').name, perms: role('director').perms.filter((p) => p !== 'cal.whole') })).rejects.toThrow(/Administrator only/);
    // the ready-made roles stay
    await expect(runOp(sup, 'access.delete', { id: role('keeper').id })).rejects.toThrow(/ready-made roles stay/);
  });

  it('Respo and Grants only in the Administrator role: refused anywhere else, even as an exception, even by the Administrator', async () => {
    const dina = await ctxOf('Dina');
    const rafi = await idOf(db, 'Rafi');
    const rafiRoles = (await users()).find((u) => u.name === 'Rafi')!.roles;
    for (const tick of ['lists.donors', 'register.private']) {
      await expect(runOp(sup, 'user.save', { id: rafi, name: 'Rafi', roles: rafiRoles, extra: [tick], books: [] })).rejects.toThrow(/only in the role Administrator/);
      await expect(runOp(dina, 'user.save', { id: rafi, name: 'Rafi', roles: rafiRoles, extra: [tick], books: [] })).rejects.toThrow(/only in the role Administrator/);
      await expect(runOp(sup, 'access.save', { id: role('reception').id, name: role('reception').name, perms: [...role('reception').perms, tick] })).rejects.toThrow(/only in the role Administrator/);
      await expect(runOp(sup, 'access.save', { name: `With ${tick}`, perms: ['cal.view', tick] })).rejects.toThrow(/only in the role Administrator/);
    }
    // a Custom role from before that still has donors: its people keep it (nobody locked out), but nobody new gets it
    await db.batch([{ sql: "INSERT INTO access_profile (name, perms, sort) VALUES ('Old donors', '[\"lists.donors\",\"cal.view\"]', 50)" }]);
    const old = (await db.query<{ id: number }>("SELECT id FROM access_profile WHERE name = 'Old donors'"))[0].id;
    await db.batch([await profileStmt({ name: 'Olga', role: 'holder', pin: 'olga-pass-1', access_id: old })]);
    expect((await ctxOf('Olga')).profile.perms).toContain('lists.donors');
    await expect(runOp(sup, 'user.save', { name: 'Omar', roles: [old], books: [], pin: 'omar-pass-1' })).rejects.toThrow(/only in the role Administrator/);
  });

  it('the last Administrator stays (nothing changed when refused)', async () => {
    // (roles step 3) nobody gives himself a role, not even the Administrator
    await expect(runOp(sup, 'user.save', { id: sup.profile.id, name: 'Sup', roles: [role('director').id], books: [] })).rejects.toThrow(/Nobody gives himself a role/);
    const again = await ctxOf('Sup');
    expect(again.profile.admin).toBe(true);
    expect(again.profile.roles!.map((r) => r.kind)).toEqual(['administrator']);
    // with a second Administrator (Fouad's second person), the other one gives him a role
    await runOp(sup, 'user.save', { name: 'Alvaro', roles: [role('administrator').id], books: [], pin: 'alvaro-pass-1' });
    const alvaro = await ctxOf('Alvaro');
    await runOp(alvaro, 'user.save', { id: sup.profile.id, name: 'Sup', roles: [role('administrator').id, role('accountant').id], books: [] });
    expect((await ctxOf('Sup')).profile.perms).toContain('register.main');
    // Alvaro switched off: Sup, the last Administrator, cannot drop his own Administrator role
    await runOp(sup, 'user.deactivate', { id: alvaro.profile.id });
    await expect(runOp(sup, 'user.save', { id: sup.profile.id, name: 'Sup', roles: [role('accountant').id], books: [] })).rejects.toThrow(/role Administrator/);
    expect((await ctxOf('Sup')).profile.admin).toBe(true);
  });
});

describe('who gives what (roles step 3)', () => {
  let db: Db;
  let sup: OpCtx;
  let roles: AccessRow[];
  const ctxOf = async (name: string): Promise<OpCtx> => ({ db, profile: (await loadProfile(db, await idOf(db, name)))!, who: name, install: 'office', files });
  const role = (kind: string) => roles.find((r) => r.kind === kind)!;
  let n = 0;
  const pin = () => `pass-word-${++n}`;

  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Gives centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    sup = await ctxOf('Sup');
    roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
    // the Accountant "adds book holders" when the Administrator ticks it on that role (as today)
    if (!role('accountant').perms.includes('users.holders')) await runOp(sup, 'access.save', { id: role('accountant').id, name: role('accountant').name, perms: [...role('accountant').perms, 'users.holders'] });
    roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
    await runOp(sup, 'user.save', { name: 'Dina', roles: [role('director').id], books: [], pin: pin() });
    await runOp(sup, 'user.save', { name: 'Dani', roles: [role('director').id], books: [], pin: pin() });
  });

  it('the screen and the server agree on who may give which ready-made role', async () => {
    for (const who of ['Sup', 'Dina', 'Com']) {
      const c = await ctxOf(who);
      const g = { admin: !!c.profile.admin, can: (p: string) => c.profile.perms.includes(p as never) };
      for (const k of ROLE_KINDS) {
        const r = role(k.kind);
        const why = whyNotGive(g, r);
        const name = `${who} gives ${k.kind}`;
        const res = runOp(c, 'user.save', { name, roles: [r.id], books: [], pin: pin() });
        if (why) await expect(res, name).rejects.toThrow();
        else await expect(res, name).resolves.toBeUndefined();
      }
    }
    // in words: the Administrator gives all; the Director all but Administrator and Director; the Accountant a Book holder only
    const g = async (who: string) => { const c = await ctxOf(who); return ROLE_KINDS.filter((k) => !whyNotGive({ admin: !!c.profile.admin, can: (p) => c.profile.perms.includes(p) }, role(k.kind))).map((k) => k.kind); };
    expect(await g('Sup')).toEqual(ROLE_KINDS.map((k) => k.kind));
    expect(await g('Dina')).toEqual(['accountant', 'holder', 'reception', 'coordinator', 'keeper']);
    expect(await g('Com')).toEqual(['holder']);
  });

  it('a Director adds and removes the people of his centre, never another Director, never a role to himself', async () => {
    const dina = await ctxOf('Dina');
    const dani = await idOf(db, 'Dani');
    await runOp(dina, 'user.save', { name: 'Rima', roles: [role('reception').id, role('keeper').id], books: [], pin: pin() });
    const rima = await idOf(db, 'Rima');
    await runOp(dina, 'user.save', { id: rima, name: 'Rima N.', roles: [role('reception').id], books: [] });
    await runOp(dina, 'profile.setPin', { id: rima, pin: pin() });
    await runOp(dina, 'user.deactivate', { id: rima });
    // another Director is the Administrator's: not his name, not his password, not his books, not switched off
    await expect(runOp(dina, 'user.save', { id: dani, name: 'Dani 2', roles: [role('director').id], books: [] })).rejects.toThrow(/Administrator only/);
    await expect(runOp(dina, 'profile.setPin', { id: dani, pin: pin() })).rejects.toThrow(/Administrator only/);
    await expect(runOp(dina, 'user.deactivate', { id: dani })).rejects.toThrow(/Administrator only/);
    // his own line: his name and his password yes; a role no; dropping his own Director role no
    await runOp(dina, 'user.save', { id: dina.profile.id, name: 'Dina', roles: [role('director').id], books: [] });
    await runOp(dina, 'profile.setPin', { id: dina.profile.id, pin: 'dina-own-pass' });
    await expect(runOp(dina, 'user.save', { id: dina.profile.id, name: 'Dina', roles: [role('director').id, role('accountant').id], books: [] })).rejects.toThrow(/Nobody gives himself a role/);
    await expect(runOp(dina, 'user.save', { id: dina.profile.id, name: 'Dina', roles: [role('reception').id], books: [] })).rejects.toThrow();
    // the Administrator does all of it
    await runOp(sup, 'user.save', { id: dani, name: 'Dani', roles: [role('director').id, role('coordinator').id], books: [] });
    await runOp(sup, 'profile.setPin', { id: dani, pin: pin() });
  });

  it('the Accountant adds book holders only: their book, their password, switched off; never the Main book nor another role', async () => {
    const com = await ctxOf('Com');
    const books = (await db.query<{ id: number; is_main: number }>('SELECT id, is_main FROM book WHERE active = 1'));
    const main = books.find((b) => b.is_main)!.id;
    await db.batch([{ sql: "INSERT INTO book (name, keeper_name, city_id, account_id, is_main, sort) SELECT 'Petty', 'Hadi', city_id, account_id, 0, 99 FROM book WHERE id = ?", params: [main] }]);
    const petty = (await db.query<{ id: number }>("SELECT id FROM book WHERE name = 'Petty'"))[0].id;
    await runOp(com, 'user.save', { name: 'Hadi', roles: [role('holder').id], books: [petty], pin: pin() });
    const hadi = await idOf(db, 'Hadi');
    await runOp(com, 'profile.setPin', { id: hadi, pin: pin() });
    await expect(runOp(com, 'user.save', { id: hadi, name: 'Hadi', roles: [role('holder').id], books: [petty, main] })).rejects.toThrow(/Main book is not for a book holder/);
    await expect(runOp(com, 'user.save', { name: 'Nour', roles: [role('reception').id], books: [], pin: pin() })).rejects.toThrow(/book holder's role only/);
    await expect(runOp(com, 'user.save', { name: 'Nour', roles: [role('holder').id, role('reception').id], books: [], pin: pin() })).rejects.toThrow(/book holder's role only/);
    await expect(runOp(com, 'user.save', { id: hadi, name: 'Hadi', roles: [role('holder').id], extra: ['cal.view'], books: [petty] })).rejects.toThrow(/book holder's role only/);
    // a person who is not a book holder: not his, even for the password
    const dani = await idOf(db, 'Dani');
    await expect(runOp(com, 'user.save', { id: dani, name: 'Dani', roles: [role('holder').id], books: [] })).rejects.toThrow();
    await expect(runOp(com, 'profile.setPin', { id: dani, pin: pin() })).rejects.toThrow();
    await expect(runOp(com, 'user.deactivate', { id: dani })).rejects.toThrow();
    // a private book (the Respo book) is given by the Administrator only, not by the Accountant nor the Director
    if (!(await db.query('SELECT 1 FROM book WHERE private = 1')).length) await db.batch([{ sql: "INSERT INTO book (name, keeper_name, city_id, account_id, is_main, private, sort) SELECT 'Private test', 'Sup', city_id, account_id, 0, 1, 98 FROM book WHERE id = ?", params: [main] }]);
    const respo = (await db.query<{ id: number }>('SELECT id FROM book WHERE private = 1'))[0].id;
    await expect(runOp(com, 'user.save', { id: hadi, name: 'Hadi', roles: [role('holder').id], books: [petty, respo] })).rejects.toThrow(/only in the role Administrator/);
    await expect(runOp(await ctxOf('Dina'), 'user.save', { id: hadi, name: 'Hadi', roles: [role('holder').id], books: [petty, respo] })).rejects.toThrow(/only in the role Administrator/);
    // what he sees of the roles: the book holder's only
    expect(((await runOp(com, 'access.list', {})) as AccessRow[]).map((r) => r.kind)).toEqual(['holder']);
    await runOp(com, 'user.deactivate', { id: hadi });
  });

  it('"Make a copy to adapt": a Director copies a ready-made role he gives, then only adds what he has', async () => {
    const dina = await ctxOf('Dina');
    const acc = role('accountant');
    // the Accountant's ticks are not all his (he does not write), but he gives that role, so he may copy it
    expect(acc.perms.some((p) => !dina.profile.perms.includes(p))).toBe(true);
    await runOp(dina, 'access.save', { name: 'Accountant (Homs copy)', perms: acc.perms.filter((p) => p !== 'data.import'), from: acc.id });
    await expect(runOp(dina, 'access.save', { name: 'Accountant (too much)', perms: [...acc.perms, 'data.restore'], from: acc.id })).rejects.toThrow(/more than you have/);
    await expect(runOp(dina, 'access.save', { name: 'Accountant (no from)', perms: acc.perms })).rejects.toThrow(/more than you have/);
    await expect(runOp(dina, 'access.save', { name: 'Director (copy)', perms: role('director').perms, from: role('director').id })).rejects.toThrow(/Administrator only/);
    // the copy is Custom, and the Director may give it (it is within a ready-made role he gives)
    roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
    const copy = roles.find((r) => r.name === 'Accountant (Homs copy)')!;
    expect(copy.kind).toBe(null);
    // the Administrator copies anything but never carries the Respo book or grants into a copy
    await expect(runOp(sup, 'access.save', { name: 'Admin (copy)', perms: role('administrator').perms, from: role('administrator').id })).rejects.toThrow(/only in the role Administrator/);
    await runOp(sup, 'access.save', { name: 'Admin (copy)', perms: role('administrator').perms.filter((p) => p !== 'lists.donors' && p !== 'register.private'), from: role('administrator').id });
  });
});

describe('server: "sign in as" never climbs', () => {
  let srv: Running;
  let dir: string;
  let base: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-roles-'));
    srv = await startServer({ dataDir: dir, webRoot: dir, config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
    base = `http://127.0.0.1:${srv.httpPort}`;
  }, 60000);
  afterAll(async () => {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const call = async (url: string, body?: unknown, cookie?: string) => {
    const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };

  it('a Director may not sign in as the Administrator; he may as someone of the centre', async () => {
    const db = (await call('/api/dbs/create', { organisation: 'Roles centre', centre: 'homs' })).body.slug;
    expect((await call('/api/setup/new', { db, organisation: 'Roles centre', supName: 'Fouad', supPin: 'sup-secret', comName: 'Com', comPin: 'com-secret' })).status).toBe(200);
    const people = async () => (await call(`/api/profiles?db=${db}`)).body as { id: number; name: string }[];
    const login = async (name: string, password: string) => {
      const r = await call('/api/login', { db, profileId: (await people()).find((p) => p.name === name)!.id, password });
      if (r.body.mustChange) await call('/api/op/profile.setPin', { id: r.body.profile.id, pin: password }, r.cookie!);
      return r.cookie!;
    };
    const fouad = await login('Fouad', 'sup-secret');
    const list = (await call('/api/op/access.list', {}, fouad)).body as AccessRow[];
    expect((await call('/api/op/user.save', { name: 'Dina', roles: [list.find((r) => r.kind === 'director')!.id], books: [], pin: 'dina-secret' }, fouad)).status).toBe(200);
    const dina = await login('Dina', 'dina-secret');
    const ids = await people();
    expect((await call('/api/as', { profileId: ids.find((p) => p.name === 'Fouad')!.id, mode: 'view' }, dina)).status).toBe(403);
    expect((await call('/api/as', { profileId: ids.find((p) => p.name === 'Com')!.id, mode: 'view' }, dina)).status).toBe(200);
    // the doors and rights come with the session
    expect((await call('/api/me', undefined, fouad)).body.profile).toMatchObject({ admin: true, roles: [{ kind: 'administrator' }] });
  }, 60000);
});
