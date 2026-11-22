// The receipt — «وصل استلام» — of a group (22 November 2026): its lines and totals, and the PDF.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { convertReceipt, initialRows, receiptPdf, receiptTotals, rowAmount, type ReceiptDoc } from '../src/io/hostReceipt';

const pub = (p: string) => new Uint8Array(fs.readFileSync(new URL('../public/' + p, import.meta.url)));
const bk = { kind: 'stay' as const, people: 18, price_mode: 'person' as const, rate: 10, currency: 'USD' as const, from_day: '2027-01-20', to_day: '2027-01-23', repeat_days: null };
const doc = (o: Partial<ReceiptDoc> = {}): ReceiptDoc => ({
  organisation: 'MAGIS Homs · ماجيس حمص', logos: { jesuit: pub('brand/jesuits.png'), centre: pub('brand/mark-homs.png') }, fonts: { arabic: pub('fonts/amiri-arabic-400.ttf'), arabicBold: pub('fonts/amiri-arabic-700.ttf') },
  accent: '#870d0d', issuedOn: '2026-11-22', ref: 'HB-2027-0006', kind: 'stay', billedTo: { name: 'Parish retreat', contact: 'Fadi', phone: '0955 444 333' },
  from_day: '2027-01-20', to_day: '2027-01-23', people: 18, nights: 3, repeats: false, rooms: ['school · Main hall'], equipment: ['Video projector x 1'],
  rows: initialRows(bk, 3, [{ label: 'Lunch', qty: 18, amount: 90, currency: 'USD' }]), payments: [], note: '', ...o,
});

describe('the lines and totals of a receipt', () => {
  it('the stay is people × nights × the rate; a service line keeps its quantity and its price of one', () => {
    const rows = initialRows(bk, 3, [{ label: 'Lunch', qty: 18, amount: 90, currency: 'USD' }, { label: 'Heating', qty: 1, amount: 300000, currency: 'SYP' }]);
    expect(rows[0]).toMatchObject({ qty: 54, unit: 10, currency: 'USD' });
    expect(rowAmount(rows[0])).toBe(540);
    expect(rows[1]).toMatchObject({ label: 'Lunch', qty: 18, unit: 5 });
    expect(rows[2]).toMatchObject({ qty: 1, unit: 300000, currency: 'SYP' });
  });
  it('a fixed price for the group is one line; a booking with no price starts with its services only', () => {
    expect(initialRows({ ...bk, price_mode: 'group', rate: 500 }, 3, [])).toEqual([{ label: 'Accommodation · الإقامة (fixed price)', qty: 1, unit: 500, currency: 'USD' }]);
    expect(initialRows({ ...bk, price_mode: null, rate: null }, 3, [{ label: 'Lunch', qty: 2, amount: 10, currency: 'USD' }]).map((r) => r.label)).toEqual(['Lunch']);
  });
  it('adjusting the people, the nights or the meals changes the amounts; totals, payments and the balance are per currency', () => {
    const rows = initialRows(bk, 3, [{ label: 'Lunch', qty: 18, amount: 90, currency: 'USD' }, { label: 'Heating', qty: 1, amount: 300000, currency: 'SYP' }]);
    // 15 people, 2 nights, 30 lunches at the same price
    const adjusted = rows.map((r, i) => (i === 0 ? { ...r, qty: 15 * 2 } : r.label === 'Lunch' ? { ...r, qty: 30 } : r));
    const t = receiptTotals(adjusted, [{ amount: 100, currency: 'USD' }, { amount: 50000, currency: 'SYP' }]);
    expect(t.total).toEqual({ USD: 300 + 150, SYP: 300000 });
    expect(t.paid).toEqual({ USD: 100, SYP: 50000 });
    expect(t.due).toEqual({ USD: 350, SYP: 250000 });
    expect(rowAmount({ qty: 3, unit: 0.1 })).toBe(0.3);
  });
});

describe('the PDF', () => {
  it('is written with the Arabic title and both logos, and can be read back', async () => {
    const bytes = await receiptPdf(doc({ payments: [{ paid_on: '2027-01-10', receipt_no: 'H2027-0001', amount: 200, currency: 'USD' }], note: 'الدفع نقداً في المركز · Payment by cash at the centre.' }));
    const back = await PDFDocument.load(bytes);
    expect(back.getPageCount()).toBe(1);
    expect(back.getTitle()).toBe('Receipt HB-2027-0006');
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 8))).toContain('%PDF');
  });
  it('an Arabic group, an event in a hall, no payments, no logos: still written', async () => {
    const bytes = await receiptPdf(doc({ kind: 'event', logos: {}, billedTo: { name: 'رعية القديس يوسف', contact: 'الأب سمير', phone: '0933 222 111' }, rooms: ['مدرسة · القاعة الكبرى'], equipment: ['جهاز عرض × 1'], rows: [{ label: 'إيجار القاعة', qty: 1, unit: 150, currency: 'USD' }] }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it('many lines go on to more pages', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({ label: `Line ${i + 1} · بند ${i + 1}`, qty: 2, unit: 3, currency: 'USD' as const }));
    const back = await PDFDocument.load(await receiptPdf(doc({ rows })));
    expect(back.getPageCount()).toBeGreaterThan(1);
  });
  it('one currency for the whole receipt: prices are converted, lines still add up, a PDF is written', async () => {
    const rows = [{ label: 'Stay', qty: 54, unit: 10, currency: 'USD' as const }, { label: 'Fuel', qty: 1, unit: 130000, currency: 'SYP' as const }];
    const pays = [{ paid_on: '2026-11-20', receipt_no: 'H2027-0001', amount: 200, currency: 'USD' as const }];
    const toSyp = convertReceipt(rows, pays, { to: 'SYP', rate: 13000 });
    expect(toSyp.rows.map((r) => r.currency)).toEqual(['SYP', 'SYP']);
    expect(toSyp.rows[0].unit).toBe(130000);
    expect(receiptTotals(toSyp.rows, toSyp.payments).total.SYP).toBe(54 * 130000 + 130000);
    expect(receiptTotals(toSyp.rows, toSyp.payments).paid.SYP).toBe(2600000);
    expect(toSyp.changed).toBe(true);
    const toUsd = convertReceipt(rows, pays, { to: 'USD', rate: 13000 });
    expect(receiptTotals(toUsd.rows, toUsd.payments).total).toEqual({ USD: 550, SYP: 0 });
    expect(convertReceipt([rows[0]], [], { to: 'USD', rate: 13000 }).changed).toBe(false);
    const bytes = await receiptPdf(doc({ rows: toSyp.rows, payments: toSyp.payments, conversion: { to: 'SYP', rate: 13000 } }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
