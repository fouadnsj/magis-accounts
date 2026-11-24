// The MAGIS Calendar, step 1 (baseline 2.1): the rules (calendar.ts) and the operations (calops.ts) on a test database.
// Nothing here is real: invented names, invented dates in March 2027 (Monday 1 March 2027 is day 0).
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { migrate, splitSql, nowIso, type Db } from '../src/db/db';
import { MIGRATIONS } from '../src/db/migrations';
import { withImplied, type Perm } from '../src/perms';
import { addDays } from '../src/hosting/host';
import {
  calRights, calTotals, cancelMoney, checkCal, clashesOf, decide, forViewer, holdDate, holdPassed, matchName, occurrences, readOrgsSheet, readSpacesSheet, RESERVED, spacesOn, warningsOf,
  type CalBooking, type CalData, type CalDate, type World,
} from '../src/hosting/calendar';
import { spacesShown } from '../src/hosting/calview';
import { nodeDb } from './nodeDb';

const day = (n: number) => addDays('2027-03-01', n);
const today = () => nowIso().slice(0, 10);

// ------------------------------------------------------------------ the rules alone

const bk = (x: Partial<CalBooking> & { id: number }): CalBooking => ({
  code: `B${x.id}`, kind: 'event', status: 'confirmed', group_name: `G${x.id}`, contact: null, phone: null, people: 0, from_day: day(0), to_day: day(0), repeat_days: null,
  time_from: null, time_to: null, price_mode: null, rate: null, currency: 'USD', note: null, cancel_reason: null, source: 'desk', review: 0, client_ref: null, created_by: null,
  created_at: '2027-02-20T10:00:00.000Z', updated_at: null, origin: 'outside', activity_kind_id: null, leader: null, org_id: null, person_id: null, subject: null, private: 0,
  whole_centre: 0, outside_place: null, hold_until: null, price_state: 'unset', price_each: 0, cancel_money: null, kept_usd: null, kept_syp: null, cancelled_by: null, cancelled_at: null, ...x,
});
const chg = (x: Partial<CalDate> & { booking_id: number; day: string; action: CalDate['action'] }): CalDate => ({ id: 1, to_day: null, time_from: null, time_to: null, reason: 'r', taken: 0, undone: 0, who: null, at: 'x', ...x });
const spaces = [{ id: 1, active: 1 }, { id: 2, active: 1 }, { id: 3, active: 1 }, { id: 4, active: 0 }];
const W = (bookings: CalBooking[], allocs: [number, number][], dates: CalDate[] = [], closed: World['closed'] = []): World => ({ bookings, allocs: allocs.map(([b, r]) => ({ booking_id: b, room_id: r })), dates, spaces, closed });

describe('the dates of a booking', () => {
  const weekly = bk({ id: 1, from_day: day(0), to_day: day(21), repeat_days: '1', time_from: '17:00', time_to: '19:00' });
  it('every week on the chosen days, between two dates', () => {
    expect(occurrences(weekly).map((o) => o.day)).toEqual([day(0), day(7), day(14), day(21)]);
    expect(occurrences(weekly)[0]).toMatchObject({ from: 17 * 60, to: 19 * 60 });
  });
  it('one date cancelled, one moved (another day, other hours), this date and the following; an undone change no longer counts', () => {
    const dates = [chg({ booking_id: 1, day: day(7), action: 'cancel' }), chg({ booking_id: 1, day: day(14), action: 'move', to_day: day(16), time_from: '10:00', time_to: '12:00' })];
    expect(occurrences(weekly, dates).map((o) => [o.day, o.from, o.moved ?? null])).toEqual([[day(0), 1020, null], [day(16), 600, day(14)], [day(21), 1020, null]]);
    expect(occurrences(weekly, [chg({ booking_id: 1, day: day(14), action: 'cancel_from' })]).map((o) => o.day)).toEqual([day(0), day(7)]);
    expect(occurrences(weekly, [chg({ booking_id: 1, day: day(7), action: 'cancel', undone: 1 })]).length).toBe(4);
    // another booking's changes do not touch this one
    expect(occurrences(weekly, [chg({ booking_id: 2, day: day(7), action: 'cancel' })]).length).toBe(4);
  });
  it('a stay holds its nights, the whole day; a cancelled booking holds nothing', () => {
    expect(occurrences(bk({ id: 2, kind: 'stay', from_day: day(0), to_day: day(3) })).map((o) => [o.day, o.from, o.to])).toEqual([[day(0), 0, 1440], [day(1), 0, 1440], [day(2), 0, 1440]]);
    expect(occurrences(bk({ id: 3, status: 'cancelled' }))).toEqual([]);
  });
});

describe('a space is never given twice', () => {
  it('"to confirm" holds the space too; hours that do not cross do not clash', () => {
    const a = bk({ id: 1, status: 'option', time_from: '10:00', time_to: '12:00' });
    const w = W([a], [[1, 1]]);
    expect(clashesOf({ ...bk({ id: 9, time_from: '11:00', time_to: '13:00' }), spaces: [1] }, w).clashes).toHaveLength(1);
    expect(clashesOf({ ...bk({ id: 9, time_from: '12:00', time_to: '13:00' }), spaces: [1] }, w).clashes).toHaveLength(0);
    expect(clashesOf({ ...bk({ id: 9, time_from: '11:00', time_to: '13:00' }), spaces: [2] }, w).clashes).toHaveLength(0);
    // a whole day (no hours) meets any hours
    expect(clashesOf({ ...bk({ id: 9 }), spaces: [1] }, w).clashes).toHaveLength(1);
    // cancelled: the space is free again
    expect(clashesOf({ ...bk({ id: 9 }), spaces: [1] }, W([{ ...a, status: 'cancelled' }], [[1, 1]])).clashes).toHaveLength(0);
  });
  it('one group per bedroom: a second stay in the same room is refused even with beds left', () => {
    const w = W([bk({ id: 1, kind: 'stay', from_day: day(0), to_day: day(3) })], [[1, 1]]);
    expect(clashesOf({ ...bk({ id: 9, kind: 'stay', from_day: day(2), to_day: day(4) }), spaces: [1] }, w).clashes.map((c) => c.day)).toEqual([day(2)]);
    // leaving the morning another group arrives is fine
    expect(clashesOf({ ...bk({ id: 9, kind: 'stay', from_day: day(3), to_day: day(5) }), spaces: [1] }, w).clashes).toHaveLength(0);
  });
  it('the whole centre holds every space in use; an activity outside the centre holds none', () => {
    const fest = bk({ id: 1, origin: 'ours', whole_centre: 1, from_day: day(5), to_day: day(5) });
    const w = W([fest], []);
    expect(clashesOf({ ...bk({ id: 9, from_day: day(5), to_day: day(5) }), spaces: [3] }, w).clashes).toHaveLength(1);
    expect(clashesOf({ ...bk({ id: 9, from_day: day(5), to_day: day(5), origin: 'ours', outside_place: 'Al-Ard' }), spaces: [] }, w).clashes).toHaveLength(0);
    // the whole centre cannot be saved while anything holds a space (a switched-off space is not counted)
    const w2 = W([bk({ id: 2, from_day: day(5), to_day: day(5) })], [[2, 3]]);
    expect(clashesOf({ ...fest, id: 9, spaces: [] }, w2).clashes.map((c) => c.space_id)).toEqual([3]);
  });
  it('a space closed for repairs cannot be booked', () => {
    const closed = [{ id: 1, room_id: 2, from_day: day(0), to_day: day(10), reason: 'painting', cancelled: 0, cancel_reason: null, who: null, at: 'x' }];
    expect(clashesOf({ ...bk({ id: 9, from_day: day(4), to_day: day(4) }), spaces: [2] }, W([], [], [], closed)).shut).toHaveLength(1);
    expect(clashesOf({ ...bk({ id: 9, from_day: day(4), to_day: day(4) }), spaces: [2] }, W([], [], [], [{ ...closed[0], cancelled: 1 }])).shut).toHaveLength(0);
  });
  it('a weekly series where some dates are taken: refused, or saved without those dates, which are listed', () => {
    const w = W([bk({ id: 1, from_day: day(7), to_day: day(7), time_from: '18:00', time_to: '20:00' })], [[1, 1]]);
    const series = { ...bk({ id: 9, from_day: day(0), to_day: day(21), repeat_days: '1', time_from: '17:00', time_to: '19:00' }), spaces: [1] };
    const d = decide(series, w);
    expect(d).toMatchObject({ kind: 'taken', canSkip: true, dates: 4, takenDays: [day(7)] });
    expect(decide(series, w, true)).toEqual({ kind: 'ok', skip: [{ day: day(7), why: 'taken', with: [1] }] });
    // one date only: never "saved without"
    const single = { ...bk({ id: 9, from_day: day(7), to_day: day(7) }), spaces: [1] };
    expect(decide(single, w, true)).toMatchObject({ kind: 'taken', canSkip: false });
  });
});

