// Rehearsal of ALL the database updates (57 -> 77: calendar, inventory, roles) on COPIES of the real databases.
// Job J5 of PIPELINE-TO-BUILD.md. Nothing here touches the real files: you give it a folder of COPIES (outside the project,
// never in test-servers/ nor real-db/), and it opens each copy, runs the program's own migration code (src/db/db.ts migrate),
// twice, and compares "who can do what" before and after. No server needed.
//   build: node_modules/.bin/esbuild scripts/rehearse-roles.ts --bundle --platform=node --format=esm --outfile=<scratch>/rehearse-roles.mjs
//   run:   node --no-warnings <scratch>/rehearse-roles.mjs <folder-of-copies> <out.json>
// It prints a summary and writes every detail to <out.json> (no password, no hash: names, roles and ticks only).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { migrate, pendingMigrations, type Db, type Row, type SqlValue, type Stmt } from '../src/db/db';
import { MIGRATIONS } from '../src/db/migrations';
import { rolesOf } from '../src/auth';
import { doorsOf } from '../src/doors';
import { peopleDoor, unionPerms, sensitiveOf } from '../src/roles';
import { cleanPerms, type Perm } from '../src/perms';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const dir = process.argv[2];
const outFile = process.argv[3];
if (!dir || !outFile) throw new Error('usage: rehearse-roles.mjs <folder-of-copies> <out.json>');
const absDir = path.resolve(dir);
if (/real-db|test-servers/.test(absDir)) throw new Error('refused: give a folder of COPIES (not real-db, not test-servers)');

// ---- the same way the server opens a database (server/server.ts openDb)
function open(file: string) {
  const sq = new DatabaseSync(file);
  sq.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  const db: Db = {
    async query<T = Row>(sql: string, params: SqlValue[] = []) { return sq.prepare(sql).all(...params) as T[]; },
    async batch(stmts: Stmt[]) {
      sq.exec('BEGIN IMMEDIATE');
      try { for (const s of stmts) sq.prepare(s.sql).run(...(s.params ?? [])); sq.exec('COMMIT'); } catch (e) { sq.exec('ROLLBACK'); throw e; }
    },
  };
  return { sq, db };
}

const sha = (x: unknown) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

interface TableSnap { cols: string[]; count: number; hashAll: string }
type Rows = Record<string, Row[]>;
async function snapshot(db: Db): Promise<{ snap: Record<string, TableSnap>; rows: Rows }> {
  const snap: Record<string, TableSnap> = {};
  const all: Rows = {};
  const tables = (await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((t) => t.name);
  for (const t of tables) {
    const cols = (await db.query<{ name: string }>(`PRAGMA table_info("${t}")`)).map((c) => c.name);
    const rows = await db.query(`SELECT * FROM "${t}" ORDER BY rowid`).catch(() => db.query(`SELECT * FROM "${t}"`));
    all[t] = rows;
    snap[t] = { cols, count: rows.length, hashAll: sha(rows) };
  }
  return { snap, rows: all };
}

const kindOfDb = async (db: Db) => (await db.query<{ value: string }>("SELECT value FROM meta WHERE key = 'kind'"))[0]?.value ?? 'centre';
const metaOf = async (db: Db, key: string) => (await db.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]))[0]?.value ?? null;

interface Person { id: number; name: string; oldRole: string; active: number; oldProfile: string | null; oldTicks: Perm[]; books: string[]; office?: string | null; hrCentres?: string | null }

async function peopleBefore(db: Db): Promise<Person[]> {
  const pcols = (await db.query<{ name: string }>('PRAGMA table_info(profile)')).map((c) => c.name);
  const sel = ['p.id', 'p.name', 'p.role', 'p.active', 'p.access_id', 'a.name AS aname', 'a.perms'];
  if (pcols.includes('cty_office')) sel.push('p.cty_office AS office');
  if (pcols.includes('hr_centres')) sel.push('p.hr_centres AS hrc');
  const rows = await db.query<Row>(`SELECT ${sel.join(', ')} FROM profile p LEFT JOIN access_profile a ON a.id = p.access_id ORDER BY p.id`);
  const out: Person[] = [];
  for (const r of rows) {
    const books = (await db.query<{ name: string }>('SELECT b.name FROM user_book ub JOIN book b ON b.id = ub.book_id WHERE ub.profile_id = ? ORDER BY b.id', [r.id as number])).map((b) => b.name);
    out.push({ id: r.id as number, name: String(r.name), oldRole: String(r.role), active: r.active as number, oldProfile: (r.aname as string) ?? null, oldTicks: cleanPerms(r.perms ? JSON.parse(String(r.perms)) : []), books, office: (r.office as string) ?? null, hrCentres: (r.hrc as string) ?? null });
  }
  return out;
}

const setEq = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

