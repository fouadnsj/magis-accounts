// The Calendar's money reaches the books (the review before 0.13.0: M1, S3, S4): the list "Payments waiting for the books"
// for those who write entries (only what an entry needs), the entry made from a payment (linked by the receipt number),
// a calendar receipt number becomes one entry only and the entry must say what the payment says, the "copy" mark.
// Nothing here is real: invented names and amounts.
import { describe, expect, it, beforeAll } from 'vitest';
import { runOp, type DataPayload, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { blankTrx } from '../src/db/repo';
import { nowIso, type Db } from '../src/db/db';
import type { Lists, Trx } from '../src/domain/types';
import { addDays } from '../src/hosting/host';
import type { CalData } from '../src/hosting/calendar';
import type { PayWaiting } from '../src/hosting/calops';
import { nodeDb } from './nodeDb';

const day = (n: number) => addDays('2027-03-01', n);
const today = () => nowIso().slice(0, 10);

let db: Db;
let director: OpCtx, coordinator: OpCtx, accountant: OpCtx, reception: OpCtx, holder: OpCtx;
let L: Lists;
let hall = 0, booking = 0, mainId = 0, secret = 0, org = 0;
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
const pay = (c: OpCtx, a: Record<string, unknown>) => runOp(c, 'cal.pay.add', a) as Promise<{ id: number; receipt_no: string }>;
const waiting = async (c: OpCtx) => ((await runOp(c, 'cal.pay.waiting', undefined)) as { rows: PayWaiting[]; ever: boolean });
/** an entry of the main book, as the entry window makes it from a payment */
const row = (over: Partial<Trx>): Trx => {
  const line = L.lines.find((l) => l.name === 'Donation') ?? L.lines[0];
  return { ...blankTrx(), city_id: L.cities[0].id, book_id: mainId, date: today(), heading_id: line.heading_id, line_id: line.id, explanation: 'Test choir', ...over };
};
const save = (c: OpCtx, r: Trx, reason?: string) => runOp(c, 'trx.save', { rows: [r], reason });

beforeAll(async () => {
  db = nodeDb();
  await createOffice(db, { organisation: 'Test centre', supName: 'Director', supPin: 'fouadsj-1', comName: 'Com', comPin: 'com-pass-1' });
  director = await ctxOf('Director');
  // a city, a heading and a line for the entries
  await db.batch([
    { sql: "INSERT INTO city (name) VALUES ('Homs')" },
    { sql: "INSERT INTO heading (name, code) VALUES ('Income test', 'IT')" },
    { sql: "INSERT INTO heading_type (heading_id, type) SELECT id, 'Income' FROM heading WHERE code = 'IT'" },
    { sql: "INSERT INTO heading_type (heading_id, type) SELECT id, 'Exp' FROM heading WHERE code = 'IT'" },
    { sql: "INSERT INTO budget_line (heading_id, name, code) SELECT id, 'Donation', 'IT01' FROM heading WHERE code = 'IT'" },
  ]);
  L = ((await runOp(director, 'data', {})) as DataPayload).lists;
  mainId = L.books.find((b) => b.is_main)!.id;
  coordinator = await role('Coordinator', ['cal.view', 'cal.contacts', 'cal.programme', 'cal.outside', 'cal.orgs', 'cal.prices', 'cal.money']);
  accountant = await role('Accountant', ['register.view', 'register.main', 'month.close']);
  reception = await role('Reception', ['cal.view', 'cal.contacts', 'cal.outside', 'cal.orgs', 'cal.arrive']);
  await db.batch([{ sql: "INSERT INTO book (name, keeper_name, is_main, sort) VALUES ('Holder book', 'Holder', 0, 99)" }]);
  const hb = (await db.query<{ id: number }>("SELECT id FROM book WHERE name = 'Holder book'"))[0].id;
  holder = await role('Holder', ['book.own'], [hb]);
  const d = (await runOp(director, 'cal.get', undefined)) as CalData;
  const area = (await runOp(director, 'cal.area.save', { name: 'Main' })) as { id: number };
  hall = ((await runOp(director, 'cal.space.save', { building_id: area.id, name: 'Hall A', kind_id: d.kinds.find((k) => k.name.startsWith('Hall'))!.id, capacity: 40 })) as { id: number }).id;
  org = ((await runOp(reception, 'cal.org.save', { name: 'Test choir', kind_id: 3, persons: [{ name: 'Person A', phone: '0911-SECRET' }] })) as { id: number }).id;
  const r = (await runOp(coordinator, 'cal.booking.save', {
    origin: 'outside', org_id: org, group_name: 'Test choir', contact: 'Person A', phone: '0911-SECRET', note: 'NOTE-SECRET', people: 20, from_day: day(98), to_day: day(99), time_from: '09:00', time_to: '12:00',
    spaces: [hall], status: 'option', free: false, price_mode: 'group', rate: 777, currency: 'USD',
  })) as { saved: boolean; id: number };
  booking = r.id;
  secret = 777;
}, 60000);

describe('payments waiting for the books (M1)', () => {
  it('only those who write entries get the list; Reception, the Coordinator and a Book holder do not', async () => {
    await pay(coordinator, { booking_id: booking, amount: 200, currency: 'USD' });
    await expect(waiting(reception)).rejects.toThrow();
    await expect(waiting(coordinator)).rejects.toThrow();
    await expect(waiting(holder)).rejects.toThrow();
    expect((await waiting(accountant)).rows).toHaveLength(1);
    expect((await waiting(director)).rows).toHaveLength(1);
  });
  it('it holds ONLY the receipt number, date, amount, currency, group, code and kind: no price, contact or note', async () => {
    const w = await waiting(accountant);
    expect(w.ever).toBe(true);
    expect(Object.keys(w.rows[0]).sort()).toEqual(['amount', 'code', 'currency', 'kind', 'name', 'paid_on', 'receipt_no']);
    expect(w.rows[0]).toMatchObject({ receipt_no: `H${today().slice(0, 4)}-0001`, amount: 200, currency: 'USD', kind: 'in', name: 'Test choir' });
    const text = JSON.stringify(w);
    for (const s of ['SECRET', String(secret), 'Person A']) expect(text).not.toContain(s);
  });
  it('a private booking shows as "Reserved"', async () => {
    await db.batch([{ sql: 'UPDATE host_booking SET private = 1 WHERE id = ?', params: [booking] }]);
    expect((await waiting(accountant)).rows[0].name).toBe('Reserved · محجوز');
    await db.batch([{ sql: 'UPDATE host_booking SET private = 0 WHERE id = ?', params: [booking] }]);
  });
  it('the entry made from it (the number in the Receipt box) takes it off the list; the calendar shows "in the books"', async () => {
    const w = (await waiting(accountant)).rows[0];
    await save(accountant, row({ type: 'Income', date: w.paid_on, inc_usd: w.amount, receipt: w.receipt_no, explanation: 'Test choir · hall' }));
    expect((await waiting(accountant)).rows).toEqual([]);
    expect(((await runOp(director, 'cal.get', undefined)) as CalData).entered).toEqual([w.receipt_no]);
  });
  it('a refund (HR…) is an expense and appears on the list, not an income', async () => {
    await runOp(coordinator, 'cal.booking.cancel', { id: booking, reason: 'the choir stopped', money: 'none' });
    const w = (await waiting(accountant)).rows;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ receipt_no: `HR${today().slice(0, 4)}-0001`, kind: 'back', amount: 200, currency: 'USD' });
    // as an income it is refused: the entry must say what the payment says
    await expect(save(accountant, row({ type: 'Income', date: w[0].paid_on, inc_usd: 200, receipt: w[0].receipt_no }))).rejects.toThrow(/expense|مصروف|money given back|مُعاد/i);
    await save(accountant, row({ type: 'Exp', date: w[0].paid_on, exp_usd: 200, receipt: w[0].receipt_no, explanation: 'Given back · Test choir' }));
    expect((await waiting(accountant)).rows).toEqual([]);
  });
  it('a payment taken back is not waiting', async () => {
    const r = (await runOp(coordinator, 'cal.booking.save', { origin: 'outside', org_id: org, group_name: 'Second', people: 5, from_day: day(105), to_day: day(105), time_from: '10:00', time_to: '11:00', spaces: [hall], free: false, price_mode: 'group', rate: 50, currency: 'USD' })) as { id: number };
    const p = await pay(coordinator, { booking_id: r.id, amount: 30 });
    expect((await waiting(accountant)).rows.map((x) => x.receipt_no)).toEqual([p.receipt_no]);
    await runOp(coordinator, 'cal.pay.cancel', { id: p.id });
    expect((await waiting(accountant)).rows).toEqual([]);
  });
});

