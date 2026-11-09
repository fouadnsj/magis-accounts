// Building sites: the budget to Excel, in USD only (Fouad, 9 Nov 2026).
// - "General": every heading — budget, spent, left, still to spend, postponed, expected total, expected left.
// - "Estimates": the items still to come (code, heading, item, USD, postponed). It is ALSO the file the
//   program reads back (Budget → Import estimates): change it in Excel, the general page follows.
// - One sheet per heading: its figures, its estimated items, and its expenses row by row.
// Formulas carry Excel's result too, so the file shows the figures even before Excel recalculates.
import ExcelJS from 'exceljs';
import type { BuildingBudgetLine } from '../domain/reports';
import type { Computed, Lists, Trx } from '../domain/types';

export const ESTIMATES_SHEET = 'Estimates';
export const ESTIMATE_HEADERS = ['Code', 'Heading', 'Item', 'USD', 'Postponed'];

const USD = '#,##0.00;[Red](#,##0.00);"-"';
const PCT = '0.0%';
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B191D' } } as ExcelJS.Fill;
const TOTAL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F9' } } as ExcelJS.Fill;

const styleHeader = (row: ExcelJS.Row) => {
  row.eachCell((c) => {
    c.fill = HEAD;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  row.height = 30;
};
const f = (formula: string, result: number | string) => ({ formula, result }) as ExcelJS.CellFormulaValue;

/** A sheet name Excel accepts (31 characters, none of \ / ? * [ ] :), unique in the workbook. */
function sheetName(wb: ExcelJS.Workbook, code: string, name: string): string {
  const base = `${code} ${name}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim();
  let s = base;
  for (let i = 2; wb.worksheets.some((w) => w.name.toLowerCase() === s.toLowerCase()); i++) s = `${base.slice(0, 28)} ${i}`;
  return s;
}

export async function exportBuildingBudget(
  lines: BuildingBudgetLine[], rows: Trx[], comp: Map<string, Computed>, lists: Lists, opts: { title: string; date: string },
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Homs Building';
  const general = wb.addWorksheet('General', { views: [{ state: 'frozen', ySplit: 4, rightToLeft: false }] });
  const est = wb.addWorksheet(ESTIMATES_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });

  // ---- Estimates (also the import format)
  est.columns = [{ width: 8 }, { width: 24 }, { width: 60 }, { width: 14 }, { width: 11 }];
  styleHeader(est.addRow(ESTIMATE_HEADERS));
  for (const l of lines)
    for (const e of l.items) {
      const r = est.addRow([l.heading.code, l.heading.name, e.description, e.amount_usd, e.postponed ? 'yes' : '']);
      r.getCell(4).numFmt = USD;
    }
  const estLast = Math.max(2, est.rowCount);
  const estRange = (col: string) => `${ESTIMATES_SHEET}!$${col}$2:$${col}$${estLast + 200}`; // room to add items in Excel

  // ---- General
  general.columns = [{ width: 7 }, { width: 26 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 15 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 10 }];
  general.addRow([opts.title]).font = { bold: true, size: 14 };
  general.addRow([`USD · ${opts.date} · Spent = paid in USD + pounds converted at each row's rate. Still to spend = the items of the "${ESTIMATES_SHEET}" sheet (postponed ones apart).`]).font = { italic: true, color: { argb: 'FF666666' } };
  general.addRow([]);
  styleHeader(general.addRow(['Code', 'Heading', 'Budget', 'Spent', 'Left', 'Still to spend', 'Postponed', 'Expected total', 'Expected left', 'Expected used']));
  const first = general.rowCount + 1;
  lines.forEach((l, i) => {
    const r = first + i;
    const row = general.addRow([
      l.heading.code, l.heading.name, l.budget || null, l.total,
      f(`C${r}-D${r}`, l.budget - l.total),
      f(`SUMIFS(${estRange('D')},${estRange('A')},A${r},${estRange('E')},"<>yes")`, l.still),
      f(`SUMIFS(${estRange('D')},${estRange('A')},A${r},${estRange('E')},"yes")`, l.postponed),
      f(`D${r}+F${r}`, l.expected),
      f(`C${r}-H${r}`, l.expectedLeft),
      f(`IF(C${r}>0,H${r}/C${r},"")`, l.budget > 0 ? l.expected / l.budget : ''),
    ]);
    for (let c = 3; c <= 9; c++) row.getCell(c).numFmt = USD;
    row.getCell(10).numFmt = PCT;
  });
  const last = general.rowCount;
  const tot = (col: string, v: number) => f(`SUM(${col}${first}:${col}${last})`, v);
  const s = (k: (l: BuildingBudgetLine) => number) => lines.reduce((a, l) => a + k(l), 0);
  const tr = general.addRow([
    '', 'Total', tot('C', s((l) => l.budget)), tot('D', s((l) => l.total)), tot('E', s((l) => l.budget - l.total)),
    tot('F', s((l) => l.still)), tot('G', s((l) => l.postponed)), tot('H', s((l) => l.expected)), tot('I', s((l) => l.expectedLeft)),
    f(`IF(C${last + 1}>0,H${last + 1}/C${last + 1},"")`, s((l) => l.budget) ? s((l) => l.expected) / s((l) => l.budget) : ''),
  ]);
  tr.eachCell((c, n) => {
    c.font = { bold: true };
    c.fill = TOTAL;
    c.numFmt = n === 10 ? PCT : USD;
  });

  // ---- One sheet per heading
  const kindOf = new Map(lists.lines.map((l) => [l.id, l.name]));
  const party = new Map(lists.parties.map((p) => [p.id, p.name]));
  lines.forEach((l, i) => {
    const g = first + i; // its row on the General sheet
    const ws = wb.addWorksheet(sheetName(wb, l.heading.code, l.heading.name));
    ws.columns = [{ width: 15 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 24 }, { width: 50 }, { width: 14 }];
    ws.addRow([`${l.heading.code} · ${l.heading.name}`]).font = { bold: true, size: 14 };
    ws.addRow([`USD · ${opts.date}`]).font = { italic: true, color: { argb: 'FF666666' } };
    ws.addRow([]);
    const fig: [string, string, number][] = [
      ['Budget', 'C', l.budget], ['Spent', 'D', l.total], ['Left', 'E', l.budget - l.total],
      ['Still to spend', 'F', l.still], ['Postponed', 'G', l.postponed], ['Expected total', 'H', l.expected], ['Expected left', 'I', l.expectedLeft],
    ];
    for (const [label, col, v] of fig) {
      const r = ws.addRow([label, f(`General!${col}${g}`, v)]);
      r.getCell(1).font = { bold: true };
      r.getCell(2).numFmt = USD;
    }
    ws.addRow([]);
    ws.addRow(['Still to spend (estimate)']).font = { bold: true, size: 12 };
    styleHeader(ws.addRow(['Item', '', '', '', '', '', 'USD']));
    if (!l.items.length) ws.addRow(['—']);
    for (const e of l.items) {
      const r = ws.addRow([e.description + (e.postponed ? '  (postponed · مؤجل)' : ''), '', '', '', '', '', e.amount_usd]);
      ws.mergeCells(r.number, 1, r.number, 6);
      r.getCell(7).numFmt = USD;
      if (e.postponed) r.font = { italic: true, color: { argb: 'FF888888' } };
    }
    ws.addRow([]);
    ws.addRow(['Expenses']).font = { bold: true, size: 12 };
    styleHeader(ws.addRow(['Bill code', 'Paid on', 'Bill date', 'Kind', 'From', 'Details', 'USD']));
    const mine = rows
      .filter((t) => t.type === 'Exp' && t.heading_id === l.heading.id && !t.cancelled_at)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.n ?? 0) - (b.n ?? 0));
    const top = ws.rowCount + 1;
    for (const t of mine) {
      const c = comp.get(t.id)!;
      const r = ws.addRow([c.billCode, t.date, t.bill_date ?? t.date, t.line_id != null ? kindOf.get(t.line_id) ?? '' : '', t.party_id != null ? party.get(t.party_id) ?? '' : '', t.explanation ?? '', c.expUsdTot]);
      r.getCell(7).numFmt = USD;
    }
    const sum = ws.addRow(['Total', '', '', '', '', `${mine.length} rows`, f(`SUM(G${top}:G${Math.max(top, ws.rowCount)})`, l.total)]);
    sum.font = { bold: true };
    sum.getCell(7).numFmt = USD;
  });

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Reads the "Estimates" sheet (of an export, possibly changed in Excel): one item per row with a code and an item. */
export function readEstimates(wb: ExcelJS.Workbook): { code: string; description: string; amount_usd: number; postponed: boolean }[] {
  const ws = wb.getWorksheet(ESTIMATES_SHEET) ?? wb.worksheets.find((w) => String(w.getCell('A1').value ?? '').trim() === 'Code');
  if (!ws) throw new Error(`No sheet "${ESTIMATES_SHEET}" in this file`);
  const val = (v: ExcelJS.CellValue): unknown => (v && typeof v === 'object' && 'result' in v ? (v as ExcelJS.CellFormulaValue).result : v && typeof v === 'object' && 'richText' in v ? (v as ExcelJS.CellRichTextValue).richText.map((x) => x.text).join('') : v);
  const out: { code: string; description: string; amount_usd: number; postponed: boolean }[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = String(val(row.getCell(1).value) ?? '').trim();
    const description = String(val(row.getCell(3).value) ?? '').trim();
    if (!code && !description) continue;
    const n = val(row.getCell(4).value);
    const amount = typeof n === 'number' ? n : Number(String(n ?? '').replace(/,/g, '').trim() || 0);
    const p = String(val(row.getCell(5).value) ?? '').trim().toLowerCase();
    out.push({ code, description, amount_usd: amount, postponed: ['yes', 'y', 'x', '1', 'نعم', 'مؤجل', 'oui', 'true'].includes(p) });
  }
  return out;
}
