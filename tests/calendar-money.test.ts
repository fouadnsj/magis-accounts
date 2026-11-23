// The MAGIS Calendar, step 4 "Money and paper" (baseline 2.1, section 7): payments at any time (also before confirming), each
// a suggestion for the books with its receipt number; cancelling with a part kept (what is given back is also a suggestion,
// HR…); the "copy" mark; the receipts, the booking sheet, the printed pages and the Excel list.
// Nothing here is real: invented names, invented dates in 2027 (Monday 1 March 2027 is day 0).
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { nowIso, type Db } from '../src/db/db';
import { addDays } from '../src/hosting/host';
import { givenBack, received, type CalData } from '../src/hosting/calendar';
import { payReceiptPdf, receiptPdf } from '../src/io/hostReceipt';
import { bookingSheetPdf, hallWeekPdf, shortPagePdf } from '../src/io/calPaper';
import { bookingsIn, calWorkbook } from '../src/io/calFile';
import { nodeDb } from './nodeDb';

const day = (n: number) => addDays('2027-03-01', n);
const today = () => nowIso().slice(0, 10);
const year = () => today().slice(0, 4);
const pub = (p: string) => new Uint8Array(fs.readFileSync(new URL('../public/' + p, import.meta.url)));
const look = { organisation: 'MAGIS Test · ماجيس', logos: { jesuit: pub('brand/jesuits.png'), centre: pub('brand/mark-homs.png') }, fonts: { arabic: pub('fonts/amiri-arabic-400.ttf'), arabicBold: pub('fonts/amiri-arabic-700.ttf') }, accent: '#5a1a1a' };

let db: Db;
let director: OpCtx, coordinator: OpCtx, reception: OpCtx;
const files = {} as OpCtx['files'];
const ctxOf = async (name: string): Promise<OpCtx> => {
  const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
  return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
};
const role = async (name: string, perms: string[]) => {
  await runOp(director, 'access.save', { name, perms });
  const access = (await db.query<{ id: number }>('SELECT id FROM access_profile WHERE name = ?', [name]))[0].id;
  await runOp(director, 'user.save', { name, access_id: access, books: [], pin: 'test123-pass' });
  return ctxOf(name);
};
const cal = async (c: OpCtx = director) => (await runOp(c, 'cal.get', undefined)) as CalData;
const pay = (c: OpCtx, a: Record<string, unknown>) => runOp(c, 'cal.pay.add', a) as Promise<{ id: number; receipt_no: string }>;
const enter = (receipt: string, type: 'Income' | 'Exp', usd: number) => db.batch([{ sql: `INSERT INTO trx (id, date, type, explanation, receipt, ${type === 'Income' ? 'inc_usd' : 'exp_usd'}, created_at) VALUES (?, ?, ?, 'test', ?, ?, '2027-04-01T00:00:00Z')`, params: [`t-${receipt}`, today(), type, receipt, usd] }]);

let hall = 0, booking = 0, org = 0;

beforeAll(async () => {
  db = nodeDb();
  await createOffice(db, { organisation: 'Test centre', supName: 'Director', supPin: 'fouadsj-1', comName: 'Com', comPin: 'com-pass-1' });
  director = await ctxOf('Director');
  coordinator = await role('Coordinator', ['cal.view', 'cal.contacts', 'cal.programme', 'cal.outside', 'cal.orgs', 'cal.prices', 'cal.money']);
  reception = await role('Reception', ['cal.view', 'cal.contacts', 'cal.outside', 'cal.orgs', 'cal.arrive']);
  const d = await cal();
  const area = (await runOp(director, 'cal.area.save', { name: 'Main' })) as { id: number };
  hall = ((await runOp(director, 'cal.space.save', { building_id: area.id, name: 'Hall A', kind_id: d.kinds.find((k) => k.name.startsWith('Hall'))!.id, capacity: 40 })) as { id: number }).id;
  org = ((await runOp(reception, 'cal.org.save', { name: 'Test choir', kind_id: 3, persons: [{ name: 'Person A', phone: '0911' }] })) as { id: number }).id;
  // three days, 30 USD each date, held "to confirm"
  const r = (await runOp(coordinator, 'cal.booking.save', {
    origin: 'outside', org_id: org, group_name: 'Test choir', contact: 'Person A', phone: '0911', people: 20, from_day: day(98), to_day: day(100), time_from: '09:00', time_to: '12:00',
    spaces: [hall], status: 'option', free: false, price_mode: 'group', price_each: true, rate: 30, currency: 'USD',
  })) as { saved: boolean; id: number };
  expect(r.saved).toBe(true);
  booking = r.id;
}, 60000);

