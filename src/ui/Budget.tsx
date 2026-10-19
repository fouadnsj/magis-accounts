// Budgets, for the Superior (and whoever is given the budget in a profile; never the book holders).
// A budget covers a period: a start month and 1–36 months. Budgets may overlap: each
// expense then belongs to one of them (the oldest that still has money on its line),
// and the leftover of a budget can be carried over to the one that continues it.
//  - Follow-up: each line's budget against what was really spent, with a colour
//    for 50 / 75 / 90 % spent, the pace against the months gone (under- or
//    over-spending), and how much of the contingency is used.
//  - Budget: per account, each line built from items (Quantity × Times × Cost,
//    as in MAGIS 2027 Budget.xlsx) or typed directly; SYP and EUR calculated;
//    import of a budget sheet; a budget from the year's spending or from another budget.
//  - Donors: who covers which part (a % or an amount of an account, a heading
//    or a line), and what is still to find.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { catIcon } from './catIcons';
import { useApp, useNames, useIcons } from '../state';
import type { BudgetPayload } from '../ops';
import {
  WHOLE, addMonths, allocWorth, assignExpenses, cellKey, cellsOf, contingencyOf, cover, defaultBudgetName, effectivePct, followUp, guessLine, inPeriod, itemTotal,
  leftoverOf, periodEnd, periodMonths, periodShare, readBudgetSheet, spentInRange, usedBand,
  type AllocStatus, type Budget, type BudgetAlloc, type BudgetBook, type BudgetItem, type BudgetRow, type Pace, type SheetRead,
} from '../domain/budget';
import { MONTHS_AR, MONTHS_EN } from '../domain/types';
import { monthWord } from '../i18n';
import { pickFile, saveFile } from '../platform';
import { donorReportXlsx } from '../io/donorReport';
import { workbookGrids, type Grid } from '../io/budgetSheet';
import { Field, Modal, Select, Seg, Tabs, confirmBox, errText, fmtPct, fmtSyp, fmtUsd, parseAmount, promptBox, t, toast } from './kit';

type Tab = 'follow' | 'edit' | 'donors';

const fmtEur = (n: number) => `€${Math.round(n).toLocaleString('en-US')}`;
/** dollars with the sign, 0 shown as $0 (not a dash) */
const usd = (n: number) => (Math.abs(n) < 0.005 ? '$0' : n < 0 ? `-$${fmtUsd(-n)}` : `$${fmtUsd(n)}`);
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const monthName = (m: number) => monthWord(m - 1, MONTHS_AR, MONTHS_EN);
/** 'YYYY-MM' → "July 2026" */
const ymName = (ym: string) => `${monthName(Number(ym.slice(5, 7)))} ${ym.slice(0, 4)}`;
const periodName = (b: Pick<Budget, 'start_ym' | 'months'>) => `${ymName(b.start_ym)} → ${ymName(periodEnd(b))} · ${b.months} ${t('شهراً', 'months')}`;

/** Every budget with what it holds, and which budget each expense belongs to (overlaps: first in, first out). */
function useAssignment(b: BudgetPayload) {
  const { d } = useApp();
  return useMemo(() => {
    const books: BudgetBook[] = b.books.map((x) => ({ budget: x.budget, cells: x.cells, lumped: new Set(x.lumped) }));
    return { books, assigned: assignExpenses(d.rows, d.comp, books) };
  }, [b, d]);
}

export function BudgetPage() {
  const { s, can } = useApp();
  const [budgetId, setBudgetId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [b, setB] = useState<BudgetPayload | null>(null);
  const [tab, setTab] = useState<Tab>('follow');
  const [editPeriod, setEditPeriod] = useState(false);
  const load = useCallback(async () => {
    try {
      setB(await s.api.call('budget.get', { budgetId }));
    } catch (e) {
      toast(errText(e), true);
    }
  }, [s, budgetId]);
  useEffect(() => {
    void load();
  }, [load]);

  const showCreate = creating || (b != null && !b.budget);
  return (
    <>
      <div className="page-head">
        <h1>{t('الموازنة', 'Budget')}</h1>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {b && b.budgets.length > 0 && (
            <select className="inp" style={{ width: 'auto', minWidth: 220 }} value={creating ? '' : b.budget?.id ?? ''} onChange={(e) => { setCreating(false); setBudgetId(Number(e.target.value)); }}>
              {creating && <option value="">{t('موازنة جديدة…', 'New budget…')}</option>}
              {b.budgets.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.start_ym} → {periodEnd(x)}</option>)}
            </select>
          )}
          {can('budget.manage') && !showCreate && <button className="btn" onClick={() => setCreating(true)}>＋ {t('موازنة جديدة', 'New budget')}</button>}
        </div>
      </div>
      {b?.budget && !showCreate && (
        <div className="row muted small" style={{ margin: '-6px 0 10px', flexWrap: 'wrap' }}>
          <span className="pill">{b.current?.rev ? t(`المراجعة ${b.current.rev}`, `Revision ${b.current.rev}`) : t('الأصلية', 'Original')}</span>
          <span>{periodName(b.budget)}</span>
          {b.budget.carry_from_id != null && <span>· {t('تكمل', 'continues')} «{b.budgets.find((x) => x.id === b.budget!.carry_from_id)?.name}»</span>}
          {can('budget.manage') && <button className="btn small ghost" onClick={() => setEditPeriod(true)}>✎ {t('الاسم والفترة', 'Name and period')}</button>}
        </div>
      )}
      {!b ? <p className="muted">…</p> : showCreate ? (
        can('budget.manage')
          ? <CreateBudget budgets={b.budgets} onCancel={b.budget ? () => setCreating(false) : undefined} onDone={async (id) => { setCreating(false); setBudgetId(id); }} />
          : <div className="panel"><p>{t('لا موازنة بعد.', 'No budget yet.')}</p></div>
      ) : !b.current ? (
        <div className="panel"><p>{t('هذه الموازنة بلا مبالغ.', 'This budget has no amounts.')}</p></div>
      ) : (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'follow', label: t('المتابعة', 'Follow-up') },
            { value: 'edit', label: t('الموازنة', 'Budget') },
            { value: 'donors', label: t('المانحون', 'Donors'), hidden: !can('lists.donors') },
          ]} />
          {tab === 'follow' && <FollowUp key={b.budget!.id} b={b} />}
          {tab === 'edit' && <EditBudget key={b.budget!.id} b={b} reload={load} onDeleted={() => setBudgetId(null)} />}
          {tab === 'donors' && can('lists.donors') && <Donors key={b.budget!.id} b={b} reload={load} />}
        </>
      )}
      {editPeriod && b?.budget && <PeriodModal budget={b.budget} budgets={b.budgets} onClose={() => setEditPeriod(false)} onDone={async () => { setEditPeriod(false); await load(); }} />}
    </>
  );
}

