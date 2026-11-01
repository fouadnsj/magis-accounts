// Budgets, for the Superior (and whoever is given the budget in a profile; never the book holders).
// A budget covers a period: a start month and 1–36 months. Budgets may overlap: each
// expense then belongs to one of them (the oldest that still has money on its line),
// and the leftover of a budget can be carried over to the one that continues it.
//  - Follow-up: each line's budget against what was really spent, with a colour
//    for 50 / 75 / 90 % spent, the pace against the months gone (under- or
//    over-spending), and how much of the contingency is used.
//  - Budget: one for the whole centre; each line built from items (Quantity × Times × Cost,
//    as in MAGIS 2027 Budget.xlsx) or typed directly; SYP and EUR calculated;
//    import of a budget sheet; a budget from the year's spending or from another budget.
//  - Funds: each line has at most one fund (Fouad, 2026-11-01); a fund is given to whole
//    headings or single lines; what is not funded, and each fund against its lines.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { catIcon } from './catIcons';
import { useApp, useNames, useIcons } from '../state';
import type { BudgetPayload } from '../ops';
import {
  NOFUND, addMonths, assignExpenses, contingencyOf, defaultBudgetName, followUp, guessLine, itemTotal,
  leftoverOf, periodEnd, periodMonths, periodShare, readBudgetSheet, spentInRange, usedBand,
  type Budget, type BudgetBook, type BudgetItem, type BudgetRow, type Pace, type SheetRead,
} from '../domain/budget';
import { MONTHS_AR, MONTHS_EN } from '../domain/types';
import { monthWord } from '../i18n';
import { pickFile } from '../platform';
import { workbookGrids, type Grid } from '../io/budgetSheet';
import { Field, Modal, Select, Seg, Tabs, confirmBox, errText, fmtPct, fmtSyp, fmtUsd, parseAmount, promptBox, t, toast } from './kit';
import { GuideLink } from '../guide/GuideView';

type Tab = 'follow' | 'edit' | 'funds';

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
    const books: BudgetBook[] = b.books.map((x) => ({ budget: x.budget, cells: x.cells }));
    const outside = new Set(d.lists.accounts.filter((a) => a.outside_budget).map((a) => a.id));
    return { books, assigned: assignExpenses(d.rows, d.comp, books, (r) => r.account_id == null || !outside.has(r.account_id)) };
  }, [b, d]);
}

