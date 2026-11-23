// Inventory step 3 (Fouad, baseline 1.1 sections 3 and 10): problems reported. Anyone of the centre reports (what, where, a
// photo); the keeper sees the list and sets the state of the item or "nothing wrong"; the person then sees "seen by the keeper"
// and the new state. Update 75. The phone (full app only) sends the same, never twice. The Coordinator's totals carry no value.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { migrate, splitSql, type Db } from '../src/db/db';
import { MIGRATIONS } from '../src/db/migrations';
import type { InvData } from '../src/inventory/inv';
import { inventorySummary, problemsLite } from '../src/inventory/ops';
import { cleanReport, keeperOrder, problemSaid, spaceOfWhere, type InvProblem } from '../src/inventory/problems';
import { fullPhone, phonePack, phoneProblem, phoneOf, pairPhone } from '../server/phone';
import { nodeDb } from './nodeDb';

const store = new Map<string, Uint8Array>();
const files = { docWrite: async (r: string, b: Uint8Array) => { store.set(r, b); }, docRead: async (r: string) => store.get(r)!, docExists: async (r: string) => store.has(r) } as unknown as OpCtx['files'];
const JPG = btoa('fake-jpeg-bytes');

describe('the rules (pure)', () => {
  it('a report needs "what"; both texts are trimmed and short', () => {
    expect(cleanReport({ what: '   ' })).toBeNull();
    expect(cleanReport({ what: '  The   fan\n does not turn ', where: ' Hall   A ' })).toEqual({ what: 'The fan does not turn', where: 'Hall A' });
    expect(cleanReport({ what: 'x'.repeat(900) })!.what).toHaveLength(600);
    expect(cleanReport({ what: 'x', where: '' })!.where).toBeNull();
  });
  it('a typed "where" is a space only when exactly one has that name', () => {
    const spaces = [{ id: 1, name: 'Hall A' }, { id: 2, name: 'Store' }, { id: 3, name: 'store' }];
    expect(spaceOfWhere(' hall a ', spaces)).toBe(1);
    expect(spaceOfWhere('Store', spaces)).toBeNull();
    expect(spaceOfWhere('the garden', spaces)).toBeNull();
  });
  it('what the person is told; the keeper\'s order: waiting first (oldest), then answered (newest)', () => {
    expect(problemSaid({ status: 'new', result: null })).toBe('waiting');
    expect(problemSaid({ status: 'seen', result: 'repair' })).toBe('repair');
    const p = (id: number, status: 'new' | 'seen', at: string, seen: string | null) => ({ id, status, reported_at: at, seen_at: seen });
    expect(keeperOrder([p(1, 'seen', '2026-11-01', '2026-11-05'), p(2, 'new', '2026-11-03', null), p(3, 'new', '2026-11-02', null), p(4, 'seen', '2026-11-01', '2026-11-09')]).map((x) => x.id)).toEqual([3, 2, 4, 1]);
  });
});

describe('update 75 on a database at 74', () => {
  it('adds the table of problems and nothing else changes', async () => {
    const db = nodeDb();
    await db.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
    for (const mg of MIGRATIONS.filter((x) => x.n <= 74)) await db.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
    const items = JSON.stringify(await db.query('SELECT * FROM inv_item'));
    expect(await migrate(db)).toEqual([75, 76]);
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM inv_problem'))[0].n).toBe(0);
    expect(JSON.stringify(await db.query('SELECT * FROM inv_item'))).toBe(items);
    expect(await migrate(db)).toEqual([]);
  });
});

