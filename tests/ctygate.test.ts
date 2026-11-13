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

  it("the Jesuits' door (13 November 2026): a name and a password, then the offices he holds as hats, no other password", async () => {
    const slug = ((await call('/api/hello', undefined, (await call('/api/cty/unlock', { password: 'side-pass-2' })).cookie)).body.dbs as { slug: string; kind: string }[]).find((d) => d.kind === 'community')!.slug;
    // no communities' password needed: his own name and password are enough
    expect((await call('/api/signin', { centre: 'jesuits', name: 'Marc', password: 'wrong-pass' })).status).toBe(403);
    const r = await call('/api/signin', { centre: 'jesuits', name: ' marc ', password: 'test-pass-2' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ places: [slug], db: slug, profile: { name: 'Marc', office: null } });
    // an office never signs in through the door (it is a hat, inside)
    expect((await call('/api/signin', { centre: 'jesuits', name: 'Econome (Marc)', password: 'test-office-2' })).status).toBe(403);
    // the houses' door does not open a community
    expect((await call('/api/signin', { centre: 'homs', name: 'Marc', password: 'test-pass-2' })).status).toBe(403);

    // a password given by someone else: no hat before he chooses his own
    const me0 = (await call('/api/me', undefined, r.cookie)).body as { profile: { id: number } };
    expect((await call('/api/cty/hat', { profileId: me0.profile.id }, r.cookie)).status).toBe(403);
    expect((await call('/api/op/profile.setPin', { id: me0.profile.id, pin: 'marc-own-pass-1' }, r.cookie)).status).toBe(200);
    // his hats: Econome and Minister (Paul holds the Superior and the Administrator)
    const hats = (await call('/api/cty/hats', undefined, r.cookie)).body as { person: { name: string; id: number }; current: number; hats: { profileId: number; office: string }[] };
    expect(hats.person.name).toBe('Marc');
    expect(hats.current).toBe(hats.person.id);
    expect(hats.hats.map((h) => h.office)).toEqual(['econome', 'minister']);
    const eco = hats.hats[0].profileId;
    const on = await call('/api/cty/hat', { profileId: eco }, r.cookie);
    expect([on.status, on.body?.error?.en]).toEqual([200, undefined]);
    expect(on.body.profile.office).toBe('econome');
    expect(((await call('/api/me', undefined, r.cookie)).body as { profile: { id: number } }).profile.id).toBe(eco);
    // the hats stay his while he wears one; back to himself
    expect(((await call('/api/cty/hats', undefined, r.cookie)).body as { current: number }).current).toBe(eco);
    expect((await call('/api/cty/hat', { profileId: hats.person.id }, r.cookie)).status).toBe(200);
    // not someone else's office, nor someone else
    const ps = (await call(`/api/profiles?db=${slug}`, undefined, r.cookie)).body as { id: number; name: string; office: string | null }[];
    expect((await call('/api/cty/hat', { profileId: ps.find((p) => p.office === 'superior')!.id }, r.cookie)).status).toBe(403);
    expect((await call('/api/cty/hat', { profileId: ps.find((p) => p.name === 'Paul')!.id }, r.cookie)).status).toBe(403);
    // signed in with an office's own password (the old way): no hats
    const old = await call('/api/login', { db: slug, profileId: eco, password: 'test-office-2' }, r.cookie);
    expect(((await call('/api/cty/hats', undefined, old.cookie)).body as { person: unknown }).person).toBeNull();
    expect((await call('/api/cty/hat', { profileId: hats.person.id }, old.cookie)).status).toBe(403);
  });

  it('on the same server, the month goes straight to the country econome and his answers come back (the file stays)', async () => {
    const pass = (await call('/api/cty/unlock', { password: 'side-pass-2' })).cookie!;
    const marc = await call('/api/signin', { centre: 'jesuits', name: 'Marc', password: 'marc-own-pass-1' });
    expect(marc.status).toBe(200);
    // no country econome yet on this server: the file only
    expect((await call('/api/cty/country', undefined, marc.cookie)).body).toEqual({ country: null });
    const eco = ((await call('/api/cty/hats', undefined, marc.cookie)).body as { hats: { profileId: number; office: string }[] }).hats.find((h) => h.office === 'econome')!.profileId;
    expect((await call('/api/cty/hat', { profileId: eco }, marc.cookie)).status).toBe(200);
    expect((await call('/api/cty/send', { yms: ['2026-10'] }, marc.cookie)).status).toBe(400);

    // the country econome of Syria, on the same server
    const made = await call('/api/dbs/create', { organisation: 'Syria', centre: 'other', kind: 'country' }, pass);
    expect((await call('/api/setup/country', { db: made.body.slug, country: 'Syria', localCurrency: 'SYP', people: [{ name: 'Elias', password: 'elias-first-1' }] }, pass)).status).toBe(200);
    expect((await call('/api/cty/country', undefined, marc.cookie)).body).toEqual({ country: 'Syria' });

    // close the community's month, then send it straight
    expect((await call('/api/op/cty.community.close', { ym: '2026-10' }, marc.cookie)).status).toBe(200);
    const sent = await call('/api/cty/send', { yms: ['2026-10'] }, marc.cookie);
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ country: 'Syria', results: [{ community: 'Demo community', ym: '2026-10', status: 'new' }] });
    // twice: nothing changes
    expect((await call('/api/cty/send', { yms: ['2026-10'] }, marc.cookie)).body.results[0].status).toBe('same');

    // the country econome sees it, as if the file had come
    const elias = await call('/api/signin', { centre: 'jesuits', name: 'Elias', password: 'elias-first-1' });
    expect((await call('/api/op/profile.setPin', { id: elias.body.profile.id, pin: 'elias-own-pass-1' }, elias.cookie)).status).toBe(200);
    const data = (await call('/api/op/country.data', {}, elias.cookie)).body as { ctys: { name: string }[]; months: { ym: string }[] };
    expect(data.ctys.map((x) => x.name)).toEqual(['Demo community']);
    expect(data.months.map((x) => x.ym)).toEqual(['2026-10']);

    // the answers come back to the community
    const ans = await call('/api/cty/answers', {}, marc.cookie);
    expect(ans.status).toBe(200);
    expect(ans.body.country).toBe('Syria');
    // a Jesuit without the econome's hat may not
    expect((await call('/api/cty/hat', { profileId: (await call('/api/cty/hats', undefined, marc.cookie)).body.person.id }, marc.cookie)).status).toBe(200);
    expect((await call('/api/cty/send', { yms: ['2026-10'] }, marc.cookie)).status).toBe(400);
    expect((await call('/api/cty/answers', {}, marc.cookie)).status).toBe(403);
  });
});
