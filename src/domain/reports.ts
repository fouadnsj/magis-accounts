// The report sheets of the workbook (Holders, Dashboard, Monthly, Coverage,
// Donors), computed from the register. Same rules as the Excel formulas;
// one difference by design: a period is "YYYY-MM to YYYY-MM", so two years
// never mix, and undated rows (flagged for review) are left out of periods.

import type { Book, Computed, Lists, Trx } from './types';

export interface Period {
  from: string; // YYYY-MM
  to: string; // YYYY-MM
}

export const inPeriod = (t: Trx, p: Period | null) => {
  if (!p) return true;
  if (!t.date) return false;
  const ym = t.date.slice(0, 7);
  return ym >= p.from && ym <= p.to;
};

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

// ---------------------------------------------------------------- Holders

export interface HolderLine {
  book: Book | null; // null = "no book written" (must be nil)
  opening: number;
  income: number;
  expenses: number;
  transfers: number;
  exchange: number; // SYP: + pounds received; USD: − dollars given
  shouldHold: number;
}

/**
 * Holders sheet, sections 1 and 2. A transfer is one row on the keeper's book;
 * the main fund's side is the opposite of all transfers (Holders!E7, E20).
 */
export function holders(rows: Trx[], books: Book[], currency: 'SYP' | 'USD', upTo?: string): HolderLine[] {
  const rs = upTo ? rows.filter((r) => r.date && r.date <= upTo) : rows;
  const inc = (r: Trx) => (currency === 'SYP' ? r.inc_syp : r.inc_usd);
  const exp = (r: Trx) => (currency === 'SYP' ? r.exp_syp : r.exp_usd);
  const trf = (r: Trx) => (currency === 'SYP' ? r.trf_syp : r.trf_usd);
  const exch = (r: Trx) => (currency === 'SYP' ? r.trf_syp : -r.trf_usd);
  const allTransfers = sum(rs.filter((r) => r.type === 'Transfer'), trf);

  const line = (book: Book | null): HolderLine => {
    const mine = rs.filter((r) => (book ? r.book_id === book.id : r.book_id == null));
    const opening = book ? (currency === 'SYP' ? book.opening_syp : book.opening_usd) : 0;
    const income = sum(mine, inc);
    const expenses = sum(mine, exp);
    const transfers = book?.is_main ? -allTransfers : sum(mine.filter((r) => r.type === 'Transfer'), trf);
    const exchange = sum(mine.filter((r) => r.type === 'Exchange'), exch);
    return { book, opening, income, expenses, transfers, exchange, shouldHold: opening + income - expenses + transfers + exchange };
  };
  const out = books.map(line);
  out.push(line(null));
  return out;
}

/** One month of a holder: what he had at the start, what moved, what he has at the end. */
export interface HolderMonthLine {
  book: Book | null;
  start: number;
  income: number;
  expenses: number;
  transfers: number;
  exchange: number;
  end: number;
}

/** Holders for one month (YYYY-MM): start = opening + everything dated before; end = start + the month. */
export function holdersMonth(rows: Trx[], books: Book[], currency: 'SYP' | 'USD', ym: string): HolderMonthLine[] {
  const before = holders(rows.filter((r) => r.date && r.date.slice(0, 7) < ym), books, currency);
  const zero = books.map((b) => ({ ...b, opening_syp: 0, opening_usd: 0 }));
  const during = holders(rows.filter((r) => r.date?.startsWith(ym)), zero, currency);
  return before.map((b, i) => {
    const m = during[i];
    return { book: b.book, start: b.shouldHold, income: m.income, expenses: m.expenses, transfers: m.transfers, exchange: m.exchange, end: b.shouldHold + m.shouldHold };
  });
}

/** The months that have dated rows, oldest first. */
export const monthsOf = (rows: Trx[]) => [...new Set(rows.map((r) => r.date?.slice(0, 7)).filter(Boolean) as string[])].sort();

// ---------------------------------------------------------------- Dashboard / summary

export interface Summary {
  incSyp: number;
  expSyp: number;
  incUsd: number;
  expUsd: number;
  incEq: number;
  expEq: number;
  count: number;
  noLine: number;
  topHeading: { name: string; amount: number } | null;
  topIncomeLine: { name: string; amount: number } | null;
}

