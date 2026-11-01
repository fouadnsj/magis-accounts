// The checks before closing (Fouad, 2026-11-02): what to look at in the centre's grants, projects and budget before a
// month or the year is closed. Nothing is changed here; each line says where to change it.
import { useEffect, useMemo, useState } from 'react';
import { useApp, useNames } from '../state';
import type { BudgetPayload } from '../ops';
import { NOFUND, periodEnd } from '../domain/budget';
import { inPeriod } from '../domain/reports';
import { shareHere } from './Grants';
import { fmtUsd, t } from './kit';

interface Check { level: 'bad' | 'warn' | 'ok'; title: string; detail?: string; where: string }

export function Checks() {
  const { s, d, can } = useApp();
  const names = useNames();
  const [b, setB] = useState<BudgetPayload | null>(null);
  useEffect(() => { if (can('budget.view')) s.api.call('budget.get', { budgetId: null }).then(setB).catch(() => setB(null)); }, [s, can]);
  const checks = useMemo((): Check[] => {
    const out: Check[] = [];
    const usd = (n: number) => `$${fmtUsd(n)}`;
    const exps = d.centreRows.filter((r) => r.type === 'Exp' && r.date && !r.private_total);
    // grants
    if (can('lists.donors')) {
      const noProject = d.grants.filter((g) => shareHere(g, d.grantParts, d.grantShares) > 0 && !d.grantParts.some((p) => p.grant_id === g.id && p.account_id != null));
      out.push(noProject.length
        ? { level: 'bad', title: t(`${noProject.length} منحة بلا مشروع هنا`, `${noProject.length} grant(s) without a project here`), detail: noProject.map((g) => names.donor(g.donor_id) + (g.reference ? ` ${g.reference}` : '')).join(' · '), where: t('المنح ← تعديل', 'Grants → Edit') }
        : { level: 'ok', title: t('لكل منحة مشروعها هنا', 'Every grant has its project here'), where: '' });
      const projects = d.lists.accounts.filter((a) => a.active && d.grantParts.some((p) => p.account_id === a.id) && !a.start_date && !a.end_date);
      if (projects.length) out.push({ level: 'warn', title: t(`${projects.length} مشروع منحة بلا مدة`, `${projects.length} grant project(s) without dates`), detail: projects.map((a) => a.name).join(' · '), where: t('القوائم ← المشاريع ← المدة', 'Lists → Projects → Dates') });
    }
    // the budget running now
    if (b?.budget && b.current) {
      const B = b.budget;
      const fund = new Map(b.amounts.map((x) => [x.line_id, x.account_id]));
      const nf = b.amounts.filter((x) => x.account_id === NOFUND);
      out.push(nf.length
        ? { level: 'warn', title: t(`${nf.length} خطاً في الموازنة «${B.name}» غير ممول`, `${nf.length} line(s) of the budget "${B.name}" not funded`), detail: `${usd(nf.reduce((a, x) => a + x.amount_usd, 0))} · ${nf.slice(0, 8).map((x) => names.line(x.line_id)).join(' · ')}${nf.length > 8 ? '…' : ''}`, where: t('الموازنة ← المشاريع', 'Budget → Projects') }
        : { level: 'ok', title: t(`لكل خط في «${B.name}» مشروعه`, `Every line of "${B.name}" has its project`), where: '' });
      const period = { from: B.start_ym, to: periodEnd(B) };
      const inB = exps.filter((r) => inPeriod(r, period));
      const noBudget = inB.filter((r) => r.line_id != null && !fund.has(r.line_id) && r.from_line);
      if (noBudget.length) out.push({ level: 'warn', title: t(`${noBudget.length} نفقة على خطوط بلا موازنة`, `${noBudget.length} expense(s) on lines with no budget`), detail: [...new Set(noBudget.map((r) => names.line(r.line_id)))].slice(0, 8).join(' · '), where: t('الموازنة ← الموازنة', 'Budget → Budget') });
      // spent outside a project's dates: the line has a project, the expense is not funded
      const outDates = inB.filter((r) => r.from_line && r.account_id == null && r.line_id != null && (fund.get(r.line_id) ?? NOFUND) !== NOFUND);
      if (outDates.length) out.push({ level: 'bad', title: t(`${outDates.length} نفقة خارج مدة مشروع خطها`, `${outDates.length} expense(s) outside the dates of their line's project`), detail: `${usd(outDates.reduce((a, r) => a + (d.comp.get(r.id)?.expUsdTot ?? 0), 0))} · ${t('تُحسب غير ممولة', 'counted as not funded')}`, where: t('القوائم ← المشاريع ← المدة، أو السجل', 'Lists → Projects → Dates, or the Register') });
      // projects with less money here than their lines
      if (can('lists.donors')) for (const a of d.lists.accounts) {
        const p = d.grantParts.find((x) => x.account_id === a.id);
        const g = p && d.grants.find((x) => x.id === p.grant_id);
        if (!p || !g) continue;
        const money = g.currency === 'EUR' ? p.amount / (b.current.rate_eur || 1) : p.amount;
        const lines = b.amounts.filter((x) => x.account_id === a.id).reduce((s2, x) => s2 + x.amount_usd, 0);
        if (lines - money > 0.5) out.push({ level: 'warn', title: t(`«${a.name}»: ينقص ${usd(lines - money)}`, `"${a.name}": short by ${usd(lines - money)}`), detail: t(`خطوطه ${usd(lines)}، ماله هنا ${usd(money)}`, `its lines ${usd(lines)}, its money here ${usd(money)}`), where: t('الموازنة ← المشاريع', 'Budget → Projects') });
      }
    }
    // expenses not funded, this year
    const year = new Date().toISOString().slice(0, 4);
    const nfRows = exps.filter((r) => r.from_line && r.account_id == null && r.date!.startsWith(year));
    if (nfRows.length) out.push({ level: 'warn', title: t(`${nfRows.length} نفقة غير ممولة في ${year}`, `${nfRows.length} expense(s) not funded in ${year}`), detail: usd(nfRows.reduce((a, r) => a + (d.comp.get(r.id)?.expUsdTot ?? 0), 0)), where: t('السجل ← المشروع: غير ممول', 'Register → Project: Not funded') });
    // old accounts no longer used
    const lastYear = `${Number(year) - 1}-${new Date().toISOString().slice(5, 10)}`;
    const idle = d.lists.accounts.filter((a) => a.active && !a.outside_budget && !d.grantParts.some((p) => p.account_id === a.id)
      && !(b?.amounts ?? []).some((x) => x.account_id === a.id) && !d.rows.some((r) => r.account_id === a.id && (r.date ?? '') >= lastYear));
    if (idle.length) out.push({ level: 'warn', title: t(`${idle.length} مشروع لا يُستعمل (منذ سنة)`, `${idle.length} project(s) not used (for a year)`), detail: idle.map((a) => a.name).join(' · '), where: t('القوائم ← المشاريع ← دمج', 'Lists → Projects → Merge') });
    // months not closed
    const now = new Date().toISOString().slice(0, 7);
    const months = [...new Set(d.rows.filter((r) => r.date && r.date.slice(0, 7) < now).map((r) => r.date!.slice(0, 7)))].filter((ym) => !d.closed.has(ym)).sort();
    if (months.length) out.push({ level: 'warn', title: t(`${months.length} شهراً لم يُغلق`, `${months.length} month(s) not closed`), detail: months.join(' · '), where: t('الإدارة ← إغلاق الأشهر', 'Admin → Month closing') });
    const review = d.rows.filter((r) => r.review).length;
    if (review) out.push({ level: 'warn', title: t(`${review} قيداً للمراجعة`, `${review} row(s) to review`), where: t('السجل ← للمراجعة', 'Register → To review') });
    return out;
  }, [d, b, can, names]);
  const icon = { bad: '✗', warn: '⚠', ok: '✓' };
  const color = { bad: '#9b2c2c', warn: '#8a5a10', ok: '#2f6b3a' };
  return (
    <div className="panel" style={{ maxWidth: 900 }}>
      <p className="muted small" style={{ marginTop: 0 }}>{t('ما يُنظر فيه قبل إغلاق شهر أو سنة. لا يتغير شيء هنا؛ كل سطر يقول أين يُصحَّح.', 'What to look at before closing a month or the year. Nothing changes here; each line says where to correct it.')}</p>
      <table className="t">
        <tbody>
          {[...checks].sort((a, c) => ['bad', 'warn', 'ok'].indexOf(a.level) - ['bad', 'warn', 'ok'].indexOf(c.level)).map((c, i) => (
            <tr key={i}>
              <td style={{ width: 24, color: color[c.level], fontWeight: 700 }}>{icon[c.level]}</td>
              <td><b>{c.title}</b>{c.detail ? <div className="muted small">{c.detail}</div> : null}</td>
              <td className="small muted nowrap">{c.where}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
