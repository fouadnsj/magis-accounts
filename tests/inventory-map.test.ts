// Inventory step 1 (baseline 1.1, 24 November 2026): one map of the centre shared with the calendar, the 0.12 places
// carried over without loss, categories with three ticks, a group that splits, "always in the room" read from the
// inventory, the new rights (look, values, keep; everyone reports a problem).
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { migrate } from '../src/db/db';
import type { Db } from '../src/db/db';
import type { InvData } from '../src/inventory/inv';
import type { CalData } from '../src/hosting/calendar';
import { withImplied } from '../src/perms';
import { inventoryPack } from '../src/inventory/ops';
import {
  alwaysInRoom, findByLabel, groupOf, INV_AREA, invMap, invRights, inRoomOf, itemAsks, partLetter, spaceLabel, splitLabels, splitProblem, withoutValues,
} from '../src/inventory/map';
import { nodeDb } from './nodeDb';

const store = new Map<string, Uint8Array>();
const files = { docWrite: async (r: string, b: Uint8Array) => { store.set(r, b); }, docRead: async (r: string) => store.get(r)!, docExists: async (r: string) => store.has(r) } as unknown as OpCtx['files'];

describe('the rules (pure)', () => {
  it('a group splits with letters: A stays, B moves; a part split again keeps its letter', () => {
    expect(splitLabels('HO-0102', ['HO-0101', 'HO-0102'])).toEqual({ stays: 'HO-0102-A', moves: 'HO-0102-B' });
    expect(splitLabels('HO-0102-A', ['HO-0102-A', 'HO-0102-B'])).toEqual({ stays: 'HO-0102-A', moves: 'HO-0102-C' });
    expect(splitLabels('HO-0102-B', ['HO-0102-A', 'HO-0102-B', 'HO-0102-C'])).toEqual({ stays: 'HO-0102-B', moves: 'HO-0102-D' });
    const many = Array.from({ length: 26 }, (_, i) => `JAR-0001-${String.fromCharCode(65 + i)}`);
    expect(splitLabels('JAR-0001-Z', many).moves).toBe('JAR-0001-AA');
    expect(groupOf('HO-0102-B')).toBe('HO-0102');
    expect(partLetter('HO-0102-b')).toBe('B');
    // the labels printed before recording (JAR-V001) are not parts of a group
    expect(groupOf('JAR-V001')).toBe('JAR-V001');
    expect(partLetter('JAR-V001')).toBeNull();
  });

  it('how many may move apart: at least one, fewer than all, whole numbers', () => {
    const g = { qty: 60, status: 'in_use' as const };
    expect(splitProblem(g, 30)).toBeNull();
    expect(splitProblem(g, 60)).toBe('qty');
    expect(splitProblem(g, 0)).toBe('qty');
    expect(splitProblem(g, 2.5)).toBe('qty');
    expect(splitProblem({ qty: 60, status: 'disposed' }, 3)).toBe('out');
  });

  it('an old sticker finds every part of its group; an exact label finds only its item', () => {
    const items = [{ code: 'HO-0102-A' }, { code: 'HO-0102-B' }, { code: 'HO-0103' }];
    expect(findByLabel(items, 'HO-0102').map((i) => i.code)).toEqual(['HO-0102-A', 'HO-0102-B']);
    expect(findByLabel(items, 'ho-0102-b').map((i) => i.code)).toEqual(['HO-0102-B']);
    expect(findByLabel(items, 'HO-0103')).toHaveLength(1);
    expect(findByLabel(items, ' ')).toHaveLength(0);
  });

  it('the rights: look, values, keep; everyone reports a problem', () => {
    expect(invRights([])).toEqual({ look: false, values: false, keep: false, report: true });
    expect(invRights(['inventory.view'])).toEqual({ look: true, values: false, keep: false, report: true });
    expect(invRights(['inventory.values'])).toMatchObject({ look: true, values: true, keep: false });
    expect(invRights(['inventory.manage'])).toMatchObject({ look: true, values: true, keep: true });
    // on a role, keeping brings the values, the values bring looking
    expect(withImplied(['inventory.manage'])).toEqual(expect.arrayContaining(['inventory.view', 'inventory.values']));
    expect(withImplied(['inventory.values'])).toContain('inventory.view');
    expect(withImplied(['inventory.view'])).not.toContain('inventory.values');
  });

  it('"always in the room" comes from the inventory; the typed text only while the inventory has nothing there', () => {
    const spaces = [{ id: 1, place_id: 10, fixed: 'projector' }, { id: 2, place_id: 20, fixed: '40 chairs' }, { id: 3, place_id: null, fixed: null }];
    const cats = [{ id: 1, in_calendar: 1 }, { id: 2, in_calendar: 0 }];
    const it = (name: string, place_id: number, category_id: number, qty = 1, status: 'in_use' | 'disposed' = 'in_use') => ({ name, place_id, category_id, qty, status });
    const rows = inRoomOf(spaces, [it('Projector', 10, 1), it('projector ', 10, 1), it('Speaker', 10, 1, 2), it('Chair', 10, 2, 40), it('Screen', 10, 1, 1, 'disposed')], cats);
    expect(rows).toEqual([{ room_id: 1, name: 'Projector', qty: 2 }, { room_id: 1, name: 'Speaker', qty: 2 }]);
    expect(alwaysInRoom(spaces[0], rows)).toEqual({ items: [{ name: 'Projector', qty: 2 }, { name: 'Speaker', qty: 2 }], typed: null });
    expect(alwaysInRoom(spaces[1], rows)).toEqual({ items: [], typed: '40 chairs' });
  });

  it('a valuable item asks for a photo, a category with serials asks for the serial', () => {
    const cats = [{ id: 1, serial: 1, valuable: 1 }, { id: 2, serial: 0, valuable: 0 }];
    expect(itemAsks({ id: 5, category_id: 1, serial: null, status: 'in_use' }, cats, [])).toEqual(['photo', 'serial']);
    expect(itemAsks({ id: 5, category_id: 1, serial: 'SN', status: 'in_use' }, cats, [{ item_id: 5 }])).toEqual([]);
    expect(itemAsks({ id: 6, category_id: 2, serial: null, status: 'in_use' }, cats, [])).toEqual([]);
    expect(itemAsks({ id: 5, category_id: 1, serial: null, status: 'lost' }, cats, [])).toEqual([]);
  });

  it('a space is named "Area · Space"; a store of "Inventory places" by its own name', () => {
    expect(spaceLabel({ name: 'Main' }, { name: 'Hall A' })).toBe('Main · Hall A');
    expect(spaceLabel({ name: INV_AREA }, { name: 'Store 1' })).toBe('Store 1');
    expect(spaceLabel(null, { name: 'Store 1' })).toBe('Store 1');
  });
});

