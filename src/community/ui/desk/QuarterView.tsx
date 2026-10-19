// Every category in each quarter of the year (T1 = Oct–Dec … T4 = Jul–Sep), for the whole
// community, with a chart that answers to your clicks (as in the MAGIS reports):
//  - click a category: the chart shows it quarter by quarter, beside the year before;
//  - click a quarter (its column or its button): the ring shows where the money went in it,
//    and a click on a slice opens that category.
import { useMemo, useState } from 'react';
import { todayIso } from '../../../ui/kit';
import { CURS, accountBooks, quarterOf, rollUp, sheetOf, yearOf, zero, type Cur, type CtyAccount, type Money } from '../../domain';
import { useCty } from '../CtyApp';
import { Columns, Ring } from '../charts';
import { iconOf } from '../icons';
import { accName, curName, money, t3, yearName } from '../text';
import { exportExcel } from './excel';

const RANGE: Record<number, [string, string]> = { 1: ['10-01', '12-31'], 2: ['01-01', '03-31'], 3: ['04-01', '06-30'], 4: ['07-01', '09-30'] };
const range = (year: number, q: number): [string, string] => [`${q === 1 ? year : year + 1}-${RANGE[q][0]}`, `${q === 1 ? year : year + 1}-${RANGE[q][1]}`];

