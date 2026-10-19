// From the communities to the country econome and back: the monthly file (totals only),
// claims decided, charges between communities, the account at the économat, the
// year-end reconciliation, and the return file.
import { describe, expect, it, beforeAll } from 'vitest';
import type { Db } from '../src/db/db';
import { loadProfile } from '../src/auth';
import { runOp, type OpCtx } from '../src/ops';
import { createCountry, type CountryData } from '../src/community/country';
import { loadAccounts, loadBooks, loadEntries } from '../src/community/repo';
import type { MonthFile, ReturnFile } from '../src/community/files';
import { reconcile } from '../src/community/ledger';
import type { CtyData } from '../src/community/ops';
import { nodeDb } from './nodeDb';
import { makeCommunity } from './ctyHelpers';

const files = {} as OpCtx['files'];
async function people(db: Db) {
  const out: Record<string, OpCtx> = {};
  for (const p of await db.query<{ id: number; name: string }>('SELECT id, name FROM profile')) out[p.name] = { db, profile: (await loadProfile(db, p.id))!, who: p.name, install: 'office', files };
  return out;
}

let homs: Db, dam: Db, syria: Db;
let H: Record<string, OpCtx>, D: Record<string, OpCtx>, S: Record<string, OpCtx>;

beforeAll(async () => {
  homs = nodeDb(); dam = nodeDb(); syria = nodeDb();
  // invented names
  H = await makeCommunity(homs, 'Community A', ['SupA', 'EcoA', 'JesA'], { superior: 'SupA', econome: 'EcoA', minister: 'EcoA', admin: 'SupA' });
  D = await makeCommunity(dam, 'Community B', ['SupB', 'MinB'], { superior: 'SupB', econome: 'SupB', minister: 'MinB', admin: 'SupB' });
  await createCountry(syria, { country: 'Syria', localCurrency: 'SYP', people: [{ name: 'Country eco', password: 'test-pass-9' }] });
  S = await people(syria);
  // these tests close month by month
  await runOp(H.Econome, 'cty.settings.save', { closePeriod: 'month' });
  await runOp(D.Econome, 'cty.settings.save', { closePeriod: 'month' });
});

const code = async (db: Db, c: string) => (await loadAccounts(db)).find((a) => a.code === c)!.id;
const bookOf = async (db: Db, kind: string, name?: string) => (await loadBooks(db)).find((b) => b.cty_kind === kind && (!name || b.name === name))!.id;

describe('a community: its month, consolidated, then its file', () => {
  it('cannot make the file before the community month is closed, nor close it while a member is open', async () => {
    const jes = await bookOf(homs, 'personal', 'JesA');
    await runOp(H.JesA, 'cty.entry.save', { entry: { book_id: jes, date: '2025-10-05', type: 'Exp', account_id: await code(homs, '61101'), cur: 'LOC', amount: 20000 } });
    await runOp(H.JesA, 'cty.entry.save', { entry: { book_id: jes, date: '2025-10-06', type: 'Exp', account_id: await code(homs, '61402'), cur: 'LOC', amount: 30000, claim: 'health', note: 'glasses' } });
    await runOp(H.Minister, 'cty.entry.save', { entry: { book_id: await bookOf(homs, 'house'), date: '2025-10-07', type: 'Exp', account_id: await code(homs, '63100'), cur: 'LOC', amount: 40000 } });
    await expect(runOp(H.Econome, 'cty.month.file', { ym: '2025-10' })).rejects.toThrow(/Close the community/);
    await expect(runOp(H.Econome, 'cty.community.close', { ym: '2025-10' })).rejects.toThrow(/Not closed yet: .*JesA/);
    await expect(runOp(H.JesA, 'cty.community.close', { ym: '2025-10' })).rejects.toThrow(/Not allowed/);
  });
  it('once every book is closed, the file holds the totals by code; a claim carries the name of the Jesuit', async () => {
    const entries = await loadEntries(homs);
    const { balance } = await import('../src/community/domain');
    for (const b of await loadBooks(homs)) {
      if (!entries.some((e) => e.book_id === b.id || e.to_book_id === b.id)) continue;
      const ctx = b.cty_kind === 'personal' && b.name === 'JesA' ? H.JesA : b.cty_kind === 'house' || b.cty_kind === 'envelope' ? H.Minister : H.Econome;
      await runOp(ctx, 'cty.month.close', { bookId: b.id, ym: '2025-10', counted: balance(entries, b, '2025-10-31') });
    }
    await runOp(H.Econome, 'cty.community.close', { ym: '2025-10' });
    const f = (await runOp(H.Econome, 'cty.month.file', { ym: '2025-10' })) as MonthFile;
    expect(f.totals['61101'].LOC).toBe(-20000);
    expect(f.totals['63100'].LOC).toBe(-40000);
    expect(f.cash.expenses.LOC).toBe(-90000);
    expect(f.claims.map((c) => [c.amount, c.reason, c.book_kind, c.person])).toEqual([[30000, 'health', 'personal', 'JesA']]);
  });
});

