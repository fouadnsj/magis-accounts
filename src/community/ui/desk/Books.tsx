// "The books" (Fouad, 14 November 2026: "like the accountant's page in MAGIS: the brothers as book holders,
// and when I go to a book I see more details"). One row per book: each brother, the house, the community's
// cash (with its bank) and the économat. A click opens the book: its month, its entries, its counts.
// The econome and the Superior see the same page; what each may change is decided by the server.
import { useMemo, useState } from 'react';
import { todayIso } from '../../../ui/kit';
import { CURS, accountBooks, balanceOf, lastDay, monthSheetOf, prevMonth, totalUsd, type CtyBook, type Money } from '../../domain';
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
    return { b, m, s, used, approvals, unconfirmed, disputed, notes, lastEntry, bal: balanceOf(d.entries, grp, end) };
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
      <p className="muted small">{t3('كل دفتر في الجماعة ومن يمسكه. اضغط على دفتر لترى تفاصيله: شهره، قيوده، وعدّ نقده.', 'Every book of the community and who keeps it. Click a book to see its details: its month, its entries, its counts.', 'Chaque compte de la communauté et qui le tient. Cliquez sur un compte pour voir son détail : son mois, ses écritures, ses comptages.')}</p>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead>
            <tr>
              <th>{t3('الدفتر', 'Book', 'Compte')}</th>
              <th>{t3('يمسكه', 'Kept by', 'Tenu par')}</th>
              <th>{t3('الشهر', 'Month', 'Mois')}</th>
              <th>{t3('الرئيس', 'Superior', 'Supérieur')}</th>
              {CURS.map((c) => <th key={c} className="num">{t3('الرصيد', 'Balance', 'Solde')} {curName(c, d.local)}</th>)}
              <th className="num">{t3('الرصيد ≈ $', 'Balance ≈ $', 'Solde ≈ $')}</th>
              <th className="num">{t3('صُرف في الشهر ≈ $', 'Spent this month ≈ $', 'Dépensé ce mois ≈ $')}</th>
              <th>{t3('آخر قيد', 'Last entry', 'Dernière écriture')}</th>
              <th>{t3('ينتظر', 'Waiting', 'En attente')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.b.id} className="click" onClick={() => onOpen(r.b.id)}>
                <td><b>{BOOK_ICON[r.b.cty_kind ?? ''] ?? ''} {r.b.cty_kind === 'personal' ? bookName(r.b) : bookLabel(r.b)}</b></td>
                <td className="small muted">{keptBy(r.b)}</td>
                <td>{personal(r.b.cty_kind) ? (r.m ? <span className="ok">✓ {t3('مغلق', 'closed', 'clôturé')}</span> : r.used ? <span className="muted">{t3('مفتوح', 'open', 'ouvert')}</span> : <span className="muted">—</span>) : ''}
                  {r.m && r.m.counted_loc != null && r.m.book_loc != null && r.m.counted_loc !== r.m.book_loc && <span className="desk-alert small"> · {t3('فرق', 'difference', 'écart')}</span>}</td>
                <td>{r.m?.seen_at ? <span className="ok">✓</span> : r.m ? <span className="muted">…</span> : ''}</td>
                {CURS.map((c) => <td key={c} className="num">{r.bal[c] ? money(r.bal[c], c) : <span className="muted">-</span>}</td>)}
                <td className="num"><b>{totalUsd(r.bal, rates).usd ? money(totalUsd(r.bal, rates).usd, 'USD') : <span className="muted">-</span>}</b></td>
                <td className="num">{totalUsd(neg(r.s.totalExpenses), rates).usd ? money(totalUsd(neg(r.s.totalExpenses), rates).usd, 'USD') : <span className="muted">-</span>}</td>
                <td className="small muted">{r.lastEntry ? dayName(r.lastEntry) : '—'}</td>
                <td className="small">
                  {r.approvals > 0 && <span title={t3('بانتظار الرئيس', 'waiting for the Superior', 'en attente du Supérieur')}>⏳ {r.approvals} </span>}
                  {r.unconfirmed > 0 && <span title={t3('مبالغ لم تؤكَّد', 'transfers not confirmed', 'transferts non confirmés')}>… {r.unconfirmed} </span>}
                  {r.disputed > 0 && <span className="desk-alert" title={t3('قيل إن مبلغاً لم يصل', 'money said not received', 'montant dit non reçu')}>⚠ {r.disputed} </span>}
                  {r.notes > 0 && <span title={t3('ملاحظات غير مقروءة', 'unread remarks', 'remarques non lues')}>✉︎ {r.notes}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
