// "My month": what is in my pocket, what came in and went out this month, by heading,
// what waits for me (money to confirm, a question of the Superior), and the entries.
import { useMemo, useState } from 'react';
import { promptBox, toast, errText, todayIso } from '../../ui/kit';
import { CURS, balance, lastDay, monthSheet, prevMonth, type CtyAccount, type CtyEntry, type Cur, type Money } from '../domain';
import { useCty, Card, bookName } from './CtyApp';
import { accName, curName, dayName, money, moneyCur, monthName, t3 } from './text';
import { CloseMonth } from './Close';

/** The heading of a line: the account just under its family (61402 → 61400). */
export function headingOf(accounts: CtyAccount[], id: number | null): CtyAccount | undefined {
  let a = accounts.find((x) => x.id === id);
  while (a) {
    const p = accounts.find((x) => x.id === a!.parent_id);
    if (!p || p.parent_id == null) return a;
    a = p;
  }
  return undefined;
}

/** The currencies worth showing for a book: the local one always, the others once used. */
export function usedCurs(entries: CtyEntry[], bookId: number, opening?: Money): Cur[] {
  return CURS.filter((c) => c === 'LOC' || (opening && opening[c]) || entries.some((e) => (e.book_id === bookId || e.to_book_id === bookId) && (e.cur === c || e.cur2 === c)));
}

