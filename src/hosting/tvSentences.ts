// The welcome phrases of the TV screen (Fouad, 26 November 2026). They are NOT a list of their own any more: the TV draws from the ONE pool of
// sentences of the centre (src/sentencePool.ts; the defaults are in src/ui/doorSentences.ts, the ones marked "tv"). Here stay what is only
// the TV's: the greeting by the hour, and the list of the default phrases for TV-SENTENCES.md.
// RULE (as everywhere): every sentence is traceable to a source or plainly marked ORIGINAL; no testimony on the TV.
import { m, type Msg } from '../i18n';
import { SENTENCES } from '../ui/doorSentences';

export { TV_PHRASE_MINUTES, TV_PHRASE_MIN, TV_PHRASE_MAX, clampPhraseMinutes, tvPhrases, type SentenceRow } from '../sentencePool';

/** the default phrases of the TV (the code's pool, the ones marked for the TV) */
export const TV_SENTENCES = SENTENCES.filter((x) => x.for.includes('tv'));

/** the greeting of the hour, small above the phrase: morning, the day, the evening (the centre's own TV hours, 08:00–22:00) */
export function tvGreeting(minutes: number): Msg {
  if (minutes < 12 * 60) return m('صباح الخير', 'Good morning', 'Bonjour');
  if (minutes >= 17 * 60) return m('مساء الخير', 'Good evening', 'Bonsoir');
  return m('أهلاً بكم', 'Welcome', 'Bienvenue');
}
