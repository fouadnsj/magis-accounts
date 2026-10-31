// HR stage 2 (Fouad, 30 October 2026): the salary scale, the pay of each person, the hours worked.
// Everything here needs the permission 'hr.pay'. The rules of the calculation are in pay.ts.
import { nowIso, one } from '../db/db';
import { auditStmt, UserError } from '../db/repo';
import { has } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import { DEFAULT_PAY, payOn, type PaySettings } from './pay';
import { centreCodes, needAll, needCentre, needPerson, sees, seesAll, seenPeople } from './scope';

export interface HrGrade { id: number; name: string; name_ar: string | null; sort: number; note: string | null; active: number; monthly_usd: number | null; /** the centre's code; null = shared by every centre */ centre: string | null }
export interface HrPay { id: number; person_id: number; valid_from: string; grade_id: number | null; weekly_hours: number | null; monthly_usd: number | null; monthly_syp: number | null; note: string | null; paper_id: number | null }
export interface HrHours { id: number; person_id: number; ym: string; hours: number; note: string | null }
/** a line of the staff list for the budget (the columns of Fouad's salary sheet): no names */
export interface HrBudgetRow { centre: string | null; position: string; monthly: number; months: number; people: number; times: number; total: number }
export interface HrPayData { grades: HrGrade[]; pays: HrPay[]; hours: HrHours[]; settings: PaySettings; /** person → the code of their centre */ centreOf: Record<number, string | null> }

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
  // the dollar rate: written in the settings, else the one of the last payroll run; each centre may have its own (written,
  // else its last run's)
  const last = (await one<{ r: number }>(c.db, 'SELECT rate_syp AS r FROM hr_run ORDER BY ym DESC, id DESC LIMIT 1'))?.r ?? 0;
  const rates: Record<string, number> = {};
  for (const code of ['jaramana', 'aleppo', 'homs', 'other']) {
    const own = get(`hr_rate_syp:${code}`, 0) || ((await one<{ r: number }>(c.db, 'SELECT rate_syp AS r FROM hr_run WHERE centre = ? ORDER BY ym DESC, id DESC LIMIT 1', [code]))?.r ?? 0);
    if (own > 0) rates[code] = own;
  }
  return { paymentsPerYear: get('hr_payments_per_year', DEFAULT_PAY.paymentsPerYear), roundTo: get('hr_round_to', DEFAULT_PAY.roundTo), maxWeekly: get('hr_max_weekly', DEFAULT_PAY.maxWeekly), rateSyp: get('hr_rate_syp', 0) || last, rates };
}

export async function payData(c: OpCtx): Promise<HrPayData> {
  // only the user's centres
  const seen = await seenPeople(c);
  const mine = <T extends { person_id: number }>(xs: T[]) => (seen ? xs.filter((x) => seen.has(x.person_id)) : xs);
  const codes = await centreCodes(c);
  const centreOf: Record<number, string | null> = {};
  for (const p of await c.db.query<{ id: number; centre: string | null }>('SELECT id, centre FROM hr_person')) if (!seen || seen.has(p.id)) centreOf[p.id] = p.centre ? codes.get(p.centre) ?? null : null;
  const settings = await settingsOf(c);
  if (!seesAll(c)) settings.rates = Object.fromEntries(Object.entries(settings.rates ?? {}).filter(([k]) => sees(c, k)));
  return {
    grades: (await c.db.query<HrGrade>('SELECT id, name, name_ar, sort, note, active, monthly_usd, centre FROM hr_grade ORDER BY sort, id')).filter((g) => g.centre == null || sees(c, g.centre)),
    pays: mine(await c.db.query<HrPay>('SELECT id, person_id, valid_from, grade_id, weekly_hours, monthly_usd, monthly_syp, note, paper_id FROM hr_pay WHERE deleted_at IS NULL ORDER BY person_id, valid_from, id')),
    hours: mine(await c.db.query<HrHours>('SELECT id, person_id, ym, hours, note FROM hr_hours ORDER BY ym DESC, person_id')),
    settings,
    centreOf,
  };
}

/**
 * HR makes the staff list, finance puts it in the budget (Fouad, 30 October 2026). For a year: each person's stipend
 * month by month (from the agreements and the changes), grouped by centre, position and monthly amount, as in the
 * salary sheet: quantity of people, times a year (the months, and the 13th payment in proportion), total. No names.
 */
