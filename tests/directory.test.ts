// The sign-in directory (Fouad, 30 October 2026): one name and password, then only the databases given to that person.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';

let srv: Running;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-dir-'));
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  base = `http://127.0.0.1:${srv.httpPort}`;
}, 60000);
afterAll(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** a browser: keeps its own cookies */
function browser() {
  const jar = new Map<string, string>();
  return async (url: string, body?: unknown) => {
    const r = await fetch(base + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (/Max-Age=0/.test(c)) jar.delete(kv.slice(0, i));
      else jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

describe('server: the sign-in directory', () => {
  it('administrator, access per database, entering without a second password, enforcement', async () => {
    const admin = browser();
    // two centres, each with a Superior and an Accountant
    for (const [org, centre] of [['Homs', 'homs'], ['Aleppo', 'aleppo']] as const) {
      const made = await admin('/api/dbs/create', { organisation: org, centre });
      await admin('/api/setup/new', { db: made.body.slug, organisation: org, supName: 'Boss', supPin: `boss-${org}-1`, comName: 'Clerk', comPin: `clerk-${org}-1` });
    }
    expect((await admin('/api/hello')).body.dir.on).toBe(false);

    // the first person: the administrator (on the server computer)
    expect((await admin('/api/dir/setup', { name: 'Fouad', password: 'abc' })).status).toBe(400); // too short
    expect((await admin('/api/dir/setup', { name: 'Fouad', password: 'fouad-pass-1' })).status).toBe(200);
    expect((await admin('/api/dir/setup', { name: 'Other', password: 'other-pass-1' })).status).toBe(409);
    const h = (await admin('/api/hello')).body;
    expect(h.dir).toMatchObject({ on: true, enforced: false, person: { name: 'Fouad', admin: true } });
    expect(h.dbs.map((d: { slug: string }) => d.slug).sort()).toEqual(['aleppo', 'homs']);

    // add Salma: only Homs, as the Clerk of Homs
    const homsClerk = (await admin('/api/dir/people')).body.dbs.find((d: { slug: string }) => d.slug === 'homs').profiles.find((p: { name: string }) => p.name === 'Clerk').id;
    const saved = await admin('/api/dir/save', { name: 'Salma', admin: false, active: true, password: 'salma-temp-1', grants: { homs: homsClerk } });
    expect(saved.status).toBe(200);
    expect((await admin('/api/dir/save', { name: 'salma', password: 'x12345' })).status).toBe(409); // the name exists

    // Salma, from her own browser
    const salma = browser();
    expect((await salma('/api/dir/login', { name: 'Salma', password: 'wrong-one' })).status).toBe(403);
    expect((await salma('/api/dir/login', { name: 'salma', password: 'salma-temp-1' })).status).toBe(200);
    expect((await salma('/api/dir/people')).status).toBe(403); // not an administrator
    // a password given by the administrator is replaced first
    expect((await salma('/api/dir/enter', { db: 'homs' })).status).toBe(403);
    expect((await salma('/api/dir/password', { old: 'salma-temp-1', password: 'salma-own-1' })).status).toBe(200);
    expect((await salma('/api/hello')).body.dbs.map((d: { slug: string }) => d.slug)).toEqual(['homs']);
    expect((await salma('/api/dir/enter', { db: 'aleppo' })).status).toBe(403);
    const entered = await salma('/api/dir/enter', { db: 'homs' });
    expect(entered.status).toBe(200);
    expect(entered.body.profile.name).toBe('Clerk');
    expect((await salma('/api/me')).body.db).toBe('homs');

    // the administrator enters as the Superior of any database, without being linked
    const e2 = await admin('/api/dir/enter', { db: 'aleppo' });
    expect(e2.status).toBe(200);
    expect(e2.body.profile.name).toBe('Boss');

    // enforced: a browser that is not signed in sees nothing, and the old sign-in is refused
    // (the server computer keeps its way in, so nobody is ever locked out)
    expect((await admin('/api/dir/enforce', { enforced: true })).status).toBe(200);
    const stranger = browser();
    expect((await stranger('/api/hello')).body.dir.enforced).toBe(true);
    expect((await salma('/api/hello')).body.dbs).toHaveLength(1);

    // deactivated: out at once
    const p = (await admin('/api/dir/people')).body.people.find((x: { name: string }) => x.name === 'Salma');
    expect((await admin('/api/dir/save', { id: p.id, name: 'Salma', admin: false, active: false, grants: p.grants })).status).toBe(200);
    expect((await salma('/api/dir/enter', { db: 'homs' })).status).toBe(401);
    expect((await salma('/api/dir/login', { name: 'Salma', password: 'salma-own-1' })).status).toBe(403);

    // the last administrator cannot be removed
    const f = (await admin('/api/dir/people')).body.people.find((x: { name: string }) => x.name === 'Fouad');
    expect((await admin('/api/dir/save', { id: f.id, name: 'Fouad', admin: false, active: true, grants: {} })).status).toBe(409);

    // forgot the password: on the server computer, with a Superior's password
    expect((await admin('/api/dir/reset', { name: 'Fouad', password: 'fouad-new-1', superior: 'nope' })).status).toBe(403);
    expect((await admin('/api/dir/reset', { name: 'Fouad', password: 'fouad-new-1', superior: 'boss-Homs-1' })).status).toBe(200);
    const again = browser();
    expect((await again('/api/dir/login', { name: 'Fouad', password: 'fouad-new-1' })).body.person.mustChange).toBe(true);

    // the file is kept on disk, with hashes only
    const file = fs.readFileSync(path.join(dir, 'directory.json'), 'utf8');
    expect(file).not.toContain('fouad-new-1');
    expect(file).not.toContain('salma-own-1');
  });
});
