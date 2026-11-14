// Texts and numbers of the community screens, in the three languages each
// person chooses (English, French, Arabic; or Arabic · English as in MAGIS).
import { getLang, m, tx, type LangMode } from '../../i18n';
import type { CtyAccount, Cur } from '../domain';

/** A text in three languages: Arabic, English, French. */
export const t3 = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));

/** A name stored as "عربي · English · Français" (the community roles), in the person's language. */
export function triName(s: string): string {
  const parts = s.split(' + ').map((one) => {
    const p = one.split(' · ');
    return p.length === 3 ? tx(m(p[0], p[1], p[2])) : one;
  });
  return parts.join(' + ');
}

/** The name of a line of the chart. */
export function accName(a: Pick<CtyAccount, 'name_en' | 'name_fr' | 'name_ar'> | undefined | null, l: LangMode = getLang()): string {
  if (!a) return '—';
  if (l === 'fr') return a.name_fr;
  if (l === 'ar') return a.name_ar;
  if (l === 'en') return a.name_en;
  return `${a.name_ar} · ${a.name_en}`;
}

/** The currency as people say it. */
export function curName(c: Cur, local: string): string {
  if (c === 'USD') return '$';
  if (c === 'EUR') return '€';
  return local === 'SYP' ? t3('ل.س', 'SYP', 'LS') : local;
}

/** An amount: the local currency without decimals, dollars and euros with cents when there are any. */
export function money(n: number, c: Cur): string {
  const x = Math.abs(n);
  const s = c === 'LOC' ? Math.round(x).toLocaleString('en-US') : x.toLocaleString('en-US', { minimumFractionDigits: x % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return n < 0 ? `−${s}` : s;
}
export const moneyCur = (n: number, c: Cur, local: string) => (c === 'LOC' ? `${money(n, c)} ${curName(c, local)}` : `${curName(c, local)}${money(n, c)}`);

const MONTHS = {
  ar: ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
};
/** "October 2025", in the person's language. */
export function monthName(ym: string, short = false): string {
  const i = Number(ym.slice(5, 7)) - 1;
  const y = ym.slice(0, 4);
  const pick = (k: 'ar' | 'en' | 'fr') => (short ? MONTHS[k][i].slice(0, k === 'ar' ? 20 : 3) : MONTHS[k][i]);
  const l = getLang();
  const name = l === 'both' ? `${pick('ar')} · ${pick('en')}` : pick(l === 'fr' ? 'fr' : l === 'ar' ? 'ar' : 'en');
  return short ? name : `${name} ${y}`;
}
/** "1st quarter", the year starting in October (Oct–Dec = 1st). */
export function quarterWord(q: number): string {
  const ar = ['الفصل الأول', 'الفصل الثاني', 'الفصل الثالث', 'الفصل الرابع'][q - 1];
  const en = ['1st quarter', '2nd quarter', '3rd quarter', '4th quarter'][q - 1];
  const fr = ['1er trimestre', '2e trimestre', '3e trimestre', '4e trimestre'][q - 1];
  return t3(ar, en, fr);
}
/**
 * A period said in full (Fouad, 14 November 2026: "the period must be more clear"):
 * one month → "October 2026"; a quarter → "1st quarter · October – December 2026".
 */
export function periodName(months: string[]): string {
  if (months.length <= 1) return monthName(months[0]);
  const first = months[0];
  const last = months[months.length - 1];
  const q = Number(first.slice(5, 7)) >= 10 ? 1 : Math.floor((Number(first.slice(5, 7)) - 1) / 3) + 2;
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const from = sameYear ? monthName(first).replace(/ \d{4}$/, '') : monthName(first);
  return `${months.length === 3 ? `${quarterWord(q)} · ` : ''}${from} – ${monthName(last)}`;
}
/** "Oct 2025 – Sept 2026" */
export const yearName = (y: number) => `${monthName(`${y}-10`, true)} ${y} – ${monthName(`${y + 1}-09`, true)} ${y + 1}`;

export function dayName(d: string): string {
  return `${Number(d.slice(8, 10))} ${monthName(d.slice(0, 7), true)}`;
}

/** The currency with its name: "SYP · Syrian pound". */
export function curLong(c: Cur, local: string): string {
  if (c === 'USD') return t3('دولار أمريكي', 'US dollar', 'Dollar américain');
  if (c === 'EUR') return t3('يورو', 'Euro', 'Euro');
  return local === 'SYP' ? t3('ليرة سورية', 'Syrian pound', 'Livre syrienne') : local;
}
/** The short code shown beside an amount. */
export const curCode = (c: Cur, local: string) => (c === 'LOC' ? local : c);