// ------------------------------------------------------------------ a 0.12 database brought up to step 1

describe('update 69-71 on a 0.12 database', () => {
  let db: Db;
  beforeAll(async () => {
    db = nodeDb();
    // stop before 69, as a 0.12 / calendar-step-2 database is
    await db.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }, ...[69, 70, 71].map((n) => ({ sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?,?,?)', params: [n, 'later', 'x'] }))]);
    await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    // what 0.12 holds: two stores typed in the inventory, a guest house whose rooms are places, items in each
    await db.batch([
      { sql: "INSERT INTO inv_place (id, name, sort) VALUES (1, 'Store 1', 1), (2, 'Store 2', 2), (3, 'Guest house · Room 1', 3)" },
      { sql: "INSERT INTO host_building (id, name, sort) VALUES (1, 'Guest house', 1)" },
      { sql: "INSERT INTO host_room (id, building_id, name, beds, kind, kind_id, active, sort, place_id) VALUES (1, 1, 'Room 1', 2, 'bedroom', 1, 1, 1, 3), (2, 1, 'Room 2', 2, 'bedroom', 1, 1, 2, NULL)" },
      { sql: "INSERT INTO inv_item (id, code, name, category_id, place_id, qty, created_at) VALUES (1, 'HOM-0001', 'Chairs', 3, 1, 60, 'x'), (2, 'HOM-0002', 'Projector', 2, 2, 1, 'x'), (3, 'HOM-0003', 'Bed', 3, 3, 2, 'x')" },
      { sql: "INSERT INTO inv_move (item_id, on_date, kind, place_id, at) VALUES (1, '2026-11-01', 'added', 1, 'x'), (2, '2026-11-01', 'added', 2, 'x')" },
      { sql: "INSERT INTO access_profile (name, perms, sort) VALUES ('Reception', '[\"inventory.view\"]', 4), ('Stock keeper', '[\"inventory.manage\",\"inventory.view\"]', 5)" },
    ]);
    await db.batch([{ sql: 'DELETE FROM schema_migration WHERE n IN (69, 70, 71)' }]);
    expect(await migrate(db)).toEqual([69, 70, 71]);
  }, 60000);

  it('every place is a space and every space a place; the stores cannot be booked; nothing of 0.12 is lost', async () => {
    const rooms = await db.query<{ id: number; building_id: number; name: string; place_id: number | null; bookable: number; rentable: number }>('SELECT id, building_id, name, place_id, bookable, rentable FROM host_room ORDER BY id');
    const area = (await db.query<{ id: number }>('SELECT id FROM host_building WHERE name = ?', [INV_AREA]))[0];
    expect(area).toBeTruthy();
    expect(rooms.filter((r) => r.building_id === area.id).map((r) => [r.name, r.place_id, r.bookable, r.rentable])).toEqual([['Store 1', 1, 0, 0], ['Store 2', 2, 0, 0]]);
    // the room that had no place gets one, named as 0.12 named them
    const room2 = rooms.find((r) => r.id === 2)!;
    expect((await db.query<{ name: string }>('SELECT name FROM inv_place WHERE id = ?', [room2.place_id]))[0].name).toBe('Guest house · Room 2');
    // the guest-house rooms stay bookable; no place is outside the map
    expect(rooms.filter((r) => r.building_id === 1).every((r) => r.bookable === 1)).toBe(true);
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM inv_place p WHERE NOT EXISTS (SELECT 1 FROM host_room r WHERE r.place_id = p.id)'))[0].n).toBe(0);
    // the items and their history keep their place
    expect((await db.query<{ id: number; place_id: number }>('SELECT id, place_id FROM inv_item ORDER BY id'))).toEqual([{ id: 1, place_id: 1 }, { id: 2, place_id: 2 }, { id: 3, place_id: 3 }]);
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM inv_move'))[0].n).toBe(2);
  });

  it('the categories start with their ticks; the values tick goes to whoever keeps the inventory', async () => {
    const cats = await db.query<{ name: string; serial: number; valuable: number; in_calendar: number }>('SELECT name, serial, valuable, in_calendar FROM inv_category ORDER BY sort');
    expect(cats.filter((c) => c.valuable).map((c) => c.name)).toEqual(['IT equipment · معدات معلوماتية', 'Audio-visual · صوت وصورة']);
    expect(cats.filter((c) => c.in_calendar).map((c) => c.name)).toEqual(['Audio-visual · صوت وصورة']);
    const perms = new Map((await db.query<{ name: string; perms: string }>('SELECT name, perms FROM access_profile')).map((p) => [p.name, JSON.parse(p.perms) as string[]]));
    expect(perms.get('Stock keeper')).toContain('inventory.values');
    expect(perms.get('Reception')).not.toContain('inventory.values');
    expect([...perms.values()].some((p) => p.includes('users.manage') && p.includes('inventory.values'))).toBe(true);
  });

  it('a second run changes nothing', async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

// ------------------------------------------------------------------ the operations

describe('the operations of step 1', () => {
  let db: Db;
  let sup: OpCtx;
  let reception: OpCtx;
  const ctxOf = async (name: string): Promise<OpCtx> => {
    const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
    return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
  };
  const get = async (c: OpCtx = sup) => (await runOp(c, 'inv.get', undefined)) as InvData;

  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    sup = await ctxOf('Sup');
    await runOp(sup, 'access.save', { name: 'Reception', perms: ['inventory.view', 'cal.view'] });
    const acc = (await db.query<{ id: number }>("SELECT id FROM access_profile WHERE name = 'Reception'"))[0].id;
    await runOp(sup, 'user.save', { name: 'Rita', access_id: acc, books: [], pin: 'rita-pass-1' });
    reception = await ctxOf('Rita');
  }, 60000);

  it('a place added in the inventory is a space of the map that cannot be booked', async () => {
    const id = ((await runOp(sup, 'inv.list.save', { table: 'place', name: 'Store A' })) as { id: number }).id;
    const d = await get();
    const sp = d.spaces.find((s) => s.place_id === id)!;
    expect(sp).toMatchObject({ name: 'Store A', bookable: 0 });
    expect(d.areas.find((a) => a.id === sp.building_id)?.name).toBe(INV_AREA);
    // renamed here, its space follows
    await runOp(sup, 'inv.list.save', { table: 'place', id, name: 'Store B' });
    expect((await get()).spaces.find((s) => s.place_id === id)?.name).toBe('Store B');
    // the calendar does not show it
    const cal = (await runOp(sup, 'cal.get', undefined)) as CalData;
    expect(cal.spaces.find((s) => s.place_id === id)?.bookable).toBe(0);
  });

  it('a space of the calendar is changed in the calendar\'s settings, not in the inventory', async () => {
    const area = ((await runOp(sup, 'cal.area.save', { name: 'Main' })) as { id: number }).id;
    const kind = (await db.query<{ id: number }>('SELECT id FROM host_kind WHERE sleeps = 0 ORDER BY id LIMIT 1'))[0].id;
    const hall = ((await runOp(sup, 'cal.space.save', { building_id: area, name: 'Hall A', kind_id: kind, capacity: 40, fixed: 'whiteboard' })) as { id: number }).id;
    const place = (await get()).spaces.find((s) => s.id === hall)!.place_id!;
    await expect(runOp(sup, 'inv.list.save', { table: 'place', id: place, name: 'Hall Z' })).rejects.toThrow(/calendar/);
  });

  it('the category ticks are kept when an older screen saves only the name and the serial tick', async () => {
    const cat = (await get()).categories.find((c) => c.name.startsWith('Furniture'))!;
    await runOp(sup, 'inv.list.save', { table: 'category', id: cat.id, name: cat.name, serial: false, valuable: true, in_calendar: true });
    await runOp(sup, 'inv.list.save', { table: 'category', id: cat.id, name: cat.name, serial: false });
    expect((await get()).categories.find((c) => c.id === cat.id)).toMatchObject({ valuable: 1, in_calendar: 1 });
    await runOp(sup, 'inv.list.save', { table: 'category', id: cat.id, name: cat.name, serial: false, valuable: false, in_calendar: false });
    const added = ((await runOp(sup, 'inv.list.save', { table: 'category', name: 'Sound', valuable: true, in_calendar: true })) as { id: number }).id;
    expect((await get()).categories.find((c) => c.id === added)).toMatchObject({ valuable: 1, in_calendar: 1, serial: 0 });
  });

  it('part of a group moves: the group splits, same label with a letter, history on both, value and photos kept', async () => {
    const d0 = await get();
    const hall = d0.spaces.find((s) => s.name === 'Hall A')!;
    const store = d0.spaces.find((s) => s.name === 'Store B')!;
    const furniture = d0.categories.find((c) => c.name.startsWith('Furniture'))!;
    const { id } = (await runOp(sup, 'inv.item.add', { name: 'Chairs', qty: 60, category_id: furniture.id, place_id: store.place_id, value_usd: 12 })) as { id: number };
    await runOp(sup, 'inv.photo.add', { itemId: id, base64: btoa('jpg'), mime: 'image/jpeg' });
    const code = (await get()).items.find((i) => i.id === id)!.code;

    await expect(runOp(sup, 'inv.item.move', { id, space_id: hall.id, qty: 0 })).rejects.toThrow();
    await expect(runOp(sup, 'inv.item.move', { id, space_id: store.id })).rejects.toThrow(/already/);
    await expect(runOp(reception, 'inv.item.move', { id, space_id: hall.id, qty: 30 })).rejects.toThrow();
    const r = (await runOp(sup, 'inv.item.move', { id, space_id: hall.id, qty: 30, date: '2026-11-23' })) as { part: number; stays: string; moves: string };
    expect(r).toMatchObject({ stays: `${code}-A`, moves: `${code}-B` });

    const d = await get();
    const a = d.items.find((i) => i.id === id)!;
    const b = d.items.find((i) => i.id === r.part)!;
    expect([a.code, a.qty, a.place_id]).toEqual([`${code}-A`, 30, store.place_id]);
    expect([b.code, b.qty, b.place_id, b.value_usd, b.split_from]).toEqual([`${code}-B`, 30, hall.place_id, 12, id]);
    expect(d.photos.filter((p) => p.item_id === r.part)).toHaveLength(1);
    expect(d.moves.filter((m) => m.kind === 'split').map((m) => m.item_id).sort()).toEqual([id, r.part].sort());
    // the value of the centre is unchanged: 60 × 12
    expect(d.items.filter((i) => i.name === 'Chairs').reduce((n, i) => n + i.qty * (i.value_usd ?? 0), 0)).toBe(720);
    // the old sticker finds both parts
    expect(findByLabel(d.items, code).map((i) => i.id).sort()).toEqual([id, r.part].sort());

    // the rest moves whole: no new letter
    await runOp(sup, 'inv.item.move', { id, space_id: hall.id });
    expect((await get()).items.find((i) => i.id === id)).toMatchObject({ code: `${code}-A`, qty: 30, place_id: hall.place_id });
    // a part split again takes the next letter
    const again = (await runOp(sup, 'inv.item.move', { id: r.part, space_id: store.id, qty: 10 })) as { stays: string; moves: string };
    expect(again).toMatchObject({ stays: `${code}-B`, moves: `${code}-C` });
  });

  it('"always in the room" in the calendar is read from the inventory (category shown in the calendar)', async () => {
    const d = await get();
    const hall = d.spaces.find((s) => s.name === 'Hall A')!;
    const av = d.categories.find((c) => c.in_calendar === 1)!;
    await runOp(sup, 'inv.item.add', { name: 'Projector', category_id: av.id, place_id: hall.place_id, serial: 'PRJ-1' });
    const cal = (await runOp(sup, 'cal.get', undefined)) as CalData;
    expect(cal.inRoom?.filter((x) => x.room_id === hall.id)).toEqual([{ room_id: hall.id, name: 'Projector', qty: 1 }]);
    // the chairs (furniture, not shown in the calendar) are not there; the typed "whiteboard" gives way to the inventory
    const sp = cal.spaces.find((s) => s.id === hall.id)!;
    expect(alwaysInRoom(sp, cal.inRoom ?? [])).toEqual({ items: [{ name: 'Projector', qty: 1 }], typed: null });
  });

  it('who looks without the values tick gets every item without any amount; the keeper sees them', async () => {
    const mine = await get(reception);
    expect(mine.rights).toEqual({ look: true, values: false, keep: false, report: true });
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((i) => i.value_usd == null && i.value_note == null)).toBe(true);
    expect((await get()).items.some((i) => i.value_usd === 12)).toBe(true);
    expect(withoutValues({ items: mine.items }, true).items).toBe(mine.items);
  });

  it('the map: a card per space with items, units, value for those who may see it, and the store area only when used', async () => {
    const d = await get();
    const map = invMap(d, { values: true });
    const hall = map.areas.flatMap((a) => a.spaces).find((s) => s.space.name === 'Hall A')!;
    expect(hall).toMatchObject({ label: 'Main · Hall A', bookable: true, items: 3, units: 51 });
    expect(hall.value).toBe(30 * 12 + 20 * 12);
    expect(invMap(d, { values: false }).areas.flatMap((a) => a.spaces).every((s) => s.value === null)).toBe(true);
    expect(map.loose).toEqual([]);
    // the phone's list of places uses the names of the map
    const pack = await inventoryPack(db);
    expect(pack.places.map((p) => p.name)).toEqual(expect.arrayContaining(['Store B', 'Main · Hall A']));
  });
});
