// The inventory of a centre (Fouad, 21 November 2026): what the centre owns, where it is, its state. The finance follows
// the assets, so it lives in the centre's own database, beside the register: every purchase on a furniture or equipment
// line must be listed as an item (or marked "not an item"). The value of a bought item is the USD value of its purchase
// entry; of a gift or an old item, an estimate. No depreciation. Nothing is deleted: an item leaves (disposed, lost).
// Pure functions here (shared by the server operations, the screens and the tests).
import type { Lists, Trx } from '../domain/types';

export interface InvCategory { id: number; name: string; serial: number; active: number; sort: number }
export interface InvOriginRow { id: number; name: string; bought: number; active: number; sort: number }
export interface InvPlace { id: number; name: string; active: number; sort: number }
export interface InvSource { kind: 'heading' | 'line'; ref: number }
export type InvCondition = 'good' | 'repair' | 'broken';
export type InvStatus = 'in_use' | 'disposed' | 'lost';
export type InvOrigin = 'bought' | 'gift' | 'old';

export interface InvItem {
  id: number;
  code: string;
  name: string;
  category_id: number | null;
  place_id: number | null;
  qty: number;
  brand: string | null;
  model: string | null;
  serial: string | null;
  condition: InvCondition;
  status: InvStatus;
  holder: string | null;
  origin: InvOrigin;
  /** where it comes from, in the centre's own list */
  origin_id: number | null;
  acquired_on: string | null;
  trx_id: string | null;
  party_id: number | null;
  /** one unit */
  value_usd: number | null;
  value_note: string | null;
  counted_on: string | null;
  note: string | null;
  disposed_on: string | null;
  disposed_why: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
}

export interface InvMove { id: number; item_id: number; on_date: string; kind: string; place_id: number | null; holder: string | null; note: string | null; who: string | null; at: string }
export interface InvPhoto { id: string; item_id: number; created_at: string }
export interface InvSkip { trx_id: string; reason: string | null; who: string | null; at: string }

/** What `inv.get` gives: everything the inventory screens need. */
export interface InvData {
  categories: InvCategory[];
  places: InvPlace[];
  origins: InvOriginRow[];
  items: InvItem[];
  moves: InvMove[];
  sources: InvSource[];
  skips: InvSkip[];
  /** the photos (their bytes come by `inv.photo.get`) */
  photos: InvPhoto[];
  /** the label's beginning (JAR → JAR-0001) */
  prefix: string;
  /** what a QR label holds besides the label: the fields chosen in the settings */
  qr: string[];
}

/** What the main `data` call carries, for the badge, the entry form and the list of purchases still to register. */
export interface InvLite {
  sources: InvSource[];
  /** the purchase entries already listed (an item, or "not an item") */
  done: string[];
}

