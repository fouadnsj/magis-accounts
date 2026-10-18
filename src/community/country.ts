// The country econome's database (e.g. "Syria"): it receives each community's monthly
// file, decides on the claims, records the charges between communities and the payments,
// keeps each community's account at the économat, makes the year-end reconciliation and
// a return file for each community. It never sees a Jesuit's detail: only totals.

import { type Db, type Stmt, migrate, nowIso, one, uuid } from '../db/db';
import { auditStmt, getMeta, setMetaStmt, UserError } from '../db/repo';
import { has, profileStmt } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import { CURS, r2, type Cur } from './domain';
import { MONTH_FILE, RETURN_FILE, fingerprint, type MonthFile, type ReturnFile } from './files';
import { ledgerOf, signedMove, type CountryCharge, type CountryClaim, type CountryCty, type CountryMove, type MoveKind } from './ledger';

export interface CountrySetup {
  country: string;
  localCurrency: string;
  people: { name: string; password: string }[];
  mustChange?: boolean;
}

export const COUNTRY_PERMS = ['country.manage', 'users.manage', 'data.backup', 'data.restore', 'data.export', 'data.import', 'audit.view'];

export async function createCountry(db: Db, s: CountrySetup): Promise<void> {
  await migrate(db);
  if (await one(db, 'SELECT 1 AS x FROM profile LIMIT 1')) throw new UserError(m('قاعدة البيانات مُعدّة مسبقاً', 'This database is already set up', 'Cette base est déjà préparée'));
  if (!s.country.trim()) throw new UserError(m('اكتب اسم البلد', 'Write the name of the country', 'Écrivez le nom du pays'));
  const people = s.people.filter((p) => p.name.trim());
  if (!people.length) throw new UserError(m('من هو مدبّر البلد؟', 'Who is the country econome?', "Qui est l'économe du pays ?"));
  await db.batch([
    { sql: 'DELETE FROM access_profile' },
    // (the table is empty: this profile gets the number 1)
    { sql: 'INSERT INTO access_profile (id, name, perms, sort) VALUES (1, ?, ?, 1)', params: ['مدبّر البلد · Country econome · Économe du pays', JSON.stringify(COUNTRY_PERMS)] },
    setMetaStmt('install', 'office'),
    setMetaStmt('kind', 'country'),
    setMetaStmt('organisation', s.country.trim()),
    setMetaStmt('country', s.country.trim()),
    setMetaStmt('local_currency', s.localCurrency.trim().toUpperCase() || 'SYP'),
    setMetaStmt('created_at', nowIso()),
  ]);
  for (const p of people) {
    await db.batch([
      await profileStmt({ name: p.name, role: 'sup', pin: p.password, access_id: 1 }),
      ...(s.mustChange !== false ? [{ sql: 'UPDATE profile SET must_change = 1 WHERE id = (SELECT MAX(id) FROM profile)' }] : []),
    ]);
  }
  await db.batch([auditStmt('setup', 'create', 'meta', null, null, { kind: 'country', country: s.country })]);
}

// ---------------------------------------------------------------- reading

export interface CountryProposal { id: string; host_id: number; date: string; charged_uid: string | null; charged_name: string; person: string | null; cur: Cur; amount: number; note: string; status: 'waiting' | 'approved' | 'refused' | 'withdrawn'; decision_note: string | null; decided_at: string | null; decided_by: string | null }
export interface CountryMonth { cty_id: number; ym: string; hash: string; received_at: string; received_by: string | null; file: MonthFile }
export interface CountryData {
  kind: string | null;
  local: string;
  ctys: CountryCty[];
  months: CountryMonth[];
  claims: CountryClaim[];
  charges: CountryCharge[];
  moves: CountryMove[];
  proposals: CountryProposal[];
}

async function requireCountry(db: Db) {
  if ((await getMeta(db, 'kind')) !== 'country') throw new UserError(m('هذه ليست قاعدة بيانات البلد', 'This is not a country database', "Ce n'est pas la base de données du pays"));
}
const need = (c: OpCtx) => {
  if (!has(c.profile, 'country.manage')) throw new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
};

