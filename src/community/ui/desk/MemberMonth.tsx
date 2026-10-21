// One member's month (or the house's), laid out as the Comptapro FDC: cash at the
// start, income, expenses by heading and line with their codes, given back, kept;
// in three currencies. The closing (what was counted) and, for the Superior,
// "seen ✓" and a private question.
import { useMemo, useState } from 'react';
import { errText, promptBox, toast, todayIso } from '../../../ui/kit';
import { CURS, accountBooks, monthSheetOf, prevMonth, rollUp, type CtyAccount, type Money } from '../../domain';
import { useCty, bookLabel, bookName } from '../CtyApp';
import { Thread } from '../Notes';
import { CountHistory } from '../CountHistory';
import { accName, curName, money, monthName, t3 } from '../text';
import { exportExcel } from './excel';

export function MemberMonth({ initialBook, initialYm }: { initialBook: number | null; initialYm?: string }) {
  const { d, s, reload, can } = useCty();
  const today = todayIso();
  const people = d.books.filter((b) => b.active && (b.cty_kind === 'personal' || b.cty_kind === 'house'));
  const [bookId, setBookId] = useState<number>(initialBook ?? people[0]?.id);
  const [ym, setYm] = useState(initialYm ?? today.slice(0, 7));
  const book = d.books.find((b) => b.id === bookId) ?? people[0];
  const sheet = useMemo(() => (book ? monthSheetOf(d.entries, accountBooks(d.books, book), ym) : null), [d.entries, book, ym]);
  const closed = d.months.find((x) => x.book_id === book?.id && x.ym === ym);
  const notes = d.notes.filter((n) => n.book_id === book?.id && !n.parent_id && (n.ym === ym || d.entries.find((e) => e.id === n.entry_id)?.date.slice(0, 7) === ym));
  if (!book || !sheet) return <p className="muted">{t3('لا أعضاء.', 'No members.', 'Aucun membre.')}</p>;

  const lines = (map: Map<number, Money>, sign: 1 | -1) => {
    const up = rollUp(d.accounts, map);
    // headings (with their lines), in the order of the chart
    const heads = d.accounts.filter((a) => up.has(a.id) && a.parent_id != null && d.accounts.find((p) => p.id === a.parent_id)?.parent_id == null);
    return heads.map((h) => ({ h, total: up.get(h.id)!, lines: d.accounts.filter((a) => map.has(a.id) && a.id !== h.id && isUnder(d.accounts, a, h.id)).map((a) => ({ a, v: map.get(a.id)! })) }))
      .map((g) => ({ ...g, sign }));
  };
  const income = lines(sheet.income, 1);
  const expenses = lines(sheet.expenses, -1);

  const seen = async () => {
    try {
      await s.api.call('cty.month.seen', { bookId: book.id, ym });
      await reload();
      toast(t3('اطّلعت ✓', 'Seen ✓', 'Vu ✓'));
    } catch (e) { toast(errText(e), true); }
  };
  const ask = async () => {
    const body = await promptBox(t3('سؤالك (خاص، لصاحب الدفتر فقط)', 'Your question (private, for the keeper of the book only)', 'Votre question (privée, pour le titulaire seulement)'));
    if (!body) return;
    try {
      await s.api.call('cty.note.add', { bookId: book.id, ym, body });
      await reload();
    } catch (e) { toast(errText(e), true); }
  };
  const reopen = async () => {
    const reason = await promptBox(t3('سبب إعادة فتح الشهر؟', 'Why reopen the month?', 'Pourquoi rouvrir le mois ?'));
    if (!reason) return;
    try {
      await s.api.call('cty.month.reopen', { bookId: book.id, ym, reason });
      await reload();
    } catch (e) { toast(errText(e), true); }
  };

  const Row = ({ label, v, cls, code }: { label: string; v: Money; cls?: string; code?: string }) => (
    <tr className={cls}>
      <td className="muted small">{code}</td><td>{label}</td>
      {CURS.map((c) => <td key={c} className="num">{v[c] ? money(v[c], c) : ''}</td>)}
    </tr>
  );

  const exportIt = async () => {
    const rows: (string | number | null)[][] = [];
    const add = (code: string, label: string, v: Money) => rows.push([code, label, ...CURS.map((c) => v[c] || null)]);
    add('', t3('من الشهر الماضي', 'Carried over', 'Report du mois précédent'), sheet.carried);
    add('', t3('من القيم', 'Received from the econome', "Reçu de l'économe"), sheet.received);
    add('', t3('دخل بالصرافة', 'In by exchange', 'Entré par change'), sheet.inByExchange);
    for (const g of income) for (const l of g.lines.length ? g.lines : [{ a: g.h, v: g.total }]) add(l.a.code, accName(l.a), l.v);
    add('', t3('مجموع الدخل', 'Total income', 'Total revenus'), sheet.totalIncome);
    for (const g of expenses) for (const l of g.lines.length ? g.lines : [{ a: g.h, v: g.total }]) add(l.a.code, accName(l.a), l.v);
    add('', t3('مجموع النفقات', 'Total expenses', 'Total dépenses'), sheet.totalExpenses);
    add('', t3('أعاده إلى القيم', 'Given back to the econome', "Rendu à l'économe"), sheet.givenBack);
    add('', t3('خرج بالصرافة', 'Out by exchange', 'Sorti par change'), sheet.outByExchange);
    add('', t3('في آخر الشهر', 'Kept at the end of the month', 'Gardé en fin de mois'), sheet.kept);
    try {
      await exportExcel(`FDC-${bookName(book)}-${ym}.xlsx`, [{ name: `${ym}`, header: [t3('الرمز', 'Code', 'Code'), bookName(book), ...CURS.map((c) => curName(c, d.local))], rows, money: [2, 3, 4] }]);
    } catch (e) { toast(errText(e), true); }
  };

  return (
    <>
      <div className="desk-head">
        <h1>{book.cty_kind === 'house' ? bookLabel(book) : bookName(book)} · {monthName(ym)}</h1>
        <div className="row">
          <button className="btn" onClick={exportIt}>Excel</button>
          <button className="btn" onClick={() => window.print()}>{t3('طباعة', 'Print', 'Imprimer')}</button>
        </div>
      </div>
      <div className="desk-filters">
        <select value={book.id} onChange={(e) => setBookId(Number(e.target.value))}>
          {people.map((b) => <option key={b.id} value={b.id}>{b.cty_kind === 'house' ? bookLabel(b) : bookName(b)}</option>)}
        </select>
        <button className="btn" onClick={() => setYm(prevMonth(ym))}>‹</button>
        <span>{monthName(ym)}</span>
        <button className="btn" disabled={ym >= today.slice(0, 7)} onClick={() => setYm(nextOf(ym))}>›</button>
      </div>
      <div className="desk-two">
        <div className="cty-card">
          <table className="desk-table fdc">
            <thead><tr><th /><th /><th className="num">{curName('LOC', d.local)}</th><th className="num">$</th><th className="num">€</th></tr></thead>
            <tbody>
              <Row label={t3('من الشهر الماضي', 'Carried over', 'Report du mois précédent')} v={sheet.carried} />
              <Row label={t3('من القيم', 'Received from the econome', "Reçu de l'économe")} v={sheet.received} />
              <Row label={t3('دخل بالصرافة', 'In by exchange', 'Entré par change')} v={sheet.inByExchange} />
              <tr className="fdc-part"><td colSpan={5}>{t3('الدخل', 'Income', 'Revenus')}</td></tr>
              {income.map((g) => g.lines.length ? g.lines.map((l) => <Row key={l.a.id} code={l.a.code} label={accName(l.a)} v={l.v} />) : <Row key={g.h.id} code={g.h.code} label={accName(g.h)} v={g.total} />)}
              <Row label={t3('مجموع الدخل', 'Total income', 'Total revenus')} v={sheet.totalIncome} cls="fdc-total" />
              <tr className="fdc-part"><td colSpan={5}>{t3('النفقات', 'Expenses', 'Dépenses')}</td></tr>
              {expenses.map((g) => (
                <FragmentRows key={g.h.id}>
                  <Row code={g.h.code} label={accName(g.h)} v={g.total} cls="fdc-head" />
                  {g.lines.map((l) => <Row key={l.a.id} code={l.a.code} label={`  ${accName(l.a)}`} v={l.v} cls="fdc-line" />)}
                </FragmentRows>
              ))}
              <Row label={t3('مجموع النفقات', 'Total expenses', 'Total dépenses')} v={sheet.totalExpenses} cls="fdc-total" />
              <Row label={t3('أعاده إلى القيم', 'Given back to the econome', "Rendu à l'économe")} v={sheet.givenBack} />
              <Row label={t3('خرج بالصرافة', 'Out by exchange', 'Sorti par change')} v={sheet.outByExchange} />
              <Row label={t3('في آخر الشهر', 'Kept at the end of the month', 'Gardé en fin de mois')} v={sheet.kept} cls="fdc-total" />
            </tbody>
          </table>
        </div>
        <div>
          <div className="cty-card">
            <div className="cty-label">{t3('الإغلاق', 'Closing', 'Clôture')}</div>
            {closed ? (
              <>
                <div>✓ {t3('أغلقه', 'Closed by', 'Clôturé par')} {closed.closed_by} · {closed.closed_at.slice(0, 10)}</div>
                <table className="desk-table small">
                  <tbody>
                    <tr><td>{t3('الدفتر', 'Book', 'Compte')}</td>{CURS.map((c) => <td key={c} className="num">{money((closed as unknown as Record<string, number>)[`book_${c.toLowerCase()}`] ?? 0, c)}</td>)}</tr>
                    <tr><td>{t3('المعدود', 'Counted', 'Compté')}</td>{CURS.map((c) => <td key={c} className="num">{money((closed as unknown as Record<string, number>)[`counted_${c.toLowerCase()}`] ?? 0, c)}</td>)}</tr>
                  </tbody>
                </table>
                {closed.count_note && <blockquote className="cty-quote">{closed.count_note}</blockquote>}
                <div style={{ marginTop: 8 }}>{closed.seen_at ? <>✓ {t3('اطّلع عليه', 'Seen by', 'Vu par')} {closed.seen_by}</> : <span className="muted">{t3('لم يطّلع عليه الرئيس بعد', 'Not yet seen by the Superior', 'Pas encore vu par le Supérieur')}</span>}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  {can('cty.month_seen') && !closed.seen_at && <button className="btn primary" onClick={seen}>✓ {t3('اطّلعت', 'Seen', 'Vu')}</button>}
                  {can('month.reopen') && <button className="btn ghost" onClick={reopen}>{t3('إعادة فتح…', 'Reopen…', 'Rouvrir…')}</button>}
                </div>
              </>
            ) : <p className="muted">{t3('لم يُغلق بعد.', 'Not closed yet.', 'Pas encore clôturé.')}</p>}
          </div>
          <CountHistory key={book.id} bookId={book.id} />
          {can('cty.month_seen') && (
            <div className="cty-card">
              <div className="cty-label">🔒 {t3('أسئلة الرئيس (خاصة)', "The Superior's questions (private)", 'Questions du Supérieur (privées)')}</div>
              {notes.map((n) => <Thread key={n.id} root={n} compact />)}
              <button className="btn" onClick={ask}>? {t3('سؤال', 'Ask a question', 'Poser une question')}</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
const isUnder = (all: CtyAccount[], a: CtyAccount, headId: number): boolean => {
  for (let p = a.parent_id; p != null; p = all.find((x) => x.id === p)?.parent_id ?? null) if (p === headId) return true;
  return false;
};
const nextOf = (ym: string) => {
  const [y, mo] = ym.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
