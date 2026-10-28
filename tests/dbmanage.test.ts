// Managing the databases (Fouad, 29 October 2026): a window to switch a database off or on, or delete it.
// Every change needs the password of that database's Superior; a deleted database is not erased: its whole
// folder (database, backups, documents) moves to "deleted" and can be put back.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';

let srv: Running;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-dbm-'));
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  base = `http://127.0.0.1:${srv.httpPort}`;
}, 60000);
afterAll(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(url: string, body?: unknown) {
  const r = await fetch(base + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

describe('server: managing the databases', () => {
  it('switch off / on, delete into a kept folder, restore; always with the Superior\'s password', async () => {
    const made = await call('/api/dbs/create', { organisation: 'Old Year', centre: 'homs' });
    const slug = made.body.slug as string;
    expect((await call('/api/setup/new', { db: slug, organisation: 'Old Year', supName: 'Fouad', supPin: 'sup-secret-1', comName: 'Assem', comPin: 'com-secret-1' })).status).toBe(200);
    await call('/api/dbs/create', { organisation: 'Keep Me', centre: 'homs' });

    const list = (await call('/api/dbs/manage')).body;
    expect(list.dbs.map((d: { slug: string; active: boolean }) => [d.slug, d.active])).toEqual([[slug, true], ['keep-me', true]]);

    // wrong password, or the Accountant's (he does not manage users): refused
    expect((await call('/api/dbs/state', { db: slug, active: false, password: 'nope' })).status).toBe(403);
    expect((await call('/api/dbs/state', { db: slug, active: false, password: 'com-secret-1' })).status).toBe(403);

    // switched off: not listed, nobody can sign in, but it is still on the disk and in the management list
    expect((await call('/api/dbs/state', { db: slug, active: false, password: 'sup-secret-1' })).status).toBe(200);
    expect((await call('/api/hello')).body.dbs.map((d: { slug: string }) => d.slug)).toEqual(['keep-me']);
    expect((await call(`/api/profiles?db=${slug}`)).status).toBe(404);
    expect((await call('/api/dbs/manage')).body.dbs.find((d: { slug: string }) => d.slug === slug).active).toBe(false);
    expect((await call('/api/dbs/state', { db: slug, active: true, password: 'sup-secret-1' })).status).toBe(200);
    expect((await call(`/api/profiles?db=${slug}`)).status).toBe(200);

    // delete: the name must be typed, the password given; the folder is kept
    expect((await call('/api/dbs/delete', { db: slug, name: 'wrong', password: 'sup-secret-1' })).status).toBe(400);
    expect((await call('/api/dbs/delete', { db: slug, name: 'Old Year', password: 'bad' })).status).toBe(403);
    const del = await call('/api/dbs/delete', { db: slug, name: 'Old Year', password: 'sup-secret-1' });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(dir, 'dbs', slug))).toBe(false);
    const kept = (await call('/api/dbs/manage')).body;
    expect(kept.dbs.map((d: { slug: string }) => d.slug)).toEqual(['keep-me']);
    expect(kept.deleted).toHaveLength(1);
    expect(kept.deleted[0].organisation).toBe('Old Year');
    expect(fs.existsSync(path.join(kept.folder, kept.deleted[0].folder, 'magis.db'))).toBe(true);
    expect(fs.readdirSync(path.join(kept.folder, kept.deleted[0].folder, 'backups')).some((f) => f.includes('before-delete'))).toBe(true);

    // restore: back in the list, with its people
    expect((await call('/api/dbs/restore', { folder: '../x' })).status).toBe(404);
    const back = await call('/api/dbs/restore', { folder: kept.deleted[0].folder });
    expect(back.status).toBe(200);
    expect(back.body.slug).toBe(slug);
    const people = (await call(`/api/profiles?db=${slug}`)).body as { name: string }[];
    expect(people.map((p) => p.name).sort()).toEqual(['Assem', 'Fouad']);
    expect((await call('/api/dbs/manage')).body.deleted).toHaveLength(0);
  });
});