export function summary(rows: Trx[], comp: Map<string, Computed>, lists: Lists, p: Period | null): Summary {
  const rs = rows.filter((r) => inPeriod(r, p));
  const c = (r: Trx) => comp.get(r.id)!;
  const byHeading = new Map<number, number>();
  const byLine = new Map<number, number>();
  for (const r of rs) {
    if (r.type === 'Exp' && r.heading_id != null) byHeading.set(r.heading_id, (byHeading.get(r.heading_id) ?? 0) + c(r).expUsdTot);
    if (r.type === 'Income' && r.line_id != null) byLine.set(r.line_id, (byLine.get(r.line_id) ?? 0) + c(r).incUsdTot);
  }
  const top = <K>(m: Map<K, number>, name: (k: K) => string) => {
    let best: { name: string; amount: number } | null = null;
    for (const [k, v] of m) if (!best || v > best.amount) best = { name: name(k), amount: v };
    return best;
  };
  return {
    incSyp: sum(rs, (r) => r.inc_syp),
    expSyp: sum(rs, (r) => r.exp_syp),
    incUsd: sum(rs, (r) => r.inc_usd),
    expUsd: sum(rs, (r) => r.exp_usd),
    incEq: sum(rs, (r) => c(r).incUsdTot),
    expEq: sum(rs, (r) => c(r).expUsdTot),
    count: rs.length,
    noLine: rs.filter((r) => (r.type === 'Income' || r.type === 'Exp') && r.line_id == null).length,
    topHeading: top(byHeading, (k) => lists.headings.find((h) => h.id === k)?.name ?? '?'),
    topIncomeLine: top(byLine, (k) => lists.lines.find((l) => l.id === k)?.name ?? '?'),
  };
}

// ---------------------------------------------------------------- Monthly

export interface MonthLine {
  ym: string;
  incSyp: number;
  expSyp: number;
  incUsd: number;
  expUsd: number;
  incEq: number;
  expEq: number;
  count: number;
  cumSyp: number;
  cumUsd: number;
}

export function monthly(rows: Trx[], comp: Map<string, Computed>, year: number): MonthLine[] {
  const out: MonthLine[] = [];
  let cumSyp = 0;
  let cumUsd = 0;
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    const rs = rows.filter((r) => r.date?.startsWith(ym));
    const l: MonthLine = {
      ym,
      incSyp: sum(rs, (r) => r.inc_syp),
      expSyp: sum(rs, (r) => r.exp_syp),
      incUsd: sum(rs, (r) => r.inc_usd),
      expUsd: sum(rs, (r) => r.exp_usd),
      incEq: sum(rs, (r) => comp.get(r.id)!.incUsdTot),
      expEq: sum(rs, (r) => comp.get(r.id)!.expUsdTot),
      count: rs.length,
      cumSyp: 0,
      cumUsd: 0,
    };
    cumSyp += l.incSyp - l.expSyp;
    cumUsd += l.incUsd - l.expUsd;
    l.cumSyp = cumSyp;
    l.cumUsd = cumUsd;
    out.push(l);
  }
  return out;
}

// ---------------------------------------------------------------- Coverage (confidential)

export interface CoverageSummary {
  expenses: number;
  ownIncome: number;
  gap: number;
  projectFunds: number;
  surplus: number;
  pctOwn: number;
  pctFunds: number;
  pctNot: number;
}

const isFundRow = (r: Trx, lists: Lists) =>
  r.type === 'Income' && r.line_id != null && !!lists.lines.find((l) => l.id === r.line_id)?.is_project_fund;

function coverageOf(rs: Trx[], comp: Map<string, Computed>, lists: Lists): CoverageSummary {
  const expenses = sum(rs.filter((r) => r.type === 'Exp'), (r) => comp.get(r.id)!.expUsdTot);
  const allIncome = sum(rs.filter((r) => r.type === 'Income'), (r) => comp.get(r.id)!.incUsdTot);
  const projectFunds = sum(rs.filter((r) => isFundRow(r, lists)), (r) => comp.get(r.id)!.incUsdTot);
  const ownIncome = allIncome - projectFunds;
  const pctOwn = expenses ? Math.min(1, ownIncome / expenses) : 0;
  const pctFunds = expenses ? Math.min(1 - pctOwn, projectFunds / expenses) : 0;
  return {
    expenses,
    ownIncome,
    gap: Math.max(0, expenses - ownIncome),
    projectFunds,
    surplus: ownIncome + projectFunds - expenses,
    pctOwn,
    pctFunds,
    pctNot: 1 - pctOwn - pctFunds,
  };
}

