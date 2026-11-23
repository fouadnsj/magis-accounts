// Accommodation and events (Fouad, 22 November 2026): the buildings and rooms of a centre (Al-Ard is a farm with guest
// houses), a booking per group, and a calendar of rooms by day. The pure rules live here (days, conflicts, prices,
// numbers); the operations are in ops.ts, the screens in ui/Hosting.tsx and the phone's copy in phone/.
//
// The rules Fouad gave:
//  - a booking is "to confirm" (option), confirmed, arrived, left, or cancelled;
//  - a stay is priced per person per night (usual) or as a fixed price for the group; services (meals, breaks,
//    logistics, heating…) are a list the keeper edits, each with its own amount;
//  - the amounts are seen only by the Superior, the Accountant and whoever keeps the calendar (hosting.keep);
//  - a booking made on a phone with no connection is always "to confirm" until the server has checked it.

export const STATUSES = ['option', 'confirmed', 'arrived', 'left', 'cancelled'] as const;
export type BookingStatus = (typeof STATUSES)[number];
export type BookingKind = 'stay' | 'event';
export type RoomKind = 'bedroom' | 'hall' | 'other';
export type Currency = 'USD' | 'SYP';

export interface HostBuilding { id: number; name: string; active: number; sort: number; /** its colour on the calendar (#rrggbb); null: one from the palette */ color: string | null }
export interface HostRoom { id: number; building_id: number; name: string; beds: number; kind: RoomKind; /** the kind of room, from the list the keeper edits */ kind_id: number | null; /** the most people a meeting space holds (a hall); 0: not given */ capacity: number; active: number; sort: number; place_id: number | null }
/** a kind of room: with beds (people sleep there) or a meeting space */
export interface HostKind { id: number; name: string; sleeps: number; active: number; sort: number }
/** a piece of equipment a booking may ask for: an item name of the inventory, with how many the inventory holds (in use, in good condition) */
export interface HostEquip { id: number; name: string; active: number; sort: number; total: number }
export interface HostNeed { booking_id: number; equip_id: number; qty: number }
/** what a room holds, read from the inventory (the room is a place of the inventory) */
export interface HostAsset { room_id: number; name: string; qty: number }
export interface HostService { id: number; name: string; active: number; sort: number }
export interface HostBooking {
  id: number;
  code: string;
  kind: BookingKind;
  status: BookingStatus;
  group_name: string;
  contact: string | null;
  phone: string | null;
  people: number;
  /** a stay: the arrival day, and the day of leaving (the nights are in between). An event: its first and last day. */
  from_day: string;
  to_day: string;
  /** an event that repeats every week: the weekdays, 0 = Sunday … 6 = Saturday, as "1,3" (from_day to to_day, both included) */
  repeat_days: string | null;
  /** an event's hours (HH:MM); two events in one hall on one day only clash if their hours cross */
  time_from: string | null;
  time_to: string | null;
  /** the amounts: only for those who keep the calendar */
  price_mode: 'person' | 'group' | null;
  rate: number | null;
  currency: Currency;
  note: string | null;
  cancel_reason: string | null;
  /** 'desk', or 'phone' for a booking made with no connection (it waits for a check) */
  source: 'desk' | 'phone';
  /** 1: made on a phone, not yet looked at by someone who sees the whole calendar */
  review: number;
  client_ref: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}
export interface HostAlloc { booking_id: number; room_id: number; /** the beds used in the room; null: the whole room */ beds: number | null }
export interface HostLine { id: number; booking_id: number; service_id: number | null; label: string; qty: number; amount: number; currency: Currency }
export interface HostPay {
  id: number; booking_id: number; amount: number; currency: Currency; paid_on: string; method: string; receipt_no: string;
  status: 'suggested' | 'refused'; note: string | null; who: string | null; at: string;
  /** 'in': money received (an income for the books); 'back': money given back after a cancellation (an expense). Update 74. */
  kind?: 'in' | 'back';
  /** how many times its receipt was printed (printed again: the mark "copy"). Update 74. */
  printed?: number;
}