describe('holds, warnings and money', () => {
  it('"to confirm" holds until the date written, or 7 days after it was made; then the date has passed (it is not freed)', () => {
    expect(holdDate(bk({ id: 1, status: 'option' }))).toBe('2027-02-27');
    expect(holdDate(bk({ id: 1, status: 'option', hold_until: day(2) }))).toBe(day(2));
    expect(holdPassed(bk({ id: 1, status: 'option' }), '2027-02-28')).toBe(true);
    expect(holdPassed(bk({ id: 1, status: 'confirmed' }), '2027-02-28')).toBe(false);
  });
  it('Sunday (an outside hall booking), a closed period, more people than the space holds, not enough equipment', () => {
    const w = {
      ...W([bk({ id: 1, from_day: day(6), to_day: day(6) })], [[1, 3]]),
      periods: [{ id: 1, name: 'August', from_day: day(5), to_day: day(9), cancelled: 0, cancel_reason: null, who: null, at: 'x' }],
      spacesFull: [{ id: 1, beds: 0, capacity: 20, kind: 'hall' as const, kind_id: 2 }],
      kinds: [{ id: 2, sleeps: 0 }],
      equip: [{ id: 1, total: 2 }],
      needs: [{ booking_id: 1, equip_id: 1, qty: 2 }],
    };
    const p = { ...bk({ id: 9, from_day: day(6), to_day: day(6), people: 30 }), spaces: [1] };
    expect(warningsOf(p, [{ equip_id: 1, qty: 1 }], w).map((x) => x.kind)).toEqual(['sunday', 'period', 'capacity', 'equipment']);
    // our own activity on a Sunday: no Sunday warning; a stay: never
    expect(warningsOf({ ...p, origin: 'ours', people: 10 }, [], w).map((x) => x.kind)).toEqual(['period']);
  });
  it('free, per person per night, for the whole booking, or each date of a repeating booking; services on top', () => {
    const stay = bk({ id: 1, kind: 'stay', from_day: day(0), to_day: day(3), people: 10, price_state: 'priced', price_mode: 'person', rate: 8 });
    expect(calTotals(stay, [{ amount: 50000, currency: 'SYP' }])).toEqual({ USD: 240, SYP: 50000 });
    expect(calTotals({ ...stay, price_state: 'free' }, [])).toEqual({ USD: 0, SYP: 0 });
    const weekly = bk({ id: 2, from_day: day(0), to_day: day(21), repeat_days: '1', price_state: 'priced', price_mode: 'group', rate: 20 });
    expect(calTotals(weekly, []).USD).toBe(20);
    expect(calTotals({ ...weekly, price_each: 1 }, []).USD).toBe(80);
    // a date cancelled is not paid
    expect(calTotals({ ...weekly, price_each: 1 }, [], [chg({ booking_id: 2, day: day(7), action: 'cancel' })]).USD).toBe(60);
  });
  it('cancelled after money was received: keep all, give all back, or keep a part', () => {
    const got = { USD: 100, SYP: 50000 };
    expect(cancelMoney(got, 'all')).toEqual({ kept: got, back: { USD: 0, SYP: 0 } });
    expect(cancelMoney(got, 'none')).toEqual({ kept: { USD: 0, SYP: 0 }, back: got });
    expect(cancelMoney(got, 'part', { USD: 30 })).toEqual({ kept: { USD: 30, SYP: 0 }, back: { USD: 70, SYP: 50000 } });
    expect(cancelMoney(got, 'part', { USD: 130 })).toBe('too_much');
    expect(cancelMoney(got, 'part', {})).toBe('no_part');
  });
});