describe('the country econome', () => {
  let fileA: MonthFile;
  it('brings in the file; the same file twice changes nothing', async () => {
    fileA = (await runOp(H.Econome, 'cty.month.file', { ym: '2025-10' })) as MonthFile;
    expect(await runOp(S['Country eco'], 'country.import', { file: fileA })).toMatchObject({ status: 'new', claims: 1, community: 'Community A' });
    const again = (await runOp(H.Econome, 'cty.month.file', { ym: '2025-10' })) as MonthFile;
    expect(await runOp(S['Country eco'], 'country.import', { file: again })).toMatchObject({ status: 'same' });
    await expect(runOp(H.Econome, 'country.import', { file: fileA })).rejects.toThrow(/Not allowed/);
  });
  it('a community of another country is refused', async () => {
    await expect(runOp(S['Country eco'], 'country.import', { file: { ...fileA, community: { ...fileA.community, uid: 'x', country: 'Lebanon' } } })).rejects.toThrow(/another country/);
  });
  it('decides on a claim: in part needs a reason', async () => {
    const d = (await runOp(S['Country eco'], 'country.data', undefined)) as CountryData;
    const cl = d.claims[0];
    await expect(runOp(S['Country eco'], 'country.claim.decide', { id: cl.id, status: 'accepted', accepted: 20000 })).rejects.toThrow(/why/);
    await runOp(S['Country eco'], 'country.claim.decide', { id: cl.id, status: 'accepted', accepted: 20000, note: 'frames not covered' });
  });
  it('records a charge between communities and a payment; the reconciliation adds up', async () => {
    // community B must exist: its first file
    const minB = await bookOf(dam, 'house');
    await runOp(D.Minister, 'cty.entry.save', { entry: { book_id: minB, date: '2025-10-03', type: 'Exp', account_id: await code(dam, '63200'), cur: 'LOC', amount: 5000 } });
    const { balance } = await import('../src/community/domain');
    const b = (await loadBooks(dam)).find((x) => x.id === minB)!;
    await runOp(D.Minister, 'cty.month.close', { bookId: minB, ym: '2025-10', counted: balance(await loadEntries(dam), b, '2025-10-31') });
    await runOp(D.Econome, 'cty.community.close', { ym: '2025-10' });
    await runOp(S['Country eco'], 'country.import', { file: await runOp(D.Econome, 'cty.month.file', { ym: '2025-10' }) });
    const d = (await runOp(S['Country eco'], 'country.data', undefined)) as CountryData;
    const A = d.ctys.find((c) => c.name === 'Community A')!.id;
    const B = d.ctys.find((c) => c.name === 'Community B')!.id;
    // B hosted a Jesuit of A for 3 nights
    await expect(runOp(S['Country eco'], 'country.charge.save', { charge: { date: '2025-11-02', host_id: B, charged_id: B, cur: 'LOC', amount: 90000, note: 'x' } })).rejects.toThrow(/two different/);
    await runOp(S['Country eco'], 'country.charge.save', { charge: { date: '2025-11-02', host_id: B, charged_id: A, cur: 'LOC', amount: 90000, note: 'Fr of A, 3 nights' } });
    await runOp(S['Country eco'], 'country.move.save', { move: { cty_id: A, date: '2025-12-01', kind: 'paid_by_cty', cur: 'LOC', amount: 50000, note: 'paid in cash at the économat' } });
    await runOp(S['Country eco'], 'country.move.save', { move: { cty_id: A, date: '2026-01-10', kind: 'cotisation', cur: 'USD', amount: 37, note: 'Rome 2025-2026' } });
    const d2 = (await runOp(S['Country eco'], 'country.data', undefined)) as CountryData;
    const r = reconcile(2025, d2.ctys, d2.claims, d2.charges, d2.moves);
    const rA = r.find((x) => x.ctyId === A)!;
    const rB = r.find((x) => x.ctyId === B)!;
    // A: claim +20,000, charged −90,000, paid +50,000 → −20,000 SYP (A must pay); cotisation −$37
    expect(rA.end).toEqual({ LOC: -20000, USD: -37, EUR: 0 });
    expect(rA.byKind.claim.LOC).toBe(20000);
    expect(rB.end.LOC).toBe(90000);
    // charges add up to zero across the communities
    expect((rA.byKind.charged?.LOC ?? 0) + (rB.byKind.host?.LOC ?? 0)).toBe(0);
  });
});

