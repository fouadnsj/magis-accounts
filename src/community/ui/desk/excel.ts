// Export of a desk table to Excel (one sheet per table), saved where the person chooses.
import ExcelJS from 'exceljs';
import { saveFile } from '../../../platform';

export interface SheetData {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
  /** columns holding amounts (0-based), formatted #,##0.## */
  money?: number[];
}

export async function exportExcel(fileName: string, sheets: SheetData[]): Promise<string | null> {
  const wb = new ExcelJS.Workbook();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    ws.addRow(sh.header).font = { bold: true };
    for (const r of sh.rows) ws.addRow(r);
    ws.columns.forEach((col, i) => {
      col.width = Math.min(45, Math.max(10, ...sh.rows.map((r) => String(r[i] ?? '').length + 2), sh.header[i]?.length ?? 8));
      if (sh.money?.includes(i)) col.numFmt = '#,##0.##;(#,##0.##);-';
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const buf = await wb.xlsx.writeBuffer();
  return saveFile(fileName, ['xlsx'], new Uint8Array(buf as ArrayBuffer), fileName);
}
