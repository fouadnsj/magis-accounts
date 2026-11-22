// The phone (Fouad, 2026-11-13): a person away from the centre records expenses and income on a phone, offline; back on
// the centre's network the phone sends them. The server stays the only record: every row passes the same checks as on
// the computer (runOp 'trx.save'), with the rights of the person the phone belongs to. Nothing else comes from a phone:
// no transfer, no exchange, no change of a row already here.
//
// A phone is paired once, by its owner signed in on it. It then holds a long random key (never the password); the
// server keeps only the key's hash. A phone that has not come back for PHONE_DAYS days must be paired again, and
// whoever manages the users can cut a phone off at once.
import { isHouseLine } from '../src/community/chart';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Db, one } from '../src/db/db';
import { auditStmt, blankTrx, closedMonths, getMeta, loadLists, loadTrx, UserError } from '../src/db/repo';
import { has, listProfiles, loadProfile, type Profile } from '../src/auth';
import { runOp, type OpCtx } from '../src/ops';
import { inventoryPack } from '../src/inventory/ops';
import { sectionOn } from '../src/hosting/ops';
import type { HostAlloc, HostBooking, HostBuilding, HostRoom } from '../src/hosting/host';
import { holders } from '../src/domain/reports';
import { rateOn } from '../src/domain/compute';
import { m, type Msg } from '../src/i18n';
import type { Trx } from '../src/domain/types';
import { loadAccounts, loadBooks, loadEntries } from '../src/community/repo';
import { balance as ctyBalance, leafAccounts, type CtyAccount } from '../src/community/domain';

export const PHONE_DAYS = 30;
const DAY = 86_400_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

export interface PhoneRow { id: string; profile_id: number; name: string; key_hash: string; created_at: string; last_sync: string | null; revoked_at: string | null; revoked_by: string | null }

/** until when this phone may still send without coming back (30 days after its last sync) */
export const validUntil = (p: Pick<PhoneRow, 'created_at' | 'last_sync'>) => new Date(Date.parse(p.last_sync ?? p.created_at) + PHONE_DAYS * DAY).toISOString();

/** may this person record from a phone at all? (somebody who writes in a book) */
export const mayPhone = (p: Profile) => has(p, 'register.edit') || has(p, 'register.main') || (has(p, 'book.own') && p.books.length > 0) || has(p, 'inventory.manage') || has(p, 'hosting.view') || has(p, 'hosting.book') || has(p, 'hosting.prices') || has(p, 'hosting.keep');

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
  books: { id: number; name: string; main: boolean; usd: number; syp: number; rate: number; bal?: Record<string, number>; kind?: string | null; office?: string | null }[];
  /** a community: the books money may be given to (the brothers, the house, the community cash) */
  targets?: { id: number; name: string; kind: string | null }[];
  headings: { id: number; name: string; code: string; types: PhoneType[]; names?: Msg }[];
  /** scope (communities): 'P' a line a Jesuit may use for himself; others are for the house */
  lines: { id: number; heading_id: number; name: string; code: string; names?: Msg; scope?: string | null; house?: boolean }[];
  parties: { id: number; name: string }[];
  /** months closed for everybody, and months this person's books are closed for */
  closed: string[];
  bookClosed: { book_id: number; ym: string }[];
  fiscalStart: string | null;
  rate: number;
  /** how far an exchange's rate may be from the last one before the phone warns (0.25 = 25 %) */
  tolerance: number;
  /** a Jesuit community (Fouad, 13 November 2026): three currencies, any exchange, no heading for an exchange */
  kind?: 'community';
  curs?: { code: string; label: string }[];
  /** the inventory, for the one who keeps it: the places and the items to count (21 November 2026) */
  inv?: { categories: { id: number; name: string; serial: number }[]; origins: { id: number; name: string }[]; names: string[]; places: { id: number; name: string }[]; items: { id: number; code: string; name: string; place_id: number | null; qty: number; serial: string | null; counted_on: string | null }[] };
  /** the calendar of rooms (22 November 2026): never an amount; `book`: this person may make bookings */
  host?: HostPack;
}

