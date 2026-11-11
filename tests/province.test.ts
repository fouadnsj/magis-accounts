// The Province account (Fouad, 2026-11-07): the Coordinator's own book — money in, exchange USD → SYP, its months.
// Only the Coordinator (the directory's administrator) reaches it; it is never listed with the centres.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';
import { blankTrx } from '../src/db/repo';

let srv: Running;
let base: string;
let dir: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-prov-'));
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  base = `http://127.0.0.1:${srv.httpPort}`;
}, 60000);
afterAll(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function browser() {
  const jar = new Map<string, string>();
  return async (url: string, body?: unknown) => {
    const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

describe('the Province account', () => {
  it('money in, an exchange, the balance, the month; for the Coordinator only', async () => {
    const admin = browser();
    const made = await admin('/api/dbs/create', { organisation: 'Homs', centre: 'homs' });
    await admin('/api/setup/new', { db: made.body.slug, organisation: 'Homs', supName: 'Boss', supPin: 'boss-prov-1', comName: 'Clerk', comPin: 'clerk-prov-1' });
    const stranger = browser();
    expect((await stranger('/api/province')).status).toBe(403);
    expect((await admin('/api/dir/setup', { name: 'Fouad', password: 'fouad-pass-1' })).status).toBe(200);
    const p = (await admin('/api/province')).body;
    expect(p.balance).toEqual({ syp: 0, usd: 0 });
    const L = p.lists;
    const head = (n: string) => L.headings.find((h: { name: string }) => h.name === n);
    const line = (n: string) => L.lines.find((l: { heading_id: number }) => l.heading_id === head(n).id);
    const row = { ...blankTrx(), book_id: p.bookId, city_id: L.cities[0].id, date: '2026-11-02' };
    expect((await admin('/api/province/op/trx.save', { rows: [{ ...row, id: 'in-1', type: 'Income', heading_id: head('Income').id, line_id: line('Income').id, inc_usd: 10000, explanation: 'SEN-2027, first part' }] })).status).toBe(200);
    expect((await admin('/api/province/op/trx.save', { rows: [{ ...row, id: 'ex-1', type: 'Exchange', heading_id: head('Exchange').id, line_id: line('Exchange').id, trf_usd: 2000, trf_syp: 26_000_000 }] })).status).toBe(200);
    expect((await admin('/api/province')).body.balance).toEqual({ syp: 26_000_000, usd: 8000 });
    // only its rows and months: nothing else
    expect((await admin('/api/province/op/users.save', {})).status).toBe(400);
    expect((await admin('/api/province/op/month.close', { ym: '2026-11' })).status).toBe(200);
    expect((await admin('/api/province')).body.closed).toEqual(['2026-11']);
    expect((await admin('/api/province/op/trx.save', { rows: [{ ...row, id: 'in-2', type: 'Income', heading_id: head('Income').id, line_id: line('Income').id, inc_usd: 5, explanation: 'late' }] })).status).toBe(400);
    // never among the centres
    expect((await admin('/api/hello')).body.dbs.map((d: { slug: string }) => d.slug)).toEqual([made.body.slug]);
    expect((await admin('/api/dbs/manage')).body.dbs.map((d: { slug: string }) => d.slug)).toEqual([made.body.slug]);
    expect(fs.existsSync(path.join(dir, 'province', 'magis.db'))).toBe(true);
  });

  it("grants: a split between the centres' projects (a sum or a %), the money in linked to it", async () => {
    const admin = browser();
    expect((await admin('/api/dir/login', { name: 'Fouad', password: 'fouad-pass-1' })).status).toBe(200);
    const slug = (await admin('/api/hello')).body.dbs[0].slug;
    // a project made in Homs by the Coordinator
    const pr = await admin('/api/province/project', { centre: slug, name: 'SEN Library', start_date: '2027-01-01', end_date: '2028-12-31' });
    expect(pr.status).toBe(200);
    const projects = (await admin('/api/province/projects')).body;
    expect(projects[0].projects.find((x: { id: number }) => x.id === pr.body.id)).toMatchObject({ name: 'SEN Library', start_date: '2027-01-01' });
    const g = { id: 'sen-2027', donor: 'SEN', reference: 'SEN-2027', amount: 100000, currency: 'EUR', start_date: '2027-01-01', end_date: '2028-12-31', note: null,
      parts: [{ centre: slug, centre_name: null, project_id: pr.body.id, project_name: null, amount: null, pct: 60 }] };
    expect((await admin('/api/province/grant', { ...g, parts: [{ ...g.parts[0], pct: 120 }] })).status).toBe(400); // more than the grant
    expect((await admin('/api/province/grant', g)).status).toBe(200);
    let list = (await admin('/api/province/grants')).body;
    expect(list[0]).toMatchObject({ donor: 'SEN', received_usd: 0, parts: [{ centre_name: 'Homs', project_name: 'SEN Library', pct: 60 }] });
    // its money arrives on the Province's account
    const p = (await admin('/api/province')).body;
    const head = p.lists.headings.find((h: { name: string }) => h.name === 'Income');
    const line = p.lists.lines.find((l: { heading_id: number; name: string }) => l.heading_id === head.id && l.name === 'Grant');
    const row = { ...blankTrx(), id: 'sen-in', book_id: p.bookId, city_id: p.lists.cities[0].id, date: '2026-12-15', type: 'Income', heading_id: head.id, line_id: line.id, inc_usd: 50000, explanation: 'SEN-2027', grant_id: 'sen-2027' };
    expect((await admin('/api/province/op/trx.save', { rows: [row] })).status).toBe(200);
    list = (await admin('/api/province/grants')).body;
    expect(list[0].received_usd).toBe(50000);
    expect((await admin('/api/province/grant/delete', { id: 'sen-2027' })).status).toBe(400); // money arrived: it is closed, not deleted
    expect((await browser()('/api/province/grants')).status).toBe(403);
    // a grant in euros: the euros arrive and are changed into dollars; both are kept
    expect((await admin('/api/province/grant', { ...g, id: 'eur-1', reference: 'EUR-1', parts: [] })).status).toBe(200);
    const eurRow = { ...row, id: 'eur-in', inc_usd: 10800, grant_id: 'eur-1', explanation: 'EUR-1' };
    expect((await admin('/api/province/op/trx.save', { rows: [eurRow], eur: { 'eur-in': 10000 } })).status).toBe(200);
    list = (await admin('/api/province/grants')).body;
    expect(list.find((x: { id: string }) => x.id === 'eur-1')).toMatchObject({ received_eur: 10000, received_usd: 10800 });
    expect((await admin('/api/province')).body.eur).toEqual({ 'eur-in': 10000 });
    expect((await admin('/api/province/op/trx.delete', { ids: ['eur-in'], reason: 'test' })).status).toBe(200);
    expect((await admin('/api/province')).body.eur).toEqual({});
  });

  it('a send to a centre: waiting, "not received", corrected, accepted (an income in its grants book); the months wait for it', async () => {
    const admin = browser();
    expect((await admin('/api/dir/login', { name: 'Fouad', password: 'fouad-pass-1' })).status).toBe(200);
    const slug = (await admin('/api/hello')).body.dbs[0].slug;
    const project = (await admin('/api/province/projects')).body[0].projects.find((x: { name: string }) => x.name === 'SEN Library');
    // the centre's Superior, in the centre
    const homs = browser();
    const profiles = (await homs(`/api/profiles?db=${slug}`)).body;
    expect((await homs('/api/login', { db: slug, profileId: profiles.find((x: { name: string }) => x.name === 'Boss').id, password: 'boss-prov-1' })).status).toBe(200);
    await homs('/api/op/list.add', { table: 'city', name: 'Homs' });
    await homs('/api/op/heading.add', { name: 'Income', types: ['Income'] });
    const L0 = (await homs('/api/op/data', {})).body.lists;
    await homs('/api/op/line.add', { headingId: L0.headings.find((h: { name: string }) => h.name === 'Income').id, name: 'Donation' });
    // a send goes only to a project with its dates and a budget line: first, a budget whose line "Books" is given to it
    expect((await admin('/api/province/send', { date: '2026-12-20', centre: slug, project_id: project.id, grant_id: 'sen-2027', cur: 'USD', amount: 20000 })).status).toBe(400);
    await homs('/api/op/heading.add', { name: 'Library', types: ['Exp'] });
    const L1 = (await homs('/api/op/data', {})).body.lists;
    await homs('/api/op/line.add', { headingId: L1.headings.find((h: { name: string }) => h.name === 'Library').id, name: 'Books' });
    const books = (await homs('/api/op/data', {})).body.lists.lines.find((l: { name: string }) => l.name === 'Books');
    await homs('/api/op/budget.create', { start_ym: '2026-01', months: 24, rate_syp: 13000, rate_eur: 0.9, from: 'empty' });
    const v = (await homs('/api/op/budget.get', {})).body.current.id;
    await homs('/api/op/budget.saveAmounts', { versionId: v, cells: [{ line_id: books.id, amount_usd: 1000 }] });
    expect((await homs('/api/op/budget.setFund', { versionId: v, line_ids: [books.id], account_id: project.id })).status).toBe(200);

    const sent = await admin('/api/province/send', { date: '2026-12-20', centre: slug, project_id: project.id, grant_id: 'sen-2027', cur: 'USD', amount: 20000 });
    expect(sent.body).toMatchObject({ id: expect.any(String) });
    expect((await admin('/api/province')).body.balance.usd).toBe(8000 + 50000 - 20000);
    let mine = (await homs('/api/op/province.sends', {})).body;
    expect(mine[0]).toMatchObject({ id: sent.body.id, usd: 20000, status: 'waiting', donor: 'SEN', project_id: project.id });
    // both months wait for the answer
    expect((await homs('/api/op/closing.problems', { ym: '2026-12', bookId: null })).body.map((x: { en: string }) => x.en).join()).toMatch(/not yet accepted/);
    expect((await admin('/api/province/op/month.close', { ym: '2026-12' })).status).toBe(400);
    // "not received": the Province sees the centre's word; it corrects; the centre accepts
    expect((await homs('/api/province-answer', { id: sent.body.id, ok: false, note: 'received 19,800' })).status).toBe(200);
    let sends = (await admin('/api/province/sends')).body;
    expect(sends[0]).toMatchObject({ centre_name: 'Homs', project_name: 'SEN Library', dispute_note: 'received 19,800' });
    expect((await admin('/api/province/send', { id: sent.body.id, date: '2026-12-20', centre: slug, project_id: project.id, grant_id: 'sen-2027', cur: 'USD', amount: 19800 })).body).toEqual({ id: sent.body.id });
    mine = (await homs('/api/op/province.sends', {})).body;
    expect(mine[0]).toMatchObject({ usd: 19800, status: 'waiting', note: null });
    expect((await homs('/api/province-answer', { id: sent.body.id, ok: true })).body).toEqual({ status: 'accepted' });
    // (the grants book is private: the row is read in the centre's file)
    const { DatabaseSync } = (await import('node:module')).createRequire(import.meta.url)('node:sqlite');
    const file = new DatabaseSync(path.join(dir, 'dbs', slug, 'magis.db'), { readOnly: true });
    const income = file.prepare('SELECT t.type, t.inc_usd, t.account_id, b.private FROM trx t JOIN book b ON b.id = t.book_id WHERE t.id = ?').get(`province-${sent.body.id}`);
    file.close();
    expect(income).toMatchObject({ type: 'Income', inc_usd: 19800, account_id: project.id, private: 1 });
    sends = (await admin('/api/province/sends')).body;
    expect(sends[0].received_at).toBeTruthy();
    // accepted: it no longer changes, and the months can close
    expect((await homs('/api/province-answer', { id: sent.body.id, ok: false })).status).toBe(400);
    expect((await admin('/api/province/send/cancel', { id: sent.body.id })).status).toBe(400);
    expect((await admin('/api/province/op/month.close', { ym: '2026-12' })).status).toBe(200);
    // a send cancelled before the answer disappears from the centre
    const other = await admin('/api/province/send', { date: '2027-01-05', centre: slug, project_id: project.id, grant_id: 'sen-2027', cur: 'SYP', amount: 1_000_000 });
    expect((await admin('/api/province/send/cancel', { id: other.body.id })).status).toBe(200);
    expect((await homs('/api/op/province.sends', {})).body.map((x: { id: string }) => x.id)).toEqual([sent.body.id]);
  });
});
