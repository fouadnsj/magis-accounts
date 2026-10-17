// The yearly budget, built the way MAGIS builds it (MAGIS 2027 Budget.xlsx):
// each item = Quantity × Times (the months it runs; staff 13) × Cost per unit, in USD.
// Items are grouped under a budget line, per account; the line's amount is their
// total. A contingency (e.g. 10 % on running costs) is added per account, as a
// reserve, not a line one spends on. Pounds and euros come from estimated rates.
// Donors cover parts: a percentage or a fixed amount of an account, a heading, a line.
// What is spent comes from the register (expenses, in USD as in the reports: column T).
import type { Computed, Trx } from './types';

export interface BudgetVersion {
  id: number;
  year: number;
  /** 0 = the original budget; 1, 2… = revisions (the original is always kept) */
  rev: number;
  rate_syp: number; // estimated SYP per USD
  rate_eur: number; // estimated EUR per USD
  /** the period it covers: e.g. 2026 from July (7) for 6 months */
  start_month: number;
  months: number;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

export interface BudgetAmount {
  version_id: number;
  account_id: number;
  line_id: number;
  amount_usd: number;
}

export interface BudgetItem {
  id?: number;
  version_id?: number;
  account_id: number;
  line_id: number;
  name: string;
  unit: string | null;
  qty: number;
  times: number;
  unit_cost: number;
  note: string | null;
  sort?: number;
}

export interface BudgetAccount {
  version_id: number;
  account_id: number;
  contingency_pct: number;
}

export type AllocStatus = 'requested' | 'promised' | 'received';

export interface BudgetAlloc {
  id: number;
  year: number;
  donor_id: number;
  account_id: number;
  /** null with line_id null: the whole account */
  heading_id: number | null;
  /** a single line (then heading_id is that line's heading) */
  line_id: number | null;
  /** either a percentage… */
  pct: number | null;
  /** …or a fixed amount in USD */
  amount_usd: number | null;
  status: AllocStatus;
  note: string | null;
}

export const cellKey = (accountId: number, lineId: number) => `${accountId}|${lineId}`;
export const itemTotal = (i: Pick<BudgetItem, 'qty' | 'times' | 'unit_cost'>) => i.qty * i.times * i.unit_cost;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The same items for a shorter period: Times × months / 12 (staff 13 → 6.5 for 6 months). */
export function prorateItems<T extends BudgetItem>(items: T[], months: number): T[] {
  return items.map((i) => ({ ...i, times: round2((i.times * months) / 12) }));
}

/** The line totals of a list of items. */
export function totalsOf(items: BudgetItem[]) {
  const m = new Map<string, number>();
  for (const i of items) {
    const k = cellKey(i.account_id, i.line_id);
    m.set(k, (m.get(k) ?? 0) + itemTotal(i));
  }
  return m;
}

const yearOf = (r: Trx) => (r.date ? Number(r.date.slice(0, 4)) : null);

/** USD spent per (account, line) in a year, up to a month, and the first month of each. */
export function spentByCell(rows: Trx[], comp: Map<string, Computed>, year: number, upToMonth = 12) {
  const spent = new Map<string, number>();
  const firstMonth = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== 'Exp' || yearOf(r) !== year || r.account_id == null || r.line_id == null) continue;
    const month = Number(r.date!.slice(5, 7));
    if (month > upToMonth) continue;
    const k = cellKey(r.account_id, r.line_id);
    spent.set(k, (spent.get(k) ?? 0) + (comp.get(r.id)?.expUsdTot ?? 0));
    firstMonth.set(k, Math.min(firstMonth.get(k) ?? 12, month));
  }
  return { spent, firstMonth };
}

/**
 * A first budget for `year` from what was spent in `year - 1`.
 * `scale`: a line that started during the year is raised to 12 months
 * (e.g. 3 months of rent → ×4); otherwise the real amount is kept.
 * `pct`: one change for every line (+10 = 10 % more). Whole dollars.
 */
