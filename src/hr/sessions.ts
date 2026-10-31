// Tutors paid by session (Fouad, 31 October 2026). Besides the staff with an agreement, the centres pay tutors (workshop
// animators, tutors) for each session they lead: no agreement, one price per session written in the settings (from a
// date), the sessions recorded by date with their activity. At the end of the month the sessions of a centre's tutors go
// into that centre's payroll run, one line per tutor (and currency); a session in a run can no longer change.
// Later the sessions will also be imported from the calendar of the participants' program (source 'calendar').
import { nowIso, one, type Stmt } from '../db/db';
import { auditStmt, UserError } from '../db/repo';
import { has } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import { needAll, needCentre, needPerson, seenPeople } from './scope';

export interface HrSession { id: number; person_id: number; on_date: string; activity: string | null; note: string | null; source: string; run_line_id: number | null }
export interface HrSessionPrice { id: number; valid_from: string; amount: number; currency: 'USD' | 'SYP' }

const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
const needPay = (c: OpCtx) => { if (!has(c.profile, 'hr.pay')) throw refuse(); };
const txt = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim());
const r2 = (n: number) => Math.round(n * 100) / 100;
const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const lastDay = (ym: string) => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

/** The price of a session on a date: the latest price that has begun (null when none is written yet). */
export function priceOn(prices: HrSessionPrice[], date: string): HrSessionPrice | null {
  return prices.filter((p) => p.valid_from <= date).sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.id - a.id)[0] ?? null;
}

const pricesOf = (c: OpCtx) => c.db.query<HrSessionPrice>('SELECT id, valid_from, amount, currency FROM hr_session_price ORDER BY valid_from DESC, id DESC');

async function sessionOf(c: OpCtx, id: number) {
  const x = await one<HrSession>(c.db, 'SELECT * FROM hr_session WHERE id = ?', [id]);
  if (!x) throw new UserError(m('الجلسة غير موجودة', 'Session not found', 'Séance introuvable'));
  await needPerson(c, x.person_id);
  return x;
}
const notPaid = (x: HrSession) => {
  if (x.run_line_id) throw new UserError(m('هذه الجلسة في كشف دفع: احذف سطرها من الكشف أولاً', 'This session is in a payroll run: remove its line from the run first', "Cette séance est dans une paie : retirez d'abord sa ligne de la paie"));
};

/**
 * The lines that pay a centre's tutors in a run: every session up to the end of the run's month not paid yet (a session
 * written late is paid in the next run), one line per tutor and currency, each session at the price of its own date.
 */
export async function sessionLineStmts(c: OpCtx, run: { /** null: the run made just before, in the same batch */ id: number | null; ym: string; centre: string | null; rate_syp: number }): Promise<{ stmts: Stmt[]; lines: number }> {
  if (!run.centre) return { stmts: [], lines: 0 };
  const last = lastDay(run.ym);
  const rows = await c.db.query<{ id: number; person_id: number; on_date: string; account: string | null; budget_line: string | null }>(
    `SELECT s.id, s.person_id, s.on_date, p.account, p.budget_line FROM hr_session s JOIN hr_person p ON p.id = s.person_id
      WHERE s.run_line_id IS NULL AND s.on_date <= ? AND p.centre IN (SELECT name FROM hr_list WHERE kind = 'centre' AND code = ?) ORDER BY p.name, s.on_date`, [last, run.centre]);
  if (!rows.length) return { stmts: [], lines: 0 };
  const prices = await pricesOf(c);
  const groups = new Map<string, { person: number; currency: 'USD' | 'SYP'; ids: number[]; amount: number; unit: Set<number>; account: string | null; line: string | null }>();
  for (const s of rows) {
    const p = priceOn(prices, s.on_date);
    if (!p) throw new UserError(m(`لا سعر للجلسة في ${s.on_date}: اكتبه في الإعدادات`, `No price of a session on ${s.on_date}: write it in Settings`, `Pas de prix de séance au ${s.on_date} : écrivez-le dans Réglages`));
    const k = `${s.person_id}/${p.currency}`;
    const g = groups.get(k) ?? { person: s.person_id, currency: p.currency, ids: [], amount: 0, unit: new Set<number>(), account: s.account, line: s.budget_line };
    g.ids.push(s.id);
    g.amount += p.amount;
    g.unit.add(p.amount);
    groups.set(k, g);
  }
  if ([...groups.values()].some((g) => g.currency === 'SYP') && !(run.rate_syp > 0)) throw new UserError(m('اكتب سعر الدولار للكشف', 'Write the dollar rate of the run', 'Écrivez le taux du dollar de la paie'));
  const stmts: Stmt[] = [];
  for (const g of groups.values()) {
    const usd = g.currency === 'USD' ? r2(g.amount) : r2(g.amount / run.rate_syp);
    const label = `Sessions: ${g.ids.length}${g.unit.size === 1 ? ` × ${[...g.unit][0]} ${g.currency}` : ''}`;
    stmts.push(
      { sql: `INSERT INTO hr_run_line (run_id, person_id, label, sessions, base_usd, total_usd, paid_in, amount_paid, account, budget_line) VALUES (${run.id == null ? '(SELECT MAX(id) FROM hr_run)' : '?'},?,?,?,?,?,?,?,?,?)`, params: [...(run.id == null ? [] : [run.id]), g.person, label, g.ids.length, usd, usd, g.currency, r2(g.amount), g.account, g.line] },
      { sql: `UPDATE hr_session SET run_line_id = (SELECT MAX(id) FROM hr_run_line) WHERE id IN (${g.ids.map(() => '?').join(',')})`, params: g.ids },
    );
  }
  return { stmts, lines: groups.size };
}

