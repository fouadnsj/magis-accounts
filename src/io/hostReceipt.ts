// The receipt of a group — «وصل استلام» (Fouad, 22 November 2026; never called an invoice): a PDF with the Jesuit logo and the centre's logo, the group, what was
// booked (the period, the rooms, the equipment), the lines with their amounts, the total in each currency, the payments
// received and what is still due. Arabic and English labels. The Arabic font of the project has no Latin letters or digits,
// so a text is cut into Arabic runs (written with that font, shaped and in the right order) and the rest (Helvetica).
import { stayAmount, type Currency, type HostBooking, type Totals } from '../hosting/host';
import { amountWords } from '../hosting/words';
import { newCanvas, pdfDay as day, pdfMoney as money, type HouseLook } from './pdfCanvas';

/** a line of the receipt: the amount is the quantity times the price of one */
export interface ReceiptRow { label: string; /** a small line under it (e.g. "18 people x 3 nights") */ sub?: string; qty: number; unit: number; currency: Currency }
export const rowAmount = (r: Pick<ReceiptRow, 'qty' | 'unit'>) => Math.round((Number(r.qty) || 0) * (Number(r.unit) || 0) * 100) / 100;

/** a receipt shown in one currency only: every amount in `to`, at `rate` = how many SYP are 1 USD */
export interface ReceiptConversion { to: Currency; rate: number }
export const convertAmount = (v: number, from: Currency, c: ReceiptConversion) =>
  from === c.to ? v : c.to === 'SYP' ? Math.round(v * c.rate) : Math.round((v / c.rate) * 100) / 100;
/** the lines and the payments in the one currency (a price is converted, then multiplied, so the lines still add up); `changed` = something was converted */
export function convertReceipt<P extends { amount: number; currency: Currency }>(rows: ReceiptRow[], payments: P[], c: ReceiptConversion) {
  return {
    rows: rows.map((r) => (r.currency === c.to ? r : { ...r, unit: convertAmount(r.unit, r.currency, c), currency: c.to })),
    payments: payments.map((p) => (p.currency === c.to ? p : { ...p, amount: convertAmount(p.amount, p.currency, c), currency: c.to })),
    changed: rows.some((r) => r.currency !== c.to && rowAmount(r) !== 0) || payments.some((p) => p.currency !== c.to && p.amount !== 0),
  };
}

/** what the receipt comes to in each currency, what was paid, and what is still due */
export function receiptTotals(rows: ReceiptRow[], payments: { amount: number; currency: Currency }[]) {
  const total: Totals = { USD: 0, SYP: 0 }, paid: Totals = { USD: 0, SYP: 0 };
  for (const r of rows) total[r.currency] += rowAmount(r);
  for (const p of payments) paid[p.currency] += p.amount;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { total: { USD: r2(total.USD), SYP: r2(total.SYP) }, paid: { USD: r2(paid.USD), SYP: r2(paid.SYP) }, due: { USD: r2(total.USD - paid.USD), SYP: r2(total.SYP - paid.SYP) } };
}

/** the lines a receipt starts with, from the booking: the stay (or the hall) and each service line */
export function initialRows(b: Pick<HostBooking, 'kind' | 'people' | 'price_mode' | 'rate' | 'currency' | 'from_day' | 'to_day' | 'repeat_days'>, nights: number, lines: { label: string; qty: number; amount: number; currency: Currency }[]): ReceiptRow[] {
  const ev = b.kind === 'event';
  const rows: ReceiptRow[] = [];
  if (b.rate != null && b.price_mode) {
    const what = ev ? 'Hall rental · إيجار القاعة' : 'Accommodation · الإقامة';
    if (b.price_mode === 'group') rows.push({ label: `${what} (fixed price)`, qty: 1, unit: stayAmount({ ...b, price_mode: 'group', rate: b.rate }), currency: b.currency });
    else rows.push({ label: what, sub: `${b.people} people x ${nights} ${ev ? 'day(s)' : 'night(s)'}`, qty: b.people * nights, unit: b.rate, currency: b.currency });
  }
  for (const l of lines) rows.push({ label: l.label, qty: l.qty, unit: l.qty > 0 ? Math.round((l.amount / l.qty) * 100) / 100 : l.amount, currency: l.currency });
  return rows;
}

