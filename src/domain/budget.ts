// Budgets, built the way MAGIS builds them (MAGIS 2027 Budget.xlsx). A budget covers
// a period (a start month and 1–36 months); budgets may overlap: each expense then
// belongs to ONE of them, the oldest that still has money on its line (first in,
// first out), so nothing is counted twice; what a budget did not spend can be
// carried over to the one that continues it.
// each item = Quantity × Times (the months it runs; staff 13) × Cost per unit, in USD.
// Items are grouped under a budget line, per account; the line's amount is their
// total. A contingency (e.g. 10 % on running costs) is added per account, as a
// reserve, not a line one spends on. Pounds and euros come from estimated rates.
// Donors cover parts: a percentage or a fixed amount of an account, a heading, a line.
// What is spent comes from the register (expenses, in USD as in the reports: column T).
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
  /** one amount for all the account's spending, whatever the line (e.g. Harat, funded by UNDP) */
  lump_usd: number | null;
}

/** The "line" of an account budgeted as one amount. */
export const WHOLE = -1;

/** The budget's cells: line amounts, plus one cell per account budgeted as a single amount. */
export function cellsOf(amounts: BudgetAmount[], accounts: BudgetAccount[]): BudgetAmount[] {
  return [
    ...amounts,
    ...accounts.filter((a) => a.lump_usd != null && a.lump_usd > 0).map((a) => ({ version_id: a.version_id, account_id: a.account_id, line_id: WHOLE, amount_usd: a.lump_usd! })),
  ];
}

export type AllocStatus = 'requested' | 'promised' | 'received';

export interface BudgetAlloc {
  id: number;
  budget_id: number;
  donor_id: number;
  /** null: every account of the centre */
  account_id: number | null;
  /** null with line_id null: the whole account */
  heading_id: number | null;
  /** a single line (then heading_id is that line's heading) */
  line_id: number | null;
  /** either a percentage… */
  pct: number | null;
  /** …or a fixed amount in USD… */
  amount_usd: number | null;
  /** …or 1: the rest, what no other donor covers (e.g. SJ) */
  rest: number;
  status: AllocStatus;
  note: string | null;
}

export const cellKey = (accountId: number, lineId: number) => `${accountId}|${lineId}`;
export const itemTotal = (i: Pick<BudgetItem, 'qty' | 'times' | 'unit_cost'>) => i.qty * i.times * i.unit_cost;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The same items for a different length: Times × months / 12 (staff 13 → 6.5 for 6 months, 19.5 for 18). */
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

