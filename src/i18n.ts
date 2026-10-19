// Every label is bilingual, Arabic first: "عربي · English".
// The user can switch to English only (Settings); Arabic stays the default.
// Three languages (Fouad, 18 October 2026): each person may also choose French
// or Arabic alone. A text without its French yet shows in English.

import { FR, FR_PATTERNS } from './i18n-fr';

// the patterns of i18n-fr.ts as regular expressions, made once; and the texts already looked up
const PATTERNS = FR_PATTERNS.map(([en, fr]) => {
  const order: number[] = [];
  const src = en.split(/(\{\d\})/).map((part) => {
    const ph = /^\{(\d)\}$/.exec(part);
    if (ph) { order.push(Number(ph[1])); return '([\\s\\S]*?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { re: new RegExp(`^${src}$`), order, fr };
});
const seen = new Map<string, string>();
/** The French of an English text of the centres' screens (i18n-fr.ts), or the English itself. */
export function frOf(en: string): string {
  const hit = Object.prototype.hasOwnProperty.call(FR, en) ? FR[en] : seen.get(en);
  if (hit !== undefined) return hit;
  let out = en;
  for (const p of PATTERNS) {
    const mt = p.re.exec(en);
    if (!mt) continue;
    out = p.fr.replace(/\{(\d)\}/g, (_, i: string) => mt[p.order.indexOf(Number(i)) + 1] ?? '');
    break;
  }
  if (seen.size < 5000) seen.set(en, out);
  return out;
}

export interface Msg {
  ar: string;
  en: string;
  fr?: string;
}

export const m = (ar: string, en: string, fr?: string): Msg => (fr === undefined ? { ar, en } : { ar, en, fr });

export type LangMode = 'both' | 'en' | 'fr' | 'ar';
export const LANG_MODES: readonly LangMode[] = ['both', 'en', 'fr', 'ar'];
let mode: LangMode = 'both';
try {
  const saved = localStorage.getItem('lang');
  if ((LANG_MODES as readonly string[]).includes(saved ?? '')) mode = saved as LangMode;
} catch {
  /* no storage: keep default */
}

export function getLang(): LangMode {
  return mode;
}
export function setLang(l: LangMode) {
  mode = l;
  try {
    localStorage.setItem('lang', l);
  } catch {
    /* ignore */
  }
}

/** Text of a message in the current mode. */
export function tx(msg: Msg): string {
  return txIn(msg, mode);
}

/** Text of a message in a given mode. */
export function txIn(msg: Msg, l: LangMode): string {
  if (l === 'en') return msg.en;
  if (l === 'fr') return msg.fr ?? frOf(msg.en);
  if (l === 'ar') return msg.ar;
  return `${msg.ar} · ${msg.en}`;
}

/** Arabic reads right to left. */
export const isRtl = (l: LangMode = mode) => l === 'ar';

export const TYPE_LABEL: Record<string, Msg> = {
  Income: m('إيراد', 'Income', 'Recette'),
  Exp: m('نفقة', 'Expense', 'Dépense'),
  Transfer: m('تحويل', 'Transfer', 'Transfert'),
  Exchange: m('تصريف', 'Exchange', 'Change'),
};

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** The name of a month (0 = January) in the person's language. */
export function monthWord(i: number, ar: readonly string[], en: readonly string[]): string {
  if (mode === 'en') return en[i];
  if (mode === 'fr') return MONTHS_FR[i];
  if (mode === 'ar') return ar[i];
  return `${ar[i]} · ${en[i]}`;
}