/** What the screens receive. The amounts are null (and `pays` empty) for someone who does not keep the calendar. */
export interface HostData {
  buildings: HostBuilding[];
  rooms: HostRoom[];
  kinds: HostKind[];
  equip: HostEquip[];
  needs: HostNeed[];
  /** the items the inventory holds in each meeting space (not in bedrooms) */
  assets: HostAsset[];
  services: HostService[];
  bookings: HostBooking[];
  allocs: HostAlloc[];
  lines: HostLine[];
  pays: HostPay[];
  /** the receipt numbers already made into an entry of the register */
  entered: string[];
  /** this person sees the amounts and the payments */
  prices: boolean;
}

// ------------------------------------------------------------------ days

export const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`));
const MS = 86400000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(toMs(d) + n * MS).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / MS);

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const repeatSet = (x: string | null | undefined) => (x ? new Set(x.split(',').map(Number).filter((n) => n >= 0 && n <= 6)) : null);

/**
 * the days a booking holds its rooms: a stay holds its nights (not the day of leaving); an event holds every day, both ends
 * included, or — when it repeats every week (like the website's calendar) — only the chosen weekdays between its two dates
 */
export function heldDays(b: Pick<HostBooking, 'kind' | 'from_day' | 'to_day'> & { repeat_days?: string | null }): string[] {
  const out: string[] = [];
  const last = b.kind === 'event' ? b.to_day : addDays(b.to_day, -1);
  const rep = b.kind === 'event' ? repeatSet(b.repeat_days) : null;
  let n = 0;
  for (let d = b.from_day; d <= last && n++ < 1100; d = addDays(d, 1)) {
    if (!rep || rep.has(new Date(`${d}T00:00:00Z`).getUTCDay())) out.push(d);
  }
  return out;
}
export const nightsOf = (b: Pick<HostBooking, 'kind' | 'from_day' | 'to_day'> & { repeat_days?: string | null }) => heldDays(b).length;

/** a room holds its beds; a hall or a room with no beds counts as one place, taken whole */
export const capacity = (r: Pick<HostRoom, 'beds'>) => Math.max(1, r.beds || 0);

/** Why a booking cannot be saved as it is (null: fine). */
export function checkBooking(b: Pick<HostBooking, 'kind' | 'from_day' | 'to_day' | 'group_name' | 'people'> & { repeat_days?: string | null; time_from?: string | null; time_to?: string | null }): string | null {
  if (!b.group_name.trim()) return 'name';
  if (!isDay(b.from_day) || !isDay(b.to_day)) return 'dates';
  if (b.kind === 'stay' ? b.to_day <= b.from_day : b.to_day < b.from_day) return 'order';
  if (diffDays(b.from_day, b.to_day) > (b.kind === 'event' && b.repeat_days ? 1100 : 370)) return 'long';
  if (b.kind === 'event' && b.repeat_days && heldDays(b).length === 0) return 'repeat';
  for (const h of [b.time_from, b.time_to]) if (h && !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) return 'time';
  if (!(b.people >= 0)) return 'people';
  return null;
}

// ------------------------------------------------------------------ colours

/** the colours a building or area gets when nobody chose one (like the floors of the website's calendar) */
export const PALETTE = ['#2e7d6b', '#b5541d', '#3b5ba9', '#8a4f9e', '#a8821c', '#c2476b', '#4a7c2f', '#546e7a'] as const;
/** a building's colour on the calendar: the one chosen, or one from the palette by its place in the list */
export function colorOf(buildings: Pick<HostBuilding, 'id' | 'color'>[], id: number): string {
  const i = buildings.findIndex((b) => b.id === id);
  return buildings[i]?.color || PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

// ------------------------------------------------------------------ conflicts

const HOLDING: BookingStatus[] = ['confirmed', 'arrived'];
type Hours = { kind: BookingKind; time_from?: string | null; time_to?: string | null };
/** two events in the same hall on the same day, each with its hours, that do not cross: no clash */
function apart(a: Hours, b: Hours): boolean {
  if (a.kind !== 'event' || b.kind !== 'event' || !a.time_from || !a.time_to || !b.time_from || !b.time_to) return false;
  return a.time_to <= b.time_from || b.time_to <= a.time_from;
}
/** a booking that keeps its rooms taken for sure */
export const holds = (b: Pick<HostBooking, 'status'>) => HOLDING.includes(b.status);
/** a booking that still takes a place on the calendar */
export const live = (b: Pick<HostBooking, 'status'>) => b.status !== 'cancelled';

export interface Conflict { room_id: number; day: string; with: number[] }

/**
 * The days on which a booking's rooms are more than full. `against` says which other bookings count: 'sure' (confirmed or
 * arrived: a clash that forbids confirming) or 'any' (an option too: a warning).
 */
export function conflictsOf(
  b: Pick<HostBooking, 'id' | 'kind' | 'from_day' | 'to_day'> & { repeat_days?: string | null; time_from?: string | null; time_to?: string | null }, mine: HostAlloc[], all: { bookings: HostBooking[]; allocs: HostAlloc[]; rooms: HostRoom[] },
  against: 'sure' | 'any' = 'sure',
): Conflict[] {
  const room = new Map(all.rooms.map((r) => [r.id, r]));
  const days = new Set(heldDays(b));
  const others = all.bookings.filter((o) => o.id !== b.id && (against === 'sure' ? holds(o) : live(o)) && !apart(b, o));
  const byId = new Map(others.map((o) => [o.id, o]));
  const out: Conflict[] = [];
  for (const a of mine) {
    const r = room.get(a.room_id);
    if (!r) continue;
    const cap = capacity(r);
    const want = Math.min(cap, a.beds ?? cap);
    // beds already taken, day by day, in this room
    const used = new Map<string, { n: number; ids: number[] }>();
    for (const x of all.allocs) {
      if (x.room_id !== a.room_id) continue;
      const o = byId.get(x.booking_id);
      if (!o) continue;
      for (const d of heldDays(o)) {
        if (!days.has(d)) continue;
        const u = used.get(d) ?? { n: 0, ids: [] };
        u.n += Math.min(cap, x.beds ?? cap);
        u.ids.push(o.id);
        used.set(d, u);
      }
    }
    for (const [d, u] of [...used].sort((p, q) => p[0].localeCompare(q[0]))) if (u.n + want > cap) out.push({ room_id: a.room_id, day: d, with: u.ids });
  }
  return out;
}

/** the other bookings a list of conflicts runs into */
export const clashing = (cs: Conflict[]) => [...new Set(cs.flatMap((c) => c.with))];

/** the beds taken in a room on a day, by the bookings that still count (for the calendar's cell) */
export function takenOn(room: HostRoom, day: string, bookings: HostBooking[], allocs: HostAlloc[]): { booking: HostBooking; beds: number }[] {
  const cap = capacity(room);
  const out: { booking: HostBooking; beds: number }[] = [];
  for (const a of allocs) {
    if (a.room_id !== room.id) continue;
    const b = bookings.find((x) => x.id === a.booking_id);
    if (b && live(b) && heldDays(b).includes(day)) out.push({ booking: b, beds: Math.min(cap, a.beds ?? cap) });
  }
  return out;
}

// ------------------------------------------------------------------ equipment: what bookings ask for against what the inventory holds

export interface Shortage { equip_id: number; day: string; wanted: number; have: number; /** the other bookings that ask for it on that day */ with: number[] }

type Window = Pick<HostBooking, 'id' | 'kind' | 'from_day' | 'to_day'> & { repeat_days?: string | null; time_from?: string | null; time_to?: string | null };

/**
 * The days on which this booking's equipment cannot be had: its own request plus those of the other bookings that still count
 * (to confirm, confirmed, arrived) and meet it that day (two events whose hours do not cross do not compete) are more than
 * the inventory holds.
 */
export function shortagesFor(
  b: Window, mine: { equip_id: number; qty: number }[],
  all: { bookings: HostBooking[]; needs: HostNeed[]; equip: Pick<HostEquip, 'id' | 'total'>[] },
): Shortage[] {
  const out: Shortage[] = [];
  const days = heldDays(b);
  for (const n of mine) {
    if (!(n.qty > 0)) continue;
    const have = all.equip.find((e) => e.id === n.equip_id)?.total ?? 0;
    const others = all.bookings.filter((o) => o.id !== b.id && live(o) && !apart(b, o)).map((o) => ({ o, q: all.needs.find((x) => x.booking_id === o.id && x.equip_id === n.equip_id)?.qty ?? 0, held: new Set(heldDays(o)) })).filter((x) => x.q > 0);
    for (const day of days) {
      const here = others.filter((x) => x.held.has(day));
      const wanted = n.qty + here.reduce((s, x) => s + x.q, 0);
      if (wanted > have) out.push({ equip_id: n.equip_id, day, wanted, have, with: here.map((x) => x.o.id) });
    }
  }
  return out;
}

/** day by day, for each piece of equipment: how many are asked for, who asks, and how many exist (for the Equipment view) */
export function equipmentLoad(d: { bookings: HostBooking[]; needs: HostNeed[]; equip: HostEquip[] }, from: string, to: string) {
  const rows = d.equip.map((e) => {
    const asks = d.bookings.filter((b) => live(b)).map((b) => ({ b, q: d.needs.find((x) => x.booking_id === b.id && x.equip_id === e.id)?.qty ?? 0 })).filter((x) => x.q > 0).map((x) => ({ ...x, held: new Set(heldDays(x.b)) }));
    const days = new Map<string, { wanted: number; bookings: HostBooking[] }>();
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const here = asks.filter((x) => x.held.has(day));
      if (!here.length) continue;
      // hours that do not cross do not compete: the worst moment is the booking with the most asked around it
      const timed = here.some((x) => x.b.time_from && x.b.time_to);
      const wanted = timed ? Math.max(...here.map((x) => x.q + here.filter((y) => y !== x && !apart(x.b, y.b)).reduce((s, y) => s + y.q, 0))) : here.reduce((s, x) => s + x.q, 0);
      days.set(day, { wanted, bookings: here.map((x) => x.b) });
    }
    return { equip: e, days };
  });
  return rows;
}

// ------------------------------------------------------------------ views by month and by year

/** how full the rooms are, day by day (for the month and year views): beds used, and the bookings present */
export function occupancy(d: Pick<HostData, 'bookings' | 'allocs' | 'rooms'>, roomIds?: Set<number>) {
  const rooms = d.rooms.filter((r) => r.active && (!roomIds || roomIds.has(r.id)));
  const cap = new Map(rooms.map((r) => [r.id, capacity(r)]));
  const total = [...cap.values()].reduce((n, c) => n + c, 0);
  const per = new Map<string, { used: Map<number, number>; groups: HostBooking[] }>();
  for (const b of d.bookings) {
    if (!live(b)) continue;
    const mine = d.allocs.filter((a) => a.booking_id === b.id && cap.has(a.room_id));
    if (!mine.length) continue;
    for (const day of heldDays(b)) {
      const e = per.get(day) ?? { used: new Map<number, number>(), groups: [] };
      for (const a of mine) e.used.set(a.room_id, (e.used.get(a.room_id) ?? 0) + Math.min(cap.get(a.room_id)!, a.beds ?? cap.get(a.room_id)!));
      e.groups.push(b);
      per.set(day, e);
    }
  }
  const out = new Map<string, { used: number; groups: HostBooking[] }>();
  for (const [day, e] of per) out.set(day, { used: [...e.used].reduce((n, [id, u]) => n + Math.min(cap.get(id)!, u), 0), groups: e.groups });
  return { total, days: out };
}
export const addMonths = (d: string, n: number) => { const x = new Date(`${d.slice(0, 7)}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
export const daysInMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

