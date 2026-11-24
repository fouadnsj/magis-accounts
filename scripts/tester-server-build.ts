// A CLEAN TESTER SERVER for MAGIS Accounts (made 26 November 2026): a data folder + starters holding ONLY INVENTED data, so that a member
// of the team can be given the full Administrator role and try everything without any risk. Nothing here is real: no real person,
// name, amount, donor, phone, and nothing is copied from real-db/ or from any other folder of test-servers/.
//
//   build:  node_modules/.bin/esbuild scripts/tester-server-build.ts --bundle --platform=node --format=esm --outfile=/tmp/tester-server-build.mjs
//   run:    node --no-warnings /tmp/tester-server-build.mjs --out ../test-servers/tester-server --password <text, 8 characters or more> [--port 8294] [--rebuild]
//
// THE PASSWORD is never written in any file or in this script: it is given on the command line, set for every invented person (stored as
// the program stores any password: salted and hashed), and the manager tells it to the tester, who is asked to change it.
// The script REFUSES: a missing or short (< 8) password; any path with "real-db"; a target folder that exists and is not empty (unless --rebuild,
// which moves it to "<folder>-old", never deletes, and only a folder this script made before: it has the file .tester-server).
// Everything is made with the program's own functions (createOffice, createHr, runOp, addHeading, addLine, the sample data of test-data.ts).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import type { Db, Row, SqlValue, Stmt } from '../src/db/db';
import { nowIso } from '../src/db/db';
import { createOffice } from '../src/setup';
import { createHr } from '../src/hr/hr';
import { hashSecret, loadProfile } from '../src/auth';
import { runOp, type OpCtx } from '../src/ops';
import { addHeading, addLine, addNamed, blankTrx, saveBook, setMetaStmt } from '../src/db/repo';
import { mainListFromDb } from '../src/io/mainList';
import { addDays } from '../src/hosting/host';
import { addTestData } from './test-data';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

export const CENTRE_SLUG = 'sample-centre';
export const HR_SLUG = 'sample-hr';
export const CENTRE_NAME = 'MAGIS Sample Centre · مركز ماجيس التجريبي';
export const HR_NAME = 'MAGIS Sample HR · الموارد البشرية التجريبية';
export const DEFAULT_PORT = 8294;
export const MARKER = '.tester-server';

/** the invented people, with their ready-made roles (a person may hold several) */
export const PEOPLE: { name: string; roles: string[]; book?: boolean; about: string }[] = [
  { name: 'Sample Admin', roles: ['administrator'], about: 'Administrator: everything, the Respo book, grants, donors, inventory totals; also in the HR database' },
  { name: 'Sample Director', roles: ['director'], about: 'Director: looks at books, reports and budget, keeps the whole calendar, gives the other roles' },
  { name: 'Sample Accountant', roles: ['accountant'], about: 'Accountant: writes in the Main book, closes the months, sees the calendar' },
  { name: 'Sample Holder 1', roles: ['holder'], book: true, about: 'Book holder: writes in her own cash book' },
  { name: 'Sample Holder 2', roles: ['holder', 'coordinator'], book: true, about: 'Book holder + Coordinator (workshops): her own cash book, and workshop payments go into it' },
  { name: 'Sample Reception', roles: ['reception'], about: 'Reception: the calendar and its contacts, books outside groups, no prices' },
  { name: 'Sample Keeper', roles: ['keeper', 'reception'], about: 'Store keeper + Reception: the inventory and the calendar' },
];

export interface BuildOptions { out: string; password: string; rebuild?: boolean; port?: number; today?: string; log?: (s: string) => void }
export interface BuildSummary { out: string; movedAside: string | null; port: number; people: string[]; centreDb: string; hrDb: string | null; counts: Record<string, number>; problems: string[] }

