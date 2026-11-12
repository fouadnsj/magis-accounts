// The HR database (Fouad, 30 October 2026): a separate, private database (kind 'hr'). Stage 1:
// people, yearly volunteer agreements, one-time stipend letters, the code of conduct (each version,
// who signed it), and a vault of document copies (IDs...) where every opening is logged.
// Minimum personal data. Nothing is ever hard-deleted: a person is made inactive; a removed scan
// stays on the disk and in the log. No money is paid from here yet (payroll is a later stage).

import { type Db, type Stmt, migrate, nowIso, one } from '../db/db';
import { auditStmt, getMeta, setMetaStmt, UserError } from '../db/repo';
import { checkSecretShape, has, hashSecret, profileStmt } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import { HR_ADMIN_PERMS, HR_PERM_GROUPS, type Perm } from '../perms';
import { centreCodes, needAll, needCentre, needPerson, needRight, scopeOf, sees, seesAll, seenPeople } from './scope';

export const HR_PERMS: Perm[] = [...HR_PERM_GROUPS.flatMap((g) => g.perms.map((p) => p.key)), ...HR_ADMIN_PERMS];

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
    { sql: 'INSERT INTO access_profile (id, name, perms, sort) VALUES (2, ?, ?, 2)', params: ['قارئ · Reader · Lecteur', JSON.stringify(['hr.view', 'hr.details'])] },
    // the HR keeper of a centre (sees only the centres given to the user), the Superior, the MAGIS manager (Fouad, 31 October 2026)
    { sql: 'INSERT INTO access_profile (id, name, perms, sort) VALUES (3, ?, ?, 3)', params: ["مسؤول الموارد البشرية في مركز · HR keeper of a centre · Responsable RH d'un centre", JSON.stringify(['hr.view', 'hr.details', 'hr.manage', 'hr.vault', 'hr.salary', 'hr.agreements', 'hr.scale', 'hr.sessions', 'hr.pay', 'data.export'])] },
    { sql: 'INSERT INTO access_profile (id, name, perms, sort) VALUES (4, ?, ?, 4)', params: ['الرئيس · Superior · Supérieur', JSON.stringify(['hr.view', 'hr.details', 'hr.manage', 'hr.vault', 'hr.salary', 'hr.agreements', 'hr.scale', 'hr.sessions', 'hr.pay', 'hr.approve', 'hr.paid', 'hr.hourly', 'hr.donors', 'hr.reports', 'data.export', 'audit.view'])] },
    { sql: 'INSERT INTO access_profile (id, name, perms, sort) VALUES (5, ?, ?, 5)', params: ['مدير ماجيس · MAGIS manager · Directeur MAGIS', JSON.stringify(HR_PERMS)] },
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

export interface HrPerson { id: number; name: string; name_ar: string | null; first_name: string | null; last_name: string | null; father_name: string | null; first_name_ar: string | null; last_name_ar: string | null; father_name_ar: string | null; address_ar: string | null; national_id: string | null; birth_place: string | null; birth_date: string | null; address: string | null; phone: string | null; role: string | null; centre: string | null; account: string | null; budget_line: string | null; started: string | null; ended: string | null; active: number; note: string | null; /** staff (with an agreement) or tutor (paid by session) */ category: 'staff' | 'tutor'; /** a tutor's usual activity */ activity: string | null }
export interface HrPaper { id: number; person_id: number; kind: 'agreement' | 'stipend'; start_date: string | null; end_date: string | null; service: string | null; amount: number | null; currency: 'USD' | 'SYP'; paid_on: string | null; note: string | null; file_name: string | null; size: number | null; created_at: string; position: string | null; weekly_hours: number | null }
export interface HrConduct { id: number; version: string; valid_from: string; note: string | null; file_name: string | null; size: number | null }
export interface HrSign { id: number; conduct_id: number; person_id: number; signed_on: string; file_name: string | null; size: number | null }
export interface HrDoc { id: number; person_id: number; label: string; expires_on: string | null; file_name: string; mime: string; size: number; created_at: string }
export interface HrAlert { kind: 'agreement_ending' | 'agreement_missing' | 'doc_expiring' | 'conduct_unsigned' | 'unsigned_paper' | 'insurance_ending'; person_id: number; item_id: number | null; date: string | null; days: number | null }
/** an item of the lists; a centre also carries its heading on the documents (code = its mark: jaramana | aleppo | homs | other) */
export interface HrListItem { id: number; kind: 'centre' | 'account' | 'line'; /** a line a centre pays its tutors on */ tutor: number; name: string; code: string | null; heading: string | null; source: string | null; salary_heading: string | null; account: string | null; party_ar: string | null; party_en: string | null; rep_ar: string | null; rep_en: string | null; city_ar: string | null; city_en: string | null; /** an account: the donors who fund it (from the grants in the accounts), joined by " | " */ donors: string | null }
/** a thing to do when someone arrives or leaves (the list is kept in the settings) */
export interface HrCheckItem { id: number; kind: 'arrival' | 'leaving'; label_ar: string | null; label_en: string; sort: number; active: number }
export interface HrCheckDone { person_id: number; item_id: number; done_on: string; done_by: string | null; note: string | null }
/** a kind of leave (prepared for later) */
export interface HrLeaveType { id: number; name_ar: string | null; name_en: string; days_per_year: number | null; paid: number; active: number }
export interface HrData {
  /** the stored lists the person's centre, account and budget line are chosen from (filled from the budgets) */
  lists: HrListItem[];
  /** the positions of the scale (names only), the roles a person can have, and their Arabic names */
  positions: string[];
  positionsAr: Record<string, string>;
  /** the positions with their centre (null = shared by every centre): a person chooses among those of their centre */
  grades: { name: string; name_ar: string | null; centre: string | null }[];
  /** the centres this user sees (codes); null = every centre */
  scope: string[] | null;
  checkItems: HrCheckItem[];
  checksDone: HrCheckDone[];
  leaveTypes: HrLeaveType[];
  /** the names that sign the documents */
  docSettings: { repAr: string; repEn: string };
  kind: string | null;
  people: HrPerson[];
  papers: HrPaper[];
  conducts: HrConduct[];
  signs: HrSign[];
  /** the vault list: only for those who may open it */
  docs: HrDoc[] | null;
  alerts: HrAlert[];
}

