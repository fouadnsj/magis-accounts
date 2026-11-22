// The hosting section's operations (Fouad, 22 November 2026): buildings and rooms, bookings with their status, the services
// sold with them, and payments the accountant turns into entries. See host.ts for the rules.
//  - hosting.view: sees the calendar and the bookings, never an amount;
//  - hosting.book: makes, changes and confirms bookings (still no amount);
//  - hosting.prices: sees and sets the amounts and the payments (its own tick: reception may or may not have it);
//  - hosting.keep: keeps the buildings, rooms and services (and has the prices).
import { nowIso, one, type Stmt } from '../db/db';
import { addHeading, addLine, auditStmt, getMeta, setMetaStmt, UserError } from '../db/repo';
import { FARM_LIST } from './farm';
import { has } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import {
  checkBooking, clashing, conflictsOf, holds, isDay, nextCode, nextReceipt, STATUSES, toReview, withoutPrices,
  shortagesFor, type BookingKind, type BookingStatus, type Currency, type HostAlloc, type HostAsset, type HostEquip, type HostNeed, type HostBooking, type HostBuilding, type HostData, type HostKind, type HostLine, type HostPay, type HostRoom, type HostService,
} from './host';

const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non autorisé pour cet utilisateur'));
const view = (c: OpCtx) => { if (!has(c.profile, 'hosting.view') && !has(c.profile, 'hosting.book') && !has(c.profile, 'hosting.prices') && !has(c.profile, 'hosting.keep')) throw refuse(); };
const book = (c: OpCtx) => { if (!has(c.profile, 'hosting.book') && !has(c.profile, 'hosting.prices') && !has(c.profile, 'hosting.keep')) throw refuse(); };
const keep = (c: OpCtx) => { if (!has(c.profile, 'hosting.keep')) throw refuse(); };
/** seeing and setting the prices and the payments is its own tick (the one who keeps the calendar has it too) */
const priced = (c: OpCtx) => has(c.profile, 'hosting.prices') || has(c.profile, 'hosting.keep');
const pricedOnly = (c: OpCtx) => { if (!priced(c)) throw refuse(); };
const looksAtAll = (c: OpCtx) => has(c.profile, 'hosting.keep') || has(c.profile, 'hosting.book') || has(c.profile, 'hosting.prices');

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
    kinds: await c.db.query<HostKind>('SELECT * FROM host_kind ORDER BY sort, name'),
    equip: await equipOf(c),
    needs: await c.db.query<HostNeed>('SELECT * FROM host_need'),
    // what each meeting space holds: the items of the inventory placed in it (projector, sound system, chairs…)
    assets: await c.db.query<HostAsset>("SELECT r.id AS room_id, i.name AS name, SUM(i.qty) AS qty FROM host_room r JOIN inv_item i ON i.place_id = r.place_id AND i.status = 'in_use' WHERE r.place_id IS NOT NULL AND r.kind <> 'bedroom' GROUP BY r.id, i.name ORDER BY r.id, i.name"),
    services: await c.db.query<HostService>('SELECT * FROM host_service ORDER BY sort, name'),
    bookings: await c.db.query<HostBooking>('SELECT * FROM host_booking ORDER BY from_day, id'),
    allocs: await c.db.query<HostAlloc>('SELECT * FROM host_alloc'),
    lines: await c.db.query<HostLine>('SELECT * FROM host_line ORDER BY id'),
    pays: await c.db.query<HostPay>('SELECT * FROM host_pay ORDER BY paid_on, id'),
    entered: (await c.db.query<{ receipt: string }>("SELECT DISTINCT receipt FROM trx WHERE type = 'Income' AND receipt IN (SELECT receipt_no FROM host_pay)")).map((x) => x.receipt),
    prices: true,
  };
  return priced(c) ? d : withoutPrices(d);
}

