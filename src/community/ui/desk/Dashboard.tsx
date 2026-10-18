// The econome's dashboard: this month, member by member (closed? money confirmed?
// approvals?), the cash, the bank and the économat in three currencies, the rate,
// and what is left to do. A click on a member opens his month.
import { useMemo, useState } from 'react';
import { todayIso } from '../../../ui/kit';
import { CURS, balance, lastDay, monthSheet, prevMonth, rateFromExchanges, type CtyBook, type Cur } from '../../domain';
import { useCty, bookLabel, bookName } from '../CtyApp';
import { curName, money, monthName, t3 } from '../text';
import type { DeskNav } from './Desk';

export function Dashboard({ go }: { go: (n: DeskNav) => void }) {
  const { d, write } = useCty();
  const today = todayIso();
  const [ym, setYm] = useState(today.slice(0, 7));
  const end = ym === today.slice(0, 7) ? today : lastDay(ym);
  const people = d.books.filter((b) => b.active && (b.cty_kind === 'personal' || b.cty_kind === 'house'));
  const own = d.books.filter((b) => b.active && ['cash', 'bank', 'economat'].includes(b.cty_kind ?? ''));
  const cash = own.find((b) => b.cty_kind === 'cash');

  const rows = useMemo(() => people.map((b) => {
    const m = d.months.find((x) => x.book_id === b.id && x.ym === ym);
    const s = monthSheet(d.entries, b, ym);
    const unconfirmed = d.entries.filter((e) => e.type === 'Transfer' && (e.to_book_id === b.id || e.book_id === b.id) && !e.received_at && !e.disputed_at && e.date <= lastDay(ym)).length;
    const disputed = d.entries.filter((e) => e.type === 'Transfer' && (e.to_book_id === b.id || e.book_id === b.id) && e.disputed_at).length;
    const approvals = d.entries.filter((e) => e.book_id === b.id && e.approval_needed && !e.approved_at).length;
    const used = d.entries.some((e) => (e.book_id === b.id || e.to_book_id === b.id) && e.date.slice(0, 7) === ym);
    return { b, m, s, pocket: balance(d.entries, b, end), unconfirmed, disputed, approvals, used };
  }), [d, ym, end, people]);

  // what is left to do
  const last = prevMonth(today.slice(0, 7));
  const lateClosing = Number(today.slice(8, 10)) > 5 ? people.filter((b) => !d.months.some((x) => x.book_id === b.id && x.ym === last) && d.entries.some((e) => (e.book_id === b.id || e.to_book_id === b.id) && e.date.slice(0, 7) <= last)) : [];
  const claims = d.entries.filter((e) => e.claim && e.date.slice(0, 7) === ym);
  const usdLoc = rateFromExchanges(d.entries, 'USD', 'LOC', today);
  const eurLoc = rateFromExchanges(d.entries, 'EUR', 'LOC', today);

  return (
    <>
      <div className="desk-head">
        <div className="cty-monthnav" style={{ margin: 0 }}>
          <button onClick={() => setYm(prevMonth(ym))}>‹</button>
          <h1>{monthName(ym)}</h1>
          <button disabled={ym >= today.slice(0, 7)} onClick={() => setYm(nextMonth(ym))}>›</button>
        </div>
        <div className="row">
          {cash && <button className="btn primary" onClick={() => write({ kind: 'Transfer', bookId: cash.id })}>{t3('إعطاء مال من الصندوق…', 'Give money from the cash…', 'Donner de l’argent de la caisse…')}</button>}
          <button className="btn" onClick={() => go({ page: 'register' })}>{t3('السجل', 'Register', 'Registre')}</button>
        </div>
      </div>

      <div className="desk-cards">
        {own.map((b) => <BookCard key={b.id} b={b} end={end} onOpen={() => go({ page: 'register', bookId: b.id, ym })} />)}
        <div className="cty-card desk-card">
          <div className="cty-label">{t3('السعر (آخر صرافة)', 'Rate (last exchange)', 'Taux (dernier change)')}</div>
          <div>$1 = {money(usdLoc ?? d.limits.startRate, 'LOC')} {curName('LOC', d.local)} {usdLoc == null && <span className="muted small">({t3('سعر البداية', 'starting rate', 'taux de départ')})</span>}</div>
          {eurLoc != null && <div>€1 = {money(eurLoc, 'LOC')} {curName('LOC', d.local)}</div>}
        </div>
      </div>

      {(lateClosing.length > 0 || rows.some((r) => r.unconfirmed || r.disputed || r.approvals) || claims.length > 0) && (
        <div className="cty-card desk-todo">
          <div className="cty-label">{t3('ما بقي', 'Left to do', 'Reste à faire')}</div>
          <ul>
            {lateClosing.length > 0 && <li>{t3(`لم يُغلق شهر ${monthName(last)}:`, `${monthName(last)} not closed:`, `${monthName(last)} non clôturé :`)} {lateClosing.map((b) => bookName(b)).join(', ')}</li>}
            {rows.filter((r) => r.unconfirmed).map((r) => <li key={'u' + r.b.id}>{bookName(r.b)}: {t3(`${r.unconfirmed} مبلغ لم يؤكَّد`, `${r.unconfirmed} transfer(s) not yet confirmed`, `${r.unconfirmed} transfert(s) non confirmé(s)`)}</li>)}
            {rows.filter((r) => r.disputed).map((r) => <li key={'d' + r.b.id} className="desk-alert">⚠ {bookName(r.b)}: {t3('قيل إن مبلغاً لم يصل', 'says money was not received', 'dit qu’un montant n’a pas été reçu')}</li>)}
            {rows.filter((r) => r.approvals).map((r) => <li key={'a' + r.b.id}>⏳ {bookName(r.b)}: {t3(`${r.approvals} بانتظار الرئيس`, `${r.approvals} waiting for the Superior`, `${r.approvals} en attente du Supérieur`)}</li>)}
            {claims.length > 0 && <li>↺ {t3(`${claims.length} نفقة للمطالبة هذا الشهر`, `${claims.length} expense(s) to claim this month`, `${claims.length} dépense(s) à réclamer ce mois-ci`)} · <button className="cty-link" onClick={() => go({ page: 'claims' })}>{t3('عرض', 'see', 'voir')}</button></li>}
          </ul>
        </div>
      )}

      <div className="cty-card">
        <div className="cty-label">{t3('الأعضاء والبيت', 'Members and house', 'Membres et maison')}</div>
        <table className="desk-table">
          <thead>
            <tr>
              <th>{t3('الدفتر', 'Book', 'Compte')}</th>
              <th>{t3('الشهر', 'Month', 'Mois')}</th>
              <th>{t3('الرئيس', 'Superior', 'Supérieur')}</th>
              <th className="num">{t3('صُرف', 'Spent', 'Dépensé')} ({curName('LOC', d.local)})</th>
              {CURS.map((c) => <th key={c} className="num">{t3('في الجيب', 'In pocket', 'En poche')} {curName(c, d.local)}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.b.id} className="click" onClick={() => go({ page: 'member', bookId: r.b.id, ym })}>
                <td><b>{r.b.cty_kind === 'house' ? bookLabel(r.b) : bookName(r.b)}</b></td>
                <td>{r.m ? <span className="ok">✓ {t3('مغلق', 'closed', 'clôturé')}</span> : r.used ? <span className="muted">{t3('مفتوح', 'open', 'ouvert')}</span> : <span className="muted">—</span>}
                  {r.m && r.m.counted_loc != null && r.m.book_loc != null && r.m.counted_loc !== r.m.book_loc && <span className="desk-alert small"> · {t3('فرق', 'difference', 'écart')}</span>}</td>
                <td>{r.m?.seen_at ? '✓' : r.m ? <span className="muted">…</span> : ''}</td>
                <td className="num">{money(-r.s.totalExpenses.LOC, 'LOC')}</td>
                {CURS.map((c) => <td key={c} className="num">{r.pocket[c] ? money(r.pocket[c], c) : <span className="muted">-</span>}</td>)}
                <td className="small">{[r.unconfirmed ? '…' : '', r.disputed ? '⚠' : '', r.approvals ? '⏳' : ''].join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BookCard({ b, end, onOpen }: { b: CtyBook; end: string; onOpen: () => void }) {
  const { d } = useCty();
  const bal = balance(d.entries, b, end);
  const curs: Cur[] = CURS.filter((c) => c === 'LOC' || bal[c] !== 0);
  return (
    <button className="cty-card desk-card click" onClick={onOpen}>
      <div className="cty-label">{bookLabel(b)}</div>
      {curs.map((c) => <div key={c} className="desk-bal"><b>{money(bal[c], c)}</b> <span className="muted">{curName(c, d.local)}</span></div>)}
    </button>
  );
}

const nextMonth = (ym: string) => {
  const [y, mo] = ym.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