/** what the phone keeps of the calendar to work offline */
export interface HostPack {
  book: boolean;
  buildings: Pick<HostBuilding, 'id' | 'name' | 'color'>[];
  rooms: Pick<HostRoom, 'id' | 'building_id' | 'name' | 'beds' | 'kind' | 'capacity'>[];
  bookings: Pick<HostBooking, 'id' | 'code' | 'kind' | 'status' | 'group_name' | 'contact' | 'phone' | 'people' | 'from_day' | 'to_day' | 'repeat_days' | 'time_from' | 'time_to' | 'review' | 'note'>[];
  allocs: HostAlloc[];
  /** what a booking asks for (read only on the phone): the names of the equipment and how many */
  equip: { id: number; name: string }[];
  needs: { booking_id: number; equip_id: number; qty: number }[];
}

/** the rooms and the bookings of the days ahead (a few days back too), without any amount */
export async function hostPack(db: Db, profile: Profile): Promise<HostPack | undefined> {
  if (!(has(profile, 'hosting.view') || has(profile, 'hosting.book') || has(profile, 'hosting.prices') || has(profile, 'hosting.keep')) || !(await sectionOn(db))) return undefined;
  const bookings = await db.query<HostPack['bookings'][number]>("SELECT id, code, kind, status, group_name, contact, phone, people, from_day, to_day, repeat_days, time_from, time_to, review, note FROM host_booking WHERE status <> 'cancelled' AND to_day >= date('now', '-7 day') ORDER BY from_day, id");
  const ids = new Set(bookings.map((b) => b.id));
  return {
    book: has(profile, 'hosting.book') || has(profile, 'hosting.prices') || has(profile, 'hosting.keep'),
    buildings: await db.query<HostPack['buildings'][number]>('SELECT id, name, color FROM host_building WHERE active = 1 ORDER BY sort, name'),
    rooms: await db.query<HostPack['rooms'][number]>('SELECT id, building_id, name, beds, kind, capacity FROM host_room WHERE active = 1 ORDER BY building_id, sort, name'),
    bookings,
    allocs: (await db.query<HostAlloc>('SELECT * FROM host_alloc')).filter((a) => ids.has(a.booking_id)),
    equip: await db.query<{ id: number; name: string }>('SELECT id, name FROM host_equip ORDER BY sort, name'),
    needs: (await db.query<{ booking_id: number; equip_id: number; qty: number }>('SELECT booking_id, equip_id, qty FROM host_need')).filter((n) => ids.has(n.booking_id)),
  };
}

/** what a phone records: expenses, income and (Fouad, 2026-11-13) exchanges; transfers stay on the computer */
export type PhoneType = 'Exp' | 'Income' | 'Exchange' | 'Transfer';
const PHONE_TYPES: readonly string[] = ['Exp', 'Income', 'Exchange'];

/** the books a person writes in from a phone: the ones kept, Main with its right; every book for who writes everywhere */
function phoneBooks(profile: Profile, books: Awaited<ReturnType<typeof loadLists>>['books']) {
  const all = has(profile, 'register.edit');
  return books.filter((b) => b.active && (profile.books.includes(b.id) || (!!b.is_main && has(profile, 'register.main')) || (all && !b.private)));
}

/** What the phone keeps to work offline: the person's books and their balance, the headings and lines, the closed months. */
export async function phonePack(db: Db, profile: Profile, phone: PhoneRow): Promise<PhonePack> {
  if ((await getMeta(db, 'kind')) === 'community') return ctyPack(db, profile, phone);
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
    ...(has(profile, 'inventory.manage') ? { inv: await inventoryPack(db) } : {}),
    ...((await hostPack(db, profile)) ? { host: await hostPack(db, profile) } : {}),
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
  currency: string;
  /** an exchange: the pounds received */
  syp?: number;
  /** a community: a Jesuit's expense paid for the house (1) */
  for_house?: number;
  /** a community: a transfer, to which book */
  to_book_id?: number | null;
  /** an exchange in a community: the currency and the amount received */
  cur2?: string | null;
  amount2?: number | null;
}
export interface PhoneResult { id: string; ok: boolean; already?: boolean; error?: Msg }

const ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Takes the rows a phone sends, one by one: each passes the usual checks or comes back with its reason. A row already
 * here (the phone sent it, then lost the connection before hearing so) is not written twice.
 */
export async function phonePush(ctx: OpCtx, phone: PhoneRow, entries: PhoneEntry[]): Promise<PhoneResult[]> {
  if ((await getMeta(ctx.db, 'kind')) === 'community') return ctyPush(ctx, phone, entries);
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
  const cty = (await getMeta(ctx.db, 'kind')) === 'community';
  const made = (await runOp(ctx, cty ? 'cty.doc.add' : 'doc.add', cty
    ? { entryId: String(a.trxId), base64: String(a.base64 ?? ''), mime: String(a.mime ?? '') }
    : { trxId: String(a.trxId), base64: String(a.base64 ?? ''), mime: String(a.mime ?? '') })) as { id: string };
  await ctx.db.batch([{ sql: 'INSERT INTO phone_photo (key, attachment_id, at) VALUES (?,?,?)', params: [key, made.id, now()] }]);
  return { ok: true };
}

/** A count made on the phone: these items were seen in this place on this day. `key` is its own number: it never counts twice. */
export async function phoneInvCount(ctx: OpCtx, a: { key: string; ids: number[]; placeId: number | null; date: string }): Promise<{ ok: true; counted?: number; already?: boolean }> {
  const key = String(a.key ?? '');
  if (!ID.test(key)) throw new UserError(m('عدّ بلا رقم', 'A count without its number', 'Un comptage sans son numéro'));
  if (await one(ctx.db, 'SELECT 1 AS x FROM phone_photo WHERE key = ?', [key])) return { ok: true, already: true };
  const r = (await runOp(ctx, 'inv.count', { ids: (Array.isArray(a.ids) ? a.ids : []).slice(0, 5000), placeId: a.placeId ?? null, date: String(a.date ?? '') })) as { counted: number };
  await ctx.db.batch([{ sql: 'INSERT INTO phone_photo (key, attachment_id, at) VALUES (?,?,?)', params: [key, 'inv-count', now()] }]);
  return { ok: true, counted: r.counted };
}

/** An item recorded on the phone (a walk-through): created like on the computer; its photo, if any, comes with it. */
export async function phoneInvNew(ctx: OpCtx, a: { key: string; item: Record<string, unknown>; photo?: { base64: string; mime: string } | null }): Promise<{ ok: true; id?: number; code?: string; already?: boolean }> {
  const key = String(a.key ?? '');
  if (!ID.test(key)) throw new UserError(m('بلا رقم', 'Without its number', 'Sans son numéro'));
  if (await one(ctx.db, 'SELECT 1 AS x FROM phone_photo WHERE key = ?', [key])) return { ok: true, already: true };
  const it = a.item ?? {};
  const made = (await runOp(ctx, 'inv.item.many', { items: [{
    name: String(it.name ?? ''), category_id: it.category_id == null ? null : Number(it.category_id), place_id: it.place_id == null ? null : Number(it.place_id),
    qty: Number(it.qty ?? 1), serial: it.serial == null ? null : String(it.serial), code: it.code == null || String(it.code).trim() === '' ? null : String(it.code).trim(),
    origin_id: it.origin_id == null ? null : Number(it.origin_id), note: it.note == null ? null : String(it.note),
  }] })) as { ids: number[] };
  const id = made.ids[0];
  if (a.photo?.base64) { try { await runOp(ctx, 'inv.photo.add', { itemId: id, base64: String(a.photo.base64), mime: String(a.photo.mime ?? 'image/jpeg') }); } catch { /* the item is made; its photo can be added on the computer */ } }
  await ctx.db.batch([{ sql: 'INSERT INTO phone_photo (key, attachment_id, at) VALUES (?,?,?)', params: [key, 'inv-new', now()] }]);
  const code = (await one<{ code: string }>(ctx.db, 'SELECT code FROM inv_item WHERE id = ?', [id]))?.code;
  return { ok: true, id, code };
}

