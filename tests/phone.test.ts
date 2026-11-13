// The phone (Fouad, 2026-11-13): expenses and income recorded away from the centre, sent when the phone is back on the
// centre's network. The server checks every row as it does on the computer; a phone holds a key, never a password.
import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer, type Running } from '../server/server';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const servers: Running[] = [];
const dirs: string[] = [];
afterAll(async () => { for (const s of servers) await s.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function centre() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-phone-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  const srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.httpPort}`;
  const browser = () => {
    const jar = new Map<string, string>();
    return async (url: string, body?: unknown) => {
      const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      return { status: r.status, body: await r.json().catch(() => null) };
    };
  };
  /** a phone speaks with its key only: no cookie */
  const phone = (key: string) => async (url: string, body: unknown = {}) => {
    const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const boss = browser();
  const slug = (await boss('/api/dbs/create', { organisation: 'Homs', centre: 'homs' })).body.slug as string;
  await boss('/api/setup/new', { db: slug, organisation: 'Homs', supName: 'Boss', supPin: 'boss-phone-1', comName: 'Clerk', comPin: 'clerk-phone-1' });
  const people = (await boss(`/api/profiles?db=${slug}`)).body as { id: number; name: string }[];
  await boss('/api/login', { db: slug, profileId: people.find((p) => p.name === 'Boss')!.id, password: 'boss-phone-1' });
  await boss('/api/op/list.add', { table: 'city', name: 'Homs' });
  await boss('/api/op/heading.add', { name: 'Activities', types: ['Exp'] });
  await boss('/api/op/heading.add', { name: 'Gifts', types: ['Income'] });
  let L = (await boss('/api/op/data', {})).body.lists;
  const head = (n: string) => L.headings.find((h: { name: string }) => h.name === n).id as number;
  await boss('/api/op/line.add', { headingId: head('Activities'), name: 'Outing' });
  await boss('/api/op/line.add', { headingId: head('Gifts'), name: 'Friends' });
  L = (await boss('/api/op/data', {})).body.lists;
  const line = (n: string) => L.lines.find((l: { name: string }) => l.name === n) as { id: number; heading_id: number };
  return { boss, browser, phone, slug, dir, people, L, line, base };
}

describe('the phone', () => {
  it('is linked once by its owner, takes what it needs, sends rows that pass the usual checks, never twice', async () => {
    const c = await centre();
    // nobody signed in: no phone
    expect((await c.browser()('/api/phone/pair', { name: 'x' })).status).toBe(401);
    const made = await c.boss('/api/phone/pair', { name: "Boss's iPhone" });
    expect(made.status).toBe(200);
    const key = made.body.key as string;
    expect(key.startsWith(`${c.slug}:`)).toBe(true);
    const ph = c.phone(key);

    // what the phone keeps: the books with their balance, the headings by kind, the lines
    const pack = (await ph('/api/phone/pack')).body;
    expect(pack).toMatchObject({ user: 'Boss', organisation: 'Homs', phone: { name: "Boss's iPhone" } });
    expect(pack.books.length).toBeGreaterThan(0);
    const book = pack.books[0] as { id: number; usd: number; syp: number };
    expect(pack.headings.find((h: { name: string }) => h.name === 'Activities').types).toEqual(['Exp']);
    expect(pack.headings.find((h: { name: string }) => h.name === 'Gifts').types).toEqual(['Income']);
    expect(pack.headings.some((h: { name: string }) => h.name.toLowerCase() === 'transfer')).toBe(false);
    expect(pack.lines.map((l: { name: string }) => l.name)).toEqual(expect.arrayContaining(['Outing', 'Friends']));
    expect(Date.parse(pack.validUntil) - Date.parse(pack.asOf)).toBe(30 * 86_400_000);

    // three rows written offline: a gift, an expense, and an expense with no explanation
    const out = c.line('Outing'), gift = c.line('Friends');
    const rows = [
      { id: 'phone-row-0001', book_id: book.id, date: '2026-11-10', type: 'Income', heading_id: gift.heading_id, line_id: gift.id, explanation: 'A friend of the centre', amount: 100, currency: 'USD' },
      { id: 'phone-row-0002', book_id: book.id, date: '2026-11-11', type: 'Exp', heading_id: out.heading_id, line_id: out.id, explanation: 'Bus for the outing', amount: 25, currency: 'USD' },
      { id: 'phone-row-0003', book_id: book.id, date: '2026-11-11', type: 'Exp', heading_id: out.heading_id, line_id: out.id, explanation: '', amount: 5, currency: 'USD' },
      { id: 'phone-row-0004', book_id: book.id, date: '2026-11-11', type: 'Transfer', heading_id: out.heading_id, line_id: out.id, explanation: 'no', amount: 5, currency: 'USD' },
      { id: 'phone-row-0005', book_id: book.id, date: '2026-11-12', type: 'Exp', heading_id: out.heading_id, line_id: gift.id, explanation: 'wrong line', amount: 5, currency: 'SYP' },
    ];
    const sent = (await ph('/api/phone/push', { rows })).body;
    expect(sent.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, false, false, false]);
    expect(sent.results[2].error.en).toMatch(/Explanation/);
    expect(sent.results[3].error.en).toMatch(/expense or an income only/);
    // the balance comes back with the answer: +100 −25
    expect(sent.pack.books[0].usd).toBe(book.usd + 75);
    // on the computer: the two rows, in the owner's name
    const seen = (await c.boss('/api/op/data', {})).body.rows as { id: string; exp_usd: number; inc_usd: number; created_by: string }[];
    expect(seen.filter((r) => r.id.startsWith('phone-row-')).map((r) => [r.id, r.inc_usd, r.exp_usd])).toEqual([['phone-row-0001', 100, 0], ['phone-row-0002', 0, 25]]);

    // the connection dropped before the phone heard the answer: it sends again, nothing is written twice
    const again = (await ph('/api/phone/push', { rows: rows.slice(0, 2) })).body;
    expect(again.results).toEqual([{ id: 'phone-row-0001', ok: true, already: true }, { id: 'phone-row-0002', ok: true, already: true }]);
    expect(again.pack.books[0].usd).toBe(book.usd + 75);
    // a row already here is never changed from a phone
    await ph('/api/phone/push', { rows: [{ ...rows[1], amount: 999 }] });
    expect(((await c.boss('/api/op/data', {})).body.rows as { id: string; exp_usd: number }[]).find((r) => r.id === 'phone-row-0002')!.exp_usd).toBe(25);

    // the photo of the receipt: once
    expect((await ph('/api/phone/photo', { trxId: 'phone-row-0002', key: 'photo-key-0001', base64: PNG, mime: 'image/png' })).body).toEqual({ ok: true });
    expect((await ph('/api/phone/photo', { trxId: 'phone-row-0002', key: 'photo-key-0001', base64: PNG, mime: 'image/png' })).body).toEqual({ ok: true, already: true });
    expect(((await c.boss('/api/op/data', {})).body.attachments as { trx_id: string }[]).filter((a) => a.trx_id === 'phone-row-0002')).toHaveLength(1);
    // a photo for a row that is not here is refused
    expect((await ph('/api/phone/photo', { trxId: 'phone-row-0003', key: 'photo-key-0002', base64: PNG, mime: 'image/png' })).status).toBe(400);
  });

  it('a wrong key, a phone cut off, 30 days without a sync, an owner switched off: the phone is out', async () => {
    const c = await centre();
    const key = (await c.boss('/api/phone/pair', { name: 'Phone A' })).body.key as string;
    const [slug, id, secret] = key.split(':');
    expect((await c.phone(key)('/api/phone/pack')).status).toBe(200);
    expect((await c.phone(`${slug}:${id}:${secret.slice(0, -2)}xx`)('/api/phone/pack')).status).toBe(401);
    expect((await c.phone(`nowhere:${id}:${secret}`)('/api/phone/pack')).status).toBe(401);
    expect((await c.phone('')('/api/phone/pack')).status).toBe(401);

    // 30 days: the last sync was 31 days ago
    const file = path.join(c.dir, 'dbs', slug, 'magis.db');
    const setSync = (iso: string) => { const db = new DatabaseSync(file); db.prepare('UPDATE phone SET last_sync = ? WHERE id = ?').run(iso, id); db.close(); };
    setSync(new Date(Date.now() - 31 * 86_400_000).toISOString());
    const old = await c.phone(key)('/api/phone/pack');
    expect([old.status, old.body.error.en]).toEqual([401, 'More than 30 days since the last sync: sign in again at the centre']);
    setSync(new Date(Date.now() - 29 * 86_400_000).toISOString());
    expect((await c.phone(key)('/api/phone/pack')).status).toBe(200);

    // the Superior sees the phones and cuts one off
    const list = (await c.boss('/api/op/phone.list', {})).body as { id: string; user: string; name: string; revoked_at: string | null }[];
    expect(list).toMatchObject([{ id, user: 'Boss', name: 'Phone A', revoked_at: null }]);
    expect((await c.boss('/api/op/phone.revoke', { id })).status).toBe(200);
    const cut = await c.phone(key)('/api/phone/push', { rows: [] });
    expect([cut.status, cut.body.error.en]).toEqual([401, 'This phone was cut off: see the office']);

    // somebody else's phone is not theirs to see or cut; the Clerk cannot link a phone without a book
    const clerk = c.browser();
    await clerk('/api/login', { db: slug, profileId: c.people.find((p) => p.name === 'Clerk')!.id, password: 'clerk-phone-1' });
    const key2 = (await c.boss('/api/phone/pair', { name: 'Phone B' })).body.key as string;
    const mine = (await clerk('/api/op/phone.list', {})).body as unknown[];
    expect(mine).toEqual([]);
    expect((await clerk('/api/op/phone.revoke', { id: key2.split(':')[1] })).status).toBe(400);
    expect((await c.phone(key2)('/api/phone/pack')).status).toBe(200);
  });
});
