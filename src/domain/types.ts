export const TYPES = ['Income', 'Exp', 'Transfer', 'Exchange'] as const;
export type TrxType = (typeof TYPES)[number];

export type Role = 'sup' | 'com' | 'holder';

/** A register row as stored (input columns only). */
export interface Trx {
  id: string;
  n: number | null;
  city_id: number | null;
  account_id: number | null;
  book_id: number | null;
  date: string | null; // YYYY-MM-DD
  type: TrxType | null;
  heading_id: number | null;
  line_id: number | null;
  explanation: string | null;
  party_id: number | null;
  receipt: string | null;
  inc_syp: number;
  exp_syp: number;
  inc_usd: number;
  exp_usd: number;
  trf_syp: number;
  trf_usd: number;
  transfer_group: string | null;
  review: string | null;
  sent_at: string | null;
  /** transfers: the receiver confirmed (or said he did not receive) */
  received_at?: string | null;
  received_by?: string | null;
  disputed_at?: string | null;
  dispute_note?: string | null;
  /** a large expense: approved by whom the settings name */
  approved_at?: string | null;
  approved_by?: string | null;
  /** the grant this money comes from (income in the Superior's book, transfers from it) */
  grant_id?: string | null;
  /** sent to someone who does not keep this private book: a transfer shown for its other side only */
  private_book?: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  source_file: string | null;
}

/** The formula columns R:Z of the Excel register. */
export interface Computed {
  rate: number; // R
  incUsdTot: number; // S
  expUsdTot: number; // T
  code: string; // U
  billCode: string; // V
  month: number | null; // W
  monthEn: string; // X
  year: number | null; // Y
  exchRate: number | null; // Z
}

export interface Named {
  id: number;
  name: string;
  active: number;
  sort?: number;
}

export interface Book extends Named {
  keeper_name: string | null;
  city_id: number | null;
  account_id: number | null;
  is_main: number;
  opening_syp: number;
  opening_usd: number;
  /** only its keepers see it (the Superior's book); others see only the transfers it makes */
  private?: number;
}

export interface Heading extends Named {
  code: string;
}

export interface BudgetLine {
  id: number;
  heading_id: number;
  name: string;
  code: string;
  is_project_fund: number;
  active: number;
}

export interface Donor extends Named {
  default_project_id: number | null;
}

export interface ProjectRule {
  id: number;
  project_id: number;
  account_id: number;
  heading_id: number | null;
}

/** Every reference list, loaded once and kept in memory. */
export interface Lists {
  cities: Named[];
  /** outside_budget: an account outside the centre (e.g. Deir), left out of its budget */
  accounts: (Named & { outside_budget?: number })[];
  projects: Named[];
  books: Book[];
  parties: Named[];
  headings: Heading[];
  headingTypes: { heading_id: number; type: TrxType }[];
  lines: BudgetLine[];
  donors: Donor[];
  rules: ProjectRule[];
  settings: Settings;
}

export interface Settings {
  usd_rate: number; // fallback SYP per USD
  def_city_id: number | null;
  def_account_id: number | null;
  def_book_id: number | null;
  fiscal_start: string | null; // YYYY-MM-DD; dates before it are refused
  exchange_tolerance: number; // 0.25 = ±25 %
  /** an expense from this amount (USD, all currencies counted) needs its scanned document; 0 = never */
  doc_required_usd: number;
  /** large expenses wait for approval */
  approval_on: number;
  approval_usd: number;
  /** the permission profile who approves (e.g. Superior); null = whoever manages users */
  approval_profile_id: number | null;
  /** the rules apply to entries made from these moments on (when each was switched on) */
  doc_since: string | null;
  approval_since: string | null;
}

export const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTHS_AR = [
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
];
