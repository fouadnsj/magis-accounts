// The Coordinator's grants (Fouad, 2026-11-07), kept in the Province account's database: a donor's grant, its planned
// split between projects in the centres (a sum or a percentage each), and what arrived of it on the Province's account
// (its income rows carry the grant's id). What was sent to the centres comes next.
import type { Db, Stmt } from '../db/db';
import { auditStmt, UserError } from '../db/repo';
import { m } from '../i18n';

export interface NetGrantPart { centre: string; centre_name: string | null; project_id: number | null; project_name: string | null; amount: number | null; pct: number | null }
export interface NetGrant {
  id: string; donor: string; reference: string | null; amount: number; currency: 'USD' | 'EUR';
  start_date: string | null; end_date: string | null; closed: number; note: string | null; created_at: string; created_by: string | null;
  parts: NetGrantPart[];
}
/** a grant with what arrived of it on the Province's account */
export interface NetGrantRow extends NetGrant { received_usd: number; received_syp: number; /** the euros that arrived (changed into dollars) */ received_eur: number }

/** A part's planned amount, in the grant's currency. */
export const partAmount = (g: Pick<NetGrant, 'amount'>, p: Pick<NetGrantPart, 'amount' | 'pct'>) => (p.pct != null ? (g.amount * p.pct) / 100 : p.amount ?? 0);

export async function listNetGrants(db: Db): Promise<NetGrantRow[]> {
  const gs = await db.query<Omit<NetGrant, 'parts'>>('SELECT * FROM net_grant ORDER BY created_at');
  const ps = await db.query<NetGrantPart & { grant_id: string }>('SELECT * FROM net_grant_part ORDER BY sort, id');
  const inc = await db.query<{ grant_id: string; usd: number; syp: number; eur: number }>(
    "SELECT t.grant_id, SUM(t.inc_usd) AS usd, SUM(t.inc_syp) AS syp, COALESCE(SUM(e.eur), 0) AS eur FROM trx t LEFT JOIN net_eur_in e ON e.trx_id = t.id WHERE t.type = 'Income' AND t.grant_id IS NOT NULL GROUP BY t.grant_id");
  return gs.map((g) => ({
    ...g,
    parts: ps.filter((p) => p.grant_id === g.id).map(({ centre, centre_name, project_id, project_name, amount, pct }) => ({ centre, centre_name, project_id, project_name, amount, pct })),
    received_usd: inc.find((x) => x.grant_id === g.id)?.usd ?? 0,
    received_syp: inc.find((x) => x.grant_id === g.id)?.syp ?? 0,
    received_eur: inc.find((x) => x.grant_id === g.id)?.eur ?? 0,
  }));
}

/** A new grant or a change: its parts are written again. The split never goes beyond the grant. */
export async function saveNetGrant(db: Db, g: Omit<NetGrant, 'created_at' | 'created_by' | 'closed'> & { closed?: number }, who: string, now: string) {
  const donor = (g.donor ?? '').trim();
  if (!donor) throw new UserError(m('اكتب اسم المانح', 'Write the name of the donor', 'Écrivez le nom du donateur'));
  if (!(g.amount > 0)) throw new UserError(m('المبلغ مطلوب', 'The amount is required', 'Le montant est demandé'));
  if (g.currency !== 'USD' && g.currency !== 'EUR') throw new UserError(m('العملة: دولار أو يورو', 'Currency: USD or EUR', 'Monnaie : USD ou EUR'));
  if (g.start_date && g.end_date && g.end_date < g.start_date) throw new UserError(m('النهاية قبل البداية', 'The end is before the start', 'La fin est avant le début'));
  const parts = g.parts ?? [];
  for (const p of parts) {
    if (!p.centre) throw new UserError(m('اختر المركز لكل جزء', 'Choose the centre of each part', 'Choisissez le centre de chaque part'));
    if ((p.amount == null) === (p.pct == null)) throw new UserError(m('لكل جزء مبلغ أو نسبة', 'Each part has a sum or a percentage', 'Chaque part a une somme ou un pourcentage'));
  }
  const planned = parts.reduce((a, p) => a + partAmount(g, p), 0);
  if (planned > g.amount + 0.5) throw new UserError(m(`التقسيم (${planned.toFixed(2)}) أكبر من المنحة (${g.amount})`, `The split (${planned.toFixed(2)}) is more than the grant (${g.amount})`, `La répartition (${planned.toFixed(2)}) dépasse la subvention (${g.amount})`));
  const before = (await db.query('SELECT * FROM net_grant WHERE id = ?', [g.id]))[0] ?? null;
  const stmts: Stmt[] = [
    before
      ? { sql: 'UPDATE net_grant SET donor = ?, reference = ?, amount = ?, currency = ?, start_date = ?, end_date = ?, closed = ?, note = ? WHERE id = ?', params: [donor, g.reference?.trim() || null, g.amount, g.currency, g.start_date || null, g.end_date || null, g.closed ? 1 : 0, g.note?.trim() || null, g.id] }
      : { sql: 'INSERT INTO net_grant (id, donor, reference, amount, currency, start_date, end_date, closed, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [g.id, donor, g.reference?.trim() || null, g.amount, g.currency, g.start_date || null, g.end_date || null, g.closed ? 1 : 0, g.note?.trim() || null, now, who] },
    { sql: 'DELETE FROM net_grant_part WHERE grant_id = ?', params: [g.id] },
    ...parts.map((p, i) => ({ sql: 'INSERT INTO net_grant_part (grant_id, centre, centre_name, project_id, project_name, amount, pct, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [g.id, p.centre, p.centre_name, p.project_id, p.project_name, p.amount, p.pct, i] as (string | number | null)[] })),
    auditStmt(who, before ? 'edit' : 'add', 'net_grant', g.id, before, { donor, reference: g.reference, amount: g.amount, currency: g.currency, parts }),
  ];
  await db.batch(stmts);
}

/** A grant with no money arrived can be deleted. */
export async function deleteNetGrant(db: Db, id: string, who: string) {
  if ((await db.query('SELECT 1 FROM trx WHERE grant_id = ? LIMIT 1', [id])).length)
    throw new UserError(m('وصل مال من هذه المنحة: لا تُحذف (أغلقها)', 'Money of this grant has arrived: it is not deleted (close it)', "L'argent de cette subvention est arrivé : elle ne se supprime pas (clôturez-la)"));
  await db.batch([
    { sql: 'DELETE FROM net_grant_part WHERE grant_id = ?', params: [id] },
    { sql: 'DELETE FROM net_grant WHERE id = ?', params: [id] },
    auditStmt(who, 'delete', 'net_grant', id, null, null),
  ]);
}
