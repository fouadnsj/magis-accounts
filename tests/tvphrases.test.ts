// The TV welcome phrases of a centre (update 78, 26 November 2026): the code's list is the default; a centre may switch a phrase off, edit it
// (and restore it), write its own and delete it, and set how long one stays (1-15 minutes, 5 by default). Only the Director and the
// Administrator (tick cal.setup) write. The TV receives the phrases and nothing else of this page. And the map draws EVERY active area that
// has a bookable space, even with nothing today. Invented names.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { migrate, nowIso, splitSql, type Db } from '../src/db/db';
import { MIGRATIONS } from '../src/db/migrations';
import type { CalData } from '../src/hosting/calendar';
import { TV_PHRASE_MINUTES, TV_SENTENCES, tvPhraseList, type TvPhrase } from '../src/hosting/tvSentences';
import { calPhoneOf, claimLink, tvPack } from '../server/calphone';
import { TV_JS } from '../server/tv-page';
import { nodeDb } from './nodeDb';

const today = () => nowIso().slice(0, 10);
const files = {} as OpCtx['files'];

describe('update 78 on a database at 77', () => {
  it('adds the table of phrases and nothing else; a second run does nothing', async () => {
    const db = nodeDb();
    await db.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
    for (const mg of MIGRATIONS.filter((x) => x.n <= 77)) await db.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
    const rooms = JSON.stringify(await db.query('SELECT * FROM host_room'));
    expect(await migrate(db)).toEqual([78]);
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM cal_tv_phrase'))[0].n).toBe(0);
    expect(JSON.stringify(await db.query('SELECT * FROM host_room'))).toBe(rooms);
    expect(await migrate(db)).toEqual([]);
  });
});