export function proposeFromYear(rows: Trx[], comp: Map<string, Computed>, lastYear: number, opts: { scale: boolean; pct: number }) {
  const { spent, firstMonth } = spentByCell(rows, comp, lastYear);
  const out: { account_id: number; line_id: number; amount_usd: number }[] = [];
  for (const [k, v] of spent) {
    if (v <= 0) continue;
    const [account_id, line_id] = k.split('|').map(Number);
    const months = 12 - (firstMonth.get(k) ?? 1) + 1;
    const full = opts.scale ? (v * 12) / months : v;
    out.push({ account_id, line_id, amount_usd: Math.round(full * (1 + opts.pct / 100)) });
  }
  return out;
}

/** Share of the budget's period gone by at the end of `upToMonth` (0–1). */
export function periodShare(v: Pick<BudgetVersion, 'start_month' | 'months'>, upToMonth: number) {
  return Math.max(0, Math.min(1, (upToMonth - v.start_month + 1) / v.months));
}

/**
 * Where a line stands, from its budget, what was spent and the share of the period gone:
 *  - over: more than the whole budget (it uses the contingency);
 *  - ahead: clearly faster than time (more than 110 % of what was expected by now);
 *  - under: clearly slower (less than 75 % of what was expected), once a quarter has passed;
 *  - ontrack; nobudget: spent with no budget; none: nothing.
 */
export type Pace = 'over' | 'ahead' | 'ontrack' | 'under' | 'nobudget' | 'none';
export function paceOf(budget: number, spent: number, share: number): Pace {
  if (budget <= 0) return spent > 0.004 ? 'nobudget' : 'none';
  if (spent > budget + 0.004) return 'over';
  const expected = budget * share;
  if (share >= 0.25 && spent < 0.75 * expected) return 'under';
  if (spent > expected * 1.1 + 0.5) return 'ahead';
  return 'ontrack';
}

/** Colour step from the share spent: under 50 %, 50 %, 75 %, 90 %, over 100 %. */
export function usedBand(used: number | null): 0 | 50 | 75 | 90 | 100 {
  if (used == null) return 100;
  if (used > 1.00001) return 100;
  if (used >= 0.9) return 90;
  if (used >= 0.75) return 75;
  if (used >= 0.5) return 50;
  return 0;
}

/** Which allocations apply to one cell (account + line of a heading). */
export function allocsFor(allocs: BudgetAlloc[], accountId: number, lineId: number, headingId: number) {
  return allocs.filter((a) =>
    a.account_id === accountId &&
    (a.line_id != null ? a.line_id === lineId : a.heading_id != null ? a.heading_id === headingId : true));
}

/**
 * The percentage each allocation really gives: its own %, or, for a fixed
 * amount, that amount against the budget of what it covers (at most 100 %).
 */
export function effectivePct(allocs: BudgetAlloc[], amounts: BudgetAmount[], headingOf: Map<number, number>) {
  const out = new Map<number, number>();
  for (const a of allocs) {
    if (a.pct != null) {
      out.set(a.id, a.pct);
      continue;
    }
    const scope = amounts
      .filter((x) => x.account_id === a.account_id && (a.line_id != null ? x.line_id === a.line_id : a.heading_id != null ? headingOf.get(x.line_id) === a.heading_id : true))
      .reduce((s, x) => s + x.amount_usd, 0);
    out.set(a.id, scope > 0 ? Math.min(100, ((a.amount_usd ?? 0) / scope) * 100) : 0);
  }
  return out;
}

export interface CellCover {
  /** per donor: USD of this cell he covers, and with which status */
  donors: { donor_id: number; usd: number; status: AllocStatus }[];
  /** total percentage given (can pass 100 %: shown as a warning) */
  pct: number;
  covered: number;
  toFind: number;
}

