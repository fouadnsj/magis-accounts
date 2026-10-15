// One-time migration: reads Data, Budget, Transactions (TRX), Holders and Donors
// from Master Sup.xlsx / Master Com.xlsx and fills an EMPTY database.
//
// Rule: every register row is imported exactly as it is, so the totals match
// the workbook. A row the app would refuse to save is imported with a "review"
// note listing why. Nothing is guessed, nothing is dropped.

import type ExcelJS from 'exceljs';
import { type Db, type Stmt, nowIso, uuid } from '../db/db';
import { auditStmt, insertTrxStmt, setMetaStmt, setSettingStmt } from '../db/repo';
import { validateTrx } from '../domain/validate';
import type { Lists, Trx, TrxType } from '../domain/types';
import { TYPES } from '../domain/types';

type Cell = ExcelJS.CellValue;

/** The value Excel shows in a cell: formula result, rich text joined, dates as Date. */
export function cellValue(v: Cell): string | number | Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as Cell);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
    return null;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as string | number;
}

const str = (v: Cell): string | null => {
  const x = cellValue(v);
  if (x == null) return null;
  if (x instanceof Date) return isoDate(x);
  const s = String(x).trim();
  return s === '' ? null : s;
};

const num = (v: Cell): number => {
  const x = cellValue(v);
  if (x == null || x === '') return 0;
  if (typeof x === 'number') return x;
  const n = Number(String(x).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

/** Excel stores dates as UTC midnight; we keep the calendar day. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateOf(v: Cell): string | null {
  const x = cellValue(v);
  if (x instanceof Date) return isoDate(x);
  if (typeof x === 'number' && x > 20000 && x < 80000) {
    // a date typed as a serial number
    return isoDate(new Date(Date.UTC(1899, 11, 30) + x * 86400000));
  }
  if (typeof x === 'string') {
    const s = x.trim();
    let mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/yyyy
    if (mt) return `${mt[3]}-${mt[2].padStart(2, '0')}-${mt[1].padStart(2, '0')}`;
    mt = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mt) return `${mt[1]}-${mt[2]}-${mt[3]}`;
  }
  return null;
}

// ---------------------------------------------------------------- reading tables

interface TableData {
  headers: string[];
  rows: Cell[][];
}

function colToNum(col: string): number {
  return col.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}

function parseRef(ref: string) {
  const mt = ref.replace(/\$/g, '').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!mt) throw new Error('Bad range ' + ref);
  return { c1: colToNum(mt[1]), r1: Number(mt[2]), c2: colToNum(mt[3]), r2: Number(mt[4]) };
}

function findTable(wb: ExcelJS.Workbook, name: string): TableData | null {
  for (const ws of wb.worksheets) {
    const t = (ws as unknown as { tables?: Record<string, { table: { tableRef?: string; ref?: string } }> }).tables?.[name];
    if (!t) continue;
    const ref = t.table.tableRef ?? t.table.ref;
    if (!ref) continue;
    const { c1, r1, c2, r2 } = parseRef(ref);
    const headers: string[] = [];
    for (let c = c1; c <= c2; c++) headers.push(str(ws.getCell(r1, c).value) ?? '');
    const rows: Cell[][] = [];
    for (let r = r1 + 1; r <= r2; r++) {
      const row: Cell[] = [];
      for (let c = c1; c <= c2; c++) row.push(ws.getCell(r, c).value);
      rows.push(row);
    }
    return { headers, rows };
  }
  return null;
}

/** Values of one column of a table, by header text (first header that starts with it). */
function column(t: TableData | null, header: string): Cell[] {
  if (!t) return [];
  const i = t.headers.findIndex((h) => h === header || h.endsWith(header) || h.startsWith(header));
  if (i < 0) return [];
  return t.rows.map((r) => r[i]);
}

const distinct = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];

// ---------------------------------------------------------------- the seed

export interface SeedRow {
  excelRow: number;
  n: number | null;
  city: string | null;
  account: string | null;
  book: string | null;
  date: string | null;
  rawDate: string | null; // what the cell held when it is not a date
  /** How Excel saw the date cell. Excel ignores a date typed as text for the rate
   *  (N(E)=0 → USD_Rate) but still reads its month; an empty cell counts as January 1900. */
  dateKind: 'date' | 'text' | 'emptyText' | 'blank';
  type: string | null;
  heading: string | null;
  line: string | null;
  explanation: string | null;
  party: string | null;
  receipt: string | null;
  inc_syp: number;
  exp_syp: number;
  inc_usd: number;
  exp_usd: number;
  trf_syp: number;
  trf_usd: number;
  /** Excel's own computed values, kept to prove the app computes the same */
  excel: { rate: number | null; incUsdTot: number | null; expUsdTot: number | null; code: string | null };
}

export interface Seed {
  cities: string[];
  accounts: string[];
  projects: string[];
  parties: string[];
  books: { name: string; keeper: string | null; city: string | null; account: string | null; isMain: boolean; openSyp: number; openUsd: number }[];
  headings: { name: string; code: string }[];
  headingTypes: { type: string; heading: string }[];
  lines: { heading: string; line: string; code: string | null }[];
  projectFundLines: string[];
  donors: { name: string; project: string | null }[];
  rules: { project: string; account: string; heading: string | null }[];
  grants: { date: string | null; donor: string; project: string | null; amount: number; reference: string | null; note: string | null }[];
  settings: { usdRate: number | null; city: string | null; account: string | null; book: string | null };
  trx: SeedRow[];
  warnings: string[];
}

export function readWorkbook(wb: ExcelJS.Workbook): Seed {
  const warnings: string[] = [];
  const need = (name: string) => {
    const t = findTable(wb, name);
    if (!t) warnings.push(`Table ${name} not found`);
    return t;
  };

  const cities = distinct(column(need('Cities'), 'City').map(str));
  const accounts = distinct(column(need('AccountsList'), 'Account').map(str));
  const bookNames = distinct(column(need('BooksList'), 'Book').map(str));
  const parties = distinct(column(need('Parties'), 'Party').map(str));
  const projects = distinct(column(need('Projects'), 'Project').map(str));

  const donorsT = need('DonorsList');
  const donors = column(donorsT, 'Donor')
    .map((d, i) => ({ name: str(d), project: str(column(donorsT, 'Project')[i]) }))
    .filter((d): d is { name: string; project: string | null } => !!d.name);

  const projectFundLines = distinct(column(need('DonationLines'), 'Donation_Line').map(str));

  const pm = need('ProjectMap');
  const rules = column(pm, 'Project')
    .map((p, i) => ({ project: str(p), account: str(column(pm, 'Account')[i]), heading: str(column(pm, 'Heading')[i]) }))
    .filter((r): r is { project: string; account: string; heading: string | null } => !!r.project && !!r.account)
    .map((r) => ({ ...r, heading: r.heading === 'All' ? null : r.heading }));

  // ---- Budget
  const hd = need('Headings');
  const headings = column(hd, 'Budget Heading')
    .map((h, i) => ({ name: str(h), code: str(column(hd, 'Code')[i]) }))
    .filter((h): h is { name: string; code: string } => !!h.name && !!h.code);
  const ht = need('HeadingTypes');
  const headingTypes = column(ht, 'Type')
    .map((t, i) => ({ type: str(t), heading: str(column(ht, 'Budget Heading')[i]) }))
    .filter((x): x is { type: string; heading: string } => !!x.type && !!x.heading);
  const bt = findTable(wb, 'Budget2027') ?? findTableStartingWith(wb, 'Budget');
  if (!bt) warnings.push('Budget table not found');
  const lineCodes = readLineCodes(wb);
  const lines = column(bt, 'Budget Heading')
    .map((h, i) => ({ heading: str(h), line: str(column(bt, 'Budget Line')[i]) }))
    .filter((x): x is { heading: string; line: string } => !!x.heading && !!x.line)
    .map((x) => ({ ...x, code: lineCodes.get(`${x.heading}|${x.line}`) ?? null }));

  // ---- Settings block (Data!S4, S7:S9) and book keepers (Data!R16:U…)
  const data = wb.getWorksheet('Data');
  const settings = {
    usdRate: data ? num(data.getCell('S4').value) || null : null,
    city: data ? str(data.getCell('S7').value) : null,
    account: data ? str(data.getCell('S8').value) : null,
    book: data ? str(data.getCell('S9').value) : null,
  };
  const keepers = new Map<string, { keeper: string | null; city: string | null; account: string | null }>();
  if (data) {
    for (let r = 16; r <= 40; r++) {
      const b = str(data.getCell(r, 18).value);
      if (!b) continue;
      keepers.set(b, { keeper: str(data.getCell(r, 19).value), city: str(data.getCell(r, 20).value), account: str(data.getCell(r, 21).value) });
    }
  }

  // ---- Opening balances (Holders!B7 Main SYP, B8… per book; B20, B21… USD)
  const open = new Map<string, { syp: number; usd: number }>();
  const hs = wb.getWorksheet('Holders');
  if (hs) {
    open.set('Main', { syp: num(hs.getCell('B7').value), usd: num(hs.getCell('B20').value) });
    bookNames.forEach((b, i) => {
      // only trust the row if the sheet itself names that book there
      const nameS = str(hs.getCell(8 + i, 1).value);
      const nameU = str(hs.getCell(21 + i, 1).value);
      open.set(b, {
        syp: nameS === b ? num(hs.getCell(8 + i, 2).value) : 0,
        usd: nameU === b ? num(hs.getCell(21 + i, 2).value) : 0,
      });
    });
  }
  const books = ['Main', ...bookNames.filter((b) => b !== 'Main')].map((name) => ({
    name,
    keeper: keepers.get(name)?.keeper ?? null,
    city: keepers.get(name)?.city ?? null,
    account: keepers.get(name)?.account ?? null,
    isMain: name === 'Main',
    openSyp: open.get(name)?.syp ?? 0,
    openUsd: open.get(name)?.usd ?? 0,
  }));

  // ---- Grants (Donors sheet, table Donations — only in Master Sup)
  const dn = findTable(wb, 'Donations');
  const grants: Seed['grants'] = [];
  if (dn) {
    dn.rows.forEach((r) => {
      const donor = str(r[1]);
      const amount = num(r[3]);
      if (!donor && !amount) return;
      grants.push({ date: dateOf(r[0]), donor: donor ?? '', project: str(r[2]), amount, reference: str(r[4]), note: str(r[5]) });
    });
  }

  // ---- Register
  const trxT = need('TRX');
  const trx: SeedRow[] = [];
  if (trxT) {
    const H = (name: string) => trxT.headers.indexOf(name);
    const idx = Object.fromEntries(
      ['N', 'City', 'Account', 'Book', 'Date', 'Type', 'Budget_Heading', 'Budget_Line', 'Explanation', 'Party', 'Receipt',
        'Inc_SYP', 'Exp_SYP', 'Inc_USD', 'Exp_USD', 'Trf_SYP', 'Trf_USD', 'Rate', 'Inc_USD_Tot', 'Exp_USD_Tot', 'Code'].map((h) => [h, H(h)]),
    );
    const get = (row: Cell[], h: string) => (idx[h] >= 0 ? row[idx[h]] : null);
    const firstRow = parseRef(tableRef(wb, 'TRX') ?? 'A2:A2').r1 + 1;
    trxT.rows.forEach((row, i) => {
      const inputs = ['City', 'Account', 'Book', 'Date', 'Type', 'Budget_Heading', 'Budget_Line', 'Explanation', 'Party', 'Receipt',
        'Inc_SYP', 'Exp_SYP', 'Inc_USD', 'Exp_USD', 'Trf_SYP', 'Trf_USD'];
      if (!inputs.some((h) => str(get(row, h)) != null)) return; // spare empty row
      const date = dateOf(get(row, 'Date'));
      const rawCell = cellValue(get(row, 'Date'));
      const dateKind: SeedRow['dateKind'] =
        rawCell instanceof Date || typeof rawCell === 'number' ? 'date'
        : rawCell == null ? 'blank'
        : String(rawCell).trim() === '' ? 'emptyText'
        : 'text';
      const nTxt = str(get(row, 'N'));
      const exNum = (h: string) => {
        const v = cellValue(get(row, h));
        return typeof v === 'number' ? v : null;
      };
      trx.push({
        excelRow: firstRow + i,
        n: nTxt && /^\d+$/.test(nTxt) ? Number(nTxt) : null,
        city: str(get(row, 'City')),
        account: str(get(row, 'Account')),
        book: str(get(row, 'Book')),
        date,
        rawDate: dateKind === 'text' ? str(get(row, 'Date')) : null,
        dateKind,
        type: str(get(row, 'Type')),
        heading: str(get(row, 'Budget_Heading')),
        line: str(get(row, 'Budget_Line')),
        explanation: str(get(row, 'Explanation')),
        party: str(get(row, 'Party')),
        receipt: str(get(row, 'Receipt')),
        inc_syp: num(get(row, 'Inc_SYP')),
        exp_syp: num(get(row, 'Exp_SYP')),
        inc_usd: num(get(row, 'Inc_USD')),
        exp_usd: num(get(row, 'Exp_USD')),
        trf_syp: num(get(row, 'Trf_SYP')),
        trf_usd: num(get(row, 'Trf_USD')),
        excel: { rate: exNum('Rate'), incUsdTot: exNum('Inc_USD_Tot'), expUsdTot: exNum('Exp_USD_Tot'), code: str(get(row, 'Code')) },
      });
    });
  }

  return { cities, accounts, projects, parties, books, headings, headingTypes, lines, projectFundLines, donors, rules, grants, settings, trx, warnings };
}

function tableRef(wb: ExcelJS.Workbook, name: string): string | null {
  for (const ws of wb.worksheets) {
    const t = (ws as unknown as { tables?: Record<string, { table: { tableRef?: string; ref?: string } }> }).tables?.[name];
    if (t) return t.table.tableRef ?? t.table.ref ?? null;
  }
  return null;
}

function findTableStartingWith(wb: ExcelJS.Workbook, prefix: string): TableData | null {
  for (const ws of wb.worksheets) {
    const tables = (ws as unknown as { tables?: Record<string, unknown> }).tables ?? {};
    for (const k of Object.keys(tables)) if (k.startsWith(prefix)) return findTable(wb, k);
  }
  return null;
}

/** Budget!N:Q — the line list with its codes, as Excel last computed it. */
function readLineCodes(wb: ExcelJS.Workbook): Map<string, string> {
  const out = new Map<string, string>();
  const ws = wb.getWorksheet('Budget');
  if (!ws) return out;
  for (let r = 4; r <= ws.rowCount; r++) {
    const key = str(ws.getCell(r, 16).value); // P: Heading|Line
    const code = str(ws.getCell(r, 17).value); // Q: Line Code
    if (key && code) out.set(key, code);
  }
  return out;
}

// ---------------------------------------------------------------- writing the seed

export interface ImportReport {
  rows: number;
  toReview: number;
  addedToLists: string[];
  reviewSamples: { excelRow: number; reasons: string }[];
  warnings: string[];
}

export async function applySeed(db: Db, seed: Seed, who: string, sourceFile: string): Promise<ImportReport> {
  const existing = await db.query<{ c: number }>('SELECT COUNT(*) AS c FROM trx');
  if (existing[0].c > 0) throw new Error('The database already has register rows: migration only works on an empty database.');

  // The lists of the workbook replace whatever lists the new database had.
  const stmts: Stmt[] = [
    'project_rule', 'grant_row', 'heading_type', 'budget_line', 'heading', 'donor', 'cash_count', 'book', 'party', 'project', 'account', 'city', 'setting',
  ].map((tb) => ({ sql: `DELETE FROM ${tb}` }));
  stmts.unshift({ sql: 'UPDATE profile SET book_id = NULL' });
  const addedToLists: string[] = [];
  const ids = { city: new Map<string, number>(), account: new Map<string, number>(), project: new Map<string, number>(), party: new Map<string, number>(), book: new Map<string, number>(), heading: new Map<string, number>(), donor: new Map<string, number>() };
  const lineIds = new Map<string, number>();
  const key = (s: string) => s.trim().toLowerCase();

  const addNamed = (table: 'city' | 'account' | 'project' | 'party', names: string[]) => {
    names.forEach((name) => {
      if (ids[table].has(key(name))) return;
      const id = ids[table].size + 1;
      ids[table].set(key(name), id);
      stmts.push({ sql: `INSERT INTO ${table} (id, name, sort) VALUES (?, ?, ?)`, params: [id, name, id] });
    });
  };
  /** A value used in the register but missing from its list is added, and reported. */
  const ensure = (table: 'city' | 'account' | 'project' | 'party', name: string | null): number | null => {
    if (!name) return null;
    if (!ids[table].has(key(name))) {
      addNamed(table, [name]);
      addedToLists.push(`${table}: ${name}`);
    }
    return ids[table].get(key(name))!;
  };

  addNamed('city', seed.cities);
  addNamed('account', seed.accounts);
  addNamed('project', seed.projects);
  addNamed('party', seed.parties);

  seed.books.forEach((b, i) => {
    const id = i + 1;
    ids.book.set(key(b.name), id);
    stmts.push({
      sql: 'INSERT INTO book (id, name, keeper_name, city_id, account_id, is_main, opening_syp, opening_usd, sort) VALUES (?,?,?,?,?,?,?,?,?)',
      params: [id, b.name, b.keeper, ensure('city', b.city), ensure('account', b.account), b.isMain ? 1 : 0, b.openSyp, b.openUsd, id],
    });
  });

  seed.headings.forEach((h, i) => {
    const id = i + 1;
    ids.heading.set(key(h.name), id);
    stmts.push({ sql: 'INSERT INTO heading (id, name, code, sort) VALUES (?,?,?,?)', params: [id, h.name, h.code, id] });
  });
  seed.headingTypes.forEach((ht) => {
    const hid = ids.heading.get(key(ht.heading));
    if (!hid || !(TYPES as readonly string[]).includes(ht.type)) {
      seed.warnings.push(`HeadingTypes: ${ht.type} → ${ht.heading} ignored`);
      return;
    }
    stmts.push({ sql: 'INSERT OR IGNORE INTO heading_type (heading_id, type) VALUES (?, ?)', params: [hid, ht.type] });
  });

  // Lines: keep Excel's code; a line without one gets the next free number of its heading.
  const usedCodes = new Set(seed.lines.map((l) => l.code).filter(Boolean) as string[]);
  const isFund = new Set(seed.projectFundLines.map(key));
  seed.lines.forEach((l, i) => {
    const hid = ids.heading.get(key(l.heading));
    if (!hid) {
      seed.warnings.push(`Budget line "${l.line}" has unknown heading "${l.heading}"`);
      return;
    }
    let code = l.code;
    if (!code) {
      const hcode = seed.headings.find((h) => key(h.name) === key(l.heading))!.code;
      let k = 1;
      while (usedCodes.has(`${hcode}.${k}`)) k++;
      code = `${hcode}.${k}`;
      usedCodes.add(code);
    }
    const id = i + 1;
    lineIds.set(`${key(l.heading)}|${key(l.line)}`, id);
    stmts.push({
      sql: 'INSERT INTO budget_line (id, heading_id, name, code, is_project_fund) VALUES (?,?,?,?,?)',
      params: [id, hid, l.line, code, isFund.has(key(l.line)) ? 1 : 0],
    });
  });

  seed.donors.forEach((d, i) => {
    const id = i + 1;
    ids.donor.set(key(d.name), id);
    stmts.push({ sql: 'INSERT INTO donor (id, name, default_project_id, sort) VALUES (?,?,?,?)', params: [id, d.name, d.project ? ensure('project', d.project) : null, id] });
  });

  seed.rules.forEach((r) => {
    const hid = r.heading ? ids.heading.get(key(r.heading)) ?? null : null;
    stmts.push({
      sql: 'INSERT OR IGNORE INTO project_rule (project_id, account_id, heading_id) VALUES (?,?,?)',
      params: [ensure('project', r.project), ensure('account', r.account), hid],
    });
  });

  seed.grants.forEach((g) => {
    const did = ids.donor.get(key(g.donor));
    if (!did || !g.date) {
      seed.warnings.push(`Grant row skipped (no donor or date): ${g.donor} ${g.amount}`);
      return;
    }
    stmts.push({
      sql: 'INSERT INTO grant_row (id, date, donor_id, project_id, amount_usd, reference, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      params: [uuid(), g.date, did, g.project ? ensure('project', g.project) : null, g.amount, g.reference, g.note, nowIso(), who],
    });
  });

  // Settings
  stmts.push(setSettingStmt('usd_rate', seed.settings.usdRate ?? 130));
  stmts.push(setSettingStmt('def_city_id', seed.settings.city ? ensure('city', seed.settings.city) : null));
  stmts.push(setSettingStmt('def_account_id', seed.settings.account ? ensure('account', seed.settings.account) : null));
  stmts.push(setSettingStmt('def_book_id', seed.settings.book ? ids.book.get(key(seed.settings.book)) ?? null : null));
  stmts.push(setSettingStmt('exchange_tolerance', 0.25));

  // ---- Register rows (first pass: build them; second pass: check them)
  const rows: Trx[] = [];
  const notes = new Map<string, string[]>();
  let n = 1;
  for (const s of seed.trx) {
    const t: Trx = {
      id: uuid(),
      n: n++,
      city_id: ensure('city', s.city),
      account_id: ensure('account', s.account),
      book_id: null,
      date: s.date,
      type: (TYPES as readonly string[]).includes(s.type ?? '') ? (s.type as TrxType) : null,
      heading_id: s.heading ? ids.heading.get(key(s.heading)) ?? null : null,
      line_id: s.heading && s.line ? lineIds.get(`${key(s.heading)}|${key(s.line)}`) ?? null : null,
      explanation: s.explanation,
      party_id: ensure('party', s.party),
      receipt: s.receipt,
      inc_syp: s.inc_syp, exp_syp: s.exp_syp, inc_usd: s.inc_usd, exp_usd: s.exp_usd, trf_syp: s.trf_syp, trf_usd: s.trf_usd,
      transfer_group: null, review: null, sent_at: null,
      created_at: nowIso(), created_by: who, updated_at: null, source_file: `${sourceFile}#row${s.excelRow}`,
    };
    const extra: string[] = [];
    if (s.book) {
      const bid = ids.book.get(key(s.book));
      if (bid) t.book_id = bid;
      else extra.push(`Book "${s.book}" is not in the book list`);
    }
    if (s.type && !t.type) extra.push(`Type "${s.type}" unknown`);
    if (s.heading && t.heading_id == null) extra.push(`Heading "${s.heading}" is not in the budget`);
    if (s.line && t.line_id == null && t.heading_id != null) extra.push(`Line "${s.line}" is not under heading "${s.heading}"`);
    if (s.dateKind === 'text' && s.date)
      extra.push(`Date was typed as text "${s.rawDate}" in Excel (Excel used rate ${seed.settings.usdRate ?? 130} for it) — confirm the date`);
    else if (s.rawDate) extra.push(`Date cell holds "${s.rawDate}"`);
    notes.set(t.id, extra);
    rows.push(t);
  }

  // Lists as they will be once the statements run — to check rows with the real rules.
  const lists = seedLists(seed, ids, lineIds);
  const report: ImportReport = { rows: rows.length, toReview: 0, addedToLists, reviewSamples: [], warnings: seed.warnings };
  const ctx = { lists, rows: [] as Trx[], closedMonths: new Set<string>(), today: '9999-12-31' };
  for (const t of rows) {
    const { errors } = validateTrx(t, ctx);
    const reasons = [...notes.get(t.id)!, ...errors.map((e) => e.en)];
    if (reasons.length) {
      t.review = reasons.join(' | ');
      report.toReview++;
      if (report.reviewSamples.length < 400) report.reviewSamples.push({ excelRow: Number(t.source_file?.split('#row')[1]), reasons: reasons.join('; ') });
    }
    stmts.push(insertTrxStmt(t));
  }

  stmts.push(setMetaStmt('last_n', String(n - 1)));
  stmts.push(setMetaStmt('migrated_from', sourceFile));
  stmts.push(setMetaStmt('migrated_at', nowIso()));
  stmts.push(auditStmt(who, 'migrate', 'trx', null, null, { file: sourceFile, rows: rows.length, toReview: report.toReview }));
  stmts.push({
    sql: 'INSERT INTO import_log (at, who, kind, file_name, added, skipped, detail) VALUES (?,?,?,?,?,?,?)',
    params: [nowIso(), who, 'workbook', sourceFile, rows.length, 0, JSON.stringify({ toReview: report.toReview, addedToLists })],
  });
  await db.batch(stmts);
  return report;
}

/** Lists object matching what applySeed inserts (ids included), for validation. */
function seedLists(
  seed: Seed,
  ids: Record<'city' | 'account' | 'project' | 'party' | 'book' | 'heading' | 'donor', Map<string, number>>,
  lineIds: Map<string, number>,
): Lists {
  const named = (m: Map<string, number>) => [...m.entries()].map(([name, id]) => ({ id, name, active: 1 }));
  const key = (s: string) => s.trim().toLowerCase();
  return {
    cities: named(ids.city),
    accounts: named(ids.account),
    projects: named(ids.project),
    parties: named(ids.party),
    books: seed.books.map((b) => ({
      id: ids.book.get(key(b.name))!, name: b.name, active: 1, keeper_name: b.keeper, city_id: null, account_id: null,
      is_main: b.isMain ? 1 : 0, opening_syp: b.openSyp, opening_usd: b.openUsd,
    })),
    headings: seed.headings.map((h) => ({ id: ids.heading.get(key(h.name))!, name: h.name, code: h.code, active: 1 })),
    headingTypes: seed.headingTypes
      .filter((x) => ids.heading.has(key(x.heading)))
      .map((x) => ({ heading_id: ids.heading.get(key(x.heading))!, type: x.type as TrxType })),
    lines: seed.lines
      .filter((l) => lineIds.has(`${key(l.heading)}|${key(l.line)}`))
      .map((l) => ({
        id: lineIds.get(`${key(l.heading)}|${key(l.line)}`)!, heading_id: ids.heading.get(key(l.heading))!, name: l.line,
        code: l.code ?? '', is_project_fund: 0, active: 1,
      })),
    donors: [],
    rules: [],
    settings: { usd_rate: seed.settings.usdRate ?? 130, def_city_id: null, def_account_id: null, def_book_id: null, fiscal_start: null, exchange_tolerance: 0.25 },
  };
}
