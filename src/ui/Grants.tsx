// Grants (the Superior only): one card per grant, following the money —
// promised → approved → transferred by the donor → in the bank → in hand. In hand,
// it is an income in the Respo book; from there it is transferred to Main
// (confirmed by the Accountant) and spent on the accounts it is for.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp, useNames } from '../state';
import { GRANT_STEPS, grantFlows, type GrantCard, type GrantPart, type GrantShare, type GrantStep } from '../domain/grants';
import { Field, Modal, Seg, Select, confirmBox, errText, fmtDate, fmtUsd, parseAmount, t, toast, todayIso } from './kit';
import { CENTRES, centreStyle, type CentreKey } from '../brand';
import { tx } from '../i18n';
import { GuideLink } from '../guide/GuideView';
import { GrantSteps, MISSING_LABEL, type GrantMissing } from './GrantSteps';
import { ProjectSheet } from './ProjectSheet';

const STEP_LABEL: Record<GrantStep, () => string> = {
  promised: () => t('موعودة', 'Promised'),
  approved: () => t('موافَق عليها', 'Approved'),
  transferred: () => t('حوّلها المانح', 'Transferred by the donor'),
  bank: () => t('في البنك', 'In the bank'),
  hand: () => t('باليد', 'In hand'),
};
const STEP_DATE: Record<GrantStep, keyof GrantCard> = { promised: 'promised_on', approved: 'approved_on', transferred: 'transferred_on', bank: 'bank_on', hand: 'hand_on' };
const money = (n: number, cur: string) => (cur === 'EUR' ? `€${fmtUsd(n)}` : `$${fmtUsd(n)}`);

/** What of a grant comes to this centre: its share here (the grant's parts here), else the whole grant when it is not divided. */
export function shareHere(g: GrantCard, parts: GrantPart[], shares: GrantShare[]) {
  const mine = parts.filter((p) => p.grant_id === g.id).reduce((a, p) => a + p.amount, 0);
  if (mine > 0) return mine;
  return shares.some((x) => x.grant_id === g.id) ? 0 : g.amount;
}

