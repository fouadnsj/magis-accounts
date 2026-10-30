// HR stage 2 (Fouad, 30 October 2026): the salary scale, the pay of each person, the hours worked.
// Everything here needs the permission 'hr.pay'. The rules of the calculation are in pay.ts.
import { nowIso, one } from '../db/db';
import { auditStmt, UserError } from '../db/repo';
import { has } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import { DEFAULT_PAY, payOn, type PaySettings } from './pay';

export interface HrGrade { id: number; name: string; name_ar: string | null; sort: number; note: string | null; active: number; monthly_usd: number | null }
export interface HrPay { id: number; person_id: number; valid_from: string; grade_id: number | null; weekly_hours: number | null; monthly_usd: number | null; monthly_syp: number | null; note: string | null; paper_id: number | null }
export interface HrHours { id: number; person_id: number; ym: string; hours: number; note: string | null }
/** a line of the staff list for the budget (the columns of Fouad's salary sheet): no names */
export interface HrBudgetRow { centre: string | null; position: string; monthly: number; months: number; people: number; times: number; total: number }
export interface HrPayData { grades: HrGrade[]; pays: HrPay[]; hours: HrHours[]; settings: PaySettings }

const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
const needPay = (c: OpCtx) => { if (!has(c.profile, 'hr.pay')) throw refuse(); };
const txt = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim());
const num = (x: unknown) => (x == null || x === '' ? null : Number(x));
const date = (x: unknown) => {
  const s = txt(x);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UserError(m('تاريخ غير صالح', 'Not a valid date', 'Date non valide'));
  return s;
};

async function settingsOf(c: OpCtx): Promise<PaySettings> {
  const rows = await c.db.query<{ key: string; value: string | null }>("SELECT key, value FROM setting WHERE key LIKE 'hr_%'");
  const get = (k: string, d: number) => { const v = Number(rows.find((r) => r.key === k)?.value); return Number.isFinite(v) && v >= 0 ? v : d; };
  // the dollar rate: written in the settings, else the one of the last payroll run
  const last = (await one<{ r: number }>(c.db, 'SELECT rate_syp AS r FROM hr_run ORDER BY ym DESC, id DESC LIMIT 1'))?.r ?? 0;
  return { paymentsPerYear: get('hr_payments_per_year', DEFAULT_PAY.paymentsPerYear), roundTo: get('hr_round_to', DEFAULT_PAY.roundTo), maxWeekly: get('hr_max_weekly', DEFAULT_PAY.maxWeekly), rateSyp: get('hr_rate_syp', 0) || last };
}

export async function payData(c: OpCtx): Promise<HrPayData> {
  return {
    grades: await c.db.query<HrGrade>('SELECT id, name, name_ar, sort, note, active, monthly_usd FROM hr_grade ORDER BY sort, id'),
    pays: await c.db.query<HrPay>('SELECT id, person_id, valid_from, grade_id, weekly_hours, monthly_usd, monthly_syp, note, paper_id FROM hr_pay WHERE deleted_at IS NULL ORDER BY person_id, valid_from, id'),
    hours: await c.db.query<HrHours>('SELECT id, person_id, ym, hours, note FROM hr_hours ORDER BY ym DESC, person_id'),
    settings: await settingsOf(c),
  };
}

/**
 * HR makes the staff list, finance puts it in the budget (Fouad, 30 October 2026). For a year: each person's stipend
 * month by month (from the agreements and the changes), grouped by centre, position and monthly amount, as in the
 * salary sheet: quantity of people, times a year (the months, and the 13th payment in proportion), total. No names.
 */
