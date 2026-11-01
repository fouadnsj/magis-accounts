// All centres together (Fouad, 2026-11-01): the server keeps every centre's database side by side (a copy of
// Aleppo's brought to Fouad's server beside Homs); this joins them. Per centre: what was spent, with a project,
// not funded. Per grant: one grant written in each centre it covers, matched by its contract number (or, without
// one, by donor, amount and currency), with each centre's share, project, money received and spending.
import type { Computed, Lists, Trx } from './types';
import type { GrantCard, GrantPart, GrantShare } from './grants';
import type { Period } from './reports';
import { projectReport } from './projects';

export interface CentreInput {
  slug: string;
  organisation: string;
  /** jaramana | aleppo | homs | other */
  centre: string;
  /** the register without the Respo book (what the centre's reports count) */
  rows: Trx[];
  comp: Map<string, Computed>;
  lists: Pick<Lists, 'accounts' | 'lines' | 'donors'>;
  grants: GrantCard[];
  grantParts: GrantPart[];
  grantShares: GrantShare[];
}

export interface CentreSummary {
  slug: string;
  organisation: string;
  centre: string;
  spent: number;
  withProject: number;
  notFunded: number;
  outside: number;
  projects: { name: string; donor: string | null; reference: string | null; received: number | null; spent: number; spentAll: number; left: number | null }[];
}

export interface GrantAcross {
  donor: string;
  reference: string | null;
  currency: 'USD' | 'EUR';
  amount: number;
  shares: GrantShare[];
  centres: { slug: string; organisation: string; centre: string; project: string | null; received: number | null; spent: number; spentAll: number }[];
}

export function allCentresReport(inputs: CentreInput[], period: Period): { centres: CentreSummary[]; grants: GrantAcross[] } {
  const centres: CentreSummary[] = [];
  const grants = new Map<string, GrantAcross>();
  for (const c of inputs) {
    const rep = projectReport({ rows: c.rows, comp: c.comp, lists: c.lists, grants: c.grants, grantParts: c.grantParts, grantShares: c.grantShares, period });
    const donorOf = (g: GrantCard | null) => (g ? c.lists.donors.find((d) => d.id === g.donor_id)?.name ?? '' : null);
    const inside = rep.filter((p) => !p.outside);
    const spent = inside.reduce((s, p) => s + p.spent, 0);
    const notFunded = rep.find((p) => p.id == null)?.spent ?? 0;
    centres.push({
      slug: c.slug, organisation: c.organisation, centre: c.centre, spent, withProject: spent - notFunded, notFunded,
      outside: rep.filter((p) => p.outside).reduce((s, p) => s + p.spent, 0),
      projects: inside.filter((p) => p.id != null).map((p) => ({ name: p.name, donor: donorOf(p.grant), reference: p.grant?.reference ?? null, received: p.received, spent: p.spent, spentAll: p.spentAll, left: p.left })),
    });
    for (const g of c.grants) {
      const donor = donorOf(g) ?? '';
      const key = g.reference?.trim() ? `ref:${g.reference.trim().toLowerCase()}` : `${donor.toLowerCase()}|${g.amount}|${g.currency}`;
      const x = grants.get(key) ?? { donor, reference: g.reference?.trim() || null, currency: g.currency, amount: g.amount, shares: [], centres: [] };
      // the shares as written in the first centre that has them
      if (!x.shares.length) x.shares = c.grantShares.filter((s) => s.grant_id === g.id);
      const p = rep.find((r) => r.grant?.id === g.id);
      x.centres.push({ slug: c.slug, organisation: c.organisation, centre: c.centre, project: p?.name ?? null, received: g.status === 'hand' ? g.hand_usd ?? 0 : null, spent: p?.spent ?? 0, spentAll: p?.spentAll ?? 0 });
      grants.set(key, x);
    }
  }
  return { centres, grants: [...grants.values()].sort((a, b) => a.donor.localeCompare(b.donor)) };
}

/** One income or expense for the Explore report, with names (so the rows of several centres go together). */
export interface ExploreRow {
  id: string;
  /** jaramana | aleppo | homs | other */
  centre: string;
  organisation: string;
  n: number | null;
  date: string;
  type: 'Exp' | 'Income';
  heading: string | null;
  line: string | null;
  /** the project (null: not funded, or the centre's own income) */
  project: string | null;
  book: string | null;
  party: string | null;
  explanation: string | null;
  syp: number;
  usd: number;
  /** all in dollars */
  eq: number;
}

/** A centre's incomes and expenses of a period, for Explore. */
export function exploreRows(a: { rows: Trx[]; comp: Map<string, Computed>; lists: Pick<Lists, 'accounts' | 'headings' | 'lines' | 'books' | 'parties'>; centre: string; organisation: string; period: Period }): ExploreRow[] {
  const name = (arr: { id: number; name: string }[], id: number | null | undefined) => (id == null ? null : arr.find((x) => x.id === id)?.name ?? null);
  return a.rows
    .filter((r) => (r.type === 'Exp' || r.type === 'Income') && r.date && r.date.slice(0, 7) >= a.period.from && r.date.slice(0, 7) <= a.period.to)
    .map((r) => {
      const exp = r.type === 'Exp';
      const c = a.comp.get(r.id);
      return {
        id: r.id, centre: a.centre, organisation: a.organisation, n: r.n ?? null, date: r.date!, type: r.type as 'Exp' | 'Income',
        heading: name(a.lists.headings, r.heading_id), line: name(a.lists.lines, r.line_id), project: name(a.lists.accounts, r.account_id),
        book: name(a.lists.books, r.book_id), party: name(a.lists.parties, r.party_id), explanation: r.explanation ?? null,
        syp: exp ? r.exp_syp : r.inc_syp, usd: exp ? r.exp_usd : r.inc_usd, eq: (exp ? c?.expUsdTot : c?.incUsdTot) ?? 0,
      };
    });
}
