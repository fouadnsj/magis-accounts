// The standard donor report (Excel): for one donor and one budget (its period),
// what he covers in the budget, what he gave (Grants) during the period, and every
// expense of the budget that he covers, with his share and whether its document
// (scan) is attached.
import ExcelJS from 'exceljs';
import type { Computed, Lists, Trx } from '../domain/types';
import { WHOLE, cellsOf, cover, effectivePct, allocWorth, inPeriod, periodEnd, type Budget, type BudgetAccount, type BudgetAlloc, type BudgetAmount } from '../domain/budget';
import type { GrantRow } from '../domain/reports';

export interface DonorReportInput {
  donorId: number;
  budget: Budget;
  organisation: string;
  lists: Lists;
  rows: Trx[];
  comp: Map<string, Computed>;
  amounts: BudgetAmount[];
  accounts: BudgetAccount[];
  allocs: BudgetAlloc[];
  grants: GrantRow[];
  /** trx id → names of its attached documents */
  docs: Map<string, string[]>;
  /** expense id → the budget it belongs to (overlapping budgets); without it, every expense of the period */
  assigned?: Map<string, number>;
}

export interface DonorReport {
  allocated: number;
  received: number;
  spentShare: number;
  lines: { id: string; date: string; bill: string; usd: number; share: number; doc: boolean }[];
}

/** The donor's share (0–1) of a row: his part of the budget cell the row belongs to. */
function shareOf(i: DonorReportInput, eff: Map<number, number>, r: Trx): number {
  if (r.account_id == null) return 0;
  const lump = i.accounts.some((a) => a.account_id === r.account_id && a.lump_usd != null && a.lump_usd > 0);
  const line = lump ? WHOLE : r.line_id ?? -999;
  const heading = lump ? WHOLE : r.heading_id ?? -999;
  const c = cover(i.allocs, eff, r.account_id, line, heading, 1);
  return c.donors.filter((d) => d.donor_id === i.donorId).reduce((s, d) => s + d.usd, 0);
}

export function donorReportData(i: DonorReportInput): DonorReport {
  const headingOf = new Map(i.lists.lines.map((l) => [l.id, l.heading_id]));
  const outside = new Set(i.lists.accounts.filter((a) => a.outside_budget).map((a) => a.id));
  const cells = cellsOf(i.amounts, i.accounts).filter((x) => !outside.has(x.account_id));
  const eff = effectivePct(i.allocs, cells, headingOf);
  const mine = i.allocs.filter((a) => a.donor_id === i.donorId && a.budget_id === i.budget.id);
  const allocated = mine.reduce((s, a) => s + allocWorth(a, i.allocs, eff, cells, headingOf), 0);
  const received = i.grants.filter((g) => g.donor_id === i.donorId && g.date && inPeriod(i.budget, g.date.slice(0, 7))).reduce((s, g) => s + g.amount_usd, 0);
  const lines = i.rows
    .filter((r) => r.type === 'Exp' && r.date && inPeriod(i.budget, r.date.slice(0, 7)) && !outside.has(r.account_id ?? -1))
    .filter((r) => !i.assigned || i.assigned.get(r.id) === i.budget.id)
    .map((r) => ({ r, share: shareOf(i, eff, r) }))
    .filter((x) => x.share > 0.00001)
    .map(({ r, share }) => ({ id: r.id, date: r.date!, bill: i.comp.get(r.id)?.billCode ?? '', usd: i.comp.get(r.id)?.expUsdTot ?? 0, share, doc: (i.docs.get(r.id) ?? []).length > 0 }));
  const spentShare = lines.reduce((s, x) => s + x.usd * x.share, 0);
  return { allocated, received, spentShare, lines };
}

