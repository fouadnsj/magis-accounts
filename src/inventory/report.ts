// Inventory step 4 (baseline 1.1, sections 5 and 8): pure rules for the printed pages and the donor report.
// "What a project bought": the items bought on the budget lines funded by that project, in the chosen period (months), with
// their photos, spaces and values: a PDF with photos for the donor and an Excel. The rules are here, the pages in io/invPaper.ts.
import type { InvCategory, InvItem, InvPhoto } from './inv';
import { itemTotal } from './inv';
import { spaceOfPlace, type MapArea, type MapSpace } from './map';

/** one purchase found by the server: the item and the entry it was bought with (the entry sits on a line of the project, in the period) */
export interface BoughtFor { item_id: number; trx_id: string; date: string | null; line_id: number | null; heading_id: number | null; party_id: number | null }

/** what the register says about an entry (the bill code, the supplier, the line), as the screens know it */
export interface EntryInfo { bill: string; supplier: string; heading: string; line: string }

export interface ReportRow {
  item: InvItem;
  category: string;
  /** the space as the map names it ("Area · Space"), or '' when it has none */
  space: string;
  date: string | null;
  bill: string;
  supplier: string;
  heading: string;
  line: string;
  units: number;
  /** the value of the item (one unit × units), USD; null when none was given */
  value: number | null;
  /** the first photo of the item */
  photo: string | null;
  /** it left the inventory (given away, lost): still bought for the project, so still listed, and said so */
  out: boolean;
}
export interface ProjectReport {
  rows: ReportRow[];
  items: number;
  units: number;
  value: number;
  /** the items without a photo (the donor may ask) */
  noPhoto: number;
  bySpace: { space: string; items: number; units: number; value: number }[];
}

/** the months of a period: "2026-01" to "2026-12" (both included) */
export const inMonths = (day: string | null | undefined, from: string, to: string) => !!day && day.slice(0, 7) >= from && day.slice(0, 7) <= to;

/** The report of a project: the items found, in the order of their purchase, with what the donor reads; totals and by space. */
export function projectReport(a: {
  found: BoughtFor[];
  items: InvItem[];
  categories: Pick<InvCategory, 'id' | 'name'>[];
  photos: Pick<InvPhoto, 'id' | 'item_id'>[];
  areas: MapArea[];
  spaces: MapSpace[];
  entry: (trxId: string) => EntryInfo;
  spaceName: (placeId: number | null) => string;
}): ProjectReport {
  const byId = new Map(a.items.map((i) => [i.id, i]));
  const first = new Map<number, string>();
  for (const p of a.photos) if (!first.has(p.item_id)) first.set(p.item_id, p.id);
  const rows: ReportRow[] = [];
  for (const f of a.found) {
    const item = byId.get(f.item_id);
    if (!item) continue;
    const e = a.entry(f.trx_id);
    rows.push({
      item, category: a.categories.find((c) => c.id === item.category_id)?.name ?? '', space: a.spaceName(item.place_id), date: f.date, bill: e.bill, supplier: e.supplier, heading: e.heading, line: e.line,
      units: item.qty, value: item.value_usd != null ? Math.round(itemTotal(item) * 100) / 100 : null, photo: first.get(item.id) ?? null, out: item.status !== 'in_use',
    });
  }
  rows.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? '') || x.item.code.localeCompare(y.item.code));
  const spaces = new Map<string, { space: string; items: number; units: number; value: number }>();
  for (const r of rows) {
    const key = r.out ? '—' : r.space || '—';
    const s = spaces.get(key) ?? { space: key, items: 0, units: 0, value: 0 };
    s.items++; s.units += r.units; s.value += r.value ?? 0;
    spaces.set(key, s);
  }
  return {
    rows,
    items: rows.length,
    units: rows.reduce((n, r) => n + r.units, 0),
    value: Math.round(rows.reduce((n, r) => n + (r.value ?? 0), 0) * 100) / 100,
    noPhoto: rows.filter((r) => !r.photo).length,
    bySpace: [...spaces.values()].map((s) => ({ ...s, value: Math.round(s.value * 100) / 100 })).sort((x, y) => y.value - x.value || x.space.localeCompare(y.space)),
  };
}

// ------------------------------------------------------------------ the printed pages

/** The items of a space that go on its sheet or its counting list: in use, by label (a group's parts together). */
export function itemsOfSpace(items: InvItem[], space: Pick<MapSpace, 'place_id'>): InvItem[] {
  if (space.place_id == null) return [];
  return items.filter((i) => i.status === 'in_use' && i.place_id === space.place_id).sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
}

/** The spaces of a counting list, in the order of the map (area, then space), only those with something in them. */
export function countingPlan(a: { areas: MapArea[]; spaces: MapSpace[]; items: InvItem[] }, only?: Set<number>): { area: MapArea; space: MapSpace; items: InvItem[] }[] {
  const out: { area: MapArea; space: MapSpace; items: InvItem[] }[] = [];
  for (const area of [...a.areas].filter((x) => x.active).sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name))) {
    for (const space of a.spaces.filter((s) => s.building_id === area.id && s.active).sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name))) {
      if (only && !only.has(space.id)) continue;
      const items = itemsOfSpace(a.items, space);
      if (items.length) out.push({ area, space, items });
    }
  }
  return out;
}

/** The name of a space of an item, for a donor: "Area · Space" (a store of "Inventory places" by its own name). */
export function placeLabel(a: { areas: MapArea[]; spaces: MapSpace[]; places: { id: number; name: string }[] }, placeId: number | null, invArea: string): string {
  const sp = spaceOfPlace(a.spaces, placeId);
  if (!sp) return a.places.find((p) => p.id === placeId)?.name ?? '';
  const area = a.areas.find((x) => x.id === sp.building_id);
  return area && area.name !== invArea ? `${area.name} · ${sp.name}` : sp.name;
}
