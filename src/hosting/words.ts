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
function arBelow1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r === 0 ? '' : r < 10 ? AR_ONES[r] : r < 20 ? AR_TEENS[r - 10] : `${r % 10 ? `${AR_ONES[r % 10]} و` : ''}${AR_TENS[Math.floor(r / 10)]}`;
  return [AR_HUNDREDS[h], rest].filter(Boolean).join(' و');
}
/** thousands, millions, billions: one, two, three to ten, eleven and more (ألف، ألفان، ثلاثة آلاف، أحد عشر ألفاً) */
const AR_SCALES: [number, [string, string, string, string]][] = [
  [1e9, ['مليار', 'ملياران', 'مليارات', 'ملياراً']],
  [1e6, ['مليون', 'مليونان', 'ملايين', 'مليوناً']],
  [1e3, ['ألف', 'ألفان', 'آلاف', 'ألفاً']],
];
function arScale(k: number, w: [string, string, string, string]): string {
  if (k === 1) return w[0];
  if (k === 2) return w[1];
  if (k <= 10) return `${arBelow1000(k)} ${w[2]}`;
  const last = k % 100;
  const noun = last >= 3 && last <= 10 ? w[2] : last >= 11 ? w[3] : w[0];
  return `${arBelow1000(k)} ${noun}`;
}
/** a whole number in Arabic words: 1250 → «ألف ومئتان وخمسون» */
export function arWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const out: string[] = [];
  for (const [v, w] of AR_SCALES) if (n >= v) { out.push(arScale(Math.floor(n / v), w)); n %= v; }
  if (n) out.push(arBelow1000(n));
  return out.join(' و');
}

// ------------------------------------------------------------------ an amount with its currency

/** the counted noun after a number in Arabic: one / two / three to ten / eleven and more */
const AR_CUR: Record<Currency, [string, string, string, string]> = {
  USD: ['دولار أمريكي', 'دولاران أمريكيان', 'دولارات أمريكية', 'دولاراً أمريكياً'],
  SYP: ['ليرة سورية', 'ليرتان سوريتان', 'ليرات سورية', 'ليرةً سوريةً'],
};
/** with a feminine noun (ليرة) the numbers 3 to 10 lose their ة: ثلاث ليرات، عشر ليرات */
const FEM: Record<string, string> = { ثلاثة: 'ثلاث', أربعة: 'أربع', خمسة: 'خمس', ستة: 'ست', سبعة: 'سبع', ثمانية: 'ثماني', تسعة: 'تسع', عشرة: 'عشر' };
const arCount = (n: number, w: [string, string, string, string], fem = false, one = '') => {
  if (n === 1) return `${w[0]}${one ? ` ${one}` : ''}`;
  if (n === 2) return w[1];
  const last = n % 100;
  if (n <= 10 || (last >= 3 && last <= 10)) {
    let words = arWords(n);
    if (fem) { const parts = words.split(' '); parts[parts.length - 1] = FEM[parts[parts.length - 1]] ?? parts[parts.length - 1]; words = parts.join(' '); }
    return `${words} ${w[2]}`;
  }
  if (last >= 11) return `${arWords(n)} ${w[3]}`;
  return `${arWords(n)} ${w[0]}`;
};
/**
 * An amount in words, Arabic and English: USD with its cents, SYP whole.
 * 150 USD → «فقط مئة وخمسون دولاراً أمريكياً لا غير» · "One hundred and fifty US dollars only".
 */
export function amountWords(amount: number, currency: Currency): { ar: string; en: string } {
  const whole = Math.floor(Math.abs(amount) + 1e-9);
  const cents = currency === 'USD' ? Math.round((Math.abs(amount) - whole) * 100) : 0;
  const arMain = whole === 0 && cents ? '' : arCount(whole, AR_CUR[currency], currency === 'SYP', currency === 'SYP' ? 'واحدة' : 'واحد');
  const arCents = cents ? arCount(cents, ['سنت', 'سنتان', 'سنتات', 'سنتاً']) : '';
  const ar = `فقط ${[arMain, arCents].filter(Boolean).join(' و')} لا غير`;
  const enCur = currency === 'USD' ? (whole === 1 ? 'US dollar' : 'US dollars') : (whole === 1 ? 'Syrian pound' : 'Syrian pounds');
  const enMain = whole === 0 && cents ? '' : `${enWords(whole)} ${enCur}`;
  const enCents = cents ? `${enWords(cents)} cent${cents === 1 ? '' : 's'}` : '';
  const en = `${[enMain, enCents].filter(Boolean).join(' and ')} only`;
  return { ar, en: en.charAt(0).toUpperCase() + en.slice(1) };
}
