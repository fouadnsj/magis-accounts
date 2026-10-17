// Grants (the Superior only): one card per grant, following the money —
// promised → approved → transferred by the donor → in the bank → in hand. In hand,
// it is an income in the Respo book; from there it is transferred to Main
// (confirmed by the Accountant) and spent on the accounts it is for.
import { useMemo, useState } from 'react';
import { useApp, useNames } from '../state';
import { GRANT_STEPS, grantFlows, type GrantCard, type GrantStep } from '../domain/grants';
import { Field, Modal, Seg, Select, confirmBox, errText, fmtDate, fmtUsd, parseAmount, t, toast, todayIso } from './kit';

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
  const flows = useMemo(() => grantFlows(d.grants, d.grantParts, d.rows, d.comp), [d]);
  const done = (g: GrantCard) => g.status === 'hand' && (flows.get(g.id)?.left ?? 1) <= 0.5;
  const shown = d.grants.filter((g) => showDone || !done(g));
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
          <button className="btn primary" onClick={() => setEditing('new')}>＋ {t('منحة', 'Grant')}</button>
        </div>
      </div>
      <div className="alert info small">{t('سرّي — يراه الرئيس فقط. «باليد» = في دفتر المسؤول (Respo)؛ ثم يُحوَّل إلى الرئيسي ويؤكده المحاسب.', 'Confidential — only the Superior sees this. "In hand" = in the Respo book; then it is transferred to Main and the Accountant confirms.')}</div>

      <div className="cards" style={{ marginBottom: 14 }}>
        <div className="card"><div className="k">{t('في الطريق (قبل «باليد»)', 'On the way (before "in hand")')}</div><div className="v ltr">${fmtUsd(tot.coming)}{tot.comingEur ? ` + €${fmtUsd(tot.comingEur)}` : ''}</div></div>
        <div className="card"><div className="k">{t('مع الرئيس', 'With the Superior')}</div><div className="v ltr">${fmtUsd(tot.withSup)}</div></div>
        <div className="card"><div className="k">{t('حُوّل إلى الرئيسي', 'Transferred to Main')}</div><div className="v ltr">${fmtUsd(tot.sent)}</div></div>
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
                  <div><span>{t('مع الرئيس', 'With the Superior')}</span><b className="ltr">${fmtUsd(f.withSup)}</b></div>
                  <div><span>{t('حُوّل إلى الرئيسي', 'To Main')}</span><b className="ltr">${fmtUsd(f.sent)}</b>{f.sentWaiting > 0.004 && <em className="small ltr"> +${fmtUsd(f.sentWaiting)} ⏳</em>}</div>
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
      {stepping && <StepModal g={stepping.g} to={stepping.to} onClose={() => setStepping(null)} onDone={async () => { setStepping(null); await reload(); }} />}
    </>
  );
}

/** New or changed grant: donor, amount, currency, what it is for. */
function GrantModal({ start, onClose, onSaved }: { start: GrantCard | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { s, d } = useApp();
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
  const total = parseAmount(amount);
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
        <Field label={t('المانح', 'Donor')}><Select value={donor} options={d.lists.donors.filter((x) => x.active || x.id === donor).map((x) => ({ value: x.id, label: x.name }))} onChange={setDonor} /></Field>
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