export interface CoverageReport {
  summary: CoverageSummary;
  accounts: { id: number; name: string }[];
  /** heading id (null = no valid Exp heading) → spending per account id */
  byHeading: { headingId: number | null; name: string; perAccount: Map<number, number>; total: number; own: number; funds: number; notCovered: number; share: number }[];
  byMonth: { ym: string; expenses: number; own: number; funds: number; surplus: number; pctOwn: number }[];
}

export function coverage(rows: Trx[], comp: Map<string, Computed>, lists: Lists, p: Period, year: number): CoverageReport {
  const rs = rows.filter((r) => inPeriod(r, p));
  const s = coverageOf(rs, comp, lists);
  const accounts = lists.accounts.map((a) => ({ id: a.id, name: a.name }));
  const expHeadings = lists.headings.filter((h) => lists.headingTypes.some((t) => t.heading_id === h.id && t.type === 'Exp'));
  const exps = rs.filter((r) => r.type === 'Exp');
  const rowFor = (headingId: number | null, name: string, pick: (r: Trx) => boolean) => {
    const perAccount = new Map<number, number>();
    for (const a of accounts) perAccount.set(a.id, sum(exps.filter((r) => pick(r) && r.account_id === a.id), (r) => comp.get(r.id)!.expUsdTot));
    const total = sum(exps.filter(pick), (r) => comp.get(r.id)!.expUsdTot);
    return { headingId, name, perAccount, total, own: total * s.pctOwn, funds: total * s.pctFunds, notCovered: total * (1 - s.pctOwn - s.pctFunds), share: s.expenses ? total / s.expenses : 0 };
  };
  const expIds = new Set(expHeadings.map((h) => h.id));
  const byHeading = [
    ...expHeadings.map((h) => rowFor(h.id, h.name, (r) => r.heading_id === h.id)),
    rowFor(null, '', (r) => r.heading_id == null || !expIds.has(r.heading_id)),
  ];
  const byMonth = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    const c = coverageOf(rows.filter((r) => r.date?.startsWith(ym)), comp, lists);
    byMonth.push({
      ym,
      expenses: c.expenses,
      own: c.ownIncome,
      funds: c.projectFunds,
      surplus: c.surplus,
      pctOwn: c.expenses === 0 ? 0 : c.ownIncome > c.expenses ? 1 : c.ownIncome / c.expenses,
    });
  }
  return { summary: s, accounts, byHeading, byMonth };
}

// ---------------------------------------------------------------- Funding (the Superior's)

// How the centre's expenses (every book, the Superior's too) are paid: by the
// centre's own income, and by what the Respo book sends (grants, the Province).
// The Respo book itself is outside the centre.

export interface FundingMonth {
  ym: string;
  expenses: number;
  own: number;
  /** sent by the Respo to the books, less what came back to it */
  fromRespo: number;
  /** own + fromRespo − expenses */
  surplus: number;
  pctOwn: number;
  pctRespo: number;
  /** what reached the Respo: grants in hand, and the rest (the Province...) */
  respoGrants: number;
  respoOther: number;
}

export interface FundingReport {
  total: FundingMonth;
  byMonth: FundingMonth[];
  /** the Respo's cash at the end of the period */
  respoSyp: number;
  respoUsd: number;
  /** expenses by heading, and how they are paid (same % for every heading) */
  byHeading: { headingId: number | null; name: string; total: number; share: number }[];
}

