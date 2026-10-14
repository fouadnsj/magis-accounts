// Export to Excel: values only (no formulas to break), the register in the
// exact TRX layout of the workbook so its reports keep working.

import ExcelJS from 'exceljs';
import type { Computed, Lists, Trx } from '../domain/types';
import { MONTHS_EN } from '../domain/types';
import { coverage, exchangeLog, holders, inPeriod, monthly, projectFunds, summary, type GrantRow, type Period } from '../domain/reports';

/** The register columns, in this exact order (brief §8). */
export const TRX_HEADERS = [
  'N', 'City', 'Account', 'Book', 'Date', 'Type', 'Budget_Heading', 'Budget_Line', 'Explanation', 'Party', 'Receipt',
  'Inc_SYP', 'Exp_SYP', 'Inc_USD', 'Exp_USD', 'Trf_SYP', 'Trf_USD',
  'Rate', 'Inc_USD_Tot', 'Exp_USD_Tot', 'Code', 'Bill_Code', 'Month', 'Month_EN', 'Year', 'Exch_Rate', 'Entry_ID',
] as const;

const FMT_SYP = '#,##0;(#,##0);-';
const FMT_USD = '#,##0.00;(#,##0.00);-';
const FMT_DATE = 'dd/mm/yyyy';

// Colour code of the workbook (rules file §2).
const HEAD_YELLOW = { fill: 'FFFFD966', font: 'FF7F6000' }; // date, text and amount columns
const HEAD_BLUE = { fill: 'FF2E75B6', font: 'FFFFFFFF' }; // classification
const HEAD_PURPLE = { fill: 'FF7030A0', font: 'FFFFFFFF' }; // transfer / exchange
const HEAD_GREY = { fill: 'FFF2F2F2', font: 'FF595959' }; // computed
const ROW_TINT: Record<string, string> = { Income: 'FFE2EFDA', Exp: 'FFF8CBCB', Transfer: 'FFDED0EC', Exchange: 'FFDDEBF7' };

function headerStyle(h: string) {
  if (['Type', 'Budget_Heading', 'Budget_Line', 'Party', 'City', 'Account', 'Book'].includes(h)) return HEAD_BLUE;
  if (['Trf_SYP', 'Trf_USD'].includes(h)) return HEAD_PURPLE;
  if (['Rate', 'Inc_USD_Tot', 'Exp_USD_Tot', 'Code', 'Bill_Code', 'Month', 'Month_EN', 'Year', 'Exch_Rate', 'Entry_ID'].includes(h)) return HEAD_GREY;
  return HEAD_YELLOW;
}

/** Excel date from 'YYYY-MM-DD' (no time zone shift). */
const xlDate = (d: string | null) => (d ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))) : null);

export interface ExportOptions {
  period: Period | null;
  bookId: number | null;
  accountId: number | null;
  /** B:Q + Entry_ID only, for pasting under the last row of an existing workbook */
  registerOnly: boolean;
  withLists: boolean;
  withReports: boolean;
  /** Sup only: donors, grants, coverage, project funds */
  confidential: boolean;
  grants: GrantRow[];
  organisation: string | null;
}

