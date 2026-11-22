// Accommodation and events (Fouad, 22 November 2026): buildings and rooms, bookings with a status, double-booking checks,
// the amounts seen only by those who keep the calendar, payments suggested to the accountant, a booking from a phone.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type DataPayload, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import type { Db } from '../src/db/db';
import { bookingTotals, colorOf, equipmentLoad, knownNames, nameKey, report, shortagesFor, conflictsOf, dueOf, heldDays, nextCode, nextReceipt, nightsOf, occupancy, PALETTE, stayAmount, type HostData } from '../src/hosting/host';
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
    // each service line has its own currency; the total and what is due are kept per currency
    const t = bookingTotals({ ...b, price_mode: 'person', rate: 8, currency: 'USD' }, [{ amount: 60, currency: 'USD' }, { amount: 500000, currency: 'SYP' }]);
    expect(t).toEqual({ USD: 300, SYP: 500000 });
    expect(dueOf(t, [{ amount: 100, currency: 'USD', status: 'suggested' }, { amount: 50, currency: 'USD', status: 'refused' }, { amount: 200000, currency: 'SYP', status: 'suggested' }])).toEqual({ USD: 200, SYP: 300000 });
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

describe('events that repeat, hours, colours, currencies', () => {
  it('a weekly event holds only its weekdays between the two dates; a stay never repeats', () => {
    // 2027-03-01 is a Monday
    const ev = { kind: 'event' as const, from_day: '2027-03-01', to_day: '2027-03-14', repeat_days: '1,3' };
    expect(heldDays(ev)).toEqual(['2027-03-01', '2027-03-03', '2027-03-08', '2027-03-10']);
    expect(heldDays({ ...ev, kind: 'stay' as const, to_day: '2027-03-04' })).toEqual(['2027-03-01', '2027-03-02', '2027-03-03']);
  });

  it('saves a repeating event, refuses weekdays that never fall in the dates, and clears the repeat on a stay', async () => {
    const ok = (await runOp(sup, 'host.booking.save', { kind: 'event', group_name: 'Choir practice', people: 20, from_day: day(100), to_day: day(128), repeat_days: [1, 3], time_from: '16:00', time_to: '18:00', allocs: [{ room_id: hall }], status: 'confirmed' })) as { id: number };
    const row = (await db.query<{ repeat_days: string; time_from: string }>('SELECT repeat_days, time_from FROM host_booking WHERE id = ?', [ok.id]))[0];
    expect(row).toEqual({ repeat_days: '1,3', time_from: '16:00' });
    // a one-day span that holds no chosen weekday
    await expect(runOp(sup, 'host.booking.save', { kind: 'event', group_name: 'Nothing', from_day: day(101), to_day: day(101), repeat_days: [1], allocs: [{ room_id: hall }] })).rejects.toThrow();
    // a stay with a repeat: the repeat is ignored and cleared
    const st = (await runOp(sup, 'host.booking.save', { kind: 'stay', group_name: 'Plain stay', people: 1, from_day: day(200), to_day: day(202), repeat_days: [1, 3], time_from: '10:00', allocs: [{ room_id: r2 }] })) as { id: number };
    expect((await db.query<{ repeat_days: string | null; time_from: string | null }>('SELECT repeat_days, time_from FROM host_booking WHERE id = ?', [st.id]))[0]).toEqual({ repeat_days: null, time_from: null });
  });

  it('two events in one hall on one day clash only if their hours cross', async () => {
    const d = day(110); // a day the choir practice may hold: make the days match the weekday rule
    const first = (await runOp(sup, 'host.booking.save', { kind: 'event', group_name: 'Morning class', people: 10, from_day: d, to_day: d, time_from: '09:00', time_to: '11:00', allocs: [{ room_id: hall }], status: 'confirmed' })) as { id: number };
    const apart = (await runOp(sup, 'host.booking.save', { kind: 'event', group_name: 'Evening class', people: 10, from_day: d, to_day: d, time_from: '17:00', time_to: '19:00', allocs: [{ room_id: hall }], status: 'confirmed' })) as { id: number };
    expect(apart.id).not.toBe(first.id);
    await expect(runOp(sup, 'host.booking.save', { kind: 'event', group_name: 'Crossing', people: 5, from_day: d, to_day: d, time_from: '10:00', time_to: '12:00', allocs: [{ room_id: hall }], status: 'confirmed' })).rejects.toThrow();
    // no hours: the whole day, so it clashes with both
    await expect(runOp(sup, 'host.booking.save', { kind: 'event', group_name: 'All day', people: 5, from_day: d, to_day: d, allocs: [{ room_id: hall }], status: 'confirmed' })).rejects.toThrow();
  });

  it('a building has a colour (chosen, or from the palette); a bad one is refused; only a keeper changes it', async () => {
    const d = await host();
    const b = d.buildings[0];
    expect(colorOf(d.buildings, b.id)).toBe(PALETTE[0]);
    await runOp(sup, 'host.building.save', { id: b.id, name: b.name, color: '#112233' });
    expect(colorOf((await host()).buildings, b.id)).toBe('#112233');
    await expect(runOp(sup, 'host.building.save', { id: b.id, name: b.name, color: 'red' })).rejects.toThrow();
    await expect(runOp(reception, 'host.building.save', { id: b.id, name: b.name, color: '#000000' })).rejects.toThrow();
    // saving the name alone keeps the colour
    await runOp(sup, 'host.building.save', { id: b.id, name: b.name });
    expect(colorOf((await host()).buildings, b.id)).toBe('#112233');
  });

  it('a service line has its own currency; reception keeps it unchanged', async () => {
    const id = (await runOp(sup, 'host.booking.save', { group_name: 'Two currencies', people: 2, from_day: day(300), to_day: day(302), allocs: [{ room_id: r2 }], price_mode: 'person', rate: 10, currency: 'USD', lines: [{ label: 'Lunch', qty: 2, amount: 40, currency: 'USD' }, { label: 'Heating', qty: 1, amount: 300000, currency: 'SYP' }] })) as { id: number };
    const forSup = await host(sup);
    expect(forSup.lines.filter((l) => l.booking_id === id.id).map((l) => l.currency)).toEqual(['USD', 'SYP']);
    const lines = await db.query<{ id: number; label: string }>('SELECT id, label FROM host_line WHERE booking_id = ? ORDER BY id', [id.id]);
    await runOp(reception, 'host.booking.save', { id: id.id, group_name: 'Two currencies', people: 2, from_day: day(300), to_day: day(302), allocs: [{ room_id: r2 }], lines: [{ id: lines[0].id, label: 'Lunch', qty: 2, amount: 1, currency: 'SYP' }, { id: lines[1].id, label: 'Heating', qty: 1, amount: 1, currency: 'USD' }] });
    const kept = await db.query<{ amount: number; currency: string }>('SELECT amount, currency FROM host_line WHERE booking_id = ? ORDER BY id', [id.id]);
    expect(kept).toEqual([{ amount: 40, currency: 'USD' }, { amount: 300000, currency: 'SYP' }]);
    // a payment in the other currency
    const p = (await runOp(sup, 'host.pay.add', { booking_id: id.id, amount: 100000, currency: 'SYP' })) as { receipt_no: string };
    expect((await host()).pays.find((x) => x.receipt_no === p.receipt_no)?.currency).toBe('SYP');
  });

  it('the month and year views count the beds used each day', async () => {
    const d = await host();
    const occ = occupancy(d);
    expect(occ.total).toBeGreaterThan(0);
    const some = [...occ.days.values()].find((x) => x.used > 0);
    expect(some).toBeTruthy();
    // the Scouts: Room 1 (4 beds) all 3 nights
    expect(occ.days.get(day(1))?.groups.some((g) => g.group_name === 'Scouts')).toBe(true);
    // a room set aside: only its own beds count
    const only = occupancy(d, new Set([hall]));
    expect(only.total).toBe(1);
  });
});