describe('one entry for a receipt number, and it says what the payment says (S3)', () => {
  let no = '', booking2 = 0;
  beforeAll(async () => {
    booking2 = ((await runOp(coordinator, 'cal.booking.save', { origin: 'outside', org_id: org, group_name: 'Third', people: 5, from_day: day(110), to_day: day(110), time_from: '10:00', time_to: '11:00', spaces: [hall], free: false, price_mode: 'group', rate: 300, currency: 'USD' })) as { id: number }).id;
    no = (await pay(coordinator, { booking_id: booking2, amount: 200, currency: 'USD' })).receipt_no;
  });
  it('an amount that differs, another currency or the wrong type is refused', async () => {
    await expect(save(accountant, row({ type: 'Income', inc_usd: 20, receipt: no }))).rejects.toThrow(/Receipt|الوصل/);
    await expect(save(accountant, row({ type: 'Income', inc_syp: 200, receipt: no }))).rejects.toThrow(/Receipt|الوصل/);
    await expect(save(accountant, row({ type: 'Exp', exp_usd: 200, receipt: no }))).rejects.toThrow(/Receipt|الوصل/);
    expect((await waiting(accountant)).rows.map((x) => x.receipt_no)).toEqual([no]);
  });
  it('the right entry is made once; a second one with the same number (also with other capitals or spaces) is refused', async () => {
    await save(accountant, row({ type: 'Income', inc_usd: 200, receipt: no }));
    await expect(save(accountant, row({ type: 'Income', inc_usd: 200, receipt: no }))).rejects.toThrow(/twice|مرتين/);
    await expect(save(accountant, row({ type: 'Income', inc_usd: 200, receipt: ` ${no.toLowerCase()} ` }))).rejects.toThrow(/twice|مرتين/);
    expect((await db.query('SELECT id FROM trx WHERE receipt = ?', [no]))).toHaveLength(1);
  });
  it('two rows with the same number in one save are refused too', async () => {
    const p2 = await pay(coordinator, { booking_id: booking2, amount: 10, currency: 'USD' });
    await expect(runOp(accountant, 'trx.save', { rows: [row({ type: 'Income', inc_usd: 10, receipt: p2.receipt_no }), row({ type: 'Income', inc_usd: 10, receipt: p2.receipt_no })] })).rejects.toThrow(/twice|مرتين/);
    await save(accountant, row({ type: 'Income', inc_usd: 10, receipt: p2.receipt_no }));
  });
  it('the entry changed later to another amount is refused; a note on it is allowed; other receipt numbers are free', async () => {
    const e = (await db.query<Trx>('SELECT * FROM trx WHERE receipt = ?', [no]))[0];
    await expect(save(accountant, { ...e, inc_usd: 20 }, 'a typing mistake')).rejects.toThrow(/Receipt|الوصل/);
    await save(accountant, { ...e, explanation: 'Third group, the hall' }, 'clearer');
    await save(accountant, row({ type: 'Income', inc_usd: 5, receipt: 'BILL-77' }));
    await save(accountant, row({ type: 'Income', inc_usd: 5, receipt: 'BILL-77' }));
  });
  it('Syrian pounds are whole pounds when a payment is recorded (what is said in words is what is written)', async () => {
    const p = await pay(coordinator, { booking_id: booking2, amount: 1250.75, currency: 'SYP' });
    const x = (await db.query<{ amount: number }>('SELECT amount FROM host_pay WHERE receipt_no = ?', [p.receipt_no]))[0];
    expect(x.amount).toBe(1251);
    await expect(pay(coordinator, { booking_id: booking2, amount: 0.3, currency: 'SYP' })).rejects.toThrow();
    const u = await pay(coordinator, { booking_id: booking2, amount: 12.5, currency: 'USD' });
    expect((await db.query<{ amount: number }>('SELECT amount FROM host_pay WHERE receipt_no = ?', [u.receipt_no]))[0].amount).toBe(12.5);
  });
});

