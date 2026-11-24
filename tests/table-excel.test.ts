// The "Excel of what is on the screen" of a report (Reports, 25 November 2026).
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { cellValue, safeSheetName, tablesXlsx } from '../src/io/tableExcel';

describe('table Excel', () => {
  it('turns shown figures back into numbers, and keeps the rest as text', () => {
    expect(cellValue('1,234')).toBe(1234);
    expect(cellValue('(1,234.50)')).toBe(-1234.5);
    expect(cellValue('12.5%')).toBe(12.5);
    expect(cellValue('-')).toBeNull();
    expect(cellValue('007')).toBe('007');
    expect(cellValue('2026-05')).toBe('2026-05');
    expect(cellValue('Salaries')).toBe('Salaries');
  });
  it('gives each sheet a safe, different name', () => {
    const used = new Set<string>();
    expect(safeSheetName('A/B: totals?', used)).toBe('A B totals');
    expect(safeSheetName('A B totals', used)).toBe('A B totals 2');
  });
  it('writes the title, the period and each table', async () => {
    const bytes = await tablesXlsx({ title: 'Reports · Summary', lines: ['Homs', 'May 2026 → June 2026'], tables: [{ name: 'Totals', head: ['Line', 'USD'], rows: [['Rent', '1,200.00'], ['Food', '(30.00)']] }] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.getWorksheet('Totals')!;
    expect(ws.getCell('A1').value).toBe('Reports · Summary');
    expect(ws.getCell('A3').value).toBe('May 2026 → June 2026');
    expect(ws.getCell('A5').value).toBe('Line');
    expect(ws.getCell('B6').value).toBe(1200);
    expect(ws.getCell('B7').value).toBe(-30);
  });
});