const parts = (p: string) => path.resolve(p).split(path.sep).map((x) => x.toLowerCase());
/** refuses anything that is, or leads into, real data */
export function refuseRealDb(p: string) {
  if (/real-db/i.test(p) || parts(p).includes('real-db')) throw new Error(`Refused: ${p} is under real-db. This script never touches real data.`);
  let up = path.resolve(p);
  while (!fs.existsSync(up) && path.dirname(up) !== up) up = path.dirname(up);
  try { if (parts(fs.realpathSync(up)).includes('real-db')) throw new Error(`Refused: ${p} leads into real-db.`); } catch (e) { if ((e as Error).message.startsWith('Refused')) throw e; }
}
export function checkPassword(pw: unknown): string {
  if (typeof pw !== 'string' || !pw) throw new Error('The password is missing: run with  --password <text>  (8 characters or more). It is never written in any file.');
  if (pw.length < 8) throw new Error('The password is too short: use 8 characters or more.');
  return pw;
}

function fileDb(file: string): { db: Db; close: () => void } {
  const sq = new DatabaseSync(file);
  sq.exec('PRAGMA foreign_keys = ON');
  return {
    db: {
      async query<T = Row>(sql: string, params: SqlValue[] = []) { return sq.prepare(sql).all(...params) as T[]; },
      async batch(stmts: Stmt[]) {
        sq.exec('BEGIN');
        try { for (const s of stmts) sq.prepare(s.sql).run(...(s.params ?? [])); sq.exec('COMMIT'); } catch (e) { sq.exec('ROLLBACK'); throw e; }
      },
    },
    close: () => sq.close(),
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** today as the people of the house see it (the computer's own date, not UTC: a build at night would be a day behind) */
const localDay = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const addMonths = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return iso(d).slice(0, 7); };

// ---------------------------------------------------------------- the invented lists
const HEADINGS: { name: string; types: ('Income' | 'Exp' | 'Exchange')[]; lines: string[] }[] = [
  { name: 'Gifts and grants · هبات ومنح', types: ['Income'], lines: ['Individual gifts', 'Grants received', 'Friends association'] },
  { name: 'Activity income · إيرادات الأنشطة', types: ['Income'], lines: ['Course fees', 'Hall and room hire'] },
  { name: 'People · الأشخاص', types: ['Exp'], lines: ['Stipends', 'Volunteers’ expenses', 'Training'] },
  { name: 'Premises · المبنى', types: ['Exp'], lines: ['Rent', 'Electricity and water', 'Heating', 'Repairs and cleaning'] },
  { name: 'Programme · البرنامج', types: ['Exp'], lines: ['Youth evenings', 'Courses and workshops', 'Teaching materials', 'Transport'] },
  { name: 'Office · المكتب', types: ['Exp'], lines: ['Stationery', 'Phone and internet'] },
  { name: 'Exchange · تصريف', types: ['Exchange'], lines: ['Exchange'] },
];

export async function buildTesterServer(o: BuildOptions): Promise<BuildSummary> {
  const log = o.log ?? (() => undefined);
  const password = checkPassword(o.password);
  const out = path.resolve(o.out);
  refuseRealDb(out);
  const port = o.port ?? DEFAULT_PORT;
  let movedAside: string | null = null;
  if (fs.existsSync(out) && fs.readdirSync(out).length) {
    if (!o.rebuild) throw new Error(`Refused: ${out} exists and is not empty. To make it again, run with --rebuild (the old folder is moved to "${path.basename(out)}-old", nothing is deleted).`);
    if (!fs.existsSync(path.join(out, MARKER))) throw new Error(`Refused: ${out} was not made by this script (no ${MARKER} file), so it is not moved aside.`);
    let old = `${out}-old`;
    for (let i = 2; fs.existsSync(old); i++) old = `${out}-old-${i}`;
    fs.renameSync(out, old);
    movedAside = old;
  }
  fs.mkdirSync(path.join(out, 'dbs', CENTRE_SLUG), { recursive: true });
  fs.mkdirSync(path.join(out, 'dbs', HR_SLUG), { recursive: true });
  const today = o.today ?? localDay();
  const counts: Record<string, number> = {};
  const problems: string[] = [];
  const add = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

  // ================================================================ THE CENTRE
  const centreFile = path.join(out, 'dbs', CENTRE_SLUG, 'magis.db');
  const { db, close } = fileDb(centreFile);
  await createOffice(db, { organisation: CENTRE_NAME, supName: 'Sample Admin', supPin: password, comName: 'Sample Accountant', comPin: password });
  await db.batch([setMetaStmt('centre', 'other'), setMetaStmt('city', 'Sampleville'), setMetaStmt('sec_hosting', '1'), setMetaStmt('main_list', 'centres')]);

  const files = { docWrite: async () => undefined, docRead: async () => new Uint8Array(), docExists: async () => false, backupNow: async () => undefined } as unknown as OpCtx['files'];
  const ctxOf = async (database: Db, id: number, who: string): Promise<OpCtx> => ({ db: database, profile: (await loadProfile(database, id))!, who, install: 'office', files });
  const adminId = (await db.query<{ id: number }>("SELECT id FROM profile WHERE name = 'Sample Admin'"))[0].id;
  const A = await ctxOf(db, adminId, 'Sample Admin');
  const op = <T = unknown>(name: string, args?: unknown) => runOp(A, name, args) as Promise<T>;
  const note = (what: string, e: unknown) => problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);

  // the standard lines (like the program's main list: headings I01…, E01…, with their lines), then the same as the server's published list
  for (const h of HEADINGS) {
    await addHeading(db, h.name, h.types, 'setup');
    const id = (await db.query<{ id: number }>('SELECT id FROM heading WHERE name = ?', [h.name]))[0].id;
    for (const l of h.lines) await addLine(db, id, l, 'setup');
  }
  await addNamed(db, 'city', 'Sampleville', 'setup');
  const city = (await db.query<{ id: number }>("SELECT id FROM city WHERE name = 'Sampleville'"))[0].id;
  const book = async (name: string) => (await db.query<{ id: number }>('SELECT id FROM book WHERE name = ?', [name]))[0]?.id;
  const mainId = (await db.query<{ id: number }>('SELECT id FROM book WHERE is_main = 1'))[0].id;
  const respoId = (await db.query<{ id: number }>('SELECT id FROM book WHERE private = 1 ORDER BY id'))[0].id;
  await saveBook(db, { id: mainId, name: 'Main', city_id: city, opening_syp: 20000, opening_usd: 1500 }, 'setup');
  await saveBook(db, { id: respoId, name: 'Respo', city_id: city, opening_syp: 2000, opening_usd: 300 }, 'setup');

  // the people, with all the roles
  const roleId: Record<string, number> = Object.fromEntries((await db.query<{ id: number; kind: string }>("SELECT id, kind FROM access_profile WHERE kind IS NOT NULL")).map((r) => [r.kind, r.id]));
  for (const p of PEOPLE) {
    if (p.name === 'Sample Admin') { await op('user.save', { id: adminId, name: p.name, roles: [roleId.administrator], books: [respoId] }); add('people'); continue; }
    if (p.name === 'Sample Accountant') { add('people'); continue; } // made with the centre (the Accountant role)
    try { await op('user.save', { name: p.name, roles: p.roles.map((r) => roleId[r]), books: [], pin: password, makeBook: !!p.book }); add('people'); } catch (e) { note(`person ${p.name}`, e); }
  }
  await db.batch([{ sql: 'UPDATE profile SET must_change = 0' }]); // the tester may change the password; it is not forced at each of the seven sign-ins
  const holder1 = await book('Sample Holder 1'), holder2 = await book('Sample Holder 2');
  if (holder1) await saveBook(db, { id: holder1, name: 'Sample Holder 1', keeper_name: 'Sample Holder 1', city_id: city, opening_syp: 4000, opening_usd: 100 }, 'setup');
  if (holder2) await saveBook(db, { id: holder2, name: 'Sample Holder 2', keeper_name: 'Sample Holder 2', city_id: city, opening_syp: 3000, opening_usd: 80 }, 'setup');

  // parties
  const parties = ['Sample Landlord', 'Sample Electric Company', 'Sample Stationery Shop', 'Sample Friends Association', 'Sample Print Shop'];
  for (const p of parties) await op('party.add', { name: p });
  const party = async (n: string) => (await db.query<{ id: number }>('SELECT id FROM party WHERE name = ?', [n]))[0].id;
  const pid: Record<string, number> = {};
  for (const p of parties) pid[p] = await party(p);
  const lineId = async (n: string) => (await db.query<{ id: number; heading_id: number }>('SELECT id, heading_id FROM budget_line WHERE name = ?', [n]))[0];

  // donor, grant and project (the Administrator sees the Grants)
  let grantId: string | null = null;
  try {
    await op('donor.save', { name: 'Sample Foundation', default_project_id: null });
    await op('grant.save', { donor: 'Sample Foundation', amount: 20000, currency: 'USD', reference: 'SAMPLE-GRANT-1', note: 'Invented grant for testing', here: 'other', shares: [], projects: [{ fund_id: null, new_fund: 'Sample Youth Project' }], start_date: `${today.slice(0, 4)}-01-01`, end_date: `${Number(today.slice(0, 4)) + 1}-12-31` });
    grantId = (await db.query<{ id: string }>("SELECT id FROM grant_card WHERE reference = 'SAMPLE-GRANT-1'"))[0]?.id ?? null;
    add('grants');
  } catch (e) { note('grant', e); }

  // entries: the last five months, SYP and USD, receipts and parties
  const rows: ReturnType<typeof blankTrx>[] = [];
  const row = async (bookId: number, date: string, type: 'Income' | 'Exp', cur: 'SYP' | 'USD', amount: number, lineName: string, explanation: string, extra: { party?: string; receipt?: string; grant?: boolean } = {}) => {
    if (date > today) return;
    const l = await lineId(lineName);
    const t = blankTrx();
    Object.assign(t, { book_id: bookId, city_id: city, date, type, heading_id: l.heading_id, line_id: l.id, explanation, party_id: extra.party ? pid[extra.party] : null, receipt: extra.receipt ?? null, created_by: 'Sample Admin' });
    if (type === 'Income') { if (cur === 'SYP') t.inc_syp = amount; else t.inc_usd = amount; } else if (cur === 'SYP') t.exp_syp = amount; else t.exp_usd = amount;
    if (extra.grant && grantId) t.grant_id = grantId;
    rows.push(t);
  };
  const months = [4, 3, 2, 1, 0].map((n) => addMonths(today.slice(0, 7), -n));
  let k = 0;
  for (const ym of months) {
    k++;
    const d = (n: number) => `${ym}-${String(Math.min(n, daysIn(ym))).padStart(2, '0')}`;
    const rc = (n: number) => `SAMPLE-${ym.replace('-', '')}-${String(n).padStart(2, '0')}`;
    await row(mainId, d(3), 'Income', 'SYP', 6000 + k * 450, 'Individual gifts', 'Sample gifts from visitors');
    await row(mainId, d(5), 'Income', 'USD', 350 + k * 25, 'Friends association', 'Sample monthly gift of the friends association', { party: 'Sample Friends Association' });
    await row(mainId, d(8), 'Exp', 'SYP', 1950, 'Rent', 'Sample rent for the month', { party: 'Sample Landlord', receipt: rc(1) });
    await row(mainId, d(12), 'Exp', 'SYP', 480 + k * 30, 'Electricity and water', 'Sample electricity bill', { party: 'Sample Electric Company', receipt: rc(2) });
    // (the first two months stay under the $50 of the "document needed" rule, so that they can be closed; the later ones ask for a scan)
    await row(mainId, d(15), 'Exp', 'USD', k <= 2 ? 40 : 120, 'Stipends', 'Sample stipend of the month', { receipt: rc(3) });
    await row(mainId, d(20), 'Exp', 'SYP', 650 + k * 40, 'Stationery', 'Sample paper and pens', { party: 'Sample Stationery Shop', receipt: rc(4) });
    await row(mainId, d(22), 'Exp', 'USD', k <= 2 ? 30 + k * 5 : 45 + k * 5, 'Teaching materials', 'Sample teaching materials', { party: 'Sample Print Shop', receipt: rc(5) });
    if (holder1) {
      await row(holder1, d(10), 'Exp', 'SYP', 380 + k * 20, 'Youth evenings', 'Sample refreshments for the youth evening', { receipt: rc(11) });
      await row(holder1, d(18), 'Exp', 'USD', 12, 'Courses and workshops', 'Sample craft supplies');
    }
    if (holder2) {
      await row(holder2, d(11), 'Exp', 'SYP', 250 + k * 15, 'Transport', 'Sample bus tickets for the outing', { receipt: rc(21) });
      await row(holder2, d(19), 'Income', 'USD', 20, 'Course fees', 'Sample course fees received');
    }
  }
  // an exchange on Main (USD given, SYP received) and the Respo book
  {
    const x = await lineId('Exchange');
    const t = blankTrx();
    Object.assign(t, { book_id: mainId, city_id: city, date: addDays(today, -12), type: 'Exchange', heading_id: x.heading_id, line_id: x.id, explanation: 'Sample exchange of dollars', trf_syp: 13000, trf_usd: 100, created_by: 'Sample Admin' });
    rows.push(t);
  }
  await row(respoId, addDays(today, -40), 'Income', 'USD', 2000, 'Grants received', 'Sample instalment of the Sample Foundation grant', { grant: true });
  await row(respoId, addDays(today, -20), 'Exp', 'USD', 150, 'Transport', 'Sample travel of a guest');
  await row(respoId, addDays(today, -9), 'Exp', 'SYP', 900, 'Repairs and cleaning', 'Sample small repair paid privately', { receipt: 'SAMPLE-RESPO-01' });
  try { await op('trx.save', { rows }); add('register entries', rows.length); } catch (e) { note('register entries', e); }

  // a budget for the year, USD a year per line
  try {
    const year = Number(today.slice(0, 4));
    await op('budget.create', { name: String(year), start_ym: `${year}-01`, months: 12, rate_syp: 130, rate_eur: 0.89, from: 'empty' });
    const versionId = (await db.query<{ id: number }>('SELECT MAX(id) AS id FROM budget_version'))[0].id;
    const amounts: Record<string, number> = { 'Individual gifts': 600, 'Grants received': 24000, 'Friends association': 4800, 'Course fees': 300, 'Stipends': 1500, 'Rent': 180, 'Electricity and water': 480, 'Repairs and cleaning': 300, 'Youth evenings': 450, 'Courses and workshops': 400, 'Teaching materials': 700, 'Transport': 500, 'Stationery': 650, 'Phone and internet': 360 };
    const cells = [];
    for (const [n, v] of Object.entries(amounts)) cells.push({ line_id: (await lineId(n)).id, amount_usd: v });
    await op('budget.saveAmounts', { versionId, cells });
    add('budgets');
  } catch (e) { note('budget', e); }

  // the first two months closed (the others stay open to be closed by the tester)
  for (const ym of months.slice(0, 2)) {
    try {
      // each cash book is closed first, with the cash counted equal to the book
      for (const b of [holder1, holder2]) {
        if (!b) continue;
        const bal = await op<{ syp: number; usd: number }>('bookMonth.balance', { bookId: b, ym });
        await op('bookMonth.close', { bookId: b, ym, counted_syp: bal.syp, counted_usd: bal.usd });
      }
      await op('month.close', { ym });
      add('months closed');
    } catch (e) { note(`closing ${ym} (left open; the tester can close it)`, e); }
  }

  // the calendar and the inventory: the sample data of test-data.ts, with its weeks starting this week, and a few things TODAY and the next days
  const monday = addDays(today, -((dow(today) + 6) % 7)); // this week's Monday
  try {
    const r = await addTestData(centreFile, { backup: false, today: addDays(monday, -1) }); // "today" for it = the Sunday before this week: its first Monday is this Monday
    for (const [kk, v] of Object.entries(r.added)) add(`sample ${kk}`, v);
    problems.push(...r.problems.map((x) => `sample data: ${x}`));
  } catch (e) { note('sample calendar and inventory', e); }
  try {
    type CalGet = { orgs: { id: number; name: string }[]; persons: { id: number; org_id: number; active: number }[]; spaces: { id: number; name: string }[]; activityKinds: { id: number; name: string }[] };
    const d = await op<CalGet>('cal.get');
    const orgOf = (n: string) => d.orgs.find((x) => x.name === n);
    const sp = (n: string) => d.spaces.find((x) => x.name === n)?.id;
    const person = (orgId?: number) => d.persons.find((x) => x.org_id === orgId && x.active)?.id;
    const mk = async (key: string, label: string, a: Record<string, unknown>) => {
      try {
        const r = await op<{ saved: boolean; refused?: string }>('cal.booking.save', { force: true, without_taken: true, ...a, note: `SAMPLE ${key} · ${label}` });
        if (r.saved) add('bookings around today'); else problems.push(`booking ${key} not saved: ${r.refused ?? '?'}`);
      } catch (e) { note(`booking ${key}`, e); }
    };
    const school = orgOf('Sample School'), parish = orgOf('Sample Parish of St Example'), choir = orgOf('Sample Choir Association');
    await mk('t1', 'workshop in the hall today', { origin: 'outside', org_id: school?.id, person_id: person(school?.id), people: 30, from_day: today, time_from: '10:00', time_to: '12:00', spaces: [sp('Sample Hall')].filter(Boolean), status: 'confirmed', price_mode: 'group', free: false, rate: 80, currency: 'USD' });
    await mk('t2', 'a group arrives today for three nights', { origin: 'outside', kind: 'stay', org_id: parish?.id, person_id: person(parish?.id), people: 3, from_day: today, to_day: addDays(today, 3), spaces: [sp('Sample Bedroom 2')].filter(Boolean), status: 'confirmed', price_mode: 'person', free: false, rate: 12, currency: 'USD' });
    await mk('t3', 'a group leaves today', { origin: 'outside', kind: 'stay', org_id: choir?.id, person_id: person(choir?.id), people: 2, from_day: addDays(today, -2), to_day: today, spaces: [sp('Sample Bedroom 3')].filter(Boolean), status: 'confirmed', price_mode: 'person', free: false, rate: 10, currency: 'USD' });
    await mk('t4', 'classroom tomorrow', { origin: 'outside', org_id: choir?.id, person_id: person(choir?.id), people: 14, from_day: addDays(today, 1), time_from: '14:00', time_to: '16:00', spaces: [sp('Sample Classroom')].filter(Boolean), status: 'confirmed', price_mode: 'group', free: false, rate: 35, currency: 'USD' });
    await mk('t5', 'hall in two days, to confirm', { origin: 'outside', org_id: parish?.id, person_id: person(parish?.id), people: 40, from_day: addDays(today, 2), time_from: '09:00', time_to: '11:00', spaces: [sp('Sample Hall')].filter(Boolean), status: 'option', hold_until: addDays(today, 1), price_mode: 'group', free: false, rate: 60, currency: 'USD' });
  } catch (e) { note('bookings around today', e); }
  close();

  // ================================================================ THE HR DATABASE
  let hrDb: string | null = null;
  let hrAdminId: number | null = null;
  try {
    const hrFile = path.join(out, 'dbs', HR_SLUG, 'magis.db');
    const h = fileDb(hrFile);
    await createHr(h.db, { organisation: HR_NAME, people: [{ name: 'Sample Admin', password }], mustChange: false });
    hrAdminId = (await h.db.query<{ id: number }>("SELECT id FROM profile WHERE name = 'Sample Admin'"))[0].id;
    const H = await ctxOf(h.db, hrAdminId, 'Sample Admin');
    const staff: [string, string, string, string][] = [['Sample', 'Teacher One', 'Teacher', '2025-09-01'], ['Sample', 'Assistant Two', 'Assistant', '2025-10-15'], ['Sample', 'Cook Three', 'Cook', '2026-01-10']];
    for (const [first, last, role, started] of staff) { await runOp(H, 'hr.person.save', { name: `${first} ${last}`, first_name: first, last_name: last, role, started, category: 'staff' }); add('HR staff'); }
    await runOp(H, 'hr.person.save', { name: 'Sample Tutor Four', first_name: 'Sample', last_name: 'Tutor Four', role: 'Tutor', started: '2026-02-01', category: 'tutor', activity: 'English course' });
    add('HR tutors');
    h.close();
    hrDb = hrFile;
  } catch (e) { note('HR database (left out)', e); hrAdminId = null; }

  // ================================================================ THE FIRST-PAGE DIRECTORY, THE SERVER'S FILES, THE STARTERS
  const c = fileDb(centreFile);
  const ids = Object.fromEntries((await c.db.query<{ id: number; name: string }>('SELECT id, name FROM profile')).map((r) => [r.name, r.id]));
  // the main list the centre follows: published as it is (the same headings, codes and lines)
  const list = await mainListFromDb(c.db, 'MAGIS Sample Server', CENTRE_NAME);
  c.close();
  fs.mkdirSync(path.join(out, 'main-lists'), { recursive: true });
  fs.writeFileSync(path.join(out, 'main-lists', 'centres.json'), JSON.stringify({ ...list, id: 'centres', title: 'Sample list', version: 1, published_at: nowIso() }, null, 1));

  const people = [];
  let next = 1;
  for (const p of PEOPLE) {
    const salt = randomBytes(16).toString('base64url');
    const grants: Record<string, number | null> = { [CENTRE_SLUG]: ids[p.name] };
    if (p.name === 'Sample Admin' && hrAdminId != null) grants[HR_SLUG] = hrAdminId;
    people.push({ id: next++, name: p.name, salt, hash: await hashSecret(salt, password), admin: false, active: true, mustChange: false, grants });
  }
  fs.writeFileSync(path.join(out, 'directory.json'), JSON.stringify({ enforced: true, next, people }, null, 2));
  fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({ httpPort: port, httpMode: 'serve', idleMinutes: 60 }, null, 2));
  fs.writeFileSync(path.join(out, MARKER), 'Made by scripts/tester-server-build.ts. All data here is invented.\n');
  fs.writeFileSync(path.join(out, 'START-TESTER-SERVER.command'), MAC_STARTER(port), { mode: 0o755 });
  fs.chmodSync(path.join(out, 'START-TESTER-SERVER.command'), 0o755);
  fs.writeFileSync(path.join(out, 'START-TESTER-SERVER.bat'), WIN_STARTER(port).replace(/\n/g, '\r\n'));
  fs.writeFileSync(path.join(out, 'README-TESTER-SERVER.md'), README(port, hrDb != null));
  log(`built ${out}`);
  return { out, movedAside, port, people: PEOPLE.map((p) => p.name), centreDb: centreFile, hrDb, counts, problems };
}

