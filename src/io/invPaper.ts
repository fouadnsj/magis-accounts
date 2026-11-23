// The inventory's printed pages (baseline 1.1, sections 5 and 8, step 4), in the look of the house (the two logos, Arabic and
// English on every page): the sheet of a space to put on its door (what is in it, no values), a list for counting space by
// space, and the report for a donor: what a project bought, with photos, spaces and values (a PDF, and an Excel).
import ExcelJS from 'exceljs';
import type { PDFImage } from 'pdf-lib';
import { newCanvas, pdfDay, type Canvas, type HouseLook } from './pdfCanvas';
import type { InvCategory, InvItem } from '../inventory/inv';
import type { ProjectReport, ReportRow } from '../inventory/report';

const cat = (categories: Pick<InvCategory, 'id' | 'name'>[], id: number | null) => categories.find((c) => c.id === id)?.name ?? '';
const COND: Record<string, string> = { good: 'Good · جيد', repair: 'Needs repair · يحتاج إصلاحاً', broken: 'Broken · معطّل' };
const usd = (n: number | null) => (n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

interface Col { title: string; w: number; align?: 'left' | 'right'; get: (i: number) => string }

/** a table: its header again on each new page; `rowH` for rows that carry a picture */
function table(c: Canvas, cols: Col[], n: number, o: { rowH?: number; size?: number; before?: (i: number, y: number) => void } = {}) {
  const { M, put } = c;
  const size = o.size ?? 9, rowH = o.rowH ?? size + 7;
  const x0: number[] = [];
  cols.reduce((x, k) => { x0.push(x); return x + k.w; }, M);
  const header = () => {
    c.page.drawRectangle({ x: M, y: c.y - 5, width: cols.reduce((s, k) => s + k.w, 0), height: 17, color: c.tint });
    cols.forEach((k, j) => put(k.title, k.align === 'right' ? x0[j] + k.w - 4 : x0[j] + 3, c.y, 7.5, { bold: true, color: c.muted, align: k.align === 'right' ? 'right' : 'left' }));
    c.y -= 20;
  };
  c.onNewPage = header;
  header();
  for (let i = 0; i < n; i++) {
    c.ensure(rowH + 4);
    const top = c.y;
    o.before?.(i, top);
    cols.forEach((k, j) => {
      const text = c.fit(k.get(i), k.w - 7, size);
      put(text, k.align === 'right' ? x0[j] + k.w - 4 : x0[j] + 3, top - (o.rowH ? rowH / 2 - size / 2 + 2 : 0) - 1, size, { align: k.align === 'right' ? 'right' : 'left' });
    });
    c.rule(top - rowH + (o.rowH ? 10 : 5), c.line);
    c.y -= rowH;
  }
  c.onNewPage = undefined;
}

// ------------------------------------------------------------------ the sheet of a space, for its door

export async function spaceSheetPdf(look: HouseLook, a: { space: string; area: string; items: InvItem[]; categories: Pick<InvCategory, 'id' | 'name'>[]; lastCount: string | null; fixed: string | null }, issuedOn: string): Promise<Uint8Array> {
  const c = await newCanvas(look, { title: `Inventory · ${a.space}` });
  const { W, M, put } = c;
  await c.head();
  put('WHAT IS IN THIS ROOM  ·  محتويات هذا المكان', M, c.y, 14, { bold: true, color: c.accent });
  c.y -= 26;
  put(a.space, M, c.y, 20, { bold: true });
  put(`Date · التاريخ:  ${pdfDay(issuedOn)}`, W - M, c.y + 4, 10, { align: 'right', color: c.muted });
  c.y -= 18;
  if (a.area) put(a.area, M, c.y, 10, { color: c.muted });
  put(`Last count · آخر جرد:  ${a.lastCount ? pdfDay(a.lastCount) : '-'}`, W - M, c.y, 9, { align: 'right', color: c.muted });
  c.y -= 24;
  const units = a.items.reduce((n, i) => n + i.qty, 0);
  put(`${a.items.length} items  ·  ${units} units  ·  عدد الأغراض ${a.items.length}`, M, c.y, 10, { bold: true });
  c.y -= 22;
  const rest = W - 2 * M;
  table(c, [
    { title: 'Label · الرمز', w: 78, get: (i) => a.items[i].code },
    { title: 'Item · الغرض', w: rest - 78 - 40 - 140 - 96, get: (i) => a.items[i].name },
    { title: 'Qty · العدد', w: 40, align: 'right', get: (i) => String(a.items[i].qty) },
    { title: 'Category · الصنف', w: 140, get: (i) => cat(a.categories, a.items[i].category_id) },
    { title: 'State · الحالة', w: 96, get: (i) => (a.items[i].condition === 'good' ? '' : (COND[a.items[i].condition] ?? '').split(' · ')[0]) },
  ], a.items.length, { size: 10, rowH: 20 });
  if (a.fixed && !a.items.length) { c.y -= 6; put(a.fixed, M, c.y, 10, { color: c.muted }); }
  if (!a.items.length) put('Nothing is listed in this room yet · لا شيء مسجَّل بعد', M, c.y - 4, 10, { color: c.muted });
  c.y -= 12;
  put('Something missing, broken or not listed? Tell the keeper of the inventory.  ·  أبلغ أمين الجرد عن أي نقص أو عطل.', M, Math.max(c.y, M + 8), 8.5, { color: c.muted });
  c.foot(`${look.organisation}  ·  ${a.space}`);
  return c.save();
}

// ------------------------------------------------------------------ the list for counting, space by space

export async function countingListPdf(look: HouseLook, plan: { area: string; space: string; lastCount: string | null; items: InvItem[] }[], issuedOn: string): Promise<Uint8Array> {
  const c = await newCanvas(look, { title: 'Inventory counting list' });
  const { W, M, put } = c;
  let first = true;
  for (const p of plan) {
    if (!first) c.newPage();
    first = false;
    await c.head();
    put('LIST FOR COUNTING  ·  قائمة الجرد', M, c.y, 14, { bold: true, color: c.accent });
    put(`Date · التاريخ:  ${pdfDay(issuedOn)}`, W - M, c.y + 2, 10, { align: 'right', color: c.muted });
    c.y -= 28;
    put(p.space, M, c.y, 18, { bold: true });
    c.y -= 17;
    put(`${p.area}${p.area ? '  ·  ' : ''}last count · آخر جرد: ${p.lastCount ? pdfDay(p.lastCount) : '-'}`, M, c.y, 9, { color: c.muted });
    c.y -= 8;
    put('Tick what you really see · ضع علامة على ما تراه فعلاً', W - M, c.y + 8, 9, { align: 'right', bold: true, color: c.muted });
    c.y -= 16;
    const rest = W - 2 * M;
    table(c, [
      { title: 'Seen · موجود', w: 52, get: () => '' },
      { title: 'Label · الرمز', w: 78, get: (i) => p.items[i].code },
      { title: 'Item · الغرض', w: rest - 52 - 78 - 44 - 120 - 80, get: (i) => p.items[i].name },
      { title: 'Qty · العدد', w: 44, align: 'right', get: (i) => String(p.items[i].qty) },
      { title: 'Serial · الرقم التسلسلي', w: 120, get: (i) => p.items[i].serial ?? '' },
      { title: 'Last · آخر عدّ', w: 80, get: (i) => (p.items[i].counted_on ? pdfDay(p.items[i].counted_on!) : '-') },
    ], p.items.length, {
      size: 10, rowH: 22,
      before: (_i, y) => c.page.drawRectangle({ x: M + 16, y: y - 12, width: 12, height: 12, borderColor: c.ink, borderWidth: 0.9 }),
    });
    c.y -= 8;
    put('Not seen / found elsewhere / to report:  ·  ملاحظات:', M, c.y - 4, 8.5, { bold: true, color: c.muted });
    c.page.drawLine({ start: { x: M, y: c.y - 24 }, end: { x: W - M, y: c.y - 24 }, thickness: 0.6, color: c.line });
    c.page.drawLine({ start: { x: M, y: c.y - 44 }, end: { x: W - M, y: c.y - 44 }, thickness: 0.6, color: c.line });
    c.y -= 40;
    c.ensure(60);
    c.y -= 24;
    const half = (W - 2 * M - 40) / 2;
    put('Counted by · عدَّه', M, c.y, 9, { bold: true, color: c.muted });
    c.page.drawLine({ start: { x: M, y: c.y - 26 }, end: { x: M + half, y: c.y - 26 }, thickness: 0.7, color: c.ink });
    put('Counted on · بتاريخ', M + half + 40, c.y, 9, { bold: true, color: c.muted });
    c.page.drawLine({ start: { x: M + half + 40, y: c.y - 26 }, end: { x: W - M, y: c.y - 26 }, thickness: 0.7, color: c.ink });
  }
  if (!plan.length) { await c.head(); put('Nothing to count · لا شيء للجرد', M, c.y, 12, { color: c.muted }); }
  c.foot(`${look.organisation}  ·  Inventory counting list · قائمة الجرد`);
  return c.save();
}

// ------------------------------------------------------------------ the report for a donor: what a project bought

export interface DonorHead { project: string; donor: string; period: { from: string; to: string }; issuedOn: string }

export async function projectReportPdf(look: HouseLook, h: DonorHead, rep: ProjectReport, photos: Map<string, { bytes: Uint8Array; mime: string }>): Promise<Uint8Array> {
  const c = await newCanvas(look, { title: `What ${h.project} bought`, landscape: true, margin: 36 });
  const { W, M, put } = c;
  await c.head();
  put('WHAT THIS PROJECT BOUGHT  ·  ما اشتراه هذا المشروع', M, c.y, 14, { bold: true, color: c.accent });
  put(`Date · التاريخ:  ${pdfDay(h.issuedOn)}`, W - M, c.y + 2, 10, { align: 'right', color: c.muted });
  c.y -= 24;
  put(h.project, M, c.y, 16, { bold: true });
  c.y -= 16;
  put(`${h.donor ? `Donor: ${h.donor}  ·  ` : ''}Purchases dated ${h.period.from.slice(5)}/${h.period.from.slice(0, 4)} to ${h.period.to.slice(5)}/${h.period.to.slice(0, 4)}`, M, c.y, 10, { color: c.muted });
  c.y -= 22;
  put(`${rep.items} items  ·  ${rep.units} units  ·  total value USD ${usd(rep.value)}`, M, c.y, 11, { bold: true });
  c.y -= 24;
  // the pictures: each item's first photo, embedded once (JPEG or PNG; another kind is left out, the row says "-")
  const img = new Map<string, PDFImage>();
  for (const r of rep.rows) {
    const ph = r.photo ? photos.get(r.photo) : undefined;
    if (!ph || !r.photo) continue;
    try { img.set(r.photo, ph.mime === 'image/png' ? await c.pdf.embedPng(ph.bytes) : await c.pdf.embedJpg(ph.bytes)); } catch { /* a picture the PDF cannot hold */ }
  }
  const rest = W - 2 * M;
  const w = { ph: 56, code: 66, qty: 34, date: 56, bill: 62, val: 62 };
  const fixed = w.ph + w.code + w.qty + w.date + w.bill + w.val;
  const left = rest - fixed;
  const cols: Col[] = [
    { title: 'Photo', w: w.ph, get: () => '' },
    { title: 'Label · الرمز', w: w.code, get: (i) => rep.rows[i].item.code },
    { title: 'Item · الغرض', w: left * 0.3, get: (i) => `${rep.rows[i].item.name}${rep.rows[i].out ? '  (out of the inventory)' : ''}` },
    { title: 'Space · المكان', w: left * 0.22, get: (i) => rep.rows[i].space },
    { title: 'Qty', w: w.qty, align: 'right', get: (i) => String(rep.rows[i].units) },
    { title: 'Bought', w: w.date, get: (i) => (rep.rows[i].date ? pdfDay(rep.rows[i].date!) : '') },
    { title: 'Receipt', w: w.bill, get: (i) => rep.rows[i].bill },
    { title: 'Supplier · المورّد', w: left * 0.22, get: (i) => rep.rows[i].supplier },
    { title: 'Budget line', w: left * 0.26, get: (i) => `${rep.rows[i].line}` },
    { title: 'Value USD', w: w.val, align: 'right', get: (i) => usd(rep.rows[i].value) },
  ];
  table(c, cols, rep.rows.length, {
    size: 8.5, rowH: 44,
    before: (i, y) => {
      const r = rep.rows[i];
      const im = r.photo ? img.get(r.photo) : undefined;
      if (!im) return;
      const s = Math.min(40 / im.height, (w.ph - 6) / im.width);
      c.page.drawImage(im, { x: M + 3, y: y - 40, width: im.width * s, height: im.height * s });
    },
  });
  if (!rep.rows.length) put('No item was listed for this project in this period.  ·  لم يُسجَّل أي غرض.', M, c.y - 4, 10, { color: c.muted });
  // by space
  if (rep.bySpace.length) {
    c.ensure(40 + rep.bySpace.length * 16);
    c.y -= 14;
    put('By space  ·  حسب المكان', M, c.y, 11, { bold: true, color: c.accent });
    c.y -= 20;
    table(c, [
      { title: 'Space · المكان', w: rest * 0.5, get: (i) => rep.bySpace[i].space },
      { title: 'Items', w: 70, align: 'right', get: (i) => String(rep.bySpace[i].items) },
      { title: 'Units', w: 70, align: 'right', get: (i) => String(rep.bySpace[i].units) },
      { title: 'Value USD', w: 100, align: 'right', get: (i) => usd(rep.bySpace[i].value) },
    ], rep.bySpace.length, { size: 9.5 });
  }
  c.foot(`${look.organisation}  ·  ${h.project}`);
  return c.save();
}

export async function projectReportXlsx(h: DonorHead & { organisation: string }, rep: ProjectReport): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const bold = (row: ExcelJS.Row) => { row.font = { bold: true }; };
  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 28 }, { width: 44 }];
  bold(s.addRow([`${h.organisation} — ${h.project}`]));
  if (h.donor) s.addRow(['Donor', h.donor]);
  s.addRow(['Purchases dated', `${h.period.from} → ${h.period.to}`]);
  s.addRow(['Report date', h.issuedOn]);
  s.addRow(['Items', rep.items]);
  s.addRow(['Units', rep.units]);
  s.addRow(['Total value (USD)', rep.value]).getCell(2).numFmt = '#,##0.00';
  s.addRow(['Items without a photo', rep.noPhoto]);
  s.addRow([]);
  s.addRow(['The value of an item is its purchase value in USD (the pounds at the rate of the entry), or an estimate. No depreciation.']);

  const ws = wb.addWorksheet('Items');
  ws.columns = [
    { header: 'Label', width: 14 }, { header: 'Item', width: 30 }, { header: 'Category', width: 22 }, { header: 'Space', width: 30 }, { header: 'Qty', width: 7 },
    { header: 'Bought on', width: 12 }, { header: 'Receipt', width: 14 }, { header: 'Supplier', width: 24 }, { header: 'Heading', width: 24 }, { header: 'Budget line', width: 28 },
    { header: 'Brand', width: 14 }, { header: 'Model', width: 14 }, { header: 'Serial', width: 18 }, { header: 'State', width: 12 }, { header: 'In the inventory', width: 14 }, { header: 'Photo', width: 8 }, { header: 'Value USD', width: 12, style: { numFmt: '#,##0.00' } },
  ];
  bold(ws.getRow(1));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const row = (r: ReportRow) => [r.item.code, r.item.name, r.category, r.space, r.units, r.date, r.bill, r.supplier, r.heading, r.line, r.item.brand, r.item.model, r.item.serial, COND[r.item.condition]?.split(' · ')[0] ?? r.item.condition, r.out ? (r.item.status === 'lost' ? 'Lost' : 'Taken out') : 'Yes', r.photo ? 'Yes' : 'No', r.value];
  for (const r of rep.rows) ws.addRow(row(r));
  bold(ws.addRow(['Total', '', '', '', rep.units, '', '', '', '', '', '', '', '', '', '', '', rep.value]));

  const sp = wb.addWorksheet('By space');
  sp.columns = [{ header: 'Space', width: 36 }, { header: 'Items', width: 8 }, { header: 'Units', width: 8 }, { header: 'Value USD', width: 14, style: { numFmt: '#,##0.00' } }];
  bold(sp.getRow(1));
  for (const x of rep.bySpace) sp.addRow([x.space, x.items, x.units, x.value]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