/** A fund's name; NOFUND: "Not funded". */
function useFundName() {
  const names = useNames();
  return (id: number) => (id === NOFUND ? t('غير ممول', 'Not funded') : names.account(id));
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
        <h1>{t('الموازنة', 'Budget')}<GuideLink id="budget" /></h1>
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
            { value: 'funds', label: t('المشاريع', 'Projects') },
          ]} />
          {tab === 'follow' && <FollowUp key={b.budget!.id} b={b} />}
          {tab === 'edit' && <EditBudget key={b.budget!.id} b={b} reload={load} onDeleted={() => setBudgetId(null)} />}
          {tab === 'funds' && <FundsTab key={b.budget!.id} b={b} reload={load} />}
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
    () => followUp({ rows: d.rows, comp: d.comp, budget: B, upToYm: upTo, amounts: b.amounts, original: b.original, headingOf, outside, assigned: shared ? assigned : undefined }),
    [d, b, B, upTo, headingOf, outside, shared, assigned],
  );
  const rows = all.filter((r) => (account == null || r.account_id === account) && (!onlyFlags || r.pace === 'over' || r.pace === 'under' || r.pace === 'nobudget' || r.pace === 'ahead'));
  const revised = b.original != null;
  const share = periodShare(B, upTo);
  // carried over: from the budget this one continues, and to the one that continues it
  const leftover = (id: number) => {
    const bk = books.find((x) => x.budget.id === id);
    return bk ? leftoverOf(bk, d.rows, d.comp, assigned) : 0;
  };
  const carriedIn = B.carry_from_id != null ? Math.max(0, leftover(B.carry_from_id)) : 0;
  const carriedTo = b.budgets.filter((x) => x.carry_from_id === B.id);
  const lineName = (id: number) => d.lists.lines.find((l) => l.id === id)?.name ?? '?';
  const fundName = useFundName();
  const sumOf = (xs: BudgetRow[]) => ({
    original: xs.reduce((s, r) => s + (r.original ?? 0), 0),
    budget: xs.reduce((s, r) => s + r.budget, 0),
    spent: xs.reduce((s, r) => s + r.spent, 0),
    lastYear: xs.reduce((s, r) => s + r.lastYear, 0),
  });
  const scope = all.filter((r) => account == null || r.account_id === account);
  const total = sumOf(scope);
  const { reserve, used: reserveUsed } = contingencyOf(scope, b.current?.contingency_pct ?? 0);
  const headings = d.lists.headings.filter((h) => rows.some((r) => r.heading_id === h.id));
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
        <span className="muted small">{t('المشروع', 'Project')}</span>
        <div style={{ minWidth: 180 }}>
          <Select value={account} placeholder={t('كل المشاريع', 'All projects')} options={[...d.lists.accounts.filter((a) => !a.outside_budget && b.amounts.some((x) => x.account_id === a.id)).map((a) => ({ value: a.id, label: a.name })), { value: NOFUND, label: t('غير ممول', 'Not funded') }]} onChange={setAccount} />
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
              {account == null && <th>{t('المشروع', 'Project')}</th>}
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
              const xs = rows.filter((r) => r.heading_id === h.id).sort((a, c) => lineName(a.line_id).localeCompare(lineName(c.line_id)));
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
                  <tr key={r.line_id}>
                    <td style={{ paddingInlineStart: 22 }}>{icons.line(r.line_id)} {lineName(r.line_id)}</td>
                    {account == null && <td className={`small ${r.account_id === NOFUND ? 'bad' : ''}`}>{fundName(r.account_id)}</td>}
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

// ---------------------------------------------------------------- the budget of the centre

/**
 * Gives a project to lines. A closed month with expenses on them would change after its closing (Fouad, 2026-11-02):
 * it is said first, and whoever may reopen months reopens them here (to close again afterwards).
 */
function useGiveFund(versionId: number, budget: Pick<Budget, 'start_ym' | 'months'>) {
  const { s, d, can } = useApp();
  return async (lineIds: number[], fundId: number | null): Promise<boolean> => {
    if (!lineIds.length) return true;
    // the project's dates should cover the budget: outside them its lines' expenses are not funded
    const p = fundId != null && fundId !== NOFUND ? d.lists.accounts.find((a) => a.id === fundId) : undefined;
    const from = `${budget.start_ym}-01`, to = `${periodEnd(budget)}-31`;
    if (p && ((p.start_date && p.start_date > from) || (p.end_date && p.end_date < to))
      && !(await confirmBox(t(`مدة «${p.name}» (${p.start_date ?? '…'} → ${p.end_date ?? '…'}) لا تغطي الموازنة كلها (${budget.start_ym} → ${periodEnd(budget)}): النفقات خارجها تبقى غير ممولة. متابعة؟`, `The dates of "${p.name}" (${p.start_date ?? '…'} → ${p.end_date ?? '…'}) do not cover the whole budget (${budget.start_ym} → ${periodEnd(budget)}): the expenses outside them stay not funded. Continue?`)))) return false;
    const { closed } = await s.api.call('budget.fundCheck', { versionId, line_ids: lineIds });
    if (closed.length) {
      if (!can('month.reopen')) {
        toast(t(`أشهر مغلقة فيها نفقات على هذه الخطوط: ${closed.join('، ')}. اطلب إعادة فتحها ممن يستطيع.`, `Closed months have expenses on these lines: ${closed.join(', ')}. Ask whoever may reopen them.`), true);
        return false;
      }
      if (!(await confirmBox(t(`نفقات هذه الخطوط في أشهر مغلقة: ${closed.join('، ')}. تغيير المشروع يغيّر هذه الأشهر: تُعاد فتحها الآن، ثم تُغلق من جديد في الإدارة ← إغلاق الأشهر. متابعة؟`, `The expenses of these lines are in closed months: ${closed.join(', ')}. Changing the project changes these months: they are reopened now, then closed again in Admin → Month closing. Continue?`)))) return false;
      for (const ym of closed) await s.api.call('month.reopen', { ym });
      toast(t(`أُعيد فتح: ${closed.join('، ')}. أغلقها من جديد بعد التغيير.`, `Reopened: ${closed.join(', ')}. Close them again after the change.`));
    }
    await s.api.call('budget.setFund', { versionId, line_ids: lineIds, account_id: fundId === NOFUND ? null : fundId });
    return true;
  };
}

