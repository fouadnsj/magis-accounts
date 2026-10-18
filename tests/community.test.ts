// The rules of a community database, tried through the same operations the
// screens and the server use (runOp checks the permissions).
import { describe, expect, it, beforeAll } from 'vitest';
import type { Db } from '../src/db/db';
import { one } from '../src/db/db';
import { loadProfile } from '../src/auth';
import { runOp, type OpCtx } from '../src/ops';
import { createCommunity } from '../src/community/setup';
import { CHART } from '../src/community/chart';
import { loadAccounts, loadBooks, loadEntries } from '../src/community/repo';
import { balance, monthSheet, quarterOf, rateFromExchanges, rollUp, yearOf, type CtyBook } from '../src/community/domain';
import type { CtyData, EntryInput } from '../src/community/ops';
import { nodeDb } from './nodeDb';

let db: Db;
const ctx: Record<string, OpCtx> = {};
let books: CtyBook[];
let code: (c: string) => number;
const bookOf = (name: string) => books.find((b) => b.name === name)!.id;
const files = {} as OpCtx['files'];
const run = (who: string, op: string, args?: unknown) => runOp(ctx[who], op, args);

beforeAll(async () => {
  db = nodeDb();
  // Demo people (invented names): Superior + econome in one person, as in Damascus
  await createCommunity(db, {
    community: 'Demo community', country: 'Syria', localCurrency: 'SYP',
    people: [
      { name: 'Paul', password: 'test-pass-1', roles: ['superior', 'econome'] },
      { name: 'Marc', password: 'test-pass-2', roles: ['minister'] },
      { name: 'Jean', password: 'test-pass-3', roles: ['jesuit'] },
    ],
  });
  for (const p of await db.query<{ id: number; name: string }>('SELECT id, name FROM profile')) {
    ctx[p.name] = { db, profile: (await loadProfile(db, p.id))!, who: p.name, install: 'office', files };
  }
  books = await loadBooks(db);
  const accounts = await loadAccounts(db);
  code = (c) => accounts.find((a) => a.code === c)!.id;
});

const spend = (over: Partial<EntryInput> = {}): EntryInput => ({ book_id: bookOf('Jean'), date: '2025-10-05', type: 'Exp', account_id: code('61101'), cur: 'LOC', amount: 25000, ...over });

describe('setup', () => {
  it('the chart: every line, with its corrections', async () => {
    const accounts = await loadAccounts(db);
    expect(accounts.length).toBe(CHART.length);
    expect(new Set(accounts.map((a) => a.code)).size).toBe(CHART.length);
    expect(accounts.find((a) => a.code === '61202')!.name_en).toMatch(/Studies/);
    expect(accounts.some((a) => a.code.startsWith('31'))).toBe(false);
    expect(accounts.find((a) => a.code === '61405')!.name_fr).toBe('Analyses médicales');
    for (const a of accounts) expect(a.name_en && a.name_fr && a.name_ar).toBeTruthy();
  });
  it('the books and who keeps them', () => {
    expect(books.map((b) => b.cty_kind).sort()).toEqual(['bank', 'cash', 'economat', 'house', 'personal', 'personal', 'personal']);
    expect(ctx.Marc.profile.books).toEqual(expect.arrayContaining([bookOf('Marc'), books.find((b) => b.cty_kind === 'house')!.id]));
    expect(ctx.Paul.profile.perms).toEqual(expect.arrayContaining(['users.manage', 'cty.write_all', 'cty.month_seen']));
    expect(ctx.Jean.profile.perms).toEqual(['book.own']);
  });
});

