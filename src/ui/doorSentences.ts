// The warm sentences of the centre: the doors page (Fouad, 24 November 2026) and the TV screen (26 November 2026) draw from ONE pool.
// This file is the DEFAULT pool (the code); each centre may switch a sentence off, edit it, choose where it appears, or write its own
// (Administration → Sentences; table `sentence`, update 78: only what the centre changed is stored, see src/sentencePool.ts).
// RULE: every sentence is traceable to a source (the MAGIS charter, the explanation of the logos, the concept note, the
// testimonies, the first page of the program) or is plainly marked "original" - written in the same spirit, never given to a
// person. Nothing here is a made-up name, number, testimony or quote. A testimony shows no name ("a participant").
// `tr` lists the languages that are a translation made for this page (the source being in another language): to be read by Fouad.
// The same list is written out for review in DOORS-SENTENCES.md (regenerate it with: npx tsx scripts/doors-sentences-md.ts).
import { m, type Msg } from '../i18n';
import type { CentreKey } from '../brand';
import type { DoorKey } from '../doors';

export type SentenceKind = 'charter' | 'logo' | 'note' | 'testimony' | 'app' | 'original' | 'centre';
/** where a sentence may appear: the line under the centre's name on the doors page, a door's own line, or the TV screen */
export type Place = DoorKey | 'centre' | 'tv';
export const PLACES: Place[] = ['centre', 'accounts', 'calendar', 'inventory', 'hr', 'admin', 'tv'];
export interface Sentence {
  id: string;
  msg: Msg;
  kind: SentenceKind;
  /** where it comes from, or "original" */
  source: string;
  /** where it may appear: the doors it suits, 'centre' = the heading of the doors page (under the centre's name), 'tv' = the TV screen (never a testimony) */
  for: Place[];
  /** a sentence taken from one centre's logo or house: only shown with that centre */
  centre?: CentreKey;
  /** a testimony: who says it, as the source says it (never a name) */
  by?: Msg;
  /** the languages translated for this page */
  tr?: ('ar' | 'en' | 'fr')[];
}

const CHARTER = 'The MAGIS charter (Reference/MAGIS-charter.md)';
const LOGO = 'The explanation of the centres’ logos (Chart design / «رمزيات التصميم»), Arabic';
const NOTE = 'The concept note (2026 draft, §';
const PARTICIPANT = m('— مشارك في «نار و نور»', '— a participant in “Nar w Nour”', '— un participant « Nar w Nour »');

