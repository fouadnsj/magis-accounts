import { useEffect, useMemo, useState } from 'react';
import { useApp, useNames, useIcons } from '../state';
import { exchangeLog, funding, monthly, summary, inPeriod, type Period } from '../domain/reports';
import { MONTHS_AR, MONTHS_EN } from '../domain/types';
import { monthWord, tx } from '../i18n';
import type { Perm } from '../perms';
import { Seg, Tabs, errText, fmtDate, fmtPct, fmtRate, fmtSyp, fmtUsd, t, toast } from './kit';
import { BarList, EXPENSE, INCOME, MonthColumns, type Bar } from './Charts';
import { useNav } from './Shell';
import type { Trx } from '../domain/types';
import { CurrencyFrame } from './Cash';
import { QuartersTab } from './Quarters';
import { projectReport, type ProjectRow } from '../domain/projects';
import type { CentreSummary, GrantAcross } from '../domain/allCentres';
import { centreStyle } from '../brand';
import { projectXlsx } from '../io/projectExcel';
import { saveFile } from '../platform';

type Tab = 'summary' | 'explore' | 'quarters' | 'monthly' | 'accounts' | 'all' | 'funding' | 'exchange';

const monthName = (ym: string) => {
  const m = Number(ym.slice(5, 7)) - 1;
  return `${monthWord(m, MONTHS_AR, MONTHS_EN)} ${ym.slice(0, 4)}`;
};

export function Reports() {
  const { d, s, can } = useApp();
  // every centre of this server together: for who keeps the grants and manages the users, on the server
  const allCentres = s.mode === 'server' && can('lists.donors') && can('users.manage');
  const names = useNames();
  const years = useMemo(() => [...new Set(d.centreRows.map((r) => r.date?.slice(0, 4)).filter(Boolean) as string[])].sort(), [d.centreRows]);
  const lastYear = years[years.length - 1] ?? String(new Date().getFullYear());
  const first = (['summary', 'monthly', 'accounts', 'funding', 'exchange'] as Tab[]).find((x) => can(`reports.${x}` as Perm)) ?? 'summary';
  const [tab, setTab] = useState<Tab>(first);
  const [p, setP] = useState<Period>({ from: `${lastYear}-01`, to: `${lastYear}-12` });
  const year = Number(p.to.slice(0, 4));
  const yms = useMemo(() => {
    const out: string[] = [];
    for (const y of years.length ? years : [lastYear]) for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
    return out;
  }, [years, lastYear]);

  const period = (
    <div className="row">
      <span className="muted small">{t('من', 'From')}</span>
      <select className="inp" style={{ width: 'auto' }} value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })}>
        {yms.map((x) => <option key={x} value={x}>{monthName(x)}</option>)}
      </select>
      <span className="muted small">{t('إلى', 'To')}</span>
      <select className="inp" style={{ width: 'auto' }} value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })}>
        {yms.map((x) => <option key={x} value={x}>{monthName(x)}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <h1>{t('التقارير', 'Reports')}</h1>
        {period}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'summary', label: t('الملخص', 'Summary'), hidden: !can('reports.summary') },
        { value: 'explore', label: t('التحليل', 'Explore'), hidden: !can('reports.summary') },
        { value: 'quarters', label: t('الفصول والبنود', 'Quarters & categories'), hidden: !can('reports.summary') },
        { value: 'monthly', label: t('شهرياً', 'Monthly'), hidden: !can('reports.monthly') },
        { value: 'accounts', label: t('حسب المشروع', 'By project'), hidden: !can('reports.accounts') },
        { value: 'all', label: t('كل المراكز', 'All centres'), hidden: !allCentres },
        { value: 'funding', label: t('التمويل', 'Funding'), hidden: !can('reports.funding') },
        { value: 'exchange', label: t('سجل التصريف', 'Exchange log'), hidden: !can('reports.exchange') },
      ]} />
      {tab === 'funding' && can('reports.funding') && <FundingTab p={p} />}
      {can('users.manage') && <p className="muted small" style={{ margin: '-4px 0 10px' }}>{t('من يرى أي تقرير: الإدارة ← الأدوار والصلاحيات ← مجموعة «التقارير».', 'Who sees which report: Admin → Roles and permissions → the "Reports" group.')}</p>}
      {tab === 'summary' && can('reports.summary') && <SummaryTab p={p} />}
      {tab === 'explore' && can('reports.summary') && <ExploreTab p={p} />}
      {tab === 'quarters' && can('reports.summary') && <QuartersTab />}
      {tab === 'monthly' && can('reports.monthly') && <MonthlyTab year={year} />}
      {tab === 'accounts' && can('reports.accounts') && <ProjectsTab p={p} />}
      {tab === 'all' && allCentres && <AllCentresTab p={p} />}
      {tab === 'exchange' && can('reports.exchange') && <ExchangeTab p={p} names={names} />}
    </>
  );
}

function Card({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="card">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className="v2">{sub}</div>}
    </div>
  );
}

type Measure = 'eq' | 'SYP' | 'USD';

/** Every month of a period, YYYY-MM. */
function monthsBetween(p: Period): string[] {
  const out: string[] = [];
  let [y, m] = p.from.split('-').map(Number);
  const [ty, tm] = p.to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length <= 60) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

const shortMonth = (ym: string, many: boolean) => `${MONTHS_EN[Number(ym.slice(5, 7)) - 1].slice(0, 3)}${many ? ' ' + ym.slice(2, 4) : ''}`;

