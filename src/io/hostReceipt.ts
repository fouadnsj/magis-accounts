// The receipt of a group — «وصل استلام» (Fouad, 22 November 2026; never called an invoice): a PDF with the Jesuit logo and the centre's logo, the group, what was
// booked (the period, the rooms, the equipment), the lines with their amounts, the total in each currency, the payments
// received and what is still due. Arabic and English labels. The Arabic font of the project has no Latin letters or digits,
// so a text is cut into Arabic runs (written with that font, shaped and in the right order) and the rest (Helvetica).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { stayAmount, type Currency, type HostBooking, type Totals } from '../hosting/host';

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
}

// ---------------------------------------------------------------- text: Arabic runs and the rest, in the right visual order

const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const NEUTRAL_ONLY = /^[\s.,:;!?()\-–—/"'·•|]+$/;
interface Run { text: string; ar: boolean }
/** the little of fontkit that is used here */
interface FkFont { unitsPerEm: number; layout(text: string): { glyphs: { path?: { commands: unknown[]; transform(a: number, b: number, c: number, d: number, e: number, f: number): { toSVG(): string } } }[]; positions: { xAdvance: number; xOffset: number; yOffset: number }[] } }

function runsOf(text: string): Run[] {
  const raw: Run[] = [];
  for (const ch of text) {
    const ar = AR.test(ch);
    const last = raw[raw.length - 1];
    if (last && last.ar === ar) last.text += ch; else raw.push({ text: ch, ar });
  }
  // spaces and punctuation between two Arabic runs belong to the Arabic
  const joined = raw.map((r, i) => (!r.ar && NEUTRAL_ONLY.test(r.text) && raw[i - 1]?.ar && raw[i + 1]?.ar ? { text: r.text, ar: true } : r));
  const out: Run[] = [];
  for (const r of joined) { const l = out[out.length - 1]; if (l && l.ar === r.ar) l.text += r.text; else out.push({ ...r }); }
  return out;
}
/** an Arabic text reads from the right: the runs are laid out in the opposite order */
const rtl = (text: string) => { for (const ch of text) { if (AR.test(ch)) return true; if (/[A-Za-z0-9]/.test(ch)) return false; } return false; };
/** what Helvetica (WinAnsi) can write */
const win = (s: string) => s.replace(/→/g, '-').replace(/×/g, 'x').replace(/[^ -~ -ÿ–—‘’“”•€…]/g, '?');

const money = (n: number, c: Currency) => (c === 'SYP' ? `SYP ${Math.round(n).toLocaleString('en-US')}` : `USD ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const hex = (h: string | undefined) => { const m = /^#?([0-9a-f]{6})$/i.exec(h ?? ''); const v = m ? parseInt(m[1], 16) : 0x5a1a1a; return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); };

export async function receiptPdf(x: ReceiptDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`Receipt ${x.ref}`);
  pdf.setCreator('MAGIS Accounts');
  const lat = await pdf.embedFont(StandardFonts.Helvetica);
  const latB = await pdf.embedFont(StandardFonts.HelveticaBold);
  // The Arabic is drawn by this program, glyph by glyph, as vector shapes: the font's own engine joins the letters and
  // places each one (Amiri moves letters with positioning rules that a PDF text string cannot carry)
  const fk = [fontkit.create(x.fonts.arabic), fontkit.create(x.fonts.arabicBold)] as unknown as FkFont[];
  const accent = hex(x.accent);
  const ink = rgb(0.13, 0.12, 0.11), muted = rgb(0.42, 0.4, 0.37), line = rgb(0.85, 0.82, 0.76), tint = rgb(0.97, 0.95, 0.9);

  const W = 595.28, H = 841.89, M = 42;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const latOf = (bold: boolean): PDFFont => (bold ? latB : lat);
  const arWidth = (text: string, size: number, bold: boolean) => { const f = fk[bold ? 1 : 0]; return f.layout(text).positions.reduce((n, p) => n + p.xAdvance, 0) * (size / f.unitsPerEm); };
  const runWidth = (r: Run, size: number, bold: boolean) => (r.ar ? arWidth(r.text, size, bold) : latOf(bold).widthOfTextAtSize(win(r.text), size));
  const widthOf = (text: string, size: number, bold = false) => runsOf(text).reduce((n, r) => n + runWidth(r, size, bold), 0);
  /** one Arabic run: its glyphs, in the order they stand on the line, each a vector shape at the font's own position */
  const drawArabic = (text: string, cx: number, py: number, size: number, bold: boolean, color: ReturnType<typeof rgb>) => {
    const f = fk[bold ? 1 : 0];
    const sc = size / f.unitsPerEm;
    const run = f.layout(text);
    let gx = cx;
    run.glyphs.forEach((g, i) => {
      const pos = run.positions[i];
      const path = g.path;
      if (path && path.commands.length) page.drawSvgPath(path.transform(1, 0, 0, -1, 0, 0).toSVG(), { x: gx + pos.xOffset * sc, y: py - pos.yOffset * sc, scale: sc, color, borderWidth: 0 });
      gx += pos.xAdvance * sc;
    });
  };
  /** writes a text at x (left), or ending at x (right), or centred on x */
  const put = (text: string, px: number, py: number, size: number, o: { bold?: boolean; align?: 'left' | 'right' | 'center'; color?: ReturnType<typeof rgb> } = {}) => {
    if (!text) return;
    const runs = runsOf(text);
    const ordered = rtl(text) ? [...runs].reverse() : runs;
    const total = widthOf(text, size, o.bold);
    let cx = o.align === 'right' ? px - total : o.align === 'center' ? px - total / 2 : px;
    for (const r of ordered) {
      const col = o.color ?? ink;
      if (r.ar) drawArabic(r.text, cx, py, size, !!o.bold, col);
      else page.drawText(win(r.text), { x: cx, y: py, size, font: latOf(!!o.bold), color: col });
      cx += runWidth(r, size, !!o.bold);
    }
  };
  const wrap = (text: string, maxW: number, size: number, bold = false): string[] => {
    const out: string[] = [];
    let cur = '';
    for (const w of text.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && widthOf(next, size, bold) > maxW) { out.push(cur); cur = w; } else cur = next;
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  const rule = (yy: number, color = line) => page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 0.7, color });
  const ensure = (need: number, redraw?: () => void) => { if (y - need < M + 30) { page = pdf.addPage([W, H]); y = H - M; redraw?.(); } };

  // ---- the two logos and the name of the house
  const png = async (b?: Uint8Array | null): Promise<PDFImage | null> => { try { return b ? await pdf.embedPng(b) : null; } catch { return null; } };
  const [lj, lc] = [await png(x.logos.jesuit), await png(x.logos.centre)];
  const fit = (img: PDFImage, maxH: number, maxW: number) => { const s = Math.min(maxH / img.height, maxW / img.width); return { w: img.width * s, h: img.height * s }; };
  const top = y;
  let hMax = 0;
  if (lj) { const d = fit(lj, 58, 120); page.drawImage(lj, { x: M, y: top - d.h, width: d.w, height: d.h }); hMax = Math.max(hMax, d.h); }
  if (lc) { const d = fit(lc, 58, 120); page.drawImage(lc, { x: W - M - d.w, y: top - d.h, width: d.w, height: d.h }); hMax = Math.max(hMax, d.h); }
  put(x.organisation, W / 2, top - 22, 15, { bold: true, align: 'center', color: accent });
  put('Society of Jesus  ·  الرهبنة اليسوعية', W / 2, top - 38, 9.5, { align: 'center', color: muted });
  y = top - Math.max(hMax, 44) - 16;
  rule(y, accent);
  y -= 30;

  // ---- title and reference
  put('RECEIPT  ·  وصل استلام', M, y, 22, { bold: true, color: accent });
  put(`Date · التاريخ:  ${day(x.issuedOn)}`, W - M, y + 8, 10, { align: 'right' });
  if (x.ref) put(`Ref · المرجع:  ${x.ref}`, W - M, y - 6, 10, { align: 'right', color: muted });
  y -= 34;

  // ---- billed to, and the period
  const ev = x.kind === 'event';
  const boxTop = y;
  put('Billed to · إلى', M + 10, y - 14, 8.5, { bold: true, color: muted });
  put(x.billedTo.name, M + 10, y - 31, 13, { bold: true });
  let by = y - 46;
  if (x.billedTo.contact) { put(x.billedTo.contact, M + 10, by, 10); by -= 14; }
  if (x.billedTo.phone) { put(x.billedTo.phone, M + 10, by, 10, { color: muted }); by -= 14; }
  const colX = W / 2 + 6;
  put(ev ? 'Days · الأيام' : 'Stay · الإقامة', colX, y - 14, 8.5, { bold: true, color: muted });
  put(x.from_day === x.to_day ? day(x.from_day) : `${day(x.from_day)}  -  ${day(x.to_day)}`, colX, y - 31, 12, { bold: true });
  put(`${x.nights} ${ev ? (x.repeats ? 'session(s) · جلسة' : 'day(s) · يوم') : 'night(s) · ليلة'}   ·   ${x.people} people · شخصاً`, colX, y - 46, 10);
  y = Math.min(by, y - 54) - 6;
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: boxTop - y, borderColor: line, borderWidth: 0.8 });
  y -= 16;

  // rooms and equipment: what was provided
  const para = (label: string, items: string[]) => {
    if (!items.length) return;
    put(label, M, y, 8.5, { bold: true, color: muted });
    y -= 13;
    for (const l of wrap(items.join('   ·   '), W - 2 * M, 10)) { ensure(14); put(l, M, y, 10); y -= 13.5; }
    y -= 4;
  };
  para('Rooms · الغرف', x.rooms);
  para('Equipment provided · التجهيزات', x.equipment);
  y -= 6;

  // ---- the lines
  const cQty = W - M - 175, cUnit = W - M - 95, cAmt = W - M;
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 21, color: tint });
    put('Description · البيان', M + 8, y, 9, { bold: true, color: accent });
    put('Qty · العدد', cQty, y, 9, { bold: true, align: 'right', color: accent });
    put('Price · السعر', cUnit, y, 9, { bold: true, align: 'right', color: accent });
    put('Amount · المبلغ', cAmt - 6, y, 9, { bold: true, align: 'right', color: accent });
    y -= 22;
  };
  header();
  const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  const rows = x.rows.filter((r) => r.label.trim() || r.qty || r.unit);
  if (!rows.length) { put('No amount. · لا مبلغ', M + 8, y, 10, { color: muted }); y -= 20; }
  for (const r of rows) {
    const ls = wrap(r.label, cQty - M - 60, 10);
    ensure(14 * (ls.length + 1) + 8, header);
    ls.forEach((l, i) => put(l, M + 8, y - i * 13, 10));
    put(num(r.qty), cQty, y, 10, { align: 'right' });
    put(money(r.unit, r.currency), cUnit, y, 10, { align: 'right' });
    put(money(rowAmount(r), r.currency), cAmt - 6, y, 10, { align: 'right', bold: true });
    let used = ls.length * 13;
    if (r.sub) { put(r.sub, M + 8, y - used, 8.5, { color: muted }); used += 11; }
    const bottom = y - used - 4;
    rule(bottom);
    y = bottom - 15;
  }
  y -= 8;

  // ---- totals, payments, what is still due
  const { total, paid, due } = receiptTotals(rows, x.payments);
  const currencies = (['USD', 'SYP'] as Currency[]).filter((c) => total[c] || paid[c]);
  const totalLine = (label: string, val: (c: Currency) => number, bold = false, color = ink, only?: (c: Currency) => boolean) => {
    for (const c of currencies.filter((k) => !only || only(k))) { ensure(18); put(label, cUnit - 20, y, bold ? 11 : 10, { align: 'right', bold, color }); put(money(val(c), c), cAmt - 6, y, bold ? 11 : 10, { align: 'right', bold, color }); y -= 16; }
  };
  totalLine('Total · المجموع', (c) => total[c], true);
  if (x.payments.length) {
    y -= 6;
    ensure(30 + x.payments.length * 14);
    put('Payments received · الدفعات المقبوضة', M, y, 8.5, { bold: true, color: muted });
    y -= 14;
    for (const p of x.payments) { ensure(14); put(day(p.paid_on), M + 8, y, 9.5); put(p.receipt_no, M + 90, y, 9.5, { color: muted }); put(money(p.amount, p.currency), cAmt - 6, y, 9.5, { align: 'right' }); y -= 13.5; }
    y -= 4;
    totalLine('Paid · المدفوع', (c) => paid[c], false, ink, (c) => paid[c] > 0);
    y -= 4;
    rule(y + 10, accent);
    totalLine('Balance due · المتبقي', (c) => due[c], true, accent);
  }

  if (x.conversion) {
    const rt = x.conversion.rate.toLocaleString('en-US', { maximumFractionDigits: 4 });
    y -= 10;
    ensure(14);
    put(`Rate · سعر الصرف:  1 USD = ${rt} SYP`, M, y, 9, { color: muted });
    y -= 12.5;
  }

  // ---- a note, then the foot of every page
  if (x.note.trim()) {
    y -= 10;
    for (const l of wrap(x.note.trim(), W - 2 * M, 9.5)) { ensure(13); put(l, M, y, 9.5, { color: muted }); y -= 12.5; }
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    put('Thank you · شكراً لكم', W / 2, M + 4, 10, { align: 'center', color: muted });
    put(`${x.organisation}  ·  ${day(x.issuedOn)}${pages.length > 1 ? `  ·  ${i + 1}/${pages.length}` : ''}`, W / 2, M - 10, 8, { align: 'center', color: muted });
  });
  return pdf.save();
}
