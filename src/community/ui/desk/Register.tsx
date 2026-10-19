// The register: every entry of the community, filtered by book, month, type, or a word.
// With one book chosen it becomes that book's journal (cash, bank, économat…), with its
// running balance in each currency, as in the économat's Journal.
import { useMemo, useState } from 'react';
import { todayIso, toast, errText, promptBox, parseAmount } from '../../../ui/kit';
import { CURS, balance, effect, yearOf, type CtyEntry, type Cur, type EntryType } from '../../domain';
import { useCty, bookName } from '../CtyApp';
import { iconOf } from '../icons';
import { accName, curName, money, monthName, t3, yearName } from '../text';
import { exportExcel } from './excel';

export function Register({ initialBook, initialYm }: { initialBook: number | null; initialYm?: string }) {
  const { d, write } = useCty();
  const today = todayIso();
  const [bookId, setBookId] = useState<number | null>(initialBook);
  const [period, setPeriod] = useState<string>(initialYm ?? today.slice(0, 7)); // YYYY-MM, or Y2025 for a year
  const [type, setType] = useState<EntryType | ''>('');
  const [q, setQ] = useState('');
  const book = d.books.find((b) => b.id === bookId);
  const [opening, setOpening] = useState(false);

  const inPeriod = (date: string) => (period.startsWith('Y') ? yearOf(date) === Number(period.slice(1)) : date.slice(0, 7) === period);
  const from = period.startsWith('Y') ? `${period.slice(1)}-10-01` : `${period}-01`;
  const rows = useMemo(() => {
    const word = q.trim().toLowerCase();
    return d.entries.filter((e) => {
      if (!inPeriod(e.date)) return false;
      if (bookId != null && e.book_id !== bookId && e.to_book_id !== bookId) return false;
      if (type && e.type !== type) return false;
      if (word) {
        const acc = d.accounts.find((a) => a.id === e.account_id);
        const hay = [e.note, acc?.code, acc?.name_en, acc?.name_fr, acc?.name_ar, bookName(d.books.find((b) => b.id === e.book_id)), bookName(d.books.find((b) => b.id === e.to_book_id))].join(' ').toLowerCase();
        if (!hay.includes(word)) return false;
      }
      return true;
    });
  }, [d, bookId, period, type, q]);

  // the running balance of the chosen book, from what it held before the period
  const running = useMemo(() => {
    if (!book) return null;
    const dayBefore = from.slice(0, 8) + '00';
    const bal = balance(d.entries, book, dayBefore);
    const out = new Map<string, Record<Cur, number>>();
    for (const e of rows) {
      const fx = effect(e, book.id);
      for (const c of CURS) bal[c] += fx[c];
      out.set(e.id, { ...bal });
    }
    return { start: balance(d.entries, book, dayBefore), out };
  }, [book, rows, d.entries, from]);

  /** What the entry means for the book shown (or, with all books, for the book it was written in). */
  const signed = (e: CtyEntry) => effect(e, bookId ?? e.book_id);
  const totals = CURS.map((c) => rows.reduce((n, e) => n + (e.type === 'Transfer' && bookId == null ? 0 : signed(e)[c]), 0));

  const periods = useMemo(() => {
    const ms = new Set<string>([today.slice(0, 7), ...d.entries.map((e) => e.date.slice(0, 7))]);
    const ys = new Set<number>([...ms].map((m) => yearOf(`${m}-01`)));
    return [...[...ms].sort().reverse(), ...[...ys].sort().reverse().map((y) => `Y${y}`)];
  }, [d.entries, today]);

  const label = (e: CtyEntry) => {
    if (e.type === 'Income' || e.type === 'Exp') {
      const a = d.accounts.find((x) => x.id === e.account_id);
      return `${iconOf(a?.code)} ${a?.code ?? ''} ${accName(a)}`;
    }
    if (e.type === 'Transfer') return `${bookName(d.books.find((b) => b.id === e.book_id))} → ${bookName(d.books.find((b) => b.id === e.to_book_id))}`;
    return t3('صرافة', 'Exchange', 'Change');
  };
  const typeName: Record<EntryType, string> = {
    Exp: t3('نفقة', 'Expense', 'Dépense'), Income: t3('دخل', 'Income', 'Revenu'),
    Transfer: t3('تحويل', 'Transfer', 'Transfert'), Exchange: t3('صرافة', 'Exchange', 'Change'),
  };

  const exportIt = async () => {
    try {
      const header = ['N', t3('التاريخ', 'Date', 'Date'), t3('الدفتر', 'Book', 'Compte'), t3('النوع', 'Type', 'Type'), t3('البند', 'Line', 'Ligne'), t3('ملاحظة', 'Note', 'Note'),
        ...CURS.map((c) => curName(c, d.local)), ...(running ? CURS.map((c) => `${t3('الرصيد', 'Balance', 'Solde')} ${curName(c, d.local)}`) : [])];
      const data = rows.map((e) => [e.n, e.date, bookName(d.books.find((b) => b.id === e.book_id)), typeName[e.type], label(e), e.note,
        ...CURS.map((c) => signed(e)[c] || null), ...(running ? CURS.map((c) => running.out.get(e.id)![c]) : [])]);
      await exportExcel(`${book ? bookName(book) : 'register'}-${period}.xlsx`, [{ name: book ? bookName(book) : 'Register', header, rows: data, money: [6, 7, 8, 9, 10, 11] }]);
    } catch (e) {
      toast(errText(e), true);
    }
  };

  return (
    <>
      <div className="desk-head">
        <h1>{book ? `${t3('دفتر', 'Journal', 'Journal')} · ${bookName(book)}` : t3('السجل', 'Register', 'Registre')}</h1>
        <div className="row">
          <button className="btn primary" disabled={!book} title={book ? '' : t3('اختر دفتراً', 'Choose a book', 'Choisissez un compte')} onClick={() => book && write({ kind: 'Exp', bookId: book.id })}>＋ {t3('قيد جديد', 'New entry', 'Nouvelle écriture')}</button>
          {book && <button className="btn" onClick={() => setOpening(true)}>{t3('ما كان فيه في البداية…', 'Amount at the start…', 'Montant au départ…')}</button>}
          <button className="btn" onClick={exportIt}>Excel</button>
        </div>
      </div>
      {opening && book && <OpeningSheet bookId={book.id} onClose={() => setOpening(false)} />}
      <div className="desk-filters">
        <select value={bookId ?? ''} onChange={(e) => setBookId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t3('كل الدفاتر', 'All books', 'Tous les comptes')}</option>
          {d.books.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{bookName(b)}</option>)}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map((p) => <option key={p} value={p}>{p.startsWith('Y') ? yearName(Number(p.slice(1))) : monthName(p)}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as EntryType | '')}>
          <option value="">{t3('كل الأنواع', 'All types', 'Tous les types')}</option>
          {(Object.keys(typeName) as EntryType[]).map((k) => <option key={k} value={k}>{typeName[k]}</option>)}
        </select>
        <input placeholder={t3('بحث…', 'Search…', 'Chercher…')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead>
            <tr>
              <th>N</th><th>{t3('التاريخ', 'Date', 'Date')}</th>{!book && <th>{t3('الدفتر', 'Book', 'Compte')}</th>}<th>{t3('البند', 'Line', 'Ligne')}</th><th>{t3('ملاحظة', 'Note', 'Note')}</th>
              {CURS.map((c) => <th key={c} className="num">{curName(c, d.local)}</th>)}
              {running && CURS.map((c) => <th key={'b' + c} className="num muted">{t3('الرصيد', 'Balance', 'Solde')} {curName(c, d.local)}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {running && (
              <tr className="muted">
                <td /><td colSpan={3}>{t3('من قبل', 'Carried over', 'Report')}</td>
                {CURS.map((c) => <td key={c} />)}
                {CURS.map((c) => <td key={'b' + c} className="num">{money(running.start[c], c)}</td>)}<td />
              </tr>
            )}
            {rows.map((e) => {
              const fx = signed(e);
              return (
                <tr key={e.id} className="click" onClick={() => write({ kind: e.type, edit: e })}>
                  <td className="muted">{e.n}</td>
                  <td>{e.date.slice(8, 10)}/{e.date.slice(5, 7)}</td>
                  {!book && <td>{bookName(d.books.find((b) => b.id === e.book_id))}</td>}
                  <td>{label(e)}</td>
                  <td className="desk-note">{e.note}</td>
                  {CURS.map((c) => <td key={c} className={`num ${fx[c] < 0 ? 'out' : fx[c] > 0 ? 'in' : ''}`}>{fx[c] ? money(fx[c], c) : ''}</td>)}
                  {running && CURS.map((c) => <td key={'b' + c} className="num muted">{money(running.out.get(e.id)![c], c)}</td>)}
                  <td className="small">
                    {e.refused_at ? '⛔' : e.approval_needed && !e.approved_at ? '⏳' : ''}{e.claim ? '↺' : ''}
                    {e.type === 'Transfer' && !e.received_at && !e.disputed_at ? '…' : ''}{e.disputed_at ? '⚠' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={book ? 4 : 5}>{rows.length} {t3('قيد', 'entries', 'écritures')}{!book && <span className="muted small"> · {t3('دون التحويلات', 'without transfers', 'sans les transferts')}</span>}</td>
              {CURS.map((c, i) => <td key={c} className="num">{money(totals[i], c)}</td>)}
              {running && CURS.map((c) => <td key={'b' + c} />)}<td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small">… {t3('لم يؤكَّد', 'not confirmed', 'non confirmé')} · ⚠ {t3('لم يصل', 'not received', 'pas reçu')} · ⏳ {t3('بانتظار الرئيس', 'waits for the Superior', 'attend le Supérieur')} · ↺ {t3('للمطالبة', 'to claim', 'à réclamer')}</p>
    </>
  );
}

/** What the book held before its first entry, in each currency (the econome; a reason is asked). */
function OpeningSheet({ bookId, onClose }: { bookId: number; onClose: () => void }) {
  const { d, s, reload } = useCty();
  const b = d.books.find((x) => x.id === bookId)!;
  const [v, setV] = useState<Record<Cur, string>>({ LOC: String(b.opening_syp || ''), USD: String(b.opening_usd || ''), EUR: String(b.opening_eur || '') });
  const save = async () => {
    const reason = await promptBox(t3('السبب؟ (مثلاً: بداية البرنامج)', 'Why? (e.g. start of the program)', 'Pourquoi ? (p. ex. début du programme)'));
    if (!reason) return;
    try {
      await s.api.call('cty.book.opening', { bookId, opening: { LOC: parseAmount(v.LOC), USD: parseAmount(v.USD), EUR: parseAmount(v.EUR) }, reason });
      await reload();
      toast(t3('حُفظ ✓', 'Saved ✓', 'Enregistré ✓'));
      onClose();
    } catch (e) { toast(errText(e), true); }
  };
  return (
    <div className="cty-sheet" role="dialog">
      <div className="cty-sheet-head"><button className="cty-icon" onClick={onClose}>✕</button><b>{bookName(b)} · {t3('في البداية', 'At the start', 'Au départ')}</b></div>
      <div className="cty-sheet-body">
        <p className="muted">{t3('ما كان في هذا الدفتر قبل أول قيد فيه.', 'What this book held before its first entry.', 'Ce que ce compte avait avant sa première écriture.')}</p>
        {CURS.map((c) => (
          <label key={c} className="field"><span>{curName(c, d.local)}</span><input inputMode="decimal" value={v[c]} onChange={(e) => setV({ ...v, [c]: e.target.value })} /></label>
        ))}
        <button className="btn primary cty-wide" onClick={save}>{t3('احفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </div>
  );
}
