// The MAGIS Calendar (Fouad, baseline 2.1, 24 November 2026; calendar-plan/CALENDAR-BASELINE.md). Step 1: the data and
// the rules, no screen yet. It starts from the 0.12 hosting tables (host.ts): a building is an AREA, a room is a SPACE.
//
// The golden rules kept here:
//  - one calendar for OUR programme and for OUTSIDE bookings (hall bookings and guest stays);
//  - a space is NEVER given twice: if something already holds it at that time, the second cannot be saved, whichever it
//    is ("to confirm" holds too). A weekly series where some dates are taken may be saved WITHOUT those dates (listed);
//  - "to confirm" holds the space until a date (7 days by default); after it the date is shown as passed, the space is
//    never freed by itself;
//  - a space closed for repairs cannot be booked; a closed period of the centre and Sunday are only warnings;
//  - the whole centre (Director) holds every space; an activity outside the centre holds none;
//  - one group per bedroom: the program counts rooms, not beds;
//  - nothing is deleted: a booking or a date is cancelled with a reason and kept.
import type { InRoom } from '../inventory/map';
import type { Currency, HostAlloc, HostBooking, HostBuilding, HostEquip, HostKind, HostLine, HostNeed, HostPay, HostRoom } from './host';
import { addDays, isDay } from './host';

// ------------------------------------------------------------------ the data

export type Origin = 'ours' | 'outside';
export type PriceState = 'free' | 'priced' | 'unset';
export type CancelMoney = 'all' | 'none' | 'part';

export interface CalCategory { id: number; name: string; active: number; sort: number }
export interface CalKind extends HostKind { category_id: number | null }
/** a space: a hall, a classroom, a kitchen, a bedroom… (a 0.12 room) */
export interface CalSpace extends HostRoom { floor: string | null; rentable: number; fixed: string | null; note: string | null; category_id: number | null; /** 0: shown only in the inventory (a store, an office), never in the calendar */ bookable: number }
export interface CalActivityKind { id: number; name: string; color: string | null; active: number; sort: number }
export interface CalOrgKind { id: number; name: string; active: number; sort: number }
export interface CalOrg { id: number; name: string; kind_id: number | null; note: string | null; active: number; created_by: string | null; created_at: string; updated_at: string | null }
export interface CalPerson { id: number; org_id: number; name: string; phone: string | null; active: number; sort: number }
export interface CalBooking extends HostBooking {
  origin: Origin;
  activity_kind_id: number | null;
  leader: string | null;
  org_id: number | null;
  person_id: number | null;
  /** an outside booking: what it is for (a conference…), optional */
  subject: string | null;
  private: number;
  whole_centre: number;
  /** our activity outside the centre (a trip, a camp): the place, and no space */
  outside_place: string | null;
  hold_until: string | null;
  /** null for our own activities */
  price_state: PriceState | null;
  /** with price_mode 'group': the amount is for each date */
  price_each: number;
  cancel_money: CancelMoney | null;
  kept_usd: number | null;
  kept_syp: number | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
}
export type DateAction = 'cancel' | 'move' | 'cancel_from';
/** one date of a booking cancelled or moved, or this date and the following cancelled */
export interface CalDate { id: number; booking_id: number; day: string; action: DateAction; to_day: string | null; time_from: string | null; time_to: string | null; reason: string | null; taken: number; undone: number; who: string | null; at: string }
export interface SpaceClosed { id: number; room_id: number; from_day: string; to_day: string; reason: string; cancelled: number; cancel_reason: string | null; who: string | null; at: string }
export interface ClosedPeriod { id: number; name: string; from_day: string; to_day: string; cancelled: number; cancel_reason: string | null; who: string | null; at: string }
export interface PriceHist { id: number; booking_id: number; price_state: PriceState | null; price_mode: string | null; price_each: number; rate: number | null; currency: string | null; lines: string | null; who: string | null; at: string }

