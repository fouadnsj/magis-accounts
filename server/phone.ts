// The phone (Fouad, 2026-11-13): a person away from the centre records expenses and income on a phone, offline; back on
// the centre's network the phone sends them. The server stays the only record: every row passes the same checks as on
// the computer (runOp 'trx.save'), with the rights of the person the phone belongs to. Nothing else comes from a phone:
// no transfer, no exchange, no change of a row already here.
//
// A phone is paired once, by its owner signed in on it. It then holds a long random key (never the password); the
// server keeps only the key's hash. A phone that has not come back for PHONE_DAYS days must be paired again, and
// whoever manages the users can cut a phone off at once.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Db, one } from '../src/db/db';
import { auditStmt, blankTrx, closedMonths, getMeta, loadLists, loadTrx, UserError } from '../src/db/repo';
import { has, type Profile } from '../src/auth';
import { runOp, type OpCtx } from '../src/ops';
import { holders } from '../src/domain/reports';
import { rateOn } from '../src/domain/compute';
import { m, type Msg } from '../src/i18n';
import type { Trx } from '../src/domain/types';

export const PHONE_DAYS = 30;
const DAY = 86_400_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

export interface PhoneRow { id: string; profile_id: number; name: string; key_hash: string; created_at: string; last_sync: string | null; revoked_at: string | null; revoked_by: string | null }

/** until when this phone may still send without coming back (30 days after its last sync) */
export const validUntil = (p: Pick<PhoneRow, 'created_at' | 'last_sync'>) => new Date(Date.parse(p.last_sync ?? p.created_at) + PHONE_DAYS * DAY).toISOString();

/** may this person record from a phone at all? (somebody who writes in a book) */
export const mayPhone = (p: Profile) => has(p, 'register.edit') || has(p, 'register.main') || (has(p, 'book.own') && p.books.length > 0);

/** Pairs a phone for the person signed in on it. The key is given once, here. */
export async function pairPhone(db: Db, profile: Profile, name: string): Promise<{ id: string; key: string }> {
  if (!mayPhone(profile)) throw new UserError(m('الهاتف لمن يسجّل في دفتر', 'The phone is for someone who writes in a book', "Le téléphone est pour quelqu'un qui écrit dans un livre"));
  const label = name.trim().slice(0, 60) || 'Phone';
  const id = randomBytes(9).toString('base64url');
  const key = randomBytes(32).toString('base64url');
  await db.batch([
    { sql: 'INSERT INTO phone (id, profile_id, name, key_hash, created_at) VALUES (?,?,?,?,?)', params: [id, profile.id, label, sha(key), now()] },
    auditStmt(profile.name, 'phone-pair', 'phone', id, null, { name: label }),
  ]);
  return { id, key };
}

