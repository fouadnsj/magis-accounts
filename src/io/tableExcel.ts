// "What is on the screen" of a report, as an Excel file: each table shown becomes a sheet, with the title,
// the period and the centre at the top (Fouad, 25 November 2026: an Export on each report). Values only.
import ExcelJS from 'exceljs';

export interface ShownTable { name: string; head: string[]; rows: string[][] }

/** A shown figure back to a number: "1,234", "(1,234)" (negative), "12.5%", "-" (nothing). Anything else stays text. */
export function cellValue(text: string): string | number | null {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s === '' || s === '-' || s === '—') return null;
  const m = /^(\()?(-)?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?%?(\))?$/.exec(s);
  if (!m || (m[1] && !m[5]) || (!m[1] && m[5])) return s;
  if (/^0\d/.test(m[3])) return s; // a code such as 007 stays text
  const n = Number(m[3].replace(/,/g, '') + (m[4] ?? ''));
  return m[1] || m[2] ? -n : n;
}

export function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Sheet';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
}

export async function tablesXlsx(a: { title: string; lines: string[]; tables: ShownTable[] }): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (const tb of a.tables) {
    const ws = wb.addWorksheet(safeSheetName(tb.name, used));
    ws.addRow([a.title]).font = { bold: true, size: 13 };
    for (const l of a.lines) ws.addRow([l]);
    ws.addRow([]);
    ws.addRow(tb.head).font = { bold: true };
    for (const r of tb.rows) {
      const row = ws.addRow(r.map(cellValue));
      row.eachCell((c) => { if (typeof c.value === 'number') c.numFmt = '#,##0.##;(#,##0.##)'; });
    }
    const cols = Math.max(tb.head.length, ...tb.rows.map((r) => r.length), 1);
    for (let i = 1; i <= cols; i++) {
      const w = Math.max(10, ...[tb.head[i - 1] ?? '', ...tb.rows.map((r) => r[i - 1] ?? '')].map((x) => Math.min(44, x.length + 2)));
      ws.getColumn(i).width = w;
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
