// SAMPLE data for testing the new Calendar and Inventory (job J4, 24 November 2026). Fills a COPY of a centre database with
// invented, clearly marked sample data, using the program's own operations (cal.*, inv.*), so that numbers (H…, HR…), history
// and rules are the program's. Nothing here is real: no real people, no real phone numbers.
//
//   build:  node_modules/.bin/esbuild scripts/test-data.ts --bundle --platform=node --format=esm --outfile=/tmp/test-data.mjs
//   run:    node --no-warnings /tmp/test-data.mjs <data-folder> <db-name>
//   e.g.    node --no-warnings /tmp/test-data.mjs ../test-servers/next-test magis-homs      (stop the server on that folder first)
//
// <data-folder> holds dbs/<db-name>/magis.db (like test-servers/next-test). The script:
//  - REFUSES any path with "real-db" in it, and any path that is not <folder>/dbs/<db>/magis.db;
//  - first makes its own backup copy: dbs/<db>/backups/<time>_before-test-data.db;
//  - adds ONLY sample data, each thing marked (names start with "Sample", notes with "SAMPLE <key>") and NEVER twice:
//    run it again and it adds nothing (it skips what exists); what Fouad typed is kept (spaces: only what is missing is added).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Db, Row, SqlValue, Stmt } from '../src/db/db';
import { migrate, nowIso } from '../src/db/db';
import { loadProfile } from '../src/auth';
import { runOp, type OpCtx } from '../src/ops';
import { addDays } from '../src/hosting/host';
import type { CalData } from '../src/hosting/calendar';
import { INV_AREA } from '../src/inventory/map';
import { problemsAvailable } from '../src/inventory/ops';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

export interface SampleReport { backup: string | null; added: Record<string, number>; skipped: Record<string, number>; problems: string[] }

function fileDb(sq: InstanceType<typeof DatabaseSync>): Db {
  sq.exec('PRAGMA foreign_keys = ON');
  return {
    async query<T = Row>(sql: string, params: SqlValue[] = []) { return sq.prepare(sql).all(...params) as T[]; },
    async batch(stmts: Stmt[]) {
      sq.exec('BEGIN');
      try { for (const s of stmts) sq.prepare(s.sql).run(...(s.params ?? [])); sq.exec('COMMIT'); } catch (e) { sq.exec('ROLLBACK'); throw e; }
    },
  };
}

/** the file of a database inside a data folder; refuses real data */
export function dbFileOf(folder: string, name: string): string {
  const parts = (p: string) => path.resolve(p).split(path.sep).map((x) => x.toLowerCase());
  const file = path.resolve(folder, 'dbs', name, 'magis.db');
  if (parts(folder).includes('real-db') || parts(file).includes('real-db') || /real-db/i.test(folder) || /real-db/i.test(name)) throw new Error(`Refused: ${file} is under real-db. This script is for copies only.`);
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) throw new Error(`Refused: "${name}" is not a plain database name.`);
  if (!fs.existsSync(file)) throw new Error(`No database at ${file}`);
  try { if (parts(fs.realpathSync(file)).includes('real-db')) throw new Error(`Refused: ${file} leads into real-db.`); } catch (e) { if ((e as Error).message.startsWith('Refused')) throw e; }
  return file;
}

const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday

export async function addTestData(file: string, opts: { backup?: boolean; today?: string } = {}): Promise<SampleReport> {
  const report: SampleReport = { backup: null, added: {}, skipped: {}, problems: [] };
  const sq = new DatabaseSync(file);
  if (opts.backup !== false) {
    const dir = path.join(path.dirname(file), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    let dest = path.join(dir, `${nowIso().replace(/:/g, '-').slice(0, 19)}_before-test-data.db`);
    for (let i = 2; fs.existsSync(dest); i++) dest = dest.replace(/(-\d+)?\.db$/, `-${i}.db`);
    sq.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    report.backup = dest;
  }
  const db = fileDb(sq);
  await migrate(db);
  const sup = (await db.query<{ id: number; name: string }>("SELECT id, name FROM profile WHERE role = 'sup' ORDER BY id LIMIT 1"))[0];
  if (!sup) throw new Error('This database has no Superior profile.');
  const files = { docWrite: async () => undefined, docRead: async () => new Uint8Array(), docExists: async () => false } as unknown as OpCtx['files'];
  const c: OpCtx = { db, profile: (await loadProfile(db, sup.id))!, who: sup.name, install: 'office', files };
  const op = <T = unknown>(name: string, args: unknown) => runOp(c, name, args) as Promise<T>;
  const cal = () => op<CalData>('cal.get', undefined);
  const add = (k: string, n = 1) => { report.added[k] = (report.added[k] ?? 0) + n; };
  const skip = (k: string, n = 1) => { report.skipped[k] = (report.skipped[k] ?? 0) + n; };
  const fail = (what: string, e: unknown) => { report.problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`); };

  const today = opts.today ?? nowIso().slice(0, 10);
  // day 0 of the sample weeks: the first Monday after today, and after any space closed for repairs now (what Fouad typed stays free of clashes)
  const shut = (await db.query<{ n: string | null }>("SELECT MAX(to_day) AS n FROM cal_space_closed WHERE cancelled = 0 AND to_day >= ? AND from_day <= ?", [today, addDays(today, 60)]))[0]?.n;
  const after = shut && shut > today ? shut : today;
  const M = addDays(after, 7 - ((dow(after) + 6) % 7));
  const D = (n: number) => addDays(M, n);
  const pre = (list: { id: number; name: string }[], start: string) => list.find((x) => x.name.toLowerCase().startsWith(start.toLowerCase()))?.id ?? null;

  // ---------------------------------------------------------------- spaces: only what is missing
  let d = await cal();
  const area = d.areas.find((a) => a.active && a.name !== INV_AREA);
  let areaId = area?.id;
  if (areaId == null) { areaId = ((await op<{ id: number }>('cal.area.save', { name: 'Sample building' })).id); add('areas'); }
  const need: { kind: string; count: number; label: string; extra: Record<string, unknown> }[] = [
    { kind: 'Hall', count: 1, label: 'Hall', extra: { capacity: 60, rentable: true, fixed: 'projector, 40 chairs' } },
    { kind: 'Classroom', count: 1, label: 'Classroom', extra: { capacity: 25, rentable: true } },
    { kind: 'Bedroom', count: 3, label: 'Bedroom', extra: { beds: 3, rentable: true } },
    { kind: 'Kitchen', count: 1, label: 'Kitchen', extra: { capacity: 8, rentable: false } },
    { kind: 'Store', count: 1, label: 'Store', extra: { bookable: false, rentable: false } },
  ];
  const mine: Record<string, number[]> = {}; // the spaces to use, for each kind: the existing ones first
  for (const n of need) {
    const kind = d.kinds.find((k) => k.name.toLowerCase().startsWith(n.kind.toLowerCase()));
    if (!kind) { fail(`space kind ${n.kind}`, 'the kind does not exist in this database'); mine[n.kind] = []; continue; }
    const have = d.spaces.filter((s) => s.kind_id === kind.id && s.active);
    mine[n.kind] = have.map((s) => s.id);
    skip('spaces', Math.min(have.length, n.count));
    const inArea = have[0]?.building_id ?? areaId;
    for (let i = have.length; i < n.count; i++) {
      const name = n.count > 1 ? `Sample ${n.label} ${i + 1}` : `Sample ${n.label}`;
      try { mine[n.kind].push((await op<{ id: number }>('cal.space.save', { building_id: inArea, name, kind_id: kind.id, ...n.extra })).id); add('spaces'); } catch (e) { fail(`space ${name}`, e); }
    }
  }
  d = await cal();
  // the places of the inventory are the spaces' places
  const place = (spaceId: number) => d.spaces.find((s) => s.id === spaceId)?.place_id ?? null;
  const hall = mine.Hall[0], classroom = mine.Classroom[0], kitchen = mine.Kitchen[0], store = mine.Store[0], beds = mine.Bedroom.slice(0, 3);
  const otherHall = mine.Hall[1] ?? hall; // a second hall if the centre has one

  // ---------------------------------------------------------------- organisations (5) with persons
  const orgDefs: { key: string; name: string; kind: string; note: string; persons: [string, string][] }[] = [
    { key: 'parish', name: 'Sample Parish of St Example', kind: 'Parish group', note: 'SAMPLE · pays on arrival', persons: [['Sample Contact A1', '000 000 101'], ['Sample Contact A2', '000 000 102']] },
    { key: 'choir', name: 'Sample Choir Association', kind: 'Association', note: 'SAMPLE · pays each month', persons: [['Sample Contact B1', '000 000 201']] },
    { key: 'school', name: 'Sample School', kind: 'School', note: 'SAMPLE', persons: [['Sample Contact C1', '000 000 301'], ['Sample Contact C2', '000 000 302']] },
    { key: 'inst', name: 'Sample Language Institute', kind: 'Company', note: 'SAMPLE', persons: [['Sample Contact D1', '000 000 401']] },
    { key: 'family', name: 'Sample Family Gathering', kind: 'Person', note: 'SAMPLE · private person', persons: [['Sample Contact E1', '000 000 501']] },
  ];
  const org: Record<string, { id: number; person: number | null }> = {};
  for (const o of orgDefs) {
    const had = d.orgs.find((x) => x.name.toLowerCase() === o.name.toLowerCase());
    if (had) { skip('organisations'); org[o.key] = { id: had.id, person: d.persons.find((p) => p.org_id === had.id && p.active)?.id ?? null }; continue; }
    try {
      const r = await op<{ id: number }>('cal.org.save', { name: o.name, kind_id: pre(d.orgKinds, o.kind), note: o.note, persons: o.persons.map(([name, phone]) => ({ name, phone })) });
      add('organisations');
      org[o.key] = { id: r.id, person: null };
    } catch (e) { fail(`organisation ${o.name}`, e); }
  }
  d = await cal();
  for (const k of Object.keys(org)) org[k].person = d.persons.find((p) => p.org_id === org[k].id && p.active)?.id ?? null;

  // ---------------------------------------------------------------- equipment the calendar may ask for, from the inventory (below)
  // (made after the items exist)

  // ---------------------------------------------------------------- bookings: each has a key in its note: never twice
  const keyed = async (key: string) => (await db.query<{ id: number }>("SELECT id FROM host_booking WHERE note LIKE ?", [`SAMPLE ${key} %`]))[0]?.id ?? null;
  const svc = (start: string) => pre(d.services, start);
  const ak = (start: string) => pre(d.activityKinds, start);
  type Saved = { saved: boolean; id?: number; refused?: string; clashes?: { name: string }[]; takenDays?: string[] };
  /** saves a booking once; returns its id when it was made now (null if it existed or was refused: then nothing follows) */
  const book = async (key: string, label: string, a: Record<string, unknown>): Promise<number | null> => {
    if (await keyed(key)) { skip('bookings'); return null; }
    try {
      const r = await op<Saved>('cal.booking.save', { force: true, without_taken: true, ...a, note: `SAMPLE ${key} · ${label}` });
      if (!r.saved) { fail(`booking ${key} (${label})`, `not saved: ${r.refused ?? '?'} ${JSON.stringify(r).slice(0, 300)}`); return null; }
      add('bookings');
      return r.id ?? null;
    } catch (e) { fail(`booking ${key} (${label})`, e); return null; }
  };
  const pay = async (id: number | null, amount: number, currency: 'USD' | 'SYP', method: 'cash' | 'transfer', daysAgo: number, note: string) => {
    if (id == null) return;
    try { await op('cal.pay.add', { booking_id: id, amount, currency, method, paid_on: addDays(today, -daysAgo), note: `SAMPLE ${note}` }); add('payments'); } catch (e) { fail(`payment of ${amount} ${currency}`, e); }
  };

  // our weekly activities (courses), several hours; Monday = 1 … Sunday = 0
  const ours: { key: string; title: string; kind: string; leader: string; days: number[]; from: string; to: string; space: number | undefined; people: number }[] = [
    { key: 'a1', title: 'Sample English course', kind: 'Course', leader: 'Sample Teacher 1', days: [1, 3], from: '17:00', to: '18:30', space: classroom, people: 15 },
    { key: 'a2', title: 'Sample Cinema club', kind: 'Club', leader: 'Sample Leader 2', days: [4], from: '18:00', to: '20:00', space: hall, people: 30 },
    { key: 'a3', title: 'Sample Youth workshop', kind: 'Workshop', leader: 'Sample Leader 3', days: [6], from: '10:00', to: '12:00', space: hall, people: 20 },
    { key: 'a4', title: 'Sample Computer training', kind: 'Training', leader: 'Sample Teacher 4', days: [2], from: '09:00', to: '11:00', space: classroom, people: 12 },
    { key: 'a5', title: 'Sample Prayer group', kind: 'Prayer', leader: 'Sample Leader 5', days: [5], from: '19:00', to: '20:00', space: classroom, people: 10 },
    { key: 'a6', title: 'Sample Catechism', kind: 'Christian', leader: 'Sample Leader 6', days: [0], from: '10:00', to: '11:30', space: otherHall, people: 25 },
    { key: 'a7', title: 'Sample Cooking club', kind: 'Club', leader: 'Sample Leader 7', days: [3], from: '10:00', to: '12:00', space: kitchen, people: 8 },
  ];
  const id: Record<string, number | null> = {};
  for (const a of ours) {
    if (a.space == null) { fail(`activity ${a.key}`, 'no space for it'); continue; }
    id[a.key] = await book(a.key, a.title, { origin: 'ours', title: a.title, activity_kind_id: ak(a.kind), leader: a.leader, people: a.people, from_day: D(0), to_day: D(63), repeat_days: a.days, time_from: a.from, time_to: a.to, spaces: [a.space], status: 'confirmed' });
  }
  // one date cancelled, one moved
  if (id.a1) { try { await op('cal.date.change', { booking_id: id.a1, day: D(7), action: 'cancel', reason: 'Sample: public holiday' }); add('date changes'); } catch (e) { fail('a date cancelled', e); } }
  if (id.a2) { try { const r = await op<{ ok: boolean; refused?: string }>('cal.date.change', { booking_id: id.a2, day: D(10), action: 'move', to_day: D(8), time_from: '18:00', time_to: '20:00', reason: 'Sample: the hall is needed on Thursday' }); if (r.ok) add('date changes'); else fail('a date moved', r.refused ?? 'refused'); } catch (e) { fail('a date moved', e); } }
  // the whole centre one Saturday; an activity outside the centre
  await book('a8', 'open day, whole centre', { origin: 'ours', title: 'Sample Open day', activity_kind_id: ak('Event'), people: 200, from_day: D(75), to_day: D(75), whole_centre: true });
  await book('a9', 'camp outside the centre', { origin: 'ours', title: 'Sample Camp outside', activity_kind_id: ak('Event'), people: 25, from_day: D(30), to_day: D(32), outside_place: 'Sample farm' });

  // outside bookings: prices in USD and SYP, services, equipment (the equipment comes after the items: see below)
  const coffee = svc('Break'), lunch = svc('Lunch'), breakfast = svc('Breakfast');
  const grp = { price_mode: 'group', free: false };
  const b01 = await book('b01', 'parish afternoon, projector', { origin: 'outside', org_id: org.parish?.id, person_id: org.parish?.person, people: 40, from_day: D(1), time_from: '15:00', time_to: '18:00', spaces: [hall], status: 'confirmed', ...grp, rate: 60, currency: 'USD', lines: [{ service_id: coffee, qty: 40, amount: 30, currency: 'USD' }] });
  await pay(b01, 30, 'USD', 'cash', 5, 'advance for b01');
  await pay(b01, 60, 'USD', 'cash', 0, 'rest of b01, paid in full');
  const b02 = await book('b02', 'choir, every Wednesday, 25 USD each date', { origin: 'outside', org_id: org.choir?.id, person_id: org.choir?.person, people: 25, from_day: D(2), to_day: D(37), repeat_days: [3], time_from: '17:00', time_to: '19:00', spaces: [hall], status: 'confirmed', ...grp, price_each: true, rate: 25, currency: 'USD' });
  await pay(b02, 75, 'USD', 'transfer', 3, 'half of b02');
  const b03 = await book('b03', 'school morning, prices in SYP', { origin: 'outside', org_id: org.school?.id, person_id: org.school?.person, people: 25, from_day: D(3), time_from: '09:00', time_to: '12:00', spaces: [classroom], status: 'confirmed', ...grp, rate: 400000, currency: 'SYP', lines: [{ service_id: lunch, qty: 25, amount: 150000, currency: 'SYP' }] });
  await pay(b03, 550000, 'SYP', 'transfer', 1, 'b03 paid in full');
  await book('b04', 'language institute, Saturdays, per person', { origin: 'outside', org_id: org.inst?.id, person_id: org.inst?.person, people: 15, from_day: D(5), to_day: D(33), repeat_days: [6], time_from: '14:00', time_to: '17:00', spaces: [classroom], status: 'confirmed', price_mode: 'person', free: false, rate: 5, currency: 'USD' });
  await book('b05', 'choir rehearsal, to confirm', { origin: 'outside', org_id: org.choir?.id, person_id: org.choir?.person, people: 40, from_day: D(11), time_from: '16:00', time_to: '20:00', spaces: [hall], status: 'option', hold_until: D(9), ...grp, rate: 80, currency: 'USD' });
  await book('b06', 'parish, to confirm, date already passed', { origin: 'outside', org_id: org.parish?.id, person_id: org.parish?.person, people: 12, from_day: D(16), time_from: '10:00', time_to: '12:00', spaces: [classroom], status: 'option', hold_until: addDays(today, -2), ...grp, rate: 35, currency: 'USD' });
  const b07 = await book('b07', 'private booking', { origin: 'outside', org_id: org.family?.id, person_id: org.family?.person, private: true, people: 40, from_day: D(12), time_from: '15:00', time_to: '19:00', spaces: [hall], status: 'confirmed', ...grp, rate: 120, currency: 'USD', lines: [{ service_id: coffee, qty: 40, amount: 40, currency: 'USD' }] });
  await pay(b07, 50, 'USD', 'cash', 2, 'advance for b07');
  // a stay of 3 nights with breakfast (three bedrooms), and a stay going on now
  const b08 = beds.length ? await book('b08', 'stay of 3 nights with breakfast', { origin: 'outside', kind: 'stay', org_id: org.school?.id, person_id: org.school?.person, people: beds.length * 2, from_day: D(14), to_day: D(17), spaces: beds, status: 'confirmed', price_mode: 'person', free: false, rate: 15, currency: 'USD', lines: [{ service_id: breakfast, qty: beds.length * 6, amount: 36, currency: 'USD' }] }) : null;
  await pay(b08, 100, 'USD', 'cash', 0, 'advance for the stay b08');
  const b09 = beds.length ? await book('b09', 'stay going on now', { origin: 'outside', kind: 'stay', org_id: org.parish?.id, person_id: org.parish?.person, people: 2, from_day: addDays(today, -1), to_day: addDays(today, 2), spaces: [beds[0]], status: 'confirmed', price_mode: 'person', free: false, rate: 10, currency: 'USD' }) : null;
  if (b09) { try { await op('cal.booking.status', { id: b09, status: 'arrived' }); add('arrivals'); } catch (e) { fail('arrival of b09', e); } }
  // ONE cancellation: an advance paid, a part kept, the rest given back (the program makes its HR… number)
  const b10 = await book('b10', 'cancelled: part kept, money given back', { origin: 'outside', org_id: org.parish?.id, person_id: org.parish?.person, people: 30, from_day: D(4), time_from: '10:00', time_to: '13:00', spaces: [hall], status: 'confirmed', ...grp, rate: 100, currency: 'USD' });
  await pay(b10, 60, 'USD', 'cash', 4, 'advance for b10');
  if (b10) { try { await op('cal.booking.cancel', { id: b10, reason: 'Sample: the group postponed', money: 'part', kept_usd: 20 }); add('cancellations'); } catch (e) { fail('cancelling b10', e); } }
  await book('b13', 'school fair, free', { origin: 'outside', org_id: org.school?.id, person_id: org.school?.person, people: 40, from_day: D(25), time_from: '09:00', time_to: '13:00', spaces: [hall], status: 'confirmed' });
  await book('b14', 'parish, every Thursday evening, 15 USD each date', { origin: 'outside', org_id: org.parish?.id, person_id: org.parish?.person, people: 18, from_day: D(17), to_day: D(38), repeat_days: [4], time_from: '18:00', time_to: '19:30', spaces: [classroom], status: 'confirmed', ...grp, price_each: true, rate: 15, currency: 'USD' });
  await book('b15', 'choir concert, to confirm', { origin: 'outside', org_id: org.choir?.id, person_id: org.choir?.person, people: 40, from_day: D(26), time_from: '15:00', time_to: '17:30', spaces: [hall], status: 'option', hold_until: D(12), ...grp, rate: 90, currency: 'USD' });
  await book('b16', 'school, classroom, free', { origin: 'outside', org_id: org.school?.id, person_id: org.school?.person, people: 20, from_day: D(25), time_from: '10:00', time_to: '12:00', spaces: [classroom], status: 'confirmed' });
  await book('b17', 'language institute, evening, SYP', { origin: 'outside', org_id: org.inst?.id, person_id: org.inst?.person, people: 30, from_day: D(19), time_from: '18:30', time_to: '21:00', spaces: [hall], status: 'confirmed', ...grp, rate: 300000, currency: 'SYP' });

  // ---------------------------------------------------------------- inventory
  const cats = (await op<{ categories: { id: number; name: string }[]; origins: { id: number; name: string; bought: number }[] }>('inv.get', undefined));
  const cat = (start: string) => pre(cats.categories, start);
  const old = cats.origins.find((o) => !o.bought && o.name.toLowerCase().startsWith('old'))?.id ?? cats.origins.find((o) => !o.bought)?.id ?? null;
  const gift = cats.origins.find((o) => !o.bought && o.name.toLowerCase().startsWith('gift'))?.id ?? old;
  type Item = { key: string; name: string; cat: string; space: number | undefined; qty?: number; serial?: string; brand?: string; model?: string; condition?: 'good' | 'repair' | 'broken'; holder?: string; value?: number; gift?: boolean };
  const items: Item[] = [
    { key: 'i01', name: 'Chairs', cat: 'Furniture', space: hall, qty: 40, value: 8 },
    { key: 'i02', name: 'Tables', cat: 'Furniture', space: hall, qty: 8, value: 25 },
    { key: 'i03', name: 'Projector', cat: 'Audio', space: hall, serial: 'SAMPLE-PRJ-001', brand: 'SampleBrand', model: 'P100', value: 450 },
    { key: 'i04', name: 'Sound speaker', cat: 'Audio', space: hall, qty: 2, value: 120 },
    { key: 'i05', name: 'Whiteboard', cat: 'Other', space: hall, qty: 1 },
    { key: 'i06', name: 'Fan', cat: 'Appliances', space: hall, qty: 2, condition: 'repair' },
    { key: 'i07', name: 'Student desks', cat: 'Furniture', space: classroom, qty: 20, value: 15 },
    { key: 'i08', name: 'Whiteboard (classroom)', cat: 'Other', space: classroom },
    { key: 'i09', name: 'Laptop', cat: 'IT', space: classroom, serial: 'SAMPLE-LAP-001', brand: 'SampleBrand', model: 'L14', holder: 'Sample Teacher 1', value: 600 },
    { key: 'i10', name: 'Laptop (spare)', cat: 'IT', space: store, serial: 'SAMPLE-LAP-002', brand: 'SampleBrand', model: 'L14', value: 550 },
    { key: 'i11', name: 'Printer', cat: 'IT', space: classroom, serial: 'SAMPLE-PRN-001', condition: 'repair', value: 200 },
    { key: 'i12', name: 'Wall clock', cat: 'Other', space: classroom, gift: true },
    { key: 'i13', name: 'Gas stove', cat: 'Appliances', space: kitchen, value: 250 },
    { key: 'i14', name: 'Fridge', cat: 'Appliances', space: kitchen, value: 400 },
    { key: 'i15', name: 'Pots', cat: 'Kitchen', space: kitchen, qty: 6 },
    { key: 'i16', name: 'Plates', cat: 'Kitchen', space: kitchen, qty: 60 },
    { key: 'i17', name: 'Cups', cat: 'Kitchen', space: kitchen, qty: 60 },
    { key: 'i18', name: 'Kettle', cat: 'Kitchen', space: kitchen, condition: 'repair' },
    { key: 'i19', name: 'Folding chairs', cat: 'Furniture', space: store, qty: 60, value: 6 },
    { key: 'i20', name: 'Spare tables', cat: 'Furniture', space: store, qty: 4 },
    { key: 'i21', name: 'Extension cables', cat: 'Tools', space: store, qty: 10 },
    { key: 'i22', name: 'Paint buckets', cat: 'Tools', space: store, qty: 5 },
    { key: 'i23', name: 'Board games', cat: 'Books', space: store, qty: 12, gift: true },
    { key: 'i24', name: 'Old sofa', cat: 'Furniture', space: store, condition: 'broken' },
    { key: 'i25', name: 'Christmas decorations', cat: 'Other', space: store, qty: 1, gift: true },
    ...beds.flatMap((s, i) => [
      { key: `i${26 + i * 2}`, name: `Beds (bedroom ${i + 1})`, cat: 'Furniture', space: s, qty: 3, value: 40 } as Item,
      { key: `i${27 + i * 2}`, name: `Wardrobe (bedroom ${i + 1})`, cat: 'Furniture', space: s } as Item,
    ]),
  ];
  const newItems: Record<string, number> = {};
  for (const it of items) {
    if ((await db.query('SELECT 1 FROM inv_item WHERE note LIKE ?', [`SAMPLE ${it.key} %`]))[0]) { skip('items'); continue; }
    if (it.space == null) { fail(`item ${it.name}`, 'its space does not exist'); continue; }
    try {
      const r = await op<{ id: number }>('inv.item.add', { name: it.name, category_id: cat(it.cat), place_id: place(it.space), qty: it.qty ?? 1, serial: it.serial, brand: it.brand, model: it.model, condition: it.condition ?? 'good', holder: it.holder, value_usd: it.value, origin_id: it.gift ? gift : old, note: `SAMPLE ${it.key} · sample item` });
      newItems[it.key] = r.id; add('items');
    } catch (e) { fail(`item ${it.name}`, e); }
  }
  // a group that splits: 10 of the 40 chairs go to the store (A stays, B moves: the labels with a letter)
  if (newItems.i01 && store != null) { try { await op('inv.item.move', { id: newItems.i01, space_id: store, qty: 10, note: 'SAMPLE: 10 chairs for the store' }); add('group splits'); } catch (e) { fail('splitting the chairs', e); } }

  // the equipment the calendar may ask for: names the inventory holds
  d = await cal();
  for (const name of ['Projector', 'Sound speaker']) {
    if (d.equip.some((e) => e.name.toLowerCase() === name.toLowerCase())) { skip('equipment'); continue; }
    if (!(await db.query("SELECT 1 FROM inv_item WHERE status = 'in_use' AND lower(trim(name)) = lower(?)", [name]))[0]) continue;
    try { await op('cal.equip.save', { name }); add('equipment'); } catch (e) { fail(`equipment ${name}`, e); }
  }
  d = await cal();
  // the booking b01 asks for the projector (done after the booking was made, now that the list exists)
  const eq = d.equip.find((e) => e.name.toLowerCase() === 'projector')?.id;
  if (b01 && eq) {
    try {
      const b = d.bookings.find((x) => x.id === b01)!;
      const line = d.lines.find((l) => l.booking_id === b01);
      await op('cal.booking.save', { id: b01, origin: 'outside', org_id: b.org_id, person_id: b.person_id, people: b.people, from_day: b.from_day, to_day: b.to_day, time_from: b.time_from, time_to: b.time_to, spaces: d.allocs.filter((a) => a.booking_id === b01).map((a) => a.room_id), status: 'confirmed', note: b.note, free: false, price_mode: 'group', rate: 60, currency: 'USD', lines: line ? [{ id: line.id, service_id: coffee, qty: line.qty, amount: line.amount, currency: 'USD' }] : [], needs: [{ equip_id: eq, qty: 1 }], force: true });
      add('equipment asked');
    } catch (e) { fail('the projector for b01', e); }
  }

  // one problem reported; a count of one space (the classroom)
  if (await problemsAvailable(db)) {
    if ((await db.query("SELECT 1 FROM inv_problem WHERE what LIKE 'SAMPLE%'"))[0]) skip('problems');
    else { try { await op('inv.problem.report', { what: 'SAMPLE: the fan in the hall does not turn', where: 'Hall', space_id: hall }); add('problems'); } catch (e) { fail('the problem report', e); } }
  } else report.problems.push('problems: not available in this database (no inventory section)');
  const counted = (await db.query("SELECT 1 FROM inv_move m JOIN inv_item i ON i.id = m.item_id WHERE m.kind = 'counted' AND i.note LIKE 'SAMPLE%'"))[0];
  if (counted) skip('counts');
  else {
    const ids = ['i07', 'i08', 'i09', 'i11', 'i12'].map((k) => newItems[k]).filter(Boolean);
    const placeId = classroom != null ? place(classroom) : null;
    if (ids.length && placeId != null) { try { await op('inv.count', { ids, placeId }); add('counts'); } catch (e) { fail('the count', e); } }
  }
  sq.close();
  return report;
}

// ------------------------------------------------------------------ run from the command line
const entry = process.argv[1] ?? '';
if (/test-data\.(mjs|ts|js)$/.test(entry)) {
  const [folder, name] = process.argv.slice(2);
  if (!folder || !name) { console.error('usage: node test-data.mjs <data-folder> <db-name>   (e.g. ../test-servers/next-test magis-homs)'); process.exit(2); }
  try {
    const file = dbFileOf(folder, name);
    const r = await addTestData(file);
    console.log(`Database: ${file}\nBackup:   ${r.backup}\nAdded:    ${JSON.stringify(r.added)}\nSkipped (already there): ${JSON.stringify(r.skipped)}`);
    if (r.problems.length) console.log(`\nNot done (${r.problems.length}):\n - ${r.problems.join('\n - ')}`);
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
