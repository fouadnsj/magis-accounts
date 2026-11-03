// The main list of headings and lines on the server (Fouad, 2026-11-03): started from Homs, changed as a draft,
// renumbered, published; each centre takes what it needs, and what it has follows the list (names, codes, moves,
// merges) with its rows.
import { describe, expect, it } from 'vitest';
import { migrate, type Db } from '../src/db/db';
import { addHeading, addLine, loadLists } from '../src/db/repo';
import { applyMainList, checkMainList, mainListChanges, mainListFromDb, newUid, renumber, type MainList } from '../src/io/mainList';
import { nodeDb } from './nodeDb';

const fresh = async () => {
  const db = nodeDb();
  await migrate(db);
  return db;
};
const row = (db: Db, id: string, lineId: number, headingId: number) =>
  db.batch([{ sql: "INSERT INTO trx (id, date, type, heading_id, line_id, created_at) VALUES (?, '2026-10-01', 'Exp', ?, ?, '2026-10-01')", params: [id, headingId, lineId] }]);
const lineOf = async (db: Db, name: string) => (await loadLists(db)).lines.find((l) => l.name === name && l.merged_into == null);
const headingOf = async (db: Db, name: string) => (await loadLists(db)).headings.find((h) => h.name === name);

async function homs() {
  const db = await fresh();
  await addHeading(db, 'Salary', ['Exp'], 't');
  await addHeading(db, 'Activities', ['Exp'], 't');
  const sal = (await headingOf(db, 'Salary'))!.id;
  const act = (await headingOf(db, 'Activities'))!.id;
  for (const n of ['Reception', 'Cleaner', 'Animator']) await addLine(db, sal, n, 't');
  for (const n of ['Hospitality', 'Snacks']) await addLine(db, act, n, 't');
  return db;
}

