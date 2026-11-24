// The sentences of a centre (update 78, 26 November 2026): ONE pool for the doors page and the TV. The code's list is the default; a centre may
// switch a sentence off, edit it (and restore it), choose where it appears, write its own and delete it; the TV interval and language are settings.
// Only the Administrator and the Director write (the rule of People and Roles); the doors page reads the pool; the TV receives only its own
// phrases. And the map draws EVERY active area that has a bookable space, even with nothing today. Invented names.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { migrate, nowIso, splitSql, type Db } from '../src/db/db';
import { MIGRATIONS } from '../src/db/migrations';
import type { CalData } from '../src/hosting/calendar';
import { SENTENCES, pickSentences, sentencesFor, type Sentence } from '../src/ui/doorSentences';
import { TV_PHRASE_MINUTES, poolList, type PoolItem } from '../src/sentencePool';
import { calPhoneOf, claimLink, tvPack } from '../server/calphone';
import { TV_JS } from '../server/tv-page';
import { nodeDb } from './nodeDb';

const today = () => nowIso().slice(0, 10);
const files = {} as OpCtx['files'];

describe('update 78 on a database at 77', () => {
  it('adds the table of sentences and nothing else; a second run does nothing', async () => {
    const db = nodeDb();
    await db.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
    for (const mg of MIGRATIONS.filter((x) => x.n <= 77)) await db.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
    const rooms = JSON.stringify(await db.query('SELECT * FROM host_room'));
    expect(await migrate(db)).toEqual([78, 79]);
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM sentence'))[0].n).toBe(0);
    expect(JSON.stringify(await db.query('SELECT * FROM host_room'))).toBe(rooms);
    expect(await migrate(db)).toEqual([]);
  });
});