/**
 * Explore: choose expenses or income, a heading, a line — every chart follows the choice:
 * its lines, month by month, by account, by holder, by party, and the rows themselves.
 */
function ExploreTab({ p }: { p: Period }) {
  const { d } = useApp();
  const names = useNames();
  const icons = useIcons();
  const nav = useNav();
  const [kind, setKind] = useState<'Exp' | 'Income'>('Exp');
  const [heading, setHeading] = useState<number | null>(null);
  const [line, setLine] = useState<number | null>(null);
  const [measure, setMeasure] = useState<Measure>('eq');
  const L = d.lists;

  const fmtM = measure === 'SYP' ? fmtSyp : fmtUsd;
  const unit = measure === 'SYP' ? 'SYP' : measure === 'USD' ? 'USD' : 'USD-eq';
  const color = kind === 'Exp' ? EXPENSE : INCOME;
  const val = (r: Trx) =>
    kind === 'Exp'
      ? measure === 'SYP' ? r.exp_syp : measure === 'USD' ? r.exp_usd : d.comp.get(r.id)!.expUsdTot
      : measure === 'SYP' ? r.inc_syp : measure === 'USD' ? r.inc_usd : d.comp.get(r.id)!.incUsdTot;

  const ofKind = useMemo(() => d.centreRows.filter((r) => r.type === kind && inPeriod(r, p)), [d.centreRows, kind, p]);
  const rows = ofKind.filter((r) => (heading == null || r.heading_id === heading) && (line == null || r.line_id === line)).filter((r) => val(r) !== 0);
  const total = rows.reduce((a, r) => a + val(r), 0);
  const allTotal = ofKind.reduce((a, r) => a + val(r), 0);
  const months = monthsBetween(p);
  const many = months.length > 12;

  const group = (key: (r: Trx) => number | null, label: (k: number) => string): Bar[] => {
    const m = new Map<number, number>();
    for (const r of rows) {
      const k = key(r) ?? -1;
      m.set(k, (m.get(k) ?? 0) + val(r));
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, label: k === -1 ? '—' : label(k), value: v }));
  };

  const headingOpts = L.headings.filter((h) => L.headingTypes.some((x) => x.heading_id === h.id && x.type === kind));
  const lineOpts = heading == null ? [] : L.lines.filter((l) => l.heading_id === heading);
  const title = line != null ? names.line(line) : heading != null ? names.heading(heading) : kind === 'Exp' ? t('كل النفقات', 'All expenses') : t('كل الإيرادات', 'All income');
  const byParty = group((r) => r.party_id, names.party).sort((a, b) => b.value - a.value).slice(0, 12);

  return (
    <>
      <div className="panel explore-bar">
        <Seg<'Exp' | 'Income'> value={kind} onChange={(k) => { setKind(k); setHeading(null); setLine(null); }} options={[
          { value: 'Exp', label: t('النفقات', 'Expenses') },
          { value: 'Income', label: t('الإيرادات', 'Income') },
        ]} />
        <select className="inp" value={heading ?? ''} onChange={(e) => { setHeading(e.target.value ? Number(e.target.value) : null); setLine(null); }}>
          <option value="">{t('كل البنود', 'All headings')}</option>
          {headingOpts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <select className="inp" value={line ?? ''} disabled={heading == null} onChange={(e) => setLine(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t('كل الخطوط', 'All lines')}</option>
          {lineOpts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <Seg<Measure> value={measure} onChange={setMeasure} options={[
          { value: 'eq', label: t('الكل بالدولار', 'All in USD') },
          { value: 'SYP', label: t('ليرة فقط', 'SYP only') },
          { value: 'USD', label: t('دولار فقط', 'USD only') },
        ]} />
        {(heading != null || line != null) && <button className="btn small ghost" onClick={() => { setHeading(null); setLine(null); }}>✕ {t('مسح', 'Clear')}</button>}
      </div>

      <h2>{title}</h2>
      <div className="cards" style={{ marginBottom: 16 }}>
        <Card k={t('المجموع', 'Total')} v={fmtM(total)} sub={unit} />
        <Card k={t('عدد الحركات', 'Rows')} v={String(rows.length)} />
        <Card k={t('المعدّل الشهري', 'Average per month')} v={fmtM(total / Math.max(1, months.length))} sub={unit} />
        <Card k={kind === 'Exp' ? t('من كل النفقات', 'Share of all expenses') : t('من كل الإيرادات', 'Share of all income')} v={allTotal ? fmtPct(total / allTotal) : '-'} />
      </div>

      <div className="grid2 dash-charts">
        {line == null && (
          <div className="panel">
            {heading == null ? (
              <>
                <h3>{t('حسب البند', 'By heading')} <span className="muted small">· {unit} · {t('اضغط لتفتح', 'click to open')}</span></h3>
                <BarList bars={group((r) => r.heading_id, (k) => `${icons.heading(k)} ${names.heading(k)}`)} color={color} fmt={fmtM} unit={unit} onPick={(b) => b.key !== -1 && setHeading(Number(b.key))} empty={t('لا شيء', 'Nothing')} />
              </>
            ) : (
              <>
                <h3>{t('حسب الخط', 'By line')} <span className="muted small">· {unit} · {t('اضغط لتفتح', 'click to open')}</span></h3>
                <BarList bars={group((r) => r.line_id, (k) => `${icons.line(k)} ${names.line(k)}`)} color={color} fmt={fmtM} unit={unit} onPick={(b) => b.key !== -1 && setLine(Number(b.key))} empty={t('لا شيء', 'Nothing')} />
              </>
            )}
          </div>
        )}
        <div className="panel">
          <h3>{t('شهراً بشهر', 'Month by month')} <span className="muted small">· {unit}</span></h3>
          <MonthColumns
            labels={months.map((m) => shortMonth(m, many))}
            series={[{ name: title, color, values: months.map((m) => rows.filter((r) => r.date?.startsWith(m)).reduce((a, r) => a + val(r), 0)) }]}
            fmt={(n) => (measure === 'SYP' ? fmtSyp(n) : Math.round(n).toLocaleString('en-US'))} unit={unit} />
        </div>
        <div className="panel">
          <h3>{t('حسب الحساب', 'By account')} <span className="muted small">· {unit}</span></h3>
          <BarList bars={group((r) => r.account_id, names.account)} color={color} fmt={fmtM} unit={unit} empty={t('لا شيء', 'Nothing')} />
        </div>
        <div className="panel">
          <h3>{t('حسب الصندوق', 'By holder')} <span className="muted small">· {unit}</span></h3>
          <BarList bars={group((r) => r.book_id, names.book)} color={color} fmt={fmtM} unit={unit} empty={t('لا شيء', 'Nothing')} />
        </div>
        <div className="panel">
          <h3>{kind === 'Exp' ? t('لمن دُفع', 'Paid to') : t('ممّن قُبض', 'Received from')} <span className="muted small">· {unit} · {t('أعلى 12', 'top 12')}</span></h3>
          <BarList bars={byParty} color={color} fmt={fmtM} unit={unit} empty={t('لا شيء', 'Nothing')} />
        </div>
      </div>

      <div className="panel">
        <h3>{t('السطور', 'The rows')} <span className="muted small">· {rows.length}</span></h3>
        <div className="tbl-wrap" style={{ maxHeight: 420 }}>
          <table className="t">
            <thead><tr><th>N</th><th>{t('التاريخ', 'Date')}</th><th>{t('الصندوق', 'Holder')}</th><th>{t('الخط', 'Line')}</th><th>{t('الشرح', 'Explanation')}</th><th>{t('الجهة', 'Party')}</th><th className="n">{unit}</th></tr></thead>
            <tbody>
              {[...rows].sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : -1)).map((r) => (
                <tr key={r.id} className="click" onClick={() => nav.entry(r)}>
                  <td className="code">{d.attachments.some((x) => x.trx_id === r.id) ? '📎' : ''}{r.n == null ? '' : String(r.n).padStart(4, '0')}</td>
                  <td className="nowrap">{fmtDate(r.date)}</td><td>{names.book(r.book_id)}</td><td>{icons.line(r.line_id)} {names.line(r.line_id)}</td>
                  <td>{r.explanation}</td><td>{names.party(r.party_id)}</td><td className="n">{fmtM(val(r))}</td>
                </tr>
              ))}
              <tr className="total"><td colSpan={6}>{t('المجموع', 'Total')}</td><td className="n">{fmtM(total)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** The dashboard: the figures of the period in three separate frames (pounds, dollars,
 *  all in dollars), the top lines, and charts — expenses by heading (click to see its
 *  lines), income by line, and the months. */
function SummaryTab({ p }: { p: Period }) {
  const { d } = useApp();
  const names = useNames();
  const icons = useIcons();
  const s = summary(d.centreRows, d.comp, d.lists, p);
  const undated = d.centreRows.filter((r) => !r.date).length;
  const [measure, setMeasure] = useState<Measure>('eq');
  const [heading, setHeading] = useState<number | null>(null);
  const rs = useMemo(() => d.centreRows.filter((r) => inPeriod(r, p)), [d.centreRows, p]);

  const fmtM = measure === 'SYP' ? fmtSyp : fmtUsd;
  const unit = measure === 'SYP' ? 'SYP' : measure === 'USD' ? 'USD' : 'USD-eq';
  const inc = (r: (typeof rs)[number]) => (measure === 'SYP' ? r.inc_syp : measure === 'USD' ? r.inc_usd : d.comp.get(r.id)!.incUsdTot);
  const exp = (r: (typeof rs)[number]) => (measure === 'SYP' ? r.exp_syp : measure === 'USD' ? r.exp_usd : d.comp.get(r.id)!.expUsdTot);

  const sumBy = (pick: (r: (typeof rs)[number]) => boolean, key: (r: (typeof rs)[number]) => number | null, val: (r: (typeof rs)[number]) => number, label: (k: number) => string) => {
    const m = new Map<number, number>();
    for (const r of rs) {
      if (!pick(r)) continue;
      const k = key(r);
      if (k == null) continue;
      m.set(k, (m.get(k) ?? 0) + val(r));
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, label: label(k), value: v }));
  };
  const byHeading = sumBy((r) => r.type === 'Exp', (r) => r.heading_id, exp, (k) => `${icons.heading(k)} ${names.heading(k)}`);
  const linesOf = heading == null ? [] : sumBy((r) => r.type === 'Exp' && r.heading_id === heading, (r) => r.line_id, exp, (k) => `${icons.line(k)} ${names.line(k)}`);
  const byIncomeLine = sumBy((r) => r.type === 'Income', (r) => r.line_id, inc, (k) => `${icons.line(k)} ${names.line(k)}`);

  const monthsInPeriod = useMemo(() => {
    const out: string[] = [];
    let [y, m] = p.from.split('-').map(Number);
    const [ty, tm] = p.to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
      if (out.length > 60) break;
    }
    return out;
  }, [p]);
  const cols = monthsInPeriod.map((ym) => {
    const mr = rs.filter((r) => r.date?.startsWith(ym));
    return {
      label: `${MONTHS_EN[Number(ym.slice(5, 7)) - 1].slice(0, 3)}${monthsInPeriod.length > 12 ? ' ' + ym.slice(2, 4) : ''}`,
      income: mr.filter((r) => r.type === 'Income').reduce((a, r) => a + inc(r), 0),
      expense: mr.filter((r) => r.type === 'Exp').reduce((a, r) => a + exp(r), 0),
    };
  });
  const headingTotal = byHeading.find((b) => b.key === heading)?.value ?? 0;

  const Fig = ({ k, v, f, strong }: { k: string; v: number; f: (n: number) => string; strong?: boolean }) => (
    <div className={`fig ${v < 0 ? 'neg' : ''} ${strong ? 'strong' : ''}`}><span>{k}</span><b>{f(v)}</b></div>
  );

  return (
    <>
      <div className="dash-frames">
        <div className="panel dash-frame SYP">
          <div className="cur-head"><span className="cur-chip">SYP</span><h3>{t('ليرة سورية', 'Syrian pounds')}</h3></div>
          <Fig k={t('إيرادات', 'Income')} v={s.incSyp} f={fmtSyp} />
          <Fig k={t('نفقات', 'Expenses')} v={s.expSyp} f={fmtSyp} />
          <Fig k={t('الصافي', 'Net')} v={s.incSyp - s.expSyp} f={fmtSyp} strong />
        </div>
        <div className="panel dash-frame USD">
          <div className="cur-head"><span className="cur-chip">USD</span><h3>{t('دولار', 'US dollars')}</h3></div>
          <Fig k={t('إيرادات', 'Income')} v={s.incUsd} f={fmtUsd} />
          <Fig k={t('نفقات', 'Expenses')} v={s.expUsd} f={fmtUsd} />
          <Fig k={t('الصافي', 'Net')} v={s.incUsd - s.expUsd} f={fmtUsd} strong />
        </div>
        <div className="panel dash-frame EQ">
          <div className="cur-head"><span className="cur-chip">USD-eq</span><h3>{t('الكل بالدولار', 'All, in dollars')}</h3></div>
          <Fig k={t('إيرادات', 'Income')} v={s.incEq} f={fmtUsd} />
          <Fig k={t('نفقات', 'Expenses')} v={s.expEq} f={fmtUsd} />
          <Fig k={t('الصافي', 'Net')} v={s.incEq - s.expEq} f={fmtUsd} strong />
          <div className="muted small" style={{ marginTop: 6 }}>{t('الليرات محوّلة بسعر التصريف لكل سطر', 'Pounds converted at each row\'s exchange rate')}</div>
        </div>
      </div>

      <div className="cards" style={{ marginBottom: 16 }}>
        {s.topHeading && <Card k={t('أعلى بند نفقات (بالدولار)', 'Top expense heading (USD-eq)')} v={fmtUsd(s.topHeading.amount)} sub={s.topHeading.name} />}
        {s.topIncomeLine && <Card k={t('أعلى خط إيرادات (بالدولار)', 'Top income line (USD-eq)')} v={fmtUsd(s.topIncomeLine.amount)} sub={s.topIncomeLine.name} />}
        <Card k={t('عدد الحركات', 'Rows')} v={String(s.count)} />
        <Card k={t('نسبة النفقات إلى الإيرادات', 'Expenses / income')} v={s.incEq ? fmtPct(s.expEq / s.incEq) : '-'} />
        <Card k={t('بلا خط موازنة', 'No budget line')} v={String(s.noLine)} />
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('الرسوم', 'Charts')}</h2>
        <Seg<Measure> value={measure} onChange={setMeasure} options={[
          { value: 'eq', label: t('الكل بالدولار', 'All in USD') },
          { value: 'SYP', label: t('ليرة فقط', 'SYP only') },
          { value: 'USD', label: t('دولار فقط', 'USD only') },
        ]} />
      </div>

      <div className="grid2 dash-charts">
        <div className="panel">
          {heading == null ? (
            <>
              <h3>{t('النفقات حسب البند', 'Expenses by heading')} <span className="muted small">· {unit} · {t('اضغط على بند لترى خطوطه', 'click a heading to see its lines')}</span></h3>
              <BarList bars={byHeading} color={EXPENSE} fmt={fmtM} unit={unit} onPick={(b) => setHeading(Number(b.key))} empty={t('لا نفقات في هذه الفترة', 'No expenses in this period')} />
            </>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>{icons.heading(heading)} {names.heading(heading)} <span className="muted small">· {fmtM(headingTotal)} {unit} · {linesOf.length} {t('خطوط', 'lines')}</span></h3>
                <button className="btn small" onClick={() => setHeading(null)}>← {t('كل البنود', 'All headings')}</button>
              </div>
              <div style={{ marginTop: 10 }}>
                <BarList bars={linesOf} color={EXPENSE} fmt={fmtM} unit={unit} empty={t('لا شيء', 'Nothing')} />
              </div>
            </>
          )}
        </div>
        <div className="panel">
          <h3>{t('الإيرادات حسب الخط', 'Income by line')} <span className="muted small">· {unit}</span></h3>
          <BarList bars={byIncomeLine} color={INCOME} fmt={fmtM} unit={unit} empty={t('لا إيرادات في هذه الفترة', 'No income in this period')} />
        </div>
      </div>

      <div className="panel">
        <h3>{t('شهراً بشهر', 'Month by month')} <span className="muted small">· {unit}</span></h3>
        <MonthColumns
          labels={cols.map((c) => c.label)}
          series={[
            { name: t('إيرادات', 'Income'), color: INCOME, values: cols.map((c) => c.income) },
            { name: t('نفقات', 'Expenses'), color: EXPENSE, values: cols.map((c) => c.expense) },
          ]}
          fmt={(n) => (measure === 'SYP' ? fmtSyp(n) : Math.round(n).toLocaleString('en-US'))} unit={unit} />
      </div>
      {undated > 0 && <p className="warn small">{t(`${undated} سطراً بلا تاريخ غير محسوبة في أي فترة`, `${undated} undated rows are not counted in any period`)}</p>}
    </>
  );
}