describe('the "copy" mark comes from the server (S4)', () => {
  it('two prints of the same receipt, one after the other from two screens that loaded the same data: the second one is a copy', async () => {
    const r = (await runOp(coordinator, 'cal.booking.save', { origin: 'outside', org_id: org, group_name: 'Fourth', people: 5, from_day: day(120), to_day: day(120), time_from: '10:00', time_to: '11:00', spaces: [hall], free: false, price_mode: 'group', rate: 50, currency: 'USD' })) as { id: number };
    const p = await pay(coordinator, { booking_id: r.id, amount: 5 });
    const [a, b] = await Promise.all([runOp(coordinator, 'cal.paper.printed', { what: 'pay', id: p.id }), runOp(director, 'cal.paper.printed', { what: 'pay', id: p.id })]);
    expect([(a as { before: number }).before, (b as { before: number }).before].sort()).toEqual([0, 1]);
    expect((await runOp(coordinator, 'cal.paper.printed', { what: 'pay', id: p.id }) as { before: number }).before).toBe(2);
    const [c, e] = await Promise.all([runOp(coordinator, 'cal.paper.printed', { what: 'booking', id: r.id }), runOp(director, 'cal.paper.printed', { what: 'booking', id: r.id })]);
    expect([(c as { before: number }).before, (e as { before: number }).before].sort()).toEqual([0, 1]);
  });
});
