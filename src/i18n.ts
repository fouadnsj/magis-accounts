// Every label is bilingual, Arabic first: "عربي · English".
// The user can switch to English only (Settings); Arabic stays the default.

export interface Msg {
  ar: string;
  en: string;
}

export const m = (ar: string, en: string): Msg => ({ ar, en });

export type LangMode = 'both' | 'en';
let mode: LangMode = 'both';
try {
  const saved = localStorage.getItem('lang');
  if (saved === 'en' || saved === 'both') mode = saved;
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
  return mode === 'en' ? msg.en : `${msg.ar} · ${msg.en}`;
}

export const TYPE_LABEL: Record<string, Msg> = {
  Income: m('إيراد', 'Income'),
  Exp: m('نفقة', 'Expense'),
  Transfer: m('تحويل', 'Transfer'),
  Exchange: m('تصريف', 'Exchange'),
};