/** Monthly: pounds, dollars and the dollar equivalent in three separate tables. */
function MonthlyTab({ year }: { year: number }) {
  const { d } = useApp();
  const ls = monthly(d.centreRows, d.comp, year);
  const sum = (f: (l: (typeof ls)[number]) => number) => ls.reduce((a, l) => a + f(l), 0);
  const block = (cur: 'SYP' | 'USD') => {
    const f = cur === 'SYP' ? fmtSyp : fmtUsd;
    const inc = (l: (typeof ls)[number]) => (cur === 'SYP' ? l.incSyp : l.incUsd);
    const exp = (l: (typeof ls)[number]) => (cur === 'SYP' ? l.expSyp : l.expUsd);
    const cum = (l: (typeof ls)[number]) => (cur === 'SYP' ? l.cumSyp : l.cumUsd);
    return (
      <CurrencyFrame cur={cur}>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>{t('الشهر', 'Month')}</th><th className="n">{t('إيرادات', 'Income')}</th><th className="n">{t('نفقات', 'Expenses')}</th><th className="n">{t('الصافي', 'Net')}</th><th className="n">{t('التراكمي', 'Cumulative')}</th></tr></thead>
            <tbody>
              {ls.map((l) => (
                <tr key={l.ym} className={l.count ? '' : 'off'}>
                  <td>{monthName(l.ym)}</td><td className="n">{f(inc(l))}</td><td className="n">{f(exp(l))}</td><td className="n">{f(inc(l) - exp(l))}</td><td className="n">{f(cum(l))}</td>
                </tr>
              ))}
              <tr className="total"><td>{year}</td><td className="n">{f(sum(inc))}</td><td className="n">{f(sum(exp))}</td><td className="n">{f(sum(inc) - sum(exp))}</td><td /></tr>
            </tbody>
          </table>
        </div>
      </CurrencyFrame>
    );
  };
  return (
    <>
      {block('SYP')}
      {block('USD')}
      <div className="panel cur-frame EQ">
        <div className="cur-head"><span className="cur-chip">USD-eq</span><h2>{t('الكل بالدولار', 'All, in dollars')}</h2></div>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>{t('الشهر', 'Month')}</th><th className="n">{t('إيرادات', 'Income')}</th><th className="n">{t('نفقات', 'Expenses')}</th><th className="n">{t('الصافي', 'Net')}</th><th className="n">{t('عدد الحركات', 'Rows')}</th></tr></thead>
            <tbody>
              {ls.map((l) => (
                <tr key={l.ym} className={l.count ? '' : 'off'}>
                  <td>{monthName(l.ym)}</td><td className="n">{fmtUsd(l.incEq)}</td><td className="n">{fmtUsd(l.expEq)}</td><td className="n">{fmtUsd(l.incEq - l.expEq)}</td><td className="n">{l.count}</td>
                </tr>
              ))}
              <tr className="total"><td>{year}</td><td className="n">{fmtUsd(sum((l) => l.incEq))}</td><td className="n">{fmtUsd(sum((l) => l.expEq))}</td><td className="n">{fmtUsd(sum((l) => l.incEq - l.expEq))}</td><td className="n">{sum((l) => l.count)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/**
 * The centre by project (Fouad, 2026-11-01): each project with its grant (for who sees the grants),
 * what was received, spent in the period and since the beginning, what is left; line by line on
 * opening; what is not funded; the projects outside the budget (Deir) apart. Excel for the donor.
 */
function ProjectsTab({ p }: { p: Period }) {
  const { d, s, can } = useApp();
  const names = useNames();
  const icons = useIcons();
  const [open, setOpen] = useState<string | null>(null);
  const report = useMemo(() => projectReport({ rows: d.centreRows, comp: d.comp, lists: d.lists, grants: d.grants, grantParts: d.grantParts, grantShares: d.grantShares, period: p }), [d, p]);
  const inside = report.filter((x) => !x.outside);
  const outside = report.filter((x) => x.outside);
  const total = inside.reduce((t, x) => t + x.spent, 0);
  const notFunded = report.find((x) => x.id == null)?.spent ?? 0;
  const money = (n: number, cur: string) => `${cur === 'EUR' ? '€' : '$'}${fmtUsd(n)}`;
  const label = (x: ProjectRow) => (x.id == null ? t('غير ممول', 'Not funded') : x.name);
  const excel = async (x: ProjectRow) => {
    try {
      const docs = new Map<string, string[]>();
      for (const at of d.attachments) docs.set(at.trx_id, [...(docs.get(at.trx_id) ?? []), at.name]);
      const bytes = await projectXlsx({ project: x, period: p, organisation: s.organisation, lists: d.lists, comp: d.comp, docs });
      const path = await saveFile(`${(x.id == null ? 'not-funded' : x.name).replace(/[^\p{L}\p{N}]+/gu, '-')}-${p.from}-${p.to}.xlsx`, ['xlsx'], bytes, t('احفظ ملف Excel', 'Save the Excel file'));
      if (path) toast(t('حُفظ', 'Saved') + ': ' + path);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const rowOf = (x: ProjectRow) => {
    const k = String(x.id);
    return [
      <tr key={k} className={x.id == null ? 'group' : ''}>
        <td>
          <button className="btn small ghost" onClick={() => setOpen(open === k ? null : k)}>{open === k ? '▾' : '▸'}</button>{' '}
          <b className={x.id == null ? 'bad' : ''}>{label(x)}</b>
        </td>
        <td className="small">
          {x.grant ? <>{names.donor(x.grant.donor_id)}{x.grant.reference ? <span className="muted"> · {x.grant.reference}</span> : null}{x.share != null ? <span className="muted ltr"> · {money(x.share, x.grant.currency)}</span> : null}</> : x.id == null || !can('lists.donors') ? '' : <span className="muted">{t('خاص', 'Private')}</span>}
        </td>
        <td className="n">{x.received == null ? '—' : fmtUsd(x.received)}</td>
        <td className="n">{fmtUsd(x.spent)}</td>
        <td className="n muted">{fmtUsd(x.spentAll)}</td>
        <td className={`n ${x.left != null && x.left < -0.5 ? 'bad' : ''}`}>{x.left == null ? '—' : fmtUsd(x.left)}</td>
        <td className="right"><button className="btn small" disabled={!x.expenses.length} onClick={() => excel(x)}>Excel</button></td>
      </tr>,
      open === k ? (
        <tr key={`${k}-lines`} className="items-row">
          <td colSpan={7}>
            <table className="t">
              <tbody>
                {x.lines.map((l) => (
                  <tr key={`${l.line_id}`}>
                    <td>{l.heading_id != null ? `${icons.heading(l.heading_id)} ${names.heading(l.heading_id)} › ` : ''}{l.line_id != null ? names.line(l.line_id) : '—'}</td>
                    <td className="n muted">{l.rows}</td>
                    <td className="n">{fmtUsd(l.spent)}</td>
                  </tr>
                ))}
                {!x.lines.length && <tr><td className="muted">{t('لا مصاريف في هذه الفترة', 'No expenses in this period')}</td></tr>}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null,
    ];
  };
  const head = (
    <thead><tr>
      <th>{t('المشروع', 'Project')}</th><th>{t('المنحة', 'Grant')}</th><th className="n">{t('استُلم باليد', 'Received in hand')} $</th>
      <th className="n">{t('صُرف في الفترة', 'Spent in the period')} $</th><th className="n">{t('صُرف منذ البداية', 'Spent since the beginning')} $</th><th className="n">{t('الباقي', 'Left')} $</th><th />
    </tr></thead>
  );
  return (
    <>
      <div className="cards" style={{ marginBottom: 14 }}>
        <Card k={t('مصاريف المركز في الفترة', "The centre's expenses in the period")} v={`$${fmtUsd(total)}`} />
        <Card k={t('لها مشروع', 'With a project')} v={`$${fmtUsd(total - notFunded)}`} />
        <Card k={t('غير ممول', 'Not funded')} v={`$${fmtUsd(notFunded)}`} />
      </div>
      <div className="tbl-wrap">
        <table className="t">{head}<tbody>{inside.flatMap(rowOf)}</tbody></table>
      </div>
      {outside.length > 0 && (
        <>
          <h3>{t('خارج الموازنة', 'Outside the budget')}</h3>
          <div className="tbl-wrap"><table className="t">{head}<tbody>{outside.flatMap(rowOf)}</tbody></table></div>
        </>
      )}
      <p className="muted small">{t('الليرات بالدولار بسعر كل نفقة. «الباقي» = ما استُلم باليد ناقص كل ما صُرف على المشروع منذ البداية. مصروف المشروع يأتي من خط الموازنة.', 'Pounds are in dollars at the rate of each expense. "Left" = what was received in hand minus all that was spent on the project since the beginning. A project\'s spending comes from the budget line.')}</p>
    </>
  );
}

/**
 * Every centre of this server together (Fouad, 2026-11-01): what each spent, with a project and not funded, its
 * projects; and each grant across the centres it covers (matched by its contract number), with each centre's share,
 * project and spending. A copy of another centre's database brought to this server counts like the others.
 */
function AllCentresTab({ p }: { p: Period }) {
  const [r, setR] = useState<{ centres: CentreSummary[]; grants: GrantAcross[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setR(null);
    setErr(null);
    fetch('/api/all-centres', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
      .then(async (x) => (x.ok ? setR(await x.json()) : setErr(t('غير مسموح', 'Not allowed'))))
      .catch((e) => setErr(String(e)));
  }, [p]);
  if (err) return <div className="alert err">{err}</div>;
  if (!r) return <p className="muted">…</p>;
  const name = (c: { centre: string; organisation: string }) => `${tx(centreStyle(c.centre).name)} · ${c.organisation}`;
  const money = (n: number, cur: string) => `${cur === 'EUR' ? '€' : '$'}${fmtUsd(n)}`;
  const sum = (f: (c: CentreSummary) => number) => r.centres.reduce((a, c) => a + f(c), 0);
  return (
    <>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>{t('المركز', 'Centre')}</th><th className="n">{t('مصاريف الفترة', 'Spent in the period')} $</th><th className="n">{t('لها مشروع', 'With a project')} $</th><th className="n">{t('غير ممول', 'Not funded')} $</th><th className="n">{t('خارج الموازنة', 'Outside the budget')} $</th></tr></thead>
          <tbody>
            {r.centres.map((c) => (
              <tr key={c.slug}><td><b style={{ color: centreStyle(c.centre).deep }}>{name(c)}</b></td><td className="n">{fmtUsd(c.spent)}</td><td className="n">{fmtUsd(c.withProject)}</td><td className={`n ${c.notFunded > 0.5 ? 'bad' : ''}`}>{fmtUsd(c.notFunded)}</td><td className="n muted">{fmtUsd(c.outside)}</td></tr>
            ))}
            <tr className="group"><td><b>{t('المجموع', 'Total')}</b></td><td className="n"><b>{fmtUsd(sum((c) => c.spent))}</b></td><td className="n"><b>{fmtUsd(sum((c) => c.withProject))}</b></td><td className="n"><b>{fmtUsd(sum((c) => c.notFunded))}</b></td><td className="n muted">{fmtUsd(sum((c) => c.outside))}</td></tr>
          </tbody>
        </table>
      </div>

      <h3>{t('المنح عبر المراكز', 'Grants across the centres')}</h3>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>{t('المنحة', 'Grant')}</th><th className="n">{t('المبلغ', 'Amount')}</th>{r.centres.map((c) => <th key={c.slug}>{name(c)}</th>)}</tr></thead>
          <tbody>
            {r.grants.map((g, i) => (
              <tr key={i}>
                <td><b>{g.donor}</b>{g.reference ? <span className="muted"> · {g.reference}</span> : <div className="muted small">{t('بلا رقم عقد: مطابقة بالمانح والمبلغ', 'no contract number: matched by donor and amount')}</div>}</td>
                <td className="n ltr">{money(g.amount, g.currency)}</td>
                {r.centres.map((c) => {
                  const share = g.shares.find((x) => x.centre === c.centre);
                  const here = g.centres.find((x) => x.slug === c.slug);
                  return (
                    <td key={c.slug} className="small">
                      {share ? <div className="ltr">{t('الحصة', 'Share')} {money(share.amount, g.currency)}</div> : null}
                      {here ? <>
                        <div>{here.project ?? <span className="bad">{t('لا مشروع', 'no project')}</span>}</div>
                        <div className="muted">{here.received != null ? `${t('استُلم', 'received')} $${fmtUsd(here.received)} · ` : ''}{t('صُرف', 'spent')} ${fmtUsd(here.spentAll)}</div>
                      </> : share ? <div className="bad">{t('غير مكتوبة في هذا المركز', 'not written in this centre')}</div> : <span className="muted">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!r.grants.length && <tr><td colSpan={2 + r.centres.length} className="muted">{t('لا منح', 'No grants')}</td></tr>}
          </tbody>
        </table>
      </div>

      {r.centres.map((c) => (
        <div key={c.slug}>
          <h3 style={{ color: centreStyle(c.centre).deep }}>{name(c)}</h3>
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>{t('المشروع', 'Project')}</th><th>{t('المنحة', 'Grant')}</th><th className="n">{t('استُلم باليد', 'Received in hand')} $</th><th className="n">{t('صُرف في الفترة', 'Spent in the period')} $</th><th className="n">{t('صُرف منذ البداية', 'Spent since the beginning')} $</th><th className="n">{t('الباقي', 'Left')} $</th></tr></thead>
              <tbody>
                {c.projects.map((x) => (
                  <tr key={x.name}><td><b>{x.name}</b></td><td className="small">{x.donor ? <>{x.donor}{x.reference ? <span className="muted"> · {x.reference}</span> : null}</> : <span className="muted">{t('خاص', 'Private')}</span>}</td>
                    <td className="n">{x.received == null ? '—' : fmtUsd(x.received)}</td><td className="n">{fmtUsd(x.spent)}</td><td className="n muted">{fmtUsd(x.spentAll)}</td><td className={`n ${x.left != null && x.left < -0.5 ? 'bad' : ''}`}>{x.left == null ? '—' : fmtUsd(x.left)}</td></tr>
                ))}
                <tr><td><b className="bad">{t('غير ممول', 'Not funded')}</b></td><td /><td /><td className="n">{fmtUsd(c.notFunded)}</td><td /><td /></tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="muted small">{t('كل قواعد المراكز على هذا الخادم. لإضافة مركز يعمل على حاسوبه: انسخ نسخته الاحتياطية وأضفها هنا قاعدةً بجانب الأخرى. المنحة نفسها تُطابَق برقم العقد.', "Every centre database on this server. To add a centre that works on its own computer: bring its backup and add it here as a database beside the others. The same grant is matched by its contract number.")}</p>
    </>
  );
}

function ExchangeTab({ p, names }: { p: Period; names: ReturnType<typeof useNames> }) {
  const { d } = useApp();
  const ex = exchangeLog(d.centreRows, p);
  return (
    <div className="tbl-wrap">
      <table className="t">
        <thead><tr><th>{t('التاريخ', 'Date')}</th><th>{t('الصندوق', 'Holder')}</th><th className="n">{t('دولار خرج', 'USD given')}</th><th className="n">{t('ليرة دخلت', 'SYP received')}</th><th className="n">{t('السعر', 'Rate')}</th><th>{t('الشرح', 'Explanation')}</th></tr></thead>
        <tbody>
          <tr className="total"><td colSpan={2}>{t('المجموع', 'Total')} · {ex.rows.length}</td><td className="n">{fmtUsd(ex.usd)}</td><td className="n">{fmtSyp(ex.syp)}</td><td className="n">{ex.usd ? fmtRate(ex.syp / ex.usd) : '-'}</td><td /></tr>
          {ex.rows.map((x) => (
            <tr key={x.trx.id}><td>{fmtDate(x.trx.date)}</td><td>{names.book(x.trx.book_id)}</td><td className="n">{fmtUsd(x.usdOut)}</td><td className="n">{fmtSyp(x.sypIn)}</td><td className="n">{fmtRate(x.rate)}</td><td>{x.trx.explanation}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FundingTab({ p }: { p: Period }) {
  const { d } = useApp();
  const f = funding(d.rows, d.comp, d.lists, d.grantsBookId, p);
  const s = f.total;
  const pct = (x: number) => fmtPct(x);
  return (
    <>
      <div className="alert info small">{t(
        'سرّي · نفقات المركز (كل الدفاتر، ومنها دفترك) وكيف تُدفع: بإيراد المركز الذاتي، وبما يرسله دفتر المسؤول (المنح، الرهبنة). دفتر المسؤول خارج المركز.',
        "Confidential · The centre's expenses (every book, yours too) and how they are paid: by the centre's own income, and by what the Respo book sends (grants, the Province). The Respo book is outside the centre.")}</div>
      {d.grantsBookId == null && <div className="alert warn small">{t('لا دفتر للمسؤول بعد', 'No Respo book yet')}</div>}
      <div className="cards">
        <Card k={t('نفقات المركز', "Centre's expenses")} v={fmtUsd(s.expenses)} />
        <Card k={t('إيراد ذاتي', 'Own income')} v={fmtUsd(s.own)} sub={pct(s.pctOwn)} />
        <Card k={t('من المسؤول', 'From the Respo')} v={fmtUsd(s.fromRespo)} sub={pct(s.pctRespo)} />
        <Card k={t('فائض / (عجز)', 'Surplus / (shortfall)')} v={fmtUsd(s.surplus)} sub={s.expenses ? `${pct(Math.max(0, 1 - s.pctOwn - s.pctRespo))} ${t('غير مغطى', 'not covered')}` : undefined} />
        <Card k={t('وصل إلى المسؤول', 'Reached the Respo')} v={fmtUsd(s.respoGrants + s.respoOther)} sub={`${t('منح', 'grants')} ${fmtUsd(s.respoGrants)} · ${t('غيرها', 'other')} ${fmtUsd(s.respoOther)}`} />
        <Card k={t('لدى المسؤول', 'With the Respo')} v={`${fmtUsd(f.respoUsd)} USD`} sub={`${fmtSyp(f.respoSyp)} SYP`} />
      </div>
      <h3 style={{ marginTop: 18 }}>{t('حسب الشهر', 'By month')} (USD-eq)</h3>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr>
            <th>{t('الشهر', 'Month')}</th><th className="n">{t('نفقات', 'Expenses')}</th><th className="n">{t('إيراد ذاتي', 'Own income')}</th><th className="n">% {t('ذاتي', 'own')}</th>
            <th className="n">{t('من المسؤول', 'From the Respo')}</th><th className="n">% {t('المسؤول', 'Respo')}</th><th className="n">{t('فائض/(عجز)', 'Surplus')}</th>
            <th className="n">{t('منح وصلت', 'Grants in')}</th><th className="n">{t('غيرها وصل', 'Other in')}</th>
          </tr></thead>
          <tbody>
            {[...f.byMonth, s].map((m) => (
              <tr key={m.ym || 'total'} className={m.ym ? (m.expenses || m.own || m.fromRespo || m.respoGrants || m.respoOther ? '' : 'off') : 'total'}>
                <td>{m.ym ? monthName(m.ym) : <b>{t('المجموع', 'Total')}</b>}</td>
                <td className="n">{fmtUsd(m.expenses)}</td><td className="n">{fmtUsd(m.own)}</td><td className="n">{m.expenses ? pct(m.pctOwn) : ''}</td>
                <td className="n">{fmtUsd(m.fromRespo)}</td><td className="n">{m.expenses ? pct(m.pctRespo) : ''}</td>
                <td className={`n ${m.surplus < -0.5 ? 'bad' : ''}`}>{fmtUsd(m.surplus)}</td>
                <td className="n">{fmtUsd(m.respoGrants)}</td><td className="n">{fmtUsd(m.respoOther)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 18 }}>{t('حسب البند', 'By heading')} (USD-eq)</h3>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>{t('البند', 'Heading')}</th><th className="n">{t('المجموع', 'Total')}</th><th className="n">%</th><th className="n">{t('ذاتي', 'Own')}</th><th className="n">{t('المسؤول', 'Respo')}</th><th className="n">{t('غير مغطى', 'Not covered')}</th></tr></thead>
          <tbody>
            {f.byHeading.map((h) => (
              <tr key={h.headingId ?? 'none'}>
                <td>{h.headingId == null ? t('بلا بند', 'No heading') : h.name}</td>
                <td className="n"><b>{fmtUsd(h.total)}</b></td><td className="n">{pct(h.share)}</td>
                <td className="n">{fmtUsd(h.total * s.pctOwn)}</td><td className="n">{fmtUsd(h.total * s.pctRespo)}</td>
                <td className="n">{fmtUsd(h.total * Math.max(0, 1 - s.pctOwn - s.pctRespo))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
