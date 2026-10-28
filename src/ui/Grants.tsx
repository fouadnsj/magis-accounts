// Grants (the Superior only): one card per grant, following the money —
// promised → approved → transferred by the donor → in the bank → in hand. In hand,
// it is an income in the Respo book; from there it is transferred to Main
// (confirmed by the Accountant) and spent on the accounts it is for.
import { useEffect, useMemo, useState } from 'react';
import { useApp, useNames } from '../state';
import { GRANT_STEPS, grantFlows, type GrantCard, type GrantStep } from '../domain/grants';
import type { BudgetPayload } from '../ops';
import { WHOLE, cellsOf, cover, effectivePct } from '../domain/budget';
import { Field, Modal, Seg, Select, confirmBox, errText, fmtDate, fmtUsd, parseAmount, promptBox, t, toast, todayIso } from './kit';

const STEP_LABEL: Record<GrantStep, () => string> = {
  promised: () => t('موعودة', 'Promised'),
  approved: () => t('موافَق عليها', 'Approved'),
  transferred: () => t('حوّلها المانح', 'Transferred by the donor'),
  bank: () => t('في البنك', 'In the bank'),
  hand: () => t('باليد', 'In hand'),
};
const STEP_DATE: Record<GrantStep, keyof GrantCard> = { promised: 'promised_on', approved: 'approved_on', transferred: 'transferred_on', bank: 'bank_on', hand: 'hand_on' };
const money = (n: number, cur: string) => (cur === 'EUR' ? `€${fmtUsd(n)}` : `$${fmtUsd(n)}`);