// ---------------------------------------------------------------- the starters and the README (no password in any of them)
const MAC_STARTER = (port: number) => `#!/bin/bash
# MAGIS Accounts — TESTER SERVER. Every name, amount and person in it is INVENTED. Double-click to start; close this window to stop.
cd "$(dirname "$0")"
NODE="$HOME/.local/node/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"
if [ -z "$NODE" ]; then echo "Node was not found. Tell the person who gave you this folder."; read -r -p "Press Return"; exit 1; fi
SERVER="../../app/server-dist/server.mjs"
[ -f "$SERVER" ] || SERVER="../app/server-dist/server.mjs"
if [ ! -f "$SERVER" ]; then echo "The program (app/server-dist/server.mjs) was not found next to this folder."; read -r -p "Press Return"; exit 1; fi
echo "MAGIS Accounts — TESTER SERVER (invented data only)"
echo "Open:  http://localhost:${port}   Sign in with a name from README-TESTER-SERVER.md and the password you were given."
echo "Close this window to stop the server."
echo ""
( sleep 2; open "http://localhost:${port}" ) &
exec "$NODE" --no-warnings "$SERVER" --data="$PWD" --http-only --port=${port}
`;
const WIN_STARTER = (port: number) => `@echo off
rem MAGIS Accounts - TESTER SERVER. Every name, amount and person in it is INVENTED. Double-click to start; close this window to stop.
cd /d "%~dp0"
set SERVER=..\\..\\app\\server-dist\\server.mjs
if not exist "%SERVER%" set SERVER=..\\app\\server-dist\\server.mjs
if not exist "%SERVER%" (
  echo The program app\\server-dist\\server.mjs was not found next to this folder.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node was not found. Tell the person who gave you this folder.
  pause
  exit /b 1
)
echo MAGIS Accounts - TESTER SERVER (invented data only)
echo Open http://localhost:${port}  and sign in with a name from README-TESTER-SERVER.md and the password you were given.
echo Close this window to stop the server.
start "" "http://localhost:${port}"
node --no-warnings "%SERVER%" --data="%~dp0." --http-only --port=${port}
`;
const README = (port: number, hr: boolean) => `# MAGIS Accounts — tester server

**Everything in this folder is INVENTED.** The centre "MAGIS Sample Centre · مركز ماجيس التجريبي" (city: Sampleville), its people, amounts, donor, grant, parties, bookings and
inventory are made up for testing. There is no real person, no real money, no real data. It is safe to try anything, to break things, and to start again.

## Start
- **Mac:** double-click \`START-TESTER-SERVER.command\`. **Windows:** double-click \`START-TESTER-SERVER.bat\`.
- The browser opens at **http://localhost:${port}**. Closing the window stops the server.
- Use it on **one computer only** (the one that runs it). Do not put it on the internet.

## Sign in (on the first page: name + password)
On the first page click any badge (for example **المدير · Administrator · Sign in**), type the name and the password, then choose **MAGIS centres** and **MAGIS Sample Centre**.
The password is given to you by the person who built this folder. It is not written here. **Please change it** (Settings) if anyone else can reach the computer.
Names (all with the same password):

| Name | Roles |
|---|---|
${PEOPLE.map((p) => `| ${p.name} | ${p.about} |`).join('\n')}

Doors you should see: **Sample Admin** — Accounts, Calendar, Inventory${hr ? ', HR' : ''} and Administration; **Sample Director** — the same without HR; **Sample Accountant** — Accounts, Calendar and Inventory (the program's Accountant role has the inventory ticks); **Sample Holder 1** — Accounts and Calendar; **Sample Holder 2** — Accounts, Calendar and Inventory (Coordinator) and she can take workshop payments into her own book; **Sample Reception** — Calendar only; **Sample Keeper** — Calendar and Inventory.
Payments made in the Calendar wait for the books (Accounts → "Payments waiting for the books").

## What is in it
- Accounts: five months of invented entries in SYP and USD with receipts and parties (Main book, two cash books, the private Respo book), a budget for the year, the first two months closed, the others open to close.
- A donor ("Sample Foundation"), one grant and one project, so the Administrator sees the Grants.
- The calendar: areas, halls, a classroom, bedrooms, a kitchen, a store; bookings and payments; things happening **today** and on the next days (when the folder was built).
- The inventory with sample items, a count, a reported problem.
- The TV at the entrance: in the Calendar settings make a link code for a screen, then open \`http://localhost:${port}/tv\` and type the code.
${hr ? '- An HR database with three invented staff and one invented tutor (Sample Admin only).\n' : ''}
## Start again from nothing
Ask the person who built it to run the build script again with \`--rebuild\`: the old folder is moved to \`tester-server-old\` (nothing is deleted) and a fresh one is made. If your bookings are all in the past, that is also the way to get new "today" data.
`;

