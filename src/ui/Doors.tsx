// The doors page (Fouad, 24 November 2026): "when I enter a centre I see several badges: Accounts, Calendar, Inventory, HR".
// Large, calm badges in the style of the first page (the sun, the halo, each coming in one after the other), each with a warm
// sentence drawn at random at every visit (doorSentences.ts: the charter, the logos, the concept note, the testimonies, or
// plainly marked original). A person with a single door sees the same page: it would be a pity to avoid it.
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { CENTRES, type CentreKey } from '../brand';
import { getLang, m, tx, type Msg } from '../i18n';
import { DOOR_ORDER, type DoorKey } from '../doors';
import { pickSentences, type Sentence } from './doorSentences';

const DOOR: Record<DoorKey, { name: Msg; hint: Msg; glyph: ReactNode }> = {
  accounts: {
    name: m('الحسابات', 'Accounts', 'Comptes'),
    hint: m('الدفاتر والنقد والتقارير', 'Books, cash and reports', 'Livres, caisse et rapports'),
    glyph: <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 11c5-2 11-2 16 2 5-4 11-4 16-2v26c-5-2-11-2-16 2-5-4-11-4-16-2z" /><path d="M24 13v26" /><path d="M13 19c3-.8 6-.6 8 .8M13 25c3-.8 6-.6 8 .8M27 20c2-1.4 5-1.6 8-.8M27 26c2-1.4 5-1.6 8-.8" /></svg>,
  },
  calendar: {
    name: m('التقويم', 'Calendar', 'Calendrier'),
    hint: m('القاعات والغرف والمجموعات', 'Halls, rooms and groups', 'Salles, chambres et groupes'),
    glyph: <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="11" width="32" height="29" rx="3" /><path d="M8 19h32M16 7v8M32 7v8" /><path d="M15 26h4M22 26h4M29 26h4M15 33h4M22 33h4" /></svg>,
  },
  inventory: {
    name: m('الجرد', 'Inventory', 'Inventaire'),
    hint: m('ما في البيت وأين هو', 'What is in the house, and where', 'Ce qu’il y a dans la maison, et où'),
    glyph: <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 7l15 7v20l-15 7-15-7V14z" /><path d="M9 14l15 7 15-7M24 21v20" /><path d="M16.5 10.5l15 7" /></svg>,
  },
  hr: {
    name: m('الموارد البشرية', 'HR', 'RH'),
    hint: m('أشخاص المراكز كلّها، وكلّ مركز على حدة في الداخل', 'The people of all the centres, each centre kept apart inside', 'Les personnes de tous les centres, chaque centre à part à l’intérieur'),
    glyph: <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="16" r="6" /><path d="M12 39c0-7 5-12 12-12s12 5 12 12" /><circle cx="10" cy="22" r="4" /><circle cx="38" cy="22" r="4" /><path d="M3 36c0-4 3-7 7-7M45 36c0-4-3-7-7-7" /></svg>,
  },
  admin: {
    name: m('الإدارة', 'Administration', 'Administration'),
    hint: m('أشخاص المركز وأدوارهم', 'The people of the centre and their roles', 'Les personnes du centre et leurs rôles'),
    glyph: <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="20" cy="15" r="6" /><path d="M8 38c0-7 5-12 12-12 3 0 5.5.9 7.5 2.4" /><path d="M35 25l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9v-5z" /><path d="M32 33l2.2 2.2L38.5 31" /></svg>,
  },
};
const ENTER = m('دخول', 'Enter', 'Entrer');
const HR_NOTE = m('واحدة للجميع، ومفصولة في الداخل', 'One for all, and separated inside', 'Une pour tous, et séparée à l’intérieur');

/** the sentence shown at the last visit of each slot (kept while the program is open), so the next visit shows another */
const lastSeen: Partial<Record<string, string>> = {};

/** A sentence in Arabic and, under it, in English or French (Arabic alone when the program is in Arabic). */
function Said({ s, className }: { s: Sentence; className?: string }) {
  const l = getLang();
  return (
    <div className={`mg-said ${className ?? ''}`}>
      <p className="ar" dir="rtl">{s.msg.ar}</p>
      {l !== 'ar' && <p className="tr" dir="ltr">{l === 'fr' ? s.msg.fr ?? s.msg.en : s.msg.en}</p>}
      {s.by && <p className="by">{l === 'ar' ? s.by.ar : l === 'fr' ? s.by.fr ?? s.by.en : s.by.en}</p>}
    </div>
  );
}