describe('who sees what', () => {
  it('the rights: Team only looks; booking outside, the organisations and the arrivals bring the contacts', () => {
    expect(calRights(['cal.view'])).toMatchObject({ view: true, contacts: false, outside: false });
    expect(calRights(['cal.outside'])).toMatchObject({ view: true, contacts: true });
    expect(calRights(['book.own'])).toMatchObject({ view: false });
    expect(withImplied(['cal.arrive'] as Perm[]).sort()).toEqual(['cal.arrive', 'cal.contacts', 'cal.view']);
  });
  it('a private booking shows "Reserved" to the Team; no phone without the contacts, no amount without the prices', () => {
    const d = {
      bookings: [bk({ id: 1, private: 1, group_name: 'Family', contact: 'Person A', phone: '09', price_state: 'priced', price_mode: 'group', rate: 50 })],
      orgs: [{ id: 1 }], persons: [{ id: 1 }], lines: [{ id: 1, booking_id: 1, amount: 9, currency: 'USD', label: 'Lunch', qty: 1, service_id: null }], pays: [{ id: 1 }],
    } as unknown as CalData;
    const team = forViewer({ ...d, rights: calRights(['cal.view']) });
    expect(team.bookings[0]).toMatchObject({ group_name: RESERVED, contact: null, phone: null, rate: null });
    expect(team.orgs).toEqual([]);
    expect(team.pays).toEqual([]);
    expect(team.lines[0].amount).toBe(0);
    const reception = forViewer({ ...d, rights: calRights(['cal.view', 'cal.contacts', 'cal.outside']) });
    expect(reception.bookings[0]).toMatchObject({ group_name: 'Family', phone: '09', rate: null });
    const coord = forViewer({ ...d, rights: calRights(['cal.prices', 'cal.contacts']) });
    expect(coord.bookings[0].rate).toBe(50);
  });
  it('what is typed is checked', () => {
    const ok = { origin: 'outside' as const, kind: 'event' as const, group_name: 'X', from_day: day(0), to_day: day(0), repeat_days: null, time_from: '10:00', time_to: '12:00', people: 3, spaces: [1], whole_centre: false, outside_place: null, activity_kind_id: null, org_id: 1 };
    expect(checkCal(ok)).toBeNull();
    expect(checkCal({ ...ok, time_from: '12:00', time_to: '10:00' })).toBe('hours');
    expect(checkCal({ ...ok, spaces: [] })).toBe('space');
    expect(checkCal({ ...ok, whole_centre: true })).toBe('whole_ours');
    expect(checkCal({ ...ok, origin: 'ours', kind: 'stay', to_day: day(2), time_from: null, time_to: null })).toBe('ours_stay');
    expect(checkCal({ ...ok, origin: 'ours', activity_kind_id: null })).toBe('activity_kind');
    expect(checkCal({ ...ok, origin: 'ours', activity_kind_id: 1, spaces: [], outside_place: 'Al-Ard' })).toBeNull();
    expect(checkCal({ ...ok, kind: 'stay', to_day: day(2) })).toBe('stay_hours');
  });
});

describe('the Excel file of the spaces', () => {
  const kinds = [{ id: 1, name: 'Bedroom · غرفة نوم', sleeps: 1 }, { id: 2, name: 'Hall · قاعة', sleeps: 0 }, { id: 7, name: 'Kitchen · مطبخ', sleeps: 0 }];
  it('reads the sheet "Rooms": the example line is left out, a kind is matched in either language, problems are listed', () => {
    const rows = [
      ['Centre · المركز', 'Area · المنطقة', 'Floor · الطابق', 'Room name · اسم المكان', 'Kind · النوع', 'Capacity (people) · السعة', 'Beds · الأسرّة', 'Rentable · قابل للتأجير', 'Always in the room · التجهيزات الثابتة', 'Note · ملاحظة'],
      ['Homs', 'Example: Main building', 'Ground', 'Example: Hall 1', 'Hall · قاعة', 40, '', 'Yes', 'projector, 40 chairs', ''],
      ['Homs', 'Main', 'Ground', 'Hall A', 'Hall · قاعة', 40, '', 'Yes', 'projector', ''],
      ['Homs', 'Main', '1', 'Kitchen', 'مطبخ', '', '', 'لا', '', 'small'],
      ['Homs', 'Guest house', '1', 'Bedroom 1', 'bedroom', '', 3, '', '', ''],
      ['Homs', 'Guest house', '1', 'Bedroom 2', 'Garage', '', 3, '', '', ''],
      ['Homs', 'Main', 'Ground', 'Hall A', 'Hall', 10, '', '', '', ''],
    ];
    const r = readSpacesSheet(rows, kinds);
    expect(r.spaces.map((s) => [s.area, s.name, s.kind_id, s.capacity, s.beds, s.rentable])).toEqual([['Main', 'Hall A', 2, 40, 0, true], ['Main', 'Kitchen', 7, 0, 0, false], ['Guest house', 'Bedroom 1', 1, 0, 3, true]]);
    expect(r.spaces[2].rentableGiven).toBe(false);
    expect(r.problems).toEqual([{ row: 6, why: 'kind' }, { row: 7, why: 'twice' }]);
    expect(matchName(kinds, 'قاعة')?.id).toBe(2);
  });
  it('reads the sheet "Organisations" with two persons in charge', () => {
    const rows = [
      ['Organisation · الجهة', 'Kind · النوع', 'Person in charge · المسؤول', 'Phone · الهاتف', 'Second person · شخص آخر', 'Phone 2 · هاتف ٢', 'Note · ملاحظة'],
      ['Example: a parish', 'Church · كنيسة', 'Example: name', '09xxxxxxxx', '', '', 'pays on arrival'],
      ['Choir of the test', 'Association', 'Person A', '0911', 'Person B', '0922', ''],
    ];
    const r = readOrgsSheet(rows, [{ id: 3, name: 'Association · جمعية' }]);
    expect(r.orgs).toEqual([{ row: 3, name: 'Choir of the test', kind_id: 3, note: null, persons: [{ name: 'Person A', phone: '0911' }, { name: 'Person B', phone: '0922' }] }]);
  });
});

// ------------------------------------------------------------------ the operations on a test database

const store = new Map<string, Uint8Array>();
const files = { docWrite: async (r: string, b: Uint8Array) => { store.set(r, b); }, docRead: async (r: string) => store.get(r)!, docExists: async (r: string) => store.has(r) } as unknown as OpCtx['files'];
let db: Db;
let director: OpCtx, coordinator: OpCtx, reception: OpCtx, team: OpCtx;
const ctxOf = async (name: string): Promise<OpCtx> => {
  const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
  return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
};
const role = async (name: string, perms: string[]) => {
  await runOp(director, 'access.save', { name, perms });
  const access = (await db.query<{ id: number }>('SELECT id FROM access_profile WHERE name = ?', [name]))[0].id;
  await runOp(director, 'user.save', { name, access_id: access, books: [], pin: 'test123-pass' });
  return ctxOf(name);
};
const cal = async (c: OpCtx = director) => (await runOp(c, 'cal.get', undefined)) as CalData;
type Saved = { saved: boolean; id?: number; refused?: string; canSkip?: boolean; takenDays?: string[]; warnings?: { kind: string }[]; skipped?: { day: string }[]; clashes?: { name: string }[] };
const save = (c: OpCtx, a: Record<string, unknown>) => runOp(c, 'cal.booking.save', a) as Promise<Saved>;

let hallA = 0, hallB = 0, bed1 = 0, office = 0, org = 0, p1 = 0, p2 = 0, workshop = 0;

beforeAll(async () => {
  db = nodeDb();
  await createOffice(db, { organisation: 'Test centre', supName: 'Director', supPin: 'fouadsj-1', comName: 'Com', comPin: 'com-pass-1' });
  director = await ctxOf('Director');
  coordinator = await role('Coordinator', ['cal.view', 'cal.contacts', 'cal.programme', 'cal.outside', 'cal.orgs', 'cal.prices', 'cal.money']);
  reception = await role('Reception', ['cal.view', 'cal.contacts', 'cal.outside', 'cal.orgs', 'cal.arrive']);
  team = await role('Team', ['cal.view']);
}, 60000);

