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

export interface HostBuilding { id: number; name: string; active: number; sort: number }
export interface HostRoom { id: number; building_id: number; name: string; beds: number; kind: RoomKind; active: number; sort: number; place_id: number | null }
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
export interface HostLine { id: number; booking_id: number; service_id: number | null; label: string; qty: number; amount: number }
export interface HostPay {
  id: number; booking_id: number; amount: number; currency: Currency; paid_on: string; method: string; receipt_no: string;
  status: 'suggested' | 'refused'; note: string | null; who: string | null; at: string;
}

/** What the screens receive. The amounts are null (and `pays` empty) for someone who does not keep the calendar. */
export interface HostData {
  buildings: HostBuilding[];
  rooms: HostRoom[];
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

/** the days a booking holds its rooms: a stay holds its nights (not the day of leaving); an event holds every day, both ends included */
export function heldDays(b: Pick<HostBooking, 'kind' | 'from_day' | 'to_day'>): string[] {
  const out: string[] = [];
  const last = b.kind === 'event' ? b.to_day : addDays(b.to_day, -1);
  for (let d = b.from_day; d <= last && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
export const nightsOf = (b: Pick<HostBooking, 'kind' | 'from_day' | 'to_day'>) => heldDays(b).length;

/** a room holds its beds; a hall or a room with no beds counts as one place, taken whole */
export const capacity = (r: Pick<HostRoom, 'beds'>) => Math.max(1, r.beds || 0);

/** Why a booking cannot be saved as it is (null: fine). */
export function checkBooking(b: Pick<HostBooking, 'kind' | 'from_day' | 'to_day' | 'group_name' | 'people'>): string | null {
  if (!b.group_name.trim()) return 'name';
  if (!isDay(b.from_day) || !isDay(b.to_day)) return 'dates';
  if (b.kind === 'stay' ? b.to_day <= b.from_day : b.to_day < b.from_day) return 'order';
  if (diffDays(b.from_day, b.to_day) > 370) return 'long';
  if (!(b.people >= 0)) return 'people';
  return null;
}

// ------------------------------------------------------------------ conflicts

const HOLDING: BookingStatus[] = ['confirmed', 'arrived'];
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
  b: Pick<HostBooking, 'id' | 'kind' | 'from_day' | 'to_day'>, mine: HostAlloc[], all: { bookings: HostBooking[]; allocs: HostAlloc[]; rooms: HostRoom[] },
  against: 'sure' | 'any' = 'sure',
): Conflict[] {
  const room = new Map(all.rooms.map((r) => [r.id, r]));
  const days = new Set(heldDays(b));
  const others = all.bookings.filter((o) => o.id !== b.id && (against === 'sure' ? holds(o) : live(o)));
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

// ------------------------------------------------------------------ amounts

/** the stay itself: people × nights × the rate, or the group's fixed price; the services come on top */
export function stayAmount(b: Pick<HostBooking, 'kind' | 'from_day' | 'to_day' | 'people' | 'price_mode' | 'rate'>): number {
  if (b.rate == null || !b.price_mode) return 0;
  return Math.round((b.price_mode === 'group' ? b.rate : b.rate * b.people * nightsOf(b)) * 100) / 100;
}
export const bookingTotal = (b: Parameters<typeof stayAmount>[0], lines: Pick<HostLine, 'amount'>[]) =>
  Math.round((stayAmount(b) + lines.reduce((s, l) => s + (l.amount || 0), 0)) * 100) / 100;

/** what is still due in the booking's currency (payments in the other currency are not counted) */
export function dueOf(total: number, currency: Currency, pays: Pick<HostPay, 'amount' | 'currency' | 'status'>[]): number {
  const paid = pays.filter((p) => p.status !== 'refused' && p.currency === currency).reduce((s, p) => s + p.amount, 0);
  return Math.round((total - paid) * 100) / 100;
}

// ------------------------------------------------------------------ numbers

/** HB-2026-0007: the next booking number of a year */
export function nextCode(existing: string[], year: number): string {
  const re = new RegExp(`^HB-${year}-(\\d+)$`);
  const n = Math.max(0, ...existing.map((c) => Number(re.exec(c)?.[1] ?? 0)));
  return `HB-${year}-${String(n + 1).padStart(4, '0')}`;
}
/** H2026-0007: the next receipt number of a year (it goes on the entry of the register) */
export function nextReceipt(existing: string[], year: number): string {
  const re = new RegExp(`^H${year}-(\\d+)$`);
  const n = Math.max(0, ...existing.map((c) => Number(re.exec(c)?.[1] ?? 0)));
  return `H${year}-${String(n + 1).padStart(4, '0')}`;
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