/** what the calendar reads */
export interface CalData {
  areas: HostBuilding[];
  spaces: CalSpace[];
  kinds: CalKind[];
  categories: CalCategory[];
  activityKinds: CalActivityKind[];
  orgKinds: CalOrgKind[];
  orgs: CalOrg[];
  persons: CalPerson[];
  bookings: CalBooking[];
  allocs: HostAlloc[];
  dates: CalDate[];
  closed: SpaceClosed[];
  periods: ClosedPeriod[];
  equip: HostEquip[];
  needs: HostNeed[];
  lines: HostLine[];
  pays: HostPay[];
  /** "always in the room", read from the inventory (inventory baseline 1.1, §6): the items of each space whose category is
   * ticked "shown in the calendar". While a space has none, its typed `fixed` text is still shown (alwaysInRoom). */
  inRoom?: InRoom[];
  /** what this person may see and do */
  rights: CalRights;
}

// ------------------------------------------------------------------ rights (baseline §3)

export interface CalRights {
  view: boolean; contacts: boolean; programme: boolean; outside: boolean; orgs: boolean; arrive: boolean;
  prices: boolean; money: boolean; whole: boolean; setup: boolean; history: boolean;
}
/** the calendar's rights from the ticks of a person (every tick brings "view"; booking outside, organisations and arrivals bring the contacts) */
export function calRights(perms: readonly string[]): CalRights {
  const t = (k: string) => perms.includes(`cal.${k}`);
  const any = perms.some((p) => p.startsWith('cal.'));
  return {
    view: any, contacts: t('contacts') || t('outside') || t('orgs') || t('arrive'), programme: t('programme'), outside: t('outside'), orgs: t('orgs'),
    arrive: t('arrive'), prices: t('prices'), money: t('money'), whole: t('whole'), setup: t('setup'), history: t('history'),
  };
}
/** may this person change this booking? our programme, an outside booking, the whole centre each have their tick */
export function mayChange(r: CalRights, b: Pick<CalBooking, 'origin' | 'whole_centre'>): boolean {
  if (b.whole_centre) return r.whole;
  return b.origin === 'ours' ? r.programme : r.outside;
}
/** the prices and the money are seen by those who set them or record the payments */
export const seesPrices = (r: CalRights) => r.prices || r.money;

// ------------------------------------------------------------------ hours and days

const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHour = (x: unknown): x is string => typeof x === 'string' && (HOUR.test(x) || x === '24:00');
export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday … 6 = Saturday (stored like 0.12)
export const isSunday = (d: string) => weekday(d) === 0;
/** the hours of a booking on a day, in minutes; a stay, the whole centre or an activity with no hours holds the whole day */
const ALL_DAY: [number, number] = [0, 1440];

export interface Occurrence { day: string; from: number; to: number; /** moved here from another day or other hours */ moved?: string }

type Shape = Pick<CalBooking, 'id' | 'kind' | 'status' | 'from_day' | 'to_day' | 'repeat_days' | 'time_from' | 'time_to'> & Partial<Pick<CalBooking, 'whole_centre'>>;

const repeatSet = (x: string | null | undefined) => (x ? new Set(x.split(',').map(Number).filter((n) => n >= 0 && n <= 6)) : null);

/** the days a booking would have before any date is moved or cancelled (a stay: its nights; an event: every day, or the chosen weekdays) */
export function baseDays(b: Pick<CalBooking, 'kind' | 'from_day' | 'to_day' | 'repeat_days'>): string[] {
  if (!isDay(b.from_day) || !isDay(b.to_day)) return [];
  const out: string[] = [];
  const last = b.kind === 'stay' ? addDays(b.to_day, -1) : b.to_day;
  const rep = b.kind === 'event' ? repeatSet(b.repeat_days) : null;
  let n = 0;
  for (let d = b.from_day; d <= last && n++ < 1100; d = addDays(d, 1)) if (!rep || rep.has(weekday(d))) out.push(d);
  return out;
}

const hoursOf = (b: Shape, tf?: string | null, tt?: string | null): [number, number] => {
  if (b.kind === 'stay' || b.whole_centre) return ALL_DAY;
  const f = tf ?? b.time_from, t = tt ?? b.time_to;
  return f && t && isHour(f) && isHour(t) ? [toMin(f), toMin(t)] : ALL_DAY;
};

/**
 * The real dates of a booking: its days, less the dates cancelled (one, or "this date and the following"), with the dates
 * moved to their new day or hours. A cancelled booking has none. Only the changes not undone count.
 */