describe('step 1 on a test database', () => {
  it('the Superior has every calendar tick; the ticks of each role are as in the baseline', () => {
    expect(calRights(director.profile.perms)).toEqual({ view: true, contacts: true, programme: true, outside: true, orgs: true, arrive: true, prices: true, money: true, whole: true, setup: true, history: true });
    expect(calRights(reception.profile.perms)).toMatchObject({ outside: true, programme: false, prices: false, arrive: true });
    expect(calRights(team.profile.perms)).toMatchObject({ view: true, contacts: false, outside: false });
  });

  it('areas, spaces, kinds and categories; only the Director sets them up', async () => {
    const d = await cal();
    expect(d.categories.map((c) => c.name)).toEqual(['Halls · القاعات', 'Rooms · الغرف']);
    expect(d.activityKinds.map((k) => k.name.split(' · ')[0])).toEqual(['Workshop', 'Course', 'Club', 'Training', 'Event', 'Christian education', 'Prayer groups']);
    expect(d.orgKinds).toHaveLength(8);
    const kindId = (n: string) => d.kinds.find((k) => k.name.startsWith(n))!.id;
    workshop = d.activityKinds[0].id;
    await expect(runOp(coordinator, 'cal.area.save', { name: 'Main' })).rejects.toThrow();
    const main = (await runOp(director, 'cal.area.save', { name: 'Main', color: '#378add' })) as { id: number };
    const guest = (await runOp(director, 'cal.area.save', { name: 'Guest house' })) as { id: number };
    hallA = ((await runOp(director, 'cal.space.save', { building_id: main.id, name: 'Hall A', kind_id: kindId('Hall'), capacity: 20, fixed: 'projector', floor: 'Ground' })) as { id: number }).id;
    hallB = ((await runOp(director, 'cal.space.save', { building_id: main.id, name: 'Hall B', kind_id: kindId('Hall'), capacity: 30 })) as { id: number }).id;
    office = ((await runOp(director, 'cal.space.save', { building_id: main.id, name: 'Office', kind_id: kindId('Office'), rentable: false })) as { id: number }).id;
    bed1 = ((await runOp(director, 'cal.space.save', { building_id: guest.id, name: 'Bedroom 1', kind_id: kindId('Bedroom'), beds: 3 })) as { id: number }).id;
    // a new category (Playground) with a kind in it
    const pg = (await runOp(director, 'cal.category.save', { name: 'Playground · ملعب' })) as { id: number };
    await runOp(director, 'cal.kind.save', { name: 'Football · كرة قدم', sleeps: false, category_id: pg.id });
    const d2 = await cal();
    expect(d2.kinds.find((k) => k.name.startsWith('Football'))?.category_id).toBe(pg.id);
    expect(d2.spaces.find((s) => s.id === hallA)).toMatchObject({ capacity: 20, fixed: 'projector', floor: 'Ground', rentable: 1 });
    expect(d2.spaces.find((s) => s.id === office)?.rentable).toBe(0);
    // the space stays a place of the inventory
    expect((await db.query<{ name: string }>('SELECT name FROM inv_place')).map((p) => p.name)).toContain('Main · Hall A');
  });

  it('organisations with several persons in charge; the person is chosen for each booking and the phone comes by itself', async () => {
    await expect(runOp(team, 'cal.org.save', { name: 'Test choir' })).rejects.toThrow();
    org = ((await runOp(reception, 'cal.org.save', { name: 'Test choir', kind_id: 3, note: 'pays each month', persons: [{ name: 'Person A', phone: '0911' }, { name: 'Person B', phone: '0922' }] })) as { id: number }).id;
    const d = await cal(reception);
    [p1, p2] = d.persons.filter((p) => p.org_id === org).map((p) => p.id);
    // a person is never removed, only switched off
    await runOp(reception, 'cal.org.save', { id: org, name: 'Test choir', kind_id: 3, persons: [{ id: p1, name: 'Person A', phone: '0911', active: false }] });
    expect((await cal()).persons.filter((p) => p.org_id === org).map((p) => p.active)).toEqual([0, 1]);
    const r = await save(reception, { origin: 'outside', org_id: org, person_id: p2, people: 15, from_day: day(1), time_from: '10:00', time_to: '12:00', spaces: [hallA] });
    expect(r.saved).toBe(true);
    const b = (await cal()).bookings.find((x) => x.id === r.id)!;
    expect(b).toMatchObject({ group_name: 'Test choir', contact: 'Person B', phone: '0922', status: 'option', price_state: 'unset', origin: 'outside' });
    // "to confirm" holds 7 days by default
    expect(b.hold_until).toBe(addDays(today(), 7));
  });

  it('the never-twice rule: the second booking cannot be saved, whichever it is; other hours or another space are fine', async () => {
    const r = await save(coordinator, { origin: 'ours', title: 'English course', activity_kind_id: workshop, leader: 'Tutor A', people: 10, from_day: day(1), time_from: '11:00', time_to: '13:00', spaces: [hallA] });
    expect(r).toMatchObject({ saved: false, refused: 'taken', canSkip: false });
    expect(r.clashes?.[0].name).toBe('Test choir');
    expect((await save(coordinator, { origin: 'ours', title: 'English course', activity_kind_id: workshop, people: 10, from_day: day(1), time_from: '12:00', time_to: '13:00', spaces: [hallA] })).saved).toBe(true);
    expect((await save(coordinator, { origin: 'ours', title: 'Club', activity_kind_id: workshop, people: 10, from_day: day(1), time_from: '10:00', time_to: '12:00', spaces: [hallB] })).saved).toBe(true);
    // Reception does not change our programme; the Team changes nothing
    await expect(save(reception, { origin: 'ours', title: 'X', activity_kind_id: workshop, from_day: day(2), spaces: [hallB] })).rejects.toThrow();
    await expect(save(team, { origin: 'outside', org_id: org, from_day: day(2), spaces: [hallB] })).rejects.toThrow();
  });

  it('a weekly series where one date is taken is saved without it, and that date is listed and kept', async () => {
    const a = { origin: 'outside', org_id: org, person_id: p2, people: 12, from_day: day(0), to_day: day(21), repeat_days: [1], time_from: '17:00', time_to: '19:00', spaces: [hallB] };
    // a booking of ours already holds Hall B on Monday 8 March
    expect((await save(director, { origin: 'ours', title: 'Training day', activity_kind_id: workshop, from_day: day(7), spaces: [hallB] })).saved).toBe(true);
    const first = await save(reception, a);
    expect(first).toMatchObject({ saved: false, refused: 'taken', canSkip: true, takenDays: [day(7)] });
    const r = await save(reception, { ...a, without_taken: true });
    expect(r.saved).toBe(true);
    expect(r.skipped?.map((s) => s.day)).toEqual([day(7)]);
    const d = await cal();
    const b = d.bookings.find((x) => x.id === r.id)!;
    expect(occurrences(b, d.dates).map((o) => o.day)).toEqual([day(0), day(14), day(21)]);
    expect(d.dates.find((x) => x.booking_id === r.id)).toMatchObject({ day: day(7), action: 'cancel', taken: 1, reason: 'taken' });
  });

  it('one date moved or cancelled with a reason, "this date and the following", and put back', async () => {
    const r = await save(coordinator, { origin: 'ours', title: 'Prayer group', activity_kind_id: workshop, from_day: day(2), to_day: day(23), repeat_days: [3], time_from: '18:00', time_to: '19:00', spaces: [hallA] });
    const id = r.id!;
    await expect(runOp(coordinator, 'cal.date.change', { booking_id: id, day: day(9), action: 'cancel' })).rejects.toThrow(/reason/);
    expect(await runOp(coordinator, 'cal.date.change', { booking_id: id, day: day(9), action: 'cancel', reason: 'Feast' })).toEqual({ ok: true });
    // moved onto the choir's hours on day 1 (10:00–12:00): refused; to another day: fine
    expect(await runOp(coordinator, 'cal.date.change', { booking_id: id, day: day(16), action: 'move', to_day: day(1), time_from: '10:00', time_to: '11:00', reason: 'x' })).toMatchObject({ ok: false, refused: 'taken' });
    expect(await runOp(coordinator, 'cal.date.change', { booking_id: id, day: day(16), action: 'move', to_day: day(17), reason: 'The leader is away' })).toEqual({ ok: true });
    await runOp(coordinator, 'cal.date.change', { booking_id: id, day: day(23), action: 'cancel_from', reason: 'End of the year' });
    let d = await cal();
    expect(occurrences(d.bookings.find((x) => x.id === id)!, d.dates).map((o) => o.day)).toEqual([day(2), day(17)]);
    // put back the cancelled date
    const c = d.dates.find((x) => x.booking_id === id && x.day === day(9))!;
    expect(await runOp(coordinator, 'cal.date.undo', { id: c.id })).toEqual({ ok: true });
    d = await cal();
    expect(occurrences(d.bookings.find((x) => x.id === id)!, d.dates).map((o) => o.day)).toEqual([day(2), day(9), day(17)]);
    expect(d.dates.find((x) => x.id === c.id)?.undone).toBe(1);
  });

  it('a space closed for repairs cannot be booked; closing over bookings lists them first', async () => {
    await expect(runOp(coordinator, 'cal.space.close', { room_id: hallA, from_day: day(30), to_day: day(40), reason: 'painting' })).rejects.toThrow();
    expect(await runOp(director, 'cal.space.close', { room_id: hallA, from_day: day(30), to_day: day(40), reason: 'Painting' })).toMatchObject({ saved: true });
    const r = await save(reception, { origin: 'outside', org_id: org, from_day: day(32), time_from: '10:00', time_to: '11:00', spaces: [hallA] });
    expect(r).toMatchObject({ saved: false, refused: 'taken' });
    const over = (await runOp(director, 'cal.space.close', { room_id: hallB, from_day: day(14), to_day: day(14), reason: 'Leak' })) as { saved: boolean; bookings: { name: string }[] };
    expect(over.saved).toBe(false);
    expect(over.bookings.map((b) => b.name)).toEqual(['Test choir']);
    // reopened (the closing is kept, cancelled with a reason)
    const cl = (await cal()).closed.find((x) => x.room_id === hallA)!;
    await runOp(director, 'cal.space.reopen', { id: cl.id, reason: 'Finished early' });
    expect((await save(reception, { origin: 'outside', org_id: org, from_day: day(32), time_from: '10:00', time_to: '11:00', spaces: [hallA] })).saved).toBe(true);
  });

  it('a closed period and Sunday are warnings: saving stays possible', async () => {
    await runOp(director, 'cal.period.save', { name: 'Summer · الصيف', from_day: day(150), to_day: day(180) });
    const a = { origin: 'outside', org_id: org, people: 5, from_day: day(153), time_from: '10:00', time_to: '11:00', spaces: [hallB] }; // day 153 is a Sunday
    const r = await save(reception, a);
    expect(r.saved).toBe(false);
    expect(r.warnings?.map((w) => w.kind)).toEqual(['sunday', 'period']);
    expect((await save(reception, { ...a, force: true })).saved).toBe(true);
  });

  it('a space that cannot be booked (a store, an office) is only in the inventory: never booked, never held by the whole centre', async () => {
    const d = await cal();
    const main = d.spaces.find((x) => x.id === hallA)!.building_id;
    const store = ((await runOp(director, 'cal.space.save', { building_id: main, name: 'Store', kind_id: d.kinds.find((k) => k.name.startsWith('Other'))!.id, bookable: false })) as { id: number }).id;
    expect((await cal()).spaces.find((x) => x.id === store)).toMatchObject({ bookable: 0, active: 1 });
    await expect(save(coordinator, { origin: 'ours', title: 'Sorting', activity_kind_id: workshop, from_day: day(45), spaces: [store] })).rejects.toThrow(/only in the inventory/);
    // the whole centre does not hold it
    const w = (await cal()).spaces;
    expect(spacesOn({ id: 0, whole_centre: 1 }, day(45), { allocs: [], spaces: w, closed: [] })).not.toContain(store);
    // a space with bookings to come stays bookable until they are moved or cancelled
    await expect(runOp(director, 'cal.space.save', { id: hallB, building_id: main, name: 'Hall B', kind_id: d.spaces.find((x) => x.id === hallB)!.kind_id, capacity: 30, bookable: false })).rejects.toThrow(/bookings to come/);
    // ticked again: it can be booked
    await runOp(director, 'cal.space.save', { id: store, building_id: main, name: 'Store', kind_id: d.kinds.find((k) => k.name.startsWith('Other'))!.id, bookable: true });
    expect((await save(coordinator, { origin: 'ours', title: 'Sorting', activity_kind_id: workshop, from_day: day(45), spaces: [store] })).saved).toBe(true);
  });

  it('an outside group only in rentable spaces; a stay only in bedrooms', async () => {
    await expect(save(reception, { origin: 'outside', org_id: org, from_day: day(50), spaces: [office] })).rejects.toThrow(/rentable/);
    await expect(save(reception, { origin: 'outside', kind: 'stay', org_id: org, from_day: day(50), to_day: day(52), spaces: [hallB] })).rejects.toThrow(/bedroom/);
    expect((await save(coordinator, { origin: 'ours', title: 'Team meeting', activity_kind_id: workshop, from_day: day(50), spaces: [office] })).saved).toBe(true);
  });

  it('the whole centre: by the Director only, never over a booking; an activity outside the centre has no space', async () => {
    const fest = { origin: 'ours', whole_centre: true, title: 'Christmas festival', activity_kind_id: workshop, people: 300, from_day: day(60), to_day: day(60) };
    await expect(save(coordinator, fest)).rejects.toThrow();
    expect((await save(director, fest)).saved).toBe(true);
    expect(await save(reception, { origin: 'outside', org_id: org, from_day: day(60), time_from: '10:00', time_to: '11:00', spaces: [hallB] })).toMatchObject({ saved: false, refused: 'taken' });
    expect((await save(coordinator, { origin: 'ours', title: 'Camp at Al-Ard', activity_kind_id: workshop, outside_place: 'Al-Ard', from_day: day(59), to_day: day(61) })).saved).toBe(true);
    expect(await save(director, { ...fest, title: 'Another', from_day: day(1), to_day: day(1) })).toMatchObject({ saved: false, refused: 'taken' });
  });

  it('the free tick (ticked by default), a price, every change of price kept; Reception keeps "price not set" and never sees the amounts', async () => {
    const r = await save(coordinator, { origin: 'outside', org_id: org, people: 10, from_day: day(70), time_from: '09:00', time_to: '12:00', spaces: [hallA] });
    let b = (await cal()).bookings.find((x) => x.id === r.id)!;
    expect(b.price_state).toBe('free');
    const priced = { id: r.id, origin: 'outside', org_id: org, people: 10, from_day: day(70), time_from: '09:00', time_to: '12:00', spaces: [hallA], free: false, price_mode: 'group', rate: 40, currency: 'USD', lines: [{ label: 'Coffee break', qty: 10, amount: 30, currency: 'USD' }] };
    await save(coordinator, priced);
    await expect(save(coordinator, { ...priced, rate: null })).rejects.toThrow(/free/);
    b = (await cal()).bookings.find((x) => x.id === r.id)!;
    expect(b).toMatchObject({ price_state: 'priced', rate: 40, price_mode: 'group' });
    // Reception changes the note: the price stays, and Reception sees no amount
    await save(reception, { id: r.id, origin: 'outside', org_id: org, people: 12, from_day: day(70), time_from: '09:00', time_to: '12:00', spaces: [hallA], note: 'twelve now', free: true, rate: 1, lines: [{ id: (await cal()).lines.find((l) => l.booking_id === r.id)!.id, label: 'Coffee break', qty: 12, amount: 999 }] });
    const seen = (await cal(reception)).bookings.find((x) => x.id === r.id)!;
    expect(seen.rate).toBeNull();
    b = (await cal()).bookings.find((x) => x.id === r.id)!;
    expect(b).toMatchObject({ price_state: 'priced', rate: 40, people: 12 });
    expect((await cal()).lines.find((l) => l.booking_id === r.id)?.amount).toBe(30);
    const hist = (await runOp(director, 'cal.history', { booking_id: r.id })) as { prices: { price_state: string; rate: number | null }[]; changes: unknown[] };
    expect(hist.prices.map((p) => [p.price_state, p.rate])).toEqual([['free', null], ['priced', 40]]);
    expect(hist.changes.length).toBeGreaterThanOrEqual(3);
    await expect(runOp(coordinator, 'cal.history', { booking_id: r.id })).rejects.toThrow();
  });

  it('a private booking shows "Reserved" to the Team, with no phone', async () => {
    const r = await save(reception, { origin: 'outside', org_id: org, person_id: p2, private: true, from_day: day(80), time_from: '15:00', time_to: '17:00', spaces: [hallB] });
    const t = (await cal(team)).bookings.find((x) => x.id === r.id)!;
    expect(t).toMatchObject({ group_name: RESERVED, phone: null, contact: null });
    expect((await cal(team)).orgs).toEqual([]);
    expect((await cal(reception)).bookings.find((x) => x.id === r.id)?.group_name).toBe('Test choir');
  });

  it('confirm, arrived and left (a guest stay, Reception and Director); cancelled with a reason and a part kept', async () => {
    const r = await save(reception, { origin: 'outside', kind: 'stay', org_id: org, people: 3, from_day: day(90), to_day: day(92), spaces: [bed1] });
    expect(r.saved).toBe(true);
    expect(await save(reception, { origin: 'outside', kind: 'stay', org_id: org, people: 1, from_day: day(91), to_day: day(93), spaces: [bed1] })).toMatchObject({ saved: false, refused: 'taken' });
    await runOp(reception, 'cal.booking.status', { id: r.id, status: 'confirmed' });
    await expect(runOp(coordinator, 'cal.booking.status', { id: r.id, status: 'arrived' })).rejects.toThrow();
    await runOp(reception, 'cal.booking.status', { id: r.id, status: 'arrived' });
    // an advance was received (0.12 payments, still the hosting tick)
    await runOp(director, 'host.pay.add', { booking_id: r.id, amount: 100, currency: 'USD' });
    await expect(runOp(reception, 'cal.booking.cancel', { id: r.id, reason: '' })).rejects.toThrow(/reason/);
    await expect(runOp(reception, 'cal.booking.cancel', { id: r.id, reason: 'Left early', money: 'part', kept_usd: 30 })).rejects.toThrow();
    const c = (await runOp(reception, 'cal.booking.cancel', { id: r.id, reason: 'Left early' })) as { toDecide: boolean };
    expect(c.toDecide).toBe(true);
    await expect(runOp(coordinator, 'cal.booking.money', { id: r.id, money: 'part', kept_usd: 130 })).rejects.toThrow(/more/);
    await runOp(coordinator, 'cal.booking.money', { id: r.id, money: 'part', kept_usd: 30 });
    const b = (await cal()).bookings.find((x) => x.id === r.id)!;
    expect(b).toMatchObject({ status: 'cancelled', cancel_reason: 'Left early', cancel_money: 'part', kept_usd: 30, kept_syp: 0 });
    // nothing is deleted; the room is free again
    expect((await save(reception, { origin: 'outside', kind: 'stay', org_id: org, people: 1, from_day: day(91), to_day: day(93), spaces: [bed1] })).saved).toBe(true);
    // the cancelled booking cannot come back over the new one
    expect(await runOp(reception, 'cal.booking.status', { id: r.id, status: 'option' })).toMatchObject({ ok: false, refused: 'taken' });
  });

  it('the spaces and organisations from the Excel file: first what would be added, then added; what exists is left alone', async () => {
    const rows = [
      ['Centre · المركز', 'Area · المنطقة', 'Floor · الطابق', 'Room name · اسم المكان', 'Kind · النوع', 'Capacity (people) · السعة', 'Beds · الأسرّة', 'Rentable · قابل للتأجير', 'Always in the room · التجهيزات الثابتة', 'Note · ملاحظة'],
      ['Test', 'Main', 'Ground', 'Hall A', 'Hall', 20, '', 'Yes', '', ''],
      ['Test', 'Annex', '1', 'Library', 'Library · مكتبة', 25, '', 'No', 'books', ''],
    ];
    const dry = (await runOp(director, 'cal.import.spaces', { rows, dry: true })) as { areas: string[]; add: { name: string }[]; there: { name: string }[]; done: boolean };
    expect(dry).toMatchObject({ areas: ['Annex'], done: false });
    expect(dry.add.map((s) => s.name)).toEqual(['Library']);
    expect(dry.there.map((s) => s.name)).toEqual(['Hall A']);
    expect((await cal()).spaces.some((s) => s.name === 'Library')).toBe(false);
    await runOp(director, 'cal.import.spaces', { rows });
    expect((await cal()).spaces.find((s) => s.name === 'Library')).toMatchObject({ rentable: 0, capacity: 25, fixed: 'books' });
    const orgRows = [['Organisation · الجهة', 'Kind · النوع', 'Person in charge · المسؤول', 'Phone · الهاتف'], ['Test choir', '', 'X', ''], ['Test school', 'School', 'Person C', '0933']];
    const o = (await runOp(reception, 'cal.import.orgs', { rows: orgRows })) as { add: { name: string }[]; there: { name: string }[] };
    expect(o.add.map((x) => x.name)).toEqual(['Test school']);
    expect(o.there.map((x) => x.name)).toEqual(['Test choir']);
  });
});

