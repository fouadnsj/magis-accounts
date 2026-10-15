// The MAGIS design (Concept Note 2027): warm off-white, a thin gold line, and one
// colour and one mark per centre — Jaramana gold, Aleppo navy, Homs maroon.
import { m, type Msg } from './i18n';

export type CentreKey = 'jaramana' | 'aleppo' | 'homs' | 'other';

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
  other: { name: m('أخرى', 'Other'), color: '#B8891B', deep: '#26292E', mark: null },
};

export const centreStyle = (k: string | null | undefined): CentreStyle => CENTRES[(k as CentreKey) in CENTRES ? (k as CentreKey) : 'other'];

/** Guess a centre from a name (databases made before centres existed). */
export function guessCentre(name: string): CentreKey {
  const n = name.toLowerCase();
  if (/homs|حمص/.test(n)) return 'homs';
  if (/alep|aleppo|حلب/.test(n)) return 'aleppo';
  if (/jaramana|جرمانا|damas|دمشق|alberto/.test(n)) return 'jaramana';
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
