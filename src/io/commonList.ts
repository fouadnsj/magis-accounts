// One list of headings and lines for every centre (Fouad, 2026-11-01). A heading or a line is known everywhere by
// its uid. A database "in the common list" takes the lines the others add, and gives them its own; what comes from
// another centre arrives switched off, and each centre switches on what it uses (active stays local). Nothing is ever
// deleted this way.
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
    // (what comes from another centre arrives switched off: each centre switches on what it uses)
    stmts.push({ sql: 'INSERT INTO heading (id, uid, name, code, sort, active) VALUES (?, ?, ?, ?, ?, 0)', params: [id, h.uid, h.name, code, id] });
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
    stmts.push({ sql: 'INSERT INTO budget_line (uid, heading_id, name, code, is_project_fund, active) VALUES (?, ?, ?, ?, ?, 0)', params: [l.uid, head.id, l.name, code, l.is_project_fund ? 1 : 0] });
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

/**
 * A centre joins the common list, its old headings and lines matched one by one (Fouad, 2026-11-01: Aleppo's lines,
 * e.g. a salary line per person, go to the lines by position). `headings` and `lines` say, for each old one, the
 * common one it becomes (its uid), or null: it is added to the common list as it is (a line under the heading its
 * own heading becomes). An old line that becomes a common line takes its identity, name and code; when several go
 * to the same one, they are merged into it: the rows of the register, the budget amounts (added) and items move.
 * Then the rest of the common list comes in, and the database is in the common list. Rows keep their dates and
 * amounts; only their heading and line change. (The caller takes a backup first.)
 */
