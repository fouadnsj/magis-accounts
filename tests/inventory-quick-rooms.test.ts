// Quick add of the inventory, room after room and the same list in several rooms (Fouad's third test, comment 6, answer "A — both",
// 26 November 2026): the rooms of one area and kind in the map's order, the list copied into each ticked room (one save, all or none),
// a serial number never copied to several rooms.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import type { Db } from '../src/db/db';
import type { InvData } from '../src/inventory/inv';
import { QUICK_MAX, quickInRooms, quickRooms, quickSerialBlocked, type QuickRow } from '../src/inventory/map';
import { nodeDb } from './nodeDb';

const files = { docWrite: async () => undefined, docRead: async () => new Uint8Array(), docExists: async () => false } as unknown as OpCtx['files'];
const row = (name: string, qty: string, o: Partial<QuickRow> = {}): QuickRow => ({ name, qty, place_id: 1, category_id: null, serial: '', value: '', ...o });

describe('the rules (pure)', () => {
  it('the walk: the rooms of the same area and kind, active, in the map order', () => {
    const sp = (id: number, building_id: number, kind_id: number | null, sort: number, active = 1, place_id: number | null = id) => ({ id, building_id, kind_id, sort, active, place_id });
    const all = [sp(1, 1, 5, 2), sp(2, 1, 5, 1), sp(3, 1, 6, 0), sp(4, 2, 5, 0), sp(5, 1, 5, 3, 0), sp(6, 1, 5, 4, 1, null), sp(7, 1, 5, 2)];
    expect(quickRooms(all[0], all).map((x) => x.id)).toEqual([2, 1, 7]);
    expect(quickRooms(all[3], all).map((x) => x.id)).toEqual([4]);
  });
  it('the same list in each ticked room, room by room; empty and 0 rows skipped', () => {
    const rows = [row('Bed', '2'), row('Cupboard', ''), row('Chair', '0'), row('Desk', '1')];
    const r = quickInRooms(rows, [10, 11, 12], () => false);
    expect(r.skipped).toEqual([]);
    expect(r.items.map((x) => [x.place_id, x.name, x.qty])).toEqual([[10, 'Bed', '2'], [10, 'Desk', '1'], [11, 'Bed', '2'], [11, 'Desk', '1'], [12, 'Bed', '2'], [12, 'Desk', '1']]);
    // the same room twice counts once
    expect(quickInRooms(rows, [10, 10], () => false).items).toHaveLength(2);
    expect(QUICK_MAX).toBe(1000);
  });
  it('a serial number is not copied to several rooms: the row is skipped there; in one room it stays', () => {
    const asks = (id: number | null) => id === 9;
    const rows = [row('Bed', '2'), row('Laptop', '1', { category_id: 9 }), row('Printer', '1', { category_id: 9, serial: 'SN-1' }), row('Router', '3', { category_id: 9 })];
    const many = quickInRooms(rows, [10, 11], asks);
    expect(many.skipped.map((x) => x.name)).toEqual(['Laptop', 'Printer']);
    expect(many.items.map((x) => [x.place_id, x.name])).toEqual([[10, 'Bed'], [10, 'Router'], [11, 'Bed'], [11, 'Router']]);
    expect(quickInRooms(rows, [10], asks).skipped).toEqual([]);
    expect(quickInRooms(rows, [10], asks).items).toHaveLength(4);
    expect(quickSerialBlocked({ qty: '1', serial: '' }, false, 3)).toBe(false);
  });
});

describe('the multi-room save (the server)', () => {
  let db: Db;
  let sup: OpCtx;
  const get = async () => (await runOp(sup, 'inv.get', undefined)) as InvData;
  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    const p = (await db.query<{ id: number }>("SELECT id FROM profile WHERE name = 'Sup'"))[0];
    sup = { db, profile: (await loadProfile(db, p.id))!, who: 'Sup', install: 'office', files };
  }, 60000);

  it('a group "Bed ×2" in each of three bedrooms = three groups, one history line each, the origin of the save', async () => {
    const places: number[] = [];
    for (const n of ['Room 1', 'Room 2', 'Room 3']) places.push(((await runOp(sup, 'inv.list.save', { table: 'place', name: n })) as { id: number }).id);
    const d0 = await get();
    const gift = d0.origins.find((o) => !o.bought && o.active && /gift|هدية/i.test(o.name)) ?? d0.origins.find((o) => !o.bought && o.active)!;
    const rooms = quickInRooms([row('Bed', '2'), row('Cupboard', '1')], places, () => false).items;
    const r = (await runOp(sup, 'inv.item.many', { origin_id: gift.id, items: rooms.map((x) => ({ ...x, qty: Number(x.qty) })) })) as { ids: number[] };
    expect(r.ids).toHaveLength(6);
    const d = await get();
    for (const pl of places) {
      const here = d.items.filter((i) => i.place_id === pl);
      expect(here.map((i) => [i.name, i.qty, i.origin_id]).sort()).toEqual([['Bed', 2, gift.id], ['Cupboard', 1, gift.id]]);
    }
    const hist = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM inv_move WHERE kind = 'added' AND item_id IN (" + r.ids.join(',') + ')');
    expect(hist[0].n).toBe(6);
  });

  it('all rooms or none: one wrong row stops the whole save', async () => {
    const places = (await get()).places.slice(0, 2).map((p) => p.id);
    const before = (await get()).items.length;
    const items = [
      ...quickInRooms([row('Fan', '1')], places, () => false).items.map((x) => ({ ...x, qty: Number(x.qty) })),
      { name: 'Ghost', qty: 1, place_id: 99999 },
    ];
    await expect(runOp(sup, 'inv.item.many', { items })).rejects.toThrow();
    expect((await get()).items.length).toBe(before);
  });

  it('the same serial number twice in one save is refused (so it must not be copied to rooms), nothing is saved', async () => {
    const places = (await get()).places.slice(0, 2).map((p) => p.id);
    const before = (await get()).items.length;
    const items = places.map((pl) => ({ name: 'Laptop', qty: 1, place_id: pl, serial: 'SN-77' }));
    await expect(runOp(sup, 'inv.item.many', { items })).rejects.toThrow(/serial/i);
    expect((await get()).items.length).toBe(before);
    // one laptop with its serial in one room is fine
    await runOp(sup, 'inv.item.many', { items: [items[0]] });
    expect((await get()).items.length).toBe(before + 1);
  });
});
