// A payment of the calendar goes into the book of the person who took the money (Fouad, 26 November 2026; update 79).
// In a small centre one person (Nagham in Homs) is a Book holder AND keeps the calendar: her payments go into her own book,
// not into the Accountant's. Nothing here is real: invented names and amounts.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type DataPayload, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { blankTrx } from '../src/db/repo';
import { migrate, splitSql, nowIso, type Db } from '../src/db/db';
import { MIGRATIONS } from '../src/db/migrations';
import type { Lists, Trx } from '../src/domain/types';
import { addDays } from '../src/hosting/host';
import type { CalData } from '../src/hosting/calendar';
import type { PayBook, PayWaiting } from '../src/hosting/calops';
import { nodeDb } from './nodeDb';

const day = (n: number) => addDays('2027-03-01', n);
const today = () => nowIso().slice(0, 10);

let db: Db;
let director: OpCtx, coordinator: OpCtx, accountant: OpCtx, accountantMoney: OpCtx, nagham: OpCtx, two: OpCtx, privateKeeper: OpCtx, deskHolder: OpCtx, holderOnly: OpCtx;
let L: Lists;
let hall = 0, org = 0, mainId = 0, bookN = 0, bookA = 0, bookB = 0, bookPriv = 0;
const files = {} as OpCtx['files'];
const ctxOf = async (name: string): Promise<OpCtx> => {
  const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
  return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
};
const role = async (name: string, perms: string[], books: number[] = []) => {
  await runOp(director, 'access.save', { name, perms });
  const access = (await db.query<{ id: number }>('SELECT id FROM access_profile WHERE name = ?', [name]))[0].id;
  await runOp(director, 'user.save', { name, access_id: access, books, pin: 'test123-pass' });
  return ctxOf(name);
};
const MONEY = ['cal.view', 'cal.contacts', 'cal.programme', 'cal.outside', 'cal.orgs', 'cal.prices', 'cal.money'];
let nth = 0;
const newBooking = async (c: OpCtx) => { const r = (await runOp(c, 'cal.booking.save', {
  origin: 'outside', org_id: org, group_name: `Choir ${++nth}`, contact: 'Person A', phone: '0911-SECRET', people: 20, from_day: day(42 + nth * 7), to_day: day(43 + nth * 7), time_from: '09:00', time_to: '12:00',
  spaces: [hall], status: 'option', free: false, price_mode: 'group', rate: 500, currency: 'USD',
})) as { saved: boolean; id: number }; if (!r.id) throw new Error('booking not saved: ' + JSON.stringify(r)); return r.id; };
const pay = (c: OpCtx, booking: number, extra: Record<string, unknown> = {}) => runOp(c, 'cal.pay.add', { booking_id: booking, amount: 100, currency: 'USD', ...extra }) as Promise<{ id: number; receipt_no: string }>;
const bookOf = async (receipt: string) => (await db.query<{ book_id: number | null; by_profile: number | null }>('SELECT book_id, by_profile FROM host_pay WHERE receipt_no = ?', [receipt]))[0];
const waiting = (c: OpCtx) => runOp(c, 'cal.pay.waiting', undefined) as Promise<{ rows: PayWaiting[]; ever: boolean; elsewhere: number }>;
const row = (over: Partial<Trx>): Trx => {
  const line = L.lines.find((l) => l.name === 'Donation') ?? L.lines[0];
  return { ...blankTrx(), city_id: L.cities[0].id, book_id: mainId, date: today(), heading_id: line.heading_id, line_id: line.id, explanation: 'Test choir', ...over };
};
const entryOf = (w: PayWaiting, book: number): Trx => row({ type: w.kind === 'back' ? 'Exp' : 'Income', book_id: book, date: w.paid_on, inc_usd: w.kind === 'back' ? 0 : w.amount, exp_usd: w.kind === 'back' ? w.amount : 0, receipt: w.receipt_no });
const save = (c: OpCtx, r: Trx) => runOp(c, 'trx.save', { rows: [r] });