/** A name in Arabic, and the English or French small under it. */
function Name({ msg, className }: { msg: Msg; className?: string }) {
  const l = getLang();
  return (
    <div className={className}>
      <b className="ar" dir="rtl">{msg.ar}</b>
      {l !== 'ar' && <span dir="ltr">{l === 'fr' ? msg.fr ?? msg.en : msg.en}</span>}
    </div>
  );
}

/** a door's name, for other screens (the Users window shows each person's doors) */
export const doorName = (k: DoorKey): Msg => DOOR[k].name;

export function Doors({ doors, centre, centreName, mark, who, badges, onEnter, children }: {
  doors: DoorKey[];
  centre: string;
  /** the name of this house (the organisation) */
  centreName: string;
  /** the centre's mark */
  mark: string;
  /** the person signed in */
  who: string;
  /** a small number on a door (things waiting there) */
  badges?: Partial<Record<DoorKey, number>>;
  onEnter: (k: DoorKey) => void;
  /** under the doors: a note, a link */
  children?: ReactNode;
}) {
  // a different sentence at each visit: drawn when the page opens, never the one of the last visit
  const said = useMemo(() => {
    const x = pickSentences(['centre', ...doors], centre, lastSeen);
    for (const [k, v] of Object.entries(x)) lastSeen[k] = v.id;
    return x;
  }, [doors.join(','), centre]); // eslint-disable-line react-hooks/exhaustive-deps
  const ordered = DOOR_ORDER.filter((k) => doors.includes(k));
  const eyebrow = (centre in CENTRES ? tx(CENTRES[centre as CentreKey].name) : '');
  return (
    <div className="dr-page">
      <header className="dr-hero">
        <div className="dr-mark"><span className="mg-hh-halo" /><img src={mark} alt="" /></div>
        <div className="mg-eyebrow">MAGIS{eyebrow ? ` · ${eyebrow}` : ''}</div>
        <h1 className="dr-name">{centreName}</h1>
        <Said s={said.centre} className="dr-centre-said" />
        <div className="dr-who">{tx(m('أهلاً', 'Welcome', 'Bienvenue'))}, {who}</div>
      </header>
      {ordered.length > 0 ? (
        <div className={`dr-grid n${ordered.length}`}>
          {ordered.map((k, i) => (
            <button key={k} type="button" className={`dr-door ${k}`} style={{ animationDelay: `${0.35 + i * 0.28}s` } as CSSProperties} onClick={() => onEnter(k)}
              aria-label={`${DOOR[k].name.ar} · ${DOOR[k].name.en} · ${tx(ENTER)}`}>
              {!!badges?.[k] && <span className="dr-badge" title={String(badges[k])}>{badges[k]}</span>}
              <span className="dr-glyph"><span className="mg-hh-halo" />{DOOR[k].glyph}</span>
              <Name msg={DOOR[k].name} className="dr-title" />
              <span className="dr-hint">{tx(DOOR[k].hint)}</span>
              {k === 'hr' && (
                <span className="dr-houses" aria-hidden="true">
                  {(['jaramana', 'aleppo', 'homs', 'alard'] as CentreKey[]).map((h) => <img key={h} src={CENTRES[h].mark!} alt="" />)}
                  <span className="dr-houses-note">{tx(HR_NOTE)}</span>
                </span>
              )}
              <Said s={said[k]} className="dr-said" />
              <span className="dr-go">{tx(ENTER)} ›</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="dr-none">
          <p>{tx(m('لا بابَ مفتوح لك هنا بعد. اطلب من الرئيس أن يعطيك الصلاحيات المناسبة.', 'No door is open to you here yet. Ask the Superior to give you the right ticks.', 'Aucune porte ne vous est encore ouverte ici. Demandez au Supérieur de vous donner les droits qu’il faut.'))}</p>
        </div>
      )}
      {children}
    </div>
  );
}
