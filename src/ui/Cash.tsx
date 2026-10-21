// Holders sheet: what each holder should hold, the note-by-note count, the difference.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp, type Data } from '../state';
import { holders, holdersMonth, monthsOf, type HolderLine, type HolderMonthLine } from '../domain/reports';
import { MONTHS_AR, MONTHS_EN } from '../domain/types';
import { monthWord } from '../i18n';
import type { CashCountLog } from '../ops';
import { Field, Modal, Seg, confirmBox, errText, fmtDate, fmtSyp, fmtUsd, parseAmount, t, toast, todayIso } from './kit';

export const NOTES = { SYP: [10000, 5000, 2000, 1000, 500, 200, 100, 50], USD: [100, 50, 20, 10, 5, 2, 1] };

type Counts = Record<number, { SYP: Map<number, number>; USD: Map<number, number>; at: string | null }>;

/** A holder's own balance. On the server the office's transfers are in the register.
 *  With files, the office books the transfers elsewhere, so the holder uses what he noted as received. */
export function holderBalance(d: Data, bookId: number, fileHolder: boolean) {
  const book = d.lists.books.find((b) => b.id === bookId)!;
  const mk = (cur: 'SYP' | 'USD') => {
    const [line] = holders(d.rows, [book], cur);
    if (!fileHolder) return line;
    const received = d.receipts.reduce((a, r) => a + (cur === 'SYP' ? r.amount_syp : r.amount_usd), 0);
    return { ...line, transfers: received, shouldHold: line.shouldHold - line.transfers + received };
  };
  return { syp: mk('SYP'), usd: mk('USD') };
}

