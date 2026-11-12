// HR stage 4 (Fouad, 30 October 2026): the health insurance of the staff and their family (paid yearly, with a
// reminder before it ends), and the cost of staff time by project (the project of each person's budget line).
import { nowIso, one } from '../db/db';
import { auditStmt, UserError } from '../db/repo';
import { has } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import { needPerson, needRight, seenPeople } from './scope';

/** only the rows of the people the user sees */
async function mine<T extends { person_id: number }>(c: OpCtx, rows: T[]): Promise<T[]> {
  const seen = await seenPeople(c);
  return seen ? rows.filter((r) => seen.has(r.person_id)) : rows;
}

export interface HrInsurance { id: number; person_id: number; member_name: string | null; relation: string | null; amount_usd: number; currency: 'USD' | 'SYP'; paid_by: 'centre' | 'staff'; end_date: string | null; paid_on: string | null; note: string | null }
export interface HrAlloc { person_id: number; valid_from: string; target: string; pct: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
const needPay = (c: OpCtx) => { if (!has(c.profile, 'hr.pay')) throw refuse(); };
const txt = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim());
const day = (x: unknown) => {
  const s = txt(x);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UserError(m('تاريخ غير صالح', 'Not a valid date', 'Date non valide'));
  return s;
};

/** The split of a person on a date: the latest set that has begun. Empty = not split (unallocated). */
export function allocOn(all: HrAlloc[], personId: number, date: string): HrAlloc[] {
  const mine = all.filter((a) => a.person_id === personId && a.valid_from <= date);
  const from = mine.map((a) => a.valid_from).sort().pop();
  return mine.filter((a) => a.valid_from === from);
}

/** Divides an amount by percentages; the last part takes what is left, so the parts always add up. */
export function splitAmount(total: number, parts: { pct: number }[], decimals = 2): number[] {
  const f = 10 ** decimals;
  let left = Math.round(total * f);
  return parts.map((p, i) => {
    const v = i === parts.length - 1 ? left : Math.round((total * p.pct * f) / 100);
    left -= v;
    return v / f;
  });
}

export const HR_STAGE4_OPS = {
  'hr.ins.list': { check: (c: OpCtx) => needRight(c, 'hr.salary'), run: async (c: OpCtx) => mine(c, await c.db.query<HrInsurance>('SELECT id, person_id, member_name, relation, amount_usd, currency, paid_by, end_date, paid_on, note FROM hr_insurance WHERE deleted_at IS NULL ORDER BY person_id, member_name IS NOT NULL, member_name')) },
  'hr.ins.save': {
    check: needPay,
    run: async (c: OpCtx, a: { id?: number | null; personId: number; memberName?: string | null; relation?: string | null; amountUsd: number; currency?: 'USD' | 'SYP'; paidBy?: 'centre' | 'staff'; endDate?: string | null; paidOn?: string | null; note?: string | null }) => {
      if (!(await one(c.db, 'SELECT 1 AS x FROM hr_person WHERE id = ?', [a.personId]))) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      await needPerson(c, a.personId);
      if (a.id) await needPerson(c, (await one<{ person_id: number }>(c.db, 'SELECT person_id FROM hr_insurance WHERE id = ?', [a.id]))?.person_id);
      const amount = Number(a.amountUsd);
      if (!(amount >= 0)) throw new UserError(m('مبلغ غير صالح', 'Not a valid amount', 'Montant non valide'));
      // the staff member's own insurance is usually paid by the centre; a family member's by the staff member
      const member = txt(a.memberName);
      const paidBy = a.paidBy === 'centre' || a.paidBy === 'staff' ? a.paidBy : member ? 'staff' : 'centre';
      const v = [a.personId, member, txt(a.relation), amount, a.currency === 'SYP' ? 'SYP' : 'USD', paidBy, day(a.endDate), day(a.paidOn), txt(a.note)];
      if (a.id) {
        await c.db.batch([{ sql: 'UPDATE hr_insurance SET person_id=?, member_name=?, relation=?, amount_usd=?, currency=?, paid_by=?, end_date=?, paid_on=?, note=? WHERE id = ? AND deleted_at IS NULL', params: [...v, a.id] }, auditStmt(c.who, 'update', 'hr_insurance', String(a.id), null, { person: a.personId, amount })]);
        return { id: a.id };
      }
      await c.db.batch([{ sql: 'INSERT INTO hr_insurance (person_id, member_name, relation, amount_usd, currency, paid_by, end_date, paid_on, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', params: [...v, nowIso(), c.who] }, auditStmt(c.who, 'add', 'hr_insurance', null, null, { person: a.personId, amount })]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_insurance'))!.id };
    },
  },
  'hr.ins.delete': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
      await needPerson(c, (await one<{ person_id: number }>(c.db, 'SELECT person_id FROM hr_insurance WHERE id = ?', [a.id]))?.person_id);
      await c.db.batch([{ sql: 'UPDATE hr_insurance SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', params: [nowIso(), a.id] }, auditStmt(c.who, 'delete', 'hr_insurance', String(a.id), null, null)]);
      return { ok: true };
    },
  },

  // the split by percentages is gone (Fouad, 2026-11-01): a salary follows the project of its budget line. The old
  // splits stay in hr_alloc for the record; nothing reads them any more.
  'hr.alloc.list': { check: (c: OpCtx) => needRight(c, 'hr.salary'), run: async (): Promise<HrAlloc[]> => [] },

  // the cost of staff time by donor or project, by month, from the approved and paid runs of a year
  'hr.alloc.report': {
    check: (c: OpCtx) => needRight(c, 'hr.donors'),
    run: async (c: OpCtx, a: { year: number }) => {
      const y = Number(a.year);
      if (!(y >= 2000 && y <= 2100)) throw new UserError(m('سنة غير صالحة', 'Not a valid year', 'Année non valide'));
      // by the project each line was paid on
      const lines = await mine(c, await c.db.query<{ ym: string; person_id: number; account: string | null; total_usd: number }>("SELECT r.ym, l.person_id, l.account, l.total_usd FROM hr_run_line l JOIN hr_run r ON r.id = l.run_id WHERE r.status IN ('approved','paid') AND r.ym LIKE ?", [`${y}-%`]));
      const acc = new Map<string, number>();
      for (const l of lines) acc.set(`${l.ym}|${l.account ?? ''}`, r2((acc.get(`${l.ym}|${l.account ?? ''}`) ?? 0) + l.total_usd));
      return [...acc].map(([k, total_usd]) => { const [ym, target] = k.split('|'); return { ym, target: target || null, total_usd }; }).sort((x, y2) => x.ym.localeCompare(y2.ym) || (x.target ?? '').localeCompare(y2.target ?? ''));
    },
  },
};
export const HR_STAGE4_READ_ONLY = ['hr.ins.list', 'hr.alloc.list', 'hr.alloc.report'];
