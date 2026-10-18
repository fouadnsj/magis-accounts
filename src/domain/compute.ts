// The formula columns R:Z of the Excel register, computed exactly as Excel does.
// Proven row by row against the values Excel saved in Master Sup.xlsx
// (tests/juge.test.ts). If you change anything here, run the tests.

import type { Computed, Lists, Trx } from './types';
import { MONTHS_EN } from './types';

/** Z — Exch_Rate: =IF(F="Exchange", IFERROR(P/Q,""), "") */
export function exchRate(t: Pick<Trx, 'type' | 'trf_syp' | 'trf_usd'>): number | null {
  if (t.type !== 'Exchange') return null;
  if (!t.trf_usd) return null;
  return t.trf_syp / t.trf_usd;
}

interface RateIndex {
  /** book key → ascending dates, with the exchange rates of that date */
  byBook: Map<string, { dates: string[]; rates: number[][] }>;
  all: { dates: string[]; rates: number[][] };
}

const bookKey = (id: number | null) => (id == null ? '' : String(id));

function addTo(idx: { dates: string[]; rates: number[][] }, date: string, rate: number) {
  // dates arrive sorted; consecutive equal dates share a slot
  const last = idx.dates.length - 1;
  if (last >= 0 && idx.dates[last] === date) idx.rates[last].push(rate);
  else {
    idx.dates.push(date);
    idx.rates.push([rate]);
  }
}

function buildRateIndex(rows: Trx[]): RateIndex {
  const ex = rows
    .filter((r) => r.type === 'Exchange' && r.date)
    .map((r) => ({ date: r.date as string, book: bookKey(r.book_id), rate: exchRate(r) }))
    .filter((e): e is { date: string; book: string; rate: number } => e.rate != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const idx: RateIndex = { byBook: new Map(), all: { dates: [], rates: [] } };
  for (const e of ex) {
    // MAXIFS(…, Exch_Rate, ">0", …): only positive rates can be "the latest exchange".
    // AVERAGEIFS then averages every rate on that date (Excel ignores the "" cells).
    addTo(idx.all, e.date, e.rate);
    if (!idx.byBook.has(e.book)) idx.byBook.set(e.book, { dates: [], rates: [] });
    addTo(idx.byBook.get(e.book)!, e.date, e.rate);
  }
  return idx;
}

/** Latest slot whose date ≤ d holding at least one positive rate. */
function latestOnOrBefore(idx: { dates: string[]; rates: number[][] }, d: string): number[] | null {
  let lo = 0;
  let hi = idx.dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.dates[mid] <= d) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  for (let i = found; i >= 0; i--) {
    if (idx.rates[i].some((r) => r > 0)) return idx.rates[i];
  }
  return null;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * R — Rate. Exchange row: its own rate P/Q.
 * Otherwise: average rate of the latest exchange on or before the date in the SAME book;
 * else the latest exchange in any book; else the fallback USD_Rate.
 */
function rateFor(t: Trx, idx: RateIndex, fallback: number): number {
  if (t.type === 'Exchange') {
    const r = exchRate(t);
    return r == null ? fallback : r;
  }
  if (!t.date) return fallback;
  const own = idx.byBook.get(bookKey(t.book_id));
  const inBook = own ? latestOnOrBefore(own, t.date) : null;
  if (inBook) return avg(inBook);
  const any = latestOnOrBefore(idx.all, t.date);
  if (any) return avg(any);
  return fallback;
}

/** V — Bill_Code: code (or TYP) - last 3 digits of the receipt - MMYY */
export function billCode(t: Trx, code: string, month: number | null, year: number | null): string {
  if (!t.type) return '';
  const head = code !== '' ? code : t.type.slice(0, 3).toUpperCase();
  const right3 = (t.receipt ?? '').toString().slice(-3).trim();
  const num = right3 === '' ? NaN : Number(right3);
  const rec = Number.isFinite(num) ? String(Math.round(num)).padStart(3, '0') : '000';
  const mm = month == null ? '01' : String(month).padStart(2, '0');
  const yy = year == null ? '00' : String(year % 100).padStart(2, '0');
  return `${head}-${rec}-${mm}${yy}`;
}

export function computeAll(rows: Trx[], lists: Lists): Map<string, Computed> {
  const idx = buildRateIndex(rows);
  const fallback = lists.settings.usd_rate;
  const lineCode = new Map(lists.lines.map((l) => [l.id, l.code]));
  const out = new Map<string, Computed>();
  for (const t of rows) {
    const rate = rateFor(t, idx, fallback);
    const div = (x: number) => (rate ? x / rate : 0); // IFERROR(L/R, 0)
    const month = t.date ? Number(t.date.slice(5, 7)) : null;
    const year = t.date ? Number(t.date.slice(0, 4)) : null;
    const code = t.line_id != null ? lineCode.get(t.line_id) ?? '' : '';
    out.set(t.id, {
      rate,
      incUsdTot: t.inc_usd + div(t.inc_syp),
      expUsdTot: t.exp_usd + div(t.exp_syp),
      code,
      billCode: billCode(t, code, month, year),
      month,
      monthEn: month ? MONTHS_EN[month - 1] : '',
      year,
      exchRate: exchRate(t),
    });
  }
  return out;
}

/** The rate a new row of this book would get on this date (for forms and warnings). */
export function rateOn(rows: Trx[], bookId: number | null, date: string, fallback: number): number {
  const idx = buildRateIndex(rows);
  const probe = { id: '', type: 'Exp', date, book_id: bookId } as Trx;
  return rateFor(probe, idx, fallback);
}
