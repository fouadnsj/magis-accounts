// The sample-data script (job J4, scripts/test-data.ts): it fills a COPY with marked sample data, never twice, refuses real-db,
// and makes its own backup first.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOffice } from '../src/setup';
import { addTestData, dbFileOf } from '../scripts/test-data';
import { nodeDb } from './nodeDb';

describe('scripts/test-data.ts', () => {
  it('refuses real data and anything that is not <folder>/dbs/<db>/magis.db', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'td-')) + '/real-db';
    fs.mkdirSync(path.join(real, 'dbs', 'x'), { recursive: true });
    fs.writeFileSync(path.join(real, 'dbs', 'x', 'magis.db'), '');
    expect(() => dbFileOf(real, 'x')).toThrow(/real-db/);
    expect(() => dbFileOf(os.tmpdir(), '../x')).toThrow(/plain database name/);
    expect(() => dbFileOf(os.tmpdir(), 'no-such-db-here')).toThrow(/No database/);
  });

  it('adds the sample data once, with a backup; a second run adds nothing', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
    const dir = path.join(folder, 'dbs', 'test');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'magis.db');
    await createOffice(nodeDb(file), { organisation: 'Test centre', supName: 'Director', supPin: 'fouadsj-1', comName: 'Com', comPin: 'com-pass-1' });
    expect(dbFileOf(folder, 'test')).toBe(file);

    const first = await addTestData(file);
    expect(first.problems).toEqual([]);
    expect(fs.existsSync(first.backup!)).toBe(true);
    expect(path.basename(first.backup!)).toMatch(/_before-test-data\.db$/);
    expect(first.added).toMatchObject({ organisations: 5, cancellations: 1, arrivals: 1, problems: 1, counts: 1, 'group splits': 1 });
    expect(first.added.bookings).toBeGreaterThanOrEqual(20);
    expect(first.added.items).toBeGreaterThanOrEqual(25);

    const second = await addTestData(file);
    expect(second.added).toEqual({});
    expect(second.problems).toEqual([]);

    const db = nodeDb(file);
    const n = async (sql: string) => (await db.query<{ n: number }>(sql))[0].n;
    expect(await n("SELECT COUNT(*) AS n FROM host_booking WHERE note LIKE 'SAMPLE %'")).toBe(first.added.bookings);
    expect(await n('SELECT COUNT(*) AS n FROM host_booking WHERE private = 1')).toBe(1);
    expect(await n("SELECT COUNT(*) AS n FROM host_pay WHERE kind = 'back'")).toBe(1);
    expect(await n("SELECT COUNT(*) AS n FROM host_pay WHERE kind = 'in'")).toBeGreaterThanOrEqual(5);
    expect(await n("SELECT COUNT(*) AS n FROM inv_item WHERE condition = 'repair'")).toBeGreaterThanOrEqual(3);
    expect(await n("SELECT COUNT(*) AS n FROM inv_item WHERE holder IS NOT NULL")).toBe(1);
  }, 120000);
});
