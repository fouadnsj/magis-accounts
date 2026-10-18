// From the communities to the country econome and back: the monthly file (totals only),
// claims decided, charges between communities, the account at the économat, the
// year-end reconciliation, and the return file.
import { describe, expect, it, beforeAll } from 'vitest';
import type { Db } from '../src/db/db';
import { loadProfile } from '../src/auth';
import { runOp, type OpCtx } from '../src/ops';
import { createCommunity } from '../src/community/setup';
import { createCountry, type CountryData } from '../src/community/country';
import { loadAccounts, loadBooks, loadEntries } from '../src/community/repo';
import type { MonthFile, ReturnFile } from '../src/community/files';
import { reconcile } from '../src/community/ledger';
import type { CtyData } from '../src/community/ops';
import { nodeDb } from './nodeDb';

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
  await createCommunity(homs, { community: 'Community A', country: 'Syria', localCurrency: 'SYP', people: [
    { name: 'SupA', password: 'test-pass-1', roles: ['superior'] }, { name: 'EcoA', password: 'test-pass-2', roles: ['econome', 'minister'] }, { name: 'JesA', password: 'test-pass-3', roles: [] },
  ] });
  await createCommunity(dam, { community: 'Community B', country: 'Syria', localCurrency: 'SYP', people: [
    { name: 'SupB', password: 'test-pass-1', roles: ['superior', 'econome'] }, { name: 'MinB', password: 'test-pass-2', roles: ['minister'] },
  ] });
  await createCountry(syria, { country: 'Syria', localCurrency: 'SYP', people: [{ name: 'Country eco', password: 'test-pass-9' }] });
  [H, D, S] = [await people(homs), await people(dam), await people(syria)];
});

const code = async (db: Db, c: string) => (await loadAccounts(db)).find((a) => a.code === c)!.id;
const bookOf = async (db: Db, kind: string, name?: string) => (await loadBooks(db)).find((b) => b.cty_kind === kind && (!name || b.name === name))!.id;

describe('a community: its month, consolidated, then its file', () => {
  it('cannot make the file before the community month is closed, nor close it while a member is open', async () => {
    const jes = await bookOf(homs, 'personal', 'JesA');
    await runOp(H.JesA, 'cty.entry.save', { entry: { book_id: jes, date: '2025-10-05', type: 'Exp', account_id: await code(homs, '61101'), cur: 'LOC', amount: 20000 } });
    await runOp(H.JesA, 'cty.entry.save', { entry: { book_id: jes, date: '2025-10-06', type: 'Exp', account_id: await code(homs, '61402'), cur: 'LOC', amount: 30000, claim: 'health', note: 'glasses' } });
    await runOp(H.EcoA, 'cty.entry.save', { entry: { book_id: await bookOf(homs, 'house'), date: '2025-10-07', type: 'Exp', account_id: await code(homs, '63100'), cur: 'LOC', amount: 40000 } });
    await expect(runOp(H.EcoA, 'cty.month.file', { ym: '2025-10' })).rejects.toThrow(/Close the community/);
    await expect(runOp(H.EcoA, 'cty.community.close', { ym: '2025-10' })).rejects.toThrow(/Not closed yet: .*JesA/);
    await expect(runOp(H.JesA, 'cty.community.close', { ym: '2025-10' })).rejects.toThrow(/Not allowed/);
  });
  it('once every book is closed, the file holds the totals by code, never a name', async () => {
    const entries = await loadEntries(homs);
    const { balance } = await import('../src/community/domain');
    for (const b of await loadBooks(homs)) {
      if (!entries.some((e) => e.book_id === b.id || e.to_book_id === b.id)) continue;
      const ctx = b.cty_kind === 'personal' && b.name === 'JesA' ? H.JesA : H.EcoA;
      await runOp(ctx, 'cty.month.close', { bookId: b.id, ym: '2025-10', counted: balance(entries, b, '2025-10-31') });
    }
    await runOp(H.EcoA, 'cty.community.close', { ym: '2025-10' });
    const f = (await runOp(H.EcoA, 'cty.month.file', { ym: '2025-10' })) as MonthFile;
    expect(f.totals['61101'].LOC).toBe(-20000);
    expect(f.totals['63100'].LOC).toBe(-40000);
    expect(f.cash.expenses.LOC).toBe(-90000);
    expect(f.claims.map((c) => [c.amount, c.reason, c.book_kind])).toEqual([[30000, 'health', 'personal']]);
    expect(JSON.stringify(f)).not.toContain('JesA');
  });
});

describe('the country econome', () => {
  let fileA: MonthFile;
  it('brings in the file; the same file twice changes nothing', async () => {
    fileA = (await runOp(H.EcoA, 'cty.month.file', { ym: '2025-10' })) as MonthFile;
    expect(await runOp(S['Country eco'], 'country.import', { file: fileA })).toMatchObject({ status: 'new', claims: 1, community: 'Community A' });
    const again = (await runOp(H.EcoA, 'cty.month.file', { ym: '2025-10' })) as MonthFile;
    expect(await runOp(S['Country eco'], 'country.import', { file: again })).toMatchObject({ status: 'same' });
    await expect(runOp(H.EcoA, 'country.import', { file: fileA })).rejects.toThrow(/Not allowed/);
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
    await runOp(D.SupB, 'cty.entry.save', { entry: { book_id: minB, date: '2025-10-03', type: 'Exp', account_id: await code(dam, '63200'), cur: 'LOC', amount: 5000 } });
    const { balance } = await import('../src/community/domain');
    const b = (await loadBooks(dam)).find((x) => x.id === minB)!;
    await runOp(D.MinB, 'cty.month.close', { bookId: minB, ym: '2025-10', counted: balance(await loadEntries(dam), b, '2025-10-31') });
    await runOp(D.SupB, 'cty.community.close', { ym: '2025-10' });
    await runOp(S['Country eco'], 'country.import', { file: await runOp(D.SupB, 'cty.month.file', { ym: '2025-10' }) });
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
    await expect(runOp(D.SupB, 'cty.return.import', { file: ret })).rejects.toThrow(/another community/);
    expect(await runOp(H.EcoA, 'cty.return.import', { file: ret })).toEqual({ decisions: 1, lines: 4 });
    const claim = (await loadEntries(homs)).find((e) => e.claim)!;
    expect([claim.claim_status, claim.claim_accepted, claim.claim_decision_note]).toEqual(['accepted', 20000, 'frames not covered']);
    const data = (await runOp(H.EcoA, 'cty.data', undefined)) as CtyData;
    expect(data.statement.map((l) => [l.kind, l.amount])).toEqual([['claim', 20000], ['charged', -90000], ['paid_by_cty', 50000], ['cotisation', -37]]);
    // the Jesuit does not see the community's account
    expect(((await runOp(H.JesA, 'cty.data', undefined)) as CtyData).statement).toEqual([]);
  });
});
