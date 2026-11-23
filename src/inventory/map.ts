// Inventory step 1 (baseline 1.1, 24 November 2026): ONE map of the centre, kept once. The areas and spaces are the
// calendar's (host_building, host_room); each space is also a place of the inventory (host_room.place_id → inv_place), so
// the items keep their place and their history. A space that cannot be booked (a store, an office) is only in the
// inventory. Pure functions here: shared by the server operations, the screens and the tests.
import type { InvCategory, InvItem, InvPhoto, InvPlace } from './inv';

/** an area of the map (the calendar's area, with its colour) */
export interface MapArea { id: number; name: string; color: string | null; active: number; sort: number }
/** a space of the map, as the inventory needs it */
export interface MapSpace { id: number; building_id: number; name: string; floor: string | null; active: number; sort: number; place_id: number | null; bookable: number; fixed: string | null }

/** The area made by update 69 for the places of the 0.12 inventory that were not spaces (stores…). */
export const INV_AREA = 'Inventory places · أماكن الجرد';

/** The name of a space as the inventory shows it: "Area · Space" (a store of "Inventory places" by its own name). */
export const spaceLabel = (area: Pick<MapArea, 'name'> | null | undefined, space: Pick<MapSpace, 'name'>) => (area && area.name !== INV_AREA ? `${area.name} · ${space.name}` : space.name);

/** The space of a place of the inventory (null: the place is not on the map, which update 69 leaves for none). */
export const spaceOfPlace = <S extends Pick<MapSpace, 'place_id'>>(spaces: S[], placeId: number | null | undefined): S | null =>
  placeId == null ? null : spaces.find((s) => s.place_id === placeId) ?? null;

// ------------------------------------------------------------------ the map (home of the inventory)

export interface MapCard {
  space: MapSpace;
  label: string;
  /** shown in the calendar too */
  bookable: boolean;
  /** items in use here (a group counts once) */
  items: number;
  /** units (Chairs ×60 count 60) */
  units: number;
  /** USD; null when this person does not see the values */
  value: number | null;
  /** the last day something here was counted */
  lastCount: string | null;
  /** items to repair or broken */
  attention: number;
  /** the first photo of an item here, to show on the card */
  photo: string | null;
}
export interface MapView {
  areas: { area: MapArea; spaces: MapCard[] }[];
  /** items in use with no place yet */
  unplaced: number;
  /** places of the inventory that are not a space (none after update 69; kept so nothing is ever hidden) */
  loose: InvPlace[];
}

/** The map: each area with a card per space (items, value for those who may see it, last count, what needs attention). */
export function invMap(d: { areas: MapArea[]; spaces: MapSpace[]; places: InvPlace[]; items: InvItem[]; photos?: InvPhoto[] }, o: { values: boolean; withInactive?: boolean } = { values: true }): MapView {
  const live = d.items.filter((i) => i.status === 'in_use');
  const byPlace = new Map<number, InvItem[]>();
  for (const i of live) if (i.place_id != null) byPlace.set(i.place_id, [...(byPlace.get(i.place_id) ?? []), i]);
  const firstPhoto = new Map<number, string>();
  for (const p of d.photos ?? []) if (!firstPhoto.has(p.item_id)) firstPhoto.set(p.item_id, p.id);
  const card = (a: MapArea, s: MapSpace): MapCard => {
    const here = s.place_id != null ? byPlace.get(s.place_id) ?? [] : [];
    return {
      space: s,
      label: spaceLabel(a, s),
      bookable: s.bookable !== 0,
      items: here.length,
      units: here.reduce((n, i) => n + i.qty, 0),
      value: o.values ? Math.round(here.reduce((n, i) => n + (i.value_usd ?? 0) * i.qty, 0) * 100) / 100 : null,
      lastCount: here.reduce<string | null>((m, i) => (i.counted_on && (!m || i.counted_on > m) ? i.counted_on : m), null),
      attention: here.filter((i) => i.condition !== 'good').length,
      photo: here.map((i) => firstPhoto.get(i.id)).find(Boolean) ?? null,
    };
  };
  const onMap = new Set(d.spaces.map((s) => s.place_id).filter((x): x is number => x != null));
  return {
    areas: d.areas
      .filter((a) => o.withInactive || a.active)
      .map((a) => ({ area: a, spaces: d.spaces.filter((s) => s.building_id === a.id && (o.withInactive || s.active)).sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name)).map((s) => card(a, s)) }))
      .filter((x) => o.withInactive || x.spaces.length || x.area.name !== INV_AREA),
    unplaced: live.filter((i) => i.place_id == null).length,
    loose: d.places.filter((p) => !onMap.has(p.id)),
  };
}

// ------------------------------------------------------------------ categories with three ticks

/** What a valuable item still lacks: a photo (valuable category), a serial number (category that expects one). */
export function itemAsks(i: Pick<InvItem, 'id' | 'category_id' | 'serial' | 'status'>, categories: Pick<InvCategory, 'id' | 'serial' | 'valuable'>[], photos: Pick<InvPhoto, 'item_id'>[]): ('photo' | 'serial')[] {
  if (i.status !== 'in_use') return [];
  const c = categories.find((x) => x.id === i.category_id);
  if (!c) return [];
  const out: ('photo' | 'serial')[] = [];
  if (c.valuable && !photos.some((p) => p.item_id === i.id)) out.push('photo');
  if (c.serial && !(i.serial ?? '').trim()) out.push('serial');
  return out;
}