export function occurrences(b: Shape, changes: Pick<CalDate, 'booking_id' | 'day' | 'action' | 'to_day' | 'time_from' | 'time_to' | 'undone'>[] = []): Occurrence[] {
  if (b.status === 'cancelled') return [];
  const mine = b.kind === 'event' ? changes.filter((c) => c.booking_id === b.id && !c.undone) : [];
  const stopAt = mine.filter((c) => c.action === 'cancel_from').map((c) => c.day).sort()[0];
  const off = new Set(mine.filter((c) => c.action === 'cancel' || c.action === 'move').map((c) => c.day));
  const [f, t] = hoursOf(b);
  const out: Occurrence[] = [];
  for (const d of baseDays(b)) if (!off.has(d) && !(stopAt && d >= stopAt)) out.push({ day: d, from: f, to: t });
  for (const c of mine) {
    if (c.action !== 'move' || (stopAt && c.day >= stopAt)) continue;
    const [mf, mt] = hoursOf(b, c.time_from, c.time_to);
    out.push({ day: c.to_day && isDay(c.to_day) ? c.to_day : c.day, from: mf, to: mt, moved: c.day });
  }
  return out.sort((x, y) => x.day.localeCompare(y.day) || x.from - y.from);
}

const cross = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from < b.to && b.from < a.to;

// ------------------------------------------------------------------ holds (to confirm)

export const HOLD_DAYS = 7;
/** the day until which a booking "to confirm" holds the space: the one written, or 7 days after it was made */
export const holdDate = (b: Pick<CalBooking, 'hold_until' | 'created_at'>) => b.hold_until ?? addDays(b.created_at.slice(0, 10), HOLD_DAYS);
/** the held date has passed (shown in red; the space stays held until someone decides) */
export const holdPassed = (b: Pick<CalBooking, 'status' | 'hold_until' | 'created_at'>, today: string) => b.status === 'option' && holdDate(b) < today;

// ------------------------------------------------------------------ spaces, categories, closings

/** a space's category: its own, or that of its kind */
export function categoryOf(s: Pick<CalSpace, 'category_id' | 'kind_id'>, kinds: Pick<CalKind, 'id' | 'category_id'>[]): number | null {
  return s.category_id ?? kinds.find((k) => k.id === s.kind_id)?.category_id ?? null;
}
/** a space where people sleep (a bedroom): its kind has beds */
export const sleepsIn = (s: Pick<CalSpace, 'kind' | 'kind_id'>, kinds: Pick<CalKind, 'id' | 'sleeps'>[]) => {
  const k = kinds.find((x) => x.id === s.kind_id);
  return k ? !!k.sleeps : s.kind === 'bedroom';
};
/** the closing of a space that covers this day (repairs), if any */
export const closedOn = (closed: SpaceClosed[], spaceId: number, day: string) => closed.find((c) => !c.cancelled && c.room_id === spaceId && day >= c.from_day && day <= c.to_day) ?? null;
/** the closed period of the centre that covers this day, if any */
export const periodOn = (periods: ClosedPeriod[], day: string) => periods.find((p) => !p.cancelled && day >= p.from_day && day <= p.to_day) ?? null;

/** a space of the calendar: in use, and one that can be booked (a store or an office is only in the inventory) */
export const inCalendar = (s: Pick<CalSpace, 'active'> & Partial<Pick<CalSpace, 'bookable'>>) => !!s.active && s.bookable !== 0;
/** the spaces a booking holds on a day: the whole centre holds every space of the calendar (but one closed for repairs), an activity outside the centre none */
export function spacesOn(b: Pick<CalBooking, 'id'> & Partial<Pick<CalBooking, 'whole_centre' | 'outside_place'>>, day: string, w: { allocs: Pick<HostAlloc, 'booking_id' | 'room_id'>[]; spaces: (Pick<CalSpace, 'id' | 'active'> & Partial<Pick<CalSpace, 'bookable'>>)[]; closed: SpaceClosed[] }, mine?: number[]): number[] {
  if (b.whole_centre) return w.spaces.filter((s) => inCalendar(s) && !closedOn(w.closed, s.id, day)).map((s) => s.id);
  return mine ?? w.allocs.filter((a) => a.booking_id === b.id).map((a) => a.room_id);
}

// ------------------------------------------------------------------ the "never twice" rule