describe('the return file, back in the community', () => {
  it('brings the decisions and the account at the économat; not into another community', async () => {
    const d = (await runOp(S['Country eco'], 'country.data', undefined)) as CountryData;
    const A = d.ctys.find((c) => c.name === 'Community A')!.id;
    const ret = (await runOp(S['Country eco'], 'country.return.build', { ctyId: A })) as ReturnFile;
    await expect(runOp(D.Econome, 'cty.return.import', { file: ret })).rejects.toThrow(/another community/);
    expect(await runOp(H.Econome, 'cty.return.import', { file: ret })).toEqual({ decisions: 1, lines: 4 });
    const claim = (await loadEntries(homs)).find((e) => e.claim)!;
    expect([claim.claim_status, claim.claim_accepted, claim.claim_decision_note]).toEqual(['accepted', 20000, 'frames not covered']);
    const data = (await runOp(H.Econome, 'cty.data', undefined)) as CtyData;
    expect(data.statement.map((l) => [l.kind, l.amount])).toEqual([['claim', 20000], ['charged', -90000], ['paid_by_cty', 50000], ['cotisation', -37]]);
    // the Jesuit does not see the community's account
    expect(((await runOp(H.JesA, 'cty.data', undefined)) as CtyData).statement).toEqual([]);
  });
});