describe('entries', () => {
  it('a Jesuit writes in his own book', async () => {
    await run('Jean', 'cty.entry.save', { entry: spend() });
    expect((await loadEntries(db)).length).toBe(1);
  });
  it('but not in another one', async () => {
    await expect(run('Jean', 'cty.entry.save', { entry: spend({ book_id: bookOf('Marc') }) })).rejects.toThrow(/Not allowed/);
  });
  it('a house line is refused in a personal book', async () => {
    await expect(run('Jean', 'cty.entry.save', { entry: spend({ account_id: code('62070') }) })).rejects.toThrow(/house book/);
  });
  it('a heading with lines under it is refused: the detail is asked', async () => {
    await expect(run('Jean', 'cty.entry.save', { entry: spend({ account_id: code('61400') }) })).rejects.toThrow(/detailed line/);
  });
  it('a change asks a reason; a deletion too, and stays in the audit', async () => {
    const e = (await loadEntries(db))[0];
    await expect(run('Jean', 'cty.entry.save', { entry: { ...spend(), id: e.id, amount: 30000 } })).rejects.toThrow(/reason/);
    await run('Jean', 'cty.entry.save', { entry: { ...spend(), id: e.id, amount: 30000 }, reason: 'typo' });
    await expect(run('Jean', 'cty.entry.delete', { id: e.id, reason: '' })).rejects.toThrow(/reason/);
    await run('Jean', 'cty.entry.delete', { id: e.id, reason: 'entered twice' });
    const audit = await one<{ before: string }>(db, "SELECT before FROM audit_log WHERE tbl = 'cty_entry' AND action = 'delete'");
    expect(JSON.parse(audit!.before).amount).toBe(30000);
  });
  it('the Jesuit sees only his book; the Superior sees all', async () => {
    await run('Marc', 'cty.entry.save', { entry: spend({ book_id: bookOf('Marc'), amount: 1000 }) });
    const jean = (await run('Jean', 'cty.data')) as CtyData;
    const paul = (await run('Paul', 'cty.data')) as CtyData;
    expect(jean.entries.some((e) => e.book_id === bookOf('Marc'))).toBe(false);
    expect(paul.entries.some((e) => e.book_id === bookOf('Marc'))).toBe(true);
  });
});

describe('money from the econome, exchange, end of the month', () => {
  const cash = () => books.find((b) => b.cty_kind === 'cash')!.id;
  it('the econome gives; only the receiver confirms', async () => {
    const id = (await run('Paul', 'cty.entry.save', { entry: { book_id: cash(), to_book_id: bookOf('Jean'), date: '2025-10-01', type: 'Transfer', cur: 'LOC', amount: 2000000 } })) as string;
    await expect(run('Paul', 'cty.transfer.answer', { id, ok: true })).rejects.toThrow(/receiver/);
    await expect(run('Jean', 'cty.transfer.answer', { id, ok: false })).rejects.toThrow(/note/);
    await run('Jean', 'cty.transfer.answer', { id, ok: true });
  });
  it('an exchange: dollars given, pounds received, and the rate comes from it', async () => {
    await run('Paul', 'cty.entry.save', { entry: { book_id: cash(), to_book_id: bookOf('Jean'), date: '2025-10-02', type: 'Transfer', cur: 'USD', amount: 100 } });
    const t = (await loadEntries(db)).find((e) => e.cur === 'USD')!;
    await run('Jean', 'cty.transfer.answer', { id: t.id, ok: true });
    await run('Jean', 'cty.entry.save', { entry: { book_id: bookOf('Jean'), date: '2025-10-03', type: 'Exchange', cur: 'USD', amount: 50, cur2: 'LOC', amount2: 650000 } });
    const entries = await loadEntries(db);
    expect(rateFromExchanges(entries, 'USD', 'LOC', '2025-10-31')).toBe(13000);
    expect(rateFromExchanges(entries, 'LOC', 'USD', '2025-10-31')).toBeCloseTo(1 / 13000);
    expect(rateFromExchanges(entries, 'USD', 'EUR', '2025-10-31')).toBeNull();
  });
  it('the month sheet adds up as the FDC', async () => {
    await run('Jean', 'cty.entry.save', { entry: spend({ date: '2025-10-10', account_id: code('61402'), amount: 250000, claim: 'health' }) });
    const s = monthSheet(await loadEntries(db), (await loadBooks(db)).find((b) => b.id === bookOf('Jean'))!, '2025-10');
    expect(s.received).toEqual({ LOC: 2000000, USD: 100, EUR: 0 });
    expect(s.inByExchange.LOC).toBe(650000);
    expect(s.outByExchange.USD).toBe(-50);
    expect(s.totalExpenses.LOC).toBe(-250000);
    expect(s.kept).toEqual({ LOC: 2400000, USD: 50, EUR: 0 });
    const up = rollUp(await loadAccounts(db), s.expenses);
    expect(up.get(code('61400'))!.LOC).toBe(-250000);
    expect(up.get(code('61000'))!.LOC).toBe(-250000);
  });
  it('closing: the count must match, or a note explains', async () => {
    const b = bookOf('Jean');
    await expect(run('Jean', 'cty.month.close', { bookId: b, ym: '2025-10', counted: { LOC: 2390000, USD: 50, EUR: 0 } })).rejects.toThrow(/note/);
    await run('Jean', 'cty.month.close', { bookId: b, ym: '2025-10', counted: { LOC: 2400000, USD: 50, EUR: 0 } });
    await expect(run('Jean', 'cty.entry.save', { entry: spend({ date: '2025-10-20' }) })).rejects.toThrow(/closed/);
    await expect(run('Jean', 'cty.month.reopen', { bookId: b, ym: '2025-10', reason: 'x' })).rejects.toThrow(/Not allowed/);
    await run('Paul', 'cty.month.seen', { bookId: b, ym: '2025-10' });
    expect((await one<{ seen_by: string }>(db, 'SELECT seen_by FROM cty_month WHERE book_id = ?', [b]))!.seen_by).toBe('Paul');
  });
  it('a month with money not yet confirmed cannot close', async () => {
    await run('Paul', 'cty.entry.save', { entry: { book_id: cash(), to_book_id: bookOf('Marc'), date: '2025-10-04', type: 'Transfer', cur: 'LOC', amount: 500000 } });
    await expect(run('Marc', 'cty.month.close', { bookId: bookOf('Marc'), ym: '2025-10', counted: { LOC: 499000, USD: 0, EUR: 0 } })).rejects.toThrow(/not yet confirmed/);
  });
  it('balances and the year', async () => {
    const b = (await loadBooks(db)).find((x) => x.id === bookOf('Jean'))!;
    expect(balance(await loadEntries(db), b, '2025-09-30')).toEqual({ LOC: 0, USD: 0, EUR: 0 });
    expect(yearOf('2025-10-01')).toBe(2025);
    expect(yearOf('2026-09-30')).toBe(2025);
    expect([quarterOf('2025-12-31'), quarterOf('2026-01-01'), quarterOf('2026-06-30'), quarterOf('2026-07-01')]).toEqual([1, 2, 3, 4]);
  });
});