export async function budgetStaff(c: OpCtx, year: number): Promise<{ rows: HrBudgetRow[]; paymentsPerYear: number; /** people agreed in pounds, left out because the dollar rate is not known */ needRate: number }> {
  const d = await payData(c);
  const people = await c.db.query<{ id: number; centre: string | null; role: string | null; started: string | null; ended: string | null }>('SELECT id, centre, role, started, ended FROM hr_person');
  const per = d.settings.paymentsPerYear;
  const groups = new Map<string, HrBudgetRow & { ids: Set<number> }>();
  const unpriced = new Set<number>();
  for (const p of people) {
    // the months of the year this person is paid, and how much each month
    const months = new Map<number, number>();
    for (let mth = 1; mth <= 12; mth++) {
      const first = `${year}-${String(mth).padStart(2, '0')}-01`;
      const last = `${year}-${String(mth).padStart(2, '0')}-${String(new Date(Date.UTC(year, mth, 0)).getUTCDate()).padStart(2, '0')}`;
      if ((p.started && p.started > last) || (p.ended && p.ended < first)) continue;
      const now = payOn(d, p.id, last);
      if (now?.monthly) months.set(mth, now.monthly);
      else if (now?.needsRate) unpriced.add(p.id);
    }
    const byAmount = new Map<number, number>();
    for (const v of months.values()) byAmount.set(v, (byAmount.get(v) ?? 0) + 1);
    for (const [monthly, n] of byAmount) {
      const position = payOn(d, p.id, `${year}-12-31`)?.grade?.name ?? p.role ?? '—';
      const key = JSON.stringify([p.centre, position, monthly, n]);
      const g = groups.get(key) ?? { centre: p.centre, position, monthly, months: n, people: 0, times: Math.round(((n * per) / 12) * 100) / 100, total: 0, ids: new Set<number>() };
      g.ids.add(p.id);
      g.people = g.ids.size;
      g.total = Math.round(g.people * g.times * monthly * 100) / 100;
      groups.set(key, g);
    }
  }
  const rows = [...groups.values()].map(({ ids: _ids, ...r }) => r).sort((a, b) => (a.centre ?? '').localeCompare(b.centre ?? '') || b.monthly - a.monthly || a.position.localeCompare(b.position));
  return { rows, paymentsPerYear: per, needRate: unpriced.size };
}

