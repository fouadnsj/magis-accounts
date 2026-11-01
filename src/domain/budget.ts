// Budgets, built the way MAGIS builds them (MAGIS 2027 Budget.xlsx). A budget covers
// a period (a start month and 1–36 months); budgets may overlap: each expense then
// belongs to ONE of them, the oldest that still has money on its line (first in,
// first out), so nothing is counted twice; what a budget did not spend can be
// carried over to the one that continues it.
// each item = Quantity × Times (the months it runs; staff 13) × Cost per unit, in USD.
// One budget for the whole centre (Fouad, 2026-11-01): items are grouped under a budget
// line; the line's amount is their total; each line has at most ONE fund (a grant's share
// here, or private money), else it is "not funded". A contingency (e.g. 10 %) is added to
// the budget as a reserve, not a line one spends on. Pounds and euros come from estimated rates.
// What is spent comes from the register (expenses, in USD as in the reports: column T), by line.
import type { Computed, Trx } from './types';

/** A budget: a name, a period, and (maybe) the budget it continues. */
export interface Budget {
  id: number;
  name: string;
  /** first month, 'YYYY-MM' */
  start_ym: string;
  /** how many months it covers (1–36) */
  months: number;
  /** the earlier budget whose leftover is carried over into this one */
  carry_from_id: number | null;
  created_at?: string;
  created_by?: string | null;
}

