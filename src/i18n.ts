// Every label is bilingual, Arabic first: "عربي · English".
// The user can switch to English only (Settings); Arabic stays the default.
// Three languages (Fouad, 18 October 2026): each person may also choose French
// or Arabic alone. A text without its French yet shows in English.

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
  if (l === 'fr') return msg.fr ?? msg.en;
  if (l === 'ar') return msg.ar;
  return `${msg.ar} · ${msg.en}`;
}

/** Arabic reads right to left. */
export const isRtl = (l: LangMode = mode) => l === 'ar';

export const TYPE_LABEL: Record<string, Msg> = {
  Income: m('إيراد', 'Income'),
  Exp: m('نفقة', 'Expense'),
  Transfer: m('تحويل', 'Transfer'),
  Exchange: m('تصريف', 'Exchange'),
};
