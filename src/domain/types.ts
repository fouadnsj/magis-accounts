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
  accounts: Named[];
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
}

export const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTHS_AR = [
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
];