/** everything the receipt shows (the window lets it be adjusted before it is written) */
export interface ReceiptDoc {
  organisation: string;
  /** the Arabic line under the name (empty: "Society of Jesus · الرهبنة اليسوعية") */
  titleAr?: string;
  /** PNG bytes: the Jesuits' logo and the centre's */
  logos: { jesuit?: Uint8Array | null; centre?: Uint8Array | null };
  /** TrueType files of Amiri (regular and bold) */
  fonts: { arabic: Uint8Array; arabicBold: Uint8Array };
  /** the accent colour of the centre (#rrggbb) */
  accent?: string;
  issuedOn: string;
  ref: string;
  kind: 'stay' | 'event';
  billedTo: { name: string; contact: string; phone: string };
  from_day: string;
  to_day: string;
  people: number;
  /** nights of a stay, days or sessions of an event */
  nights: number;
  repeats: boolean;
  /** "Guest house · Room 1 (2 beds)" … (empty: not shown) */
  rooms: string[];
  /** "Video projector x 1" … (empty: not shown) */
  equipment: string[];
  rows: ReceiptRow[];
  /** the payments received that are counted (empty: none shown) */
  payments: { paid_on: string; receipt_no: string; amount: number; currency: Currency }[];
  /** set when the amounts were converted to one currency: a line at the foot gives the rate */
  conversion?: ReceiptConversion;
  /** a line printed at the foot (bank details, a thank-you, a condition…) */
  note: string;
  /** printed before: the mark "copy" (calendar step 4) */
  copy?: boolean;
}


