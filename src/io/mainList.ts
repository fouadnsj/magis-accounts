// The main list of headings and lines (Fouad, 2026-11-03). It is kept on the server, apart from every centre, and
// only the administrator changes it: as a draft first (codes do not change while he works), then "Renumber", then
// "Publish to this server". Each centre takes from it what it needs, and switches off for itself what it does not
// use; it never renames what it took. The servers of the other cities take the list as a file, and never change it.
// A heading or a line is known everywhere by its uid; a merge is kept in the list, so that a centre several versions
// behind still merges.
import type { Db, Stmt } from '../db/db';
import { auditStmt, setMetaStmt, UserError } from '../db/repo';
import { m } from '../i18n';
import type { TrxType } from '../domain/types';

export const MAIN_LIST = 'magis-main-list';

export interface MainHeading { uid: string; code: string; name: string; types: TrxType[]; active: number }
export interface MainLine { uid: string; heading_uid: string; code: string; name: string; is_project_fund: number; active: number }
export interface MainMerge { kind: 'heading' | 'line'; from: string; into: string; at: string }

export interface MainList {
  kind: typeof MAIN_LIST;
  /** the server that makes it (only there can it be changed) */
  home: string;
  /** 0 while it was never published; then 1, 2… */
  version: number;
  published_at: string | null;
  /** the database it was started from */
  from: string | null;
  /** in their order */
  headings: MainHeading[];
  lines: MainLine[];
  merged: MainMerge[];
}

const lower = (x: string) => x.trim().toLowerCase();
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
export const PREFIX: Record<TrxType, string> = { Income: 'I', Exp: 'E', Transfer: 'T', Exchange: 'X' };
export const newUid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/** The main list started from a database (Homs): its headings and lines, in the order of their codes. */
export async function mainListFromDb(db: Db, home: string, from: string | null): Promise<MainList> {
  const heads = await db.query<{ id: number; uid: string; code: string; name: string; active: number }>('SELECT id, uid, code, name, active FROM heading');
  const types = await db.query<{ heading_id: number; type: TrxType }>('SELECT heading_id, type FROM heading_type');
  const lines = await db.query<{ uid: string; heading_id: number; code: string; name: string; is_project_fund: number; active: number }>(
    'SELECT uid, heading_id, code, name, is_project_fund, active FROM budget_line WHERE merged_into IS NULL');
  heads.sort((a, b) => natural(a.code, b.code));
  lines.sort((a, b) => natural(a.code, b.code));
  return {
    kind: MAIN_LIST, home, version: 0, published_at: null, from,
    headings: heads.map((h) => ({ uid: h.uid, code: h.code, name: h.name, types: types.filter((x) => x.heading_id === h.id).map((x) => x.type), active: h.active ? 1 : 0 })),
    lines: lines.map((l) => ({ uid: l.uid, heading_uid: heads.find((h) => h.id === l.heading_id)!.uid, code: l.code, name: l.name, is_project_fund: l.is_project_fund ? 1 : 0, active: l.active ? 1 : 0 })),
    merged: [],
  };
}