const BASE: Sentence[] = [
  // ---- the charter (the three languages are the charter's own)
  { id: 'ch-hope', kind: 'charter', source: `${CHARTER}, the “because” on hope`, for: ['centre', 'accounts'], msg: m('نؤمن، بالرّغم من كلّ التحدّيات، بأنّ الرجاء ممكن', 'Despite everything, we believe that hope is possible.', 'Malgré tout, nous croyons que l’espérance est possible.') },
  { id: 'ch-place', kind: 'charter', source: `${CHARTER}, the “because” on every human being’s place`, for: ['hr', 'calendar', 'admin'], msg: m('كلّ إنسانٍ يستحقّ أن يجد مكانه في المجتمع', 'Every human being deserves to find their place in society.', 'Chaque être humain mérite de trouver sa place dans la société.') },
  { id: 'ch-dignity', kind: 'charter', source: `${CHARTER}, the “because” on dignity`, for: ['hr', 'admin'], msg: m('كرامتنا لا تنفصل عن كرامة الآخر', 'The dignity of a person is not separable from that of others.', 'La dignité d’un individu n’est pas séparable de celle des autres.') },
  { id: 'ch-bridges', kind: 'charter', source: `${CHARTER}, the “because” on bridges`, for: ['accounts', 'calendar', 'admin'], msg: m('عالمنا بحاجة إلى جسورٍ من الثقة والحوار', 'Our world needs bridges, trust and dialogue.', 'Notre monde a besoin de ponts, de confiance et de dialogue.') },
  { id: 'ch-home', kind: 'charter', source: `${CHARTER}, the “because” on the Earth, our common home`, for: ['inventory'], msg: m('نحن شركاء في المسؤوليّة تُجاه الأرض «بيتنا المشترك»', 'Together we are responsible for the Earth, “our common home”.', 'Nous sommes ensemble responsables de la Terre, « notre maison commune ».') },
  { id: 'ch-dream', kind: 'charter', source: `${CHARTER}, the dream`, for: ['calendar', 'centre'], msg: m('نحلم بخلق مِساحاتٍ يستطيع فيها الجميع المضيّ أبعدَ وأعمق', 'We dream of a space in which everyone can go further, deeper.', 'Nous rêvons d’espaces dans lesquels chacun puisse aller plus loin, davantage en profondeur.') },
  { id: 'ch-trust', kind: 'charter', source: `${CHARTER}, “Our values” (the sentence around the value is ours)`, for: ['accounts', 'admin'], msg: m('«ثقةٌ ومسؤوليّة»: إحدى قيمنا الخمس في الميثاق', '“Trust and responsibility”: one of the five values of our charter.', '« Confiance et responsabilité » : l’une des cinq valeurs de notre charte.') },
  { id: 'ch-simple', kind: 'charter', source: `${CHARTER}, “Our values” (the sentence around the value is ours)`, for: ['accounts', 'inventory'], msg: m('«بساطةٌ وجمال»: إحدى قيمنا الخمس في الميثاق', '“Simplicity and beauty”: one of the five values of our charter.', '« Simplicité et beauté » : l’une des cinq valeurs de notre charte.') },
  { id: 'ch-host', kind: 'charter', source: `${CHARTER}, “Our values” (the sentence around the value is ours)`, for: ['calendar'], msg: m('«استقبالٌ ومشاركة»: إحدى قيمنا الخمس في الميثاق', '“Hospitality and sharing”: one of the five values of our charter.', '« Hospitalité et partage » : l’une des cinq valeurs de notre charte.') },

  // ---- the explanation of the logos (the Arabic is the text; English and French are translated for this page)
  { id: 'lg-all-colours', kind: 'logo', source: `${LOGO}, “The meaning of the colours”`, for: ['hr', 'centre'], tr: ['en', 'fr'], msg: m('التنوّع الذي يولد من الوحدة', 'The diversity that is born from unity.', 'La diversité qui naît de l’unité.') },
  { id: 'lg-all-sun', kind: 'logo', source: `${LOGO}, “The meaning of the colours” (the circle, the sun)`, for: ['centre', 'hr'], tr: ['en', 'fr'], msg: m('مسيرة نورٍ يشرق ويتحرّك ليصل إلى الجميع', 'A journey of light that rises and moves to reach everyone.', 'Une marche de lumière qui se lève et avance pour atteindre tout le monde.') },
  { id: 'lg-jar-gates', kind: 'logo', centre: 'jaramana', source: `${LOGO}, the Damascus (Jaramana) centre`, for: ['centre', 'calendar'], tr: ['en', 'fr'], msg: m('بوابات لا تنفتح إلا بحضور الإنسان', 'Gates that open only when a person is there.', 'Des portes qui ne s’ouvrent que lorsqu’une personne est là.') },
  { id: 'lg-jar-grow', kind: 'logo', centre: 'jaramana', source: `${LOGO}, the Damascus (Jaramana) centre`, for: ['centre', 'hr'], tr: ['en', 'fr'], msg: m('مع حضور الأشخاص ينمو البيت ويكبر', 'As people come, the house grows.', 'Avec la présence des personnes, la maison grandit.') },
  { id: 'lg-jar-hands', kind: 'logo', centre: 'jaramana', source: `${LOGO}, the Damascus (Jaramana) centre`, for: ['calendar'], tr: ['en', 'fr'], msg: m('أشخاص بأيدٍ مفتوحة للاستقبال', 'People with open hands, ready to welcome.', 'Des personnes aux mains ouvertes, prêtes à accueillir.') },
  { id: 'lg-jar-pyramid', kind: 'logo', centre: 'jaramana', source: `${LOGO}, the Damascus (Jaramana) centre`, for: ['inventory', 'centre'], tr: ['en', 'fr'], msg: m('هرم غير منتهٍ، في إشارة إلى أن النمو لا يتوقف', 'A pyramid never finished: a sign that growth does not stop.', 'Une pyramide jamais achevée : le signe que la croissance ne s’arrête pas.') },
  { id: 'lg-ale-grow', kind: 'logo', centre: 'aleppo', source: `${LOGO}, the Aleppo centre`, for: ['centre', 'hr'], tr: ['en', 'fr'], msg: m('فمع الإنسان ينمو المكان ويكبر', 'With the person, the place grows.', 'Avec la personne, le lieu grandit.') },
  { id: 'lg-ale-gates', kind: 'logo', centre: 'aleppo', source: `${LOGO}, the Aleppo centre`, for: ['calendar', 'centre'], tr: ['en', 'fr'], msg: m('البوابات التي لا تنفتح إلا بوجود الإنسان', 'The gates that open only when a person is there.', 'Les portes qui ne s’ouvrent que lorsqu’une personne est là.') },
  { id: 'lg-ale-start', kind: 'logo', centre: 'aleppo', source: `${LOGO}, the Aleppo centre`, for: ['calendar', 'inventory'], tr: ['en', 'fr'], msg: m('نقطة البداية لكل من يدخل المكان', 'The starting point for everyone who enters the place.', 'Le point de départ de quiconque entre dans le lieu.') },
  { id: 'lg-hom-hands', kind: 'logo', centre: 'homs', source: `${LOGO}, the Homs centre`, for: ['centre', 'calendar'], tr: ['en', 'fr'], msg: m('يدان مفتوحتان ترمزان إلى هوية المكان القائمة على الاستقبال', 'Two open hands: the identity of this place rests on welcome.', 'Deux mains ouvertes : l’identité de ce lieu repose sur l’accueil.') },
  { id: 'lg-hom-grow', kind: 'logo', centre: 'homs', source: `${LOGO}, the Homs centre`, for: ['centre', 'hr'], tr: ['en', 'fr'], msg: m('فالإنسان حاضر في كل لقاء، ومعه ينمو المكان', 'A person is present in every encounter, and with them the place grows.', 'La personne est présente dans chaque rencontre, et avec elle le lieu grandit.') },
  { id: 'lg-hom-pyramid', kind: 'logo', centre: 'homs', source: `${LOGO}, the Homs centre`, for: ['inventory', 'centre'], tr: ['en', 'fr'], msg: m('هرم غير منتهٍ يرمز إلى نمو لا يتوقف', 'An unfinished pyramid, a sign of a growth that does not stop.', 'Une pyramide inachevée, signe d’une croissance qui ne s’arrête pas.') },

  // ---- the first page of the program (Fouad's sentences of the MAGIS animation, already approved there)
  { id: 'ap-hope', kind: 'app', source: 'The first page of the program (the sentence of hope of the MAGIS animation)', for: ['centre', 'accounts'], msg: m('رغم كلّ شيء، الرجاء ممكن', 'Despite everything, hope is possible', 'Malgré tout, l’espérance est possible') },
  { id: 'ap-jar', kind: 'app', centre: 'jaramana', source: 'The first page of the program (the sentence of the Jaramana house)', for: ['centre'], msg: m('في هذا البيت، البابُ مفتوحٌ قبل أن تصل', 'In this house the door is open before you arrive', 'Dans cette maison, la porte est ouverte avant que tu arrives') },
  { id: 'ap-ale', kind: 'app', centre: 'aleppo', source: 'The first page of the program (the sentence of the Aleppo house)', for: ['centre'], msg: m('كلُّ إنسانٍ يدخل من هنا هو بداية', 'Everyone who comes through here is a beginning', 'Chaque personne qui entre ici est un commencement') },
  { id: 'ap-hom', kind: 'app', centre: 'homs', source: 'The first page of the program (the sentence of the Homs house)', for: ['centre'], msg: m('أيدٍ مفتوحة، بعد كلّ ما فُقد', 'Open hands, after everything that was lost', 'Des mains ouvertes, après tout ce qui a été perdu') },
  { id: 'ap-alard', kind: 'app', centre: 'alard', source: 'The first page of the program (Fouad, 21 November 2026; English and French to be confirmed there too)', for: ['centre'], msg: m('الأرض: حيث يمكننا المضي للعمق', 'Al-Ard: where we can go deep', 'Al-Ard : là où nous pouvons aller en profondeur') },

  // ---- Al-Ard (the report of the three sessions at Al-Ard; Arabic and French translated for this page)
  { id: 'ar-trees', kind: 'note', centre: 'alard', source: 'Report for the 3 sessions at Al-Ard (the place described on the first day)', for: ['centre', 'inventory'], tr: ['ar', 'fr'], msg: m('محاطة بأراضٍ مزروعة مليئة بالزيتون والجوز واللوز', 'Surrounded by farmed lands full of olive, walnut and almond trees.', 'Entourée de terres cultivées pleines d’oliviers, de noyers et d’amandiers.') },
  { id: 'ar-peace', kind: 'note', centre: 'alard', source: 'Report for the 3 sessions at Al-Ard (“Dar Al-Salam”, on the first day)', for: ['centre', 'calendar'], tr: ['ar', 'fr'], msg: m('دار السلام: مكان صلاة يصلّي فيه الناس أياً كان دينهم', 'Dar Al-Salam, the House of Peace: a place of prayer where people can pray regardless of their religion.', 'Dar Al-Salam, la Maison de la Paix : un lieu de prière où chacun peut prier quelle que soit sa religion.') },

  // ---- the concept note and Fouad's own words (English as in the note; Arabic or French translated for this page)
  { id: 'nt-sower', kind: 'note', source: `${NOTE}0, in brief), taken from Fouad’s 2015 thesis (French original: “Si le semeur ne fait pas confiance à la terre, il n’aura rien à manger.”)`, for: ['accounts', 'inventory'], tr: ['ar'], msg: m('إن لم يثق الزارع بالأرض، فلن يجد ما يأكله', 'If the sower does not trust the soil, he will have nothing to eat.', 'Si le semeur ne fait pas confiance à la terre, il n’aura rien à manger.') },
  { id: 'nt-counted', kind: 'note', source: `${NOTE}11, conclusion)`, for: ['accounts'], tr: ['ar', 'fr'], msg: m('أهمّ تغيير لا يمكن أن يُعّد أبداً، لكنه يُحضَّر بصبر، لقاءً بعد لقاء', 'The most important change can never be counted. But it can be prepared, patiently, one encounter at a time.', 'Le changement le plus important ne peut jamais être compté. Mais il peut être préparé, patiemment, une rencontre après l’autre.') },
  { id: 'nt-trust', kind: 'note', source: `${NOTE}1, a country between war and peace)`, for: ['accounts', 'hr'], tr: ['ar', 'fr'], msg: m('نهجٌ صبور لطيف لإعادة بناء الثقة', 'A patient, gentle approach to rebuilding trust.', 'Une approche patiente et douce pour rebâtir la confiance.') },
  { id: 'nt-network', kind: 'note', source: `${NOTE}3, from Jaramana to a network)`, for: ['hr', 'admin'], tr: ['ar', 'fr'], msg: m('ميثاق واحد، وقيم مشتركة، وطريقة عمل مشتركة، وكلّ مركز حرّ في أن يجيب عن حاجات مدينته وطبعها', 'One charter, shared values and a shared way of working, while each centre keeps the freedom to answer the needs and character of its own city.', 'Une seule charte, des valeurs communes et une façon commune de travailler, chaque centre gardant la liberté de répondre aux besoins et au caractère de sa ville.') },
  { id: 'nt-direction', kind: 'note', source: `${NOTE}5) and the report for the 3 sessions at Al-Ard`, for: ['centre', 'calendar'], tr: ['ar', 'fr'], msg: m('من الخوف إلى الحرية، من الاستسلام إلى المقاومة، من الجمود إلى المبادرة', 'From fear to freedom, from resignation to resistance, from inertia to initiative.', 'De la peur à la liberté, de la résignation à la résistance, de l’inertie à l’initiative.') },
  { id: 'nt-source', kind: 'note', source: `${NOTE}11, conclusion)`, for: ['calendar', 'centre'], tr: ['ar', 'fr'], msg: m('مركزٌ متقَن يمكن أن يصبح مصدر رجاء حقيقيّاً للشباب السوري', 'A well-made community centre can become a real source of hope for young Syrians.', 'Un centre communautaire bien fait peut devenir une vraie source d’espérance pour les jeunes Syriens.') },

  // ---- the testimonies (as written in the concept note and the Al-Ard report; no name is shown)
  { id: 'ts-journey', kind: 'testimony', source: `${NOTE}5, “What participants say”); the participant is named there`, for: ['centre', 'calendar'], by: PARTICIPANT, tr: ['ar', 'fr'], msg: m('رحلةٌ أعطت قيمةً للحياة، ورجاءً بالعمل معاً والعيش معاً', 'A journey that gave value to life, and hope for working together and living together.', 'Un voyage qui a donné de la valeur à la vie, et l’espoir de travailler ensemble et de vivre ensemble.') },
  { id: 'ts-braver', kind: 'testimony', source: `${NOTE}5, “What participants say”); the participant is named there`, for: ['hr', 'centre'], by: PARTICIPANT, tr: ['ar', 'fr'], msg: m('أصبحت أشجع في معرفة نفسي', 'I have become braver in knowing myself.', 'Je suis devenu plus courageux dans la connaissance de moi-même.') },
  { id: 'ts-calm', kind: 'testimony', source: 'Report for the 3 sessions at Al-Ard (a participant’s words at the end of a session); the participant is not named in this extract', for: ['accounts', 'inventory'], by: PARTICIPANT, tr: ['ar', 'fr'], msg: m('كلّما كان هناك هدوء وأسئلة صائبة، شعرنا أن الحياة أسهل وأن الأشياء أوضح', 'Whenever there is calm and the right questions are asked, we feel that life becomes easier and things become clearer.', 'Dès qu’il y a du calme et que les bonnes questions sont posées, nous sentons que la vie devient plus facile et les choses plus claires.') },

  // ---- ORIGINAL: written for this page, in the same spirit; they are not quotes and belong to nobody
  { id: 'og-acc-faith', kind: 'original', source: 'original', for: ['accounts'], msg: m('أن نمسك الحسابات هو أن نبقى أوفياء لمن وثق بنا', 'Keeping accounts is a way of keeping faith with those who trusted us.', 'Tenir les comptes, c’est rester fidèle à ceux qui nous ont fait confiance.') },
  { id: 'og-acc-clear', kind: 'original', source: 'original', for: ['accounts'], msg: m('حسابات واضحة تتيح للجميع أن ينظروا بعضهم إلى بعض باطمئنان', 'Clear books let everyone look at one another without worry.', 'Des comptes clairs permettent à chacun de regarder l’autre sans inquiétude.') },
  { id: 'og-acc-gift', kind: 'original', source: 'original', for: ['accounts'], msg: m('وراء كل رقمٍ هنا عطاءُ أحدهم أو حاجتُه', 'Behind every figure here there is someone’s gift or someone’s need.', 'Derrière chaque chiffre, il y a le don de quelqu’un ou son besoin.') },
  { id: 'og-cal-expected', kind: 'original', source: 'original', for: ['calendar'], msg: m('وراء كل حجزٍ إنسانٌ ننتظره', 'Behind every booking, someone is expected.', 'Derrière chaque réservation, quelqu’un est attendu.') },
  { id: 'og-cal-ready', kind: 'original', source: 'original', for: ['calendar'], msg: m('قاعةٌ جاهزة هي ترحيبٌ يُقال بلا كلام', 'A hall that is ready is a welcome said without words.', 'Une salle prête, c’est un accueil dit sans paroles.') },
  { id: 'og-cal-days', kind: 'original', source: 'original', for: ['calendar'], msg: m('بيتٌ يرتّب أيّامه يمنح كلّ واحدٍ مكاناً فيها', 'A house that plans its days gives everyone a place in them.', 'Une maison qui prévoit ses jours donne à chacun une place dedans.') },
  { id: 'og-inv-thanks', kind: 'original', source: 'original', for: ['inventory'], msg: m('الأغراض المصونة طريقتنا في شكر من قدّمها', 'Things well kept are our way of thanking those who gave them.', 'Des choses bien gardées, c’est notre façon de remercier ceux qui les ont données.') },
  { id: 'og-inv-house', kind: 'original', source: 'original', for: ['inventory'], msg: m('البيت هو أيضاً طاولاته وكراسيه ومفاتيحه: نعتني بها كما نعتني بضيوفه', 'A house is also its tables, its chairs and its keys: we look after them as we look after its guests.', 'Une maison, ce sont aussi ses tables, ses chaises et ses clés : nous en prenons soin comme de ses hôtes.') },
  { id: 'og-inv-free', kind: 'original', source: 'original', for: ['inventory'], msg: m('أن نعرف أين الأشياء يحرّرنا لنفكّر بالناس', 'To know where things are frees us to think of the people.', 'Savoir où sont les choses nous libère pour penser aux personnes.') },
  { id: 'og-hr-name', kind: 'original', source: 'original', for: ['hr'], msg: m('وراء كل اسمٍ إنسان؛ ونحفظ هذه الصفحات باحترام', 'Behind every name there is a person; we keep these pages with respect.', 'Derrière chaque nom, il y a une personne ; nous gardons ces pages avec respect.') },
  { id: 'og-hr-trust', kind: 'original', source: 'original', for: ['hr'], msg: m('ما نعرفه عن كلّ شخصٍ أمانةٌ عندنا، لا مِلكٌ لنا', 'What we know about each person is entrusted to us, not owned by us.', 'Ce que nous savons de chacun nous est confié, il ne nous appartient pas.') },
  { id: 'og-hr-one', kind: 'original', source: 'original', for: ['hr'], msg: m('بيتٌ واحدٌ لأهل المراكز كلّها، وفيه غرفةٌ لكلّ مركز', 'One house for the people of all the centres, and in it a room for each centre.', 'Une seule maison pour les personnes de tous les centres, et dedans une chambre pour chaque centre.') },
];