interface Result {
  file: string; kind: string; centre: string | null; organisation: string | null;
  sizeBefore: number; sizeAfter: number;
  versionBefore: number; versionAfter: number;
  applied: number[]; ms: number; error: string | null;
  secondRun: { applied: number[]; changed: string[] };
  integrity: { before: string; after: string; fkBefore: number; fkAfter: number };
  tables: { name: string; before: number | null; after: number; contentChanged: boolean }[];
  roles: { id: number; name: string; kind: string | null; ticks: number; people: number; donors: boolean; respo: boolean }[];
  people: unknown[];
}

const results: Result[] = [];
const files = fs.readdirSync(absDir).filter((f) => f.endsWith('.db')).sort();

for (const f of files) {
  const file = path.join(absDir, f);
  const { sq, db } = open(file);
  const kind = await kindOfDb(db);
  const res: Result = {
    file: f, kind, centre: await metaOf(db, 'centre'), organisation: await metaOf(db, 'organisation'),
    sizeBefore: fs.statSync(file).size, sizeAfter: 0,
    versionBefore: (await db.query<{ m: number }>('SELECT MAX(n) AS m FROM schema_migration'))[0].m, versionAfter: 0,
    applied: [], ms: 0, error: null, secondRun: { applied: [], changed: [] },
    integrity: { before: String((sq.prepare('PRAGMA integrity_check').all() as Row[])[0]?.integrity_check), after: '', fkBefore: (sq.prepare('PRAGMA foreign_key_check').all() as Row[]).length, fkAfter: 0 },
    tables: [], roles: [], people: [],
  };
  const pending = await pendingMigrations(db);
  console.log(`\n=== ${f}  (${kind}, ${res.organisation}) update ${res.versionBefore} -> ${MIGRATIONS[MIGRATIONS.length - 1].n}, ${pending} to apply`);

  const people = await peopleBefore(db);
  const { snap: snapBefore, rows: rowsBefore } = await snapshot(db);

  // ---- first run: the program's own migration code, as the server does when it opens a database
  const t0 = Date.now();
  try { res.applied = await migrate(db); } catch (e) { res.error = String((e as Error)?.message ?? e); }
  res.ms = Date.now() - t0;
  res.versionAfter = (await db.query<{ m: number }>('SELECT MAX(n) AS m FROM schema_migration'))[0].m;
  console.log(`first run: applied ${res.applied.length} updates in ${res.ms} ms${res.error ? `  ERROR: ${res.error}` : ''}`);

  const { snap: snapAfter, rows: rowsAfter } = await snapshot(db);
  res.integrity.after = String((sq.prepare('PRAGMA integrity_check').all() as Row[])[0]?.integrity_check);
  res.integrity.fkAfter = (sq.prepare('PRAGMA foreign_key_check').all() as Row[]).length;

  // ---- second run: must change nothing
  try { res.secondRun.applied = await migrate(db); } catch (e) { res.secondRun.changed.push(`ERROR ${String((e as Error)?.message ?? e)}`); }
  const snap2 = (await snapshot(db)).snap;
  for (const t of Object.keys(snapAfter)) if (snap2[t]?.hashAll !== snapAfter[t].hashAll || snap2[t]?.count !== snapAfter[t].count) res.secondRun.changed.push(t);
  console.log(`second run: applied ${res.secondRun.applied.length}; tables changed: ${res.secondRun.changed.length ? res.secondRun.changed.join(', ') : 'none'}`);
  console.log(`integrity: before ${res.integrity.before}, after ${res.integrity.after}; foreign-key problems: before ${res.integrity.fkBefore}, after ${res.integrity.fkAfter}`);

  // ---- every table: rows before / after; do the OLD columns still hold the same values, row by row?
  for (const [t, sn] of Object.entries(snapAfter)) {
    const b = snapBefore[t];
    let changed = false;
    if (b) {
      const keep = b.cols.filter((c) => sn.cols.includes(c));
      changed = sha(rowsBefore[t].map((r) => keep.map((c) => r[c]))) !== sha(rowsAfter[t].slice(0, rowsBefore[t].length).map((r) => keep.map((c) => r[c]))) || b.cols.length !== keep.length;
    }
    res.tables.push({ name: t, before: b ? b.count : null, after: sn.count, contentChanged: changed });
  }
  for (const t of Object.keys(snapBefore)) if (!snapAfter[t]) res.tables.push({ name: t, before: snapBefore[t].count, after: -1, contentChanged: true });

  // ---- the roles and the people, after
  const isCentre = !['hr', 'community', 'country', 'province'].includes(kind);
  const inventoryOn = isCentre && (await metaOf(db, 'sec_inventory')) !== '0';
  const rolesTable = (await db.query<{ id: number; name: string; kind: string | null; perms: string }>('SELECT id, name, kind, perms FROM access_profile ORDER BY sort, id').catch(async () => (await db.query<{ id: number; name: string; perms: string }>('SELECT id, name, perms FROM access_profile ORDER BY sort, id')).map((x) => ({ ...x, kind: null as string | null }))));
  for (const r of rolesTable) {
    const ticks = cleanPerms(JSON.parse(r.perms));
    const n = (await db.query<{ n: number }>('SELECT COUNT(DISTINCT p) AS n FROM (SELECT id AS p FROM profile WHERE access_id = ? UNION SELECT profile_id FROM profile_role WHERE access_id = ?)', [r.id, r.id]))[0].n;
    res.roles.push({ id: r.id, name: r.name, kind: r.kind, ticks: ticks.length, people: n, donors: ticks.includes('lists.donors'), respo: ticks.includes('register.private') });
  }
  const director = rolesTable.find((r) => r.kind === 'director');
  for (const p of people) {
    const more = await rolesOf(db, p.id);
    const roles = more?.roles ?? [];
    const after: Perm[] = more ? unionPerms(more.roles, more.extra) : p.oldTicks;
    const hasBook = p.books.length > 0;
    const doorsBefore = doorsOf({ can: (x) => p.oldTicks.includes(x), hasBook, inventoryOn, hr: false, people: peopleDoor([], (x) => p.oldTicks.includes(x)) });
    const doorsAfter = doorsOf({ can: (x) => after.includes(x), hasBook, inventoryOn, hr: false, people: peopleDoor(roles, (x) => after.includes(x)) });
    const added = after.filter((x) => !p.oldTicks.includes(x));
    const lost = p.oldTicks.filter((x) => !after.includes(x));
    const custom = roles.length > 0 && roles.every((r) => !r.kind);
    const verdict = lost.length ? 'less' : added.length ? 'more' : 'same';
    const sens = more ? sensitiveOf(more.roles, more.extra).map((s) => ({ key: s.key, via: s.roles.map((r) => r.name), exception: s.exception })) : [];
    let asDirector: { lost: Perm[]; gained: Perm[] } | null = null;
    if (director && roles.some((r) => r.kind === 'administrator')) {
      const dp = cleanPerms(JSON.parse(director.perms));
      asDirector = { lost: after.filter((x) => !dp.includes(x)), gained: dp.filter((x) => !after.includes(x)) };
    }
    res.people.push({ id: p.id, name: p.name, active: p.active, oldRole: p.oldRole, oldProfile: p.oldProfile, oldTicks: p.oldTicks, books: p.books, office: p.office, hrCentres: p.hrCentres,
      roles: roles.map((r) => ({ name: r.name, kind: r.kind })), extra: more?.extra ?? [], afterTicks: after, added, lost, verdict: custom ? `${verdict} (Custom)` : verdict, custom,
      doorsBefore, doorsAfter, sensitive: sens, asDirector, oldProfileMissing: p.oldProfile == null });
    console.log(`  ${p.active ? ' ' : '(off)'} ${p.name.padEnd(22)} ${String(p.oldProfile).padEnd(28)} -> ${roles.map((r) => r.name).join(' + ') || '(none)'} | ${custom ? 'Custom ' : ''}${verdict}${added.length ? ` +${added.length}` : ''}${lost.length ? ` -${lost.length} LOST ${lost.join(',')}` : ''} | doors ${doorsBefore.join(',')} -> ${doorsAfter.join(',')}`);
  }
  sq.close();
  res.sizeAfter = fs.statSync(file).size;
  results.push(res);
}

