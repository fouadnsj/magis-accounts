// ONE pool of warm sentences for the whole centre (Fouad, 26 November 2026): "all the pages and the doors that run a random sentence must
// take from it". The code (src/ui/doorSentences.ts) is the default pool; the table `sentence` (update 78) holds only what a centre changed:
//  - a built-in sentence switched off, edited (its own ar/en/fr), or given other places (the tick boxes: the line under the centre's name,
//    each door's line, the TV); a corrected default in the code still reaches a centre that never changed it;
//  - the sentences the centre wrote (builtin_key NULL).
// Pure functions: the server, the doors page and the TV all use them (tested in tests/sentences.test.ts).
import type { Msg } from './i18n';
import { PLACES, SENTENCES, type Place, type Sentence, type SentenceKind } from './ui/doorSentences';

export { PLACES, type Place };

/** the longest text of one sentence, in one language */
export const SENTENCE_LENGTH = 220;
/** how long one phrase stays on the TV, in minutes (Fouad: "let us say 5"); a centre may change it between the limits */
export const TV_PHRASE_MINUTES = 5;
export const TV_PHRASE_MIN = 1;
export const TV_PHRASE_MAX = 15;
/** the language under the Arabic on the TV: English, French, or Arabic alone (a setting of the centre; ?l= on the TV page overrides it) */
export type TvLang = 'en' | 'fr' | 'ar';
export const TV_LANGS: TvLang[] = ['en', 'fr', 'ar'];
export const TV_LANG_DEFAULT: TvLang = 'en';
export const cleanTvLang = (x: unknown): TvLang => (TV_LANGS.includes(x as TvLang) ? (x as TvLang) : TV_LANG_DEFAULT);
export const clampPhraseMinutes = (n: unknown): number => {
  const x = Math.round(Number(n));
  return Number.isFinite(x) ? Math.max(TV_PHRASE_MIN, Math.min(TV_PHRASE_MAX, x)) : TV_PHRASE_MINUTES;
};

/** what a centre changed (table `sentence`) */
export interface SentenceRow { id: number; builtin_key: string | null; ar: string | null; en: string | null; fr: string | null; active: number; edited: number; places: string | null; sort: number }

/** a sentence as the settings page shows it */
export interface PoolItem {
  /** the id in the code, for a built-in sentence; null for one written by the centre */
  key: string | null;
  /** the row of the centre (its change, or its own sentence); null while nothing was changed */
  id: number | null;
  ar: string; en: string; fr: string;
  kind: SentenceKind;
  source: string;
  /** a testimony: who says it (no name) */
  by?: Msg;
  /** only with this centre */
  centre?: string;
  places: Place[];
  /** the places in the code (a built-in sentence), to restore them */
  defaultPlaces: Place[] | null;
  active: boolean;
  /** the text was changed by the centre */
  edited: boolean;
  /** the places were changed by the centre */
  placesEdited: boolean;
  /** the text in the code, to restore it */
  original: Msg | null;
}

export const WRITTEN_BY_CENTRE = 'written by the centre';

/** the places typed in a row, tidied: only the known ones, once each; never the TV for a testimony */
export function cleanPlaces(raw: unknown, testimony = false): Place[] {
  let a: unknown = raw;
  if (typeof raw === 'string') { try { a = JSON.parse(raw); } catch { a = []; } }
  if (!Array.isArray(a)) return [];
  const out = PLACES.filter((p) => (a as unknown[]).includes(p));
  return testimony ? out.filter((p) => p !== 'tv') : out;
}
const sameSet = (a: Place[], b: Place[]) => a.length === b.length && a.every((x) => b.includes(x));

/** every sentence this centre may show: the built-in ones that suit it (with what the centre changed), then the ones it wrote */
export function poolList(centre: string | null | undefined, rows: SentenceRow[] = []): PoolItem[] {
  const byKey = new Map(rows.filter((r) => r.builtin_key).map((r) => [r.builtin_key!, r]));
  const out: PoolItem[] = SENTENCES.filter((x) => !x.centre || x.centre === centre).map((x) => {
    const r = byKey.get(x.id);
    const edited = !!r?.edited;
    const mine = r?.places ? cleanPlaces(r.places, x.kind === 'testimony') : null;
    return {
      key: x.id, id: r?.id ?? null,
      ar: edited ? r!.ar ?? '' : x.msg.ar, en: edited ? r!.en ?? '' : x.msg.en, fr: edited ? r!.fr ?? '' : x.msg.fr ?? x.msg.en,
      kind: x.kind, source: x.source, by: x.by, centre: x.centre,
      places: mine ?? x.for, defaultPlaces: x.for, active: r ? !!r.active : true, edited, placesEdited: !!mine,
      original: { ar: x.msg.ar, en: x.msg.en, fr: x.msg.fr ?? x.msg.en },
    };
  });
  for (const r of rows.filter((r) => !r.builtin_key).sort((a, b) => a.sort - b.sort || a.id - b.id)) {
    out.push({ key: null, id: r.id, ar: r.ar ?? '', en: r.en ?? '', fr: r.fr ?? '', kind: 'centre', source: WRITTEN_BY_CENTRE, places: cleanPlaces(r.places), defaultPlaces: null, active: !!r.active, edited: false, placesEdited: false, original: null });
  }
  return out;
}

const hasText = (p: Pick<PoolItem, 'ar' | 'en' | 'fr'>) => !!(p.ar.trim() || p.en.trim() || p.fr.trim());

/**
 * The sentences that are ON, in the shape the doors page draws from (src/ui/doorSentences.ts `pickSentences`). A centre that changed
 * nothing gets the code's pool exactly (the same objects' content).
 */
export function activeSentences(centre: string | null | undefined, rows: SentenceRow[] = []): Sentence[] {
  return poolList(centre, rows)
    .filter((p) => p.active && hasText(p) && p.places.length)
    .map((p) => ({
      id: p.key ?? `c${p.id}`, msg: { ar: p.ar, en: p.en, fr: p.fr }, kind: p.kind, source: p.source, for: p.places, by: p.by, centre: p.centre as Sentence['centre'],
    }));
}

/** what changes in a row when a built-in sentence goes back to the code: nothing is stored for the default */
export const isDefault = (p: Pick<PoolItem, 'active' | 'edited' | 'placesEdited'>) => p.active && !p.edited && !p.placesEdited;
export { sameSet };

// ---- the TV: the sentences marked for it, shuffled by day

/** a small fixed shuffle: the same order for the same day and centre (so all the screens of a centre agree), another one tomorrow */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** the phrases of this centre for this day, in an order that changes every day: the sentences that are ON and marked for the TV */
export function tvPhrases(centre: string | null | undefined, day: string, rows: SentenceRow[] = []): Msg[] {
  const pool = activeSentences(centre, rows).filter((x) => x.for.includes('tv') && x.kind !== 'testimony');
  const rand = seeded(`${centre ?? ''}|${day}`);
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.map((x) => ({ ar: x.msg.ar, en: x.msg.en, fr: x.msg.fr ?? x.msg.en }));
}
