// HR stage 2 (Fouad, 30 October 2026): the salary scale, the pay of each person, the hours worked.
// Everything here needs the permission 'hr.pay'. The rules of the calculation are in pay.ts.
import { nowIso, one } from '../db/db';
import { auditStmt, UserError } from '../db/repo';
import { has } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import { DEFAULT_PAY, type PaySettings } from './pay';

export interface HrGrade { id: number; name: string; sort: number; note: string | null; active: number; rates: Record<number, number> }
export interface HrPay { id: number; person_id: number; valid_from: string; grade_id: number | null; weekly_hours: number | null; monthly_usd: number | null; note: string | null }
export interface HrHours { id: number; person_id: number; ym: string; hours: number; note: string | null }
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
  return { paymentsPerYear: get('hr_payments_per_year', DEFAULT_PAY.paymentsPerYear), roundTo: get('hr_round_to', DEFAULT_PAY.roundTo), maxWeekly: get('hr_max_weekly', DEFAULT_PAY.maxWeekly) };
}

export async function payData(c: OpCtx): Promise<HrPayData> {
  const grades = await c.db.query<Omit<HrGrade, 'rates'>>('SELECT id, name, sort, note, active FROM hr_grade ORDER BY sort, id');
  const rates = await c.db.query<{ grade_id: number; year: number; hourly_usd: number }>('SELECT * FROM hr_grade_rate');
  return {
    grades: grades.map((g) => ({ ...g, rates: Object.fromEntries(rates.filter((r) => r.grade_id === g.id).map((r) => [r.year, r.hourly_usd])) })),
    pays: await c.db.query<HrPay>('SELECT id, person_id, valid_from, grade_id, weekly_hours, monthly_usd, note FROM hr_pay WHERE deleted_at IS NULL ORDER BY person_id, valid_from'),
    hours: await c.db.query<HrHours>('SELECT id, person_id, ym, hours, note FROM hr_hours ORDER BY ym DESC, person_id'),
    settings: await settingsOf(c),
  };
}

