// "The books" (Fouad, 14 November 2026: "like the accountant's page in MAGIS: the brothers as book holders,
// and when I go to a book I see more details"). One row per book: each brother, the house, the community's
// cash (with its bank) and the économat. A click opens the book: its month, its entries, its counts.
// The econome and the Superior see the same page; what each may change is decided by the server.
import { useMemo, useState } from 'react';
import { todayIso } from '../../../ui/kit';
import { CURS, accountBooks, balanceOf, forHouse, lastDay, zero, monthSheetOf, prevMonth, totalUsd, type CtyBook, type Money } from '../../domain';
import { useRates } from '../usd';
import { useCty, bookHelp, bookLabel, bookName } from '../CtyApp';
import { BOOK_ICON } from '../icons';
import { curName, dayName, money, monthName, t3 } from '../text';
import { MemberMonth } from './MemberMonth';
import { Register } from './Register';
import { CountHistory } from '../CountHistory';

const ORDER = ['personal', 'house', 'cash', 'economat'];

export function Books({ initialBook, initialYm }: { initialBook: number | null; initialYm?: string }) {
  const today = todayIso();
  const [open, setOpen] = useState<number | null>(initialBook);
  const [ym, setYm] = useState(initialYm ?? today.slice(0, 7));
  if (open != null) return <OneBook bookId={open} ym={ym} onBack={() => setOpen(null)} />;
  return <AllBooks ym={ym} setYm={setYm} onOpen={setOpen} />;
}

/** Who keeps a book, in words. */
function keptBy(b: CtyBook): string {
  if (b.cty_kind === 'personal') return t3('هو نفسه', 'himself', 'lui-même');
  if (b.cty_kind === 'house') return t3('المدبر', 'the minister', 'le ministre');
  return t3('القيم', 'the econome', "l'économe");
}