beforeAll(async () => {
  db = nodeDb();
  await createOffice(db, { organisation: 'Test centre', supName: 'Director', supPin: 'fouadsj-1', comName: 'Com', comPin: 'com-pass-1' });
  director = await ctxOf('Director');
  await db.batch([
    { sql: "INSERT INTO city (name) VALUES ('Homs')" },
    { sql: "INSERT INTO heading (name, code) VALUES ('Income test', 'IT')" },
    { sql: "INSERT INTO heading_type (heading_id, type) SELECT id, 'Income' FROM heading WHERE code = 'IT'" },
    { sql: "INSERT INTO heading_type (heading_id, type) SELECT id, 'Exp' FROM heading WHERE code = 'IT'" },
    { sql: "INSERT INTO budget_line (heading_id, name, code) SELECT id, 'Donation', 'IT01' FROM heading WHERE code = 'IT'" },
    { sql: "INSERT INTO book (name, keeper_name, is_main, sort) VALUES ('Nagham book', 'Nagham', 0, 91), ('Book A', 'Two', 0, 92), ('Book B', 'Two', 0, 93)" },
    { sql: "INSERT INTO book (name, keeper_name, is_main, sort, private) VALUES ('Private book', 'Secret', 0, 94, 1)" },
    { sql: "INSERT INTO book (name, keeper_name, is_main, sort) VALUES ('Desk book', 'Desk', 0, 95)" },
  ]);
  const id = async (name: string) => (await db.query<{ id: number }>('SELECT id FROM book WHERE name = ?', [name]))[0].id;
  [bookN, bookA, bookB, bookPriv] = [await id('Nagham book'), await id('Book A'), await id('Book B'), await id('Private book')];
  L = ((await runOp(director, 'data', {})) as DataPayload).lists;
  mainId = L.books.find((b) => b.is_main)!.id;
  coordinator = await role('Coordinator', MONEY);
  accountant = await role('Accountant', ['register.view', 'register.main', 'month.close']);
  accountantMoney = await role('AccountantMoney', ['register.view', 'register.main', ...MONEY]);
  nagham = await role('Nagham', ['book.own', ...MONEY], [bookN]);
  two = await role('Two', ['book.own', ...MONEY], [bookA, bookB]);
  privateKeeper = await role('PrivateKeeper', ['book.own', ...MONEY], [bookPriv]);
  deskHolder = await role('DeskHolder', ['book.own', 'cal.view', 'cal.arrive'], [await id('Desk book')]);
  holderOnly = await role('HolderOnly', ['book.own'], []);
  const d = (await runOp(director, 'cal.get', undefined)) as CalData;
  const area = (await runOp(director, 'cal.area.save', { name: 'Main area' })) as { id: number };
  hall = ((await runOp(director, 'cal.space.save', { building_id: area.id, name: 'Hall A', kind_id: d.kinds.find((k) => k.name.startsWith('Hall'))!.id, capacity: 40 })) as { id: number }).id;
  org = ((await runOp(coordinator, 'cal.org.save', { name: 'Test choir', kind_id: 3, persons: [{ name: 'Person A', phone: '0911-SECRET' }] })) as { id: number }).id;
}, 60000);

