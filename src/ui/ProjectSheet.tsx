// One project in one place (Fouad, 2026-11-03), like a person's page in HR: an overview, its lines in the
// budget with their items, its grant, its expenses, and its Excel. Opened from a grant's card and from
// Budget → Projects.
import { useEffect, useMemo, useState } from 'react';
import { useApp, useNames } from '../state';
import type { BudgetPayload } from '../ops';
import { inPeriod, itemTotal } from '../domain/budget';
import { projectReport } from '../domain/projects';
import { projectXlsx } from '../io/projectExcel';
import { saveFile } from '../platform';
import { Modal, Tabs, errText, fmtDate, fmtUsd, t, toast } from './kit';
import { GuideLink } from '../guide/GuideView';

type Sec = 'overview' | 'lines' | 'grant' | 'expenses';
const usd = (n: number | null | undefined) => (n == null ? '—' : `$${fmtUsd(n)}`);

export function ProjectSheet({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const { s, d } = useApp();
  const names = useNames();
  const [sec, setSec] = useState<Sec>('overview');
  const acc = d.lists.accounts.find((a) => a.id === projectId)!;
  // the budget of the project's months (the one covering its start, else the latest)
  const [b, setB] = useState<BudgetPayload | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const all: BudgetPayload = await s.api.call('budget.get', {});
        const ym = acc.start_date?.slice(0, 7);
        const pick = (ym && [...all.budgets].reverse().find((x) => inPeriod(x, ym))) || all.budgets[all.budgets.length - 1];
        setB(pick ? await s.api.call('budget.get', { budgetId: pick.id }) : all);
      } catch (e) {
        toast(errText(e), true);
      }
    })();
  }, [s, acc.start_date]);
  // its spending: from its start (or the first expense) to its end (or now)
  const period = { from: acc.start_date?.slice(0, 7) ?? '2000-01', to: acc.end_date?.slice(0, 7) ?? '2999-12' };
  const p = useMemo(() => projectReport({ rows: d.centreRows, comp: d.comp, lists: d.lists, grants: d.grants, grantParts: d.grantParts, grantShares: d.grantShares, period })
    .find((x) => x.id === projectId), [d, projectId, period.from, period.to]);
  const given = b ? b.amounts.filter((x) => x.account_id === projectId) : [];
  const linesTotal = given.reduce((sum, x) => sum + x.amount_usd, 0);
  const shareUsd = p?.grant && p.share != null ? (p.grant.currency === 'EUR' ? p.share / (b?.current?.rate_eur || 1) : p.share) : null;
  const line = (id: number | null) => d.lists.lines.find((l) => l.id === id);
  const heading = (id: number | null) => d.lists.headings.find((h) => h.id === line(id)?.heading_id)?.name ?? '';
  const excel = async () => {
    if (!p) return;
    try {
      const docs = new Map<string, string[]>();
      for (const at of d.attachments) docs.set(at.trx_id, [...(docs.get(at.trx_id) ?? []), at.name]);
      const bytes = await projectXlsx({ project: p, period, organisation: s.organisation, lists: d.lists, comp: d.comp, docs });
      const path = await saveFile(`${acc.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.xlsx`, ['xlsx'], bytes, t('احفظ ملف Excel', 'Save the Excel file'));
      if (path) toast(t('حُفظ', 'Saved') + ': ' + path);
    } catch (e) {
      toast(errText(e), true);
    }
  };

  return (
    <Modal title={<>{acc.name}<GuideLink id="grant-steps" /></>} onClose={onClose}>
      <div className="muted small ltr" style={{ marginTop: -6 }}>{acc.start_date ?? '…'} → {acc.end_date ?? '…'}{b?.budget ? ` · ${b.budget.name}` : ''}</div>
      <Tabs value={sec} onChange={setSec} tabs={[
        { value: 'overview', label: t('نظرة عامة', 'Overview') },
        { value: 'lines', label: t('الخطوط', 'Lines') },
        { value: 'grant', label: t('المنحة', 'Grant'), hidden: !p?.grant },
        { value: 'expenses', label: t('النفقات', 'Expenses') },
      ]} />
      {sec === 'overview' && (
        <div className="cards" style={{ marginTop: 10 }}>
          <div className="card"><div className="k">{t('حصة المنحة هنا', "The grant's share here")}</div><div className="v ltr">{usd(shareUsd)}</div></div>
          <div className="card"><div className="k">{t('خطوطه في الموازنة', 'Its lines in the budget')}</div><div className="v ltr">{usd(linesTotal)}</div>
            <div className="muted small">{shareUsd == null ? '' : Math.abs(shareUsd - linesTotal) <= 0.5 ? `✓ ${t('مطابق', 'Matches')}` : shareUsd > linesTotal ? `${t('لم يُعطَ لخطوط بعد', 'Not yet given to lines')} ${usd(shareUsd - linesTotal)}` : `${t('ينقص', 'Short by')} ${usd(linesTotal - shareUsd)}`}</div></div>
          <div className="card"><div className="k">{t('وصل باليد', 'Received in hand')}</div><div className="v ltr">{usd(p?.received)}</div></div>
          <div className="card"><div className="k">{t('صُرف', 'Spent')}</div><div className="v ltr">{usd(p?.spentAll ?? 0)}</div>
            <div className="muted small">{p?.left != null ? `${t('باقٍ', 'Left')} ${usd(p.left)}` : ''}</div></div>
        </div>
      )}
      {sec === 'lines' && (
        <table className="t" style={{ marginTop: 10 }}>
          <thead><tr><th>{t('البند › الخط', 'Heading › line')}</th><th className="n">{t('الموازنة', 'Budget')} $</th><th className="n">{t('صُرف', 'Spent')} $</th></tr></thead>
          <tbody>
            {given.map((x) => {
              const its = b!.items.filter((i) => i.line_id === x.line_id);
              return (
                <tr key={x.line_id}>
                  <td>{heading(x.line_id)} › <b>{line(x.line_id)?.name}</b>{its.length ? <div className="muted small">{its.map((i) => `${i.name} (${usd(itemTotal(i))})`).join(' · ')}</div> : null}</td>
                  <td className="n">{fmtUsd(x.amount_usd)}</td>
                  <td className="n">{fmtUsd(p?.lines.find((l) => l.line_id === x.line_id)?.spent ?? 0)}</td>
                </tr>
              );
            })}
            {!given.length && <tr><td colSpan={3} className="muted">{t('لا خطوط بعد: المنح ← «أكمل الخطوات».', 'No lines yet: Grants → "Finish the steps".')}</td></tr>}
          </tbody>
        </table>
      )}
      {sec === 'grant' && p?.grant && (
        <div style={{ marginTop: 10 }}>
          <p><b>{names.donor(p.grant.donor_id)}</b>{p.grant.reference ? <span className="muted"> · {t('عقد', 'Contract')} {p.grant.reference}</span> : null}</p>
          <p className="ltr">{p.grant.currency === 'EUR' ? '€' : '$'}{fmtUsd(p.grant.amount)} · {t('هنا', 'here')} {p.grant.currency === 'EUR' ? '€' : '$'}{fmtUsd(p.share ?? 0)}</p>
          <p className="small">{t('المرحلة', 'Step')}: <b>{p.grant.status}</b>{p.grant.hand_on ? ` · ${t('باليد', 'in hand')} ${fmtDate(p.grant.hand_on)}` : ''}</p>
        </div>
      )}
      {sec === 'expenses' && (
        <table className="t" style={{ marginTop: 10 }}>
          <thead><tr><th>{t('التاريخ', 'Date')}</th><th>{t('الخط', 'Line')}</th><th>{t('الشرح', 'Explanation')}</th><th className="n">$</th></tr></thead>
          <tbody>
            {(p?.expenses ?? []).map((r) => (
              <tr key={r.id}><td>{fmtDate(r.date!)}</td><td>{line(r.line_id)?.name}</td><td>{r.explanation}</td><td className="n">{fmtUsd(d.comp.get(r.id)?.expUsdTot ?? 0)}</td></tr>
            ))}
            {!p?.expenses.length && <tr><td colSpan={4} className="muted">{t('لا نفقات بعد.', 'No expenses yet.')}</td></tr>}
          </tbody>
        </table>
      )}
      <div className="modal-foot">
        <button className="btn" disabled={!p} onClick={excel}>⬇ Excel</button>
        <button className="btn primary" onClick={onClose}>{t('إغلاق', 'Close')}</button>
      </div>
    </Modal>
  );
}