export const HR_PAY_OPS = {
  'hr.budget.staff': { check: needPay, run: (c: OpCtx, a: { year: number }) => budgetStaff(c, Number(a.year)) },

  'hr.pay.data': { check: needPay, run: (c: OpCtx) => payData(c) },

  // a position of the scale and its reference monthly amount (a suggestion when an agreement is made)
  'hr.grade.save': {
    check: needPay,
    run: async (c: OpCtx, a: { id?: number | null; name: string; nameAr?: string | null; note?: string | null; monthlyUsd?: number | null }) => {
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب اسم الوظيفة', 'Write the name of the position', 'Écrivez le nom du poste'));
      const amount = num(a.monthlyUsd);
      if (amount != null && !(amount > 0)) throw new UserError(m('المبلغ الشهري يجب أن يكون أكبر من صفر', 'The monthly amount must be above zero', 'Le montant mensuel doit être supérieur à zéro'));
      if (await one(c.db, 'SELECT 1 AS x FROM hr_grade WHERE name = ? AND id IS NOT ?', [name, a.id ?? null])) throw new UserError(m('هذه الوظيفة موجودة', 'This position exists already', 'Ce poste existe déjà'));
      if (a.id) {
        const before = await one<{ name: string }>(c.db, 'SELECT name FROM hr_grade WHERE id = ?', [a.id]);
        await c.db.batch([
          { sql: 'UPDATE hr_grade SET name = ?, name_ar = ?, note = ?, monthly_usd = ? WHERE id = ?', params: [name, txt(a.nameAr), txt(a.note), amount, a.id] },
          // a renamed position keeps its people
          ...(before && before.name !== name ? [{ sql: 'UPDATE hr_person SET role = ? WHERE role = ?', params: [name, before.name] }, { sql: 'UPDATE hr_paper SET position = ? WHERE position = ?', params: [name, before.name] }] : []),
          auditStmt(c.who, 'update', 'hr_grade', String(a.id), before, { name, monthly: amount }),
        ]);
        return { id: a.id };
      }
      const next = ((await one<{ s: number | null }>(c.db, 'SELECT MAX(sort) AS s FROM hr_grade'))?.s ?? 0) + 1;
      await c.db.batch([{ sql: 'INSERT INTO hr_grade (name, name_ar, sort, note, monthly_usd) VALUES (?,?,?,?,?)', params: [name, txt(a.nameAr), next, txt(a.note), amount] }, auditStmt(c.who, 'add', 'hr_grade', null, null, { name, monthly: amount })]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_grade'))!.id };
    },
  },
  'hr.grade.delete': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
      if (await one(c.db, 'SELECT 1 AS x FROM hr_pay WHERE grade_id = ? AND deleted_at IS NULL', [a.id])) throw new UserError(m('درجة مستعملة: غيّر رواتب من يستعملونها أولاً', 'This grade is in use: change the pay of the people on it first', 'Grade utilisé : changez d’abord la paie des personnes concernées'));
      await c.db.batch([{ sql: 'DELETE FROM hr_grade_rate WHERE grade_id = ?', params: [a.id] }, { sql: 'DELETE FROM hr_grade WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'hr_grade', String(a.id), null, null)]);
      return { ok: true };
    },
  },
  // the scale taken from Fouad's own sheet "Salary scale": the positions and the monthly amount planned for 2027 (and the two posts of the 2027 budgets) (the
  // agreements of January 2027 start from it); only into an empty scale
  'hr.grade.seed': {
    check: needPay,
    run: async (c: OpCtx) => {
      if (await one(c.db, 'SELECT 1 AS x FROM hr_grade')) throw new UserError(m('السلّم غير فارغ', 'The scale is not empty', "L'échelle n'est pas vide"));
      const sheet: [string, number, string, string][] = [
        ['Centre Director', 300, '7 h a day', 'مدير المركز'], ['Workshop Coordinator', 250, '7 h a day', 'منسق الورشات'], ['Guard & logistics', 230, '8 h a day', 'حارس ولوجستيات'], ['Accountant', 250, '', 'محاسب'],
        ['Reception', 180, '5 h a day', 'استقبال'], ['IT', 180, '5 h a day', 'تقنية المعلومات'], ['Cleaner', 180, '6 h a day', 'عامل نظافة'], ['Cook', 200, '6 h a day', 'طباخ'],
        // in the 2027 budgets (Magis budget folder), not in the salary sheet
        ['Academic Coordinator', 250, '2027 budget', 'منسق أكاديمي'], ['Media', 200, '2027 budget', 'إعلام'],
      ];
      await c.db.batch([
        ...sheet.map(([name, amount, note, ar], i) => ({ sql: 'INSERT INTO hr_grade (id, name, name_ar, sort, monthly_usd, note) VALUES (?,?,?,?,?,?)', params: [i + 1, name, ar, i + 1, amount, note || null] })),
        auditStmt(c.who, 'seed', 'hr_grade', null, null, { from: 'Salary scale sheet, 2027 column' }),
      ]);
      return { ok: true };
    },
  },
  'hr.pay.settings': {
    check: needPay,
    run: async (c: OpCtx, a: Partial<PaySettings>) => {
      const cur = await settingsOf(c);
      const s = { ...cur, ...a };
      if (!(s.paymentsPerYear >= 1 && s.paymentsPerYear <= 24) || !(s.roundTo >= 0) || !(s.maxWeekly > 0 && s.maxWeekly <= 84) || !(s.rateSyp >= 0)) throw new UserError(m('قيم غير صالحة', 'Not valid values', 'Valeurs non valides'));
      const put = (k: string, v: number) => ({ sql: 'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', params: [k, String(v)] });
      await c.db.batch([put('hr_payments_per_year', s.paymentsPerYear), put('hr_round_to', s.roundTo), put('hr_max_weekly', s.maxWeekly), put('hr_rate_syp', s.rateSyp), auditStmt(c.who, 'update', 'hr_settings', null, cur, s)]);
      return s;
    },
  },

  // the stipend changes from a date in the middle of the year (the agreement's line stays as history)
  'hr.pay.save': {
    check: needPay,
    run: async (c: OpCtx, a: { id?: number | null; personId: number; validFrom: string; gradeId?: number | null; weeklyHours?: number | null; monthlyUsd?: number | null; monthlySyp?: number | null; note?: string | null }) => {
      if (!(await one(c.db, 'SELECT 1 AS x FROM hr_person WHERE id = ?', [a.personId]))) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      const from = date(a.validFrom);
      const weekly = num(a.weeklyHours), monthly = num(a.monthlyUsd), grade = a.gradeId ?? null;
      if (weekly != null && !(weekly > 0 && weekly <= 84)) throw new UserError(m('ساعات الأسبوع غير صالحة', 'Not valid weekly hours', 'Heures par semaine non valides'));
      if (monthly != null && !(monthly >= 0)) throw new UserError(m('مبلغ غير صالح', 'Not a valid amount', 'Montant non valide'));
      const syp = num(a.monthlySyp);
      if (syp != null && !(syp > 0)) throw new UserError(m('مبلغ غير صالح', 'Not a valid amount', 'Montant non valide'));
      if (grade == null && monthly == null && syp == null) throw new UserError(m('اكتب المبلغ الشهري', 'Write the monthly amount', 'Écrivez le montant mensuel'));
      if (grade != null && !(await one(c.db, 'SELECT 1 AS x FROM hr_grade WHERE id = ?', [grade]))) throw new UserError(m('وظيفة غير موجودة', 'Position not found', 'Poste introuvable'));
      const v = [a.personId, from, grade, weekly, syp != null ? null : monthly, txt(a.note), syp];
      if (a.id) {
        if ((await one<{ paper_id: number | null }>(c.db, 'SELECT paper_id FROM hr_pay WHERE id = ?', [a.id]))?.paper_id) throw new UserError(m('هذا السطر من الاتفاقية: عدّل الاتفاقية', 'This line comes from the agreement: change the agreement', "Cette ligne vient de l'accord : modifiez l'accord"));
        await c.db.batch([{ sql: 'UPDATE hr_pay SET person_id=?, valid_from=?, grade_id=?, weekly_hours=?, monthly_usd=?, note=?, monthly_syp=? WHERE id = ? AND deleted_at IS NULL', params: [...v, a.id] }, auditStmt(c.who, 'update', 'hr_pay', String(a.id), null, { person: a.personId, from })]);
        return { id: a.id };
      }
      await c.db.batch([{ sql: 'INSERT INTO hr_pay (person_id, valid_from, grade_id, weekly_hours, monthly_usd, note, monthly_syp, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)', params: [...v, nowIso(), c.who] }, auditStmt(c.who, 'add', 'hr_pay', null, null, { person: a.personId, from, monthly })]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_pay'))!.id };
    },
  },
  'hr.pay.delete': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
      if ((await one<{ paper_id: number | null }>(c.db, 'SELECT paper_id FROM hr_pay WHERE id = ?', [a.id]))?.paper_id) throw new UserError(m('هذا السطر من الاتفاقية: احذف الاتفاقية أو عدّلها', 'This line comes from the agreement: change or delete the agreement', "Cette ligne vient de l'accord : modifiez ou supprimez l'accord"));
      await c.db.batch([{ sql: 'UPDATE hr_pay SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', params: [nowIso(), a.id] }, auditStmt(c.who, 'delete', 'hr_pay', String(a.id), null, null)]);
      return { ok: true };
    },
  },
  'hr.hours.save': {
    check: needPay,
    run: async (c: OpCtx, a: { personId: number; ym: string; hours: number | null; note?: string | null }) => {
      if (!/^\d{4}-\d{2}$/.test(a.ym ?? '')) throw new UserError(m('شهر غير صالح', 'Not a valid month', 'Mois non valide'));
      if (a.hours == null || (a.hours as unknown) === '') {
        await c.db.batch([{ sql: 'DELETE FROM hr_hours WHERE person_id = ? AND ym = ?', params: [a.personId, a.ym] }]);
        return { ok: true };
      }
      const h = Number(a.hours);
      if (!(h >= 0 && h <= 400)) throw new UserError(m('عدد ساعات غير صالح', 'Not a valid number of hours', "Nombre d'heures non valide"));
      await c.db.batch([
        { sql: 'INSERT INTO hr_hours (person_id, ym, hours, note, updated_at, updated_by) VALUES (?,?,?,?,?,?) ON CONFLICT(person_id, ym) DO UPDATE SET hours = excluded.hours, note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by', params: [a.personId, a.ym, h, txt(a.note), nowIso(), c.who] },
        auditStmt(c.who, 'update', 'hr_hours', `${a.personId}/${a.ym}`, null, { hours: h }),
      ]);
      return { ok: true };
    },
  },
};
export const HR_PAY_READ_ONLY = ['hr.pay.data', 'hr.budget.staff'];