export interface BudgetVersion {
  id: number;
  budget_id: number;
  /** 0 = the original budget; 1, 2… = revisions (the original is always kept) */
  rev: number;
  rate_syp: number; // estimated SYP per USD
  rate_eur: number; // estimated EUR per USD
  /** the reserve added to the budget, e.g. 10 (%) */
  contingency_pct: number;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

export interface BudgetAmount {
  version_id: number;
  /** the line's fund; NOFUND (0) = not funded */
  account_id: number;
  line_id: number;
  amount_usd: number;
}

/** A line without a fund. */
export const NOFUND = 0;

export interface BudgetItem {
  id?: number;
  version_id?: number;
  line_id: number;
  name: string;
  unit: string | null;
  qty: number;
  times: number;
  unit_cost: number;
  note: string | null;
  sort?: number;
}

export const itemTotal = (i: Pick<BudgetItem, 'qty' | 'times' | 'unit_cost'>) => i.qty * i.times * i.unit_cost;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The same items for a different length: Times × months / 12 (staff 13 → 6.5 for 6 months, 19.5 for 18). */
export function prorateItems<T extends BudgetItem>(items: T[], months: number): T[] {
  return items.map((i) => ({ ...i, times: round2((i.times * months) / 12) }));
}

/** The line totals of a list of items. */
export function totalsOf(items: BudgetItem[]) {
  const m = new Map<number, number>();
  for (const i of items) m.set(i.line_id, (m.get(i.line_id) ?? 0) + itemTotal(i));
  return m;
}

/** line → its fund, from a budget's amounts */
export const fundsOf = (amounts: BudgetAmount[]) => new Map(amounts.map((a) => [a.line_id, a.account_id]));

// ---------------------------------------------------------------- months

const ymNum = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const numYm = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
/** 'YYYY-MM' moved by n months (n may be negative). */
export const addMonths = (ym: string, n: number) => numYm(ymNum(ym) + n);
/** How many months from a to b (b − a; 0 when the same month). */
export const monthsBetween = (a: string, b: string) => ymNum(b) - ymNum(a);
export const periodEnd = (b: Pick<Budget, 'start_ym' | 'months'>) => addMonths(b.start_ym, b.months - 1);
export const inPeriod = (b: Pick<Budget, 'start_ym' | 'months'>, ym: string) => ym >= b.start_ym && ym <= periodEnd(b);
export const periodMonths = (b: Pick<Budget, 'start_ym' | 'months'>) => Array.from({ length: b.months }, (_, i) => addMonths(b.start_ym, i));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** The name a budget gets by default: "2027" for a calendar year, otherwise "Jul 2026 – Dec 2027". */
export function defaultBudgetName(start_ym: string, months: number) {
  if (months === 12 && start_ym.endsWith('-01')) return start_ym.slice(0, 4);
  return months === 1 ? monLabel(start_ym) : `${monLabel(start_ym)} – ${monLabel(addMonths(start_ym, months - 1))}`;
}

/** USD spent per line between two months (included), and the first month of each. */
export function spentInRange(rows: Trx[], comp: Map<string, Computed>, from: string, to: string, keep?: (r: Trx) => boolean) {
  const spent = new Map<number, number>();
  const firstMonth = new Map<number, string>();
  for (const r of rows) {
    if (r.type !== 'Exp' || !r.date || r.line_id == null) continue;
    const ym = r.date.slice(0, 7);
    if (ym < from || ym > to || (keep && !keep(r))) continue;
    const k = r.line_id;
    spent.set(k, (spent.get(k) ?? 0) + (comp.get(r.id)?.expUsdTot ?? 0));
    if (!firstMonth.has(k) || ym < firstMonth.get(k)!) firstMonth.set(k, ym);
  }
  return { spent, firstMonth };
}

/**
 * A first budget from what was spent in the 12 months before it starts, for its
 * own length (×months/12). `scale`: a line that started during those 12 months is
 * raised to a full year first (3 months of rent → ×4); otherwise the real amount.
 * `pct`: one change for every line (+10 = 10 % more). Whole dollars.
 */
export function proposeFromSpending(rows: Trx[], comp: Map<string, Computed>, start_ym: string, months: number, opts: { scale: boolean; pct: number; keep?: (r: Trx) => boolean }) {
  const from = addMonths(start_ym, -12);
  const to = addMonths(start_ym, -1);
  const { spent, firstMonth } = spentInRange(rows, comp, from, to, opts.keep);
  const out: { line_id: number; amount_usd: number }[] = [];
  for (const [line_id, v] of spent) {
    if (v <= 0) continue;
    const active = monthsBetween(firstMonth.get(line_id) ?? from, to) + 1;
    const year = opts.scale ? (v * 12) / active : v;
    out.push({ line_id, amount_usd: Math.round(((year * months) / 12) * (1 + opts.pct / 100)) });
  }
  return out;
}

/** Share of the budget's period gone by at the end of a month (0–1). */
export function periodShare(b: Pick<Budget, 'start_ym' | 'months'>, upToYm: string) {
  return Math.max(0, Math.min(1, (monthsBetween(b.start_ym, upToYm) + 1) / b.months));
}

// ---------------------------------------------------------------- which budget an expense belongs to

/** A budget with what it holds: its line amounts. */
export interface BudgetBook {
  budget: Budget;
  cells: BudgetAmount[];
}

/**
 * Each expense goes to ONE budget: among the budgets running at its date that
 * have its line, the oldest that still has money on that line; when none has,
 * the newest. Expenses are taken in date order, so the first donation is finished
 * before the new one starts. `keep`: the expenses that count (not outside the budget).
 */
export function assignExpenses(rows: Trx[], comp: Map<string, Computed>, books: BudgetBook[], keep?: (r: Trx) => boolean): Map<string, number> {
  const out = new Map<string, number>();
  const ordered = [...books].sort((a, b) => a.budget.start_ym.localeCompare(b.budget.start_ym) || a.budget.id - b.budget.id);
  const left = new Map<number, Map<number, number>>();
  for (const bk of ordered) left.set(bk.budget.id, new Map(bk.cells.map((c) => [c.line_id, c.amount_usd])));
  const exps = rows
    .filter((r) => r.type === 'Exp' && r.date && r.line_id != null && (!keep || keep(r)))
    .sort((a, b) => a.date!.localeCompare(b.date!) || (a.n ?? 0) - (b.n ?? 0));
  for (const r of exps) {
    const ym = r.date!.slice(0, 7);
    const cands = ordered.filter((bk) => inPeriod(bk.budget, ym) && left.get(bk.budget.id)!.has(r.line_id!));
    if (!cands.length) continue;
    const pick = cands.find((bk) => (left.get(bk.budget.id)!.get(r.line_id!) ?? 0) > 0.004) ?? cands[cands.length - 1];
    const m = left.get(pick.budget.id)!;
    m.set(r.line_id!, (m.get(r.line_id!) ?? 0) - (comp.get(r.id)?.expUsdTot ?? 0));
    out.set(r.id, pick.budget.id);
  }
  return out;
}

/** What a budget did not spend over its whole period (it can be carried over). */
export function leftoverOf(bk: BudgetBook, rows: Trx[], comp: Map<string, Computed>, assigned: Map<string, number>) {
  const total = bk.cells.reduce((s, c) => s + c.amount_usd, 0);
  const spent = rows.filter((r) => assigned.get(r.id) === bk.budget.id).reduce((s, r) => s + (comp.get(r.id)?.expUsdTot ?? 0), 0);
  return total - spent;
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

export interface BudgetRow {
  /** the line's fund (NOFUND: not funded) */
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
 * Budget against what was really spent, line by line, up to a month. Expenses on
 * a fund outside the budget are left out. Lines spent on without any budget are
 * listed too (budget 0), so nothing is hidden. With `assigned`, only the expenses
 * that belong to this budget count (overlapping budgets).
 */
export function followUp(args: {
  rows: Trx[];
  comp: Map<string, Computed>;
  budget: Pick<Budget, 'id' | 'start_ym' | 'months'>;
  upToYm: string;
  amounts: BudgetAmount[];
  original: BudgetAmount[] | null;
  headingOf: Map<number, number>;
  /** funds outside the budget (their spending is not the centre's) */
  outside: Set<number>;
  /** expense id → the budget it belongs to (see assignExpenses) */
  assigned?: Map<string, number>;
}): BudgetRow[] {
  const { rows, comp, budget, upToYm, amounts, original, headingOf, outside, assigned } = args;
  const end = upToYm < periodEnd(budget) ? upToYm : periodEnd(budget);
  const inside = (r: Trx) => r.account_id == null || !outside.has(r.account_id);
  const mine = (r: Trx) => inside(r) && (!assigned || assigned.get(r.id) === budget.id);
  const spent = spentInRange(rows, comp, budget.start_ym, end, mine).spent;
  // reference: the same months one year before
  const last = spentInRange(rows, comp, addMonths(budget.start_ym, -12), addMonths(end, -12), inside).spent;
  const budgetMap = new Map(amounts.map((a) => [a.line_id, a.amount_usd]));
  const fund = fundsOf(amounts);
  const orig = original ? new Map(original.map((a) => [a.line_id, a.amount_usd])) : null;
  const share = periodShare(budget, end);
  const out: BudgetRow[] = [];
  for (const line_id of new Set([...budgetMap.keys(), ...spent.keys()])) {
    const heading_id = headingOf.get(line_id);
    if (heading_id == null) continue;
    const b = budgetMap.get(line_id) ?? 0;
    const sp = spent.get(line_id) ?? 0;
    out.push({
      account_id: fund.get(line_id) ?? NOFUND, line_id, heading_id,
      original: orig ? orig.get(line_id) ?? 0 : null,
      budget: b, spent: sp, left: b - sp, used: b > 0 ? sp / b : null,
      pace: paceOf(b, sp, share),
      lastYear: last.get(line_id) ?? 0,
    });
  }
  return out;
}

/** The contingency of the budget (a % of it), and how much of it the overspent lines already use. */
export function contingencyOf(rows: BudgetRow[], pct: number) {
  const base = rows.reduce((s, r) => s + r.budget, 0);
  const used = rows.reduce((s, r) => s + Math.max(0, r.spent - r.budget), 0);
  return { base, reserve: (base * pct) / 100, used };
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
