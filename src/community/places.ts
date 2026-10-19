// The countries of the Province and their money (Fouad, 19 October 2026). A country may be
// typed in Arabic, English or French: "سوريا", "Syria" and "Syrie" are the same country.
export const COUNTRIES: { en: string; fr: string; ar: string; cur: string }[] = [
  { en: 'Syria', fr: 'Syrie', ar: 'سوريا', cur: 'SYP' },
  { en: 'Lebanon', fr: 'Liban', ar: 'لبنان', cur: 'LBP' },
  { en: 'Egypt', fr: 'Égypte', ar: 'مصر', cur: 'EGP' },
  { en: 'Jordan', fr: 'Jordanie', ar: 'الأردن', cur: 'JOD' },
  { en: 'Iraq', fr: 'Irak', ar: 'العراق', cur: 'IQD' },
  { en: 'Holy Land', fr: 'Terre sainte', ar: 'الأرض المقدسة', cur: 'ILS' },
  { en: 'Algeria', fr: 'Algérie', ar: 'الجزائر', cur: 'DZD' },
  { en: 'Morocco', fr: 'Maroc', ar: 'المغرب', cur: 'MAD' },
  { en: 'Turkey', fr: 'Turquie', ar: 'تركيا', cur: 'TRY' },
];

const find = (name: string) => {
  const c = name.trim().toLowerCase();
  return COUNTRIES.find((x) => [x.en, x.fr, x.ar].some((n) => n.toLowerCase() === c));
};
/** The money of a country typed in any of the three languages. */
export const currencyOf = (country: string) => find(country)?.cur;
/** The same country, whatever the language it was written in. */
export const sameCountry = (a: string, b: string) => {
  const x = find(a);
  const y = find(b);
  return x && y ? x === y : a.trim().toLowerCase() === b.trim().toLowerCase();
};
