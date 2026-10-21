// The rules of a community database, tried through the same operations the
// screens and the server use (runOp checks the permissions).
import { describe, expect, it, beforeAll } from 'vitest';
import type { Db } from '../src/db/db';
import { one } from '../src/db/db';
import { loadProfile } from '../src/auth';
import { runOp, type OpCtx } from '../src/ops';
import { CHART } from '../src/community/chart';
import { loadAccounts, loadBooks, loadEntries } from '../src/community/repo';
import { balance, monthSheet, quarterOf, rateFromExchanges, rollUp, yearOf, type CtyBook } from '../src/community/domain';
import type { ApprovalItem, CtyData, EntryInput } from '../src/community/ops';
import type { PeoplePayload } from '../src/community/people';
import { nodeDb } from './nodeDb';
import { ctxMap, makeCommunity } from './ctyHelpers';

let db: Db;
const ctx: Record<string, OpCtx> = {};
let books: CtyBook[];
let code: (c: string) => number;
const bookOf = (name: string) => books.find((b) => b.name === name)!.id;
const run = (who: string, op: string, args?: unknown) => runOp(ctx[who], op, args);

beforeAll(async () => {
  db = nodeDb();
  // Demo people (invented names): Paul is Superior (and the administrator), Marc is econome and minister, Jean a Jesuit
  Object.assign(ctx, await makeCommunity(db, 'Demo community', ['Paul', 'Marc', 'Jean'], { superior: 'Paul', econome: 'Marc', minister: 'Marc', admin: 'Paul' }));
  books = await loadBooks(db);
  // these tests close month by month (a quarter is tried on its own below)
  await runOp(ctx.Econome, 'cty.settings.save', { closePeriod: 'month' });
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
    expect(books.map((b) => b.cty_kind).sort()).toEqual(['cash', 'economat', 'house', 'personal', 'personal', 'personal']); // no bank unless the community has one
    const kind = (id: number) => books.find((b) => b.id === id)!.cty_kind;
    expect(ctx.Marc.profile.books).toEqual([bookOf('Marc')]); // a Jesuit's account: his pocket only
    expect(ctx.Minister.profile.books.map(kind).sort()).toEqual(['house']);
    expect(ctx.Econome.profile.books.map(kind).sort()).toEqual(['cash', 'economat']);
    expect(ctx.Superior.profile.books).toEqual([]);
    expect(ctx.Admin.profile.books).toEqual([]);
    expect(ctx.Superior.profile.perms).toEqual(expect.arrayContaining(['cty.view_all', 'cty.month_seen']));
    expect(ctx.Superior.profile.perms).not.toContain('book.own');
    expect(ctx.Admin.profile.perms).toEqual(expect.arrayContaining(['users.manage', 'cty.passwords']));
    expect(ctx.Admin.profile.perms).not.toContain('cty.view_all');
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
    const paul = (await run('Superior', 'cty.data')) as CtyData;
    expect(jean.entries.some((e) => e.book_id === bookOf('Marc'))).toBe(false);
    expect(paul.entries.some((e) => e.book_id === bookOf('Marc'))).toBe(true);
  });
});