export const HR_PAY_OPS = {
  'hr.pay.data': { check: needPay, run: (c: OpCtx) => payData(c) },

  'hr.grade.save': {
    check: needPay,
    run: async (c: OpCtx, a: { id?: number | null; name: string; note?: string | null; rates: Record<string, number | null> }) => {
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب اسم الدرجة', 'Write the name of the grade', 'Écrivez le nom du grade'));
      const stmts = [];
      let id = a.id ?? null;
      if (id) stmts.push({ sql: 'UPDATE hr_grade SET name = ?, note = ? WHERE id = ?', params: [name, txt(a.note), id] });
      else {
        const next = ((await one<{ s: number | null }>(c.db, 'SELECT MAX(sort) AS s FROM hr_grade'))?.s ?? 0) + 1;
        await c.db.batch([{ sql: 'INSERT INTO hr_grade (name, sort, note) VALUES (?,?,?)', params: [name, next, txt(a.note)] }]);
        id = (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_grade'))!.id;
      }
      for (const [year, rate] of Object.entries(a.rates ?? {})) {
        const y = Number(year), r = num(rate);
        if (!(y >= 2000 && y <= 2100)) throw new UserError(m('سنة غير صالحة', 'Not a valid year', 'Année non valide'));
        if (r == null) stmts.push({ sql: 'DELETE FROM hr_grade_rate WHERE grade_id = ? AND year = ?', params: [id, y] });
        else if (!(r > 0)) throw new UserError(m('أجر الساعة يجب أن يكون أكبر من صفر', 'The hourly rate must be above zero', "Le taux horaire doit être supérieur à zéro"));
        else stmts.push({ sql: 'INSERT INTO hr_grade_rate (grade_id, year, hourly_usd) VALUES (?,?,?) ON CONFLICT(grade_id, year) DO UPDATE SET hourly_usd = excluded.hourly_usd', params: [id, y, r] });
      }
      stmts.push(auditStmt(c.who, a.id ? 'update' : 'add', 'hr_grade', String(id), null, { name, rates: a.rates }));
      await c.db.batch(stmts);
      return { id };
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
  // the proposed scale of 30 October 2026 (to edit): four grades, only into an empty scale
  'hr.grade.seed': {
    check: needPay,
    run: async (c: OpCtx, a: { year: number }) => {
      if (await one(c.db, 'SELECT 1 AS x FROM hr_grade')) throw new UserError(m('السلّم غير فارغ', 'The scale is not empty', "L'échelle n'est pas vide"));
      const proposal: [string, string, number][] = [['Grade 1', 'Guard & logistics, Cleaner', 1.15], ['Grade 2', 'Cook', 1.3], ['Grade 3', 'Reception, IT, Workshop Coordinator, Accountant', 1.4], ['Grade 4', 'Centre Director', 1.65]];
      const stmts = [];
      for (const [i, [name, note, rate]] of proposal.entries()) {
        stmts.push({ sql: 'INSERT INTO hr_grade (id, name, sort, note) VALUES (?,?,?,?)', params: [i + 1, name, i + 1, note] });
        stmts.push({ sql: 'INSERT INTO hr_grade_rate (grade_id, year, hourly_usd) VALUES (?,?,?)', params: [i + 1, a.year, rate] });
      }
      await c.db.batch([...stmts, auditStmt(c.who, 'seed', 'hr_grade', null, null, { year: a.year })]);
      return { ok: true };
    },
  },
  'hr.pay.settings': {
    check: needPay,
    run: async (c: OpCtx, a: Partial<PaySettings>) => {
      const cur = await settingsOf(c);
      const s = { ...cur, ...a };
      if (!(s.paymentsPerYear >= 1 && s.paymentsPerYear <= 24) || !(s.roundTo >= 0) || !(s.maxWeekly > 0 && s.maxWeekly <= 84)) throw new UserError(m('قيم غير صالحة', 'Not valid values', 'Valeurs non valides'));
      const put = (k: string, v: number) => ({ sql: 'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', params: [k, String(v)] });
      await c.db.batch([put('hr_payments_per_year', s.paymentsPerYear), put('hr_round_to', s.roundTo), put('hr_max_weekly', s.maxWeekly), auditStmt(c.who, 'update', 'hr_settings', null, cur, s)]);
      return s;
    },
  },

  'hr.pay.save': {
    check: needPay,
    run: async (c: OpCtx, a: { id?: number | null; personId: number; validFrom: string; gradeId?: number | null; weeklyHours?: number | null; monthlyUsd?: number | null; note?: string | null }) => {
      if (!(await one(c.db, 'SELECT 1 AS x FROM hr_person WHERE id = ?', [a.personId]))) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      const from = date(a.validFrom);
      const weekly = num(a.weeklyHours), monthly = num(a.monthlyUsd), grade = a.gradeId ?? null;
      if (weekly != null && !(weekly > 0 && weekly <= 84)) throw new UserError(m('ساعات الأسبوع غير صالحة', 'Not valid weekly hours', 'Heures par semaine non valides'));
      if (monthly != null && !(monthly >= 0)) throw new UserError(m('مبلغ غير صالح', 'Not a valid amount', 'Montant non valide'));
      if (grade == null && monthly == null) throw new UserError(m('اختر درجة أو اكتب مبلغاً شهرياً', 'Choose a grade or write a monthly amount', 'Choisissez un grade ou écrivez un montant mensuel'));
      if (grade != null && !(await one(c.db, 'SELECT 1 AS x FROM hr_grade WHERE id = ?', [grade]))) throw new UserError(m('درجة غير موجودة', 'Grade not found', 'Grade introuvable'));
      if (grade != null && monthly == null && weekly == null) throw new UserError(m('اكتب ساعات الأسبوع', 'Write the weekly hours', 'Écrivez les heures par semaine'));
      const v = [a.personId, from, grade, weekly, monthly, txt(a.note)];
      if (a.id) {
        await c.db.batch([{ sql: 'UPDATE hr_pay SET person_id=?, valid_from=?, grade_id=?, weekly_hours=?, monthly_usd=?, note=? WHERE id = ? AND deleted_at IS NULL', params: [...v, a.id] }, auditStmt(c.who, 'update', 'hr_pay', String(a.id), null, { person: a.personId, from })]);
        return { id: a.id };
      }
      await c.db.batch([{ sql: 'INSERT INTO hr_pay (person_id, valid_from, grade_id, weekly_hours, monthly_usd, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)', params: [...v, nowIso(), c.who] }, auditStmt(c.who, 'add', 'hr_pay', null, null, { person: a.personId, from })]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_pay'))!.id };
    },
  },
  'hr.pay.delete': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
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
export const HR_PAY_READ_ONLY = ['hr.pay.data'];