describe('step 3: the windows (services, price, organisations) on the test database', () => {
  it('the lists of services and equipment are kept by the Director', async () => {
    await expect(runOp(coordinator, 'cal.service.save', { name: 'Coffee break · استراحة قهوة' })).rejects.toThrow();
    const sv = (await runOp(director, 'cal.service.save', { name: 'Coffee break · استراحة قهوة' })) as { id: number };
    expect((await cal()).services.find((x) => x.id === sv.id)?.active).toBe(1);
    await expect(runOp(reception, 'cal.equip.options', undefined)).rejects.toThrow();
  });
  it('Reception books with services (how many), never an amount; the Coordinator sets the amounts and a price for each date', async () => {
    const sv = (await cal()).services.find((x) => x.name.startsWith('Coffee break'))!;
    const a = { origin: 'outside', org_id: org, people: 20, from_day: day(196), to_day: day(198), time_from: '09:00', time_to: '12:00', spaces: [hallB] };
    const r = await save(reception, { ...a, lines: [{ service_id: sv.id, qty: 20, amount: 500 }], free: false, rate: 99 }); // Monday to Wednesday
    expect(r.saved).toBe(true);
    let b = (await cal()).bookings.find((x) => x.id === r.id)!;
    expect(b.price_state).toBe('unset');
    let line = (await cal()).lines.find((l) => l.booking_id === r.id)!;
    expect([line.label, line.qty, line.amount]).toEqual([sv.name, 20, 0]);
    // the Coordinator: 30 USD for each of the three dates, and the coffee break 40 USD
    await save(coordinator, { ...a, id: r.id, free: false, price_mode: 'group', price_each: true, rate: 30, currency: 'USD', lines: [{ id: line.id, service_id: sv.id, qty: 20, amount: 40, currency: 'USD' }] });
    b = (await cal()).bookings.find((x) => x.id === r.id)!;
    line = (await cal()).lines.find((l) => l.booking_id === r.id)!;
    expect([b.price_state, b.price_mode, b.price_each, b.rate, line.amount]).toEqual(['priced', 'group', 1, 30, 40]);
    const d = await cal();
    expect(calTotals(b, d.lines.filter((l) => l.booking_id === b.id), d.dates)).toEqual({ USD: 130, SYP: 0 });
    // one day only: "each date" is not kept
    await save(coordinator, { ...a, id: r.id, to_day: day(196), free: false, price_mode: 'group', price_each: true, rate: 30, currency: 'USD', lines: [{ id: line.id, service_id: sv.id, qty: 20, amount: 40, currency: 'USD' }] });
    expect((await cal()).bookings.find((x) => x.id === r.id)?.price_each).toBe(0);
  });
  it('an organisation with several persons: a person changed or switched off, never removed; the booking keeps its person', async () => {
    const o = (await runOp(coordinator, 'cal.org.save', { name: 'Test parish', kind_id: 2, persons: [{ name: 'Person D', phone: '0944' }, { name: 'Person E', phone: '0955' }] })) as { id: number };
    const ps = (await cal()).persons.filter((p) => p.org_id === o.id);
    await runOp(coordinator, 'cal.org.save', { id: o.id, name: 'Test parish', kind_id: 2, note: 'Sunday mornings', persons: [{ id: ps[0].id, name: 'Person D', phone: '0944 000', active: true }, { id: ps[1].id, name: 'Person E', phone: '0955', active: false }, { name: 'Person F', phone: '0966' }] });
    const after = (await cal()).persons.filter((p) => p.org_id === o.id);
    expect(after.map((p) => [p.name, p.phone, p.active])).toEqual([['Person D', '0944 000', 1], ['Person E', '0955', 0], ['Person F', '0966', 1]]);
    await expect(runOp(team, 'cal.org.save', { name: 'X' })).rejects.toThrow();
  });
});