export interface World {
  bookings: (Shape & Pick<CalBooking, 'group_name'> & Partial<Pick<CalBooking, 'outside_place' | 'origin'>>)[];
  allocs: Pick<HostAlloc, 'booking_id' | 'room_id'>[];
  dates: CalDate[];
  spaces: (Pick<CalSpace, 'id' | 'active'> & Partial<Pick<CalSpace, 'bookable'>>)[];
  closed: SpaceClosed[];
}
/** a booking being saved: its shape, the spaces chosen, and the date changes it already has */
export interface Probe extends Shape { outside_place?: string | null; spaces: number[]; dates?: CalDate[] }

export interface Clash { day: string; space_id: number; with: number; /** the date of the probe that clashes (before a move) */ from: number; to: number }
export interface Shut { day: string; space_id: number; closing: number }

/**
 * Where a booking runs into another one that holds the same space at the same time (every booking that is not cancelled
 * holds its spaces, "to confirm" too), and where it falls on a space closed for repairs.
 */
export function clashesOf(p: Probe, w: World): { clashes: Clash[]; shut: Shut[] } {
  const occ = occurrences(p, p.dates ?? []);
  const days = new Set(occ.map((o) => o.day));
  // the other bookings' dates on those days only
  const byDay = new Map<string, { id: number; occ: Occurrence; spaces: Set<number> }[]>();
  for (const o of w.bookings) {
    if (o.id === p.id || o.status === 'cancelled' || (o.outside_place && !o.whole_centre)) continue;
    for (const x of occurrences(o, w.dates)) {
      if (!days.has(x.day)) continue;
      const list = byDay.get(x.day) ?? [];
      list.push({ id: o.id, occ: x, spaces: new Set(spacesOn(o, x.day, w)) });
      byDay.set(x.day, list);
    }
  }
  const clashes: Clash[] = [], shut: Shut[] = [];
  if (p.outside_place && !p.whole_centre) return { clashes, shut };
  for (const o of occ) {
    const mine = spacesOn({ id: p.id, whole_centre: p.whole_centre }, o.day, w, p.spaces);
    if (!p.whole_centre) for (const s of mine) { const c = closedOn(w.closed, s, o.day); if (c) shut.push({ day: o.day, space_id: s, closing: c.id }); }
    for (const x of byDay.get(o.day) ?? []) {
      if (!cross(o, x.occ)) continue;
      for (const s of mine) if (x.spaces.has(s)) clashes.push({ day: o.day, space_id: s, with: x.id, from: o.from, to: o.to });
    }
  }
  return { clashes, shut };
}

/**
 * What saving a booking comes to:
 *  - 'ok': it can be saved (`skip`: the dates left out because the space was taken or closed, when asked to save without them);
 *  - 'taken': not possible as it is; `canSkip` when it has several dates and only some are taken (it may then be saved
 *    without those dates, which are listed).
 */
export type Decision =
  | { kind: 'ok'; skip: { day: string; why: 'taken' | 'closed'; with: number[] }[] }
  | { kind: 'taken'; clashes: Clash[]; shut: Shut[]; dates: number; takenDays: string[]; canSkip: boolean };

export function decide(p: Probe, w: World, withoutTaken = false): Decision {
  const { clashes, shut } = clashesOf(p, w);
  if (!clashes.length && !shut.length) return { kind: 'ok', skip: [] };
  const all = occurrences(p, p.dates ?? []);
  const bad = new Map<string, { why: 'taken' | 'closed'; with: Set<number> }>();
  for (const c of clashes) { const e = bad.get(c.day) ?? { why: 'taken' as const, with: new Set<number>() }; e.with.add(c.with); bad.set(c.day, e); }
  for (const s of shut) if (!bad.has(s.day)) bad.set(s.day, { why: 'closed', with: new Set() });
  const takenDays = [...bad.keys()].sort();
  // a date that was moved cannot be "left out" (it is already a change); the whole series must not be taken
  const movedBad = all.some((o) => o.moved && bad.has(o.day));
  const canSkip = all.length > 1 && takenDays.length < new Set(all.map((o) => o.day)).size && !movedBad;
  if (withoutTaken && canSkip) return { kind: 'ok', skip: takenDays.map((day) => ({ day, why: bad.get(day)!.why, with: [...bad.get(day)!.with] })) };
  return { kind: 'taken', clashes, shut, dates: all.length, takenDays, canSkip };
}