export function cover(allocs: BudgetAlloc[], eff: Map<number, number>, accountId: number, lineId: number, headingId: number, amount: number): CellCover {
  const mine = allocsFor(allocs, accountId, lineId, headingId);
  const donors = mine.map((a) => ({ donor_id: a.donor_id, usd: (amount * (eff.get(a.id) ?? 0)) / 100, status: a.status }));
  const pct = mine.reduce((s, a) => s + (eff.get(a.id) ?? 0), 0);
  const covered = (amount * Math.min(pct, 100)) / 100;
  return { donors, pct, covered, toFind: Math.max(0, amount - covered) };
}

export interface BudgetRow {
  account_id: number;
  line_id: number;
  heading_id: number;
  original: number | null; // the original budget, when a revision exists
  budget: number;
  spent: number;
  left: number;
  /** share of the budget already spent (null: no budget for this line) */
  used: number | null;
  pace: Pace;
  /** spent last year, the same months (reference) */
  lastYear: number;
}

/**
 * Budget against what was really spent, line by line, up to a month. Accounts
 * marked outside the centre are left out. Lines spent on without any budget
 * are listed too (budget 0), so nothing is hidden.
 */
export function followUp(args: {
  rows: Trx[];
  comp: Map<string, Computed>;
  version: BudgetVersion;
  upToMonth: number;
  amounts: BudgetAmount[];
  original: BudgetAmount[] | null;
  headingOf: Map<number, number>;
  outside: Set<number>;
}): BudgetRow[] {
  const { rows, comp, version, upToMonth, amounts, original, headingOf, outside } = args;
  const year = version.year;
  const { spent } = spentByCell(rows, comp, year, upToMonth);
  const last = spentByCell(rows, comp, year - 1, upToMonth).spent;
  const budget = new Map(amounts.map((a) => [cellKey(a.account_id, a.line_id), a.amount_usd]));
  const orig = original ? new Map(original.map((a) => [cellKey(a.account_id, a.line_id), a.amount_usd])) : null;
  const share = periodShare(version, upToMonth);
  const out: BudgetRow[] = [];
  for (const k of new Set([...budget.keys(), ...spent.keys()])) {
    const [account_id, line_id] = k.split('|').map(Number);
    const heading_id = headingOf.get(line_id);
    if (heading_id == null || outside.has(account_id)) continue;
    const b = budget.get(k) ?? 0;
    const s = spent.get(k) ?? 0;
    out.push({
      account_id, line_id, heading_id,
      original: orig ? orig.get(k) ?? 0 : null,
      budget: b, spent: s, left: b - s, used: b > 0 ? s / b : null,
      pace: paceOf(b, s, share),
      lastYear: last.get(k) ?? 0,
    });
  }
  return out;
}

/** Per account: the contingency, and how much of it the overspent lines already use. */
export function contingencyOf(rows: BudgetRow[], accounts: BudgetAccount[]) {
  const out = new Map<number, { base: number; reserve: number; used: number }>();
  for (const r of rows) {
    const x = out.get(r.account_id) ?? { base: 0, reserve: 0, used: 0 };
    x.base += r.budget;
    x.used += Math.max(0, r.spent - r.budget);
    out.set(r.account_id, x);
  }
  for (const [id, x] of out) x.reserve = (x.base * (accounts.find((a) => a.account_id === id)?.contingency_pct ?? 0)) / 100;
  return out;
}

// ---------------------------------------------------------------- reading a budget sheet

export interface SheetItem {
  category: string;
  name: string;
  unit: string | null;
  qty: number;
  times: number;
  unit_cost: number;
  total: number;
}

export interface SheetRead {
  title: string;
  items: SheetItem[];
  /** e.g. 10 from "contingency (10%)"; 0 when the sheet has none */
  contingencyPct: number;
  /** the sheet's own "BASE BUDGET" (or "TOTAL") figure, to check against */
  sheetBase: number | null;
}

type Cell = string | number | null;

/**
 * Reads one sheet laid out like "Homs 2027": a header row with
 * Category | Budget line (or Item) | Unit | Quantity | [Times per year] | Cost per unit | Total.
 * Subtotal and note rows are skipped. Values are those Excel computed.
 */