describe('names and the report', () => {
  const room = (id: number, building_id: number, beds: number, kind: 'bedroom' | 'hall' = 'bedroom') => ({ id, building_id, name: `R${id}`, beds, kind, active: 1, sort: id, place_id: null });
  const bk = (id: number, o: Record<string, unknown>) => ({ id, code: `B${id}`, kind: 'stay', status: 'confirmed', group_name: 'G', contact: null, phone: null, people: 2, from_day: '2027-01-01', to_day: '2027-01-03', repeat_days: null, time_from: null, time_to: null, price_mode: 'person', rate: 10, currency: 'USD', note: null, cancel_reason: null, source: 'desk', review: 0, client_ref: null, created_by: null, created_at: '', updated_at: null, ...o });
  const data = {
    buildings: [{ id: 1, name: 'Guest house', active: 1, sort: 1, color: null }, { id: 2, name: 'Main house', active: 1, sort: 2, color: null }],
    rooms: [room(1, 1, 4), room(2, 2, 0, 'hall')],
    services: [],
    bookings: [
      bk(1, { group_name: 'Scouts', contact: 'Rim', phone: '0999', from_day: '2027-01-01', to_day: '2027-01-04', people: 4 }),
      bk(2, { group_name: ' scouts ', contact: 'rim', from_day: '2027-02-10', to_day: '2027-02-12', people: 2 }),
      bk(3, { group_name: 'Choir', contact: 'Rim', kind: 'event', from_day: '2027-01-05', to_day: '2027-01-12', repeat_days: '3', status: 'arrived' }),
      bk(4, { group_name: 'Late', status: 'cancelled', from_day: '2027-01-20', to_day: '2027-01-22' }),
      bk(5, { group_name: 'Maybe', status: 'option', from_day: '2027-01-20', to_day: '2027-01-22' }),
    ],
    allocs: [{ booking_id: 1, room_id: 1, beds: null }, { booking_id: 2, room_id: 1, beds: 2 }, { booking_id: 3, room_id: 2, beds: null }, { booking_id: 4, room_id: 1, beds: null }, { booking_id: 5, room_id: 1, beds: null }],
    lines: [{ id: 1, booking_id: 1, service_id: null, label: 'Lunch', qty: 4, amount: 50, currency: 'USD' as const }],
    pays: [{ id: 1, booking_id: 1, amount: 100, currency: 'USD' as const, paid_on: '2027-01-02', method: 'cash', receipt_no: 'H2027-0001', status: 'suggested' as const, note: null, who: null, at: '' }],
    entered: [], prices: true,
  } as unknown as HostData;

  it('a name written with another case or spaces is the same group; the contact comes with it', () => {
    expect(nameKey('  Scouts ')).toBe(nameKey('scouts'));
    const k = knownNames(data.bookings);
    expect(k.groups.get('scouts')).toMatchObject({ count: 2, contact: 'rim', phone: '0999' });
    expect(k.groups.has('late')).toBe(false); // a cancelled booking is not a visit
    expect(k.people.get('rim')?.count).toBe(3);
  });

  it('counts the bookings, nights, person-nights, event sessions and the occupancy of the period', () => {
    const r = report(data, { from: '2027-01-01', to: '2027-01-31', kind: 'all', withOptions: false });
    expect(r.summary.bookings).toBe(2); // Scouts (Jan) and the Choir; February is outside, the cancelled and the option are not counted
    expect(r.summary.stays).toBe(1);
    expect(r.summary.events).toBe(1);
    expect(r.summary.nights).toBe(3);
    expect(r.summary.personNights).toBe(12);
    expect(r.summary.eventDays).toBe(1); // the Choir repeats on Wednesdays between 5 and 12 January: only the 6th
    expect(r.summary.cancelled).toBe(1);
    expect(r.summary.bed.used).toBe(12); // 4 beds × 3 nights
    // Scouts: 4 people × 3 nights × 10 + lunch 50 = 170; the Choir: 2 people × 1 session × 10 = 20
    expect(r.summary.amounts.agreed.USD).toBe(190);
    expect(r.summary.amounts.paid.USD).toBe(100);
  });

  it('can count the bookings to confirm, filter by type, and give per group, person, month and building figures', () => {
    const withOpt = report(data, { from: '2027-01-01', to: '2027-01-31', kind: 'all', withOptions: true });
    expect(withOpt.summary.bookings).toBe(3);
    const stays = report(data, { from: '2027-01-01', to: '2027-02-28', kind: 'stay', withOptions: false });
    expect(stays.summary.events).toBe(0);
    expect(stays.groups.map((g) => [g.name, g.bookings])).toEqual([['scouts', 2]]); // Jan + Feb, written two ways, one group
    expect(stays.people[0]).toMatchObject({ bookings: 2 });
    expect(stays.months.map((m) => [m.month, m.bookings])).toEqual([['2027-01', 1], ['2027-02', 1]]);
    expect(stays.buildings.find((b) => b.id === 1)?.bedNights).toBe(12 + 4); // Jan: 4 beds × 3; Feb: 2 beds × 2
    const all = report(data, { from: '2027-01-01', to: '2027-01-31', kind: 'all', withOptions: false });
    expect(all.people[0]).toMatchObject({ name: 'Rim', bookings: 2 });
    expect([...all.people[0].groups].sort()).toEqual(['Choir', 'Scouts']);
    // day by day: Scouts hold all 4 beds on 1, 2 and 3 January (a Friday, Saturday, Sunday)
    const jan = report(data, { from: '2027-01-01', to: '2027-01-31', kind: 'all', withOptions: false });
    expect(jan.days.length).toBe(31);
    expect(jan.days.slice(0, 4).map((x) => x.bedPct)).toEqual([100, 100, 100, 0]);
    expect(jan.days[0]).toMatchObject({ people: 4, stays: 1, events: 0 });
    expect(jan.days[5]).toMatchObject({ day: '2027-01-06', events: 1, stays: 0 }); // the Choir's Wednesday
    expect([...jan.days].sort((x, y) => y.bedPct - x.bedPct)[0].bedPct).toBe(100);
    // the weekday pattern: Fridays 1, 8, 15, 22, 29 January: only the 1st is full → 20 %
    expect(jan.weekdays.find((w) => w.weekday === 5)?.bedPct).toBe(20);
    expect(jan.weekdays.find((w) => w.weekday === 3)?.busy).toBe(1);
    // a person who does not keep the calendar gets no amount
    const none = report({ ...data, prices: false, lines: [], pays: [] }, { from: '2027-01-01', to: '2027-01-31', kind: 'all', withOptions: false });
    expect(none.summary.amounts.agreed).toEqual({ USD: 0, SYP: 0 });
  });

  it('the Excel file has the busiest months and days, one row per day, and no amount for those who do not see prices', async () => {
    const { hostWorkbook } = await import('../src/io/hostFile');
    const ExcelJS = (await import('exceljs')).default;
    const read = async (d: HostData) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await hostWorkbook(d, { from: '2027-01-01', to: '2027-02-28', kind: 'all', withOptions: false }, 'Al-Ard')).buffer as ArrayBuffer); return wb; };
    const wb = await read(data);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'By month', 'Busiest', 'By day', 'By building', 'Groups', 'People', 'Bookings']);
    // January is the fullest month: rank 1
    const months = wb.getWorksheet('By month')!;
    expect(months.getRow(2).getCell(1).value).toBe('2027-01');
    expect(months.getRow(2).getCell(7).value).toBe(1);
    const busiest = wb.getWorksheet('Busiest')!;
    expect(busiest.getRow(3).getCell(2).value).toBe('2027-01');
    // one row per day of the two months, the first three at 100 %
    const days = wb.getWorksheet('By day')!;
    expect(days.rowCount).toBe(1 + 31 + 28);
    expect([2, 3, 4].map((i) => days.getRow(i).getCell(3).value)).toEqual([100, 100, 100]);
    expect(days.getRow(2).getCell(8).value).toBe('Scouts');
    // without prices: no Agreed / Paid columns
    const plain = await read({ ...data, prices: false, lines: [], pays: [] } as HostData);
    expect(plain.getWorksheet('Groups')!.getRow(1).values).not.toContain('Agreed');
    expect(plain.getWorksheet('Bookings')!.getRow(1).values).not.toContain('Agreed');
    expect(wb.getWorksheet('Groups')!.getRow(1).values).toContain('Agreed');
  });
});