/** What a QR label may hold (the label itself is always first, so a scan always finds the item) */
/** The numbered labels printed before recording (a walk-through): a series of their own, V for the valuable (JAR-V001), so that a number given by itself never meets a sticker */
export function blankLabelCodes(existing: string[], prefix: string, count: number): string[] {
  const p = (prefix.trim() || 'INV').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${p}-V(\\d+)$`, 'i');
  let max = 0;
  for (const c of existing) { const mm = re.exec(c); if (mm) max = Math.max(max, Number(mm[1])); }
  return Array.from({ length: count }, (_, i) => `${prefix.trim() || 'INV'}-V${String(max + i + 1).padStart(3, '0')}`);
}

export const QR_FIELDS = ['name', 'serial', 'category', 'place', 'date'] as const;
export type QrField = (typeof QR_FIELDS)[number];

/** The text of an item's QR: its label, then the chosen fields, separated by " | " (empty ones are left out). */
export function qrText(i: Pick<InvItem, 'code' | 'name' | 'serial' | 'acquired_on'>, fields: string[], names: { category?: string | null; place?: string | null } = {}): string {
  const v: Record<string, string | null | undefined> = { name: i.name, serial: i.serial, category: names.category, place: names.place, date: i.acquired_on };
  return [i.code, ...QR_FIELDS.filter((f) => fields.includes(f)).map((f) => (v[f] ?? '').toString().trim()).filter(Boolean)].join(' | ');
}
/** The label inside a scanned text (the first part, whatever else the QR holds). */
export const codeFromScan = (text: string) => text.split(/\s*\|\s*|\r?\n/)[0].trim();

/** Things a centre is full of: a tap fills the name when recording on the phone (the keeper edits it if needed) */
export const COMMON_ITEMS: { ar: string; en: string; fr: string }[] = [
  { ar: 'كرسي', en: 'Chair', fr: 'Chaise' }, { ar: 'طاولة', en: 'Table', fr: 'Table' }, { ar: 'مكتب', en: 'Desk', fr: 'Bureau' }, { ar: 'خزانة', en: 'Cupboard', fr: 'Armoire' },
  { ar: 'رفّ', en: 'Shelf', fr: 'Étagère' }, { ar: 'كنبة', en: 'Sofa', fr: 'Canapé' }, { ar: 'سرير', en: 'Bed', fr: 'Lit' }, { ar: 'سبّورة', en: 'Whiteboard', fr: 'Tableau blanc' },
  { ar: 'حاسوب', en: 'Laptop', fr: 'Ordinateur' }, { ar: 'طابعة', en: 'Printer', fr: 'Imprimante' }, { ar: 'جهاز عرض', en: 'Projector', fr: 'Projecteur' }, { ar: 'شاشة', en: 'Screen', fr: 'Écran' },
  { ar: 'مروحة', en: 'Fan', fr: 'Ventilateur' }, { ar: 'مدفأة', en: 'Heater', fr: 'Chauffage' }, { ar: 'براد', en: 'Fridge', fr: 'Réfrigérateur' }, { ar: 'ميكروفون', en: 'Microphone', fr: 'Micro' },
];

export const CONDITIONS: InvCondition[] = ['good', 'repair', 'broken'];
export const ORIGINS: InvOrigin[] = ['bought', 'gift', 'old'];

/** Is this budget line an inventory purchase line (its heading or the line itself is ticked)? */
export function isSourceLine(sources: InvSource[], lists: Pick<Lists, 'lines'>, lineId: number | null, headingId: number | null): boolean {
  const heading = headingId ?? (lineId != null ? lists.lines.find((l) => l.id === lineId)?.heading_id ?? null : null);
  return sources.some((s) => (s.kind === 'line' && s.ref === lineId) || (s.kind === 'heading' && s.ref === heading));
}

/** The expenses on inventory lines not yet listed (neither an item nor "not an item"): what the finance must register. */
export function pendingEntries(rows: Trx[], lists: Pick<Lists, 'lines'>, inv: InvLite | null | undefined): Trx[] {
  if (!inv || !inv.sources.length) return [];
  const done = new Set(inv.done);
  return rows
    .filter((r) => r.type === 'Exp' && !r.private_total && !r.private_book && (r.exp_syp > 0 || r.exp_usd > 0) && !done.has(r.id) && isSourceLine(inv.sources, lists, r.line_id, r.heading_id))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.created_at.localeCompare(a.created_at));
}

/** The value of what is listed (units × one unit), in USD. Items that left do not count. */
export const itemTotal = (i: Pick<InvItem, 'qty' | 'value_usd'>) => (i.value_usd ?? 0) * i.qty;
export const inUse = (i: Pick<InvItem, 'status'>) => i.status === 'in_use';

/** The label of the next item: PREFIX-0001, after the highest number used with this prefix. */
export function nextCodes(existing: string[], prefix: string, count: number): string[] {
  const p = prefix.trim() || 'INV';
  let max = 0;
  const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i');
  for (const c of existing) {
    const mm = re.exec(c);
    if (mm) max = Math.max(max, Number(mm[1]));
  }
  return Array.from({ length: count }, (_, i) => `${p}-${String(max + i + 1).padStart(4, '0')}`);
}

/** The usual prefix of a centre's labels. */
export const prefixFor = (centre: string | null | undefined) => ({ jaramana: 'JAR', aleppo: 'ALE', homs: 'HOM' } as Record<string, string>)[centre ?? ''] ?? 'INV';

// ---------------------------------------------------------------- import (a Snipe-IT export, or any table)

/** One row of an import, already in the app's words. */
export interface InvImportRow {
  code?: string | null;
  name: string;
  category?: string | null;
  place?: string | null;
  qty?: number | null;
  brand?: string | null;
  model?: string | null;
  serial?: string | null;
  condition?: InvCondition;
  status?: InvStatus;
  holder?: string | null;
  origin?: InvOrigin;
  acquired_on?: string | null;
  value_usd?: number | null;
  supplier?: string | null;
  note?: string | null;
}

/** A small CSV reader: quotes, commas / semicolons / tabs, line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
/** header words (Snipe-IT's export, or ours) → the field */
const HEADERS: Record<string, string[]> = {
  code: ['asset tag', 'tag', 'code', 'asset id', 'id', 'label', 'الرمز', 'الرقم'],
  name: ['name', 'asset name', 'item', 'description', 'الاسم', 'الغرض'],
  category: ['category', 'asset category', 'type', 'الصنف', 'الفئة'],
  model: ['model', 'model name', 'model no', 'model number', 'الطراز', 'الموديل'],
  brand: ['manufacturer', 'brand', 'make', 'الماركة', 'الشركة'],
  serial: ['serial', 'serial number', 'serial no', 's n', 'sn', 'الرقم التسلسلي'],
  acquired_on: ['purchase date', 'purchased', 'acquired', 'date', 'acquired on', 'تاريخ الشراء'],
  value_usd: ['purchase cost', 'cost', 'value', 'price', 'value usd', 'unit value', 'القيمة', 'السعر'],
  place: ['location', 'default location', 'place', 'room', 'المكان', 'الغرفة'],
  status: ['status', 'status label', 'الحالة'],
  supplier: ['supplier', 'vendor', 'المورد'],
  note: ['notes', 'note', 'remarks', 'ملاحظات'],
  holder: ['checked out to', 'assigned to', 'holder', 'user', 'المستلم'],
  qty: ['qty', 'quantity', 'العدد', 'الكمية'],
};

/** Turns a table (first row = headers) into import rows; says which headers it did not understand. */
export function tableToImport(table: string[][]): { rows: InvImportRow[]; unknown: string[] } {
  if (table.length < 2) return { rows: [], unknown: [] };
  const head = table[0].map(norm);
  const col: Record<string, number> = {};
  for (const [field, words] of Object.entries(HEADERS)) {
    const i = head.findIndex((h, ix) => words.includes(h) && !Object.values(col).includes(ix));
    if (i >= 0) col[field] = i;
  }
  const unknown = table[0].filter((_, i) => !Object.values(col).includes(i) && table[0][i].trim() !== '');
  const num = (s: string | undefined) => { const n = Number(String(s ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) && String(s ?? '').trim() !== '' ? n : null; };
  const day = (s: string | undefined) => {
    const x = (s ?? '').trim();
    if (!x) return null;
    let mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(x);
    if (mm) return `${mm[1]}-${mm[2]}-${mm[3]}`;
    mm = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(x); // day first, as the centres write
    return mm ? `${mm[3]}-${mm[2].padStart(2, '0')}-${mm[1].padStart(2, '0')}` : null;
  };
  const rows: InvImportRow[] = [];
  for (const line of table.slice(1)) {
    const g = (f: string) => (col[f] != null ? (line[col[f]] ?? '').trim() : '');
    const name = g('name') || [g('brand'), g('model')].filter(Boolean).join(' ');
    if (!name) continue;
    const st = norm(g('status'));
    rows.push({
      code: g('code') || null, name, category: g('category') || null, place: g('place') || null,
      qty: Math.max(1, Math.round(num(g('qty')) ?? 1)), brand: g('brand') || null, model: g('model') || null, serial: g('serial') || null,
      condition: /broken|not fixable|مكسور|معطل/.test(st) ? 'broken' : /repair|صيانة|تصليح/.test(st) ? 'repair' : 'good',
      status: /lost|stolen|مفقود/.test(st) ? 'lost' : /archiv|dispos|retired|مستبعد/.test(st) ? 'disposed' : 'in_use',
      holder: g('holder') || null, origin: 'old', acquired_on: day(g('acquired_on')), value_usd: num(g('value_usd')),
      supplier: g('supplier') || null, note: g('note') || null,
    });
  }
  return { rows, unknown };
}
