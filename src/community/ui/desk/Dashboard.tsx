// The econome's dashboard: this month, member by member (closed? money confirmed?
// approvals?), the cash, the bank and the économat in three currencies, the rate,
// and what is left to do. A click on a member opens his month.
import { useMemo, useState } from 'react';
import { todayIso } from '../../../ui/kit';
import { CURS, accountBooks, balance, balanceOf, lastDay, monthSheetOf, monthsOfYear, sheetOf, prevMonth, rateFromExchanges, totalUsd, yearOf, type CtyBook, type Cur, type Money } from '../../domain';
import { AllUsd, useRates } from '../usd';
import { Columns, Ring } from '../charts';
import { headingOf } from '../Month';
import { useCty, bookHelp, bookLabel, bookName } from '../CtyApp';
import { accName, curName, dayName, money, monthName, t3 } from '../text';
import type { DeskNav } from './Desk';

export function Dashboard({ go }: { go: (n: DeskNav) => void }) {
  const { d, give, write } = useCty();
  const rates = useRates();
  const today = todayIso();
  const [ym, setYm] = useState(today.slice(0, 7));
  const end = ym === today.slice(0, 7) ? today : lastDay(ym);
  const people = d.books.filter((b) => b.active && (b.cty_kind === 'personal' || b.cty_kind === 'house'));
  const grp = (b: CtyBook) => accountBooks(d.books, b);
  // the community's money (cash box + bank, added together) and its account at the économat
  const own = d.books.filter((b) => b.active && ['cash', 'economat'].includes(b.cty_kind ?? ''));
  const cash = own.find((b) => b.cty_kind === 'cash');

  const rows = useMemo(() => people.map((b) => {
    const m = d.months.find((x) => x.book_id === b.id && x.ym === ym);
    const s = monthSheetOf(d.entries, grp(b), ym);
    const unconfirmed = d.entries.filter((e) => e.type === 'Transfer' && (e.to_book_id === b.id || e.book_id === b.id) && !e.received_at && !e.disputed_at && e.date <= lastDay(ym)).length;
    const disputed = d.entries.filter((e) => e.type === 'Transfer' && (e.to_book_id === b.id || e.book_id === b.id) && e.disputed_at).length;
    const approvals = d.entries.filter((e) => e.book_id === b.id && e.approval_needed && !e.approved_at).length;
    const used = d.entries.some((e) => (e.book_id === b.id || e.to_book_id === b.id) && e.date.slice(0, 7) === ym);
    const ids = new Set(grp(b).map((x) => x.id));
    const lastEntry = d.entries.filter((e) => ids.has(e.book_id) || (e.to_book_id != null && ids.has(e.to_book_id))).reduce((mx, e) => (e.date > mx ? e.date : mx), '');
    const yr = yearOf(`${ym}-01`);
    const ySpent = sheetOf(d.entries, grp(b), `${yr}-10-01`, end).totalExpenses;
    return { b, m, s, pocket: balanceOf(d.entries, grp(b), end), unconfirmed, disputed, approvals, used, lastEntry, ySpent };
  }), [d, ym, end, people]);

  // where the community's money went (members and house together) and month by month
  const spentParts = useMemo(() => {
    const by = new Map<number, number>();
    for (const r of rows) for (const [id, v] of r.s.expenses) {
      const h = headingOf(d.accounts, id);
      if (h) by.set(h.id, (by.get(h.id) ?? 0) - v.LOC);
    }
    return [...by.entries()].map(([id, value]) => ({ key: id, label: accName(d.accounts.find((a) => a.id === id)), value }));
  }, [rows, d.accounts]);
  const yearCols = monthsOfYear(yearOf(`${ym}-01`)).map((m) => ({
    label: m.slice(5), title: monthName(m),
    now: people.reduce((n, b) => n - monthSheetOf(d.entries, grp(b), m).totalExpenses.LOC, 0),
    before: people.reduce((n, b) => n - monthSheetOf(d.entries, grp(b), `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`).totalExpenses.LOC, 0),
  }));

  const neg = (m: Money): Money => ({ LOC: -m.LOC, USD: -m.USD, EUR: -m.EUR });
  const sum = (f: (r: (typeof rows)[number]) => Money): Money => rows.reduce((t, r) => ({ LOC: t.LOC + f(r).LOC, USD: t.USD + f(r).USD, EUR: t.EUR + f(r).EUR }), { LOC: 0, USD: 0, EUR: 0 });
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
        <button className="btn" onClick={() => go({ page: 'register' })}>{t3('كل القيود', 'All entries', 'Toutes les écritures')}</button>
      </div>

      {/* the four things the econome does, "Give money" first: it is what he uses most */}
      {cash && d.kept.includes(cash.id) && (
        <div className="desk-four">
          <button className="give" onClick={give}><i>💰</i><b>{t3('إعطاء مال', 'Give money', 'Donner de l’argent')}</b><small>{t3('لأحد الإخوة أو للبيت', 'to a brother or to the house', 'à un frère ou à la maison')}</small></button>
          <button className="out" onClick={() => write({ kind: 'Exp', bookId: cash.id })}><i>－</i><b>{t3('صرفتُ', 'Spent', 'Dépensé')}</b><small>{t3('نفقة من صندوق الجماعة', 'an expense from the community money', 'une dépense sur l’argent de la communauté')}</small></button>
          <button className="in" onClick={() => write({ kind: 'Income', bookId: cash.id })}><i>＋</i><b>{t3('قبضتُ', 'Received', 'Reçu')}</b><small>{t3('مال دخل الجماعة', 'money that came to the community', 'de l’argent arrivé à la communauté')}</small></button>
          <button className="exc" onClick={() => write({ kind: 'Exchange', bookId: cash.id })}><i>⇄</i><b>{t3('صرافة', 'Exchange', 'Change')}</b><small>{t3('تبديل عملة بأخرى', 'one currency for another', 'une monnaie contre une autre')}</small></button>
        </div>
      )}

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

      {spentParts.some((p) => p.value > 0) && (
        <div className="desk-two">
          <div className="cty-card">
            <div className="cty-label">{t3('أين ذهب مال الجماعة هذا الشهر', "Where the community's money went this month", "Où l'argent de la communauté est allé ce mois-ci")} · {curName('LOC', d.local)}</div>
            <Ring parts={spentParts} fmt={(n) => money(n, 'LOC')} center={curName('LOC', d.local)} />
          </div>
          <div className="cty-card">
            <div className="cty-label">{t3('نفقات الجماعة شهراً بشهر', "The community's expenses month by month", 'Dépenses de la communauté mois par mois')} · {curName('LOC', d.local)}</div>
            <Columns cols={yearCols} fmt={(n) => `${money(n, 'LOC')} ${curName('LOC', d.local)}`} />
          </div>
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
              <th className="num">{t3('صُرف ≈ $', 'Spent ≈ $', 'Dépensé ≈ $')}</th>
              {CURS.map((c) => <th key={c} className="num">{t3('في الجيب', 'In pocket', 'En poche')} {curName(c, d.local)}</th>)}
              <th className="num">{t3('في الجيب ≈ $', 'In pocket ≈ $', 'En poche ≈ $')}</th>
              <th className="num">{t3('صُرف منذ أول السنة ≈ $', 'Spent this year ≈ $', 'Dépensé cette année ≈ $')}</th>
              <th>{t3('آخر قيد', 'Last entry', 'Dernière écriture')}</th>
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
                <td className="num">{totalUsd(neg(r.s.totalExpenses), rates).usd ? money(totalUsd(neg(r.s.totalExpenses), rates).usd, 'USD') : <span className="muted">-</span>}</td>
                {CURS.map((c) => <td key={c} className="num">{r.pocket[c] ? money(r.pocket[c], c) : <span className="muted">-</span>}</td>)}
                <td className="num"><b>{totalUsd(r.pocket, rates).usd ? money(totalUsd(r.pocket, rates).usd, 'USD') : <span className="muted">-</span>}</b></td>
                <td className="num">{totalUsd(neg(r.ySpent), rates).usd ? money(totalUsd(neg(r.ySpent), rates).usd, 'USD') : <span className="muted">-</span>}</td>
                <td className="small muted">{r.lastEntry ? dayName(r.lastEntry) : '—'}</td>
                <td className="small">{[r.unconfirmed ? '…' : '', r.disputed ? '⚠' : '', r.approvals ? '⏳' : ''].join(' ')}</td>
              </tr>
            ))}
            <tr className="fdc-total">
              <td colSpan={3}>{t3('مجموع الجماعة بالدولار', 'The whole community, in dollars', 'Toute la communauté, en dollars')}</td>
              <td className="num">{money(totalUsd(sum((r) => neg(r.s.totalExpenses)), rates).usd, 'USD')}</td>
              {CURS.map((c) => <td key={c} className="num">{money(rows.reduce((n, r) => n + r.pocket[c], 0), c)}</td>)}
              <td className="num">{money(totalUsd(sum((r) => r.pocket), rates).usd, 'USD')}</td>
              <td className="num">{money(totalUsd(sum((r) => neg(r.ySpent)), rates).usd, 'USD')}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
        <p className="muted small">{t3('كل العملات محوّلة إلى دولار بسعر آخر صرافة.', 'All currencies are converted to dollars at the rate of the last exchange.', 'Toutes les monnaies sont converties en dollars au taux du dernier change.')}{totalUsd(sum((r) => r.pocket), rates).missing ? ` ${t3('(اليورو دون سعر لا يُحسب)', '(euros with no rate are left out)', '(les euros sans taux sont exclus)')}` : ''}</p>
      </div>
    </>
  );
}