export function readBudgetSheet(title: string, grid: Cell[][]): SheetRead {
  const norm = (x: Cell) => String(x ?? '').trim().toLowerCase();
  const h = grid.findIndex((r) => r.some((c) => norm(c) === 'quantity') && r.some((c) => norm(c).startsWith('cost per unit')));
  if (h < 0) throw new Error(`"${title}": no header row (Quantity, Cost per unit)`);
  const head = grid[h].map(norm);
  const col = (pred: (s: string) => boolean) => head.findIndex(pred);
  const cCat = col((s) => s === 'category');
  const cName = col((s) => s === 'budget line' || s === 'item');
  const cUnit = col((s) => s === 'unit');
  const cQty = col((s) => s === 'quantity');
  const cTimes = col((s) => s.startsWith('times'));
  const cCost = col((s) => s.startsWith('cost per unit'));
  const cTotal = col((s) => s.startsWith('total'));
  const num = (x: Cell) => (typeof x === 'number' ? x : Number(String(x ?? '').replace(/,/g, '')));
  const items: SheetItem[] = [];
  let contingencyPct = 0;
  let sheetBase: number | null = null;
  for (const r of grid.slice(h + 1)) {
    const label = String(r[cName] ?? '').trim();
    const low = label.toLowerCase();
    if (/contingency/.test(low)) {
      const m = /(\d+(?:\.\d+)?)\s*%/.exec(label);
      if (m) contingencyPct = Number(m[1]);
      continue;
    }
    if (/^base budget/.test(low) || (/total/.test(low) && sheetBase == null && !/subtotal/.test(low))) {
      if (/^base budget/.test(low) || sheetBase == null) sheetBase = num(r[cTotal]);
      continue;
    }
    const cat = String(r[cCat] ?? '').trim();
    const qty = num(r[cQty]);
    const cost = num(r[cCost]);
    if (!cat || !label || !Number.isFinite(qty) || !Number.isFinite(cost)) continue;
    const times = cTimes >= 0 ? num(r[cTimes]) : 1;
    items.push({
      category: cat, name: label, unit: cUnit >= 0 ? String(r[cUnit] ?? '').trim() || null : null,
      qty, times: Number.isFinite(times) ? times : 1, unit_cost: cost, total: num(r[cTotal]),
    });
  }
  return { title, items, contingencyPct, sheetBase };
}

/** Lower-case words of a name, for matching "Study chairs, foldable" with "Chairs". */
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/s$/, ''));

/**
 * The register line an item most likely belongs to: same name in the matching
 * heading, then same name anywhere, then the line sharing most words.
 * "Staff" is the "Salary" heading.
 */
export function guessLine(item: { category: string; name: string }, lines: { id: number; name: string; heading_id: number; active: number }[], headings: { id: number; name: string }[], fallbackHeading?: string) {
  const catName = item.category.toLowerCase() === 'staff' ? 'salary' : item.category.toLowerCase();
  const heading = headings.find((h) => h.name.toLowerCase() === catName) ?? (fallbackHeading ? headings.find((h) => h.name.toLowerCase() === fallbackHeading.toLowerCase()) : undefined);
  const pool = heading ? lines.filter((l) => l.heading_id === heading.id) : lines;
  const n = item.name.toLowerCase().replace(/\s*\*\s*$/, '').trim();
  const exact = pool.find((l) => l.name.toLowerCase().replace(/\s*\*\s*$/, '').trim() === n) ?? lines.find((l) => l.name.toLowerCase().replace(/\s*\*\s*$/, '').trim() === n);
  if (exact) return exact.id;
  const iw = words(item.name);
  let best: { id: number; score: number } | null = null;
  for (const l of pool) {
    const lw = words(l.name);
    const score = lw.filter((w) => iw.includes(w)).length / Math.max(1, lw.length);
    if (score > 0 && (!best || score > best.score)) best = { id: l.id, score };
  }
  return best?.id ?? null;
}
