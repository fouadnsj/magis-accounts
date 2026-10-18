// The files between a community and the country econome (until there is one server for
// the country). Two kinds:
//  - the monthly file (community → country): the month's totals by code for the whole
//    community (members and house together), the cash, bank and économat at the end of
//    the month, the expenses claimed from the Province (with the Jesuit's name, so the
//    country econome can check them: Fouad, 18 October 2026), and the charges the
//    community makes to other communities (it hosted one of their Jesuits);
//  - the return file (country → community): the decisions on the claims and the
//    community's account at the économat as the country econome keeps it.
// Bringing the same file in twice changes nothing.

import type { Money } from './domain';

export const MONTH_FILE = 'magis-cty-month';
export const RETURN_FILE = 'magis-cty-return';
/** The months of a quarter in one file (a community that closes by quarter). */
export const MONTH_BUNDLE = 'magis-cty-months';
export interface MonthBundle { kind: typeof MONTH_BUNDLE; version: 1; files: MonthFile[] }

export interface FileClaim {
  /** the community's entry id: the same claim, whatever file brings it */
  id: string;
  date: string;
  code: string | null;
  line: string | null;
  /** personal | house */
  book_kind: string | null;
  /** the Jesuit whose expense it is (or the house's minister) */
  person: string | null;
  cur: 'LOC' | 'USD' | 'EUR';
  amount: number;
  reason: string | null;
  note: string | null;
}

export interface MonthFile {
  kind: typeof MONTH_FILE;
  version: 1;
  community: { uid: string; name: string; country: string | null; local: string };
  ym: string;
  made_at: string;
  made_by: string;
  /** income (+) and expenses (−) by code, members and house together */
  totals: Record<string, Money>;
  /** members and house together: carried over, received from the econome, given back, kept */
  cash: { carried: Money; received: Money; givenBack: Money; kept: Money; income: Money; expenses: Money };
  /** what the econome's books held at the end of the month */
  books: { cash: Money; bank: Money; economat: Money };
  members: number;
  claims: FileClaim[];
  /** what this community charges others (it hosted one of their Jesuits…) */
  charges?: FileCharge[];
}

export interface FileCharge {
  id: string;
  date: string;
  /** the community charged, if known (from a return file); otherwise its name */
  to_uid: string | null;
  to_name: string;
  person: string | null;
  cur: 'LOC' | 'USD' | 'EUR';
  amount: number;
  note: string;
}

export interface StatementLine {
  id: string;
  date: string;
  /** claim | host | charged | paid_by_cty | paid_to_cty | cotisation | other */
  kind: string;
  note: string | null;
  cur: 'LOC' | 'USD' | 'EUR';
  /** > 0 in the community's favour, < 0 the community owes */
  amount: number;
}

export interface ReturnFile {
  kind: typeof RETURN_FILE;
  version: 1;
  community_uid: string;
  country: string;
  made_at: string;
  made_by: string;
  decisions: { id: string; status: 'waiting' | 'accepted' | 'refused' | 'withdrawn'; accepted: number | null; note: string | null }[];
  statement: StatementLine[];
  /** the decisions on the charges this community proposed */
  chargeDecisions?: { id: string; status: 'waiting' | 'approved' | 'refused' | 'withdrawn'; note: string | null }[];
  /** the communities of the country, to choose from when charging one */
  communities?: { uid: string; name: string }[];
  /** the chart of codes, kept by the country econome (later the Province) */
  chart?: ChartRow[];
}

export interface ChartRow {
  uid: string;
  parent_uid: string | null;
  code: string;
  type: 'Income' | 'Exp';
  name_en: string;
  name_fr: string;
  name_ar: string;
  scope: 'P' | 'H';
  claim: string | null;
  active: number;
  sort: number;
}

/** A short fingerprint of a file's content (to see whether a month was sent again unchanged). */
export async function fingerprint(x: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stable(x));
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** JSON with the keys in order, so the same content always gives the same text. */
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(x);
}
