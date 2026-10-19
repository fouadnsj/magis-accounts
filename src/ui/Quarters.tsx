// Reports → Quarters & categories (Fouad, 19 October 2026: liked in the communities, wanted for
// the centres). Every budget heading in each quarter of the year (Q1 = Jan–Mar … Q4 = Oct–Dec,
// the centres' budget year), beside the year before, with ONE total in dollars ("All ≈ $").
// The charts answer clicks: a heading → its quarters and months beside last year, and its lines
// in the ring; a quarter → where the money went in it; and which book spent it.
import { useMemo, useState } from 'react';
import { useApp, useIcons, useNames } from '../state';
import type { Trx } from '../domain/types';
import { MONTHS_EN } from '../domain/types';
import { Columns, Ring } from '../community/ui/charts';
import { fmtSyp, fmtUsd, t } from './kit';

type Cur = 'SYP' | 'USD' | 'ALL';
const quarterOfDate = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;

export function QuartersTab() {
  const { d } = useApp();
  const names = useNames();
  const icons = useIcons();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [type, setType] = useState<'Exp' | 'Income'>('Exp');
  const [cur, setCur] = useState<Cur>('ALL');
  const [sel, setSel] = useState<number | null>(null); // a heading, or null = all
  const [qsel, setQsel] = useState(year === thisYear ? quarterOfDate(new Date().toISOString()) : 4);
  const fmt = cur === 'SYP' ? fmtSyp : fmtUsd;
  const unit = cur === 'SYP' ? t('ل.س', 'SYP') : cur === 'USD' ? '$' : '≈ $';

  /** the amount of a row in the chosen currency (ALL = everything converted to dollars at the row's rate) */
  const val = (r: Trx) => {
    if (type === 'Exp') return cur === 'SYP' ? r.exp_syp ?? 0 : cur === 'USD' ? r.exp_usd ?? 0 : d.comp.get(r.id)?.expUsdTot ?? 0;
    return cur === 'SYP' ? r.inc_syp ?? 0 : cur === 'USD' ? r.inc_usd ?? 0 : d.comp.get(r.id)?.incUsdTot ?? 0;
  };
  const rowsOf = (y: number) => d.centreRows.filter((r) => r.type === type && r.date?.startsWith(String(y)));
  const now = useMemo(() => rowsOf(year), [d.centreRows, year, type]); // eslint-disable-line
  const before = useMemo(() => rowsOf(year - 1), [d.centreRows, year, type]); // eslint-disable-line
  const inSel = (r: Trx) => sel == null || r.heading_id === sel;
  const sum = (rs: Trx[], f: (r: Trx) => boolean) => rs.reduce((n, r) => (f(r) ? n + val(r) : n), 0);
  const q = (rs: Trx[], qq: number, f: (r: Trx) => boolean = inSel) => sum(rs, (r) => quarterOfDate(r.date!) === qq && f(r));

  const headings = d.lists.headings.filter((h) => now.some((r) => r.heading_id === h.id && val(r)) || before.some((r) => r.heading_id === h.id && val(r)));
  const lines = sel == null ? [] : d.lists.lines.filter((l) => l.heading_id === sel && (now.some((r) => r.line_id === l.id && val(r)) || before.some((r) => r.line_id === l.id && val(r))));
  const grand = sum(now, () => true);
  const yearSel = sum(now, inSel);
  const beforeSel = sum(before, inSel);
  const change = beforeSel ? Math.round(((yearSel - beforeSel) / beforeSel) * 100) : null;

  const cols = [1, 2, 3, 4].map((qq) => ({ label: `Q${qq}`, title: `Q${qq} · ${year}`, now: Math.max(0, q(now, qq)), before: Math.max(0, q(before, qq)) }));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((mm) => ({
    label: mm, title: `${MONTHS_EN[Number(mm) - 1]} ${year}`,
    now: Math.max(0, sum(now, (r) => r.date!.slice(5, 7) === mm && inSel(r))),
    before: Math.max(0, sum(before, (r) => r.date!.slice(5, 7) === mm && inSel(r))),
  }));
  // the ring of the chosen quarter: its headings, or inside a heading its lines
  const parts = (sel == null
    ? headings.map((h) => ({ key: h.id, label: `${icons.heading(h.id)} ${h.name}`, value: q(now, qsel, (r) => r.heading_id === h.id) }))
    : lines.map((l) => ({ key: l.id, label: `${icons.line(l.id)} ${l.name}`, value: q(now, qsel, (r) => r.line_id === l.id) }))
  ).filter((p) => p.value > 0);
  // which book: each book's share of the chosen heading in the chosen quarter, and in the year
  const books = d.lists.books.filter((b) => now.some((r) => r.book_id === b.id));
  const who = books.map((b) => ({ b, q: q(now, qsel, (r) => r.book_id === b.id && inSel(r)), year: sum(now, (r) => r.book_id === b.id && inSel(r)) })).filter((x) => x.q || x.year);

  const table = sel == null
    ? headings.map((h) => ({ key: h.id, label: `${icons.heading(h.id)} ${h.name}`, f: (r: Trx) => r.heading_id === h.id, click: () => setSel(h.id) }))
    : lines.map((l) => ({ key: l.id, label: `${icons.line(l.id)} ${l.name}`, f: (r: Trx) => r.line_id === l.id, click: undefined }));
  const totalRow = (sel == null ? (() => true) : inSel) as (r: Trx) => boolean;

  return (
    <div className="panel">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn small" onClick={() => setYear(year - 1)}>‹</button><b>{year}</b><button className="btn small" onClick={() => setYear(year + 1)} disabled={year >= thisYear}>›</button>
        <span className="seg">
          <button className={type === 'Exp' ? 'on' : ''} onClick={() => { setType('Exp'); setSel(null); }}>{t('النفقات', 'Expenses')}</button>
          <button className={type === 'Income' ? 'on' : ''} onClick={() => { setType('Income'); setSel(null); }}>{t('الإيرادات', 'Income')}</button>
        </span>
        <span className="seg">
          <button className={cur === 'SYP' ? 'on' : ''} onClick={() => setCur('SYP')}>{t('ل.س', 'SYP')}</button>
          <button className={cur === 'USD' ? 'on' : ''} onClick={() => setCur('USD')}>$</button>
          <button className={cur === 'ALL' ? 'on' : ''} onClick={() => setCur('ALL')} title={t('كل العملات بالدولار', 'All currencies in dollars')}>{t('الكل ≈ $', 'All ≈ $')}</button>
        </span>
        {sel != null && <button className="btn small" onClick={() => setSel(null)}>‹ {t('كل البنود', 'All headings')}</button>}
      </div>
      {cur === 'ALL' && <p className="muted small" style={{ marginTop: 0 }}>{t('الليرات محوّلة إلى دولار بسعر صرف كل قيد.', 'Pounds converted to dollars at the rate of each entry.')}</p>}

      <div className="cards" style={{ marginBottom: 14 }}>
        <div className="card"><div className="k">{sel == null ? (type === 'Exp' ? t('كل النفقات', 'All expenses') : t('كل الإيرادات', 'All income')) : `${icons.heading(sel)} ${names.heading(sel)}`} · {year}</div><div className="v">{fmt(yearSel)} {unit}</div>{sel != null && grand ? <div className="v2">{Math.round((yearSel / grand) * 100)}% {t('من المجموع', 'of the total')}</div> : null}</div>
        <div className="card"><div className="k">{t('السنة السابقة', 'The year before')} · {year - 1}</div><div className="v">{fmt(beforeSel)} {unit}</div>{change != null && <div className="v2">{change > 0 ? '▲' : change < 0 ? '▼' : '='} {Math.abs(change)}%</div>}</div>
        <div className="card"><div className="k">{t('متوسط الفصل', 'Average per quarter')}</div><div className="v">{fmt(yearSel / Math.max(1, year === thisYear ? quarterOfDate(new Date().toISOString()) : 4))} {unit}</div></div>
      </div>

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div>
          <h3>{t('فصلاً بفصل، بجانب السنة السابقة', 'Quarter by quarter, beside the year before')}</h3>
          <Columns cols={cols} fmt={fmt} />
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {[1, 2, 3, 4].map((qq) => <button key={qq} className={`btn small ${qq === qsel ? 'primary' : ''}`} onClick={() => setQsel(qq)}>Q{qq}</button>)}
          </div>
          <h3 style={{ marginTop: 14 }}>{t('شهراً بشهر', 'Month by month')}</h3>
          <Columns cols={months} fmt={fmt} />
        </div>
        <div>
          <h3>{t('أين ذهب المال', 'Where the money went')} · Q{qsel}</h3>
          {parts.length ? <Ring parts={parts} fmt={fmt} center={`Q${qsel} ${year}`} onPick={(p) => sel == null && setSel(Number(p.key))} /> : <p className="muted">{t('لا شيء في هذا الفصل.', 'Nothing in this quarter.')}</p>}
          {who.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>{t('حسب الدفتر', 'By book')}</h3>
              <table className="t">
                <thead><tr><th>{t('الدفتر', 'Book')}</th><th className="n">Q{qsel}</th><th className="n">{year}</th></tr></thead>
                <tbody>{who.map((x) => <tr key={x.b.id}><td>{x.b.name}</td><td className="n">{fmt(x.q)}</td><td className="n">{fmt(x.year)}</td></tr>)}</tbody>
              </table>
            </>
          )}
        </div>
      </div>

      <h3 style={{ marginTop: 16 }}>{sel == null ? t('كل بند في كل فصل', 'Every heading in each quarter') : t('خطوط البند', 'The lines of the heading')} <span className="muted small">({unit})</span></h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="t">
          <thead><tr><th>{sel == null ? t('البند', 'Heading') : t('الخط', 'Line')}</th><th className="n">Q1</th><th className="n">Q2</th><th className="n">Q3</th><th className="n">Q4</th><th className="n">{year}</th><th className="n">%</th><th className="n">{year - 1}</th><th className="n">±</th></tr></thead>
          <tbody>
            {table.map((x) => {
              const y = sum(now, x.f);
              const b = sum(before, x.f);
              const base = sum(now, totalRow);
              return (
                <tr key={x.key} className={x.click ? 'clickable' : ''} onClick={x.click}>
                  <td>{x.label}</td>
                  {[1, 2, 3, 4].map((qq) => <td key={qq} className="n">{fmt(q(now, qq, x.f))}</td>)}
                  <td className="n"><b>{fmt(y)}</b></td>
                  <td className="n muted">{base ? `${Math.round((y / base) * 100)}%` : ''}</td>
                  <td className="n muted">{fmt(b)}</td>
                  <td className="n muted">{b ? `${y >= b ? '+' : ''}${Math.round(((y - b) / b) * 100)}%` : ''}</td>
                </tr>
              );
            })}
            <tr className="group">
              <td><b>{t('المجموع', 'Total')}</b></td>
              {[1, 2, 3, 4].map((qq) => <td key={qq} className="n"><b>{fmt(q(now, qq, totalRow))}</b></td>)}
              <td className="n"><b>{fmt(sum(now, totalRow))}</b></td><td /><td className="n muted">{fmt(sum(before, totalRow))}</td><td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
