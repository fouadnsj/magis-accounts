// The heading and the line suggested for an income entry (Fouad, 26 November 2026). Pure, so it can be tested.
// - "Make the entry" from "Payments waiting for the books": money received is an Income, the heading is the Income heading
//   (found by its code I01, else the first heading of type Income, never by name) and the line comes from what the booking
//   is: a guest stay → I01.1, an outside hall/space booking → I01.6, our own activity paid by its participants → I01.8.
//   When the booking does not say, or the centre has no such line, the line is left empty (nothing clever).
// - In any entry window, an Income with only one income heading starts on that heading.
import type { BudgetLine, Heading, TrxType } from './types';

/** what the calendar knows of the booking a payment belongs to (null: it does not say, or the booking is private) */
export type PayHint = 'stay' | 'hall' | 'ours' | null;

const LINE_OF: Record<Exclude<PayHint, null>, string> = { stay: 'I01.1', hall: 'I01.6', ours: 'I01.8' };

type Lists = { headings: Pick<Heading, 'id' | 'code' | 'active'>[]; headingTypes: { heading_id: number; type: TrxType }[]; lines: Pick<BudgetLine, 'id' | 'heading_id' | 'code' | 'active'>[] };

/** the Income heading: the one coded I01, else the first active heading of type Income */
export function incomeHeading(L: Lists): number | null {
  const ofType = L.headings.filter((h) => h.active && L.headingTypes.some((x) => x.heading_id === h.id && x.type === 'Income'));
  return (ofType.find((h) => h.code === 'I01') ?? L.headings.find((h) => h.active && h.code === 'I01') ?? ofType[0])?.id ?? null;
}

/** the booking kind of a payment: our activity, a guest stay, or an outside hall booking (null: unknown) */
export function payHint(b: { origin?: string | null; kind?: string | null } | null | undefined): PayHint {
  if (!b) return null;
  if (b.origin === 'ours') return 'ours';
  if (b.origin === 'outside') return b.kind === 'stay' ? 'stay' : b.kind === 'event' ? 'hall' : null;
  return null;
}

/** heading and line for money received from the calendar; [null, null] when nothing is clear */
export function incomeClassForPay(L: Lists, hint: PayHint): [number | null, number | null] {
  const h = incomeHeading(L);
  if (h == null) return [null, null];
  const line = hint ? L.lines.find((l) => l.heading_id === h && l.active && l.code === LINE_OF[hint]) : undefined;
  return [h, line?.id ?? null];
}

/** an Income window with only one income heading starts on it (and on its only line); [null, null] otherwise */
export function onlyIncomeClass(L: Lists): [number | null, number | null] {
  const heads = L.headings.filter((h) => h.active && L.headingTypes.some((x) => x.heading_id === h.id && x.type === 'Income'));
  if (heads.length !== 1) return [null, null];
  const lines = L.lines.filter((l) => l.heading_id === heads[0].id && l.active);
  return [heads[0].id, lines.length === 1 ? lines[0].id : null];
}