export async function receiptPdf(x: ReceiptDoc): Promise<Uint8Array> {
  const c = await newCanvas(x, { title: `Receipt ${x.ref}` });
  const { W, M, put, wrap, rule } = c;
  await c.head();

  // ---- title and reference
  put('RECEIPT  ·  وصل استلام', M, c.y, 15, { bold: true, color: c.accent });
  put(`Date · التاريخ:  ${day(x.issuedOn)}`, W - M, c.y + 8, 10, { align: 'right' });
  if (x.ref) put(`Ref · المرجع:  ${x.ref}`, W - M, c.y - 6, 10, { align: 'right', color: c.muted });
  c.y -= 34;

  // ---- billed to, and the period
  const ev = x.kind === 'event';
  const boxTop = c.y;
  put('Billed to · إلى', M + 10, c.y - 14, 8.5, { bold: true, color: c.muted });
  put(x.billedTo.name, M + 10, c.y - 31, 13, { bold: true });
  let by = c.y - 46;
  if (x.billedTo.contact) { put(x.billedTo.contact, M + 10, by, 10); by -= 14; }
  if (x.billedTo.phone) { put(x.billedTo.phone, M + 10, by, 10, { color: c.muted }); by -= 14; }
  const colX = W / 2 + 6;
  put(ev ? 'Days · الأيام' : 'Stay · الإقامة', colX, c.y - 14, 8.5, { bold: true, color: c.muted });
  put(x.from_day === x.to_day ? day(x.from_day) : `${day(x.from_day)}  -  ${day(x.to_day)}`, colX, c.y - 31, 12, { bold: true });
  put(`${x.nights} ${ev ? (x.repeats ? 'session(s) · جلسة' : 'day(s) · يوم') : 'night(s) · ليلة'}   ·   ${x.people} people · شخصاً`, colX, c.y - 46, 10);
  c.y = Math.min(by, c.y - 54) - 6;
  c.page.drawRectangle({ x: M, y: c.y, width: W - 2 * M, height: boxTop - c.y, borderColor: c.line, borderWidth: 0.8 });
  c.y -= 16;

  // rooms and equipment: what was provided
  const para = (label: string, items: string[]) => {
    if (!items.length) return;
    put(label, M, c.y, 8.5, { bold: true, color: c.muted });
    c.y -= 13;
    for (const l of wrap(items.join('   ·   '), W - 2 * M, 10)) { c.ensure(14); put(l, M, c.y, 10); c.y -= 13.5; }
    c.y -= 4;
  };
  para('Rooms · الغرف', x.rooms);
  para('Equipment provided · التجهيزات', x.equipment);
  c.y -= 6;

  // ---- the lines
  const cQty = W - M - 175, cUnit = W - M - 95, cAmt = W - M;
  const header = () => {
    c.page.drawRectangle({ x: M, y: c.y - 6, width: W - 2 * M, height: 21, color: c.tint });
    put('Description · البيان', M + 8, c.y, 9, { bold: true, color: c.accent });
    put('Qty · العدد', cQty, c.y, 9, { bold: true, align: 'right', color: c.accent });
    put('Price · السعر', cUnit, c.y, 9, { bold: true, align: 'right', color: c.accent });
    put('Amount · المبلغ', cAmt - 6, c.y, 9, { bold: true, align: 'right', color: c.accent });
    c.y -= 22;
  };
  header();
  c.onNewPage = header;
  const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  const rows = x.rows.filter((r) => r.label.trim() || r.qty || r.unit);
  if (!rows.length) { put('No amount. · لا مبلغ', M + 8, c.y, 10, { color: c.muted }); c.y -= 20; }
  for (const r of rows) {
    const ls = wrap(r.label, cQty - M - 60, 10);
    c.ensure(14 * (ls.length + 1) + 8);
    ls.forEach((l, i) => put(l, M + 8, c.y - i * 13, 10));
    put(num(r.qty), cQty, c.y, 10, { align: 'right' });
    put(money(r.unit, r.currency), cUnit, c.y, 10, { align: 'right' });
    put(money(rowAmount(r), r.currency), cAmt - 6, c.y, 10, { align: 'right', bold: true });
    let used = ls.length * 13;
    if (r.sub) { put(r.sub, M + 8, c.y - used, 8.5, { color: c.muted }); used += 11; }
    const bottom = c.y - used - 4;
    rule(bottom);
    c.y = bottom - 15;
  }
  c.onNewPage = undefined;
  c.y -= 8;

  // ---- totals, payments, what is still due
  const { total, paid, due } = receiptTotals(rows, x.payments);
  const currencies = (['USD', 'SYP'] as Currency[]).filter((k) => total[k] || paid[k]);
  const totalLine = (label: string, val: (k: Currency) => number, bold = false, color = c.ink, only?: (k: Currency) => boolean) => {
    for (const k of currencies.filter((q) => !only || only(q))) { c.ensure(18); put(label, cUnit - 20, c.y, bold ? 11 : 10, { align: 'right', bold, color }); put(money(val(k), k), cAmt - 6, c.y, bold ? 11 : 10, { align: 'right', bold, color }); c.y -= 16; }
  };
  totalLine('Total · المجموع', (k) => total[k], true);
  if (x.payments.length) {
    c.y -= 6;
    c.ensure(30 + x.payments.length * 14);
    put('Payments received · الدفعات المقبوضة', M, c.y, 8.5, { bold: true, color: c.muted });
    c.y -= 14;
    for (const p of x.payments) { c.ensure(14); put(day(p.paid_on), M + 8, c.y, 9.5); put(p.receipt_no, M + 90, c.y, 9.5, { color: c.muted }); put(money(p.amount, p.currency), cAmt - 6, c.y, 9.5, { align: 'right' }); c.y -= 13.5; }
    c.y -= 4;
    totalLine('Paid · المدفوع', (k) => paid[k], false, c.ink, (k) => paid[k] > 0);
    c.y -= 4;
    rule(c.y + 10, c.accent);
    totalLine('Balance due · المتبقي', (k) => due[k], true, c.accent);
  }
  // the amount in words (Arabic and English): what was received when there are payments, else the total
  const inWords = x.payments.length ? paid : total;
  for (const k of currencies.filter((q) => inWords[q] > 0)) {
    const w = amountWords(inWords[k], k);
    c.y -= 6;
    c.ensure(34);
    put(x.payments.length ? 'Received in words · المقبوض كتابةً' : 'In words · كتابةً', M, c.y, 8.5, { bold: true, color: c.muted });
    c.y -= 13;
    put(w.ar, W - M, c.y, 10.5, { align: 'right' });
    c.y -= 13;
    for (const l of wrap(w.en, W - 2 * M, 9.5)) { put(l, M, c.y, 9.5, { color: c.muted }); c.y -= 12; }
  }

  if (x.conversion) {
    const rt = x.conversion.rate.toLocaleString('en-US', { maximumFractionDigits: 4 });
    c.y -= 10;
    c.ensure(14);
    put(`Rate · سعر الصرف:  1 USD = ${rt} SYP`, M, c.y, 9, { color: c.muted });
    c.y -= 12.5;
  }

  // ---- a note, the places to sign, then the foot of every page
  if (x.note.trim()) {
    c.y -= 10;
    for (const l of wrap(x.note.trim(), W - 2 * M, 9.5)) { c.ensure(13); put(l, M, c.y, 9.5, { color: c.muted }); c.y -= 12.5; }
  }
  c.signatures('Received by · المستلم', 'Paid by · الدافع');
  const keep = c.page;
  for (const p of c.pdf.getPages()) { c.page = p; put('Thank you · شكراً لكم', W / 2, M + 4, 10, { align: 'center', color: c.muted }); }
  c.page = keep;
  c.foot(`${x.organisation}  ·  ${day(x.issuedOn)}`);
  if (x.copy) c.copyMark();
  return c.save();
}