/**
 * A booking made on the phone, perhaps with no connection: it is always "to confirm" here, whatever the phone says, and the
 * phone's own number for it (`key`) makes sure it is never made twice. With `id` it changes a booking (the phone being online).
 */
export async function phoneHostBook(ctx: OpCtx, a: { key: string; id?: number | null; booking: Record<string, unknown> }): Promise<{ ok: true; id: number; conflicts: number; already?: boolean }> {
  const key = String(a.key ?? '');
  if (!ID.test(key)) throw new UserError(m('حجز بلا رقم', 'A booking without its number', 'Une réservation sans son numéro'));
  const b = a.booking ?? {};
  const rooms = (Array.isArray(b.allocs) ? (b.allocs as Record<string, unknown>[]) : []).map((x) => ({ room_id: Number(x.room_id), beds: x.beds == null ? null : Number(x.beds) }));
  const lines = (Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : []).map((l) => ({ service_id: l.service_id == null ? null : Number(l.service_id), label: l.label == null ? undefined : String(l.label), qty: Number(l.qty ?? 1) }));
  const r = (await runOp(ctx, 'host.booking.save', {
    ...(a.id ? { id: Number(a.id) } : { source: 'phone', client_ref: key }),
    kind: b.kind === 'event' ? 'event' : 'stay', group_name: String(b.group_name ?? ''), contact: b.contact == null ? null : String(b.contact), phone: b.phone == null ? null : String(b.phone),
    people: Number(b.people ?? 0), from_day: String(b.from_day ?? ''), to_day: String(b.to_day ?? ''), note: b.note == null ? null : String(b.note), allocs: rooms, lines,
  })) as { id: number; conflicts: number; again: boolean };
  return { ok: true, id: r.id, conflicts: r.conflicts, ...(r.again ? { already: true } : {}) };
}

/** Confirm (or put back to "to confirm", or cancel) a booking from the phone: the server checks the rooms again. */
export async function phoneHostStatus(ctx: OpCtx, a: { id: number; status: string; reason?: string | null }): Promise<{ ok: true }> {
  const status = ['confirmed', 'option', 'cancelled'].includes(String(a.status)) ? String(a.status) : 'option';
  await runOp(ctx, 'host.booking.status', { id: Number(a.id), status, reason: a.reason ?? null });
  return { ok: true };
}

/** A photo of an item taken on the phone. */
export async function phoneInvPhoto(ctx: OpCtx, a: { key: string; itemId: number; base64: string; mime: string }): Promise<{ ok: true; already?: boolean }> {
  const key = String(a.key ?? '');
  if (!ID.test(key)) throw new UserError(m('صورة بلا رقم', 'A photo without its number', 'Une photo sans son numéro'));
  if (await one(ctx.db, 'SELECT 1 AS x FROM phone_photo WHERE key = ?', [key])) return { ok: true, already: true };
  const made = (await runOp(ctx, 'inv.photo.add', { itemId: Number(a.itemId), base64: String(a.base64 ?? ''), mime: String(a.mime ?? '') })) as { id: string };
  await ctx.db.batch([{ sql: 'INSERT INTO phone_photo (key, attachment_id, at) VALUES (?,?,?)', params: [key, made.id, now()] }]);
  return { ok: true };
}

// ---------------------------------------------------------------- a Jesuit community (Fouad, 13 November 2026)
// The same phone, for the books a Jesuit keeps (his pocket, the house for the minister, the cash for the econome):
// expenses and income on the community's chart, exchanges between any two of its three currencies. Every entry goes
// through 'cty.entry.save' with the rights of the account the phone belongs to (approval limits included).

const CTY_CURS = ['LOC', 'USD', 'EUR'];
/** a community's phone also gives money: the econome to a brother or the house, a Jesuit back to the econome (15 November 2026) */
const CTY_TYPES: readonly string[] = ['Exp', 'Income', 'Exchange', 'Transfer'];

