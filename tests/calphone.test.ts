// The calendar phone (baseline 2.1, sections 3 and 4; step 5): linked once by a manager with a link code that works once;
// read only; 1 month back and 6 months ahead; never prices or payments; the contacts only on Reception, Coordinator and
// Director phones; "Reserved" for what is private on every phone; a cut phone is refused at once.
// Nothing here is real: invented names; the days are counted from today.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { migrate, splitSql } from '../src/db/db';
import { MIGRATIONS } from '../src/db/migrations';
import { nowIso, type Db } from '../src/db/db';
import { addDays } from '../src/hosting/host';
import { RESERVED, type CalData } from '../src/hosting/calendar';
import { loadCalRaw } from '../src/hosting/calops';
import { normCode, phoneCut, windowOf, type CalPhonePack, type CalPhoneInfo } from '../src/hosting/calphone';
import { calPhoneOf, calPhonePack, claimLink } from '../server/calphone';
import { nodeDb } from './nodeDb';

const today = () => nowIso().slice(0, 10);
// a day n days from today; a Sunday moves to the Monday, because an outside hall booking on a Sunday asks for a second "save"
// (the test must give the same result on any weekday it runs)
const day = (n: number) => { const d = addDays(today(), n); return new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? addDays(d, 1) : d; };

describe('update 76 on a database at 75', () => {
  it('adds the table of calendar phones and nothing else changes', async () => {
    const db = nodeDb();
    await db.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
    for (const mg of MIGRATIONS.filter((x) => x.n <= 75)) await db.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
    const rooms = JSON.stringify(await db.query('SELECT * FROM host_room'));
    expect(await migrate(db)).toEqual([76]);
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM cal_phone'))[0].n).toBe(0);
    expect(JSON.stringify(await db.query('SELECT * FROM host_room'))).toBe(rooms);
    expect(await migrate(db)).toEqual([]);
  });
});

describe('the window and the code', () => {
  it('1 month back and 6 months ahead, month ends respected', () => {
    expect(windowOf('2026-11-23')).toEqual({ from: '2026-10-23', to: '2027-05-23' });
    expect(windowOf('2026-03-31')).toEqual({ from: '2026-02-28', to: '2026-09-30' });
    expect(windowOf('2026-08-31')).toEqual({ from: '2026-07-31', to: '2027-02-28' });
  });
  it('a typed code is tidied: capitals, no dash or space', () => {
    expect(normCode(' ab3d-k7mn ')).toBe('AB3DK7MN');
  });
});

