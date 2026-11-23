// What the calendar's laptop screen shows (baseline 2.1 §8, step 2): the bookings of a day or a week, the Today strip, the
// lists (upcoming, in the house, to confirm, past) and the search. Pure functions, tested in tests/calview.test.ts.
import { addDays } from './host';
import { categoryOf, closedOn, holdPassed, occurrences, periodOn, sleepsIn, spacesOn, type CalBooking, type CalData, type CalSpace, type Occurrence } from './calendar';

/** the Monday of a day's week (the week starts on Monday in every language) */
export const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
export const weekOf = (d: string) => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(d), i));
/** the days shown for a month: from the Monday before the 1st to the Sunday after the last day */
export function monthGrid(d: string): string[] {
  const first = `${d.slice(0, 7)}-01`;
  const next = new Date(`${first}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(next.toISOString().slice(0, 10), -1);
  const out: string[] = [];
  for (let x = mondayOf(first); x <= addDays(mondayOf(last), 6); x = addDays(x, 1)) out.push(x);
  return out;
}
export const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** one booking on one day: its hours and the spaces it holds that day */
export interface DayItem { b: CalBooking; occ: Occurrence; spaces: number[] }

/** every booking that has a date in [from, to], day by day (a cancelled booking has none) */
export function itemsBetween(d: Pick<CalData, 'bookings' | 'dates' | 'allocs' | 'spaces' | 'closed'>, from: string, to: string): Map<string, DayItem[]> {
  const out = new Map<string, DayItem[]>();
  for (const b of d.bookings) {
    if (b.status === 'cancelled') continue;
    for (const occ of occurrences(b, d.dates)) {
      if (occ.day < from || occ.day > to) continue;
      const list = out.get(occ.day) ?? [];
      list.push({ b, occ, spaces: b.outside_place && !b.whole_centre ? [] : spacesOn(b, occ.day, d) });
      out.set(occ.day, list);
    }
  }
  for (const list of out.values()) list.sort((x, y) => x.occ.from - y.occ.from || x.b.group_name.localeCompare(y.b.group_name));
  return out;
}

/** the spaces of a quick view: everything, or the spaces of one category (and of one area when chosen) */
export function spacesShown(d: Pick<CalData, 'spaces' | 'kinds'>, category: number | null, area: number | null): CalSpace[] {
  return d.spaces.filter((s) => s.active && (area == null || s.building_id === area) && (category == null || categoryOf(s, d.kinds) === category));
}

// ------------------------------------------------------------------ the Today strip

export interface TodayFigures {
  arrive: CalBooking[];
  leave: CalBooking[];
  /** halls (spaces with no beds) used right now, with what uses them */
  inUse: { space: CalSpace; b: CalBooking; occ: Occurrence }[];
  /** bedrooms free tonight (one group per bedroom: rooms, not beds) */
  freeTonight: CalSpace[];
  toConfirm: CalBooking[];
  /** of those, the ones whose held date has passed (shown in red) */
  passed: number;
}
export function todayFigures(d: CalData, today: string, nowMin: number): TodayFigures {
  const live = d.bookings.filter((b) => b.status !== 'cancelled');
  const stays = live.filter((b) => b.kind === 'stay');
  const items = itemsBetween(d, today, today).get(today) ?? [];
  const halls = new Map(d.spaces.filter((s) => s.active && !sleepsIn(s, d.kinds)).map((s) => [s.id, s]));
  const inUse: TodayFigures['inUse'] = [];
  for (const it of items) if (it.occ.from <= nowMin && nowMin < it.occ.to) for (const id of it.spaces) { const s = halls.get(id); if (s) inUse.push({ space: s, b: it.b, occ: it.occ }); }
  const heldTonight = new Set(items.flatMap((it) => it.spaces));
  const freeTonight = d.spaces.filter((s) => s.active && sleepsIn(s, d.kinds) && !heldTonight.has(s.id) && !closedOn(d.closed, s.id, today));
  const toConfirm = live.filter((b) => b.status === 'option' && b.to_day >= today).sort((x, y) => x.from_day.localeCompare(y.from_day));
  return {
    arrive: stays.filter((b) => b.from_day === today && b.status !== 'left'),
    leave: stays.filter((b) => b.to_day === today && b.status !== 'left'),
    inUse, freeTonight, toConfirm, passed: toConfirm.filter((b) => holdPassed(b, today)).length,
  };
}

// ------------------------------------------------------------------ the lists

export type ListKind = 'upcoming' | 'house' | 'confirm' | 'past';
/** the next date of a booking from a day (or its last one, when all are past) */
export function nextDate(b: CalBooking, d: Pick<CalData, 'dates'>, from: string): string | null {
  const occ = occurrences({ ...b, status: b.status === 'cancelled' ? 'confirmed' : b.status }, d.dates);
  return occ.find((o) => o.day >= from)?.day ?? occ[occ.length - 1]?.day ?? null;
}
/**
 * Upcoming (a date today or later), In the house (guests arrived and not left), To confirm (held: the passed dates first),
 * Past (every date before today). Cancelled bookings are only in Past.
 */
export function listOf(d: CalData, kind: ListKind, today: string): { b: CalBooking; next: string | null }[] {
  const rows = d.bookings.map((b) => ({ b, next: nextDate(b, d, today) }));
  if (kind === 'house') return rows.filter((r) => r.b.status === 'arrived').sort((x, y) => x.b.to_day.localeCompare(y.b.to_day));
  if (kind === 'confirm') return rows.filter((r) => r.b.status === 'option' && (r.next ?? '') >= today).sort((x, y) => (holdPassed(y.b, today) ? 1 : 0) - (holdPassed(x.b, today) ? 1 : 0) || (x.next ?? '').localeCompare(y.next ?? ''));
  if (kind === 'upcoming') return rows.filter((r) => r.b.status !== 'cancelled' && r.next != null && r.next >= today).sort((x, y) => x.next!.localeCompare(y.next!));
  return rows.filter((r) => r.b.status === 'cancelled' || r.next == null || r.next < today).sort((x, y) => (y.next ?? y.b.from_day).localeCompare(x.next ?? x.b.from_day));
}

// ------------------------------------------------------------------ search

const fold = (x: unknown) => String(x ?? '').toLowerCase().normalize('NFKD').replace(/[ً-ْ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
/**
 * Names, organisations, leaders, phones (only what this person receives), spaces and notes. Each result has its next date.
 * Several words: every word must be found.
 */
export function search(d: CalData, q: string, today: string): { b: CalBooking; next: string | null; where: string[] }[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const org = new Map(d.orgs.map((o) => [o.id, o]));
  const persons = d.persons;
  const space = new Map(d.spaces.map((s) => [s.id, s.name]));
  const out: { b: CalBooking; next: string | null; where: string[] }[] = [];
  for (const b of d.bookings) {
    const o = b.org_id != null ? org.get(b.org_id) : undefined;
    const fields: [string, unknown][] = [
      ['name', b.group_name], ['subject', b.subject], ['leader', b.leader], ['note', b.note], ['place', b.outside_place], ['code', b.code],
      ['contact', b.contact], ['phone', b.phone], ['org', o?.name], ['org note', o?.note],
      ['persons', persons.filter((p) => p.org_id === b.org_id).map((p) => `${p.name} ${p.phone ?? ''}`).join(' ')],
      ['spaces', d.allocs.filter((a) => a.booking_id === b.id).map((a) => space.get(a.room_id)).join(' ')],
    ];
    const hay = fields.map(([k, v]) => [k, fold(v)] as const);
    if (!words.every((w) => hay.some(([, v]) => v.includes(w)))) continue;
    out.push({ b, next: nextDate(b, d, today), where: hay.filter(([, v]) => words.some((w) => v.includes(w))).map(([k]) => k) });
  }
  return out.sort((x, y) => {
    const fx = (x.next ?? '') >= today ? 0 : 1, fy = (y.next ?? '') >= today ? 0 : 1;
    return fx - fy || (fx ? (y.next ?? '').localeCompare(x.next ?? '') : (x.next ?? '').localeCompare(y.next ?? ''));
  });
}

/** the closed period of the centre on a day, and whether a space is closed for repairs (for the bands of the screen) */
export const bandOf = (d: Pick<CalData, 'periods'>, day: string) => periodOn(d.periods, day);
export const shutOf = (d: Pick<CalData, 'closed'>, spaceId: number, day: string) => closedOn(d.closed, spaceId, day);
