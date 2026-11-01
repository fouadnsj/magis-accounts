// What the HR screens share: the centre of a person (its colour and mark, the MAGIS design), the heading of the
// documents (the centre mark and the Jesuit logo), and opening or attaching a scan.
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Session } from '../../state';
import { has, type Profile } from '../../auth';
import type { Perm } from '../../perms';
import { CENTRES, centreStyle, guessCentre, type CentreKey } from '../../brand';
import { errText, toast } from '../../ui/kit';
import { pickFile, toBase64 } from '../../platform';
import { t3 } from '../../community/ui/text';
import type { HrData, HrListItem, HrPerson } from '../hr';
import type { DocHead } from '../docs';

export const fail = (e: unknown) => toast(errText(e), true);
export const usd = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

/** The list item of a person's centre, and its key (jaramana | aleppo | homs | other) for the colour and the mark. */
export function centreOf(d: HrData, p: Pick<HrPerson, 'centre'> | null | undefined): { item: HrListItem | null; key: CentreKey } {
  const item = p?.centre ? d.lists.find((x) => x.kind === 'centre' && x.name === p.centre) ?? null : null;
  const key = (item?.code && ['jaramana', 'aleppo', 'homs', 'other'].includes(item.code) ? item.code : p?.centre ? guessCentre(p.centre) : 'other') as CentreKey;
  return { item, key };
}

/** The centre's colours as CSS variables (a card, a page heading). */
export function centreVars(key: CentreKey): CSSProperties {
  const st = centreStyle(key);
  return { '--centre': st.color, '--centre-deep': st.deep } as CSSProperties;
}

export const markOf = (key: CentreKey) => centreStyle(key).mark ?? '/brand/magis-sun.png';

const bytesCache = new Map<string, Promise<Uint8Array | null>>();
const fetchBytes = (url: string) => {
  if (!bytesCache.has(url)) bytesCache.set(url, fetch(url).then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null));
  return bytesCache.get(url)!;
};

/** The heading of a person's documents: their centre (first party, who signs) with its mark, and the Jesuit logo. */
export async function headOf(d: HrData, p: HrPerson | undefined): Promise<DocHead> {
  const { item, key } = centreOf(d, p);
  const mark = centreStyle(key).mark;
  return { centre: item, mark: mark ? await fetchBytes(mark) : await fetchBytes('/brand/magis-sun.png'), jesuit: await fetchBytes('/brand/jesuits.png') };
}

/** Opens a scan in a new tab (every opening is written in the log on the server). */
export async function openScan(s: Session, kind: 'paper' | 'conduct' | 'sign' | 'doc', id: number) {
  try {
    const f = await s.api.call('hr.file.get', { kind, id });
    const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    window.open(URL.createObjectURL(new Blob([bytes], { type: f.mime })), '_blank');
  } catch (e) { fail(e); }
}

const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
/** Chooses a PDF or a picture; returns what the server needs. */
export async function chooseScan(title: string) {
  const f = await pickFile(['pdf', 'png', 'jpg', 'jpeg'], title);
  if (!f) return null;
  const mime = MIME[f.name.split('.').pop()?.toLowerCase() ?? ''];
  if (!mime) { toast(t3('PDF أو صورة فقط', 'PDF or picture only', 'PDF ou image seulement'), true); return null; }
  return { base64: toBase64(f.bytes), mime, name: f.name };
}

/** A person's two names: Arabic first, then English (when they differ). */
export function TwoNames({ p, big }: { p: HrPerson; big?: boolean }) {
  const en = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return (
    <span className={`hr-names ${big ? 'big' : ''}`}>
      <b dir="rtl">{p.name_ar || p.name}</b>
      {en && en !== p.name_ar ? <i dir="ltr">{en}</i> : null}
    </span>
  );
}

// ---------------------------------------------------------------- centres (Fouad, 31 October 2026: everything is by centre)

export const CENTRE_KEYS: CentreKey[] = ['jaramana', 'aleppo', 'homs'];

/** the centre code of a person, from the lists (null: no centre) */
export const codeOf = (d: HrData, p: Pick<HrPerson, 'centre'> | null | undefined): string | null => (p?.centre ? d.lists.find((x) => x.kind === 'centre' && x.name === p.centre)?.code ?? null : null);

