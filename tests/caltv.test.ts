// The TV at the entrance (calendar step 7, plain version): today's halls hour by hour, read only; only group names (a private
// booking shows only "Reserved · محجوز"); never prices, payments, contacts, notes or leaders. Invented names; days from today.
import vm from 'node:vm';
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { nowIso, type Db } from '../src/db/db';
import { addDays } from '../src/hosting/host';
import { RESERVED, type CalData } from '../src/hosting/calendar';
import { calPhoneOf, claimLink, tvPack } from '../server/calphone';
import { TV_FROM, TV_TO, tvScreen, type TvScreen } from '../src/hosting/caltv';
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

  it('the map screen carries the centre’s mark and colour and the welcome phrases, and nothing else of the program', async () => {
    const d = (await runOp(director, 'cal.get', undefined)) as CalData;
    const homs = tvScreen(d, today(), 'Homs house', '', { centre: 'homs' });
    expect([homs.logo, homs.color]).toEqual(['/brand/mark-homs.png', '#5B191D']);
    const own = tvScreen(d, today(), 'Own', '', { centre: 'other', color: '#336699', logo: 'data:image/png;base64,AAAA' });
    expect([own.logo, own.color]).toEqual(['data:image/png;base64,AAAA', '#336699']);
    expect(tvScreen(d, today(), 'Nobody', '', { centre: 'other' }).logo).toBeNull(); // the page then shows the MAGIS sun
    expect(homs.phrases.length).toBeGreaterThan(10);
    expect(Object.keys(homs.phrases[0]).sort()).toEqual(['ar', 'en', 'fr']);
    // the whole screen of the map holds only these keys: no price, contact, note, leader, status or id of a person
    expect(Object.keys(homs).sort()).toEqual(['areas', 'asOf', 'color', 'day', 'from', 'lang', 'logo', 'organisation', 'outside', 'period', 'phraseMinutes', 'phrases', 'staying', 'to']);
    const s = await screen('director');
    expect(Object.keys(s.areas[0].spaces[0].items[0]).sort()).toEqual(['from', 'hold', 'people', 'title', 'to']);
  });

  // ---- the page script, run against a tiny made-up page (no browser here): what the map shows and what it never shows
  type FEl = { tag: string; className: string; style: Record<string, string>; kids: FEl[]; text: string; attrs: Record<string, string>; parentNode: FEl | null; src?: string };
  const fakeEl = (tag: string): FEl & Record<string, unknown> => {
    const e: FEl & Record<string, unknown> = { tag, className: '', style: {}, kids: [], text: '', attrs: {}, parentNode: null,
      appendChild(c: FEl) { c.parentNode = e; e.kids.push(c); return c; },
      setAttribute(k: string, v: string) { e.attrs[k] = v; } };
    Object.defineProperty(e, 'textContent', { get: () => e.text, set: (v: unknown) => { e.text = String(v ?? ''); e.kids = []; } });
    Object.defineProperty(e, 'innerHTML', { get: () => '', set: () => { e.kids = []; e.text = ''; } });
    return e;
  };
  const all = (e: FEl): FEl[] => [e, ...e.kids.flatMap(all)];
  const textOf = (e: FEl): string => e.text + ' ' + (e.src ?? '') + ' ' + e.kids.map(textOf).join(' ');
  /** run the TV script as a TV would: linked, with this query; returns the page */
  const runPage = async (query: string, opts: { breakImg?: boolean } = {}) => {
    const scr = await screen();
    const app = fakeEl('div'); const body = { className: '' };
    const store: Record<string, string> = { 'magis-tv-key': 'x' };
    class XHR {
      status = 200; responseText = JSON.stringify(scr); timeout = 0; onload: (() => void) | null = null; onerror: unknown; ontimeout: unknown;
      open() {} setRequestHeader() {} send() { this.onload?.(); }
    }
    const sandbox = {
      document: { getElementById: () => app, createElement: (t: string) => { if (opts.breakImg && t === 'img') throw new Error('no pictures here'); return fakeEl(t); }, createTextNode: (t: string) => { const e = fakeEl('#text'); e.text = t; return e; }, body },
      localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } },
      XMLHttpRequest: XHR, location: { search: query }, setInterval: () => 0, setTimeout: () => 0, Date, Math, JSON, parseInt, RegExp, String, Number,
    };
    vm.runInNewContext(TV_JS, sandbox);
    return { app, body, text: textOf(app as unknown as FEl), tiles: all(app as unknown as FEl).filter((e) => e.className.indexOf('m-tile ') === 0) };
  };

  it('the map: busy now, next, closed and free tiles; a private booking is only Reserved; nothing private, no price, no contact', async () => {
    const day = await runPage('?at=09:30');
    expect(day.body.className).toBe('map');
    const byName = (name: string) => day.tiles.find((t) => textOf(t).includes(name))!;
    expect(byName('Hall A').className).toBe('m-tile busy');
    expect(textOf(byName('Hall A'))).toContain('Test choir');
    expect(textOf(byName('Hall A'))).toContain('09:00 – 11:00');
    expect(byName('Hall B').className).toBe('m-tile shut'); // closed for painting in the test before
    expect(day.text).toContain('Test centre'); // the name of the centre
    expect(day.text).toContain('Good morning'); // the greeting of the hour
    const afternoon = await runPage('?at=14:30');
    expect(textOf(afternoon.tiles.find((t) => textOf(t).includes('Hall A'))!)).toContain(RESERVED);
    for (const r of [day, afternoon]) for (const bad of ['Private meeting', 'secret note', 'do not tell', 'Person A', '0911', 'USD', 'price', 'rate', 'leader', 'painting']) expect(r.text).not.toContain(bad);
    const free = await runPage('?at=20:30');
    expect(free.tiles.find((t) => textOf(t).includes('Hall A'))!.className).toBe('m-tile free');
    const fr = await runPage('?at=09:30&l=fr');
    expect(fr.text).toContain('Fermé');
  });

  it('outside 08:00–22:00 the screen is the calm night screen, not the map', async () => {
    const night = await runPage('?at=23:10');
    expect(night.body.className).toBe('map');
    expect(night.tiles).toHaveLength(0);
    expect(night.text).toContain('08:00');
    expect(night.text).toContain('Test centre');
    expect(night.text).not.toContain('Hall A');
  });

  it('the plain page stays: ?plain shows it, and the map that cannot be drawn falls back to it by itself', async () => {
    const plain = await runPage('?plain');
    expect(plain.body.className).toBe('plain');
    expect(plain.tiles).toHaveLength(0);
    expect(plain.text).toContain('Hall A');
    const broken = await runPage('?at=09:30', { breakImg: true });
    expect(broken.body.className).toBe('plain');
    expect(broken.text).toContain('Hall A');
    expect(broken.text).toContain('Test choir');
  });
});