export function MonthScreen() {
  const { d, book, s, reload, write } = useCty();
  const today = todayIso();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [closing, setClosing] = useState(false);
  const mine = (e: CtyEntry) => e.book_id === book.id || e.to_book_id === book.id;
  const sheet = useMemo(() => monthSheet(d.entries, book, ym), [d, book, ym]);
  const pocket = balance(d.entries, book, ym === today.slice(0, 7) ? today : lastDay(ym));
  const curs = usedCurs(d.entries, book.id, { LOC: book.opening_syp, USD: book.opening_usd, EUR: book.opening_eur });
  const closed = d.months.find((x) => x.book_id === book.id && x.ym === ym);
  const inMonth = d.entries.filter((e) => mine(e) && e.date.slice(0, 7) === ym).sort((a, b) => (b.date + (b.n ?? 0)).localeCompare(a.date + (a.n ?? 0)));

  // what waits for me
  const toConfirm = d.entries.filter((e) => e.type === 'Transfer' && e.to_book_id === book.id && !e.received_at && !e.disputed_at);
  const waitingApproval = d.entries.filter((e) => e.book_id === book.id && e.approval_needed && !e.approved_at);
  const unread = d.notes.filter((n) => n.book_id === book.id && !n.read_at && n.author_id !== s.profile.id);
  const last = prevMonth(today.slice(0, 7));
  const lastOpen = Number(today.slice(8, 10)) > 5 && !d.months.some((x) => x.book_id === book.id && x.ym === last) && d.entries.some((e) => mine(e) && e.date.slice(0, 7) <= last);

  // by heading, in each currency
  const byHeading = useMemo(() => {
    const out = new Map<number, Money>();
    for (const [id, v] of sheet.expenses) {
      const h = headingOf(d.accounts, id);
      if (!h) continue;
      const t = out.get(h.id) ?? { LOC: 0, USD: 0, EUR: 0 };
      for (const c of CURS) t[c] += -v[c];
      out.set(h.id, t);
    }
    return out;
  }, [sheet, d.accounts]);

  const answer = async (e: CtyEntry, ok: boolean) => {
    try {
      const note = ok ? null : await promptBox(t3('ماذا حدث؟', 'What happened?', "Que s'est-il passé ?"));
      if (!ok && !note) return;
      await s.api.call('cty.transfer.answer', { id: e.id, ok, note });
      await reload();
      toast(ok ? t3('شكراً، تمّ التأكيد', 'Thank you, confirmed', 'Merci, confirmé') : t3('أُرسلت الملاحظة', 'Note sent', 'Note envoyée'));
    } catch (x) {
      toast(errText(x), true);
    }
  };

  if (closing) return <CloseMonth ym={ym} onDone={() => setClosing(false)} />;

  const cur0: Cur = curs.length === 1 ? 'LOC' : (curs.reduce((best, c) => (-sheet.totalExpenses[c] > -sheet.totalExpenses[best] ? c : best), 'LOC' as Cur));
  const total0 = -sheet.totalExpenses[cur0];
  const headings = [...byHeading.entries()].filter(([, v]) => v[cur0] > 0).sort((a, b) => b[1][cur0] - a[1][cur0]);

  return (
    <>
      <div className="cty-monthnav">
        <button onClick={() => setYm(prevMonth(ym))} aria-label="previous">‹</button>
        <h1>{monthName(ym)}</h1>
        <button disabled={ym >= today.slice(0, 7)} onClick={() => setYm(nextMonth(ym))} aria-label="next">›</button>
      </div>

      {lastOpen && ym === today.slice(0, 7) && (
        <button className="cty-remind" onClick={() => { setYm(last); setClosing(true); }}>
          {t3(`لم يُغلق شهر ${monthName(last)} بعد: عُدَّ نقدك`, `${monthName(last)} is not closed yet: count your cash`, `${monthName(last)} n'est pas encore clôturé : comptez votre argent`)} ›
        </button>
      )}

      <Card className="cty-pocket">
        <div className="cty-label">{ym === today.slice(0, 7) ? t3('في جيبي الآن', 'In my pocket now', 'Dans ma poche') : t3('في آخر الشهر', 'At the end of the month', 'À la fin du mois')}</div>
        <div className="cty-pocket-row">
          {curs.map((c) => (
            <div key={c} className="cty-pocket-cur"><b>{money(pocket[c], c)}</b><span>{curName(c, d.local)}</span></div>
          ))}
        </div>
      </Card>

      {(toConfirm.length > 0 || unread.length > 0 || waitingApproval.length > 0) && (
        <Card className="cty-waiting">
          {toConfirm.map((e) => (
            <div key={e.id} className="cty-confirm">
              <div>{t3(`${bookName(d.books.find((b) => b.id === e.book_id))} أعطاك`, `${bookName(d.books.find((b) => b.id === e.book_id))} gave you`, `${bookName(d.books.find((b) => b.id === e.book_id))} vous a donné`)} <b>{moneyCur(e.amount, e.cur, d.local)}</b> · {dayName(e.date)}</div>
              <div className="row">
                <button className="btn primary" onClick={() => answer(e, true)}>✓ {t3('استلمت', 'Received', 'Reçu')}</button>
                <button className="btn ghost" onClick={() => answer(e, false)}>{t3('لم يصل', 'Not received', 'Pas reçu')}</button>
              </div>
            </div>
          ))}
          {unread.length > 0 && <UnreadLink n={unread.length} />}
          {waitingApproval.length > 0 && (
            <div className="muted small">⏳ {t3(`بانتظار موافقة الرئيس: ${waitingApproval.length}`, `Waiting for the Superior's approval: ${waitingApproval.length}`, `En attente de l'accord du Supérieur : ${waitingApproval.length}`)}</div>
          )}
        </Card>
      )}

      <div className="cty-two">
        <button className="cty-big out" onClick={() => write({ kind: 'Exp' })}>－ {t3('صرفتُ', 'I spent', "J'ai dépensé")}</button>
        <button className="cty-big in" onClick={() => write({ kind: 'Income' })}>＋ {t3('قبضتُ', 'I received', "J'ai reçu")}</button>
      </div>

      <Card>
        <div className="cty-inout">
          {curs.map((c) => (
            <div key={c}>
              <span className="muted small">{curName(c, d.local)}</span>
              <span className="in">＋{money(sheet.totalIncome[c] + sheet.received[c] + sheet.inByExchange[c], c)}</span>
              <span className="out">－{money(-(sheet.totalExpenses[c] + sheet.givenBack[c] + sheet.outByExchange[c]), c)}</span>
            </div>
          ))}
        </div>
        {headings.length > 0 && (
          <>
            <div className="cty-label" style={{ marginTop: 12 }}>{t3('أين ذهب المال', 'Where it went', "Où l'argent est allé")} · {curName(cur0, d.local)}</div>
            {headings.map(([id, v], i) => (
              <div key={id} className="cty-hbar">
                <div className="cty-hbar-text"><span>{accName(d.accounts.find((a) => a.id === id))}</span><b>{money(v[cur0], cur0)}</b></div>
                <div className="cty-hbar-track"><div style={{ width: `${Math.max(2, (v[cur0] / total0) * 100)}%`, background: SHADES[i % SHADES.length] }} /></div>
              </div>
            ))}
          </>
        )}
      </Card>

      <Card>
        <div className="cty-label">{t3('القيود', 'Entries', 'Écritures')}</div>
        {inMonth.length === 0 && <p className="muted">{t3('لا شيء بعد هذا الشهر.', 'Nothing yet this month.', 'Rien encore ce mois-ci.')}</p>}
        {inMonth.map((e) => <EntryRow key={e.id} e={e} />)}
      </Card>

      <Card>
        {closed ? (
          <div>
            ✓ {t3('الشهر مغلق', 'Month closed', 'Mois clôturé')} · {dayName(closed.closed_at.slice(0, 10))}
            {closed.seen_at && <span className="muted"> · {t3('اطّلع عليه الرئيس', 'seen by the Superior', 'vu par le Supérieur')} ✓</span>}
          </div>
        ) : (
          <button className="btn primary cty-wide" onClick={() => setClosing(true)}>{t3('إغلاق الشهر: عُدَّ نقدك', 'Close the month: count your cash', 'Clôturer le mois : comptez votre argent')}</button>
        )}
      </Card>
    </>
  );
}