/**
 * The accounts behind a Jesuit's phone (Fouad, 15 November 2026): the person, and the offices he holds (the hats:
 * minister, econome…). The phone holds the books of all of them; each row is saved with the account that keeps its book.
 */
async function phoneAccounts(db: Db, owner: Profile): Promise<Profile[]> {
  const all = await listProfiles(db);
  // a phone paired while wearing a hat: the person behind that office
  const personName = (owner.office ? owner.held_by ?? '' : owner.name).trim().toLowerCase();
  const person = owner.office ? all.find((q) => !q.office && q.name.trim().toLowerCase() === personName) : owner;
  const ids = [
    ...(person ? [person.id] : [owner.id]),
    ...all.filter((q) => q.office && q.office !== 'admin' && q.office !== 'superior' && (q.held_by ?? '').trim().toLowerCase() === personName).map((q) => q.id),
  ];
  const out: Profile[] = [];
  for (const id of [...new Set(ids)]) { const p = id === owner.id ? owner : await loadProfile(db, id); if (p && p.active !== 0) out.push(p); }
  return out;
}
const accNames = (a: CtyAccount): Msg => ({ ar: a.name_ar || a.name_en, en: a.name_en, fr: a.name_fr || a.name_en });

async function ctyPack(db: Db, profile: Profile, phone: PhoneRow): Promise<PhonePack> {
  const [books, accounts, entries] = await Promise.all([loadBooks(db), loadAccounts(db), loadEntries(db)]);
  const stamp = now();
  // his books and those of his offices (the house for the minister, the cash for the econome), but not the account at
  // the économat (that one moves with the Province, never from a phone)
  const who = await phoneAccounts(db, profile);
  const keeper = (id: number) => who.find((p) => p.books.includes(id));
  const order = ['personal', 'personal_bank', 'house', 'envelope', 'cash', 'bank'];
  const mine = books.filter((b) => b.active && keeper(b.id) && b.cty_kind !== 'economat').sort((a, b) => order.indexOf(a.cty_kind ?? '') - order.indexOf(b.cty_kind ?? ''));
  const label = (b: (typeof books)[number]) => b.cty_kind === 'personal' ? (b.keeper_name ?? b.name) : b.cty_kind === 'house' ? 'The house · البيت · La maison' : b.cty_kind === 'cash' ? 'Community cash · صندوق الجماعة · Caisse' : b.cty_kind === 'bank' ? 'Bank · المصرف · Banque' : b.cty_kind === 'envelope' ? `✉ ${b.name}` : b.name;
  // the category as on the computer (Entry.tsx, offered): the highest level under the top group (Health › Doctors);
  // a line straight under a top group is its own category
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const top = (a: CtyAccount) => { let h = a; while (h.parent_id != null && byId.get(h.parent_id)?.parent_id != null) h = byId.get(h.parent_id)!; return h; };
  const lines = leafAccounts(accounts).filter((a) => a.type === 'Exp' || a.type === 'Income')
    .map((a) => ({ id: a.id, heading_id: top(a).id, name: a.name_en, code: a.code, names: accNames(a), scope: a.scope ?? null, house: isHouseLine(accounts, a.id) }));
  const heads = new Set(lines.map((l) => l.heading_id));
  const headings = accounts.filter((a) => heads.has(a.id)).sort((x, y) => x.sort - y.sort || x.code.localeCompare(y.code))
    .map((a) => ({ id: a.id, name: a.name_en, code: a.code, names: accNames(a), types: [a.type as PhoneType] }));
  const closed = (await db.query<{ ym: string }>('SELECT ym FROM closed_month')).map((r) => r.ym);
  const bm = await db.query<{ book_id: number; ym: string }>('SELECT book_id, ym FROM cty_month');
  const local = (await getMeta(db, 'local_currency')) ?? 'SYP';
  await db.batch([{ sql: 'UPDATE phone SET last_sync = ? WHERE id = ?', params: [stamp, phone.id] }]);
  return {
    phone: { id: phone.id, name: phone.name },
    user: profile.name,
    organisation: (await getMeta(db, 'organisation')) ?? '',
    centre: 'community',
    color: null,
    asOf: stamp,
    validUntil: validUntil({ created_at: phone.created_at, last_sync: stamp }),
    books: mine.map((b) => {
      // everything written in it (the phone counts every row it holds the same way)
      const bal = ctyBalance(entries, b, '9999-12-31');
      const r = (x: number) => Math.round(x * 100) / 100;
      return { id: b.id, name: label(b), main: false, usd: r(bal.USD), syp: r(bal.LOC), rate: 0, bal: { LOC: r(bal.LOC), USD: r(bal.USD), EUR: r(bal.EUR) }, kind: b.cty_kind, office: keeper(b.id)?.office ?? null };
    }),
    targets: books.filter((b) => b.active && ['personal', 'house', 'cash', 'bank'].includes(b.cty_kind ?? '')).map((b) => ({ id: b.id, name: label(b), kind: b.cty_kind })),
    headings,
    lines,
    parties: [],
    closed: [...new Set(closed)].sort(),
    bookClosed: bm.filter((x) => mine.some((b) => b.id === x.book_id)),
    fiscalStart: null,
    rate: 0,
    tolerance: 0.25,
    kind: 'community',
    curs: [{ code: 'LOC', label: local }, { code: 'USD', label: '$' }, { code: 'EUR', label: '€' }],
  };
}

