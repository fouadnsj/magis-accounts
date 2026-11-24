// The tester-server script (scripts/tester-server-build.ts): a folder of INVENTED data only, with the seven invented people and their roles,
// the first-page directory and the starters; the password is never stored in clear; the script refuses a missing or short password,
// anything under real-db, and a folder that is not empty (unless --rebuild, which moves it aside and never deletes).
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTesterServer, checkPassword, refuseRealDb, CENTRE_SLUG, HR_SLUG, MARKER, PEOPLE } from '../scripts/tester-server-build';
import { nodeDb } from './nodeDb';

const PW = 'tester-pass-9';
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('scripts/tester-server-build.ts', () => {
  let base: string;
  let out: string;
  let summary: Awaited<ReturnType<typeof buildTesterServer>>;

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-'));
    out = path.join(base, 'tester-server');
    summary = await buildTesterServer({ out, password: PW, port: 8395 });
  }, 180000);

  it('refuses a missing or short password, and any path under real-db', async () => {
    expect(() => checkPassword(undefined)).toThrow(/missing/);
    expect(() => checkPassword('')).toThrow(/missing/);
    expect(() => checkPassword('short')).toThrow(/too short/);
    expect(() => checkPassword('12345678')).not.toThrow();
    await expect(buildTesterServer({ out: path.join(base, 'x1'), password: 'short' })).rejects.toThrow(/too short/);
    await expect(buildTesterServer({ out: path.join(base, 'x1'), password: undefined as unknown as string })).rejects.toThrow(/missing/);
    expect(() => refuseRealDb(path.join(base, 'real-db', 'MAGIS'))).toThrow(/real-db/);
    expect(() => refuseRealDb(path.join(base, 'REAL-DB-copy'))).toThrow(/real-db/);
    await expect(buildTesterServer({ out: path.join(base, 'real-db', 'tester'), password: PW })).rejects.toThrow(/real-db/);
    expect(fs.existsSync(path.join(base, 'x1')) || fs.existsSync(path.join(base, 'real-db'))).toBe(false);
  });

  it('refuses a folder that is not empty; --rebuild moves it aside (never deletes) and only a folder it made', async () => {
    await expect(buildTesterServer({ out, password: PW })).rejects.toThrow(/not empty/);
    const strange = path.join(base, 'strange');
    fs.mkdirSync(strange);
    fs.writeFileSync(path.join(strange, 'important.txt'), 'keep me');
    await expect(buildTesterServer({ out: strange, password: PW, rebuild: true })).rejects.toThrow(/not made by this script/);
    expect(fs.readFileSync(path.join(strange, 'important.txt'), 'utf8')).toBe('keep me');
    // the real rebuild is the slow one: here only the marker rule and the name of the old folder are checked on a small stand-in
    expect(fs.existsSync(path.join(out, MARKER))).toBe(true);
  });

  it('makes the centre, the people with their roles, the HR database and the first-page directory', async () => {
    expect(summary.problems).toEqual([]);
    expect(summary.people).toEqual(PEOPLE.map((p) => p.name));
    expect(walk(out).some((f) => /real-db/i.test(f))).toBe(false);
    const db = nodeDb(path.join(out, 'dbs', CENTRE_SLUG, 'magis.db'));
    const people = await db.query<{ id: number; name: string; access_id: number; active: number; must_change: number }>('SELECT id, name, access_id, active, must_change FROM profile ORDER BY id');
    expect(people.map((p) => p.name).sort()).toEqual(PEOPLE.map((p) => p.name).sort());
    expect(people.every((p) => p.active === 1 && p.must_change === 0)).toBe(true);
    const kinds = new Map((await db.query<{ id: number; kind: string }>('SELECT id, kind FROM access_profile')).map((r) => [r.id, r.kind]));
    const extra = await db.query<{ profile_id: number; access_id: number }>('SELECT profile_id, access_id FROM profile_role');
    for (const want of PEOPLE) {
      const p = people.find((x) => x.name === want.name)!;
      const got = [kinds.get(p.access_id), ...extra.filter((e) => e.profile_id === p.id).map((e) => kinds.get(e.access_id))].sort();
      expect(got, want.name).toEqual([...want.roles].sort());
    }
    // the books: Main, the private Respo book, one cash book for each holder; the Respo book is Sample Admin's
    const books = await db.query<{ name: string; is_main: number; private: number }>('SELECT name, is_main, private FROM book');
    expect(books.map((b) => b.name).sort()).toEqual(['Main', 'Respo', 'Sample Holder 1', 'Sample Holder 2']);
    expect(books.find((b) => b.private)!.name).toBe('Respo');
    // headings and lines, the Income heading I01, entries in both currencies, a donor, a grant, a budget, a closed month
    const h1 = await db.query<{ code: string; name: string }>("SELECT code, name FROM heading WHERE code = 'I01'");
    expect(h1).toHaveLength(1);
    expect((await db.query('SELECT 1 FROM budget_line WHERE code LIKE ?', ['I01.%'])).length).toBeGreaterThanOrEqual(3);
    const sums = (await db.query<{ n: number; isyp: number; esyp: number; iusd: number; eusd: number }>('SELECT COUNT(*) AS n, SUM(inc_syp) AS isyp, SUM(exp_syp) AS esyp, SUM(inc_usd) AS iusd, SUM(exp_usd) AS eusd FROM trx'))[0];
    expect(sums.n).toBeGreaterThan(40);
    expect([sums.isyp, sums.esyp, sums.iusd, sums.eusd].every((x) => x > 0)).toBe(true);
    expect((await db.query('SELECT 1 FROM trx WHERE receipt IS NOT NULL AND party_id IS NOT NULL')).length).toBeGreaterThan(5);
    expect((await db.query<{ name: string }>('SELECT name FROM donor')).map((d) => d.name)).toContain('Sample Foundation'); // ("SJ" is the program's own starting donor)
    expect((await db.query('SELECT 1 FROM grant_card')).length).toBe(1);
    expect((await db.query('SELECT 1 FROM budget')).length).toBe(1);
    expect((await db.query('SELECT 1 FROM closed_month')).length).toBe(2);
    // the calendar and the inventory: spaces, bookings (some today or later), items
    expect((await db.query("SELECT 1 FROM host_booking WHERE note LIKE 'SAMPLE%'")).length).toBeGreaterThan(20);
    expect((await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM host_booking WHERE note LIKE 'SAMPLE t%' AND to_day >= date('now', '-1 day')"))[0].n).toBeGreaterThan(0);
    expect((await db.query('SELECT 1 FROM inv_item')).length).toBeGreaterThan(25);
    // the HR database
    const hr = nodeDb(path.join(out, 'dbs', HR_SLUG, 'magis.db'));
    expect((await hr.query<{ category: string }>('SELECT category FROM hr_person ORDER BY id')).map((r) => r.category)).toEqual(['staff', 'staff', 'staff', 'tutor']);
    // the first-page directory: every person, with the centre (and Sample Admin the HR) given, nobody an administrator of the directory
    const dir = JSON.parse(fs.readFileSync(path.join(out, 'directory.json'), 'utf8')) as { enforced: boolean; people: { name: string; admin: boolean; hash: string; grants: Record<string, number> }[] };
    expect(dir.enforced).toBe(true);
    expect(dir.people.map((p) => p.name)).toEqual(PEOPLE.map((p) => p.name));
    expect(dir.people.every((p) => !p.admin && p.hash.startsWith('pbkdf2$') && typeof p.grants[CENTRE_SLUG] === 'number')).toBe(true);
    expect(Object.keys(dir.people[0].grants).sort()).toEqual([CENTRE_SLUG, HR_SLUG]);
    expect(Object.keys(dir.people[1].grants)).toEqual([CENTRE_SLUG]);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8'))).toMatchObject({ httpPort: 8395, httpMode: 'serve' });
    // the starters and the README
    for (const f of ['START-TESTER-SERVER.command', 'START-TESTER-SERVER.bat', 'README-TESTER-SERVER.md']) expect(fs.existsSync(path.join(out, f))).toBe(true);
    expect(fs.statSync(path.join(out, 'START-TESTER-SERVER.command')).mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(path.join(out, 'START-TESTER-SERVER.command'), 'utf8')).toContain('--http-only --port=8395');
  });

  it('never stores the password in clear, in any file (databases, directory, starters, README)', () => {
    const needle = Buffer.from(PW);
    for (const f of walk(out)) expect(fs.readFileSync(f).includes(needle), f).toBe(false);
  });

  it('--rebuild on a folder it made moves it to "-old" and makes a new one', async () => {
    const small = path.join(base, 'small');
    fs.mkdirSync(small);
    fs.writeFileSync(path.join(small, MARKER), 'x');
    fs.writeFileSync(path.join(small, 'old-file.txt'), 'old');
    const r = await buildTesterServer({ out: small, password: PW, rebuild: true, port: 8396 });
    expect(r.movedAside).toBe(`${small}-old`);
    expect(fs.readFileSync(path.join(`${small}-old`, 'old-file.txt'), 'utf8')).toBe('old');
    expect(fs.existsSync(path.join(small, 'directory.json'))).toBe(true);
    const again = await buildTesterServer({ out: small, password: PW, rebuild: true });
    expect(again.movedAside).toBe(`${small}-old-2`);
  }, 180000);
});