describe('the main list', () => {
  it('starts from Homs, in the order of the codes, and refuses two of the same', async () => {
    const h = await homs();
    const list = await mainListFromDb(h, 'srv', 'Homs');
    expect(list.headings.map((x) => x.name)).toContain('Salary');
    expect(list.lines.filter((l) => l.heading_uid === list.headings.find((x) => x.name === 'Salary')!.uid).map((l) => l.name)).toEqual(['Reception', 'Cleaner', 'Animator']);
    expect(() => checkMainList({ ...list, lines: [...list.lines, { ...list.lines[0], uid: newUid() }] })).toThrow(/Two lines/);
  });

  it('renumbers in the order of the list', async () => {
    const list = await mainListFromDb(await homs(), 'srv', 'Homs');
    const sal = list.headings.find((x) => x.name === 'Salary')!;
    // Animator moved first in Salary: its code is still the old one until "Renumber"
    const anim = list.lines.find((l) => l.name === 'Animator')!;
    const moved = { ...list, lines: [anim, ...list.lines.filter((l) => l !== anim)] };
    const r = renumber(moved);
    expect(r.lines.find((l) => l.name === 'Animator')!.code).toBe(`${r.headings.find((x) => x.uid === sal.uid)!.code}.1`);
    expect(r.lines.find((l) => l.name === 'Reception')!.code).toBe(`${r.headings.find((x) => x.uid === sal.uid)!.code}.2`);
  });

  it('a new centre takes what it needs; a published change reaches what it has, with its rows', async () => {
    const h = await homs();
    let list: MainList = { ...(await mainListFromDb(h, 'srv', 'Homs')), version: 1 };
    const aleppo = await fresh();
    // Aleppo has its own "Cleaner"-less salary heading of the same name: it becomes the list's
    await addHeading(aleppo, 'Salary', ['Exp'], 't');
    await addLine(aleppo, (await headingOf(aleppo, 'Salary'))!.id, 'Reception', 't');
    const reception = list.lines.find((l) => l.name === 'Reception')!;
    const hosp = list.lines.find((l) => l.name === 'Hospitality')!;
    const r = await applyMainList(aleppo, list, 't', { take: [hosp.uid] });
    expect(r.added).toBe(2); // Activities and its Hospitality
    const L = await loadLists(aleppo);
    expect(L.lines.find((l) => l.name === 'Reception')!.uid).toBe(reception.uid);
    expect(L.lines.find((l) => l.name === 'Reception')!.in_main).toBe(1);
    expect(L.lines.some((l) => l.name === 'Cleaner')).toBe(false); // not taken
    expect(L.lines.find((l) => l.name === 'Hospitality')!.active).toBe(1);

    // a row on Hospitality and one on Snacks in Homs
    const hHosp = (await lineOf(h, 'Hospitality'))!;
    const hSnacks = (await lineOf(h, 'Snacks'))!;
    await row(h, 'r1', hHosp.id, hHosp.heading_id);
    await row(h, 'r2', hSnacks.id, hSnacks.heading_id);
    await row(aleppo, 'a1', (await lineOf(aleppo, 'Hospitality'))!.id, (await lineOf(aleppo, 'Hospitality'))!.heading_id);

    // the administrator: Hospitality moves to Salary (rare), Snacks is merged into it, Reception renamed; then renumber
    const sal = list.headings.find((x) => x.name === 'Salary')!;
    const snacks = list.lines.find((l) => l.name === 'Snacks')!;
    list = renumber({
      ...list, version: 2,
      lines: list.lines.filter((l) => l !== snacks).map((l) => (l === hosp ? { ...l, heading_uid: sal.uid } : l === reception ? { ...l, name: 'Receptionist' } : l)),
      merged: [{ kind: 'line', from: snacks.uid, into: hosp.uid, at: '2026-11-03' }],
    });
    expect(await mainListChanges(h, list)).toMatchObject({ merged: 1, moved: 1, rows: 2 });
    const rh = await applyMainList(h, list, 't');
    expect(rh).toMatchObject({ merged: 1, moved: 1 });
    const salId = (await headingOf(h, 'Salary'))!.id;
    const trx = await h.query<{ id: string; line_id: number; heading_id: number }>('SELECT id, line_id, heading_id FROM trx ORDER BY id');
    expect(trx).toEqual([{ id: 'r1', line_id: hHosp.id, heading_id: salId }, { id: 'r2', line_id: hHosp.id, heading_id: salId }]);
    const old = (await loadLists(h)).lines.find((l) => l.id === hSnacks.id)!;
    expect(old).toMatchObject({ active: 0, merged_into: hHosp.id });
    expect((await lineOf(h, 'Receptionist'))!.code).toBe(list.lines.find((l) => l.uid === reception.uid)!.code);

    // Aleppo follows: its Hospitality moves to Salary with its row; it never had Snacks
    await applyMainList(aleppo, list, 't');
    const aHosp = (await lineOf(aleppo, 'Hospitality'))!;
    expect(aHosp.heading_id).toBe((await headingOf(aleppo, 'Salary'))!.id);
    expect((await aleppo.query<{ heading_id: number }>("SELECT heading_id FROM trx WHERE id = 'a1'"))[0].heading_id).toBe(aHosp.heading_id);
    expect(await lineOf(aleppo, 'Receptionist')).toBeTruthy();
  });

  it('a heading merged into another brings its lines; a centre switch-off stays; the list switch-off reaches all', async () => {
    const h = await homs();
    let list: MainList = { ...(await mainListFromDb(h, 'srv', 'Homs')), version: 1 };
    const sal = list.headings.find((x) => x.name === 'Salary')!;
    const act = list.headings.find((x) => x.name === 'Activities')!;
    await h.batch([{ sql: "UPDATE budget_line SET active = 0 WHERE name = 'Cleaner'" }]);
    list = {
      ...list, version: 2,
      headings: list.headings.filter((x) => x !== act),
      lines: list.lines.map((l) => (l.heading_uid === act.uid ? { ...l, heading_uid: sal.uid } : l.name === 'Animator' ? { ...l, active: 0 } : l)),
      merged: [{ kind: 'heading', from: act.uid, into: sal.uid, at: '2026-11-03' }],
    };
    await applyMainList(h, list, 't');
    const L = await loadLists(h);
    expect(L.headings.some((x) => x.name === 'Activities')).toBe(false);
    expect((await lineOf(h, 'Snacks'))!.heading_id).toBe((await headingOf(h, 'Salary'))!.id);
    expect((await lineOf(h, 'Cleaner'))!.active).toBe(0);
    expect((await lineOf(h, 'Animator'))!.active).toBe(0);
    expect((await lineOf(h, 'Reception'))!.active).toBe(1);
  });

  it("a centre's own heading with the list's code keeps its name and gets a free code", async () => {
    const h = await homs();
    const list: MainList = { ...(await mainListFromDb(h, 'srv', 'Homs')), version: 1 };
    const c = await fresh();
    const code = list.headings.find((x) => x.name === 'Salary')!.code;
    await addHeading(c, 'Workshops', ['Exp'], 't'); // the same code as Salary in Homs (the first Exp heading)
    expect((await headingOf(c, 'Workshops'))!.code).toBe(code);
    await applyMainList(c, list, 't', { take: [list.headings.find((x) => x.name === 'Salary')!.uid] });
    expect((await headingOf(c, 'Workshops'))!.code).toBe(`${code}-2`);
    expect((await headingOf(c, 'Salary'))!.code).toBe(code);
  });
});