export function Cash() {
  const { s, d, can, myBooks } = useApp();
  const [myBook, setMyBook] = useState<number | null>(myBooks[0] ?? null);
  const [counts, setCounts] = useState<Counts>({});
  const [counting, setCounting] = useState<number | null>(null);
  const months = monthsOf(d.rows);
  const [view, setView] = useState<CashView>('total');
  const [ym, setYm] = useState(months[months.length - 1] ?? todayIso().slice(0, 7));
  const bookChoices = d.shownBooks.filter((b) => b.active || d.rows.some((r) => r.book_id === b.id)).map((b) => ({ id: b.id, name: b.name }));
  const [bookSel, setBookSel] = useState<number | null>(bookChoices.find((b) => !d.lists.books.find((x) => x.id === b.id)?.is_main)?.id ?? bookChoices[0]?.id ?? null);

  const loadCounts = useCallback(async () => {
    const rows = await s.api.call('cash.counts');
    const c: Counts = {};
    for (const r of rows) {
      c[r.book_id] ??= { SYP: new Map(), USD: new Map(), at: null };
      c[r.book_id][r.currency].set(r.denomination, r.qty);
      if (r.counted_at && (!c[r.book_id].at || r.counted_at > c[r.book_id].at!)) c[r.book_id].at = r.counted_at;
    }
    setCounts(c);
  }, [s.api]);
  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  const counted = (bookId: number, cur: 'SYP' | 'USD') => {
    const m = counts[bookId]?.[cur];
    if (!m || !m.size) return null;
    let x = 0;
    for (const [den, q] of m) x += den * q;
    return x;
  };

  if (!can('reports.cash') && myBook != null) return <HolderCash bookId={myBook} switchTo={myBooks.length > 1 ? setMyBook : null} counted={counted} counts={counts} onCount={() => setCounting(myBook)} counting={counting} setCounting={setCounting} reloadCounts={loadCounts} />;

  const syp = holders(d.rows, d.shownBooks, 'SYP');
  const usd = holders(d.rows, d.shownBooks, 'USD');

  const table = (lines: HolderLine[], cur: 'SYP' | 'USD') => {
    const f = cur === 'SYP' ? fmtSyp : fmtUsd;
    const tol = cur === 'SYP' ? 1 : 0.01;
    const visible = lines.filter((l) => !l.book || l.book.active || l.shouldHold !== 0);
    const total = (k: keyof HolderLine) => visible.reduce((a, l) => a + (l[k] as number), 0);
    const totCounted = visible.reduce((a, l) => a + (l.book ? counted(l.book.id, cur) ?? 0 : 0), 0);
    return (
      <div className="tbl-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>{t('الصندوق', 'Holder')}</th><th className="n">{t('افتتاحي', 'Opening')}</th><th className="n">＋ {t('إيرادات', 'Income')}</th>
              <th className="n">− {t('نفقات', 'Expenses')}</th><th className="n">± {t('تحويلات', 'Transfers')}</th>
              <th className="n">{cur === 'SYP' ? `＋ ${t('تصريف داخل', 'Exchange in')}` : `− ${t('تصريف خارج', 'Exchange out')}`}</th>
              <th className="n">= {t('يجب أن يحمل', 'Should hold')}</th><th className="n">{t('المعدود', 'Counted')}</th><th className="n">{t('الفرق', 'Difference')}</th><th />
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => {
              const c = l.book ? counted(l.book.id, cur) : null;
              const diff = c == null ? null : c - l.shouldHold;
              return (
                <tr key={l.book?.id ?? 'none'}>
                  <td>{l.book ? <>{l.book.name}{l.book.keeper_name ? <span className="muted small"> · {l.book.keeper_name}</span> : null}</> : <span className="muted">{t('بلا دفتر — يجب أن يكون صفراً', 'No book written — must be nil')}</span>}</td>
                  <td className="n">{f(l.opening)}</td><td className="n">{f(l.income)}</td><td className="n">{f(l.expenses)}</td><td className="n">{f(l.transfers)}</td>
                  <td className="n">{f(l.exchange)}</td><td className="n"><b>{f(l.shouldHold)}</b></td>
                  <td className="n">{c == null ? <span className="muted">—</span> : f(c)}</td>
                  <td className="n">{diff == null ? '' : Math.abs(diff) < tol ? <span className="ok">✓</span> : <span className="bad">{f(diff)}</span>}</td>
                  <td>{l.book && <button className="btn small" onClick={() => setCounting(l.book!.id)}>{t('عدّ', 'Count')}</button>}
                    {!l.book && (Math.abs(l.shouldHold) < tol ? <span className="ok">✓</span> : <span className="bad">✗</span>)}</td>
                </tr>
              );
            })}
            <tr className="total">
              <td>{t('المجموع', 'Total')}</td><td className="n">{f(total('opening'))}</td><td className="n">{f(total('income'))}</td><td className="n">{f(total('expenses'))}</td>
              <td className="n">{f(total('transfers'))} {Math.abs(total('transfers')) < tol ? <span className="ok">✓</span> : <span className="bad">✗</span>}</td>
              <td className="n">{f(total('exchange'))}</td><td className="n">{f(total('shouldHold'))}</td><td className="n">{f(totCounted)}</td><td /><td />
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <h1>{t('النقد · وضع الصناديق', "Cash · holders' position")}</h1>
        <CashViewPicker view={view} setView={setView} ym={ym} setYm={setYm} months={months} book={bookSel} setBook={setBookSel} books={bookChoices} />
      </div>
      {view === 'total' && (
        <>
          <CurrencyFrame cur="SYP">{table(syp, 'SYP')}</CurrencyFrame>
          <CurrencyFrame cur="USD">{table(usd, 'USD')}</CurrencyFrame>
        </>
      )}
      {view === 'month' && (
        <>
          <CurrencyFrame cur="SYP"><MonthTable lines={holdersMonth(d.rows, d.shownBooks, 'SYP', ym)} cur="SYP" /></CurrencyFrame>
          <CurrencyFrame cur="USD"><MonthTable lines={holdersMonth(d.rows, d.shownBooks, 'USD', ym)} cur="USD" /></CurrencyFrame>
        </>
      )}
      {view === 'book' && bookSel != null && <BookMonths bookId={bookSel} stamp={counts[bookSel]?.at} />}
      <p className="muted small">
        {t('التحويلات يجب أن يكون مجموعها صفراً: ما خرج من الرئيسي وصل إلى دفتر. التصريف يُحسب للحامل فقط، ليس إيراداً ولا نفقة.',
          "Transfers must total nil: whatever left Main arrived in someone's book. An exchange counts for the holder only — it is neither income nor expense.")}
      </p>
      {counting != null && <CountModal bookId={counting} counts={counts} onClose={() => setCounting(null)} onSaved={loadCounts} />}
    </>
  );
}

// ---------------------------------------------------------------- views: total, one month, one book month by month

export type CashView = 'total' | 'month' | 'book';