/** One line of "always in the room": a name and how many (a group counts its units). */
export interface InRoom { room_id: number; name: string; qty: number }

/**
 * "Always in the room" of a space, read from the inventory (baseline §6): the items in use there whose category is ticked
 * "shown in the calendar", grouped by name. While the inventory holds nothing of the kind for that space, the text typed
 * in the calendar's settings (calendar step 1) is still shown, so nothing is lost before the keeper has listed the items.
 */
export function alwaysInRoom(space: Pick<MapSpace, 'id' | 'fixed'>, inRoom: InRoom[]): { items: { name: string; qty: number }[]; typed: string | null } {
  const items = inRoom.filter((x) => x.room_id === space.id).map(({ name, qty }) => ({ name, qty }));
  return { items, typed: items.length ? null : (space.fixed ?? '').trim() || null };
}

/** The lines of "always in the room" from the items themselves (the server does the same in SQL). */
export function inRoomOf(spaces: Pick<MapSpace, 'id' | 'place_id'>[], items: Pick<InvItem, 'name' | 'qty' | 'place_id' | 'category_id' | 'status'>[], categories: Pick<InvCategory, 'id' | 'in_calendar'>[]): InRoom[] {
  const shown = new Set(categories.filter((c) => c.in_calendar).map((c) => c.id));
  const out = new Map<string, InRoom>();
  for (const s of spaces) {
    if (s.place_id == null) continue;
    for (const i of items) {
      if (i.status !== 'in_use' || i.place_id !== s.place_id || i.category_id == null || !shown.has(i.category_id)) continue;
      const k = `${s.id}|${i.name.trim().toLowerCase()}`;
      const x = out.get(k);
      if (x) x.qty += i.qty;
      else out.set(k, { room_id: s.id, name: i.name.trim(), qty: i.qty });
    }
  }
  return [...out.values()].sort((a, b) => a.room_id - b.room_id || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ a group that splits

const GROUP = /^(.*\d)-([A-Z]+)$/i;

/** The label of the group a part belongs to (HO-0102-B → HO-0102); a label with no letter is its own group. */
export const groupOf = (code: string) => GROUP.exec(code.trim())?.[1] ?? code.trim();
/** The letter of a part (HO-0102-B → B), or null. */
export const partLetter = (code: string) => GROUP.exec(code.trim())?.[2]?.toUpperCase() ?? null;

/** A, B … Z, AA, AB … */
const toLetters = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const fromLetters = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/**
 * The labels when part of a group moves (baseline §3: Chairs ×30 here, ×30 there, the same label with a letter).
 * The first split gives the letters A (what stays) and B (what moves); a part that splits again keeps its letter and
 * the moving part takes the next free letter of the group.
 */
export function splitLabels(code: string, existing: string[]): { stays: string; moves: string } {
  const base = groupOf(code);
  const used = existing.map((c) => c.trim()).filter((c) => groupOf(c).toLowerCase() === base.toLowerCase() && partLetter(c)).map((c) => fromLetters(partLetter(c)!));
  const taken = new Set(existing.map((c) => c.trim().toLowerCase()));
  let n = Math.max(0, ...used);
  const next = () => { let l = ''; do { n += 1; l = `${base}-${toLetters(n)}`; } while (taken.has(l.toLowerCase())); taken.add(l.toLowerCase()); return l; };
  const stays = partLetter(code) ? code.trim() : next();
  return { stays, moves: next() };
}

/** Can `qty` units of this item move apart? Whole numbers, at least one, fewer than all (all = the item moves). */
export function splitProblem(item: Pick<InvItem, 'qty' | 'status'>, qty: number): 'out' | 'qty' | null {
  if (item.status !== 'in_use') return 'out';
  return Number.isInteger(qty) && qty >= 1 && qty < item.qty ? null : 'qty';
}

/** A scanned label finds its item; the label of a group that was split finds all its parts (the sticker is older). */
export function findByLabel<T extends Pick<InvItem, 'code'>>(items: T[], scanned: string): T[] {
  const s = scanned.trim().toLowerCase();
  if (!s) return [];
  const exact = items.filter((i) => i.code.toLowerCase() === s);
  if (exact.length) return exact;
  return items.filter((i) => partLetter(i.code) && groupOf(i.code).toLowerCase() === s);
}

// ------------------------------------------------------------------ rights (baseline §2)

export interface InvRights {
  /** looks at the map, the spaces, the items */
  look: boolean;
  /** sees the values ($) */
  values: boolean;
  /** the keeper: adds, moves, counts, takes out, sets the state, gives to a staff member */
  keep: boolean;
  /** reports a problem: everyone (no tick) */
  report: boolean;
}
export function invRights(perms: readonly string[]): InvRights {
  const keep = perms.includes('inventory.manage');
  return { keep, values: keep || perms.includes('inventory.values'), look: keep || perms.includes('inventory.values') || perms.includes('inventory.view'), report: true };
}

/** What a person who does not see the values receives: the same items without any amount. */
export function withoutValues<T extends { items: InvItem[] }>(d: T, values: boolean): T {
  return values ? d : { ...d, items: d.items.map((i) => ({ ...i, value_usd: null, value_note: null })) };
}