/** The list is whole and clean: one uid each, no two headings with the same name or code, no two lines with the same code. */
export function checkMainList(list: MainList): MainList {
  const bad = (en: string, ar: string, fr: string) => { throw new UserError(m(ar, en, fr)); };
  if (list?.kind !== MAIN_LIST || !Array.isArray(list.headings) || !Array.isArray(list.lines) || !Array.isArray(list.merged) || typeof list.home !== 'string')
    bad('This file is not a main list', 'الملف ليس قائمة رئيسية', "Ce fichier n'est pas une liste principale");
  const uids = new Set<string>();
  const hNames = new Set<string>();
  const hCodes = new Set<string>();
  for (const h of list.headings) {
    if (!h.uid || !h.name?.trim() || !h.code?.trim() || !Array.isArray(h.types) || !h.types.length) bad(`A heading is not complete: ${h.name ?? ''}`, `بند غير مكتمل: ${h.name ?? ''}`, `Une rubrique est incomplète : ${h.name ?? ''}`);
    if (uids.has(h.uid)) bad('The same heading twice', 'البند نفسه مرتين', 'La même rubrique deux fois');
    if (hNames.has(lower(h.name))) bad(`Two headings are called "${h.name}"`, `بندان باسم «${h.name}»`, `Deux rubriques s'appellent « ${h.name} »`);
    if (hCodes.has(h.code)) bad(`Two headings have the code ${h.code}`, `بندان بالرمز ${h.code}`, `Deux rubriques ont le code ${h.code}`);
    uids.add(h.uid); hNames.add(lower(h.name)); hCodes.add(h.code);
  }
  const lNames = new Set<string>();
  const lCodes = new Set<string>();
  const headUids = new Set(list.headings.map((h) => h.uid));
  for (const l of list.lines) {
    if (!l.uid || !l.name?.trim() || !l.code?.trim()) bad(`A line is not complete: ${l.name ?? ''}`, `خط غير مكتمل: ${l.name ?? ''}`, `Une ligne est incomplète : ${l.name ?? ''}`);
    if (!headUids.has(l.heading_uid)) bad(`The line "${l.name}" has no heading`, `الخط «${l.name}» بلا بند`, `La ligne « ${l.name} » n'a pas de rubrique`);
    if (uids.has(l.uid)) bad('The same line twice', 'الخط نفسه مرتين', 'La même ligne deux fois');
    const key = `${l.heading_uid}|${lower(l.name)}`;
    if (lNames.has(key)) bad(`Two lines are called "${l.name}" under the same heading`, `خطان باسم «${l.name}» في البند نفسه`, `Deux lignes s'appellent « ${l.name} » dans la même rubrique`);
    if (lCodes.has(l.code)) bad(`Two lines have the code ${l.code}`, `خطان بالرمز ${l.code}`, `Deux lignes ont le code ${l.code}`);
    uids.add(l.uid); lNames.add(key); lCodes.add(l.code);
  }
  return list;
}

export function parseMainList(text: string): MainList {
  let p: MainList;
  try {
    p = JSON.parse(text);
  } catch {
    throw new UserError(m('الملف ليس قائمة رئيسية', 'This file is not a main list', "Ce fichier n'est pas une liste principale"));
  }
  return checkMainList(p);
}

/** Clean codes in the order of the list: E01, E02… by the first type of each heading; its lines E01.1, E01.2… */
export function renumber(list: MainList): MainList {
  const n: Record<string, number> = {};
  const headings = list.headings.map((h) => {
    const p = PREFIX[h.types[0]] ?? 'E';
    n[p] = (n[p] ?? 0) + 1;
    return { ...h, code: `${p}${String(n[p]).padStart(2, '0')}` };
  });
  const code = new Map(headings.map((h) => [h.uid, h.code]));
  const k: Record<string, number> = {};
  const lines = list.lines.map((l) => {
    k[l.heading_uid] = (k[l.heading_uid] ?? 0) + 1;
    return { ...l, code: `${code.get(l.heading_uid)}.${k[l.heading_uid]}` };
  });
  return { ...list, headings, lines };
}

/** The codes are already in the order of the list (nothing for "Renumber" to do). */
export const inOrder = (list: MainList) => JSON.stringify(renumber(list)) === JSON.stringify(list);

/** What a list would change in a database, before it is published there. */
export interface MainChanges { renamed: number; moved: number; merged: number; rows: number }