describe('the operations', () => {
  let db: Db;
  let sup: OpCtx;
  let rita: OpCtx; // reception: looks at nothing of the inventory, may report
  let sami: OpCtx; // another person
  let phoneOnly: OpCtx; // calendar-only phone person
  const ctxOf = async (name: string): Promise<OpCtx> => {
    const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
    return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
  };
  const mkUser = async (name: string, perms: string[]) => {
    await runOp(sup, 'access.save', { name: `${name} role`, perms });
    const acc = (await db.query<{ id: number }>('SELECT id FROM access_profile WHERE name = ?', [`${name} role`]))[0].id;
    await runOp(sup, 'user.save', { name, access_id: acc, books: [], pin: `${name.toLowerCase()}-pass-1` });
    return ctxOf(name);
  };
  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    sup = await ctxOf('Sup');
    rita = await mkUser('Rita', ['cal.view']);
    sami = await mkUser('Sami', ['cal.view']);
    phoneOnly = await mkUser('Cal', ['hosting.view']);
  }, 60000);

  it('anyone reports (no tick); the report is kept with its photo and who wrote it', async () => {
    expect((await problemsLite(rita))).toEqual({ on: true, open: 0 });
    const r = (await runOp(rita, 'inv.problem.report', { what: 'The fan does not turn', where: 'Hall A', photo: { base64: JPG, mime: 'image/jpeg' }, key: 'k-0001' })) as { id: number };
    const again = (await runOp(rita, 'inv.problem.report', { what: 'The fan does not turn', key: 'k-0001' })) as { id: number; already?: boolean };
    expect(again).toMatchObject({ id: r.id, already: true });
    await expect(runOp(rita, 'inv.problem.report', { what: '  ' })).rejects.toThrow(/what is wrong/);
    await expect(runOp(rita, 'inv.problem.report', { what: 'x', photo: { base64: JPG, mime: 'image/gif' } })).rejects.toThrow(/JPEG/);
    const row = (await db.query<{ reported_by: string; status: string; photo_file: string }>('SELECT reported_by, status, photo_file FROM inv_problem'))[0];
    expect(row).toMatchObject({ reported_by: 'Rita', status: 'new' });
    expect(store.has(row.photo_file)).toBe(true);
  });

  it('the keeper sees all; others see only their own; the photo only for the keeper and the reporter', async () => {
    await runOp(sami, 'inv.problem.report', { what: 'The tap leaks', where: 'Kitchen' });
    const all = ((await runOp(sup, 'inv.problem.list', undefined)) as { problems: InvProblem[] }).problems;
    expect(all.map((p) => p.what).sort()).toEqual(['The fan does not turn', 'The tap leaks']);
    const mineRita = ((await runOp(rita, 'inv.problem.list', undefined)) as { problems: InvProblem[] }).problems;
    expect(mineRita.map((p) => p.what)).toEqual(['The fan does not turn']);
    expect(mineRita[0]).toMatchObject({ mine: true, has_photo: true, status: 'new' });
    expect((await problemsLite(sup))!.open).toBe(2);
    const id = all.find((p) => p.what.startsWith('The fan'))!.id;
    expect(((await runOp(rita, 'inv.problem.photo', { id })) as { mime: string }).mime).toBe('image/jpeg');
    expect(((await runOp(sup, 'inv.problem.photo', { id })) as { mime: string }).mime).toBe('image/jpeg');
    await expect(runOp(sami, 'inv.problem.photo', { id })).rejects.toThrow(/not found/);
  });

  it('the keeper answers: the item\'s state is set and written in its history; the reporter sees "seen" and the new state', async () => {
    const inv = (await runOp(sup, 'inv.get', undefined)) as InvData;
    const furniture = inv.categories.find((c) => c.name.startsWith('Furniture'))!.id;
    const place = ((await runOp(sup, 'inv.list.save', { table: 'place', name: 'Hall A' })) as { id: number }).id;
    const item = ((await runOp(sup, 'inv.item.add', { name: 'Fan', category_id: furniture, place_id: place, qty: 1 })) as { id: number }).id;
    const prob = ((await runOp(rita, 'inv.problem.list', undefined)) as { problems: InvProblem[] }).problems[0];
    // a report typed with the exact name of a space is that space (the first was written before it existed)
    const typed = (await runOp(rita, 'inv.problem.report', { what: 'The light flickers', where: 'hall a' })) as { id: number };
    expect((await db.query<{ space_id: number | null }>('SELECT space_id FROM inv_problem WHERE id = ?', [typed.id]))[0].space_id).toBeTruthy();
    expect(prob.space_id).toBeNull();
    await expect(runOp(rita, 'inv.problem.answer', { id: prob.id, result: 'repair', item_id: item })).rejects.toThrow(/Not allowed/);
    await runOp(sup, 'inv.problem.answer', { id: prob.id, result: 'repair', item_id: item, note: 'Technician on Monday' });
    const fan = ((await runOp(sup, 'inv.get', undefined)) as InvData).items.find((i) => i.id === item)!;
    expect(fan.condition).toBe('repair');
    expect(((await runOp(sup, 'inv.get', undefined)) as InvData).moves.filter((x) => x.item_id === item && x.kind === 'repair')).toHaveLength(1);
    const seen = ((await runOp(rita, 'inv.problem.list', undefined)) as { problems: InvProblem[] }).problems.find((p) => p.id === prob.id)!;
    expect(seen).toMatchObject({ status: 'seen', result: 'repair', item_name: 'Fan', seen_by: 'Sup', seen_note: 'Technician on Monday' });
    expect(problemSaid(seen)).toBe('repair');
    // "nothing wrong" leaves the item as it is; no second history line for the same state
    const other = ((await runOp(sami, 'inv.problem.list', undefined)) as { problems: InvProblem[] }).problems[0];
    await runOp(sup, 'inv.problem.answer', { id: typed.id, result: 'nothing' });
    await runOp(sup, 'inv.problem.answer', { id: other.id, result: 'nothing', item_id: item });
    expect(((await runOp(sup, 'inv.get', undefined)) as InvData).items.find((i) => i.id === item)!.condition).toBe('repair');
    expect((await problemsLite(sup))!.open).toBe(0);
    await expect(runOp(sup, 'inv.problem.answer', { id: other.id, result: 'maybe' })).rejects.toThrow(/state/);
  });

  it('the spaces to say where are names only', async () => {
    const sp = (await runOp(rita, 'inv.problem.spaces', undefined)) as { id: number; name: string }[];
    expect(sp.some((x) => x.name === 'Hall A')).toBe(true);
    expect(Object.keys(sp[0]).sort()).toEqual(['id', 'name']);
  });

  it('the full phone app may report, the calendar-only phone may not; sent twice it is made once; the pack carries the answers', async () => {
    expect(fullPhone(sup.profile)).toBe(true);
    expect(fullPhone(phoneOnly.profile)).toBe(false);
    await expect(phoneProblem(phoneOnly, { key: 'ph-aaaa-0001', what: 'x' })).rejects.toThrow(/Not allowed/);
    const a = await phoneProblem(sup, { key: 'ph-aaaa-0002', what: 'A window is broken', where: 'Office', photo: { base64: JPG, mime: 'image/jpeg' } });
    expect(a.ok).toBe(true);
    expect(await phoneProblem(sup, { key: 'ph-aaaa-0002', what: 'A window is broken' })).toMatchObject({ already: true, id: a.id });
    await expect(phoneProblem(sup, { key: 'bad key', what: 'x' })).rejects.toThrow(/number/);
    const { id, key } = await pairPhone(db, sup.profile, 'Test phone');
    const phone = await phoneOf(db, id, key);
    const pack = await phonePack(db, sup.profile, phone);
    expect(pack.problem?.spaces.length).toBeGreaterThan(0);
    expect(pack.problem?.mine.some((x) => x.what === 'A window is broken')).toBe(true);
  });

  it('a community, the country and HR have no problems to report', async () => {
    const other = nodeDb();
    await createOffice(other, { organisation: 'Community', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    await other.batch([{ sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('kind', 'community')" }]);
    const p = (await other.query<{ id: number }>("SELECT id FROM profile WHERE name = 'Sup'"))[0];
    const c: OpCtx = { db: other, profile: (await loadProfile(other, p.id))!, who: 'Sup', install: 'office', files };
    expect(await problemsLite(c)).toBeNull();
    await expect(runOp(c, 'inv.problem.report', { what: 'x' })).rejects.toThrow(/Not allowed/);
  });

  it('the Coordinator\'s totals carry no value', async () => {
    expect(Object.keys(await inventorySummary(db)).some((k) => /value/i.test(k))).toBe(false);
  });
});