describe('the sentences of a centre', () => {
  let db: Db, director: OpCtx, reception: OpCtx;
  const ctxOf = async (name: string): Promise<OpCtx> => {
    const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
    return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
  };
  const get = async (c = director) => (await runOp(c, 'sentence.get', undefined)) as { minutes: number; lang: string; items: PoolItem[] };
  const pool = async (c = director) => (await runOp(c, 'sentence.pool', undefined)) as Sentence[];
  const rows = async () => (await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM sentence'))[0].n;
  const screen = async () => {
    const m = (await runOp(director, 'cal.phone.add', { name: `TV ${Math.random()}`, role: 'team' })) as { code: string };
    const got = await claimLink(db, m.code);
    return tvPack(db, await calPhoneOf(db, got!.id, got!.key), today());
  };
  // a sentence that suits the doors and the TV, one that is only for doors, and a testimony
  const BOTH = SENTENCES.find((s) => !s.centre && s.for.includes('tv') && s.for.includes('calendar') && s.kind !== 'original')!.id;
  const DOORS_ONLY = SENTENCES.find((s) => !s.centre && !s.for.includes('tv') && s.kind !== 'testimony' && s.for.includes('accounts'))!.id;
  const TESTIMONY = SENTENCES.find((s) => s.kind === 'testimony')!.id;
  const text = (id: string) => SENTENCES.find((s) => s.id === id)!.msg.en;

  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Director', supPin: 'fouadsj-1', comName: 'Com', comPin: 'com-pass-1' });
    director = await ctxOf('Director');
    await runOp(director, 'access.save', { name: 'Reception', perms: ['cal.view', 'cal.contacts', 'cal.outside', 'cal.orgs', 'cal.arrive'] });
    const access = (await db.query<{ id: number }>('SELECT id FROM access_profile WHERE name = ?', ['Reception']))[0].id;
    await runOp(director, 'user.save', { name: 'Reception', access_id: access, books: [], pin: 'test123-pass' });
    reception = await ctxOf('Reception');
  }, 60000);

  it('nothing changed: the code’s pool for everyone, all on, 5 minutes, English; nothing is stored for the default', async () => {
    const g = await get();
    expect(g.minutes).toBe(TV_PHRASE_MINUTES);
    expect(g.lang).toBe('en');
    expect(g.items.length).toBe(poolList('other').length);
    expect(g.items.every((p) => p.active && !p.edited && !p.placesEdited && p.key)).toBe(true);
    // the doors page receives the code's pool exactly (ids and places), the TV gets the ones marked for it
    expect((await pool()).map((p) => [p.id, p.for])).toEqual(poolList('other').map((p) => [p.key, p.places]));
    expect((await screen()).phrases.length).toBe(g.items.filter((p) => p.places.includes('tv')).length);
    expect(await rows()).toBe(0);
  });

  it('the pool is read by every person signed in (the doors page); the TV never receives the doors’ pool', async () => {
    expect((await pool(reception)).length).toBeGreaterThan(30);
    const s = await screen();
    expect(Object.keys(s)).not.toContain('items');
    expect(s.phrases.every((p) => Object.keys(p).sort().join() === 'ar,en,fr')).toBe(true);
  });

  it('switched off: not on the doors page, not on the TV; on again: back, and no row is left', async () => {
    await runOp(director, 'sentence.save', { key: BOTH, active: false });
    expect((await pool()).map((p) => p.id)).not.toContain(BOTH);
    expect((await screen()).phrases.map((p) => p.en)).not.toContain(text(BOTH));
    expect((await get()).items.find((p) => p.key === BOTH)!.active).toBe(false);
    await runOp(director, 'sentence.save', { key: BOTH, active: true });
    expect((await pool()).map((p) => p.id)).toContain(BOTH);
    expect((await screen()).phrases.map((p) => p.en)).toContain(text(BOTH));
    expect(await rows()).toBe(0);
  });

  it('edited: the doors page and the TV show the new text; restored, or typed back, the default returns and no row is left', async () => {
    const orig = (await get()).items.find((p) => p.key === BOTH)!;
    await runOp(director, 'sentence.save', { key: BOTH, ar: 'نص جديد', en: 'A new text', fr: 'Un nouveau texte' });
    expect((await pool()).find((p) => p.id === BOTH)!.msg).toEqual({ ar: 'نص جديد', en: 'A new text', fr: 'Un nouveau texte' });
    expect((await screen()).phrases.map((p) => p.en)).toContain('A new text');
    expect((await get()).items.find((p) => p.key === BOTH)!.original).toMatchObject({ en: orig.en });
    await runOp(director, 'sentence.save', { key: BOTH, restore: true });
    expect((await get()).items.find((p) => p.key === BOTH)!.en).toBe(orig.en);
    await runOp(director, 'sentence.save', { key: BOTH, ar: 'x', en: 'y', fr: 'z' });
    await runOp(director, 'sentence.save', { key: BOTH, ar: orig.ar, en: orig.en, fr: orig.fr });
    expect(await rows()).toBe(0);
  });

  it('the places: a doors sentence moved to the TV, one taken off the TV, one taken off a door; restored; a testimony never gets the TV', async () => {
    await runOp(director, 'sentence.save', { key: DOORS_ONLY, places: ['accounts', 'tv'] });
    expect((await screen()).phrases.map((p) => p.en)).toContain(text(DOORS_ONLY));
    const forDoors = await pool();
    expect(forDoors.find((p) => p.id === DOORS_ONLY)!.for).toEqual(['accounts', 'tv']);
    expect(sentencesFor('calendar', 'other', forDoors).map((p) => p.id)).not.toContain(DOORS_ONLY);
    await runOp(director, 'sentence.save', { key: BOTH, places: ['calendar'] });
    expect((await screen()).phrases.map((p) => p.en)).not.toContain(text(BOTH));
    expect(sentencesFor('calendar', 'other', await pool()).map((p) => p.id)).toContain(BOTH);
    await runOp(director, 'sentence.save', { key: TESTIMONY, places: ['accounts', 'tv', 'centre'] });
    expect((await get()).items.find((p) => p.key === TESTIMONY)!.places).toEqual(['centre', 'accounts']);
    expect((await screen()).phrases.map((p) => p.en)).not.toContain(text(TESTIMONY));
    for (const k of [DOORS_ONLY, BOTH, TESTIMONY]) await runOp(director, 'sentence.save', { key: k, restorePlaces: true });
    expect(await rows()).toBe(0);
  });

  it('the doors page draws only from what is on: a place with nothing left shows nothing; the others still draw', async () => {
    const ids = (await get()).items.filter((p) => p.places.includes('hr') && !p.centre).map((p) => p.key!);
    for (const k of ids) await runOp(director, 'sentence.save', { key: k, active: false });
    const p = await pool();
    const got = pickSentences(['centre', 'hr', 'calendar'], 'other', {}, Math.random, p);
    expect(got.hr).toBeUndefined();
    expect(got.calendar).toBeTruthy();
    expect(got.centre).toBeTruthy();
    for (const k of ids) await runOp(director, 'sentence.save', { key: k, active: true });
    expect(await rows()).toBe(0);
  });

  it('the centre writes its own sentence (places chosen), edits it, switches it off and deletes it; a built-in one cannot be deleted', async () => {
    const r = (await runOp(director, 'sentence.save', { ar: 'أهلاً بأهل الحيّ', en: '', fr: '', places: ['calendar', 'tv'] })) as { id: number };
    let mine = (await get()).items.find((p) => p.id === r.id)!;
    expect([mine.key, mine.kind, mine.source, mine.places]).toEqual([null, 'centre', 'written by the centre', ['calendar', 'tv']]);
    // Arabic first, the other language under it: written only in Arabic, it is sent with empty English and French
    expect((await screen()).phrases.find((p) => p.ar === 'أهلاً بأهل الحيّ')).toEqual({ ar: 'أهلاً بأهل الحيّ', en: '', fr: '' });
    expect(sentencesFor('calendar', 'other', await pool()).some((p) => p.msg.ar === 'أهلاً بأهل الحيّ')).toBe(true);
    expect(sentencesFor('accounts', 'other', await pool()).some((p) => p.msg.ar === 'أهلاً بأهل الحيّ')).toBe(false);
    await runOp(director, 'sentence.save', { id: r.id, ar: 'أهلاً بأهل الحيّ', en: 'Welcome, neighbours' });
    mine = (await get()).items.find((p) => p.id === r.id)!;
    expect(mine.en).toBe('Welcome, neighbours');
    await runOp(director, 'sentence.save', { id: r.id, active: false });
    expect((await screen()).phrases.map((p) => p.en)).not.toContain('Welcome, neighbours');
    expect((await pool()).some((p) => p.msg.en === 'Welcome, neighbours')).toBe(false);
    await runOp(director, 'sentence.delete', { id: r.id });
    expect((await get()).items.some((p) => p.id === r.id)).toBe(false);
    await runOp(director, 'sentence.save', { key: BOTH, active: false });
    const row = (await db.query<{ id: number }>('SELECT id FROM sentence WHERE builtin_key = ?', [BOTH]))[0];
    await expect(runOp(director, 'sentence.delete', { id: row.id })).rejects.toThrow(/built-in/);
    await runOp(director, 'sentence.save', { key: BOTH, active: true });
    expect(await rows()).toBe(0);
  });

  it('no check but the length and that something is written; an unknown key is refused', async () => {
    await expect(runOp(director, 'sentence.save', { ar: '', en: '  ', fr: '' })).rejects.toThrow(/at least one language/);
    await expect(runOp(director, 'sentence.save', { key: BOTH, ar: '', en: '', fr: '' })).rejects.toThrow(/at least one language/);
    await expect(runOp(director, 'sentence.save', { en: 'x'.repeat(300) })).rejects.toThrow(/too long/);
    await expect(runOp(director, 'sentence.save', { key: 'no-such-sentence', active: false })).rejects.toThrow(/Unknown/);
    await expect(runOp(director, 'sentence.delete', { id: 99999 })).rejects.toThrow();
  });

  it('the TV interval (1 to 15) and language (English, French, Arabic only): settings the TV receives', async () => {
    await runOp(director, 'sentence.minutes', { minutes: 3 });
    expect((await get()).minutes).toBe(3);
    expect((await screen()).phraseMinutes).toBe(3);
    for (const bad of [0, 16, -2, NaN]) await expect(runOp(director, 'sentence.minutes', { minutes: bad })).rejects.toThrow();
    await runOp(director, 'sentence.minutes', { minutes: 5 });
    expect((await screen()).lang).toBe('en');
    await runOp(director, 'sentence.lang', { lang: 'fr' });
    expect((await screen()).lang).toBe('fr');
    expect((await get()).lang).toBe('fr');
    await expect(runOp(director, 'sentence.lang', { lang: 'de' })).rejects.toThrow();
    await runOp(director, 'sentence.lang', { lang: 'en' });
  });

  it('only the Administrator and the Director write (or read the whole list); Reception and the others are refused by the server', async () => {
    for (const [name, args] of [['sentence.get', undefined], ['sentence.save', { key: BOTH, active: false }], ['sentence.save', { en: 'x' }], ['sentence.delete', { id: 1 }], ['sentence.minutes', { minutes: 2 }], ['sentence.lang', { lang: 'fr' }]] as [string, unknown][]) {
      await expect(runOp(reception, name, args)).rejects.toThrow();
    }
    expect((await get()).items.find((p) => p.key === BOTH)!.active).toBe(true);
    const admin = (await db.query<{ id: number }>("SELECT p.id FROM profile p JOIN access_profile a ON a.id = p.access_id WHERE a.kind = 'administrator'"))[0];
    if (admin) expect((await get({ ...director, profile: (await loadProfile(db, admin.id))! })).items.length).toBeGreaterThan(0);
  });

  it('all switched off for the TV: no phrase; the TV receives only phrases, the interval and the language', async () => {
    for (const p of (await get()).items) await runOp(director, 'sentence.save', { key: p.key, active: false });
    expect((await screen()).phrases).toEqual([]);
    expect((await pool()).length).toBe(0);
    for (const p of (await get()).items) await runOp(director, 'sentence.save', { key: p.key, active: true });
    await runOp(director, 'sentence.save', { en: 'Our own sentence', ar: 'جملتنا', places: ['tv'] });
    const s2 = await screen();
    const all = JSON.stringify(s2);
    for (const bad of ['written by the centre', 'builtin', 'edited_by', 'Director']) expect(all).not.toContain(bad);
    expect(Object.keys(s2).sort()).toEqual(['areas', 'asOf', 'color', 'day', 'from', 'lang', 'logo', 'organisation', 'outside', 'period', 'phraseMinutes', 'phrases', 'staying', 'to']);
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