/** Start month (month + year) and number of months. */
function PeriodFields({ start, setStart, months, setMonths }: { start: string; setStart: (v: string) => void; months: number; setMonths: (n: number) => void }) {
  const y = Number(start.slice(0, 4));
  const mo = Number(start.slice(5, 7));
  const set = (yy: number, mm: number) => setStart(`${yy}-${String(mm).padStart(2, '0')}`);
  return (
    <>
      <Field label={t('تبدأ في', 'Starts in')}>
        <div className="row">
          <select className="inp" value={mo} onChange={(e) => set(y, Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
          <input className="ltr" type="number" min={2000} max={2100} value={y} onChange={(e) => set(Number(e.target.value) || y, mo)} style={{ width: 90 }} />
        </div>
      </Field>
      <Field label={t('عدد الأشهر', 'Number of months')}>
        <div className="row">
          <input className="ltr" type="number" min={1} max={36} value={months} onChange={(e) => setMonths(Math.max(1, Math.min(36, Number(e.target.value) || 1)))} style={{ width: 80 }} />
          <span className="muted small">→ {ymName(addMonths(start, months - 1))}</span>
        </div>
      </Field>
    </>
  );
}

// ---------------------------------------------------------------- a new budget

function CreateBudget({ budgets, onCancel, onDone }: { budgets: Budget[]; onCancel?: () => void; onDone: (id: number) => Promise<void> }) {
  const { s, d } = useApp();
  const now = new Date();
  const [start, setStart] = useState(`${now.getFullYear() + (now.getMonth() >= 9 ? 1 : 0)}-01`);
  const [months, setMonths] = useState(12);
  const [name, setName] = useState('');
  const [rateSyp, setRateSyp] = useState(String(d.lists.settings.usd_rate || '130'));
  const [rateEur, setRateEur] = useState('0.89'); // mid-October 2026: 1 € ≈ 1.12 $
  const [from, setFrom] = useState<'empty' | 'last' | 'budget'>(budgets.length ? 'budget' : 'empty');
  const [fromBudget, setFromBudget] = useState<number | null>(budgets[budgets.length - 1]?.id ?? null);
  const [carry, setCarry] = useState<number | null>(null);
  const [scale, setScale] = useState<'scale' | 'keep'>('scale');
  const [pct, setPct] = useState('0');
  const [busy, setBusy] = useState(false);
  const before = addMonths(start, -12);
  const hasLast = d.rows.some((r) => r.type === 'Exp' && r.date && r.date.slice(0, 7) >= before && r.date.slice(0, 7) < start);
  const src = budgets.find((x) => x.id === fromBudget);
  const earlier = budgets.filter((x) => x.start_ym < start);
  const go = async () => {
    setBusy(true);
    try {
      const id = await s.api.call('budget.create', {
        name: name.trim() || null, start_ym: start, months, rate_syp: parseAmount(rateSyp), rate_eur: parseAmount(rateEur),
        from, fromBudgetId: fromBudget, scale: scale === 'scale', pct: Number(pct) || 0, carry_from_id: carry,
      });
      toast(t('أُنشئت الموازنة', 'Budget created'));
      await onDone(id);
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 780 }}>
      <h2>{t('موازنة جديدة', 'New budget')}</h2>
      <div className="grid2">
        <PeriodFields start={start} setStart={setStart} months={months} setMonths={setMonths} />
        <Field label={t('الاسم', 'Name')} className="span2">
          <input value={name} placeholder={defaultBudgetName(start, months)} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('ليرة لكل دولار (تقديري)', 'SYP per USD (estimated)')}><input className="ltr" inputMode="decimal" value={rateSyp} onChange={(e) => setRateSyp(e.target.value)} /></Field>
        <Field label={t('يورو لكل دولار (تقديري)', 'EUR per USD (estimated)')}><input className="ltr" inputMode="decimal" value={rateEur} onChange={(e) => setRateEur(e.target.value)} /></Field>
        {earlier.length > 0 && (
          <Field label={t('تكمل موازنة سابقة (يُنقل باقيها)', 'Continues an earlier budget (its leftover is carried over)')} className="span2">
            <select className="inp" value={carry ?? ''} onChange={(e) => setCarry(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('لا', 'No')}</option>
              {earlier.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.start_ym} → {periodEnd(x)}</option>)}
            </select>
          </Field>
        )}
      </div>
      <h3 style={{ marginTop: 14 }}>{t('البداية', 'Start from')}</h3>
      <Seg value={from} onChange={setFrom} options={[
        ...(budgets.length ? [{ value: 'budget' as const, label: t('موازنة أخرى', 'Another budget') }] : []),
        { value: 'last', label: t('مصاريف الأشهر الـ12 السابقة', 'What was spent in the 12 months before') },
        { value: 'empty', label: t('فارغة', 'Empty') },
      ]} />
      {from === 'budget' && (
        <div style={{ marginTop: 12 }}>
          <Field label={t('الموازنة', 'Budget')}>
            <select className="inp" style={{ width: 'auto' }} value={fromBudget ?? ''} onChange={(e) => setFromBudget(Number(e.target.value))}>
              {budgets.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.months} {t('شهراً', 'months')}</option>)}
            </select>
          </Field>
          {src && <p className="muted small">{t(`تُنسخ العناصر و«المرات» تُضرب بـ${months}/${src.months}.`, `Items are copied and "Times" is multiplied by ${months}/${src.months}.`)} {t('مثلاً الموظفون 13 ←', 'E.g. staff 13 →')} {num((13 * months) / src.months)}</p>}
        </div>
      )}
      {from === 'last' && (
        <div style={{ marginTop: 12 }}>
          {!hasLast && <div className="alert warn">{t(`لا مصاريف مسجّلة بين ${before} و${addMonths(start, -1)}: ستكون الموازنة فارغة.`, `No expenses recorded from ${before} to ${addMonths(start, -1)}: the budget will be empty.`)}</div>}
          <p className="muted small">{t(`ما صُرف في الأشهر الـ12 قبل البداية، محسوباً لـ${months} شهراً. خط بدأ خلالها (مثلاً إيجار منذ تشرين الأول):`, `What was spent in the 12 months before the start, for ${months} months. A line that started during them (e.g. rent since October):`)}</p>
          <Seg value={scale} onChange={setScale} options={[
            { value: 'scale', label: t('يُمدّ إلى سنة كاملة', 'Scale to a full year') },
            { value: 'keep', label: t('يبقى كما هو', 'Keep as it is') },
          ]} />
          <Field label={t('تغيير لكل الخطوط (%)، مثلاً 10 للزيادة', 'Change for every line (%), e.g. 10 for an increase')}>
            <input className="ltr" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} style={{ width: 120 }} />
          </Field>
        </div>
      )}
      <p className="muted small">{t('بعدها تصحّح كل خط، أو تستورد ورقة من ملف الموازنة.', 'Afterwards you correct each line, or import a sheet from the budget workbook.')}</p>
      <div className="modal-foot">
        {onCancel && <button className="btn" onClick={onCancel}>{t('إلغاء', 'Cancel')}</button>}
        <button className="btn primary" disabled={busy || !rateSyp || !rateEur || (from === 'budget' && !fromBudget)} onClick={go}>{busy ? '…' : t('إنشاء الموازنة', 'Create the budget')}</button>
      </div>
    </div>
  );
}