// ------------------------------------------------------------------ the warnings (saving stays possible)

export type Warning =
  | { kind: 'sunday'; days: string[] }
  | { kind: 'period'; name: string; days: string[] }
  | { kind: 'capacity'; people: number; holds: number }
  | { kind: 'equipment'; equip_id: number; day: string; wanted: number; have: number; with: number[] };

/**
 * Sunday (a hall booked by an outside group; accommodation is always welcome), a closed period of the centre, more people
 * than the spaces hold, and equipment asked for at the same time beyond what the inventory holds.
 */
export function warningsOf(
  p: Probe & Pick<CalBooking, 'people'> & Partial<Pick<CalBooking, 'origin'>>, needs: { equip_id: number; qty: number }[],
  w: World & { periods: ClosedPeriod[]; spacesFull: Pick<CalSpace, 'id' | 'beds' | 'capacity' | 'kind' | 'kind_id'>[]; kinds: Pick<CalKind, 'id' | 'sleeps'>[]; equip: Pick<HostEquip, 'id' | 'total'>[]; needs: HostNeed[] },
): Warning[] {
  const out: Warning[] = [];
  const occ = occurrences(p, p.dates ?? []);
  const days = [...new Set(occ.map((o) => o.day))];
  if (p.origin === 'outside' && p.kind === 'event') {
    const sun = days.filter(isSunday);
    if (sun.length) out.push({ kind: 'sunday', days: sun });
  }
  const byPeriod = new Map<number, { name: string; days: string[] }>();
  for (const d of days) { const pr = periodOn(w.periods, d); if (pr) { const e = byPeriod.get(pr.id) ?? { name: pr.name, days: [] }; e.days.push(d); byPeriod.set(pr.id, e); } }
  for (const e of byPeriod.values()) out.push({ kind: 'period', name: e.name, days: e.days });
  if (!p.whole_centre && !p.outside_place) {
    const chosen = w.spacesFull.filter((s) => p.spaces.includes(s.id));
    const holds = chosen.reduce((n, s) => n + (sleepsIn(s, w.kinds) ? s.beds || 0 : s.capacity || 0), 0);
    // only when every chosen space says how many it holds
    if (chosen.length && chosen.every((s) => (sleepsIn(s, w.kinds) ? s.beds : s.capacity) > 0) && p.people > holds) out.push({ kind: 'capacity', people: p.people, holds });
  }
  for (const n of needs) {
    if (!(n.qty > 0)) continue;
    const have = w.equip.find((e) => e.id === n.equip_id)?.total ?? 0;
    const others = w.bookings.filter((o) => o.id !== p.id && o.status !== 'cancelled').map((o) => ({ o, q: w.needs.find((x) => x.booking_id === o.id && x.equip_id === n.equip_id)?.qty ?? 0 })).filter((x) => x.q > 0).map((x) => ({ ...x, occ: occurrences(x.o, w.dates) }));
    for (const o of occ) {
      const here = others.filter((x) => x.occ.some((y) => y.day === o.day && cross(o, y)));
      const wanted = n.qty + here.reduce((s, x) => s + x.q, 0);
      if (wanted > have) { out.push({ kind: 'equipment', equip_id: n.equip_id, day: o.day, wanted, have, with: here.map((x) => x.o.id) }); break; }
    }
  }
  return out;
}

// ------------------------------------------------------------------ checking what is typed