describe("Fouad's first test: a kind with no category, the starting kind Store", () => {
  it('the kind Store has no category; a kind may be saved with no category; its spaces are never in a quick view', async () => {
    let d = await cal();
    const store = d.kinds.find((k) => k.code === 'store')!;
    expect([store.name, store.category_id, store.sleeps]).toEqual(['Store · مستودع', null, 0]);
    expect(d.kinds.filter((k) => /store|مستودع/i.test(k.name))).toHaveLength(1);
    // a new kind with no category, and one where the category is left out (the usual one: Halls)
    const none = (await runOp(director, 'cal.kind.save', { name: 'Storage room · غرفة تخزين', sleeps: false, category_id: null })) as { id: number };
    const usual = (await runOp(director, 'cal.kind.save', { name: 'Studio · استوديو', sleeps: false })) as { id: number };
    d = await cal();
    expect(d.kinds.find((k) => k.id === none.id)?.category_id).toBeNull();
    expect(d.kinds.find((k) => k.id === usual.id)?.category_id).toBe(1);
    // a kind put back in a category, then out again
    await runOp(director, 'cal.kind.save', { id: none.id, name: 'Storage room · غرفة تخزين', sleeps: false, category_id: 1 });
    expect((await cal()).kinds.find((k) => k.id === none.id)?.category_id).toBe(1);
    await runOp(director, 'cal.kind.save', { id: none.id, name: 'Storage room · غرفة تخزين', sleeps: false, category_id: null });
    // a store space (even one that can be booked) is not in the Halls quick view; "Everything" shows a space that can be booked
    const area = d.areas[0].id;
    const sp = ((await runOp(director, 'cal.space.save', { building_id: area, name: 'Store by the hall', kind_id: store.id, bookable: true })) as { id: number }).id;
    d = await cal();
    expect(spacesShown(d, 1, null).some((x) => x.id === sp)).toBe(false);
    expect(spacesShown(d, null, null).some((x) => x.id === sp)).toBe(true);
    await runOp(director, 'cal.space.save', { id: sp, building_id: area, name: 'Store by the hall', kind_id: store.id, bookable: false });
    expect(spacesShown(await cal(), null, null).some((x) => x.id === sp)).toBe(false);
  });
});