export function Grants() {
  const { s, d, reload } = useApp();
  const names = useNames();
  const [editing, setEditing] = useState<GrantCard | 'new' | null>(null);
  const [stepping, setStepping] = useState<{ g: GrantCard; to: GrantStep } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [donorsOpen, setDonorsOpen] = useState(false);
  const [donorF, setDonorF] = useState<number | null>(null);
  const cov = useBudgetCover();
  const flows = useMemo(() => grantFlows(d.grants, d.grantParts, d.rows, d.comp), [d]);
  const done = (g: GrantCard) => g.status === 'hand' && (flows.get(g.id)?.left ?? 1) <= 0.5;
  const shown = d.grants.filter((g) => (showDone || !done(g)) && (donorF == null || g.donor_id === donorF));
  const sum = (f: (g: GrantCard) => number) => d.grants.reduce((a, g) => a + f(g), 0);
  const tot = {
    coming: sum((g) => (g.status !== 'hand' ? (g.currency === 'USD' ? g.amount : 0) : 0)),
    comingEur: sum((g) => (g.status !== 'hand' && g.currency === 'EUR' ? g.amount : 0)),
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

  return (
    <>
      <div className="page-head">
        <h1>{t('المنح', 'Grants')}</h1>
        <div className="row">
          <label className="row small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {t('مع المنح المصروفة كلها', 'Include fully spent grants')}</label>
          <div style={{ minWidth: 170 }} className="field"><Select value={donorF} options={d.lists.donors.map((x) => ({ value: x.id, label: x.name }))} onChange={setDonorF} placeholder={t('كل المانحين', 'All donors')} /></div>
          <button className="btn" onClick={() => setDonorsOpen(true)}>👥 {t('المانحون', 'Donors')}</button>
          <button className="btn primary" onClick={() => setEditing('new')}>＋ {t('منحة', 'Grant')}</button>
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
          const i = GRANT_STEPS.indexOf(g.status);
          return (
            <div key={g.id} className="card grant-card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="grant-donor">{names.donor(g.donor_id)}</div>
                  <div className="muted small">{g.reference ?? ''}{g.note ? ` · ${g.note}` : ''}</div>
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
              <div className="small">
                <span className="muted">{t('لـ', 'For')}: </span>
                {parts.map((p, k) => <span key={k}>{k > 0 ? ' · ' : ''}{p.account_id == null ? t('المركز كله', 'the whole centre') : names.account(p.account_id)}{parts.length > 1 ? <span className="ltr"> {money(p.amount, g.currency)}</span> : null}</span>)}
              </div>
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
      {donorsOpen && <DonorsModal onClose={() => setDonorsOpen(false)} cov={cov} />}
      {editing && <GrantModal cov={cov} start={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
      {stepping && <StepModal g={stepping.g} to={stepping.to} onClose={() => setStepping(null)} onDone={async () => { setStepping(null); await reload(); }} />}
    </>
  );
}

/** What the current budget expects from each donor, per account (USD): the link between the budget and the grants. */
function useBudgetCover() {
  const { s, d } = useApp();
  const [b, setB] = useState<BudgetPayload | null>(null);
  useEffect(() => {
    s.api.call('budget.get', { budgetId: null }).then(setB).catch(() => setB(null));
  }, [s]);
  return useMemo(() => {
    const per = new Map<number, Map<number, number>>(); // donor → account → USD
    if (!b?.budget || !b.current) return { per, name: null as string | null };
    const headingOf = new Map(d.lists.lines.map((l) => [l.id, l.heading_id]));
    const outside = new Set(d.lists.accounts.filter((a) => a.outside_budget).map((a) => a.id));
    const cells = cellsOf(b.amounts, b.accounts).filter((x) => !outside.has(x.account_id));
    const eff = effectivePct(b.allocs, cells, headingOf);
    for (const x of cells) {
      const c = cover(b.allocs, eff, x.account_id, x.line_id, headingOf.get(x.line_id) ?? WHOLE, x.amount_usd);
      for (const dn of c.donors) {
        const m = per.get(dn.donor_id) ?? new Map<number, number>();
        m.set(x.account_id, (m.get(x.account_id) ?? 0) + dn.usd);
        per.set(dn.donor_id, m);
      }
    }
    return { per, name: b.budget.name };
  }, [b, d.lists]);
}

/** The donors, here with the grants (Fouad, 28 October 2026): add, rename, switch off; what each is expected to give in the budget, and what came. */
function DonorsModal({ onClose, cov }: { onClose: () => void; cov: ReturnType<typeof useBudgetCover> }) {
  const { s, d, reload } = useApp();
  const [name, setName] = useState('');
  const act = async (f: () => Promise<unknown>, ok?: string) => {
    try {
      await f();
      await reload();
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(errText(e), true);
      return false;
    }
  };
  const usdOf = (g: GrantCard) => (g.currency === 'USD' ? g.amount : 0);
  return (
    <Modal title={t('المانحون', 'Donors')} onClose={onClose}>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="inp" style={{ flex: 1 }} placeholder={t('مانح جديد', 'New donor')} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={!name.trim()} onClick={async () => (await act(() => s.api.call('donor.save', { name, default_project_id: null }), t('أضيف', 'Added'))) && setName('')}>＋</button>
      </div>
      <table className="t">
        <thead><tr><th>{t('المانح', 'Donor')}</th><th className="n">{cov.name ? t(`في الموازنة «${cov.name}»`, `In the budget "${cov.name}"`) : t('في الموازنة', 'In the budget')} $</th><th className="n">{t('منح', 'Grants')} $</th><th className="n">{t('باليد', 'In hand')} $</th><th /></tr></thead>
        <tbody>
          {d.lists.donors.map((x) => {
            const gs = d.grants.filter((g) => g.donor_id === x.id);
            const inBudget = [...(cov.per.get(x.id)?.values() ?? [])].reduce((a, b) => a + b, 0);
            return (
              <tr key={x.id} className={x.active ? '' : 'off'}>
                <td>{x.name}</td>
                <td className="n ltr">{inBudget ? fmtUsd(inBudget) : '—'}</td>
                <td className="n ltr">{gs.length ? [gs.some((g) => g.currency === 'USD') ? fmtUsd(gs.reduce((a, g) => a + usdOf(g), 0)) : '', gs.some((g) => g.currency === 'EUR') ? `€${fmtUsd(gs.reduce((a, g) => a + (g.currency === 'EUR' ? g.amount : 0), 0))}` : ''].filter(Boolean).join(' + ') : '—'}</td>
                <td className="n ltr">{gs.some((g) => g.status === 'hand') ? fmtUsd(gs.reduce((a, g) => a + (g.status === 'hand' ? g.hand_usd ?? 0 : 0), 0)) : '—'}</td>
                <td className="nowrap right">
                  <button className="btn small ghost" onClick={async () => {
                    const n = await promptBox(t('الاسم الجديد', 'New name'), x.name);
                    if (n && n !== x.name) void act(() => s.api.call('donor.save', { id: x.id, name: n, default_project_id: x.default_project_id }));
                  }}>✎</button>
                  {x.active
                    ? <button className="btn small ghost" title={t('حذف (أو إيقاف إن كان مستعملاً)', 'Delete (or deactivate if used)')} onClick={async () => {
                        // a donor with grants or budget allocations is only deactivated: they stay in the history
                        if (!(await confirmBox(t(`حذف المانح «${x.name}»؟`, `Delete the donor "${x.name}"?`), true))) return;
                        try {
                          await s.api.call('list.delete', { table: 'donor', id: x.id });
                          await reload();
                          toast(t('حُذف', 'Deleted'));
                        } catch {
                          if (await confirmBox(t(`لـ«${x.name}» منح أو تخصيصات في الموازنة: لا يُحذف. إيقافه بدلاً من ذلك؟ (يبقى في السجل ويختفي من القوائم)`, `"${x.name}" has grants or budget allocations: it cannot be deleted. Deactivate it instead? (it stays in the history and leaves the lists)`)))
                            await act(() => s.api.call('list.setActive', { table: 'donor', id: x.id, active: false }), t('أوقف', 'Deactivated'));
                        }
                      }}>✕</button>
                    : <button className="btn small ghost" onClick={() => act(() => s.api.call('list.setActive', { table: 'donor', id: x.id, active: true }))}>↺</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">{t('ما يغطيه كل مانح في الموازنة يُحدَّد في الموازنة ← المانحون.', 'What each donor covers in the budget is set in Budget → Donors.')}</p>
      <div className="modal-foot"><button className="btn primary" onClick={onClose}>{t('تم', 'Done')}</button></div>
    </Modal>
  );
}

/** New or changed grant: donor, amount, currency, what it is for. */
function GrantModal({ start, cov, onClose, onSaved }: { start: GrantCard | null; cov: ReturnType<typeof useBudgetCover>; onClose: () => void; onSaved: () => Promise<void> }) {
  const { s, d, reload } = useApp();
  const NEW_DONOR = -1;
  const [newName, setNewName] = useState<string | null>(null);
  const [donor, setDonor] = useState<number | null>(start?.donor_id ?? null);
  const [amount, setAmount] = useState(start ? String(start.amount) : '');
  const [currency, setCurrency] = useState<'USD' | 'EUR'>(start?.currency ?? 'USD');
  const [reference, setReference] = useState(start?.reference ?? '');
  const [note, setNote] = useState(start?.note ?? '');
  const ALL = 0; // the whole centre
  const [parts, setParts] = useState<{ account: number; amount: string }[]>(() => {
    const ps = start ? d.grantParts.filter((p) => p.grant_id === start.id) : [];
    return ps.length ? ps.map((p) => ({ account: p.account_id ?? ALL, amount: String(p.amount) })) : [{ account: ALL, amount: '' }];
  });
  // a donor made on the spot: once the lists are reloaded, it is the one chosen
  useEffect(() => {
    if (newName == null) return;
    const x = d.lists.donors.find((y) => y.name === newName.trim());
    if (x) { setDonor(x.id); setNewName(null); }
  }, [d.lists.donors, newName]);
  const pickDonor = async (v: number | null) => {
    if (v !== NEW_DONOR) return setDonor(v);
    const n = (await promptBox(t('اسم المانح الجديد', "The new donor's name"), ''))?.trim();
    if (!n) return;
    try {
      await s.api.call('donor.save', { name: n, default_project_id: null });
      setNewName(n);
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const total = parseAmount(amount);
  const budgetParts = donor != null ? [...(cov.per.get(donor)?.entries() ?? [])].filter(([, v]) => v > 0.5) : [];
  const fromBudget = () => {
    const rounded = budgetParts.map(([account, v]) => ({ account, amount: String(Math.round(v * 100) / 100) }));
    setParts(rounded);
    setCurrency('USD');
    if (!(total > 0)) setAmount(String(Math.round(budgetParts.reduce((a, [, v]) => a + v, 0) * 100) / 100));
  };
  const single = parts.length === 1;
  const sum = single ? total : parts.reduce((a, p) => a + (parseAmount(p.amount) || 0), 0);
  const accounts = [{ value: ALL, label: t('المركز كله', 'The whole centre') }, ...d.lists.accounts.filter((a) => a.active && !a.outside_budget).map((a) => ({ value: a.id, label: a.name }))];
  const save = async () => {
    try {
      await s.api.call('grant.save', {
        id: start?.id, donor_id: donor!, amount: total, currency, reference: reference.trim() || null, note: note.trim() || null,
        parts: parts.map((p) => ({ account_id: p.account === ALL ? null : p.account, amount: single ? total : parseAmount(p.amount) })),
      });
      toast(t('حُفظ', 'Saved'));
      await onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <Modal title={start ? t('تعديل المنحة', 'Edit the grant') : t('منحة جديدة', 'New grant')} onClose={onClose}>
      <div className="grid2">
        <Field label={t('المانح', 'Donor')}><Select value={donor} options={[...d.lists.donors.filter((x) => x.active || x.id === donor).map((x) => ({ value: x.id, label: x.name })), { value: NEW_DONOR, label: `＋ ${t('مانح جديد…', 'New donor…')}` }]} onChange={pickDonor} /></Field>
        <Field label={t('المبلغ', 'Amount')}>
          <div className="row">
            <input className="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 140 }} />
            <Seg value={currency} onChange={setCurrency} options={[{ value: 'USD', label: 'USD $' }, { value: 'EUR', label: 'EUR €' }]} />
          </div>
        </Field>
        <Field label={t('المرجع (رقم الاتفاق…)', 'Reference (agreement no.…)')}><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label={t('ملاحظة', 'Note')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <h3 style={{ marginTop: 12 }}>{t('لأي حساب؟', 'For which account?')}</h3>
      {budgetParts.length > 0 && (
        <div className="alert info small row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span>{t(`في الموازنة «${cov.name}» يغطي هذا المانح`, `In the budget "${cov.name}" this donor covers`)}: {budgetParts.map(([a, v]) => `${d.lists.accounts.find((x) => x.id === a)?.name ?? ''} $${fmtUsd(v)}`).join(' · ')}</span>
          <button className="btn small" onClick={fromBudget}>{t('خذها من الموازنة', 'Use the budget')}</button>
        </div>
      )}
      {parts.map((p, k) => (
        <div key={k} className="row" style={{ marginBottom: 6 }}>
          <div style={{ flex: 1 }}><Select value={p.account} options={accounts} onChange={(v) => setParts(parts.map((x, j) => (j === k ? { ...x, account: v ?? ALL } : x)))} /></div>
          {!single && <input className="ltr" inputMode="decimal" placeholder={currency} value={p.amount} onChange={(e) => setParts(parts.map((x, j) => (j === k ? { ...x, amount: e.target.value } : x)))} style={{ width: 120 }} />}
          {!single && <button className="btn small ghost" onClick={() => setParts(parts.filter((_, j) => j !== k))}>✕</button>}
        </div>
      ))}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn small" onClick={() => setParts([...parts, { account: ALL, amount: '' }])}>＋ {t('حساب آخر (تقسيم)', 'Another account (split)')}</button>
        {!single && <span className={`small ${Math.abs(sum - total) > 0.01 ? 'bad' : 'ok'}`}>{t('المجموع', 'Total')}: <span className="ltr">{money(sum, currency)} / {money(total || 0, currency)}</span></span>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!donor || !(total > 0) || (!single && Math.abs(sum - total) > 0.01)} onClick={save}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

/** Moving a grant to a step, with its date; "in hand" asks the dollars really received. */
function StepModal({ g, to, onClose, onDone }: { g: GrantCard; to: GrantStep; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useApp();
  const [date, setDate] = useState(todayIso());
  const [usd, setUsd] = useState(g.currency === 'USD' ? String(g.amount) : '');
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