export interface CalInput {
  origin: Origin;
  kind: 'stay' | 'event';
  group_name: string;
  from_day: string;
  to_day: string;
  repeat_days: string | null;
  time_from: string | null;
  time_to: string | null;
  people: number;
  spaces: number[];
  whole_centre: boolean;
  outside_place: string | null;
  activity_kind_id: number | null;
  org_id: number | null;
}
/** why a booking cannot be saved as it is (null: fine); the never-twice rule is checked apart (decide) */
export function checkCal(b: CalInput): string | null {
  if (!b.group_name.trim()) return b.origin === 'ours' ? 'title' : 'name';
  if (!isDay(b.from_day) || !isDay(b.to_day)) return 'dates';
  if (b.kind === 'stay' ? b.to_day <= b.from_day : b.to_day < b.from_day) return 'order';
  if (b.origin === 'ours' && b.kind === 'stay') return 'ours_stay';
  if (b.whole_centre && b.origin !== 'ours') return 'whole_ours';
  if (b.outside_place && b.origin !== 'ours') return 'place_ours';
  if (b.kind === 'stay' && (b.repeat_days || b.time_from || b.time_to)) return 'stay_hours';
  const span = Math.round((Date.parse(`${b.to_day}T00:00:00Z`) - Date.parse(`${b.from_day}T00:00:00Z`)) / 86400000);
  if (span > (b.repeat_days ? 1100 : 370)) return 'long';
  for (const h of [b.time_from, b.time_to]) if (h && !isHour(h)) return 'time';
  if (!!b.time_from !== !!b.time_to) return 'time';
  if (b.time_from && b.time_to && b.time_from >= b.time_to) return 'hours';
  if (b.kind === 'event' && b.repeat_days && baseDays(b).length === 0) return 'repeat';
  if (!(b.people >= 0)) return 'people';
  if (!b.whole_centre && !b.outside_place && !b.spaces.length) return 'space';
  if (b.origin === 'ours' && !b.activity_kind_id && !b.whole_centre) return 'activity_kind';
  return null;
}
/** a space that can be booked; an outside booking only in rentable spaces; a stay only in bedrooms */
export function spaceProblem(b: Pick<CalInput, 'origin' | 'kind' | 'spaces'>, spaces: (Pick<CalSpace, 'id' | 'rentable' | 'active' | 'kind' | 'kind_id'> & Partial<Pick<CalSpace, 'bookable'>>)[], kinds: Pick<CalKind, 'id' | 'sleeps'>[]): { code: 'missing' | 'not_bookable' | 'not_rentable' | 'not_bedroom'; space_id: number } | null {
  for (const id of b.spaces) {
    const s = spaces.find((x) => x.id === id);
    if (!s || !s.active) return { code: 'missing', space_id: id };
    if (s.bookable === 0) return { code: 'not_bookable', space_id: id };
    if (b.origin === 'outside' && !s.rentable) return { code: 'not_rentable', space_id: id };
    if (b.kind === 'stay' && !sleepsIn(s, kinds)) return { code: 'not_bedroom', space_id: id };
  }
  return null;
}

// ------------------------------------------------------------------ money

export type Totals = Record<Currency, number>;
const r2 = (n: number) => Math.round(n * 100) / 100;
/**
 * The agreed total (price + services), per currency. Free, or "price not set": no price (services still count when typed).
 * Per person per night (a stay), for the whole booking, or for each date of a repeating booking.
 */
export function calTotals(b: Shape & Pick<CalBooking, 'price_state' | 'price_mode' | 'price_each' | 'rate' | 'currency' | 'people'>, lines: Pick<HostLine, 'amount' | 'currency'>[], dates: CalDate[] = []): Totals {
  const t: Totals = { USD: 0, SYP: 0 };
  if (b.price_state === 'priced' && b.rate != null && b.price_mode) {
    const n = occurrences({ ...b, status: b.status === 'cancelled' ? 'confirmed' : b.status }, dates).length;
    t[b.currency] += b.price_mode === 'person' ? b.rate * b.people * n : b.price_each ? b.rate * n : b.rate;
  }
  for (const l of lines) t[l.currency === 'SYP' ? 'SYP' : 'USD'] += l.amount || 0;
  return { USD: r2(t.USD), SYP: r2(t.SYP) };
}
/** what was received, per currency (a refused payment does not count) */
export function received(pays: Pick<HostPay, 'amount' | 'currency' | 'status'>[]): Totals {
  const t: Totals = { USD: 0, SYP: 0 };
  for (const p of pays) if (p.status !== 'refused') t[p.currency] += p.amount;
  return { USD: r2(t.USD), SYP: r2(t.SYP) };
}
/**
 * Cancelled after money was received: keep all, give all back, or keep a part (the amount kept is typed, per currency).
 * Returns what is kept and what goes back, or the reason it cannot be.
 */