function BookCard({ b, end, onOpen }: { b: CtyBook; end: string; onOpen: () => void }) {
  const { d } = useCty();
  const group = accountBooks(d.books, b);
  const bal = balanceOf(d.entries, group, end);
  const curs: Cur[] = CURS.filter((c) => c === 'LOC' || bal[c] !== 0);
  return (
    <button className="cty-card desk-card click" onClick={onOpen} title={bookHelp(b.cty_kind)}>
      <div className="cty-label">{b.cty_kind === 'cash' ? (group.length > 1 ? t3('مال الجماعة (صندوق + مصرف)', "The community's money (cash + bank)", "L'argent de la communauté (caisse + banque)") : t3('صندوق الجماعة', "The community's cash", 'La caisse de la communauté')) : bookLabel(b)}</div>
      {curs.map((c) => <div key={c} className="desk-bal"><b>{money(bal[c], c)}</b> <span className="muted">{curName(c, d.local)}</span></div>)}
      {curs.length > 1 && <AllUsd m={bal} />}
      {group.length > 1 && <div className="small muted">{group.map((x) => `${x.cty_kind === 'bank' ? '🏦' : '💰'} ${money(balance(d.entries, x, end).LOC, 'LOC')}`).join(' · ')}</div>}
      <div className="small muted" style={{ marginTop: 4 }}>{b.cty_kind === 'cash' ? t3('ما يعطيه القيم للإخوة والبيت', 'what the econome gives to the brothers and the house', "ce que l'économe donne aux frères et à la maison") : b.cty_kind === 'economat' ? t3('عند خزينة الإقليم', 'with the Province treasury', 'auprès de la trésorerie de la Province') : ''}</div>
    </button>
  );
}

const nextMonth = (ym: string) => {
  const [y, mo] = ym.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