describe('who sees the prices, and people with no books', () => {
  const role = async (name: string, perms: string[]) => {
    // saved as the Superior saves a role (the ticks that go together come with it)
    await runOp(sup, 'access.save', { name, perms });
    const access = (await db.query<{ id: number }>('SELECT id FROM access_profile WHERE name = ?', [name]))[0].id;
    // no book at all: a person who only works with the calendar
    await runOp(sup, 'user.save', { name, access_id: access, books: [], pin: 'role-pass-1' });
    return ctxOf(name);
  };

  it('a reception person with no book sees the calendar and books, with no price; the Superior decides about the prices', async () => {
    const desk = await role('Desk A', ['hosting.book']);
    expect(desk.profile.books).toEqual([]);
    expect(desk.profile.perms).toEqual(expect.arrayContaining(['hosting.book', 'hosting.view']));
    expect(desk.profile.perms).not.toContain('hosting.prices');
    const d = await host(desk);
    expect(d.prices).toBe(false);
    expect(d.rooms.length).toBeGreaterThan(0);
    const made = (await runOp(desk, 'host.booking.save', { group_name: 'Desk booking', people: 2, from_day: day(400), to_day: day(402), allocs: [{ room_id: r2 }] })) as { id: number };
    expect(made.id).toBeGreaterThan(0);
    // and the whole program opens for them: no book, no error
    const payload = (await runOp(desk, 'data', {})) as DataPayload;
    expect(payload.host?.on).toBe(true);
    expect(payload.rows).toEqual([]);
    await expect(runOp(desk, 'host.pay.add', { booking_id: made.id, amount: 5 })).rejects.toThrow();
    await expect(runOp(desk, 'host.building.save', { name: 'No' })).rejects.toThrow();
  });

  it('the prices are their own tick: with it a person sees and sets them (and can book), but still cannot change the buildings', async () => {
    const acc = await role('Desk B', ['hosting.prices']);
    expect(acc.profile.perms).toEqual(expect.arrayContaining(['hosting.prices', 'hosting.book', 'hosting.view']));
    expect(acc.profile.perms).not.toContain('hosting.keep');
    expect((await host(acc)).prices).toBe(true);
    const made = (await runOp(acc, 'host.booking.save', { group_name: 'Priced', people: 2, from_day: day(410), to_day: day(412), allocs: [{ room_id: r2 }], price_mode: 'person', rate: 7, currency: 'USD' })) as { id: number };
    expect((await host(acc)).bookings.find((b) => b.id === made.id)?.rate).toBe(7);
    await runOp(acc, 'host.pay.add', { booking_id: made.id, amount: 10 });
    expect(((await runOp(acc, 'data', {})) as DataPayload).host?.toEnter).toBeGreaterThan(0);
    await expect(runOp(acc, 'host.building.save', { name: 'No' })).rejects.toThrow();
    await expect(runOp(acc, 'host.room.save', { building_id: 1, name: 'x', beds: 1 })).rejects.toThrow();
    // reception with no prices tick still sees none of it
    const desk = await ctxOf('Desk A');
    expect(JSON.stringify(await host(desk))).not.toMatch(/"rate":7/);
    // keeping the calendar brings the prices, and the buildings
    const keeper = await role('Desk C', ['hosting.keep']);
    expect(keeper.profile.perms).toEqual(expect.arrayContaining(['hosting.keep', 'hosting.prices', 'hosting.book', 'hosting.view']));
    await runOp(keeper, 'host.building.save', { name: 'Kept house' });
  });

  it('the phone is open to a person with the calendar and no book', async () => {
    const { mayPhone, hostPack } = await import('../server/phone');
    const desk = await ctxOf('Desk A');
    expect(mayPhone(desk.profile)).toBe(true);
    const pack = (await hostPack(db, desk.profile))!;
    expect(pack.book).toBe(true);
    expect(JSON.stringify(pack)).not.toMatch(/"rate"|"amount"/);
  });
});

