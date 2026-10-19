// The look of a community (or a country) database (Fouad, 19 October 2026): one colour,
// or a set of colours, chosen when the community is created and changed later by the
// Administrator. The Jesuit mark stays; centres keep their own logos and colours (src/brand.ts).
// Also kept here: the community's address and city.
import { deepOf } from '../brand';
import { auditStmt, getMeta, setMetaStmt, UserError } from '../db/repo';
import type { Db, Stmt } from '../db/db';
import { m, type Msg } from '../i18n';
import type { OpCtx } from '../ops';
import { has } from '../auth';

/** main = buttons and chosen tabs; deep = titles and the computer's side menu; soft = light backgrounds */
export interface Palette { main: string; deep: string; soft: string }

export const PALETTES: { key: string; name: Msg; p: Palette }[] = [
  { key: 'gold', name: m('ذهبي', 'Gold', 'Or'), p: { main: '#B8891B', deep: '#3D2F0C', soft: '#FFFAF0' } },
  { key: 'olive', name: m('زيتوني', 'Olive', 'Olive'), p: { main: '#6B7B3A', deep: '#2F3818', soft: '#F6F8EE' } },
  { key: 'cedar', name: m('أخضر الأرز', 'Cedar green', 'Vert cèdre'), p: { main: '#2E7D5B', deep: '#163D2D', soft: '#EEF7F2' } },
  { key: 'sea', name: m('أزرق البحر', 'Sea blue', 'Bleu mer'), p: { main: '#2A6FB0', deep: '#173B5E', soft: '#EEF4FB' } },
  { key: 'night', name: m('أزرق الليل', 'Night blue', 'Bleu nuit'), p: { main: '#3B4A8C', deep: '#1C2346', soft: '#F0F2FA' } },
  { key: 'wine', name: m('خمري', 'Wine', 'Bordeaux'), p: { main: '#8C2F39', deep: '#4A1419', soft: '#FBF0F1' } },
  { key: 'clay', name: m('طيني', 'Terracotta', 'Terre cuite'), p: { main: '#C0612B', deep: '#5A2A10', soft: '#FCF2EB' } },
  { key: 'plum', name: m('بنفسجي', 'Plum', 'Prune'), p: { main: '#7A4C8F', deep: '#3A2245', soft: '#F6F0F9' } },
  { key: 'stone', name: m('رمادي الحجر', 'Stone', 'Pierre'), p: { main: '#6B6B6B', deep: '#2B2B2B', soft: '#F4F4F2' } },
];
export const DEFAULT_PALETTE = PALETTES[0].p;

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
/** a colour mixed with another: t = 0 → a, t = 1 → b */
const mix = (a: string, b: string, t: number) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** contrast of white text on this colour */
export const whiteContrast = (h: string) => 1.05 / (lum(h) + 0.05);

/** From ONE colour: the darker shade for titles and menus, a light one for backgrounds. */
export function paletteFrom(color: string): Palette {
  const c = HEX.test(color) ? color.toUpperCase() : DEFAULT_PALETTE.main;
  // a very light colour still needs white text to be readable on its buttons
  const main = whiteContrast(c) >= 3 ? c : deepOf(c).toUpperCase();
  return { main, deep: mix(c, '#000000', 0.66), soft: mix(c, '#FFFFFF', 0.94) };
}

/** A palette read from the database (or the gold one). */
export function paletteOf(color: string | null | undefined, palette: string | null | undefined): Palette {
  if (palette) {
    try {
      const p = JSON.parse(palette) as Palette;
      if (HEX.test(p.main) && HEX.test(p.deep) && HEX.test(p.soft)) return p;
    } catch { /* an old or broken value: fall back on the colour */ }
  }
  return color && HEX.test(color) ? paletteFrom(color) : DEFAULT_PALETTE;
}

/** The CSS variables of the community screens (cty.css) for this palette. */
export function paletteVars(p: Palette): Record<string, string> {
  return { '--c-gold': p.main, '--c-deep': p.deep, '--c-soft': p.soft, '--c-soft2': mix(p.soft, p.deep, 0.06) };
}

/** Puts the palette on the whole page (the entry window is drawn outside the screens' frame). */
export function applyPalette(p: Palette): () => void {
  const root = document.documentElement;
  const vars = paletteVars(p);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  return () => { for (const k of Object.keys(vars)) root.style.removeProperty(k); };
}

/** What the database says about its look and place. */
export interface CtyStyle {
  color: string | null;
  palette: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
}

export async function loadStyle(db: Db): Promise<CtyStyle> {
  return {
    color: await getMeta(db, 'brand_color'),
    palette: await getMeta(db, 'brand_palette'),
    address: await getMeta(db, 'address'),
    city: await getMeta(db, 'city'),
    country: await getMeta(db, 'country'),
  };
}

export interface StyleInput {
  /** one colour (palette null), or a set of colours */
  color: string;
  palette?: Palette | null;
  address?: string | null;
  city?: string | null;
}

/** The meta rows for a style (checked). */
export function styleStmts(s: StyleInput): Stmt[] {
  if (!HEX.test(s.color)) throw new UserError(m('لون غير صالح', 'Invalid colour', 'Couleur non valable'));
  if (s.palette && ![s.palette.main, s.palette.deep, s.palette.soft].every((x) => HEX.test(x))) throw new UserError(m('لون غير صالح', 'Invalid colour', 'Couleur non valable'));
  return [
    setMetaStmt('brand_color', s.palette ? s.palette.main : s.color),
    setMetaStmt('brand_palette', s.palette ? JSON.stringify(s.palette) : null),
    ...(s.address !== undefined ? [setMetaStmt('address', s.address?.trim() || null)] : []),
    ...(s.city !== undefined ? [setMetaStmt('city', s.city?.trim() || null)] : []),
  ];
}

export const STYLE_OPS = {
  'cty.style.save': {
    check: (c: OpCtx) => {
      if (!has(c.profile, 'users.manage')) throw new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
    },
    run: async (c: OpCtx, a: StyleInput) => {
      const kind = await getMeta(c.db, 'kind');
      if (kind !== 'community' && kind !== 'country') throw new UserError(m('للجماعات فقط', 'For the communities only', 'Pour les communautés seulement'));
      await c.db.batch([...styleStmts(a), auditStmt(c.who, 'edit', 'meta', 'style', null, { color: a.color, palette: a.palette ?? null, address: a.address ?? null, city: a.city ?? null })]);
    },
  },
};
