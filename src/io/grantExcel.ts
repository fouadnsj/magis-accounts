// One grant's report across the centres, for its donor (Fouad, 2026-11-07): the summary, each centre's part, then the
// spending by activity and by line with a column per centre. Values only, in English (the donors' language).
import ExcelJS from 'exceljs';
import type { NetGrant } from '../domain/netGrants';
import type { GrantReport } from '../domain/grantReport';

const FMT = '#,##0.00;(#,##0.00);-';

export async function grantXlsx(g: NetGrant, r: GrantReport): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const bold = (row: ExcelJS.Row) => { row.font = { bold: true }; };
  const num = (row: ExcelJS.Row, from: number) => { row.eachCell((c, i) => { if (i >= from) c.numFmt = FMT; }); };
  const centres = r.parts.map((p) => p.centre_name);

  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 34 }, { width: 42 }];
  bold(s.addRow([`${g.donor}${g.reference ? ` — ${g.reference}` : ''}`]));
  s.addRow(['Period', `${g.start_date ?? '…'} → ${g.end_date ?? '…'}`]);
  num(s.addRow([`Grant (${g.currency})`, g.amount]), 2);
  num(s.addRow([`Planned for the centres (${g.currency})`, r.total.planned]), 2);
  num(s.addRow(['Sent to the centres (USD)', r.total.sent_usd]), 2);
  if (r.total.sent_syp) num(s.addRow(['Sent to the centres (SYP)', r.total.sent_syp]), 2);
  num(s.addRow(['Budget of the projects (USD)', r.total.budget]), 2);
  num(s.addRow(['Spent (USD)', r.total.spent]), 2);
  num(s.addRow(['Left of the budget (USD)', r.total.budget - r.total.spent]), 2);

  const p = wb.addWorksheet('By centre');
  p.columns = [{ width: 24 }, { width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 22 }];
  bold(p.addRow(['Centre', 'Project', `Planned (${g.currency})`, 'Sent (USD)', 'Accepted (USD)', 'Budget (USD)', 'Spent (USD)', 'Situation']));
  for (const x of r.parts) num(p.addRow([x.centre_name, x.project_name ?? '', x.planned, x.sent_usd, x.accepted_usd, x.budget, x.spent, x.copy_at ? `copy of ${x.copy_at.slice(0, 10)}` : 'live']), 3);

  for (const [title, rows] of [['By activity', r.byHeading], ['By line', r.byLine]] as const) {
    const w = wb.addWorksheet(title);
    const line = title === 'By line';
    w.columns = [{ width: 32 }, ...(line ? [{ width: 40 }] : []), { width: 16 }, { width: 16 }, ...centres.map(() => ({ width: 16 })), { width: 16 }];
    bold(w.addRow(['Activity', ...(line ? ['Line'] : []), 'Budget (USD)', 'Spent (USD)', ...centres.map((c) => `Spent ${c}`), 'Left (USD)']));
    for (const x of rows) num(w.addRow([x.heading, ...(line ? [x.line ?? ''] : []), x.budget, x.spent, ...centres.map((c) => x.byCentre[c] ?? 0), x.budget - x.spent]), line ? 3 : 2);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
