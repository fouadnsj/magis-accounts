// The HR database (Fouad, 30 October 2026): a separate, private database (kind 'hr'). Stage 1:
// people, yearly volunteer agreements, one-time stipend letters, the code of conduct (each version,
// who signed it), and a vault of document copies (IDs...) where every opening is logged.
// Minimum personal data. Nothing is ever hard-deleted: a person is made inactive; a removed scan
// stays on the disk and in the log. No money is paid from here yet (payroll is a later stage).

import { type Db, type Stmt, migrate, nowIso, one } from '../db/db';
import { auditStmt, getMeta, setMetaStmt, UserError } from '../db/repo';
import { has, profileStmt } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import type { Perm } from '../perms';

export const HR_PERMS: Perm[] = ['hr.view', 'hr.manage', 'hr.vault', 'users.manage', 'data.backup', 'data.restore', 'data.export', 'audit.view'];

export interface HrSetup {
  organisation: string;
  people: { name: string; password: string }[];
  mustChange?: boolean;
}

export async function createHr(db: Db, s: HrSetup): Promise<void> {
  await migrate(db);
  if (await one(db, 'SELECT 1 AS x FROM profile LIMIT 1')) throw new UserError(m('قاعدة البيانات مُعدّة مسبقاً', 'This database is already set up', 'Cette base est déjà préparée'));
  const people = s.people.filter((p) => p.name.trim());
  if (!people.length) throw new UserError(m('من يتولى الموارد البشرية؟', 'Who keeps the HR?', 'Qui tient les RH ?'));
  await db.batch([
    { sql: 'DELETE FROM access_profile' },
    { sql: 'INSERT INTO access_profile (id, name, perms, sort) VALUES (1, ?, ?, 1)', params: ['مسؤول الموارد البشرية · HR keeper · Responsable RH', JSON.stringify(HR_PERMS)] },
    { sql: 'INSERT INTO access_profile (id, name, perms, sort) VALUES (2, ?, ?, 2)', params: ['قارئ · Reader · Lecteur', JSON.stringify(['hr.view'])] },
    setMetaStmt('install', 'office'),
    setMetaStmt('kind', 'hr'),
    setMetaStmt('organisation', s.organisation.trim() || 'HR'),
    setMetaStmt('created_at', nowIso()),
  ]);
  for (const p of people) {
    await db.batch([
      await profileStmt({ name: p.name, role: 'sup', pin: p.password, access_id: 1 }),
      ...(s.mustChange !== false ? [{ sql: 'UPDATE profile SET must_change = 1 WHERE id = (SELECT MAX(id) FROM profile)' }] : []),
    ]);
  }
  await db.batch([auditStmt('setup', 'create', 'meta', null, null, { kind: 'hr' })]);
}

// ---------------------------------------------------------------- reading

export interface HrPerson { id: number; name: string; father_name: string | null; national_id: string | null; birth_place: string | null; birth_date: string | null; address: string | null; phone: string | null; role: string | null; centre: string | null; started: string | null; ended: string | null; active: number; note: string | null }
export interface HrPaper { id: number; person_id: number; kind: 'agreement' | 'stipend'; start_date: string | null; end_date: string | null; service: string | null; amount: number | null; currency: 'USD' | 'SYP'; paid_on: string | null; note: string | null; file_name: string | null; size: number | null; created_at: string }
export interface HrConduct { id: number; version: string; valid_from: string; note: string | null; file_name: string | null; size: number | null }
export interface HrSign { id: number; conduct_id: number; person_id: number; signed_on: string; file_name: string | null; size: number | null }
export interface HrDoc { id: number; person_id: number; label: string; expires_on: string | null; file_name: string; mime: string; size: number; created_at: string }
export interface HrAlert { kind: 'agreement_ending' | 'agreement_missing' | 'doc_expiring' | 'conduct_unsigned' | 'unsigned_paper'; person_id: number; item_id: number | null; date: string | null; days: number | null }
export interface HrData {
  kind: string | null;
  people: HrPerson[];
  papers: HrPaper[];
  conducts: HrConduct[];
  signs: HrSign[];
  /** the vault list: only for those who may open it */
  docs: HrDoc[] | null;
  alerts: HrAlert[];
}

const PAPER_COLS = 'id, person_id, kind, start_date, end_date, service, amount, currency, paid_on, note, file_name, size, created_at';
const SOON = 60;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysTo = (date: string, today: string) => Math.round((Date.parse(date) - Date.parse(today)) / 86400e3);

