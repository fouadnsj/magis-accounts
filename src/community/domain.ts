// The arithmetic of a community database: balances in three currencies, the
// Jesuit's monthly sheet (the Comptapro FDC, computed instead of typed), the year,
// and the rate taken from the exchanges actually made.
// Nothing here reads or writes the database: it works on rows already loaded.

import type { CtyType, Scope, ClaimReason } from './chart';

export type Cur = 'LOC' | 'USD' | 'EUR';
export const CURS: readonly Cur[] = ['LOC', 'USD', 'EUR'];
export type EntryType = 'Income' | 'Exp' | 'Transfer' | 'Exchange';
export type BookKind = 'personal' | 'house' | 'cash' | 'bank' | 'economat';

export interface CtyAccount {
  id: number;
  code: string;
  parent_id: number | null;
  type: CtyType;
  name_en: string;
  name_fr: string;
  name_ar: string;
  scope: Scope;
  claim: ClaimReason | null;
  active: number;
  sort: number;
}

export interface CtyBook {
  id: number;
  name: string;
  keeper_name: string | null;
  cty_kind: BookKind | null;
  opening_syp: number;
  opening_usd: number;
  opening_eur: number;
  active: number;
}

export interface CtyEntry {
  id: string;
  n: number | null;
  book_id: number;
  date: string;
  type: EntryType;
  account_id: number | null;
  cur: Cur;
  amount: number;
  cur2: Cur | null;
  amount2: number | null;
  to_book_id: number | null;
  note: string | null;
  claim: ClaimReason | null;
  claim_note: string | null;
  received_at: string | null;
  received_by: string | null;
  disputed_at: string | null;
  dispute_note: string | null;
  source: string | null;
  /** at or above the limit when it was saved: waits for the Superior */
  approval_needed: number;
  /** its value in dollars when it was saved (null = no rate yet) */
  approval_usd: number | null;
  approved_at: string | null;
  approved_by: string | null;
  /** the country econome's decision on a claim (from the return file) */
  claim_status?: string | null;
  claim_accepted?: number | null;
  claim_decision_note?: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
}

export type Money = Record<Cur, number>;
export const zero = (): Money => ({ LOC: 0, USD: 0, EUR: 0 });

/** Rounds away the float dust (0.1 + 0.2); amounts have at most 2 decimals. */
export const r2 = (x: number) => Math.round(x * 100) / 100 + 0;

/** What one entry changes in one book: + comes in, − goes out. */
export function effect(e: CtyEntry, bookId: number): Money {
  const d = zero();
  if (e.type === 'Income' && e.book_id === bookId) d[e.cur] += e.amount;
  else if (e.type === 'Exp' && e.book_id === bookId) d[e.cur] -= e.amount;
  else if (e.type === 'Transfer') {
    if (e.book_id === bookId) d[e.cur] -= e.amount;
    if (e.to_book_id === bookId) d[e.cur] += e.amount;
  } else if (e.type === 'Exchange' && e.book_id === bookId && e.cur2) {
    d[e.cur] -= e.amount;
    d[e.cur2] += e.amount2 ?? 0;
  }
  return d;
}

const touches = (e: CtyEntry, bookId: number) => e.book_id === bookId || e.to_book_id === bookId;

export const openingOf = (b: CtyBook): Money => ({ LOC: b.opening_syp ?? 0, USD: b.opening_usd ?? 0, EUR: b.opening_eur ?? 0 });

/** What a book holds after every entry dated up to `until` (YYYY-MM-DD, included). */
export function balance(entries: CtyEntry[], book: CtyBook, until: string): Money {
  const m = openingOf(book);
  for (const e of entries) {
    if (e.date > until || !touches(e, book.id)) continue;
    const d = effect(e, book.id);
    for (const c of CURS) m[c] += d[c];
  }
  for (const c of CURS) m[c] = r2(m[c]);
  return m;
}

// ---------------------------------------------------------------- the Superior's approval

/**
 * The limits set by the econome, in dollars (Fouad, 18 October 2026: minister $500,
 * each person $300): an expense worth at least the limit waits for the Superior's approval.
 * One limit for the house book (held by the minister), one for the personal books. 0 = none.
 */