export async function donorReportXlsx(i: DonorReportInput): Promise<Uint8Array> {
  const L = i.lists;
  const name = (arr: { id: number; name: string }[], id: number | null | undefined) => (id == null ? '' : arr.find((x) => x.id === id)?.name ?? '');
  const donor = name(L.donors, i.donorId);
  const headingOf = new Map(L.lines.map((l) => [l.id, l.heading_id]));
  const outside = new Set(L.accounts.filter((a) => a.outside_budget).map((a) => a.id));
  const cells = cellsOf(i.amounts, i.accounts).filter((x) => !outside.has(x.account_id));
  const eff = effectivePct(i.allocs, cells, headingOf);
  const data = donorReportData(i);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MAGIS Accounts';
  const money = '#,##0.00';
  const bold = { bold: true };

  // ---- Summary
  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 46 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 18 }];
  s.addRow([`${i.organisation} — ${donor} — ${i.budget.name} (${i.budget.start_ym} → ${periodEnd(i.budget)})`]).font = { bold: true, size: 14 };
  s.addRow([`Donor report · printed ${new Date().toISOString().slice(0, 10)} · all amounts in USD (pounds converted at each row's rate)`]).font = { italic: true, color: { argb: 'FF666666' } };
  s.addRow([]);
  s.addRow(['What the donor covers in the budget', 'Share', 'Budget covered (USD)', 'Status', 'Note']).font = bold;
  for (const a of i.allocs.filter((x) => x.donor_id === i.donorId && x.budget_id === i.budget.id)) {
    const scope = a.account_id == null ? 'Every account of the centre'
      : a.line_id != null ? `${name(L.accounts, a.account_id)} › ${name(L.headings, a.heading_id)} › ${name(L.lines, a.line_id)}`
        : a.heading_id != null ? `${name(L.accounts, a.account_id)} › ${name(L.headings, a.heading_id)}` : `${name(L.accounts, a.account_id)} (whole account)`;
    const share = a.rest ? 'the rest' : a.pct != null ? `${a.pct}%` : `$${a.amount_usd}`;
    const row = s.addRow([scope, share, allocWorth(a, i.allocs, eff, cells, headingOf), a.status, a.note ?? '']);
    row.getCell(3).numFmt = money;
  }
  s.addRow([]);
  const tot = (label: string, v: number) => {
    const r = s.addRow([label, '', v]);
    r.font = bold;
    r.getCell(3).numFmt = money;
  };
  tot('Allocated in the budget', data.allocated);
  tot('Grants received during the period', data.received);
  tot('Spent on what the donor covers (donor\'s share)', data.spentShare);
  tot('Received − spent', data.received - data.spentShare);
  const noDoc = data.lines.filter((x) => !x.doc).length;
  s.addRow([`Expenses without their document: ${noDoc} of ${data.lines.length}`]);

  // ---- Grants
  const g = wb.addWorksheet('Grants');
  g.columns = [{ header: 'Date', width: 12 }, { header: 'Project', width: 22 }, { header: 'Amount (USD)', width: 16 }, { header: 'Reference', width: 22 }, { header: 'Note', width: 30 }];
  g.getRow(1).font = bold;
  for (const x of i.grants.filter((y) => y.donor_id === i.donorId && y.date && inPeriod(i.budget, y.date.slice(0, 7)))) {
    g.addRow([x.date, name(L.projects, x.project_id), x.amount_usd, x.reference ?? '', x.note ?? '']).getCell(3).numFmt = money;
  }

  // ---- Expenses
  const e = wb.addWorksheet('Expenses');
  e.columns = [
    { header: 'Date', width: 11 }, { header: 'Bill code', width: 26 }, { header: 'Account', width: 12 }, { header: 'Heading', width: 22 }, { header: 'Line', width: 26 },
    { header: 'Explanation', width: 34 }, { header: 'Party', width: 16 }, { header: 'SYP', width: 12 }, { header: 'USD', width: 10 }, { header: 'All in USD', width: 12 },
    { header: "Donor's share", width: 11 }, { header: "Donor's part (USD)", width: 14 }, { header: 'Document', width: 30 },
  ];
  e.getRow(1).font = bold;
  e.views = [{ state: 'frozen', ySplit: 1 }];
  const rowsById = new Map(i.rows.map((r) => [r.id, r]));
  for (const x of data.lines.sort((a, b) => a.date.localeCompare(b.date))) {
    const r = rowsById.get(x.id)!;
    const docs = i.docs.get(r.id) ?? [];
    const row = e.addRow([
      r.date, x.bill, name(L.accounts, r.account_id), name(L.headings, r.heading_id), name(L.lines, r.line_id),
      r.explanation ?? '', name(L.parties, r.party_id), r.exp_syp || null, r.exp_usd || null, x.usd, x.share, x.usd * x.share, docs.length ? docs.join(', ') : 'MISSING',
    ]);
    row.getCell(8).numFmt = '#,##0';
    for (const k of [9, 10, 12]) row.getCell(k).numFmt = money;
    row.getCell(11).numFmt = '0%';
    if (!docs.length) row.getCell(13).font = { color: { argb: 'FFB3261E' }, bold: true };
  }
  const last = e.addRow(['', '', '', '', '', 'Total', '', null, null, data.lines.reduce((t, x) => t + x.usd, 0), null, data.spentShare, '']);
  last.font = bold;
  for (const k of [10, 12]) last.getCell(k).numFmt = money;

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