const SHADES = ['#B8891B', '#5B191D', '#232D53', '#8A6A1A', '#2A6FB0', '#D2691E', '#6b7b4a', '#7a5c8f'];
const nextMonth = (ym: string) => {
  const [y, mo] = ym.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

function UnreadLink({ n }: { n: number }) {
  const { go } = useCty();
  return <button className="cty-link" onClick={() => go('notes')}>✉︎ {t3(`سؤال من الرئيس (${n})`, `A question from the Superior (${n})`, `Une question du Supérieur (${n})`)} ›</button>;
}

/** One entry of the month, as a line; a tap opens it to change or delete. */
export function EntryRow({ e }: { e: CtyEntry }) {
  const { d, book, write } = useCty();
  const acc = d.accounts.find((a) => a.id === e.account_id);
  const other = d.books.find((b) => b.id === (e.book_id === book.id ? e.to_book_id : e.book_id));
  let label: string;
  let sign: string;
  if (e.type === 'Exp') { label = accName(acc); sign = '−'; }
  else if (e.type === 'Income') { label = accName(acc); sign = '+'; }
  else if (e.type === 'Transfer') {
    const out = e.book_id === book.id;
    label = out ? t3(`إلى ${bookName(other)}`, `To ${bookName(other)}`, `À ${bookName(other)}`) : t3(`من ${bookName(other)}`, `From ${bookName(other)}`, `De ${bookName(other)}`);
    sign = out ? '−' : '+';
  } else { label = t3('صرافة', 'Exchange', 'Change'); sign = ''; }
  return (
    <button className="cty-entry" onClick={() => write({ kind: e.type, edit: e })}>
      <span className="cty-entry-day">{Number(e.date.slice(8, 10))}</span>
      <span className="cty-entry-text">
        {label}
        {e.note && <small>{e.note}</small>}
        <small className="cty-flags">
          {e.approval_needed && !e.approved_at ? `⏳ ${t3('بانتظار الرئيس', 'waits for the Superior', 'attend le Supérieur')} ` : ''}
          {e.claim ? `↺ ${t3('للمطالبة', 'to claim', 'à réclamer')} ` : ''}
          {e.type === 'Transfer' && !e.received_at && !e.disputed_at ? `… ${t3('لم يؤكَّد', 'not confirmed', 'non confirmé')} ` : ''}
          {e.disputed_at ? `⚠ ${t3('لم يصل', 'not received', 'pas reçu')}` : ''}
        </small>
      </span>
      <span className={`cty-entry-amt ${sign === '−' ? 'out' : sign === '+' ? 'in' : ''}`}>
        {e.type === 'Exchange' ? `${moneyCur(e.amount, e.cur, d.local)} → ${moneyCur(e.amount2 ?? 0, e.cur2!, d.local)}` : `${sign}${moneyCur(e.amount, e.cur, d.local)}`}
      </span>
    </button>
  );
}
