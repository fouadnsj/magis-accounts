// Two decisions of Fouad (26 November 2026, third test, comments 4 and 5):
//  - every person with an account in a centre looks at the Calendar (view only: no prices, no contacts, nothing to change),
//    by a rule in the code: no database update and nobody's other rights change;
//  - the value of each inventory item stays with those who keep the inventory; the big totals and the donor report are the
//    Administrator's alone (tick `inventory.totals`), refused by the server in every other role and exception.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type AccessRow, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { doorsOf } from '../src/doors';
import { ROLE_KINDS, ADMIN_ONLY, EVERYONE, withEveryone } from '../src/roles';
import { calRights, type CalData } from '../src/hosting/calendar';
import type { InvData } from '../src/inventory/inv';
import { nodeDb } from './nodeDb';
import type { Db } from '../src/db/db';

const files = {} as OpCtx['files'];
let db: Db;
let sup: OpCtx;
let roles: AccessRow[] = [];
const role = (kind: string) => roles.find((r) => r.kind === kind)!;
const ctxOf = async (name: string): Promise<OpCtx> => ({ db, profile: (await loadProfile(db, (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0].id))!, who: name, install: 'office', files });
const person = async (name: string, ids: number[]) => { await runOp(sup, 'user.save', { name, roles: ids, books: [], pin: `${name}-pass-1` }); return ctxOf(name); };
const doors = (c: OpCtx, inventoryOn = true) => doorsOf({ can: (p) => c.profile.perms.includes(p), hasBook: false, inventoryOn, hr: false });
const inv = async (c: OpCtx) => (await runOp(c, 'inv.get', undefined)) as InvData;
const cal = async (c: OpCtx) => (await runOp(c, 'cal.get', undefined)) as CalData;

let hall = 0, space = 0;

beforeAll(async () => {
  db = nodeDb();
  await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
  sup = await ctxOf('Sup');
  roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
  // one outside booking with a price, a contact and a private one, made by the Administrator
  const d = await cal(sup);
  const area = (await runOp(sup, 'cal.area.save', { name: 'Main' })) as { id: number };
  hall = ((await runOp(sup, 'cal.space.save', { building_id: area.id, name: 'Hall A', kind_id: d.kinds.find((k) => k.name.startsWith('Hall'))!.id, capacity: 40 })) as { id: number }).id;
  let day = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  while (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) day = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const org = ((await runOp(sup, 'cal.org.save', { name: 'Test choir', kind_id: 3, persons: [{ name: 'Person A', phone: '0911000000' }, { name: 'Person B', phone: '0922000000' }] })) as { id: number }).id;
  const ps = (await cal(sup)).persons.filter((x) => x.org_id === org);
  const pa = ps.find((x) => x.name === 'Person A')!.id, pb = ps.find((x) => x.name === 'Person B')!.id;
  const b = { origin: 'outside', org_id: org, people: 10, from_day: day, to_day: day, time_from: '09:00', time_to: '11:00', spaces: [hall], status: 'confirmed', free: false, price_mode: 'group', price_each: true, rate: 25, currency: 'USD' };
  const r1 = await runOp(sup, 'cal.booking.save', { ...b, group_name: 'Choir', person_id: pa, contact: 'Person A', phone: '0911000000' });
  const r2 = await runOp(sup, 'cal.booking.save', { ...b, group_name: 'Secret meeting', person_id: pb, contact: 'Person B', phone: '0922000000', private: true, time_from: '13:00', time_to: '14:00' });
  expect([r1, r2]).toMatchObject([{ saved: true }, { saved: true }]);
  // an inventory with a value on each item
  space = (await inv(sup)).spaces.find((s) => s.name === 'Hall A')!.place_id!;
  await runOp(sup, 'inv.item.add', { name: 'Chair', qty: 10, value_usd: 12 }); // no place yet: in the total, in no space
  await runOp(sup, 'inv.item.add', { name: 'Table', qty: 4, place_id: space, value_usd: 50 });
  await runOp(sup, 'inv.item.add', { name: 'Projector', qty: 1, place_id: space, value_usd: 300, serial: 'P-1' });
});