// ------------------------------------------------------------------ amounts

/** the stay itself: people × nights × the rate, or the group's fixed price (in the booking's currency) */
export function stayAmount(b: Pick<HostBooking, 'kind' | 'from_day' | 'to_day' | 'people' | 'price_mode' | 'rate'> & { repeat_days?: string | null }): number {
  if (b.rate == null || !b.price_mode) return 0;
  return Math.round((b.price_mode === 'group' ? b.rate : b.rate * b.people * nightsOf(b)) * 100) / 100;
}
export type Totals = Record<Currency, number>;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** what a booking comes to, in each currency: the stay in the booking's currency, each service line in its own */
export function bookingTotals(b: Parameters<typeof stayAmount>[0] & { currency: Currency }, lines: Pick<HostLine, 'amount' | 'currency'>[]): Totals {
  const t: Totals = { USD: 0, SYP: 0 };
  t[b.currency] += stayAmount(b);
  for (const l of lines) t[l.currency === 'SYP' ? 'SYP' : 'USD'] += l.amount || 0;
  return { USD: r2(t.USD), SYP: r2(t.SYP) };
}
/** what is still due, in each currency (a payment counts in its own currency) */
export function dueOf(total: Totals, pays: Pick<HostPay, 'amount' | 'currency' | 'status' | 'kind'>[]): Totals {
  const paid: Totals = { USD: 0, SYP: 0 };
  for (const p of pays) if (p.status !== 'refused' && p.kind !== 'back') paid[p.currency] += p.amount;
  return { USD: r2(total.USD - paid.USD), SYP: r2(total.SYP - paid.SYP) };
}