/** the centres this user sees, as list items (their codes are in the user's scope) */
export const seenCentres = (d: HrData) => d.lists.filter((x) => x.kind === 'centre' && (!d.scope || (x.code && d.scope.includes(x.code))));

/** a centre's name for a code: Jaramana, Aleppo, Homs (one centre may have several databases, old and new); else the name kept in the lists */
export function centreLabel(d: HrData, code: string | null | undefined): string {
  if (!code) return t3('كل المراكز', 'Every centre', 'Tous les centres');
  if (code === 'jaramana' || code === 'aleppo' || code === 'homs') { const n = CENTRES[code].name; return t3(n.ar, n.en, n.en); }
  return d.lists.find((x) => x.kind === 'centre' && x.code === code)?.name ?? code;
}

/** the list name of a centre to give a new person: of the centre's databases, the one most of its people have */
export function mainCentreName(d: HrData, code: string): string | null {
  const items = d.lists.filter((x) => x.kind === 'centre' && x.code === code);
  const n = (name: string) => d.people.filter((p) => p.centre === name).length;
  return items.sort((a, b) => n(b.name) - n(a.name))[0]?.name ?? null;
}

/** the centres this user sees, one per centre (not one per database), in the order Jaramana, Aleppo, Homs, other */
export function centreChoices(d: HrData): { code: string; name: string }[] {
  const codes = [...new Set(seenCentres(d).map((x) => x.code).filter((x): x is string => !!x))];
  const order = ['jaramana', 'aleppo', 'homs', 'other'];
  return codes.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((code) => ({ code, name: centreLabel(d, code) }));
}

/** the positions a person of a centre can have: those of their centre, and those shared by every centre */
export const positionsFor = (d: HrData, centreName: string | null | undefined) => {
  const code = centreName ? d.lists.find((x) => x.kind === 'centre' && x.name === centreName)?.code ?? null : null;
  return [...new Set(d.grades.filter((g) => g.centre == null || g.centre === code).map((g) => g.name))];
};

// ---------------------------------------------------------------- sorting a table by clicking its column headings

export type SortDir = 1 | -1;
/** sort state: the key of the column and the direction; click again to turn it */
export function useSort<K extends string>(first: K, dir: SortDir = 1) {
  const [s, setS] = useState<{ key: K; dir: SortDir }>({ key: first, dir });
  const by = (key: K) => setS((x) => (x.key === key ? { key, dir: (x.dir * -1) as SortDir } : { key, dir: 1 }));
  return { key: s.key, dir: s.dir, by };
}
/** sorts rows by the value a column gives (numbers as numbers, texts in the reader's language order; empty last) */
export function sortRows<T>(rows: T[], val: (r: T) => string | number | null | undefined, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null || x === '') return y == null || y === '' ? 0 : 1;
    if (y == null || y === '') return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
  });
}
/** a column heading that sorts */
export function SortTh<K extends string>({ k, sort, children, n }: { k: K; sort: { key: K; dir: SortDir; by: (k: K) => void }; children: ReactNode; n?: boolean }) {
  const on = sort.key === k;
  return <th className={`hr-sort ${n ? 'n' : ''} ${on ? 'on' : ''}`} onClick={() => sort.by(k)} title={t3('اضغط للترتيب', 'Click to sort', 'Cliquez pour trier')}>{children}<span className="arrow">{on ? (sort.dir === 1 ? ' ▲' : ' ▼') : ' ↕'}</span></th>;
}

/** What the user may see and do in HR (Fouad, 1 November 2026: the rights in detail; the server checks each again). */
export interface HrRights { details: boolean; manage: boolean; vault: boolean; salary: boolean; papers: boolean; scale: boolean; sessions: boolean; pay: boolean; approve: boolean; paid: boolean; runs: boolean; users: boolean; backups: boolean }
export function rightsOf(p: Pick<Profile, 'perms'>): HrRights {
  const h = (k: Perm) => has(p, k);
  return {
    details: h('hr.details'), manage: h('hr.manage'), vault: h('hr.vault'), salary: h('hr.salary'), papers: h('hr.agreements'), scale: h('hr.scale'),
    sessions: h('hr.sessions'), pay: h('hr.pay'), approve: h('hr.approve'), paid: h('hr.paid'), runs: h('hr.pay') || h('hr.approve') || h('hr.paid'),
    users: h('users.manage'), backups: h('data.backup') || h('data.restore'),
  };
}
