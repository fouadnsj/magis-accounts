// The amount of a receipt in words, in Arabic and in English (calendar baseline 2.1, section 7: "the amount in words").
// The Arabic follows the usual form of receipts in Syria: «فقط مئة وخمسون دولاراً أمريكياً لا غير». Pure functions,
// tested in tests/words.test.ts.
import type { Currency } from './host';

// ------------------------------------------------------------------ English

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function enBelow1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? (r ? EN_ONES[r] : '') : `${EN_TENS[Math.floor(r / 10)]}${r % 10 ? `-${EN_ONES[r % 10]}` : ''}`;
  return [h ? `${EN_ONES[h]} hundred` : '', rest].filter(Boolean).join(' and ');
}
/** a whole number in English words: 1250 → "one thousand two hundred and fifty" */
export function enWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return EN_ONES[0];
  const scales: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
  const out: string[] = [];
  for (const [v, w] of scales) if (n >= v) { out.push(`${enBelow1000(Math.floor(n / v))} ${w}`); n %= v; }
  if (n) out.push(out.length && n < 100 ? `and ${enBelow1000(n)}` : enBelow1000(n));
  return out.join(' ');
}

// ------------------------------------------------------------------ Arabic

const AR_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const AR_TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];
// the same numbers with a feminine noun (ليرة): one, two and three to ten take the other form (إحدى، اثنتان، ثلاث… عشر)
const AR_ONES_F = ['', 'إحدى', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثماني', 'تسع'];
const AR_TEENS_F = ['عشر', 'إحدى عشرة', 'اثنتا عشرة', 'ثلاث عشرة', 'أربع عشرة', 'خمس عشرة', 'ست عشرة', 'سبع عشرة', 'ثماني عشرة', 'تسع عشرة'];

/** 1 to 999; `fem`: the units and the "ten" agree with a feminine noun (only for the last group, the one the noun follows) */
function arBelow1000(n: number, fem = false): string {
  const h = Math.floor(n / 100), r = n % 100;
  const ones = fem ? AR_ONES_F : AR_ONES, teens = fem ? AR_TEENS_F : AR_TEENS;
  const rest = r === 0 ? '' : r < 10 ? ones[r] : r < 20 ? teens[r - 10] : `${r % 10 ? `${ones[r % 10]} و` : ''}${AR_TENS[Math.floor(r / 10)]}`;
  return [AR_HUNDREDS[h], rest].filter(Boolean).join(' و');
}
/** thousands, millions, billions: one, two, three to ten, eleven and more (ألف، ألفان، ثلاثة آلاف، أحد عشر ألفاً) */
type Forms = [string, string, string, string];
const AR_SCALES: [number, Forms][] = [
  [1e9, ['مليار', 'ملياران', 'مليارات', 'ملياراً']],
  [1e6, ['مليون', 'مليونان', 'ملايين', 'مليوناً']],
  [1e3, ['ألف', 'ألفان', 'آلاف', 'ألفاً']],
];
/**
 * k thousands (or millions…). `last`: nothing follows but the counted noun, so the word is in the construct form
 * (ألفا دولار، أحد عشر ألف دولار) and not «ألفان دولاراً»، «أحد عشر ألفاً دولاراً».
 */
function arScale(k: number, w: Forms, last = false): string {
  if (k === 1) return w[0];
  if (k === 2) return last ? w[1].replace(/ان$/, 'ا') : w[1];
  const low = k % 100;
  const head = arBelow1000(k).replace(/مئتان$/, 'مئتا');
  if (k <= 10) return `${head} ${w[2]}`;
  if (low >= 3 && low <= 10) return `${head} ${w[2]}`;
  if (low >= 11) return `${head} ${last ? w[0] : w[3]}`;
  return `${head} ${w[0]}`;
}
/** the scale groups of n (millions, thousands…), one word group each, without the last three digits */
function arGroups(n: number, last: boolean): string[] {
  const parts: [number, Forms][] = [];
  for (const [v, w] of AR_SCALES) {
    const k = Math.floor(n / v);
    if (k > 0) { parts.push([k, w]); n %= v; }
  }
  // the group right before the counted noun is in the construct form
  return parts.map(([k, w], i) => arScale(k, w, last && i === parts.length - 1));
}
/** a whole number in Arabic words: 1250 → «ألف ومئتان وخمسون» */
export function arWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const out = arGroups(n, false);
  if (n % 1000) out.push(arBelow1000(n % 1000));
  return out.join(' و');
}

