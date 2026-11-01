// One list of headings and lines for every centre (Fouad, 2026-11-01). A heading or a line is known everywhere by
// its uid. A database "in the common list" takes the lines the others add, and gives them its own; each centre keeps
// switching off, for itself, what it does not use (active stays local). Nothing is ever deleted this way.
// The list travels between the databases of one server ("make the lists the same"), or as a file for a centre that
// works on its own computer.
import type { Db, Stmt } from '../db/db';
import { auditStmt, getMeta, setMetaStmt, UserError } from '../db/repo';
import { m } from '../i18n';
import type { TrxType } from '../domain/types';

export const COMMON_LIST = 'magis-common-list';

export interface CommonList {
  kind: typeof COMMON_LIST;
  /** the database it was taken from */
  from: string | null;
  /** taken from the database that leads the common list (Fouad's): its names and codes are the reference */
  lead: boolean;
  made_at: string;
  headings: { uid: string; code: string; name: string; types: TrxType[] }[];
  lines: { uid: string; heading_uid: string; code: string; name: string; is_project_fund: number }[];
}

/** Is this database in the common list ('lead': the one that leads it, Fouad's; 'yes': in it; null: not yet)? */
export async function commonListState(db: Db): Promise<'lead' | 'yes' | null> {
  const v = await getMeta(db, 'common_list');
  return v === 'lead' || v === 'yes' ? v : null;
}

/** This database's headings and lines, as the common list knows them. */
export async function exportCommonList(db: Db): Promise<CommonList> {
  const heads = await db.query<{ id: number; uid: string; code: string; name: string }>('SELECT id, uid, code, name FROM heading ORDER BY code');
  const types = await db.query<{ heading_id: number; type: TrxType }>('SELECT heading_id, type FROM heading_type');
  const lines = await db.query<{ uid: string; heading_uid: string; code: string; name: string; is_project_fund: number }>(
    'SELECT l.uid, h.uid AS heading_uid, l.code, l.name, l.is_project_fund FROM budget_line l JOIN heading h ON h.id = l.heading_id ORDER BY l.code');
  return {
    kind: COMMON_LIST, from: await getMeta(db, 'organisation'), lead: (await commonListState(db)) === 'lead', made_at: new Date().toISOString(),
    headings: heads.map((h) => ({ uid: h.uid, code: h.code, name: h.name, types: types.filter((t) => t.heading_id === h.id).map((t) => t.type) })),
    lines,
  };
}

export function parseCommonList(text: string): CommonList {
  let p: CommonList;
  try {
    p = JSON.parse(text);
  } catch {
    throw new UserError(m('الملف ليس قائمة مشتركة', 'This file is not a common list', "Ce fichier n'est pas une liste commune"));
  }
  if (p?.kind !== COMMON_LIST || !Array.isArray(p.headings) || !Array.isArray(p.lines)) throw new UserError(m('الملف ليس قائمة مشتركة', 'This file is not a common list', "Ce fichier n'est pas une liste commune"));
  return p;
}

/**
 * Takes a common list into this database: the headings and lines it does not have are added (with the same uid);
 * with `lead`, those it has take the list's name and code (the list is the reference); without, they keep this
 * database's. A heading or line of the same name under another uid is the same thing: it takes the list's uid.
 * When a code is already used here by something else, the newcomer gets the next free code (the uid is the key).
 */