export function QuartersByCategory() {
  const { d } = useCty();
  const [year, setYear] = useState(yearOf(todayIso()));
  const [cur, setCur] = useState<Cur>('LOC');
  const [type, setType] = useState<'Exp' | 'Income'>('Exp');
  const [sel, setSel] = useState<number | null>(null); // a category, or null = everything of that type
  const [qsel, setQsel] = useState<number>(quarterOf(todayIso()));
  const mains = d.books.filter((b) => b.active && (b.cty_kind === 'personal' || b.cty_kind === 'house'));

  /** For each quarter of a year: every account's amount (money in or out), members and house together. */
  const compute = (y: number) => [1, 2, 3, 4].map((q) => {
    const [from, to] = range(y, q);
    const by = new Map<number, Money>();
    let total = zero();
    for (const b of mains) {
      const s = sheetOf(d.entries, accountBooks(d.books, b), from, to);
      for (const [id, v] of type === 'Exp' ? s.expenses : s.income) {
        const t = by.get(id) ?? zero();
        for (const c of CURS) t[c] += type === 'Exp' ? -v[c] : v[c];
        by.set(id, t);
      }
      const tot = type === 'Exp' ? s.totalExpenses : s.totalIncome;
      for (const c of CURS) total[c] += type === 'Exp' ? -tot[c] : tot[c];
    }
    return { rolled: rollUp(d.accounts, by), total };
  });

  const now = useMemo(() => compute(year), [year, d.entries, d.books, d.accounts, type]); // eslint-disable-line
  const before = useMemo(() => compute(year - 1), [year, d.entries, d.books, d.accounts, type]); // eslint-disable-line
  const accounts = d.accounts.filter((a) => a.type === type && now.some((q) => q.rolled.has(a.id) && (q.rolled.get(a.id)![cur] !== 0)));
  const depth = (a: CtyAccount) => { let n = 0; for (let p = a.parent_id; p != null; p = d.accounts.find((x) => x.id === p)?.parent_id ?? null) n++; return n; };
  const val = (qs: typeof now, q: number, id: number | null) => (id == null ? qs[q - 1].total[cur] : qs[q - 1].rolled.get(id)?.[cur] ?? 0);
  const yearOfCat = (id: number | null) => [1, 2, 3, 4].reduce((n, q) => n + val(now, q, id), 0);
  const grand = yearOfCat(null);
  const selAcc = sel != null ? d.accounts.find((a) => a.id === sel) : undefined;

  const cols = [1, 2, 3, 4].map((q) => ({ label: `T${q}`, title: `T${q} · ${yearName(year)}`, now: Math.max(0, val(now, q, sel)), before: Math.max(0, val(before, q, sel)) }));
  // the ring of the chosen quarter: its headings (or, inside a heading, its lines)
  const inside = selAcc && d.accounts.some((a) => a.parent_id === selAcc.id);
  const ringAccounts = d.accounts.filter((a) => a.type === type && (inside ? a.parent_id === selAcc!.id : a.parent_id != null && d.accounts.find((p) => p.id === a.parent_id)?.parent_id == null));
  const parts = ringAccounts.map((a) => ({ key: a.id, label: `${iconOf(a.code)} ${accName(a)}`, value: val(now, qsel, a.id) })).filter((p) => p.value > 0);

  const exportIt = async () => {
    await exportExcel(`quarters-${year}.xlsx`, [{
      name: type === 'Exp' ? 'Expenses' : 'Income',
      header: [t3('الرمز', 'Code', 'Code'), t3('البند', 'Category', 'Catégorie'), 'T1', 'T2', 'T3', 'T4', t3('السنة', 'Year', 'Année')],
      rows: accounts.map((a) => [a.code, accName(a), ...[1, 2, 3, 4].map((q) => val(now, q, a.id) || null), yearOfCat(a.id) || null]),
      money: [2, 3, 4, 5, 6],
    }]);
  };

  return (
    <>
      <div className="desk-filters">
        <button className="btn" onClick={() => setYear(year - 1)}>‹</button><span>{yearName(year)}</span><button className="btn" onClick={() => setYear(year + 1)}>›</button>
        <div className="cty-seg" style={{ margin: 0 }}>
          <button className={type === 'Exp' ? 'on' : ''} onClick={() => { setType('Exp'); setSel(null); }}>{t3('النفقات', 'Expenses', 'Dépenses')}</button>
          <button className={type === 'Income' ? 'on' : ''} onClick={() => { setType('Income'); setSel(null); }}>{t3('الدخل', 'Income', 'Revenus')}</button>
        </div>
        <div className="cty-curs" style={{ margin: 0 }}>{CURS.map((c) => <button key={c} className={c === cur ? 'on' : ''} onClick={() => setCur(c)}>{curName(c, d.local)}</button>)}</div>
        <button className="btn" onClick={exportIt}>Excel</button>
      </div>

      <div className="desk-two">
        <div className="cty-card">
          <div className="cty-label">{selAcc ? `${iconOf(selAcc.code)} ${accName(selAcc)}` : type === 'Exp' ? t3('كل النفقات', 'All expenses', 'Toutes les dépenses') : t3('كل الدخل', 'All income', 'Tous les revenus')} · {t3('فصلاً بفصل', 'quarter by quarter', 'trimestre par trimestre')}</div>
          <Columns cols={cols} fmt={(n) => `${money(n, cur)} ${curName(cur, d.local)}`} />
          <div className="muted small"><i className="cty-key now" /> {t3('هذه السنة', 'this year', 'cette année')} · <i className="cty-key before" /> {t3('السنة الماضية', 'last year', "l'an dernier")}
            {selAcc && <button className="cty-link" style={{ marginInlineStart: 10 }} onClick={() => setSel(selAcc.parent_id != null && d.accounts.find((p) => p.id === selAcc.parent_id)?.parent_id != null ? selAcc.parent_id : null)}>↑ {t3('رجوع', 'up', 'remonter')}</button>}</div>
        </div>
        <div className="cty-card">
          <div className="cty-label">{t3('أين ذهب في', 'Where it went in', 'Où cela est allé au')} <span className="desk-qpick">{[1, 2, 3, 4].map((q) => <button key={q} className={q === qsel ? 'on' : ''} onClick={() => setQsel(q)}>T{q}</button>)}</span></div>
          {parts.length ? <Ring parts={parts} fmt={(n) => money(n, cur)} center={`T${qsel}`} onPick={(p) => typeof p.key === 'number' && setSel(p.key as number)} /> : <p className="muted">{t3('لا شيء.', 'Nothing.', 'Rien.')}</p>}
        </div>
      </div>

      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الرمز', 'Code', 'Code')}</th><th>{t3('البند', 'Category', 'Catégorie')}</th>{[1, 2, 3, 4].map((q) => <th key={q} className={`num ${q === qsel ? 'qsel' : ''}`}><button className="cty-link" onClick={() => setQsel(q)}>T{q}</button></th>)}<th className="num">{t3('السنة', 'Year', 'Année')}</th><th className="num">%</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className={`click ${a.id === sel ? 'picked' : ''} ${depth(a) === 0 ? 'fdc-total' : depth(a) === 1 ? 'fdc-head' : 'fdc-line'}`} onClick={() => setSel(a.id === sel ? null : a.id)}>
                <td className="muted small">{a.code}</td>
                <td style={{ paddingInlineStart: 8 + depth(a) * 14 }}>{iconOf(a.code)} {accName(a)}</td>
                {[1, 2, 3, 4].map((q) => <td key={q} className={`num ${q === qsel ? 'qsel' : ''}`}>{val(now, q, a.id) ? money(val(now, q, a.id), cur) : ''}</td>)}
                <td className="num"><b>{money(yearOfCat(a.id), cur)}</b></td>
                <td className="num muted">{grand ? `${Math.round((yearOfCat(a.id) / grand) * 100)}%` : ''}</td>
              </tr>
            ))}
            <tr className="fdc-total"><td /><td>{t3('المجموع', 'Total', 'Total')}</td>{[1, 2, 3, 4].map((q) => <td key={q} className="num">{money(val(now, q, null), cur)}</td>)}<td className="num">{money(grand, cur)}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">{t3('اضغط على بند ليظهر في المخطط، وعلى فصل ليظهر توزيعه.', 'Click a category to chart it, a quarter to see its breakdown.', 'Cliquez une catégorie pour la voir au graphique, un trimestre pour voir sa répartition.')}</p>
    </>
  );
}
