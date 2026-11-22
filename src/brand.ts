// The MAGIS design (Concept Note 2027): warm off-white, a thin gold line, and one
// colour and one mark per centre — Jaramana gold, Aleppo navy, Homs maroon.
import { m, type Msg } from './i18n';

export type CentreKey = 'jaramana' | 'aleppo' | 'homs' | 'alard' | 'other';

export interface CentreStyle {
  name: Msg;
  /** the centre's colour (its sun) */
  color: string;
  /** a deep version, readable with white text (menus, buttons) */
  deep: string;
  mark: string | null;
}

export const CENTRES: Record<CentreKey, CentreStyle> = {
  jaramana: { name: m('جرمانا', 'Jaramana'), color: '#F2C230', deep: '#8A6A1A', mark: '/brand/mark-jaramana.png' },
  aleppo: { name: m('حلب', 'Aleppo'), color: '#232D53', deep: '#232D53', mark: '/brand/mark-aleppo.png' },
  homs: { name: m('حمص', 'Homs'), color: '#5B191D', deep: '#5B191D', mark: '/brand/mark-homs.png' },
  // the fourth house (Fouad, 21 November 2026): the shared land where the three gather to breathe; orange, retreat and the earth
  alard: { name: m('الأرض', 'Al-Ard'), color: '#F26522', deep: '#B5410D', mark: '/brand/mark-alard.png' },
  other: { name: m('أخرى', 'Other'), color: '#B8891B', deep: '#26292E', mark: null },
};

/** the Arabic title under the name, per house (Fouad, 22 November 2026); each house can set its own in Admin → Appearance */
export const RECEIPT_TITLE_AR: Record<string, string> = {
  homs: 'الرهبانية اليسوعية - دير الآباء اليسوعيين في حمص',
  aleppo: 'الرهبانية اليسوعية - دير الآباء اليسوعيين في حلب',
  jaramana: 'الرهبانية اليسوعية - دير الآباء اليسوعيين في جرمانا',
  alard: 'الرهبانية اليسوعية - مركز الأرض',
};

export const centreStyle = (k: string | null | undefined): CentreStyle => CENTRES[(k as CentreKey) in CENTRES ? (k as CentreKey) : 'other'];

/** Guess a centre from a name (databases made before centres existed). */
export function guessCentre(name: string): CentreKey {
  const n = name.toLowerCase();
  if (/homs|حمص/.test(n)) return 'homs';
  if (/alep|aleppo|حلب/.test(n)) return 'aleppo';
  if (/jaramana|جرمانا|damas|دمشق|alberto/.test(n)) return 'jaramana';
  if (/al-?ard|الأرض|الارض/.test(n)) return 'alard';
  return 'other';
}

/** What a database says about its look (meta table): a centre, or its own colour and logo. */
export interface BrandInfo {
  centre: string;
  color?: string | null;
  logo?: string | null; // a small PNG as a data: URL
}

const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h: string) => {
  const [r, g, b] = hexRgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** A version of the colour dark enough for white text (menus, buttons): contrast ≥ 4.5. */
export function deepOf(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return '#26292E';
  let [r, g, b] = hexRgb(color);
  let hex = color;
  for (let i = 0; i < 30 && 1.05 / (lum(hex) + 0.05) < 4.5; i++) {
    [r, g, b] = [r, g, b].map((v) => Math.round(v * 0.88));
    hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  return hex;
}

/** The style of a database: its own colour/logo if it has them, else its centre's. */
export function brandStyle(b: BrandInfo | null | undefined): CentreStyle {
  const base = centreStyle(b?.centre);
  if (!b || (!b.color && !b.logo)) return base;
  const color = b.color && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : base.color;
  return { ...base, color, deep: b.color ? deepOf(color) : base.deep, mark: b.logo || base.mark };
}

/** A person's own look (Fouad, 22 November 2026): a colour for the menu and the buttons, and a softer page background */
export interface MyLook { color: string | null; bg: string | null }
/** ready page backgrounds, all light, to make the pages easier on the eyes (null = the house's own) */
export const PAGE_BG: Record<string, { color: string; name: Msg }> = {
  paper: { color: '#F7F2E7', name: m('ورقي دافئ', 'Warm paper') },
  mint: { color: '#EEF5EF', name: m('أخضر هادئ', 'Soft green') },
  sky: { color: '#EDF3F9', name: m('أزرق هادئ', 'Soft blue') },
  grey: { color: '#F0F1F3', name: m('رمادي فاتح', 'Light grey') },
  dim: { color: '#E6E8EB', name: m('خافت (أقل سطوعاً)', 'Dim (less glare)') },
};
export const BG_KEYS = Object.keys(PAGE_BG);
/** calm colours to start from (each dark enough for white text) */
export const MY_COLOURS: { color: string; name: Msg }[] = [
  { color: '#1F6F6B', name: m('أخضر مزرق', 'Teal') },
  { color: '#2F5D8A', name: m('أزرق', 'Blue') },
  { color: '#3C6E47', name: m('أخضر', 'Green') },
  { color: '#6B3F69', name: m('بنفسجي', 'Plum') },
  { color: '#3F4B5B', name: m('رمادي مزرق', 'Slate') },
  { color: '#9A4A2E', name: m('طوبي', 'Terracotta') },
  { color: '#6B6B2A', name: m('زيتوني', 'Olive') },
  { color: '#5B191D', name: m('عنابي', 'Maroon') },
];
/** the colours of a page for this person: his own colour if he chose one, else the house's; the background only if he chose one */
export function applyLook(base: CentreStyle, look: MyLook | null | undefined): { deep: string; color: string; bg: string | null } {
  const c = look?.color && /^#[0-9a-f]{6}$/i.test(look.color) ? look.color : null;
  return { deep: c ? deepOf(c) : base.deep, color: c ?? base.color, bg: look?.bg && PAGE_BG[look.bg] ? PAGE_BG[look.bg].color : null };
}

/** A logo picked by the user, made small (max 256 px) and kept as PNG (transparency stays). */
export async function logoToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const r = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.naturalWidth * r));
    cv.height = Math.max(1, Math.round(img.naturalHeight * r));
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