/** A budget's name, period, and the budget it continues. */
function PeriodModal({ budget, budgets, onClose, onDone }: { budget: Budget; budgets: Budget[]; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useApp();
  const [name, setName] = useState(budget.name);
  const [start, setStart] = useState(budget.start_ym);
  const [months, setMonths] = useState(budget.months);
  const [carry, setCarry] = useState<number | null>(budget.carry_from_id);
  const earlier = budgets.filter((x) => x.id !== budget.id && x.start_ym < start);
  const save = async () => {
    try {
      await s.api.call('budget.setPeriod', { budgetId: budget.id, name, start_ym: start, months, carry_from_id: carry });
      toast(t('حُفظ', 'Saved'));
      await onDone();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <Modal title={t('الاسم والفترة', 'Name and period')} onClose={onClose}>
      <div className="grid2">
        <Field label={t('الاسم', 'Name')} className="span2"><input value={name} placeholder={defaultBudgetName(start, months)} onChange={(e) => setName(e.target.value)} /></Field>
        <PeriodFields start={start} setStart={setStart} months={months} setMonths={setMonths} />
        <Field label={t('تكمل موازنة سابقة (يُنقل باقيها)', 'Continues an earlier budget (its leftover is carried over)')} className="span2">
          <select className="inp" value={carry ?? ''} onChange={(e) => setCarry(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('لا', 'No')}</option>
            {earlier.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.start_ym} → {periodEnd(x)}</option>)}
          </select>
        </Field>
      </div>
      {months !== budget.months && <div className="alert warn">{t('تغيير عدد الأشهر لا يغيّر المبالغ: صحّحها إن لزم.', 'Changing the number of months does not change the amounts: correct them if needed.')}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" onClick={save}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- follow-up

const PACE: Record<Pace, { icon: string; label: () => string }> = {
  over: { icon: '✗', label: () => t('تجاوز الموازنة', 'Over budget') },
  ahead: { icon: '▲', label: () => t('أسرع من الوقت', 'Ahead of time') },
  ontrack: { icon: '●', label: () => t('في الموعد', 'On track') },
  under: { icon: '▼', label: () => t('صرف أقل', 'Under-spending') },
  nobudget: { icon: '?', label: () => t('بلا موازنة', 'No budget') },
  none: { icon: '', label: () => '' },
};

function Used({ used, spent }: { used: number | null; spent: number }) {
  if (used == null && spent <= 0.004) return <span className="muted">—</span>;
  const band = usedBand(used);
  return (
    <div className={`used b${band}`}>
      <div className="used-track"><div className="used-fill" style={{ width: `${Math.min(100, (used ?? 1) * 100)}%` }} /></div>
      <span>{used == null ? '—' : fmtPct(used)}</span>
    </div>
  );
}

function PaceTag({ pace }: { pace: Pace }) {
  if (pace === 'none') return null;
  return <span className={`pace pace-${pace}`}>{PACE[pace].icon} {PACE[pace].label()}</span>;
}

function FollowUp({ b }: { b: BudgetPayload }) {
  const { d } = useApp();
  const names = useNames();
  const icons = useIcons();
  const B = b.budget!;
  const months = periodMonths(B);
  const nowYm = new Date().toISOString().slice(0, 7);
  const [upTo, setUpTo] = useState(() => (nowYm < B.start_ym ? B.start_ym : nowYm > periodEnd(B) ? periodEnd(B) : nowYm));
  const { books, assigned } = useAssignment(b);
  const shared = books.length > 1;
  const [account, setAccount] = useState<number | null>(null);
  const [onlyFlags, setOnlyFlags] = useState(false);
  const headingOf = useMemo(() => new Map(d.lists.lines.map((l) => [l.id, l.heading_id])), [d]);
  const outside = useMemo(() => new Set(d.lists.accounts.filter((a) => a.outside_budget).map((a) => a.id)), [d]);
  const all = useMemo(
    () => followUp({ rows: d.rows, comp: d.comp, budget: B, upToYm: upTo, amounts: b.amounts, original: b.original, headingOf, outside, accounts: b.accounts, assigned: shared ? assigned : undefined }),
    [d, b, B, upTo, headingOf, outside, shared, assigned],
  );
  const rows = all.filter((r) => (account == null || r.account_id === account) && (!onlyFlags || r.pace === 'over' || r.pace === 'under' || r.pace === 'nobudget' || r.pace === 'ahead'));
  const cont = contingencyOf(all, b.accounts);
  const revised = b.original != null;
  const share = periodShare(B, upTo);
  // carried over: from the budget this one continues, and to the one that continues it
  const leftover = (id: number) => {
    const bk = books.find((x) => x.budget.id === id);
    return bk ? leftoverOf(bk, d.rows, d.comp, assigned) : 0;
  };
  const carriedIn = B.carry_from_id != null ? Math.max(0, leftover(B.carry_from_id)) : 0;
  const carriedTo = b.budgets.filter((x) => x.carry_from_id === B.id);
  const lineName = (id: number) => (id === WHOLE ? t('كل المصاريف، أياً كان الخط', 'All spending, whatever the line') : d.lists.lines.find((l) => l.id === id)?.name ?? '?');
  const sumOf = (xs: BudgetRow[]) => ({
    original: xs.reduce((s, r) => s + (r.original ?? 0), 0),
    budget: xs.reduce((s, r) => s + r.budget, 0),
    spent: xs.reduce((s, r) => s + r.spent, 0),
    lastYear: xs.reduce((s, r) => s + r.lastYear, 0),
  });
  const scope = all.filter((r) => account == null || r.account_id === account);
  const total = sumOf(scope);
  const reserve = [...cont].filter(([id]) => account == null || id === account).reduce((s, [, x]) => s + x.reserve, 0);
  const reserveUsed = [...cont].filter(([id]) => account == null || id === account).reduce((s, [, x]) => s + x.used, 0);
  const headings = [
    ...(rows.some((r) => r.heading_id === WHOLE) ? [{ id: WHOLE, name: t('حسابات بمبلغ واحد', 'Accounts with one amount') }] : []),
    ...d.lists.headings.filter((h) => rows.some((r) => r.heading_id === h.id)),
  ];
  const count = (p: Pace) => scope.filter((r) => r.pace === p).length;

  // income: a reference only (no budget): this period so far, against the same months a year before
  const income = useMemo(() => {
    const sum = (from: string, to: string) => d.rows.filter((r) => r.type === 'Income' && r.date && r.date.slice(0, 7) >= from && r.date.slice(0, 7) <= to && !outside.has(r.account_id ?? -1) && (account == null || r.account_id === account))
      .reduce((s, r) => s + (d.comp.get(r.id)?.incUsdTot ?? 0), 0);
    return { now: sum(B.start_ym, upTo), last: sum(addMonths(B.start_ym, -12), addMonths(upTo, -12)) };
  }, [d, B, upTo, account, outside]);

  return (
    <>
      <div className="row" style={{ margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="muted small">{t('حتى نهاية', 'Up to the end of')}</span>
        <select className="inp" style={{ width: 'auto' }} value={upTo} onChange={(e) => setUpTo(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{ymName(m)}</option>)}
        </select>
        <span className="muted small">{t('الحساب', 'Account')}</span>
        <div style={{ minWidth: 180 }}>
          <Select value={account} placeholder={t('كل الحسابات', 'All accounts')} options={d.lists.accounts.filter((a) => !a.outside_budget).map((a) => ({ value: a.id, label: a.name }))} onChange={setAccount} />
        </div>
        <label className="row small"><input type="checkbox" checked={onlyFlags} onChange={(e) => setOnlyFlags(e.target.checked)} /> {t('ما يحتاج انتباهاً فقط', 'Only what needs attention')}</label>
      </div>

      <div className="cards" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="k">{t('الموازنة', 'Budget')}</div>
          <div className="v ltr">{usd(total.budget)}</div>
          <div className="muted small">{revised && <>{t('الأصلية', 'Original')} {usd(total.original)} · </>}+ {t('احتياط', 'contingency')} {usd(reserve)}</div>
        </div>
        <div className="card">
          <div className="k">{t('المصروف', 'Spent')}</div>
          <div className="v ltr">{usd(total.spent)}</div>
          <div className="muted small">{total.budget ? fmtPct(total.spent / total.budget) : '—'} · {t('الوقت المنقضي', 'time gone')} {fmtPct(share)}</div>
        </div>
        <div className="card">
          <div className="k">{t('الباقي', 'Left')}</div>
          <div className={`v ltr ${total.budget - total.spent < 0 ? 'bad' : ''}`}>{usd(total.budget - total.spent)}</div>
          <div className="muted small">{t('الاحتياط المستعمل', 'Contingency used')}: {usd(reserveUsed)}{reserve > 0 ? ` (${fmtPct(reserveUsed / reserve)})` : ''}</div>
        </div>
        <div className="card">
          <div className="k">{t('الإيرادات (مرجع)', 'Income (reference)')}</div>
          <div className="v ltr">{usd(income.now)}</div>
          <div className="muted small">{t('قبل سنة', 'a year before')}: {usd(income.last)}</div>
        </div>
      </div>

      {(carriedIn > 0 || carriedTo.length > 0 || shared) && (
        <div className="alert info small">
          {carriedIn > 0 && <div>↪ {t('منقول من', 'Carried over from')} «{b.budgets.find((x) => x.id === B.carry_from_id)?.name}»: <b className="ltr">{usd(carriedIn)}</b> {t('يُضاف إلى ما هو متاح.', 'added to what is available.')}</div>}
          {carriedTo.map((x) => <div key={x.id}>↩ {t('الباقي يُنقل إلى', 'The leftover is carried over to')} «{x.name}»: <b className="ltr">{usd(Math.max(0, leftover(B.id)))}</b></div>)}
          {shared && <div className="muted">{t('موازنات متداخلة: كل نفقة تُحسب في موازنة واحدة، الأقدم التي ما زال فيها مال على خطها.', 'Overlapping budgets: each expense counts in one budget only, the oldest that still has money on its line.')}</div>}
        </div>
      )}

      <div className="pace-legend small">
        {(['over', 'ahead', 'ontrack', 'under', 'nobudget'] as Pace[]).map((p) => <span key={p}><PaceTag pace={p} /> {count(p)}</span>)}
        <span className="muted">· {t('اللون حسب ما صُرف', 'Colour by share spent')}: <i className="sw b0" />&lt;50% <i className="sw b50" />50% <i className="sw b75" />75% <i className="sw b90" />90% <i className="sw b100" />100%+</span>
      </div>

      <div className="table-wrap">
        <table className="t budget-t">
          <thead>
            <tr>
              <th>{t('البند / الخط', 'Heading / line')}</th>
              {account == null && <th>{t('الحساب', 'Account')}</th>}
              {revised && <th className="n">{t('الأصلية', 'Original')}</th>}
              <th className="n">{t('الموازنة', 'Budget')} $</th>
              <th className="n">{t('المصروف', 'Spent')} $</th>
              <th className="n">{t('الباقي', 'Left')} $</th>
              <th>{t('نسبة الصرف', 'Used')}</th>
              <th>{t('الوتيرة', 'Pace')}</th>
              <th className="n">{t('قبل سنة', 'A year before')} $</th>
            </tr>
          </thead>
          <tbody>
            {headings.map((h) => {
              const xs = rows.filter((r) => r.heading_id === h.id).sort((a, c) => lineName(a.line_id).localeCompare(lineName(c.line_id)) || a.account_id - c.account_id);
              const sh = sumOf(xs);
              return [
                <tr key={`h${h.id}`} className="group">
                  <td colSpan={account == null ? 2 : 1}><b>{catIcon(h.name)} {h.name}</b></td>
                  {revised && <td className="n">{fmtUsd(sh.original)}</td>}
                  <td className="n"><b>{fmtUsd(sh.budget)}</b></td>
                  <td className="n"><b>{fmtUsd(sh.spent)}</b></td>
                  <td className={`n ${sh.budget - sh.spent < 0 ? 'bad' : ''}`}><b>{fmtUsd(sh.budget - sh.spent)}</b></td>
                  <td><Used used={sh.budget > 0 ? sh.spent / sh.budget : null} spent={sh.spent} /></td>
                  <td />
                  <td className="n muted">{fmtUsd(sh.lastYear)}</td>
                </tr>,
                ...xs.map((r) => (
                  <tr key={cellKey(r.account_id, r.line_id)}>
                    <td style={{ paddingInlineStart: 22 }}>{r.line_id === WHOLE ? '' : `${icons.line(r.line_id)} `}{lineName(r.line_id)}</td>
                    {account == null && <td className="small">{names.account(r.account_id)}</td>}
                    {revised && <td className="n muted">{fmtUsd(r.original ?? 0)}</td>}
                    <td className="n">{fmtUsd(r.budget)}</td>
                    <td className="n">{fmtUsd(r.spent)}</td>
                    <td className={`n ${r.left < 0 ? 'bad' : ''}`}>{fmtUsd(r.left)}</td>
                    <td><Used used={r.used} spent={r.spent} /></td>
                    <td><PaceTag pace={r.pace} /></td>
                    <td className="n muted">{fmtUsd(r.lastYear)}</td>
                  </tr>
                )),
              ];
            })}
            {!rows.length && <tr><td colSpan={9} className="muted">{t('لا شيء', 'Nothing')}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {t('الوتيرة: ما صُرف مقارنة بما كان متوقعاً حتى هذا الشهر (الموازنة × الوقت المنقضي). «صرف أقل»: أقل من 75% من المتوقع. «أسرع من الوقت»: أكثر من 110%. ',
          'Pace: what was spent against what was expected by this month (budget × time gone). "Under-spending": less than 75 % of it. "Ahead of time": more than 110 %. ')}
        {t('عمود «قبل سنة»: ما صُرف في الأشهر نفسها قبل سنة.', 'Column "A year before": what was spent in the same months one year earlier.')}
      </p>
    </>
  );
}

// ---------------------------------------------------------------- the budget, per account

function EditBudget({ b, reload, onDeleted }: { b: BudgetPayload; reload: () => Promise<void>; onDeleted: () => void }) {
  const B = b.budget!;
  const { s, d, can } = useApp();
  const v = b.current!;
  const may = can('budget.manage');
  const accounts = d.lists.accounts.filter((a) => a.active || b.amounts.some((x) => x.account_id === a.id));
  const [account, setAccount] = useState<number>(() => accounts.find((a) => /center|centre/i.test(a.name))?.id ?? accounts[0]?.id);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<number | null>(null); // line whose items are shown
  const [rates, setRates] = useState({ syp: String(v.rate_syp), eur: String(v.rate_eur) });
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  useEffect(() => {
    setRates({ syp: String(v.rate_syp), eur: String(v.rate_eur) });
    setEdits({});
  }, [v]);
  const acc = d.lists.accounts.find((a) => a.id === account);
  const amount = new Map(b.amounts.map((a) => [cellKey(a.account_id, a.line_id), a.amount_usd]));
  const orig = b.original ? new Map(b.original.map((a) => [cellKey(a.account_id, a.line_id), a.amount_usd])) : null;
  const itemsOf = (lineId: number) => b.items.filter((i) => i.account_id === account && i.line_id === lineId);
  const contPct = b.accounts.find((x) => x.account_id === account)?.contingency_pct ?? 0;
  const lump = b.accounts.find((x) => x.account_id === account)?.lump_usd ?? null;
  // reference: what was spent in the 12 months before the budget starts
  const lastYear = useMemo(() => spentInRange(d.rows, d.comp, addMonths(B.start_ym, -12), addMonths(B.start_ym, -1)).spent, [d, B]);
  const rSyp = parseAmount(rates.syp) || v.rate_syp;
  const rEur = parseAmount(rates.eur) || v.rate_eur;
  const expHeadings = d.lists.headings.filter((h) => d.lists.headingTypes.some((x) => x.heading_id === h.id && x.type === 'Exp'));
  const valueOf = (k: string) => (k in edits ? parseAmount(edits[k]) || 0 : amount.get(k) ?? 0);
  const changed = Object.keys(edits).filter((k) => valueOf(k) !== (amount.get(k) ?? 0));
  const base = b.amounts.filter((x) => x.account_id === account).reduce((sum, x) => sum + (changed.includes(cellKey(x.account_id, x.line_id)) ? 0 : x.amount_usd), 0) + changed.filter((k) => Number(k.split('|')[0]) === account).reduce((sum, k) => sum + valueOf(k), 0);
  const total0 = lump ?? base;
  const reserve = (total0 * contPct) / 100;
  const ratesChanged = rSyp !== v.rate_syp || rEur !== v.rate_eur;

  const save = async () => {
    setBusy(true);
    try {
      if (ratesChanged) await s.api.call('budget.setRates', { versionId: v.id, rate_syp: rSyp, rate_eur: rEur });
      if (changed.length) {
        await s.api.call('budget.saveAmounts', {
          versionId: v.id,
          cells: changed.map((k) => {
            const [account_id, line_id] = k.split('|').map(Number);
            return { account_id, line_id, amount_usd: valueOf(k) };
          }),
        });
      }
      toast(t('حُفظ', 'Saved'));
      setEdits({});
      await reload();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };

  const removeBudget = async (onlyLatest: boolean) => {
    const msg = onlyLatest
      ? t(`حذف المراجعة ${v.rev} والعودة إلى ما قبلها؟`, `Delete revision ${v.rev} and go back to the one before?`)
      : t(`حذف الموازنة «${B.name}» كلها (الأصلية والمراجعات)؟ تُؤخذ نسخة احتياطية أولاً.`, `Delete the whole budget "${B.name}" (original and revisions)? A backup is taken first.`);
    if (!(await confirmBox(msg, true))) return;
    try {
      await s.api.call('budget.delete', { budgetId: B.id, onlyLatest });
      toast(t('حُذف', 'Deleted'));
      if (onlyLatest) await reload();
      else onDeleted();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const revise = async () => {
    const note = await promptBox(t('سبب المراجعة (مثلاً: منتصف السنة، منحة جديدة)', 'Reason for the revision (e.g. mid-year, a new grant)'), '');
    if (note == null) return;
    await act(() => s.api.call('budget.revise', { budgetId: B.id, note: note || null }), t('أُنشئت مراجعة. الأصلية محفوظة كما هي.', 'A revision is made. The original is kept as it was.'));
  };
  const setContingency = async () => {
    const x = await promptBox(t('نسبة الاحتياط لهذا الحساب (%)، مثلاً 10', 'Contingency for this account (%), e.g. 10'), String(contPct));
    if (x == null) return;
    await act(() => s.api.call('budget.setAccount', { versionId: v.id, account_id: account, contingency_pct: Number(x) || 0 }), t('حُفظ', 'Saved'));
  };
  const fillActual = async () => {
    if (!(await confirmBox(t(`استبدال موازنة «${acc?.name}» بما صُرف فعلاً خلال فترة هذه الموازنة؟`, `Replace the budget of "${acc?.name}" with what was really spent during this budget's period?`)))) return;
    await act(() => s.api.call('budget.fillActual', { versionId: v.id, account_id: account }), t('حُفظ', 'Saved'));
  };
  const setLump = async () => {
    const x = await promptBox(t(`مبلغ واحد بالدولار لكل مصاريف «${acc?.name}»، أياً كان الخط`, `One amount in USD for all the spending of "${acc?.name}", whatever the line`), lump ? String(lump) : '');
    if (x == null) return;
    const n = parseAmount(x);
    if (!(n > 0)) return toast(t('مبلغ غير صحيح', 'Wrong amount'), true);
    if (b.amounts.some((y) => y.account_id === account) && !(await confirmBox(t('سيحلّ هذا المبلغ محل مبالغ الخطوط في هذا الحساب. متابعة؟', 'This amount replaces the line amounts of this account. Continue?')))) return;
    await act(() => s.api.call('budget.setAccount', { versionId: v.id, account_id: account, lump_usd: n }), t('حُفظ', 'Saved'));
  };
  const clearLump = async () => {
    await act(() => s.api.call('budget.setAccount', { versionId: v.id, account_id: account, lump_usd: null }), t('حُفظ', 'Saved'));
  };
  const toggleOutside = async () => {
    await act(() => s.api.call('account.setOutside', { id: account, outside: !acc?.outside_budget }), t('حُفظ', 'Saved'));
  };

  return (
    <>
      <div className="panel">
        <div className="grid3">
          <Field label={t('الحساب', 'Account')}>
            <Select value={account} options={accounts.map((a) => ({ value: a.id, label: a.outside_budget ? `${a.name} (${t('خارج المركز', 'outside the centre')})` : a.name }))} onChange={(x) => x != null && setAccount(x)} />
          </Field>
          <Field label={t('ليرة لكل دولار (تقديري)', 'SYP per USD (estimated)')}><input className="ltr" inputMode="decimal" disabled={!may} value={rates.syp} onChange={(e) => setRates({ ...rates, syp: e.target.value })} /></Field>
          <Field label={t('يورو لكل دولار (تقديري)', 'EUR per USD (estimated)')}><input className="ltr" inputMode="decimal" disabled={!may} value={rates.eur} onChange={(e) => setRates({ ...rates, eur: e.target.value })} /></Field>
        </div>
        <div className="budget-totals">
          <div><span className="muted small">{lump != null ? t('مبلغ واحد للحساب', 'One amount for the account') : t('الموازنة الأساسية', 'Base budget')}</span><b className="ltr">{usd(total0)}</b></div>
          <div><span className="muted small">{t('احتياط', 'Contingency')} {contPct}%</span><b className="ltr">{usd(reserve)}</b></div>
          <div><span className="muted small">{t('المجموع', 'Total')}</span><b className="ltr">{usd(total0 + reserve)}</b></div>
          <div><span className="muted small">SYP</span><b className="ltr">{fmtSyp((total0 + reserve) * rSyp)}</b></div>
          <div><span className="muted small">EUR</span><b className="ltr">{fmtEur((total0 + reserve) * rEur)}</b></div>
        </div>
        {acc?.outside_budget ? <div className="alert info">{t('هذا الحساب خارج المركز: لا يدخل في متابعة الموازنة.', 'This account is outside the centre: it is not in the budget follow-up.')}</div> : null}
        {may && (
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn" onClick={() => setImporting(true)}>{t('استيراد من Excel…', 'Import from Excel…')}</button>
            <button className="btn" onClick={setContingency}>{t('نسبة الاحتياط…', 'Contingency…')}</button>
            <button className="btn" onClick={setLump}>{lump != null ? t('تغيير المبلغ الواحد…', 'Change the one amount…') : t('مبلغ واحد للحساب كله…', 'One amount for the whole account…')}</button>
            {lump != null && <button className="btn" onClick={clearLump}>{t('حسب الخطوط', 'Line by line')}</button>}
            <button className="btn" onClick={fillActual}>{t('= ما صُرف في الفترة', '= What was spent in the period')}</button>
            {can('lists.manage') && <button className="btn" onClick={toggleOutside}>{acc?.outside_budget ? t('إعادته إلى المركز', 'Back inside the centre') : t('خارج المركز', 'Outside the centre')}</button>}
            {can('lists.manage') && <button className="btn" onClick={() => setCleaning(true)}>{t('خطوط بلا موازنة…', 'Lines without budget…')}</button>}
            <button className="btn" onClick={revise} disabled={changed.length > 0 || ratesChanged}>{t('مراجعة الموازنة…', 'Revise the budget…')}</button>
            {v.rev > 0 && <button className="btn danger" onClick={() => removeBudget(true)}>{t('حذف هذه المراجعة…', 'Delete this revision…')}</button>}
            <button className="btn danger" onClick={() => removeBudget(false)}>{t('حذف الموازنة…', 'Delete the budget…')}</button>
            <span style={{ flex: 1 }} />
            <button className="btn primary" disabled={busy || (!changed.length && !ratesChanged)} onClick={save}>{t('احفظ', 'Save')}{changed.length ? ` (${changed.length})` : ''}</button>
          </div>
        )}
        {b.versions.length > 1 && (
          <p className="muted small">{b.versions.map((x) => `${x.rev === 0 ? t('الأصلية', 'Original') : t(`مراجعة ${x.rev}`, `Revision ${x.rev}`)}: ${x.created_at.slice(0, 10)}${x.note ? ` (${x.note})` : ''}`).join(' · ')}</p>
        )}
      </div>

      {lump != null ? (
        <div className="alert info">
          {t(`لـ«${acc?.name}» مبلغ واحد (${usd(lump)}) لكل مصاريفه، أياً كان الخط: هكذا يُتابع في المتابعة وعند المانحين.`,
            `"${acc?.name}" has one amount (${usd(lump)}) for all its spending, whatever the line: that is how it is followed and shown to donors.`)}
        </div>
      ) : (
      <div className="table-wrap">
        <table className="t budget-t">
          <thead>
            <tr>
              <th>{t('البند / الخط', 'Heading / line')}</th>
              {orig && <th className="n">{t('الأصلية', 'Original')} $</th>}
              <th className="n">{t('الموازنة', 'Budget')} $</th>
              <th className="n">SYP</th>
              <th className="n">EUR</th>
              <th className="n">{t('صُرف في الأشهر الـ12 قبلها', 'Spent in the 12 months before')} $</th>
            </tr>
          </thead>
          <tbody>
            {expHeadings.map((h) => {
              const lines = d.lists.lines.filter((l) => l.heading_id === h.id && (l.active || amount.has(cellKey(account, l.id))));
              if (!lines.length) return null;
              const hs = lines.reduce((sum, l) => sum + valueOf(cellKey(account, l.id)), 0);
              return [
                <tr key={`h${h.id}`} className="group">
                  <td><b>{catIcon(h.name)} {h.name}</b></td>
                  {orig && <td className="n muted">{fmtUsd(lines.reduce((sum, l) => sum + (orig.get(cellKey(account, l.id)) ?? 0), 0))}</td>}
                  <td className="n"><b>{fmtUsd(hs)}</b></td>
                  <td className="n">{fmtSyp(hs * rSyp)}</td>
                  <td className="n">{fmtEur(hs * rEur)}</td>
                  <td className="n muted">{fmtUsd(lines.reduce((sum, l) => sum + (lastYear.get(cellKey(account, l.id)) ?? 0), 0))}</td>
                </tr>,
                ...lines.flatMap((l) => {
                  const k = cellKey(account, l.id);
                  const val = valueOf(k);
                  const its = itemsOf(l.id);
                  return [
                    <tr key={k} className={l.active ? '' : 'inactive'}>
                      <td style={{ paddingInlineStart: 22 }}>
                        {catIcon(l.name, h.name)} {l.name}
                        {(may || its.length > 0) && (
                          <button className="btn small ghost" style={{ marginInlineStart: 8 }} onClick={() => setOpen(open === l.id ? null : l.id)}>
                            {open === l.id ? '▾' : '▸'} {its.length ? t(`${its.length} عناصر`, `${its.length} items`) : t('عناصر', 'items')}
                          </button>
                        )}
                      </td>
                      {orig && <td className="n muted">{fmtUsd(orig.get(k) ?? 0)}</td>}
                      <td className="n">
                        {its.length ? <b>{fmtUsd(val)}</b> : (
                          <input className={`ltr budget-inp ${k in edits && val !== (amount.get(k) ?? 0) ? 'changed' : ''}`} inputMode="decimal" disabled={!may}
                            value={k in edits ? edits[k] : (amount.get(k) ? String(amount.get(k)) : '')}
                            placeholder="0" onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
                        )}
                      </td>
                      <td className="n muted">{val ? fmtSyp(val * rSyp) : ''}</td>
                      <td className="n muted">{val ? fmtEur(val * rEur) : ''}</td>
                      <td className="n muted">{lastYear.get(k) ? fmtUsd(lastYear.get(k)!) : ''}</td>
                    </tr>,
                    open === l.id ? (
                      <tr key={`${k}-items`} className="items-row">
                        <td colSpan={orig ? 6 : 5}>
                          <ItemsEditor key={`${v.id}-${k}`} versionId={v.id} accountId={account} lineId={l.id} items={its} may={may} onSaved={reload} />
                        </td>
                      </tr>
                    ) : null,
                  ];
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      )}
      {importing && <ImportSheet versionId={v.id} defaultAccount={account} onClose={() => setImporting(false)} onDone={async (accId) => { setImporting(false); setAccount(accId); await reload(); }} />}
      {cleaning && <UnbudgetedLines b={b} onClose={() => setCleaning(false)} onDone={async () => { setCleaning(false); await reload(); }} />}
    </>
  );
}

/** The items of one line: Quantity × Times × Cost per unit. */
function ItemsEditor({ versionId, accountId, lineId, items, may, onSaved }: { versionId: number; accountId: number; lineId: number; items: BudgetItem[]; may: boolean; onSaved: () => Promise<void> }) {
  const { s } = useApp();
  type Row = { name: string; unit: string; qty: string; times: string; unit_cost: string; note: string };
  const toRow = (i: BudgetItem): Row => ({ name: i.name, unit: i.unit ?? '', qty: num(i.qty), times: num(i.times), unit_cost: num(i.unit_cost), note: i.note ?? '' });
  const [rows, setRows] = useState<Row[]>(() => items.map(toRow));
  const [dirty, setDirty] = useState(false);
  const set = (k: number, f: keyof Row, val: string) => {
    setRows(rows.map((r, i) => (i === k ? { ...r, [f]: val } : r)));
    setDirty(true);
  };
  const total = (r: Row) => (parseAmount(r.qty) || 0) * (parseAmount(r.times) || 0) * (parseAmount(r.unit_cost) || 0);
  const save = async () => {
    try {
      await s.api.call('budget.saveItems', {
        versionId, account_id: accountId, line_id: lineId,
        items: rows.filter((r) => r.name.trim()).map((r, k) => ({ account_id: accountId, line_id: lineId, name: r.name.trim(), unit: r.unit.trim() || null, qty: parseAmount(r.qty) || 0, times: parseAmount(r.times) || 0, unit_cost: parseAmount(r.unit_cost) || 0, note: r.note.trim() || null, sort: k })),
      });
      setDirty(false);
      toast(t('حُفظ', 'Saved'));
      await onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="items-box">
      <table className="t items-t">
        <thead>
          <tr>
            <th>{t('العنصر', 'Item')}</th><th>{t('الوحدة', 'Unit')}</th>
            <th className="n">{t('الكمية', 'Quantity')}</th><th className="n">{t('مرات/السنة', 'Times/year')}</th><th className="n">{t('كلفة الوحدة', 'Cost/unit')} $</th>
            <th className="n">{t('المجموع', 'Total')} $</th><th>{t('ملاحظة', 'Note')}</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k}>
              <td><input disabled={!may} value={r.name} onChange={(e) => set(k, 'name', e.target.value)} /></td>
              <td><input disabled={!may} value={r.unit} onChange={(e) => set(k, 'unit', e.target.value)} style={{ width: 80 }} /></td>
              <td className="n"><input className="ltr num-inp" disabled={!may} inputMode="decimal" value={r.qty} onChange={(e) => set(k, 'qty', e.target.value)} /></td>
              <td className="n"><input className="ltr num-inp" disabled={!may} inputMode="decimal" value={r.times} onChange={(e) => set(k, 'times', e.target.value)} /></td>
              <td className="n"><input className="ltr num-inp" disabled={!may} inputMode="decimal" value={r.unit_cost} onChange={(e) => set(k, 'unit_cost', e.target.value)} /></td>
              <td className="n"><b>{fmtUsd(total(r))}</b></td>
              <td><input disabled={!may} value={r.note} onChange={(e) => set(k, 'note', e.target.value)} /></td>
              <td>{may && <button className="btn small ghost" onClick={() => { setRows(rows.filter((_, i) => i !== k)); setDirty(true); }}>✕</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6, flexWrap: 'wrap' }}>
        <span className="muted small">{t('الكمية × مرات في السنة (أشهر؛ الموظفون 13) × كلفة الوحدة', 'Quantity × times a year (months; staff 13) × cost per unit')} = <b className="ltr">{usd(rows.reduce((s2, r) => s2 + total(r), 0))}</b></span>
        {may && (
          <div className="row">
            <button className="btn small" onClick={() => { setRows([...rows, { name: '', unit: '', qty: '1', times: '12', unit_cost: '', note: '' }]); setDirty(true); }}>＋ {t('عنصر', 'Item')}</button>
            <button className="btn small primary" disabled={!dirty} onClick={save}>{t('احفظ العناصر', 'Save items')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** A sheet of the budget workbook into one account: each item matched with a line of the register. */
function ImportSheet({ versionId, defaultAccount, onClose, onDone }: { versionId: number; defaultAccount: number; onClose: () => void; onDone: (accountId: number) => Promise<void> }) {
  const { s, d, can, reload: reloadData } = useApp();
  const [sheets, setSheets] = useState<{ name: string; grid: Grid }[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheet, setSheet] = useState<string | null>(null);
  const [read, setRead] = useState<SheetRead | null>(null);
  const [account, setAccount] = useState<number>(defaultAccount);
  const [cont, setCont] = useState('0');
  const [lineOf, setLineOf] = useState<(number | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const expHeadingIds = new Set(d.lists.headingTypes.filter((x) => x.type === 'Exp').map((x) => x.heading_id));
  const expLines = d.lists.lines.filter((l) => expHeadingIds.has(l.heading_id));
  const lineLabel = (id: number) => {
    const l = d.lists.lines.find((x) => x.id === id)!;
    return `${d.lists.headings.find((h) => h.id === l.heading_id)?.name ?? ''} › ${l.name}${l.active ? '' : ` (${t('موقوف', 'inactive')})`}`;
  };
  const headingName = (lineId: number | null) => d.lists.headings.find((h) => h.id === d.lists.lines.find((l) => l.id === lineId)?.heading_id)?.name;
  const furnitureSheet = /furniture/i.test(sheet ?? '');
  /** the heading an item's category stands for ("Staff" is "Salary"; a furniture sheet's rooms are "Furniture") */
  const headingFor = (category: string) => {
    const c = category.toLowerCase() === 'staff' ? 'salary' : category.toLowerCase();
    return d.lists.headings.find((h) => h.name.toLowerCase() === c) ?? (furnitureSheet ? d.lists.headings.find((h) => /furniture/i.test(h.name)) : undefined);
  };
  const NEW = -1; // "add this line to the lists"

  const pick = async () => {
    try {
      const f = await pickFile(['xlsx'], t('اختر ملف الموازنة', 'Choose the budget workbook'));
      if (!f) return;
      setFileName(f.name);
      setSheets(await workbookGrids(f.bytes));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const choose = (name: string) => {
    setSheet(name);
    try {
      const r = readBudgetSheet(name, sheets!.find((x) => x.name === name)!.grid);
      setRead(r);
      setCont(String(r.contingencyPct));
      const furniture = /furniture/i.test(name);
      const accGuess = d.lists.accounts.find((a) => (furniture ? /furniture/i : /center|centre/i).test(a.name));
      if (accGuess) setAccount(accGuess.id);
      setLineOf(r.items.map((i) => {
        const g = guessLine(i, expLines, d.lists.headings, furniture ? 'Furniture' : undefined);
        if (g != null) return g;
        const c = i.category.toLowerCase() === 'staff' ? 'salary' : i.category.toLowerCase();
        return d.lists.headings.some((h) => h.name.toLowerCase() === c) ? -1 : null; // same heading exists: add the line
      }));
    } catch (e) {
      setRead(null);
      toast(errText(e), true);
    }
  };
  const total = read ? read.items.reduce((sum, i) => sum + itemTotal(i), 0) : 0;
  const missing = lineOf.filter((x) => x == null).length;

  const go = async () => {
    if (!read) return;
    setBusy(true);
    try {
      const n = await s.api.call('budget.importItems', {
        versionId, account_id: account, contingency_pct: Number(cont) || 0, source: `${fileName} › ${sheet}`,
        items: read.items.map((i, k) => ({
          account_id: account, line_id: lineOf[k] === NEW ? 0 : lineOf[k]!,
          new_line: lineOf[k] === NEW ? { heading_id: headingFor(i.category)!.id, name: i.name.replace(/\s*\*\s*$/, '') } : undefined,
          name: i.name.replace(/\s*\*\s*$/, ''), unit: i.unit, qty: i.qty, times: i.times, unit_cost: i.unit_cost,
          // keep the sheet's own group (e.g. the room "Theatre") when it is not the heading's name
          note: i.category.toLowerCase() !== (headingName(lineOf[k]) ?? '').toLowerCase() && i.category.toLowerCase() !== 'staff' ? i.category : null,
          sort: k,
        })),
      });
      toast(t(`استُورد ${n} عنصراً`, `${n} items imported`));
      if (lineOf.includes(NEW)) await reloadData(); // new lines in the lists
      await onDone(account);
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('استيراد ورقة موازنة', 'Import a budget sheet')} onClose={onClose}>
      {!sheets ? (
        <>
          <p className="muted">{t('ملف مثل «MAGIS 2027 Budget.xlsx»: لكل عنصر الكمية × المرات × كلفة الوحدة.', 'A workbook like "MAGIS 2027 Budget.xlsx": each item has Quantity × Times × Cost per unit.')}</p>
          <button className="btn primary" onClick={pick}>{t('اختيار الملف…', 'Choose the file…')}</button>
        </>
      ) : (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span className="muted small">{fileName}:</span>
            {sheets.map((x) => <button key={x.name} className={`btn small ${sheet === x.name ? 'primary' : ''}`} onClick={() => choose(x.name)}>{x.name}</button>)}
          </div>
          {read && (
            <>
              <div className="grid2" style={{ marginTop: 12 }}>
                <Field label={t('إلى الحساب', 'Into the account')}><Select value={account} options={d.lists.accounts.map((a) => ({ value: a.id, label: a.name }))} onChange={(x) => x != null && setAccount(x)} /></Field>
                <Field label={t('الاحتياط %', 'Contingency %')}><input className="ltr" inputMode="decimal" value={cont} onChange={(e) => setCont(e.target.value)} /></Field>
              </div>
              <div className={`alert ${read.sheetBase != null && Math.abs(read.sheetBase - total) < 0.5 ? 'ok' : 'warn'}`}>
                {t(`${read.items.length} عنصراً، المجموع`, `${read.items.length} items, total`)} <b className="ltr">{usd(total)}</b>
                {read.sheetBase != null && (Math.abs(read.sheetBase - total) < 0.5
                  ? <> ✓ {t('يطابق مجموع الورقة', "matches the sheet's total")}</>
                  : <> ⚠ {t('الورقة تقول', 'the sheet says')} {usd(read.sheetBase)}</>)}
                {Number(cont) > 0 && <> · {t('مع الاحتياط', 'with contingency')} <b className="ltr">{usd(total * (1 + Number(cont) / 100))}</b></>}
              </div>
              {missing > 0 && <div className="alert err">{t(`${missing} عنصراً بلا خط: اختر خطاً لكل منها.`, `${missing} items have no line: choose one for each.`)}</div>}
              <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
                <table className="t">
                  <thead><tr><th>{t('في الورقة', 'In the sheet')}</th><th className="n">$</th><th>{t('خط السجل', 'Register line')}</th></tr></thead>
                  <tbody>
                    {read.items.map((i, k) => (
                      <tr key={k}>
                        <td><span className="muted small">{i.category} ›</span> {i.name} <span className="muted small ltr">({num(i.qty)} × {num(i.times)} × {num(i.unit_cost)})</span></td>
                        <td className="n">{fmtUsd(itemTotal(i))}</td>
                        <td style={{ minWidth: 240 }}>
                          <Select value={lineOf[k]} placeholder="—"
                            options={[
                              ...(headingFor(i.category) && can('lists.manage') ? [{ value: NEW, label: `＋ ${t('خط جديد', 'New line')}: ${headingFor(i.category)!.name} › ${i.name.replace(/\s*\*\s*$/, '')}` }] : []),
                              ...expLines.map((l) => ({ value: l.id, label: lineLabel(l.id) })),
                            ]}
                            onChange={(x) => setLineOf(lineOf.map((y, j) => (j === k ? x : y)))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">{t('الاستيراد يستبدل كل ما في هذا الحساب في هذه الموازنة.', 'Importing replaces everything this account had in this budget.')}</p>
            </>
          )}
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
            <button className="btn primary" disabled={!read || missing > 0 || busy} onClick={go}>{busy ? '…' : t('استيراد', 'Import')}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Once the budget is set: expense lines with no budget leave the lists (old rows keep them). */
function UnbudgetedLines({ b, onClose, onDone }: { b: BudgetPayload; onClose: () => void; onDone: () => Promise<void> }) {
  const { s, d } = useApp();
  const outside = new Set(d.lists.accounts.filter((a) => a.outside_budget).map((a) => a.id));
  const budgeted = new Set(b.amounts.filter((x) => !outside.has(x.account_id)).map((x) => x.line_id));
  // only headings used for expenses alone (a heading also used for transfers, like "Other / Unallocated", stays)
  const typesOf = (hid: number) => d.lists.headingTypes.filter((x) => x.heading_id === hid).map((x) => x.type);
  const candidates = d.lists.lines.filter((l) => l.active && typesOf(l.heading_id).length === 1 && typesOf(l.heading_id)[0] === 'Exp' && !budgeted.has(l.id));
  const [pick, setPick] = useState<Set<number>>(() => new Set(candidates.map((l) => l.id)));
  const used = (id: number) => d.rows.filter((r) => r.line_id === id).length;
  const go = async () => {
    try {
      const n = await s.api.call('budget.deactivateLines', { lineIds: [...pick] });
      toast(t(`أُوقف ${n} خطاً`, `${n} lines deactivated`));
      await onDone();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <Modal title={t('خطوط بلا موازنة', 'Lines without budget')} onClose={onClose}>
      <p className="muted">{t('هذه خطوط نفقات لا موازنة لها. إيقافها يخرجها من القوائم عند الإدخال؛ القيود القديمة تبقى كما هي. يمكن إعادة تشغيلها من صفحة القوائم.', 'These expense lines have no budget. Deactivating them takes them out of the lists when entering; old rows stay as they are. They can be switched on again from the Lists page.')}</p>
      {!candidates.length ? <div className="alert ok">{t('كل خطوط النفقات لها موازنة.', 'Every expense line has a budget.')}</div> : (
        <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table className="t">
            <tbody>
              {candidates.map((l) => (
                <tr key={l.id}>
                  <td><input type="checkbox" checked={pick.has(l.id)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(l.id); else n.delete(l.id); setPick(n); }} /></td>
                  <td>{d.lists.headings.find((h) => h.id === l.heading_id)?.name} › <b>{l.name}</b></td>
                  <td className="muted small">{used(l.id)} {t('قيد', 'rows')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إغلاق', 'Close')}</button>
        <button className="btn primary" disabled={!pick.size} onClick={go}>{t(`إيقاف ${pick.size}`, `Deactivate ${pick.size}`)}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- donors

const STATUS_LABEL: Record<AllocStatus, () => string> = {
  requested: () => t('مطلوب', 'Requested'),
  promised: () => t('موعود', 'Promised'),
  received: () => t('مستلم', 'Received'),
};

function Donors({ b, reload }: { b: BudgetPayload; reload: () => Promise<void> }) {
  const B = b.budget!;
  const { assigned, books } = useAssignment(b);
  const { s, d, can } = useApp();
  const names = useNames();
  const may = can('budget.manage');
  const [editing, setEditing] = useState<Partial<BudgetAlloc> | null>(null);
  const headingOf = useMemo(() => new Map(d.lists.lines.map((l) => [l.id, l.heading_id])), [d]);
  const outside = new Set(d.lists.accounts.filter((a) => a.outside_budget).map((a) => a.id));
  const cells = useMemo(() => cellsOf(b.amounts, b.accounts).filter((x) => !outside.has(x.account_id)), [b, outside]);
  const eff = useMemo(() => effectivePct(b.allocs, cells, headingOf), [b, cells, headingOf]);

  const worth = (a: BudgetAlloc) => allocWorth(a, b.allocs, eff, cells, headingOf);
  const scopeName = (a: BudgetAlloc) => a.account_id == null ? t('كل حسابات المركز', 'Every account of the centre') : a.line_id != null
    ? `${names.account(a.account_id)} › ${names.heading(a.heading_id)} › ${names.line(a.line_id)}`
    : a.heading_id != null ? `${names.account(a.account_id)} › ${names.heading(a.heading_id)}` : `${names.account(a.account_id)} (${t('كله', 'whole')})`;

  const perAccount = d.lists.accounts.filter((a) => !a.outside_budget).map((acc) => {
    const mine = cells.filter((x) => x.account_id === acc.id);
    let budget = 0, toFind = 0, over = 0;
    const byStatus: Record<AllocStatus, number> = { requested: 0, promised: 0, received: 0 };
    for (const x of mine) {
      const c = cover(b.allocs, eff, x.account_id, x.line_id, headingOf.get(x.line_id) ?? WHOLE, x.amount_usd);
      budget += x.amount_usd;
      toFind += c.toFind;
      if (c.pct > 100.001) over++;
      for (const dn of c.donors) byStatus[dn.status] += dn.usd;
    }
    return { acc, budget, toFind, over, byStatus };
  }).filter((x) => x.budget > 0);
  const tot = perAccount.reduce((s2, x) => ({ budget: s2.budget + x.budget, toFind: s2.toFind + x.toFind, r: s2.r + x.byStatus.received, p: s2.p + x.byStatus.promised, q: s2.q + x.byStatus.requested }), { budget: 0, toFind: 0, r: 0, p: 0, q: 0 });

  const received = (donorId: number) => d.grants.filter((g) => g.donor_id === donorId && g.status === 'hand' && g.hand_on && inPeriod(B, g.hand_on.slice(0, 7))).reduce((sum, g) => sum + (g.hand_usd ?? 0), 0);
  const donorIds = [...new Set(b.allocs.map((a) => a.donor_id))];

  /** The standard donor report, in Excel. */
  const exportDonor = async (donorId: number) => {
    try {
      const docs = new Map<string, string[]>();
      for (const a of d.attachments) docs.set(a.trx_id, [...(docs.get(a.trx_id) ?? []), a.name]);
      const bytes = await donorReportXlsx({
        donorId, budget: B, organisation: s.organisation, lists: d.lists, rows: d.rows, comp: d.comp, assigned: books.length > 1 ? assigned : undefined,
        amounts: b.amounts, accounts: b.accounts, allocs: b.allocs, grants: d.grants, docs,
      });
      const file = `${s.organisation || 'MAGIS'} - ${names.donor(donorId)} - ${B.name}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
      const path = await saveFile(file, ['xlsx'], bytes, t('احفظ تقرير المانح', 'Save the donor report'));
      if (path !== null) toast(t('حُفظ التقرير', 'Report saved'));
    } catch (e) {
      toast(errText(e), true);
    }
  };

  const remove = async (a: BudgetAlloc) => {
    if (!(await confirmBox(t('حذف هذا التخصيص؟', 'Delete this allocation?'), true))) return;
    try {
      await s.api.call('alloc.delete', { id: a.id });
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };

  return (
    <>
      <h3>{t('ما يغطيه المانحون، حسب الحساب', 'What donors cover, per account')}</h3>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>{t('الحساب', 'Account')}</th>
              <th className="n">{t('الموازنة', 'Budget')} $</th>
              <th className="n">{t('مستلم', 'Received')} $</th>
              <th className="n">{t('موعود', 'Promised')} $</th>
              <th className="n">{t('مطلوب', 'Requested')} $</th>
              <th className="n">{t('يبقى إيجاده', 'Still to find')} $</th>
            </tr>
          </thead>
          <tbody>
            {perAccount.map((x) => (
              <tr key={x.acc.id}>
                <td>{x.acc.name}{x.over > 0 && <span className="bad small"> · ⚠ {t(`${x.over} خطاً فوق 100%`, `${x.over} lines above 100 %`)}</span>}</td>
                <td className="n">{fmtUsd(x.budget)}</td>
                <td className="n">{fmtUsd(x.byStatus.received)}</td>
                <td className="n">{fmtUsd(x.byStatus.promised)}</td>
                <td className="n">{fmtUsd(x.byStatus.requested)}</td>
                <td className={`n ${x.toFind > 0.5 ? 'bad' : 'ok'}`}><b>{fmtUsd(x.toFind)}</b></td>
              </tr>
            ))}
            {perAccount.length > 1 && (
              <tr className="group">
                <td><b>{t('المجموع', 'Total')}</b></td>
                <td className="n"><b>{fmtUsd(tot.budget)}</b></td>
                <td className="n"><b>{fmtUsd(tot.r)}</b></td>
                <td className="n"><b>{fmtUsd(tot.p)}</b></td>
                <td className="n"><b>{fmtUsd(tot.q)}</b></td>
                <td className="n"><b>{fmtUsd(tot.toFind)}</b></td>
              </tr>
            )}
            {!perAccount.length && <tr><td colSpan={6} className="muted">{t('لا مبالغ في الموازنة بعد', 'No amounts in the budget yet')}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t('بلا احتياط: يغطي المانحون الموازنة الأساسية.', 'Without contingency: donors cover the base budget.')}</p>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 18 }}>
        <h3 style={{ margin: 0 }}>{t('التخصيصات', 'Allocations')}</h3>
        {may && <button className="btn primary" onClick={() => setEditing({ budget_id: B.id, status: 'promised', pct: 100, amount_usd: null, rest: 0 })}>＋ {t('تخصيص', 'Allocation')}</button>}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>{t('المانح', 'Donor')}</th>
              <th>{t('يغطي', 'Covers')}</th>
              <th className="n">%</th>
              <th className="n">$</th>
              <th>{t('الحالة', 'Status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {b.allocs.map((a) => (
              <tr key={a.id}>
                <td>{names.donor(a.donor_id)}</td>
                <td>{scopeName(a)}{a.note ? <span className="muted small"> · {a.note}</span> : null}</td>
                <td className="n">{a.rest ? <span className="muted">{t('الباقي', 'the rest')}</span> : a.pct != null ? `${a.pct}%` : <span className="muted">{num(eff.get(a.id) ?? 0)}%</span>}</td>
                <td className="n">{a.amount_usd != null ? <b>{fmtUsd(a.amount_usd)}</b> : fmtUsd(worth(a))}</td>
                <td><span className={`pill st-${a.status}`}>{STATUS_LABEL[a.status]()}</span></td>
                <td className="right nowrap">
                  {may && <><button className="btn small" onClick={() => setEditing(a)}>{t('تعديل', 'Edit')}</button> <button className="btn small danger" onClick={() => remove(a)}>✕</button></>}
                </td>
              </tr>
            ))}
            {!b.allocs.length && <tr><td colSpan={6} className="muted">{t('لا تخصيص بعد', 'No allocation yet')}</td></tr>}
          </tbody>
        </table>
      </div>

      {donorIds.length > 0 && (
        <>
          <h3 style={{ marginTop: 18 }}>{t('حسب المانح', 'Per donor')}</h3>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>{t('المانح', 'Donor')}</th><th className="n">{t('المخصّص', 'Allocated')} $</th><th className="n">{t('منح مستلمة في الفترة', 'Grants received in the period')} $</th><th /></tr></thead>
              <tbody>
                {donorIds.map((id) => (
                  <tr key={id}>
                    <td>{names.donor(id)}</td>
                    <td className="n">{fmtUsd(b.allocs.filter((a) => a.donor_id === id).reduce((sum, a) => sum + worth(a), 0))}</td>
                    <td className="n">{fmtUsd(received(id))}</td>
                    <td className="right"><button className="btn small" onClick={() => exportDonor(id)}>⬇ {t('تقرير Excel', 'Excel report')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && <AllocModal start={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
    </>
  );
}

function AllocModal({ start, onClose, onSaved }: { start: Partial<BudgetAlloc>; onClose: () => void; onSaved: () => Promise<void> }) {
  const { s, d } = useApp();
  const [a, setA] = useState<Partial<BudgetAlloc>>(start.id && start.account_id == null ? { ...start, account_id: 0 } : start);
  const [scope, setScope] = useState<'account' | 'heading' | 'line'>(start.line_id != null ? 'line' : start.heading_id != null ? 'heading' : 'account');
  const [kind, setKind] = useState<'pct' | 'amount' | 'rest'>(start.rest ? 'rest' : start.amount_usd != null ? 'amount' : 'pct');
  const ALL = 0; // every account of the centre
  const [val, setVal] = useState(String(start.amount_usd ?? start.pct ?? 100));
  const expHeadings = d.lists.headings.filter((h) => d.lists.headingTypes.some((x) => x.heading_id === h.id && x.type === 'Exp'));
  const save = async () => {
    try {
      await s.api.call('alloc.save', {
        ...a,
        account_id: a.account_id === ALL ? null : a.account_id,
        pct: kind === 'pct' ? parseAmount(val) : null,
        amount_usd: kind === 'amount' ? parseAmount(val) : null,
        rest: kind === 'rest' ? 1 : 0,
        heading_id: scope === 'account' || a.account_id === ALL ? null : a.heading_id ?? null,
        line_id: scope === 'line' && a.account_id !== ALL ? a.line_id ?? null : null,
      } as never);
      toast(t('حُفظ', 'Saved'));
      await onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <Modal title={a.id ? t('تعديل التخصيص', 'Edit allocation') : t('تخصيص جديد', 'New allocation')} onClose={onClose}>
      <div className="grid2">
        <Field label={t('المانح', 'Donor')}><Select value={a.donor_id ?? null} options={d.lists.donors.filter((x) => x.active || x.id === a.donor_id).map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => setA({ ...a, donor_id: v ?? undefined })} /></Field>
        <Field label={t('الحساب', 'Account')}><Select value={a.account_id ?? null} options={[{ value: ALL, label: t('كل حسابات المركز', 'Every account of the centre') }, ...d.lists.accounts.filter((x) => !x.outside_budget).map((x) => ({ value: x.id, label: x.name }))]} onChange={(v) => setA({ ...a, account_id: v ?? undefined })} /></Field>
      </div>
      {a.account_id !== ALL && <Field label={t('يغطي', 'Covers')}>
        <Seg value={scope} onChange={setScope} options={[
          { value: 'account', label: t('الحساب كله', 'The whole account') },
          { value: 'heading', label: t('بنداً', 'A heading') },
          { value: 'line', label: t('خطاً', 'A line') },
        ]} />
      </Field>}
      {scope !== 'account' && a.account_id !== ALL && (
        <div className="grid2">
          <Field label={t('البند', 'Heading')}><Select value={a.heading_id ?? null} options={expHeadings.map((h) => ({ value: h.id, label: h.name }))} onChange={(v) => setA({ ...a, heading_id: v, line_id: null })} /></Field>
          {scope === 'line' && (
            <Field label={t('الخط', 'Line')}><Select value={a.line_id ?? null} options={d.lists.lines.filter((l) => l.heading_id === a.heading_id).map((l) => ({ value: l.id, label: l.name }))} onChange={(v) => setA({ ...a, line_id: v })} /></Field>
          )}
        </div>
      )}
      <div className="grid2">
        <Field label={t('المساهمة', 'Contribution')}>
          <div className="row">
            <Seg value={kind} onChange={setKind} options={[{ value: 'pct', label: '%' }, { value: 'amount', label: t('مبلغ $', 'Amount $') }, { value: 'rest', label: t('الباقي', 'The rest') }]} />
            {kind !== 'rest' && <input className="ltr" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} style={{ width: 120 }} />}
          </div>
        </Field>
        <Field label={t('الحالة', 'Status')}>
          <Seg value={a.status ?? 'promised'} onChange={(v) => setA({ ...a, status: v })} options={(['requested', 'promised', 'received'] as AllocStatus[]).map((x) => ({ value: x, label: STATUS_LABEL[x]() }))} />
        </Field>
      </div>
      <Field label={t('ملاحظة', 'Note')}><input value={a.note ?? ''} onChange={(e) => setA({ ...a, note: e.target.value || null })} /></Field>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!a.donor_id || a.account_id == null || (kind !== 'rest' && !val) || (a.account_id !== ALL && ((scope !== 'account' && !a.heading_id) || (scope === 'line' && !a.line_id)))} onClick={save}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}