/** the sentences of the doors page that the TV also shows (taken by name; no testimony, nothing about accounts, HR or the inventory) */
const ON_TV = [
  'ch-hope', 'ch-place', 'ch-dignity', 'ch-bridges', 'ch-dream', 'ch-host', 'ch-simple',
  'lg-all-colours', 'lg-all-sun',
  'lg-jar-gates', 'lg-jar-grow', 'lg-jar-hands', 'lg-ale-grow', 'lg-ale-gates', 'lg-ale-start', 'lg-hom-hands', 'lg-hom-grow',
  'ap-hope', 'ap-jar', 'ap-ale', 'ap-hom', 'ap-alard',
  'ar-trees',
  'nt-trust', 'nt-direction', 'nt-source',
  'og-cal-expected', 'og-cal-ready',
];

/** ORIGINAL, written for the TV (26 November 2026): welcome phrases in the same spirit, never given to a person */
const TV_ONLY: Sentence[] = ([
  ['tv-yours', 'أهلاً بكم، البيت بيتكم', 'Welcome. This house is yours.', 'Bienvenue. Cette maison est la vôtre.'],
  ['tv-expected', 'كنّا ننتظركم، تفضّلوا', 'We were expecting you. Come in.', 'Nous vous attendions. Entrez.'],
  ['tv-slow', 'هنا نلتقي على مهلٍ', 'Here we meet without hurry.', 'Ici, on se rencontre sans se presser.'],
  ['tv-table', 'لكلّ واحدٍ مكانٌ على الطاولة', 'There is a place at the table for everyone.', 'Il y a une place à table pour chacun.'],
  ['tv-asis', 'الباب مفتوح، تعالَوا كما أنتم', 'The door is open. Come as you are.', 'La porte est ouverte. Venez comme vous êtes.'],
  ['tv-patience', 'ما نبنيه معاً يحتاج إلى وقتٍ وصبر', 'What we build together takes time and patience.', 'Ce que nous bâtissons ensemble demande du temps et de la patience.'],
  ['tv-young', 'للشباب هنا مكانٌ، وصوتٌ يُسمَع', 'Young people have a place here, and a voice that is heard.', 'Les jeunes ont ici une place, et une voix qu’on entend.'],
  ['tv-hands', 'نستقبل بيدٍ مفتوحة، ونُصغي بقلبٍ هادئ', 'We welcome with an open hand and listen with a quiet heart.', 'Nous accueillons la main ouverte et écoutons le cœur tranquille.'],
  ['tv-listen', 'قبل أن نتكلّم، نُصغي', 'Before we speak, we listen.', 'Avant de parler, nous écoutons.'],
  ['tv-newday', 'يومٌ جديد، ولقاءاتٌ جديدة', 'A new day, and new encounters.', 'Un jour nouveau, et de nouvelles rencontres.'],
] as const).map(([id, ar, en, fr]) => ({ id, kind: 'original' as const, source: 'original', for: ['tv' as const], msg: m(ar, en, fr) }));