describe('the book a payment goes into', () => {
  it('a Book holder who takes the money: her own book is the default, and the profile is kept', async () => {
    const r = await pay(nagham, await newBooking(nagham));
    expect(await bookOf(r.receipt_no)).toEqual({ book_id: bookN, by_profile: nagham.profile.id });
    expect(((await runOp(nagham, 'cal.pay.books', undefined)) as { default: number }).default).toBe(bookN);
  });
  it('a person with no book (the Coordinator) and the Accountant who takes money: the Main book (null)', async () => {
    for (const c of [coordinator, accountantMoney]) {
      const r = await pay(c, await newBooking(c));
      expect((await bookOf(r.receipt_no)).book_id).toBeNull();
      expect(((await runOp(c, 'cal.pay.books', undefined)) as { default: number; mainId: number }).default).toBe(mainId);
    }
  });
  it('the Administrator, who keeps the private Respo book, still gets the Main book', async () => {
    const r = await pay(director, await newBooking(director));
    expect((await bookOf(r.receipt_no)).book_id).toBeNull();
    const o = (await runOp(director, 'cal.pay.books', undefined)) as { options: PayBook[] };
    expect(o.options.every((x) => x.id !== bookPriv)).toBe(true);
  });
  it('several books of his own: the Main book by default, and he may choose one of his own', async () => {
    const o = (await runOp(two, 'cal.pay.books', undefined)) as { options: PayBook[]; default: number };
    expect(o.default).toBe(mainId);
    expect(o.options.map((x) => x.id).sort()).toEqual([mainId, bookA, bookB].sort());
    const b = await newBooking(two);
    expect((await bookOf((await pay(two, b)).receipt_no)).book_id).toBeNull();
    expect((await bookOf((await pay(two, b, { book_id: bookB })).receipt_no)).book_id).toBe(bookB);
  });
  it('she may hand the money straight to the office: the Main book, by its id or by null', async () => {
    const b = await newBooking(nagham);
    expect((await bookOf((await pay(nagham, b, { book_id: mainId })).receipt_no)).book_id).toBeNull();
    expect((await bookOf((await pay(nagham, b, { book_id: null })).receipt_no)).book_id).toBeNull();
  });
  it('never another person\'s book, never a private book, never a book that does not exist', async () => {
    const b = await newBooking(nagham);
    await expect(pay(nagham, b, { book_id: bookA })).rejects.toThrow(/own book|دفترك/);
    await expect(pay(coordinator, b, { book_id: bookN })).rejects.toThrow(/own book|دفترك/);
    await expect(pay(privateKeeper, b, { book_id: bookPriv })).rejects.toThrow(/own book|دفترك/);
    await expect(pay(nagham, b, { book_id: 9999 })).rejects.toThrow();
    // a person who keeps only a private book: the Main book by default
    expect((await bookOf((await pay(privateKeeper, b)).receipt_no)).book_id).toBeNull();
    // nothing was recorded by the refused calls
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM host_pay WHERE book_id IN (?, ?)', [bookA, bookPriv]))[0].n).toBe(0);
  });
});

describe('the list "Payments waiting for the books" is per person', () => {
  let nB: number, mB: number;
  beforeAll(async () => {
    await db.batch([{ sql: 'DELETE FROM host_pay' }]);
    nB = await newBooking(nagham);
    mB = await newBooking(coordinator);
    await pay(nagham, nB, { amount: 11 });
    await pay(nagham, nB, { amount: 12 });
    await pay(coordinator, mB, { amount: 33 });
    await pay(two, nB, { amount: 44, book_id: bookA });
  });
  it('a Book holder sees her own book\'s payments only, with no price, contact or note', async () => {
    const w = await waiting(nagham);
    expect(w.rows.map((r) => r.amount)).toEqual([11, 12]);
    expect(w.rows.every((r) => r.book_id === bookN && r.book === 'Nagham book')).toBe(true);
    expect(w.elsewhere).toBe(0);
    expect(Object.keys(w.rows[0]).sort()).toEqual(['amount', 'book', 'book_id', 'code', 'currency', 'kind', 'name', 'paid_on', 'receipt_no']);
    expect(JSON.stringify(w)).not.toMatch(/SECRET|Person A|"rate"|500/);
  });
  it('the Accountant sees the Main book\'s payments, and only a plain count of the ones in holders\' books', async () => {
    const w = await waiting(accountant);
    expect(w.rows.map((r) => r.amount)).toEqual([33]);
    expect(w.elsewhere).toBe(3);
    expect(JSON.stringify(w)).not.toMatch(/Nagham|"amount":(11|12|44)/);
  });
  it('the Administrator sees them all, each with its book', async () => {
    const w = await waiting(director);
    expect(w.rows.map((r) => [r.amount, r.book_id])).toEqual([[11, bookN], [12, bookN], [33, mainId], [44, bookA]]);
    expect(w.elsewhere).toBe(0);
  });
  it('a holder with several books sees the payments of the books he keeps, not the others\'', async () => {
    expect((await waiting(two)).rows.map((r) => r.amount)).toEqual([44]);
  });
  it('a Book holder who is only Reception (no money tick), a plain holder, the Coordinator: nothing', async () => {
    await expect(waiting(deskHolder)).rejects.toThrow();
    await expect(waiting(holderOnly)).rejects.toThrow();
    await expect(waiting(coordinator)).rejects.toThrow();
  });
  it('the notice counts only the person\'s own (the number the screens show is the list)', async () => {
    expect((await waiting(nagham)).rows).toHaveLength(2);
    expect((await waiting(accountant)).rows).toHaveLength(1);
  });
});