function CashViewPicker({ view, setView, ym, setYm, months, book, setBook, books }: {
  view: CashView; setView: (v: CashView) => void; ym: string; setYm: (m: string) => void; months: string[];
  book: number | null; setBook: (b: number) => void; books: { id: number; name: string }[];
}) {
  return (
    <div className="row">
      <Seg<CashView> value={view} onChange={setView} options={[
        { value: 'total', label: t('المجموع', 'Total') },
        { value: 'month', label: t('شهر', 'One month') },
        ...(books.length ? [{ value: 'book' as CashView, label: t('شهراً بشهر', 'Month by month') }] : []),
      ]} />
      {view === 'month' && (
        <select className="inp" style={{ width: 'auto' }} value={ym} onChange={(e) => setYm(e.target.value)}>
          {[...months].reverse().map((x) => <option key={x} value={x}>{monthLabel(x)}</option>)}
        </select>
      )}
      {view === 'book' && books.length > 1 && (
        <select className="inp" style={{ width: 'auto' }} value={book ?? ''} onChange={(e) => setBook(Number(e.target.value))}>
          {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
    </div>
  );
}

const monthLabel = (ym: string) => {
  const m = Number(ym.slice(5, 7)) - 1;
  return `${monthWord(m, MONTHS_AR, MONTHS_EN)} ${ym.slice(0, 4)}`;
};

/** One frame per currency, so pounds and dollars are never mixed. */
export function CurrencyFrame({ cur, children, extra }: { cur: 'SYP' | 'USD'; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className={`panel cur-frame ${cur}`}>
      <div className="cur-head">
        <span className="cur-chip">{cur}</span>
        <h2>{cur === 'SYP' ? t('ليرة سورية', 'Syrian pounds') : t('دولار أمريكي', 'US dollars')}</h2>
        {extra}
      </div>
      {children}
    </div>
  );
}

function MonthTable({ lines, cur }: { lines: HolderMonthLine[]; cur: 'SYP' | 'USD' }) {
  const f = cur === 'SYP' ? fmtSyp : fmtUsd;
  const visible = lines.filter((l) => l.book && (l.start || l.income || l.expenses || l.transfers || l.exchange || l.end));
  const sum = (k: keyof HolderMonthLine) => visible.reduce((a, l) => a + (l[k] as number), 0);
  return (
    <div className="tbl-wrap">
      <table className="t">
        <thead><tr>
          <th>{t('الصندوق', 'Holder')}</th><th className="n">{t('في أول الشهر', 'At the start')}</th><th className="n">＋ {t('إيرادات', 'Income')}</th>
          <th className="n">− {t('نفقات', 'Expenses')}</th><th className="n">± {t('تحويلات', 'Transfers')}</th><th className="n">± {t('تصريف', 'Exchange')}</th>
          <th className="n">= {t('في آخر الشهر', 'At the end')}</th>
        </tr></thead>
        <tbody>
          {visible.map((l) => (
            <tr key={l.book!.id}>
              <td>{l.book!.name}</td><td className="n">{f(l.start)}</td><td className="n">{f(l.income)}</td><td className="n">{f(l.expenses)}</td>
              <td className="n">{f(l.transfers)}</td><td className="n">{f(l.exchange)}</td><td className="n"><b>{f(l.end)}</b></td>
            </tr>
          ))}
          <tr className="total"><td>{t('المجموع', 'Total')}</td><td className="n">{f(sum('start'))}</td><td className="n">{f(sum('income'))}</td><td className="n">{f(sum('expenses'))}</td>
            <td className="n">{f(sum('transfers'))}</td><td className="n">{f(sum('exchange'))}</td><td className="n">{f(sum('end'))}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

/** One book, month by month: each month starts where the previous one ended. */
export function BookMonths({ bookId, stamp }: { bookId: number; /** changes when a count is saved, to reload the history */ stamp?: string | null }) {
  const { d } = useApp();
  const [shown, setShown] = useState<CountInfo | null>(null);
  const book = d.lists.books.find((b) => b.id === bookId);
  const months = monthsOf(d.rows.filter((r) => r.book_id === bookId || (book?.is_main && r.type === 'Transfer')));
  if (!book) return null;
  const one = (cur: 'SYP' | 'USD') => months.map((ym) => ({ ym, ...holdersMonth(d.rows, [book], cur, ym)[0] }));
  const block = (cur: 'SYP' | 'USD') => {
    const f = cur === 'SYP' ? fmtSyp : fmtUsd;
    const ls = one(cur);
    return (
      <CurrencyFrame cur={cur} extra={<span className="muted small">· {book.name}</span>}>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr>
              <th>{t('الشهر', 'Month')}</th><th className="n">{t('في أول الشهر', 'At the start')}</th><th className="n">＋ {t('إيرادات', 'Income')}</th>
              <th className="n">− {t('نفقات', 'Expenses')}</th><th className="n">± {t('تحويلات', 'Transfers')}</th><th className="n">± {t('تصريف', 'Exchange')}</th>
              <th className="n">= {t('في آخر الشهر', 'At the end')}</th>
              <th className="n">🧮 {t('المعدود', 'Counted')}</th><th className="n">{t('الفرق', 'Difference')}</th>
            </tr></thead>
            <tbody>
              {[...ls].reverse().map((l) => (
                <tr key={l.ym}>
                  <td className="nowrap">{monthLabel(l.ym)}{d.bookClosed.has(`${bookId}|${l.ym}`) ? ' 🔒' : ''}</td>
                  <td className="n">{f(l.start)}</td><td className="n">{f(l.income)}</td><td className="n">{f(l.expenses)}</td>
                  <td className="n">{f(l.transfers)}</td><td className="n">{f(l.exchange)}</td><td className="n"><b>{f(l.end)}</b></td>
                  {(() => {
                    // the count made when this month was closed: what was counted, how it differs, and why
                    const bm = d.bookMonths.find((x) => x.book_id === bookId && x.ym === l.ym);
                    const counted = bm ? (cur === 'SYP' ? bm.counted_syp : bm.counted_usd) : null;
                    if (!bm || counted == null) return <><td className="n muted">—</td><td className="n muted">—</td></>;
                    const diff = counted - ((cur === 'SYP' ? bm.book_syp : bm.book_usd) ?? l.end);
                    const differs = cur === 'SYP' ? Math.abs(diff) >= 0.5 : Math.abs(diff) >= 0.005;
                    return (
                      <>
                        <td className="n nowrap">{f(counted)} <button className="btn small ghost" title={t('عدّ الأوراق', 'The notes counted')} onClick={() => setShown(monthInfo(bm, monthLabel(l.ym)))}>🧮</button></td>
                        <td className={`n ${differs ? 'bad' : 'ok'}`} title={bm.count_note ?? ''}>{differs ? f(diff) : '✓'}{differs && bm.count_note ? <div className="muted small" style={{ fontWeight: 400 }}>{bm.count_note}</div> : null}</td>
                      </>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CurrencyFrame>
    );
  };
  return (
    <>
      {block('SYP')}{block('USD')}
      <CountHistory bookId={bookId} stamp={stamp} onShow={setShown} />
      {shown && <CountDetail info={shown} name={book.name} onClose={() => setShown(null)} />}
    </>
  );
}

/** What the detail window shows about one count. */
interface CountInfo {
  title: string;
  at: string;
  by: string | null;
  counted_syp: number;
  counted_usd: number;
  book_syp: number | null;
  book_usd: number | null;
  note: string | null;
  detail: string | null;
}
const monthInfo = (bm: Data['bookMonths'][number], title: string): CountInfo => ({ title, at: bm.closed_at ?? '', by: bm.closed_by, counted_syp: bm.counted_syp ?? 0, counted_usd: bm.counted_usd ?? 0, book_syp: bm.book_syp ?? null, book_usd: bm.book_usd ?? null, note: bm.count_note ?? null, detail: bm.count_detail ?? null });
/** date and hour, as the person reads them */
const stampText = (at: string) => {
  const dt = new Date(at);
  return Number.isNaN(dt.getTime()) ? at.slice(0, 10) : `${fmtDate(at.slice(0, 10))} ${dt.toTimeString().slice(0, 5)}`;
};

/** Every count saved for this book, newest first: when (date and hour), who, the notes, the book at that moment, the difference. */
function CountHistory({ bookId, stamp, onShow }: { bookId: number; stamp?: string | null; onShow: (i: CountInfo) => void }) {
  const { s } = useApp();
  const [rows, setRows] = useState<CashCountLog[] | null>(null);
  useEffect(() => {
    s.api.call('cash.history', { bookId }).then(setRows).catch(() => setRows([]));
  }, [s.api, bookId, stamp]);
  if (!rows) return null;
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>🧮 {t('سجل العدّ', 'History of the counts')}</h3>
      {rows.length === 0 ? <p className="muted small">{t('لا عدّ محفوظاً بعد. كل عدّ تحفظه يبقى هنا بتاريخه وساعته.', 'No count saved yet. Every count you save stays here with its date and hour.')}</p> : (
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr>
              <th>{t('متى', 'When')}</th><th>{t('من', 'Who')}</th><th>{t('النوع', 'Kind')}</th>
              <th className="n">{t('المعدود ل.س', 'Counted SYP')}</th><th className="n">{t('الدفتر ل.س', 'Book SYP')}</th><th className="n">{t('الفرق', 'Difference')}</th>
              <th className="n">{t('المعدود $', 'Counted USD')}</th><th className="n">{t('الدفتر $', 'Book USD')}</th><th className="n">{t('الفرق', 'Difference')}</th><th />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const dS = r.book_syp == null ? null : r.counted_syp - r.book_syp;
                const dU = r.book_usd == null ? null : r.counted_usd - r.book_usd;
                const cell = (x: number | null, f: (n: number) => string, tol: number) => (x == null ? '—' : Math.abs(x) < tol ? <span className="ok">✓</span> : <span className="bad">{f(x)}</span>);
                return (
                  <tr key={r.id}>
                    <td className="nowrap ltr">{stampText(r.at)}</td><td>{r.who ?? ''}</td>
                    <td>{r.kind === 'close' ? `🔒 ${t('إغلاق', 'Closing')} ${r.ym ? monthLabel(r.ym) : ''}` : t('عدّ', 'Count')}</td>
                    <td className="n">{fmtSyp(r.counted_syp)}</td><td className="n muted">{r.book_syp == null ? '—' : fmtSyp(r.book_syp)}</td><td className="n">{cell(dS, fmtSyp, 0.5)}</td>
                    <td className="n">{fmtUsd(r.counted_usd)}</td><td className="n muted">{r.book_usd == null ? '—' : fmtUsd(r.book_usd)}</td><td className="n">{cell(dU, fmtUsd, 0.005)}</td>
                    <td><button className="btn small ghost" title={t('عدّ الأوراق', 'The notes counted')} onClick={() => onShow({ title: stampText(r.at), at: r.at, by: r.who, counted_syp: r.counted_syp, counted_usd: r.counted_usd, book_syp: r.book_syp, book_usd: r.book_usd, note: r.note, detail: r.detail })}>🧮</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The notes counted when a month was closed, with the book, the difference and the reason. */
function CountDetail({ info, name, onClose }: { info: CountInfo; name: string; onClose: () => void }) {
  const bm = { counted_syp: info.counted_syp, counted_usd: info.counted_usd, book_syp: info.book_syp, book_usd: info.book_usd, count_note: info.note };
  let list: { currency: 'SYP' | 'USD'; denomination: number; qty: number }[] = [];
  try { list = info.detail ? JSON.parse(info.detail) : []; } catch { /* an older closing: totals only */ }
  return (
    <Modal title={<>{t('عدّ النقد', 'The cash count')} · {name} · {info.title}</>} onClose={onClose}>
      <p className="muted small">{stampText(info.at)} · {info.by}</p>
      {list.length ? (
        <div className="notes-grid">
          {(['SYP', 'USD'] as const).map((cur) => (
            <table className="t" key={cur}>
              <thead><tr><th className="n">{cur === 'SYP' ? t('الفئة ل.س', 'SYP note') : t('الفئة $', 'USD note')}</th><th className="n">{t('العدد', 'How many')}</th><th className="n">{t('المجموع', 'Total')}</th></tr></thead>
              <tbody>
                {list.filter((x) => x.currency === cur).map((x) => (
                  <tr key={x.denomination}><td className="n">{x.denomination.toLocaleString('en-US')}</td><td className="n">{x.qty}</td><td className="n">{(cur === 'SYP' ? fmtSyp : fmtUsd)(x.denomination * x.qty)}</td></tr>
                ))}
                <tr className="total"><td>{t('المجموع', 'Total')}</td><td /><td className="n"><b>{(cur === 'SYP' ? fmtSyp : fmtUsd)(cur === 'SYP' ? bm.counted_syp ?? 0 : bm.counted_usd ?? 0)}</b></td></tr>
              </tbody>
            </table>
          ))}
        </div>
      ) : (
        <p>{t('النقد المعدود', 'Cash counted')}: <b>{fmtSyp(bm.counted_syp ?? 0)}</b> SYP · <b>{fmtUsd(bm.counted_usd ?? 0)}</b> USD <span className="muted small">({t('الأوراق غير محفوظة لهذا الشهر', 'the notes were not kept for this month')})</span></p>
      )}
      <table className="t" style={{ marginTop: 10 }}>
        <tbody>
          <tr><td>{t('الدفتر', 'The book')}</td><td className="n">{fmtSyp(bm.book_syp ?? 0)}</td><td className="n">{fmtUsd(bm.book_usd ?? 0)}</td></tr>
          <tr><td>{t('المعدود', 'Counted')}</td><td className="n">{fmtSyp(bm.counted_syp ?? 0)}</td><td className="n">{fmtUsd(bm.counted_usd ?? 0)}</td></tr>
        </tbody>
      </table>
      {bm.count_note && <div className="alert warn" style={{ marginTop: 10 }}><b>{t('السبب', 'Reason')}:</b> {bm.count_note}</div>}
      <div className="modal-foot"><button className="btn primary" onClick={onClose}>{t('إغلاق', 'Close')}</button></div>
    </Modal>
  );
}

function CountModal({ bookId, counts, onClose, onSaved }: { bookId: number; counts: Counts; onClose: () => void; onSaved: () => Promise<void> }) {
  const { s, d } = useApp();
  const book = d.lists.books.find((b) => b.id === bookId)!;
  const [q, setQ] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const cur of ['SYP', 'USD'] as const) for (const den of NOTES[cur]) {
      const v = counts[bookId]?.[cur].get(den);
      o[`${cur}${den}`] = v ? String(v) : '';
    }
    return o;
  });
  const tot = (cur: 'SYP' | 'USD') => NOTES[cur].reduce((a, den) => a + den * (parseAmount(q[`${cur}${den}`] ?? '') || 0), 0);
  const save = async () => {
    const counts = (['SYP', 'USD'] as const).flatMap((currency) =>
      NOTES[currency].map((denomination) => ({ currency, denomination, qty: parseAmount(q[`${currency}${denomination}`] ?? '') || 0 })),
    );
    if (!(await confirmBox(t(`حفظ هذا العدّ في سجل دفتر «${book.name}»؟ يبقى مسجّلاً بتاريخه وساعته واسمك، ولا يُمحى.`, `Save this count in the history of the book "${book.name}"? It stays recorded with its date, hour and your name, and cannot be erased.`)))) return;
    try {
      await s.api.call('cash.saveCount', { bookId, counts });
    } catch (e) {
      return toast(errText(e), true);
    }
    await onSaved();
    toast(t('حُفظ العدّ', 'Count saved'));
    onClose();
  };
  return (
    <Modal title={<>{t('عدّ النقد ورقة ورقة', 'Count the cash, note by note')} · {book.name}</>} onClose={onClose}>
      <div className="notes-grid">
        {(['SYP', 'USD'] as const).map((cur) => (
          <div key={cur}>
            <table className="t">
              <thead><tr><th className="n">{cur === 'SYP' ? t('الفئة ل.س', 'SYP note') : t('الفئة $', 'USD note')}</th><th className="n">{t('العدد', 'How many')}</th><th className="n">{t('المجموع', 'Total')}</th></tr></thead>
              <tbody>
                {NOTES[cur].map((den) => (
                  <tr key={den}>
                    <td className="n">{den.toLocaleString('en-US')}</td>
                    <td style={{ width: 110 }}><input className="inp num" inputMode="numeric" value={q[`${cur}${den}`]} onChange={(e) => setQ({ ...q, [`${cur}${den}`]: e.target.value })} /></td>
                    <td className="n">{(cur === 'SYP' ? fmtSyp : fmtUsd)(den * (parseAmount(q[`${cur}${den}`] ?? '') || 0))}</td>
                  </tr>
                ))}
                <tr className="total"><td>{t('المجموع', 'Total')}</td><td /><td className="n">{(cur === 'SYP' ? fmtSyp : fmtUsd)(tot(cur))}</td></tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" onClick={save}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

function HolderCash({ bookId: myBook, switchTo, counted, counts, counting, setCounting, reloadCounts }: {
  bookId: number; switchTo: ((b: number) => void) | null;
  counted: (b: number, c: 'SYP' | 'USD') => number | null; counts: Counts; onCount: () => void;
  counting: number | null; setCounting: (b: number | null) => void; reloadCounts: () => Promise<void>;
}) {
  const { s, d, reload, fileHolder, myBooks } = useApp();
  const b = useMemo(() => holderBalance(d, myBook, fileHolder), [d, myBook, fileHolder]);
  const transfers = d.rows.filter((r) => r.type === 'Transfer' && r.book_id === myBook);
  const [adding, setAdding] = useState(false);
  const office = d.officeTransfers[String(myBook)] ?? [];
  const sum = (cur: 'SYP' | 'USD') => office.reduce((a, x) => a + (cur === 'SYP' ? x.trf_syp : x.trf_usd), 0);

  const line = (label: string, syp: number, usd: number, strong = false) => (
    <tr className={strong ? 'total' : ''}><td>{label}</td><td className="n">{fmtSyp(syp)}</td><td className="n">{fmtUsd(usd)}</td></tr>
  );
  const cs = counted(myBook!, 'SYP');
  const cu = counted(myBook!, 'USD');

  const delReceipt = async (id: string) => {
    if (!(await confirmBox(t('حذف هذا المقبوض؟', 'Delete this receipt?'), true))) return;
    await s.api.call('receipt.delete', { id });
    await reload();
  };

  return (
    <>
      <div className="page-head"><h1>{t('صندوقي', 'My cash')} · {d.lists.books.find((x) => x.id === myBook)?.name}</h1>
        {switchTo && (
          <div className="seg">{myBooks.map((id) => <button key={id} className={id === myBook ? 'on' : ''} onClick={() => switchTo(id)}>{d.lists.books.find((x) => x.id === id)?.name}</button>)}</div>
        )}
        <div className="row">
          {fileHolder && <button className="btn" onClick={() => setAdding(true)}>＋ {t('مقبوض من المكتب', 'Received from the office')}</button>}
          <button className="btn primary" onClick={() => setCounting(myBook)}>{t('عدّ النقد', 'Count cash')}</button>
        </div>
      </div>
      <div className="panel">
        <table className="t">
          <thead><tr><th /><th className="n">SYP</th><th className="n">USD</th></tr></thead>
          <tbody>
            {line(t('رصيد افتتاحي', 'Opening'), b.syp.opening, b.usd.opening)}
            {line(`＋ ${t('مقبوض من المكتب', 'Received from the office')}`, b.syp.transfers, b.usd.transfers)}
            {line(`＋ ${t('إيرادات', 'Income')}`, b.syp.income, b.usd.income)}
            {line(`− ${t('نفقات', 'Expenses')}`, b.syp.expenses, b.usd.expenses)}
            {line(`± ${t('تصريف', 'Exchange')}`, b.syp.exchange, b.usd.exchange)}
            {line(`= ${t('يجب أن يكون معي', 'I should hold')}`, b.syp.shouldHold, b.usd.shouldHold, true)}
            <tr><td>{t('المعدود', 'Counted')}{counts[myBook!]?.at && <span className="muted small"> · {fmtDate(counts[myBook!].at!.slice(0, 10))}</span>}</td><td className="n">{cs == null ? '—' : fmtSyp(cs)}</td><td className="n">{cu == null ? '—' : fmtUsd(cu)}</td></tr>
            <tr><td>{t('الفرق', 'Difference')}</td>
              <td className="n">{cs == null ? '' : Math.abs(cs - b.syp.shouldHold) < 1 ? <span className="ok">✓</span> : <span className="bad">{fmtSyp(cs - b.syp.shouldHold)}</span>}</td>
              <td className="n">{cu == null ? '' : Math.abs(cu - b.usd.shouldHold) < 0.01 ? <span className="ok">✓</span> : <span className="bad">{fmtUsd(cu - b.usd.shouldHold)}</span>}</td></tr>
          </tbody>
        </table>
      </div>

      {!fileHolder && (
        <div className="panel">
          <h3>{t('ما سلّمني إياه المكتب', 'What the office handed me')}</h3>
          <table className="t">
            <thead><tr><th>{t('التاريخ', 'Date')}</th><th className="n">SYP</th><th className="n">USD</th><th>{t('الشرح', 'Explanation')}</th></tr></thead>
            <tbody>
              {transfers.map((r) => <tr key={r.id}><td>{fmtDate(r.date)}</td><td className="n">{fmtSyp(r.trf_syp)}</td><td className="n">{fmtUsd(r.trf_usd)}</td><td>{r.explanation}</td></tr>)}
              <tr className="total"><td /><td className="n">{fmtSyp(b.syp.transfers)}</td><td className="n">{fmtUsd(b.usd.transfers)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
      {fileHolder && <div className="grid2">
        <div className="panel">
          <h3>{t('ما سجّلتُ أني قبضته', 'What I noted as received')}</h3>
          <p className="muted small">{t('لمتابعتك فقط — لا يُرسل إلى المكتب، فالمكتب يسجّل التحويلات.', 'For your own follow-up — not sent to the office, which books the transfers.')}</p>
          <table className="t">
            <thead><tr><th>{t('التاريخ', 'Date')}</th><th className="n">SYP</th><th className="n">USD</th><th>{t('ملاحظة', 'Note')}</th><th /></tr></thead>
            <tbody>
              {d.receipts.map((r) => (
                <tr key={r.id}><td>{fmtDate(r.date)}</td><td className="n">{fmtSyp(r.amount_syp)}</td><td className="n">{fmtUsd(r.amount_usd)}</td><td>{r.note}</td>
                  <td><button className="btn small ghost" onClick={() => delReceipt(r.id)}>✕</button></td></tr>
              ))}
              <tr className="total"><td /><td className="n">{fmtSyp(b.syp.transfers)}</td><td className="n">{fmtUsd(b.usd.transfers)}</td><td colSpan={2} /></tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>{t('ما سجّله المكتب', 'What the office booked')}</h3>
          <p className="muted small">{t('من آخر حزمة قوائم. يجب أن يساوي ما قبضتَه.', 'From the last lists package. It should equal what you received.')}</p>
          <table className="t">
            <thead><tr><th>{t('التاريخ', 'Date')}</th><th className="n">SYP</th><th className="n">USD</th></tr></thead>
            <tbody>
              {office.map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td className="n">{fmtSyp(r.trf_syp)}</td><td className="n">{fmtUsd(r.trf_usd)}</td></tr>)}
              <tr className="total"><td>
                {Math.abs(sum('SYP') - b.syp.transfers) < 1 && Math.abs(sum('USD') - b.usd.transfers) < 0.01 ? <span className="ok">✓ {t('مطابق', 'matches')}</span> : <span className="warn">≠</span>}
              </td><td className="n">{fmtSyp(sum('SYP'))}</td><td className="n">{fmtUsd(sum('USD'))}</td></tr>
            </tbody>
          </table>
        </div>
      </div>}

      {!fileHolder && (
        <>
          <h2 style={{ marginTop: 8 }}>{t('شهراً بشهر', 'Month by month')}</h2>
          <BookMonths bookId={myBook} stamp={counts[myBook]?.at} />
        </>
      )}
      {adding && <ReceiptModal onClose={() => setAdding(false)} />}
      {counting != null && <CountModal bookId={counting} counts={counts} onClose={() => setCounting(null)} onSaved={reloadCounts} />}
    </>
  );
}

function ReceiptModal({ onClose }: { onClose: () => void }) {
  const { s, reload } = useApp();
  const [date, setDate] = useState(todayIso());
  const [syp, setSyp] = useState('');
  const [usd, setUsd] = useState('');
  const [note, setNote] = useState('');
  const save = async () => {
    const a = parseAmount(syp) || 0;
    const b = parseAmount(usd) || 0;
    if (!date || (!a && !b)) return toast(t('التاريخ ومبلغ واحد على الأقل', 'A date and at least one amount'), true);
    try {
      await s.api.call('receipt.add', { date, syp: a, usd: b, note: note || null });
      await reload();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <Modal title={t('مقبوض من المكتب', 'Received from the office')} onClose={onClose} narrow>
      <p className="muted small">{t('بالسالب إن أعدتَ نقداً إلى المكتب.', 'Negative if you handed cash back.')}</p>
      <div className="grid2">
        <Field label={t('التاريخ', 'Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <div />
        <Field label="SYP"><input className="num" value={syp} onChange={(e) => setSyp(e.target.value)} /></Field>
        <Field label="USD"><input className="num" value={usd} onChange={(e) => setUsd(e.target.value)} /></Field>
        <Field label={t('ملاحظة', 'Note')} className="span2"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" onClick={save}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}
