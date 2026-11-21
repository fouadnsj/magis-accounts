// The hosting section's operations (Fouad, 22 November 2026): buildings and rooms, bookings with their status, the services
// sold with them, and payments the accountant turns into entries. See host.ts for the rules.
//  - hosting.view: sees the calendar and the bookings, never an amount;
//  - hosting.book: makes, changes and confirms bookings (still no amount);
//  - hosting.keep: keeps the buildings, rooms, services, sees and sets the amounts and the payments.
import { nowIso, one, type Stmt } from '../db/db';
import { addHeading, addLine, auditStmt, getMeta, setMetaStmt, UserError } from '../db/repo';
import { FARM_LIST } from './farm';
import { has } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import {
  checkBooking, clashing, conflictsOf, holds, isDay, nextCode, nextReceipt, STATUSES, toReview, withoutPrices,
  type BookingKind, type BookingStatus, type Currency, type HostAlloc, type HostBooking, type HostBuilding, type HostData, type HostLine, type HostPay, type HostRoom, type HostService,
} from './host';

const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non autorisé pour cet utilisateur'));
const view = (c: OpCtx) => { if (!has(c.profile, 'hosting.view') && !has(c.profile, 'hosting.book') && !has(c.profile, 'hosting.keep')) throw refuse(); };
const book = (c: OpCtx) => { if (!has(c.profile, 'hosting.book') && !has(c.profile, 'hosting.keep')) throw refuse(); };
const keep = (c: OpCtx) => { if (!has(c.profile, 'hosting.keep')) throw refuse(); };
const keeps = (c: OpCtx) => has(c.profile, 'hosting.keep');
const looksAtAll = (c: OpCtx) => has(c.profile, 'hosting.keep') || has(c.profile, 'hosting.book');

const txt = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim());
const money = (x: unknown) => (x == null || x === '' ? null : Math.max(0, Math.round(Number(x) * 100) / 100));
const whole = (x: unknown) => Math.max(0, Math.floor(Number(x) || 0));
const cur = (x: unknown): Currency => (x === 'SYP' ? 'SYP' : 'USD');
const today = () => nowIso().slice(0, 10);

/** is the section switched on for this centre? */
export const sectionOn = async (db: OpCtx['db']) => (await getMeta(db, 'sec_hosting')) === '1';
/** the inventory is on unless a centre switched it off */
export const inventoryOn = async (db: OpCtx['db']) => (await getMeta(db, 'sec_inventory')) !== '0';

export async function loadHosting(c: OpCtx): Promise<HostData> {
  const d: HostData = {
    buildings: await c.db.query<HostBuilding>('SELECT * FROM host_building ORDER BY sort, name'),
    rooms: await c.db.query<HostRoom>('SELECT * FROM host_room ORDER BY building_id, sort, name'),
    services: await c.db.query<HostService>('SELECT * FROM host_service ORDER BY sort, name'),
    bookings: await c.db.query<HostBooking>('SELECT * FROM host_booking ORDER BY from_day, id'),
    allocs: await c.db.query<HostAlloc>('SELECT * FROM host_alloc'),
    lines: await c.db.query<HostLine>('SELECT * FROM host_line ORDER BY id'),
    pays: await c.db.query<HostPay>('SELECT * FROM host_pay ORDER BY paid_on, id'),
    entered: (await c.db.query<{ receipt: string }>("SELECT DISTINCT receipt FROM trx WHERE type = 'Income' AND receipt IN (SELECT receipt_no FROM host_pay)")).map((x) => x.receipt),
    prices: true,
  };
  return keeps(c) ? d : withoutPrices(d);
}

async function roomsOf(c: OpCtx) { return c.db.query<HostRoom>('SELECT * FROM host_room'); }

/** the bookings, allocations and rooms, read fresh for a conflict check */
async function snapshot(c: OpCtx) {
  return {
    bookings: await c.db.query<HostBooking>('SELECT * FROM host_booking'),
    allocs: await c.db.query<HostAlloc>('SELECT * FROM host_alloc'),
    rooms: await roomsOf(c),
  };
}

