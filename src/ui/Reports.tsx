import { useMemo, useState } from 'react';
import { useApp, useNames } from '../state';
import { coverage, exchangeLog, monthly, projectFunds, summary, inPeriod, type Period } from '../domain/reports';
import { MONTHS_AR, MONTHS_EN } from '../domain/types';
import { getLang } from '../i18n';
import type { Perm } from '../perms';
import { Seg, Tabs, fmtDate, fmtPct, fmtRate, fmtSyp, fmtUsd, t } from './kit';
import { BarList, EXPENSE, INCOME, MonthColumns, type Bar } from './Charts';
import { useNav } from './Shell';
import type { Trx } from '../domain/types';
import { CurrencyFrame } from './Cash';

type Tab = 'summary' | 'explore' | 'monthly' | 'accounts' | 'coverage' | 'funds' | 'exchange';

const monthName = (ym: string) => {
  const m = Number(ym.slice(5, 7)) - 1;
  return getLang() === 'en' ? `${MONTHS_EN[m]} ${ym.slice(0, 4)}` : `${MONTHS_AR[m]} · ${MONTHS_EN[m]} ${ym.slice(0, 4)}`;
};

export function Reports() {
  const { d, can } = useApp();
  const names = useNames();
  const years = useMemo(() => [...new Set(d.rows.map((r) => r.date?.slice(0, 4)).filter(Boolean) as string[])].sort(), [d.rows]);
  const lastYear = years[years.length - 1] ?? String(new Date().getFullYear());
  const first = (['summary', 'monthly', 'accounts', 'coverage', 'funds', 'exchange'] as Tab[]).find((x) => can(`reports.${x}` as Perm)) ?? 'summary';
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
        { value: 'monthly', label: t('شهرياً', 'Monthly'), hidden: !can('reports.monthly') },
        { value: 'accounts', label: t('حسب الحساب', 'By account'), hidden: !can('reports.accounts') },
        { value: 'coverage', label: t('التغطية', 'Coverage'), hidden: !can('reports.coverage') },
        { value: 'funds', label: t('أموال المشاريع', 'Project funds'), hidden: !can('reports.funds') },
        { value: 'exchange', label: t('سجل التصريف', 'Exchange log'), hidden: !can('reports.exchange') },
      ]} />
      {tab === 'summary' && can('reports.summary') && <SummaryTab p={p} />}
      {tab === 'explore' && can('reports.summary') && <ExploreTab p={p} />}
      {tab === 'monthly' && can('reports.monthly') && <MonthlyTab year={year} />}
      {tab === 'accounts' && can('reports.accounts') && <AccountsTab p={p} />}
      {tab === 'coverage' && can('reports.coverage') && <CoverageTab p={p} year={year} />}
      {tab === 'funds' && can('reports.funds') && <FundsTab />}
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

  const ofKind = useMemo(() => d.rows.filter((r) => r.type === kind && inPeriod(r, p)), [d.rows, kind, p]);
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
                <BarList bars={group((r) => r.heading_id, names.heading)} color={color} fmt={fmtM} unit={unit} onPick={(b) => b.key !== -1 && setHeading(Number(b.key))} empty={t('لا شيء', 'Nothing')} />
              </>
            ) : (
              <>
                <h3>{t('حسب الخط', 'By line')} <span className="muted small">· {unit} · {t('اضغط لتفتح', 'click to open')}</span></h3>
                <BarList bars={group((r) => r.line_id, names.line)} color={color} fmt={fmtM} unit={unit} onPick={(b) => b.key !== -1 && setLine(Number(b.key))} empty={t('لا شيء', 'Nothing')} />
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
                  <td className="nowrap">{fmtDate(r.date)}</td><td>{names.book(r.book_id)}</td><td>{names.line(r.line_id)}</td>
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
  const s = summary(d.rows, d.comp, d.lists, p);
  const undated = d.rows.filter((r) => !r.date).length;
  const [measure, setMeasure] = useState<Measure>('eq');
  const [heading, setHeading] = useState<number | null>(null);
  const rs = useMemo(() => d.rows.filter((r) => inPeriod(r, p)), [d.rows, p]);

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
  const byHeading = sumBy((r) => r.type === 'Exp', (r) => r.heading_id, exp, (k) => names.heading(k));
  const linesOf = heading == null ? [] : sumBy((r) => r.type === 'Exp' && r.heading_id === heading, (r) => r.line_id, exp, (k) => names.line(k));
  const byIncomeLine = sumBy((r) => r.type === 'Income', (r) => r.line_id, inc, (k) => names.line(k));

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
                <h3 style={{ margin: 0 }}>{names.heading(heading)} <span className="muted small">· {fmtM(headingTotal)} {unit} · {linesOf.length} {t('خطوط', 'lines')}</span></h3>
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
  const ls = monthly(d.rows, d.comp, year);
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

function AccountsTab({ p }: { p: Period }) {
  const { d } = useApp();
  const rs = d.rows.filter((r) => inPeriod(r, p));
  const ls = d.lists.accounts.map((a) => {
    const mine = rs.filter((r) => r.account_id === a.id);
    const s = (f: (r: (typeof mine)[number]) => number) => mine.reduce((x, r) => x + f(r), 0);
    return {
      a, inS: s((r) => r.inc_syp), exS: s((r) => r.exp_syp), inU: s((r) => r.inc_usd), exU: s((r) => r.exp_usd),
      eq: s((r) => d.comp.get(r.id)!.incUsdTot - d.comp.get(r.id)!.expUsdTot), n: mine.length,
      books: [...new Set(mine.map((r) => d.lists.books.find((b) => b.id === r.book_id)?.name).filter(Boolean))].join(', '),
    };
  });
  return (
    <div className="tbl-wrap">
      <table className="t">
        <thead><tr><th>{t('الحساب', 'Account')}</th><th className="n">Inc SYP</th><th className="n">Exp SYP</th><th className="n">Net SYP</th><th className="n">Inc USD</th><th className="n">Exp USD</th><th className="n">Net USD</th><th className="n">Net USD-eq</th><th className="n">{t('العدد', 'Rows')}</th><th>{t('الصناديق', 'Held by')}</th></tr></thead>
        <tbody>
          {ls.map((l) => (
            <tr key={l.a.id} className={l.n ? '' : 'off'}>
              <td>{l.a.name}</td><td className="n">{fmtSyp(l.inS)}</td><td className="n">{fmtSyp(l.exS)}</td><td className="n">{fmtSyp(l.inS - l.exS)}</td>
              <td className="n">{fmtUsd(l.inU)}</td><td className="n">{fmtUsd(l.exU)}</td><td className="n">{fmtUsd(l.inU - l.exU)}</td><td className="n">{fmtUsd(l.eq)}</td><td className="n">{l.n}</td><td className="small">{l.books}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageTab({ p, year }: { p: Period; year: number }) {
  const { d } = useApp();
  const c = coverage(d.rows, d.comp, d.lists, p, year);
  const s = c.summary;
  const accs = c.accounts.filter((a) => c.byHeading.some((h) => (h.perAccount.get(a.id) ?? 0) !== 0));
  return (
    <>
      <div className="alert info small">{t('سرّي · الإيراد الذاتي = كل إيراد ما عدا خطوط أموال المشاريع. كل بند مغطى بنفس النسبة.', 'Confidential · Own income = every income line except the project-fund lines. Every heading is covered in the same %.')}</div>
      <div className="cards">
        <Card k={t('نفقات', 'Expenses')} v={fmtUsd(s.expenses)} />
        <Card k={t('إيراد ذاتي', 'Own income')} v={fmtUsd(s.ownIncome)} sub={fmtPct(s.pctOwn)} />
        <Card k={t('العجز', 'Funding gap')} v={fmtUsd(s.gap)} />
        <Card k={t('أموال المشاريع', 'Project funds')} v={fmtUsd(s.projectFunds)} sub={fmtPct(s.pctFunds)} />
        <Card k={t('فائض / (عجز)', 'Surplus / (shortfall)')} v={fmtUsd(s.surplus)} />
        <Card k={t('% غير مغطى', '% not covered')} v={fmtPct(s.pctNot)} />
      </div>
      <h3 style={{ marginTop: 18 }}>{t('حسب البند والحساب', 'By heading and account')} (USD-eq)</h3>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>{t('البند', 'Heading')}</th>{accs.map((a) => <th key={a.id} className="n">{a.name}</th>)}<th className="n">{t('المجموع', 'Total')}</th><th className="n">{t('ذاتي', 'Own')}</th><th className="n">{t('مشاريع', 'Funds')}</th><th className="n">{t('غير مغطى', 'Not covered')}</th><th className="n">%</th></tr></thead>
          <tbody>
            {c.byHeading.filter((h) => h.total !== 0 || h.headingId != null).map((h) => (
              <tr key={h.headingId ?? 'none'} className={h.total ? '' : 'off'}>
                <td>{h.headingId == null ? <span className={Math.abs(h.total) > 0.005 ? 'bad' : 'muted'}>{t('بلا بند صالح — يجب أن يكون صفراً', 'No valid heading — must be nil')}</span> : h.name}</td>
                {accs.map((a) => <td key={a.id} className="n">{fmtUsd(h.perAccount.get(a.id))}</td>)}
                <td className="n"><b>{fmtUsd(h.total)}</b></td><td className="n">{fmtUsd(h.own)}</td><td className="n">{fmtUsd(h.funds)}</td><td className="n">{fmtUsd(h.notCovered)}</td><td className="n">{fmtPct(h.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 18 }}>{t('حسب الشهر', 'By month')} · {year}</h3>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>{t('الشهر', 'Month')}</th><th className="n">{t('نفقات', 'Expenses')}</th><th className="n">{t('إيراد ذاتي', 'Own income')}</th><th className="n">{t('مشاريع', 'Funds')}</th><th className="n">{t('فائض/(عجز)', 'Surplus')}</th><th className="n">% {t('ذاتي', 'own')}</th></tr></thead>
          <tbody>
            {c.byMonth.map((m) => (
              <tr key={m.ym} className={m.expenses || m.own || m.funds ? '' : 'off'}>
                <td>{monthName(m.ym)}</td><td className="n">{fmtUsd(m.expenses)}</td><td className="n">{fmtUsd(m.own)}</td><td className="n">{fmtUsd(m.funds)}</td><td className="n">{fmtUsd(m.surplus)}</td><td className="n">{fmtPct(m.pctOwn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FundsTab() {
  const { d } = useApp();
  const names = useNames();
  const f = projectFunds(d.rows, d.comp, d.lists, d.grants);
  const status: Record<string, string> = {
    used: t('صُرف كله', 'fund used up'),
    remaining: t('متبقٍ', 'remaining'),
    overspent: t('⚠ صُرف أكثر من المُرسَل', '⚠ spent more than sent'),
    enter_grant: t('⚠ أُرسل أكثر من المستلم — أدخل المنحة', '⚠ sent more than received — enter the grant'),
    none: t('لا تمويل مسجل', 'no funds recorded'),
  };
  const nil = (x: number) => (Math.abs(x) < 0.5 ? <span className="ok">✓</span> : <span className="bad">{fmtUsd(x)}</span>);
  return (
    <>
      <div className="alert info small">{t('سرّي · كل الفترات', 'Confidential · all periods')}</div>
      <div className="grid2">
        <div className="panel">
          <h3>{t('مطابقة', 'Reconciliation')}</h3>
          <table className="t"><tbody>
            <tr><td>{t('مستلم من المانحين', 'Received from donors')}</td><td className="n">{fmtUsd(f.received)}</td></tr>
            <tr><td>{t('مُرسَل إلى المركز', 'Sent to the centre')}</td><td className="n">{fmtUsd(f.sent)}</td></tr>
            <tr><td>{t('منه بحساب بلا مشروع (يجب صفر)', 'of which in an account with no project (must be nil)')}</td><td className="n">{nil(f.sentNoProject)}</td></tr>
            <tr><td>{t('عدد الحركات', 'Respo rows found')}</td><td className="n">{f.respoRows}</td></tr>
            <tr><td>{t('لدى المسؤول', 'Still held by the Respo')}</td><td className="n">{fmtUsd(f.heldByRespo)}</td></tr>
            <tr><td>{t('نفقات بلا مشروع (يجب صفر)', 'Expenses not linked to a project (must be nil)')}</td><td className="n">{nil(f.expensesNoProject)}</td></tr>
          </tbody></table>
        </div>
        <div className="panel">
          <h3>{t('المُرسَل إلى المركز', 'Sent to the centre')}</h3>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="t">
              <thead><tr><th>{t('التاريخ', 'Date')}</th><th>{t('الحساب', 'Account')}</th><th>{t('المشروع', 'Project')}</th><th className="n">USD</th></tr></thead>
              <tbody>{f.sentRows.map((r) => (
                <tr key={r.trx.id}><td>{fmtDate(r.trx.date)}</td><td>{names.account(r.trx.account_id)}</td><td>{r.projectId == null ? <span className="bad">⚠</span> : names.project(r.projectId)}</td><td className="n">{fmtUsd(r.usd)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>{t('المشروع', 'Project')}</th><th className="n">{t('مستلم', 'Received')}</th><th className="n">{t('مُرسَل', 'Sent')}</th><th className="n">{t('لدى المسؤول', 'At the Respo')}</th><th className="n">{t('مصروف', 'Spent')}</th><th className="n">{t('متبقٍ في المركز', 'Unspent at centre')}</th><th>{t('الحالة', 'Status')}</th></tr></thead>
          <tbody>
            {f.lines.map((l) => (
              <tr key={l.projectId}><td>{l.name}</td><td className="n">{fmtUsd(l.received)}</td><td className="n">{fmtUsd(l.sent)}</td><td className="n">{fmtUsd(l.atRespo)}</td><td className="n">{fmtUsd(l.spent)}</td><td className="n">{fmtUsd(l.unspent)}</td>
                <td className={l.status === 'overspent' || l.status === 'enter_grant' ? 'warn' : 'muted'}>{status[l.status]}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ExchangeTab({ p, names }: { p: Period; names: ReturnType<typeof useNames> }) {
  const { d } = useApp();
  const ex = exchangeLog(d.rows, p);
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