describe('kinds of room, capacity, and what a hall holds (from the inventory)', () => {
  let classroom = 0, hallId = 0, placeOfHall = 0;

  it('the kinds are a list: bedroom has beds, the others have a capacity; the list is edited by whoever keeps the calendar', async () => {
    const d = await host();
    expect(d.kinds.map((k) => [k.name.split(' · ')[0], k.sleeps])).toEqual([['Bedroom', 1], ['Hall', 0], ['Classroom', 0], ['Meeting room', 0], ['Dining room', 0], ['Other', 0]]);
    // the rooms made before carry their kind
    expect(d.rooms.find((r) => r.id === r1)?.kind_id).toBe(1);
    expect(d.rooms.find((r) => r.id === hall)?.kind_id).toBe(2);
    classroom = d.kinds.find((k) => k.name.startsWith('Classroom'))!.id;
    const chapel = (await runOp(sup, 'host.kind.save', { name: 'Chapel · كنيسة', sleeps: false })) as { ok: boolean };
    expect(chapel.ok).toBe(true);
    await expect(runOp(sup, 'host.kind.save', { name: 'chapel · كنيسة' })).rejects.toThrow(); // same name
    await expect(runOp(reception, 'host.kind.save', { name: 'Garden' })).rejects.toThrow();
  });

  it('a meeting space keeps a capacity (never beds); a bedroom keeps beds (never a capacity)', async () => {
    const b = (await host()).buildings[0].id;
    const made = (await runOp(sup, 'host.room.save', { building_id: b, name: 'Class A', kind_id: classroom, capacity: 25, beds: 9 })) as { id: number };
    hallId = made.id;
    let r = (await host()).rooms.find((x) => x.id === hallId)!;
    expect(r).toMatchObject({ kind_id: classroom, capacity: 25, beds: 0, kind: 'hall' });
    // a bedroom
    const bed = (await runOp(sup, 'host.room.save', { building_id: b, name: 'Dorm X', kind_id: 1, beds: 6, capacity: 99 })) as { id: number };
    r = (await host()).rooms.find((x) => x.id === bed.id)!;
    expect(r).toMatchObject({ kind_id: 1, beds: 6, capacity: 0, kind: 'bedroom' });
    // an unknown kind is refused; the old way (a word) still works
    await expect(runOp(sup, 'host.room.save', { building_id: b, name: 'Nope', kind_id: 999 })).rejects.toThrow();
    const old = (await runOp(sup, 'host.room.save', { building_id: b, name: 'Old style hall', kind: 'hall', capacity: 40 })) as { id: number };
    expect((await host()).rooms.find((x) => x.id === old.id)).toMatchObject({ kind_id: 2, capacity: 40, kind: 'hall' });
  });

  it('a kind used by rooms cannot change between beds and no beds', async () => {
    await expect(runOp(sup, 'host.kind.save', { id: 1, name: 'Bedroom · غرفة نوم', sleeps: false })).rejects.toThrow();
    await runOp(sup, 'host.kind.save', { id: 1, name: 'Bedroom · غرفة نوم', sleeps: true, active: true }); // renaming/keeping is fine
  });

  it('what a hall holds is read from the inventory: the items placed in the room, added up by name, never for a bedroom', async () => {
    const room = (await host()).rooms.find((x) => x.id === hallId)!;
    placeOfHall = room.place_id!;
    expect(placeOfHall).toBeGreaterThan(0);
    await runOp(sup, 'inv.item.many', { items: [
      { name: 'Video projector', qty: 1, place_id: placeOfHall }, { name: 'Sound system', qty: 1, place_id: placeOfHall },
      { name: 'Microphone', qty: 2, place_id: placeOfHall }, { name: 'Chair', qty: 30, place_id: placeOfHall }, { name: 'Chair', qty: 20, place_id: placeOfHall },
    ] });
    // an item in a bedroom is not listed
    const bedPlace = (await host()).rooms.find((x) => x.id === r1)!.place_id!;
    await runOp(sup, 'inv.item.many', { items: [{ name: 'Wardrobe', qty: 2, place_id: bedPlace }] });
    const d = await host();
    expect(d.assets.filter((a) => a.room_id === hallId).map((a) => [a.name, a.qty])).toEqual([['Chair', 50], ['Microphone', 2], ['Sound system', 1], ['Video projector', 1]]);
    expect(d.assets.some((a) => a.room_id === r1)).toBe(false);
    // the reception sees the equipment (and still no price)
    const forDesk = await host(reception);
    expect(forDesk.assets.filter((a) => a.room_id === hallId).length).toBe(4);
    expect(forDesk.prices).toBe(false);
    // an item taken out of use no longer counts
    const item = (await db.query<{ id: number }>("SELECT id FROM inv_item WHERE name = 'Microphone'"))[0].id;
    await runOp(sup, 'inv.item.out', { id: item, kind: 'lost', reason: 'test' });
    expect((await host()).assets.find((a) => a.room_id === hallId && a.name === 'Microphone')).toBeUndefined();
  });

  it('the phone carries the capacity', async () => {
    const { hostPack } = await import('../server/phone');
    const pack = (await hostPack(db, reception.profile))!;
    expect(pack.rooms.find((r) => r.id === hallId)?.capacity).toBe(25);
  });
});