export interface BookingInput {
  id?: number;
  kind?: BookingKind;
  group_name: string;
  contact?: string | null;
  phone?: string | null;
  people?: number;
  from_day: string;
  to_day: string;
  /** an event only: the weekdays it repeats on (0 = Sunday), and its hours */
  repeat_days?: number[] | string | null;
  time_from?: string | null;
  time_to?: string | null;
  status?: BookingStatus;
  price_mode?: 'person' | 'group' | null;
  rate?: number | null;
  currency?: Currency;
  note?: string | null;
  allocs?: { room_id: number; beds?: number | null }[];
  lines?: { id?: number; service_id?: number | null; label?: string; qty?: number; amount?: number; currency?: Currency }[];
  /** a booking made with no connection: the phone's own number for it, and where it was made */
  client_ref?: string | null;
  source?: 'desk' | 'phone';
}

const dayMsg = () => new UserError(m('تواريخ غير صحيحة', 'The dates are not valid', 'Dates invalides'));
function why(code: string): UserError {
  switch (code) {
    case 'name': return new UserError(m('اكتب اسم المجموعة', 'Write the name of the group', 'Écrivez le nom du groupe'));
    case 'dates': return dayMsg();
    case 'order': return new UserError(m('يجب أن يكون الخروج بعد الوصول', 'The leaving day must come after the arrival', 'Le départ doit suivre l’arrivée'));
    case 'repeat': return new UserError(m('لا يوجد أي يوم من أيام الأسبوع المختارة بين التاريخين', 'None of the chosen weekdays falls between the two dates', 'Aucun des jours choisis ne tombe entre les deux dates'));
    case 'time': return new UserError(m('الساعة غير صحيحة (مثال 16:00)', 'The hour is not valid (e.g. 16:00)', 'L’heure n’est pas valide (ex. 16:00)'));
    case 'long': return new UserError(m('المدة طويلة جداً (أكثر من سنة)', 'Too long (more than a year)', 'Trop long (plus d’un an)'));
    default: return new UserError(m('عدد الأشخاص غير صحيح', 'The number of people is not valid', 'Nombre de personnes invalide'));
  }
}

const clashText = (names: string[]) => new UserError(m(
  `الغرف محجوزة في هذه الأيام: ${names.join('، ')}`,
  `The rooms are already taken on these days by: ${names.join(', ')}`,
  `Les chambres sont déjà prises à ces dates par : ${names.join(', ')}`));

/** the rooms asked for must exist and be in use */
async function checkAllocs(c: OpCtx, allocs: { room_id: number; beds?: number | null }[]): Promise<HostAlloc[]> {
  const rooms = new Map((await roomsOf(c)).map((r) => [r.id, r]));
  const seen = new Set<number>();
  const out: HostAlloc[] = [];
  for (const a of allocs) {
    const r = rooms.get(Number(a.room_id));
    if (!r || !r.active) throw new UserError(m('غرفة غير موجودة أو متوقفة', 'A room is missing or switched off', 'Une chambre est introuvable ou désactivée'));
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const beds = a.beds == null ? null : Math.max(1, Math.min(Math.max(1, r.beds), whole(a.beds)));
    out.push({ booking_id: 0, room_id: r.id, beds });
  }
  return out;
}

async function bookingOf(c: OpCtx, id: number) {
  const b = await one<HostBooking>(c.db, 'SELECT * FROM host_booking WHERE id = ?', [id]);
  if (!b) throw new UserError(m('الحجز غير موجود', 'Booking not found', 'Réservation introuvable'));
  return b;
}