export async function applyCommonList(db: Db, list: CommonList, who: string, opts: { lead: boolean }): Promise<{ headings: number; lines: number; renamed: number }> {
  const out = { headings: 0, lines: 0, renamed: 0 };
  type H = { id: number; uid: string; code: string; name: string };
  type L = { id: number; uid: string; heading_id: number; code: string; name: string };
  const stmts: Stmt[] = [];
  const heads = await db.query<H>('SELECT id, uid, code, name FROM heading');
  const lines = await db.query<L>('SELECT id, uid, heading_id, code, name FROM budget_line');
  const listUids = new Set([...list.headings.map((h) => h.uid), ...list.lines.map((l) => l.uid)]);
  const lower = (x: string) => x.trim().toLowerCase();
  let nextHeadingId = Math.max(0, ...heads.map((h) => h.id)) + 1;
  const freeCode = (taken: Set<string>, code: string) => {
    if (!taken.has(code)) return code;
    for (let i = 2; ; i++) if (!taken.has(`${code}-${i}`)) return `${code}-${i}`;
  };
  const headCodes = new Set(heads.map((h) => h.code));
  for (const h of list.headings) {
    let mine = heads.find((x) => x.uid === h.uid);
    if (!mine) {
      // the same name here under another uid (and that uid is not in the list): the same heading
      const same = heads.find((x) => lower(x.name) === lower(h.name) && !listUids.has(x.uid));
      if (same) {
        stmts.push({ sql: 'UPDATE heading SET uid = ? WHERE id = ?', params: [h.uid, same.id] });
        same.uid = h.uid;
        mine = same;
      }
    }
    if (mine) {
      if (opts.lead && (mine.name !== h.name || mine.code !== h.code) && !heads.some((x) => x !== mine && (lower(x.name) === lower(h.name) || x.code === h.code))) {
        stmts.push({ sql: 'UPDATE heading SET name = ?, code = ? WHERE id = ?', params: [h.name, h.code, mine.id] });
        headCodes.delete(mine.code);
        headCodes.add(h.code);
        Object.assign(mine, { name: h.name, code: h.code });
        out.renamed++;
      }
      continue;
    }
    const code = freeCode(headCodes, h.code);
    headCodes.add(code);
    const id = nextHeadingId++;
    stmts.push({ sql: 'INSERT INTO heading (id, uid, name, code, sort) VALUES (?, ?, ?, ?, ?)', params: [id, h.uid, h.name, code, id] });
    for (const t of h.types) stmts.push({ sql: 'INSERT INTO heading_type (heading_id, type) VALUES (?, ?)', params: [id, t] });
    heads.push({ id, uid: h.uid, code, name: h.name });
    out.headings++;
  }
  const lineCodes = new Set(lines.map((l) => l.code));
  for (const l of list.lines) {
    const head = heads.find((x) => x.uid === l.heading_uid);
    if (!head) continue;
    let mine = lines.find((x) => x.uid === l.uid);
    if (!mine) {
      const same = lines.find((x) => x.heading_id === head.id && lower(x.name) === lower(l.name) && !listUids.has(x.uid));
      if (same) {
        stmts.push({ sql: 'UPDATE budget_line SET uid = ? WHERE id = ?', params: [l.uid, same.id] });
        same.uid = l.uid;
        mine = same;
      }
    }
    if (mine) {
      if (opts.lead && (mine.name !== l.name || mine.code !== l.code || mine.heading_id !== head.id)
        && !lines.some((x) => x !== mine && ((x.heading_id === head.id && lower(x.name) === lower(l.name)) || x.code === l.code))) {
        stmts.push({ sql: 'UPDATE budget_line SET name = ?, code = ?, heading_id = ? WHERE id = ?', params: [l.name, l.code, head.id, mine.id] });
        lineCodes.delete(mine.code);
        lineCodes.add(l.code);
        Object.assign(mine, { name: l.name, code: l.code, heading_id: head.id });
        out.renamed++;
      }
      continue;
    }
    if (lines.some((x) => x.heading_id === head.id && lower(x.name) === lower(l.name))) continue; // (its uid is used twice in the list: kept once)
    const code = freeCode(lineCodes, l.code);
    lineCodes.add(code);
    stmts.push({ sql: 'INSERT INTO budget_line (uid, heading_id, name, code, is_project_fund) VALUES (?, ?, ?, ?, ?)', params: [l.uid, head.id, l.name, code, l.is_project_fund ? 1 : 0] });
    lines.push({ id: -1, uid: l.uid, heading_id: head.id, code, name: l.name });
    out.lines++;
  }
  if (stmts.length) {
    stmts.push(auditStmt(who, 'common_list', 'heading', null, null, { from: list.from, lead: opts.lead, ...out }));
    await db.batch(stmts);
  }
  return out;
}

/** This database joins the common list; the first one leads it (its list becomes the common list). */
export async function joinCommonList(db: Db, who: string, lead: boolean) {
  await db.batch([setMetaStmt('common_list', lead ? 'lead' : 'yes'), auditStmt(who, 'common_list', 'meta', null, null, { joined: lead ? 'lead' : 'yes' })]);
}