const PAPER_COLS = 'id, person_id, kind, start_date, end_date, service, amount, currency, paid_on, note, file_name, size, created_at, position, weekly_hours';
const SOON = 60;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysTo = (date: string, today: string) => Math.round((Date.parse(date) - Date.parse(today)) / 86400e3);

export async function hrData(c: OpCtx, today = isoDay(new Date())): Promise<HrData> {
  await requireHr(c.db);
  // only the people of the user's centres, and what is theirs
  const seen = await seenPeople(c);
  const mine = <T extends { person_id: number }>(xs: T[]) => (seen ? xs.filter((x) => seen.has(x.person_id)) : xs);
  const people = (await c.db.query<HrPerson>('SELECT id, name, first_name, last_name, father_name, first_name_ar, last_name_ar, father_name_ar, address_ar, national_id, birth_place, birth_date, address, phone, role, centre, account, budget_line, started, ended, active, note, category, activity FROM hr_person ORDER BY active DESC, name')).filter((p) => !seen || seen.has(p.id)).map((p) => ({ ...p, name_ar: [p.first_name_ar, p.last_name_ar].filter(Boolean).join(' ') || null }))
    // the personal details only for those who see them (Fouad, 1 November 2026)
    .map((p) => (has(c.profile, 'hr.details') ? p : { ...p, national_id: null, birth_place: null, birth_date: null, address: null, address_ar: null, phone: null }));
  const papers = mine(await c.db.query<HrPaper>(`SELECT ${PAPER_COLS} FROM hr_paper WHERE deleted_at IS NULL ORDER BY COALESCE(start_date, paid_on, created_at) DESC, id DESC`))
    // the amounts only for those who see them
    .map((x) => (has(c.profile, 'hr.salary') ? x : { ...x, amount: null }));
  const conducts = await c.db.query<HrConduct>('SELECT id, version, valid_from, note, file_name, size FROM hr_conduct ORDER BY valid_from DESC, id DESC');
  const signs = mine(await c.db.query<HrSign>('SELECT id, conduct_id, person_id, signed_on, file_name, size FROM hr_conduct_sign WHERE deleted_at IS NULL'));
  const vault = has(c.profile, 'hr.vault');
  const docs = vault ? mine(await c.db.query<HrDoc>('SELECT id, person_id, label, expires_on, file_name, mime, size, created_at FROM hr_doc WHERE deleted_at IS NULL ORDER BY person_id, label')) : null;

  const alerts: HrAlert[] = [];
  const latest = conducts[0];
  for (const p of people.filter((x) => x.active)) {
    const ags = papers.filter((x) => x.person_id === p.id && x.kind === 'agreement');
    const current = ags.filter((x) => (!x.start_date || x.start_date <= today) && (!x.end_date || x.end_date >= today));
    const ending = current.map((x) => x.end_date).filter((x): x is string => !!x).sort()[0];
    const futureStarted = ags.some((x) => x.start_date && x.start_date > today);
    // a tutor is paid by session, without an agreement
    if (p.category !== 'tutor' && !current.length && !futureStarted) alerts.push({ kind: 'agreement_missing', person_id: p.id, item_id: null, date: null, days: null });
    else if (ending && daysTo(ending, today) <= SOON && !futureStarted && !ags.some((x) => x.start_date && x.start_date > ending)) alerts.push({ kind: 'agreement_ending', person_id: p.id, item_id: current.find((x) => x.end_date === ending)!.id, date: ending, days: daysTo(ending, today) });
    if (latest && !signs.some((x) => x.person_id === p.id && x.conduct_id === latest.id)) alerts.push({ kind: 'conduct_unsigned', person_id: p.id, item_id: latest.id, date: null, days: null });
    for (const x of papers.filter((q) => q.person_id === p.id && !q.file_name)) alerts.push({ kind: 'unsigned_paper', person_id: p.id, item_id: x.id, date: x.start_date ?? x.paid_on, days: null });
  }
  for (const d of docs ?? []) if (d.expires_on && daysTo(d.expires_on, today) <= SOON && people.find((p) => p.id === d.person_id)?.active) alerts.push({ kind: 'doc_expiring', person_id: d.person_id, item_id: d.id, date: d.expires_on, days: daysTo(d.expires_on, today) });
  // the health insurance ending (or ended): only for those who see the pay
  if (has(c.profile, 'hr.pay'))
    for (const x of await c.db.query<{ id: number; person_id: number; end_date: string }>('SELECT id, person_id, end_date FROM hr_insurance WHERE deleted_at IS NULL AND end_date IS NOT NULL'))
      if (daysTo(x.end_date, today) <= SOON && people.find((p) => p.id === x.person_id)?.active) alerts.push({ kind: 'insurance_ending', person_id: x.person_id, item_id: x.id, date: x.end_date, days: daysTo(x.end_date, today) });
  const allLists = await c.db.query<HrListItem>('SELECT id, kind, tutor, name, code, heading, source, salary_heading, account, party_ar, party_en, rep_ar, rep_en, city_ar, city_en, donors FROM hr_list ORDER BY kind, code, name');
  // the centres seen, and the accounts and lines of their budgets
  const seenSources = new Set(allLists.filter((x) => x.kind === 'centre' && sees(c, x.code)).map((x) => x.source).filter(Boolean));
  const lists = seesAll(c) ? allLists : allLists.filter((x) => (x.kind === 'centre' ? sees(c, x.code) : !!x.source && seenSources.has(x.source)));
  const grades = (await c.db.query<{ name: string; name_ar: string | null; centre: string | null }>('SELECT name, name_ar, centre FROM hr_grade WHERE active = 1 ORDER BY sort, id')).filter((g) => g.centre == null || sees(c, g.centre));
  const positions = [...new Set(grades.map((g) => g.name))];
  const positionsAr = Object.fromEntries(grades.filter((g) => g.name_ar).map((g) => [g.name, g.name_ar!]));
  const checkItems = await c.db.query<HrCheckItem>('SELECT id, kind, label_ar, label_en, sort, active FROM hr_check_item ORDER BY kind, sort, id');
  const checksDone = mine(await c.db.query<HrCheckDone>('SELECT person_id, item_id, done_on, done_by, note FROM hr_check_done'));
  const leaveTypes = await c.db.query<HrLeaveType>('SELECT id, name_ar, name_en, days_per_year, paid, active FROM hr_leave_type ORDER BY sort, id');
  const setting = async (k: string, d: string) => (await one<{ value: string | null }>(c.db, 'SELECT value FROM setting WHERE key = ?', [k]))?.value ?? d;
  const docSettings = { repAr: await setting('hr_rep_ar', 'الأب فؤاد نخلة اليسوعي'), repEn: await setting('hr_rep_en', '') };
  return { kind: await getMeta(c.db, 'kind'), people, papers, conducts, signs, docs, alerts, lists, positions, positionsAr, grades, scope: scopeOf(c), checkItems, checksDone, leaveTypes, docSettings };
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
      // the names in Arabic and in English (the agreement is filled in both); at least one first name
      const first = txt(a.first_name ?? (a.first_name_ar === undefined ? a.name : null)), last = txt(a.last_name);
      const firstAr = txt(a.first_name_ar), lastAr = txt(a.last_name_ar);
      if (!first && !firstAr) throw new UserError(m('اكتب الاسم', 'Write the first name', 'Écrivez le prénom'));
      const name = [first, last].filter(Boolean).join(' ') || [firstAr, lastAr].filter(Boolean).join(' ');
      // the role, centre, account and budget line are chosen from stored lists (when the list has something)
      const pick = async (kind: 'centre' | 'account' | 'line', value: string | null) => {
        if (!value) return null;
        const items = await c.db.query<{ name: string; code: string | null }>('SELECT name, code FROM hr_list WHERE kind = ?', [kind]);
        if (items.length && !items.some((i) => (kind === 'line' && i.code ? `${i.code} · ${i.name}` : i.name) === value)) throw new UserError(m('اختر من القائمة', `Choose from the list: ${value}`, `Choisissez dans la liste : ${value}`));
        return value;
      };
      // a person of the user's centres only, and moved only to one of them
      await needPerson(c, a.id);
      const code = txt(a.centre) ? (await centreCodes(c)).get(txt(a.centre)!) ?? null : null;
      if (!seesAll(c) && !txt(a.centre)) throw new UserError(m('اختر المركز', 'Choose the centre', 'Choisissez le centre'));
      needCentre(c, code);
      const role = txt(a.role);
      if (role && (await one(c.db, 'SELECT 1 AS x FROM hr_grade LIMIT 1')) && !(await one(c.db, 'SELECT 1 AS x FROM hr_grade WHERE name = ? AND (centre IS NULL OR centre IS ?)', [role, code]))) throw new UserError(m('الدور من سلّم الرواتب', `The role must be a position of the scale: ${role}`, `Le rôle doit être un poste de l'échelle : ${role}`));
      const category = a.category === 'tutor' ? 'tutor' : a.category === 'staff' ? 'staff' : null;
      const v = [name, txt(a.father_name), txt(a.national_id), txt(a.birth_place), day(a.birth_date, 'birth'), txt(a.address), txt(a.phone), role, await pick('centre', txt(a.centre)), await pick('account', txt(a.account)), await pick('line', txt(a.budget_line)), day(a.started, 'start'), day(a.ended, 'end'), a.ended ? 0 : a.active === 0 ? 0 : 1, txt(a.note), first, last, firstAr, lastAr, txt(a.father_name_ar), txt(a.address_ar)];
      const ACT = 13;
      if (a.id) {
        const before = await one<HrPerson>(c.db, 'SELECT * FROM hr_person WHERE id = ?', [a.id]);
        if (!before) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
        // who does not see the personal details does not change them (they came to the screen empty)
        if (!has(c.profile, 'hr.details')) { v[2] = before.national_id; v[3] = before.birth_place; v[4] = before.birth_date; v[5] = before.address; v[6] = before.phone; v[20] = before.address_ar; }
        await c.db.batch([
          { sql: 'UPDATE hr_person SET name=?, father_name=?, national_id=?, birth_place=?, birth_date=?, address=?, phone=?, role=?, centre=?, account=?, budget_line=?, started=?, ended=?, active=?, note=?, first_name=?, last_name=?, first_name_ar=?, last_name_ar=?, father_name_ar=?, address_ar=?, category=COALESCE(?, category), activity=? WHERE id=?', params: [...v, category, a.activity === undefined ? before.activity : txt(a.activity), a.id] },
          auditStmt(c.who, 'update', 'hr_person', String(a.id), { name: before.name, active: before.active }, { name, active: v[ACT] }),
        ]);
        return { id: a.id };
      }
      await c.db.batch([
        { sql: 'INSERT INTO hr_person (name, father_name, national_id, birth_place, birth_date, address, phone, role, centre, account, budget_line, started, ended, active, note, first_name, last_name, first_name_ar, last_name_ar, father_name_ar, address_ar, category, activity, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', params: [...v, category ?? 'staff', txt(a.activity), nowIso(), c.who] },
        auditStmt(c.who, 'add', 'hr_person', null, null, { name }),
      ]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_person'))!.id };
    },
  },

  // Deleting a person (Fouad, 30 October 2026): everything about them goes (agreements, stipend, insurance, the list of
  // their documents, signatures). Refused once they are in an approved or paid payroll run: that history belongs to the
  // accounts, so they are marked as having left instead. Their lines in a draft run go with them.
  'hr.person.delete': {
    check: needManage,
    run: async (c: OpCtx, a: { id: number }) => {
      await requireHr(c.db);
      await needPerson(c, a.id);
      const p = await one<{ name: string }>(c.db, 'SELECT name FROM hr_person WHERE id = ?', [a.id]);
      if (!p) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      if (await one(c.db, "SELECT 1 AS x FROM hr_run_line l JOIN hr_run r ON r.id = l.run_id WHERE l.person_id = ? AND r.status IN ('approved','paid')", [a.id]))
        throw new UserError(m('دُفعت له مكافآت في كشف معتمد: لا يُحذف. اكتب تاريخ مغادرته بدلاً من ذلك.', 'This person is in an approved or paid payroll run: they cannot be deleted. Write the date they left instead.', "Cette personne figure dans une paie approuvée ou payée : elle ne peut pas être supprimée. Indiquez plutôt la date de départ."));
      const del = (table: string) => ({ sql: `DELETE FROM ${table} WHERE person_id = ?`, params: [a.id] });
      await c.db.batch([
        del('hr_session'), del('hr_run_line'), del('hr_pay'), del('hr_alloc'), del('hr_hours'), del('hr_insurance'), del('hr_conduct_sign'), del('hr_doc'), del('hr_check_done'), del('hr_leave'), del('hr_paper'),
        { sql: 'DELETE FROM hr_person WHERE id = ?', params: [a.id] },
        logStmt(c, 'delete', 'person', a.id, a.id, p.name),
        auditStmt(c.who, 'delete', 'hr_person', String(a.id), { name: p.name }, null),
      ]);
      return { ok: true };
    },
  },

  // the lists can also be added to by hand, or cleaned
  'hr.list.save': {
    check: needManage,
    run: async (c: OpCtx, a: { id?: number | null; kind: 'centre' | 'account' | 'line'; name: string; code?: string | null; heading?: string | null; salary_heading?: string | null; account?: string | null; party_ar?: string | null; party_en?: string | null; rep_ar?: string | null; rep_en?: string | null; city_ar?: string | null; city_en?: string | null }) => {
      if (!['centre', 'account', 'line'].includes(a.kind)) throw new UserError(m('نوع غير معروف', 'Unknown kind', 'Type inconnu'));
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب الاسم', 'Write the name', 'Écrivez le nom'));
      if (a.kind === 'centre' && a.code && !['jaramana', 'aleppo', 'homs', 'other'].includes(a.code)) throw new UserError(m('مركز غير معروف', 'Unknown centre', 'Centre inconnu'));
      // the heading of one's own centre can be changed; the rest of the lists by those who see every centre
      if (a.kind === 'centre' && a.id) { needCentre(c, (await one<{ code: string | null }>(c.db, 'SELECT code FROM hr_list WHERE id = ?', [a.id]))?.code); needCentre(c, txt(a.code)); } else needAll(c);
      const doc = [txt(a.party_ar), txt(a.party_en), txt(a.rep_ar), txt(a.rep_en), txt(a.city_ar), txt(a.city_en)];
      if (a.id) {
        const before = await one<{ kind: string; name: string; code: string | null }>(c.db, 'SELECT kind, name, code FROM hr_list WHERE id = ?', [a.id]);
        if (!before) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
        const label = (n: string, code: string | null) => (before.kind === 'line' && code ? `${code} · ${n}` : n);
        const field = before.kind === 'centre' ? 'centre' : before.kind === 'account' ? 'account' : 'budget_line';
        await c.db.batch([
          { sql: 'UPDATE hr_list SET name = ?, code = ?, heading = ?, party_ar = ?, party_en = ?, rep_ar = ?, rep_en = ?, city_ar = ?, city_en = ?, salary_heading = ?, account = ? WHERE id = ?', params: [name, txt(a.code), txt(a.heading), ...doc, txt(a.salary_heading), txt(a.account), a.id] },
          // the people keep their choice when its name changes
          { sql: `UPDATE hr_person SET ${field} = ? WHERE ${field} = ?`, params: [label(name, txt(a.code)), label(before.name, before.code)] },
        ]);
        return { id: a.id };
      }
      await c.db.batch([{ sql: 'INSERT OR IGNORE INTO hr_list (kind, name, code, heading, party_ar, party_en, rep_ar, rep_en, city_ar, city_en, account) VALUES (?,?,?,?,?,?,?,?,?,?,?)', params: [a.kind, name, txt(a.code), txt(a.heading), ...doc, txt(a.account)] }]);
      return { ok: true };
    },
  },
  // the lines a centre pays its tutors on (Fouad, 2026-11-02): ticked once per centre, offered on the tutors' cards
  'hr.list.tutorLines': {
    check: needManage,
    run: async (c: OpCtx, a: { centreId: number; lineIds: number[] }) => {
      const centre = await one<{ code: string | null; source: string | null }>(c.db, "SELECT code, source FROM hr_list WHERE id = ? AND kind = 'centre'", [a.centreId]);
      if (!centre?.source) throw new UserError(m('مركز غير معروف', 'Unknown centre', 'Centre inconnu'));
      needCentre(c, centre.code);
      const ids = [...new Set((a.lineIds ?? []).map(Number).filter(Boolean))];
      await c.db.batch([
        { sql: "UPDATE hr_list SET tutor = CASE WHEN id IN (" + (ids.map(() => '?').join(',') || 'NULL') + ") THEN 1 ELSE 0 END WHERE kind = 'line' AND source = ?", params: [...ids, centre.source] },
        auditStmt(c.who, 'tutor_lines', 'hr_list', String(a.centreId), null, ids),
      ]);
      return { ok: true };
    },
  },
  'hr.list.delete': {
    check: needManage,
    run: async (c: OpCtx, a: { id: number }) => {
      needAll(c);
      await c.db.batch([{ sql: 'DELETE FROM hr_list WHERE id = ?', params: [a.id] }]);
      return { ok: true };
    },
  },
  'hr.docs.settings': {
    check: needManage,
    run: async (c: OpCtx, a: { repAr: string; repEn: string }) => {
      needAll(c);
      const put = (k: string, v: string) => ({ sql: 'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', params: [k, v] });
      await c.db.batch([put('hr_rep_ar', String(a.repAr ?? '').trim()), put('hr_rep_en', String(a.repEn ?? '').trim())]);
      return { ok: true };
    },
  },

  'hr.paper.save': {
    check: (c: OpCtx) => needRight(c, 'hr.agreements'),
    run: async (c: OpCtx, a: { id?: number | null; personId: number; kind: 'agreement' | 'stipend'; start?: string | null; end?: string | null; service?: string | null; amount?: number | null; currency?: 'USD' | 'SYP'; paidOn?: string | null; note?: string | null; position?: string | null; weeklyHours?: number | null }) => {
      await requireHr(c.db);
      if (!(await one(c.db, 'SELECT 1 AS x FROM hr_person WHERE id = ?', [a.personId]))) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      await needPerson(c, a.personId);
      if (a.id) await needPerson(c, (await one<{ person_id: number }>(c.db, 'SELECT person_id FROM hr_paper WHERE id = ?', [a.id]))?.person_id);
      if (a.kind !== 'agreement' && a.kind !== 'stipend') throw new UserError(m('نوع غير معروف', 'Unknown kind', 'Type inconnu'));
      const start = day(a.start, 'start'), end = day(a.end, 'end'), paidOn = day(a.paidOn, 'payment');
      if (start && end && end < start) throw new UserError(m('النهاية قبل البداية', 'The end is before the start', 'La fin est avant le début'));
      const amount = a.amount == null || a.amount === ('' as unknown) ? null : Number(a.amount);
      if (amount != null && !(amount >= 0)) throw new UserError(m('مبلغ غير صالح', 'Not a valid amount', 'Montant non valide'));
      if (a.kind === 'stipend' && !txt(a.service)) throw new UserError(m('اكتب الخدمة التي تخصها المكافأة', 'Write the service this stipend is for', 'Écrivez le service concerné'));
      const cur = a.currency === 'SYP' ? 'SYP' : 'USD';
      const agreement = a.kind === 'agreement';
      const position = agreement ? txt(a.position) : null;
      const weekly = agreement && a.weeklyHours != null && (a.weeklyHours as unknown) !== '' ? Number(a.weeklyHours) : null;
      if (weekly != null && !(weekly > 0 && weekly <= 84)) throw new UserError(m('ساعات الأسبوع غير صالحة', 'Not valid weekly hours', 'Heures par semaine non valides'));
      // the position of the person's centre, else the one shared by every centre
      const grade = position ? await one<{ id: number }>(c.db, "SELECT g.id FROM hr_grade g WHERE g.name = ? AND (g.centre IS NULL OR g.centre IS (SELECT l.code FROM hr_person p JOIN hr_list l ON l.kind = 'centre' AND l.name = p.centre WHERE p.id = ?)) ORDER BY g.centre IS NULL LIMIT 1", [position, a.personId]) : null;
      if (position && !grade && (await one(c.db, 'SELECT 1 AS x FROM hr_grade LIMIT 1'))) throw new UserError(m('الوظيفة من سلّم الرواتب', `The position must be one of the scale: ${position}`, `Le poste doit être un poste de l'échelle : ${position}`));
      const v = [a.personId, a.kind, start, agreement ? end : null, txt(a.service), amount, cur, agreement ? null : paidOn, txt(a.note), position, weekly];
      let id = a.id ?? null;
      if (id) {
        const row = await one<{ id: number }>(c.db, 'SELECT id FROM hr_paper WHERE id = ? AND deleted_at IS NULL', [id]);
        if (!row) throw new UserError(m('الورقة غير موجودة', 'Paper not found', 'Document introuvable'));
        await c.db.batch([{ sql: 'UPDATE hr_paper SET person_id=?, kind=?, start_date=?, end_date=?, service=?, amount=?, currency=?, paid_on=?, note=?, position=?, weekly_hours=? WHERE id=?', params: [...v, id] }, auditStmt(c.who, 'update', 'hr_paper', String(id), null, { kind: a.kind, amount })]);
      } else {
        await c.db.batch([
          { sql: 'INSERT INTO hr_paper (person_id, kind, start_date, end_date, service, amount, currency, paid_on, note, position, weekly_hours, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', params: [...v, nowIso(), c.who] },
          auditStmt(c.who, 'add', 'hr_paper', null, null, { kind: a.kind, person: a.personId, amount }),
        ]);
        id = (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_paper'))!.id;
      }
      // the agreement fixes the stipend from its first day: its own pay line (kept in step with the agreement)
      if (agreement) {
        // agreed in pounds: the pounds are kept (the dollars are an equivalent, shown at the dollar rate)
        const usd = amount != null && cur === 'SYP' ? null : amount;
        const syp = amount != null && cur === 'SYP' ? amount : null;
        const line = await one<{ id: number }>(c.db, 'SELECT id FROM hr_pay WHERE paper_id = ? AND deleted_at IS NULL', [id]);
        if (start && (usd != null || syp != null || grade)) {
          const pv = [a.personId, start, grade?.id ?? null, weekly, usd, syp];
          await c.db.batch([line
            ? { sql: 'UPDATE hr_pay SET person_id=?, valid_from=?, grade_id=?, weekly_hours=?, monthly_usd=?, monthly_syp=? WHERE id = ?', params: [...pv, line.id] }
            : { sql: "INSERT INTO hr_pay (person_id, valid_from, grade_id, weekly_hours, monthly_usd, monthly_syp, note, paper_id, created_at, created_by) VALUES (?,?,?,?,?,?,'agreement',?,?,?)", params: [...pv, id, nowIso(), c.who] }]);
        } else if (line) await c.db.batch([{ sql: 'UPDATE hr_pay SET deleted_at = ? WHERE id = ?', params: [nowIso(), line.id] }]);
        if (position) await c.db.batch([{ sql: 'UPDATE hr_person SET role = ? WHERE id = ?', params: [position, a.personId] }]);
      }
      return { id };
    },
  },
  'hr.paper.delete': {
    check: (c: OpCtx) => needRight(c, 'hr.agreements'),
    run: async (c: OpCtx, a: { id: number }) => {
      const p = await one<{ person_id: number }>(c.db, 'SELECT person_id FROM hr_paper WHERE id = ? AND deleted_at IS NULL', [a.id]);
      if (!p) throw new UserError(m('الورقة غير موجودة', 'Paper not found', 'Document introuvable'));
      await needPerson(c, p.person_id);
      await c.db.batch([
        { sql: 'UPDATE hr_paper SET deleted_at = ? WHERE id = ?', params: [nowIso(), a.id] },
        { sql: 'UPDATE hr_pay SET deleted_at = ? WHERE paper_id = ? AND deleted_at IS NULL', params: [nowIso(), a.id] },
        logStmt(c, 'delete', 'paper', p.person_id, a.id), auditStmt(c.who, 'delete', 'hr_paper', String(a.id), null, null),
      ]);
      return { ok: true };
    },
  },

  'hr.conduct.save': {
    check: needManage,
    run: async (c: OpCtx, a: { id?: number | null; version: string; validFrom: string; note?: string | null }) => {
      await requireHr(c.db);
      needAll(c);
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
      await needPerson(c, a.personId);
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
      await needPerson(c, await personOf(c, 'sign', a.id));
      await c.db.batch([{ sql: 'UPDATE hr_conduct_sign SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', params: [nowIso(), a.id] }, auditStmt(c.who, 'delete', 'hr_conduct_sign', String(a.id), null, null)]);
      return { ok: true };
    },
  },

  // a scan on a paper, a version of the code of conduct, or a signature
  'hr.file.add': {
    check: (c: OpCtx) => needRight(c, 'hr.manage', 'hr.agreements'),
    run: async (c: OpCtx, a: { kind: 'paper' | 'conduct' | 'sign'; id: number; base64: string; mime: string; name?: string }) => {
      if (!(a.kind in TABLE) || (a.kind as string) === 'doc') throw new UserError(m('نوع غير معروف', 'Unknown kind', 'Type inconnu'));
      const row = await one<{ id: number }>(c.db, `SELECT id FROM ${TABLE[a.kind]} WHERE id = ?`, [a.id]);
      if (!row) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
      // the scan of an agreement or a letter: by who writes them; a version of the code or a signature: by who manages
      needRight(c, a.kind === 'paper' ? 'hr.agreements' : 'hr.manage');
      if (a.kind === 'conduct') needAll(c);
      else await needPerson(c, await personOf(c, a.kind, a.id));
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
      // a signed agreement or letter shows its amount
      if (a.kind === 'paper') needRight(c, 'hr.salary');
      await needPerson(c, await personOf(c, a.kind, a.id));
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
      await needPerson(c, a.personId);
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
      await needPerson(c, await personOf(c, 'doc', a.id));
      const label = txt(a.label);
      if (!label) throw new UserError(m('اكتب نوع الوثيقة', 'Write what the document is', 'Écrivez de quel document il s’agit'));
      await c.db.batch([{ sql: 'UPDATE hr_doc SET label = ?, expires_on = ? WHERE id = ? AND deleted_at IS NULL', params: [label, day(a.expiresOn, 'expiry'), a.id] }, logStmt(c, 'edit', 'doc', await personOf(c, 'doc', a.id), a.id, label)]);
      return { ok: true };
    },
  },
  'hr.vault.delete': {
    check: needVault,
    run: async (c: OpCtx, a: { id: number }) => {
      await needPerson(c, await personOf(c, 'doc', a.id));
      await c.db.batch([{ sql: 'UPDATE hr_doc SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', params: [nowIso(), a.id] }, logStmt(c, 'delete', 'doc', await personOf(c, 'doc', a.id), a.id)]);
      return { ok: true };
    },
  },
  'hr.access.list': {
    check: needVault,
    run: async (c: OpCtx) => {
      const seen = await seenPeople(c);
      const rows = await c.db.query<{ id: number; at: string; who: string; action: string; what: string; person_id: number | null; item_id: number | null; detail: string | null }>(`SELECT * FROM hr_access_log ORDER BY id DESC LIMIT ${seen ? 3000 : 500}`);
      return seen ? rows.filter((r) => r.person_id != null && seen.has(r.person_id)).slice(0, 500) : rows;
    },
  },

  // ---- arrival and leaving (Fouad, 31 October 2026): what is to be done, kept in the settings; ticked on each person's card
  'hr.check.save': {
    check: needManage,
    run: async (c: OpCtx, a: { id?: number | null; kind: 'arrival' | 'leaving'; labelAr?: string | null; labelEn: string; active?: boolean }) => {
      needAll(c);
      if (a.kind !== 'arrival' && a.kind !== 'leaving') throw new UserError(m('نوع غير معروف', 'Unknown kind', 'Type inconnu'));
      const en = txt(a.labelEn) ?? txt(a.labelAr);
      if (!en) throw new UserError(m('اكتب ما يجب عمله', 'Write what is to be done', 'Écrivez ce qui est à faire'));
      if (a.id) {
        await c.db.batch([{ sql: 'UPDATE hr_check_item SET kind = ?, label_ar = ?, label_en = ?, active = ? WHERE id = ?', params: [a.kind, txt(a.labelAr), en, a.active === false ? 0 : 1, a.id] }, auditStmt(c.who, 'update', 'hr_check_item', String(a.id), null, { en })]);
        return { id: a.id };
      }
      const next = ((await one<{ s: number | null }>(c.db, 'SELECT MAX(sort) AS s FROM hr_check_item WHERE kind = ?', [a.kind]))?.s ?? 0) + 1;
      await c.db.batch([{ sql: 'INSERT INTO hr_check_item (kind, label_ar, label_en, sort) VALUES (?,?,?,?)', params: [a.kind, txt(a.labelAr), en, next] }, auditStmt(c.who, 'add', 'hr_check_item', null, null, { en })]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM hr_check_item'))!.id };
    },
  },
  // an item moved up or down in its list
  'hr.check.move': {
    check: needManage,
    run: async (c: OpCtx, a: { id: number; by: -1 | 1 }) => {
      needAll(c);
      const it = await one<{ kind: string }>(c.db, 'SELECT kind FROM hr_check_item WHERE id = ?', [a.id]);
      if (!it) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
      const ids = (await c.db.query<{ id: number }>('SELECT id FROM hr_check_item WHERE kind = ? ORDER BY sort, id', [it.kind])).map((x) => x.id);
      const i = ids.indexOf(a.id), j = i + (a.by < 0 ? -1 : 1);
      if (j < 0 || j >= ids.length) return { ok: true };
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await c.db.batch(ids.map((id, k) => ({ sql: 'UPDATE hr_check_item SET sort = ? WHERE id = ?', params: [k + 1, id] })));
      return { ok: true };
    },
  },
  'hr.check.tick': {
    check: needManage,
    run: async (c: OpCtx, a: { personId: number; itemId: number; done: boolean; on?: string | null; note?: string | null }) => {
      await needPerson(c, a.personId);
      if (!a.done) {
        await c.db.batch([{ sql: 'DELETE FROM hr_check_done WHERE person_id = ? AND item_id = ?', params: [a.personId, a.itemId] }, auditStmt(c.who, 'delete', 'hr_check_done', `${a.personId}/${a.itemId}`, null, null)]);
        return { ok: true };
      }
      const on = day(a.on, 'date') ?? isoDay(new Date());
      await c.db.batch([
        { sql: 'INSERT INTO hr_check_done (person_id, item_id, done_on, done_by, note) VALUES (?,?,?,?,?) ON CONFLICT(person_id, item_id) DO UPDATE SET done_on = excluded.done_on, done_by = excluded.done_by, note = excluded.note', params: [a.personId, a.itemId, on, c.who, txt(a.note)] },
        auditStmt(c.who, 'add', 'hr_check_done', `${a.personId}/${a.itemId}`, null, { on }),
      ]);
      return { ok: true };
    },
  },
  // someone leaves: the date (and why) is written; the leaving list then shows on their card
  'hr.person.leave': {
    check: needManage,
    run: async (c: OpCtx, a: { id: number; ended: string | null; note?: string | null }) => {
      await needPerson(c, a.id);
      const p = await one<{ note: string | null }>(c.db, 'SELECT note FROM hr_person WHERE id = ?', [a.id]);
      if (!p) throw new UserError(m('الشخص غير موجود', 'Person not found', 'Personne introuvable'));
      const ended = day(a.ended, 'end');
      const why = txt(a.note);
      await c.db.batch([
        { sql: 'UPDATE hr_person SET ended = ?, active = ?, note = ? WHERE id = ?', params: [ended, ended ? 0 : 1, why ? [p.note, `${ended ?? ''} ${why}`.trim()].filter(Boolean).join(' · ') : p.note, a.id] },
        auditStmt(c.who, 'update', 'hr_person', String(a.id), null, { ended, why }),
      ]);
      return { ok: true };
    },
  },

  // ---- the users of the HR database and the centres each one sees (Fouad, 31 October 2026)
  'hr.users.list': {
    check: (c: OpCtx) => { if (!can(c, 'users.manage')) throw refuse(); },
    run: async (c: OpCtx) => {
      const users = await c.db.query<{ id: number; name: string; access_id: number | null; access_name: string | null; active: number; hr_centres: string | null }>('SELECT p.id, p.name, p.access_id, a.name AS access_name, p.active, p.hr_centres FROM profile p LEFT JOIN access_profile a ON a.id = p.access_id ORDER BY p.active DESC, a.sort, p.name');
      const access = await c.db.query<{ id: number; name: string; perms: string }>('SELECT id, name, perms FROM access_profile ORDER BY sort, id');
      const rows = users.map((u) => ({ ...u, centres: u.hr_centres ? (JSON.parse(u.hr_centres) as string[]) : null }));
      // someone who sees some centres only sees the users of those centres
      const sc = scopeOf(c);
      return { users: sc ? rows.filter((u) => u.centres && u.centres.every((x) => sc.includes(x))) : rows, access: access.map((x) => ({ id: x.id, name: x.name, perms: JSON.parse(x.perms) as string[] })) };
    },
  },
  'hr.user.save': {
    check: (c: OpCtx) => { if (!can(c, 'users.manage')) throw refuse(); },
    run: async (c: OpCtx, a: { id?: number | null; name: string; accessId: number; centres: string[] | null; password?: string | null; active?: boolean }) => {
      const name = txt(a.name);
      if (!name) throw new UserError(m('الاسم فارغ', 'The name is empty', 'Le nom est vide'));
      const centres = (a.centres ?? []).filter((x) => ['jaramana', 'aleppo', 'homs', 'other'].includes(x));
      // a user who sees some centres gives only those (and never "every centre")
      const sc = scopeOf(c);
      if (sc && (!centres.length || centres.some((x) => !sc.includes(x)))) throw new UserError(m('اختر من مراكزك فقط', 'Choose among your own centres only', 'Choisissez seulement parmi vos centres'));
      const acc = await one<{ perms: string }>(c.db, 'SELECT perms FROM access_profile WHERE id = ?', [a.accessId]);
      if (!acc) throw new UserError(m('اختر ملف الصلاحيات', 'Choose a permission profile', 'Choisissez un profil de permissions'));
      if (sc && (JSON.parse(acc.perms) as string[]).some((x) => !has(c.profile, x as Perm))) throw new UserError(m('لا تعطِ صلاحيات أكثر من صلاحياتك', 'Do not give more rights than your own', 'Ne donnez pas plus de droits que les vôtres'));
      if (await one(c.db, 'SELECT 1 AS x FROM profile WHERE name = ? AND active = 1 AND id <> ?', [name, a.id ?? -1])) throw new UserError(m(`"${name}" موجود مسبقاً`, `"${name}" already exists`, `« ${name} » existe déjà`));
      if (a.id) {
        const before = await one<{ hr_centres: string | null }>(c.db, 'SELECT hr_centres FROM profile WHERE id = ?', [a.id]);
        if (!before) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
        const was = before.hr_centres ? (JSON.parse(before.hr_centres) as string[]) : null;
        if (sc && (!was || was.some((x) => !sc.includes(x)))) throw new UserError(m('خارج مراكزك', 'Outside your centres', 'Hors de vos centres'));
      }
      const stmts: Stmt[] = [];
      let id = a.id ?? null;
      const role = (JSON.parse(acc.perms) as string[]).includes('users.manage') ? 'sup' : 'com';
      const cj = centres.length ? JSON.stringify(centres) : null;
      if (id) stmts.push({ sql: 'UPDATE profile SET name = ?, access_id = ?, role = ?, hr_centres = ?, active = ? WHERE id = ?', params: [name, a.accessId, role, cj, a.active === false ? 0 : 1, id] });
      else {
        if (!txt(a.password)) throw new UserError(m('كلمة السر مطلوبة', 'A password is required', 'Un mot de passe est nécessaire'));
        id = ((await one<{ m: number | null }>(c.db, 'SELECT MAX(id) AS m FROM profile'))?.m ?? 0) + 1;
        stmts.push(await profileStmt({ name, role: role as 'sup' | 'com', pin: String(a.password), access_id: a.accessId }));
        stmts.push({ sql: 'UPDATE profile SET hr_centres = ?, must_change = 1 WHERE id = (SELECT MAX(id) FROM profile)', params: [cj] });
      }
      if (a.id && txt(a.password)) {
        checkSecretShape(String(a.password));
        const salt = crypto.randomUUID();
        stmts.push({ sql: 'UPDATE profile SET pin_salt = ?, pin_hash = ?, must_change = 1 WHERE id = ?', params: [salt, await hashSecret(salt, String(a.password)), id] });
      }
      stmts.push(auditStmt(c.who, a.id ? 'edit' : 'add', 'profile', String(id), null, { name, access: a.accessId, centres }));
      await c.db.batch(stmts);
      // at least one active user must still manage the users and see every centre
      if (!(await one(c.db, "SELECT 1 AS x FROM profile p JOIN access_profile a ON a.id = p.access_id WHERE p.active = 1 AND p.hr_centres IS NULL AND a.perms LIKE '%users.manage%'"))) {
        throw new UserError(m('يجب أن يبقى مستخدم يدير المستخدمين ويرى كل المراكز', 'Someone must still manage the users and see every centre', 'Quelqu’un doit encore gérer les utilisateurs et voir tous les centres'));
      }
      return { id };
    },
  },

  // ---- leave (prepared for later): its kinds
  'hr.leave.type.save': {
    check: needManage,
    run: async (c: OpCtx, a: { id?: number | null; nameAr?: string | null; nameEn: string; daysPerYear?: number | null; paid?: boolean; active?: boolean }) => {
      needAll(c);
      const en = txt(a.nameEn) ?? txt(a.nameAr);
      if (!en) throw new UserError(m('اكتب الاسم', 'Write the name', 'Écrivez le nom'));
      const days = a.daysPerYear == null || (a.daysPerYear as unknown) === '' ? null : Number(a.daysPerYear);
      const v = [txt(a.nameAr), en, days, a.paid === false ? 0 : 1, a.active === false ? 0 : 1];
      if (a.id) await c.db.batch([{ sql: 'UPDATE hr_leave_type SET name_ar = ?, name_en = ?, days_per_year = ?, paid = ?, active = ? WHERE id = ?', params: [...v, a.id] }]);
      else await c.db.batch([{ sql: 'INSERT INTO hr_leave_type (name_ar, name_en, days_per_year, paid, active, sort) VALUES (?,?,?,?,?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM hr_leave_type))', params: v }]);
      return { ok: true };
    },
  },
};
export const HR_READ_ONLY = ['hr.data', 'hr.access.list', 'hr.users.list'];