export const HR_SESSION_OPS = {
  // the sessions of a month (of the tutors the user sees), the prices, the activities already used
  'hr.sessions.get': {
    check: needPay,
    run: async (c: OpCtx, a: { ym: string }) => {
      if (!/^\d{4}-\d{2}$/.test(a.ym ?? '')) throw new UserError(m('شهر غير صالح', 'Not a valid month', 'Mois non valide'));
      const seen = await seenPeople(c);
      const mine = <T extends { person_id: number }>(xs: T[]) => (seen ? xs.filter((x) => seen.has(x.person_id)) : xs);
      const sessions = mine(await c.db.query<HrSession>('SELECT id, person_id, on_date, activity, note, source, run_line_id FROM hr_session WHERE on_date >= ? AND on_date <= ? ORDER BY on_date, id', [`${a.ym}-01`, lastDay(a.ym)]));
      const activities = mine(await c.db.query<{ person_id: number; activity: string }>('SELECT DISTINCT person_id, activity FROM hr_session WHERE activity IS NOT NULL'));
      return { sessions, prices: await pricesOf(c), activities: [...new Set(activities.map((x) => x.activity))].sort() };
    },
  },
  'hr.session.prices': { check: needPay, run: (c: OpCtx) => pricesOf(c) },

  'hr.session.add': {
    check: needPay,
    run: async (c: OpCtx, a: { personId: number; date: string; activity?: string | null; note?: string | null }) => {
      const p = await one<{ category: string }>(c.db, 'SELECT category FROM hr_person WHERE id = ?', [a.personId]);
      if (!p) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      await needPerson(c, a.personId);
      if (p.category !== 'tutor') throw new UserError(m('الجلسات للمدرّبين فقط', 'Sessions are for tutors only', 'Les séances sont pour les animateurs seulement'));
      if (!isDay(a.date)) throw new UserError(m('تاريخ غير صالح', 'Not a valid date', 'Date non valide'));
      const activity = txt(a.activity);
      await c.db.batch([
        { sql: 'INSERT INTO hr_session (person_id, on_date, activity, note, created_at, created_by) VALUES (?,?,?,?,?,?)', params: [a.personId, a.date, activity, txt(a.note), nowIso(), c.who] },
        // the activity becomes the tutor's usual one when they have none yet
        ...(activity ? [{ sql: 'UPDATE hr_person SET activity = ? WHERE id = ? AND activity IS NULL', params: [activity, a.personId] }] : []),
        auditStmt(c.who, 'add', 'hr_session', null, null, { person: a.personId, date: a.date, activity }),
      ]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_session'))!.id };
    },
  },
  'hr.session.save': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number; activity?: string | null; note?: string | null }) => {
      const x = await sessionOf(c, a.id);
      notPaid(x);
      await c.db.batch([{ sql: 'UPDATE hr_session SET activity = ?, note = ? WHERE id = ?', params: [txt(a.activity), txt(a.note), a.id] }, auditStmt(c.who, 'update', 'hr_session', String(a.id), { activity: x.activity }, { activity: txt(a.activity) })]);
      return { ok: true };
    },
  },
  'hr.session.delete': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
      const x = await sessionOf(c, a.id);
      notPaid(x);
      await c.db.batch([{ sql: 'DELETE FROM hr_session WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'hr_session', String(a.id), { person: x.person_id, date: x.on_date, activity: x.activity }, null)]);
      return { ok: true };
    },
  },

  // the price of a session (one for every centre), from a date
  'hr.session.price.save': {
    check: needPay,
    run: async (c: OpCtx, a: { validFrom: string; amount: number; currency: 'USD' | 'SYP' }) => {
      needAll(c);
      if (!isDay(a.validFrom)) throw new UserError(m('تاريخ غير صالح', 'Not a valid date', 'Date non valide'));
      const amount = Number(a.amount);
      if (!(amount > 0)) throw new UserError(m('المبلغ يجب أن يكون أكبر من صفر', 'The amount must be above zero', 'Le montant doit être supérieur à zéro'));
      const currency = a.currency === 'SYP' ? 'SYP' : 'USD';
      await c.db.batch([
        { sql: 'DELETE FROM hr_session_price WHERE valid_from = ?', params: [a.validFrom] },
        { sql: 'INSERT INTO hr_session_price (valid_from, amount, currency, created_at, created_by) VALUES (?,?,?,?,?)', params: [a.validFrom, amount, currency, nowIso(), c.who] },
        auditStmt(c.who, 'update', 'hr_session_price', a.validFrom, null, { amount, currency }),
      ]);
      return { ok: true };
    },
  },
  'hr.session.price.delete': {
    check: needPay,
    run: async (c: OpCtx, a: { id: number }) => {
      needAll(c);
      await c.db.batch([{ sql: 'DELETE FROM hr_session_price WHERE id = ?', params: [a.id] }, auditStmt(c.who, 'delete', 'hr_session_price', String(a.id), null, null)]);
      return { ok: true };
    },
  },

  // sessions written after the run was made: add them to it (while it is a draft)
  'hr.run.sessions.add': {
    check: needPay,
    run: async (c: OpCtx, a: { runId: number }) => {
      const run = await one<{ id: number; ym: string; kind: string; centre: string | null; rate_syp: number; status: string }>(c.db, 'SELECT id, ym, kind, centre, rate_syp, status FROM hr_run WHERE id = ?', [a.runId]);
      if (!run) throw new UserError(m('الكشف غير موجود', 'Run not found', 'Paie introuvable'));
      needCentre(c, run.centre);
      if (run.status !== 'draft') throw new UserError(m('الكشف معتمد: أعد فتحه أولاً', 'This run is approved: reopen it first', 'Cette paie est approuvée : rouvrez-la d’abord'));
      if (run.kind !== 'monthly') throw new UserError(m('الجلسات في الكشف الشهري فقط', 'Sessions go in a monthly run only', 'Les séances vont dans une paie mensuelle seulement'));
      const { stmts, lines } = await sessionLineStmts(c, run);
      if (stmts.length) await c.db.batch([...stmts, auditStmt(c.who, 'add', 'hr_run_line', null, null, { run: run.id, sessions: lines })]);
      return { lines };
    },
  },
};
export const HR_SESSION_READ_ONLY = ['hr.sessions.get', 'hr.session.prices'];

/** sessions still to pay up to the end of a month, in a centre (for the payroll page: "N sessions not in this run") */
export async function pendingSessions(c: OpCtx, ym: string, centre: string | null): Promise<number> {
  if (!centre) return 0;
  needCentre(c, centre);
  return (await one<{ n: number }>(c.db, "SELECT COUNT(*) AS n FROM hr_session s JOIN hr_person p ON p.id = s.person_id WHERE s.run_line_id IS NULL AND s.on_date <= ? AND p.centre IN (SELECT name FROM hr_list WHERE kind = 'centre' AND code = ?)", [lastDay(ym), centre]))?.n ?? 0;
}
