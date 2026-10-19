// All the records of my account (pocket + bank, or the house + envelopes): by month,
// quarter, year or everything; by category or a word. Tap a record to change it.
import { useMemo, useState } from 'react';
import { todayIso } from '../../ui/kit';
import { CURS, accountBooks, periodMonths, quarterOf, yearOf, monthsOfYear, type CtyEntry, type EntryType } from '../domain';
import { useCty, Card, bookLabel } from './CtyApp';
import { EntryRow, headingOf } from './Month';
import { iconOf } from './icons';
import { accName, curName, money, monthName, t3, yearName } from './text';

type Mode = 'month' | 'quarter' | 'year' | 'all';

export function RecordsScreen() {
  const { d, book } = useCty();
  const today = todayIso();
  const [mode, setMode] = useState<Mode>('quarter');
  const [ym, setYm] = useState(today.slice(0, 7));
  const [type, setType] = useState<EntryType | ''>('');
  const [cat, setCat] = useState<number | ''>('');
  const [q, setQ] = useState('');
  const group = useMemo(() => accountBooks(d.books, book), [d.books, book]);
  const ids = new Set(group.map((b) => b.id));

  const months = mode === 'month' ? [ym] : mode === 'quarter' ? periodMonths(ym, 'quarter') : mode === 'year' ? monthsOfYear(yearOf(`${ym}-01`)) : [];
  const title = mode === 'all' ? t3('كل القيود', 'Everything', 'Tout') : mode === 'month' ? monthName(ym) : mode === 'quarter' ? `T${quarterOf(`${months[0]}-01`)} · ${months[0].slice(5)}–${months[2].slice(5)}/${months[2].slice(0, 4)}` : yearName(yearOf(`${ym}-01`));
  const step = (k: number) => setYm(shift(ym, k * (mode === 'month' ? 1 : mode === 'quarter' ? 3 : 12)));

  const headings = useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of d.entries) if (e.account_id != null) { const h = headingOf(d.accounts, e.account_id); if (h) seen.set(h.id, `${iconOf(h.code)} ${accName(h)}`); }
    return [...seen.entries()];
  }, [d.entries, d.accounts]);

  const rows = useMemo(() => {
    const word = q.trim().toLowerCase();
    return d.entries.filter((e: CtyEntry) => {
      if (!ids.has(e.book_id) && !(e.to_book_id != null && ids.has(e.to_book_id))) return false;
      if (mode !== 'all' && !months.includes(e.date.slice(0, 7))) return false;
      if (type && e.type !== type) return false;
      if (cat !== '' && headingOf(d.accounts, e.account_id)?.id !== cat) return false;
      if (word && !`${e.note ?? ''} ${accName(d.accounts.find((a) => a.id === e.account_id))}`.toLowerCase().includes(word)) return false;
      return true;
    }).sort((a, b) => (b.date + (b.n ?? 0)).localeCompare(a.date + (a.n ?? 0)));
  }, [d.entries, d.accounts, group, mode, ym, type, cat, q]); // eslint-disable-line
  const sum = (kind: 'Exp' | 'Income') => CURS.map((c) => rows.filter((e) => e.type === kind && e.cur === c).reduce((n, e) => n + e.amount, 0));
  const exp = sum('Exp');
  const inc = sum('Income');

  return (
    <>
      <h1>{t3('كل القيود', 'All records', 'Toutes les écritures')}</h1>
      <p className="muted small" style={{ margin: 0 }}>{bookLabel(book)}</p>
      <div className="cty-seg">
        {(['month', 'quarter', 'year', 'all'] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {m === 'month' ? t3('الشهر', 'Month', 'Mois') : m === 'quarter' ? t3('الفصل', 'Quarter', 'Trimestre') : m === 'year' ? t3('السنة', 'Year', 'Année') : t3('الكل', 'All', 'Tout')}
          </button>
        ))}
      </div>
      {mode !== 'all' && (
        <div className="cty-monthnav"><button onClick={() => step(-1)}>‹</button><h1 style={{ fontSize: 16 }}>{title}</h1><button onClick={() => step(1)}>›</button></div>
      )}
      <Card>
        <div className="cty-filters">
          <select value={type} onChange={(e) => setType(e.target.value as EntryType | '')}>
            <option value="">{t3('كل الأنواع', 'All kinds', 'Tous les types')}</option>
            <option value="Exp">{t3('نفقات', 'Expenses', 'Dépenses')}</option>
            <option value="Income">{t3('دخل', 'Income', 'Revenus')}</option>
            <option value="Transfer">{t3('تحويلات', 'Transfers', 'Transferts')}</option>
            <option value="Exchange">{t3('صرافة', 'Exchanges', 'Changes')}</option>
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">{t3('كل البنود', 'All categories', 'Toutes les catégories')}</option>
            {headings.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <input placeholder={t3('بحث…', 'Search…', 'Chercher…')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          {rows.length} {t3('قيد', 'records', 'écritures')}
          {CURS.map((c, i) => (exp[i] || inc[i]) ? <span key={c}> · {curName(c, d.local)}: {inc[i] ? `＋${money(inc[i], c)} ` : ''}{exp[i] ? `－${money(exp[i], c)}` : ''}</span> : null)}
        </div>
      </Card>
      <Card>
        {rows.length === 0 && <p className="muted">{t3('لا قيود.', 'No records.', 'Aucune écriture.')}</p>}
        {rows.map((e) => <EntryRow key={e.id} e={e} showDate />)}
      </Card>
    </>
  );
}

const shift = (ym: string, k: number) => {
  const [y, mo] = ym.split('-').map(Number);
  const t = y * 12 + (mo - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