export function cancelMoney(got: Totals, choice: CancelMoney, part?: Partial<Totals>): { kept: Totals; back: Totals } | 'too_much' | 'no_part' {
  if (choice === 'all') return { kept: { ...got }, back: { USD: 0, SYP: 0 } };
  if (choice === 'none') return { kept: { USD: 0, SYP: 0 }, back: { ...got } };
  if (!part || (part.USD == null && part.SYP == null)) return 'no_part';
  const kept: Totals = { USD: r2(Math.max(0, part.USD ?? 0)), SYP: r2(Math.max(0, part.SYP ?? 0)) };
  if (kept.USD > got.USD || kept.SYP > got.SYP) return 'too_much';
  return { kept, back: { USD: r2(got.USD - kept.USD), SYP: r2(got.SYP - kept.SYP) } };
}
/** the price as one line of its history (to see whether it changed): the state, the amount and the services' amounts (not how many) */
export const priceSign = (b: Pick<CalBooking, 'price_state' | 'price_mode' | 'price_each' | 'rate' | 'currency'>, lines: Pick<HostLine, 'label' | 'amount' | 'currency'>[]) =>
  JSON.stringify([b.price_state, b.price_state === 'priced' ? b.price_mode : null, b.price_state === 'priced' ? b.price_each : 0, b.price_state === 'priced' ? b.rate : null, b.currency, lines.map((l) => [l.label, l.amount, l.currency])]);

// ------------------------------------------------------------------ what each person receives

export const RESERVED = 'Reserved · محجوز';
/**
 * The calendar as this person may see it: no contacts without the contacts tick (and no register of organisations), no
 * amounts or payments without the prices or money tick, and a private booking shown only as "Reserved" (to the Team).
 */
export function forViewer(d: CalData): CalData {
  const r = d.rights;
  const priced = seesPrices(r);
  const bookings = d.bookings.map((b) => {
    let x = b;
    if (!r.contacts) x = { ...x, contact: null, phone: null, person_id: null };
    if (!priced) x = { ...x, price_mode: null, rate: null, price_each: 0, kept_usd: null, kept_syp: null, cancel_money: null };
    if (b.private && !r.contacts) x = { ...x, group_name: RESERVED, subject: null, leader: null, note: null, org_id: null, cancel_reason: null, outside_place: x.outside_place ? RESERVED : null };
    return x;
  });
  return {
    ...d,
    bookings,
    orgs: r.contacts ? d.orgs : [],
    persons: r.contacts ? d.persons : [],
    lines: priced ? d.lines : d.lines.map((l) => ({ ...l, amount: 0 })),
    pays: priced ? d.pays : [],
  };
}

// ------------------------------------------------------------------ the spaces and organisations from the Excel file

const norm = (x: unknown) => String(x ?? '').trim().replace(/\s+/g, ' ');
const key = (x: unknown) => norm(x).toLowerCase();
/** "Hall · قاعة" matches "Hall · قاعة", "hall" or "قاعة" */
export function matchName<T extends { name: string }>(list: T[], typed: unknown): T | undefined {
  const parts = (x: unknown) => { const k = key(x); return k ? [k, ...k.split('·').map((p) => p.trim()).filter(Boolean)] : []; };
  const mine = parts(typed);
  if (!mine.length) return undefined;
  return list.find((x) => key(x.name) === mine[0]) ?? list.find((x) => parts(x.name).some((p) => mine.includes(p)));
}
const yesNo = (x: unknown): boolean | null => {
  const k = key(x);
  if (!k) return null;
  if (['yes', 'y', 'نعم', 'oui', '1', 'true'].includes(k)) return true;
  if (['no', 'n', 'لا', 'non', '0', 'false'].includes(k)) return false;
  return null;
};
const count = (x: unknown) => { const n = Number(String(x ?? '').trim()); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };
const isExample = (...xs: unknown[]) => xs.some((x) => /^example\b/i.test(norm(x)) || /^مثال/.test(norm(x)));
/** the column of each header, by its English part ("Room name · اسم المكان" → "room name") */
function headers(rows: unknown[][], first: string): { at: number; col: Map<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] ?? []).map((c) => key(String(c ?? '').split(' · ')[0]));
    if (cells.includes(first)) return { at: i, col: new Map(cells.map((c, j) => [c, j])) };
  }
  return null;
}