export async function mainListChanges(db: Db, list: MainList): Promise<MainChanges> {
  const heads = await db.query<{ id: number; uid: string; code: string; name: string }>('SELECT id, uid, code, name FROM heading');
  const lines = await db.query<{ id: number; uid: string; heading_id: number; code: string; name: string }>('SELECT id, uid, heading_id, code, name FROM budget_line WHERE merged_into IS NULL');
  const rowsOf = async (lineId: number) => (await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM trx WHERE line_id = ?', [lineId]))[0].n;
  const out: MainChanges = { renamed: 0, moved: 0, merged: 0, rows: 0 };
  const huid = new Map(heads.map((h) => [h.id, h.uid]));
  for (const x of list.merged) {
    if (x.kind === 'line') {
      const f = lines.find((l) => l.uid === x.from);
      if (f && lines.some((l) => l.uid === x.into)) { out.merged++; out.rows += await rowsOf(f.id); }
    } else if (heads.some((h) => h.uid === x.from) && heads.some((h) => h.uid === x.into)) out.merged++;
  }
  for (const h of list.headings) {
    const mine = heads.find((x) => x.uid === h.uid);
    if (mine && (mine.name !== h.name || mine.code !== h.code)) out.renamed++;
  }
  for (const l of list.lines) {
    const mine = lines.find((x) => x.uid === l.uid);
    if (!mine) continue;
    if (mine.name !== l.name || mine.code !== l.code) out.renamed++;
    if (huid.get(mine.heading_id) !== l.heading_uid) { out.moved++; out.rows += await rowsOf(mine.id); }
  }
  return out;
}

/**
 * The main list in this database. What the database already has (by uid, or of the same name under the same heading)
 * takes the list's name, code and heading, with its rows; the merges are made (rows, budget amounts and items move);
 * what the list switched off is switched off here; and what `take` names comes in, switched on. The database's own
 * headings and lines (not in the list) stay, renamed only if their name or code is now the list's. (The caller takes
 * a backup first.)
 */
export async function applyMainList(db: Db, list: MainList, who: string, opts: { take?: string[] } = {}): Promise<{ renamed: number; moved: number; merged: number; added: number }> {
  checkMainList(list);
  type H = { id: number; uid: string; code: string; name: string; active: number; gone?: boolean };
  type L = { id: number; uid: string; heading_id: number; code: string; name: string; active: number; is_project_fund: number; merged_into: number | null; mergedNow?: boolean };
  const heads = await db.query<H>('SELECT id, uid, code, name, active FROM heading');
  const lines = await db.query<L>('SELECT id, uid, heading_id, code, name, active, is_project_fund, merged_into FROM budget_line');
  const before = new Map<string, string>([...heads.map((h) => [`h${h.id}`, `${h.name}|${h.code}`] as [string, string]), ...lines.map((l) => [`l${l.id}`, `${l.name}|${l.code}|${l.heading_id}`] as [string, string])]);
  const mh = new Map(list.headings.map((h) => [h.uid, h]));
  const ml = new Map(list.lines.map((l) => [l.uid, l]));
  const take = new Set(opts.take ?? []);
  for (const u of take) { const l = ml.get(u); if (l) take.add(l.heading_uid); }
  const out = { renamed: 0, moved: 0, merged: 0, added: 0 };
  const stmts: Stmt[] = [];
  const s = (sql: string, params: (string | number | null)[] = []) => stmts.push({ sql, params });
  const live = () => lines.filter((l) => l.merged_into == null);
  const head = (uid: string) => heads.find((h) => !h.gone && h.uid === uid);
  const line = (uid: string) => live().find((l) => l.uid === uid);

  // 1. every heading and line on a temporary name and code, so that the list's are free
  for (const h of heads) s('UPDATE heading SET name = ?, code = ? WHERE id = ?', [`~${h.id}~${h.name}`, `~h${h.id}`, h.id]);
  for (const l of live()) s('UPDATE budget_line SET name = ?, code = ? WHERE id = ?', [`~${l.id}~${l.name}`, `~l${l.id}`, l.id]);

  // 2. the same name here (not yet in the list) is the same heading or line: it takes the list's identity
  for (const h of list.headings) {
    if (head(h.uid)) continue;
    const same = heads.find((x) => !x.gone && !mh.has(x.uid) && lower(x.name) === lower(h.name));
    if (same) { s('UPDATE heading SET uid = ? WHERE id = ?', [h.uid, same.id]); same.uid = h.uid; }
  }
  for (const l of list.lines) {
    if (line(l.uid)) continue;
    const hd = head(l.heading_uid);
    const same = hd && live().find((x) => x.heading_id === hd.id && !ml.has(x.uid) && lower(x.name) === lower(l.name));
    if (same) { s('UPDATE budget_line SET uid = ? WHERE id = ?', [l.uid, same.id]); same.uid = l.uid; }
  }

  // 3. the merges, in the order they were made
  for (const x of list.merged) {
    if (x.kind === 'line') {
      const f = line(x.from);
      if (!f) continue;
      const into = line(x.into);
      if (!into) { s('UPDATE budget_line SET uid = ? WHERE id = ?', [x.into, f.id]); f.uid = x.into; continue; }
      s('UPDATE trx SET line_id = ? WHERE line_id = ?', [into.id, f.id]);
      s(`UPDATE budget_amount SET amount_usd = amount_usd + (SELECT b.amount_usd FROM budget_amount b WHERE b.version_id = budget_amount.version_id AND b.line_id = ?),
                account_id = COALESCE(account_id, (SELECT b.account_id FROM budget_amount b WHERE b.version_id = budget_amount.version_id AND b.line_id = ?))
          WHERE line_id = ? AND version_id IN (SELECT version_id FROM budget_amount WHERE line_id = ?)`, [f.id, f.id, into.id, f.id]);
      s('UPDATE budget_amount SET line_id = ? WHERE line_id = ? AND version_id NOT IN (SELECT version_id FROM budget_amount WHERE line_id = ?)', [into.id, f.id, into.id]);
      s('DELETE FROM budget_amount WHERE line_id = ?', [f.id]);
      s('UPDATE budget_item SET line_id = ? WHERE line_id = ?', [into.id, f.id]);
      s('UPDATE budget_alloc SET line_id = ? WHERE line_id = ?', [into.id, f.id]);
      s('UPDATE budget_line SET merged_into = ? WHERE merged_into = ?', [into.id, f.id]);
      for (const y of lines) if (y.merged_into === f.id) y.merged_into = into.id;
      // the old line stays, switched off, pointing to its line (a keeper's file written on it still comes in)
      Object.assign(f, { merged_into: into.id, mergedNow: true, active: 0, heading_id: into.heading_id });
      s('UPDATE budget_line SET merged_into = ?, active = 0, heading_id = ? WHERE id = ?', [into.id, into.heading_id, f.id]);
      out.merged++;
    } else {
      const f = head(x.from);
      if (!f) continue;
      const into = head(x.into);
      if (!into) { s('UPDATE heading SET uid = ? WHERE id = ?', [x.into, f.id]); f.uid = x.into; continue; }
      s('INSERT OR IGNORE INTO heading_type (heading_id, type) SELECT ?, type FROM heading_type WHERE heading_id = ?', [into.id, f.id]);
      s('UPDATE budget_line SET heading_id = ? WHERE heading_id = ?', [into.id, f.id]);
      s('UPDATE budget_alloc SET heading_id = ? WHERE heading_id = ?', [into.id, f.id]);
      s('DELETE FROM project_rule WHERE heading_id = ?', [f.id]);
      s('UPDATE trx SET heading_id = ? WHERE heading_id = ?', [into.id, f.id]);
      s('DELETE FROM heading_type WHERE heading_id = ?', [f.id]);
      s('DELETE FROM heading WHERE id = ?', [f.id]);
      for (const y of lines) if (y.heading_id === f.id) y.heading_id = into.id;
      f.gone = true;
      out.merged++;
    }
  }

  // 4. the headings: the list's (and those the lines need), then this database's own
  const hNames = new Set(list.headings.map((h) => lower(h.name)));
  const hCodes = new Set(list.headings.map((h) => h.code));
  let nextId = Math.max(0, ...heads.map((h) => h.id)) + 1;
  const needed = new Set<string>([...take].filter((u) => mh.has(u)));
  for (const l of list.lines) if (line(l.uid)) needed.add(l.heading_uid);
  list.headings.forEach((h, i) => {
    let mine = head(h.uid);
    if (!mine) {
      const on = take.has(h.uid) || live().some((l) => l.active && ml.get(l.uid)?.heading_uid === h.uid);
      if (!needed.has(h.uid)) return;
      mine = { id: nextId++, uid: h.uid, code: h.code, name: h.name, active: h.active && on ? 1 : 0 };
      s('INSERT INTO heading (id, uid, name, code, sort, active, in_main) VALUES (?, ?, ?, ?, ?, ?, 1)', [mine.id, h.uid, h.name, h.code, i + 1, mine.active]);
      heads.push(mine);
      out.added++;
    } else {
      mine.active = h.active ? (take.has(h.uid) ? 1 : mine.active) : 0;
      s('UPDATE heading SET name = ?, code = ?, sort = ?, active = ?, in_main = 1 WHERE id = ?', [h.name, h.code, i + 1, mine.active, mine.id]);
    }
    Object.assign(mine, { name: h.name, code: h.code });
    for (const t of h.types) s('INSERT OR IGNORE INTO heading_type (heading_id, type) VALUES (?, ?)', [mine.id, t]);
  });
  const free = (taken: Set<string>, x: string, next: (i: number) => string) => { let y = x; for (let i = 2; taken.has(y); i++) y = next(i); taken.add(y); return y; };
  for (const h of heads) {
    if (h.gone || mh.has(h.uid)) continue;
    let name = h.name;
    while (hNames.has(lower(name))) name = `${name} (2)`;
    hNames.add(lower(name));
    h.name = name;
    h.code = free(hCodes, h.code, (i) => `${h.code}-${i}`);
    s('UPDATE heading SET name = ?, code = ?, sort = ?, in_main = 0 WHERE id = ?', [h.name, h.code, 1000 + h.id, h.id]);
  }

  // 5. the lines: the list's (under the list's heading), the merged ones, then this database's own
  const lNames = new Set(list.lines.map((l) => `${head(l.heading_uid)?.id ?? l.heading_uid}|${lower(l.name)}`));
  const lCodes = new Set(list.lines.map((l) => l.code));
  for (const l of list.lines) {
    let mine = line(l.uid);
    const hd = head(l.heading_uid);
    if (!mine) {
      if (!take.has(l.uid) || !hd) continue;
      mine = { id: -1, uid: l.uid, heading_id: hd.id, code: l.code, name: l.name, active: l.active, is_project_fund: l.is_project_fund, merged_into: null };
      s('INSERT INTO budget_line (uid, heading_id, name, code, is_project_fund, active, in_main) VALUES (?, ?, ?, ?, ?, ?, 1)', [l.uid, hd.id, l.name, l.code, l.is_project_fund ? 1 : 0, l.active ? 1 : 0]);
      lines.push(mine);
      out.added++;
      continue;
    }
    mine.active = l.active ? (take.has(l.uid) ? 1 : mine.active) : 0;
    s('UPDATE budget_line SET heading_id = ?, name = ?, code = ?, is_project_fund = ?, active = ?, in_main = 1 WHERE id = ?', [hd!.id, l.name, l.code, l.is_project_fund ? 1 : 0, mine.active, mine.id]);
    Object.assign(mine, { heading_id: hd!.id, name: l.name, code: l.code });
  }
  for (const l of lines) {
    if (l.mergedNow) {
      const into = lines.find((x) => x.id === l.merged_into)!;
      s('UPDATE budget_line SET name = ?, code = ?, in_main = 0 WHERE id = ?', [`${l.name} → ${into.name}`, `${into.code}~${l.id}`, l.id]);
      continue;
    }
    if (l.merged_into != null || l.id < 0 || ml.has(l.uid)) continue;
    let name = l.name;
    while (lNames.has(`${l.heading_id}|${lower(name)}`)) name = `${name} (2)`;
    lNames.add(`${l.heading_id}|${lower(name)}`);
    const code = free(lCodes, l.code, (i) => `${l.code}-${i}`);
    s('UPDATE budget_line SET name = ?, code = ?, in_main = 0 WHERE id = ?', [name, code, l.id]);
    Object.assign(l, { name, code });
  }

  // 6. every row of the register under the heading of its line (a line that moved takes its rows with it)
  s(`UPDATE trx SET heading_id = (SELECT heading_id FROM budget_line WHERE id = trx.line_id)
      WHERE line_id IS NOT NULL AND heading_id IS NOT (SELECT heading_id FROM budget_line WHERE id = trx.line_id)`);
  for (const h of heads) {
    const was = before.get(`h${h.id}`);
    if (!h.gone && was && was !== `${h.name}|${h.code}`) out.renamed++;
  }
  for (const l of lines) {
    const was = before.get(`l${l.id}`);
    if (!was || l.mergedNow || l.merged_into != null) continue;
    const [n, c, hid] = was.split('|');
    if (n !== l.name || c !== l.code) out.renamed++;
    if (Number(hid) !== l.heading_id) out.moved++;
  }
  stmts.push(setMetaStmt('main_list_version', String(list.version)), auditStmt(who, 'main_list', 'heading', null, null, { home: list.home, version: list.version, ...out, took: opts.take?.length ?? 0 }));
  await db.batch([{ sql: 'PRAGMA defer_foreign_keys = ON' }, ...stmts]);
  return out;
}

// ---- Requests (Fouad, 2026-11-03): a centre does not add a heading or a line; it asks the administrator, who adds it
// to the main list, points to one that exists, or refuses (with a word why). Meanwhile its rows wait on a line it
// chose (e.g. "Other / Unallocated"); once the line is taken, they can move to it.
export const MAIN_REQUESTS = 'magis-main-requests';

export interface MainRequest {
  id: string;
  kind: 'heading' | 'line';
  name: string;
  /** a line: under this heading of the main list */
  heading_uid: string | null;
  heading_name: string | null;
  /** a heading: its type */
  type: TrxType | null;
  why: string;
  /** the database and server it comes from, and who asked */
  centre: string;
  organisation: string;
  server: string | null;
  by: string;
  at: string;
  /** the line its rows are recorded on meanwhile (in that centre) */
  meanwhile_line_uid: string | null;
  status: 'open' | 'added' | 'same' | 'refused';
  /** added or pointed to: the heading or line of the main list */
  answer_uid: string | null;
  answer_name: string | null;
  note: string | null;
  answered_at: string | null;
}

/** Requests travelling as a file (a centre on its own computer, or the server of another city). */
export interface MainRequestFile { kind: typeof MAIN_REQUESTS; requests: MainRequest[] }

export function parseRequests(text: string): MainRequest[] {
  let p: MainRequestFile;
  try {
    p = JSON.parse(text);
  } catch {
    p = null as unknown as MainRequestFile;
  }
  if (p?.kind !== MAIN_REQUESTS || !Array.isArray(p.requests) || p.requests.some((r) => !r?.id || !r.name || (r.kind !== 'line' && r.kind !== 'heading')))
    throw new UserError(m('الملف ليس ملف طلبات', 'This file is not a file of requests', "Ce fichier n'est pas un fichier de demandes"));
  return p.requests;
}

/** A new heading (with its type) or a new line (under a heading), with the next free code; the list and its uid. */
export function addToList(list: MainList, x: { kind: 'heading' | 'line'; name: string; heading_uid?: string | null; type?: TrxType | null }): { list: MainList; uid: string } {
  const name = x.name.trim();
  if (!name) throw new UserError(m('الاسم فارغ', 'The name is empty', 'Le nom est vide'));
  const uid = newUid();
  if (x.kind === 'heading') {
    const type = x.type ?? 'Exp';
    const used = new Set(list.headings.map((h) => h.code));
    let code = '';
    for (let i = 1; ; i++) { code = `${PREFIX[type]}${String(i).padStart(2, '0')}`; if (!used.has(code)) break; }
    return { list: checkMainList({ ...list, headings: [...list.headings, { uid, code, name, types: [type], active: 1 }] }), uid };
  }
  const h = list.headings.find((y) => y.uid === x.heading_uid);
  if (!h) throw new UserError(m('اختر البند', 'Choose the heading', 'Choisissez la rubrique'));
  const used = new Set(list.lines.map((l) => l.code));
  let code = '';
  for (let i = 1; ; i++) { code = `${h.code}.${i}`; if (!used.has(code)) break; }
  // at the end of its heading
  const last = list.lines.map((l) => l.heading_uid).lastIndexOf(h.uid);
  const lines = [...list.lines];
  lines.splice(last < 0 ? lines.length : last + 1, 0, { uid, heading_uid: h.uid, code, name, is_project_fund: 0, active: 1 });
  return { list: checkMainList({ ...list, lines }), uid };
}

/** Headings and lines of the list whose names look like this one (to ask "is it one of these?" first). */
export function similar(list: MainList, name: string): { uid: string; name: string; heading: string | null; code: string }[] {
  const words = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  if (!words.length) return [];
  const hit = (x: string) => words.some((w) => x.toLowerCase().includes(w));
  const head = (uid: string) => list.headings.find((h) => h.uid === uid)?.name ?? null;
  return [
    ...list.headings.filter((h) => h.active && hit(h.name)).map((h) => ({ uid: h.uid, name: h.name, heading: null, code: h.code })),
    ...list.lines.filter((l) => l.active && hit(l.name)).map((l) => ({ uid: l.uid, name: l.name, heading: head(l.heading_uid), code: l.code })),
  ].slice(0, 12);
}