describe('migration 72: the starting kind Store', () => {
  const upTo71 = async () => {
    const db = nodeDb();
    await db.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
    for (const mg of MIGRATIONS.filter((x) => x.n <= 71)) await db.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
    return db;
  };
  it('a centre without one gets "Store · مستودع" with no category', async () => {
    const db = await upTo71();
    expect(await migrate(db)).toEqual([72, 73, 74, 75, 76, 77, 78]);
    expect(await db.query("SELECT name, category_id, code, active FROM host_kind WHERE code = 'store'")).toEqual([{ name: 'Store · مستودع', category_id: null, code: 'store', active: 1 }]);
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM host_kind WHERE category_id IS NULL'))[0].n).toBe(1);
  });
  it('a kind "Store" typed by hand (in Halls) is used, its category taken away, no second kind; its spaces stay', async () => {
    const db = await upTo71();
    await db.batch([
      { sql: "INSERT INTO host_kind (id, name, sleeps, sort, category_id) VALUES (40, 'Store', 0, 12, 1)" },
      { sql: "INSERT INTO host_building (id, name) VALUES (1, 'Main')" },
      { sql: "INSERT INTO host_room (id, building_id, name, beds, kind, kind_id, bookable) VALUES (1, 1, 'Store 1', 0, 'other', 40, 0)" },
    ]);
    expect(await migrate(db)).toEqual([72, 73, 74, 75, 76, 77, 78]);
    expect(await db.query("SELECT id, name, category_id, code FROM host_kind WHERE code = 'store' OR name LIKE '%Store%'")).toEqual([{ id: 40, name: 'Store', category_id: null, code: 'store' }]);
    expect(await db.query('SELECT kind_id, bookable FROM host_room WHERE id = 1')).toEqual([{ kind_id: 40, bookable: 0 }]);
  });
});