// ------------------------------------------------------------------ groups, people and the report

/** the same group or person written with another case or extra spaces is the same */
export const nameKey = (x: string | null | undefined) => (x ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** the groups and the people already known from the bookings, to complete a name while typing and to fill the contact */
export function knownNames(bookings: Pick<HostBooking, 'group_name' | 'contact' | 'phone' | 'from_day' | 'status'>[]) {
  const groups = new Map<string, { name: string; contact: string | null; phone: string | null; count: number; last: string }>();
  const people = new Map<string, { name: string; phone: string | null; count: number; last: string }>();
  for (const b of [...bookings].sort((x, y) => x.from_day.localeCompare(y.from_day))) {
    if (b.status === 'cancelled') continue;
    const gk = nameKey(b.group_name);
    if (gk) { const g = groups.get(gk); groups.set(gk, { name: b.group_name.trim(), contact: b.contact || g?.contact || null, phone: b.phone || g?.phone || null, count: (g?.count ?? 0) + 1, last: b.from_day }); }
    const pk = nameKey(b.contact);
    if (pk) { const p = people.get(pk); people.set(pk, { name: (b.contact ?? '').trim(), phone: b.phone || p?.phone || null, count: (p?.count ?? 0) + 1, last: b.from_day }); }
  }
  return { groups, people };
}

/** one day of a report: the beds used, the people in the rooms, how many stays and events, and who */
export interface DayFigure { day: string; weekday: number; bedUsed: number; bedPct: number; people: number; stays: number; events: number; groups: HostBooking[] }
export interface ReportOpts { from: string; to: string; kind: BookingKind | 'all'; /** count the bookings still "to confirm" */ withOptions: boolean }
export interface Amounts { agreed: Totals; paid: Totals }
const zero = (): Totals => ({ USD: 0, SYP: 0 });
const plus = (a: Totals, b: Totals): Totals => ({ USD: r2(a.USD + b.USD), SYP: r2(a.SYP + b.SYP) });

/**
 * A report of accommodation and events over a period. Counted: confirmed, arrived and left bookings (and "to confirm" if
 * asked). Nights and days are those that fall inside the period. The amounts (only if `prices`) are the agreed totals of
 * the bookings that fall in the period, and the payments received in it.
 */
export function report(d: HostData, o: ReportOpts) {
  const inP = (day: string) => day >= o.from && day <= o.to;
  const counted = d.bookings.filter((b) => (o.kind === 'all' || b.kind === o.kind) && (b.status === 'confirmed' || b.status === 'arrived' || b.status === 'left' || (o.withOptions && b.status === 'option')));
  const rows = counted.map((b) => ({ b, days: heldDays(b).filter(inP) })).filter((r) => r.days.length);
  const stays = rows.filter((r) => r.b.kind === 'stay'), events = rows.filter((r) => r.b.kind === 'event');
  const nights = stays.reduce((n, r) => n + r.days.length, 0);
  const personNights = stays.reduce((n, r) => n + r.days.length * r.b.people, 0);
  const eventDays = events.reduce((n, r) => n + r.days.length, 0);
  const linesOf = (id: number) => d.lines.filter((l) => l.booking_id === id);
  const totalOf = (b: HostBooking) => (d.prices ? bookingTotals(b, linesOf(b.id)) : zero());
  const paidIn = (id: number): Totals => { const t = zero(); for (const p of d.pays) if (p.booking_id === id && p.status !== 'refused' && p.kind !== 'back' && inP(p.paid_on)) t[p.currency] += p.amount; return t; };

  // beds used: only stays and the bedrooms; halls: only events
  const bedRooms = new Set(d.rooms.filter((r) => r.kind === 'bedroom' && r.beds > 0).map((r) => r.id));
  // a hall is a room that is not a bedroom, or any room an event has used
  const hallRooms = new Set(d.rooms.filter((r) => r.kind !== 'bedroom' || r.beds === 0).map((r) => r.id));
  for (const r of rows) if (r.b.kind === 'event') for (const al of d.allocs) if (al.booking_id === r.b.id) hallRooms.add(al.room_id);
  const spanDays = Math.max(1, diffDays(o.from, o.to) + 1);
  const occOf = (kindOf: BookingKind, roomIds: Set<number>, from: string, to: string) => {
    const oc = occupancy({ bookings: counted.filter((b) => b.kind === kindOf), allocs: d.allocs, rooms: d.rooms }, roomIds);
    let used = 0;
    for (const [day, e] of oc.days) if (day >= from && day <= to) used += e.used;
    const avail = oc.total * Math.max(1, diffDays(from, to) + 1);
    return { used, avail, pct: avail ? Math.round((used / avail) * 1000) / 10 : 0 };
  };

  const months: { month: string; bookings: number; nights: number; personNights: number; eventDays: number; bedPct: number }[] = [];
  for (let m = o.from.slice(0, 7); m <= o.to.slice(0, 7) && months.length < 60; m = addMonths(m + '-01', 1).slice(0, 7)) {
    const mf = m === o.from.slice(0, 7) ? o.from : `${m}-01`;
    const ml = m === o.to.slice(0, 7) ? o.to : `${m}-${String(daysInMonth(m)).padStart(2, '0')}`;
    const inM = (day: string) => day >= mf && day <= ml;
    const mine = rows.map((r) => ({ ...r, days: r.days.filter(inM) })).filter((r) => r.days.length);
    months.push({
      month: m, bookings: mine.length,
      nights: mine.filter((r) => r.b.kind === 'stay').reduce((n, r) => n + r.days.length, 0),
      personNights: mine.filter((r) => r.b.kind === 'stay').reduce((n, r) => n + r.days.length * r.b.people, 0),
      eventDays: mine.filter((r) => r.b.kind === 'event').reduce((n, r) => n + r.days.length, 0),
      bedPct: occOf('stay', bedRooms, mf, ml).pct,
    });
  }
  const buildings = d.buildings.map((bd) => {
    const ids = new Set(d.rooms.filter((r) => r.building_id === bd.id).map((r) => r.id));
    const beds = new Set([...ids].filter((i) => bedRooms.has(i)));
    const halls = new Set([...ids].filter((i) => hallRooms.has(i)));
    const mine = rows.filter((r) => d.allocs.some((a) => a.booking_id === r.b.id && ids.has(a.room_id)));
    return { id: bd.id, name: bd.name, bookings: mine.length, bedPct: occOf('stay', beds, o.from, o.to).pct, bedNights: occOf('stay', beds, o.from, o.to).used, hallDays: occOf('event', halls, o.from, o.to).used };
  });

  const groupMap = new Map<string, { name: string; bookings: number; stays: number; events: number; nights: number; personNights: number; eventDays: number; people: number; first: string; last: string; contacts: Set<string>; phone: string | null; amounts: Amounts; ids: number[] }>();
  const personMap = new Map<string, { name: string; phone: string | null; bookings: number; groups: Set<string>; last: string }>();
  for (const r of rows.sort((x, y) => x.b.from_day.localeCompare(y.b.from_day))) {
    const b = r.b;
    const gk = nameKey(b.group_name);
    const g = groupMap.get(gk) ?? { name: b.group_name.trim(), bookings: 0, stays: 0, events: 0, nights: 0, personNights: 0, eventDays: 0, people: 0, first: b.from_day, last: b.from_day, contacts: new Set<string>(), phone: null, amounts: { agreed: zero(), paid: zero() }, ids: [] };
    g.name = b.group_name.trim(); g.bookings++; g.people += b.people; g.last = b.from_day; g.ids.push(b.id);
    if (b.kind === 'stay') { g.stays++; g.nights += r.days.length; g.personNights += r.days.length * b.people; } else { g.events++; g.eventDays += r.days.length; }
    if (b.contact) g.contacts.add(b.contact.trim());
    if (b.phone) g.phone = b.phone;
    g.amounts = { agreed: plus(g.amounts.agreed, totalOf(b)), paid: plus(g.amounts.paid, d.prices ? paidIn(b.id) : zero()) };
    groupMap.set(gk, g);
    const pk = nameKey(b.contact);
    if (pk) { const p = personMap.get(pk) ?? { name: (b.contact ?? '').trim(), phone: null, bookings: 0, groups: new Set<string>(), last: b.from_day }; p.bookings++; p.groups.add(b.group_name.trim()); p.last = b.from_day; if (b.phone) p.phone = b.phone; personMap.set(pk, p); }
  }
  // day by day: the beds used, the people, the groups present (for the busiest days and the weekday pattern)
  const ocStay = occupancy({ bookings: counted.filter((b) => b.kind === 'stay'), allocs: d.allocs, rooms: d.rooms }, bedRooms);
  const ocEvent = occupancy({ bookings: counted.filter((b) => b.kind === 'event'), allocs: d.allocs, rooms: d.rooms }, hallRooms);
  const days: DayFigure[] = [];
  for (let day = o.from; day <= o.to && days.length < 1100; day = addDays(day, 1)) {
    const st = ocStay.days.get(day), ev = ocEvent.days.get(day);
    days.push({ day, weekday: new Date(`${day}T00:00:00Z`).getUTCDay(), bedUsed: st?.used ?? 0, bedPct: ocStay.total && st ? Math.round((st.used / ocStay.total) * 1000) / 10 : 0, people: st ? st.groups.reduce((n, b) => n + b.people, 0) : 0, stays: st?.groups.length ?? 0, events: ev?.groups.length ?? 0, groups: [...(st?.groups ?? []), ...(ev?.groups ?? [])] });
  }
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((w) => { const xs = days.filter((x) => x.weekday === w); return { weekday: w, bedPct: xs.length ? Math.round((xs.reduce((n, x) => n + x.bedPct, 0) / xs.length) * 10) / 10 : 0, people: xs.length ? Math.round((xs.reduce((n, x) => n + x.people, 0) / xs.length) * 10) / 10 : 0, busy: xs.filter((x) => x.stays + x.events > 0).length }; });
  const groups = [...groupMap.values()].sort((x, y) => y.bookings - x.bookings || x.name.localeCompare(y.name));
  const people = [...personMap.values()].sort((x, y) => y.bookings - x.bookings || x.name.localeCompare(y.name));
  const totals = rows.reduce((a, r) => ({ agreed: plus(a.agreed, totalOf(r.b)), paid: plus(a.paid, d.prices ? paidIn(r.b.id) : zero()) }), { agreed: zero(), paid: zero() } as Amounts);
  const cancelled = d.bookings.filter((b) => b.status === 'cancelled' && (o.kind === 'all' || b.kind === o.kind) && inP(b.from_day)).length;
  return {
    summary: {
      bookings: rows.length, stays: stays.length, events: events.length, groups: groups.length, people: stays.reduce((n, r) => n + r.b.people, 0), eventPeople: events.reduce((n, r) => n + r.b.people, 0),
      nights, personNights, eventDays, cancelled, spanDays,
      bed: occOf('stay', bedRooms, o.from, o.to), hall: occOf('event', hallRooms, o.from, o.to), amounts: totals,
    },
    months, buildings, groups, people, rows, days, weekdays,
  };
}

// ------------------------------------------------------------------ numbers

/** HB-2026-0007: the next booking number of a year */
export function nextCode(existing: string[], year: number): string {
  const re = new RegExp(`^HB-${year}-(\\d+)$`);
  const n = Math.max(0, ...existing.map((c) => Number(re.exec(c)?.[1] ?? 0)));
  return `HB-${year}-${String(n + 1).padStart(4, '0')}`;
}
/** H2026-0007: the next receipt number of a year (it goes on the entry of the register) */
/** the next number of a series: H2026-0001 (money received), HR2026-0001 (money given back) */
export function nextReceipt(existing: string[], year: number, prefix = 'H'): string {
  const re = new RegExp(`^${prefix}${year}-(\\d+)$`);
  const n = Math.max(0, ...existing.map((c) => Number(re.exec(c)?.[1] ?? 0)));
  return `${prefix}${year}-${String(n + 1).padStart(4, '0')}`;
}

/** the amounts, hidden: what someone who does not keep the calendar receives */
export function withoutPrices(d: HostData): HostData {
  return {
    ...d,
    bookings: d.bookings.map((b) => ({ ...b, price_mode: null, rate: null })),
    lines: [],
    pays: [],
    entered: [],
    prices: false,
  };
}

/** the bookings made on a phone that someone must still look at, with what each runs into */
export function toReview(d: Pick<HostData, 'bookings' | 'allocs' | 'rooms'>) {
  return d.bookings.filter((b) => b.review && live(b)).map((b) => {
    const mine = d.allocs.filter((a) => a.booking_id === b.id);
    const cs = conflictsOf(b, mine, d, 'sure');
    return { booking: b, conflicts: cs, clashWith: d.bookings.filter((o) => clashing(cs).includes(o.id)) };
  });
}