export interface Limits {
  house: number;
  personal: number;
  /** local currency for $1 until the first exchange gives the real rate (Fouad: 130 SYP) */
  startRate: number;
}
export const DEFAULT_LIMITS: Limits = { house: 500, personal: 300, startRate: 130 };
export const noLimits = (): Limits => ({ house: 0, personal: 0, startRate: 0 });

/**
 * An amount in dollars, at the rate of the last exchange made up to that day (never typed).
 * Before any exchange between pounds and dollars, the starting rate (130 SYP = $1).
 * Euros without a direct exchange to dollars go through the local currency.
 * null: nothing tells the rate (euros never exchanged).
 */
export function usdValue(entries: CtyEntry[], cur: Cur, amount: number, date: string, startRate = 0): number | null {
  if (cur === 'USD') return amount;
  const direct = rateFromExchanges(entries, cur, 'USD', date);
  if (direct != null) return r2(amount * direct);
  const locToUsd = rateFromExchanges(entries, 'LOC', 'USD', date) ?? (startRate > 0 ? 1 / startRate : null);
  if (cur === 'LOC') return locToUsd != null ? r2(amount * locToUsd) : null;
  const eurToLoc = rateFromExchanges(entries, 'EUR', 'LOC', date);
  return eurToLoc != null && locToUsd != null ? r2(amount * eurToLoc * locToUsd) : null;
}

/**
 * Does this expense wait for the Superior? usd: its value in dollars (null = no rate).
 * Without any rate (euros never exchanged) the program cannot tell: the expense waits.
 */
export function approvalOf(e: Pick<CtyEntry, 'type' | 'cur' | 'amount' | 'date'>, book: Pick<CtyBook, 'cty_kind'> | undefined, l: Limits, entries: CtyEntry[]): { needed: boolean; usd: number | null } {
  const limit = book?.cty_kind === 'house' ? l.house : book?.cty_kind === 'personal' ? l.personal : 0;
  if (e.type !== 'Exp' || !(limit > 0)) return { needed: false, usd: null };
  const usd = usdValue(entries, e.cur, e.amount, e.date, l.startRate);
  return { needed: usd == null || usd >= limit, usd };
}

// ---------------------------------------------------------------- the year (October → September)

/** The year an entry belongs to, named by its first year: 2025 = Oct 2025 → Sept 2026. */
export const yearOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 10 ? y : y - 1;
};
/** T1 = Oct–Dec, T2 = Jan–Mar, T3 = Apr–Jun, T4 = Jul–Sept. */
export const quarterOf = (date: string) => {
  const mo = Number(date.slice(5, 7));
  return mo >= 10 ? 1 : Math.floor((mo - 1) / 3) + 2;
};
/** The 12 months of a year, YYYY-MM, October first. */
export const monthsOfYear = (year: number) =>
  Array.from({ length: 12 }, (_, i) => {
    const mo = ((9 + i) % 12) + 1;
    return `${mo >= 10 ? year : year + 1}-${String(mo).padStart(2, '0')}`;
  });
export const prevMonth = (ym: string) => {
  const [y, mo] = ym.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};
export const lastDay = (ym: string) => `${ym}-31`;

// ---------------------------------------------------------------- the monthly sheet (FDC)

/**
 * The Comptapro FDC of one book over a period, computed. Signs as on the sheet:
 * money coming in is +, money going out is − (expenses, given back, out by exchange).
 * kept = carried + received + inByExchange + income + expenses + givenBack + outByExchange.
 */
export interface Sheet {
  carried: Money;
  received: Money;
  inByExchange: Money;
  income: Map<number, Money>;
  totalIncome: Money;
  expenses: Map<number, Money>;
  totalExpenses: Money;
  givenBack: Money;
  outByExchange: Money;
  kept: Money;
}

