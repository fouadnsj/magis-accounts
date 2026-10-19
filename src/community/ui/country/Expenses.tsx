// The country econome's detailed view of all the expenses (and income), from the communities'
// monthly files: click a category to chart it, a quarter to see where the money went in it,
// choose one community or all; every currency apart, or ONE total converted to dollars.
import { useMemo, useState } from 'react';
import { todayIso } from '../../../ui/kit';
import type { CountryData } from '../../country';
import { CURS, monthsOfYear, quarterOf, rollUp, totalUsd, yearOf, zero, type Cur, type CtyAccount, type Money, type Rates } from '../../domain';
import { Columns, Ring } from '../charts';
import { iconOf } from '../icons';
import { accName, curName, money, monthName, t3, yearName } from '../text';
import { exportExcel } from '../desk/excel';

export function Expenses({ d }: { d: CountryData }) {
  const latest = d.months.map((m) => m.ym).sort().pop();
  const [year, setYear] = useState(yearOf(latest ? `${latest}-01` : todayIso()));
  const [view, setView] = useState<Cur | 'ALL'>('ALL');
  const [type, setType] = useState<'Exp' | 'Income'>('Exp');
  const [cty, setCty] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [qsel, setQsel] = useState<number>(quarterOf(latest ? `${latest}-01` : todayIso()));
  const cur: Cur = view === 'ALL' ? 'USD' : view;
  const rates: Rates = { loc: d.rates.startRate > 0 ? 1 / d.rates.startRate : null, eur: d.rates.eurUsd };
  const pick = (m: Money | undefined): number => (!m ? 0 : view === 'ALL' ? totalUsd(m, rates).usd : m[cur]);
  const byCode = useMemo(() => new Map(d.accounts.map((a) => [a.code, a])), [d.accounts]);
  const active = d.ctys.filter((c) => c.active);

  /** every account's amount in some months of a year, for one community or all (rolled up to headings). */
  const agg = (y: number, test: (ym: string) => boolean, only: number | null) => {
    const by = new Map<number, Money>();
    let total = zero();
    for (const f of d.months) {
      if (yearOf(`${f.ym}-01`) !== y || !test(f.ym) || (only != null && f.cty_id !== only)) continue;
      for (const [code, v] of Object.entries(f.file.totals)) {
        const a = byCode.get(code);
        if (!a || a.type !== type) continue;
        const t = by.get(a.id) ?? zero();
        for (const c of CURS) { const x = type === 'Exp' ? -v[c] : v[c]; t[c] += x; total[c] += x; }
        by.set(a.id, t);
      }
    }
    return { rolled: rollUp(d.accounts, by), total };
  };
  const qMonths = (y: number, q: number) => monthsOfYear(y).slice((q - 1) * 3, q * 3);
  const quarters = (y: number, only: number | null) => [1, 2, 3, 4].map((q) => agg(y, (ym) => qMonths(y, q).includes(ym), only));
  const now = useMemo(() => quarters(year, cty), [d.months, byCode, year, cty, type]); // eslint-disable-line
  const before = useMemo(() => quarters(year - 1, cty), [d.months, byCode, year, cty, type]); // eslint-disable-line
  const val = (qs: typeof now, q: number, id: number | null) => (id == null ? pick(qs[q - 1].total) : pick(qs[q - 1].rolled.get(id)));
  const yearOfCat = (id: number | null) => [1, 2, 3, 4].reduce((n, q) => n + val(now, q, id), 0);
  const yearBeforeOf = (id: number | null) => [1, 2, 3, 4].reduce((n, q) => n + val(before, q, id), 0);
  const grand = yearOfCat(null);
  const yearBefore = yearBeforeOf(null);
  const change = yearBefore ? Math.round(((grand - yearBefore) / yearBefore) * 100) : null;
  const depth = (a: CtyAccount) => { let n = 0; for (let p = a.parent_id; p != null; p = d.accounts.find((x) => x.id === p)?.parent_id ?? null) n++; return n; };
  const accounts = d.accounts.filter((a) => a.type === type && now.some((q) => pick(q.rolled.get(a.id)) !== 0));
  const selAcc = sel != null ? d.accounts.find((a) => a.id === sel) : undefined;
  const heads = d.accounts.filter((a) => a.type === type && depth(a) === 1);
  const biggest = heads.map((a) => ({ a, v: yearOfCat(a.id) })).sort((x, y) => y.v - x.v)[0];
  const monthsDone = new Set(d.months.filter((f) => yearOf(`${f.ym}-01`) === year).map((f) => f.ym)).size;

  const cols = [1, 2, 3, 4].map((q) => ({ label: `T${q}`, title: `T${q} · ${yearName(year)}`, now: Math.max(0, val(now, q, sel)), before: Math.max(0, val(before, q, sel)) }));
  const monthly = useMemo(() => {
    const at = (y: number, ym: string, id: number | null) => { const a = agg(y, (x) => x === ym, cty); return id == null ? pick(a.total) : pick(a.rolled.get(id)); };
    const shift = (ym: string) => `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;
    return monthsOfYear(year).map((ym) => ({ label: ym.slice(5), title: monthName(ym), now: Math.max(0, at(year, ym, sel)), before: Math.max(0, at(year - 1, shift(ym), sel)) }));
  }, [d.months, byCode, year, cty, sel, view, type]); // eslint-disable-line

  const inside = selAcc && d.accounts.some((a) => a.parent_id === selAcc.id);
  const ringAccounts = d.accounts.filter((a) => a.type === type && (inside ? a.parent_id === selAcc!.id : depth(a) === 1));
  const parts = ringAccounts.map((a) => ({ key: a.id, label: `${iconOf(a.code)} ${accName(a)}`, value: val(now, qsel, a.id) })).filter((p) => p.value > 0);

  // who: each community, for the chosen category and quarter
  const who = useMemo(() => active.map((c) => {
    const qs = quarters(year, c.id);
    return { c, q: val(qs, qsel, sel), year: [1, 2, 3, 4].reduce((n, q) => n + val(qs, q, sel), 0), per: [1, 2, 3, 4].map((q) => val(qs, q, sel)) };
  }).filter((x) => x.year || x.q), [d.months, byCode, year, qsel, sel, view, type]); // eslint-disable-line
  const whoYear = who.reduce((n, x) => n + x.year, 0);

  const exportIt = async () => {
    await exportExcel(`expenses-${year}.xlsx`, [{
      name: type === 'Exp' ? 'Expenses' : 'Income',
      header: [t3('الرمز', 'Code', 'Code'), t3('البند', 'Category', 'Catégorie'), 'T1', 'T2', 'T3', 'T4', t3('السنة', 'Year', 'Année')],
      rows: accounts.map((a) => [a.code, accName(a), ...[1, 2, 3, 4].map((q) => val(now, q, a.id) || null), yearOfCat(a.id) || null]),
      money: [2, 3, 4, 5, 6],
    }]);
  };
  const missingEur = view === 'ALL' && d.months.some((f) => Object.values(f.file.totals).some((v) => v.EUR)) && rates.eur == null;

  return (
    <>
      <div className="desk-head">
        <h1>{type === 'Exp' ? t3('كل النفقات بالتفصيل', 'All the expenses in detail', 'Toutes les dépenses en détail') : t3('كل الدخل بالتفصيل', 'All the income in detail', 'Tous les revenus en détail')}</h1>
        <button className="btn" onClick={exportIt}>Excel</button>
      </div>
      <div className="desk-filters">
        <button className="btn" onClick={() => setYear(year - 1)}>‹</button><span>{yearName(year)}</span><button className="btn" onClick={() => setYear(year + 1)}>›</button>
        <div className="cty-seg" style={{ margin: 0 }}>
          <button className={type === 'Exp' ? 'on' : ''} onClick={() => { setType('Exp'); setSel(null); }}>{t3('النفقات', 'Expenses', 'Dépenses')}</button>
          <button className={type === 'Income' ? 'on' : ''} onClick={() => { setType('Income'); setSel(null); }}>{t3('الدخل', 'Income', 'Revenus')}</button>
        </div>
        <select value={cty ?? 0} onChange={(e) => setCty(Number(e.target.value) || null)}>
          <option value={0}>{t3('كل الجماعات', 'All communities', 'Toutes les communautés')}</option>
          {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="cty-curs" style={{ margin: 0 }}>
          {CURS.map((c) => <button key={c} className={c === view ? 'on' : ''} onClick={() => setView(c)}>{curName(c, d.local)}</button>)}
          <button className={view === 'ALL' ? 'on' : ''} onClick={() => setView('ALL')} title={t3('كل العملات بالدولار', 'All currencies in dollars', 'Toutes les monnaies en dollars')}>{t3('الكل ≈ $', 'All ≈ $', 'Tout ≈ $')}</button>
        </div>
      </div>
      {view === 'ALL' && <p className="muted small">{t3(`كل العملات محوّلة إلى دولار: $1 = ${money(d.rates.startRate, 'LOC')} ${curName('LOC', d.local)}${d.rates.eurUsd ? `، €1 = $${d.rates.eurUsd}` : ''}. يمكنك تغيير الأسعار في «الإعدادات».`, `All currencies converted to dollars: $1 = ${money(d.rates.startRate, 'LOC')} ${curName('LOC', d.local)}${d.rates.eurUsd ? `, €1 = $${d.rates.eurUsd}` : ''}. Change the rates in “Settings”.`, `Toutes les monnaies converties en dollars : 1 $ = ${money(d.rates.startRate, 'LOC')} ${curName('LOC', d.local)}${d.rates.eurUsd ? `, 1 € = ${d.rates.eurUsd} $` : ''}. Changez les taux dans « Réglages ».`)}{missingEur ? ` ${t3('(اليورو لا سعر له: لا يُحسب)', '(euros have no rate yet: left out)', '(les euros n’ont pas de taux : exclus)')}` : ''}</p>}

      <div className="desk-tiles">
        <div className="cty-card desk-card"><div className="cty-label">{type === 'Exp' ? t3('صُرف هذه السنة', 'Spent this year', 'Dépensé cette année') : t3('دخل هذه السنة', 'Received this year', 'Reçu cette année')}</div><b className="desk-big">{money(grand, cur)}</b> <span className="muted">{curName(cur, d.local)}</span></div>
        <div className="cty-card desk-card"><div className="cty-label">{t3('مقارنة بالسنة الماضية', 'Compared with last year', "Par rapport à l'an dernier")}</div><b className="desk-big">{change == null ? '—' : `${change > 0 ? '+' : ''}${change}%`}</b> <span className="muted small">{money(yearBefore, cur)}</span></div>
        <div className="cty-card desk-card"><div className="cty-label">{t3('أكبر بند', 'Biggest category', 'Plus grosse catégorie')}</div><b>{biggest && biggest.v > 0 ? `${iconOf(biggest.a.code)} ${accName(biggest.a)}` : '—'}</b>{biggest && biggest.v > 0 && <span className="muted small"> {grand ? Math.round((biggest.v / grand) * 100) : 0}%</span>}</div>
        <div className="cty-card desk-card"><div className="cty-label">{t3('المعدّل الشهري', 'Average per month', 'Moyenne par mois')}</div><b className="desk-big">{money(Math.round(grand / Math.max(1, monthsDone)), cur)}</b> <span className="muted">{curName(cur, d.local)}</span><div className="small muted">{monthsDone} {t3('أشهر وصلت', 'months received', 'mois reçus')}</div></div>
      </div>

      <div className="desk-two">
        <div className="cty-card">
          <div className="cty-label">{selAcc ? `${iconOf(selAcc.code)} ${accName(selAcc)}` : t3('الكل', 'Everything', 'Tout')} · {t3('فصلاً بفصل', 'quarter by quarter', 'trimestre par trimestre')}</div>
          <Columns cols={cols} fmt={(n) => `${money(n, cur)} ${curName(cur, d.local)}`} />
          <div className="muted small"><i className="cty-key now" /> {t3('هذه السنة', 'this year', 'cette année')} · <i className="cty-key before" /> {t3('السنة الماضية', 'last year', "l'an dernier")}
            {selAcc && <button className="cty-link" style={{ marginInlineStart: 10 }} onClick={() => setSel(selAcc.parent_id != null && d.accounts.find((p) => p.id === selAcc.parent_id)?.parent_id != null ? selAcc.parent_id : null)}>↑ {t3('رجوع', 'up', 'remonter')}</button>}</div>
        </div>
        <div className="cty-card">
          <div className="cty-label">{t3('أين ذهب في', 'Where it went in', 'Où cela est allé au')} <span className="desk-qpick">{[1, 2, 3, 4].map((q) => <button key={q} className={q === qsel ? 'on' : ''} onClick={() => setQsel(q)}>T{q}</button>)}</span></div>
          {parts.length ? <Ring parts={parts} fmt={(n) => money(n, cur)} center={`T${qsel}`} onPick={(p) => typeof p.key === 'number' && setSel(p.key as number)} /> : <p className="muted">{t3('لا شيء.', 'Nothing.', 'Rien.')}</p>}
        </div>
      </div>

      <div className="desk-two">
        <div className="cty-card">
          <div className="cty-label">{selAcc ? accName(selAcc) : t3('الكل', 'Everything', 'Tout')} · {t3('شهراً بشهر', 'month by month', 'mois par mois')}</div>
          <Columns cols={monthly} fmt={(n) => `${money(n, cur)} ${curName(cur, d.local)}`} />
        </div>
        <div className="cty-card">
          <div className="cty-label">{t3('أي جماعة؟', 'Which community?', 'Quelle communauté ?')} · {selAcc ? accName(selAcc) : t3('الكل', 'everything', 'tout')} · T{qsel}</div>
          {who.some((x) => x.q > 0) ? <Ring parts={who.map((x) => ({ key: x.c.id, label: x.c.name, value: x.q })).filter((p) => p.value > 0)} fmt={(n) => money(n, cur)} center={`T${qsel}`} onPick={(p) => typeof p.key === 'number' && setCty(p.key as number)} /> : <p className="muted">{t3('لا شيء.', 'Nothing.', 'Rien.')}</p>}
        </div>
      </div>

      <div className="cty-card desk-scroll">
        <div className="cty-label">{t3('الجماعات', 'By community', 'Par communauté')} · {selAcc ? accName(selAcc) : t3('كل البنود', 'all categories', 'toutes les catégories')}</div>
        <table className="desk-table">
          <thead><tr><th>{t3('الجماعة', 'Community', 'Communauté')}</th>{[1, 2, 3, 4].map((q) => <th key={q} className={`num ${q === qsel ? 'qsel' : ''}`}>T{q}</th>)}<th className="num">{t3('السنة', 'Year', 'Année')}</th><th className="num">%</th></tr></thead>
          <tbody>
            {who.map((x) => (
              <tr key={x.c.id} className="click" onClick={() => setCty(cty === x.c.id ? null : x.c.id)}>
                <td><b>{x.c.name}</b></td>
                {x.per.map((v, i) => <td key={i} className={`num ${i + 1 === qsel ? 'qsel' : ''}`}>{v ? money(v, cur) : ''}</td>)}
                <td className="num"><b>{money(x.year, cur)}</b></td>
                <td className="num muted">{whoYear ? `${Math.round((x.year / whoYear) * 100)}%` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الرمز', 'Code', 'Code')}</th><th>{t3('البند', 'Category', 'Catégorie')}</th>{[1, 2, 3, 4].map((q) => <th key={q} className={`num ${q === qsel ? 'qsel' : ''}`}><button className="cty-link" onClick={() => setQsel(q)}>T{q}</button></th>)}<th className="num">{t3('السنة', 'Year', 'Année')}</th><th className="num">%</th><th className="num">{t3('السنة الماضية', 'Last year', "L'an dernier")}</th><th className="num">{t3('التغيّر', 'Change', 'Évolution')}</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className={`click ${a.id === sel ? 'picked' : ''} ${depth(a) === 0 ? 'fdc-total' : depth(a) === 1 ? 'fdc-head' : 'fdc-line'}`} onClick={() => setSel(a.id === sel ? null : a.id)}>
                <td className="muted small">{a.code}</td>
                <td style={{ paddingInlineStart: 8 + depth(a) * 14 }}>{iconOf(a.code)} {accName(a)}</td>
                {[1, 2, 3, 4].map((q) => <td key={q} className={`num ${q === qsel ? 'qsel' : ''}`}>{val(now, q, a.id) ? money(val(now, q, a.id), cur) : ''}</td>)}
                <td className="num"><b>{money(yearOfCat(a.id), cur)}</b></td>
                <td className="num muted">{grand ? `${Math.round((yearOfCat(a.id) / grand) * 100)}%` : ''}</td>
                <td className="num muted">{yearBeforeOf(a.id) ? money(yearBeforeOf(a.id), cur) : ''}</td>
                <td className={`num ${yearBeforeOf(a.id) && yearOfCat(a.id) > yearBeforeOf(a.id) ? 'out' : 'in'}`}>{yearBeforeOf(a.id) ? `${yearOfCat(a.id) > yearBeforeOf(a.id) ? '▲' : yearOfCat(a.id) < yearBeforeOf(a.id) ? '▼' : '='} ${Math.round(Math.abs((yearOfCat(a.id) - yearBeforeOf(a.id)) / yearBeforeOf(a.id)) * 100)}%` : ''}</td>
              </tr>
            ))}
            <tr className="fdc-total"><td /><td>{t3('المجموع', 'Total', 'Total')}</td>{[1, 2, 3, 4].map((q) => <td key={q} className="num">{money(val(now, q, null), cur)}</td>)}<td className="num">{money(grand, cur)}</td><td /><td className="num muted">{money(yearBefore, cur)}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">{t3('اضغط على بند ليظهر في المخطط، وعلى فصل ليظهر توزيعه، وعلى جماعة لتراها وحدها.', 'Click a category to chart it, a quarter to see its breakdown, a community to look at it alone.', 'Cliquez une catégorie pour la voir au graphique, un trimestre pour sa répartition, une communauté pour la voir seule.')}</p>
    </>
  );
}