describe('who writes the entry, and in which book', () => {
  it('Nagham makes the entry in her own book (she has no "writes in Main" tick); the payment leaves her list; the calendar says "in the books"', async () => {
    const w = (await waiting(nagham)).rows[0];
    await save(nagham, entryOf(w, bookN));
    expect((await waiting(nagham)).rows.map((r) => r.amount)).toEqual([12]);
    expect(((await runOp(director, 'cal.get', undefined)) as CalData).entered).toContain(w.receipt_no);
  });
  it('the entry of her payment cannot go into the Main book or into another book (also not by the Administrator)', async () => {
    const w = (await waiting(nagham)).rows[0];
    await expect(save(nagham, entryOf(w, mainId))).rejects.toThrow();
    await expect(save(nagham, entryOf(w, bookA))).rejects.toThrow();
    await expect(save(director, entryOf(w, mainId))).rejects.toThrow(/belongs to the book|يخصّ دفتر/);
    await expect(save(director, entryOf(w, bookA))).rejects.toThrow(/belongs to the book|يخصّ دفتر/);
  });
  it('the Accountant never writes in a holder\'s book, and cannot enter a payment of a holder in the Main book', async () => {
    const w = (await waiting(nagham)).rows[0];
    await expect(save(accountant, entryOf(w, bookN))).rejects.toThrow();
    await expect(save(accountant, entryOf(w, mainId))).rejects.toThrow(/belongs to the book|يخصّ دفتر/);
  });
  it('a holder cannot make the entry of a payment of the Main book, nor of another holder\'s book', async () => {
    const main = (await waiting(accountant)).rows[0];
    await expect(save(nagham, entryOf(main, bookN))).rejects.toThrow(/belongs to the book|يخصّ دفتر/);
    await expect(save(nagham, entryOf(main, mainId))).rejects.toThrow();
    const a = (await waiting(two)).rows[0];
    await expect(save(nagham, entryOf(a, bookN))).rejects.toThrow(/belongs to the book|يخصّ دفتر/);
  });
  it('the Accountant makes the entry of a Main payment in the Main book; one entry per receipt number still holds', async () => {
    const main = (await waiting(accountant)).rows[0];
    await save(accountant, entryOf(main, mainId));
    expect((await waiting(accountant)).rows).toEqual([]);
    await expect(save(director, entryOf(main, mainId))).rejects.toThrow(/already an entry|لا يُقيَّد مرتين/);
  });
  it('the amount must still agree with the payment, in her book too', async () => {
    const w = (await waiting(nagham)).rows[0];
    await expect(save(nagham, { ...entryOf(w, bookN), inc_usd: w.amount + 1 })).rejects.toThrow(/something else|يخالفه|autre chose/i);
  });
});