export async function budgetStaff(c: OpCtx, year: number): Promise<{ rows: HrBudgetRow[]; paymentsPerYear: number; /** people agreed in pounds, left out because the dollar rate is not known */ needRate: number }> {
  const d = await payData(c);
  const people = (await c.db.query<{ id: number; centre: string | null; role: string | null; started: string | null; ended: string | null }>('SELECT id, centre, role, started, ended FROM hr_person')).filter((p) => p.id in d.centreOf);
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
    run: async (c: OpCtx, a: { id?: number | null; name: string; nameAr?: string | null; note?: string | null; monthlyUsd?: number | null; /** the centre's code; null = shared by every centre */ centre?: string | null }) => {
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب اسم الوظيفة', 'Write the name of the position', 'Écrivez le nom du poste'));
      const amount = num(a.monthlyUsd);
      if (amount != null && !(amount > 0)) throw new UserError(m('المبلغ الشهري يجب أن يكون أكبر من صفر', 'The monthly amount must be above zero', 'Le montant mensuel doit être supérieur à zéro'));
      // each centre has its scale (Fouad, 31 October 2026); a position shared by every centre is for those who see them all
      const centre = txt(a.centre);
      if (centre) needCentre(c, centre); else needAll(c);
      const before = a.id ? await one<{ name: string; centre: string | null }>(c.db, 'SELECT name, centre FROM hr_grade WHERE id = ?', [a.id]) : null;
      if (a.id && !before) throw new UserError(m('وظيفة غير موجودة', 'Position not found', 'Poste introuvable'));
      if (before) { if (before.centre) needCentre(c, before.centre); else needAll(c); }
      if (await one(c.db, 'SELECT 1 AS x FROM hr_grade WHERE name = ? AND centre IS ? AND id IS NOT ?', [name, centre, a.id ?? null])) throw new UserError(m('هذه الوظيفة موجودة', 'This position exists already', 'Ce poste existe déjà'));
      if (a.id && before) {
        // a renamed position keeps its people (those of its centre, when it belongs to one)
        const ofCentre = before.centre ? " AND centre IN (SELECT name FROM hr_list WHERE kind = 'centre' AND code = ?)" : '';
        const ofPaper = before.centre ? " AND person_id IN (SELECT p.id FROM hr_person p JOIN hr_list l ON l.kind = 'centre' AND l.name = p.centre WHERE l.code = ?)" : '';
        const extra = before.centre ? [before.centre] : [];
        await c.db.batch([
          { sql: 'UPDATE hr_grade SET name = ?, name_ar = ?, note = ?, monthly_usd = ?, centre = ? WHERE id = ?', params: [name, txt(a.nameAr), txt(a.note), amount, centre, a.id] },
          ...(before.name !== name ? [{ sql: `UPDATE hr_person SET role = ? WHERE role = ?${ofCentre}`, params: [name, before.name, ...extra] }, { sql: `UPDATE hr_paper SET position = ? WHERE position = ?${ofPaper}`, params: [name, before.name, ...extra] }] : []),
          auditStmt(c.who, 'update', 'hr_grade', String(a.id), before, { name, monthly: amount, centre }),
        ]);
        return { id: a.id };
      }
      const next = ((await one<{ s: number | null }>(c.db, 'SELECT MAX(sort) AS s FROM hr_grade'))?.s ?? 0) + 1;
      await c.db.batch([{ sql: 'INSERT INTO hr_grade (name, name_ar, sort, note, monthly_usd, centre) VALUES (?,?,?,?,?,?)', params: [name, txt(a.nameAr), next, txt(a.note), amount, centre] }, auditStmt(c.who, 'add', 'hr_grade', null, null, { name, monthly: amount, centre })]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_grade'))!.id };
    },
  },
  'hr.grade.delete': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
      const g = await one<{ centre: string | null }>(c.db, 'SELECT centre FROM hr_grade WHERE id = ?', [a.id]);
      if (g?.centre) needCentre(c, g.centre); else needAll(c);
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
      needAll(c);
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
  // a copy of the positions of one scale (a centre's, or the shared one) into a centre's scale: those it has not yet
  'hr.grade.copy': {
    check: needPay,
    run: async (c: OpCtx, a: { from: string | null; to: string }) => {
      const to = txt(a.to), from = txt(a.from);
      if (!to) throw new UserError(m('اختر المركز', 'Choose the centre', 'Choisissez le centre'));
      needCentre(c, to);
      if (from) needCentre(c, from);
      const src = await c.db.query<HrGrade>('SELECT * FROM hr_grade WHERE centre IS ? AND active = 1 ORDER BY sort, id', [from]);
      const have = new Set((await c.db.query<{ name: string }>('SELECT name FROM hr_grade WHERE centre = ?', [to])).map((x) => x.name.toLowerCase()));
      const add = src.filter((g) => !have.has(g.name.toLowerCase()));
      let sort = (await one<{ s: number | null }>(c.db, 'SELECT MAX(sort) AS s FROM hr_grade'))?.s ?? 0;
      await c.db.batch([
        ...add.map((g) => ({ sql: 'INSERT INTO hr_grade (name, name_ar, sort, note, monthly_usd, centre) VALUES (?,?,?,?,?,?)', params: [g.name, g.name_ar, ++sort, g.note, g.monthly_usd, to] })),
        auditStmt(c.who, 'copy', 'hr_grade', null, null, { from, to, n: add.length }),
      ]);
      return { added: add.length };
    },
  },
  'hr.pay.settings': {
    check: needPay,
    run: async (c: OpCtx, a: Partial<PaySettings>) => {
      const cur = await settingsOf(c);
      // the shared settings by those who see every centre; the dollar rate of a centre by those who see it
      const shared = (['paymentsPerYear', 'roundTo', 'maxWeekly', 'rateSyp'] as const).some((k) => a[k] !== undefined && a[k] !== cur[k]);
      if (shared) needAll(c);
      for (const k of Object.keys(a.rates ?? {})) needCentre(c, k);
      const s = { ...cur, ...a, rates: { ...cur.rates, ...(a.rates ?? {}) } };
      if (!(s.paymentsPerYear >= 1 && s.paymentsPerYear <= 24) || !(s.roundTo >= 0) || !(s.maxWeekly > 0 && s.maxWeekly <= 84) || !(s.rateSyp >= 0) || Object.values(a.rates ?? {}).some((r) => !(Number(r) >= 0))) throw new UserError(m('قيم غير صالحة', 'Not valid values', 'Valeurs non valides'));
      const put = (k: string, v: number) => ({ sql: 'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', params: [k, String(v)] });
      await c.db.batch([
        ...(shared ? [put('hr_payments_per_year', s.paymentsPerYear), put('hr_round_to', s.roundTo), put('hr_max_weekly', s.maxWeekly), put('hr_rate_syp', s.rateSyp)] : []),
        ...Object.entries(a.rates ?? {}).map(([k, v]) => put(`hr_rate_syp:${k}`, Number(v) || 0)),
        auditStmt(c.who, 'update', 'hr_settings', null, cur, { ...a }),
      ]);
      return s;
    },
  },

  // the stipend changes from a date in the middle of the year (the agreement's line stays as history)
  'hr.pay.save': {
    check: needPay,
    run: async (c: OpCtx, a: { id?: number | null; personId: number; validFrom: string; gradeId?: number | null; weeklyHours?: number | null; monthlyUsd?: number | null; monthlySyp?: number | null; note?: string | null }) => {
      if (!(await one(c.db, 'SELECT 1 AS x FROM hr_person WHERE id = ?', [a.personId]))) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      await needPerson(c, a.personId);
      if (a.id) await needPerson(c, (await one<{ person_id: number }>(c.db, 'SELECT person_id FROM hr_pay WHERE id = ?', [a.id]))?.person_id);
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
      await needPerson(c, (await one<{ person_id: number }>(c.db, 'SELECT person_id FROM hr_pay WHERE id = ?', [a.id]))?.person_id);
      if ((await one<{ paper_id: number | null }>(c.db, 'SELECT paper_id FROM hr_pay WHERE id = ?', [a.id]))?.paper_id) throw new UserError(m('هذا السطر من الاتفاقية: احذف الاتفاقية أو عدّلها', 'This line comes from the agreement: change or delete the agreement', "Cette ligne vient de l'accord : modifiez ou supprimez l'accord"));
      await c.db.batch([{ sql: 'UPDATE hr_pay SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', params: [nowIso(), a.id] }, auditStmt(c.who, 'delete', 'hr_pay', String(a.id), null, null)]);
      return { ok: true };
    },
  },
  'hr.hours.save': {
    check: needPay,
    run: async (c: OpCtx, a: { personId: number; ym: string; hours: number | null; note?: string | null }) => {
      if (!/^\d{4}-\d{2}$/.test(a.ym ?? '')) throw new UserError(m('شهر غير صالح', 'Not a valid month', 'Mois non valide'));
      await needPerson(c, a.personId);
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