// ------------------------------------------------------------------ an amount with its currency

/** the counted noun after a number in Arabic: one / two / three to ten / eleven and more */
const AR_CUR: Record<Currency, Forms> = {
  USD: ['دولار أمريكي', 'دولاران أمريكيان', 'دولارات أمريكية', 'دولاراً أمريكياً'],
  SYP: ['ليرة سورية', 'ليرتان سوريتان', 'ليرات سورية', 'ليرةً سوريةً'],
};
const AR_CENT: Forms = ['سنت', 'سنتان', 'سنتات', 'سنتاً'];
const AR_PIASTRE: Forms = ['قرش', 'قرشان', 'قروش', 'قرشاً'];
/**
 * n (a whole number) of a counted noun. The noun follows the LAST group of the number:
 * 1 → «دولار أمريكي واحد» · 2 → «دولاران أمريكيان» · 3 to 10 → «ثلاثة دولارات» (the number takes the other gender)
 * · 11 to 99 → «أحد عشر دولاراً» · a hundred, a thousand, a million (alone at the end) → «مئة دولار، مئتا دولار، ألف دولار».
 * With things before: 102 → «مئة ودولاران»، 1001 → «ألف ودولار واحد».
 */
function arCounted(n: number, w: Forms, fem: boolean, one: string): string {
  if (n === 0) return `صفر ${w[2]}`;
  const rem = n % 1000, r = rem % 100, h = Math.floor(rem / 100);
  if (rem === 0) return `${arGroups(n, true).join(' و')} ${w[0]}`;
  const before = arGroups(n, false);
  if (h && r) before.push(AR_HUNDREDS[h]);
  const join = (tail: string) => [...before, tail].join(' و');
  if (r === 0) return `${[...before, AR_HUNDREDS[h].replace(/مئتان$/, 'مئتا')].join(' و')} ${w[0]}`;
  if (r === 1) return `${before.length ? `${before.join(' و')} و` : ''}${w[0]} ${one}`;
  if (r === 2) return `${before.length ? `${before.join(' و')} و` : ''}${w[1]}`;
  const tail = arBelow1000(r, fem);
  return `${join(tail)} ${r <= 10 ? w[2] : w[3]}`;
}
/**
 * An amount in words, Arabic and English: the cents (USD) or the piastres (SYP) when there are any, so the words and the
 * figure of a receipt always say the same.
 * 150 USD → «فقط مئة وخمسون دولاراً أمريكياً لا غير» · "One hundred and fifty US dollars only".
 */
export function amountWords(amount: number, currency: Currency): { ar: string; en: string } {
  const total = Math.round(Math.abs(amount) * 100 + 1e-7);
  const whole = Math.floor(total / 100), cents = total % 100;
  const arMain = whole === 0 && cents ? '' : arCounted(whole, AR_CUR[currency], currency === 'SYP', currency === 'SYP' ? 'واحدة' : 'واحد');
  const arCents = cents ? arCounted(cents, currency === 'USD' ? AR_CENT : AR_PIASTRE, false, 'واحد') : '';
  const ar = `فقط ${[arMain, arCents].filter(Boolean).join(' و')} لا غير`;
  const enCur = currency === 'USD' ? (whole === 1 ? 'US dollar' : 'US dollars') : (whole === 1 ? 'Syrian pound' : 'Syrian pounds');
  const enMain = whole === 0 && cents ? '' : `${enWords(whole)} ${enCur}`;
  const enSub = currency === 'USD' ? 'cent' : 'piastre';
  const enCents = cents ? `${enWords(cents)} ${enSub}${cents === 1 ? '' : 's'}` : '';
  const en = `${[enMain, enCents].filter(Boolean).join(' and ')} only`;
  return { ar, en: en.charAt(0).toUpperCase() + en.slice(1) };
}