export async function countryData(db: Db): Promise<CountryData> {
  const months = await db.query<{ cty_id: number; ym: string; hash: string; payload: string; received_at: string; received_by: string | null }>('SELECT * FROM country_month ORDER BY ym');
  return {
    kind: await getMeta(db, 'kind'),
    local: (await getMeta(db, 'local_currency')) ?? 'SYP',
    ctys: await db.query<CountryCty>('SELECT * FROM country_cty ORDER BY name'),
    months: months.map(({ payload, ...r }) => ({ ...r, file: JSON.parse(payload) as MonthFile })),
    claims: await db.query<CountryClaim>('SELECT * FROM country_claim ORDER BY date, id'),
    charges: await db.query<CountryCharge>('SELECT * FROM country_charge ORDER BY date, id'),
    moves: await db.query<CountryMove>('SELECT * FROM country_move ORDER BY date, id'),
    proposals: await db.query<CountryProposal>('SELECT * FROM country_proposal ORDER BY date, id'),
  };
}

// ---------------------------------------------------------------- the monthly files

export interface ImportResult { community: string; ym: string; status: 'new' | 'same' | 'replaced'; claims: number }

/** A community's monthly file. The same file twice changes nothing; a corrected month replaces the old one. */
export async function importMonthFile(db: Db, f: MonthFile, who: string): Promise<ImportResult> {
  if (!f || f.kind !== MONTH_FILE || !f.community?.uid || !/^\d{4}-\d{2}$/.test(f.ym ?? '')) throw new UserError(m('ليس ملفاً شهرياً من جماعة', 'Not a monthly file from a community', "Ce n'est pas un fichier mensuel d'une communauté"));
  const country = await getMeta(db, 'country');
  if (f.community.country && country && f.community.country.toLowerCase() !== country.toLowerCase())
    throw new UserError(m(`هذه الجماعة من بلد آخر (${f.community.country})`, `This community belongs to another country (${f.community.country})`, `Cette communauté est d'un autre pays (${f.community.country})`));
  const stmts: Stmt[] = [];
  let cty = await one<CountryCty>(db, 'SELECT * FROM country_cty WHERE uid = ?', [f.community.uid]);
  if (!cty) {
    await db.batch([{ sql: 'INSERT INTO country_cty (uid, name) VALUES (?, ?)', params: [f.community.uid, f.community.name || f.community.uid] }, auditStmt(who, 'add', 'country_cty', f.community.uid, null, { name: f.community.name })]);
    cty = (await one<CountryCty>(db, 'SELECT * FROM country_cty WHERE uid = ?', [f.community.uid]))!;
  }
  const hash = await fingerprint({ ...f, made_at: null, made_by: null });
  const old = await one<{ hash: string }>(db, 'SELECT hash FROM country_month WHERE cty_id = ? AND ym = ?', [cty.id, f.ym]);
  if (old?.hash === hash) return { community: cty.name, ym: f.ym, status: 'same', claims: 0 };
  stmts.push({
    sql: 'INSERT INTO country_month (cty_id, ym, hash, payload, received_at, received_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(cty_id, ym) DO UPDATE SET hash = excluded.hash, payload = excluded.payload, received_at = excluded.received_at, received_by = excluded.received_by',
    params: [cty.id, f.ym, hash, JSON.stringify(f), nowIso(), who],
  });
  // the claims of that month: new ones wait; a claim already decided keeps its decision
  const ids = new Set(f.claims.map((x) => x.id));
  for (const x of f.claims) {
    const was = await one<CountryClaim>(db, 'SELECT * FROM country_claim WHERE id = ?', [x.id]);
    if (!was) stmts.push({ sql: 'INSERT INTO country_claim (id, cty_id, date, code, line, book_kind, person, cur, amount, reason, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [x.id, cty.id, x.date, x.code, x.line, x.book_kind, x.person ?? null, x.cur, x.amount, x.reason, x.note] });
    else if (was.status === 'waiting' || was.status === 'withdrawn') stmts.push({ sql: "UPDATE country_claim SET date = ?, code = ?, line = ?, person = ?, cur = ?, amount = ?, reason = ?, note = ?, status = 'waiting' WHERE id = ?", params: [x.date, x.code, x.line, x.person ?? null, x.cur, x.amount, x.reason, x.note, x.id] });
  }
  // a claim of that month no longer in the file was taken back by the community (if not yet decided)
  for (const was of await db.query<CountryClaim>("SELECT * FROM country_claim WHERE cty_id = ? AND substr(date, 1, 7) = ? AND status = 'waiting'", [cty.id, f.ym]))
    if (!ids.has(was.id)) stmts.push({ sql: "UPDATE country_claim SET status = 'withdrawn' WHERE id = ?", params: [was.id] });
  // the charges this community makes to others: they wait for the country econome's approval
  const chargeIds = new Set((f.charges ?? []).map((x) => x.id));
  for (const x of f.charges ?? []) {
    const was = await one<{ status: string }>(db, 'SELECT status FROM country_proposal WHERE id = ?', [x.id]);
    if (!was) stmts.push({ sql: 'INSERT INTO country_proposal (id, host_id, date, charged_uid, charged_name, person, cur, amount, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [x.id, cty.id, x.date, x.to_uid, x.to_name, x.person, x.cur, x.amount, x.note] });
    else if (was.status === 'waiting' || was.status === 'withdrawn') stmts.push({ sql: "UPDATE country_proposal SET date = ?, charged_uid = ?, charged_name = ?, person = ?, cur = ?, amount = ?, note = ?, status = 'waiting' WHERE id = ?", params: [x.date, x.to_uid, x.to_name, x.person, x.cur, x.amount, x.note, x.id] });
  }
  for (const was of await db.query<{ id: string }>("SELECT id FROM country_proposal WHERE host_id = ? AND substr(date, 1, 7) = ? AND status = 'waiting'", [cty.id, f.ym]))
    if (!chargeIds.has(was.id)) stmts.push({ sql: "UPDATE country_proposal SET status = 'withdrawn' WHERE id = ?", params: [was.id] });
  if (f.community.name && f.community.name !== cty.name) stmts.push({ sql: 'UPDATE country_cty SET name = ? WHERE id = ?', params: [f.community.name, cty.id] });
  stmts.push(auditStmt(who, old ? 'replace' : 'import', 'country_month', `${cty.id}:${f.ym}`, null, { community: f.community.name, ym: f.ym, claims: f.claims.length }));
  await db.batch(stmts);
  return { community: cty.name, ym: f.ym, status: old ? 'replaced' : 'new', claims: f.claims.length };
}

/** The return file for one community: decisions on its claims, and its account at the économat. */
export async function buildReturnFile(db: Db, ctyId: number, who: string): Promise<ReturnFile> {
  const d = await countryData(db);
  const cty = d.ctys.find((c) => c.id === ctyId);
  if (!cty) throw new UserError(m('الجماعة غير موجودة', 'Unknown community', 'Communauté inconnue'));
  return {
    kind: RETURN_FILE, version: 1, community_uid: cty.uid, country: (await getMeta(db, 'country')) ?? '', made_at: nowIso(), made_by: who,
    decisions: d.claims.filter((x) => x.cty_id === ctyId).map((x) => ({ id: x.id, status: x.status, accepted: x.accepted, note: x.decision_note })),
    statement: ledgerOf(ctyId, d.claims, d.charges, d.moves, new Map(d.ctys.map((c) => [c.id, c.name]))),
    chargeDecisions: d.proposals.filter((p) => p.host_id === ctyId).map((p) => ({ id: p.id, status: p.status, note: p.decision_note })),
    communities: d.ctys.filter((c) => c.active).map((c) => ({ uid: c.uid, name: c.name })),
  };
}

// ---------------------------------------------------------------- decisions and movements

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const okCur = (x: string): x is Cur => (CURS as readonly string[]).includes(x);

async function decideClaim(c: OpCtx, a: { id: string; status: 'accepted' | 'refused' | 'waiting'; accepted?: number | null; note?: string | null }) {
  await requireCountry(c.db);
  const cl = await one<CountryClaim>(c.db, 'SELECT * FROM country_claim WHERE id = ?', [a.id]);
  if (!cl) throw new UserError(m('المطالبة غير موجودة', 'Claim not found', 'Réclamation introuvable'));
  if (cl.status === 'withdrawn') throw new UserError(m('سحبتها الجماعة', 'The community withdrew it', 'La communauté l’a retirée'));
  const note = (a.note ?? '').trim() || null;
  let accepted: number | null = null;
  if (a.status === 'accepted') {
    accepted = a.accepted == null ? cl.amount : r2(Number(a.accepted));
    if (!(accepted > 0) || accepted > cl.amount) throw new UserError(m('المبلغ المقبول بين صفر والمبلغ المطلوب', 'The amount accepted is between zero and the amount claimed', 'Le montant accepté est entre zéro et le montant réclamé'));
    if (accepted < cl.amount && !note) throw new UserError(m('قبول جزئي: اكتب السبب', 'Accepted in part: write why', 'Accepté en partie : écrivez pourquoi'));
  }
  if (a.status === 'refused' && !note) throw new UserError(m('الرفض: اكتب السبب', 'Refused: write why', 'Refusé : écrivez pourquoi'));
  await c.db.batch([
    { sql: 'UPDATE country_claim SET status = ?, accepted = ?, decision_note = ?, decided_at = ?, decided_by = ? WHERE id = ?', params: [a.status, accepted, note, a.status === 'waiting' ? null : nowIso(), a.status === 'waiting' ? null : c.who, a.id] },
    auditStmt(c.who, 'decide', 'country_claim', a.id, { status: cl.status, accepted: cl.accepted }, { status: a.status, accepted, note }),
  ]);
}

async function saveCharge(c: OpCtx, a: { charge: Partial<CountryCharge>; reason?: string | null }) {
  await requireCountry(c.db);
  const x = a.charge;
  const old = x.id ? await one<CountryCharge>(c.db, 'SELECT * FROM country_charge WHERE id = ?', [x.id]) : undefined;
  if (x.id && !old) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
  if (!x.date || !ISO.test(x.date)) throw new UserError(m('التاريخ مطلوب', 'The date is required', 'La date est requise'));
  if (!x.host_id || !x.charged_id || x.host_id === x.charged_id) throw new UserError(m('اختر جماعتين مختلفتين', 'Choose two different communities', 'Choisissez deux communautés différentes'));
  if (!okCur(x.cur ?? '') || !(Number(x.amount) > 0)) throw new UserError(m('المبلغ والعملة', 'The amount and the currency', 'Le montant et la monnaie'));
  const note = (x.note ?? '').trim();
  if (!note) throw new UserError(m('اكتب الشرح (مثلاً: إقامة الأب س، 3 ليالٍ)', 'Write what it is (e.g. Fr X, 3 nights)', 'Écrivez ce que c’est (p. ex. P. X, 3 nuits)'));
  const reason = (a.reason ?? '').trim();
  if (old && !reason) throw new UserError(m('اكتب سبب التعديل', 'Write the reason for this change', 'Écrivez la raison de cette modification'));
  const row = { id: old?.id ?? uuid(), date: x.date, host_id: x.host_id, charged_id: x.charged_id, cur: x.cur as Cur, amount: r2(Number(x.amount)), note, created_at: old?.created_at ?? nowIso(), created_by: old?.created_by ?? c.who };
  await c.db.batch([
    { sql: 'INSERT OR REPLACE INTO country_charge (id, date, host_id, charged_id, cur, amount, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [row.id, row.date, row.host_id, row.charged_id, row.cur, row.amount, row.note, row.created_at, row.created_by] },
    auditStmt(c.who, old ? 'edit' : 'add', 'country_charge', row.id, old ?? null, old ? { ...row, reason } : row),
  ]);
  return row.id;
}

/** A charge proposed by a host community: approved (it becomes a charge between the two) or refused. */
async function decideProposal(c: OpCtx, a: { id: string; status: 'approved' | 'refused' | 'waiting'; chargedId?: number | null; note?: string | null }) {
  await requireCountry(c.db);
  const p = await one<CountryProposal>(c.db, 'SELECT * FROM country_proposal WHERE id = ?', [a.id]);
  if (!p) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
  if (p.status === 'withdrawn') throw new UserError(m('سحبتها الجماعة', 'The community withdrew it', 'La communauté l\u2019a retirée'));
  const note = (a.note ?? '').trim() || null;
  const stmts: Stmt[] = [{ sql: 'DELETE FROM country_charge WHERE id = ?', params: [p.id] }];
  if (a.status === 'approved') {
    const charged = a.chargedId ?? (p.charged_uid ? (await one<{ id: number }>(c.db, 'SELECT id FROM country_cty WHERE uid = ?', [p.charged_uid]))?.id : undefined);
    if (!charged || !(await one(c.db, 'SELECT 1 AS x FROM country_cty WHERE id = ?', [charged]))) throw new UserError(m('أي جماعة تُحمَّل؟', 'Which community is charged?', 'Quelle communauté est facturée ?'));
    if (charged === p.host_id) throw new UserError(m('اختر جماعتين مختلفتين', 'Choose two different communities', 'Choisissez deux communautés différentes'));
    stmts.push({ sql: 'INSERT INTO country_charge (id, date, host_id, charged_id, cur, amount, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [p.id, p.date, p.host_id, charged, p.cur, p.amount, [p.note, p.person].filter(Boolean).join(' · '), nowIso(), c.who] });
  }
  if (a.status === 'refused' && !note) throw new UserError(m('الرفض: اكتب السبب', 'Refused: write why', 'Refusé : écrivez pourquoi'));
  stmts.push(
    { sql: 'UPDATE country_proposal SET status = ?, decision_note = ?, decided_at = ?, decided_by = ? WHERE id = ?', params: [a.status, note, a.status === 'waiting' ? null : nowIso(), a.status === 'waiting' ? null : c.who, a.id] },
    auditStmt(c.who, 'decide', 'country_proposal', a.id, { status: p.status }, { status: a.status, chargedId: a.chargedId ?? null, note }),
  );
  await c.db.batch(stmts);
}

async function saveMove(c: OpCtx, a: { move: Partial<CountryMove>; reason?: string | null }) {
  await requireCountry(c.db);
  const x = a.move;
  const old = x.id ? await one<CountryMove>(c.db, 'SELECT * FROM country_move WHERE id = ?', [x.id]) : undefined;
  if (x.id && !old) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
  if (!x.cty_id || !(await one(c.db, 'SELECT 1 AS x FROM country_cty WHERE id = ?', [x.cty_id]))) throw new UserError(m('اختر الجماعة', 'Choose the community', 'Choisissez la communauté'));
  if (!x.date || !ISO.test(x.date)) throw new UserError(m('التاريخ مطلوب', 'The date is required', 'La date est requise'));
  const kinds: MoveKind[] = ['paid_by_cty', 'paid_to_cty', 'cotisation', 'other'];
  if (!kinds.includes(x.kind as MoveKind)) throw new UserError(m('النوع؟', 'Which kind?', 'Quel type ?'));
  if (!okCur(x.cur ?? '') || !Number(x.amount)) throw new UserError(m('المبلغ والعملة', 'The amount and the currency', 'Le montant et la monnaie'));
  const note = (x.note ?? '').trim();
  if (!note) throw new UserError(m('اكتب الشرح', 'Write what it is', 'Écrivez ce que c’est'));
  const reason = (a.reason ?? '').trim();
  if (old && !reason) throw new UserError(m('اكتب سبب التعديل', 'Write the reason for this change', 'Écrivez la raison de cette modification'));
  const row = { id: old?.id ?? uuid(), cty_id: x.cty_id, date: x.date, kind: x.kind as MoveKind, cur: x.cur as Cur, amount: r2(signedMove(x.kind as MoveKind, Number(x.amount))), note, created_at: old?.created_at ?? nowIso(), created_by: old?.created_by ?? c.who };
  await c.db.batch([
    { sql: 'INSERT OR REPLACE INTO country_move (id, cty_id, date, kind, cur, amount, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [row.id, row.cty_id, row.date, row.kind, row.cur, row.amount, row.note, row.created_at, row.created_by] },
    auditStmt(c.who, old ? 'edit' : 'add', 'country_move', row.id, old ?? null, old ? { ...row, reason } : row),
  ]);
  return row.id;
}

async function deleteRow(c: OpCtx, a: { table: 'country_charge' | 'country_move'; id: string; reason: string }) {
  await requireCountry(c.db);
  if (a.table !== 'country_charge' && a.table !== 'country_move') throw new UserError(m('غير معروف', 'Unknown', 'Inconnu'));
  const reason = (a.reason ?? '').trim();
  if (!reason) throw new UserError(m('اكتب سبب الحذف', 'Write the reason for this deletion', 'Écrivez la raison de cette suppression'));
  const old = await one(c.db, `SELECT * FROM ${a.table} WHERE id = ?`, [a.id]);
  if (!old) return;
  await c.db.batch([{ sql: `DELETE FROM ${a.table} WHERE id = ?`, params: [a.id] }, auditStmt(c.who, 'delete', a.table, a.id, old, { reason })]);
}

async function renameCty(c: OpCtx, a: { id: number; name: string; active?: number }) {
  await requireCountry(c.db);
  const name = (a.name ?? '').trim();
  if (!name) throw new UserError(m('الاسم فارغ', 'The name is empty', 'Le nom est vide'));
  await c.db.batch([{ sql: 'UPDATE country_cty SET name = ?, active = ? WHERE id = ?', params: [name, a.active ?? 1, a.id] }, auditStmt(c.who, 'edit', 'country_cty', String(a.id), null, { name, active: a.active ?? 1 })]);
}

export const COUNTRY_OPS = {
  'country.data': { check: need, run: async (c: OpCtx) => { await requireCountry(c.db); return countryData(c.db); } },
  'country.import': { check: need, run: async (c: OpCtx, a: { file: MonthFile }) => { await requireCountry(c.db); return importMonthFile(c.db, a.file, c.who); } },
  'country.claim.decide': { check: need, run: (c: OpCtx, a: { id: string; status: 'accepted' | 'refused' | 'waiting'; accepted?: number | null; note?: string | null }) => decideClaim(c, a) },
  'country.proposal.decide': { check: need, run: (c: OpCtx, a: { id: string; status: 'approved' | 'refused' | 'waiting'; chargedId?: number | null; note?: string | null }) => decideProposal(c, a) },
  'country.charge.save': { check: need, run: (c: OpCtx, a: { charge: Partial<CountryCharge>; reason?: string | null }) => saveCharge(c, a) },
  'country.move.save': { check: need, run: (c: OpCtx, a: { move: Partial<CountryMove>; reason?: string | null }) => saveMove(c, a) },
  'country.delete': { check: need, run: (c: OpCtx, a: { table: 'country_charge' | 'country_move'; id: string; reason: string }) => deleteRow(c, a) },
  'country.cty.save': { check: need, run: (c: OpCtx, a: { id: number; name: string; active?: number }) => renameCty(c, a) },
  'country.return.build': { check: need, run: async (c: OpCtx, a: { ctyId: number }) => { await requireCountry(c.db); return buildReturnFile(c.db, a.ctyId, c.who); } },
};
export const COUNTRY_READ_ONLY = ['country.data', 'country.return.build'];
