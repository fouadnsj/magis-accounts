// One project's report for its donor (Fouad, 2026-11-01): a summary, the spending line by line,
// and every expense with its bill code and documents. Values only, in English (the donors' language).
import ExcelJS from 'exceljs';
import type { Computed, Lists, Trx } from '../domain/types';
import type { ProjectRow } from '../domain/projects';
import type { Period } from '../domain/reports';

const FMT_USD = '#,##0.00;(#,##0.00);-';
const FMT_SYP = '#,##0;(#,##0);-';
const CENTRE: Record<string, string> = { jaramana: 'Jaramana', aleppo: 'Aleppo', homs: 'Homs', other: 'Other' };

export async function projectXlsx(a: {
  project: ProjectRow;
  period: Period;
  organisation: string;
  lists: Pick<Lists, 'headings' | 'lines' | 'books' | 'parties' | 'donors'>;
  comp: Map<string, Computed>;
  /** expense id → the names of its documents */
  docs: Map<string, string[]>;
}): Promise<Uint8Array> {
  const { project: p, lists: L } = a;
  const name = (arr: { id: number; name: string }[], id: number | null | undefined) => arr.find((x) => x.id === id)?.name ?? '';
  const wb = new ExcelJS.Workbook();
  const bold = (row: ExcelJS.Row) => { row.font = { bold: true }; };

  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 30 }, { width: 40 }];
  bold(s.addRow([`${a.organisation} — ${p.id == null ? 'Not funded' : p.name}`]));
  s.addRow(['Period', `${a.period.from} → ${a.period.to}`]);
  if (p.grant) {
    const cur = p.grant.currency;
    s.addRow(['Donor', name(L.donors, p.grant.donor_id)]);
    s.addRow(['Contract', p.grant.reference ?? '']);
    s.addRow([`Grant (${cur})`, p.grant.amount]).getCell(2).numFmt = FMT_USD;
    for (const x of p.shares) s.addRow([`Share ${CENTRE[x.centre] ?? x.centre} (${cur})`, x.amount]).getCell(2).numFmt = FMT_USD;
    if (!p.shares.length && p.share != null) s.addRow([`Share here (${cur})`, p.share]).getCell(2).numFmt = FMT_USD;
    if (p.received != null) s.addRow(['Received in hand (USD)', p.received]).getCell(2).numFmt = FMT_USD;
  }
  s.addRow(['Spent in the period (USD)', p.spent]).getCell(2).numFmt = FMT_USD;
  s.addRow(['Spent since the beginning (USD)', p.spentAll]).getCell(2).numFmt = FMT_USD;
  if (p.left != null) s.addRow(['Left (USD)', p.left]).getCell(2).numFmt = FMT_USD;
  s.addRow([]);
  s.addRow(['Pounds are counted in dollars at the rate of each expense.']);

  const l = wb.addWorksheet('By line');
  l.columns = [{ header: 'Heading', width: 30 }, { header: 'Line', width: 36 }, { header: 'Expenses', width: 10 }, { header: 'Spent USD', width: 14, style: { numFmt: FMT_USD } }];
  bold(l.getRow(1));
  for (const x of p.lines) l.addRow([name(L.headings, x.heading_id), name(L.lines, x.line_id), x.rows, x.spent]);
  bold(l.addRow(['Total', '', p.lines.reduce((t, x) => t + x.rows, 0), p.spent]));

  const e = wb.addWorksheet('Expenses');
  e.columns = [
    { header: 'Date', width: 12 }, { header: 'Bill code', width: 16 }, { header: 'Book', width: 14 }, { header: 'Heading', width: 24 }, { header: 'Line', width: 28 },
    { header: 'Explanation', width: 40 }, { header: 'Party', width: 20 }, { header: 'SYP', width: 12, style: { numFmt: FMT_SYP } }, { header: 'USD', width: 12, style: { numFmt: FMT_USD } },
    { header: 'Total USD', width: 13, style: { numFmt: FMT_USD } }, { header: 'Documents', width: 30 },
  ];
  bold(e.getRow(1));
  for (const r of p.expenses as Trx[]) {
    const c = a.comp.get(r.id);
    e.addRow([r.date, c?.billCode ?? '', name(L.books, r.book_id), name(L.headings, r.heading_id), name(L.lines, r.line_id), r.explanation ?? '', name(L.parties, r.party_id),
      r.exp_syp, r.exp_usd, c?.expUsdTot ?? 0, (a.docs.get(r.id) ?? []).join(', ')]);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
