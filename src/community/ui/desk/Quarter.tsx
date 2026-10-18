// The quarterly file (what the econome copied into Comptapro-Trim by hand): each member,
// the house, and the community's total, line by line with the codes, for a quarter
// or the whole year (October → September). Exported to Excel, one sheet per currency.
import { useMemo, useState } from 'react';
import { errText, toast, todayIso } from '../../../ui/kit';
import { CURS, rollUp, sheet, yearOf, type Cur, type Money } from '../../domain';
import { useCty, bookLabel, bookName } from '../CtyApp';
import { accName, curName, money, t3, yearName } from '../text';
import { exportExcel } from './excel';

const QUARTERS: Record<number, [string, string]> = { 1: ['10-01', '12-31'], 2: ['01-01', '03-31'], 3: ['04-01', '06-30'], 4: ['07-01', '09-30'] };

export function Quarter() {
  const { d } = useCty();
  const [year, setYear] = useState(yearOf(todayIso()));
  const [q, setQ] = useState<number>(1);
  const [cur, setCur] = useState<Cur>('LOC');
  const books = d.books.filter((b) => b.cty_kind === 'personal' || b.cty_kind === 'house');
  const [from, to] = q ? [`${q === 1 ? year : year + 1}-${QUARTERS[q][0]}`, `${q === 1 ? year : year + 1}-${QUARTERS[q][1]}`] : [`${year}-10-01`, `${year + 1}-09-30`];

  const cols = useMemo(() => books.map((b) => {
    const s = sheet(d.entries, b, from, to);
    const byAcc = new Map<number, Money>([...s.income, ...s.expenses]);
    return { b, s, up: rollUp(d.accounts, byAcc) };
  }), [books, d, from, to]);
  const used = d.accounts.filter((a) => cols.some((c) => c.up.has(a.id)));
  const depth = (id: number | null): number => { let n = 0; for (let p = d.accounts.find((a) => a.id === id)?.parent_id; p != null; p = d.accounts.find((a) => a.id === p)?.parent_id) n++; return n; };
  const v = (up: Map<number, Money>, id: number, c: Cur) => up.get(id)?.[c] ?? 0;
  const total = (id: number, c: Cur) => cols.reduce((n, x) => n + v(x.up, id, c), 0);
  const fixed: { key: keyof ReturnType<typeof sheet>; label: string }[] = [
    { key: 'carried', label: t3('رصيد سابق', 'Carried over', 'Report') },
    { key: 'received', label: t3('من القيّم', 'From the econome', "Reçu de l'économe") },
    { key: 'totalIncome', label: t3('مجموع الدخل', 'Total income', 'Total revenus') },
    { key: 'totalExpenses', label: t3('مجموع النفقات', 'Total expenses', 'Total dépenses') },
    { key: 'givenBack', label: t3('أعيد إلى القيّم', 'Given back', "Rendu à l'économe") },
    { key: 'kept', label: t3('في النهاية', 'Kept at the end', 'Gardé à la fin') },
  ];
  const colName = (b: (typeof books)[number]) => (b.cty_kind === 'house' ? bookLabel(b) : bookName(b));

  const exportIt = async () => {
    try {
      await exportExcel(`quarterly-${year}${q ? `-T${q}` : ''}.xlsx`, CURS.map((c) => ({
        name: curName(c, d.local) === '$' ? 'USD' : curName(c, d.local) === '€' ? 'EUR' : d.local,
        header: [t3('الرمز', 'Code', 'Code'), t3('البند', 'Line', 'Ligne'), ...books.map(colName), t3('الجماعة', 'Community', 'Communauté')],
        rows: [
          ...used.map((a) => [a.code, accName(a), ...cols.map((x) => v(x.up, a.id, c) || null), total(a.id, c) || null]),
          ...fixed.map((f) => ['', f.label, ...cols.map((x) => (x.s[f.key] as Money)[c] || null), cols.reduce((n, x) => n + (x.s[f.key] as Money)[c], 0) || null]),
        ],
        money: Array.from({ length: books.length + 1 }, (_, i) => i + 2),
      })));
    } catch (e) { toast(errText(e), true); }
  };

  return (
    <>
      <div className="desk-head">
        <h1>{t3('الملف الفصلي', 'Quarterly file', 'Fichier trimestriel')}</h1>
        <button className="btn" onClick={exportIt}>Excel</button>
      </div>
      <div className="desk-filters">
        <button className="btn" onClick={() => setYear(year - 1)}>‹</button><span>{yearName(year)}</span><button className="btn" onClick={() => setYear(year + 1)}>›</button>
        <select value={q} onChange={(e) => setQ(Number(e.target.value))}>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>T{n}</option>)}
          <option value={0}>{t3('السنة كلها', 'Whole year', 'Toute l’année')}</option>
        </select>
        <div className="cty-curs" style={{ margin: 0 }}>
          {CURS.map((c) => <button key={c} className={c === cur ? 'on' : ''} onClick={() => setCur(c)}>{curName(c, d.local)}</button>)}
        </div>
      </div>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الرمز', 'Code', 'Code')}</th><th>{t3('البند', 'Line', 'Ligne')}</th>{books.map((b) => <th key={b.id} className="num">{colName(b)}</th>)}<th className="num">{t3('الجماعة', 'Community', 'Communauté')}</th></tr></thead>
          <tbody>
            {used.length === 0 && <tr><td colSpan={books.length + 3} className="muted">{t3('لا شيء في هذه المدة.', 'Nothing in this period.', 'Rien sur cette période.')}</td></tr>}
            {used.map((a) => (
              <tr key={a.id} className={depth(a.id) === 0 ? 'fdc-total' : depth(a.id) === 1 ? 'fdc-head' : 'fdc-line'}>
                <td className="muted small">{a.code}</td>
                <td style={{ paddingInlineStart: 8 + depth(a.id) * 14 }}>{accName(a)}</td>
                {cols.map((x) => <td key={x.b.id} className="num">{v(x.up, a.id, cur) ? money(v(x.up, a.id, cur), cur) : ''}</td>)}
                <td className="num"><b>{total(a.id, cur) ? money(total(a.id, cur), cur) : ''}</b></td>
              </tr>
            ))}
            <tr className="fdc-part"><td colSpan={books.length + 3}>{t3('النقد', 'Cash', 'Trésorerie')}</td></tr>
            {fixed.map((f) => (
              <tr key={f.key}>
                <td /><td>{f.label}</td>
                {cols.map((x) => <td key={x.b.id} className="num">{money((x.s[f.key] as Money)[cur], cur)}</td>)}
                <td className="num"><b>{money(cols.reduce((n, x) => n + (x.s[f.key] as Money)[cur], 0), cur)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