export async function joinWithMatching(db: Db, list: CommonList, map: { headings: Record<number, string | null>; lines: Record<number, string | null> }, who: string) {
  type H = { id: number; uid: string; code: string; name: string };
  type L = { id: number; uid: string; heading_id: number; code: string; name: string };
  const heads = await db.query<H>('SELECT id, uid, code, name FROM heading');
  const lines = await db.query<L>('SELECT id, uid, heading_id, code, name FROM budget_line');
  const types = await db.query<{ heading_id: number; type: TrxType }>('SELECT heading_id, type FROM heading_type');
  const lh = new Map(list.headings.map((h) => [h.uid, h]));
  const ll = new Map(list.lines.map((l) => [l.uid, l]));
  for (const [, uid] of [...Object.entries(map.headings), ...Object.entries(map.lines)]) {
    if (uid != null && !lh.has(uid) && !ll.has(uid)) throw new UserError(m('مطابقة غير صالحة: أعد فتح الشاشة', 'A match is not valid: open the screen again', 'Une correspondance n’est pas valide : rouvrez l’écran'));
  }
  // the Income, Transfer and Exchange headings: by their type, when not chosen
  const onlyType = (hid: number, t: TrxType) => types.filter((x) => x.heading_id === hid).every((x) => x.type === t) && types.some((x) => x.heading_id === hid);
  const hMap = new Map<number, string | null>();
  for (const h of heads) {
    let uid = map.headings[h.id];
    if (uid === undefined) {
      const t = (['Income', 'Transfer', 'Exchange'] as TrxType[]).find((x) => onlyType(h.id, x));
      uid = t ? list.headings.find((x) => x.types.length === 1 && x.types[0] === t)?.uid ?? null : null;
    }
    hMap.set(h.id, uid ?? null);
  }
  const stmts: Stmt[] = [];
  const s = (sql: string, params: (string | number | null)[] = []) => stmts.push({ sql, params });
  // 1. every old heading and line on a temporary name and code (so that the common ones are free)
  for (const h of heads) s('UPDATE heading SET name = ?, code = ? WHERE id = ?', [`~${h.id}~${h.name}`, `~h${h.id}`, h.id]);
  for (const l of lines) s('UPDATE budget_line SET name = ?, code = ? WHERE id = ?', [`~${l.id}~${l.name}`, `~l${l.id}`, l.id]);
  // 2. the headings: the first old one matched to a common heading becomes it; the others are merged into it
  const keeperH = new Map<string, number>(); // common heading uid → the old heading that became it
  const nextId = { h: Math.max(0, ...heads.map((h) => h.id)) + 1 };
  const headingCodes = new Set(list.headings.map((h) => h.code));
  const newCode = (taken: Set<string>, prefix: string) => { for (let i = 1; ; i++) { const c = `${prefix}${String(i).padStart(2, '0')}`; if (!taken.has(c)) { taken.add(c); return c; } } };
  const finalHeading = new Map<number, number>(); // old heading id → the heading id its lines belong to now
  const codeOf = new Map<number, string>(); // heading id → its code now
  for (const h of heads) {
    const uid = hMap.get(h.id)!;
    if (uid == null) {
      // a heading of its own, added to the common list: its name, a free code of its type
      const t = types.find((x) => x.heading_id === h.id)?.type ?? 'Exp';
      const code = newCode(headingCodes, ({ Income: 'I', Exp: 'E', Transfer: 'T', Exchange: 'X' } as Record<TrxType, string>)[t]);
      s('UPDATE heading SET name = ?, code = ? WHERE id = ?', [h.name, code, h.id]);
      finalHeading.set(h.id, h.id);
      codeOf.set(h.id, code);
      continue;
    }
    const keeper = keeperH.get(uid);
    if (keeper == null) {
      const c = lh.get(uid)!;
      s('UPDATE heading SET uid = ?, name = ?, code = ? WHERE id = ?', [uid, c.name, c.code, h.id]);
      keeperH.set(uid, h.id);
      finalHeading.set(h.id, h.id);
      codeOf.set(h.id, c.code);
    } else finalHeading.set(h.id, keeper);
  }
  // the common headings no old one became: added
  for (const c of list.headings) {
    if (keeperH.has(c.uid)) continue;
    const id = nextId.h++;
    s('INSERT INTO heading (id, uid, name, code, sort, active) VALUES (?, ?, ?, ?, ?, 0)', [id, c.uid, c.name, c.code, id]);
    for (const t of c.types) s('INSERT INTO heading_type (heading_id, type) VALUES (?, ?)', [id, t]);
    keeperH.set(c.uid, id);
    codeOf.set(id, c.code);
  }
  const headingOfUid = (uid: string) => keeperH.get(uid)!;
  // 3. the lines
  const keeperL = new Map<string, number>();
  const lineCodes = new Set(list.lines.map((l) => l.code));
  // heading id | name: the common lines (a line kept as it is never takes a common line's name) and those done
  const lineNames = new Set<string>(list.lines.map((c) => `${headingOfUid(c.heading_uid)}|${c.name.toLowerCase()}`));
  for (const l of lines) {
    const uid = map.lines[l.id] ?? null;
    if (uid == null) {
      // a line of its own, added to the common list under the heading its heading became
      const hid = finalHeading.get(l.heading_id)!;
      const prefix = codeOf.get(hid)!;
      let code = '';
      for (let i = 1; ; i++) if (!lineCodes.has(`${prefix}.${i}`)) { code = `${prefix}.${i}`; break; }
      lineCodes.add(code);
      let name = l.name;
      while (lineNames.has(`${hid}|${name.toLowerCase()}`)) name = `${name} (2)`;
      lineNames.add(`${hid}|${name.toLowerCase()}`);
      s('UPDATE budget_line SET heading_id = ?, name = ?, code = ? WHERE id = ?', [hid, name, code, l.id]);
      continue;
    }
    const c = ll.get(uid)!;
    const hid = headingOfUid(c.heading_uid);
    const keeper = keeperL.get(uid);
    if (keeper == null) {
      s('UPDATE budget_line SET uid = ?, heading_id = ?, name = ?, code = ?, is_project_fund = ? WHERE id = ?', [uid, hid, c.name, c.code, c.is_project_fund ? 1 : 0, l.id]);
      keeperL.set(uid, l.id);
      lineNames.add(`${hid}|${c.name.toLowerCase()}`);
      continue;
    }
    // merged into the line that already became it
    s('UPDATE trx SET line_id = ? WHERE line_id = ?', [keeper, l.id]);
    s(`UPDATE budget_amount SET amount_usd = amount_usd + (SELECT b.amount_usd FROM budget_amount b WHERE b.version_id = budget_amount.version_id AND b.line_id = ?),
              account_id = COALESCE(account_id, (SELECT b.account_id FROM budget_amount b WHERE b.version_id = budget_amount.version_id AND b.line_id = ?))
        WHERE line_id = ? AND version_id IN (SELECT version_id FROM budget_amount WHERE line_id = ?)`, [l.id, l.id, keeper, l.id]);
    s('UPDATE budget_amount SET line_id = ? WHERE line_id = ? AND version_id NOT IN (SELECT version_id FROM budget_amount WHERE line_id = ?)', [keeper, l.id, keeper]);
    s('DELETE FROM budget_amount WHERE line_id = ?', [l.id]);
    s('UPDATE budget_item SET line_id = ? WHERE line_id = ?', [keeper, l.id]);
    s('UPDATE budget_alloc SET line_id = ? WHERE line_id = ?', [keeper, l.id]);
    s('DELETE FROM budget_line WHERE id = ?', [l.id]);
  }
  // the headings merged into another: what pointed to them goes to it, with their types; then they go
  for (const h of heads) {
    const to = finalHeading.get(h.id)!;
    if (to === h.id) continue;
    for (const t of types.filter((x) => x.heading_id === h.id)) s('INSERT OR IGNORE INTO heading_type (heading_id, type) VALUES (?, ?)', [to, t.type]);
    s('UPDATE budget_line SET heading_id = ? WHERE heading_id = ?', [to, h.id]);
    s('UPDATE budget_alloc SET heading_id = ? WHERE heading_id = ?', [to, h.id]);
    s('DELETE FROM project_rule WHERE heading_id = ?', [h.id]);
    s('UPDATE trx SET heading_id = ? WHERE heading_id = ?', [to, h.id]);
    s('DELETE FROM heading_type WHERE heading_id = ?', [h.id]);
    s('DELETE FROM heading WHERE id = ?', [h.id]);
  }
  // every row of the register under the heading of its line
  s('UPDATE trx SET heading_id = (SELECT heading_id FROM budget_line WHERE id = trx.line_id) WHERE line_id IS NOT NULL');
  // the common headings that became something here take the common list's types too
  for (const c of list.headings) for (const t of c.types) s('INSERT OR IGNORE INTO heading_type (heading_id, type) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM heading WHERE id = ?)', [headingOfUid(c.uid), t, headingOfUid(c.uid)]);
  stmts.push(setMetaStmt('common_list', 'yes'), auditStmt(who, 'common_list', 'meta', null, null, { joined: 'yes', from: list.from, headings: map.headings, lines: map.lines }));
  await db.batch([{ sql: 'PRAGMA defer_foreign_keys = ON' }, ...stmts]);
  // the common lines no old one became
  const added = await applyCommonList(db, list, who, { lead: true });
  return { matched: Object.values(map.lines).filter(Boolean).length, kept: Object.values(map.lines).filter((x) => x == null).length, added: added.headings + added.lines };
}
