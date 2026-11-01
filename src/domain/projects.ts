// The centre's report by project (Fouad, 2026-11-01): each project (a grant's share here, or
// private money) with what was spent on it, line by line; what is not funded; and the projects
// outside the budget (Deir) apart. The fund of an expense already comes from its line (see the
// register), so a project's spending is the expenses written on it.
import type { Computed, Lists, Trx } from './types';
import type { GrantCard, GrantPart, GrantShare } from './grants';
import { inPeriod, type Period } from './reports';

export interface ProjectLine {
  heading_id: number | null;
  line_id: number | null;
  /** USD (pounds at the rate of each expense) */
  spent: number;
  rows: number;
}

export interface ProjectRow {
  /** the project (an account); null = not funded */
  id: number | null;
  name: string;
  outside: boolean;
  grant: GrantCard | null;
  /** this centre's share of the grant, in the grant's currency */
  share: number | null;
  /** every centre's share of the grant */
  shares: GrantShare[];
  /** dollars received in hand for the grant (null: not yet in hand) */
  received: number | null;
  /** spent in the period, and since the beginning */
  spent: number;
  spentAll: number;
  /** received − spent since the beginning (null: not in hand) */
  left: number | null;
  lines: ProjectLine[];
  /** the expenses of the period, oldest first */
  expenses: Trx[];
}

export function projectReport(a: {
  rows: Trx[];
  comp: Map<string, Computed>;
  lists: Pick<Lists, 'accounts' | 'lines'>;
  grants: GrantCard[];
  grantParts: GrantPart[];
  grantShares: GrantShare[];
  period: Period;
}): ProjectRow[] {
  const usd = (r: Trx) => a.comp.get(r.id)?.expUsdTot ?? 0;
  const exps = a.rows.filter((r) => r.type === 'Exp' && r.date && !r.private_total);
  const headingOf = new Map(a.lists.lines.map((l) => [l.id, l.heading_id]));
  const make = (id: number | null, name: string, outside: boolean): ProjectRow => {
    const all = exps.filter((r) => (id == null ? r.account_id == null : r.account_id === id));
    const mine = all.filter((r) => inPeriod(r, a.period)).sort((x, y) => x.date!.localeCompare(y.date!) || (x.n ?? 0) - (y.n ?? 0));
    const byLine = new Map<string, ProjectLine>();
    for (const r of mine) {
      const k = `${r.line_id}`;
      const x = byLine.get(k) ?? { heading_id: r.heading_id ?? (r.line_id != null ? headingOf.get(r.line_id) ?? null : null), line_id: r.line_id, spent: 0, rows: 0 };
      x.spent += usd(r);
      x.rows += 1;
      byLine.set(k, x);
    }
    const part = id == null ? undefined : a.grantParts.find((p) => p.account_id === id);
    const grant = part ? a.grants.find((g) => g.id === part.grant_id) ?? null : null;
    // in hand: the dollars received, divided between the grant's projects here by their amounts
    const parts = grant ? a.grantParts.filter((x) => x.grant_id === grant.id) : [];
    const whole = parts.reduce((t, x) => t + x.amount, 0);
    const received = grant?.status === 'hand' ? (grant.hand_usd ?? 0) * (whole > 0 && part ? part.amount / whole : 1) : null;
    const spentAll = all.reduce((s, r) => s + usd(r), 0);
    return {
      id, name, outside, grant, share: part?.amount ?? null,
      shares: grant ? a.grantShares.filter((x) => x.grant_id === grant.id) : [],
      received, spent: mine.reduce((s, r) => s + usd(r), 0), spentAll,
      left: received == null ? null : received - spentAll,
      lines: [...byLine.values()].sort((x, y) => y.spent - x.spent),
      expenses: mine,
    };
  };
  const out = a.lists.accounts.map((acc) => make(acc.id, acc.name, !!acc.outside_budget));
  out.push(make(null, '', false));
  return out.filter((p) => p.expenses.length || p.grant || p.spentAll);
}
