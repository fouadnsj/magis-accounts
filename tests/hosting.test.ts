// Accommodation and events (Fouad, 22 November 2026): buildings and rooms, bookings with a status, double-booking checks,
// the amounts seen only by those who keep the calendar, payments suggested to the accountant, a booking from a phone.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type DataPayload, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import type { Db } from '../src/db/db';
import { bookingTotal, conflictsOf, dueOf, heldDays, nextCode, nextReceipt, nightsOf, stayAmount, type HostData } from '../src/hosting/host';
import { nodeDb } from './nodeDb';

const store = new Map<string, Uint8Array>();
const files = { docWrite: async (r: string, b: Uint8Array) => { store.set(r, b); }, docRead: async (r: string) => store.get(r)!, docExists: async (r: string) => store.has(r) } as unknown as OpCtx['files'];
let db: Db;
let sup: OpCtx;
let reception: OpCtx;
let holder: OpCtx;
const ctxOf = async (name: string): Promise<OpCtx> => {
  const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
  return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
};
const host = async (c: OpCtx = sup) => (await runOp(c, 'host.get', undefined)) as HostData;
const day = (n: number) => new Date(Date.UTC(2027, 2, 1 + n)).toISOString().slice(0, 10);

let hall = 0, r1 = 0, r2 = 0;