describe('money from the econome, exchange, end of the month', () => {
  const cash = () => books.find((b) => b.cty_kind === 'cash')!.id;
  it('the econome gives; only the receiver confirms', async () => {
    const id = (await run('Econome', 'cty.entry.save', { entry: { book_id: cash(), to_book_id: bookOf('Jean'), date: '2025-10-01', type: 'Transfer', cur: 'LOC', amount: 2000000 } })) as string;
    await expect(run('Econome', 'cty.transfer.answer', { id, ok: true })).rejects.toThrow(/receiver/);
    await expect(run('Jean', 'cty.transfer.answer', { id, ok: false })).rejects.toThrow(/note/);
    await run('Jean', 'cty.transfer.answer', { id, ok: true });
  });
  it('an exchange: dollars given, pounds received, and the rate comes from it', async () => {
    await run('Econome', 'cty.entry.save', { entry: { book_id: cash(), to_book_id: bookOf('Jean'), date: '2025-10-02', type: 'Transfer', cur: 'USD', amount: 100 } });
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
    await run('Superior', 'cty.month.seen', { bookId: b, ym: '2025-10' });
    expect((await one<{ seen_by: string }>(db, 'SELECT seen_by FROM cty_month WHERE book_id = ?', [b]))!.seen_by).toContain('Paul');
  });
  it('the history of the counts: a count saved by hand and the closing are both kept, with hour and who', async () => {
    const b = bookOf('Jean');
    // (the closing above is already in the history, automatically)
    await run('Jean', 'cty.count.save', { bookId: b, counted: { LOC: 100, USD: 0, EUR: 0 }, note: 'a quick check', detail: { LOC: { '100': 1 } } });
    await run('Jean', 'cty.count.save', { bookId: b, counted: { LOC: 200, USD: 0, EUR: 0 }, detail: { LOC: { '100': 2 } } });
    const h = (await run('Jean', 'cty.count.history', { bookId: b })) as { kind: string; who: string; at: string; counted_loc: number; held_loc: number | null; ym: string | null }[];
    expect(h.map((x) => x.kind)).toEqual(['count', 'count', 'close']); // newest first, nothing replaced
    expect(h[0]).toMatchObject({ who: 'Jean', counted_loc: 200 });
    expect(h[0].at).toMatch(/T\d\d:\d\d/);
    expect(h[2]).toMatchObject({ ym: '2025-10', counted_loc: 2400000 });
    // the econome and the Superior read it; another Jesuit does not
    expect(((await run('Econome', 'cty.count.history', { bookId: b })) as unknown[]).length).toBe(3);
    await expect(run('Marc', 'cty.count.history', { bookId: b })).rejects.toThrow(/Not allowed/);
    await expect(run('Marc', 'cty.count.save', { bookId: b, counted: { LOC: 1, USD: 0, EUR: 0 } })).rejects.toThrow(/Not allowed/);
  });
  it('a month with money not yet confirmed cannot close', async () => {
    await run('Econome', 'cty.entry.save', { entry: { book_id: cash(), to_book_id: bookOf('Marc'), date: '2025-10-04', type: 'Transfer', cur: 'LOC', amount: 500000 } });
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

describe('the chart of codes is kept by the country econome', () => {
  it('a community econome cannot change it', async () => {
    const a = (await loadAccounts(db)).find((x) => x.code === '61402')!;
    await expect(run('Econome', 'cty.account.save', { account: { ...a, code: '61406' }, reason: 'x' })).rejects.toThrow(/Not allowed/);
  });
});

describe('a MAGIS centre database is not a community', () => {
  it('community operations are refused there', async () => {
    const centre = nodeDb();
    const { migrate } = await import('../src/db/db');
    await migrate(centre);
    const c = { ...ctx.Econome, db: centre };
    await expect(runOp(c, 'cty.entry.save', { entry: spend() })).rejects.toThrow(/not a community/);
  });
});

describe("the Superior's approval above a limit, and his private notes", () => {
  const c2: Record<string, OpCtx> = {};
  let db2: Db;
  let bk: (kind: string, name?: string) => number;
  let food: number;
  const r2 = (who: string, op: string, args?: unknown) => runOp(c2[who], op, args);
  const exp = (bookId: number, amount: number, cur = 'LOC') => ({ entry: { book_id: bookId, date: '2025-11-05', type: 'Exp', account_id: food, cur, amount } });

  beforeAll(async () => {
    db2 = nodeDb();
    Object.assign(c2, await makeCommunity(db2, 'Demo 2', ['Sup', 'Eco', 'Min'], { superior: 'Sup', econome: 'Eco', minister: 'Min', admin: 'Sup' }));
    const bs = await loadBooks(db2);
    bk = (kind, name) => bs.find((b) => b.cty_kind === kind && (!name || b.name === name))!.id;
    food = (await loadAccounts(db2)).find((a) => a.code === '61101')!.id;
  });

  const cash = () => bk('cash');
  const waiting = async () => (await loadEntries(db2)).filter((e) => e.approval_needed && !e.approved_at).map((e) => [e.amount, e.cur]);

  it("Fouad's limits from the start: minister $500, each person $300, 130 SYP = $1", async () => {
    expect(((await r2('Minister', 'cty.data')) as CtyData).limits).toEqual({ house: 500, personal: 300, startRate: 130 });
  });
  it('before any exchange, the starting rate (130 SYP = $1) decides; euros never exchanged wait', async () => {
    await r2('Minister', 'cty.entry.save', exp(bk('house'), 64000)); // $492
    await r2('Minister', 'cty.entry.save', exp(bk('house'), 66000)); // $507.69: waits
    await r2('Minister', 'cty.entry.save', exp(bk('house'), 10, 'EUR'));
    expect(await waiting()).toEqual([[66000, 'LOC'], [10, 'EUR']]);
    const ids = (await loadEntries(db2)).filter((e) => e.approval_needed).map((e) => e.id);
    await r2('Superior', 'cty.entry.approve', { ids });
  });
  it('the limit in dollars applies to pounds and euros at the rate of the last exchange', async () => {
    // the econome changes $100 into 1,300,000 SYP: 13,000 SYP a dollar; then €100 into 1,500,000 SYP
    await r2('Econome', 'cty.entry.save', { entry: { book_id: cash(), date: '2025-11-01', type: 'Exchange', cur: 'USD', amount: 100, cur2: 'LOC', amount2: 1300000 } });
    await r2('Econome', 'cty.entry.save', { entry: { book_id: cash(), date: '2025-11-01', type: 'Exchange', cur: 'EUR', amount: 100, cur2: 'LOC', amount2: 1500000 } });
    await r2('Minister', 'cty.entry.save', exp(bk('house'), 7000000)); // $538: waits
    await r2('Minister', 'cty.entry.save', exp(bk('house'), 6000000)); // $461
    await r2('Minister', 'cty.entry.save', exp(bk('house'), 50, 'USD'));
    await r2('Minister', 'cty.entry.save', exp(bk('house'), 400, 'EUR')); // €400 = $461.54 through the pound
    await r2('Min', 'cty.entry.save', exp(bk('personal', 'Min'), 4000000)); // $307.69 > $300: waits
    expect(await waiting()).toEqual([[7000000, 'LOC'], [4000000, 'LOC']]);
    const eur = (await loadEntries(db2)).find((e) => e.cur === 'EUR' && e.amount === 400)!;
    expect(eur.approval_usd).toBe(461.54);
  });
  it("the Superior's list shows each waiting expense with its details and the Jesuit's note", async () => {
    const e = (await loadEntries(db2)).find((x) => x.amount === 7000000)!;
    await r2('Minister', 'cty.entry.save', { entry: { ...e, note: 'fuel for the generator, winter' }, reason: 'note' });
    await expect(r2('Econome', 'cty.approvals')).rejects.toThrow(/Not allowed/);
    const list = (await r2('Superior', 'cty.approvals')) as ApprovalItem[];
    expect(list.map((x) => [x.keeper ?? x.book, x.entry.amount, x.entry.approval_usd, x.limit, x.account?.code])).toEqual([
      ['House · البيت · Maison', 7000000, 538.46, 500, '61101'],
      ['Min', 4000000, 307.69, 300, '61101'],
    ]);
    expect(list[0].entry.note).toBe('fuel for the generator, winter');
  });
  it('only the Superior approves; the month cannot close before', async () => {
    const es = await loadEntries(db2);
    const big = es.find((x) => x.amount === 7000000)!.id;
    const house = (await loadBooks(db2)).find((b) => b.id === bk('house'))!;
    await expect(r2('Minister', 'cty.month.close', { bookId: house.id, ym: '2025-11', counted: balance(es, house, '2025-11-30') })).rejects.toThrow(/approval/);
    await expect(r2('Econome', 'cty.entry.approve', { ids: [big] })).rejects.toThrow(/Not allowed/);
    await r2('Superior', 'cty.entry.approve', { ids: [big] });
    expect((await loadEntries(db2)).find((e) => e.id === big)!.approved_by).toContain('Sup');
  });
  it('only the econome changes the limits, and the past stays as it was', async () => {
    await expect(r2('Minister', 'cty.limits.save', { limits: { house: 50, personal: 50 } })).rejects.toThrow(/Not allowed/);
    await expect(r2('Superior', 'cty.limits.save', { limits: { house: 50, personal: 50 } })).rejects.toThrow(/Not allowed/);
    await r2('Econome', 'cty.limits.save', { limits: { house: 50, personal: 50 } });
    expect(await waiting()).toEqual([[4000000, 'LOC']]);
    expect(((await r2('Econome', 'cty.data')) as CtyData).limits.startRate).toBe(130);
    await r2('Econome', 'cty.limits.save', { limits: { house: 500, personal: 300 } });
  });
  it('a changed amount needs the approval again; a changed note does not', async () => {
    const big = (await loadEntries(db2)).find((e) => e.amount === 7000000)!;
    await r2('Minister', 'cty.entry.save', { entry: { ...big, note: 'fuel, winter' }, reason: 'note' });
    expect((await loadEntries(db2)).find((e) => e.id === big.id)!.approved_at).not.toBeNull();
    await r2('Minister', 'cty.entry.save', { entry: { ...big, amount: 7100000 }, reason: 'real bill' });
    expect((await loadEntries(db2)).find((e) => e.id === big.id)!.approved_at).toBeNull();
  });
  it("the Superior's notes: the Jesuit and the Superior read them, the econome does not", async () => {
    const q = (await r2('Superior', 'cty.note.add', { bookId: bk('personal', 'Min'), ym: '2025-11', body: 'What was this large expense?' })) as string;
    await r2('Min', 'cty.note.add', { bookId: bk('personal', 'Min'), parentId: q, body: 'A doctor for my mother.' });
    await expect(r2('Econome', 'cty.note.add', { bookId: bk('personal', 'Min'), body: 'x' })).rejects.toThrow(/Not allowed/);
    const seen = async (who: string) => ((await r2(who, 'cty.data')) as CtyData).notes.map((n) => n.body);
    expect(await seen('Min')).toHaveLength(2);
    expect(await seen('Superior')).toHaveLength(2);
    expect(await seen('Econome')).toEqual([]);
    const audit = await db2.query<{ after: string }>("SELECT after FROM audit_log WHERE tbl = 'cty_note'");
    expect(audit.some((a) => a.after.includes('doctor'))).toBe(false);
  });
});

describe('what a book holds at the start', () => {
  it('its keeper sets it, with a reason; nobody else; a book with a closed month refuses', async () => {
    const cashId = books.find((b) => b.cty_kind === 'cash')!.id;
    await expect(run('Jean', 'cty.book.opening', { bookId: cashId, opening: { LOC: 5000000, USD: 400, EUR: 0 }, reason: 'start' })).rejects.toThrow(/Not allowed/);
    await expect(run('Superior', 'cty.book.opening', { bookId: cashId, opening: { LOC: 5000000, USD: 400, EUR: 0 }, reason: 'start' })).rejects.toThrow(/Not allowed/);
    await expect(run('Econome', 'cty.book.opening', { bookId: cashId, opening: { LOC: 5000000, USD: 400, EUR: 0 }, reason: '' })).rejects.toThrow(/reason/);
    await run('Econome', 'cty.book.opening', { bookId: cashId, opening: { LOC: 5000000, USD: 400, EUR: 0 }, reason: 'start of the program' });
    const cash = (await loadBooks(db)).find((b) => b.id === cashId)!;
    expect([cash.opening_syp, cash.opening_usd]).toEqual([5000000, 400]);
    await expect(run('Econome', 'cty.book.opening', { bookId: bookOf('Jean'), opening: { LOC: 1, USD: 0, EUR: 0 }, reason: 'x' })).rejects.toThrow(/Not allowed/); // not his book
    await expect(run('Jean', 'cty.book.opening', { bookId: bookOf('Jean'), opening: { LOC: 1, USD: 0, EUR: 0 }, reason: 'x' })).rejects.toThrow(/closed month/);
  });
});

describe('the econome works only in his books; the Superior only looks, approves, refuses', () => {
  it("the econome writes nothing in a Jesuit's book, nor in the house", async () => {
    await expect(run('Econome', 'cty.entry.save', { entry: spend({ book_id: bookOf('Jean'), date: '2025-11-02' }) })).rejects.toThrow(/Not allowed/);
    const house = books.find((b) => b.cty_kind === 'house')!.id;
    await expect(run('Econome', 'cty.entry.save', { entry: spend({ book_id: house, date: '2025-11-02', account_id: code('62070') }) })).rejects.toThrow(/Not allowed/);
    expect(((await run('Econome', 'cty.data')) as CtyData).entries.some((e) => e.book_id === bookOf('Jean'))).toBe(true); // but he sees them
  });
  it('the Superior changes nothing', async () => {
    await expect(run('Superior', 'cty.entry.save', { entry: spend({ book_id: bookOf('Jean'), date: '2025-11-02' }) })).rejects.toThrow(/Not allowed/);
    await expect(run('Superior', 'cty.month.close', { bookId: bookOf('Jean'), ym: '2025-11', counted: { LOC: 0, USD: 0, EUR: 0 } })).rejects.toThrow(/Not allowed/);
    await expect(run('Superior', 'cty.limits.save', { limits: { house: 1, personal: 1 } })).rejects.toThrow(/Not allowed/);
  });
  it('the Administrator sees no record at all', async () => {
    const a = (await run('Admin', 'cty.data')) as CtyData;
    expect(a.entries).toEqual([]);
    expect(a.notes).toEqual([]);
    await expect(run('Admin', 'cty.approvals')).rejects.toThrow(/Not allowed/);
    await expect(run('Admin', 'cty.entry.save', { entry: spend({ book_id: bookOf('Jean'), date: '2025-11-02' }) })).rejects.toThrow(/Not allowed/);
  });
  it('the Superior refuses an expense with a reason; the Jesuit corrects; it asks approval again', async () => {
    const big = spend({ date: '2025-11-03', amount: 9000000 }); // far above $300
    const id = (await run('Jean', 'cty.entry.save', { entry: big })) as string;
    expect((await loadEntries(db)).find((e) => e.id === id)!.approval_needed).toBe(1);
    await expect(run('Superior', 'cty.entry.refuse', { ids: [id], reason: '' })).rejects.toThrow(/reason/);
    await expect(run('Econome', 'cty.entry.refuse', { ids: [id], reason: 'no' })).rejects.toThrow(/Not allowed/);
    await run('Superior', 'cty.entry.refuse', { ids: [id], reason: 'Too much for one month' });
    let e = (await loadEntries(db)).find((x) => x.id === id)!;
    expect([e.refused_note, e.refused_by, e.approved_at]).toEqual(['Too much for one month', ctx.Superior.who, null]);
    // it stays recorded, but is no longer on the Superior's list (the Jesuit has it)
    expect(((await run('Superior', 'cty.approvals')) as ApprovalItem[]).some((x) => x.entry.id === id)).toBe(false);
    // a month with a refused expense cannot close
    await expect(run('Jean', 'cty.month.close', { bookId: bookOf('Jean'), ym: '2025-11', counted: { LOC: 0, USD: 0, EUR: 0 } })).rejects.toThrow();
    // the Jesuit corrects: the refusal is cleared and the approval is asked again
    await run('Jean', 'cty.entry.save', { entry: { ...big, id, amount: 8000000 }, reason: 'smaller' });
    e = (await loadEntries(db)).find((x) => x.id === id)!;
    expect([e.refused_at, e.approval_needed, e.approved_at]).toEqual([null, 1, null]);
    expect(((await run('Superior', 'cty.approvals')) as ApprovalItem[]).some((x) => x.entry.id === id)).toBe(true);
    await run('Jean', 'cty.entry.delete', { id, reason: 'test over' });
  });
});

describe('offices and persons (the Administrator)', () => {
  const people = async (who = 'Admin') => (await run(who, 'cty.people', undefined)) as PeoplePayload;
  it('an office is handed over: the books and the history stay, the password and the holder change', async () => {
    const before = await people();
    expect(before.offices.map((o) => [o.office, o.heldBy])).toEqual(expect.arrayContaining([['econome', 'Marc'], ['superior', 'Paul']]));
    await expect(run('Jean', 'cty.office.save', { office: 'econome', heldBy: 'Jean', password: 'new-pass-1' })).rejects.toThrow(/Not allowed/);
    await expect(run('Econome', 'cty.office.save', { office: 'econome', heldBy: 'Jean', password: 'new-pass-1' })).rejects.toThrow(/Not allowed/);
    await run('Admin', 'cty.office.save', { office: 'econome', heldBy: 'Jean', password: 'new-pass-1' });
    const eco = (await loadProfile(db, ctx.Econome.profile.id))!;
    expect(eco.held_by).toBe('Jean');
    expect(eco.name).toBe('Econome (Jean)');
    expect(eco.books).toEqual(ctx.Econome.profile.books); // the books follow the office
    const seen = (await runOp({ ...ctx.Econome, profile: eco }, 'cty.data', undefined)) as CtyData;
    expect(seen.entries.some((e) => e.book_id === bookOf('Marc'))).toBe(true); // the old records of others
    // Jean's own account is untouched
    expect((await loadProfile(db, ctx.Jean.profile.id))!.books).toEqual(ctx.Jean.profile.books);
    await run('Admin', 'cty.office.save', { office: 'econome', heldBy: 'Marc' });
  });
  it('password reset: the econome and the administrator may; the econome not for the administrator; a Jesuit not at all', async () => {
    const jean = ctx.Jean.profile.id;
    await expect(run('Jean', 'cty.password.reset', { profileId: ctx.Marc.profile.id, password: 'whatever-1' })).rejects.toThrow(/Not allowed/);
    await expect(run('Econome', 'cty.password.reset', { profileId: jean, password: '123' })).rejects.toThrow(/6 characters/);
    await run('Econome', 'cty.password.reset', { profileId: jean, password: 'jean-new-1' });
    await run('Econome', 'cty.password.reset', { profileId: ctx.Minister.profile.id, password: 'minister-new-1' });
    await expect(run('Econome', 'cty.password.reset', { profileId: ctx.Admin.profile.id, password: 'admin-new-1' })).rejects.toThrow(/Not allowed/);
    await run('Admin', 'cty.password.reset', { profileId: ctx.Econome.profile.id, password: 'econome-new-1' });
    const p = (await people()).persons.find((x) => x.id === jean)!;
    expect(p.mustChange).toBe(1);
  });
  it('a new Jesuit arrives (password to change at first sign-in), another leaves', async () => {
    await expect(run('Admin', 'cty.person.save', { name: 'Luc', password: '123' })).rejects.toThrow(/6 characters/);
    await expect(run('Econome', 'cty.person.save', { name: 'Luc', password: 'luc-pass-1' })).rejects.toThrow(/Not allowed/);
    await run('Admin', 'cty.person.save', { name: 'Luc', password: 'luc-pass-1', hasBank: true });
    const luc = (await people()).persons.find((p) => p.name === 'Luc')!;
    expect([luc.hasBank, luc.mustChange]).toEqual([true, 1]);
    expect((await loadProfile(db, luc.id))!.books.length).toBe(2);
    await run('Admin', 'cty.person.save', { id: luc.id, name: 'Luc', active: 0 });
    expect(await loadProfile(db, luc.id)).toBeNull();
  });
  it('the roles page: the administrator changes what an account type may do', async () => {
    const list = (await run('Admin', 'access.list')) as { id: number; name: string; perms: string[] }[];
    const sup = list.find((a) => a.name.includes('Superior'))!;
    expect(sup.perms).not.toContain('cty.limits');
    await run('Admin', 'access.save', { id: sup.id, name: sup.name, perms: [...sup.perms, 'cty.limits'] });
    expect((await loadProfile(db, ctx.Superior.profile.id))!.perms).toContain('cty.limits');
    await run('Admin', 'access.save', { id: sup.id, name: sup.name, perms: sup.perms });
    await expect(run('Econome', 'access.list')).rejects.toThrow(/Not allowed/);
  });
  it('the community can have a bank (or not); closing by quarter by default', async () => {
    let d = (await run('Econome', 'cty.data', undefined)) as CtyData;
    expect([d.settings.hasBank, d.settings.closePeriod]).toEqual([false, 'month']); // set to month for this file
    await run('Econome', 'cty.settings.save', { hasBank: true, closePeriod: 'month', notes: { LOC: [100, 500, 50], USD: [100, 20], EUR: [50] } });
    d = (await run('Econome', 'cty.data', undefined)) as CtyData;
    expect([d.settings.hasBank, d.settings.closePeriod, d.settings.notes.LOC]).toEqual([true, 'month', [500, 100, 50]]);
    const bank = d.books.find((b) => b.cty_kind === 'bank' && b.active)!;
    expect(bank).toBeTruthy();
    expect((await loadProfile(db, ctx.Econome.profile.id))!.books).toContain(bank.id); // the bank goes to the econome
    await run('Econome', 'cty.settings.save', { hasBank: false, closePeriod: 'quarter' });
  });
});

describe('closing by quarter (the default)', () => {
  it('one count at the end of the quarter closes its three months; the community closes the quarter', async () => {
    const q = nodeDb();
    const P = await makeCommunity(q, 'Q', ['S', 'J']);
    expect(((await runOp(P.Econome, 'cty.data', undefined)) as CtyData).settings.closePeriod).toBe('quarter');
    const jb = (await loadBooks(q)).find((b) => b.name === 'J')!;
    const food = (await loadAccounts(q)).find((a) => a.code === '61101')!.id;
    await runOp(P.J, 'cty.entry.save', { entry: { book_id: jb.id, date: '2025-10-05', type: 'Exp', account_id: food, cur: 'LOC', amount: 100 } });
    await runOp(P.J, 'cty.entry.save', { entry: { book_id: jb.id, date: '2025-12-05', type: 'Exp', account_id: food, cur: 'LOC', amount: 50 } });
    await runOp(P.J, 'cty.month.close', { bookId: jb.id, ym: '2025-11', counted: { LOC: -150, USD: 0, EUR: 0 }, detail: { LOC: { '50': 0 } } });
    const ms = (await q.query<{ ym: string; counted_loc: number | null }>('SELECT ym, counted_loc FROM cty_month WHERE book_id = ? ORDER BY ym', [jb.id]));
    expect(ms).toEqual([{ ym: '2025-10', counted_loc: null }, { ym: '2025-11', counted_loc: null }, { ym: '2025-12', counted_loc: -150 }]);
    await expect(runOp(P.J, 'cty.entry.save', { entry: { book_id: jb.id, date: '2025-11-20', type: 'Exp', account_id: food, cur: 'LOC', amount: 1 } })).rejects.toThrow(/closed/);
    await runOp(P.Econome, 'cty.community.close', { ym: '2025-10' });
    expect((await q.query<{ ym: string }>('SELECT ym FROM closed_month ORDER BY ym')).map((r) => r.ym)).toEqual(['2025-10', '2025-11', '2025-12']);
  });
});

describe('one account from several books: pocket + bank, house + envelopes', () => {
  it('money between a Jesuit\'s own books needs no confirmation; the account adds both', async () => {
    const q = nodeDb();
    const P = await makeCommunity(q, 'G', ['S', 'J']);
    const refresh = async () => { Object.assign(P, await ctxMap(q)); };
    await runOp(P.Admin, 'cty.person.save', { id: P.J.profile.id, name: 'J', hasBank: true });
    await refresh();
    const { accountBooks, balanceOf } = await import('../src/community/domain');
    const bs = await loadBooks(q);
    const pocket = bs.find((b) => b.cty_kind === 'personal' && b.name === 'J')!;
    const bank = bs.find((b) => b.cty_kind === 'personal_bank')!;
    expect(accountBooks(bs, bank).map((b) => b.id)).toEqual([pocket.id, bank.id]);
    await runOp(P.J, 'cty.book.opening', { bookId: bank.id, opening: { LOC: 1000, USD: 0, EUR: 0 }, reason: 'start' });
    const t = (await runOp(P.J, 'cty.entry.save', { entry: { book_id: bank.id, to_book_id: pocket.id, date: '2025-10-02', type: 'Transfer', cur: 'LOC', amount: 200 } })) as string;
    expect((await loadEntries(q)).find((e) => e.id === t)!.received_at).not.toBeNull(); // no confirmation
    const bs2 = await loadBooks(q);
    expect(balanceOf(await loadEntries(q), accountBooks(bs2, pocket), '2025-10-31').LOC).toBe(bs2.find((b) => b.id === pocket.id)!.opening_syp + 1000);
  });
  it('the minister gives money to an envelope (cook), spends from it, puts back what is left; one count for the house', async () => {
    const q = nodeDb();
    const P = await makeCommunity(q, 'E', ['S', 'J']);
    await expect(runOp(P.J, 'cty.envelope.save', { name: 'Cook' })).rejects.toThrow(/Not allowed/);
    const env = (await runOp(P.Minister, 'cty.envelope.save', { name: 'Cook' })) as number;
    P.Minister = { ...P.Minister, profile: (await loadProfile(q, P.Minister.profile.id))! };
    const house = (await loadBooks(q)).find((b) => b.cty_kind === 'house')!;
    expect(P.Minister.profile.books).toContain(env);
    await runOp(P.Minister, 'cty.book.opening', { bookId: house.id, opening: { LOC: 10000, USD: 0, EUR: 0 }, reason: 'start' });
    await runOp(P.Minister, 'cty.entry.save', { entry: { book_id: house.id, to_book_id: env, date: '2025-10-03', type: 'Transfer', cur: 'LOC', amount: 3000 } });
    await runOp(P.Minister, 'cty.entry.save', { entry: { book_id: env, date: '2025-10-04', type: 'Exp', account_id: (await loadAccounts(q)).find((a) => a.code === '61101')!.id, cur: 'LOC', amount: 2500, note: 'vegetables' } });
    const { balanceOf, accountBooks } = await import('../src/community/domain');
    const bs = await loadBooks(q);
    const es = await loadEntries(q);
    expect(balanceOf(es, accountBooks(bs, bs.find((b) => b.id === house.id)!), '2025-10-31').LOC).toBe(7500); // 10000 − 2500 spent; the 3000 only moved
    await expect(runOp(P.Minister, 'cty.envelope.save', { id: env, name: 'Cook', active: 0 })).rejects.toThrow(/money in it/);
    await runOp(P.Minister, 'cty.month.close', { bookId: house.id, bookIds: [env], ym: '2025-10', counted: { LOC: 7500, USD: 0, EUR: 0 } });
    expect((await q.query('SELECT book_id FROM cty_month ORDER BY book_id')).length).toBeGreaterThanOrEqual(6); // house + envelope × the quarter's months
  });
});