export interface SheetSpace { row: number; area: string; floor: string | null; name: string; kind_id: number; beds: number; capacity: number; rentable: boolean; rentableGiven: boolean; fixed: string | null; note: string | null }
export interface SheetProblem { row: number; why: 'kind' | 'name' | 'area' | 'twice' | 'rentable' }
/**
 * The sheet "Rooms · الغرف" of MAGIS-Calendar-spaces.xlsx: one line per space. The example lines are left out; a kind
 * must be on the list; a bedroom has beds, any other space a capacity. Empty cells stay empty (rentable: yes).
 */
export function readSpacesSheet(rows: unknown[][], kinds: Pick<CalKind, 'id' | 'name' | 'sleeps'>[]): { spaces: SheetSpace[]; problems: SheetProblem[] } {
  const h = headers(rows, 'room name');
  const spaces: SheetSpace[] = [], problems: SheetProblem[] = [];
  if (!h) return { spaces, problems };
  const get = (r: unknown[], k: string) => (h.col.has(k) ? r[h.col.get(k)!] : undefined);
  const seen = new Set<string>();
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (!r.some((c) => norm(c))) continue;
    const area = norm(get(r, 'area')), name = norm(get(r, 'room name'));
    if (isExample(area, name)) continue;
    const row = i + 1;
    if (!name) { problems.push({ row, why: 'name' }); continue; }
    if (!area) { problems.push({ row, why: 'area' }); continue; }
    const kind = matchName(kinds as (Pick<CalKind, 'id' | 'name' | 'sleeps'>)[], get(r, 'kind'));
    if (!kind) { problems.push({ row, why: 'kind' }); continue; }
    const k = `${key(area)}|${key(name)}`;
    if (seen.has(k)) { problems.push({ row, why: 'twice' }); continue; }
    seen.add(k);
    const rent = yesNo(get(r, 'rentable'));
    if (rent === null && norm(get(r, 'rentable'))) { problems.push({ row, why: 'rentable' }); continue; }
    spaces.push({
      row, area, floor: norm(get(r, 'floor')) || null, name, kind_id: kind.id,
      beds: kind.sleeps ? count(get(r, 'beds')) ?? 0 : 0, capacity: kind.sleeps ? 0 : count(get(r, 'capacity (people)')) ?? 0,
      rentable: rent ?? true, rentableGiven: rent !== null, fixed: norm(get(r, 'always in the room')) || null, note: norm(get(r, 'note')) || null,
    });
  }
  return { spaces, problems };
}

export interface SheetOrg { row: number; name: string; kind_id: number | null; note: string | null; persons: { name: string; phone: string | null }[] }
/** the sheet "Organisations · الجهات": a name, a kind (from the list, or left empty), up to two persons with their phones */
export function readOrgsSheet(rows: unknown[][], kinds: Pick<CalOrgKind, 'id' | 'name'>[]): { orgs: SheetOrg[]; problems: SheetProblem[] } {
  const h = headers(rows, 'organisation');
  const orgs: SheetOrg[] = [], problems: SheetProblem[] = [];
  if (!h) return { orgs, problems };
  const get = (r: unknown[], k: string) => (h.col.has(k) ? r[h.col.get(k)!] : undefined);
  const seen = new Set<string>();
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (!r.some((c) => norm(c))) continue;
    const name = norm(get(r, 'organisation'));
    if (isExample(name, get(r, 'person in charge'))) continue;
    const row = i + 1;
    if (!name) { problems.push({ row, why: 'name' }); continue; }
    if (seen.has(key(name))) { problems.push({ row, why: 'twice' }); continue; }
    seen.add(key(name));
    const kindTyped = norm(get(r, 'kind'));
    const kind = kindTyped ? matchName(kinds as Pick<CalOrgKind, 'id' | 'name'>[], kindTyped) : undefined;
    if (kindTyped && !kind) { problems.push({ row, why: 'kind' }); continue; }
    const persons = [[get(r, 'person in charge'), get(r, 'phone')], [get(r, 'second person'), get(r, 'phone 2')]]
      .map(([n, p]) => ({ name: norm(n), phone: norm(p) || null })).filter((p) => p.name);
    orgs.push({ row, name, kind_id: kind?.id ?? null, note: norm(get(r, 'note')) || null, persons });
  }
  return { orgs, problems };
}
