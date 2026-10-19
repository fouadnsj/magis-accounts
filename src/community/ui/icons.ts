// The icon of each line and heading of the chart, so a Jesuit finds his category by
// its picture (Fouad, 19 October 2026: "I liked the icons of the categories, apply them
// to all"). A line takes the icon of its own code, else of the nearest code before it
// (61402 → 6140 → 614). The longest matching start wins.

const ICONS: Record<string, string> = {
  // support
  '611': '🍞', '61102': '🏨', '612': '📚', '61201': '📚', '61202': '🎓', '61203': '🎭', '61204': '⚽',
  '613': '👕', '61302': '🧴', '61303': '🪪', '614': '⚕️', '61401': '🩺', '61405': '🔬', '61402': '💊', '61403': '🏥', '61404': '🩹',
  '615': '🤲', '616': '🕯️',
  // common
  '62011': '⛽', '62012': '🔧', '62013': '🛡️', '6201': '🚗', '6202': '🪑', '6203': '🧰',
  '62051': '🚌', '62052': '🚲', '62053': '🅿️', '6205': '🚌', '62061': '🧹', '62062': '🔨', '62063': '⛪', '62064': '🌿', '6206': '🏠',
  '6207': '👥', '62081': '🙏', '62082': '⛪', '62083': '✝️', '6208': '⛪', '6209': '⚖️',
  '62101': '✏️', '62102': '✉️', '62103': '💻', '62104': '📱', '6210': '☎️',
  // general
  '631': '💡', '632': '💧', '633': '🔥', '634': '📡', '635': '🛡️', '63601': '🛢️', '63602': '🔧', '636': '⚙️',
  // sharing, extraordinary, financial
  '641': '🤝', '642': '🧾', '643': '🤝', '651': '👷', '652': '✈️', '65301': '🏗️', '65302': '🌳', '653': '🏗️', '659': '📦', '671': '🏦',
  // income
  '711': '🧓', '712': '💼', '713': '🕊️', '714': '✍️', '716': '⛪', '71701': '🧺', '71702': '🙏', '717': '🙏', '71801': '🛏️', '71802': '🧳', '718': '🛏️', '719': '💰',
  '721': '📄', '722': '🎁', '723': '🛒', '724': '💰', '731': '🧓', '732': '⚕️', '733': '🎓', '73': '🏛️',
};
const KEYS = Object.keys(ICONS).sort((a, b) => b.length - a.length);

/** The icon of a code ('61402') or, failing that, of the nearest code before it. */
export function iconOf(code: string | null | undefined): string {
  if (!code) return '•';
  // 5-digit codes end in 0 for a heading (61400): compare on the significant digits
  const k = KEYS.find((p) => code.startsWith(p) || (p.length === 3 && code.slice(0, 3) === p));
  return k ? ICONS[k] : '•';
}

/** Icons of the kinds of books and of the choices of money. */
export const BOOK_ICON: Record<string, string> = { personal: '💰', personal_bank: '🏦', house: '🏠', envelope: '✉️', cash: '💰', bank: '🏦', economat: '🏛️' };
