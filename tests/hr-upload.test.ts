// An HR database brought to a server (Fouad, 2026-11-11): a new database marked HR takes a .db file as it is — its people,
// its keepers and their passwords — instead of only the form for a new HR keeper.
import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';

const servers: Running[] = [];
const dirs: string[] = [];
afterAll(async () => { for (const s of servers) await s.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

async function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-hrup-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  const srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.httpPort}`;
  const call = async (url: string, body?: unknown) => {
    const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { call, dir };
}

describe('an HR database taken into a server', () => {
  it('a new HR database takes a .db file whole; the keeper signs in with his own password', async () => {
    const one = await server();
    const made = await one.call('/api/dbs/create', { organisation: 'HR old', centre: 'other', kind: 'hr' });
    expect(made.status).toBe(200);
    expect((await one.call('/api/setup/hr', { db: made.body.slug, organisation: 'HR old', people: [{ name: 'Keeper', password: 'keeper-pass-1' }], mustChange: false })).status).toBe(200);
    const file = fs.readFileSync(path.join(one.dir, 'dbs', made.body.slug, 'magis.db')).toString('base64');

    // another server: a new database marked HR, then the file instead of the form
    const two = await server();
    const hr = await two.call('/api/dbs/create', { organisation: 'HR', centre: 'other', kind: 'hr' });
    expect((await two.call('/api/hello')).body.dbs[0]).toMatchObject({ kind: 'hr', setupNeeded: true });
    expect((await two.call('/api/setup/upload-db', { db: hr.body.slug, base64: file })).status).toBe(200);
    expect((await two.call('/api/hello')).body.dbs[0]).toMatchObject({ kind: 'hr', setupNeeded: false });
    const profiles = (await two.call(`/api/profiles?db=${hr.body.slug}`)).body as { id: number; name: string }[];
    expect(profiles.map((p) => p.name)).toEqual(['Keeper']);
    expect((await two.call('/api/login', { db: hr.body.slug, profileId: profiles[0].id, password: 'keeper-pass-1' })).status).toBe(200);
    // a database already set up is not replaced by this route
    expect((await two.call('/api/setup/upload-db', { db: hr.body.slug, base64: file })).status).toBe(409);
    // not a database file
    const other = await two.call('/api/dbs/create', { organisation: 'HR 2', centre: 'other', kind: 'hr' });
    expect((await two.call('/api/setup/upload-db', { db: other.body.slug, base64: Buffer.from('not a database').toString('base64') })).status).toBe(400);
  });

  it('"From a database file" in New database: a plain new database takes an HR file; a community or Province file is refused', async () => {
    const one = await server();
    const made = await one.call('/api/dbs/create', { organisation: 'HR old', centre: 'other', kind: 'hr' });
    await one.call('/api/setup/hr', { db: made.body.slug, organisation: 'HR old', people: [{ name: 'Keeper', password: 'keeper-pass-1' }], mustChange: false });
    const hrFile = path.join(one.dir, 'dbs', made.body.slug, 'magis.db');
    const b64 = fs.readFileSync(hrFile).toString('base64');

    // another server: the new database is not marked HR (as the button creates it), then the file
    const two = await server();
    const plain = await two.call('/api/dbs/create', { organisation: 'HR at Aleppo', centre: 'aleppo' });
    expect((await two.call('/api/setup/upload-db', { db: plain.body.slug, base64: b64 })).status).toBe(200);
    const shown = (await two.call('/api/hello')).body.dbs[0];
    expect(shown).toMatchObject({ kind: 'hr', setupNeeded: false, centre: 'aleppo' }); // it is HR now, and keeps Aleppo's colours

    // a community's file (or the Province's) does not come in through a plain database
    const { DatabaseSync } = (await import('node:module')).createRequire(import.meta.url)('node:sqlite');
    for (const kind of ['community', 'province']) {
      const copy = path.join(one.dir, `as-${kind}.db`);
      fs.copyFileSync(hrFile, copy);
      const db = new DatabaseSync(copy);
      db.prepare("UPDATE meta SET value = ? WHERE key = 'kind'").run(kind);
      db.close();
      const target = await two.call('/api/dbs/create', { organisation: `Plain ${kind}`, centre: 'other' });
      expect((await two.call('/api/setup/upload-db', { db: target.body.slug, base64: fs.readFileSync(copy).toString('base64') })).status).toBe(400);
    }
  });

  it('a database from a file keeps its own name; its users and their centres are shown first; the house and colour are chosen; a name already used is refused', async () => {
    const one = await server();
    const made = await one.call('/api/dbs/create', { organisation: 'HR Syria', centre: 'other', kind: 'hr' });
    await one.call('/api/setup/hr', { db: made.body.slug, organisation: 'HR Syria', people: [{ name: 'Keeper', password: 'keeper-pass-1' }], mustChange: false });
    const hrFile = path.join(one.dir, 'dbs', made.body.slug, 'magis.db');
    // the keeper is limited to Homs (an HR keeper "of a centre")
    const { DatabaseSync } = (await import('node:module')).createRequire(import.meta.url)('node:sqlite');
    const copy = path.join(one.dir, 'limited.db');
    fs.copyFileSync(hrFile, copy);
    const f = new DatabaseSync(copy);
    f.prepare('UPDATE profile SET hr_centres = ?').run('["homs"]');
    f.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('brand_logo', 'data:image/png;base64,AAAA')").run();
    f.close();
    const b64 = fs.readFileSync(copy).toString('base64');

    const two = await server();
    // looked at first: its name, its kind, its users with the centres each sees
    const peek = await two.call('/api/dbs/peek', { base64: b64 });
    expect(peek.body).toMatchObject({ organisation: 'HR Syria', kind: 'hr', nameTaken: false, users: [{ name: 'Keeper', centres: ['homs'] }] });
    // imported with no name written: it keeps ITS OWN name; nothing else is asked
    const imp = await two.call('/api/dbs/import', { base64: b64 });
    expect(imp.body).toMatchObject({ organisation: 'HR Syria', kind: 'hr' });
    expect((await two.call('/api/hello')).body.dbs.map((d: { organisation: string; kind: string }) => [d.organisation, d.kind])).toEqual([['HR Syria', 'hr']]);
    const profiles = (await two.call(`/api/profiles?db=${imp.body.slug}`)).body as { id: number }[];
    expect((await two.call('/api/login', { db: imp.body.slug, profileId: profiles[0].id, password: 'keeper-pass-1' })).status).toBe(200);
    // the same name again is refused (it would confuse); under another name, with Aleppo's house, it comes
    expect((await two.call('/api/dbs/peek', { base64: b64 })).body.nameTaken).toBe(true);
    expect((await two.call('/api/dbs/import', { base64: b64 })).status).toBe(409);
    const aleppo = await two.call('/api/dbs/import', { base64: b64, organisation: 'HR Aleppo', centre: 'aleppo' });
    expect(aleppo.status).toBe(200);
    // its own colour and logo
    expect((await two.call('/api/dbs/import', { base64: b64, organisation: 'HR Scouts', centre: 'other', color: '#112233' })).status).toBe(200);
    const shown = (await two.call('/api/hello')).body.dbs as { organisation: string; centre: string; color: string | null; logo: string | null }[];
    expect(shown.find((d) => d.organisation === 'HR Aleppo')).toMatchObject({ centre: 'aleppo' });
    expect(shown.find((d) => d.organisation === 'HR Scouts')).toMatchObject({ centre: 'other', color: '#112233', logo: 'data:image/png;base64,AAAA' }); // its own colour, the file's logo kept
    expect(shown.find((d) => d.organisation === 'HR Aleppo')!.logo).toBeNull(); // a house's mark instead of the logo
    expect(shown.find((d) => d.organisation === 'HR Syria')).toBeTruthy(); // (left alone: as in the file)
    // a file that is not a database, or a community's, leaves nothing behind
    expect((await two.call('/api/dbs/import', { base64: Buffer.from('nope').toString('base64') })).status).toBe(400);
    expect((await two.call('/api/hello')).body.dbs).toHaveLength(3);
  });
});