describe('the TV phrases of a centre', () => {
  let db: Db, director: OpCtx, reception: OpCtx;
  const ctxOf = async (name: string): Promise<OpCtx> => {
    const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
    return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
  };
  const get = async (c = director) => (await runOp(c, 'cal.tv.get', undefined)) as { minutes: number; phrases: TvPhrase[] };
  const screen = async () => {
    const m = (await runOp(director, 'cal.phone.add', { name: `TV ${Math.random()}`, role: 'team' })) as { code: string };
    const got = await claimLink(db, m.code);
    return tvPack(db, await calPhoneOf(db, got!.id, got!.key), today());
  };
  const KEY = TV_SENTENCES.find((s) => !s.centre)!.id;

  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Director', supPin: 'fouadsj-1', comName: 'Com', comPin: 'com-pass-1' });
    director = await ctxOf('Director');
    await runOp(director, 'access.save', { name: 'Reception', perms: ['cal.view', 'cal.contacts', 'cal.outside', 'cal.orgs', 'cal.arrive'] });
    const access = (await db.query<{ id: number }>('SELECT id FROM access_profile WHERE name = ?', ['Reception']))[0].id;
    await runOp(director, 'user.save', { name: 'Reception', access_id: access, books: [], pin: 'test123-pass' });
    reception = await ctxOf('Reception');
  }, 60000);

  it('nothing changed: the code’s list, all on, 5 minutes; the TV gets the same', async () => {
    const g = await get();
    expect(g.minutes).toBe(TV_PHRASE_MINUTES);
    expect(TV_PHRASE_MINUTES).toBe(5);
    expect(g.phrases.length).toBe(tvPhraseList('other').length);
    expect(g.phrases.every((p) => p.active && !p.edited && p.key)).toBe(true);
    const s = await screen();
    expect(s.phraseMinutes).toBe(5);
    expect(s.phrases.length).toBe(g.phrases.length);
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM cal_tv_phrase'))[0].n).toBe(0); // nothing is stored for the default
  });

  it('a built-in phrase is switched off and on; the TV follows; no testimony is ever in the list', async () => {
    const before = (await get()).phrases.find((p) => p.key === KEY)!;
    await runOp(director, 'cal.tv.save', { key: KEY, active: false });
    expect((await get()).phrases.find((p) => p.key === KEY)!.active).toBe(false);
    expect((await screen()).phrases.map((p) => p.en)).not.toContain(before.en);
    await runOp(director, 'cal.tv.save', { key: KEY, active: true });
    expect((await screen()).phrases.map((p) => p.en)).toContain(before.en);
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM cal_tv_phrase'))[0].n).toBe(0); // back to the default: no row left
    expect((await get()).phrases.some((p) => p.kind === 'testimony')).toBe(false);
  });

  it('a built-in phrase is edited, then restored (or typed back as it was)', async () => {
    const orig = (await get()).phrases.find((p) => p.key === KEY)!;
    await runOp(director, 'cal.tv.save', { key: KEY, ar: 'نص جديد', en: 'A new text', fr: 'Un nouveau texte' });
    let p = (await get()).phrases.find((x) => x.key === KEY)!;
    expect([p.ar, p.en, p.fr, p.edited]).toEqual(['نص جديد', 'A new text', 'Un nouveau texte', true]);
    expect(p.original).toMatchObject({ en: orig.en });
    expect((await screen()).phrases.map((x) => x.en)).toContain('A new text');
    await runOp(director, 'cal.tv.save', { key: KEY, restore: true });
    p = (await get()).phrases.find((x) => x.key === KEY)!;
    expect([p.en, p.edited]).toEqual([orig.en, false]);
    await runOp(director, 'cal.tv.save', { key: KEY, ar: 'x', en: 'y', fr: 'z' });
    await runOp(director, 'cal.tv.save', { key: KEY, ar: orig.ar, en: orig.en, fr: orig.fr });
    expect((await get()).phrases.find((x) => x.key === KEY)!.edited).toBe(false);
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM cal_tv_phrase'))[0].n).toBe(0);
  });

  it('the centre writes its own phrase, edits it, switches it off and deletes it; a built-in one cannot be deleted', async () => {
    const r = (await runOp(director, 'cal.tv.save', { ar: 'أهلاً بأهل الحيّ', en: '', fr: '' })) as { id: number };
    let mine = (await get()).phrases.find((p) => p.id === r.id)!;
    expect([mine.key, mine.kind, mine.source]).toEqual([null, 'centre', 'written by the centre']);
    // Arabic first, the other language under it: a phrase written only in Arabic is sent with empty English and French
    expect((await screen()).phrases.find((p) => p.ar === 'أهلاً بأهل الحيّ')).toEqual({ ar: 'أهلاً بأهل الحيّ', en: '', fr: '' });
    await runOp(director, 'cal.tv.save', { id: r.id, ar: 'أهلاً بأهل الحيّ', en: 'Welcome, neighbours' });
    mine = (await get()).phrases.find((p) => p.id === r.id)!;
    expect(mine.en).toBe('Welcome, neighbours');
    await runOp(director, 'cal.tv.save', { id: r.id, active: false });
    expect((await screen()).phrases.map((p) => p.en)).not.toContain('Welcome, neighbours');
    await runOp(director, 'cal.tv.delete', { id: r.id });
    expect((await get()).phrases.some((p) => p.id === r.id)).toBe(false);
    await runOp(director, 'cal.tv.save', { key: KEY, active: false });
    const row = (await get()).phrases.find((p) => p.key === KEY)!;
    await expect(runOp(director, 'cal.tv.delete', { id: row.id! })).rejects.toThrow(/built-in/);
    await runOp(director, 'cal.tv.save', { key: KEY, active: true });
  });

  it('no check but the length and that something is written; an unknown key is refused', async () => {
    await expect(runOp(director, 'cal.tv.save', { ar: '', en: '  ', fr: '' })).rejects.toThrow(/at least one language/);
    await expect(runOp(director, 'cal.tv.save', { key: KEY, ar: '', en: '', fr: '' })).rejects.toThrow(/at least one language/);
    await expect(runOp(director, 'cal.tv.save', { en: 'x'.repeat(300) })).rejects.toThrow(/too long/);
    await expect(runOp(director, 'cal.tv.save', { key: 'no-such-phrase', active: false })).rejects.toThrow(/Unknown/);
    await expect(runOp(director, 'cal.tv.delete', { id: 99999 })).rejects.toThrow();
  });

  it('the interval: 1 to 15 minutes; the TV gets it', async () => {
    await runOp(director, 'cal.tv.minutes', { minutes: 3 });
    expect((await get()).minutes).toBe(3);
    expect((await screen()).phraseMinutes).toBe(3);
    for (const bad of [0, 16, -2, NaN]) await expect(runOp(director, 'cal.tv.minutes', { minutes: bad })).rejects.toThrow();
    await runOp(director, 'cal.tv.minutes', { minutes: 15 });
    expect((await screen()).phraseMinutes).toBe(15);
    await runOp(director, 'cal.tv.minutes', { minutes: 5 });
  });

  it('only who has the set-up tick writes (or even reads this page); the Administrator may', async () => {
    for (const [name, args] of [['cal.tv.get', undefined], ['cal.tv.save', { key: KEY, active: false }], ['cal.tv.save', { en: 'x' }], ['cal.tv.delete', { id: 1 }], ['cal.tv.minutes', { minutes: 2 }]] as [string, unknown][]) {
      await expect(runOp(reception, name, args)).rejects.toThrow();
    }
    expect((await get()).phrases.find((p) => p.key === KEY)!.active).toBe(true);
    const admin = (await db.query<{ id: number }>("SELECT p.id FROM profile p JOIN access_profile a ON a.id = p.access_id WHERE a.kind = 'administrator'"))[0];
    if (admin) expect(((await get({ ...director, profile: (await loadProfile(db, admin.id))! })).phrases.length)).toBeGreaterThan(0);
  });

  it('all switched off: no phrase at all on the TV; the TV receives only the phrases and the interval', async () => {
    for (const p of (await get()).phrases) await runOp(director, 'cal.tv.save', { key: p.key, active: false });
    const s = await screen();
    expect(s.phrases).toEqual([]);
    for (const p of (await get()).phrases) await runOp(director, 'cal.tv.save', { key: p.key, active: true });
    await runOp(director, 'cal.tv.save', { en: 'Our own sentence', ar: 'جملتنا' });
    const s2 = await screen();
    expect(s2.phrases.every((p) => Object.keys(p).sort().join() === 'ar,en,fr')).toBe(true);
    const all = JSON.stringify(s2);
    for (const bad of ['written by the centre', 'builtin', 'edited_by', 'Director']) expect(all).not.toContain(bad);
    expect(Object.keys(s2).sort()).toEqual(['areas', 'asOf', 'color', 'day', 'from', 'logo', 'organisation', 'outside', 'period', 'phraseMinutes', 'phrases', 'staying', 'to']);
  });
});