async function ctyPush(ctx: OpCtx, phone: PhoneRow, entries: PhoneEntry[]): Promise<PhoneResult[]> {
  const out: PhoneResult[] = [];
  const who = await phoneAccounts(ctx.db, ctx.profile);
  for (const e of entries.slice(0, 200)) {
    const id = String(e?.id ?? '');
    try {
      if (!ID.test(id)) throw new UserError(m('سطر بلا رقم', 'A row without its number', 'Une ligne sans son numéro'));
      if (await one(ctx.db, 'SELECT 1 AS x FROM cty_entry WHERE id = ?', [id])) { out.push({ id, ok: true, already: true }); continue; }
      if (!CTY_TYPES.includes(e.type)) throw new UserError(m('من الهاتف: نفقة أو إيراد أو صرافة أو تحويل فقط', 'From a phone: an expense, an income, an exchange or a transfer only', "Depuis un téléphone : une dépense, une recette, un change ou un transfert seulement"));
      // saved with the account that keeps this book: himself, or his office (minister, econome)
      const by = who.find((p) => p.books.includes(Number(e.book_id))) ?? ctx.profile;
      const tr = e.type === 'Transfer';
      if (!CTY_CURS.includes(e.currency) || (e.type === 'Exchange' && !CTY_CURS.includes(String(e.cur2))))
        throw new UserError(m('العملة غير معروفة', 'Unknown currency', 'Monnaie inconnue'));
      const ex = e.type === 'Exchange';
      const note = [String(e.explanation ?? '').trim(), e.receipt ? `#${String(e.receipt).trim()}` : ''].filter(Boolean).join(' · ').slice(0, 500) || null;
      await runOp({ ...ctx, profile: by, who: by.name }, 'cty.entry.save', {
        newId: id,
        entry: {
          book_id: Number(e.book_id), date: String(e.date ?? ''), type: e.type, cur: e.currency, amount: Number(e.amount),
          account_id: ex || tr ? null : Number(e.line_id) || null, to_book_id: tr ? Number(e.to_book_id) || null : null,
          cur2: ex ? String(e.cur2) : null, amount2: ex ? Number(e.amount2) : null, note, claim: null,
          for_house: e.type === 'Exp' && e.for_house ? 1 : 0,
        },
      });
      await ctx.db.batch([auditStmt(by.name, 'phone-row', 'cty_entry', id, null, { phone: phone.name })]);
      out.push({ id, ok: true });
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      out.push({ id, ok: false, error: err.msg });
    }
  }
  await ctx.db.batch([{ sql: 'UPDATE phone SET last_sync = ? WHERE id = ?', params: [now(), phone.id] }]);
  return out;
}