async function saveBooking(c: OpCtx, a: BookingInput) {
  const kind: BookingKind = a.kind === 'event' ? 'event' : 'stay';
  const old = a.id ? await bookingOf(c, a.id) : null;
  const dup = a.client_ref ? await one<{ id: number }>(c.db, 'SELECT id FROM host_booking WHERE client_ref = ?', [a.client_ref]) : null;
  // a phone that sent the same booking twice (no answer, sent again): the first one stays
  if (dup && !old) return { id: dup.id, conflicts: 0, again: true };
  // the repeat and the hours are for events only (never a stay)
  const rep = kind === 'event' ? (Array.isArray(a.repeat_days) ? a.repeat_days : typeof a.repeat_days === 'string' && a.repeat_days ? a.repeat_days.split(',') : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : [];
  const repeat = rep.length ? [...new Set(rep)].sort((x, y) => x - y).join(',') : null;
  const tFrom = kind === 'event' ? txt(a.time_from) : null;
  const tTo = kind === 'event' ? txt(a.time_to) : null;
  const g = { kind, group_name: String(a.group_name ?? ''), people: whole(a.people), from_day: String(a.from_day ?? ''), to_day: String(a.to_day ?? ''), repeat_days: repeat, time_from: tFrom, time_to: tTo };
  const bad = checkBooking(g);
  if (bad) throw why(bad);
  const asked = await checkAllocs(c, Array.isArray(a.allocs) ? a.allocs : []);
  const phone = a.source === 'phone';
  // a booking from a phone with no connection is always "to confirm"
  let status: BookingStatus = old?.status ?? 'option';
  if (!old && a.source === 'phone') status = 'option';
  else if (a.status && (STATUSES as readonly string[]).includes(a.status) && !phone) status = a.status;
  if (old && old.status === 'cancelled' && status !== 'cancelled') status = old.status;
  const id = old?.id ?? ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(id), 0) AS n FROM host_booking'))?.n ?? 0) + 1;
  const snap = await snapshot(c);
  const probe = { id, kind, from_day: g.from_day, to_day: g.to_day, repeat_days: repeat, time_from: tFrom, time_to: tTo };
  const sure = conflictsOf(probe, asked, snap, 'sure');
  const byId = new Map(snap.bookings.map((x) => [x.id, x]));
  if (holds({ status }) && sure.length) throw clashText(clashing(sure).map((i) => byId.get(i)?.group_name ?? String(i)));
  const any = conflictsOf(probe, asked, snap, 'any');

  // the amounts are written only by someone who keeps the calendar; the others leave them as they are
  const priced = keeps(c);
  const mode = priced ? (a.price_mode === 'group' ? 'group' : a.price_mode === 'person' ? 'person' : null) : old?.price_mode ?? null;
  const rate = priced ? money(a.rate) : old?.rate ?? null;
  const currency = priced ? cur(a.currency) : old?.currency ?? 'USD';

  const stmts: Stmt[] = [];
  const stamp = nowIso();
  if (old) {
    stmts.push({
      sql: `UPDATE host_booking SET kind=?, group_name=?, contact=?, phone=?, people=?, from_day=?, to_day=?, repeat_days=?, time_from=?, time_to=?, status=?, price_mode=?, rate=?, currency=?, note=?, updated_at=? WHERE id=?`,
      params: [kind, g.group_name.trim(), txt(a.contact), txt(a.phone), g.people, g.from_day, g.to_day, repeat, tFrom, tTo, status, mode, rate, currency, txt(a.note), stamp, id],
    });
    stmts.push({ sql: 'DELETE FROM host_alloc WHERE booking_id = ?', params: [id] });
  } else {
    const code = nextCode((await c.db.query<{ code: string }>('SELECT code FROM host_booking')).map((x) => x.code), Number(g.from_day.slice(0, 4)));
    stmts.push({
      sql: `INSERT INTO host_booking (id, code, kind, status, group_name, contact, phone, people, from_day, to_day, repeat_days, time_from, time_to, price_mode, rate, currency, note, source, review, client_ref, created_by, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      params: [id, code, kind, status, g.group_name.trim(), txt(a.contact), txt(a.phone), g.people, g.from_day, g.to_day, repeat, tFrom, tTo, mode, rate, currency, txt(a.note),
        a.source === 'phone' ? 'phone' : 'desk', a.source === 'phone' ? 1 : 0, txt(a.client_ref), c.who, stamp],
    });
  }
  for (const al of asked) stmts.push({ sql: 'INSERT INTO host_alloc (booking_id, room_id, beds) VALUES (?,?,?)', params: [id, al.room_id, al.beds] });

  // the services: those who do not see the amounts keep the amount a line already had
  const had = new Map((await c.db.query<HostLine>('SELECT * FROM host_line WHERE booking_id = ?', [id])).map((l) => [l.id, l]));
  const services = new Map((await c.db.query<HostService>('SELECT * FROM host_service')).map((s) => [s.id, s]));
  stmts.push({ sql: 'DELETE FROM host_line WHERE booking_id = ?', params: [id] });
  let next = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(id), 0) AS n FROM host_line'))?.n ?? 0);
  for (const l of Array.isArray(a.lines) ? a.lines : []) {
    const sv = l.service_id != null ? services.get(Number(l.service_id)) : null;
    const label = txt(l.label) ?? sv?.name;
    if (!label) continue;
    const amount = priced ? money(l.amount) ?? 0 : (l.id != null ? had.get(l.id)?.amount : 0) ?? 0;
    const lineCur = priced ? cur(l.currency ?? currency) : (l.id != null ? had.get(l.id)?.currency : null) ?? currency;
    stmts.push({ sql: 'INSERT INTO host_line (id, booking_id, service_id, label, qty, amount, currency) VALUES (?,?,?,?,?,?,?)', params: [++next, id, sv?.id ?? null, label, Math.max(0, Number(l.qty) || 1), amount, lineCur] });
  }
  stmts.push(auditStmt(c.who, old ? 'update' : 'add', 'host_booking', String(id), null, { group: g.group_name.trim(), from: g.from_day, to: g.to_day, status, rooms: asked.length }));
  await c.db.batch(stmts);
  return { id, conflicts: clashing(any).length, again: false };
}

export const HOST_OPS = {
  'host.get': { check: view, run: (c: OpCtx) => loadHosting(c) },

  'host.booking.save': { check: book, run: (c: OpCtx, a: BookingInput) => saveBooking(c, a) },

  /** to confirm → confirmed → arrived → left, or cancelled (with the reason) */
  'host.booking.status': {
    check: book,
    run: async (c: OpCtx, a: { id: number; status: BookingStatus; reason?: string | null }) => {
      if (!(STATUSES as readonly string[]).includes(a.status)) throw new UserError(m('حالة غير معروفة', 'Unknown status', 'Statut inconnu'));
      const b = await bookingOf(c, a.id);
      if (b.status === 'cancelled' && a.status !== 'option') throw new UserError(m('الحجز ملغى؛ أعده «للتأكيد» أولاً', 'The booking is cancelled: put it back to "to confirm" first', 'Réservation annulée : remettez-la d’abord « à confirmer »'));
      if (holds({ status: a.status })) {
        const snap = await snapshot(c);
        const mine = snap.allocs.filter((x) => x.booking_id === b.id);
        if (!mine.length) throw new UserError(m('اختر الغرف قبل التأكيد', 'Choose the rooms before confirming', 'Choisissez les chambres avant de confirmer'));
        const cs = conflictsOf(b, mine, snap, 'sure');
        if (cs.length) {
          const byId = new Map(snap.bookings.map((x) => [x.id, x]));
          throw clashText(clashing(cs).map((i) => byId.get(i)?.group_name ?? String(i)));
        }
      }
      const reason = a.status === 'cancelled' ? txt(a.reason) : null;
      await c.db.batch([
        { sql: 'UPDATE host_booking SET status = ?, cancel_reason = ?, review = 0, updated_at = ? WHERE id = ?', params: [a.status, reason, nowIso(), b.id] },
        auditStmt(c.who, 'status', 'host_booking', String(b.id), { status: b.status }, { status: a.status, reason }),
      ]);
      return { ok: true };
    },
  },

  /** a booking made by mistake, with no payment: removed */
  'host.booking.delete': {
    check: keep,
    run: async (c: OpCtx, a: { id: number }) => {
      const b = await bookingOf(c, a.id);
      if (await one(c.db, 'SELECT 1 FROM host_pay WHERE booking_id = ?', [b.id])) throw new UserError(m('عليه دفعات: ألغِه بدل حذفه', 'It has payments: cancel it instead', 'Il a des paiements : annulez-la plutôt'));
      await c.db.batch([
        { sql: 'DELETE FROM host_line WHERE booking_id = ?', params: [b.id] },
        { sql: 'DELETE FROM host_alloc WHERE booking_id = ?', params: [b.id] },
        { sql: 'DELETE FROM host_booking WHERE id = ?', params: [b.id] },
        auditStmt(c.who, 'delete', 'host_booking', String(b.id), { group: b.group_name, from: b.from_day, to: b.to_day }, null),
      ]);
      return { ok: true };
    },
  },

  'host.building.save': {
    check: keep,
    run: async (c: OpCtx, a: { id?: number; name: string; active?: boolean; color?: string | null }) => {
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب الاسم', 'Write the name', 'Écrivez le nom'));
      const color = a.color == null || a.color === '' ? null : /^#[0-9a-fA-F]{6}$/.test(String(a.color)) ? String(a.color).toLowerCase() : (() => { throw new UserError(m('لون غير صحيح', 'The colour is not valid', 'Couleur invalide')); })();
      if (await one(c.db, 'SELECT 1 FROM host_building WHERE name = ? AND id <> ?', [name, a.id ?? -1])) throw new UserError(m('الاسم موجود', 'That name exists', 'Ce nom existe déjà'));
      const active = a.active === false ? 0 : 1;
      const sort = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(sort), 0) AS n FROM host_building'))?.n ?? 0) + 1;
      await c.db.batch([
        a.id ? { sql: 'UPDATE host_building SET name = ?, active = ?, color = COALESCE(?, color) WHERE id = ?', params: [name, active, a.color === undefined ? null : color, a.id] } : { sql: 'INSERT INTO host_building (name, sort, color) VALUES (?,?,?)', params: [name, sort, color] },
        auditStmt(c.who, a.id ? 'update' : 'add', 'host_building', a.id ? String(a.id) : null, null, { name, active, color }),
      ]);
      return { id: a.id ?? (await one<{ id: number }>(c.db, 'SELECT id FROM host_building WHERE name = ?', [name]))?.id ?? null };
    },
  },

  /** a room (or a hall): its beds; it is also a place of the inventory, so the things in it are listed there */
  'host.room.save': {
    check: keep,
    run: async (c: OpCtx, a: { id?: number; building_id: number; name: string; beds?: number; kind?: string; active?: boolean }) => {
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب الاسم', 'Write the name', 'Écrivez le nom'));
      const bld = await one<HostBuilding>(c.db, 'SELECT * FROM host_building WHERE id = ?', [a.building_id]);
      if (!bld) throw new UserError(m('المبنى غير موجود', 'Building not found', 'Bâtiment introuvable'));
      if (await one(c.db, 'SELECT 1 FROM host_room WHERE building_id = ? AND name = ? AND id <> ?', [bld.id, name, a.id ?? -1])) throw new UserError(m('الاسم موجود في هذا المبنى', 'That name exists in this building', 'Ce nom existe déjà dans ce bâtiment'));
      const kind = a.kind === 'hall' ? 'hall' : a.kind === 'other' ? 'other' : 'bedroom';
      const beds = whole(a.beds);
      const active = a.active === false ? 0 : 1;
      const old = a.id ? await one<HostRoom>(c.db, 'SELECT * FROM host_room WHERE id = ?', [a.id]) : null;
      const placeName = `${bld.name} · ${name}`;
      const stmts: Stmt[] = [];
      let placeId = old?.place_id ?? null;
      const found = await one<{ id: number }>(c.db, 'SELECT id FROM inv_place WHERE name = ?', [placeName]);
      if (found) placeId = found.id;
      else if (placeId) stmts.push({ sql: 'UPDATE inv_place SET name = ? WHERE id = ?', params: [placeName, placeId] });
      else {
        placeId = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(id), 0) AS n FROM inv_place'))?.n ?? 0) + 1;
        const so = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(sort), 0) AS n FROM inv_place'))?.n ?? 0) + 1;
        stmts.push({ sql: 'INSERT INTO inv_place (id, name, sort) VALUES (?,?,?)', params: [placeId, placeName, so] });
      }
      const sort = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(sort), 0) AS n FROM host_room'))?.n ?? 0) + 1;
      stmts.push(a.id
        ? { sql: 'UPDATE host_room SET building_id = ?, name = ?, beds = ?, kind = ?, active = ?, place_id = ? WHERE id = ?', params: [bld.id, name, beds, kind, active, placeId, a.id] }
        : { sql: 'INSERT INTO host_room (building_id, name, beds, kind, active, sort, place_id) VALUES (?,?,?,?,?,?,?)', params: [bld.id, name, beds, kind, active, sort, placeId] });
      stmts.push(auditStmt(c.who, a.id ? 'update' : 'add', 'host_room', a.id ? String(a.id) : null, null, { building: bld.name, name, beds, kind, active }));
      await c.db.batch(stmts);
      return { id: a.id ?? (await one<{ id: number }>(c.db, 'SELECT id FROM host_room WHERE building_id = ? AND name = ?', [bld.id, name]))?.id ?? null };
    },
  },

  /** the services sold with a booking (meals, breaks, logistics, heating…) */
  'host.service.save': {
    check: keep,
    run: async (c: OpCtx, a: { id?: number; name: string; active?: boolean }) => {
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب الاسم', 'Write the name', 'Écrivez le nom'));
      if (await one(c.db, 'SELECT 1 FROM host_service WHERE name = ? AND id <> ?', [name, a.id ?? -1])) throw new UserError(m('الاسم موجود', 'That name exists', 'Ce nom existe déjà'));
      const active = a.active === false ? 0 : 1;
      const sort = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(sort), 0) AS n FROM host_service'))?.n ?? 0) + 1;
      await c.db.batch([
        a.id ? { sql: 'UPDATE host_service SET name = ?, active = ? WHERE id = ?', params: [name, active, a.id] } : { sql: 'INSERT INTO host_service (name, sort) VALUES (?,?)', params: [name, sort] },
        auditStmt(c.who, a.id ? 'update' : 'add', 'host_service', a.id ? String(a.id) : null, null, { name, active }),
      ]);
      return { ok: true };
    },
  },

  /** a payment received for a booking: a SUGGESTION of an entry, which the accountant makes (or refuses) */
  'host.pay.add': {
    check: keep,
    run: async (c: OpCtx, a: { booking_id: number; amount: number; currency?: Currency; paid_on?: string; method?: string; note?: string | null }) => {
      const b = await bookingOf(c, a.booking_id);
      const amount = money(a.amount);
      if (!amount) throw new UserError(m('اكتب المبلغ', 'Write the amount', 'Écrivez le montant'));
      const day = a.paid_on && isDay(a.paid_on) ? a.paid_on : today();
      const receipt = nextReceipt((await c.db.query<{ receipt_no: string }>('SELECT receipt_no FROM host_pay')).map((x) => x.receipt_no), Number(day.slice(0, 4)));
      const method = ['cash', 'transfer', 'other'].includes(String(a.method)) ? String(a.method) : 'cash';
      await c.db.batch([
        { sql: 'INSERT INTO host_pay (booking_id, amount, currency, paid_on, method, receipt_no, note, who, at) VALUES (?,?,?,?,?,?,?,?,?)', params: [b.id, amount, cur(a.currency ?? b.currency), day, method, receipt, txt(a.note), c.who, nowIso()] },
        auditStmt(c.who, 'add', 'host_pay', receipt, null, { booking: b.code, amount, currency: cur(a.currency ?? b.currency) }),
      ]);
      return { receipt_no: receipt };
    },
  },

  /** the accountant decides this payment will not be an entry (wrong, or kept elsewhere) */
  'host.pay.refuse': {
    check: keep,
    run: async (c: OpCtx, a: { id: number; on?: boolean }) => {
      const p = await one<HostPay>(c.db, 'SELECT * FROM host_pay WHERE id = ?', [a.id]);
      if (!p) throw new UserError(m('الدفعة غير موجودة', 'Payment not found', 'Paiement introuvable'));
      if (await one(c.db, "SELECT 1 FROM trx WHERE receipt = ? AND type = 'Income'", [p.receipt_no])) throw new UserError(m('صارت قيداً في السجل', 'It is already an entry of the register', 'C’est déjà une écriture du registre'));
      const st = a.on === false ? 'suggested' : 'refused';
      await c.db.batch([{ sql: 'UPDATE host_pay SET status = ? WHERE id = ?', params: [st, p.id] }, auditStmt(c.who, st, 'host_pay', p.receipt_no, null, null)]);
      return { ok: true };
    },
  },

  /** Al-Ard's farm: the first headings and lines of its books (what already exists is left alone) */
  'host.farm.seed': {
    check: (c: OpCtx) => { if (!has(c.profile, 'lists.manage')) throw refuse(); },
    run: async (c: OpCtx) => {
      if ((await c.db.query('SELECT 1 FROM heading WHERE in_main = 1 LIMIT 1')).length)
        throw new UserError(m('هذه القاعدة تأخذ من القائمة الرئيسية: أضف البنود من هناك', 'This database takes from the main list: add the headings there', 'Cette base prend de la liste principale : ajoutez les rubriques là'));
      let headings = 0, lines = 0;
      for (const h of FARM_LIST) {
        let row = await one<{ id: number }>(c.db, 'SELECT id FROM heading WHERE name = ?', [h.name]);
        if (!row) { await addHeading(c.db, h.name, h.types, c.who); headings++; row = await one<{ id: number }>(c.db, 'SELECT id FROM heading WHERE name = ?', [h.name]); }
        for (const l of h.lines) {
          if (await one(c.db, 'SELECT 1 FROM budget_line WHERE heading_id = ? AND name = ?', [row!.id, l])) continue;
          await addLine(c.db, row!.id, l, c.who);
          lines++;
        }
      }
      return { headings, lines };
    },
  },

  /** the section is switched on or off for this centre */
  'host.section': {
    check: (c: OpCtx) => { if (!has(c.profile, 'lists.manage')) throw refuse(); },
    run: async (c: OpCtx, a: { on: boolean; section?: 'hosting' | 'inventory' }) => {
      const key = a.section === 'inventory' ? 'sec_inventory' : 'sec_hosting';
      await c.db.batch([setMetaStmt(key, a.on ? '1' : '0'), auditStmt(c.who, 'update', key, null, null, { on: !!a.on })]);
      return { ok: true };
    },
  },
} as const;

export const HOST_READ_ONLY = ['host.get'];

/** what the main data call carries: null when the section is off or the person does not see it */
export async function hostLite(c: OpCtx) {
  const can = has(c.profile, 'hosting.view') || has(c.profile, 'hosting.book') || has(c.profile, 'hosting.keep');
  const on = await sectionOn(c.db);
  if (!on) return can || has(c.profile, 'lists.manage') ? { on: false, review: 0, toEnter: 0, inventoryOn: await inventoryOn(c.db) } : null;
  if (!can) return null;
  const review = looksAtAll(c) ? ((await one<{ n: number }>(c.db, 'SELECT COUNT(*) AS n FROM host_booking WHERE review = 1 AND status <> ?', ['cancelled']))?.n ?? 0) : 0;
  const toEnter = keeps(c)
    ? ((await one<{ n: number }>(c.db, "SELECT COUNT(*) AS n FROM host_pay WHERE status = 'suggested' AND receipt_no NOT IN (SELECT receipt FROM trx WHERE receipt IS NOT NULL AND type = 'Income')"))?.n ?? 0)
    : 0;
  return { on: true, review, toEnter, inventoryOn: await inventoryOn(c.db) };
}

/** the bookings made on a phone that wait for a look, with what each runs into (for the window shown at the connection) */
export async function hostReview(c: OpCtx) {
  const s = await snapshot(c);
  return toReview(s);
}
