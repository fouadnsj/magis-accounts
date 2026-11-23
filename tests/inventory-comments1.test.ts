// Fouad's first test of the new inventory (23 November 2026, TEST-COMMENTS-1.md "Inventory"): Quick add by room with a
// ready list per kind of space (update 73); the serial number only where needed; the quick view "Stores" (the kind with
// the code 'store'); the person who has an item chosen from MAGIS HR, and the reminder when they leave.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { migrate, splitSql, type Db } from '../src/db/db';
import { MIGRATIONS } from '../src/db/migrations';
import { commonName, type InvData } from '../src/inventory/inv';
import { holderRefOf, isStore, quickBadQty, quickToSave, readyOf, withSomeoneWhoLeft, type HrPick, type InvReady, type QuickRow } from '../src/inventory/map';
import { startServer, type Running } from '../server/server';
import { nodeDb } from './nodeDb';

const files = { docWrite: async () => undefined, docRead: async () => new Uint8Array(), docExists: async () => false } as unknown as OpCtx['files'];

describe('the rules (pure)', () => {
  it('a store is found by the code of its kind, not by its name', () => {
    const kinds = [{ id: 1, code: null }, { id: 7, code: 'store' }];
    expect(isStore({ kind_id: 7 }, kinds)).toBe(true);
    expect(isStore({ kind_id: 1 }, kinds)).toBe(false);
    expect(isStore({ kind_id: null }, kinds)).toBe(false);
  });
  it('the ready list of a space is the list of its kind, in its order', () => {
    const ready: InvReady[] = [{ id: 1, kind_id: 2, name: 'Table', category_id: null, sort: 2 }, { id: 2, kind_id: 2, name: 'Chair', category_id: null, sort: 1 }, { id: 3, kind_id: 1, name: 'Bed', category_id: null, sort: 1 }];
    expect(readyOf({ kind_id: 2 }, ready).map((r) => r.name)).toEqual(['Chair', 'Table']);
    expect(readyOf({ kind_id: null }, ready)).toEqual([]);
  });
  it('Quick add saves only rows with a name, a space and a whole number of 1 or more', () => {
    const r = (name: string, qty: string, place_id: number | null = 5): QuickRow => ({ name, qty, place_id, category_id: null, serial: '', value: '' });
    const rows = [r('Bed', '2'), r('Cupboard', ''), r('Chair', '0'), r('', '3'), r('Desk', '1', null), r('Fan', '1.5'), r('Heater', 'x')];
    expect(quickToSave(rows).map((x) => x.name)).toEqual(['Bed']);
    expect(rows.filter(quickBadQty).map((x) => x.name)).toEqual(['Fan', 'Heater']);
  });
  it('a common name in the language of the screen; the centre\'s own names stay', () => {
    expect(commonName('Bed', 'ar')).toBe('سرير');
    expect(commonName('سرير', 'fr')).toBe('Lit');
    expect(commonName('Bed', 'both')).toBe('Bed');
    expect(commonName('Bunk bed', 'ar')).toBe('Bunk bed');
  });
  it('a name is an HR person only when exactly one has it (Latin or Arabic); the reminder for who left', () => {
    const people: HrPick[] = [{ ref: 'hr:1', name: 'Rima Haddad', name_ar: 'ريما حداد', left: null }, { ref: 'hr:2', name: 'Sami Nasr', name_ar: null, left: '2026-11-20' }, { ref: 'hr:3', name: 'Twin', name_ar: null, left: null }, { ref: 'hr:4', name: 'twin', name_ar: null, left: null }];
    expect(holderRefOf('  rima  haddad ', people)).toBe('hr:1');
    expect(holderRefOf('ريما حداد', people)).toBe('hr:1');
    expect(holderRefOf('Twin', people)).toBeNull();
    expect(holderRefOf('Someone else', people)).toBeNull();
    const items = [
      { id: 1, status: 'in_use' as const, holder: 'Sami Nasr', holder_ref: 'hr:2' },
      { id: 2, status: 'in_use' as const, holder: 'Rima Haddad', holder_ref: 'hr:1' },
      { id: 3, status: 'in_use' as const, holder: 'Sami (typed)', holder_ref: null },
      { id: 4, status: 'disposed' as const, holder: 'Sami Nasr', holder_ref: 'hr:2' },
    ];
    expect(withSomeoneWhoLeft(items, people).map((x) => [x.item.id, x.person.left])).toEqual([[1, '2026-11-20']]);
  });
});

