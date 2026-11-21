// The inventory's files (Fouad, 21 November 2026): reading a Snipe-IT export (.csv) or an Excel list, and writing the
// inventory to Excel (values only, one line per item).
import ExcelJS from 'exceljs';
import { parseCsv, itemTotal, type InvCategory, type InvItem, type InvOriginRow, type InvPlace } from '../inventory/inv';

/** The first sheet of an Excel file, or a CSV, as text rows. */
export async function readTable(bytes: Uint8Array, name: string): Promise<string[][]> {
  if (/\.csv$|\.txt$/i.test(name)) return parseCsv(new TextDecoder('utf-8').decode(bytes));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let i = 1; i <= ws.columnCount; i++) {
      const v = row.getCell(i).value;
      cells.push(v instanceof Date ? v.toISOString().slice(0, 10) : row.getCell(i).text ?? '');
    }
    out.push(cells);
  });
  return out;
}

const STATE = { good: 'Good', repair: 'To repair', broken: 'Broken' } as const;
const OUT = { in_use: 'In use', disposed: 'Disposed', lost: 'Lost' } as const;

export interface InvSheetInput {
  items: InvItem[];
  categories: InvCategory[];
  places: InvPlace[];
  origins: InvOriginRow[];
  /** supplier names by id */
  parties: Map<number, string>;
  /** bill code of a purchase entry */
  bill: (trxId: string) => string;
  organisation: string;
}

/** The inventory as an Excel file: the items, then a summary by category. */
export async function inventoryWorkbook(x: InvSheetInput): Promise<Uint8Array> {
  const cat = new Map(x.categories.map((c) => [c.id, c.name]));
  const place = new Map(x.places.map((p) => [p.id, p.name]));
  const origin = new Map(x.origins.map((o) => [o.id, o.name]));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventory');
  const head = ['Label', 'Name', 'Category', 'Place', 'Qty', 'Brand', 'Model', 'Serial', 'State', 'Status', 'Holder', 'Origin', 'Date', 'Unit value USD', 'Total value USD', 'Purchase entry', 'Supplier', 'Last count', 'Note'];
  ws.addRow(head);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } };
  for (const i of x.items) {
    ws.addRow([i.code, i.name, i.category_id ? cat.get(i.category_id) : '', i.place_id ? place.get(i.place_id) : '', i.qty, i.brand ?? '', i.model ?? '', i.serial ?? '', STATE[i.condition], OUT[i.status], i.holder ?? '', (i.origin_id ? origin.get(i.origin_id) : null) ?? i.origin,
      i.acquired_on ?? '', i.value_usd ?? null, i.value_usd != null ? itemTotal(i) : null, i.trx_id ? x.bill(i.trx_id) : '', i.party_id ? x.parties.get(i.party_id) ?? '' : '', i.counted_on ?? '', i.note ?? '']);
  }
  ws.columns.forEach((c, k) => { c.width = [12, 28, 22, 18, 6, 14, 14, 18, 10, 10, 16, 9, 12, 14, 14, 18, 18, 12, 30][k] ?? 14; });
  for (const col of [14, 15]) ws.getColumn(col).numFmt = '#,##0.00';
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };

  const sm = wb.addWorksheet('By category');
  sm.addRow(['Category', 'Items', 'Units', 'Value USD']);
  sm.getRow(1).font = { bold: true };
  const live = x.items.filter((i) => i.status === 'in_use');
  const groups = new Map<string, { n: number; u: number; v: number }>();
  for (const i of live) {
    const k = (i.category_id ? cat.get(i.category_id) : null) ?? '—';
    const g = groups.get(k) ?? { n: 0, u: 0, v: 0 };
    g.n += 1; g.u += i.qty; g.v += itemTotal(i);
    groups.set(k, g);
  }
  for (const [k, g] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) sm.addRow([k, g.n, g.u, Math.round(g.v * 100) / 100]);
  sm.addRow(['Total', live.length, live.reduce((a, i) => a + i.qty, 0), Math.round(live.reduce((a, i) => a + itemTotal(i), 0) * 100) / 100]);
  sm.lastRow!.font = { bold: true };
  sm.columns.forEach((c, k) => { c.width = [30, 10, 10, 14][k]; });
  sm.getColumn(4).numFmt = '#,##0.00';
  wb.title = `${x.organisation} — inventory`;
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** An Excel file to fill in and import (Settings → Import): the headers the import understands, drop-down lists for the category and the place. */
export async function inventoryTemplate(categories: InvCategory[], places: InvPlace[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Items');
  const head = ['Name', 'Category', 'Place', 'Qty', 'Serial', 'Brand', 'Model', 'Value USD', 'Note'];
  ws.addRow(head);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } };
  ws.addRow(['Chair (example: delete this row)', categories[0]?.name.split(' · ')[0] ?? '', places[0]?.name ?? '', 20, '', '', '', '', '']);
  ws.columns.forEach((c, k) => { c.width = [34, 26, 20, 7, 18, 14, 14, 12, 30][k]; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const lists = wb.addWorksheet('Lists');
  lists.addRow(['Categories', 'Places']);
  lists.getRow(1).font = { bold: true };
  const n = Math.max(categories.length, places.length);
  for (let i = 0; i < n; i++) lists.addRow([categories[i]?.name ?? '', places[i]?.name ?? '']);
  lists.columns.forEach((c) => { c.width = 38; });
  // the drop-down lists: a validation on each cell of the column (ExcelJS keeps them cell by cell)
  const catRange = `Lists!$A$2:$A$${categories.length + 1}`;
  const placeRange = `Lists!$B$2:$B$${places.length + 1}`;
  for (let r = 2; r <= 1000; r++) {
    if (categories.length) ws.getCell(`B${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [catRange] };
    if (places.length) ws.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [placeRange] };
  }
  const help = wb.addWorksheet('How to');
  for (const l of ['Fill the sheet "Items": one line per object, or one line per group (20 chairs = Qty 20).', 'Category and Place: choose from the drop-down (the lists are on the sheet "Lists").', 'Serial: for IT and audio-visual equipment. A serial number is never used twice.', 'Value USD: one unit; leave it empty and fill it later.', 'Then in the app: Inventory → Settings → Import → choose this file.']) help.addRow([l]);
  help.getColumn(1).width = 100;
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
