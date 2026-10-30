// HR stage 3 (Fouad, 30 October 2026): payroll runs. A run is the stipends of one month, or the 13th payment
// (a bonus instead of social security). One person prepares it (hr.pay), the Superior approves it (hr.approve)
// and marks it paid. Accounts only ever receives totals: see 'hr.run.voucher' (no names, no individual amounts).
import { nowIso, one } from '../db/db';
import { auditStmt, UserError } from '../db/repo';
import { has } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import { payData } from './payOps';
import { payOn } from './pay';
import { allocOn, splitAmount, type HrAlloc } from './stage4';

export interface HrRun { id: number; ym: string; kind: 'monthly' | 'thirteenth'; rate_syp: number; status: 'draft' | 'approved' | 'paid'; note: string | null; created_by: string | null; approved_at: string | null; approved_by: string | null; paid_on: string | null; paid_by: string | null; lines: number; total_usd: number }
export interface HrRunLine { id: number; run_id: number; person_id: number; person_name: string; national_id: string | null; role: string | null; label: string | null; paper_id: number | null; weekly_hours: number | null; hours_worked: number | null; base_usd: number; bonus_usd: number; deduction_usd: number; total_usd: number; paid_in: 'USD' | 'SYP'; amount_paid: number; account: string | null; budget_line: string | null; note: string | null }
export interface HrVoucherRow { account: string | null; budget_line: string | null; target: string | null; paid_in: 'USD' | 'SYP'; total_usd: number; amount_paid: number }

const SYP_STEP = 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
const needPay = (c: OpCtx) => { if (!has(c.profile, 'hr.pay')) throw refuse(); };
const needApprove = (c: OpCtx) => { if (!has(c.profile, 'hr.approve')) throw refuse(); };
const txt = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim());
const num = (x: unknown) => (x == null || x === '' ? 0 : Number(x));
const lastDay = (ym: string) => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

/** total in dollars, and what is handed over in the currency it is paid in (the pound rounded to 1,000, unless exact) */
export function lineAmounts(base: number, bonus: number, deduction: number, paidIn: 'USD' | 'SYP', rate: number, exact = false) {
  const total = r2(base + bonus - deduction);
  const paid = paidIn === 'USD' ? total : exact ? Math.round(total * rate) : Math.round((total * rate) / SYP_STEP) * SYP_STEP;
  return { total, paid };
}

async function runOf(c: OpCtx, id: number) {
  const r = await one<HrRun>(c.db, 'SELECT * FROM hr_run WHERE id = ?', [id]);
  if (!r) throw new UserError(m('الكشف غير موجود', 'Run not found', 'Paie introuvable'));
  return r;
}
const needDraft = (r: HrRun) => {
  if (r.status !== 'draft') throw new UserError(m('الكشف معتمد: أعد فتحه أولاً', 'This run is approved: reopen it first', 'Cette paie est approuvée : rouvrez-la d’abord'));
};