describe('equipment a booking asks for, against what the inventory holds', () => {
  let projector = 0, board = 0;
  const halls = async () => (await host()).rooms.filter((r) => r.kind !== 'bedroom' && r.active).map((r) => r.id);
  const ev = async (group: string, dayN: number, projectors: number, o: Record<string, unknown> = {}) => {
    const h = await halls();
    return (await runOp(sup, 'host.booking.save', { kind: 'event', group_name: group, people: 10, from_day: day(dayN), to_day: day(dayN), allocs: [{ room_id: h[(o.room as number) ?? 0] }], needs: projectors ? [{ equip_id: projector, qty: projectors }] : [], ...o, room: undefined })) as { id: number; shortages: { equip_id: number; day: string; wanted: number; have: number; with: number[] }[] };
  };

  it('the list of equipment comes from the inventory\'s own names, and the count is read live (in use, in good condition)', async () => {
    // two video projectors in the inventory (one is already in the hall), a whiteboard
    await runOp(sup, 'inv.item.many', { items: [{ name: 'Video projector', qty: 1 }, { name: 'Whiteboard', qty: 3 }] });
    const opts = (await runOp(sup, 'host.equip.options', undefined)) as { name: string; total: number }[];
    expect(opts.find((o) => o.name === 'Video projector')?.total).toBeGreaterThanOrEqual(2);
    // only a name the inventory holds can be chosen; any case; twice gives the same one; only a keeper
    await expect(runOp(sup, 'host.equip.save', { name: 'Flying carpet' })).rejects.toThrow();
    projector = ((await runOp(sup, 'host.equip.save', { name: 'video PROJECTOR' })) as { id: number }).id;
    expect(((await runOp(sup, 'host.equip.save', { name: 'Video projector' })) as { id: number }).id).toBe(projector);
    board = ((await runOp(sup, 'host.equip.save', { name: 'Whiteboard' })) as { id: number }).id;
    await expect(runOp(reception, 'host.equip.save', { name: 'Chair' })).rejects.toThrow();
    const d = await host();
    expect(d.equip.find((e) => e.id === projector)?.total).toBe(2);
    // a broken one no longer counts
    await db.batch([{ sql: "UPDATE inv_item SET condition = 'broken' WHERE id = (SELECT MAX(id) FROM inv_item WHERE name = 'Video projector')" }]);
    expect((await host()).equip.find((e) => e.id === projector)?.total).toBe(1);
    await db.batch([{ sql: "UPDATE inv_item SET condition = 'good' WHERE name = 'Video projector'" }]);
    expect((await host()).equip.find((e) => e.id === projector)?.total).toBe(2);
  });

  it('four events on one day each want a projector and there are two: the third and the fourth are told, and who else asks', async () => {
    const a = await ev('Event A', 600, 1, { room: 0 });
    const b2 = await ev('Event B', 600, 1, { room: 1 });
    expect(a.shortages).toEqual([]);
    expect(b2.shortages).toEqual([]);
    const c3 = await ev('Event C', 600, 1, { room: 2 });
    expect(c3.shortages).toEqual([{ equip_id: projector, day: day(600), wanted: 3, have: 2, with: expect.arrayContaining([a.id, b2.id]) }]);
    // a booking that asks nothing is never told
    expect((await ev('Event D', 600, 0, { room: 0 })).shortages).toEqual([]);
    // the screens' own rule agrees, and the day-by-day load says 3 against 2
    const d = await host();
    expect(shortagesFor(d.bookings.find((x) => x.id === c3.id)!, d.needs.filter((n) => n.booking_id === c3.id), d).length).toBe(1);
    const load = equipmentLoad(d, day(599), day(601)).find((r) => r.equip.id === projector)!;
    expect(load.days.get(day(600))?.wanted).toBe(3);
    expect(load.days.get(day(599))).toBeUndefined();
    // confirming says it too
    const c = await runOp(sup, 'host.booking.status', { id: c3.id, status: 'confirmed' }) as { ok: boolean; shortages: unknown[] };
    expect(c.ok).toBe(true);
    expect(c.shortages.length).toBe(1);
  });

  it('two events whose hours do not cross do not compete; a cancelled booking frees what it asked for', async () => {
    const x = await ev('Morning', 610, 2, { room: 0, time_from: '09:00', time_to: '11:00' });
    const y = await ev('Evening', 610, 2, { room: 1, time_from: '17:00', time_to: '19:00' });
    expect(x.shortages).toEqual([]);
    expect(y.shortages).toEqual([]);
    const clash = await ev('Crossing', 610, 1, { room: 2, time_from: '10:00', time_to: '12:00' });
    expect(clash.shortages.length).toBe(1); // 2 (Morning) + 1 = 3 > 2
    await runOp(sup, 'host.booking.status', { id: x.id, status: 'cancelled', reason: 'test' });
    const again = await ev('Crossing 2', 611, 2, { room: 0 });
    expect(again.shortages).toEqual([]);
    const d = await host();
    expect(shortagesFor(d.bookings.find((b) => b.id === clash.id)!, d.needs.filter((n) => n.booking_id === clash.id), d)).toEqual([]);
  });

  it('a request for something not on the list is refused; reception sees the requests, never a price; deleting a booking removes them', async () => {
    const h = await halls();
    await expect(runOp(sup, 'host.booking.save', { kind: 'event', group_name: 'Bad', from_day: day(620), to_day: day(620), allocs: [{ room_id: h[0] }], needs: [{ equip_id: 9999, qty: 1 }] })).rejects.toThrow();
    const made = await ev('Seen', 621, 1, { room: 0 });
    const forDesk = await host(reception);
    expect(forDesk.needs.some((n) => n.booking_id === made.id)).toBe(true);
    expect(forDesk.prices).toBe(false);
    // reception may ask for equipment on a booking
    const byDesk = (await runOp(reception, 'host.booking.save', { kind: 'event', group_name: 'Desk event', people: 5, from_day: day(622), to_day: day(622), allocs: [{ room_id: h[0] }], needs: [{ equip_id: board, qty: 2 }] })) as { id: number };
    expect((await host()).needs.find((n) => n.booking_id === byDesk.id)).toMatchObject({ equip_id: board, qty: 2 });
    await runOp(sup, 'host.booking.delete', { id: byDesk.id });
    expect((await host()).needs.some((n) => n.booking_id === byDesk.id)).toBe(false);
  });

  it('arrived and left are for accommodation only: an event cannot be marked so; a stay can', async () => {
    const e = await ev('Event no arrival', 630, 0, { room: 0 });
    await runOp(sup, 'host.booking.status', { id: e.id, status: 'confirmed' });
    await expect(runOp(sup, 'host.booking.status', { id: e.id, status: 'arrived' })).rejects.toThrow();
    await expect(runOp(sup, 'host.booking.status', { id: e.id, status: 'left' })).rejects.toThrow();
    const stay = (await runOp(sup, 'host.booking.save', { kind: 'stay', group_name: 'Guests', people: 2, from_day: day(640), to_day: day(642), allocs: [{ room_id: r2 }], status: 'confirmed' })) as { id: number };
    await runOp(sup, 'host.booking.status', { id: stay.id, status: 'arrived' });
    await runOp(sup, 'host.booking.status', { id: stay.id, status: 'left' });
    expect((await host()).bookings.find((b) => b.id === stay.id)?.status).toBe('left');
  });
});