function AllBooks({ ym, setYm, onOpen }: { ym: string; setYm: (x: string) => void; onOpen: (id: number) => void }) {
  const { d, s: sess } = useCty();
  const rates = useRates();
  const today = todayIso();
  const end = ym === today.slice(0, 7) ? today : lastDay(ym);
  const books = useMemo(() => d.books.filter((b) => b.active && ORDER.includes(b.cty_kind ?? ''))
    .sort((a, b) => ORDER.indexOf(a.cty_kind ?? '') - ORDER.indexOf(b.cty_kind ?? '') || bookName(a).localeCompare(bookName(b))), [d.books]);

  const rows = useMemo(() => books.map((b) => {
    const grp = accountBooks(d.books, b);
    const ids = new Set(grp.map((x) => x.id));
    const touches = (e: { book_id: number; to_book_id: number | null }) => ids.has(e.book_id) || (e.to_book_id != null && ids.has(e.to_book_id));
    const m = d.months.find((x) => x.book_id === b.id && x.ym === ym);
    const s = monthSheetOf(d.entries, grp, ym);
    const used = d.entries.some((e) => touches(e) && e.date.slice(0, 7) === ym);
    const approvals = d.entries.filter((e) => ids.has(e.book_id) && e.approval_needed && !e.approved_at && !e.refused_at).length;
    const unconfirmed = d.entries.filter((e) => e.type === 'Transfer' && touches(e) && !e.received_at && !e.disputed_at && e.date <= end).length;
    const disputed = d.entries.filter((e) => e.type === 'Transfer' && touches(e) && e.disputed_at).length;
    const notes = d.notes.filter((n) => n.book_id === b.id && !n.read_at && n.author_id !== sess.profile.id).length;
    const lastEntry = d.entries.filter(touches).reduce((mx, e) => (e.date > mx ? e.date : mx), '');
    const house = zero();
    for (const v of forHouse(d.entries, ids, `${ym}-01`, lastDay(ym)).values()) for (const c of CURS) house[c] -= v[c];
    return { b, m, s, used, approvals, unconfirmed, disputed, notes, lastEntry, house, bal: balanceOf(d.entries, grp, end) };
  }), [d, books, ym, end, sess.profile.id]);
  const neg = (x: Money): Money => ({ LOC: -x.LOC, USD: -x.USD, EUR: -x.EUR });
  const personal = (k: string | null) => k === 'personal' || k === 'house';

  return (
    <>
      <div className="desk-head">
        <div className="cty-monthnav" style={{ margin: 0 }}>
          <button onClick={() => setYm(prevMonth(ym))}>‹</button>
          <h1>{t3('الدفاتر', 'The books', 'Les comptes')} · {monthName(ym)}</h1>
          <button disabled={ym >= today.slice(0, 7)} onClick={() => setYm(next(ym))}>›</button>
        </div>
      </div>
      <p className="muted small">{t3('كل دفتر في الجماعة ومن يمسكه. اضغط على دفتر لترى تفاصيله: شهره، قيوده، وعدّ نقده.', 'Every book of the community, who keeps it, and where it stands. Click a card to see everything: its month, its entries, its counts.', 'Chaque compte de la communauté et qui le tient. Cliquez sur un compte pour voir son détail : son mois, ses écritures, ses comptages.')}</p>
      {([
        ['personal', t3('الإخوة', 'The brothers', 'Les frères')],
        ['house', t3('البيت', 'The house', 'La maison')],
        ['econ', t3('دفاتر القيم', "The econome's books", "Les comptes de l'économe")],
      ] as const).map(([grp, title]) => {
        const list = rows.filter((r) => (grp === 'econ' ? ['cash', 'economat'].includes(r.b.cty_kind ?? '') : r.b.cty_kind === grp));
        if (!list.length) return null;
        return (
          <section key={grp}>
            <h2 className="desk-h2">{title}</h2>
            <div className="desk-bcards">
              {list.map((r) => {
                const usd = totalUsd(r.bal, rates).usd;
                const spent = totalUsd(neg(r.s.totalExpenses), rates).usd;
                const house = totalUsd(r.house, rates).usd;
                return (
                  <button key={r.b.id} className={`desk-bcard k-${r.b.cty_kind}`} onClick={() => onOpen(r.b.id)}>
                    <div className="desk-bcard-top">
                      <b>{BOOK_ICON[r.b.cty_kind ?? ''] ?? ''} {r.b.cty_kind === 'personal' ? bookName(r.b) : bookLabel(r.b)}</b>
                      <span className="badges">
                        {r.approvals > 0 && <i title={t3('بانتظار الرئيس', 'waiting for the Superior', 'en attente du Supérieur')}>⏳ {r.approvals}</i>}
                        {r.unconfirmed > 0 && <i title={t3('مبالغ لم تؤكَّد', 'transfers not confirmed', 'transferts non confirmés')}>… {r.unconfirmed}</i>}
                        {r.disputed > 0 && <i className="bad" title={t3('قيل إن مبلغاً لم يصل', 'money said not received', 'montant dit non reçu')}>⚠ {r.disputed}</i>}
                        {r.notes > 0 && <i title={t3('ملاحظات غير مقروءة', 'unread remarks', 'remarques non lues')}>✉︎ {r.notes}</i>}
                      </span>
                    </div>
                    <div className="small muted">{t3('يمسكه', 'Kept by', 'Tenu par')} {keptBy(r.b)}</div>
                    <div className="desk-bcard-bal">
                      {CURS.filter((c) => c === 'LOC' || r.bal[c]).map((c) => <div key={c}><b>{money(r.bal[c], c)}</b> <span className="muted">{curName(c, d.local)}</span></div>)}
                      {CURS.some((c) => c !== 'LOC' && r.bal[c]) && <div className="small muted">≈ ${money(usd, 'USD')} {t3('الكل', 'in all', 'en tout')}</div>}
                    </div>
                    <div className="desk-bcard-foot">
                      {personal(r.b.cty_kind) && <span>{r.m ? <span className="ok">✓ {t3('الشهر مغلق', 'month closed', 'mois clôturé')}</span> : r.used ? t3('الشهر مفتوح', 'month open', 'mois ouvert') : t3('لا قيود هذا الشهر', 'nothing this month', 'rien ce mois')}
                        {r.m && r.m.counted_loc != null && r.m.book_loc != null && r.m.counted_loc !== r.m.book_loc && <span className="desk-alert"> · {t3('فرق', 'difference', 'écart')}</span>}
                        {r.m && <> · {r.m.seen_at ? <span className="ok">✓ {t3('اطّلع الرئيس', 'seen by the Superior', 'vu par le Supérieur')}</span> : t3('لم يطّلع الرئيس', 'not seen yet', 'pas encore vu')}</>}</span>}
                      {spent > 0 && <span>{t3('صُرف هذا الشهر', 'spent this month', 'dépensé ce mois')} ≈ ${money(spent, 'USD')}{house > 0 ? <> · 🏠 {t3('منها للبيت', 'of which for the house', 'dont maison')} ≈ ${money(house, 'USD')}</> : null}</span>}
                      <span>{t3('آخر قيد', 'Last entry', 'Dernière écriture')}: {r.lastEntry ? dayName(r.lastEntry) : '—'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="muted small">⏳ {t3('بانتظار الرئيس', 'waiting for the Superior', 'en attente du Supérieur')} · … {t3('مبلغ لم يؤكَّد استلامه', 'money not yet confirmed as received', 'argent pas encore confirmé reçu')} · ⚠ {t3('قيل إنه لم يصل', 'said not received', 'dit non reçu')} · ✉︎ {t3('ملاحظات', 'remarks', 'remarques')}</p>
    </>
  );
}

type Tab = 'month' | 'entries' | 'counts';

function OneBook({ bookId, ym, onBack }: { bookId: number; ym: string; onBack: () => void }) {
  const { d } = useCty();
  const book = d.books.find((b) => b.id === bookId);
  const withMonth = book?.cty_kind === 'personal' || book?.cty_kind === 'house';
  const [tab, setTab] = useState<Tab>(withMonth ? 'month' : 'entries');
  if (!book) return <button className="btn" onClick={onBack}>‹ {t3('كل الدفاتر', 'All the books', 'Tous les comptes')}</button>;
  const tabs: { k: Tab; label: string; hidden?: boolean }[] = [
    { k: 'month', label: t3('الشهر', 'The month', 'Le mois'), hidden: !withMonth },
    { k: 'entries', label: t3('القيود', 'Entries', 'Écritures') },
    { k: 'counts', label: t3('عدّ النقد', 'Cash counts', 'Comptages') },
  ];
  return (
    <>
      <div className="desk-bookhead">
        <button className="btn" onClick={onBack}>‹ {t3('كل الدفاتر', 'All the books', 'Tous les comptes')}</button>
        <div>
          <h1 style={{ margin: 0 }}>{BOOK_ICON[book.cty_kind ?? ''] ?? ''} {book.cty_kind === 'personal' ? bookName(book) : bookLabel(book)}</h1>
          <div className="small muted">{t3('يمسكه', 'Kept by', 'Tenu par')} {keptBy(book)} · {bookHelp(book.cty_kind)}</div>
        </div>
      </div>
      <div className="desk-tabs" role="tablist">
        {tabs.filter((t) => !t.hidden).map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>{t.label}</button>)}
      </div>
      {tab === 'month' && <MemberMonth initialBook={book.id} initialYm={ym} fixed />}
      {tab === 'entries' && <Register initialBook={book.id} initialYm={ym} fixed />}
      {tab === 'counts' && <div className="desk-narrow"><CountHistory bookId={book.id} /></div>}
    </>
  );
}

const next = (ym: string) => {
  const [y, mo] = ym.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
