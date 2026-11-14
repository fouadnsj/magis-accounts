// Speaking with the server (Fouad, 2026-11-13). The phone sends what is waiting, then the photos of the rows the server
// took, and keeps the fresh pack (books, balance, lists) that comes back. With no connection nothing is lost: the rows
// stay "waiting" and go the next time.
import { allPhotos, allRows, kvSet, putPhoto, putRow, type Entry, type Msg, type Pack } from './store';

export class Unlinked extends Error { constructor(public msg: Msg) { super(msg.en); } }
export class Offline extends Error {}
export class Refused extends Error { constructor(public msg: Msg) { super(msg.en); } }

async function call<T>(url: string, body: unknown, key?: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Offline(); }
  const json = (await r.json().catch(() => null)) as { error?: Msg } | null;
  if (r.ok) return json as T;
  const msg = json?.error ?? { ar: 'خطأ في الخادم', en: 'Server error', fr: 'Erreur du serveur' };
  if (key && r.status === 401) throw new Unlinked(msg);
  // (a page that is not the server answering: the phone is on another network)
  if (!json) throw new Offline();
  throw new Refused(msg);
}

export const api = {
  hello: () => call<{ dbs: { slug: string; organisation: string; kind: string; centre: string }[]; dir: { on: boolean; person: { name: string } | null } }>('/api/hello', undefined),
  signin: (centre: string, name: string, password: string) => call<{ dir?: true; places?: string[]; db?: string; mustChange?: boolean }>('/api/signin', { centre, name, password }),
  enterRing: (db: string) => call<{ mustChange: boolean }>('/api/signin/enter', { db }),
  enterDir: (db: string) => call<{ mustChange: boolean }>('/api/dir/enter', { db }),
  pair: (name: string) => call<{ key: string; validUntil: string; pack: Pack }>('/api/phone/pair', { name }),
  logout: async () => { await call('/api/logout', {}).catch(() => undefined); await call('/api/dir/logout', {}).catch(() => undefined); },
};

/** the full program, as in a browser, opened with this phone's key (only while the server answers) */
export async function openFull(key: string) {
  await call('/api/phone/session', {}, key);
  location.href = '/';
}

export interface SyncResult { sent: number; refused: number; photos: number }

/** One sync: rows waiting → the server; photos of the rows it has → the server; the fresh pack is kept. */
export async function sync(key: string): Promise<{ pack: Pack; result: SyncResult }> {
  const rows = await allRows();
  const waiting = rows.filter((r) => r.state === 'waiting').sort((a, b) => a.made_at.localeCompare(b.made_at));
  const res = { sent: 0, refused: 0, photos: 0 };
  let pack: Pack;
  if (waiting.length) {
    const body = { rows: waiting.map((r) => ({ id: r.id, book_id: r.book_id, date: r.date, type: r.type, heading_id: r.heading_id, line_id: r.line_id, explanation: r.explanation, receipt: r.receipt || null, amount: r.amount, currency: r.currency, syp: r.syp, cur2: r.cur2, amount2: r.amount2, for_house: r.for_house ? 1 : 0 })) };
    const out = await call<{ results: { id: string; ok: boolean; error?: Msg }[]; pack: Pack }>('/api/phone/push', body, key);
    for (const x of out.results) {
      const r = waiting.find((w) => w.id === x.id);
      if (!r) continue;
      const next: Entry = x.ok ? { ...r, state: 'sent', error: null, sent_at: new Date().toISOString() } : { ...r, state: 'fix', error: x.error ?? null };
      await putRow(next);
      if (x.ok) res.sent++; else res.refused++;
    }
    pack = out.pack;
  } else {
    pack = await call<Pack>('/api/phone/pack', {}, key);
  }
  await kvSet('pack', pack);
  // the photos of the rows the server has
  const sentIds = new Set((await allRows()).filter((r) => r.state === 'sent').map((r) => r.id));
  for (const p of await allPhotos()) {
    if (p.sent || !sentIds.has(p.trxId)) continue;
    try {
      await call('/api/phone/photo', { trxId: p.trxId, key: p.key, base64: p.base64, mime: p.mime }, key);
      // sent: the picture itself is no longer needed on the phone
      await putPhoto({ ...p, sent: true, base64: '' });
      res.photos++;
    } catch (e) {
      if (e instanceof Refused) { await putPhoto({ ...p, sent: true, base64: '' }); continue; } // the row is gone on the server: nothing to attach to
      throw e;
    }
  }
  return { pack, result: res };
}