describe('the calendar phones', () => {
  let db: Db;
  let director: OpCtx, reception: OpCtx, coordinator: OpCtx;
  let hall = 0, org = 0, person = 0;
  const files = {} as OpCtx['files'];
  const ctxOf = async (name: string): Promise<OpCtx> => {
    const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
    return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
  };
  const role = async (name: string, perms: string[]) => {
    await runOp(director, 'access.save', { name, perms });
    const access = (await db.query<{ id: number }>('SELECT id FROM access_profile WHERE name = ?', [name]))[0].id;
    await runOp(director, 'user.save', { name, access_id: access, books: [], pin: 'test123-pass' });
    return ctxOf(name);
  };
  const book = async (c: OpCtx, a: Record<string, unknown>) => (await runOp(c, 'cal.booking.save', { origin: 'outside', org_id: org, person_id: person, people: 10, time_from: '09:00', time_to: '11:00', spaces: [hall], status: 'confirmed', free: false, price_mode: 'group', price_each: true, rate: 25, currency: 'USD', ...a })) as { saved: boolean; id: number };
  const add = (name: string, r: string) => runOp(director, 'cal.phone.add', { name, role: r }) as Promise<{ id: string; code: string; until: string }>;
  const link = async (name: string, r: string) => { const m = await add(name, r); const got = await claimLink(db, m.code); expect(got).not.toBeNull(); return got!; };
  const packOf = async (g: { id: string; key: string }) => calPhonePack(db, await calPhoneOf(db, g.id, g.key), today());
  const days = (p: CalPhonePack) => p.data.bookings.map((b) => b.from_day).sort();
  const on = (p: CalPhonePack, n: number) => p.data.bookings.find((b) => b.from_day === day(n))!;

  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Director', supPin: 'fouadsj-1', comName: 'Com', comPin: 'com-pass-1' });
    director = await ctxOf('Director');
    coordinator = await role('Coordinator', ['cal.view', 'cal.contacts', 'cal.programme', 'cal.outside', 'cal.orgs', 'cal.prices', 'cal.money']);
    reception = await role('Reception', ['cal.view', 'cal.contacts', 'cal.outside', 'cal.orgs', 'cal.arrive']);
    const d = (await runOp(director, 'cal.get', undefined)) as CalData;
    const area = (await runOp(director, 'cal.area.save', { name: 'Main' })) as { id: number };
    hall = ((await runOp(director, 'cal.space.save', { building_id: area.id, name: 'Hall A', kind_id: d.kinds.find((k) => k.name.startsWith('Hall'))!.id, capacity: 40 })) as { id: number }).id;
    org = ((await runOp(reception, 'cal.org.save', { name: 'Test choir', kind_id: 3, persons: [{ name: 'Person A', phone: '0911' }] })) as { id: number }).id;
    person = ((await runOp(reception, 'cal.get', undefined)) as CalData).persons[0].id;
    // inside the window, in the middle, far ahead (outside), long past (outside), private, cancelled
    await book(coordinator, { group_name: 'Inside choir', from_day: day(3), to_day: day(3), contact: 'Person A', phone: '0911' });
    await book(coordinator, { group_name: 'Edge ahead', from_day: day(170), to_day: day(170) });
    await book(coordinator, { group_name: 'Far ahead', from_day: day(220), to_day: day(220) });
    await book(coordinator, { group_name: 'Long ago', from_day: day(-90), to_day: day(-90) });
    await book(coordinator, { group_name: 'Secret meeting', from_day: day(5), to_day: day(5), private: true, contact: 'Person A', phone: '0911', note: 'do not tell' });
    const x = await book(coordinator, { group_name: 'Called off', from_day: day(7), to_day: day(7) });
    await runOp(coordinator, 'cal.booking.cancel', { id: x.id, reason: 'test', money: 'none' });
    const p = (await book(coordinator, { group_name: 'Paid group', from_day: day(9), to_day: day(9) })).id;
    await runOp(coordinator, 'cal.pay.add', { booking_id: p, amount: 50, currency: 'USD' });
  }, 60000);

  it('only a manager links a phone: the Director (set-up); Reception and the Coordinator may not', async () => {
    await expect(runOp(reception, 'cal.phone.add', { name: 'x', role: 'team' })).rejects.toThrow();
    await expect(runOp(coordinator, 'cal.phone.list', undefined)).rejects.toThrow();
    await expect(runOp(director, 'cal.phone.add', { name: '  ', role: 'team' })).rejects.toThrow();
    await expect(runOp(director, 'cal.phone.add', { name: 'x', role: 'boss' })).rejects.toThrow();
    const m = await add('Guard phone', 'team');
    expect(m.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const list = (await runOp(director, 'cal.phone.list', undefined)) as CalPhoneInfo[];
    expect(list.find((x) => x.id === m.id)).toMatchObject({ name: 'Guard phone', role: 'team', waiting: true, linked_at: null });
    // the code itself is not kept
    expect(JSON.stringify(await db.query('SELECT * FROM cal_phone'))).not.toContain(m.code.replace('-', ''));
  });

  it('the link code works once, and a wrong or expired one gives nothing', async () => {
    const m = await add('Once phone', 'reception');
    expect(await claimLink(db, 'AAAA-AAAA')).toBeNull();
    const got = await claimLink(db, m.code.toLowerCase().replace('-', ' '));
    expect(got).toMatchObject({ id: m.id, role: 'reception', name: 'Once phone' });
    expect(await claimLink(db, m.code)).toBeNull();
    const old = await add('Late phone', 'team');
    await db.batch([{ sql: 'UPDATE cal_phone SET link_until = ? WHERE id = ?', params: [new Date(Date.now() - 1000).toISOString(), old.id] }]);
    expect(await claimLink(db, old.code)).toBeNull();
    const list = (await runOp(director, 'cal.phone.list', undefined)) as CalPhoneInfo[];
    expect(list.find((x) => x.id === old.id)?.waiting).toBe(false);
  });

  it('the key: only the right one opens; the pack has the window, no prices, no payments, no cancelled booking', async () => {
    const g = await link('Window phone', 'director');
    await expect(calPhoneOf(db, g.id, 'wrong')).rejects.toBeTruthy();
    await expect(calPhoneOf(db, 'nope', g.key)).rejects.toBeTruthy();
    const pack = await packOf(g);
    expect(pack).toMatchObject({ phone: { id: g.id, name: 'Window phone', role: 'director' }, organisation: 'Test centre', from: windowOf(today()).from, to: windowOf(today()).to });
    expect(days(pack)).toEqual([day(3), day(5), day(9), day(170)]);
    const d = pack.data;
    expect(d.pays).toEqual([]);
    expect(d.lines).toEqual([]);
    expect(d.entered).toEqual([]);
    expect(d.rights).toMatchObject({ prices: false, money: false, setup: false, programme: false });
    for (const b of d.bookings) expect(b).toMatchObject({ price_mode: null, rate: null, price_each: 0, price_state: null, kept_usd: null, cancel_money: null });
    // the last update is noted
    expect((await db.query<{ last_sync: string | null }>('SELECT last_sync FROM cal_phone WHERE id = ?', [g.id]))[0].last_sync).toBe(pack.asOf);
  });

  it('what is private shows only "Reserved" on every phone; the contacts only on Reception, Coordinator and Director phones', async () => {
    const team = await packOf(await link('Team phone', 'team'));
    const rec = await packOf(await link('Reception phone', 'reception'));
    const coo = await packOf(await link('Coordinator phone', 'coordinator'));
    for (const p of [team, rec, coo]) {
      const secret = on(p, 5);
      expect(secret.group_name).toBe(RESERVED);
      expect(secret).toMatchObject({ subject: null, leader: null, note: null, org_id: null, contact: null, phone: null });
      expect(JSON.stringify(p.data)).not.toContain('do not tell');
    }
    const inside = (p: CalPhonePack) => on(p, 3);
    expect(inside(team)).toMatchObject({ contact: null, phone: null, person_id: null });
    expect(team.data.orgs).toEqual([]);
    expect(team.data.persons).toEqual([]);
    expect(inside(rec)).toMatchObject({ contact: 'Person A', phone: '0911' });
    expect(rec.data.orgs.map((o) => o.name)).toEqual(['Test choir']);
    expect(inside(coo)).toMatchObject({ contact: 'Person A', phone: '0911' });
    expect(JSON.stringify(team.data)).not.toContain('0911');
  });

  it('a phone can be renamed and given another role; the Team phone then has no contacts', async () => {
    const g = await link('Role phone', 'reception');
    expect(on(await packOf(g), 3).phone).toBe('0911');
    await runOp(director, 'cal.phone.edit', { id: g.id, name: 'Kitchen phone', role: 'team' });
    const p = await packOf(g);
    expect(p.phone).toMatchObject({ name: 'Kitchen phone', role: 'team' });
    expect(on(p, 3).phone).toBeNull();
  });

  it('cutting a phone stops it at once, for good; a code not yet used dies too', async () => {
    const g = await link('Lost phone', 'team');
    await packOf(g);
    await expect(runOp(coordinator, 'cal.phone.cut', { id: g.id })).rejects.toThrow();
    await runOp(director, 'cal.phone.cut', { id: g.id });
    await expect(calPhoneOf(db, g.id, g.key)).rejects.toMatchObject({ msg: { en: expect.stringContaining('cut off') } });
    await expect(runOp(director, 'cal.phone.edit', { id: g.id, name: 'again' })).rejects.toThrow();
    const m = await add('Never linked', 'team');
    await runOp(director, 'cal.phone.cut', { id: m.id });
    expect(await claimLink(db, m.code)).toBeNull();
    const list = (await runOp(director, 'cal.phone.list', undefined)) as CalPhoneInfo[];
    expect(list.find((x) => x.id === g.id)).toMatchObject({ revoked_by: 'Director' });
    expect((await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('cal-phone-add','cal-phone-cut','cal-phone-linked')"))[0].n).toBeGreaterThan(3);
  });

  it('the calendar a laptop reads is the same as before (the loader was shared)', async () => {
    const all = await loadCalRaw(db, { view: true, contacts: true, programme: false, outside: false, orgs: false, arrive: false, prices: true, money: true, whole: false, setup: false, history: false });
    expect(all.pays.length).toBeGreaterThan(0);
    const cut = phoneCut(all, 'director', today());
    expect(cut.pays).toEqual([]);
    expect(all.pays.length).toBeGreaterThan(0);
  });
});