// ------------------------------------------------------------------ the 0.12 data carried over

describe('migrations 64–67 on a 0.12 database', () => {
  it('the rooms, bookings, services, payments and ticks of 0.12 stay as they were; the new columns are filled', async () => {
    const old = nodeDb();
    await old.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
    for (const mg of MIGRATIONS.filter((x) => x.n <= 63)) await old.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
    await old.batch([
      { sql: "INSERT INTO access_profile (name, perms, sort) VALUES ('Desk', '[\"hosting.book\",\"hosting.view\"]', 9), ('Prices', '[\"hosting.prices\",\"hosting.book\",\"hosting.view\"]', 10)" },
      { sql: "INSERT INTO host_building (id, name) VALUES (1, 'Guest house')" },
      { sql: "INSERT INTO host_room (id, building_id, name, beds, kind, kind_id) VALUES (1, 1, 'Room 1', 4, 'bedroom', 1), (2, 1, 'Hall', 0, 'hall', 2)" },
      { sql: "INSERT INTO host_booking (id, code, kind, status, group_name, people, from_day, to_day, price_mode, rate, currency, created_at) VALUES (1, 'HB-2026-0001', 'stay', 'confirmed', 'Scouts', 4, '2026-12-01', '2026-12-03', 'person', 10, 'USD', '2026-11-22T10:00:00Z'), (2, 'HB-2026-0002', 'event', 'option', 'Choir', 20, '2026-12-01', '2026-12-29', NULL, NULL, 'USD', '2026-11-22T10:00:00Z')" },
      { sql: "UPDATE host_booking SET repeat_days = '2', time_from = '18:00', time_to = '20:00' WHERE id = 2" },
      { sql: 'INSERT INTO host_alloc (booking_id, room_id, beds) VALUES (1, 1, NULL), (2, 2, NULL)' },
      { sql: "INSERT INTO host_line (id, booking_id, label, qty, amount, currency) VALUES (1, 1, 'Dinner', 4, 20, 'USD')" },
      { sql: "INSERT INTO host_pay (booking_id, amount, currency, paid_on, receipt_no, at) VALUES (1, 40, 'USD', '2026-12-01', 'H2026-0001', 'x')" },
    ]);
    const before = await old.query('SELECT id, code, kind, status, group_name, people, from_day, to_day, repeat_days, time_from, time_to, price_mode, rate, currency FROM host_booking ORDER BY id');
    expect(await migrate(old)).toEqual([64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78]);
    expect(await old.query('SELECT id, code, kind, status, group_name, people, from_day, to_day, repeat_days, time_from, time_to, price_mode, rate, currency FROM host_booking ORDER BY id')).toEqual(before);
    expect(await old.query('SELECT id, origin, price_state, private, whole_centre, hold_until FROM host_booking ORDER BY id')).toEqual([
      { id: 1, origin: 'outside', price_state: 'priced', private: 0, whole_centre: 0, hold_until: null },
      { id: 2, origin: 'outside', price_state: 'unset', private: 0, whole_centre: 0, hold_until: null },
    ]);
    expect((await old.query<{ n: number }>('SELECT COUNT(*) AS n FROM host_pay'))[0].n).toBe(1);
    expect((await old.query<{ n: number }>('SELECT COUNT(*) AS n FROM host_line'))[0].n).toBe(1);
    expect(await old.query('SELECT booking_id, price_state, price_mode, rate FROM cal_price_hist')).toEqual([{ booking_id: 1, price_state: 'priced', price_mode: 'person', rate: 10 }]);
    expect(await old.query('SELECT id, rentable, bookable, category_id FROM host_room ORDER BY id')).toEqual([{ id: 1, rentable: 1, bookable: 1, category_id: null }, { id: 2, rentable: 1, bookable: 1, category_id: null }]);
    const ticks = async (name: string | number) => (JSON.parse((await old.query<{ perms: string }>(`SELECT perms FROM access_profile WHERE ${typeof name === 'number' ? 'id' : 'name'} = ?`, [name]))[0].perms) as string[]).filter((p) => p.startsWith('cal.')).sort();
    expect(await ticks('Desk')).toEqual(['cal.arrive', 'cal.contacts', 'cal.orgs', 'cal.outside', 'cal.view']);
    expect(await ticks('Prices')).toEqual(['cal.arrive', 'cal.contacts', 'cal.money', 'cal.orgs', 'cal.outside', 'cal.prices', 'cal.view']);
    expect((await ticks(1)).length).toBe(11); // the Superior
    expect(await ticks(3)).toEqual([]); // a book holder
    // the Accountant kept the 0.12 calendar, but the calendar has no accountant role: it only sees (update 67)
    expect(await ticks(2)).toEqual(['cal.view']);
    expect(JSON.parse((await old.query<{ perms: string }>('SELECT perms FROM access_profile WHERE id = 2'))[0].perms)).toContain('hosting.keep');
    // the 0.12 weekly event keeps its dates in the new rules
    const b = (await old.query<CalBooking>('SELECT * FROM host_booking WHERE id = 2'))[0];
    expect(occurrences(b).map((o) => o.day)).toEqual(['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22', '2026-12-29']);
  });
});