describe('a charge marked by the host community, approved by the country econome', () => {
  it('goes in the monthly file, waits, is approved, and comes back', async () => {
    // B hosted a Jesuit of A in November; B does not know A's identity yet: it writes the name
    await expect(runOp(D.Minister, 'cty.charge.save', { charge: { date: '2025-11-03', to_name: 'Community A', cur: 'LOC', amount: 60000, note: '2 nights' } })).rejects.toThrow(/Not allowed/);
    await runOp(D.Econome, 'cty.charge.save', { charge: { date: '2025-11-03', to_name: 'Community A', person: 'Fr of A', cur: 'LOC', amount: 60000, note: '2 nights' } });
    const minB = await bookOf(dam, 'house');
    const { balance } = await import('../src/community/domain');
    const b = (await loadBooks(dam)).find((x) => x.id === minB)!;
    await runOp(D.Minister, 'cty.month.close', { bookId: minB, ym: '2025-11', counted: balance(await loadEntries(dam), b, '2025-11-30') });
    await runOp(D.Econome, 'cty.community.close', { ym: '2025-11' });
    const f = (await runOp(D.Econome, 'cty.month.file', { ym: '2025-11' })) as MonthFile;
    expect(f.charges!.map((x) => [x.to_name, x.amount, x.person])).toEqual([['Community A', 60000, 'Fr of A']]);
    await runOp(S['Country eco'], 'country.import', { file: f });
    let d = (await runOp(S['Country eco'], 'country.data', undefined)) as CountryData;
    const p = d.proposals[0];
    expect(p.status).toBe('waiting');
    const A = d.ctys.find((c) => c.name === 'Community A')!.id;
    const B = d.ctys.find((c) => c.name === 'Community B')!.id;
    const before = reconcile(2025, d.ctys, d.claims, d.charges, d.moves).find((x) => x.ctyId === A)!.end.LOC;
    await expect(runOp(S['Country eco'], 'country.proposal.decide', { id: p.id, status: 'approved' })).rejects.toThrow(/Which community/);
    await runOp(S['Country eco'], 'country.proposal.decide', { id: p.id, status: 'approved', chargedId: A });
    d = (await runOp(S['Country eco'], 'country.data', undefined)) as CountryData;
    expect(reconcile(2025, d.ctys, d.claims, d.charges, d.moves).find((x) => x.ctyId === A)!.end.LOC).toBe(before - 60000);
    // back in B: the decision, and the list of communities to choose from next time
    const ret = (await runOp(S['Country eco'], 'country.return.build', { ctyId: B })) as ReturnFile;
    await runOp(D.Econome, 'cty.return.import', { file: ret });
    const data = (await runOp(D.Econome, 'cty.data', undefined)) as CtyData;
    expect(data.charges.map((x) => x.status)).toEqual(['approved']);
    expect(data.known.map((k) => k.name)).toEqual(['Community A']);
    await expect(runOp(D.Econome, 'cty.charge.delete', { id: data.charges[0].id, reason: 'x' })).rejects.toThrow(/decided/);
  });
});

describe('the chart of codes: changed by the country econome, received by the communities', () => {
  it('a changed code and a new line arrive with the return file; past entries follow', async () => {
    const d = (await runOp(S['Country eco'], 'country.data', undefined)) as CountryData;
    const med = d.accounts.find((a) => a.code === '61402')!;
    await runOp(S['Country eco'], 'country.account.save', { account: { ...med, code: '61406' }, reason: 'new Province chart' });
    const head = d.accounts.find((a) => a.code === '61300')!;
    await runOp(S['Country eco'], 'country.account.save', { account: { code: '61304', parent_id: head.id, name_en: 'Haircut', name_fr: 'Coiffeur', name_ar: 'حلاقة' } });
    const A = d.ctys.find((c) => c.name === 'Community A')!.id;
    const medInA = (await loadAccounts(homs)).find((a) => a.uid === med.uid)!;
    const used = (await loadEntries(homs)).filter((e) => e.account_id === medInA.id).length;
    await runOp(H.Econome, 'cty.return.import', { file: await runOp(S['Country eco'], 'country.return.build', { ctyId: A }) });
    const accs = await loadAccounts(homs);
    expect(accs.find((a) => a.id === medInA.id)!.code).toBe('61406');
    expect((await loadEntries(homs)).filter((e) => e.account_id === medInA.id).length).toBe(used);
    const hair = accs.find((a) => a.code === '61304')!;
    expect([hair.name_fr, hair.parent_id, hair.scope]).toEqual(['Coiffeur', accs.find((a) => a.code === '61300')!.id, 'P']);
  });
});