export async function hrData(c: OpCtx, today = isoDay(new Date())): Promise<HrData> {
  await requireHr(c.db);
  const people = await c.db.query<HrPerson>('SELECT id, name, father_name, national_id, birth_place, birth_date, address, phone, role, centre, started, ended, active, note FROM hr_person ORDER BY active DESC, name');
  const papers = await c.db.query<HrPaper>(`SELECT ${PAPER_COLS} FROM hr_paper WHERE deleted_at IS NULL ORDER BY COALESCE(start_date, paid_on, created_at) DESC, id DESC`);
  const conducts = await c.db.query<HrConduct>('SELECT id, version, valid_from, note, file_name, size FROM hr_conduct ORDER BY valid_from DESC, id DESC');
  const signs = await c.db.query<HrSign>('SELECT id, conduct_id, person_id, signed_on, file_name, size FROM hr_conduct_sign WHERE deleted_at IS NULL');
  const vault = has(c.profile, 'hr.vault');
  const docs = vault ? await c.db.query<HrDoc>('SELECT id, person_id, label, expires_on, file_name, mime, size, created_at FROM hr_doc WHERE deleted_at IS NULL ORDER BY person_id, label') : null;

  const alerts: HrAlert[] = [];
  const latest = conducts[0];
  for (const p of people.filter((x) => x.active)) {
    const ags = papers.filter((x) => x.person_id === p.id && x.kind === 'agreement');
    const current = ags.filter((x) => (!x.start_date || x.start_date <= today) && (!x.end_date || x.end_date >= today));
    const ending = current.map((x) => x.end_date).filter((x): x is string => !!x).sort()[0];
    const futureStarted = ags.some((x) => x.start_date && x.start_date > today);
    if (!current.length && !futureStarted) alerts.push({ kind: 'agreement_missing', person_id: p.id, item_id: null, date: null, days: null });
    else if (ending && daysTo(ending, today) <= SOON && !futureStarted && !ags.some((x) => x.start_date && x.start_date > ending)) alerts.push({ kind: 'agreement_ending', person_id: p.id, item_id: current.find((x) => x.end_date === ending)!.id, date: ending, days: daysTo(ending, today) });
    if (latest && !signs.some((x) => x.person_id === p.id && x.conduct_id === latest.id)) alerts.push({ kind: 'conduct_unsigned', person_id: p.id, item_id: latest.id, date: null, days: null });
    for (const x of papers.filter((q) => q.person_id === p.id && !q.file_name)) alerts.push({ kind: 'unsigned_paper', person_id: p.id, item_id: x.id, date: x.start_date ?? x.paid_on, days: null });
  }
  for (const d of docs ?? []) if (d.expires_on && daysTo(d.expires_on, today) <= SOON && people.find((p) => p.id === d.person_id)?.active) alerts.push({ kind: 'doc_expiring', person_id: d.person_id, item_id: d.id, date: d.expires_on, days: daysTo(d.expires_on, today) });
  return { kind: await getMeta(c.db, 'kind'), people, papers, conducts, signs, docs, alerts };
}

// ---------------------------------------------------------------- writing

async function requireHr(db: Db) {
  if ((await getMeta(db, 'kind')) !== 'hr') throw new UserError(m('هذه ليست قاعدة الموارد البشرية', 'This is not the HR database', "Ce n'est pas la base RH"));
}
const can = (c: OpCtx, p: Perm) => has(c.profile, p);
const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
const needView = (c: OpCtx) => { if (!can(c, 'hr.view')) throw refuse(); };
const needManage = (c: OpCtx) => { if (!can(c, 'hr.manage')) throw refuse(); };
const needVault = (c: OpCtx) => { if (!can(c, 'hr.vault')) throw refuse(); };
const txt = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim());
const day = (x: unknown, what: string) => {
  const s = txt(x);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UserError(m(`تاريخ غير صالح: ${what}`, `Not a valid date: ${what}`, `Date non valide : ${what}`));
  return s;
};
const logStmt = (c: OpCtx, action: string, what: string, personId: number | null, itemId: number | null, detail?: string): Stmt => ({
  sql: 'INSERT INTO hr_access_log (at, who, action, what, person_id, item_id, detail) VALUES (?,?,?,?,?,?,?)',
  params: [nowIso(), c.who, action, what, personId, itemId, detail ?? null],
});

export const HR_MAX_FILE = 15 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
const bytesToB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const safeName = (n: string, ext: string) => {
  const base = n.replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'file';
  return `${base}.${ext}`;
};

