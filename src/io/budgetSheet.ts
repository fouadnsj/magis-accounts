// Reads every sheet of a budget workbook (like MAGIS 2027 Budget.xlsx) as a
// plain grid of values: numbers and texts as Excel computed them.
import ExcelJS from 'exceljs';

export type Grid = (string | number | null)[][];

function plain(v: unknown): string | number | null {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if ('result' in o) return plain(o.result);
    if (o.richText) return o.richText.map((x) => x.text).join('');
    if (typeof o.text === 'string') return o.text;
  }
  return String(v);
}

export async function workbookGrids(bytes: Uint8Array): Promise<{ name: string; grid: Grid }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const grid: Grid = [];
    ws.eachRow({ includeEmpty: true }, (r, i) => {
      const vals: (string | number | null)[] = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(plain(r.getCell(c).value));
      grid[i - 1] = vals;
    });
    for (let i = 0; i < grid.length; i++) grid[i] ??= [];
    return { name: ws.name, grid };
  });
}