/** The funds a line can have: those inside the budget, and "not funded". */
function useFundOptions(current: number[] = []) {
  const { d } = useApp();
  return [
    { value: NOFUND, label: `— ${t('غير ممول', 'Not funded')} —` },
    ...d.lists.accounts.filter((a) => !a.outside_budget && (a.active || current.includes(a.id))).map((a) => ({ value: a.id, label: a.name })),
  ];
}

function EditBudget({ b, reload, onDeleted }: { b: BudgetPayload; reload: () => Promise<void>; onDeleted: () => void }) {
  const B = b.budget!;
  const { s, d, can } = useApp();
  const fundName = useFundName();
  const v = b.current!;
  const may = can('budget.manage');
  // giving funds to lines: who keeps the grants
  const mayFund = may && can('lists.donors');
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
  const amount = new Map(b.amounts.map((a) => [String(a.line_id), a.amount_usd]));
  const fund = new Map(b.amounts.map((a) => [a.line_id, a.account_id]));
  const fundOptions = useFundOptions([...fund.values()]);
  const orig = b.original ? new Map(b.original.map((a) => [String(a.line_id), a.amount_usd])) : null;
  const itemsOf = (lineId: number) => b.items.filter((i) => i.line_id === lineId);
  const contPct = v.contingency_pct ?? 0;
  // reference: what was spent in the 12 months before the budget starts (not on funds outside the budget)
  const lastYear = useMemo(() => {
    const outside = new Set(d.lists.accounts.filter((a) => a.outside_budget).map((a) => a.id));
    return spentInRange(d.rows, d.comp, addMonths(B.start_ym, -12), addMonths(B.start_ym, -1), (r) => r.account_id == null || !outside.has(r.account_id)).spent;
  }, [d, B]);
  const rSyp = parseAmount(rates.syp) || v.rate_syp;
  const rEur = parseAmount(rates.eur) || v.rate_eur;
  const expHeadings = d.lists.headings.filter((h) => d.lists.headingTypes.some((x) => x.heading_id === h.id && x.type === 'Exp'));
  const valueOf = (k: string) => (k in edits ? parseAmount(edits[k]) || 0 : amount.get(k) ?? 0);
  const changed = Object.keys(edits).filter((k) => valueOf(k) !== (amount.get(k) ?? 0));
  const total0 = b.amounts.reduce((sum, x) => sum + (changed.includes(String(x.line_id)) ? 0 : x.amount_usd), 0) + changed.reduce((sum, k) => sum + valueOf(k), 0);
  const notFunded = b.amounts.filter((x) => x.account_id === NOFUND).reduce((sum, x) => sum + x.amount_usd, 0);
  const reserve = (total0 * contPct) / 100;
  const ratesChanged = rSyp !== v.rate_syp || rEur !== v.rate_eur;

  const save = async () => {
    setBusy(true);
    try {
      if (ratesChanged) await s.api.call('budget.setRates', { versionId: v.id, rate_syp: rSyp, rate_eur: rEur });
      if (changed.length) await s.api.call('budget.saveAmounts', { versionId: v.id, cells: changed.map((k) => ({ line_id: Number(k), amount_usd: valueOf(k) })) });
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
    const x = await promptBox(t('نسبة الاحتياط للموازنة (%)، مثلاً 10', 'Contingency for the budget (%), e.g. 10'), String(contPct));
    if (x == null) return;
    await act(() => s.api.call('budget.setContingency', { versionId: v.id, contingency_pct: Number(x) || 0 }), t('حُفظ', 'Saved'));
  };
  const fillActual = async (h: { id: number; name: string }) => {
    if (!(await confirmBox(t(`استبدال موازنة خطوط «${h.name}» بما صُرف فعلاً خلال فترة هذه الموازنة؟`, `Replace the budget of the lines of "${h.name}" with what was really spent during this budget's period?`)))) return;
    await act(() => s.api.call('budget.fillActual', { versionId: v.id, heading_id: h.id }), t('حُفظ', 'Saved'));
  };
  const give = useGiveFund(v.id, B);
  const giveFund = async (lineIds: number[], fundId: number | null) => {
    try {
      if (await give(lineIds, fundId)) { toast(t('حُفظ', 'Saved')); await reload(); }
    } catch (e) {
      toast(errText(e), true);
    }
  };

  return (
    <>
      <div className="panel">
        <div className="grid3">
          <Field label={t('ليرة لكل دولار (تقديري)', 'SYP per USD (estimated)')}><input className="ltr" inputMode="decimal" disabled={!may} value={rates.syp} onChange={(e) => setRates({ ...rates, syp: e.target.value })} /></Field>
          <Field label={t('يورو لكل دولار (تقديري)', 'EUR per USD (estimated)')}><input className="ltr" inputMode="decimal" disabled={!may} value={rates.eur} onChange={(e) => setRates({ ...rates, eur: e.target.value })} /></Field>
        </div>
        <div className="budget-totals">
          <div><span className="muted small">{t('الموازنة الأساسية', 'Base budget')}</span><b className="ltr">{usd(total0)}</b></div>
          <div><span className="muted small">{t('احتياط', 'Contingency')} {contPct}%</span><b className="ltr">{usd(reserve)}</b></div>
          <div><span className="muted small">{t('المجموع', 'Total')}</span><b className="ltr">{usd(total0 + reserve)}</b></div>
          <div><span className="muted small">SYP</span><b className="ltr">{fmtSyp((total0 + reserve) * rSyp)}</b></div>
          <div><span className="muted small">EUR</span><b className="ltr">{fmtEur((total0 + reserve) * rEur)}</b></div>
          <div><span className="muted small">{t('غير ممول', 'Not funded')}</span><b className={`ltr ${notFunded > 0.5 ? 'bad' : ''}`}>{usd(notFunded)}</b></div>
        </div>
        {may && (
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn" onClick={() => setImporting(true)}>{t('استيراد من Excel…', 'Import from Excel…')}</button>
            <button className="btn" onClick={setContingency}>{t('نسبة الاحتياط…', 'Contingency…')}</button>
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
        <p className="muted small">{t('لكل خط مشروع واحد. لإعطاء مشروع لبند كامل: اختره في سطر البند.', 'Each line has one project. To give a project to a whole heading: choose it on the heading\'s row.')}</p>
      </div>

      <div className="table-wrap">
        <table className="t budget-t">
          <thead>
            <tr>
              <th>{t('البند / الخط', 'Heading / line')}</th>
              <th>{t('المشروع', 'Project')}</th>
              {orig && <th className="n">{t('الأصلية', 'Original')} $</th>}
              <th className="n">{t('الموازنة', 'Budget')} $</th>
              <th className="n">SYP</th>
              <th className="n">EUR</th>
              <th className="n">{t('صُرف في الأشهر الـ12 قبلها', 'Spent in the 12 months before')} $</th>
            </tr>
          </thead>
          <tbody>
            {expHeadings.map((h) => {
              const lines = d.lists.lines.filter((l) => l.heading_id === h.id && (l.active || amount.has(String(l.id))));
              if (!lines.length) return null;
              const hs = lines.reduce((sum, l) => sum + valueOf(String(l.id)), 0);
              const withAmount = lines.filter((l) => fund.has(l.id)).map((l) => l.id);
              const hFunds = [...new Set(withAmount.map((id) => fund.get(id)!))];
              return [
                <tr key={`h${h.id}`} className="group">
                  <td>
                    <b>{catIcon(h.name)} {h.name}</b>
                    {may && <button className="btn small ghost" style={{ marginInlineStart: 8 }} title={t('= ما صُرف في الفترة', '= What was spent in the period')} onClick={() => fillActual(h)}>= {t('المصروف', 'spent')}</button>}
                  </td>
                  <td>
                    {mayFund && withAmount.length > 0
                      ? <select className="inp small" style={{ minWidth: 160 }} value={hFunds.length === 1 ? hFunds[0] : ''} onChange={(e) => e.target.value !== '' && void giveFund(withAmount, Number(e.target.value))}>
                          {hFunds.length !== 1 && <option value="">{t('عدة مشاريع', 'Several projects')}</option>}
                          {fundOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      : hFunds.length === 1 ? <span className={`small ${hFunds[0] === NOFUND ? 'bad' : ''}`}>{fundName(hFunds[0])}</span> : null}
                  </td>
                  {orig && <td className="n muted">{fmtUsd(lines.reduce((sum, l) => sum + (orig.get(String(l.id)) ?? 0), 0))}</td>}
                  <td className="n"><b>{fmtUsd(hs)}</b></td>
                  <td className="n">{fmtSyp(hs * rSyp)}</td>
                  <td className="n">{fmtEur(hs * rEur)}</td>
                  <td className="n muted">{fmtUsd(lines.reduce((sum, l) => sum + (lastYear.get(l.id) ?? 0), 0))}</td>
                </tr>,
                ...lines.flatMap((l) => {
                  const k = String(l.id);
                  const val = valueOf(k);
                  const its = itemsOf(l.id);
                  const f = fund.get(l.id);
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
                      <td>
                        {f == null ? null : mayFund
                          ? <select className="inp small" style={{ minWidth: 160 }} value={f} onChange={(e) => void giveFund([l.id], Number(e.target.value))}>
                              {fundOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          : <span className={`small ${f === NOFUND ? 'bad' : ''}`}>{fundName(f)}</span>}
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
                      <td className="n muted">{lastYear.get(l.id) ? fmtUsd(lastYear.get(l.id)!) : ''}</td>
                    </tr>,
                    open === l.id ? (
                      <tr key={`${k}-items`} className="items-row">
                        <td colSpan={orig ? 7 : 6}>
                          <ItemsEditor key={`${v.id}-${k}`} versionId={v.id} lineId={l.id} items={its} may={may} onSaved={reload} />
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
      {importing && <ImportSheet versionId={v.id} contingency={contPct} onClose={() => setImporting(false)} onDone={async () => { setImporting(false); await reload(); }} />}
      {cleaning && <UnbudgetedLines b={b} onClose={() => setCleaning(false)} onDone={async () => { setCleaning(false); await reload(); }} />}
    </>
  );
}

/** The items of one line: Quantity × Times × Cost per unit. */
function ItemsEditor({ versionId, lineId, items, may, onSaved }: { versionId: number; lineId: number; items: BudgetItem[]; may: boolean; onSaved: () => Promise<void> }) {
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
        versionId, line_id: lineId,
        items: rows.filter((r) => r.name.trim()).map((r, k) => ({ line_id: lineId, name: r.name.trim(), unit: r.unit.trim() || null, qty: parseAmount(r.qty) || 0, times: parseAmount(r.times) || 0, unit_cost: parseAmount(r.unit_cost) || 0, note: r.note.trim() || null, sort: k })),
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

/** A sheet of the budget workbook: each item matched with a line of the register; its lines are replaced, the others stay. */
function ImportSheet({ versionId, contingency, onClose, onDone }: { versionId: number; contingency: number; onClose: () => void; onDone: () => Promise<void> }) {
  const { s, d, can, reload: reloadData } = useApp();
  const [sheets, setSheets] = useState<{ name: string; grid: Grid }[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheet, setSheet] = useState<string | null>(null);
  const [read, setRead] = useState<SheetRead | null>(null);
  const [cont, setCont] = useState(String(contingency));
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
      if (r.contingencyPct) setCont(String(r.contingencyPct));
      const furniture = /furniture/i.test(name);
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
        versionId, contingency_pct: Number(cont) || 0, source: `${fileName} › ${sheet}`,
        items: read.items.map((i, k) => ({
          line_id: lineOf[k] === NEW ? 0 : lineOf[k]!,
          new_line: lineOf[k] === NEW ? { heading_id: headingFor(i.category)!.id, name: i.name.replace(/\s*\*\s*$/, '') } : undefined,
          name: i.name.replace(/\s*\*\s*$/, ''), unit: i.unit, qty: i.qty, times: i.times, unit_cost: i.unit_cost,
          // keep the sheet's own group (e.g. the room "Theatre") when it is not the heading's name
          note: i.category.toLowerCase() !== (headingName(lineOf[k]) ?? '').toLowerCase() && i.category.toLowerCase() !== 'staff' ? i.category : null,
          sort: k,
        })),
      });
      toast(t(`استُورد ${n} عنصراً`, `${n} items imported`));
      if (lineOf.includes(NEW)) await reloadData(); // new lines in the lists
      await onDone();
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
              <p className="muted small">{t('الاستيراد يستبدل عناصر الخطوط الموجودة في الورقة؛ الخطوط الأخرى تبقى. كل خط يحتفظ بمشروعه.', 'Importing replaces the items of the lines in the sheet; the other lines stay. Each line keeps its project.')}</p>
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
  const budgeted = new Set(b.amounts.map((x) => x.line_id));
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

// ---------------------------------------------------------------- funds

/**
 * Each fund against its lines (Fouad, 2026-11-01): a grant's share here against the lines it was
 * given — short of money, or money not yet given to lines — and what is not funded.
 */
function FundsTab({ b, reload }: { b: BudgetPayload; reload: () => Promise<void> }) {
  const B = b.budget!;
  const v = b.current!;
  const { d, can } = useApp();
  const { assigned, books } = useAssignment(b);
  const mayFund = can('budget.manage') && can('lists.donors');
  const [giving, setGiving] = useState<number | null>(null);
  const headingOf = useMemo(() => new Map(d.lists.lines.map((l) => [l.id, l.heading_id])), [d]);
  const outside = useMemo(() => new Set(d.lists.accounts.filter((a) => a.outside_budget).map((a) => a.id)), [d]);
  const rows = useMemo(
    () => followUp({ rows: d.rows, comp: d.comp, budget: B, upToYm: periodEnd(B), amounts: b.amounts, original: null, headingOf, outside, assigned: books.length > 1 ? assigned : undefined }),
    [d, b, B, headingOf, outside, books, assigned],
  );
  // the fund's money here, in dollars: a grant's share (euros at the budget's rate); a private fund has no set amount
  const moneyOf = (fundId: number) => {
    const p = d.grantParts.find((x) => x.account_id === fundId);
    const g = p && d.grants.find((x) => x.id === p.grant_id);
    if (!p || !g) return null;
    return { usd: g.currency === 'EUR' ? p.amount / (v.rate_eur || 1) : p.amount, grant: g, share: p.amount };
  };
  const funds = d.lists.accounts.filter((a) => !a.outside_budget && (b.amounts.some((x) => x.account_id === a.id) || (a.active && moneyOf(a.id))));
  const linesOf = (id: number) => b.amounts.filter((x) => x.account_id === id).reduce((sum, x) => sum + x.amount_usd, 0);
  const spentOf = (id: number) => rows.filter((r) => r.account_id === id).reduce((sum, r) => sum + r.spent, 0);
  const total = b.amounts.reduce((sum, x) => sum + x.amount_usd, 0);
  const notFunded = linesOf(NOFUND);
  return (
    <>
      <div className="cards" style={{ margin: '10px 0 14px' }}>
        <div className="card"><div className="k">{t('الموازنة', 'Budget')}</div><div className="v ltr">{usd(total)}</div></div>
        <div className="card"><div className="k">{t('لها مشروع', 'With a project')}</div><div className="v ltr">{usd(total - notFunded)}</div></div>
        <div className="card"><div className="k">{t('غير ممول', 'Not funded')}</div><div className={`v ltr ${notFunded > 0.5 ? 'bad' : ''}`}>{usd(notFunded)}</div></div>
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>{t('المشروع', 'Project')}</th>
              <th>{t('المنحة', 'Grant')}</th>
              <th className="n">{t('مال المشروع هنا', "The project's money here")} $</th>
              <th className="n">{t('خطوطه في الموازنة', 'Its lines in the budget')} $</th>
              <th>{t('الفرق', 'Difference')}</th>
              <th className="n">{t('صُرف على خطوطه', 'Spent on its lines')} $</th>
              {mayFund && <th />}
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => {
              const mo = moneyOf(f.id);
              const lines = linesOf(f.id);
              const diff = mo ? mo.usd - lines : null;
              return (
                <tr key={f.id}>
                  <td><b>{f.name}</b>{f.start_date || f.end_date ? <div className="muted small ltr">{f.start_date ?? '…'} → {f.end_date ?? '…'}</div> : null}</td>
                  <td className="small">{mo ? <>{d.lists.donors.find((x) => x.id === mo.grant.donor_id)?.name}{mo.grant.reference ? <span className="muted"> · {mo.grant.reference}</span> : null}{mo.grant.currency === 'EUR' ? <span className="muted ltr"> · €{fmtUsd(mo.share)}</span> : null}</> : <span className="muted">{t('خاص', 'Private')}</span>}</td>
                  <td className="n">{mo ? fmtUsd(mo.usd) : '—'}</td>
                  <td className="n">{fmtUsd(lines)}</td>
                  <td className="small">
                    {diff == null ? '' : diff < -0.5
                      ? <span className="bad">{t('ينقص', 'Short by')} <span className="ltr">{usd(-diff)}</span></span>
                      : diff > 0.5 ? <span>{t('لم يُعطَ لخطوط بعد', 'Not yet given to lines')} <span className="ltr">{usd(diff)}</span></span>
                      : <span className="ok">✓ {t('مطابق', 'Matches')}</span>}
                  </td>
                  <td className="n">{fmtUsd(spentOf(f.id))}</td>
                  {mayFund && <td className="right"><button className="btn small" onClick={() => setGiving(f.id)}>{t('أعطه خطوطاً…', 'Give it lines…')}</button></td>}
                </tr>
              );
            })}
            <tr className="group">
              <td><b className="bad">{t('غير ممول', 'Not funded')}</b></td>
              <td /><td />
              <td className="n"><b>{fmtUsd(notFunded)}</b></td>
              <td /><td className="n">{fmtUsd(spentOf(NOFUND))}</td>
              {mayFund && <td />}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">{t('مال المنحة هنا = حصة هذا المركز في صفحة المنح (اليورو بسعر الموازنة). المشروع الخاص بلا مبلغ محدد.', "A grant's money here = this centre's share on the Grants page (euros at the budget's rate). A private project has no set amount.")}</p>
      {giving != null && <GiveLines b={b} fundId={giving} onClose={() => setGiving(null)} onDone={async () => { setGiving(null); await reload(); }} />}
      {!mayFund && <p className="muted small">{t('يعطي المشاريعَ للخطوط من يحفظ المنح.', 'Projects are given to lines by who keeps the grants.')}</p>}
    </>
  );
}

/** A fund given to whole headings or single lines; a line ticked here leaves its former fund. */
function GiveLines({ b, fundId, onClose, onDone }: { b: BudgetPayload; fundId: number; onClose: () => void; onDone: () => Promise<void> }) {
  const { d } = useApp();
  const give = useGiveFund(b.current!.id, b.budget!);
  const fundName = useFundName();
  const fund = new Map(b.amounts.map((x) => [x.line_id, x.account_id]));
  const amount = new Map(b.amounts.map((x) => [x.line_id, x.amount_usd]));
  const [pick, setPick] = useState<Set<number>>(() => new Set(b.amounts.filter((x) => x.account_id === fundId).map((x) => x.line_id)));
  const headings = d.lists.headings.filter((h) => b.amounts.some((x) => d.lists.lines.find((l) => l.id === x.line_id)?.heading_id === h.id));
  const linesOf = (hid: number) => d.lists.lines.filter((l) => l.heading_id === hid && amount.has(l.id));
  const toggle = (ids: number[], on: boolean) => {
    const n = new Set(pick);
    for (const id of ids) if (on) n.add(id); else n.delete(id);
    setPick(n);
  };
  const sum = [...pick].reduce((x, id) => x + (amount.get(id) ?? 0), 0);
  const go = async () => {
    try {
      const was = b.amounts.filter((x) => x.account_id === fundId).map((x) => x.line_id);
      const add = [...pick].filter((id) => fund.get(id) !== fundId);
      const drop = was.filter((id) => !pick.has(id));
      if (add.length && !(await give(add, fundId))) return;
      if (drop.length && !(await give(drop, null))) return;
      toast(t('حُفظ', 'Saved'));
      await onDone();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <Modal title={t(`خطوط «${fundName(fundId)}»`, `Lines of "${fundName(fundId)}"`)} onClose={onClose}>
      <p className="muted small">{t('اختر بنوداً كاملة أو خطوطاً. الخط له مشروع واحد: إن كان لمشروع آخر ينتقل إلى هذا.', 'Tick whole headings or single lines. A line has one project: if it belongs to another project, it moves to this one.')}</p>
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="t">
          <tbody>
            {headings.map((h) => {
              const ls = linesOf(h.id);
              const all = ls.every((l) => pick.has(l.id));
              return [
                <tr key={`h${h.id}`} className="group">
                  <td><input type="checkbox" checked={all} onChange={(e) => toggle(ls.map((l) => l.id), e.target.checked)} /></td>
                  <td><b>{catIcon(h.name)} {h.name}</b></td>
                  <td className="n"><b>{fmtUsd(ls.reduce((x, l) => x + (amount.get(l.id) ?? 0), 0))}</b></td>
                  <td />
                </tr>,
                ...ls.map((l) => {
                  const f = fund.get(l.id)!;
                  return (
                    <tr key={l.id}>
                      <td style={{ paddingInlineStart: 22 }}><input type="checkbox" checked={pick.has(l.id)} onChange={(e) => toggle([l.id], e.target.checked)} /></td>
                      <td>{l.name}</td>
                      <td className="n">{fmtUsd(amount.get(l.id) ?? 0)}</td>
                      <td className={`small ${f === NOFUND ? 'bad' : f === fundId ? 'ok' : 'muted'}`}>{fundName(f)}</td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="modal-foot">
        <span className="muted small" style={{ flex: 1 }}>{t('المجموع', 'Total')}: <b className="ltr">{usd(sum)}</b></span>
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" onClick={go}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}