// ---- names in the centres and in HR (or elsewhere) that are the same, or nearly
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const byName = new Map<string, { db: string; name: string }[]>();
for (const r of results) for (const p of r.people as { name: string }[]) { const k = norm(p.name); byName.set(k, [...(byName.get(k) ?? []), { db: r.file, name: p.name }]); }
const same = [...byName.entries()].filter(([, v]) => new Set(v.map((x) => x.db)).size > 1).map(([k, v]) => ({ key: k, where: v }));
const keys = [...byName.keys()];
const near: { a: string; b: string; where: { db: string; name: string }[] }[] = [];
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
  const a = keys[i], b = keys[j];
  const ta = a.split(' '), tb = b.split(' ');
  const close = a.includes(b) || b.includes(a) || ta[0] === tb[0] || ta.some((x) => x.length > 3 && tb.includes(x));
  const dbs = new Set([...byName.get(a)!, ...byName.get(b)!].map((x) => x.db));
  if (close && dbs.size > 1) near.push({ a, b, where: [...byName.get(a)!, ...byName.get(b)!] });
}

const summary = { ranAt: new Date().toISOString(), lastUpdate: MIGRATIONS[MIGRATIONS.length - 1].n, results, sameNames: same, nearNames: near };
fs.writeFileSync(outFile, JSON.stringify(summary, null, 1));
const less = results.flatMap((r) => (r.people as { name: string; verdict: string }[]).filter((p) => p.verdict.startsWith('less')).map((p) => `${r.file}:${p.name}`));
console.log(`\nDONE. Databases: ${results.length}. Errors: ${results.filter((r) => r.error).length}. Second run changed something: ${results.filter((r) => r.secondRun.applied.length || r.secondRun.changed.length).length}. People with LESS: ${less.length}${less.length ? ' -> ' + less.join('; ') : ''}`);
console.log(`details: ${outFile}`);