describe('money between the Province and a community: promised → on the way → received', () => {
  it('only what is received counts; the community sees the state; the dollars total converts', async () => {
    const d0 = (await runOp(S['Country eco'], 'country.data', undefined)) as CountryData;
    const A = d0.ctys.find((c) => c.name === 'Community A')!.id;
    const id = (await runOp(S['Country eco'], 'country.move.save', { move: { cty_id: A, date: '2026-01-10', kind: 'paid_to_cty', cur: 'USD', amount: 500, note: 'grant for the roof', status: 'promised' } })) as string;
    let d = (await runOp(S['Country eco'], 'country.data', undefined)) as CountryData;
    expect(d.moves.find((m) => m.id === id)!.status).toBe('promised');
    const year = 2025;
    const end = (data: CountryData) => reconcile(year, data.ctys, data.claims, data.charges, data.moves).find((r) => r.ctyId === A)!.end.USD;
    const before = end(d);
    await runOp(S['Country eco'], 'country.move.status', { id, status: 'received' });
    d = (await runOp(S['Country eco'], 'country.data', undefined)) as CountryData;
    expect(end(d)).toBe(before - 500); // received: now it counts (the community received money: it owes less)
    await expect(runOp(S['Country eco'], 'country.move.status', { id, status: 'later' })).rejects.toThrow();
    await runOp(S['Country eco'], 'country.rates.save', { startRate: 13000, eurUsd: 1.1 });
    expect(((await runOp(S['Country eco'], 'country.data', undefined)) as CountryData).rates).toEqual({ startRate: 13000, eurUsd: 1.1 });
    const { totalUsd } = await import('../src/community/domain');
    expect(totalUsd({ LOC: 13000, USD: 5, EUR: 10 }, { loc: 1 / 13000, eur: 1.1 })).toEqual({ usd: 17, missing: false });
    expect(totalUsd({ LOC: 13000, USD: 5, EUR: 10 }, { loc: 1 / 13000, eur: null })).toEqual({ usd: 6, missing: true });
  });
});

describe("both sides of the money with the Province: the community records its part, the country econome compares", () => {
  it('a movement on one side only, then on both; the file carries the community side', async () => {
    const { compareSides } = await import('../src/community/ledger');
    await expect(runOp(H.JesA, 'cty.province.save', { line: { date: '2026-02-01', kind: 'paid_to_cty', cur: 'USD', amount: 500, note: 'roof grant', status: 'received' } })).rejects.toThrow(/Not allowed/);
    await runOp(H.Econome, 'cty.province.save', { line: { date: '2026-02-03', kind: 'paid_to_cty', cur: 'USD', amount: 500, note: 'roof grant', status: 'received' } });
    const f = (await runOp(H.Econome, 'cty.month.file', { ym: '2025-10' })) as MonthFile;
    expect(f.province!.map((x) => [x.kind, x.amount, x.status])).toEqual([['paid_to_cty', 500, 'received']]);
    const side = (s: 'promised' | 'on_the_way' | 'received') => ({ id: 'x', date: '2026-01-10', kind: 'paid_to_cty' as const, cur: 'USD' as const, amount: 500, note: 'grant', status: s });
    const mine = f.province!.map((x) => ({ ...x }));
    // the Province recorded it as promised, the community as received: same movement, states differ
    let c = compareSides([side('promised')], mine);
    expect([c.matched.length, c.matched[0].sameStatus, c.onlyCountry.length, c.onlyCommunity.length]).toEqual([1, false, 0, 0]);
    // another amount: each side has one the other does not
    c = compareSides([{ ...side('received'), amount: 450 }], mine);
    expect([c.matched.length, c.onlyCountry.length, c.onlyCommunity.length]).toEqual([0, 1, 1]);
    const id = (await runOp(H.Econome, 'cty.data', undefined) as CtyData).province[0].id;
    await expect(runOp(H.Econome, 'cty.province.delete', { id, reason: '' })).rejects.toThrow(/reason/);
    await runOp(H.Econome, 'cty.province.delete', { id, reason: 'test' });
    expect(((await runOp(H.Econome, 'cty.data', undefined)) as CtyData).province).toEqual([]);
  });
});
