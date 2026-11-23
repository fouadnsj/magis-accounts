// The TV at the entrance (calendar step 7, plain version): today's halls hour by hour, read only; only group names (a private
// booking shows only "Reserved · محجوز"); never prices, payments, contacts, notes or leaders. Invented names; days from today.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { nowIso, type Db } from '../src/db/db';
import { addDays } from '../src/hosting/host';
import { RESERVED, type CalData } from '../src/hosting/calendar';
import { calPhoneOf, claimLink, tvPack } from '../server/calphone';
import { TV_FROM, TV_TO, type TvScreen } from '../src/hosting/caltv';
import { TV_HTML, TV_JS } from '../server/tv-page';
import { nodeDb } from './nodeDb';

const today = () => nowIso().slice(0, 10);

describe('the TV screen', () => {
  let db: Db, director: OpCtx;
  let hall = 0, hall2 = 0, room = 0, org = 0, person = 0;
  const files = {} as OpCtx['files'];
  const screen = async (role = 'team'): Promise<TvScreen> => {
    const m = (await runOp(director, 'cal.phone.add', { name: `TV ${role} ${Math.random()}`, role })) as { code: string };
    const got = await claimLink(db, m.code);
    return tvPack(db, await calPhoneOf(db, got!.id, got!.key), today());
  };
  const book = async (a: Record<string, unknown>) => (await runOp(director, 'cal.booking.save', { origin: 'outside', org_id: org, person_id: person, people: 10, time_from: '09:00', time_to: '11:00', spaces: [hall], status: 'confirmed', free: false, price_mode: 'group', price_each: true, rate: 25, currency: 'USD', from_day: today(), to_day: today(), ...a })) as { saved: boolean; id: number };

  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Director', supPin: 'fouadsj-1', comName: 'Com', comPin: 'com-pass-1' });
    const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', ['Director']))[0];
    director = { db, profile: (await loadProfile(db, p.id))!, who: 'Director', install: 'office', files };
    const d = (await runOp(director, 'cal.get', undefined)) as CalData;
    const area = (await runOp(director, 'cal.area.save', { name: 'Main' })) as { id: number };
    const hk = d.kinds.find((k) => k.name.startsWith('Hall'))!.id;
    hall = ((await runOp(director, 'cal.space.save', { building_id: area.id, name: 'Hall A', kind_id: hk, capacity: 40 })) as { id: number }).id;
    hall2 = ((await runOp(director, 'cal.space.save', { building_id: area.id, name: 'Hall B', kind_id: hk, capacity: 20 })) as { id: number }).id;
    room = ((await runOp(director, 'cal.space.save', { building_id: area.id, name: 'Room 1', kind_id: d.kinds.find((k) => k.sleeps > 0)!.id, beds: 2 })) as { id: number }).id;
    org = ((await runOp(director, 'cal.org.save', { name: 'Test choir', kind_id: 3, persons: [{ name: 'Person A', phone: '0911' }] })) as { id: number }).id;
    person = ((await runOp(director, 'cal.get', undefined)) as CalData).persons[0].id;
    await book({ group_name: 'Morning choir', contact: 'Person A', phone: '0911', note: 'secret note' });
    await book({ group_name: 'Private meeting', time_from: '14:00', time_to: '16:00', private: true, note: 'do not tell', contact: 'Person A', phone: '0911' });
    await book({ group_name: 'Tomorrow only', from_day: addDays(today(), 1), to_day: addDays(today(), 1) });
    const c = await book({ group_name: 'Called off', time_from: '18:00', time_to: '19:00' });
    await runOp(director, 'cal.booking.cancel', { id: c.id, reason: 'test', money: 'none' });
    await book({ group_name: 'Waiting group', time_from: '12:00', time_to: '13:00', spaces: [hall2], status: 'option' });
    await book({ kind: 'stay', group_name: 'Guests from far', spaces: [room], time_from: undefined, time_to: undefined, from_day: today(), to_day: addDays(today(), 2), people: 2 });
  }, 60000);

  it("today's halls hour by hour: names, hours; no bedroom row; no other day; nothing cancelled", async () => {
    const s = await screen();
    expect([s.from, s.to]).toEqual([TV_FROM, TV_TO]);
    expect(s.day).toBe(today());
    const names = s.areas.flatMap((a) => a.spaces.map((x) => x.name));
    expect(names).toEqual(['Hall A', 'Hall B']);
    const a = s.areas[0].spaces.find((x) => x.name === 'Hall A')!;
    // an outside booking is shown under its organisation's name; tomorrow's and the cancelled one are not there
    expect(a.items).toHaveLength(2);
    expect(a.items[0]).toMatchObject({ title: 'Test choir', from: 540, to: 660, hold: false });
    expect(s.areas[0].spaces.find((x) => x.name === 'Hall B')!.items).toMatchObject([{ title: 'Test choir', from: 720, to: 780, hold: true }]);
    expect(s.staying).toEqual(['Test choir']);
  });

  it('a private booking shows only Reserved; no price, payment, contact, phone, note or leader reaches the TV, whatever the role of the phone', async () => {
    for (const role of ['team', 'director']) {
      const s = await screen(role);
      const all = JSON.stringify(s);
      expect(s.areas[0].spaces[0].items.map((i) => i.title)).toContain(RESERVED);
      for (const bad of ['Private meeting', 'secret note', 'do not tell', 'Person A', '0911', 'price', 'USD', 'rate', 'pay', 'leader']) expect(all).not.toContain(bad);
    }
  });

  it('a space closed today is marked closed; the page and its script exist and call only the TV routes', async () => {
    await runOp(director, 'cal.space.close', { room_id: hall2, from_day: today(), to_day: today(), reason: 'painting', force: true });
    const s = await screen();
    expect(s.areas[0].spaces.find((x) => x.name === 'Hall B')!.shut).toBe(true);
    expect(JSON.stringify(s)).not.toContain('painting');
    expect(TV_HTML).toContain('/tv.js');
    expect(TV_HTML).not.toMatch(/<script>[^<]/);
    expect(TV_JS).toContain('/api/tv/screen');
    expect(TV_JS).not.toContain('/api/calphone');
  });
});
