// Icons and soft colours for the MAGIS centres' budget headings and lines (Fouad, 19 October
// 2026: "the icons of the categories, apply them to all"), like the communities' chart
// (src/community/ui/icons.ts). A centre's headings and lines have names, not chart codes:
// the icon is found from words in the name (English, Arabic or French), else from its heading.

// The first rule whose words appear in the name wins (most precise first).
const RULES: [RegExp, string][] = [
  // salaries and staff
  [/health insurance|insurance|تأمين|assurance/i, '⚕️'],
  [/accountant|محاسب|comptable/i, '🧮'],
  [/director|مدير|directeur/i, '🧭'],
  [/cleaner|عامل(ة)? (ال)?تنظيف|agent d.entretien/i, '🧹'],
  [/coordinator|منسق|coordinat/i, '🗂️'],
  [/guard|logistic|حارس|حراسة|gardien/i, '🛡️'],
  [/honorari|bonus|مكافأ|prime/i, '🎁'],
  [/reception|استقبال|accueil/i, '🛎️'],
  [/salar|wage|staff|رواتب|راتب|أجور|salaire|personnel/i, '👷'],
  // activities
  [/film|cinema|سينما|ciné/i, '🎬'],
  [/microphone|sound|equipment|معدات|صوت|matériel|équipement/i, '🎤'],
  [/festival|مهرجان/i, '🎉'],
  [/exhibition|gallery|show|presentation|معرض|exposition|spectacle/i, '🖼️'],
  [/facilitator|trainer|منشط|مدرب|animateur|formateur/i, '🧑‍🏫'],
  [/consumable|مستهلك|consommable/i, '✂️'],
  [/\bart|فن|artist/i, '🎨'],
  [/\bevent|حدث|فعالي|événement/i, '🎪'],
  [/english|انكليزي|إنجليزي|انجليزي|anglais/i, '🔤'],
  [/academic|course|cours|دورات|أكاديمي/i, '🎓'],
  [/accompan|مرافقة|accompagnement/i, '🤝'],
  [/retreat|spiritual|رياضة روحية|خلوة|retraite|spirituel/i, '🙏'],
  [/weekend|نهاية الأسبوع|week-end/i, '🏕️'],
  [/skill|capacity|training|formation|تدريب|مهارات|compétence/i, '🛠️'],
  // running the centre
  [/cleaning|تنظيف|nettoyage|entretien ménager/i, '🧴'],
  [/electric|gas|كهرباء|غاز|électricité/i, '💡'],
  [/heating|fuel|generator|تدفئة|وقود|مولد|chauffage|carburant/i, '🔥'],
  [/internet|انترنت|إنترنت/i, '📡'],
  [/operation|running|تشغيل|fonctionnement/i, '⚙️'],
  [/\bit\b|computer|حاسوب|informatique/i, '💻'],
  [/maintenance|repair|صيانة|réparation/i, '🔧'],
  [/office|printing|stationery|قرطاسية|طباعة|bureau|impression/i, '🖨️'],
  [/transport|مواصلات|نقل/i, '🚌'],
  [/food|provision|طعام|مؤونة|nourriture|vivres/i, '🍞'],
  [/hospitality|ضيافة|accueil|hospitalité/i, '☕'],
  [/church|pastoral|كنيسة|رعوي|église|pastorale/i, '⛪'],
  [/community|household|جماعة|منزل|communauté|maison/i, '👥'],
  // furniture
  [/chair|كرسي|كراسي|chaise/i, '🪑'],
  [/kitchen|مطبخ|cuisine/i, '🍳'],
  [/library|shelv|book|مكتبة|كتب|bibliothèque|livre/i, '📚'],
  [/screen|projector|شاشة|عارض|écran|projecteur/i, '📽️'],
  [/whiteboard|\bboard|لوح|tableau/i, '📋'],
  [/\btable|طاولة|طاولات/i, '🪵'],
  [/furniture|أثاث|mobilier|meuble/i, '🛋️'],
  // income
  [/accom+odation|lodging|إقامة|سكن|hébergement/i, '🛏️'],
  [/donation|gift|تبرع|هبة|don\b/i, '🎁'],
  [/photo|تصوير|صور/i, '📷'],
  [/\brent|إيجار|ايجار|loyer/i, '🏠'],
  [/province|الإقليم|المقاطعة/i, '🏛️'],
  [/respo/i, '🔑'],
  [/acquisition|purchase|شراء|achat/i, '🛒'],
  [/income|إيراد|recette|revenu/i, '💰'],
  // the movements
  [/transfer|تحويل|virement/i, '🔁'],
  [/exchange|تصريف|صرف|change/i, '💱'],
  [/unallocated|\bother|divers|misc|أخرى|متفرقات|غير موزع|autre/i, '📦'],
];

/** The icon of a heading or line from its name; a line falls back on its heading's icon. */
export function catIcon(name: string | null | undefined, headingName?: string | null): string {
  for (const n of [name, headingName]) {
    if (!n) continue;
    const hit = RULES.find(([re]) => re.test(n));
    if (hit) return hit[1];
  }
  return '•';
}

/** Soft colours (background, border) per kind of movement, as on the four buttons. */
export const TYPE_TINT: Record<string, [string, string]> = {
  Exp: ['#fbe9df', '#D2691E'],
  Income: ['#e3eefa', '#2A6FB0'],
  Transfer: ['#efe8d6', '#B8891B'],
  Exchange: ['#ece6f5', '#7a5c8f'],
};

/** A soft colour per heading (its place in the list), so headings are told apart at a glance. */
const HEADING_TINTS: [string, string][] = [
  ['#fbf0d4', '#d9a93a'], ['#e3eefb', '#4f86c6'], ['#dff3ee', '#3f9a8a'], ['#efe6f7', '#8a5cb0'],
  ['#fbe3e0', '#c9594a'], ['#e2f1e2', '#4c9a54'], ['#f7e8d9', '#b8742f'], ['#e6edf8', '#5a7fb8'],
];
export const headingTint = (index: number): [string, string] => HEADING_TINTS[((index % HEADING_TINTS.length) + HEADING_TINTS.length) % HEADING_TINTS.length];