beforeAll(async () => {
  db = nodeDb();
  await createOffice(db, { organisation: 'Al-Ard', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
  sup = await ctxOf('Sup');
  // a reception person: sees and books, never the prices
  await db.batch([{ sql: "INSERT INTO access_profile (name, perms) VALUES ('Reception', '[\"hosting.book\",\"book.own\"]')" }]);
  const access = (await db.query<{ id: number }>("SELECT id FROM access_profile WHERE name = 'Reception'"))[0].id;
  await db.batch([{ sql: "INSERT INTO book (name, keeper_name, is_main, sort) VALUES ('Desk', 'Desk', 0, 98)" }]);
  const bk = (await db.query<{ id: number }>("SELECT id FROM book WHERE name = 'Desk'"))[0].id;
  await runOp(sup, 'user.save', { name: 'Reception', access_id: access, books: [bk], pin: 'desk-pass-1' });
  reception = await ctxOf('Reception');
  await runOp(sup, 'user.save', { name: 'Plain', access_id: 3, books: [], pin: 'plain-pass-1' });
  holder = await ctxOf('Plain');
}, 60000);

describe('the days and the money', () => {
  it('a stay holds its nights, an event holds every day', () => {
    expect(heldDays({ kind: 'stay', from_day: '2027-03-01', to_day: '2027-03-04' })).toEqual(['2027-03-01', '2027-03-02', '2027-03-03']);
    expect(heldDays({ kind: 'event', from_day: '2027-03-01', to_day: '2027-03-02' })).toEqual(['2027-03-01', '2027-03-02']);
    expect(nightsOf({ kind: 'stay', from_day: '2027-03-01', to_day: '2027-03-04' })).toBe(3);
  });
  it('per person per night, or a price for the group; services come on top', () => {
    const b = { kind: 'stay' as const, from_day: '2027-03-01', to_day: '2027-03-04', people: 10 };
    expect(stayAmount({ ...b, price_mode: 'person', rate: 8 })).toBe(240);
    expect(stayAmount({ ...b, price_mode: 'group', rate: 500 })).toBe(500);
    expect(stayAmount({ ...b, price_mode: null, rate: null })).toBe(0);
    expect(bookingTotal({ ...b, price_mode: 'person', rate: 8 }, [{ amount: 60 }, { amount: 40 }])).toBe(340);
    expect(dueOf(340, 'USD', [{ amount: 100, currency: 'USD', status: 'suggested' }, { amount: 50, currency: 'USD', status: 'refused' }, { amount: 9999, currency: 'SYP', status: 'suggested' }])).toBe(240);
  });
  it('numbers continue in the year', () => {
    expect(nextCode([], 2027)).toBe('HB-2027-0001');
    expect(nextCode(['HB-2027-0009', 'HB-2026-0100'], 2027)).toBe('HB-2027-0010');
    expect(nextReceipt(['H2027-0003'], 2027)).toBe('H2027-0004');
  });
});

describe('buildings, rooms and the section', () => {
  it('the Accountant and Superior keep the calendar; reception books; a plain holder sees nothing', async () => {
    expect(sup.profile.perms).toContain('hosting.keep');
    expect(reception.profile.perms).toContain('hosting.book');
    expect(reception.profile.perms).not.toContain('hosting.keep');
    await expect(runOp(holder, 'host.get', undefined)).rejects.toThrow();
    // only a keeper writes the lists
    await expect(runOp(reception, 'host.building.save', { name: 'Guest house' })).rejects.toThrow();
  });

  it('the section is off until switched on; it reaches the menu only then', async () => {
    const d0 = (await runOp(sup, 'data', {})) as DataPayload;
    expect(d0.host).toEqual({ on: false, review: 0, toEnter: 0, inventoryOn: true });
    await runOp(sup, 'host.section', { on: true });
    expect(((await runOp(sup, 'data', {})) as DataPayload).host?.on).toBe(true);
    expect(((await runOp(holder, 'data', {})) as DataPayload).host).toBeNull();
    await expect(runOp(reception, 'host.section', { on: false })).rejects.toThrow();
  });

  it('a room is also a place of the inventory', async () => {
    const b = (await runOp(sup, 'host.building.save', { name: 'Guest house' })) as { id: number };
    r1 = ((await runOp(sup, 'host.room.save', { building_id: b.id, name: 'Room 1', beds: 4 })) as { id: number }).id;
    r2 = ((await runOp(sup, 'host.room.save', { building_id: b.id, name: 'Room 2', beds: 2 })) as { id: number }).id;
    const b2 = (await runOp(sup, 'host.building.save', { name: 'Main house' })) as { id: number };
    hall = ((await runOp(sup, 'host.room.save', { building_id: b2.id, name: 'Hall', beds: 0, kind: 'hall' })) as { id: number }).id;
    const places = await db.query<{ name: string }>('SELECT name FROM inv_place ORDER BY name');
    expect(places.map((p) => p.name)).toContain('Guest house · Room 1');
    const d = await host();
    expect(d.rooms.find((r) => r.id === r1)?.place_id).not.toBeNull();
    await expect(runOp(sup, 'host.room.save', { building_id: b.id, name: 'Room 1', beds: 4 })).rejects.toThrow();
  });
});

describe('bookings', () => {
  let a = 0;
  it('a booking starts "to confirm"; a stay needs a leaving day after the arrival', async () => {
    await expect(runOp(sup, 'host.booking.save', { group_name: 'Scouts', from_day: day(0), to_day: day(0), allocs: [{ room_id: r1 }] })).rejects.toThrow();
    const r = (await runOp(sup, 'host.booking.save', { group_name: 'Scouts', people: 4, from_day: day(0), to_day: day(3), allocs: [{ room_id: r1 }], price_mode: 'person', rate: 10, currency: 'USD' })) as { id: number };
    a = r.id;
    const b = (await host()).bookings.find((x) => x.id === a)!;
    expect(b.status).toBe('option');
    expect(b.code).toBe('HB-2027-0001');
  });

  it('two options may overlap (a warning); the second cannot be confirmed over a confirmed one', async () => {
    const r = (await runOp(sup, 'host.booking.save', { group_name: 'Choir', people: 4, from_day: day(1), to_day: day(2), allocs: [{ room_id: r1 }] })) as { id: number; conflicts: number };
    expect(r.conflicts).toBe(1);
    await runOp(sup, 'host.booking.status', { id: a, status: 'confirmed' });
    await expect(runOp(sup, 'host.booking.status', { id: r.id, status: 'confirmed' })).rejects.toThrow(/Scouts|taken/);
    // a different room is free
    await runOp(sup, 'host.booking.save', { id: r.id, group_name: 'Choir', people: 4, from_day: day(1), to_day: day(2), allocs: [{ room_id: r2, beds: 2 }] });
    await runOp(sup, 'host.booking.status', { id: r.id, status: 'confirmed' });
  });

  it('beds are shared: two groups in one room while there are beds, not more', async () => {
    const d = await host();
    const probe = { id: 999, kind: 'stay' as const, from_day: day(10), to_day: day(12) };
    const x = (await runOp(sup, 'host.booking.save', { group_name: 'G1', people: 3, from_day: day(10), to_day: day(12), allocs: [{ room_id: r1, beds: 3 }], status: 'confirmed' })) as { id: number };
    const y = (await runOp(sup, 'host.booking.save', { group_name: 'G2', people: 1, from_day: day(10), to_day: day(12), allocs: [{ room_id: r1, beds: 1 }], status: 'confirmed' })) as { id: number };
    expect(x.id).not.toBe(y.id);
    await expect(runOp(sup, 'host.booking.save', { group_name: 'G3', people: 1, from_day: day(11), to_day: day(13), allocs: [{ room_id: r1, beds: 1 }], status: 'confirmed' })).rejects.toThrow();
    const dd = await host();
    expect(conflictsOf(probe, [{ booking_id: 999, room_id: r1, beds: 1 }], dd, 'sure').length).toBeGreaterThan(0);
    expect(d.bookings.length).toBeGreaterThan(0);
    // leaving the morning another group arrives is fine (the day of leaving is not a night)
    await runOp(sup, 'host.booking.save', { group_name: 'G4', people: 4, from_day: day(12), to_day: day(14), allocs: [{ room_id: r1 }], status: 'confirmed' });
  });

  it('an event takes a hall for its days', async () => {
    const e = (await runOp(sup, 'host.booking.save', { kind: 'event', group_name: 'Workshop', people: 30, from_day: day(20), to_day: day(21), allocs: [{ room_id: hall }], status: 'confirmed' })) as { id: number };
    expect(e.id).toBeGreaterThan(0);
    await expect(runOp(sup, 'host.booking.save', { kind: 'event', group_name: 'Wedding', people: 80, from_day: day(21), to_day: day(21), allocs: [{ room_id: hall }], status: 'confirmed' })).rejects.toThrow();
  });

  it('cancelling asks nothing of the rooms; a cancelled booking frees them', async () => {
    const x = (await host()).bookings.find((b) => b.group_name === 'G1')!;
    await runOp(sup, 'host.booking.status', { id: x.id, status: 'cancelled', reason: 'They called off' });
    const y = await host();
    expect(y.bookings.find((b) => b.id === x.id)?.cancel_reason).toBe('They called off');
    await runOp(sup, 'host.booking.save', { group_name: 'G5', people: 3, from_day: day(10), to_day: day(12), allocs: [{ room_id: r1, beds: 3 }], status: 'confirmed' });
  });
});

describe('the prices are for those who keep the calendar', () => {
  let id = 0;
  it('reception sees the bookings and never an amount — in what the server sends', async () => {
    id = ((await runOp(sup, 'host.booking.save', { group_name: 'Pilgrims', people: 6, from_day: day(30), to_day: day(33), allocs: [{ room_id: r2 }], price_mode: 'person', rate: 12, currency: 'USD', lines: [{ label: 'Lunch', qty: 6, amount: 30 }] })) as { id: number }).id;
    await runOp(sup, 'host.pay.add', { booking_id: id, amount: 100 });
    const forSup = await host(sup);
    expect(forSup.prices).toBe(true);
    expect(forSup.bookings.find((b) => b.id === id)?.rate).toBe(12);
    expect(forSup.lines.length).toBeGreaterThan(0);
    expect(forSup.pays.length).toBe(1);
    const forDesk = await host(reception);
    expect(forDesk.prices).toBe(false);
    expect(forDesk.bookings.find((b) => b.id === id)?.group_name).toBe('Pilgrims');
    expect(JSON.stringify(forDesk)).not.toMatch(/"rate":\d|"amount"/);
    expect(forDesk.pays).toEqual([]);
    expect(forDesk.lines).toEqual([]);
    await expect(runOp(reception, 'host.pay.add', { booking_id: id, amount: 5 })).rejects.toThrow();
  });

  it('reception edits a booking without changing its price or its lines', async () => {
    const lineId = (await db.query<{ id: number }>('SELECT id FROM host_line WHERE booking_id = ?', [id]))[0].id;
    await runOp(reception, 'host.booking.save', { id, group_name: 'Pilgrims (changed)', people: 7, from_day: day(30), to_day: day(33), allocs: [{ room_id: r2 }], price_mode: 'group', rate: 1, lines: [{ id: lineId, label: 'Lunch', qty: 7, amount: 1 }, { label: 'Heating', qty: 1, amount: 999 }] });
    const b = (await db.query<{ rate: number; price_mode: string; group_name: string }>('SELECT rate, price_mode, group_name FROM host_booking WHERE id = ?', [id]))[0];
    expect(b).toMatchObject({ rate: 12, price_mode: 'person', group_name: 'Pilgrims (changed)' });
    const ls = await db.query<{ label: string; amount: number }>('SELECT label, amount FROM host_line WHERE booking_id = ? ORDER BY id', [id]);
    expect(ls).toEqual([{ label: 'Lunch', amount: 30 }, { label: 'Heating', amount: 0 }]);
  });
});

describe('payments are suggestions of entries', () => {
  it('a payment waits until the accountant makes the entry (the receipt number links them) or refuses it', async () => {
    const id = (await db.query<{ id: number }>("SELECT id FROM host_booking WHERE group_name LIKE 'Pilgrims%'"))[0].id;
    const r = (await runOp(sup, 'host.pay.add', { booking_id: id, amount: 50, currency: 'USD', paid_on: day(31) })) as { receipt_no: string };
    expect(r.receipt_no).toMatch(/^H2027-\d{4}$/);
    expect(((await runOp(sup, 'data', {})) as DataPayload).host?.toEnter).toBe(2);
    // the accountant makes the entry with that receipt number
    await db.batch([{ sql: "INSERT INTO trx (id, date, type, explanation, receipt, inc_usd, created_at) VALUES ('t-1', ?, 'Income', 'Pilgrims', ?, 50, '2027-04-01T00:00:00Z')", params: [day(31), r.receipt_no] }]);
    expect((await host()).entered).toContain(r.receipt_no);
    expect(((await runOp(sup, 'data', {})) as DataPayload).host?.toEnter).toBe(1);
    await expect(runOp(sup, 'host.pay.refuse', { id: (await host()).pays.find((p) => p.receipt_no === r.receipt_no)!.id })).rejects.toThrow();
    // the other one is refused
    const other = (await host()).pays.find((p) => p.receipt_no !== r.receipt_no)!;
    await runOp(sup, 'host.pay.refuse', { id: other.id });
    expect(((await runOp(sup, 'data', {})) as DataPayload).host?.toEnter).toBe(0);
  });
});

describe('a booking made on a phone with no connection', () => {
  it('is always "to confirm", is never made twice, and waits for a look with what it runs into', async () => {
    const mk = (ref: string, from: number, to: number) => ({ source: 'phone' as const, client_ref: ref, group_name: `Phone ${ref}`, people: 2, from_day: day(from), to_day: day(to), allocs: [{ room_id: r2 }], status: 'confirmed' as const });
    // free days
    const ok = (await runOp(reception, 'host.booking.save', mk('p1', 60, 62))) as { id: number };
    const again = (await runOp(reception, 'host.booking.save', mk('p1', 60, 62))) as { id: number; again: boolean };
    expect(again.again).toBe(true);
    expect(again.id).toBe(ok.id);
    expect((await host()).bookings.find((b) => b.id === ok.id)).toMatchObject({ status: 'option', review: 1, source: 'phone' });
    // the Pilgrims have Room 2 from day 30 to 33: a phone booking for the same days is a conflict, found at the connection
    const bad = (await runOp(reception, 'host.booking.save', { ...mk('p2', 31, 32), group_name: 'Phone late' })) as { id: number };
    await runOp(sup, 'host.booking.status', { id: (await db.query<{ id: number }>("SELECT id FROM host_booking WHERE group_name LIKE 'Pilgrims%'"))[0].id, status: 'confirmed' });
    const { hostReview } = await import('../src/hosting/ops');
    const list = await hostReview(sup);
    const row = list.find((x) => x.booking.id === bad.id)!;
    expect(row.conflicts.length).toBeGreaterThan(0);
    expect(row.clashWith.map((b) => b.group_name)).toEqual(['Pilgrims (changed)']);
    expect(list.find((x) => x.booking.id === ok.id)!.conflicts).toEqual([]);
    expect(((await runOp(reception, 'data', {})) as DataPayload).host?.review).toBe(2);
    // the free one is confirmed; the other cannot be
    await runOp(reception, 'host.booking.status', { id: ok.id, status: 'confirmed' });
    await expect(runOp(reception, 'host.booking.status', { id: bad.id, status: 'confirmed' })).rejects.toThrow();
    // moved to free days, then confirmed
    await runOp(reception, 'host.booking.save', { id: bad.id, group_name: 'Phone late', people: 2, from_day: day(70), to_day: day(72), allocs: [{ room_id: r2 }] });
    await runOp(reception, 'host.booking.status', { id: bad.id, status: 'confirmed' });
    expect(((await runOp(reception, 'data', {})) as DataPayload).host?.review).toBe(0);
  });
});

describe('the phone', () => {
  it('carries the calendar without any amount, for those who see it', async () => {
    const { hostPack, mayPhone, phoneHostBook, phoneHostStatus } = await import('../server/phone');
    expect(mayPhone(reception.profile)).toBe(true);
    expect(mayPhone(holder.profile)).toBe(false);
    const pack = (await hostPack(db, reception.profile))!;
    expect(pack.book).toBe(true);
    expect(pack.rooms.length).toBeGreaterThan(0);
    expect(JSON.stringify(pack)).not.toMatch(/"rate"|"amount"|"price/);
    expect(await hostPack(db, holder.profile)).toBeUndefined();

    // a booking sent twice (no answer, sent again) is made once; it is "to confirm" whatever is asked
    const mk = (days: [number, number]) => ({ kind: 'stay', group_name: 'Phone group', people: 3, from_day: day(days[0]), to_day: day(days[1]), contact: 'Rim', phone: '0999', allocs: [{ room_id: r1, beds: 2 }], status: 'confirmed' });
    const a = await phoneHostBook(reception, { key: 'phone-key-0001', booking: mk([90, 92]) });
    const b = await phoneHostBook(reception, { key: 'phone-key-0001', booking: mk([90, 92]) });
    expect(b.already).toBe(true);
    expect(b.id).toBe(a.id);
    expect((await host()).bookings.find((x) => x.id === a.id)).toMatchObject({ status: 'option', review: 1, source: 'phone' });
    // online: change the dates, then confirm
    await phoneHostBook(reception, { key: 'phone-key-0002', id: a.id, booking: mk([95, 97]) });
    await phoneHostStatus(reception, { id: a.id, status: 'confirmed' });
    expect((await host()).bookings.find((x) => x.id === a.id)).toMatchObject({ status: 'confirmed', review: 0, from_day: day(95) });
    // a bad key is refused
    await expect(phoneHostBook(reception, { key: '!', booking: mk([1, 2]) })).rejects.toThrow();
  });
});

describe("Al-Ard's farm list", () => {
  it('adds the headings and lines once, leaves what exists, and only for those who manage lists', async () => {
    await expect(runOp(reception, 'host.farm.seed', undefined)).rejects.toThrow();
    const a = (await runOp(sup, 'host.farm.seed', undefined)) as { headings: number; lines: number };
    expect(a).toEqual({ headings: 3, lines: 15 });
    const b = (await runOp(sup, 'host.farm.seed', undefined)) as { headings: number; lines: number };
    expect(b).toEqual({ headings: 0, lines: 0 });
    const names = (await db.query<{ name: string }>('SELECT name FROM budget_line')).map((x) => x.name);
    expect(names).toContain('زيت زيتون · Olive oil');
    expect(names).toContain('مخيمات · Camps');
    expect(names).toContain('عمالة موسمية (تقليم…) · Seasonal labour (pruning…)');
  });
});