export async function exportWorkbook(rows: Trx[], comp: Map<string, Computed>, lists: Lists, o: ExportOptions): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MAGIS Accounts';
  wb.created = new Date();

  const name = <T extends { id: number; name: string }>(arr: T[], id: number | null) => (id == null ? '' : arr.find((x) => x.id === id)?.name ?? '');
  const picked = rows
    .filter((r) => inPeriod(r, o.period))
    .filter((r) => o.bookId == null || r.book_id === o.bookId)
    .filter((r) => o.accountId == null || r.account_id === o.accountId);

  // ---------------------------------------------------------------- Transactions
  const ws = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 2, rightToLeft: false }] });
  ws.getCell('A1').value = 'السجل · TRANSACTIONS — سطر واحد لكل حركة · one row per movement of money';
  ws.getCell('A1').font = { bold: true, size: 13 };

  const headers: string[] = o.registerOnly ? TRX_HEADERS.slice(1, 17).concat('Entry_ID') : [...TRX_HEADERS];
  const data = picked.map((t) => {
    const c = comp.get(t.id)!;
    const full: Record<string, ExcelJS.CellValue> = {
      N: t.n == null ? '' : String(t.n).padStart(4, '0'),
      City: name(lists.cities, t.city_id),
      Account: name(lists.accounts, t.account_id),
      Book: name(lists.books, t.book_id),
      Date: xlDate(t.date),
      Type: t.type ?? '',
      Budget_Heading: name(lists.headings, t.heading_id),
      Budget_Line: name(lists.lines, t.line_id),
      Explanation: t.explanation ?? '',
      Party: name(lists.parties, t.party_id),
      Receipt: t.receipt != null && /^\d+$/.test(t.receipt) ? Number(t.receipt) : t.receipt ?? '',
      Inc_SYP: t.inc_syp || null,
      Exp_SYP: t.exp_syp || null,
      Inc_USD: t.inc_usd || null,
      Exp_USD: t.exp_usd || null,
      Trf_SYP: t.trf_syp || null,
      Trf_USD: t.trf_usd || null,
      Rate: c.rate,
      Inc_USD_Tot: c.incUsdTot,
      Exp_USD_Tot: c.expUsdTot,
      Code: c.code,
      Bill_Code: c.billCode,
      Month: c.month,
      Month_EN: c.monthEn,
      Year: c.year,
      Exch_Rate: c.exchRate,
      Entry_ID: t.id,
    };
    return headers.map((h) => full[h] ?? null);
  });

  ws.addTable({
    name: 'TRX',
    ref: 'A2',
    headerRow: true,
    style: { theme: 'TableStyleLight1', showRowStripes: false },
    columns: headers.map((h) => ({ name: h, filterButton: true })),
    rows: data.length ? data : [headers.map(() => null)],
  });

  headers.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    const st = headerStyle(h);
    const cell = ws.getCell(2, i + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
    cell.font = { bold: true, color: { argb: st.font } };
    if (h === 'Date') col.numFmt = FMT_DATE;
    if (['Inc_SYP', 'Exp_SYP', 'Trf_SYP'].includes(h)) col.numFmt = FMT_SYP;
    if (['Inc_USD', 'Exp_USD', 'Trf_USD', 'Inc_USD_Tot', 'Exp_USD_Tot', 'Rate', 'Exch_Rate'].includes(h)) col.numFmt = FMT_USD;
    if (h === 'Year' || h === 'Month') col.numFmt = '0';
    col.width = h === 'Explanation' ? 40 : h === 'Entry_ID' ? 38 : ['Budget_Heading', 'Budget_Line'].includes(h) ? 26 : h === 'Date' ? 12 : 11;
  });
  const typeCol = headers.indexOf('Type');
  data.forEach((row, i) => {
    const tint = ROW_TINT[String(row[typeCol] ?? '')];
    if (!tint) return;
    const r = ws.getRow(3 + i);
    for (let c = 1; c <= headers.length; c++) r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint } };
  });

  if (o.registerOnly) return new Uint8Array(await wb.xlsx.writeBuffer());

  // ---------------------------------------------------------------- lists
  if (o.withLists) {
    const sheet = (title: string, cols: string[], body: (string | number | null)[][]) => {
      const s = wb.addWorksheet(title);
      s.addRow(cols).font = { bold: true };
      s.getRow(1).eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BLUE.fill } }));
      s.getRow(1).eachCell((c) => (c.font = { bold: true, color: { argb: HEAD_BLUE.font } }));
      body.forEach((b) => s.addRow(b));
      cols.forEach((_, i) => (s.getColumn(i + 1).width = 24));
      return s;
    };
    const act = (a: number) => (a ? 'yes' : 'no');
    sheet('Cities', ['City', 'Active'], lists.cities.map((x) => [x.name, act(x.active)]));
    sheet('Accounts', ['Account', 'Project (rule "All")', 'Active'], lists.accounts.map((a) => [a.name, name(lists.projects, lists.rules.find((r) => r.account_id === a.id && r.heading_id == null)?.project_id ?? null), act(a.active)]));
    sheet('Books', ['Book', 'Keeper', 'City', 'Account', 'Main', 'Opening SYP', 'Opening USD', 'Active'], lists.books.map((b) => [b.name, b.keeper_name, name(lists.cities, b.city_id), name(lists.accounts, b.account_id), b.is_main ? 'yes' : '', b.opening_syp, b.opening_usd, act(b.active)]));
    sheet('Types', ['Type'], ['Income', 'Exp', 'Transfer', 'Exchange'].map((t) => [t]));
    sheet('Parties', ['Party', 'Active'], lists.parties.map((x) => [x.name, act(x.active)]));
    sheet('Budget', ['Budget Heading', 'Heading Code', 'Budget Line', 'Line Code', 'Project fund', 'Active'],
      lists.lines.map((l) => {
        const h = lists.headings.find((x) => x.id === l.heading_id);
        return [h?.name ?? '', h?.code ?? '', l.name, l.code, l.is_project_fund ? 'yes' : '', act(l.active)];
      }));
    sheet('HeadingTypes', ['Type', 'Budget Heading'],
      lists.headingTypes.map((x) => [x.type, name(lists.headings, x.heading_id)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    sheet('Projects', ['Project', 'Active'], lists.projects.map((x) => [x.name, act(x.active)]));
    sheet('ProjectMap', ['Project', 'Account', 'Heading'], lists.rules.map((r) => [name(lists.projects, r.project_id), name(lists.accounts, r.account_id), r.heading_id == null ? 'All' : name(lists.headings, r.heading_id)]));
    if (o.confidential) {
      sheet('Donors', ['Donor', 'Project'], lists.donors.map((d) => [d.name, name(lists.projects, d.default_project_id)]));
      const g = sheet('Grants', ['Date', 'Donor', 'Project', 'Amount USD', 'Reference', 'Note'],
        o.grants.map((x) => [x.date, name(lists.donors, x.donor_id), name(lists.projects, x.project_id), x.amount_usd, x.reference, x.note]));
      g.getColumn(4).numFmt = FMT_USD;
    }
  }

  // ---------------------------------------------------------------- reports
  if (o.withReports) {
    const p = o.period;
    const s = summary(rows, comp, lists, p);
    const sh = wb.addWorksheet('Summary');
    sh.addRow([`الفترة · Period: ${p ? `${p.from} → ${p.to}` : 'all'}`]).font = { bold: true };
    sh.addRow([]);
    const kv: [string, number, string][] = [
      ['إيراد ل.س · Income SYP', s.incSyp, FMT_SYP], ['نفقة ل.س · Expense SYP', s.expSyp, FMT_SYP], ['الصافي ل.س · Net SYP', s.incSyp - s.expSyp, FMT_SYP],
      ['إيراد $ · Income USD', s.incUsd, FMT_USD], ['نفقة $ · Expense USD', s.expUsd, FMT_USD], ['الصافي $ · Net USD', s.incUsd - s.expUsd, FMT_USD],
      ['إيراد إجمالي $ · Income USD-eq', s.incEq, FMT_USD], ['نفقة إجمالية $ · Expense USD-eq', s.expEq, FMT_USD], ['الصافي الإجمالي $ · Net USD-eq', s.incEq - s.expEq, FMT_USD],
      ['عدد الحركات · Count', s.count, '0'], ['بلا خط موازنة · No budget line', s.noLine, '0'],
    ];
    kv.forEach(([k, v, f]) => {
      const r = sh.addRow([k, v]);
      r.getCell(2).numFmt = f;
    });
    sh.getColumn(1).width = 40;
    sh.getColumn(2).width = 18;

    const year = Number((p?.to ?? new Date().toISOString()).slice(0, 4));
    const mo = wb.addWorksheet('Monthly');
    mo.addRow(['Month', 'Inc SYP', 'Exp SYP', 'Net SYP', 'Cumul SYP', 'Inc USD', 'Exp USD', 'Net USD', 'Cumul USD', 'Count', 'Inc USD-eq', 'Exp USD-eq']).font = { bold: true };
    monthly(rows, comp, year).forEach((l, i) => {
      const r = mo.addRow([`${MONTHS_EN[i]} ${year}`, l.incSyp, l.expSyp, l.incSyp - l.expSyp, l.cumSyp, l.incUsd, l.expUsd, l.incUsd - l.expUsd, l.cumUsd, l.count, l.incEq, l.expEq]);
      [2, 3, 4, 5].forEach((c) => (r.getCell(c).numFmt = FMT_SYP));
      [6, 7, 8, 9, 11, 12].forEach((c) => (r.getCell(c).numFmt = FMT_USD));
    });
    mo.columns.forEach((c) => (c.width = 14));

    const ho = wb.addWorksheet('Holders');
    for (const cur of ['SYP', 'USD'] as const) {
      ho.addRow([`${cur}`]).font = { bold: true };
      ho.addRow(['Holder', 'Opening', 'Income', 'Expenses', 'Transfers', 'Exchange', 'Should hold']).font = { bold: true };
      holders(rows, lists.books, cur).forEach((l) => {
        const r = ho.addRow([l.book?.name ?? 'No book written', l.opening, l.income, l.expenses, l.transfers, l.exchange, l.shouldHold]);
        for (let c = 2; c <= 7; c++) r.getCell(c).numFmt = cur === 'SYP' ? FMT_SYP : FMT_USD;
      });
      ho.addRow([]);
    }
    ho.columns.forEach((c) => (c.width = 16));

    const ex = exchangeLog(rows, p);
    const el = wb.addWorksheet('Exchange log');
    el.addRow(['Date', 'Holder', 'USD given', 'SYP received', 'Rate']).font = { bold: true };
    ex.rows.forEach((x) => {
      const r = el.addRow([xlDate(x.trx.date), name(lists.books, x.trx.book_id), x.usdOut, x.sypIn, x.rate]);
      r.getCell(1).numFmt = FMT_DATE;
      r.getCell(3).numFmt = FMT_USD;
      r.getCell(4).numFmt = FMT_SYP;
      r.getCell(5).numFmt = FMT_USD;
    });
    el.columns.forEach((c) => (c.width = 14));

    if (o.confidential && p) {
      const cv = coverage(rows, comp, lists, p, year);
      const co = wb.addWorksheet('Coverage');
      co.addRow([`Coverage ${p.from} → ${p.to} (USD-eq)`]).font = { bold: true };
      const cs = cv.summary;
      ([
        ['Expenses', cs.expenses], ['Own income', cs.ownIncome], ['Funding gap', cs.gap], ['Project funds (From the Respo)', cs.projectFunds],
        ['Surplus / (shortfall)', cs.surplus], ['% covered by own income', cs.pctOwn], ['% covered by project funds', cs.pctFunds], ['% not covered', cs.pctNot],
      ] as [string, number][]).forEach(([k, v]) => {
        const r = co.addRow([k, v]);
        r.getCell(2).numFmt = k.startsWith('%') ? '0.0%' : FMT_USD;
      });
      co.addRow([]);
      co.addRow(['Budget heading', ...cv.accounts.map((a) => a.name), 'Total', 'Own income', 'Project funds', 'Not covered', '% of spending']).font = { bold: true };
      cv.byHeading.forEach((h) => {
        const r = co.addRow([h.name || 'No valid heading', ...cv.accounts.map((a) => h.perAccount.get(a.id) ?? 0), h.total, h.own, h.funds, h.notCovered, h.share]);
        for (let c = 2; c <= cv.accounts.length + 5; c++) r.getCell(c).numFmt = FMT_USD;
        r.getCell(cv.accounts.length + 6).numFmt = '0.0%';
      });
      co.columns.forEach((c) => (c.width = 16));
      co.getColumn(1).width = 34;

      const pf = projectFunds(rows, comp, lists, o.grants);
      const ps = wb.addWorksheet('Project funds');
      ps.addRow(['Project', 'Received', 'Sent to centre', 'At the Respo', 'Spent', 'Unspent at centre', 'Status']).font = { bold: true };
      pf.lines.forEach((l) => {
        const r = ps.addRow([l.name, l.received, l.sent, l.atRespo, l.spent, l.unspent, l.status]);
        for (let c = 2; c <= 6; c++) r.getCell(c).numFmt = FMT_USD;
      });
      ps.columns.forEach((c) => (c.width = 18));
    }
  }

  if (o.organisation) wb.title = o.organisation;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
