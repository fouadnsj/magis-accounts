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