/** The sheet of `book` from `from` to `to` (YYYY-MM-DD, both included). */
export function sheet(entries: CtyEntry[], book: CtyBook, from: string, to: string): Sheet {
  const dayBefore = from.slice(0, 8) + '00'; // sorts before the 1st: every earlier date is ≤ it
  const s: Sheet = {
    carried: balance(entries, book, dayBefore),
    received: zero(), inByExchange: zero(), income: new Map(), totalIncome: zero(),
    expenses: new Map(), totalExpenses: zero(), givenBack: zero(), outByExchange: zero(), kept: zero(),
  };
  const add = (map: Map<number, Money>, id: number, c: Cur, x: number) => {
    const v = map.get(id) ?? zero();
    v[c] += x;
    map.set(id, v);
  };
  for (const e of entries) {
    if (e.date < from || e.date > to || !touches(e, book.id)) continue;
    if (e.type === 'Income') { add(s.income, e.account_id ?? 0, e.cur, e.amount); s.totalIncome[e.cur] += e.amount; }
    else if (e.type === 'Exp') { add(s.expenses, e.account_id ?? 0, e.cur, -e.amount); s.totalExpenses[e.cur] -= e.amount; }
    else if (e.type === 'Transfer') {
      if (e.to_book_id === book.id) s.received[e.cur] += e.amount;
      if (e.book_id === book.id) s.givenBack[e.cur] -= e.amount;
    } else if (e.type === 'Exchange' && e.cur2) {
      s.outByExchange[e.cur] -= e.amount;
      s.inByExchange[e.cur2] += e.amount2 ?? 0;
    }
  }
  for (const c of CURS) {
    s.kept[c] = r2(s.carried[c] + s.received[c] + s.inByExchange[c] + s.totalIncome[c] + s.totalExpenses[c] + s.givenBack[c] + s.outByExchange[c]);
    for (const k of ['received', 'inByExchange', 'totalIncome', 'totalExpenses', 'givenBack', 'outByExchange'] as const) s[k][c] = r2(s[k][c]);
  }
  for (const map of [s.income, s.expenses]) for (const v of map.values()) for (const c of CURS) v[c] = r2(v[c]);
  return s;
}

export const monthSheet = (entries: CtyEntry[], book: CtyBook, ym: string) => sheet(entries, book, `${ym}-01`, lastDay(ym));
/** The FDC "Total" tab: the whole year, October to September. */
export const yearSheet = (entries: CtyEntry[], book: CtyBook, year: number) => sheet(entries, book, `${year}-10-01`, `${year + 1}-09-31`);

// ---------------------------------------------------------------- totals by code

/** Adds the amounts of the lines up to their headings and families (for the reports by code). */
export function rollUp(accounts: CtyAccount[], byAccount: Map<number, Money>): Map<number, Money> {
  const parent = new Map(accounts.map((a) => [a.id, a.parent_id]));
  const out = new Map<number, Money>();
  for (const [id, v] of byAccount) {
    for (let cur: number | null = id; cur != null; cur = parent.get(cur) ?? null) {
      const t = out.get(cur) ?? zero();
      for (const c of CURS) t[c] = r2(t[c] + v[c]);
      out.set(cur, t);
    }
  }
  return out;
}

/** The accounts an entry may use: active, without active lines under them (the most detailed level). */
export function leafAccounts(accounts: CtyAccount[]): CtyAccount[] {
  const parents = new Set(accounts.filter((a) => a.active && a.parent_id != null).map((a) => a.parent_id));
  return accounts.filter((a) => a.active && !parents.has(a.id));
}

// ---------------------------------------------------------------- the rate (from the exchanges made)

/**
 * How many units of `to` one unit of `from` was worth at the last exchange between
 * them up to `until`, in any book of the community (never typed). null if none yet.
 */
export function rateFromExchanges(entries: CtyEntry[], from: Cur, to: Cur, until: string): number | null {
  if (from === to) return 1;
  let best: CtyEntry | null = null;
  for (const e of entries) {
    if (e.type !== 'Exchange' || !e.cur2 || !e.amount2 || e.date > until) continue;
    const pair = (e.cur === from && e.cur2 === to) || (e.cur === to && e.cur2 === from);
    if (pair && (!best || e.date > best.date || (e.date === best.date && (e.n ?? 0) > (best.n ?? 0)))) best = e;
  }
  if (!best) return null;
  // the exchange gave `amount` of cur and received `amount2` of cur2
  return best.cur === from ? best.amount2! / best.amount : best.amount / best.amount2!;
}
