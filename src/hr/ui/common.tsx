// What the HR screens share: the centre of a person (its colour and mark, the MAGIS design), the heading of the
// documents (the centre mark and the Jesuit logo), and opening or attaching a scan.
import type { CSSProperties } from 'react';
import type { Session } from '../../state';
import { centreStyle, guessCentre, type CentreKey } from '../../brand';
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