/** Stores a scan under hr/<random>.<ext> and returns what the table keeps. */
async function storeFile(c: OpCtx, a: { base64: string; mime: string; name?: string }) {
  const ext = FILE_TYPES[a.mime];
  if (!ext) throw new UserError(m('نوع الملف غير مقبول (PDF أو صورة)', 'File type not accepted (PDF or picture)', 'Type de fichier non accepté (PDF ou image)'));
  const bytes = b64ToBytes(a.base64);
  if (!bytes.length) throw new UserError(m('الملف فارغ', 'The file is empty', 'Le fichier est vide'));
  if (bytes.length > HR_MAX_FILE) throw new UserError(m('الملف أكبر من 15 م.ب', 'The file is larger than 15 MB', 'Le fichier dépasse 15 Mo'));
  let rel = '';
  do rel = `hr/${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.${ext}`;
  while (await c.files.docExists(rel));
  await c.files.docWrite(rel, bytes);
  return { file: rel, file_name: safeName(a.name ?? 'scan', ext), mime: a.mime, size: bytes.length };
}

type FileKind = 'paper' | 'conduct' | 'sign' | 'doc';
const TABLE: Record<FileKind, string> = { paper: 'hr_paper', conduct: 'hr_conduct', sign: 'hr_conduct_sign', doc: 'hr_doc' };

async function personOf(c: OpCtx, kind: FileKind, id: number): Promise<number | null> {
  if (kind === 'conduct') return null;
  return (await one<{ person_id: number }>(c.db, `SELECT person_id FROM ${TABLE[kind]} WHERE id = ?`, [id]))?.person_id ?? null;
}

