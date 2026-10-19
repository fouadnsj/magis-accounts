// The password of the Jesuit communities' side (Fouad, 19 October 2026: "to keep the privacy"):
// the first community sets it; until it is given, the server neither names the communities nor
// lists their accounts nor lets anyone sign in to them. The centres are not touched.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';

let srv: Running;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-gate-'));
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  base = `http://127.0.0.1:${srv.httpPort}`;
}, 60000);
afterAll(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(url: string, body?: unknown, cookie?: string) {
  const r = await fetch(base + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

const setup = {
  community: 'Demo community', country: 'Syria', localCurrency: 'SYP',
  people: [{ name: 'Paul', password: 'test-pass-1' }, { name: 'Marc', password: 'test-pass-2' }],
  offices: { superior: { heldBy: 'Paul', password: 'test-office-1' }, econome: { heldBy: 'Marc', password: 'test-office-2' }, minister: { heldBy: 'Marc', password: 'test-office-3' }, admin: { heldBy: 'Paul', password: 'test-office-4' } },
};

describe("server: the communities' password", () => {
  it('the first community sets it; afterwards the communities are hidden until it is given', async () => {
    await call('/api/dbs/create', { organisation: 'A centre', centre: 'homs' });
    const c = await call('/api/dbs/create', { organisation: 'Demo community', centre: 'other', kind: 'community' });
    const slug = c.body.slug as string;
    // no password chosen: refused
    expect((await call('/api/setup/community', { db: slug, ...setup })).status).toBe(400);
    const made = await call('/api/setup/community', { db: slug, ...setup, gate: 'side-pass-1' });
    expect(made.status).toBe(200);
    expect(made.cookie).toMatch(/^magis_cty=/);

    // a new browser: only the centre is named; the community's accounts and sign-in are refused
    const h = (await call('/api/hello')).body;
    expect(h.ctyGate).toBe(true);
    expect(h.ctyOpen).toBe(false);
    expect(h.dbs.map((d: { kind: string }) => d.kind)).toEqual(['centre']);
    expect((await call(`/api/profiles?db=${slug}`)).status).toBe(403);
    expect((await call('/api/login', { db: slug, profileId: 1, password: 'test-office-1' })).status).toBe(403);
    expect((await call('/api/dbs/create', { organisation: 'Another', kind: 'community' })).status).toBe(403);

    // a wrong password, then the right one: the community appears
    expect((await call('/api/cty/unlock', { password: 'wrong-pass' })).status).toBe(403);
    const open = await call('/api/cty/unlock', { password: 'side-pass-1' });
    expect(open.status).toBe(200);
    const h2 = (await call('/api/hello', undefined, open.cookie)).body;
    expect(h2.ctyOpen).toBe(true);
    expect(h2.dbs.some((d: { slug: string }) => d.slug === slug)).toBe(true);
    expect((await call(`/api/profiles?db=${slug}`, undefined, open.cookie)).status).toBe(200);

    // the administrator of the community changes it
    const ps = (await call(`/api/profiles?db=${slug}`, undefined, open.cookie)).body as { id: number; office: string | null }[];
    const admin = ps.find((p) => p.office === 'admin')!;
    const login = await call('/api/login', { db: slug, profileId: admin.id, password: 'test-office-4' }, open.cookie);
    expect(login.status).toBe(200);
    const both = `${open.cookie}; ${login.cookie}`;
    expect((await call('/api/cty/gate', { password: 'side-pass-2' }, both)).status).toBe(200);
    expect((await call('/api/cty/unlock', { password: 'side-pass-1' })).status).toBe(403);
    expect((await call('/api/cty/unlock', { password: 'side-pass-2' })).status).toBe(200);
  });
});