// ------------------------------------------------------------------ update 73

const upTo72 = async (kind?: string) => {
  const db = nodeDb();
  await db.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
  for (const mg of MIGRATIONS.filter((x) => x.n <= 72)) await db.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
  if (kind) await db.batch([{ sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('kind', ?)", params: [kind] }]);
  return db;
};

describe('update 73 on a database at 72', () => {
  it('each kind of space gets its usual items (common names only, with their category); the Store kind its shelf', async () => {
    const db = await upTo72();
    expect(await migrate(db)).toEqual([73, 74]);
    const rows = await db.query<{ kind: string; name: string; cat: string | null; code: string | null }>(
      'SELECT k.name AS kind, r.name, c.name AS cat, k.code FROM inv_ready r JOIN host_kind k ON k.id = r.kind_id LEFT JOIN inv_category c ON c.id = r.category_id ORDER BY k.sort, r.sort');
    const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.name);
    expect(of('Bedroom · غرفة نوم')).toEqual(['Bed', 'Cupboard', 'Desk', 'Chair', 'Fan', 'Heater']);
    expect(of('Hall · قاعة')).toEqual(['Chair', 'Table', 'Whiteboard', 'Projector', 'Screen', 'Microphone', 'Fan', 'Heater']);
    expect(of('Office · مكتب')).toEqual(['Desk', 'Chair', 'Cupboard', 'Shelf', 'Laptop', 'Printer']);
    expect(of('Other · أخرى')).toEqual([]);
    expect(rows.filter((r) => r.code === 'store').map((r) => r.name)).toEqual(['Shelf']);
    // every name is one of the common names; every row has its category
    const { COMMON_ITEMS } = await import('../src/inventory/inv');
    expect(rows.every((r) => COMMON_ITEMS.some((c) => c.en === r.name))).toBe(true);
    expect(rows.every((r) => r.cat != null)).toBe(true);
    expect(rows.find((r) => r.name === 'Laptop')!.cat).toBe('IT equipment · معدات معلوماتية');
    expect(rows.find((r) => r.name === 'Projector')!.cat).toBe('Audio-visual · صوت وصورة');
    // the person of HR on an item
    expect((await db.query<{ name: string }>("SELECT name FROM pragma_table_info('inv_item') WHERE name = 'holder_ref'")).length).toBe(1);
    expect(await migrate(db)).toEqual([]);
  });
  it('a community, the country and HR get no ready list', async () => {
    for (const k of ['community', 'country', 'hr']) {
      const db = await upTo72(k);
      expect(await migrate(db)).toEqual([73, 74]);
      expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM inv_ready'))[0].n).toBe(0);
    }
  });
});

// ------------------------------------------------------------------ the operations

describe('the operations', () => {
  let db: Db;
  let sup: OpCtx;
  const get = async () => (await runOp(sup, 'inv.get', undefined)) as InvData;
  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    const p = (await db.query<{ id: number }>("SELECT id FROM profile WHERE name = 'Sup'"))[0];
    sup = { db, profile: (await loadProfile(db, p.id))!, who: 'Sup', install: 'office', files };
  }, 60000);

  it('the inventory carries the kinds and the ready lists; a ready list is saved whole, in its order', async () => {
    const d = await get();
    const bedroom = d.kinds.find((k) => k.name.startsWith('Bedroom'))!;
    expect(readyOf({ kind_id: bedroom.id }, d.ready).map((r) => r.name)).toEqual(['Bed', 'Cupboard', 'Desk', 'Chair', 'Fan', 'Heater']);
    const furniture = d.categories.find((c) => c.name.startsWith('Furniture'))!.id;
    await runOp(sup, 'inv.ready.save', { kind_id: bedroom.id, items: [{ name: 'Bunk bed', category_id: furniture }, { name: 'Bed' }, { name: 'bed' }, { name: ' ' }] });
    expect(readyOf({ kind_id: bedroom.id }, (await get()).ready).map((r) => [r.name, r.category_id])).toEqual([['Bunk bed', furniture], ['Bed', null]]);
    await expect(runOp(sup, 'inv.ready.save', { kind_id: 999, items: [] })).rejects.toThrow(/kind/);
  });

  it('the kind of an inventory-only space is set from the inventory (a store); a space of the calendar is refused', async () => {
    const placeId = ((await runOp(sup, 'inv.list.save', { table: 'place', name: 'Back store' })) as { id: number }).id;
    let d = await get();
    const sp = d.spaces.find((x) => x.place_id === placeId)!;
    const store = d.kinds.find((k) => k.code === 'store')!;
    expect(isStore(sp, d.kinds)).toBe(false);
    await runOp(sup, 'inv.space.kind', { space_id: sp.id, kind_id: store.id });
    d = await get();
    expect(isStore(d.spaces.find((x) => x.id === sp.id)!, d.kinds)).toBe(true);
    const area = ((await runOp(sup, 'cal.area.save', { name: 'Main' })) as { id: number }).id;
    const hall = ((await runOp(sup, 'cal.space.save', { building_id: area, name: 'Hall A', kind_id: d.kinds.find((k) => k.name.startsWith('Hall'))!.id, capacity: 40 })) as { id: number }).id;
    await expect(runOp(sup, 'inv.space.kind', { space_id: hall, kind_id: store.id })).rejects.toThrow(/calendar/);
  });

  it('Quick add of a space: the ready rows with a number are recorded in that space, the others skipped', async () => {
    const d = await get();
    const sp = d.spaces.find((x) => x.name === 'Back store')!;
    const rows = readyOf(sp, d.ready).map((r): QuickRow => ({ name: r.name, category_id: r.category_id, place_id: sp.place_id, qty: '', serial: '', value: '' }));
    rows[0].qty = '12';
    rows.push({ name: 'Ladder', category_id: null, place_id: sp.place_id, qty: '0', serial: '', value: '' });
    const r = (await runOp(sup, 'inv.item.many', { items: quickToSave(rows).map((x) => ({ ...x, qty: Number(x.qty) })) })) as { ids: number[] };
    expect(r.ids).toHaveLength(1);
    const it = (await get()).items.find((i) => i.id === r.ids[0])!;
    expect([it.name, it.qty, it.place_id]).toEqual(['Shelf', 12, sp.place_id]);
  });

  it('the person who has an item: chosen from HR (kept), typed by hand (none), taken out (cleared)', async () => {
    const id = ((await runOp(sup, 'inv.item.add', { name: 'Laptop', qty: 1, holder: 'Rima Haddad', holder_ref: 'hr-db:4' })) as { id: number }).id;
    const one = async () => (await get()).items.find((i) => i.id === id)!;
    expect((await one()).holder_ref).toBe('hr-db:4');
    const base = await one();
    const save = (x: object) => runOp(sup, 'inv.item.save', { id, name: base.name, qty: 1, category_id: null, place_id: null, ...x });
    // an older screen saves without the ref: the same person keeps it
    await save({ holder: 'Rima Haddad' });
    expect((await one()).holder_ref).toBe('hr-db:4');
    // another name typed by hand: no person of HR
    await save({ holder: 'A visitor', holder_ref: null });
    expect((await one())).toMatchObject({ holder: 'A visitor', holder_ref: null });
    await save({ holder: 'Rima Haddad', holder_ref: 'hr-db:4' });
    await runOp(sup, 'inv.item.out', { id, status: 'disposed', why: 'old' });
    expect((await one())).toMatchObject({ holder: null, holder_ref: null });
  });
});