describe('payments', () => {
  it('a payment before confirming: a suggestion for the books with the next receipt number; Reception may not record one', async () => {
    await expect(pay(reception, { booking_id: booking, amount: 10 })).rejects.toThrow();
    const a = await pay(coordinator, { booking_id: booking, amount: 40, currency: 'USD' });
    const b = await pay(director, { booking_id: booking, amount: 20, currency: 'USD', method: 'transfer' });
    expect([a.receipt_no, b.receipt_no]).toEqual([`H${year()}-0001`, `H${year()}-0002`]);
    const d = await cal();
    expect(d.bookings.find((x) => x.id === booking)?.status).toBe('option');
    expect(received(d.pays.filter((p) => p.booking_id === booking))).toEqual({ USD: 60, SYP: 0 });
    expect(d.pays.find((p) => p.id === b.id)).toMatchObject({ status: 'suggested', kind: 'in', method: 'transfer' });
    expect(d.entered).toEqual([]);
    // Reception sees no payments at all
    expect((await cal(reception)).pays).toEqual([]);
    await expect(pay(coordinator, { booking_id: booking, amount: 5, paid_on: addDays(today(), 3) })).rejects.toThrow();
  });
  it('a payment recorded by mistake is taken back, unless it is already in the books', async () => {
    const x = await pay(coordinator, { booking_id: booking, amount: 7 });
    await runOp(coordinator, 'cal.pay.cancel', { id: x.id });
    expect((await cal()).pays.find((p) => p.id === x.id)?.status).toBe('refused');
    const first = (await cal()).pays.find((p) => p.receipt_no === `H${year()}-0001`)!;
    await enter(first.receipt_no, 'Income', 40);
    expect((await cal()).entered).toEqual([first.receipt_no]);
    await expect(runOp(coordinator, 'cal.pay.cancel', { id: first.id })).rejects.toThrow();
    expect(received((await cal()).pays.filter((p) => p.booking_id === booking))).toEqual({ USD: 60, SYP: 0 });
  });
  it('printing a receipt is counted: the next one carries "copy"', async () => {
    const p = (await cal()).pays.find((x) => x.receipt_no === `H${year()}-0002`)!;
    expect(p.printed).toBe(0);
    expect(await runOp(coordinator, 'cal.paper.printed', { what: 'pay', id: p.id })).toEqual({ before: 0 });
    expect(await runOp(coordinator, 'cal.paper.printed', { what: 'pay', id: p.id })).toEqual({ before: 1 });
    await runOp(director, 'cal.paper.printed', { what: 'booking', id: booking });
    expect((await cal()).bookings.find((b) => b.id === booking)?.receipt_printed).toBe(1);
    await expect(runOp(reception, 'cal.paper.printed', { what: 'pay', id: p.id })).rejects.toThrow();
  });
});