export function Grants() {
  const { s, d, reload } = useApp();
  const names = useNames();
  const [editing, setEditing] = useState<GrantCard | 'new' | null>(null);
  const [stepping, setStepping] = useState<{ g: GrantCard; to: GrantStep } | null>(null);
  // the step by step of a grant (new, or one to finish): grant and project → lines → amounts → check
  const [guided, setGuided] = useState<string | 'new' | null>(null);
  const [sheet, setSheet] = useState<number | null>(null);
  // what each grant still needs before its money may leave the Respo book
  const [ready, setReady] = useState<Record<string, GrantMissing[]>>({});
  const loadReady = useCallback(() => { s.api.call('grant.readiness', {}).then(setReady).catch(() => setReady({})); }, [s]);
  useEffect(() => { loadReady(); }, [loadReady, d]);
  const [showDone, setShowDone] = useState(false);
  const [donorF, setDonorF] = useState<number | null>(null);
  const flows = useMemo(() => grantFlows(d.grants, d.grantParts, d.rows, d.comp), [d]);
  const done = (g: GrantCard) => g.status === 'hand' && (flows.get(g.id)?.left ?? 1) <= 0.5;
  const shown = d.grants.filter((g) => (showDone || !done(g)) && (donorF == null || g.donor_id === donorF));
  const sum = (f: (g: GrantCard) => number) => d.grants.reduce((a, g) => a + f(g), 0);
  const here = (g: GrantCard) => shareHere(g, d.grantParts, d.grantShares);
  const tot = {
    // a grant divided between centres: only this centre's share comes here
    coming: sum((g) => (g.status !== 'hand' ? (g.currency === 'USD' ? here(g) : 0) : 0)),
    comingEur: sum((g) => (g.status !== 'hand' && g.currency === 'EUR' ? here(g) : 0)),
    withSup: sum((g) => flows.get(g.id)?.withSup ?? 0),
    sent: sum((g) => (flows.get(g.id)?.sent ?? 0) + (flows.get(g.id)?.sentWaiting ?? 0)),
    left: sum((g) => flows.get(g.id)?.left ?? 0),
  };
  const remove = async (g: GrantCard) => {
    if (!(await confirmBox(t('حذف هذه المنحة؟', 'Delete this grant?'), true))) return;
    try {
      await s.api.call('grant.delete', { id: g.id });
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const next = (g: GrantCard) => GRANT_STEPS[GRANT_STEPS.indexOf(g.status) + 1] as GrantStep | undefined;
  const prev = (g: GrantCard) => GRANT_STEPS[GRANT_STEPS.indexOf(g.status) - 1] as GrantStep | undefined;

  if (guided) return <GrantSteps grantId={guided === 'new' ? null : guided} onClose={async () => { setGuided(null); await reload(); }} />;

  return (
    <>
      <div className="page-head">
        <h1>{t('المنح', 'Grants')}<GuideLink id="grants" /></h1>
        <div className="row">
          <label className="row small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {t('مع المنح المصروفة كلها', 'Include fully spent grants')}</label>
          <div style={{ minWidth: 170 }} className="field"><Select value={donorF} options={d.lists.donors.map((x) => ({ value: x.id, label: x.name }))} onChange={setDonorF} placeholder={t('كل المانحين', 'All donors')} /></div>
          <button className="btn" title={t('لتسجيل منحة موعودة بسرعة؛ تُكمل خطواتها لاحقاً', 'To note a promised grant quickly; its steps are finished later')} onClick={() => setEditing('new')}>＋ {t('منحة موعودة (سريع)', 'Promised grant (quick)')}</button>
          <button className="btn primary" onClick={() => setGuided('new')}>＋ {t('منحة، خطوة بخطوة', 'Grant, step by step')}</button>
        </div>
      </div>
      <div className="alert info small">{t('سرّي — يراه الرئيس فقط. «باليد» = في دفتر المسؤول (Respo)؛ ثم يُحوَّل إلى الرئيسي ويؤكده المحاسب.', 'Confidential — only the Superior sees this. "In hand" = in the Respo book; then it is transferred to Main and the Accountant confirms.')}</div>

      <div className="cards" style={{ marginBottom: 14 }}>
        <div className="card"><div className="k">{t('في الطريق (قبل «باليد»)', 'On the way (before "in hand")')}</div><div className="v ltr">${fmtUsd(tot.coming)}{tot.comingEur ? ` + €${fmtUsd(tot.comingEur)}` : ''}</div></div>
        <div className="card"><div className="k">{t('في دفتر المسؤول', 'In the Respo')}</div><div className="v ltr">${fmtUsd(tot.withSup)}</div></div>
        <div className="card"><div className="k">{t('أُرسل من المسؤول', 'Sent from the Respo')}</div><div className="v ltr">${fmtUsd(tot.sent)}</div></div>
        <div className="card"><div className="k">{t('باقٍ لم يُصرف', 'Left, not yet spent')}</div><div className="v ltr">${fmtUsd(tot.left)}</div></div>
      </div>

      <div className="grant-grid">
        {shown.map((g) => {
          const f = flows.get(g.id)!;
          const parts = d.grantParts.filter((p) => p.grant_id === g.id);
          const shares = SHARE_CENTRES.flatMap((k) => d.grantShares.filter((x) => x.grant_id === g.id && x.centre === k));
          const i = GRANT_STEPS.indexOf(g.status);
          return (
            <div key={g.id} className="card grant-card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="grant-donor">{names.donor(g.donor_id)}</div>
                  <div className="muted small">{g.reference ? `${t('عقد', 'Contract')} ${g.reference}` : ''}{g.note ? ` · ${g.note}` : ''}</div>
                </div>
                <div className="grant-amount ltr">{money(g.amount, g.currency)}</div>
              </div>
              <ol className="steps">
                {GRANT_STEPS.map((st, k) => (
                  <li key={st} className={k < i ? 'done' : k === i ? 'now' : ''}>
                    <span className="dot" />
                    <span className="lbl">{STEP_LABEL[st]()}</span>
                    <span className="when ltr">{(g[STEP_DATE[st]] as string | null) ? fmtDate(g[STEP_DATE[st]] as string) : ''}</span>
                  </li>
                ))}
              </ol>
              {shares.length > 0 && (
                <div className="small">
                  <span className="muted">{t('المراكز', 'Centres')}: </span>
                  {shares.map((x, k) => <span key={x.centre}>{k > 0 ? ' · ' : ''}{x.centre === s.centre ? <b>{tx(centreStyle(x.centre).name)}</b> : tx(centreStyle(x.centre).name)} <span className="ltr">{money(x.amount, g.currency)}</span></span>)}
                </div>
              )}
              <div className="small">
                <span className="muted">{t('المشروع هنا', 'The project here')}: </span>
                {parts.length ? parts.map((p, k) => <span key={k}>{k > 0 ? ' · ' : ''}{p.account_id == null ? <span className="bad">{t('لا مشروع بعد', 'no project yet')}</span> : <button className="link" title={t('صفحة المشروع', 'The project page')} onClick={() => setSheet(p.account_id)}><b>{names.account(p.account_id)}</b></button>}{parts.length > 1 || shares.length ? <span className="ltr"> {money(p.amount, g.currency)}</span> : null}</span>) : <span className="muted">{t('لا حصة هنا', 'no share here')}</span>}
              </div>
              {(ready[g.id] ?? []).length > 0 && (
                <div className={`alert ${g.status === 'hand' ? 'warn' : 'info'} small`} style={{ margin: '8px 0 0' }}>
                  {t('للإكمال', 'To finish')}: {(ready[g.id] ?? []).map((k) => MISSING_LABEL[k]()).join(' · ')}
                  {g.status === 'hand' && <div>{t('لا يخرج مالها من دفتر المسؤول قبل ذلك.', 'Its money cannot leave the Respo book before that.')}</div>}
                  <div><button className="btn small primary" style={{ marginTop: 6 }} onClick={() => setGuided(g.id)}>{t('أكمل الخطوات →', 'Finish the steps →')}</button></div>
                </div>
              )}
              {g.status === 'hand' && (
                <div className="grant-flow">
                  <div><span>{t('باليد', 'In hand')}</span><b className="ltr">${fmtUsd(f.inHand)}</b></div>
                  <div><span>{t('في دفتر المسؤول', 'In the Respo')}</span><b className="ltr">${fmtUsd(f.withSup)}</b></div>
                  <div><span>{t('أُرسل', 'Sent')}</span><b className="ltr">${fmtUsd(f.sent)}</b>{f.sentWaiting > 0.004 && <em className="small ltr"> +${fmtUsd(f.sentWaiting)} ⏳</em>}</div>
                  <div><span>{t('صُرف', 'Spent')}</span><b className="ltr">${fmtUsd(f.spent)}</b></div>
                  <div><span>{t('باقٍ', 'Left')}</span><b className={`ltr ${f.left < -0.5 ? 'bad' : ''}`}>${fmtUsd(f.left)}</b></div>
                  <div className="used-track" style={{ gridColumn: '1 / -1' }}><div className="used-fill" style={{ width: `${f.inHand ? Math.min(100, (f.spent / f.inHand) * 100) : 0}%`, background: '#8A8577' }} /></div>
                </div>
              )}
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap' }}>
                <div className="row">
                  {prev(g) && <button className="btn small ghost" title={t('رجوع خطوة', 'One step back')} onClick={() => setStepping({ g, to: prev(g)! })}>↶</button>}
                  {next(g) && <button className="btn small primary" onClick={() => setStepping({ g, to: next(g)! })}>→ {STEP_LABEL[next(g)!]()}</button>}
                </div>
                <div className="row">
                  <button className="btn small" onClick={() => setEditing(g)}>{t('تعديل', 'Edit')}</button>
                  <button className="btn small danger" onClick={() => remove(g)}>✕</button>
                </div>
              </div>
            </div>
          );
        })}
        {!shown.length && <p className="muted">{t('لا منح بعد.', 'No grants yet.')}</p>}
      </div>
      <p className="muted small">{t('لإرسال مال منحة إلى الرئيسي: سجّل «تحويلاً» من دفتر المسؤول إلى الرئيسي واختر المنحة فيه. كل نفقة على حساب المنحة تُخصم من أقدم منحة لهذا الحساب.', 'To send a grant\'s money to Main: record a "Transfer" from the Respo book to Main and choose the grant in it. Each expense on a grant\'s account uses the oldest grant for that account.')}</p>
      {editing && <GrantModal start={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
      {sheet != null && <ProjectSheet projectId={sheet} onClose={() => setSheet(null)} />}
      {stepping && <StepModal g={stepping.g} to={stepping.to} onClose={() => setStepping(null)} onDone={async () => { setStepping(null); await reload(); }} />}
    </>
  );
}

/** The centres a grant can be divided between (the order of the menus). */
const SHARE_CENTRES: CentreKey[] = ['jaramana', 'aleppo', 'homs', 'other'];

/**
 * New or changed grant (Fouad, 2026-11-01): the donor written as a name, the contract number,
 * the amount, the share of each centre; this centre's share goes to one fund here.
 */
export function GrantModal({ start, onClose, onSaved, asStep }: { start: GrantCard | null; onClose: () => void; onSaved: (id: string) => Promise<void>; /** shown as step 1 of the step by step, not in a window */ asStep?: boolean }) {
  const { s, d } = useApp();
  const names = useNames();
  const here = (s.centre ?? 'other') as CentreKey;
  const NEW_FUND = -1;
  const [donor, setDonor] = useState(start ? names.donor(start.donor_id) : '');
  const [amount, setAmount] = useState(start ? String(start.amount) : '');
  const [currency, setCurrency] = useState<'USD' | 'EUR'>(start?.currency ?? 'USD');
  const [reference, setReference] = useState(start?.reference ?? '');
  const [note, setNote] = useState(start?.note ?? '');
  const oldParts = start ? d.grantParts.filter((p) => p.grant_id === start.id) : [];
  // several centres, or only this one
  const [split, setSplit] = useState(() => !!start && d.grantShares.some((x) => x.grant_id === start.id && x.centre !== here));
  const [shares, setShares] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const x of start ? d.grantShares.filter((y) => y.grant_id === start.id) : []) o[x.centre] = String(x.amount);
    return o;
  });
  // this centre's share goes to one project, or is divided between several (each with its amount)
  type Row = { fund: number | null; name: string; amount: string };
  const [rows, setRows] = useState<Row[]>(() => {
    const own = oldParts.filter((p) => p.account_id != null);
    return own.length ? own.map((p) => ({ fund: p.account_id, name: '', amount: String(p.amount) })) : [{ fund: start ? null : NEW_FUND, name: '', amount: '' }];
  });
  const setRow = (i: number, r: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...r } : x)));
  // the projects' dates here: the grant's period (outside them, its lines' expenses are not funded)
  const fundNow = d.lists.accounts.find((a) => a.id === rows[0]?.fund);
  const [pStart, setPStart] = useState(fundNow?.start_date ?? '');
  const [pEnd, setPEnd] = useState(fundNow?.end_date ?? '');
  const total = parseAmount(amount);
  const shareOf = (k: string) => parseAmount(shares[k] ?? '') || 0;
  const sum = SHARE_CENTRES.reduce((a, k) => a + shareOf(k), 0);
  const hereAmount = split ? shareOf(here) : total;
  // a fund has one grant: the funds already taken by another grant are not offered
  const taken = new Set(d.grantParts.filter((p) => p.grant_id !== start?.id && p.account_id != null).map((p) => p.account_id!));
  const funds = (current: number | null) => [
    ...d.lists.accounts.filter((a) => (a.active && !taken.has(a.id)) || a.id === current).map((a) => ({ value: a.id, label: a.name })),
    { value: NEW_FUND, label: `＋ ${t('مشروع جديد', 'A new project')}` },
  ];
  const autoName = [donor.trim(), reference.trim()].filter(Boolean).join(' ');
  const several = rows.length > 1;
  const rowsSum = rows.reduce((a, r) => a + (parseAmount(r.amount) || 0), 0);
  const ok = !!donor.trim() && total > 0 && (!split || Math.abs(sum - total) <= 0.01)
    && (hereAmount <= 0 || (rows.every((r) => r.fund != null) && (!several || Math.abs(rowsSum - hereAmount) <= 0.01)));
  const save = async () => {
    try {
      const id: string = await s.api.call('grant.save', {
        id: start?.id, donor: donor.trim(), amount: total, currency, reference: reference.trim() || null, note: note.trim() || null,
        here, shares: split ? SHARE_CENTRES.filter((k) => shareOf(k) > 0).map((k) => ({ centre: k, amount: shareOf(k) })) : [],
        projects: rows.map((r, i) => ({ fund_id: r.fund === NEW_FUND ? null : r.fund, new_fund: r.fund === NEW_FUND ? (r.name.trim() || (several ? `${autoName} ${i + 1}` : autoName)) : null, amount: several ? parseAmount(r.amount) : null })),
        start_date: pStart || null, end_date: pEnd || null,
      });
      toast(t('حُفظ', 'Saved'));
      await onSaved(id);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const Frame = asStep ? StepFrame : Modal;
  return (
    <Frame title={start ? t('تعديل المنحة', 'Edit the grant') : t('منحة جديدة', 'New grant')} onClose={onClose}>
      <div className="grid2">
        <Field label={t('المانح', 'Donor')}>
          <input list="grant-donors" value={donor} onChange={(e) => setDonor(e.target.value)} />
          <datalist id="grant-donors">{d.lists.donors.filter((x) => x.active).map((x) => <option key={x.id} value={x.name} />)}</datalist>
        </Field>
        <Field label={t('رقم العقد', 'Contract number')}><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label={t('المبلغ', 'Amount')}>
          <div className="row">
            <input className="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 140 }} />
            <Seg value={currency} onChange={setCurrency} options={[{ value: 'USD', label: 'USD $' }, { value: 'EUR', label: 'EUR €' }]} />
          </div>
        </Field>
        <Field label={t('ملاحظة (الاتفاق…)', 'Note (the agreement…)')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>

      <h3 style={{ marginTop: 12 }}>{t('لأي مركز؟', 'For which centre?')}</h3>
      <Seg value={split ? 'split' : 'here'} onChange={(v) => {
        setSplit(v === 'split');
        if (v === 'split' && !Object.keys(shares).length && total > 0) setShares({ [here]: String(total) });
      }} options={[
        { value: 'here', label: t(`كلها لـ${CENTRES[here].name.ar}`, `All for ${CENTRES[here].name.en}`) },
        { value: 'split', label: t('مقسومة بين المراكز', 'Divided between centres') },
      ]} />
      {split && (
        <table className="t" style={{ marginTop: 8, maxWidth: 420 }}>
          <tbody>
            {SHARE_CENTRES.map((k) => (
              <tr key={k}>
                <td>{tx(CENTRES[k].name)}{k === here && <span className="muted small"> · {t('هنا', 'here')}</span>}</td>
                <td className="n"><input className="ltr" inputMode="decimal" placeholder={currency} value={shares[k] ?? ''} onChange={(e) => setShares({ ...shares, [k]: e.target.value })} style={{ width: 120 }} /></td>
              </tr>
            ))}
            <tr>
              <td><b>{t('المجموع', 'Total')}</b></td>
              <td className={`n ltr ${Math.abs(sum - total) > 0.01 ? 'bad' : 'ok'}`}>{money(sum, currency)} / {money(total || 0, currency)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {hereAmount > 0 ? (
        <>
          <h3 style={{ marginTop: 12 }}>{several ? t('المشاريع هنا', 'The projects here') : t('المشروع هنا', 'The project here')} <span className="muted small ltr">{money(hereAmount, currency)}</span></h3>
          {rows.map((r, i) => (
            <div key={i} className="row" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}><Select value={r.fund} options={funds(r.fund)} onChange={(v) => setRow(i, { fund: v })} /></div>
              {r.fund === NEW_FUND && <input style={{ flex: '1 1 180px' }} value={r.name} placeholder={several ? t('اسم المشروع (مثلاً: تشغيل، أثاث)', 'Name of the project (e.g. running, furniture)') : autoName} onChange={(e) => setRow(i, { name: e.target.value })} />}
              {several && <input className="ltr" inputMode="decimal" placeholder={currency} value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} style={{ width: 120 }} />}
              {several && <button className="btn small ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn small" onClick={() => setRows([...rows.map((x) => (several ? x : { ...x, amount: String(hereAmount) })), { fund: NEW_FUND, name: '', amount: '' }])}>＋ {t('مشروع آخر (تقسيم الحصة)', 'Another project (divide the share)')}</button>
            {several && <span className={`small ${Math.abs(rowsSum - hereAmount) > 0.01 ? 'bad' : 'ok'}`}>{t('المجموع', 'Total')}: <span className="ltr">{money(rowsSum, currency)} / {money(hereAmount, currency)}</span></span>}
          </div>
          <div className="grid2" style={{ marginTop: 8 }}>
            <Field label={t('بداية المشروع', 'Project starts')}><input type="date" value={pStart} onChange={(e) => setPStart(e.target.value)} /></Field>
            <Field label={t('نهاية المشروع', 'Project ends')}><input type="date" value={pEnd} onChange={(e) => setPEnd(e.target.value)} /></Field>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>{t('خارج هذين التاريخين، نفقات خطوط المشروع غير ممولة.', "Outside these dates, the expenses on the project's lines are not funded.")}</p>
          <p className="muted small">{t('المشروع لا يكون لمنحتين، والمنحة قد تُقسم بين عدة مشاريع هنا (مثلاً التشغيل والأثاث). في الموازنة، كل خط له مشروع واحد.', 'A project never has two grants; a grant may be divided between several projects here (e.g. running costs and furniture). In the budget, each line has one project.')}</p>
        </>
      ) : split && <p className="muted small">{t('لا حصة لهذا المركز: لا مشروع هنا.', 'No share for this centre: no project here.')}</p>}

      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!ok} onClick={save}>{asStep ? t('احفظ وتابع ←', 'Save and continue →') : t('احفظ', 'Save')}</button>
      </div>
    </Frame>
  );
}

/** The grant's form as the first step of the step by step (in the page, not a window). */
function StepFrame({ children }: { title: ReactNode; children: ReactNode; onClose: () => void }) {
  return <div className="card" style={{ padding: 16 }}>{children}</div>;
}

/** Moving a grant to a step, with its date; "in hand" asks the dollars really received. */
function StepModal({ g, to, onClose, onDone }: { g: GrantCard; to: GrantStep; onClose: () => void; onDone: () => Promise<void> }) {
  const { s, d } = useApp();
  const [date, setDate] = useState(todayIso());
  // the dollars that come here: this centre's share of the grant
  const [usd, setUsd] = useState(g.currency === 'USD' ? String(shareHere(g, d.grantParts, d.grantShares)) : '');
  const back = GRANT_STEPS.indexOf(to) < GRANT_STEPS.indexOf(g.status);
  const go = async () => {
    try {
      await s.api.call('grant.step', { id: g.id, status: to, date, hand_usd: to === 'hand' ? parseAmount(usd) : null });
      toast(t('حُفظ', 'Saved'));
      await onDone();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <Modal narrow title={back ? t(`رجوع إلى «${STEP_LABEL[to]()}»`, `Back to "${STEP_LABEL[to]()}"`) : STEP_LABEL[to]()} onClose={onClose}>
      <Field label={t('التاريخ', 'Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {to === 'hand' && (
        <>
          <Field label={t('الدولارات المستلمة باليد', 'Dollars received in hand')}><input className="ltr" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} /></Field>
          <p className="muted small">{t('تُسجَّل إيراداً في دفتر المسؤول، مربوطاً بهذه المنحة.', "It is recorded as an income in the Respo book, linked to this grant.")}{g.currency === 'EUR' ? ` ${t('المنحة باليورو: اكتب الدولارات بعد التصريف.', 'The grant is in euros: write the dollars after exchange.')}` : ''}</p>
        </>
      )}
      {back && g.status === 'hand' && <div className="alert warn">{t('يُحذف الإيراد من دفتر المسؤول.', "The income is removed from the Respo book.")}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!date || (to === 'hand' && !(parseAmount(usd) > 0))} onClick={go}>{t('تأكيد', 'Confirm')}</button>
      </div>
    </Modal>
  );
}