// ------------------------------------------------------------------ run from the command line
const entry = process.argv[1] ?? '';
if (/tester-server-build\.(mjs|ts|js)$/.test(entry)) {
  const get = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  try {
    const out = get('out');
    if (!out) throw new Error('usage: node tester-server-build.mjs --out <folder> --password <text, 8+ characters> [--port 8294] [--rebuild]');
    const r = await buildTesterServer({ out, password: get('password') as string, rebuild: process.argv.includes('--rebuild'), port: get('port') ? Number(get('port')) : undefined, log: console.log });
    console.log(`\nTester server ready: ${r.out}${r.movedAside ? `\nThe old folder was moved to: ${r.movedAside}` : ''}`);
    console.log(`Centre database: ${r.centreDb}\nHR database: ${r.hrDb ?? '(left out)'}\nPort: ${r.port}\nPeople (one password for all, the one you typed): ${r.people.join(', ')}`);
    console.log(`Made: ${JSON.stringify(r.counts)}`);
    if (r.problems.length) console.log(`\nNot done (${r.problems.length}):\n - ${r.problems.join('\n - ')}`);
    console.log(`\nStart it: double-click ${path.join(r.out, 'START-TESTER-SERVER.command')}   (or run the same on Windows: START-TESTER-SERVER.bat).`);
    console.log('Tell the tester the password and ask them to change it.');
  } catch (e) { console.error((e as Error).message); process.exit(e instanceof Error && /Refused|password|usage/i.test(e.message) ? 2 : 1); }
}