/** The phone behind this key; throws what the phone must show (cut off, too old). */
export async function phoneOf(db: Db, id: string, key: string): Promise<PhoneRow> {
  const out = () => new UserError(m('هذا الهاتف غير مربوط: سجّل الدخول من جديد في المركز', 'This phone is not linked: sign in again at the centre', "Ce téléphone n'est pas relié : reconnectez-vous au centre"));
  const p = await one<PhoneRow>(db, 'SELECT * FROM phone WHERE id = ?', [id]);
  if (!p) throw out();
  const a = Buffer.from(p.key_hash, 'hex'), b = Buffer.from(sha(key), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw out();
  if (p.revoked_at) throw new UserError(m('أُوقف هذا الهاتف: راجع المكتب', 'This phone was cut off: see the office', 'Ce téléphone a été coupé : voyez le bureau'));
  if (Date.now() > Date.parse(validUntil(p)))
    throw new UserError(m(`مرّ أكثر من ${PHONE_DAYS} يوماً منذ آخر مزامنة: سجّل الدخول من جديد في المركز`, `More than ${PHONE_DAYS} days since the last sync: sign in again at the centre`, `Plus de ${PHONE_DAYS} jours depuis la dernière synchronisation : reconnectez-vous au centre`));
  return p;
}

export interface PhonePack {
  phone: { id: string; name: string };
  user: string;
  organisation: string;
  centre: string;
  color: string | null;
  asOf: string;
  validUntil: string;
  /** the books this person writes in, with what each should hold now */
  /** rate: the book's latest exchange rate (SYP for one USD), to warn about a mistyped exchange */
  books: { id: number; name: string; main: boolean; usd: number; syp: number; rate: number }[];
  headings: { id: number; name: string; code: string; types: PhoneType[] }[];
  lines: { id: number; heading_id: number; name: string; code: string }[];
  parties: { id: number; name: string }[];
  /** months closed for everybody, and months this person's books are closed for */
  closed: string[];
  bookClosed: { book_id: number; ym: string }[];
  fiscalStart: string | null;
  rate: number;
  /** how far an exchange's rate may be from the last one before the phone warns (0.25 = 25 %) */
  tolerance: number;
}

/** what a phone records: expenses, income and (Fouad, 2026-11-13) exchanges; transfers stay on the computer */
export type PhoneType = 'Exp' | 'Income' | 'Exchange';
const PHONE_TYPES: readonly string[] = ['Exp', 'Income', 'Exchange'];

/** the books a person writes in from a phone: the ones kept, Main with its right; every book for who writes everywhere */
function phoneBooks(profile: Profile, books: Awaited<ReturnType<typeof loadLists>>['books']) {
  const all = has(profile, 'register.edit');
  return books.filter((b) => b.active && (profile.books.includes(b.id) || (!!b.is_main && has(profile, 'register.main')) || (all && !b.private)));
}

/** What the phone keeps to work offline: the person's books and their balance, the headings and lines, the closed months. */
export async function phonePack(db: Db, profile: Profile, phone: PhoneRow): Promise<PhonePack> {
  const [lists, rows, closed] = await Promise.all([loadLists(db), loadTrx(db), closedMonths(db)]);
  const mine = phoneBooks(profile, lists.books);
  const usd = holders(rows, lists.books, 'USD'), syp = holders(rows, lists.books, 'SYP');
  const types = (id: number) => lists.headingTypes.filter((t) => t.heading_id === id && PHONE_TYPES.includes(t.type)).map((t) => t.type as PhoneType);
  const headings = lists.headings.filter((h) => h.active && types(h.id).length).map((h) => ({ id: h.id, name: h.name, code: h.code, types: types(h.id) }));
  const bm = await db.query<{ book_id: number; ym: string }>('SELECT book_id, ym FROM book_month');
  const parentOf = new Map(lists.books.map((b) => [b.id, b.parent_id ?? null]));
  const stamp = now();
  await db.batch([{ sql: 'UPDATE phone SET last_sync = ? WHERE id = ?', params: [stamp, phone.id] }]);
  return {
    phone: { id: phone.id, name: phone.name },
    user: profile.name,
    organisation: (await getMeta(db, 'organisation')) ?? '',
    centre: (await getMeta(db, 'centre')) ?? 'other',
    color: await getMeta(db, 'brand_color'),
    asOf: stamp,
    validUntil: validUntil({ created_at: phone.created_at, last_sync: stamp }),
    books: mine.map((b) => ({
      id: b.id, name: b.name, main: !!b.is_main,
      usd: Math.round((usd.find((x) => x.book?.id === b.id)?.shouldHold ?? 0) * 100) / 100,
      syp: Math.round(syp.find((x) => x.book?.id === b.id)?.shouldHold ?? 0),
      rate: Math.round(rateOn(rows, b.id, stamp.slice(0, 10), lists.settings.usd_rate) * 100) / 100,
    })),
    headings,
    lines: lists.lines.filter((l) => l.active && headings.some((h) => h.id === l.heading_id)).map((l) => ({ id: l.id, heading_id: l.heading_id, name: l.name, code: l.code })),
    parties: lists.parties.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name })),
    closed: [...closed].sort(),
    // (an envelope is closed with its book)
    bookClosed: mine.flatMap((b) => bm.filter((x) => x.book_id === b.id || x.book_id === parentOf.get(b.id)).map((x) => ({ book_id: b.id, ym: x.ym }))),
    fiscalStart: lists.settings.fiscal_start,
    rate: lists.settings.usd_rate,
    tolerance: lists.settings.exchange_tolerance,
  };
}

/** one row as the phone sends it: an expense or an income, one amount in one currency; or an exchange, dollars given (amount) for pounds received (syp) */
export interface PhoneEntry {
  id: string;
  book_id: number;
  date: string;
  type: PhoneType;
  heading_id: number;
  line_id: number;
  explanation: string | null;
  receipt?: string | null;
  party_id?: number | null;
  amount: number;
  currency: 'USD' | 'SYP';
  /** an exchange: the pounds received */
  syp?: number;
}
export interface PhoneResult { id: string; ok: boolean; already?: boolean; error?: Msg }

const ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Takes the rows a phone sends, one by one: each passes the usual checks or comes back with its reason. A row already
 * here (the phone sent it, then lost the connection before hearing so) is not written twice.
 */
export async function phonePush(ctx: OpCtx, phone: PhoneRow, entries: PhoneEntry[]): Promise<PhoneResult[]> {
  const out: PhoneResult[] = [];
  const lists = await loadLists(ctx.db);
  for (const e of entries.slice(0, 200)) {
    const id = String(e?.id ?? '');
    try {
      if (!ID.test(id)) throw new UserError(m('سطر بلا رقم', 'A row without its number', 'Une ligne sans son numéro'));
      if (await one(ctx.db, 'SELECT 1 AS x FROM trx WHERE id = ?', [id])) { out.push({ id, ok: true, already: true }); continue; }
      if (!PHONE_TYPES.includes(e.type)) throw new UserError(m('من الهاتف: نفقة أو إيراد أو تصريف فقط', 'From a phone: an expense, an income or an exchange only', "Depuis un téléphone : une dépense, une recette ou un change seulement"));
      if (e.type !== 'Exchange' && e.currency !== 'USD' && e.currency !== 'SYP') throw new UserError(m('العملة: دولار أو ليرة', 'The currency: USD or SYP', 'La devise : USD ou SYP'));
      const amount = Number(e.amount);
      if (!(amount > 0) || !Number.isFinite(amount)) throw new UserError(m('أدخل مبلغاً', 'Enter an amount', 'Saisissez un montant'));
      const book = lists.books.find((b) => b.id === Number(e.book_id));
      // an exchange: the dollars given and the pounds received, as on the computer (both positive)
      const syp = Number(e.syp);
      if (e.type === 'Exchange' && (!(syp > 0) || !Number.isFinite(syp))) throw new UserError(m('أدخل الليرات المقبوضة', 'Enter the pounds received', 'Saisissez les livres reçues'));
      const amounts: Partial<Trx> = e.type === 'Exchange' ? { trf_usd: amount, trf_syp: syp }
        : { [`${e.type === 'Exp' ? 'exp' : 'inc'}_${e.currency === 'USD' ? 'usd' : 'syp'}`]: amount };
      const row: Trx = {
        ...blankTrx(), id, book_id: book?.id ?? null, city_id: book?.city_id ?? lists.settings.def_city_id ?? lists.cities.find((x) => x.active)?.id ?? null,
        date: String(e.date ?? ''), type: e.type, heading_id: Number(e.heading_id) || null, line_id: Number(e.line_id) || null,
        explanation: (e.explanation ?? '').toString().trim().slice(0, 500) || null, receipt: (e.receipt ?? '').toString().trim().slice(0, 60) || null,
        party_id: e.party_id != null ? Number(e.party_id) || null : null, ...amounts, created_by: ctx.who,
      };
      await runOp(ctx, 'trx.save', { rows: [row] });
      await ctx.db.batch([auditStmt(ctx.who, 'phone-row', 'trx', id, null, { phone: phone.name })]);
      out.push({ id, ok: true });
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      out.push({ id, ok: false, error: err.msg });
    }
  }
  await ctx.db.batch([{ sql: 'UPDATE phone SET last_sync = ? WHERE id = ?', params: [now(), phone.id] }]);
  return out;
}

/** A photo of the receipt for a row the phone sent. `key` is the photo's own number: the same photo never comes twice. */
export async function phonePhoto(ctx: OpCtx, a: { trxId: string; key: string; base64: string; mime: string }): Promise<{ ok: true; already?: boolean }> {
  const key = String(a.key ?? '');
  if (!ID.test(key)) throw new UserError(m('صورة بلا رقم', 'A photo without its number', 'Une photo sans son numéro'));
  if (await one(ctx.db, 'SELECT 1 AS x FROM phone_photo WHERE key = ?', [key])) return { ok: true, already: true };
  const made = (await runOp(ctx, 'doc.add', { trxId: String(a.trxId), base64: String(a.base64 ?? ''), mime: String(a.mime ?? '') })) as { id: string };
  await ctx.db.batch([{ sql: 'INSERT INTO phone_photo (key, attachment_id, at) VALUES (?,?,?)', params: [key, made.id, now()] }]);
  return { ok: true };
}
