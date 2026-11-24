// The welcome phrases of the TV screen (Fouad, 24 November 2026: "an original welcoming phrase"). One phrase at a time changes now and
// then under the name of the centre: Arabic first and, under it, English (or French).
// RULE (the same as the doors page, src/ui/doorSentences.ts): every phrase is traceable to a source (the MAGIS charter, the explanation
// of the logos, the concept note, the first page of the program) or is plainly marked ORIGINAL: written in the same spirit, simple and
// humble, belonging to nobody. Nothing is an invented name, number, testimony or quote. A testimony is NOT used on the TV: it speaks of a
// person, and a screen at the entrance is seen by everyone. The sentences that already exist on the doors page are taken from there BY NAME
// (so a correction made there is made here too); the new ones are below. The list is written out for review in TV-SENTENCES.md
// (regenerate it with: scripts/tv-sentences-md.ts).
import { m, type Msg } from '../i18n';
import { SENTENCES, type SentenceKind } from '../ui/doorSentences';

export interface TvSentence {
  id: string;
  msg: Msg;
  kind: SentenceKind;
  source: string;
  /** a sentence taken from one centre's logo or house: only shown with that centre */
  centre?: string;
  /** the languages translated for the page (the source being in another language): to be read by Fouad */
  tr?: ('ar' | 'en' | 'fr')[];
  /** taken from the doors page (its id there) */
  fromDoors?: boolean;
}

/** from the doors page, by id: the charter, the logos, the concept note, the first page. No testimony, nothing about accounts, HR or the inventory. */
const FROM_DOORS = [
  'ch-hope', 'ch-place', 'ch-dignity', 'ch-bridges', 'ch-dream', 'ch-host', 'ch-simple',
  'lg-all-colours', 'lg-all-sun',
  'lg-jar-gates', 'lg-jar-grow', 'lg-jar-hands', 'lg-ale-grow', 'lg-ale-gates', 'lg-ale-start', 'lg-hom-hands', 'lg-hom-grow',
  'ap-hope', 'ap-jar', 'ap-ale', 'ap-hom', 'ap-alard',
  'ar-trees',
  'nt-trust', 'nt-direction', 'nt-source',
  'og-cal-expected', 'og-cal-ready',
];

const ORIGINAL = 'original';
/** written for the TV: the same spirit as the charter, never given to a person */
const NEW_ONES: TvSentence[] = [
  { id: 'tv-yours', kind: 'original', source: ORIGINAL, msg: m('أهلاً بكم، البيت بيتكم', 'Welcome. This house is yours.', 'Bienvenue. Cette maison est la vôtre.') },
  { id: 'tv-expected', kind: 'original', source: ORIGINAL, msg: m('كنّا ننتظركم، تفضّلوا', 'We were expecting you. Come in.', 'Nous vous attendions. Entrez.') },
  { id: 'tv-slow', kind: 'original', source: ORIGINAL, msg: m('هنا نلتقي على مهلٍ', 'Here we meet without hurry.', 'Ici, on se rencontre sans se presser.') },
  { id: 'tv-table', kind: 'original', source: ORIGINAL, msg: m('لكلّ واحدٍ مكانٌ على الطاولة', 'There is a place at the table for everyone.', 'Il y a une place à table pour chacun.') },
  { id: 'tv-asis', kind: 'original', source: ORIGINAL, msg: m('الباب مفتوح، تعالَوا كما أنتم', 'The door is open. Come as you are.', 'La porte est ouverte. Venez comme vous êtes.') },
  { id: 'tv-patience', kind: 'original', source: ORIGINAL, msg: m('ما نبنيه معاً يحتاج إلى وقتٍ وصبر', 'What we build together takes time and patience.', 'Ce que nous bâtissons ensemble demande du temps et de la patience.') },
  { id: 'tv-young', kind: 'original', source: ORIGINAL, msg: m('للشباب هنا مكانٌ، وصوتٌ يُسمَع', 'Young people have a place here, and a voice that is heard.', 'Les jeunes ont ici une place, et une voix qu’on entend.') },
  { id: 'tv-hands', kind: 'original', source: ORIGINAL, msg: m('نستقبل بيدٍ مفتوحة، ونُصغي بقلبٍ هادئ', 'We welcome with an open hand and listen with a quiet heart.', 'Nous accueillons la main ouverte et écoutons le cœur tranquille.') },
  { id: 'tv-listen', kind: 'original', source: ORIGINAL, msg: m('قبل أن نتكلّم، نُصغي', 'Before we speak, we listen.', 'Avant de parler, nous écoutons.') },
  { id: 'tv-newday', kind: 'original', source: ORIGINAL, msg: m('يومٌ جديد، ولقاءاتٌ جديدة', 'A new day, and new encounters.', 'Un jour nouveau, et de nouvelles rencontres.') },
];

/** all the phrases the TV may show, with their sources */
export const TV_SENTENCES: TvSentence[] = [
  ...FROM_DOORS.map((id) => {
    const s = SENTENCES.find((x) => x.id === id);
    if (!s) throw new Error(`TV phrase ${id} is not on the doors page`);
    return { id: s.id, msg: s.msg, kind: s.kind, source: s.source, centre: s.centre, tr: s.tr, fromDoors: true } as TvSentence;
  }),
  ...NEW_ONES,
];

/** the greeting of the hour, small above the phrase: morning, the day, the evening (the centre's own TV hours, 08:00–22:00) */
export function tvGreeting(minutes: number): Msg {
  if (minutes < 12 * 60) return m('صباح الخير', 'Good morning', 'Bonjour');
  if (minutes >= 17 * 60) return m('مساء الخير', 'Good evening', 'Bonsoir');
  return m('أهلاً بكم', 'Welcome', 'Bienvenue');
}

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

/** the phrases of this centre for this day, in an order that changes every day: the general ones and the centre's own */
export function tvPhrases(centre: string | null | undefined, day: string): Msg[] {
  const pool = TV_SENTENCES.filter((x) => !x.centre || x.centre === centre);
  const rand = seeded(`${centre ?? ''}|${day}`);
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.map((x) => ({ ar: x.msg.ar, en: x.msg.en, fr: x.msg.fr ?? x.msg.en }));
}
