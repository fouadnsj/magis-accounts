// A grant step by step (Fouad, 2026-11-03): everything a grant needs in one place, like a new person in HR.
// 1 the grant and its project (with its dates) → 2 its budget lines → 3 their amounts → 4 the check.
// The budget is the centre's one budget for those months: a new grant never makes a new budget. Once the
// grant is in hand, its money leaves the Respo book only when step 4 is all ✓ (the server checks it too);
// lines that do not cover the whole share are a warning only.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import type { BudgetPayload } from '../ops';
import { inPeriod, itemTotal, periodEnd } from '../domain/budget';
import { Field, Select, errText, fmtUsd, t, toast } from './kit';
import { GuideLink } from '../guide/GuideView';
import { GrantModal } from './Grants';
import { GiveLines, ItemsEditor } from './Budget';

export type GrantMissing = 'project' | 'dates' | 'lines';
export const MISSING_LABEL: Record<GrantMissing, () => string> = {
  project: () => t('المشروع', 'the project'),
  dates: () => t('تاريخا المشروع', "the project's dates"),
  lines: () => t('خطوط الموازنة', 'the budget lines'),
};

const usd = (n: number) => `$${fmtUsd(n)}`;

export function GrantSteps({ grantId, onClose }: { grantId: string | null; onClose: () => Promise<void> }) {
  const { s, d, reload } = useApp();
  const [gid, setGid] = useState<string | null>(grantId);
  // an unfinished grant opens on its lines; a new one on its form
  const [step, setStep] = useState(grantId ? 2 : 1);
  const grant = d.grants.find((g) => g.id === gid) ?? null;
  const projects = useMemo(() => d.grantParts.filter((p) => p.grant_id === gid && p.account_id != null), [d, gid]);
  const [pid, setPid] = useState<number | null>(null);
  const project = d.lists.accounts.find((a) => a.id === (pid ?? projects[0]?.account_id)) ?? null;
  const part = projects.find((p) => p.account_id === project?.id) ?? null;

  // the budget for the project's months: the one covering its start (else the latest)
  const [b, setB] = useState<BudgetPayload | null>(null);
  const loadBudget = useCallback(async () => {
    try {
      const all: BudgetPayload = await s.api.call('budget.get', {});
      const ym = project?.start_date?.slice(0, 7);
      const pick = (ym && [...all.budgets].reverse().find((x) => inPeriod(x, ym))) || all.budgets[all.budgets.length - 1];
      setB(pick ? await s.api.call('budget.get', { budgetId: pick.id }) : null);
    } catch (e) {
      toast(errText(e), true);
    }
  }, [s, project?.start_date]);
  useEffect(() => { if (step >= 2) loadBudget(); }, [step, loadBudget]);

  const [ready, setReady] = useState<GrantMissing[] | null>(null);
  useEffect(() => {
    if (step === 4 && gid) s.api.call('grant.readiness', {}).then((r: Record<string, GrantMissing[]>) => setReady(r[gid] ?? [])).catch(() => setReady(null));
  }, [step, gid, s, d, b]);

  const steps = [t('المنحة والمشروع', 'Grant and project'), t('خطوطه', 'Its lines'), t('المبالغ', 'The amounts'), t('التحقق', 'Check')];
  const head = (
    <div className="page-head">
      <div>
        <button className="link" onClick={onClose}>‹ {t('المنح', 'Grants')}</button>
        <h1>{grantId ? t('أكمل خطوات المنحة', "Finish the grant's steps") : t('منحة، خطوة بخطوة', 'Grant, step by step')}<GuideLink id="grant-steps" /></h1>
      </div>
      <ol className="wizard-steps">
        {steps.map((x, i) => (
          <li key={x} className={i + 1 === step ? 'now' : i + 1 < step ? 'done' : ''}>
            <button className="link" disabled={!gid && i > 0} onClick={() => setStep(i + 1)}>{i + 1}. {x}</button>
          </li>
        ))}
      </ol>
    </div>
  );

  if (step === 1) {
    return (
      <>
        {head}
        <p className="muted small">{t('اكتب المنحة ومشروعها هنا مع تاريخي البداية والنهاية. لا حاجة لموازنة جديدة: تُعطى للمشروع خطوطٌ من موازنة المركز.', "Write the grant and its project here, with its start and end dates. No new budget is needed: the project is given lines of the centre's budget.")}</p>
        <GrantModal asStep start={grant} onClose={onClose} onSaved={async (id) => { await reload(); setGid(id); setPid(null); setStep(2); }} />
      </>
    );
  }

  const moneyHere = grant && part ? (grant.currency === 'EUR' ? part.amount / (b?.current?.rate_eur || 1) : part.amount) : null;
  const given = b && project ? b.amounts.filter((x) => x.account_id === project.id) : [];
  const linesTotal = given.reduce((sum, x) => sum + x.amount_usd, 0);
  const line = (id: number) => d.lists.lines.find((l) => l.id === id);
  const heading = (id: number) => d.lists.headings.find((h) => h.id === line(id)?.heading_id)?.name ?? '';
  const projectTabs = projects.length > 1 && (
    <div className="row" style={{ margin: '6px 0 10px', flexWrap: 'wrap' }}>
      <span className="muted small">{t('المشروع', 'Project')}:</span>
      {projects.map((p) => (
        <button key={p.account_id} className={`btn small ${p.account_id === project?.id ? 'primary' : ''}`} onClick={() => setPid(p.account_id)}>{d.lists.accounts.find((a) => a.id === p.account_id)?.name}</button>
      ))}
    </div>
  );
  const balance = moneyHere != null && (
    <div className={`alert ${Math.abs(moneyHere - linesTotal) <= 0.5 ? 'ok' : 'warn'} small`}>
      {t('حصة المنحة هنا', "The grant's share here")} <b className="ltr">{usd(moneyHere)}</b> · {t('خطوطه', 'its lines')} <b className="ltr">{usd(linesTotal)}</b> ·{' '}
      {Math.abs(moneyHere - linesTotal) <= 0.5 ? <b>✓ {t('مطابق', 'Matches')}</b>
        : moneyHere > linesTotal ? <>{t('لم يُعطَ لخطوط بعد', 'Not yet given to lines')} <b className="ltr">{usd(moneyHere - linesTotal)}</b> <span className="muted">({t('تنبيه فقط', 'a warning only')})</span></>
        : <>{t('ينقص', 'Short by')} <b className="ltr">{usd(linesTotal - moneyHere)}</b> <span className="muted">({t('تنبيه فقط', 'a warning only')})</span></>}
    </div>
  );
  const nav = (
    <div className="modal-foot">
      <button className="btn" onClick={() => setStep(step - 1)}>← {t('رجوع', 'Back')}</button>
      {step < 4 ? <button className="btn primary" onClick={() => setStep(step + 1)}>{t('التالي', 'Next')} →</button>
        : <button className="btn primary" onClick={onClose}>{t('انتهى', 'Done')}</button>}
    </div>
  );
  if (!project) {
    return (
      <>
        {head}
        <div className="alert warn">{t('لا مشروع لهذه المنحة هنا بعد: ارجع إلى الخطوة 1 واختر مشروعاً.', 'This grant has no project here yet: go back to step 1 and choose one.')}</div>
        {nav}
      </>
    );
  }
  if (!b?.current) {
    return (
      <>
        {head}
        {b === null ? <p className="muted">…</p> : null}
        <div className="alert warn">{t('لا موازنة للمركز بعد: أنشئها أولاً في الموازنة ← موازنة جديدة.', "The centre has no budget yet: make it first in Budget → New budget.")}</div>
        {nav}
      </>
    );
  }
  const B = b.budget!;
  const fromTo = <span className="muted small ltr">{project.start_date ?? '…'} → {project.end_date ?? '…'}</span>;

  if (step === 2) {
    return (
      <>
        {head}
        <h2>{project.name} {fromTo}</h2>
        {projectTabs}
        <p className="muted small">{t(`الموازنة: «${B.name}» (${B.start_ym} → ${periodEnd(B)}). كل خط له مشروع واحد: خط يُعطى لهذا المشروع يترك مشروعه السابق.`, `The budget: "${B.name}" (${B.start_ym} → ${periodEnd(B)}). A line has one project: a line given to this one leaves its earlier project.`)}</p>
        {balance}
        <LinesOf b={b} projectId={project.id} onChanged={async () => { await loadBudget(); await reload(); }} />
        <AddLine onAdded={async () => { await reload(); }} />
        {nav}
      </>
    );
  }
  if (step === 3) {
    return (
      <>
        {head}
        <h2>{project.name} {fromTo}</h2>
        {projectTabs}
        {balance}
        <p className="muted small">{t('لكل خط عناصره: الكمية × المرات × كلفة الوحدة. مجموعها مبلغ الخط.', 'Each line has its items: quantity × times × cost per unit. Their total is the line’s amount.')}</p>
        {given.map((x) => (
          <div key={x.line_id} className="card" style={{ padding: 12, marginBottom: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{heading(x.line_id)} › {line(x.line_id)?.name}</b>
              <b className="ltr">{usd(x.amount_usd)}</b>
            </div>
            <ItemsEditor key={`${x.line_id}-${b.items.filter((i) => i.line_id === x.line_id).length}`} versionId={b.current!.id} lineId={x.line_id}
              items={b.items.filter((i) => i.line_id === x.line_id)} may onSaved={async () => { await loadBudget(); await reload(); }} />
          </div>
        ))}
        {!given.length && <div className="alert warn">{t('لم يُعطَ المشروع خطوطاً بعد: ارجع إلى الخطوة 2.', 'The project has no lines yet: go back to step 2.')}</div>}
        {nav}
      </>
    );
  }

  // step 4: what is done, and what the money needs
  const ok = (on: boolean, label: string, extra?: string) => (
    <li className={on ? 'ok' : 'bad'}>{on ? '✓' : '✗'} {label}{extra ? <span className="muted small"> · {extra}</span> : null}</li>
  );
  const miss = ready ?? [];
  return (
    <>
      {head}
      <h2>{project.name} {fromTo}</h2>
      {projectTabs}
      <ul className="check-list">
        {ok(!miss.includes('project'), t('المنحة لها مشروع هنا', 'The grant has its project here'))}
        {ok(!miss.includes('dates'), t('للمشروع تاريخ بداية ونهاية', 'The project has a start and an end date'))}
        {ok(!miss.includes('lines'), t('للمشروع خطوط في الموازنة', 'The project has lines in the budget'), `${given.length} ${t('خطوط', 'lines')} · ${B.name}`)}
      </ul>
      {balance}
      {grant && (
        <p className="small">
          {grant.status === 'hand'
            ? (miss.length ? t('المنحة باليد: لا يخرج مالها من دفتر المسؤول قبل أن يكتمل كل ما سبق.', 'The grant is in hand: its money cannot leave the Respo book until all the above is ✓.')
              : t('المنحة باليد: يمكن الآن تحويل مالها من دفتر المسؤول (تحويل، واختر المنحة).', 'The grant is in hand: its money can now be transferred from the Respo book (a transfer, choosing the grant).'))
            : t('حين تصل المنحة، انقلها إلى «باليد» في صفحة المنح.', 'When the grant arrives, move it to "In hand" on the Grants page.')}
        </p>
      )}
      {nav}
    </>
  );
}

/** The lines given to a project in this budget, and the button that chooses them. */
function LinesOf({ b, projectId, onChanged }: { b: BudgetPayload; projectId: number; onChanged: () => Promise<void> }) {
  const { d } = useApp();
  const [giving, setGiving] = useState(false);
  const given = b.amounts.filter((x) => x.account_id === projectId);
  const line = (id: number) => d.lists.lines.find((l) => l.id === id);
  return (
    <div className="card" style={{ padding: 12 }}>
      <table className="t">
        <tbody>
          {given.map((x) => {
            const its = b.items.filter((i) => i.line_id === x.line_id);
            return (
              <tr key={x.line_id}>
                <td>{d.lists.headings.find((h) => h.id === line(x.line_id)?.heading_id)?.name} › <b>{line(x.line_id)?.name}</b>
                  {its.length ? <div className="muted small">{its.map((i) => `${i.name} ($${fmtUsd(itemTotal(i))})`).join(' · ')}</div> : null}</td>
                <td className="n">{x.amount_usd ? `$${fmtUsd(x.amount_usd)}` : <span className="muted small">{t('بلا مبلغ بعد', 'no amount yet')}</span>}</td>
              </tr>
            );
          })}
          {!given.length && <tr><td className="muted">{t('لا خطوط بعد.', 'No lines yet.')}</td></tr>}
        </tbody>
      </table>
      <button className="btn primary" style={{ marginTop: 8 }} onClick={() => setGiving(true)}>{t('اختر خطوطه…', 'Choose its lines…')}</button>
      <span className="muted small"> {t('الخطوط غير الممولة تظهر بالأحمر.', 'Lines not funded show in red.')}</span>
      {giving && <GiveLines b={b} fundId={projectId} onClose={() => setGiving(false)} onDone={async () => { setGiving(false); await onChanged(); }} />}
    </div>
  );
}

/** A line the list does not have yet: added under its heading, then chosen above. */
function AddLine({ onAdded }: { onAdded: () => Promise<void> }) {
  const { s, d, can } = useApp();
  const [heading, setHeading] = useState<number | null>(null);
  const [name, setName] = useState('');
  if (!can('lists.manage')) return null;
  // a database that takes from the main list asks the administrator instead (Lists → Budget)
  if (d.lists.headings.some((h) => h.in_main))
    return <p className="muted small" style={{ marginTop: 10 }}>{t('خط غير موجود؟ اطلبه من المدير: القوائم ← الموازنة ← «اطلب بنداً أو خطاً…».', 'A line that is not there? Ask the administrator: Lists → Budget → "Ask for a heading or a line…".')}</p>;
  const expHeadings = d.lists.headings.filter((h) => h.active && d.lists.headingTypes.some((x) => x.heading_id === h.id && x.type === 'Exp'));
  const add = async () => {
    try {
      await s.api.call('line.add', { headingId: heading!, name: name.trim() });
      toast(t('أُضيف الخط: اختره الآن في «اختر خطوطه…»', 'Line added: now choose it in "Choose its lines…"'));
      setName('');
      await onAdded();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <details style={{ marginTop: 10 }}>
      <summary className="small">{t('خط غير موجود في القائمة؟ أضفه', 'A line that is not in the list? Add it')}</summary>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
        <Field label={t('البند', 'Heading')}><div style={{ minWidth: 200 }}><Select value={heading} options={expHeadings.map((h) => ({ value: h.id, label: h.name }))} onChange={setHeading} /></div></Field>
        <Field label={t('اسم الخط', 'Name of the line')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <button className="btn" disabled={heading == null || !name.trim()} onClick={add}>＋ {t('أضف', 'Add')}</button>
      </div>
      <p className="muted small">{t('الخط الجديد لهذا المركز فقط؛ اطلب من المدير أن يضيفه إلى القائمة الرئيسية.', 'A new line is for this centre only; ask the administrator to add it to the main list.')}</p>
    </details>
  );
}