describe('a refund goes back out of the book the money came into', () => {
  let b = 0;
  it('the refund (HR…) is in her book, an expense she enters; the Accountant does not see it', async () => {
    b = await newBooking(nagham);
    await pay(nagham, b, { amount: 70 });
    await runOp(nagham, 'cal.booking.cancel', { id: b, reason: 'stopped', money: 'none' });
    const back = (await waiting(nagham)).rows.filter((r) => r.kind === 'back');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ amount: 70, book_id: bookN, kind: 'back' });
    expect((await bookOf(back[0].receipt_no)).book_id).toBe(bookN);
    expect((await waiting(accountant)).rows.filter((r) => r.kind === 'back')).toEqual([]);
    await save(nagham, entryOf(back[0], bookN));
    expect((await waiting(nagham)).rows.filter((r) => r.kind === 'back')).toEqual([]);
  });
  it('a refund of Main money stays in the Main book', async () => {
    const m = await newBooking(coordinator);
    await pay(coordinator, m, { amount: 60 });
    await runOp(coordinator, 'cal.booking.cancel', { id: m, reason: 'stopped', money: 'none' });
    const back = (await waiting(accountant)).rows.filter((r) => r.kind === 'back');
    expect(back).toHaveLength(1);
    expect((await bookOf(back[0].receipt_no)).book_id).toBeNull();
  });
  it('only the Administrator changes the book of a payment that is not in the books yet; never to a private book', async () => {
    const w = (await waiting(accountant)).rows.find((r) => r.kind === 'back')!;
    await expect(runOp(coordinator, 'cal.pay.book', { receipt_no: w.receipt_no, book_id: bookN })).rejects.toThrow();
    await expect(runOp(nagham, 'cal.pay.book', { receipt_no: w.receipt_no, book_id: bookN })).rejects.toThrow();
    await expect(runOp(director, 'cal.pay.book', { receipt_no: w.receipt_no, book_id: bookPriv })).rejects.toThrow();
    await runOp(director, 'cal.pay.book', { receipt_no: w.receipt_no, book_id: bookN });
    expect((await waiting(nagham)).rows.map((r) => r.receipt_no)).toContain(w.receipt_no);
    expect((await waiting(accountant)).rows.map((r) => r.receipt_no)).not.toContain(w.receipt_no);
    // once it is an entry it cannot move
    const moved = (await waiting(nagham)).rows.find((r) => r.receipt_no === w.receipt_no)!;
    await save(nagham, entryOf(moved, bookN));
    await expect(runOp(director, 'cal.pay.book', { receipt_no: w.receipt_no, book_id: null })).rejects.toThrow();
  });
});

describe('update 79 on a database at 78', () => {
  it('adds the book to the payments; the payments already there stay in the Main book (null); it runs once', async () => {
    const old = nodeDb();
    await old.batch([{ sql: 'CREATE TABLE schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' }]);
    for (const mg of MIGRATIONS.filter((x) => x.n <= 78)) await old.batch([...splitSql(mg.sql).map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)', params: [mg.n, mg.name, 'x'] }]);
    await old.batch([
      { sql: "INSERT INTO host_booking (id, code, kind, status, group_name, people, from_day, to_day, price_mode, rate, currency, created_at) VALUES (1, 'HB-2026-0001', 'stay', 'confirmed', 'Scouts', 4, '2026-12-01', '2026-12-03', 'person', 10, 'USD', '2026-11-22T10:00:00Z')" },
      { sql: "INSERT INTO host_pay (booking_id, amount, currency, paid_on, receipt_no, at) VALUES (1, 40, 'USD', '2026-12-01', 'H2026-0001', 'x')" },
    ]);
    expect(await migrate(old)).toEqual([79]);
    expect(await old.query('SELECT receipt_no, amount, book_id, by_profile FROM host_pay')).toEqual([{ receipt_no: 'H2026-0001', amount: 40, book_id: null, by_profile: null }]);
    expect(await migrate(old)).toEqual([]);
  });
});