describe('every active area with a bookable space is on the map', () => {
  it('an area with nothing today is drawn with quiet tiles; bedrooms-only, stores-only and switched-off areas are not', async () => {
    const db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Director', supPin: 'fouadsj-1', comName: 'Com', comPin: 'com-pass-1' });
    const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', ['Director']))[0];
    const director: OpCtx = { db, profile: (await loadProfile(db, p.id))!, who: 'Director', install: 'office', files };
    const d0 = (await runOp(director, 'cal.get', undefined)) as CalData;
    const hall = d0.kinds.find((k) => k.name.startsWith('Hall'))!.id, bed = d0.kinds.find((k) => k.sleeps > 0)!.id;
    const area = async (name: string, active = true) => {
      const id = ((await runOp(director, 'cal.area.save', { name })) as { id: number }).id;
      if (!active) await runOp(director, 'cal.area.save', { id, name, active: false });
      return id;
    };
    const space = (building_id: number, name: string, kind_id: number, extra: Record<string, unknown> = {}) => runOp(director, 'cal.space.save', { building_id, name, kind_id, capacity: 10, ...extra });
    const busy = await area('Busy'), quiet = await area('Quiet'), beds = await area('Beds only'), stores = await area('Stores only'), off = await area('Switched off', false), empty = await area('Empty');
    await space(busy, 'Hall A', hall); await space(quiet, 'Hall Q', hall); await space(quiet, 'Hall R', hall);
    await space(beds, 'Room 1', bed, { beds: 2 }); await space(stores, 'Store 1', hall, { bookable: false }); await space(off, 'Hall Z', hall);
    void empty;
    const org = ((await runOp(director, 'cal.org.save', { name: 'Test choir', kind_id: 3, persons: [{ name: 'Person A', phone: '0911' }] })) as { id: number }).id;
    const person = ((await runOp(director, 'cal.get', undefined)) as CalData).persons[0].id;
    const hallA = ((await runOp(director, 'cal.get', undefined)) as CalData).spaces.find((s) => s.name === 'Hall A')!.id;
    await runOp(director, 'cal.booking.save', { origin: 'outside', org_id: org, person_id: person, people: 5, time_from: '09:00', time_to: '10:00', spaces: [hallA], status: 'confirmed', free: false, price_mode: 'group', price_each: true, rate: 25, currency: 'USD', from_day: today(), to_day: today(), group_name: 'Choir' });
    const m = (await runOp(director, 'cal.phone.add', { name: 'TV', role: 'team' })) as { code: string };
    const got = await claimLink(db, m.code);
    const s = await tvPack(db, await calPhoneOf(db, got!.id, got!.key), today());
    expect(s.areas.map((a) => a.name)).toEqual(['Busy', 'Quiet']);
    expect(s.areas[1].spaces.map((x) => [x.name, x.items.length])).toEqual([['Hall Q', 0], ['Hall R', 0]]);
    expect(TV_JS).toContain('لا نشاط اليوم');
    expect(TV_JS).toContain('No activity today');
  });
});
