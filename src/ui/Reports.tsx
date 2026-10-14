import { useMemo, useState } from 'react';
import { useApp, useNames } from '../state';
import { coverage, exchangeLog, monthly, projectFunds, summary, inPeriod, type Period } from '../domain/reports';
import { MONTHS_AR, MONTHS_EN } from '../domain/types';
import { getLang } from '../i18n';
import { Tabs, fmtDate, fmtPct, fmtRate, fmtSyp, fmtUsd, t } from './kit';

type Tab = 'summary' | 'monthly' | 'accounts' | 'coverage' | 'funds' | 'exchange';

const monthName = (ym: string) => {
  const m = Number(ym.slice(5, 7)) - 1;
  return getLang() === 'en' ? `${MONTHS_EN[m]} ${ym.slice(0, 4)}` : `${MONTHS_AR[m]} · ${MONTHS_EN[m]} ${ym.slice(0, 4)}`;
};

export function Reports() {
  const { d, isSup } = useApp();
  const names = useNames();
  const years = useMemo(() => [...new Set(d.rows.map((r) => r.date?.slice(0, 4)).filter(Boolean) as string[])].sort(), [d.rows]);
  const lastYear = years[years.length - 1] ?? String(new Date().getFullYear());
  const [tab, setTab] = useState<Tab>('summary');
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
        { value: 'summary', label: t('الملخص', 'Summary') },
        { value: 'monthly', label: t('شهرياً', 'Monthly') },
        { value: 'accounts', label: t('حسب الحساب', 'By account') },
        { value: 'coverage', label: t('التغطية', 'Coverage'), hidden: !isSup },
        { value: 'funds', label: t('أموال المشاريع', 'Project funds'), hidden: !isSup },
        { value: 'exchange', label: t('سجل التصريف', 'Exchange log') },
      ]} />
      {tab === 'summary' && <SummaryTab p={p} />}
      {tab === 'monthly' && <MonthlyTab year={year} />}
      {tab === 'accounts' && <AccountsTab p={p} />}
      {tab === 'coverage' && isSup && <CoverageTab p={p} year={year} />}
      {tab === 'funds' && isSup && <FundsTab />}
      {tab === 'exchange' && <ExchangeTab p={p} names={names} />}
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

function SummaryTab({ p }: { p: Period }) {
  const { d } = useApp();
  const s = summary(d.rows, d.comp, d.lists, p);
  const undated = d.rows.filter((r) => !r.date).length;
  return (
    <>
      <div className="cards">
        <Card k={t('إيراد ل.س', 'Income SYP')} v={fmtSyp(s.incSyp)} />
        <Card k={t('نفقة ل.س', 'Expense SYP')} v={fmtSyp(s.expSyp)} />
        <Card k={t('الصافي ل.س', 'Net SYP')} v={fmtSyp(s.incSyp - s.expSyp)} />
        <Card k={t('إيراد $', 'Income USD')} v={fmtUsd(s.incUsd)} />
        <Card k={t('نفقة $', 'Expense USD')} v={fmtUsd(s.expUsd)} />
        <Card k={t('الصافي $', 'Net USD')} v={fmtUsd(s.incUsd - s.expUsd)} />
        <Card k={t('إيراد إجمالي $', 'Income USD-eq')} v={fmtUsd(s.incEq)} />
        <Card k={t('نفقة إجمالية $', 'Expense USD-eq')} v={fmtUsd(s.expEq)} />
        <Card k={t('الصافي الإجمالي $', 'Net USD-eq')} v={fmtUsd(s.incEq - s.expEq)} />
        <Card k={t('عدد الحركات', 'Rows')} v={String(s.count)} />
        <Card k={t('نسبة النفقات', 'Expense / income')} v={s.incEq ? fmtPct(s.expEq / s.incEq) : '-'} />
        <Card k={t('بلا خط موازنة', 'No budget line')} v={String(s.noLine)} />
      </div>
      <div className="grid2" style={{ marginTop: 14 }}>
        {s.topHeading && <Card k={t('أعلى بند نفقات', 'Top expense heading')} v={fmtUsd(s.topHeading.amount)} sub={s.topHeading.name} />}
        {s.topIncomeLine && <Card k={t('أعلى خط إيرادات', 'Top income line')} v={fmtUsd(s.topIncomeLine.amount)} sub={s.topIncomeLine.name} />}
      </div>
      {undated > 0 && <p className="warn small">{t(`${undated} سطراً بلا تاريخ غير محسوبة في أي فترة`, `${undated} undated rows are not counted in any period`)}</p>}
    </>
  );
}

function MonthlyTab({ year }: { year: number }) {
  const { d } = useApp();
  const ls = monthly(d.rows, d.comp, year);
  return (
    <div className="tbl-wrap">
      <table className="t">
        <thead><tr>
          <th>{t('الشهر', 'Month')}</th><th className="n">Inc SYP</th><th className="n">Exp SYP</th><th className="n">Net SYP</th><th className="n">{t('التراكمي', 'Cumul.')} SYP</th>
          <th className="n">Inc USD</th><th className="n">Exp USD</th><th className="n">Net USD</th><th className="n">{t('التراكمي', 'Cumul.')} USD</th><th className="n">{t('العدد', 'Count')}</th>
          <th className="n">Inc USD-eq</th><th className="n">Exp USD-eq</th>
        </tr></thead>
        <tbody>
          {ls.map((l) => (
            <tr key={l.ym} className={l.count ? '' : 'off'}>
              <td>{monthName(l.ym)}</td><td className="n">{fmtSyp(l.incSyp)}</td><td className="n">{fmtSyp(l.expSyp)}</td><td className="n">{fmtSyp(l.incSyp - l.expSyp)}</td><td className="n">{fmtSyp(l.cumSyp)}</td>
              <td className="n">{fmtUsd(l.incUsd)}</td><td className="n">{fmtUsd(l.expUsd)}</td><td className="n">{fmtUsd(l.incUsd - l.expUsd)}</td><td className="n">{fmtUsd(l.cumUsd)}</td>
              <td className="n">{l.count}</td><td className="n">{fmtUsd(l.incEq)}</td><td className="n">{fmtUsd(l.expEq)}</td>
            </tr>
          ))}
          <tr className="total">
            <td>{year}</td>
            <td className="n">{fmtSyp(ls.reduce((a, l) => a + l.incSyp, 0))}</td><td className="n">{fmtSyp(ls.reduce((a, l) => a + l.expSyp, 0))}</td><td /><td />
            <td className="n">{fmtUsd(ls.reduce((a, l) => a + l.incUsd, 0))}</td><td className="n">{fmtUsd(ls.reduce((a, l) => a + l.expUsd, 0))}</td><td /><td />
            <td className="n">{ls.reduce((a, l) => a + l.count, 0)}</td>
            <td className="n">{fmtUsd(ls.reduce((a, l) => a + l.incEq, 0))}</td><td className="n">{fmtUsd(ls.reduce((a, l) => a + l.expEq, 0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
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