export const HR_RUN_OPS = {
  'hr.run.list': {
    check: needPay,
    run: (c: OpCtx) => c.db.query<HrRun>('SELECT r.*, (SELECT COUNT(*) FROM hr_run_line l WHERE l.run_id = r.id) AS lines, (SELECT COALESCE(SUM(total_usd), 0) FROM hr_run_line l WHERE l.run_id = r.id) AS total_usd FROM hr_run r ORDER BY ym DESC, kind'),
  },
  'hr.run.get': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
      const run = await runOf(c, a.id);
      const lines = await c.db.query<HrRunLine>('SELECT l.*, p.name AS person_name, p.national_id, p.role FROM hr_run_line l JOIN hr_person p ON p.id = l.person_id WHERE l.run_id = ? ORDER BY p.name, l.id', [a.id]);
      // the centres whose accounts already received it
      const sent = await c.db.query<{ centre: string; sent_at: string; sent_by: string | null; total_usd: number }>('SELECT centre, sent_at, sent_by, total_usd FROM hr_run_sent WHERE run_id = ?', [a.id]);
      return { run, lines, sent };
    },
  },

  'hr.run.create': {
    check: needPay,
    run: async (c: OpCtx, a: { ym: string; kind: 'monthly' | 'thirteenth'; rateSyp: number; note?: string | null }) => {
      if (!/^\d{4}-\d{2}$/.test(a.ym ?? '')) throw new UserError(m('شهر غير صالح', 'Not a valid month', 'Mois non valide'));
      if (a.kind !== 'monthly' && a.kind !== 'thirteenth') throw new UserError(m('نوع غير معروف', 'Unknown kind', 'Type inconnu'));
      const rate = Number(a.rateSyp);
      if (!(rate > 0)) throw new UserError(m('اكتب سعر الدولار بالليرة', 'Write the dollar rate in pounds', 'Écrivez le taux du dollar en livres'));
      if (await one(c.db, 'SELECT 1 AS x FROM hr_run WHERE ym = ? AND kind = ?', [a.ym, a.kind])) throw new UserError(m('يوجد كشف لهذا الشهر', 'There is already a run for this month', 'Il y a déjà une paie pour ce mois'));
      const d = await payData(c);
      const first = `${a.ym}-01`, last = lastDay(a.ym);
      const people = await c.db.query<{ id: number; account: string | null; budget_line: string | null }>('SELECT id, account, budget_line FROM hr_person WHERE (started IS NULL OR started <= ?) AND (ended IS NULL OR ended >= ?) ORDER BY name', [last, first]);
      const hours = await c.db.query<{ person_id: number; hours: number }>('SELECT person_id, hours FROM hr_hours WHERE ym = ?', [a.ym]);
      const stmts = [{ sql: 'INSERT INTO hr_run (ym, kind, rate_syp, note, created_at, created_by) VALUES (?,?,?,?,?,?)', params: [a.ym, a.kind, rate, txt(a.note), nowIso(), c.who] }];
      await c.db.batch([...stmts]);
      const runId = (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_run'))!.id;
      const lines = [];
      const skipped: number[] = [];
      for (const p of people) {
        const cur = payOn(d, p.id, last);
        if (!cur || cur.monthly == null || cur.monthly <= 0) { skipped.push(p.id); continue; }
        const { total, paid } = lineAmounts(cur.monthly, 0, 0, 'USD', rate);
        lines.push({ sql: 'INSERT INTO hr_run_line (run_id, person_id, label, weekly_hours, hours_worked, base_usd, total_usd, paid_in, amount_paid, account, budget_line) VALUES (?,?,?,?,?,?,?,?,?,?,?)', params: [runId, p.id, a.kind === 'thirteenth' ? '13th payment' : null, cur.weekly, hours.find((h) => h.person_id === p.id)?.hours ?? null, cur.monthly, total, 'USD', paid, p.account, p.budget_line] });
      }
      // the one-time stipend letters paid this month and not yet in a run
      if (a.kind === 'monthly') {
        const letters = await c.db.query<{ id: number; person_id: number; service: string | null; amount: number; currency: 'USD' | 'SYP'; account: string | null; budget_line: string | null }>(
          `SELECT s.id, s.person_id, s.service, s.amount, s.currency, p.account, p.budget_line FROM hr_paper s JOIN hr_person p ON p.id = s.person_id
            WHERE s.kind = 'stipend' AND s.deleted_at IS NULL AND s.amount IS NOT NULL AND s.paid_on >= ? AND s.paid_on <= ? AND s.id NOT IN (SELECT paper_id FROM hr_run_line WHERE paper_id IS NOT NULL)`, [first, last]);
        for (const s of letters) {
          const usd = s.currency === 'USD' ? s.amount : r2(s.amount / rate);
          lines.push({ sql: 'INSERT INTO hr_run_line (run_id, person_id, label, paper_id, base_usd, total_usd, paid_in, amount_paid, account, budget_line) VALUES (?,?,?,?,?,?,?,?,?,?)', params: [runId, s.person_id, `Stipend: ${s.service ?? ''}`, s.id, usd, usd, s.currency, s.amount, s.account, s.budget_line] });
        }
      }
      await c.db.batch([...lines, auditStmt(c.who, 'add', 'hr_run', String(runId), null, { ym: a.ym, kind: a.kind, lines: lines.length })]);
      return { id: runId, skipped };
    },
  },

  'hr.run.line.save': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number; baseUsd?: number; bonusUsd?: number; deductionUsd?: number; hoursWorked?: number | null; paidIn?: 'USD' | 'SYP'; note?: string | null }) => {
      const l = await one<HrRunLine>(c.db, 'SELECT * FROM hr_run_line WHERE id = ?', [a.id]);
      if (!l) throw new UserError(m('السطر غير موجود', 'Line not found', 'Ligne introuvable'));
      const run = await runOf(c, l.run_id);
      needDraft(run);
      const base = a.baseUsd != null ? num(a.baseUsd) : l.base_usd, bonus = a.bonusUsd != null ? num(a.bonusUsd) : l.bonus_usd, ded = a.deductionUsd != null ? num(a.deductionUsd) : l.deduction_usd;
      if (base < 0 || bonus < 0 || ded < 0) throw new UserError(m('مبلغ غير صالح', 'Not a valid amount', 'Montant non valide'));
      const paidIn = a.paidIn === 'SYP' ? 'SYP' : a.paidIn === 'USD' ? 'USD' : l.paid_in;
      const { total, paid } = lineAmounts(base, bonus, ded, paidIn, run.rate_syp, !!l.paper_id);
      await c.db.batch([
        { sql: 'UPDATE hr_run_line SET base_usd=?, bonus_usd=?, deduction_usd=?, total_usd=?, paid_in=?, amount_paid=?, hours_worked=?, note=? WHERE id=?', params: [base, bonus, ded, total, paidIn, paid, a.hoursWorked === undefined ? l.hours_worked : a.hoursWorked, a.note === undefined ? l.note : txt(a.note), a.id] },
        auditStmt(c.who, 'update', 'hr_run_line', String(a.id), { total: l.total_usd }, { total }),
      ]);
      return { total, paid };
    },
  },
  // an occasional bonus (or any other line) for a person
  'hr.run.line.add': {
    check: needPay,
    run: async (c: OpCtx, a: { runId: number; personId: number; label: string; baseUsd?: number; bonusUsd?: number }) => {
      const run = await runOf(c, a.runId);
      needDraft(run);
      const p = await one<{ account: string | null; budget_line: string | null }>(c.db, 'SELECT account, budget_line FROM hr_person WHERE id = ?', [a.personId]);
      if (!p) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      const label = txt(a.label);
      if (!label) throw new UserError(m('اكتب سبب السطر', 'Write what the line is for', 'Écrivez à quoi sert la ligne'));
      const base = num(a.baseUsd), bonus = num(a.bonusUsd);
      if (base < 0 || bonus < 0) throw new UserError(m('مبلغ غير صالح', 'Not a valid amount', 'Montant non valide'));
      const { total, paid } = lineAmounts(base, bonus, 0, 'USD', run.rate_syp);
      await c.db.batch([{ sql: 'INSERT INTO hr_run_line (run_id, person_id, label, base_usd, bonus_usd, total_usd, paid_in, amount_paid, account, budget_line) VALUES (?,?,?,?,?,?,?,?,?,?)', params: [a.runId, a.personId, label, base, bonus, total, 'USD', paid, p.account, p.budget_line] }, auditStmt(c.who, 'add', 'hr_run_line', null, null, { run: a.runId, person: a.personId, total })]);
      return { ok: true };
    },
  },
  'hr.run.line.delete': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
      const l = await one<{ run_id: number }>(c.db, 'SELECT run_id FROM hr_run_line WHERE id = ?', [a.id]);
      if (!l) throw new UserError(m('السطر غير موجود', 'Line not found', 'Ligne introuvable'));
      needDraft(await runOf(c, l.run_id));
      await c.db.batch([{ sql: 'DELETE FROM hr_run_line WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'hr_run_line', String(a.id), null, null)]);
      return { ok: true };
    },
  },

  'hr.run.approve': {
    check: needApprove,
    run: async (c: OpCtx, a: { id: number }) => {
      const run = await runOf(c, a.id);
      needDraft(run);
      if (!(await one(c.db, 'SELECT 1 AS x FROM hr_run_line WHERE run_id = ?', [a.id]))) throw new UserError(m('الكشف فارغ', 'The run is empty', 'La paie est vide'));
      await c.db.batch([{ sql: "UPDATE hr_run SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ?", params: [nowIso(), c.who, a.id] }, auditStmt(c.who, 'approve', 'hr_run', String(a.id), null, null)]);
      return { ok: true };
    },
  },
  'hr.run.reopen': {
    check: needApprove,
    run: async (c: OpCtx, a: { id: number }) => {
      const run = await runOf(c, a.id);
      if (run.status === 'paid') throw new UserError(m('الكشف مدفوع ولا يُعاد فتحه', 'This run is paid and cannot be reopened', 'Cette paie est payée et ne peut pas être rouverte'));
      if (await one(c.db, 'SELECT 1 AS x FROM hr_run_sent WHERE run_id = ?', [a.id])) throw new UserError(m('أُرسل إلى الحسابات: اسحبه أولاً', 'It was sent to the accounts: take it back first', "Elle a été envoyée à la comptabilité : reprenez-la d'abord"));
      await c.db.batch([{ sql: "UPDATE hr_run SET status = 'draft', approved_at = NULL, approved_by = NULL WHERE id = ?", params: [a.id] }, auditStmt(c.who, 'reopen', 'hr_run', String(a.id), null, null)]);
      return { ok: true };
    },
  },
  'hr.run.paid': {
    check: needApprove,
    run: async (c: OpCtx, a: { id: number; paidOn: string }) => {
      const run = await runOf(c, a.id);
      if (run.status !== 'approved') throw new UserError(m('يجب اعتماد الكشف أولاً', 'Approve the run first', "Approuvez d'abord la paie"));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.paidOn ?? '')) throw new UserError(m('تاريخ غير صالح', 'Not a valid date', 'Date non valide'));
      await c.db.batch([{ sql: "UPDATE hr_run SET status = 'paid', paid_on = ?, paid_by = ? WHERE id = ?", params: [a.paidOn, c.who, a.id] }, auditStmt(c.who, 'paid', 'hr_run', String(a.id), null, { paid_on: a.paidOn })]);
      return { ok: true };
    },
  },
  'hr.run.delete': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
      needDraft(await runOf(c, a.id));
      await c.db.batch([{ sql: 'DELETE FROM hr_run_line WHERE run_id = ?', params: [a.id] }, { sql: 'DELETE FROM hr_run WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'hr_run', String(a.id), null, null)]);
      return { ok: true };
    },
  },

  // what Accounts receives: totals only, by account and budget line and currency; never a name
  'hr.run.voucher': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
      const run = await runOf(c, a.id);
      if (run.status === 'draft') throw new UserError(m('اعتمد الكشف أولاً', 'Approve the run first', "Approuvez d'abord la paie"));
      // each line is split by the donor or project percentages of its person (on the last day of the month); totals only
      const lines = await c.db.query<{ person_id: number; account: string | null; budget_line: string | null; paid_in: 'USD' | 'SYP'; total_usd: number; amount_paid: number }>('SELECT person_id, account, budget_line, paid_in, total_usd, amount_paid FROM hr_run_line WHERE run_id = ?', [a.id]);
      const allocs = await c.db.query<HrAlloc>('SELECT person_id, valid_from, target, pct FROM hr_alloc');
      const acc = new Map<string, HrVoucherRow>();
      for (const l of lines) {
        const parts = allocOn(allocs, l.person_id, lastDay(run.ym));
        const usds = parts.length ? splitAmount(l.total_usd, parts) : [l.total_usd];
        const paids = parts.length ? splitAmount(l.amount_paid, parts, l.paid_in === 'SYP' ? 0 : 2) : [l.amount_paid];
        (parts.length ? parts.map((p) => p.target) : [null]).forEach((target, i) => {
          const key = JSON.stringify([l.account, l.budget_line, target, l.paid_in]);
          const row = acc.get(key) ?? { account: l.account, budget_line: l.budget_line, target, paid_in: l.paid_in, total_usd: 0, amount_paid: 0 };
          row.total_usd = r2(row.total_usd + usds[i]);
          row.amount_paid = r2(row.amount_paid + paids[i]);
          acc.set(key, row);
        });
      }
      const key = (x: string | null) => x ?? '';
      const rows = [...acc.values()].sort((p, q) => key(p.account).localeCompare(key(q.account)) || key(p.budget_line).localeCompare(key(q.budget_line)) || key(p.target).localeCompare(key(q.target)) || p.paid_in.localeCompare(q.paid_in));
      return { run: { id: run.id, ym: run.ym, kind: run.kind, rate_syp: run.rate_syp, status: run.status, approved_by: run.approved_by, paid_on: run.paid_on }, rows, total_usd: r2(rows.reduce((s, r) => s + r.total_usd, 0)) };
    },
  },
};
export const HR_RUN_READ_ONLY = ['hr.run.list', 'hr.run.get', 'hr.run.voucher'];
