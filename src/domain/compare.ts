// What changed in the register since a backup: rows added, deleted, changed
// (with the fields that differ). Used to find a mistake and put one row back.
import type { Trx } from './types';

/** The fields a person types: the ones compared and put back. */
export const ENTRY_FIELDS = [
  'date', 'type', 'book_id', 'account_id', 'city_id', 'heading_id', 'line_id', 'party_id', 'explanation', 'receipt',
  'inc_syp', 'exp_syp', 'inc_usd', 'exp_usd', 'trf_syp', 'trf_usd',
  'bill_date', 'rate', 'cancelled_at', 'cancel_reason',
] as const;
export type EntryField = (typeof ENTRY_FIELDS)[number];

export interface RowChange {
  before: Trx;
  after: Trx;
  fields: EntryField[];
}

export interface Comparison {
  added: Trx[];
  deleted: Trx[];
  changed: RowChange[];
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

export function compareRows(then: Trx[], now: Trx[]): Comparison {
  const old = new Map(then.map((r) => [r.id, r]));
  const cur = new Map(now.map((r) => [r.id, r]));
  const added = now.filter((r) => !old.has(r.id));
  const deleted = then.filter((r) => !cur.has(r.id));
  const changed: RowChange[] = [];
  for (const r of now) {
    const b = old.get(r.id);
    if (!b) continue;
    const fields = ENTRY_FIELDS.filter((f) => !same(b[f], r[f]));
    if (fields.length) changed.push({ before: b, after: r, fields });
  }
  return { added, deleted, changed };
}
