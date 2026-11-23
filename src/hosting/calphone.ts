// The calendar phone (baseline 2.1, sections 3 and 4; step 5). A phone is linked once at the centre by a manager, who gives it
// a name and a role. It is read only, keeps 1 month back and 6 months ahead, says when it was last updated, never receives
// prices or payments, and receives the contacts (person and phone) only when its role is Reception, Coordinator or Director.
// A private booking shows only "Reserved" on every phone. Pure functions (the server cuts, the phone reads), tested in
// tests/calphone.test.ts.
import { RESERVED, occurrences, type CalData, type CalRights } from './calendar';

export type PhoneRole = 'team' | 'reception' | 'coordinator' | 'director';
export const PHONE_ROLES: PhoneRole[] = ['team', 'reception', 'coordinator', 'director'];
export const isPhoneRole = (x: unknown): x is PhoneRole => PHONE_ROLES.includes(x as PhoneRole);
export const ROLE_NAME: Record<PhoneRole, { ar: string; en: string; fr: string }> = {
  team: { ar: 'الفريق', en: 'Team', fr: 'Équipe' },
  reception: { ar: 'الاستقبال', en: 'Reception', fr: 'Réception' },
  coordinator: { ar: 'المنسّق', en: 'Coordinator', fr: 'Coordinateur' },
  director: { ar: 'المدير', en: 'Director', fr: 'Directeur' },
};
/** who receives the contacts (person in charge and phone) */
export const roleSeesContacts = (r: PhoneRole) => r !== 'team';

/** 1 month back and 6 months ahead, from a day */
export function windowOf(day: string): { from: string; to: string } {
  const move = (d: string, months: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    const dom = x.getUTCDate();
    x.setUTCDate(1);
    x.setUTCMonth(x.getUTCMonth() + months);
    const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
    x.setUTCDate(Math.min(dom, last));
    return x.toISOString().slice(0, 10);
  };
  return { from: move(day, -1), to: move(day, 6) };
}

/** what a phone of this role receives, from the whole calendar: no amounts, the window, the contacts by role, "Reserved" for the private */
export function phoneCut(all: CalData, role: PhoneRole, today: string): CalData {
  const { from, to } = windowOf(today);
  const contacts = roleSeesContacts(role);
  const rights: CalRights = { view: true, contacts, programme: false, outside: false, orgs: false, arrive: false, prices: false, money: false, whole: false, setup: false, history: false };
  const keep = all.bookings.filter((b) => b.status !== 'cancelled' && occurrences(b, all.dates).some((o) => o.day >= from && o.day <= to));
  const ids = new Set(keep.map((b) => b.id));
  const bookings = keep.map((b) => {
    let x = { ...b, price_state: null, price_mode: null, rate: null, price_each: 0, kept_usd: null, kept_syp: null, cancel_money: null, cancel_reason: null, cancelled_by: null, cancelled_at: null, created_by: null, receipt_printed: 0 } as typeof b;
    if (!contacts) x = { ...x, contact: null, phone: null, person_id: null };
    if (b.private) x = { ...x, group_name: RESERVED, subject: null, leader: null, note: null, org_id: null, contact: null, phone: null, person_id: null, outside_place: x.outside_place ? RESERVED : null };
    return x;
  });
  const orgIds = new Set(bookings.map((b) => b.org_id).filter((x): x is number => x != null));
  return {
    ...all,
    bookings,
    allocs: all.allocs.filter((a) => ids.has(a.booking_id)),
    dates: all.dates.filter((d) => ids.has(d.booking_id)),
    needs: all.needs.filter((n) => ids.has(n.booking_id)),
    closed: all.closed.filter((c) => !c.cancelled && c.to_day >= from && c.from_day <= to).map((c) => ({ ...c, who: null })),
    periods: all.periods.filter((p) => !p.cancelled && p.to_day >= from && p.from_day <= to).map((p) => ({ ...p, who: null })),
    orgs: contacts ? all.orgs.filter((o) => orgIds.has(o.id)).map((o) => ({ ...o, created_by: null })) : [],
    persons: contacts ? all.persons.filter((p) => orgIds.has(p.org_id)) : [],
    lines: [],
    pays: [],
    entered: [],
    services: [],
    rights,
  };
}

/** what the server sends to a calendar phone */
export interface CalPhonePack {
  phone: { id: string; name: string; role: PhoneRole };
  organisation: string;
  /** when this pack was made (the phone says "updated at …") */
  asOf: string;
  from: string;
  to: string;
  data: CalData;
}

/** a calendar phone as the managers see it */
export interface CalPhoneInfo { id: string; name: string; role: PhoneRole; created_by: string | null; created_at: string; linked_at: string | null; last_sync: string | null; revoked_at: string | null; revoked_by: string | null; waiting: boolean; link_until: string | null }


// ------------------------------------------------------------------ the link code (made by a manager, typed once on the phone)

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 8 letters and digits with no look-alikes, written XXXX-XXXX */
export function newLinkCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(b, (x) => CODE_LETTERS[x % CODE_LETTERS.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
/** what is typed, tidied (capitals, no dash or space; O and I are read as 0 and 1 are not used: the letters left out) */
export const normCode = (x: unknown) => String(x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
export async function shaHex(s: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
}
/** the link code works for 30 minutes */
export const LINK_MINUTES = 30;
