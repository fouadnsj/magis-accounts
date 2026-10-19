// "My month": first the money given to me (to confirm), then what I have now, what came in
// and went out this month, where it went (a ring with the % of each heading), what waits,
// the entries, and the closing of the period (the quarter, or the month).
import { useMemo, useState } from 'react';
import { promptBox, toast, errText, todayIso } from '../../ui/kit';
import { CURS, accountBooks, balance, balanceOf, lastDay, monthSheetOf, periodMonths, prevMonth, quarterOf, type CtyBook, type CtyAccount, type CtyEntry, type Cur, type Money } from '../domain';
import { useCty, Card, bookLabel, bookName, partLabel } from './CtyApp';
import { BOOK_ICON, iconOf } from './icons';
import { Ring } from './charts';
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
  const { d, book, s, reload, write, give, can } = useCty();
  const today = todayIso();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [closing, setClosing] = useState<string | null>(null);
  // one account: his pocket + his bank, or the house + its envelopes
  const group = useMemo(() => accountBooks(d.books, book), [d.books, book]);
  const ids = useMemo(() => new Set(group.map((b) => b.id)), [group]);
  const mine = (e: CtyEntry) => ids.has(e.book_id) || (e.to_book_id != null && ids.has(e.to_book_id));
  const sheet = useMemo(() => monthSheetOf(d.entries, group, ym), [d, group, ym]);
  const until = ym === today.slice(0, 7) ? today : lastDay(ym);
  const pocket = balanceOf(d.entries, group, until);
  const curs = usedCurs(d.entries, book.id, { LOC: book.opening_syp, USD: book.opening_usd, EUR: book.opening_eur });
  const quarterly = d.settings.closePeriod === 'quarter';
  const period = periodMonths(ym, d.settings.closePeriod);
  const periodEnd = period[period.length - 1];
  const closed = d.months.find((x) => x.book_id === book.id && x.ym === periodEnd);
  const inMonth = d.entries.filter((e) => mine(e) && e.date.slice(0, 7) === ym).sort((a, b) => (b.date + (b.n ?? 0)).localeCompare(a.date + (a.n ?? 0)));

  // what waits for me: money given to me, to confirm; money I gave, not yet confirmed
  const toConfirm = d.entries.filter((e) => e.type === 'Transfer' && e.to_book_id != null && ids.has(e.to_book_id) && !e.received_at && !e.disputed_at);
  // (the econome also sees what he gave from the cash or the bank)
  const giver = new Set([...ids, ...(can('cty.write_all') ? d.books.filter((b) => b.cty_kind === 'cash' || b.cty_kind === 'bank').map((b) => b.id) : [])]);
  const iGave = d.entries.filter((e) => e.type === 'Transfer' && giver.has(e.book_id) && !e.received_at && !e.disputed_at);
  const waitingApproval = d.entries.filter((e) => ids.has(e.book_id) && e.approval_needed && !e.approved_at);
  const unread = d.notes.filter((n) => ids.has(n.book_id) && !n.read_at && n.author_id !== s.profile.id);
  // the last period that ended and is not closed (reminder after the 5th of the next month)
  const lastPeriod = periodMonths(prevMonth(periodMonths(today.slice(0, 7), d.settings.closePeriod)[0]), d.settings.closePeriod);
  const lastEnd = lastPeriod[lastPeriod.length - 1];
  const lastOpen = Number(today.slice(8, 10)) > 5 && !d.months.some((x) => x.book_id === book.id && x.ym === lastEnd) && d.entries.some((e) => mine(e) && e.date.slice(0, 7) <= lastEnd);
  /** "T1 (Oct–Dec 2026)", short in every language */
  const periodName = (months: string[]) => (months.length > 1 ? `T${quarterOf(`${months[0]}-01`)} (${months[0].slice(5)}–${months[2].slice(5)}/${months[2].slice(0, 4)})` : monthName(months[0]));

  // where the money went, by heading
  const cur0: Cur = curs.length === 1 ? 'LOC' : curs.reduce((best, c) => (-sheet.totalExpenses[c] > -sheet.totalExpenses[best] ? c : best), 'LOC' as Cur);
  const parts = useMemo(() => {
    const out = new Map<number, number>();
    for (const [id, v] of sheet.expenses) {
      const h = headingOf(d.accounts, id);
      if (h) out.set(h.id, (out.get(h.id) ?? 0) - v[cur0]);
    }
    return [...out.entries()].map(([id, value]) => ({ key: id, label: `${iconOf(d.accounts.find((a) => a.id === id)?.code)} ${accName(d.accounts.find((a) => a.id === id))}`, value }));
  }, [sheet, d.accounts, cur0]);

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

  if (closing) return <CloseMonth ym={closing} onDone={() => setClosing(null)} />;
  const from = (e: CtyEntry) => bookName(d.books.find((b) => b.id === e.book_id));

  return (
    <>
      {/* 1 · money given to me: confirm it (the first thing on the screen) */}
      {toConfirm.length > 0 && (
        <section className="cty-money-in">
          <h3>💰 {t3('مال لك: هل استلمته؟', 'Money for you: did you receive it?', 'De l’argent pour vous : l’avez-vous reçu ?')}</h3>
          {toConfirm.map((e) => (
            <div key={e.id} className="cty-confirm">
              <div><span className="big">{moneyCur(e.amount, e.cur, d.local)}</span> · {t3('من', 'from', 'de')} {from(e)} · {dayName(e.date)}{e.note ? ` · ${e.note}` : ''}</div>
              <div className="row">
                <button className="btn primary" onClick={() => answer(e, true)}>✓ {t3('نعم، استلمته', 'Yes, I received it', 'Oui, je l’ai reçu')}</button>
                <button className="btn ghost" onClick={() => answer(e, false)}>{t3('لم يصلني', 'I did not receive it', 'Je ne l’ai pas reçu')}</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="cty-monthnav">
        <button onClick={() => setYm(prevMonth(ym))} aria-label="previous">‹</button>
        <h1>{monthName(ym)}</h1>
        <button disabled={ym >= today.slice(0, 7)} onClick={() => setYm(nextMonth(ym))} aria-label="next">›</button>
      </div>

      {lastOpen && ym === today.slice(0, 7) && (
        <button className="cty-remind" onClick={() => setClosing(lastEnd)}>
          {t3(`لم تُغلق ${periodName(lastPeriod)} بعد: عُدَّ نقدك`, `${periodName(lastPeriod)} is not closed yet: count your cash`, `${periodName(lastPeriod)} n'est pas encore clôturé : comptez votre argent`)} ›
        </button>
      )}

      <Card className="cty-pocket">
        <div className="cty-label">{ym === today.slice(0, 7) ? t3('معي الآن', 'I have now', "J'ai maintenant") : t3('في آخر الشهر', 'At the end of the month', 'À la fin du mois')} · {bookLabel(book)}</div>
        <div className="cty-pocket-row">
          {curs.map((c) => (
            <div key={c} className="cty-pocket-cur"><b>{money(pocket[c], c)}</b><span>{curName(c, d.local)}</span></div>
          ))}
        </div>
        {group.length > 1 && (
          <div className="cty-parts">
            {group.map((b) => {
              const bal = balance(d.entries, b, until);
              return <span key={b.id}>{BOOK_ICON[b.cty_kind ?? ''] ?? ''} {partLabel(b)} <b>{curs.filter((c) => bal[c] || c === 'LOC').map((c) => money(bal[c], c)).join(' / ')}</b></span>;
            })}
          </div>
        )}
      </Card>

      {/* the four things a person does, as in MAGIS Accounts */}
      <div className="cty-four">
        <button className="out" onClick={() => write({ kind: 'Exp' })}><i>－</i>{t3('صرفتُ', 'I spent', "J'ai dépensé")}</button>
        <button className="in" onClick={() => write({ kind: 'Income' })}><i>＋</i>{t3('قبضتُ', 'I received', "J'ai reçu")}</button>
        <button className="exc" onClick={() => write({ kind: 'Exchange' })}><i>⇄</i>{t3('صرافة', 'Exchange', 'Change')}</button>
        <button className="trf" onClick={() => write({ kind: 'Transfer' })}><i>↔</i>{t3('تحويل', 'Transfer', 'Transfert')}</button>
      </div>
      {book.cty_kind === 'house' && <Envelopes group={group} until={until} curs={curs} />}
      {can('cty.write_all') && <button className="cty-give" onClick={give}>💰 {t3('إعطاء مال لأحد الإخوة أو للبيت', 'Give money to a Jesuit or to the house', "Donner de l'argent à un jésuite ou à la maison")}</button>}

      {(iGave.length > 0 || unread.length > 0 || waitingApproval.length > 0) && (
        <Card className="cty-waiting">
          {iGave.map((e) => (
            <div key={e.id} className="muted small">… {t3(`أعطيت ${bookName(d.books.find((b) => b.id === e.to_book_id))} ${moneyCur(e.amount, e.cur, d.local)}: لم يؤكّد بعد`, `You gave ${bookName(d.books.find((b) => b.id === e.to_book_id))} ${moneyCur(e.amount, e.cur, d.local)}: not confirmed yet`, `Vous avez donné ${moneyCur(e.amount, e.cur, d.local)} à ${bookName(d.books.find((b) => b.id === e.to_book_id))} : pas encore confirmé`)}</div>
          ))}
          {unread.length > 0 && <UnreadLink n={unread.length} />}
          {waitingApproval.length > 0 && (
            <div className="muted small">⏳ {t3(`بانتظار موافقة الرئيس: ${waitingApproval.length}`, `Waiting for the Superior's approval: ${waitingApproval.length}`, `En attente de l'accord du Supérieur : ${waitingApproval.length}`)}</div>
          )}
        </Card>
      )}

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
        {parts.some((p) => p.value > 0) && (
          <>
            <div className="cty-label" style={{ marginTop: 12 }}>{t3('أين ذهب المال', 'Where it went', "Où l'argent est allé")} · {curName(cur0, d.local)}</div>
            <Ring parts={parts} fmt={(n) => money(n, cur0)} center={curName(cur0, d.local)} />
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
            ✓ {quarterly ? t3('الفصل مغلق', 'Quarter closed', 'Trimestre clôturé') : t3('الشهر مغلق', 'Month closed', 'Mois clôturé')} · {dayName(closed.closed_at.slice(0, 10))}
            {closed.seen_at && <span className="muted"> · {t3('اطّلع عليه الرئيس', 'seen by the Superior', 'vu par le Supérieur')} ✓</span>}
          </div>
        ) : (
          <button className="btn primary cty-wide" onClick={() => setClosing(periodEnd)}>
            {quarterly ? t3('إغلاق الفصل: عُدَّ نقدك', 'Close the quarter: count your cash', 'Clôturer le trimestre : comptez votre argent') : t3('إغلاق الشهر: عُدَّ نقدك', 'Close the month: count your cash', 'Clôturer le mois : comptez votre argent')}
            {quarterly && <small style={{ display: 'block', opacity: 0.8 }}>{periodName(period)}</small>}
          </button>
        )}
      </Card>
    </>
  );
}

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
  const ids = new Set(accountBooks(d.books, book).map((b) => b.id));
  const acc = d.accounts.find((a) => a.id === e.account_id);
  const mine = ids.has(e.book_id);
  const inner = e.type === 'Transfer' && mine && e.to_book_id != null && ids.has(e.to_book_id);
  const fromBook = d.books.find((b) => b.id === e.book_id);
  const toBook = d.books.find((b) => b.id === e.to_book_id);
  const other = mine ? toBook : fromBook;
  const part = ids.size > 1 && fromBook && (e.type === 'Exp' || e.type === 'Income' || e.type === 'Exchange') ? ` · ${BOOK_ICON[fromBook.cty_kind ?? ''] ?? ''}${partLabel(fromBook)}` : '';
  let label: string;
  let sign: string;
  if (e.type === 'Exp') { label = `${iconOf(acc?.code)} ${accName(acc)}${part}`; sign = '−'; }
  else if (e.type === 'Income') { label = `${iconOf(acc?.code)} ${accName(acc)}${part}`; sign = '+'; }
  else if (e.type === 'Transfer') {
    if (inner) { label = `↔ ${partLabel(fromBook!)} → ${partLabel(toBook!)}`; sign = ''; }
    else { label = mine ? t3(`إلى ${bookName(other)}`, `To ${bookName(other)}`, `À ${bookName(other)}`) : t3(`من ${bookName(other)}`, `From ${bookName(other)}`, `De ${bookName(other)}`); sign = mine ? '−' : '+'; }
  } else { label = `⇄ ${t3('صرافة', 'Exchange', 'Change')}${part}`; sign = ''; }
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

/** The minister's envelopes (cook, steward, cleaner…): what each holds, give to one, put back, a new one. */
function Envelopes({ group, until, curs }: { group: CtyBook[]; until: string; curs: Cur[] }) {
  const { d, s, reload, write } = useCty();
  const envs = group.filter((b) => b.cty_kind === 'envelope');
  const house = group[0];
  const add = async () => {
    const name = await promptBox(t3('اسم الظرف (مثلاً: الطباخ، البوّاب، عاملة التنظيف)', 'Name of the envelope (e.g. Cook, Steward, Cleaner)', 'Nom de l’enveloppe (p. ex. Cuisinier, Intendant, Femme de ménage)'));
    if (!name) return;
    try {
      await s.api.call('cty.envelope.save', { name });
      await reload();
    } catch (e) { toast(errText(e), true); }
  };
  const rename = async (b: CtyBook, active = 1) => {
    const name = active ? await promptBox(t3('الاسم', 'Name', 'Nom'), b.name) : b.name;
    if (!name) return;
    try { await s.api.call('cty.envelope.save', { id: b.id, name, active }); await reload(); } catch (e) { toast(errText(e), true); }
  };
  return (
    <Card>
      <div className="cty-label">✉️ {t3('أظرفة البيت', 'Envelopes of the house', 'Enveloppes de la maison')}</div>
      {envs.length === 0 && <p className="muted small">{t3('أظرفة لمن تعطيهم مالاً: الطباخ، البوّاب، عاملة التنظيف… تعطي الظرف مالاً، وتسجّل ما صُرف منه، وتُعيد الباقي.', 'Envelopes for those you give money to: the cook, the steward, the cleaner… You give an envelope some money, record what is spent from it, and put back what is left.', 'Des enveloppes pour ceux à qui vous donnez de l’argent : le cuisinier, l’intendant, la femme de ménage… Vous donnez de l’argent à l’enveloppe, notez ce qui en est dépensé, et remettez le reste.')}</p>}
      {envs.map((b) => {
        const bal = balance(d.entries, b, until);
        return (
          <div key={b.id} className="cty-env">
            <div><b>✉️ {b.name}</b><div className="muted small">{curs.filter((c) => bal[c] || c === 'LOC').map((c) => `${money(bal[c], c)} ${curName(c, d.local)}`).join(' · ')}</div></div>
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button className="btn" onClick={() => write({ kind: 'Transfer', bookId: house.id, toBookId: b.id })}>＋ {t3('أعطِ', 'Give', 'Donner')}</button>
              <button className="btn" onClick={() => write({ kind: 'Exp', bookId: b.id })}>－ {t3('صُرف', 'Spent', 'Dépensé')}</button>
              <button className="btn ghost" onClick={() => write({ kind: 'Transfer', bookId: b.id, toBookId: house.id })}>↩</button>
              <button className="cty-link" onClick={() => rename(b)} aria-label="rename">✎</button>
            </div>
          </div>
        );
      })}
      <button className="btn cty-wide" onClick={add}>＋ {t3('ظرف جديد', 'A new envelope', 'Une nouvelle enveloppe')}</button>
    </Card>
  );
}
