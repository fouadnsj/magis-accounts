// Roles step 2 (25 November 2026): the Respo book and the grants (donors, steps, coverage) belong to the Administrator alone.
// A Director sees the centre's own money, the PROJECT and the amounts, never the donor's name nor a Respo row. The server cuts
// what it sends: tested through the real server, as the Director and as the Accountant.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOp, type AccessRow, type OpCtx, type ProvinceSend } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { blankTrx } from '../src/db/repo';
import { startServer, type Running } from '../server/server';
import { nodeDb } from './nodeDb';
import type { Trx } from '../src/domain/types';
import type { DataPayload } from '../src/ops';

const DONOR = 'Secret Donor Foundation';
const REF = 'SDF-77';

describe('the server cuts the Respo book and the grants for everybody but the Administrator', () => {
  let srv: Running;
  let dir: string;
  let base: string;
  let slug: string;
  let fouad: string;
  let dina: string;
  let com: string;
  let respoId: number;
  let mainId: number;
  let docId: string;

  const call = async (url: string, body?: unknown, cookie?: string) => {
    const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  const must = async (r: Promise<{ status: number; body: unknown }>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x; };
  /** refused: the server answers an error that says "Not allowed" */
  const refused = (r: { status: number; body: unknown }, what: string) => { expect(r.status, what).toBeGreaterThanOrEqual(400); expect(JSON.stringify(r.body), what).toContain('Not allowed'); };
  const as = (ck: string) => (name: string, a: unknown = {}) => call(`/api/op/${name}`, a, ck);

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-respo-'));
    srv = await startServer({ dataDir: dir, webRoot: dir, config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
    base = `http://127.0.0.1:${srv.httpPort}`;
    slug = (await call('/api/dbs/create', { organisation: 'Respo centre', centre: 'homs' })).body.slug;
    expect((await call('/api/setup/new', { db: slug, organisation: 'Respo centre', supName: 'Fouad', supPin: 'sup-secret', comName: 'Com', comPin: 'com-secret' })).status).toBe(200);
    const people = async () => (await call(`/api/profiles?db=${slug}`)).body as { id: number; name: string }[];
    const login = async (name: string, password: string) => {
      const r = await call('/api/login', { db: slug, profileId: (await people()).find((p) => p.name === name)!.id, password });
      if (r.body.mustChange) await call('/api/op/profile.setPin', { id: r.body.profile.id, pin: password }, r.cookie!);
      return r.cookie!;
    };
    fouad = await login('Fouad', 'sup-secret');
    const F = as(fouad);
    const roles = (await F('access.list')).body as AccessRow[];
    await must(F('user.save', { name: 'Dina', roles: [roles.find((r) => r.kind === 'director')!.id], books: [], pin: 'dina-secret' }));
    dina = await login('Dina', 'dina-secret');
    com = await login('Com', 'com-secret');

    // the centre: a city, an income line "Donation", an expense line, the Respo book (private, kept by Fouad, with some opening money)
    await F('list.add', { table: 'city', name: 'Homs' });
    await F('heading.add', { name: 'Income', types: ['Income'] });
    await F('heading.add', { name: 'Staff', types: ['Exp'] });
    let L = (await F('data')).body.lists;
    await F('line.add', { headingId: L.headings.find((h: { name: string }) => h.name === 'Income').id, name: 'Donation' });
    await F('line.add', { headingId: L.headings.find((h: { name: string }) => h.name === 'Staff').id, name: 'Reception' });
    // (the Respo book exists in every database, private)
    L = (await F('data')).body.lists;
    respoId = L.books.find((b: { name: string }) => b.name === 'Respo').id;
    await must(F('book.save', { id: respoId, name: 'Respo', keeper_name: 'Fouad', opening_usd: 777 }));
    mainId = L.books.find((b: { is_main: number }) => b.is_main).id;
    const fid = (await F('users.list')).body.find((u: { name: string }) => u.name === 'Fouad').id;
    const own = await F('user.save', { id: fid, name: 'Fouad', roles: [roles.find((r) => r.kind === 'administrator')!.id], books: [respoId] });
    expect(JSON.stringify(own.body), 'own books').toContain('');
    expect(own.status, JSON.stringify(own.body)).toBe(200);

    // a grant, the project it pays, the dollars in hand (an income in the Respo book), and one transfer from the Respo to Main
    await must(F('grant.save', { donor: DONOR, amount: 5000, currency: 'USD', reference: REF, here: null, shares: [], fund_id: null, new_fund: 'Youth project', start_date: '2026-01-01', end_date: '2026-12-31' }));
    const gid = (await F('data')).body.grants[0].id as string;
    await must(F('grant.step', { id: gid, status: 'hand', date: '2026-05-02', hand_usd: 5000 }));
    L = (await F('data')).body.lists;
    const project = L.accounts.find((a: { name: string }) => a.name === 'Youth project').id;
    const line = L.lines.find((l: { name: string }) => l.name === 'Reception');
    // (the project has its dates and a line of the budget: its money may leave the Respo book)
    await must(F('budget.create', { start_ym: '2026-01', months: 12, rate_syp: 13000, rate_eur: 0.9, from: 'empty' }));
    const v = (await F('budget.get', {})).body.current.id;
    await must(F('budget.saveAmounts', { versionId: v, cells: [{ line_id: line.id, amount_usd: 1000 }] }));
    await must(F('budget.setFund', { versionId: v, line_ids: [line.id], account_id: project }));
    const base1 = { ...blankTrx(), date: '2026-05-10', city_id: L.cities[0].id, transfer_group: 'tg1', explanation: `For the youth: ${DONOR}`, grant_id: gid };
    const t = (id: string, book: number, usd: number): Trx => ({ ...base1, id, type: 'Transfer', book_id: book, trf_usd: usd });
    const exp: Trx = { ...blankTrx(), id: 'exp1', type: 'Exp', date: '2026-05-12', book_id: mainId, city_id: L.cities[0].id, account_id: project, heading_id: line.heading_id, line_id: line.id, exp_usd: 100, explanation: 'Rent' };
    await must(F('trx.save', { rows: [t('t-respo', respoId, -1000), exp] }));
    // a paper attached to the Respo transfer
    docId = ((await must(F('doc.add', { trxId: 't-respo', base64: Buffer.from('%PDF-1.4 respo').toString('base64'), mime: 'application/pdf' }))).body as { id: string }).id;
    // sanity: the Administrator sees everything
    const all = (await F('data')).body as DataPayload;
    expect(all.rows.some((r) => r.book_id === respoId && r.type === 'Income')).toBe(true);
    expect(all.lists.donors.map((x) => x.name)).toContain(DONOR);
    expect(all.grants).toHaveLength(1);
  }, 120000);

  afterAll(async () => {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const dataOf = async (ck: string) => (await as(ck)('data')).body as DataPayload;

  it('a Director never receives a donor name, a grant, a Respo row or the Respo book\'s opening money', async () => {
    const r = await as(dina)('data');
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('Secret Donor');
    expect(text).not.toContain(REF);
    const d = r.body as DataPayload;
    expect(d.lists.donors).toEqual([]);
    expect(d.grants).toEqual([]);
    expect(d.grantParts).toEqual([]);
    expect(d.grantShares).toEqual([]);
    // no row of the Respo book except its transfer (amount, no explanation, no grant)
    const respoRows = d.rows.filter((x) => x.book_id === respoId);
    expect(respoRows.map((x) => x.type)).toEqual(['Transfer']);
    expect(respoRows[0]).toMatchObject({ explanation: null, grant_id: null, private_book: true });
    expect(d.rows.every((x) => !x.grant_id)).toBe(true);
    expect(respoRows[0]).toMatchObject({ trf_usd: -1000 });
    expect(d.transfers.every((x) => x.explanation == null)).toBe(true);
    // the book's name stays (the transfer names it), its opening money does not
    expect(d.lists.books.find((b) => b.id === respoId)).toMatchObject({ name: 'Respo', opening_usd: 0 });
    expect(d.bookMonths.every((b) => b.book_id !== respoId)).toBe(true);
    // the project and the amounts stay
    expect(d.lists.accounts.map((a) => a.name)).toContain('Youth project');
    expect(d.rows.find((x) => x.id === 'exp1')).toMatchObject({ exp_usd: 100 });
  });

  it('the Accountant never receives them either', async () => {
    const text = JSON.stringify(await dataOf(com));
    expect(text).not.toContain('Secret Donor');
    expect(text).not.toContain(REF);
    expect((await as(com)('lists.export')).body.tables.book.find((b: { id: number }) => b.id === respoId)).toMatchObject({ opening_usd: 0 });
  });

  it('the audit trail of a Director has no line about a grant, the donors or a row of the Respo book', async () => {
    const aud = await as(fouad)('audit.list');
    expect(JSON.stringify(aud.body)).toContain('grant_card'); // (the Administrator reads it all)
    const r = await as(dina)('audit.list');
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('Secret Donor');
    expect(text).not.toContain('grant_card');
    expect(text).not.toContain(REF);
    expect((r.body as { tbl: string; after: string | null }[]).some((x) => x.tbl === 'trx' && /"book_id":(\d+)/.test(x.after ?? '') && x.after!.includes(`"book_id":${respoId},`))).toBe(false);
    // what is left has no link to a grant
    expect(text).not.toMatch(/"grant_id\\?":\\?"[^n]/);
  });

  it('a Director cannot ask for the grants, the donors, the Respo book or its documents', async () => {
    const D = as(dina);
    for (const [op, args] of [
      ['grant.save', { donor: 'X', amount: 5, currency: 'USD', here: null, shares: [], fund_id: null, new_fund: 'P' }],
      ['grant.readiness', {}],
      ['grant.step', { id: 'x', status: 'approved', date: '2026-05-01' }],
      ['grant.delete', { id: 'x' }],
      ['donor.save', { name: 'Y', default_project_id: null }],
      ['province.answer', { id: 'x', ok: true }],
      ['account.setDates', { id: 1, start_date: null, end_date: null }],
    ] as [string, unknown][]) refused(await D(op, args), op);
    // he cannot make the Respo book public to read it, nor change it
    refused(await D('book.setPrivate', { id: respoId, private: false }), 'setPrivate');
    refused(await D('book.save', { id: respoId, name: 'Respo 2' }), 'book.save');
    refused(await D('doc.get', { id: docId }), 'doc.get');
    expect((await as(fouad)('doc.get', { id: docId })).status).toBe(200);
    expect((await dataOf(dina)).attachments).toEqual([]);
    expect((await dataOf(fouad)).attachments).toHaveLength(1);
    // and the Respo book is still private, with its opening money
    const f = (await dataOf(fouad)).lists.books.find((b) => b.id === respoId)!;
    expect(f).toMatchObject({ name: 'Respo', private: 1, opening_usd: 777 });
  });

  it('a Director cannot write in the Respo book, and its grant link stays', async () => {
    const rows = (await dataOf(fouad)).rows;
    expect(rows.find((x) => x.id === 't-respo')!.grant_id).toBeTruthy();
    // (the Director has no right to write at all; the rule for anybody without the grants is tested on the operation itself below)
    refused(await as(dina)('trx.save', { rows: [{ ...rows.find((x) => x.id === 't-respo')!, grant_id: null }] }), 'trx.save');
    expect((await dataOf(fouad)).rows.find((x) => x.id === 't-respo')!.grant_id).toBeTruthy();
  });

  it('"All centres" without a directory needs the grants too, not only the users', async () => {
    expect((await call('/api/all-centres/allowed', undefined, dina)).body).toMatchObject({ allowed: false });
  });
});

describe('the Province sends: a Director sees the amount and the project, not the donor', () => {
  it('donor, reference and what was written are cut', async () => {
    const db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    const files = {} as OpCtx['files'];
    const ctx = async (name: string): Promise<OpCtx> => ({ db, profile: (await loadProfile(db, (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0].id))!, who: name, install: 'office', files });
    const sup = await ctx('Sup');
    const roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
    await runOp(sup, 'user.save', { name: 'Dina', roles: [roles.find((r) => r.kind === 'director')!.id], books: [], pin: 'dina-pass-1' });
    await db.batch([{ sql: "INSERT INTO province_send (id, date, usd, syp, project_id, donor, reference, explanation, sent_by, status) VALUES ('p1', '2026-05-01', 500, 0, NULL, ?, ?, ?, 'Province', 'waiting')", params: [DONOR, REF, `${DONOR} → Homs`] }]);
    const mine = (await runOp(await ctx('Dina'), 'province.sends', {})) as ProvinceSend[];
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ usd: 500, donor: null, reference: null, explanation: null });
    expect(JSON.stringify(mine)).not.toContain('Secret Donor');
    expect(((await runOp(sup, 'province.sends', {})) as ProvinceSend[])[0]).toMatchObject({ donor: DONOR, reference: REF });
  });
});