/** USD spent per (account, line) between two months (included), and the first month of each. */
export function spentInRange(rows: Trx[], comp: Map<string, Computed>, from: string, to: string, keep?: (r: Trx) => boolean) {
  const spent = new Map<string, number>();
  const firstMonth = new Map<string, string>();
  for (const r of rows) {
    if (r.type !== 'Exp' || !r.date || r.account_id == null || r.line_id == null) continue;
    const ym = r.date.slice(0, 7);
    if (ym < from || ym > to || (keep && !keep(r))) continue;
    const k = cellKey(r.account_id, r.line_id);
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
export function proposeFromSpending(rows: Trx[], comp: Map<string, Computed>, start_ym: string, months: number, opts: { scale: boolean; pct: number }) {
  const from = addMonths(start_ym, -12);
  const to = addMonths(start_ym, -1);
  const { spent, firstMonth } = spentInRange(rows, comp, from, to);
  const out: { account_id: number; line_id: number; amount_usd: number }[] = [];
  for (const [k, v] of spent) {
    if (v <= 0) continue;
    const [account_id, line_id] = k.split('|').map(Number);
    const active = monthsBetween(firstMonth.get(k) ?? from, to) + 1;
    const year = opts.scale ? (v * 12) / active : v;
    out.push({ account_id, line_id, amount_usd: Math.round(((year * months) / 12) * (1 + opts.pct / 100)) });
  }
  return out;
}

/** Share of the budget's period gone by at the end of a month (0–1). */
export function periodShare(b: Pick<Budget, 'start_ym' | 'months'>, upToYm: string) {
  return Math.max(0, Math.min(1, (monthsBetween(b.start_ym, upToYm) + 1) / b.months));
}

// ---------------------------------------------------------------- which budget an expense belongs to

/** A budget with what it holds: its cells (line amounts, and one cell per account with one amount). */
export interface BudgetBook {
  budget: Budget;
  cells: BudgetAmount[];
  /** accounts budgeted as one amount: their spending goes to the WHOLE cell */
  lumped: Set<number>;
}

/**
 * Each expense goes to ONE budget: among the budgets running at its date that
 * contain its account, the oldest that still has money on its line (or on the
 * account, for one amount); when none has, the newest. Expenses are taken in
 * date order, so the first donation is finished before the new one starts.
 */
export function assignExpenses(rows: Trx[], comp: Map<string, Computed>, books: BudgetBook[]): Map<string, number> {
  const out = new Map<string, number>();
  const ordered = [...books].sort((a, b) => a.budget.start_ym.localeCompare(b.budget.start_ym) || a.budget.id - b.budget.id);
  const left = new Map<number, Map<string, number>>();
  const accounts = new Map<number, Set<number>>();
  for (const bk of ordered) {
    left.set(bk.budget.id, new Map(bk.cells.map((c) => [cellKey(c.account_id, c.line_id), c.amount_usd])));
    accounts.set(bk.budget.id, new Set(bk.cells.map((c) => c.account_id)));
  }
  const exps = rows
    .filter((r) => r.type === 'Exp' && r.date && r.account_id != null)
    .sort((a, b) => a.date!.localeCompare(b.date!) || (a.n ?? 0) - (b.n ?? 0));
  for (const r of exps) {
    const ym = r.date!.slice(0, 7);
    const cands = ordered.filter((bk) => inPeriod(bk.budget, ym) && accounts.get(bk.budget.id)!.has(r.account_id!));
    if (!cands.length) continue;
    const keyFor = (bk: BudgetBook) => (bk.lumped.has(r.account_id!) ? cellKey(r.account_id!, WHOLE) : cellKey(r.account_id!, r.line_id ?? -999));
    const pick = cands.find((bk) => (left.get(bk.budget.id)!.get(keyFor(bk)) ?? 0) > 0.004) ?? cands[cands.length - 1];
    const k = keyFor(pick);
    const m = left.get(pick.budget.id)!;
    m.set(k, (m.get(k) ?? 0) - (comp.get(r.id)?.expUsdTot ?? 0));
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

/** Which allocations apply to one cell (account + line of a heading). */
export function allocsFor(allocs: BudgetAlloc[], accountId: number, lineId: number, headingId: number) {
  return allocs.filter((a) =>
    (a.account_id == null || a.account_id === accountId) &&
    (a.line_id != null ? a.line_id === lineId : a.heading_id != null ? a.heading_id === headingId : true));
}

const inScope = (a: BudgetAlloc, x: BudgetAmount, headingOf: Map<number, number>) =>
  (a.account_id == null || x.account_id === a.account_id) &&
  (a.line_id != null ? x.line_id === a.line_id : a.heading_id != null ? headingOf.get(x.line_id) === a.heading_id : true);

/**
 * The percentage each allocation really gives: its own %, or, for a fixed
 * amount, that amount against the budget of what it covers (at most 100 %).
 */
export function effectivePct(allocs: BudgetAlloc[], cells: BudgetAmount[], headingOf: Map<number, number>) {
  const out = new Map<number, number>();
  for (const a of allocs) {
    if (a.rest) continue; // worked out cell by cell (see cover)
    if (a.pct != null) {
      out.set(a.id, a.pct);
      continue;
    }
    const scope = cells.filter((x) => inScope(a, x, headingOf)).reduce((s, x) => s + x.amount_usd, 0);
    out.set(a.id, scope > 0 ? Math.min(100, ((a.amount_usd ?? 0) / scope) * 100) : 0);
  }
  return out;
}

/** What an allocation is worth in USD over the budget it covers. */
export function allocWorth(a: BudgetAlloc, allocs: BudgetAlloc[], eff: Map<number, number>, cells: BudgetAmount[], headingOf: Map<number, number>) {
  return cells.filter((x) => inScope(a, x, headingOf)).reduce((s, x) => {
    const c = cover(allocs, eff, x.account_id, x.line_id, headingOf.get(x.line_id) ?? WHOLE, x.amount_usd);
    return s + c.donors.filter((d) => d.alloc_id === a.id).reduce((t, d) => t + d.usd, 0);
  }, 0);
}

export interface CellCover {
  /** per allocation: USD of this cell it covers, and with which status */
  donors: { alloc_id: number; donor_id: number; usd: number; status: AllocStatus }[];
  /** total percentage given (can pass 100 %: shown as a warning) */
  pct: number;
  covered: number;
  toFind: number;
}

export function cover(allocs: BudgetAlloc[], eff: Map<number, number>, accountId: number, lineId: number, headingId: number, amount: number): CellCover {
  const mine = allocsFor(allocs, accountId, lineId, headingId);
  const fixed = mine.filter((a) => !a.rest);
  const rests = mine.filter((a) => a.rest);
  const given = fixed.reduce((s, a) => s + (eff.get(a.id) ?? 0), 0);
  // "the rest": what the others leave, shared if several donors take the rest
  const restPct = rests.length ? Math.max(0, 100 - given) / rests.length : 0;
  const pctOf = (a: BudgetAlloc) => (a.rest ? restPct : eff.get(a.id) ?? 0);
  const donors = mine.map((a) => ({ alloc_id: a.id, donor_id: a.donor_id, usd: (amount * pctOf(a)) / 100, status: a.status }));
  const pct = given + restPct * rests.length;
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
 * are listed too (budget 0), so nothing is hidden. With `assigned`, only the
 * expenses that belong to this budget count (overlapping budgets).
 */
export function followUp(args: {
  rows: Trx[];
  comp: Map<string, Computed>;
  budget: Pick<Budget, 'id' | 'start_ym' | 'months'>;
  upToYm: string;
  amounts: BudgetAmount[];
  original: BudgetAmount[] | null;
  headingOf: Map<number, number>;
  outside: Set<number>;
  /** accounts budgeted as one amount (their spending is gathered, whatever the line) */
  accounts?: BudgetAccount[];
  /** expense id → the budget it belongs to (see assignExpenses) */
  assigned?: Map<string, number>;
}): BudgetRow[] {
  const { rows, comp, budget, upToYm, amounts, original, headingOf, outside, assigned } = args;
  const lumps = (args.accounts ?? []).filter((a) => a.lump_usd != null && a.lump_usd > 0);
  const lumped = new Set(lumps.map((a) => a.account_id));
  const gather = (m: Map<string, number>) => {
    const out = new Map<string, number>();
    for (const [k, v] of m) {
      const acc = Number(k.split('|')[0]);
      const key = lumped.has(acc) ? cellKey(acc, WHOLE) : k;
      out.set(key, (out.get(key) ?? 0) + v);
    }
    return out;
  };
  const end = upToYm < periodEnd(budget) ? upToYm : periodEnd(budget);
  const mine = assigned ? (r: Trx) => assigned.get(r.id) === budget.id : undefined;
  const spent = gather(spentInRange(rows, comp, budget.start_ym, end, mine).spent);
  // reference: the same months one year before, on this budget's accounts
  const accs = new Set([...amounts.map((a) => a.account_id), ...lumped]);
  const onMine = assigned && accs.size ? (r: Trx) => accs.has(r.account_id!) : undefined;
  const last = gather(spentInRange(rows, comp, addMonths(budget.start_ym, -12), addMonths(end, -12), onMine).spent);
  const budgetMap = new Map([...amounts.filter((a) => !lumped.has(a.account_id)), ...cellsOf([], lumps)].map((a) => [cellKey(a.account_id, a.line_id), a.amount_usd]));
  const hOf = new Map([...headingOf, [WHOLE, WHOLE]]);
  const orig = original ? new Map(original.map((a) => [cellKey(a.account_id, a.line_id), a.amount_usd])) : null;
  const share = periodShare(budget, end);
  const out: BudgetRow[] = [];
  for (const k of new Set([...budgetMap.keys(), ...spent.keys()])) {
    const [account_id, line_id] = k.split('|').map(Number);
    const heading_id = hOf.get(line_id);
    if (heading_id == null || outside.has(account_id)) continue;
    const b = budgetMap.get(k) ?? 0;
    const sp = spent.get(k) ?? 0;
    out.push({
      account_id, line_id, heading_id,
      original: orig ? orig.get(k) ?? 0 : null,
      budget: b, spent: sp, left: b - sp, used: b > 0 ? sp / b : null,
      pace: paceOf(b, sp, share),
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