describe('the chart can change later (Province econome)', () => {
  it('a code changes: past entries follow', async () => {
    const before = (await loadEntries(db)).filter((e) => e.account_id === code('61402')).length;
    const a = (await loadAccounts(db)).find((x) => x.code === '61402')!;
    await expect(run('Jean', 'cty.account.save', { account: { ...a, code: '61406' }, reason: 'x' })).rejects.toThrow(/Not allowed/);
    await run('Paul', 'cty.account.save', { account: { ...a, code: '61406' }, reason: 'new Province chart' });
    const now = (await loadAccounts(db)).find((x) => x.id === a.id)!;
    expect(now.code).toBe('61406');
    expect((await loadEntries(db)).filter((e) => e.account_id === a.id).length).toBe(before);
  });
  it('a line is added under a heading', async () => {
    await expect(run('Paul', 'cty.account.save', { account: { code: '61303', parent_id: code('61300'), name_en: 'x', name_fr: 'x', name_ar: 'x' } })).rejects.toThrow(/already used/);
    await run('Paul', 'cty.account.save', { account: { code: '61304', parent_id: code('61300'), name_en: 'Haircut', name_fr: 'Coiffeur', name_ar: 'حلاقة' } });
    const added = (await loadAccounts(db)).find((x) => x.code === '61304')!;
    expect([added.type, added.scope]).toEqual(['Exp', 'P']);
  });
});

describe('a MAGIS centre database is not a community', () => {
  it('community operations are refused there', async () => {
    const centre = nodeDb();
    const { migrate } = await import('../src/db/db');
    await migrate(centre);
    const c = { ...ctx.Paul, db: centre };
    await expect(runOp(c, 'cty.entry.save', { entry: spend() })).rejects.toThrow(/not a community/);
  });
});