// ------------------------------------------------------------------ the people of the centre in MAGIS HR (the server)

describe('the inventory reads the people of its centre from MAGIS HR', () => {
  const servers: Running[] = [];
  const dirs: string[] = [];
  afterAll(async () => { for (const s of servers) await s.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

  it('names only, the day someone left; only for whoever keeps the inventory; another centre\'s people are not given', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-invhr-'));
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
    const admin = browser();
    expect((await admin('/api/dir/setup', { name: 'Fouad', password: 'fouad-pass-1' })).status).toBe(200);
    const homs = await admin('/api/dbs/create', { organisation: 'MAGIS Homs test', centre: 'homs' });
    await admin('/api/setup/new', { db: homs.body.slug, organisation: 'MAGIS Homs test', supName: 'Boss', supPin: 'boss-inv-1', comName: 'Clerk', comPin: 'clerk-inv-1' });
    const jar = await admin('/api/dbs/create', { organisation: 'MAGIS Jaramana test', centre: 'jaramana' });
    await admin('/api/setup/new', { db: jar.body.slug, organisation: 'MAGIS Jaramana test', supName: 'Boss J', supPin: 'boss-jar-1', comName: 'Clerk J', comPin: 'clerk-jar-1' });
    const hr = await admin('/api/dbs/create', { organisation: 'HR', centre: 'other', kind: 'hr' });
    await admin('/api/setup/hr', { db: hr.body.slug, organisation: 'HR', people: [{ name: 'Keeper', password: 'keeper-inv-1' }], mustChange: false });
    const keeper = browser();
    const kp = (await keeper(`/api/profiles?db=${hr.body.slug}`)).body[0].id;
    expect((await keeper('/api/login', { db: hr.body.slug, profileId: kp, password: 'keeper-inv-1' })).status).toBe(200);
    for (const from of [homs.body.slug, jar.body.slug]) expect((await keeper('/api/hr/import-lists', { from })).status).toBe(200);
    const lists = (await keeper('/api/op/hr.data', {})).body.lists as { kind: string; name: string; source: string | null }[];
    const centreOf = (slug: string) => lists.find((x) => x.kind === 'centre' && x.source === slug)!.name;
    const add = async (name: string, centre: string, extra: object = {}) => (await keeper('/api/op/hr.person.save', { name, centre, started: '2026-01-01', ...extra })).body.id as number;
    await add('Rima Haddad', centreOf(homs.body.slug), { first_name: 'Rima', last_name: 'Haddad', first_name_ar: 'ريما', last_name_ar: 'حداد' });
    const sami = await add('Sami Nasr', centreOf(homs.body.slug), { first_name: 'Sami', last_name: 'Nasr' });
    await add('Lina Jaramana', centreOf(jar.body.slug));
    expect((await keeper('/api/op/hr.person.leave', { id: sami, ended: '2026-11-20' })).status).toBe(200);

    // the Superior of Homs (who keeps the inventory) gets the two people of Homs, and the day Sami left
    const boss = browser();
    const profiles = (await boss(`/api/profiles?db=${homs.body.slug}`)).body as { id: number; name: string }[];
    expect((await boss('/api/login', { db: homs.body.slug, profileId: profiles.find((p) => p.name === 'Boss')!.id, password: 'boss-inv-1' })).status).toBe(200);
    const r = await boss('/api/inv/hr-people');
    expect(r.status).toBe(200);
    const got = r.body as HrPick[];
    expect(got.map((p) => [p.name, p.name_ar, p.left])).toEqual([['Rima Haddad', 'ريما حداد', null], ['Sami Nasr', null, '2026-11-20']]);
    expect(Object.keys(got[0]).sort()).toEqual(['left', 'name', 'name_ar', 'ref']);
    expect(got[0].ref.startsWith(`${hr.body.slug}:`)).toBe(true);
    // nobody signed in: refused
    expect((await browser()('/api/inv/hr-people')).status).toBe(403);
  }, 60000);
});
