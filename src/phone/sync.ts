// Speaking with the server (Fouad, 2026-11-13). The phone sends what is waiting, then the photos of the rows the server
// took, and keeps the fresh pack (books, balance, lists) that comes back. With no connection nothing is lost: the rows
// stay "waiting" and go the next time.
import { allPhotos, allRows, kvSet, putPhoto, putRow, type Entry, type Msg, type Pack } from './store';
import { invCounts, invPhotos } from './Count';
import { invNews, putInvNews } from './Record';
import { problemNews, putProblemNews } from './Problem';
import { hostNews, putHostNews } from './Calendar';

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

export interface SyncResult { sent: number; refused: number; photos: number; /** the bookings just made on the server, to be looked at */ hostIds: number[] }

/** One sync: rows waiting → the server; photos of the rows it has → the server; the fresh pack is kept. */
export async function sync(key: string): Promise<{ pack: Pack; result: SyncResult }> {
  const rows = await allRows();
  const waiting = rows.filter((r) => r.state === 'waiting').sort((a, b) => a.made_at.localeCompare(b.made_at));
  const res: SyncResult = { sent: 0, refused: 0, photos: 0, hostIds: [] };
  let pack: Pack;
  if (waiting.length) {
    const body = { rows: waiting.map((r) => ({ id: r.id, book_id: r.book_id, date: r.date, type: r.type, heading_id: r.heading_id, line_id: r.line_id, explanation: r.explanation, receipt: r.receipt || null, amount: r.amount, currency: r.currency, syp: r.syp, cur2: r.cur2, amount2: r.amount2, for_house: r.for_house ? 1 : 0, to_book_id: r.to_book_id ?? null })) };
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
  // the inventory: the counts and the photos of items made on the phone
  let invSent = 0;
  const counts = await invCounts();
  for (const c of counts) {
    if (c.sent) continue;
    try { await call('/api/phone/inv-count', { key: c.key, ids: c.ids, placeId: c.placeId, date: c.date }, key); c.sent = true; invSent++; }
    catch (e) { if (e instanceof Refused) { c.sent = true; continue; } throw e; }
  }
  if (invSent) await kvSet('inv-counts', counts.filter((c) => !c.sent || Date.now() - Date.parse(c.date) < 7 * 86400e3));
  const pics = await invPhotos();
  for (const p of pics) {
    if (p.sent) continue;
    try { await call('/api/phone/inv-photo', { key: p.key, itemId: p.itemId, mime: p.mime, base64: p.base64 }, key); p.sent = true; p.base64 = ''; invSent++; }
    catch (e) { if (e instanceof Refused) { p.sent = true; p.base64 = ''; continue; } throw e; }
  }
  if (pics.some((p) => p.sent)) await kvSet('inv-photos', pics.filter((p) => !p.sent));
  // the items recorded on the phone, one by one: each is made on the server, which gives it its number
  const news = await invNews();
  let newSent = 0;
  for (const x of news) {
    if (x.state !== 'waiting') continue;
    try {
      const r = await call<{ code?: string }>('/api/phone/inv-new', { key: x.key, item: x.item, photo: x.photo }, key);
      x.state = 'sent'; x.code = r.code ?? null; x.photo = null; x.error = null; newSent++;
    } catch (e) { if (e instanceof Refused) { x.state = 'fix'; x.error = e.msg; continue; } await putInvNews(news); throw e; }
  }
  if (news.length) await putInvNews(news.filter((x) => x.state !== 'sent' || Date.now() - Date.parse(x.made_at) < 24 * 3600e3));
  invSent += newSent;
  // the problems reported on the phone, one by one (the server says which it already had)
  const reports = await problemNews();
  let reportSent = 0;
  for (const x of reports) {
    if (x.state !== 'waiting') continue;
    try { await call('/api/phone/inv-problem', { key: x.key, what: x.what, where: x.where, photo: x.photo }, key); x.state = 'sent'; x.photo = null; x.error = null; reportSent++; }
    catch (e) { if (e instanceof Refused) { x.state = 'fix'; x.error = e.msg; continue; } await putProblemNews(reports); throw e; }
  }
  if (reports.length) await putProblemNews(reports.filter((x) => x.state !== 'sent'));
  invSent += reportSent;
  // the bookings made on the phone: each is made on the server as "to confirm"; the server says which it already had
  const hosts = await hostNews();
  let hostChanged = false;
  for (const x of hosts) {
    if (x.state !== 'waiting') continue;
    try {
      const r = await call<{ id: number }>('/api/phone/host-book', { key: x.key, booking: x.booking }, key);
      x.state = 'sent'; x.id = r.id; x.error = null; res.hostIds.push(r.id); hostChanged = true;
    } catch (e) { if (e instanceof Refused) { x.state = 'fix'; x.error = e.msg; hostChanged = true; continue; } throw e; }
  }
  if (hostChanged) {
    await putHostNews(hosts.filter((x) => x.state !== 'sent' || Date.now() - Date.parse(x.made_at) < 24 * 3600e3));
    pack = await call<Pack>('/api/phone/pack', {}, key); await kvSet('pack', pack);
  }
  // the pack again, so that the counts just sent show on the phone
  if (invSent && (pack.inv || pack.problem)) { pack = await call<Pack>('/api/phone/pack', {}, key); await kvSet('pack', pack); }
  return { pack, result: res };
}

/** confirm a booking the phone made (the phone is connected: the server checks the rooms again) */
export const hostConfirm = (key: string, id: number) => call('/api/phone/host-status', { id, status: 'confirmed' }, key);
/** change the dates or the rooms of a booking (connected) */
export const hostChange = (key: string, id: number, booking: unknown) => call('/api/phone/host-book', { key: `chg-${id}-${Date.now()}`, id, booking }, key);

/** what a book holds as the phone knows it: the server's figure at the last sync, and the rows still waiting here */
export function balance(pack: Pack, rows: Entry[], bookId: number) {
  const b = pack.books.find((x) => x.id === bookId);
  // every currency of the book (a community has three); a centre: dollars and pounds
  const m: Record<string, number> = { ...(b?.bal ?? { USD: b?.usd ?? 0, SYP: b?.syp ?? 0 }) };
  const add = (c: string, v: number) => { m[c] = (m[c] ?? 0) + v; };
  let n = 0;
  for (const r of rows) {
    if (r.state !== 'waiting') continue;
    // money given to this book from another book of the phone (the house to an envelope…)
    if (r.type === 'Transfer' && r.to_book_id === bookId && r.book_id !== bookId) { add(r.currency, r.amount); n++; continue; }
    if (r.book_id !== bookId) continue;
    if (r.type === 'Transfer') add(r.currency, -r.amount);
    else if (r.type === 'Exchange') { add(r.currency, -r.amount); add(r.cur2 ?? 'SYP', r.amount2 ?? r.syp ?? 0); }
    else add(r.currency, (r.type === 'Income' ? 1 : -1) * r.amount);
    n++;
  }
  for (const k of Object.keys(m)) m[k] = Math.round(m[k] * 100) / 100;
  return { bal: m, usd: m.USD ?? 0, syp: m.SYP ?? m.LOC ?? 0, waiting: n };
}

/** what the phone can already say about a row before the server sees it (the server checks everything again) */
export function check(pack: Pack, r: Pick<Entry, 'book_id' | 'date' | 'type' | 'heading_id' | 'line_id' | 'explanation' | 'amount' | 'syp' | 'currency' | 'cur2' | 'amount2'> & { to_book_id?: number | null }): Msg[] {
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
  if (r.type === 'Transfer') {
    if (!r.to_book_id) out.push({ ar: 'لمن؟', en: 'To whom?', fr: 'À qui ?' });
    else if (r.to_book_id === r.book_id) out.push({ ar: 'لا تحويل إلى الدفتر نفسه', en: 'A book cannot give to itself', fr: 'Un compte ne peut pas se donner à lui-même' });
    return out;
  }
  if (!r.heading_id) out.push({ ar: 'اختر البند', en: 'Choose the heading', fr: 'Choisissez la rubrique' });
  if (!r.line_id) out.push({ ar: 'اختر الخط', en: 'Choose the line', fr: 'Choisissez la ligne' });
  if (r.type !== 'Exchange' && !cty && !r.explanation.trim()) out.push(r.type === 'Exp' ? { ar: 'اكتب الشرح: على ماذا صُرف المال؟', en: 'Write the explanation: what was the money spent on?', fr: "Écrivez l'explication : à quoi a servi l'argent ?" } : { ar: 'اكتب الشرح: من أين جاء المال؟', en: 'Write the explanation: where does the money come from?', fr: "Écrivez l'explication : d'où vient l'argent ?" });
  return out;
}
