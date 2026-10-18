// The account of a community at the économat, as the country econome keeps it, and the
// year-end reconciliation: what each community must pay, what it can claim.
// Every line stays visible (nothing is netted in secret). Each currency is counted apart.
//   + in the community's favour: a claim accepted, a charge it made as host, what it paid in;
//   − against it: a charge for one of its Jesuits elsewhere, what it received, a cotisation.

import { CURS, r2, yearOf, zero, type Cur, type Money } from './domain';
import type { StatementLine } from './files';

export interface CountryClaim {
  id: string; cty_id: number; date: string; code: string | null; line: string | null; book_kind: string | null; person?: string | null;
  cur: Cur; amount: number; reason: string | null; note: string | null;
  status: 'waiting' | 'accepted' | 'refused' | 'withdrawn'; accepted: number | null; decision_note: string | null;
  decided_at: string | null; decided_by: string | null;
}
export interface CountryCharge { id: string; date: string; host_id: number; charged_id: number; cur: Cur; amount: number; note: string; created_at: string; created_by: string | null }
export type MoveKind = 'paid_by_cty' | 'paid_to_cty' | 'cotisation' | 'other';
export interface CountryMove { id: string; cty_id: number; date: string; kind: MoveKind; cur: Cur; amount: number; note: string; created_at: string; created_by: string | null }
export interface CountryCty { id: number; uid: string; name: string; active: number }

/** The lines of one community's account, oldest first. */
export function ledgerOf(ctyId: number, claims: CountryClaim[], charges: CountryCharge[], moves: CountryMove[], names: Map<number, string>): StatementLine[] {
  const out: StatementLine[] = [];
  for (const c of claims) {
    if (c.cty_id !== ctyId || c.status !== 'accepted') continue;
    out.push({ id: `claim:${c.id}`, date: c.date, kind: 'claim', cur: c.cur, amount: r2(c.accepted ?? c.amount), note: [c.code, c.line, c.note].filter(Boolean).join(' · ') || null });
  }
  for (const ch of charges) {
    if (ch.host_id === ctyId) out.push({ id: `host:${ch.id}`, date: ch.date, kind: 'host', cur: ch.cur, amount: ch.amount, note: `${ch.note} → ${names.get(ch.charged_id) ?? '?'}` });
    if (ch.charged_id === ctyId) out.push({ id: `charged:${ch.id}`, date: ch.date, kind: 'charged', cur: ch.cur, amount: -ch.amount, note: `${ch.note} ← ${names.get(ch.host_id) ?? '?'}` });
  }
  for (const m of moves) if (m.cty_id === ctyId) out.push({ id: `move:${m.id}`, date: m.date, kind: m.kind, cur: m.cur, amount: m.amount, note: m.note });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** A move's sign follows its kind: what the community paid in is in its favour; what it received or owes is not. */
export function signedMove(kind: MoveKind, amount: number): number {
  const x = Math.abs(amount);
  return kind === 'paid_by_cty' ? x : kind === 'paid_to_cty' || kind === 'cotisation' ? -x : amount;
}

export interface Reconciliation {
  ctyId: number;
  /** before the year (carried over) */
  before: Money;
  /** during the year, by kind */
  byKind: Record<string, Money>;
  /** at the end of the year: > 0 the Province owes the community (it can claim), < 0 the community must pay */
  end: Money;
  /** claims still waiting for a decision (not counted) */
  waiting: Money;
}

/** The year (October → September) of every community. */
export function reconcile(year: number, ctys: CountryCty[], claims: CountryClaim[], charges: CountryCharge[], moves: CountryMove[]): Reconciliation[] {
  const names = new Map(ctys.map((c) => [c.id, c.name]));
  return ctys.map((c) => {
    const r: Reconciliation = { ctyId: c.id, before: zero(), byKind: {}, end: zero(), waiting: zero() };
    for (const l of ledgerOf(c.id, claims, charges, moves, names)) {
      const y = yearOf(l.date);
      if (y > year) continue;
      if (y < year) r.before[l.cur] += l.amount;
      else (r.byKind[l.kind] ??= zero())[l.cur] += l.amount;
      r.end[l.cur] += l.amount;
    }
    for (const cl of claims) if (cl.cty_id === c.id && cl.status === 'waiting' && yearOf(cl.date) <= year) r.waiting[cl.cur] += cl.amount;
    for (const k of CURS) { r.before[k] = r2(r.before[k]); r.end[k] = r2(r.end[k]); r.waiting[k] = r2(r.waiting[k]); }
    for (const v of Object.values(r.byKind)) for (const k of CURS) v[k] = r2(v[k]);
    return r;
  });
}