describe('the paper', () => {
  it('the receipt of one payment, of the whole booking (with "copy"), the booking sheet, the week of the hall, the short page: all written', async () => {
    const d = await cal();
    const b = d.bookings.find((x) => x.id === booking)!;
    const pdfs = [
      await payReceiptPdf({ ...look, receipt_no: `H${year()}-0002`, paid_on: today(), amount: 20, currency: 'USD', method: 'transfer', from: { name: 'Test choir', person: 'Person A', phone: '0911' }, booking: { code: b.code, name: b.group_name, days: `${b.from_day} → ${b.to_day}`, spaces: 'Hall A' }, due: { USD: 30, SYP: 0 }, copy: true }),
      await receiptPdf({ ...look, issuedOn: today(), ref: b.code, kind: 'event', billedTo: { name: 'Test choir', contact: 'Person A', phone: '0911' }, from_day: b.from_day, to_day: b.to_day, people: 20, nights: 3, repeats: false, rooms: ['Hall A'], equipment: [], rows: [{ label: 'Hall rental · إيجار القاعة', sub: '3 date(s)', qty: 3, unit: 30, currency: 'USD' }], payments: [{ paid_on: today(), receipt_no: `H${year()}-0001`, amount: 40, currency: 'USD' }], note: '', copy: true }),
      await bookingSheetPdf(look, d, b, today()),
      await hallWeekPdf(look, d, hall, day(98)),
      await shortPagePdf(look, d, day(98), day(104)),
      await shortPagePdf(look, d, day(99), day(99)),
    ];
    for (const bytes of pdfs) expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  }, 30000);
  it('the Excel list: the bookings of the period, with the money for who sees it; Reception gets no amounts', async () => {
    const d = await cal();
    expect(bookingsIn(d, day(98), day(98)).map((b) => b.id)).toEqual([booking]);
    expect(bookingsIn(d, day(101), day(120))).toEqual([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await calWorkbook(d, day(90), day(110), 'Test centre')) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Bookings')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    const row = (ws.getRow(2).values as unknown[]).slice(1);
    const col = (h: string) => row[header.indexOf(h)];
    expect([col('Name'), col('Total USD'), col('Paid USD'), col('Still due USD'), col('Dates')]).toEqual(['Test choir', 90, 60, 30, 3]);
    expect(wb.getWorksheet('Payments')).toBeTruthy();
    const wr = new ExcelJS.Workbook();
    await wr.xlsx.load((await calWorkbook(await cal(reception), day(90), day(110), 'Test centre')) as unknown as ArrayBuffer);
    expect((wr.getWorksheet('Bookings')!.getRow(1).values as unknown[]).includes('Total USD')).toBe(false);
    expect(wr.getWorksheet('Payments')).toBeUndefined();
  });
});

describe('cancelling with money received', () => {
  it('Reception cancels: the money waits for the Director or the Coordinator', async () => {
    // Reception may not decide the money: it is refused, and it cancels without deciding
    await expect(runOp(reception, 'cal.booking.cancel', { id: booking, reason: 'the choir stopped', money: 'none' })).rejects.toThrow();
    const r = (await runOp(reception, 'cal.booking.cancel', { id: booking, reason: 'the choir stopped' })) as { toDecide: boolean };
    expect(r.toDecide).toBe(true);
    const b = (await cal()).bookings.find((x) => x.id === booking)!;
    expect([b.status, b.cancel_money]).toEqual(['cancelled', null]);
    expect(givenBack((await cal()).pays)).toEqual({ USD: 0, SYP: 0 });
    await expect(pay(coordinator, { booking_id: booking, amount: 5 })).rejects.toThrow();
  });
  it('keep a part: what goes back is a suggestion for the books (HR…); decided again, it is replaced', async () => {
    await expect(runOp(coordinator, 'cal.booking.money', { id: booking, money: 'part', kept_usd: 70 })).rejects.toThrow(); // more than received
    await runOp(coordinator, 'cal.booking.money', { id: booking, money: 'part', kept_usd: 25 });
    let d = await cal();
    let back = d.pays.filter((p) => p.kind === 'back');
    expect(back.map((p) => [p.receipt_no, p.amount, p.currency, p.status])).toEqual([[`HR${year()}-0001`, 35, 'USD', 'suggested']]);
    expect(received(d.pays.filter((p) => p.booking_id === booking))).toEqual({ USD: 60, SYP: 0 });
    // decided again: give all back
    await runOp(director, 'cal.booking.money', { id: booking, money: 'none' });
    d = await cal();
    back = d.pays.filter((p) => p.kind === 'back');
    expect(back.map((p) => [p.receipt_no, p.amount])).toEqual([[`HR${year()}-0001`, 60]]);
    expect(d.bookings.find((x) => x.id === booking)).toMatchObject({ cancel_money: 'none', kept_usd: 0 });
  });
  it('once the money given back is in the books, it cannot change, and the booking cannot be put back', async () => {
    await enter(`HR${year()}-0001`, 'Exp', 60);
    await expect(runOp(director, 'cal.booking.money', { id: booking, money: 'all' })).rejects.toThrow();
    await runOp(director, 'cal.booking.money', { id: booking, money: 'none' }); // the same decision: nothing changes
    await expect(runOp(director, 'cal.booking.status', { id: booking, status: 'option' })).rejects.toThrow();
    expect((await cal()).entered?.sort()).toEqual([`H${year()}-0001`, `HR${year()}-0001`]);
  });
  it('a booking cancelled with money given back not yet in the books is put back: the decision is undone', async () => {
    const r = (await runOp(coordinator, 'cal.booking.save', { origin: 'outside', org_id: org, group_name: 'Second group', people: 5, from_day: day(105), to_day: day(105), time_from: '10:00', time_to: '11:00', spaces: [hall], free: false, price_mode: 'group', rate: 50, currency: 'USD' })) as { saved: boolean; id: number };
    await pay(coordinator, { booking_id: r.id, amount: 50 });
    await runOp(coordinator, 'cal.booking.cancel', { id: r.id, reason: 'mistake', money: 'part', kept_usd: 10 });
    expect((await cal()).pays.filter((p) => p.booking_id === r.id && p.kind === 'back').map((p) => p.amount)).toEqual([40]);
    await runOp(coordinator, 'cal.booking.status', { id: r.id, status: 'option' });
    const d = await cal();
    expect(d.pays.filter((p) => p.booking_id === r.id && p.kind === 'back')).toEqual([]);
    expect(d.bookings.find((x) => x.id === r.id)).toMatchObject({ status: 'option', cancel_money: null, kept_usd: null });
  });
});
