// Al-Ard: a ready database of the program — its lines (the farm list and the guest-house lines) and two budgets, every
// amount empty. Writes ONE new database file; nothing else is touched. (Fouad, 22 November 2026)
//   build:  node_modules/.bin/esbuild scripts/alard-build.ts --bundle --platform=node --format=esm --outfile=/tmp/alard-build.mjs
//   run:    node --no-warnings /tmp/alard-build.mjs <out.db> [main-list-id]
// The database follows the server's main list "Al Ard" (id al-ard unless another id is given): the Lists → Budget page then
// offers that list, and lines can be taken, switched on and off from it.
// The two default passwords are "fouadsj" and must be changed at the first sign-in (a rule of this program for given passwords).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Db, Row, SqlValue, Stmt } from '../src/db/db';
import { createOffice } from '../src/setup';
import { loadProfile } from '../src/auth';
import { runOp, type OpCtx } from '../src/ops';
import { addHeading, addLine, setMetaStmt } from '../src/db/repo';
import { FARM_LIST, type FarmHeading } from '../src/hosting/farm';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const out = process.argv[2];
const listId = process.argv[3] || 'al-ard';
if (!out) throw new Error('usage: alard-build.mjs <out.db>');
if (fs.existsSync(out)) throw new Error(`${out} already exists: choose a new name`);

/** the guest-house lines (Fouad chose "farm lines + guest-house lines" on 22 November 2026): a starter, to be changed in the database */
const GUEST_LIST: FarmHeading[] = [
  { name: 'إيرادات الضيافة · Hosting income', types: ['Income'], lines: ['إقامة المجموعات · Group accommodation', 'قاعات ونشاطات · Halls and events', 'وجبات وخدمات · Meals and services'] },
  { name: 'تكاليف الضيافة · Guest-house costs', types: ['Exp'], lines: ['مواد غذائية · Food supplies', 'تنظيف وغسيل · Cleaning and laundry', 'ماء وكهرباء · Water and electricity', 'تدفئة · Heating', 'صيانة المباني · Building maintenance', 'أثاث وتجهيزات · Furniture and equipment'] },
];

function fileDb(path: string): Db {
  const sq = new DatabaseSync(path);
  sq.exec('PRAGMA foreign_keys = ON');
  return {
    async query<T = Row>(sql: string, params: SqlValue[] = []) { return sq.prepare(sql).all(...params) as T[]; },
    async batch(stmts: Stmt[]) {
      sq.exec('BEGIN');
      try { for (const s of stmts) sq.prepare(s.sql).run(...(s.params ?? [])); sq.exec('COMMIT'); } catch (e) { sq.exec('ROLLBACK'); throw e; }
    },
  };
}

const db = fileDb(out);
await createOffice(db, { organisation: 'MAGIS Al-Ard', supName: 'Fouad', supPin: 'fouadsj', comName: 'Accountant', comPin: 'fouadsj' });
await db.batch([
  setMetaStmt('centre', 'alard'),
  setMetaStmt('sec_hosting', '1'), // the calendar is on for Al-Ard
  setMetaStmt('main_list', listId), // it follows the main list of Al-Ard (the lines below are the same as the list's)
  { sql: 'UPDATE profile SET must_change = 1' },
]);

for (const h of [...FARM_LIST, ...GUEST_LIST]) {
  await addHeading(db, h.name, h.types, 'setup');
  const id = (await db.query<{ id: number }>('SELECT id FROM heading WHERE name = ?', [h.name]))[0].id;
  for (const l of h.lines) await addLine(db, id, l, 'setup');
}

// the two budgets: every line is there, every amount empty; the rates are the ones of the Homs budget (130 and 0.89)
const files = { docWrite: async () => undefined, docRead: async () => new Uint8Array(), docExists: async () => false } as unknown as OpCtx['files'];
const sup = (await db.query<{ id: number }>("SELECT id FROM profile WHERE name = 'Fouad'"))[0];
const ctx: OpCtx = { db, profile: (await loadProfile(db, sup.id))!, who: 'Fouad', install: 'office', files };
for (const year of [2026, 2027]) {
  await runOp(ctx, 'budget.create', { name: String(year), start_ym: `${year}-01`, months: 12, rate_syp: 130, rate_eur: 0.89, from: 'empty' });
}

const heads = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM heading');
const lines = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM budget_line');
const budgets = await db.query<{ name: string; start_ym: string; months: number }>('SELECT name, start_ym, months FROM budget ORDER BY id');
console.log(JSON.stringify({ out, headings: heads[0].n, lines: lines[0].n, budgets }));