/** the equipment that can be asked for, each with how many the inventory holds (items in use and in good condition) */
async function equipOf(c: OpCtx): Promise<HostEquip[]> {
  return c.db.query<HostEquip>("SELECT e.*, COALESCE((SELECT SUM(i.qty) FROM inv_item i WHERE lower(trim(i.name)) = lower(trim(e.name)) AND i.status = 'in_use' AND i.condition = 'good'), 0) AS total FROM host_equip e ORDER BY e.sort, e.name");
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
  /** the equipment the group asks for */
  needs?: { equip_id: number; qty: number }[];
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
  if (dup && !old) return { id: dup.id, conflicts: 0, again: true, shortages: [] };
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
  const withPrice = priced(c);
  const mode = withPrice ? (a.price_mode === 'group' ? 'group' : a.price_mode === 'person' ? 'person' : null) : old?.price_mode ?? null;
  const rate = withPrice ? money(a.rate) : old?.rate ?? null;
  const currency = withPrice ? cur(a.currency) : old?.currency ?? 'USD';

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
    const amount = withPrice ? money(l.amount) ?? 0 : (l.id != null ? had.get(l.id)?.amount : 0) ?? 0;
    const lineCur = withPrice ? cur(l.currency ?? currency) : (l.id != null ? had.get(l.id)?.currency : null) ?? currency;
    stmts.push({ sql: 'INSERT INTO host_line (id, booking_id, service_id, label, qty, amount, currency) VALUES (?,?,?,?,?,?,?)', params: [++next, id, sv?.id ?? null, label, Math.max(0, Number(l.qty) || 1), amount, lineCur] });
  }
  // the equipment asked for: each must be on the list taken from the inventory
  const equip = await equipOf(c);
  const wants: { equip_id: number; qty: number }[] = [];
  for (const n of Array.isArray(a.needs) ? a.needs : []) {
    const e = equip.find((x) => x.id === Number(n.equip_id));
    const qty = whole(n.qty);
    if (!e) throw new UserError(m('تجهيز غير موجود في القائمة', 'That equipment is not on the list', 'Cet équipement n’est pas dans la liste'));
    if (qty >= 1 && !wants.some((w) => w.equip_id === e.id)) wants.push({ equip_id: e.id, qty });
  }
  stmts.push({ sql: 'DELETE FROM host_need WHERE booking_id = ?', params: [id] });
  for (const w of wants) stmts.push({ sql: 'INSERT INTO host_need (booking_id, equip_id, qty) VALUES (?,?,?)', params: [id, w.equip_id, w.qty] });
  // would this booking, with the others that meet it, ask for more than the inventory holds?
  const needsNow = await c.db.query<HostNeed>('SELECT * FROM host_need');
  const shortages = shortagesFor(probe, wants, { bookings: snap.bookings, needs: needsNow, equip });
  stmts.push(auditStmt(c.who, old ? 'update' : 'add', 'host_booking', String(id), null, { group: g.group_name.trim(), from: g.from_day, to: g.to_day, status, rooms: asked.length, equipment: wants.length }));
  await c.db.batch(stmts);
  return { id, conflicts: clashing(any).length, again: false, shortages };
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
      // arriving and leaving are for accommodation only (an event has days, not a stay)
      if (b.kind === 'event' && (a.status === 'arrived' || a.status === 'left')) throw new UserError(m('الوصول والمغادرة للإقامة فقط', 'Arrived and left are for accommodation only', 'Arrivé et parti : pour l’hébergement seulement'));
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
      // equipment: does this booking, now counted as confirmed, ask for more than the inventory holds?
      const equip = await equipOf(c);
      const needsNow = await c.db.query<HostNeed>('SELECT * FROM host_need');
      const snap2 = await snapshot(c);
      const shortages = shortagesFor(b, needsNow.filter((x) => x.booking_id === b.id), { bookings: snap2.bookings, needs: needsNow, equip });
      return { ok: true, shortages };
    },
  },

  /** a booking made by mistake, with no payment: removed */
  'host.booking.delete': {
    check: keep,
    run: async (c: OpCtx, a: { id: number }) => {
      const b = await bookingOf(c, a.id);
      if (await one(c.db, 'SELECT 1 FROM host_pay WHERE booking_id = ?', [b.id])) throw new UserError(m('عليه دفعات: ألغِه بدل حذفه', 'It has payments: cancel it instead', 'Il a des paiements : annulez-la plutôt'));
      await c.db.batch([
        { sql: 'DELETE FROM host_need WHERE booking_id = ?', params: [b.id] },
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
    run: async (c: OpCtx, a: { id?: number; building_id: number; name: string; beds?: number; capacity?: number; kind?: string; kind_id?: number | null; active?: boolean }) => {
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب الاسم', 'Write the name', 'Écrivez le nom'));
      const bld = await one<HostBuilding>(c.db, 'SELECT * FROM host_building WHERE id = ?', [a.building_id]);
      if (!bld) throw new UserError(m('المبنى غير موجود', 'Building not found', 'Bâtiment introuvable'));
      if (await one(c.db, 'SELECT 1 FROM host_room WHERE building_id = ? AND name = ? AND id <> ?', [bld.id, name, a.id ?? -1])) throw new UserError(m('الاسم موجود في هذا المبنى', 'That name exists in this building', 'Ce nom existe déjà dans ce bâtiment'));
      // the kind comes from the list the keeper edits; a kind with beds sleeps people, any other is a meeting space with a capacity
      const kinds = await c.db.query<HostKind>('SELECT * FROM host_kind');
      let row = a.kind_id != null ? kinds.find((k) => k.id === Number(a.kind_id)) : undefined;
      if (a.kind_id != null && !row) throw new UserError(m('نوع الغرفة غير موجود', 'That kind of room does not exist', 'Ce type de salle n’existe pas'));
      if (!row) row = a.kind === 'hall' || a.kind === 'other' ? kinds.find((k) => !k.sleeps) : kinds.find((k) => k.sleeps);
      if (!row) throw new UserError(m('أضف نوع غرفة أولاً', 'Add a kind of room first', 'Ajoutez d’abord un type de salle'));
      const sleeps = !!row.sleeps;
      const kind = sleeps ? 'bedroom' : a.kind === 'other' ? 'other' : 'hall';
      const beds = sleeps ? whole(a.beds) : 0;
      const capacity = sleeps ? 0 : whole(a.capacity);
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
        ? { sql: 'UPDATE host_room SET building_id = ?, name = ?, beds = ?, kind = ?, kind_id = ?, capacity = ?, active = ?, place_id = ? WHERE id = ?', params: [bld.id, name, beds, kind, row.id, capacity, active, placeId, a.id] }
        : { sql: 'INSERT INTO host_room (building_id, name, beds, kind, kind_id, capacity, active, sort, place_id) VALUES (?,?,?,?,?,?,?,?,?)', params: [bld.id, name, beds, kind, row.id, capacity, active, sort, placeId] });
      stmts.push(auditStmt(c.who, a.id ? 'update' : 'add', 'host_room', a.id ? String(a.id) : null, null, { building: bld.name, name, beds, capacity, kind: row.name, active }));
      await c.db.batch(stmts);
      return { id: a.id ?? (await one<{ id: number }>(c.db, 'SELECT id FROM host_room WHERE building_id = ? AND name = ?', [bld.id, name]))?.id ?? null };
    },
  },

  /** the names the inventory holds (items in use), with how many are in good condition: what can be chosen as equipment */
  'host.equip.options': {
    check: keep,
    run: async (c: OpCtx) => c.db.query<{ name: string; total: number; good: number }>("SELECT MIN(name) AS name, SUM(qty) AS total, SUM(CASE WHEN condition = 'good' THEN qty ELSE 0 END) AS good FROM inv_item WHERE status = 'in_use' GROUP BY lower(trim(name)) ORDER BY lower(trim(name))"),
  },

  /** a piece of equipment that bookings may ask for: it must be a name the inventory holds; switch it off (never deleted) */
  'host.equip.save': {
    check: keep,
    run: async (c: OpCtx, a: { id?: number; name?: string; active?: boolean }) => {
      if (a.id) {
        const old = await one<HostEquip>(c.db, 'SELECT * FROM host_equip WHERE id = ?', [a.id]);
        if (!old) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
        await c.db.batch([{ sql: 'UPDATE host_equip SET active = ? WHERE id = ?', params: [a.active === false ? 0 : 1, a.id] }, auditStmt(c.who, a.active === false ? 'off' : 'on', 'host_equip', String(a.id), null, { name: old.name })]);
        return { id: a.id };
      }
      const name = txt(a.name);
      if (!name) throw new UserError(m('اختر غرضاً من الجرد', 'Choose an item of the inventory', 'Choisissez un objet de l’inventaire'));
      const inv = await one<{ name: string }>(c.db, "SELECT name FROM inv_item WHERE status = 'in_use' AND lower(trim(name)) = lower(trim(?)) LIMIT 1", [name]);
      if (!inv) throw new UserError(m('هذا الغرض غير موجود في الجرد', 'The inventory holds no item with that name', 'L’inventaire ne contient aucun objet de ce nom'));
      const had = await one<{ id: number }>(c.db, 'SELECT id FROM host_equip WHERE name = ?', [inv.name]);
      if (had) { await c.db.batch([{ sql: 'UPDATE host_equip SET active = 1 WHERE id = ?', params: [had.id] }]); return { id: had.id }; }
      const sort = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(sort), 0) AS n FROM host_equip'))?.n ?? 0) + 1;
      await c.db.batch([{ sql: 'INSERT INTO host_equip (name, sort) VALUES (?,?)', params: [inv.name, sort] }, auditStmt(c.who, 'add', 'host_equip', null, null, { name: inv.name })]);
      return { id: (await one<{ id: number }>(c.db, 'SELECT id FROM host_equip WHERE name = ?', [inv.name]))?.id ?? null };
    },
  },

  /** the kinds of room: add, rename, say whether it has beds, switch off (never deleted) */
  'host.kind.save': {
    check: keep,
    run: async (c: OpCtx, a: { id?: number; name: string; sleeps?: boolean; active?: boolean }) => {
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب الاسم', 'Write the name', 'Écrivez le nom'));
      if (await one(c.db, 'SELECT 1 FROM host_kind WHERE name = ? AND id <> ?', [name, a.id ?? -1])) throw new UserError(m('الاسم موجود', 'That name exists', 'Ce nom existe déjà'));
      const old = a.id ? await one<HostKind>(c.db, 'SELECT * FROM host_kind WHERE id = ?', [a.id]) : null;
      if (a.id && !old) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
      const sleeps = a.sleeps ? 1 : 0;
      const active = a.active === false ? 0 : 1;
      // a kind that rooms already use cannot change between beds and no beds (their beds and capacity would no longer mean the same)
      if (old && old.sleeps !== sleeps && (await one(c.db, 'SELECT 1 FROM host_room WHERE kind_id = ?', [old.id]))) throw new UserError(m('غرف تستعمل هذا النوع: لا يمكن تغيير «فيه أسرّة»', 'Rooms use this kind: "has beds" cannot be changed', 'Des chambres utilisent ce type : « a des lits » ne peut plus changer'));
      const sort = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(sort), 0) AS n FROM host_kind'))?.n ?? 0) + 1;
      await c.db.batch([
        a.id ? { sql: 'UPDATE host_kind SET name = ?, sleeps = ?, active = ? WHERE id = ?', params: [name, sleeps, active, a.id] } : { sql: 'INSERT INTO host_kind (name, sleeps, sort) VALUES (?,?,?)', params: [name, sleeps, sort] },
        auditStmt(c.who, a.id ? 'update' : 'add', 'host_kind', a.id ? String(a.id) : null, null, { name, sleeps, active }),
      ]);
      return { ok: true };
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
    check: pricedOnly,
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
    check: pricedOnly,
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
  const can = has(c.profile, 'hosting.view') || has(c.profile, 'hosting.book') || has(c.profile, 'hosting.prices') || has(c.profile, 'hosting.keep');
  const on = await sectionOn(c.db);
  if (!on) return can || has(c.profile, 'lists.manage') ? { on: false, review: 0, toEnter: 0, inventoryOn: await inventoryOn(c.db) } : null;
  if (!can) return null;
  const review = looksAtAll(c) ? ((await one<{ n: number }>(c.db, 'SELECT COUNT(*) AS n FROM host_booking WHERE review = 1 AND status <> ?', ['cancelled']))?.n ?? 0) : 0;
  const toEnter = priced(c)
    ? ((await one<{ n: number }>(c.db, "SELECT COUNT(*) AS n FROM host_pay WHERE status = 'suggested' AND receipt_no NOT IN (SELECT receipt FROM trx WHERE receipt IS NOT NULL AND type = 'Income')"))?.n ?? 0)
    : 0;
  return { on: true, review, toEnter, inventoryOn: await inventoryOn(c.db) };
}

/** the bookings made on a phone that wait for a look, with what each runs into (for the window shown at the connection) */
export async function hostReview(c: OpCtx) {
  const s = await snapshot(c);
  return toReview(s);
}
