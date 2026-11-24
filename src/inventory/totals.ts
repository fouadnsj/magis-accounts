// The big totals of the inventory (Fouad, 26 November 2026): the figure on the inventory home, and the sum of each space.
// The value of each object stays with whoever keeps the inventory; only the Administrator (the tick `inventory.totals`)
// receives these sums: the server works them out and sends them to him alone (src/inventory/ops.ts `load`).
import { itemTotal } from './inv';
import type { InvItem } from './inv';
import type { MapSpace } from './map';

/** what the Administrator receives; everyone else receives `null` */
export interface InvTotals {
  /** USD, every item in use */
  all: number;
  /** USD, the items in use in each space (by the id of the space) */
  spaces: Record<number, number>;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function invTotals(d: { items: InvItem[]; spaces: Pick<MapSpace, 'id' | 'place_id'>[] }): InvTotals {
  const live = d.items.filter((i) => i.status === 'in_use');
  const spaces: Record<number, number> = {};
  for (const s of d.spaces) spaces[s.id] = s.place_id == null ? 0 : cents(live.filter((i) => i.place_id === s.place_id).reduce((n, i) => n + itemTotal(i), 0));
  return { all: cents(live.reduce((n, i) => n + itemTotal(i), 0)), spaces };
}