/** what a book holds as the phone knows it: the server's figure at the last sync, and the rows still waiting here */
export function balance(pack: Pack, rows: Entry[], bookId: number) {
  const b = pack.books.find((x) => x.id === bookId);
  // every currency of the book (a community has three); a centre: dollars and pounds
  const m: Record<string, number> = { ...(b?.bal ?? { USD: b?.usd ?? 0, SYP: b?.syp ?? 0 }) };
  const add = (c: string, v: number) => { m[c] = (m[c] ?? 0) + v; };
  let n = 0;
  for (const r of rows) {
    if (r.book_id !== bookId || r.state !== 'waiting') continue;
    if (r.type === 'Exchange') { add(r.currency, -r.amount); add(r.cur2 ?? 'SYP', r.amount2 ?? r.syp ?? 0); }
    else add(r.currency, (r.type === 'Income' ? 1 : -1) * r.amount);
    n++;
  }
  for (const k of Object.keys(m)) m[k] = Math.round(m[k] * 100) / 100;
  return { bal: m, usd: m.USD ?? 0, syp: m.SYP ?? m.LOC ?? 0, waiting: n };
}

/** what the phone can already say about a row before the server sees it (the server checks everything again) */
export function check(pack: Pack, r: Pick<Entry, 'book_id' | 'date' | 'type' | 'heading_id' | 'line_id' | 'explanation' | 'amount' | 'syp' | 'currency' | 'cur2' | 'amount2'>): Msg[] {
  const cty = pack.kind === 'community';
  const out: Msg[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) out.push({ ar: 'التاريخ مطلوب', en: 'The date is needed', fr: 'La date est nécessaire' });
  else {
    const ym = r.date.slice(0, 7);
    if (pack.closed.includes(ym) || pack.bookClosed.some((x) => x.book_id === r.book_id && x.ym === ym)) out.push({ ar: `الشهر ${ym} مغلق`, en: `The month ${ym} is closed`, fr: `Le mois ${ym} est clôturé` });
    if (pack.fiscalStart && r.date < pack.fiscalStart) out.push({ ar: 'التاريخ قبل بداية السنة المالية', en: 'The date is before the start of the financial year', fr: "La date est avant le début de l'exercice" });
  }
  if (r.type === 'Exchange' && cty) {
    if (!(r.amount > 0)) out.push({ ar: 'أدخل ما أعطيت', en: 'Enter what you gave', fr: 'Saisissez ce que vous avez donné' });
    if (!((r.amount2 ?? 0) > 0)) out.push({ ar: 'أدخل ما استلمت', en: 'Enter what you received', fr: 'Saisissez ce que vous avez reçu' });
    if (r.cur2 === r.currency) out.push({ ar: 'عملتان مختلفتان', en: 'Two different currencies', fr: 'Deux monnaies différentes' });
  } else if (r.type === 'Exchange') {
    if (!(r.amount > 0)) out.push({ ar: 'أدخل الدولارات المدفوعة', en: 'Enter the dollars given', fr: 'Saisissez les dollars donnés' });
    if (!((r.syp ?? 0) > 0)) out.push({ ar: 'أدخل الليرات المقبوضة', en: 'Enter the pounds received', fr: 'Saisissez les livres reçues' });
  } else if (!(r.amount > 0)) out.push({ ar: 'أدخل مبلغاً', en: 'Enter an amount', fr: 'Saisissez un montant' });
  if (cty && r.type === 'Exchange') return out; // a community's exchange has no heading
  if (!r.heading_id) out.push({ ar: 'اختر البند', en: 'Choose the heading', fr: 'Choisissez la rubrique' });
  if (!r.line_id) out.push({ ar: 'اختر الخط', en: 'Choose the line', fr: 'Choisissez la ligne' });
  if (r.type !== 'Exchange' && !cty && !r.explanation.trim()) out.push(r.type === 'Exp' ? { ar: 'اكتب الشرح: على ماذا صُرف المال؟', en: 'Write the explanation: what was the money spent on?', fr: "Écrivez l'explication : à quoi a servi l'argent ?" } : { ar: 'اكتب الشرح: من أين جاء المال؟', en: 'Write the explanation: where does the money come from?', fr: "Écrivez l'explication : d'où vient l'argent ?" });
  return out;
}