export function funding(rows: Trx[], comp: Map<string, Computed>, lists: Lists, respoId: number | null, p: Period): FundingReport {
  const isLegacyFund = (r: Trx) => isFundRow(r, lists);
  const usdTrf = (r: Trx) => r.trf_usd + r.trf_syp / (comp.get(r.id)?.rate || 1);
  const of = (rs: Trx[], ym: string): FundingMonth => {
    const centre = rs.filter((r) => r.book_id !== respoId || respoId == null);
    const respo = respoId == null ? [] : rs.filter((r) => r.book_id === respoId);
    const expenses = sum(centre.filter((r) => r.type === 'Exp'), (r) => comp.get(r.id)?.expUsdTot ?? 0);
    const own = sum(centre.filter((r) => r.type === 'Income' && !isLegacyFund(r)), (r) => comp.get(r.id)?.incUsdTot ?? 0);
    const fromRespo = -sum(respo.filter((r) => r.type === 'Transfer'), usdTrf)
      + sum(centre.filter(isLegacyFund), (r) => comp.get(r.id)?.incUsdTot ?? 0);
    const respoInc = respo.filter((r) => r.type === 'Income');
    const respoGrants = sum(respoInc.filter((r) => r.grant_id), (r) => comp.get(r.id)?.incUsdTot ?? 0);
    const respoOther = sum(respoInc.filter((r) => !r.grant_id), (r) => comp.get(r.id)?.incUsdTot ?? 0);
    const pctOwn = expenses ? Math.min(1, Math.max(0, own) / expenses) : 0;
    const pctRespo = expenses ? Math.min(1 - pctOwn, Math.max(0, fromRespo) / expenses) : 0;
    return { ym, expenses, own, fromRespo, surplus: own + fromRespo - expenses, pctOwn, pctRespo, respoGrants, respoOther };
  };
  const rs = rows.filter((r) => inPeriod(r, p));
  const months: string[] = [];
  for (let ym = p.from; ym <= p.to; ) {
    months.push(ym);
    const [y, m] = ym.split('-').map(Number);
    ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  const byMonth = months.map((ym) => of(rs.filter((r) => r.date?.startsWith(ym)), ym));
  const total = of(rs, '');
  const book = lists.books.find((b) => b.id === respoId);
  const end = `${p.to}-31`;
  const respoSyp = book ? holders(rows, [book], 'SYP', end)[0].shouldHold : 0;
  const respoUsd = book ? holders(rows, [book], 'USD', end)[0].shouldHold : 0;
  const exps = rs.filter((r) => r.type === 'Exp' && (r.book_id !== respoId || respoId == null));
  const expHeadings = lists.headings.filter((h) => lists.headingTypes.some((t) => t.heading_id === h.id && t.type === 'Exp'));
  const expIds = new Set(expHeadings.map((h) => h.id));
  const line = (headingId: number | null, name: string, pick: (r: Trx) => boolean) => {
    const t = sum(exps.filter(pick), (r) => comp.get(r.id)?.expUsdTot ?? 0);
    return { headingId, name, total: t, share: total.expenses ? t / total.expenses : 0 };
  };
  const byHeading = [
    ...expHeadings.map((h) => line(h.id, h.name, (r) => r.heading_id === h.id)),
    line(null, '', (r) => r.heading_id == null || !expIds.has(r.heading_id)),
  ].filter((h) => Math.abs(h.total) > 0.005);
  return { total, byMonth, respoSyp, respoUsd, byHeading };
}

// ---------------------------------------------------------------- Project funds (Donors sheet)

export interface GrantRow {
  id: string;
  date: string;
  donor_id: number;
  project_id: number | null;
  amount_usd: number;
  reference: string | null;
  note: string | null;
}

/** Project of an account: the ProjectMap rule for that account with Heading = All. */
export function projectOfAccount(lists: Lists, accountId: number | null): number | null {
  if (accountId == null) return null;
  return lists.rules.find((r) => r.account_id === accountId && r.heading_id == null)?.project_id ?? null;
}

/** Spent_USD per rule: a named heading wins over "All" for the same account. */
export function spentByRule(rows: Trx[], comp: Map<string, Computed>, lists: Lists): Map<number, number> {
  const out = new Map<number, number>();
  const exps = rows.filter((r) => r.type === 'Exp');
  for (const rule of lists.rules) {
    const named = lists.rules.filter((x) => x.account_id === rule.account_id && x.heading_id != null).map((x) => x.heading_id);
    const pick =
      rule.heading_id == null
        ? (r: Trx) => r.account_id === rule.account_id && !named.includes(r.heading_id)
        : (r: Trx) => r.account_id === rule.account_id && r.heading_id === rule.heading_id;
    out.set(rule.id, sum(exps.filter(pick), (r) => comp.get(r.id)!.expUsdTot));
  }
  return out;
}

export interface ProjectFundLine {
  projectId: number;
  name: string;
  received: number;
  sent: number;
  atRespo: number;
  spent: number;
  unspent: number;
  status: 'used' | 'remaining' | 'overspent' | 'enter_grant' | 'none';
}

export interface ProjectFunds {
  lines: ProjectFundLine[];
  received: number;
  sent: number;
  sentNoProject: number; // must be nil
  respoRows: number;
  heldByRespo: number;
  expensesNoProject: number; // must be nil
  sentRows: { trx: Trx; projectId: number | null; usd: number }[];
}

export function projectFunds(rows: Trx[], comp: Map<string, Computed>, lists: Lists, grants: GrantRow[]): ProjectFunds {
  const sentRows = rows
    .filter((r) => isFundRow(r, lists))
    .map((trx) => ({ trx, projectId: projectOfAccount(lists, trx.account_id), usd: comp.get(trx.id)!.incUsdTot }));
  const spent = spentByRule(rows, comp, lists);
  const lines: ProjectFundLine[] = lists.projects.map((p) => {
    const received = sum(grants.filter((g) => g.project_id === p.id), (g) => g.amount_usd);
    const sent = sum(sentRows.filter((s) => s.projectId === p.id), (s) => s.usd);
    const sp = sum(lists.rules.filter((r) => r.project_id === p.id), (r) => spent.get(r.id) ?? 0);
    const atRespo = received - sent;
    const unspent = sent - sp;
    const status: ProjectFundLine['status'] =
      unspent < -0.5 ? 'overspent' : atRespo < -0.5 ? 'enter_grant' : received === 0 && sent === 0 && sp === 0 ? 'none' : Math.abs(unspent) <= 0.5 && Math.abs(atRespo) <= 0.5 ? 'used' : 'remaining';
    return { projectId: p.id, name: p.name, received, sent, atRespo, spent: sp, unspent, status };
  });
  const received = sum(grants, (g) => g.amount_usd);
  const sent = sum(sentRows, (s) => s.usd);
  const allExp = sum(rows.filter((r) => r.type === 'Exp'), (r) => comp.get(r.id)!.expUsdTot);
  const allSpent = sum([...spent.values()], (x) => x);
  return {
    lines,
    received,
    sent,
    sentNoProject: sum(sentRows.filter((s) => s.projectId == null), (s) => s.usd),
    respoRows: sentRows.length,
    heldByRespo: received - sent,
    expensesNoProject: allExp - allSpent,
    sentRows,
  };
}

// ---------------------------------------------------------------- Exchange log

export function exchangeLog(rows: Trx[], p: Period | null) {
  const ex = rows.filter((r) => r.type === 'Exchange' && inPeriod(r, p));
  return {
    rows: ex.map((r) => ({ trx: r, usdOut: r.trf_usd, sypIn: r.trf_syp, rate: r.trf_usd ? r.trf_syp / r.trf_usd : 0 })),
    usd: sum(ex, (r) => r.trf_usd),
    syp: sum(ex, (r) => r.trf_syp),
  };
}

// ---------------------------------------------------------------- building sites: budget per heading

export interface BuildingBudgetLine {
  heading: Lists['headings'][number];
  budget: number; // USD
  usd: number; // paid in dollars
  conv: number; // paid in pounds, in USD at each row's rate
  total: number;
  rest: number;
  /** spent by kind: line name (Materials, Wages, Other) → USD-eq */
  byLine: { line: Lists['lines'][number]; total: number }[];
}

/**
 * The Data sheet of a building-site workbook: for each expense heading, its budget,
 * what was paid in USD, the pounds converted (Syp / Rate), the total and what is left.
 * Exchanges are not spending (Excel counted them under "Exchange"; Fouad, 17 Oct 2026).
 * Cancelled rows hold no amount.
 */
export function buildingBudget(rows: Trx[], comp: Map<string, Computed>, lists: Lists, p: Period | null = null): BuildingBudgetLine[] {
  const expHeadings = new Set(lists.headingTypes.filter((x) => x.type === 'Exp').map((x) => x.heading_id));
  const exps = rows.filter((r) => r.type === 'Exp' && inPeriod(r, p));
  return lists.headings
    .filter((h) => expHeadings.has(h.id))
    .map((h) => {
      const mine = exps.filter((r) => r.heading_id === h.id);
      const usd = sum(mine, (r) => r.exp_usd);
      const conv = sum(mine, (r) => (comp.get(r.id)?.expUsdTot ?? 0) - r.exp_usd);
      const budget = h.budget_usd ?? 0;
      const byLine = lists.lines
        .filter((l) => l.heading_id === h.id)
        .map((line) => ({ line, total: sum(mine.filter((r) => r.line_id === line.id), (r) => comp.get(r.id)?.expUsdTot ?? 0) }));
      return { heading: h, budget, usd, conv, total: usd + conv, rest: budget - usd - conv, byLine };
    });
}
