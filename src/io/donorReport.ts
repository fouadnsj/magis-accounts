// The standard donor report (Excel): for one donor and one budget (its period),
// what he covers in the budget, what he gave (Grants) during the period, and every
// expense of the budget that he covers, with his share and whether its document
// (scan) is attached.
import ExcelJS from 'exceljs';
import type { Computed, Lists, Trx } from '../domain/types';
import { WHOLE, cellsOf, cover, effectivePct, allocWorth, inPeriod, periodEnd, type Budget, type BudgetAccount, type BudgetAlloc, type BudgetAmount } from '../domain/budget';
import type { GrantCard } from '../domain/grants';

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
  grants: GrantCard[];
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
  const received = i.grants.filter((g) => g.donor_id === i.donorId && g.status === 'hand' && g.hand_on && inPeriod(i.budget, g.hand_on.slice(0, 7))).reduce((s, g) => s + (g.hand_usd ?? 0), 0);
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
  g.columns = [{ header: 'Amount', width: 14 }, { header: 'Currency', width: 9 }, { header: 'Step', width: 12 }, { header: 'Promised', width: 12 }, { header: 'Approved', width: 12 },
    { header: 'Transferred', width: 12 }, { header: 'In the bank', width: 12 }, { header: 'In hand', width: 12 }, { header: 'USD in hand', width: 14 }, { header: 'Reference', width: 22 }, { header: 'Note', width: 30 }];
  g.getRow(1).font = bold;
  for (const x of i.grants.filter((y) => y.donor_id === i.donorId && (!y.hand_on || inPeriod(i.budget, y.hand_on.slice(0, 7))))) {
    const r = g.addRow([x.amount, x.currency, x.status, x.promised_on, x.approved_on, x.transferred_on, x.bank_on, x.hand_on, x.hand_usd, x.reference ?? '', x.note ?? '']);
    r.getCell(1).numFmt = money;
    r.getCell(9).numFmt = money;
  }

  // ---- By category: the donor's part of the budget, line by line, against what was spent (with the budget's own codes)
  const c = wb.addWorksheet('By category');
  c.columns = [{ width: 10 }, { width: 44 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 12 }];
  c.addRow([`${i.organisation} — ${donor} — ${i.budget.name}: budget and spending by category`]).font = { bold: true, size: 14 };
  c.addRow([`Budget = the part of each budget line the donor covers · Spent = the donor's share of the expenses · USD`]).font = { italic: true, color: { argb: 'FF666666' } };
  c.addRow([]);
  c.addRow(['Code', 'Category / line', 'Budget (donor part)', 'Spent (donor part)', 'Left', '% spent']).font = bold;
  const lumpAccounts = new Set(i.accounts.filter((a) => a.lump_usd != null && a.lump_usd > 0).map((a) => a.account_id));
  type Acc = { budget: number; spent: number };
  const byLine = new Map<string, Acc>(); // `${heading}|${line}` or `L|${account}`
  const bump = (key: string, k: 'budget' | 'spent', v: number) => byLine.set(key, { ...(byLine.get(key) ?? { budget: 0, spent: 0 }), [k]: (byLine.get(key)?.[k] ?? 0) + v });
  for (const x of cells) {
    const cv = cover(i.allocs, eff, x.account_id, x.line_id, headingOf.get(x.line_id) ?? WHOLE, x.amount_usd);
    const mineUsd = cv.donors.filter((dn) => dn.donor_id === i.donorId).reduce((t, dn) => t + dn.usd, 0);
    if (mineUsd <= 0) continue;
    bump(x.line_id === WHOLE ? `L|${x.account_id}` : `${headingOf.get(x.line_id)}|${x.line_id}`, 'budget', mineUsd);
  }
  const rowsOf = new Map(i.rows.map((r) => [r.id, r]));
  for (const x of data.lines) {
    const r = rowsOf.get(x.id)!;
    bump(r.account_id != null && lumpAccounts.has(r.account_id) ? `L|${r.account_id}` : `${r.heading_id}|${r.line_id}`, 'spent', x.usd * x.share);
  }
  const pctF = (row: number) => ({ formula: `IF(C${row}>0,D${row}/C${row},"")` });
  const headingIds = [...new Set([...byLine.keys()].filter((k) => !k.startsWith('L|')).map((k) => Number(k.split('|')[0])))];
  headingIds.sort((a, b) => (L.headings.find((h) => h.id === a)?.code ?? '').localeCompare(L.headings.find((h) => h.id === b)?.code ?? '', undefined, { numeric: true }));
  const headRows: number[] = [];
  const style = (row: ExcelJS.Row, headRow: boolean) => {
    row.getCell(3).numFmt = money; row.getCell(4).numFmt = money; row.getCell(5).numFmt = money; row.getCell(6).numFmt = '0%';
    if (headRow) { row.font = bold; row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFE8D8' } }; }); }
  };
  for (const hid of headingIds) {
    const h = L.headings.find((x) => x.id === hid);
    const keys = [...byLine.keys()].filter((k) => k.startsWith(`${hid}|`));
    const hr = c.addRow([h?.code ?? '', h?.name ?? '(no heading)', null, null, null, null]);
    headRows.push(hr.number);
    const lineKeys = keys.sort((a, b) => (L.lines.find((l) => l.id === Number(a.split('|')[1]))?.code ?? '').localeCompare(L.lines.find((l) => l.id === Number(b.split('|')[1]))?.code ?? '', undefined, { numeric: true }));
    const first = hr.number + 1;
    for (const k of lineKeys) {
      const ln = L.lines.find((l) => l.id === Number(k.split('|')[1]));
      const v = byLine.get(k)!;
      const row = c.addRow([ln?.code ?? '', `   ${ln?.name ?? '(no line)'}`, v.budget, v.spent, null, null]);
      row.getCell(5).value = { formula: `C${row.number}-D${row.number}`, result: v.budget - v.spent };
      row.getCell(6).value = pctF(row.number);
      style(row, false);
    }
    const last = hr.number + lineKeys.length;
    hr.getCell(3).value = { formula: `SUM(C${first}:C${last})`, result: lineKeys.reduce((t, k) => t + byLine.get(k)!.budget, 0) };
    hr.getCell(4).value = { formula: `SUM(D${first}:D${last})`, result: lineKeys.reduce((t, k) => t + byLine.get(k)!.spent, 0) };
    hr.getCell(5).value = { formula: `C${hr.number}-D${hr.number}` };
    hr.getCell(6).value = pctF(hr.number);
    style(hr, true);
  }
  for (const k of [...byLine.keys()].filter((x) => x.startsWith('L|'))) {
    const v = byLine.get(k)!;
    const row = c.addRow(['', `${name(L.accounts, Number(k.split('|')[1]))} — one amount for the whole account`, v.budget, v.spent, null, null]);
    row.getCell(5).value = { formula: `C${row.number}-D${row.number}` };
    row.getCell(6).value = pctF(row.number);
    style(row, false);
    headRows.push(row.number);
  }
  const totalRow = c.addRow(['', 'Total', headRows.length ? { formula: headRows.map((n) => `C${n}`).join('+') } : 0, headRows.length ? { formula: headRows.map((n) => `D${n}`).join('+') } : 0, null, null]);
  totalRow.getCell(5).value = { formula: `C${totalRow.number}-D${totalRow.number}` };
  totalRow.getCell(6).value = pctF(totalRow.number);
  style(totalRow, true);
  const unplaced = data.spentShare - [...byLine.values()].reduce((t, v) => t + v.spent, 0);
  if (Math.abs(unplaced) > 0.005) c.addRow(['', 'Spent on rows without a heading or line', null, unplaced]).getCell(4).numFmt = money;
  c.views = [{ state: 'frozen', ySplit: 4 }];

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
