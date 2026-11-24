// "Sign in as" / "Test as…" shows the TARGET's databases and doors (Fouad, 25 November 2026): while signed in as Assem, the server
// sends the databases Assem would see had they signed in themselves (never Fouad's list, never the HR door without a place in
// HR, never the Coordinator's space), and a person who signs in directly sees the same.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';
import type { AccessRow } from '../src/ops';

let srv: Running;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-signas-'));
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
type B = ReturnType<typeof browser>;
const slugs = async (b: B) => ((await b('/api/hello')).body.dbs as { slug: string }[]).map((d) => d.slug).sort();

describe('server: sign in as shows the target’s databases', () => {
  it('Fouad signed in from the first page, then as Assem, a Reception person, the Director, someone who is also in HR', async () => {
    const admin = browser();
    const homs = (await admin('/api/dbs/create', { organisation: 'Homs sa', centre: 'homs' })).body.slug as string;
    const aleppo = (await admin('/api/dbs/create', { organisation: 'Aleppo sa', centre: 'aleppo' })).body.slug as string;
    const hr = (await admin('/api/dbs/create', { organisation: 'HR sa', centre: 'other', kind: 'hr' })).body.slug as string;
    expect((await admin('/api/setup/new', { db: homs, organisation: 'Homs sa', supName: 'Fouad', supPin: 'fouad-sa-1', comName: 'Com', comPin: 'com-sa-12' })).status).toBe(200);
    expect((await admin('/api/setup/new', { db: aleppo, organisation: 'Aleppo sa', supName: 'Boss', supPin: 'boss-sa-12', comName: 'Clerk', comPin: 'clerk-sa-12' })).status).toBe(200);
    // HR: Fouad and Hana have a place there; nobody else
    expect((await admin('/api/setup/hr', { db: hr, organisation: 'HR sa', people: [{ name: 'Fouad', password: 'fouad-sa-1' }, { name: 'Hana', password: 'hana-sa-12' }], mustChange: false })).status).toBe(200);

    const fouad = browser();
    const r0 = await fouad('/api/signin', { centre: 'homs', name: 'Fouad', password: 'fouad-sa-1' });
    expect(r0.status).toBe(200);
    expect(r0.body.places).toEqual([homs, hr]);
    const access = (await fouad('/api/op/access.list', {})).body as AccessRow[];
    const roleId = (kind: string) => access.find((a) => a.kind === kind)!.id;
    const person = async (name: string, kind: string, pin: string) => expect((await fouad('/api/op/user.save', { name, roles: [roleId(kind)], books: [], pin })).status).toBe(200);
    await person('Assem', 'accountant', 'assem-sa-12');
    await person('Rima', 'reception', 'rima-sa-12');
    await person('Kamal', 'keeper', 'kamal-sa-12');
    await person('Dina', 'director', 'dina-sa-12');
    await person('Hana', 'accountant', 'hana-sa-12');
    const people = (await fouad(`/api/profiles?db=${homs}`)).body as { id: number; name: string }[];
    const idOf = (n: string) => people.find((p) => p.name === n)!.id;
    const asView = (n: string, mode: 'view' | 'act' = 'view') => fouad('/api/as', { profileId: idOf(n), mode });

    // Fouad himself: his house and HR (not Aleppo: that is another house)
    expect(await slugs(fouad)).toEqual([homs, hr].sort());
    expect((await fouad('/api/hello')).body.ring).toEqual([homs, hr]);

    // as Assem, Rima, Kamal, Dina: only their house, and no HR: they have no place in HR
    for (const n of ['Assem', 'Rima', 'Kamal', 'Dina']) {
      expect((await asView(n)).status).toBe(200);
      const h = (await fouad('/api/hello')).body;
      expect(h.dbs.map((d: { slug: string }) => d.slug), n).toEqual([homs]);
      expect(h.ring, n).toEqual([homs]);
      expect(h.dir.person, n).toBe(null);
      expect(h.current).toBe(homs);
      expect((await fouad('/api/signin/enter', { db: hr })).status, n).toBe(403); // no way into HR as them
      expect((await fouad('/api/me')).body.as, n).toMatchObject({ by: 'Fouad' });
    }
    // as Hana, who has a place in HR: HR is there, and she may go in (still seen "as" her, the way back stays)
    expect((await asView('Hana')).status).toBe(200);
    expect(await slugs(fouad)).toEqual([homs, hr].sort());
    const e = await fouad('/api/signin/enter', { db: hr });
    expect(e.status).toBe(200);
    expect(e.body.profile.name).toBe('Hana');
    expect((await fouad('/api/me')).body).toMatchObject({ db: hr, as: { by: 'Fouad', mode: 'view' }, profile: { name: 'Hana' } });
    // the way back: myself again, with my own list
    expect((await fouad('/api/as/back', {})).status).toBe(200);
    expect((await fouad('/api/me')).body).toMatchObject({ db: hr, as: null, profile: { name: 'Fouad' } });
    expect(await slugs(fouad)).toEqual([homs, hr].sort());

    // a person who signs in directly sees exactly what "sign in as" showed
    const assem = browser();
    expect((await assem('/api/signin', { centre: 'homs', name: 'Assem', password: 'assem-sa-12' })).body.places).toEqual([homs]);
    expect(await slugs(assem)).toEqual([homs]);
    const hana = browser();
    expect((await hana('/api/signin', { centre: 'homs', name: 'Hana', password: 'hana-sa-12' })).body.places).toEqual([homs, hr]);
    expect(await slugs(hana)).toEqual([homs, hr].sort());
  }, 60000);

  it('the Coordinator (directory administrator): the network space and every database stay his; as Assem none of it shows', async () => {
    const admin = browser();
    const homs = (await admin('/api/dbs/create', { organisation: 'Homs dir', centre: 'homs' })).body.slug as string;
    const aleppo = (await admin('/api/dbs/create', { organisation: 'Aleppo dir', centre: 'aleppo' })).body.slug as string;
    const hr = (await admin('/api/dbs/create', { organisation: 'HR dir', centre: 'other', kind: 'hr' })).body.slug as string;
    const jar = (await admin('/api/hello')).body.dbs.map((d: { slug: string }) => d.slug);
    expect(jar).toEqual(expect.arrayContaining([homs, aleppo, hr]));
    expect((await admin('/api/setup/new', { db: homs, organisation: 'Homs dir', supName: 'Boss', supPin: 'boss-dir-12', comName: 'Zed', comPin: 'zed-dir-123' })).status).toBe(200);
    expect((await admin('/api/setup/new', { db: aleppo, organisation: 'Aleppo dir', supName: 'Boss', supPin: 'boss-dir-12', comName: 'Clerk', comPin: 'clerk-dir-1' })).status).toBe(200);
    expect((await admin('/api/setup/hr', { db: hr, organisation: 'HR dir', people: [{ name: 'Boss', password: 'boss-dir-12' }], mustChange: false })).status).toBe(200);
    expect((await admin('/api/dir/setup', { name: 'Fouad', password: 'fouad-dir-1' })).status).toBe(200);
    const all = await slugs(admin); // every database of the server (the first test's too)
    expect(all).toEqual(expect.arrayContaining([aleppo, homs, hr]));

    // the Coordinator comes into Homs (as its Superior) and signs in as the Com of Homs
    expect((await admin('/api/dir/enter', { db: homs })).status).toBe(200);
    const com = ((await admin(`/api/profiles?db=${homs}`)).body as { id: number; name: string }[]).find((p) => p.name === 'Zed')!.id;
    expect((await admin('/api/as', { profileId: com, mode: 'view' })).status).toBe(200);
    const h = (await admin('/api/hello')).body;
    expect(h.dbs.map((d: { slug: string }) => d.slug)).toEqual([homs]); // not his list of every database
    expect(h.dir.person).toBe(null); // no Coordinator space, no "all databases" for them
    expect(h.ring).toEqual([homs]);
    expect((await admin('/api/dir/people')).status).toBe(403); // and nothing of the Coordinator's through the side door
    expect((await admin('/api/as/back', {})).status).toBe(200);
    expect(await slugs(admin)).toEqual(all);
    expect((await admin('/api/hello')).body.dir.person).toMatchObject({ name: 'Fouad', admin: true });

    // someone who has a directory account of their own: seen as them, it is exactly what the directory gave them
    const clerkAleppo = ((await admin(`/api/dir/people`)).body.dbs.find((d: { slug: string }) => d.slug === homs).profiles as { id: number; name: string }[]).find((p) => p.name === 'Zed')!.id;
    expect((await admin('/api/dir/save', { name: 'Zed', admin: false, active: true, password: 'zed-temp-123', grants: { [homs]: clerkAleppo } })).status).toBe(200);
    expect((await admin('/api/as', { profileId: com, mode: 'view' })).status).toBe(200);
    const g = (await admin('/api/hello')).body;
    expect(g.dir.person).toMatchObject({ name: 'Zed', admin: false, mustChange: false });
    expect(g.dbs.map((d: { slug: string }) => d.slug)).toEqual([homs]);
    expect((await admin('/api/dir/people')).status).toBe(403);
  }, 60000);
});