export const HR_OPS = {
  'hr.data': { check: needView, run: (c: OpCtx, a?: { today?: string }) => hrData(c, a?.today) },

  'hr.person.save': {
    check: needManage,
    run: async (c: OpCtx, a: Partial<HrPerson> & { name: string }) => {
      await requireHr(c.db);
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب الاسم', 'Write the name', 'Écrivez le nom'));
      const v = [name, txt(a.father_name), txt(a.national_id), txt(a.birth_place), day(a.birth_date, 'birth'), txt(a.address), txt(a.phone), txt(a.role), txt(a.centre), day(a.started, 'start'), day(a.ended, 'end'), a.ended ? 0 : a.active === 0 ? 0 : 1, txt(a.note)];
      if (a.id) {
        const before = await one<HrPerson>(c.db, 'SELECT * FROM hr_person WHERE id = ?', [a.id]);
        if (!before) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
        await c.db.batch([
          { sql: 'UPDATE hr_person SET name=?, father_name=?, national_id=?, birth_place=?, birth_date=?, address=?, phone=?, role=?, centre=?, started=?, ended=?, active=?, note=? WHERE id=?', params: [...v, a.id] },
          auditStmt(c.who, 'update', 'hr_person', String(a.id), { name: before.name, active: before.active }, { name, active: v[11] }),
        ]);
        return { id: a.id };
      }
      await c.db.batch([
        { sql: 'INSERT INTO hr_person (name, father_name, national_id, birth_place, birth_date, address, phone, role, centre, started, ended, active, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', params: [...v, nowIso(), c.who] },
        auditStmt(c.who, 'add', 'hr_person', null, null, { name }),
      ]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_person'))!.id };
    },
  },

  'hr.paper.save': {
    check: needManage,
    run: async (c: OpCtx, a: { id?: number | null; personId: number; kind: 'agreement' | 'stipend'; start?: string | null; end?: string | null; service?: string | null; amount?: number | null; currency?: 'USD' | 'SYP'; paidOn?: string | null; note?: string | null }) => {
      await requireHr(c.db);
      if (!(await one(c.db, 'SELECT 1 AS x FROM hr_person WHERE id = ?', [a.personId]))) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      if (a.kind !== 'agreement' && a.kind !== 'stipend') throw new UserError(m('نوع غير معروف', 'Unknown kind', 'Type inconnu'));
      const start = day(a.start, 'start'), end = day(a.end, 'end'), paidOn = day(a.paidOn, 'payment');
      if (start && end && end < start) throw new UserError(m('النهاية قبل البداية', 'The end is before the start', 'La fin est avant le début'));
      const amount = a.amount == null || a.amount === ('' as unknown) ? null : Number(a.amount);
      if (amount != null && !(amount >= 0)) throw new UserError(m('مبلغ غير صالح', 'Not a valid amount', 'Montant non valide'));
      if (a.kind === 'stipend' && !txt(a.service)) throw new UserError(m('اكتب الخدمة التي تخصها المكافأة', 'Write the service this stipend is for', 'Écrivez le service concerné'));
      const cur = a.currency === 'SYP' ? 'SYP' : 'USD';
      const v = [a.personId, a.kind, start, a.kind === 'stipend' ? null : end, txt(a.service), amount, cur, a.kind === 'stipend' ? paidOn : null, txt(a.note)];
      if (a.id) {
        const row = await one<{ id: number }>(c.db, 'SELECT id FROM hr_paper WHERE id = ? AND deleted_at IS NULL', [a.id]);
        if (!row) throw new UserError(m('الورقة غير موجودة', 'Paper not found', 'Document introuvable'));
        await c.db.batch([{ sql: 'UPDATE hr_paper SET person_id=?, kind=?, start_date=?, end_date=?, service=?, amount=?, currency=?, paid_on=?, note=? WHERE id=?', params: [...v, a.id] }, auditStmt(c.who, 'update', 'hr_paper', String(a.id), null, { kind: a.kind })]);
        return { id: a.id };
      }
      await c.db.batch([
        { sql: 'INSERT INTO hr_paper (person_id, kind, start_date, end_date, service, amount, currency, paid_on, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', params: [...v, nowIso(), c.who] },
        auditStmt(c.who, 'add', 'hr_paper', null, null, { kind: a.kind, person: a.personId }),
      ]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_paper'))!.id };
    },
  },
  'hr.paper.delete': {
    check: needManage,
    run: async (c: OpCtx, a: { id: number }) => {
      const p = await one<{ person_id: number }>(c.db, 'SELECT person_id FROM hr_paper WHERE id = ? AND deleted_at IS NULL', [a.id]);
      if (!p) throw new UserError(m('الورقة غير موجودة', 'Paper not found', 'Document introuvable'));
      await c.db.batch([{ sql: 'UPDATE hr_paper SET deleted_at = ? WHERE id = ?', params: [nowIso(), a.id] }, logStmt(c, 'delete', 'paper', p.person_id, a.id), auditStmt(c.who, 'delete', 'hr_paper', String(a.id), null, null)]);
      return { ok: true };
    },
  },

  'hr.conduct.save': {
    check: needManage,
    run: async (c: OpCtx, a: { id?: number | null; version: string; validFrom: string; note?: string | null }) => {
      await requireHr(c.db);
      const version = txt(a.version);
      const from = day(a.validFrom, 'valid from');
      if (!version || !from) throw new UserError(m('اكتب رقم النسخة وتاريخها', 'Write the version and its date', 'Écrivez la version et sa date'));
      if (a.id) {
        await c.db.batch([{ sql: 'UPDATE hr_conduct SET version=?, valid_from=?, note=? WHERE id=?', params: [version, from, txt(a.note), a.id] }, auditStmt(c.who, 'update', 'hr_conduct', String(a.id), null, { version })]);
        return { id: a.id };
      }
      await c.db.batch([{ sql: 'INSERT INTO hr_conduct (version, valid_from, note, created_at, created_by) VALUES (?,?,?,?,?)', params: [version, from, txt(a.note), nowIso(), c.who] }, auditStmt(c.who, 'add', 'hr_conduct', null, null, { version })]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_conduct'))!.id };
    },
  },
  'hr.conduct.sign': {
    check: needManage,
    run: async (c: OpCtx, a: { conductId: number; personId: number; signedOn: string }) => {
      await requireHr(c.db);
      const on = day(a.signedOn, 'signature');
      if (!on) throw new UserError(m('اكتب تاريخ التوقيع', 'Write the date of the signature', 'Écrivez la date de signature'));
      if (!(await one(c.db, 'SELECT 1 AS x FROM hr_conduct WHERE id = ?', [a.conductId])) || !(await one(c.db, 'SELECT 1 AS x FROM hr_person WHERE id = ?', [a.personId]))) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
      if (await one(c.db, 'SELECT 1 AS x FROM hr_conduct_sign WHERE conduct_id = ? AND person_id = ? AND deleted_at IS NULL', [a.conductId, a.personId])) throw new UserError(m('وقّع هذه النسخة من قبل', 'Already signed this version', 'A déjà signé cette version'));
      await c.db.batch([{ sql: 'INSERT INTO hr_conduct_sign (conduct_id, person_id, signed_on, created_at, created_by) VALUES (?,?,?,?,?)', params: [a.conductId, a.personId, on, nowIso(), c.who] }, auditStmt(c.who, 'add', 'hr_conduct_sign', null, null, { conduct: a.conductId, person: a.personId })]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_conduct_sign'))!.id };
    },
  },
  'hr.conduct.unsign': {
    check: needManage,
    run: async (c: OpCtx, a: { id: number }) => {
      await c.db.batch([{ sql: 'UPDATE hr_conduct_sign SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', params: [nowIso(), a.id] }, auditStmt(c.who, 'delete', 'hr_conduct_sign', String(a.id), null, null)]);
      return { ok: true };
    },
  },

  // a scan on a paper, a version of the code of conduct, or a signature
  'hr.file.add': {
    check: needManage,
    run: async (c: OpCtx, a: { kind: 'paper' | 'conduct' | 'sign'; id: number; base64: string; mime: string; name?: string }) => {
      if (!(a.kind in TABLE) || (a.kind as string) === 'doc') throw new UserError(m('نوع غير معروف', 'Unknown kind', 'Type inconnu'));
      const row = await one<{ id: number }>(c.db, `SELECT id FROM ${TABLE[a.kind]} WHERE id = ?`, [a.id]);
      if (!row) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
      const f = await storeFile(c, a);
      await c.db.batch([
        { sql: `UPDATE ${TABLE[a.kind]} SET file = ?, file_name = ?, mime = ?, size = ? WHERE id = ?`, params: [f.file, f.file_name, f.mime, f.size, a.id] },
        logStmt(c, 'add', a.kind, await personOf(c, a.kind, a.id), a.id, f.file_name),
      ]);
      return { name: f.file_name };
    },
  },
  'hr.file.get': {
    check: (c: OpCtx) => needView(c),
    run: async (c: OpCtx, a: { kind: FileKind; id: number }) => {
      if (!(a.kind in TABLE)) throw new UserError(m('نوع غير معروف', 'Unknown kind', 'Type inconnu'));
      if (a.kind === 'doc') needVault(c);
      const d = await one<{ file: string | null; file_name: string | null; mime: string | null }>(c.db, `SELECT file, file_name, mime FROM ${TABLE[a.kind]} WHERE id = ?${a.kind === 'conduct' ? '' : ' AND deleted_at IS NULL'}`, [a.id]);
      if (!d?.file) throw new UserError(m('لا ملف', 'No file', 'Pas de fichier'));
      await c.db.batch([logStmt(c, 'open', a.kind, await personOf(c, a.kind, a.id), a.id, d.file_name ?? undefined)]);
      return { name: d.file_name ?? 'file', mime: d.mime ?? 'application/octet-stream', base64: bytesToB64(await c.files.docRead(d.file)) };
    },
  },

  'hr.vault.add': {
    check: needVault,
    run: async (c: OpCtx, a: { personId: number; label: string; expiresOn?: string | null; base64: string; mime: string; name?: string }) => {
      await requireHr(c.db);
      if (!(await one(c.db, 'SELECT 1 AS x FROM hr_person WHERE id = ?', [a.personId]))) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      const label = txt(a.label);
      if (!label) throw new UserError(m('اكتب نوع الوثيقة', 'Write what the document is', 'Écrivez de quel document il s’agit'));
      const exp = day(a.expiresOn, 'expiry');
      const f = await storeFile(c, a);
      await c.db.batch([
        { sql: 'INSERT INTO hr_doc (person_id, label, expires_on, file, file_name, mime, size, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)', params: [a.personId, label, exp, f.file, f.file_name, f.mime, f.size, nowIso(), c.who] },
        logStmt(c, 'add', 'doc', a.personId, null, `${label} · ${f.file_name}`),
      ]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_doc'))!.id };
    },
  },
  'hr.vault.save': {
    check: needVault,
    run: async (c: OpCtx, a: { id: number; label: string; expiresOn?: string | null }) => {
      const label = txt(a.label);
      if (!label) throw new UserError(m('اكتب نوع الوثيقة', 'Write what the document is', 'Écrivez de quel document il s’agit'));
      await c.db.batch([{ sql: 'UPDATE hr_doc SET label = ?, expires_on = ? WHERE id = ? AND deleted_at IS NULL', params: [label, day(a.expiresOn, 'expiry'), a.id] }, logStmt(c, 'edit', 'doc', await personOf(c, 'doc', a.id), a.id, label)]);
      return { ok: true };
    },
  },
  'hr.vault.delete': {
    check: needVault,
    run: async (c: OpCtx, a: { id: number }) => {
      await c.db.batch([{ sql: 'UPDATE hr_doc SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', params: [nowIso(), a.id] }, logStmt(c, 'delete', 'doc', await personOf(c, 'doc', a.id), a.id)]);
      return { ok: true };
    },
  },
  'hr.access.list': {
    check: needVault,
    run: (c: OpCtx) => c.db.query<{ id: number; at: string; who: string; action: string; what: string; person_id: number | null; item_id: number | null; detail: string | null }>('SELECT * FROM hr_access_log ORDER BY id DESC LIMIT 500'),
  },
};
export const HR_READ_ONLY = ['hr.data', 'hr.access.list'];