describe('the calendar for every person with an account (view only)', () => {
  it('every ready-made role and a Custom role have the Calendar door, with nothing else changed', async () => {
    for (const k of ROLE_KINDS) {
      const c = await person(`P-${k.kind}`, [role(k.kind).id]);
      expect(c.profile.perms, k.kind).toContain('cal.view');
      expect(doors(c), k.kind).toContain('calendar');
    }
    await runOp(sup, 'access.save', { name: 'Secretary (custom)', perms: ['reports.summary'] });
    roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
    const custom = roles.find((r) => r.name === 'Secretary (custom)')!;
    const c = await person('Sam', [custom.id]);
    expect(c.profile.perms.sort()).toEqual(['cal.view', 'reports.summary']);
    expect(doors(c)).toContain('calendar');
  });

  it('the rule adds the one tick and nothing else; the stored roles are not changed', () => {
    expect(EVERYONE).toEqual(['cal.view']);
    expect(withEveryone(['inventory.view']).sort()).toEqual(['cal.view', 'inventory.view']);
    expect(withEveryone(['cal.view', 'cal.prices']).sort()).toEqual(['cal.prices', 'cal.view']);
    expect(role('holder').perms).not.toContain('cal.view');
    expect(role('keeper').perms).not.toContain('cal.view');
  });

  it('a Book holder and a Store keeper look at the calendar: no prices, no contacts, a private booking stays "Reserved"', async () => {
    for (const k of ['holder', 'keeper', 'accountant']) {
      const c = await ctxOf(`P-${k}`);
      const r = calRights(c.profile.perms);
      expect(r, k).toMatchObject({ view: true, contacts: false, prices: false, money: false, programme: false, outside: false, orgs: false, arrive: false, whole: false, setup: false, history: false });
      const d = await cal(c);
      expect(d.bookings.length, k).toBe(2);
      expect(d.bookings.every((b) => b.contact == null && b.phone == null && b.rate == null && b.price_mode == null), k).toBe(true);
      expect(d.orgs, k).toEqual([]);
      expect(d.persons, k).toEqual([]);
      expect(d.pays, k).toEqual([]);
      expect(d.bookings.map((b) => b.group_name).sort(), k).toEqual(['Reserved · محجوز', 'Test choir']);
      expect(JSON.stringify(d.bookings), k).not.toMatch(/0911000000|0922000000|Person A|Secret meeting/);
    }
    // the administrator still sees all of it
    const all = await cal(sup);
    expect(all.bookings.some((b) => b.phone === '0911000000' && b.rate === 25)).toBe(true);
  });

  it('the server refuses every change to a person who only looks', async () => {
    for (const k of ['holder', 'keeper']) {
      const c = await ctxOf(`P-${k}`);
      const b = { origin: 'ours', people: 5, from_day: '2027-05-03', to_day: '2027-05-03', time_from: '09:00', time_to: '10:00', spaces: [hall], status: 'confirmed', group_name: 'Nope' };
      for (const [op, args] of [
        ['cal.booking.save', b], ['cal.booking.save', { ...b, origin: 'outside' }], ['cal.booking.cancel', { id: 1 }], ['cal.booking.status', { id: 1, status: 'confirmed' }],
        ['cal.booking.money', { id: 1, free: true }], ['cal.pay.add', { booking_id: 1, amount: 5, currency: 'USD' }], ['cal.date.change', { id: 1 }],
        ['cal.space.close', { space_id: hall, from_day: '2027-05-03', to_day: '2027-05-04' }], ['cal.org.save', { name: 'X' }], ['cal.history', { booking_id: 1 }],
        ['cal.phone.list', undefined], ['cal.space.save', { name: 'New' }], ['cal.period.save', { from_day: '2027-08-01', to_day: '2027-08-31' }],
      ] as [string, unknown][]) await expect(runOp(c, op, args as never), `${k} ${op}`).rejects.toThrow(/Not allowed|غير مسموح|Non autorisé/);
    }
  });

  it('a person with no account has nothing; a community or the HR database does not get the calendar by this rule', async () => {
    // no account: a person switched off cannot be loaded at all
    const id = (await db.query<{ id: number }>("SELECT id FROM profile WHERE name = 'Sam'"))[0].id;
    await runOp(sup, 'user.deactivate', { id }).catch(() => undefined);
    const gone = await loadProfile(db, id);
    expect(gone === null || gone.perms.includes('cal.view')).toBe(true); // (switched off: null when the program switched him off)
    await db.batch([{ sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('kind', 'hr')" }]);
    const hr = await loadProfile(db, (await db.query<{ id: number }>("SELECT id FROM profile WHERE name = 'P-holder'"))[0].id);
    expect(hr!.perms).not.toContain('cal.view');
    await db.batch([{ sql: "DELETE FROM meta WHERE key = 'kind'" }]);
  });
});

describe('the inventory: the value of each item for the keepers, the big totals for the Administrator only', () => {
  it('the Store keeper and the Director see the value of each item, and the server sends them no total', async () => {
    for (const k of ['keeper', 'director']) {
      const c = await ctxOf(`P-${k}`);
      const d = await inv(c);
      expect(d.rights, k).toMatchObject({ values: true, totals: false });
      expect(d.items.find((i) => i.name === 'Chair')!.value_usd, k).toBe(12);
      expect(d.items.find((i) => i.name === 'Projector')!.value_usd, k).toBe(300);
      expect(d.totals, k).toBeNull();
    }
    // the accountant who keeps the inventory (ticks of the keeper) keeps the value of each item too, and still gets no total
    await runOp(sup, 'access.save', { name: 'Accountant who keeps', perms: ['book.own', 'register.view', 'inventory.manage'] });
    roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
    const c = await person('Assem', [roles.find((r) => r.name === 'Accountant who keeps')!.id]);
    const d = await inv(c);
    expect(d.rights).toMatchObject({ values: true, keep: true, totals: false });
    expect(d.items.find((i) => i.name === 'Chair')!.value_usd).toBe(12);
    expect(d.totals).toBeNull();
    // and he can write the value of an item
    const chair = d.items.find((i) => i.name === 'Chair')!;
    await runOp(c, 'inv.item.save', { id: chair.id, name: 'Chair', qty: 10, value_usd: 15 });
    expect((await inv(c)).items.find((i) => i.id === chair.id)!.value_usd).toBe(15);
    await runOp(c, 'inv.item.save', { id: chair.id, name: 'Chair', qty: 10, value_usd: 12 });
  });

  it('someone who looks without the values tick sees no value and no total', async () => {
    const c = await ctxOf('P-coordinator');
    const d = await inv(c);
    expect(d.rights).toMatchObject({ look: true, values: false, totals: false });
    expect(d.items.every((i) => i.value_usd == null)).toBe(true);
    expect(d.totals).toBeNull();
  });

  it('the Administrator receives the totals, worked out by the server', async () => {
    const d = await inv(sup);
    expect(d.rights).toMatchObject({ values: true, totals: true });
    expect(d.totals).toEqual({ all: 620, spaces: expect.objectContaining({ [(d.spaces.find((s) => s.name === 'Hall A')!).id]: 500 }) });
  });

  it('the tick is the Administrator\'s alone: refused in another role, in a copy, and in an exception', async () => {
    expect(ADMIN_ONLY).toContain('inventory.totals');
    expect(role('administrator').perms).toContain('inventory.totals');
    for (const k of ['director', 'keeper', 'accountant', 'holder', 'reception', 'coordinator']) expect(role(k).perms, k).not.toContain('inventory.totals');
    await expect(runOp(sup, 'access.save', { name: 'Keeper with totals', perms: ['inventory.view', 'inventory.values', 'inventory.totals'] })).rejects.toThrow(/only in the role Administrator/);
    await expect(runOp(sup, 'access.save', { id: role('keeper').id, name: role('keeper').name, perms: [...role('keeper').perms, 'inventory.totals'] })).rejects.toThrow(/only in the role Administrator/);
    const c = await ctxOf('P-keeper');
    const id = (await db.query<{ id: number }>("SELECT id FROM profile WHERE name = 'P-keeper'"))[0].id;
    await expect(runOp(sup, 'user.save', { id, name: 'P-keeper', roles: [role('keeper').id], extra: ['inventory.totals'], books: [] })).rejects.toThrow(/only in the role Administrator/);
    expect((await ctxOf('P-keeper')).profile.perms).not.toContain('inventory.totals');
    expect(c.profile.perms).not.toContain('inventory.totals');
    // a second Administrator has it
    const admin2 = await person('Second', [role('administrator').id]);
    expect(admin2.profile.perms).toContain('inventory.totals');
    expect((await inv(admin2)).totals?.all).toBe(620);
  });

  it('the donor report: only the Administrator makes it', async () => {
    const ok = (await runOp(sup, 'inv.report.project', { account_id: (await db.query<{ id: number }>('SELECT id FROM account LIMIT 1'))[0]?.id ?? 1, from: '2027-01', to: '2027-12' }).catch((e) => e)) as unknown;
    expect((ok as Error)?.message ?? '').not.toMatch(/Not allowed|غير مسموح|Non autorisé/);
    for (const k of ['director', 'keeper', 'coordinator']) {
      await expect(runOp(await ctxOf(`P-${k}`), 'inv.report.project', { account_id: 1, from: '2027-01', to: '2027-12' }), k).rejects.toThrow(/Not allowed|غير مسموح|Non autorisé/);
    }
    await expect(runOp(await ctxOf('Assem'), 'inv.report.project', { account_id: 1, from: '2027-01', to: '2027-12' })).rejects.toThrow(/Not allowed|غير مسموح|Non autorisé/);
  });
});