/** the receipt of ONE payment (calendar step 4): its number is the one the books carry */
export interface PayReceiptDoc extends HouseLook {
  receipt_no: string;
  paid_on: string;
  amount: number;
  currency: Currency;
  method: string;
  /** who paid: the group or organisation, the person */
  from: { name: string; person: string; phone: string };
  /** for what: the booking's code, name, days and spaces */
  booking: { code: string; name: string; days: string; spaces: string };
  /** after this payment, what the booking still owes (null: not shown) */
  due: Totals | null;
  copy: boolean;
}
export async function payReceiptPdf(x: PayReceiptDoc): Promise<Uint8Array> {
  const c = await newCanvas(x, { title: `Receipt ${x.receipt_no}` });
  const { W, M, put, wrap } = c;
  await c.head();
  put('RECEIPT  ·  وصل استلام', M, c.y, 16, { bold: true, color: c.accent });
  put(`No. · رقم:  ${x.receipt_no}`, W - M, c.y + 8, 11, { align: 'right', bold: true });
  put(`Date · التاريخ:  ${day(x.paid_on)}`, W - M, c.y - 7, 10, { align: 'right' });
  c.y -= 40;
  const row = (label: string, value: string, size = 11, bold = false) => {
    if (!value) return;
    put(label, M, c.y, 9, { bold: true, color: c.muted });
    const ls = wrap(value, W - 2 * M - 150, size, bold);
    ls.forEach((l, i) => put(l, M + 150, c.y - i * (size + 3), size, { bold }));
    c.y -= ls.length * (size + 3) + 9;
  };
  row('Received from · استلمنا من', x.from.name, 12, true);
  row('Person · الشخص', [x.from.person, x.from.phone].filter(Boolean).join('  ·  '));
  // the amount: big, in a box, then in words
  const boxTop = c.y + 4;
  c.page.drawRectangle({ x: M, y: c.y - 74, width: W - 2 * M, height: 78, color: c.tint, borderColor: c.line, borderWidth: 0.8 });
  put('Amount · المبلغ', M + 12, c.y - 16, 9, { bold: true, color: c.muted });
  put(money(x.amount, x.currency), W - M - 12, c.y - 20, 20, { bold: true, align: 'right', color: c.accent });
  const w = amountWords(x.amount, x.currency);
  put(w.ar, W - M - 12, c.y - 44, 11, { align: 'right' });
  put(c.fit(w.en, W - 2 * M - 24, 10), M + 12, c.y - 62, 10, { color: c.muted });
  c.y = boxTop - 78 - 22;
  const how: Record<string, string> = { cash: 'Cash · نقداً', transfer: 'Transfer · حوالة', other: 'Other · غير ذلك' };
  row('Paid by · طريقة الدفع', how[x.method] ?? x.method);
  row('For · مقابل', `${x.booking.name}  ·  ${x.booking.code}`);
  row('Days · الأيام', x.booking.days);
  row('Spaces · الأماكن', x.booking.spaces);
  if (x.due) {
    const left = (['USD', 'SYP'] as Currency[]).filter((k) => x.due![k] > 0).map((k) => money(x.due![k], k)).join('  +  ');
    row('Still due · المتبقي', left || 'Nothing · لا شيء');
  }
  c.signatures('Received by · المستلم', 'Paid by · الدافع');
  c.foot(`${x.organisation}  ·  ${x.receipt_no}`);
  if (x.copy) c.copyMark();
  return c.save();
}
