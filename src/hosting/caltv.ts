// The TV at the entrance (baseline 2.1, section 4; step 7, plain version): today's halls and what happens in each, hour by hour
// from 08:00 to 22:00. Read only. It shows the names of the groups, never prices, payments, contacts, notes or leaders: a private
// booking shows only "Reserved · محجوز". The server cuts the calendar like the Team phone (src/hosting/calphone.ts) and then
// makes this small screen, so the TV receives nothing else. Pure functions, tested in tests/caltv.test.ts.
import { closedOn, inCalendar, periodOn, sleepsIn, type CalData } from './calendar';
import { itemsBetween } from './calview';

export const TV_FROM = 8 * 60;
export const TV_TO = 22 * 60;

export interface TvItem { from: number; to: number; title: string; /** to confirm: shown paler */ hold: boolean; people: number }
export interface TvSpace { id: number; name: string; /** closed for repairs today (nothing else is said) */ shut: boolean; items: TvItem[] }
export interface TvArea { name: string; color: string | null; spaces: TvSpace[] }
export interface TvScreen {
  organisation: string;
  /** the day shown (the server's day) */
  day: string;
  /** when the server made it */
  asOf: string;
  from: number;
  to: number;
  areas: TvArea[];
  /** our activities outside the centre today: what and where */
  outside: { title: string; place: string; from: number; to: number }[];
  /** the groups staying in the house tonight (names only) */
  staying: string[];
  /** a closed period of the centre today (holidays): its name */
  period: string | null;
}

/** the screen of a day, from a calendar already cut like the Team phone's */
export function tvScreen(d: CalData, day: string, organisation = '', asOf = ''): TvScreen {
  const items = (itemsBetween(d, day, day).get(day) ?? []).filter((it) => it.b.status !== 'left' || it.b.kind !== 'stay');
  const halls = d.spaces.filter((s) => inCalendar(s) && !sleepsIn(s, d.kinds));
  const areas: TvArea[] = [];
  for (const a of [...d.areas].filter((x) => x.active).sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name))) {
    const spaces: TvSpace[] = halls
      .filter((s) => s.building_id === a.id && s.active)
      .sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name))
      .map((s) => ({
        id: s.id,
        name: s.name,
        shut: !!closedOn(d.closed, s.id, day),
        items: items
          .filter((it) => it.b.kind !== 'stay' && it.spaces.includes(s.id))
          .map((it) => ({ from: it.occ.from, to: it.occ.to, title: it.b.group_name, hold: it.b.status === 'option', people: it.b.people || 0 })),
      }));
    if (spaces.length) areas.push({ name: a.name, color: a.color, spaces });
  }
  return {
    organisation,
    day,
    asOf,
    from: TV_FROM,
    to: TV_TO,
    areas,
    outside: items.filter((it) => it.b.outside_place && !it.b.whole_centre).map((it) => ({ title: it.b.group_name, place: it.b.outside_place!, from: it.occ.from, to: it.occ.to })),
    staying: [...new Set(items.filter((it) => it.b.kind === 'stay').map((it) => it.b.group_name))],
    period: periodOn(d.periods, day)?.name ?? null,
  };
}