/** the default pool: the doors page's sentences (those that suit the TV also say so) and the TV's own */
export const SENTENCES: Sentence[] = [...BASE.map((x) => (ON_TV.includes(x.id) && x.kind !== 'testimony' ? { ...x, for: [...x.for, 'tv' as const] } : x)), ...TV_ONLY];

/** The sentences that suit a door (or the heading of the page), for this centre: its own logo and house sentences first in the heading. */
export function sentencesFor(slot: Place, centre: string, pool: Sentence[] = SENTENCES): Sentence[] {
  const mine = pool.filter((x) => x.for.includes(slot) && (!x.centre || x.centre === centre));
  if (slot !== 'centre') return mine;
  const own = mine.filter((x) => x.centre === centre);
  // the heading speaks with the centre's own words when it has some; otherwise with the charter and the note
  return own.length ? own : mine;
}

/**
 * One sentence for each slot, drawn at random, never the same sentence twice on the page and never the one shown at the last
 * visit of the same slot (`last`). `rand` is Math.random, or a fixed one in the tests.
 */
export function pickSentences(slots: Place[], centre: string, last: Partial<Record<string, string>> = {}, rand: () => number = Math.random, pool: Sentence[] = SENTENCES): Record<string, Sentence> {
  const out: Record<string, Sentence> = {};
  const used = new Set<string>();
  for (const slot of slots) {
    const cands = sentencesFor(slot, centre, pool);
    let fresh = cands.filter((x) => !used.has(x.id) && x.id !== last[slot]);
    if (!fresh.length) fresh = cands.filter((x) => !used.has(x.id));
    if (!fresh.length) fresh = cands;
    if (!fresh.length) continue; // a centre that switched every sentence of this place off: nothing is shown there
    const s = fresh[Math.floor(rand() * fresh.length) % fresh.length];
    out[slot] = s;
    used.add(s.id);
  }
  return out;
}
