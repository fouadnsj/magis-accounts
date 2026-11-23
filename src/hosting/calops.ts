// The MAGIS Calendar's operations (baseline 2.1, step 1): our programme and outside bookings, organisations with their
// persons, dates moved or cancelled, holds, spaces closed for repairs, closed periods, the whole centre, the free tick and
// the price history, cancelling with a part kept, the lists, and the spaces from the Excel file. Rules: calendar.ts.
// The 0.12 hosting operations (ops.ts) stay as they are until the new screens replace them.
import { nowIso, one, type Stmt } from '../db/db';
import { auditStmt, UserError } from '../db/repo';
import { m, type Msg } from '../i18n';
import type { OpCtx } from '../ops';
import { addDays, isDay, nextCode, type Currency, type HostAlloc, type HostBuilding, type HostEquip, type HostLine, type HostNeed, type HostPay } from './host';
import {
  calRights, cancelMoney, decide, forViewer, isHour, mayChange, occurrences, priceSign, readOrgsSheet, readSpacesSheet, received, seesPrices, spaceProblem, warningsOf, checkCal, clashesOf,
  HOLD_DAYS, type CalActivityKind, type CalBooking, type CalCategory, type CalData, type CalDate, type CalKind, type CalOrg, type CalOrgKind, type CalPerson, type CalRights,
  type CalSpace, type CancelMoney, type ClosedPeriod, type Clash, type Origin, type PriceHist, type Probe, type SpaceClosed, type World,
} from './calendar';
import { HOST_OPS } from './ops';

const err = (ar: string, en: string, fr: string) => new UserError(m(ar, en, fr));
const refuse = () => err('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non autorisé pour cet utilisateur');
const rightsOf = (c: OpCtx) => calRights(c.profile.perms);
const need = (k: keyof CalRights) => (c: OpCtx) => { if (!rightsOf(c)[k]) throw refuse(); };
const anyChange = (c: OpCtx) => { const r = rightsOf(c); if (!r.programme && !r.outside && !r.whole) throw refuse(); };

const txt = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim());
const money = (x: unknown) => (x == null || x === '' ? null : Math.max(0, Math.round(Number(x) * 100) / 100));
const whole = (x: unknown) => Math.max(0, Math.floor(Number(x) || 0));
const cur = (x: unknown): Currency => (x === 'SYP' ? 'SYP' : 'USD');
const today = () => nowIso().slice(0, 10);
const maxId = async (c: OpCtx, table: string) => ((await one<{ n: number }>(c.db, `SELECT COALESCE(MAX(id), 0) AS n FROM ${table}`))?.n ?? 0);
const nextSort = async (c: OpCtx, table: string) => ((await one<{ n: number }>(c.db, `SELECT COALESCE(MAX(sort), 0) AS n FROM ${table}`))?.n ?? 0) + 1;
const colorOk = (x: unknown) => (x == null || x === '' ? null : /^#[0-9a-fA-F]{6}$/.test(String(x)) ? String(x).toLowerCase() : (() => { throw err('لون غير صحيح', 'The colour is not valid', 'Couleur invalide'); })());

// ------------------------------------------------------------------ reading

async function equipOf(c: OpCtx): Promise<HostEquip[]> {
  return c.db.query<HostEquip>("SELECT e.*, COALESCE((SELECT SUM(i.qty) FROM inv_item i WHERE lower(trim(i.name)) = lower(trim(e.name)) AND i.status = 'in_use' AND i.condition = 'good'), 0) AS total FROM host_equip e ORDER BY e.sort, e.name");
}

/** everything the calendar holds, before it is cut to what this person may see */
export async function loadCalAll(c: OpCtx): Promise<CalData> {
  const q = <T>(sql: string) => c.db.query<T>(sql);
  return {
    areas: await q<HostBuilding>('SELECT * FROM host_building ORDER BY sort, name'),
    spaces: await q<CalSpace>('SELECT * FROM host_room ORDER BY building_id, sort, name'),
    kinds: await q<CalKind>('SELECT * FROM host_kind ORDER BY sort, name'),
    categories: await q<CalCategory>('SELECT * FROM cal_category ORDER BY sort, name'),
    activityKinds: await q<CalActivityKind>('SELECT * FROM cal_activity_kind ORDER BY sort, name'),
    orgKinds: await q<CalOrgKind>('SELECT * FROM cal_org_kind ORDER BY sort, name'),
    orgs: await q<CalOrg>('SELECT * FROM cal_org ORDER BY name'),
    persons: await q<CalPerson>('SELECT * FROM cal_org_person ORDER BY org_id, sort, id'),
    bookings: await q<CalBooking>('SELECT * FROM host_booking ORDER BY from_day, id'),
    allocs: await q<HostAlloc>('SELECT * FROM host_alloc'),
    dates: await q<CalDate>('SELECT * FROM cal_date ORDER BY booking_id, day, id'),
    closed: await q<SpaceClosed>('SELECT * FROM cal_space_closed ORDER BY from_day, id'),
    periods: await q<ClosedPeriod>('SELECT * FROM cal_closed_period ORDER BY from_day, id'),
    equip: await equipOf(c),
    needs: await q<HostNeed>('SELECT * FROM host_need'),
    lines: await q<HostLine>('SELECT * FROM host_line ORDER BY id'),
    pays: await q<HostPay>('SELECT * FROM host_pay ORDER BY paid_on, id'),
    rights: rightsOf(c),
  };
}
export const loadCal = async (c: OpCtx) => forViewer(await loadCalAll(c));

async function world(c: OpCtx): Promise<World & { periods: ClosedPeriod[]; spacesFull: CalSpace[]; kinds: CalKind[]; equip: HostEquip[]; needs: HostNeed[] }> {
  return {
    bookings: await c.db.query<CalBooking>('SELECT * FROM host_booking'),
    allocs: await c.db.query<HostAlloc>('SELECT booking_id, room_id FROM host_alloc'),
    dates: await c.db.query<CalDate>('SELECT * FROM cal_date'),
    spaces: await c.db.query<CalSpace>('SELECT * FROM host_room'),
    closed: await c.db.query<SpaceClosed>('SELECT * FROM cal_space_closed'),
    periods: await c.db.query<ClosedPeriod>('SELECT * FROM cal_closed_period'),
    spacesFull: await c.db.query<CalSpace>('SELECT * FROM host_room'),
    kinds: await c.db.query<CalKind>('SELECT * FROM host_kind'),
    equip: await equipOf(c),
    needs: await c.db.query<HostNeed>('SELECT * FROM host_need'),
  };
}

async function bookingOf(c: OpCtx, id: number) {
  const b = await one<CalBooking>(c.db, 'SELECT * FROM host_booking WHERE id = ?', [Number(id)]);
  if (!b) throw err('الحجز غير موجود', 'Booking not found', 'Réservation introuvable');
  return b;
}

/** a clash, told in words: the date, the space and what holds it */
async function clashList(c: OpCtx, cs: Clash[]) {
  const names = new Map((await c.db.query<{ id: number; group_name: string; private: number }>('SELECT id, group_name, private FROM host_booking')).map((b) => [b.id, b]));
  const spaces = new Map((await c.db.query<{ id: number; name: string }>('SELECT id, name FROM host_room')).map((s) => [s.id, s.name]));
  const contacts = rightsOf(c).contacts;
  return cs.map((x) => { const o = names.get(x.with); return { day: x.day, space_id: x.space_id, space: spaces.get(x.space_id) ?? '', with: x.with, name: o ? (o.private && !contacts ? 'Reserved · محجوز' : o.group_name) : '' }; });
}

// ------------------------------------------------------------------ saving a booking

export interface CalSaveInput {
  id?: number;
  origin: Origin;
  /** an outside booking: a hall booking ('event') or a guest stay ('stay'); our activities are always 'event' */
  kind?: 'stay' | 'event';
  /** our activity: its title; an outside booking with no organisation (0.12): the name of the group */
  title?: string;
  subject?: string | null;
  leader?: string | null;
  activity_kind_id?: number | null;
  org_id?: number | null;
  person_id?: number | null;
  people?: number;
  from_day: string;
  to_day?: string;
  /** every week on these weekdays (0 = Sunday … 6 = Saturday) between the two dates */
  repeat_days?: number[] | string | null;
  time_from?: string | null;
  time_to?: string | null;
  spaces?: number[];
  whole_centre?: boolean;
  /** our activity outside the centre: the place written, no space */
  outside_place?: string | null;
  status?: 'option' | 'confirmed';
  hold_until?: string | null;
  private?: boolean;
  note?: string | null;
  /** the "free" tick (Director, Coordinator): ticked unless false */
  free?: boolean;
  price_mode?: 'person' | 'group' | null;
  price_each?: boolean;
  rate?: number | null;
  currency?: Currency;
  lines?: { id?: number; service_id?: number | null; label?: string; qty?: number; amount?: number; currency?: Currency }[];
  needs?: { equip_id: number; qty: number }[];
  /** save even with the warnings (Sunday, closed period, capacity, equipment) */
  force?: boolean;
  /** a series where some dates are taken: save it without those dates */
  without_taken?: boolean;
}

function why(code: string): UserError {
  const t: Record<string, Msg> = {
    title: m('اكتب عنوان النشاط', 'Write the title of the activity', 'Écrivez le titre de l’activité'),
    name: m('اختر الجهة', 'Choose the organisation', 'Choisissez l’organisation'),
    dates: m('تواريخ غير صحيحة', 'The dates are not valid', 'Dates invalides'),
    order: m('التاريخ الأخير قبل الأول (أو الخروج ليس بعد الوصول)', 'The last day is before the first (or the leaving day is not after the arrival)', 'Le dernier jour est avant le premier (ou le départ n’est pas après l’arrivée)'),
    ours_stay: m('نشاطاتنا ليست إقامة', 'Our activities are not guest stays', 'Nos activités ne sont pas des séjours'),
    whole_ours: m('حجز المركز كله لنشاط من نشاطاتنا فقط', 'The whole centre is booked only for one of our activities', 'Tout le centre se réserve seulement pour une de nos activités'),
    place_ours: m('خارج المركز: لنشاطاتنا فقط', 'Outside the centre: only for our activities', 'Hors du centre : seulement pour nos activités'),
    stay_hours: m('الإقامة لها أيام وليس ساعات، ولا تتكرر', 'A stay has days, no hours, and does not repeat', 'Un séjour a des jours, pas d’heures, et ne se répète pas'),
    long: m('المدة طويلة جداً', 'Too long', 'Trop long'),
    time: m('الساعة غير صحيحة (مثال 16:00)', 'The hour is not valid (e.g. 16:00)', 'L’heure n’est pas valide (ex. 16:00)'),
    hours: m('ساعة النهاية قبل ساعة البداية', 'The end is before the start', 'La fin est avant le début'),
    repeat: m('لا يوجد أي يوم من الأيام المختارة بين التاريخين', 'None of the chosen weekdays falls between the two dates', 'Aucun des jours choisis ne tombe entre les deux dates'),
    people: m('عدد الأشخاص غير صحيح', 'The number of people is not valid', 'Nombre de personnes invalide'),
    space: m('اختر مكاناً واحداً على الأقل', 'Choose at least one space', 'Choisissez au moins un espace'),
    activity_kind: m('اختر نوع النشاط', 'Choose the kind of activity', 'Choisissez le type d’activité'),
  };
  return new UserError(t[code] ?? t.dates);
}
const spaceWhy = (code: string, name: string) => code === 'not_bookable'
  ? err(`«${name}» لا يُحجز (يظهر في الجرد فقط)`, `"${name}" cannot be booked (it is only in the inventory)`, `« ${name} » ne se réserve pas (seulement dans l’inventaire)`)
  : code === 'not_rentable'
  ? err(`«${name}» لنشاطاتنا فقط (غير قابل للتأجير)`, `"${name}" is for our activities only (not rentable)`, `« ${name} » est pour nos activités seulement (pas à louer)`)
  : code === 'not_bedroom'
    ? err(`«${name}» ليست غرفة نوم: الإقامة في غرف النوم فقط`, `"${name}" is not a bedroom: a stay is only in bedrooms`, `« ${name} » n’est pas une chambre : un séjour seulement dans les chambres`)
    : err('مكان غير موجود أو متوقف', 'A space is missing or switched off', 'Un espace est introuvable ou désactivé');

const repeatOf = (x: CalSaveInput['repeat_days']) => {
  const xs = (Array.isArray(x) ? x : typeof x === 'string' && x ? x.split(',') : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return xs.length ? [...new Set(xs)].sort((p, q) => p - q).join(',') : null;
};

async function saveBooking(c: OpCtx, a: CalSaveInput) {
  const r = rightsOf(c);
  const old = a.id ? await bookingOf(c, a.id) : null;
  if (old?.status === 'cancelled') throw err('الحجز ملغى؛ أعده «للتأكيد» أولاً', 'The booking is cancelled: put it back to "to confirm" first', 'Réservation annulée : remettez-la d’abord « à confirmer »');
  const origin: Origin = a.origin === 'ours' ? 'ours' : 'outside';
  const wholeC = origin === 'ours' && !!a.whole_centre;
  const place = origin === 'ours' && !wholeC ? txt(a.outside_place) : null;
  const kind: 'stay' | 'event' = origin === 'outside' && a.kind === 'stay' ? 'stay' : 'event';
  if (!mayChange(r, { origin, whole_centre: wholeC ? 1 : 0 }) || (old && !mayChange(r, old))) throw refuse();

  // who: our activity (kind, title, leader) or an organisation and the person for this booking (the phone comes by itself)
  let groupName = txt(a.title) ?? '';
  let orgId: number | null = null, personId: number | null = null, contact: string | null = old?.contact ?? null, phone: string | null = old?.phone ?? null;
  if (origin === 'outside') {
    if (a.org_id != null) {
      const org = await one<CalOrg>(c.db, 'SELECT * FROM cal_org WHERE id = ?', [Number(a.org_id)]);
      if (!org) throw err('الجهة غير موجودة', 'Organisation not found', 'Organisation introuvable');
      orgId = org.id;
      groupName = org.name;
      if (a.person_id != null) {
        const p = await one<CalPerson>(c.db, 'SELECT * FROM cal_org_person WHERE id = ? AND org_id = ?', [Number(a.person_id), org.id]);
        if (!p) throw err('هذا الشخص ليس من هذه الجهة', 'That person is not of this organisation', 'Cette personne n’est pas de cette organisation');
        personId = p.id; contact = p.name; phone = p.phone;
      } else { contact = null; phone = null; }
    } else if (!old || old.org_id != null) groupName = ''; // a new outside booking always has its organisation
  }
  const akind = origin === 'ours' && a.activity_kind_id != null ? await one<CalActivityKind>(c.db, 'SELECT * FROM cal_activity_kind WHERE id = ?', [Number(a.activity_kind_id)]) : null;
  if (origin === 'ours' && a.activity_kind_id != null && !akind) throw err('نوع النشاط غير موجود', 'That kind of activity does not exist', 'Ce type d’activité n’existe pas');

  const repeat = kind === 'event' ? repeatOf(a.repeat_days) : null;
  const tFrom = kind === 'event' && !wholeC ? txt(a.time_from) : null;
  const tTo = kind === 'event' && !wholeC ? txt(a.time_to) : null;
  const spaces = wholeC || place ? [] : [...new Set((Array.isArray(a.spaces) ? a.spaces : []).map(Number))];
  const fromDay = String(a.from_day ?? ''), toDay = String(a.to_day ?? a.from_day ?? '');
  const input = { origin, kind, group_name: groupName, from_day: fromDay, to_day: toDay, repeat_days: repeat, time_from: tFrom, time_to: tTo, people: whole(a.people), spaces, whole_centre: wholeC, outside_place: place, activity_kind_id: akind?.id ?? null, org_id: orgId };
  const bad = checkCal(input);
  if (bad) throw why(bad);
  const w = await world(c);
  const sp = spaceProblem(input, w.spacesFull, w.kinds);
  if (sp) throw spaceWhy(sp.code, w.spacesFull.find((s) => s.id === sp.space_id)?.name ?? String(sp.space_id));

  // status and hold: "to confirm" holds the space until a date (7 days by default)
  let status = old?.status ?? 'option';
  if (a.status === 'confirmed' || a.status === 'option') { if (!old || old.status === 'option' || old.status === 'confirmed') status = a.status; }
  const holdUntil = status === 'option' ? (a.hold_until && isDay(a.hold_until) ? a.hold_until : old?.hold_until ?? addDays(today(), HOLD_DAYS)) : old?.hold_until ?? null;

  // the never-twice rule
  const id = old?.id ?? (await maxId(c, 'host_booking')) + 1;
  const myDates = w.dates.filter((d) => d.booking_id === id);
  const probe: Probe = { id, kind, status, from_day: fromDay, to_day: toDay, repeat_days: repeat, time_from: tFrom, time_to: tTo, whole_centre: wholeC ? 1 : 0, outside_place: place, spaces, dates: myDates };
  const dec = decide(probe, w, !!a.without_taken);
  if (dec.kind === 'taken') {
    return { saved: false as const, refused: 'taken' as const, canSkip: dec.canSkip, dates: dec.dates, takenDays: dec.takenDays, clashes: await clashList(c, dec.clashes), closed: dec.shut };
  }
  const stamp = nowIso();
  const skipRows: CalDate[] = dec.skip.map((s, i) => ({ id: -1 - i, booking_id: id, day: s.day, action: 'cancel', to_day: null, time_from: null, time_to: null, reason: s.why, taken: 1, undone: 0, who: c.who, at: stamp }));

  // the equipment asked for (from the list taken from the inventory)
  const wants: { equip_id: number; qty: number }[] = [];
  for (const n of Array.isArray(a.needs) ? a.needs : []) {
    const e = w.equip.find((x) => x.id === Number(n.equip_id));
    if (!e) throw err('تجهيز غير موجود في القائمة', 'That equipment is not on the list', 'Cet équipement n’est pas dans la liste');
    const qty = whole(n.qty);
    if (qty >= 1 && !wants.some((x) => x.equip_id === e.id)) wants.push({ equip_id: e.id, qty });
  }
  const warnings = warningsOf({ ...probe, dates: [...myDates, ...skipRows], people: input.people, origin }, wants, w);
  if (warnings.length && !a.force) return { saved: false as const, refused: 'warnings' as const, warnings, skip: dec.skip };

  // the price: the "free" tick (ticked by default) for the Director and the Coordinator; Reception's bookings: "price not set"
  const priced = r.prices;
  let priceState = old?.price_state ?? null, mode = old?.price_mode ?? null, each = old?.price_each ?? 0, rate = old?.rate ?? null, currency: Currency = old?.currency ?? 'USD';
  if (origin === 'ours') { priceState = null; mode = null; each = 0; rate = null; }
  else if (priced) {
    if (a.free === false) {
      priceState = 'priced';
      mode = a.price_mode === 'person' ? 'person' : 'group';
      each = mode === 'group' && a.price_each && repeat ? 1 : 0;
      rate = money(a.rate);
      currency = cur(a.currency);
      if (rate == null) throw err('اكتب السعر أو علّم «مجاني»', 'Write the price, or tick "free"', 'Écrivez le prix ou cochez « gratuit »');
    } else { priceState = 'free'; mode = null; each = 0; rate = null; }
  } else if (!old || old.origin === 'ours') { priceState = 'unset'; mode = null; each = 0; rate = null; }

  // the services: amounts only from the Director or the Coordinator; the others keep the amount a line already had
  const had = new Map((await c.db.query<HostLine>('SELECT * FROM host_line WHERE booking_id = ?', [id])).map((l) => [l.id, l]));
  const services = new Map((await c.db.query<{ id: number; name: string }>('SELECT id, name FROM host_service')).map((s) => [s.id, s]));
  let nextLine = await maxId(c, 'host_line');
  const newLines: HostLine[] = [];
  for (const l of Array.isArray(a.lines) ? a.lines : []) {
    const sv = l.service_id != null ? services.get(Number(l.service_id)) : undefined;
    const label = txt(l.label) ?? sv?.name;
    if (!label) continue;
    const prev = l.id != null ? had.get(Number(l.id)) : undefined;
    newLines.push({ id: ++nextLine, booking_id: id, service_id: sv?.id ?? null, label, qty: Math.max(0, Number(l.qty) || 1), amount: priced ? money(l.amount) ?? 0 : prev?.amount ?? 0, currency: priced ? cur(l.currency ?? currency) : prev?.currency ?? currency });
  }

  const row = {
    origin, kind, status, group_name: groupName.trim(), contact, phone, people: input.people, from_day: fromDay, to_day: toDay, repeat_days: repeat, time_from: tFrom, time_to: tTo,
    price_mode: mode, rate, currency, note: txt(a.note), activity_kind_id: akind?.id ?? null, leader: origin === 'ours' ? txt(a.leader) : null, org_id: orgId ?? (origin === 'outside' ? old?.org_id ?? null : null),
    person_id: personId, subject: origin === 'outside' ? txt(a.subject) : null, private: a.private ? 1 : 0, whole_centre: wholeC ? 1 : 0, outside_place: place, hold_until: holdUntil,
    price_state: priceState, price_each: each,
  };
  const cols = Object.keys(row) as (keyof typeof row)[];
  const stmts: Stmt[] = [];
  if (old) {
    stmts.push({ sql: `UPDATE host_booking SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, params: [...cols.map((k) => row[k]), stamp, id] });
    stmts.push({ sql: 'DELETE FROM host_alloc WHERE booking_id = ?', params: [id] });
  } else {
    const code = nextCode((await c.db.query<{ code: string }>('SELECT code FROM host_booking')).map((x) => x.code), Number(fromDay.slice(0, 4)));
    stmts.push({ sql: `INSERT INTO host_booking (id, code, ${cols.join(', ')}, source, review, created_by, created_at) VALUES (${['?', '?', ...cols.map(() => '?'), '?', '?', '?', '?'].join(', ')})`, params: [id, code, ...cols.map((k) => row[k]), 'desk', 0, c.who, stamp] });
  }
  for (const s of spaces) stmts.push({ sql: 'INSERT INTO host_alloc (booking_id, room_id, beds) VALUES (?,?,NULL)', params: [id, s] });
  stmts.push({ sql: 'DELETE FROM host_line WHERE booking_id = ?', params: [id] });
  for (const l of newLines) stmts.push({ sql: 'INSERT INTO host_line (id, booking_id, service_id, label, qty, amount, currency) VALUES (?,?,?,?,?,?,?)', params: [l.id, id, l.service_id, l.label, l.qty, l.amount, l.currency] });
  stmts.push({ sql: 'DELETE FROM host_need WHERE booking_id = ?', params: [id] });
  for (const x of wants) stmts.push({ sql: 'INSERT INTO host_need (booking_id, equip_id, qty) VALUES (?,?,?)', params: [id, x.equip_id, x.qty] });
  // the dates left out because the space was taken (or closed): kept, with the reason, and listed
  for (const s of skipRows) stmts.push({ sql: 'INSERT INTO cal_date (booking_id, day, action, reason, taken, who, at) VALUES (?,?,?,?,?,?,?)', params: [id, s.day, 'cancel', s.reason, 1, c.who, stamp] });
  // every change of price is kept
  if (origin === 'outside') {
    const before = old ? priceSign(old, [...had.values()]) : null;
    const after = priceSign({ price_state: priceState, price_mode: mode, price_each: each, rate, currency }, newLines);
    if (before !== after) stmts.push({ sql: 'INSERT INTO cal_price_hist (booking_id, price_state, price_mode, price_each, rate, currency, lines, who, at) VALUES (?,?,?,?,?,?,?,?,?)', params: [id, priceState, mode, each, rate, currency, JSON.stringify(newLines.map((l) => ({ label: l.label, qty: l.qty, amount: l.amount, currency: l.currency }))), c.who, stamp] });
  }
  stmts.push(auditStmt(c.who, old ? 'update' : 'add', 'host_booking', String(id), old ? { name: old.group_name, from: old.from_day, to: old.to_day, status: old.status } : null, { name: row.group_name, origin, from: fromDay, to: toDay, repeat, hours: tFrom ? `${tFrom}-${tTo}` : null, spaces, whole: wholeC, place, status, private: row.private, left_out: dec.skip.map((s) => s.day) }));
  await c.db.batch(stmts);
  return { saved: true as const, id, warnings, skipped: dec.skip };
}

// ------------------------------------------------------------------ status, cancelling, the money kept

/** what changed between two clash lists: the clashes the change would bring that were not there before */
const fresh = (before: Clash[], after: Clash[]) => { const k = (x: Clash) => `${x.day}|${x.space_id}|${x.with}`; const had = new Set(before.map(k)); return after.filter((x) => !had.has(k(x))); };

function probeOf(b: CalBooking, w: World, dates?: CalDate[]): Probe {
  return { ...b, spaces: w.allocs.filter((a) => a.booking_id === b.id).map((a) => a.room_id), dates: dates ?? w.dates.filter((d) => d.booking_id === b.id) };
}

async function setStatus(c: OpCtx, a: { id: number; status: 'option' | 'confirmed' | 'arrived' | 'left'; hold_until?: string | null }) {
  const r = rightsOf(c);
  const b = await bookingOf(c, a.id);
  if (!['option', 'confirmed', 'arrived', 'left'].includes(a.status)) throw err('حالة غير معروفة', 'Unknown status', 'Statut inconnu');
  if (a.status === 'arrived' || a.status === 'left') {
    if (!r.arrive) throw refuse();
    if (b.kind !== 'stay') throw err('الوصول والمغادرة للإقامة فقط', 'Arrived and left are for guest stays only', 'Arrivé et parti : pour les séjours seulement');
    if (b.status === 'cancelled') throw err('الحجز ملغى', 'The booking is cancelled', 'La réservation est annulée');
  } else if (!mayChange(r, b)) throw refuse();
  // a cancelled booking put back "to confirm" holds its spaces again: it must not run into anything
  if (b.status === 'cancelled') {
    if (a.status !== 'option') throw err('الحجز ملغى؛ أعده «للتأكيد» أولاً', 'The booking is cancelled: put it back to "to confirm" first', 'Réservation annulée : remettez-la d’abord « à confirmer »');
    const w = await world(c);
    const { clashes, shut } = clashesOf({ ...probeOf(b, w), status: 'option' }, w);
    if (clashes.length || shut.length) return { ok: false as const, refused: 'taken' as const, clashes: await clashList(c, clashes), closed: shut };
  }
  const hold = a.status === 'option' ? (a.hold_until && isDay(a.hold_until) ? a.hold_until : b.status === 'cancelled' || !b.hold_until ? addDays(today(), HOLD_DAYS) : b.hold_until) : b.hold_until;
  await c.db.batch([
    { sql: 'UPDATE host_booking SET status = ?, hold_until = ?, cancel_reason = CASE WHEN ? = 1 THEN NULL ELSE cancel_reason END, updated_at = ? WHERE id = ?', params: [a.status, hold, b.status === 'cancelled' ? 1 : 0, nowIso(), b.id] },
    auditStmt(c.who, 'status', 'host_booking', String(b.id), { status: b.status, hold: b.hold_until }, { status: a.status, hold }),
  ]);
  return { ok: true as const };
}

async function cancelBooking(c: OpCtx, a: { id: number; reason: string; money?: CancelMoney | null; kept_usd?: number | null; kept_syp?: number | null }) {
  const r = rightsOf(c);
  const b = await bookingOf(c, a.id);
  if (!mayChange(r, b)) throw refuse();
  if (b.status === 'cancelled') throw err('الحجز ملغى من قبل', 'The booking is already cancelled', 'La réservation est déjà annulée');
  const reason = txt(a.reason);
  if (!reason) throw err('اكتب سبب الإلغاء', 'Write the reason for cancelling', 'Écrivez la raison de l’annulation');
  const got = received(await c.db.query<HostPay>('SELECT * FROM host_pay WHERE booking_id = ?', [b.id]));
  // money received: keep all, give all back or keep a part — decided by the Director or the Coordinator, now or later
  let decision: { money: CancelMoney | null; usd: number | null; syp: number | null } = { money: null, usd: null, syp: null };
  if ((got.USD > 0 || got.SYP > 0) && a.money) {
    if (!r.money) throw refuse();
    decision = keptOf(got, a.money, a.kept_usd, a.kept_syp);
  }
  const stamp = nowIso();
  await c.db.batch([
    { sql: 'UPDATE host_booking SET status = ?, cancel_reason = ?, cancel_money = ?, kept_usd = ?, kept_syp = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ? WHERE id = ?', params: ['cancelled', reason, decision.money, decision.usd, decision.syp, c.who, stamp, stamp, b.id] },
    auditStmt(c.who, 'cancel', 'host_booking', String(b.id), { status: b.status }, { status: 'cancelled', reason, money: decision.money, kept_usd: decision.usd, kept_syp: decision.syp }),
  ]);
  return { ok: true as const, received: got, toDecide: (got.USD > 0 || got.SYP > 0) && !decision.money };
}

function keptOf(got: { USD: number; SYP: number }, choice: CancelMoney, usd?: number | null, syp?: number | null) {
  if (!['all', 'none', 'part'].includes(choice)) throw err('اختر: نحتفظ بالكل، نعيد الكل، أو نحتفظ بجزء', 'Choose: keep all, give all back, or keep a part', 'Choisissez : tout garder, tout rendre ou garder une part');
  const res = cancelMoney(got, choice, { USD: usd == null ? undefined : Number(usd), SYP: syp == null ? undefined : Number(syp) });
  if (res === 'no_part') throw err('اكتب المبلغ الذي نحتفظ به', 'Write the amount kept', 'Écrivez le montant gardé');
  if (res === 'too_much') throw err('المبلغ المحتفظ به أكبر مما قُبض', 'The amount kept is more than what was received', 'Le montant gardé dépasse ce qui a été reçu');
  return { money: choice, usd: res.kept.USD, syp: res.kept.SYP };
}

// ------------------------------------------------------------------ one date: moved, cancelled, put back

async function dateChange(c: OpCtx, a: { booking_id: number; day: string; action: 'cancel' | 'cancel_from' | 'move'; to_day?: string | null; time_from?: string | null; time_to?: string | null; reason?: string | null }) {
  const b = await bookingOf(c, a.booking_id);
  if (!mayChange(rightsOf(c), b)) throw refuse();
  if (b.status === 'cancelled') throw err('الحجز ملغى', 'The booking is cancelled', 'La réservation est annulée');
  if (b.kind !== 'event') throw err('الإقامة لا تُنقل يوماً بيوم: ألغها واحجز من جديد', 'A stay is not moved day by day: cancel it and make a new booking', 'Un séjour ne se déplace pas jour par jour : annulez-le et faites une nouvelle réservation');
  const reason = txt(a.reason);
  if (!reason) throw err('اكتب السبب', 'Write the reason', 'Écrivez la raison');
  const w = await world(c);
  const mine = w.dates.filter((d) => d.booking_id === b.id);
  const occ = occurrences(b, mine);
  if (!occ.some((o) => o.day === a.day && !o.moved)) throw err('هذا التاريخ ليس من تواريخ هذا الحجز', 'That date is not one of this booking', 'Cette date n’est pas une date de cette réservation');
  let change: CalDate = { id: -1, booking_id: b.id, day: a.day, action: a.action, to_day: null, time_from: null, time_to: null, reason, taken: 0, undone: 0, who: c.who, at: nowIso() };
  if (a.action === 'move') {
    const toDay = a.to_day && isDay(a.to_day) ? a.to_day : a.day;
    const tf = txt(a.time_from) ?? b.time_from, tt = txt(a.time_to) ?? b.time_to;
    for (const h of [tf, tt]) if (h && !isHour(h)) throw why('time');
    if (tf && tt && tf >= tt) throw why('hours');
    if (toDay === a.day && tf === b.time_from && tt === b.time_to) throw err('لم يتغير شيء', 'Nothing changed', 'Rien n’a changé');
    if (occ.some((o) => o.day === toDay && o.day !== a.day)) throw err('لهذا الحجز تاريخ في ذلك اليوم من قبل', 'This booking already has a date on that day', 'Cette réservation a déjà une date ce jour-là');
    change = { ...change, to_day: toDay, time_from: tf, time_to: tt };
    const p = probeOf(b, w, mine);
    const before = clashesOf(p, w), after = clashesOf({ ...p, dates: [...mine, change] }, w);
    const now = fresh(before.clashes, after.clashes), shut = after.shut.filter((s) => s.day === toDay);
    if (now.length || shut.length) return { ok: false as const, refused: 'taken' as const, clashes: await clashList(c, now), closed: shut };
  } else if (a.action === 'cancel_from' && a.day === b.from_day) throw err('هذا أول تاريخ: ألغِ الحجز كله', 'This is the first date: cancel the whole booking', 'C’est la première date : annulez toute la réservation');
  await c.db.batch([
    { sql: 'INSERT INTO cal_date (booking_id, day, action, to_day, time_from, time_to, reason, taken, who, at) VALUES (?,?,?,?,?,?,?,0,?,?)', params: [b.id, change.day, change.action, change.to_day, change.time_from, change.time_to, reason, c.who, change.at] },
    auditStmt(c.who, a.action, 'cal_date', String(b.id), null, { day: change.day, to: change.to_day, hours: change.time_from ? `${change.time_from}-${change.time_to}` : null, reason }),
  ]);
  return { ok: true as const };
}

async function dateUndo(c: OpCtx, a: { id: number }) {
  const d = await one<CalDate>(c.db, 'SELECT * FROM cal_date WHERE id = ?', [Number(a.id)]);
  if (!d || d.undone) throw err('غير موجود', 'Not found', 'Introuvable');
  const b = await bookingOf(c, d.booking_id);
  if (!mayChange(rightsOf(c), b)) throw refuse();
  // the date comes back: it must not run into anything held since
  const w = await world(c);
  const mine = w.dates.filter((x) => x.booking_id === b.id);
  const p = probeOf(b, w, mine);
  const before = clashesOf(p, w), after = clashesOf({ ...p, dates: mine.map((x) => (x.id === d.id ? { ...x, undone: 1 } : x)) }, w);
  const now = fresh(before.clashes, after.clashes);
  const shutKeys = new Set(before.shut.map((s) => `${s.day}|${s.space_id}`));
  const shut = after.shut.filter((s) => !shutKeys.has(`${s.day}|${s.space_id}`));
  if (now.length || shut.length) return { ok: false as const, refused: 'taken' as const, clashes: await clashList(c, now), closed: shut };
  await c.db.batch([
    { sql: 'UPDATE cal_date SET undone = 1 WHERE id = ?', params: [d.id] },
    auditStmt(c.who, 'undo', 'cal_date', String(b.id), { day: d.day, action: d.action, to: d.to_day }, null),
  ]);
  return { ok: true as const };
}

// ------------------------------------------------------------------ spaces closed for repairs, closed periods

async function closeSpace(c: OpCtx, a: { room_id: number; from_day: string; to_day: string; reason: string; force?: boolean }) {
  const s = await one<CalSpace>(c.db, 'SELECT * FROM host_room WHERE id = ?', [Number(a.room_id)]);
  if (!s) throw err('المكان غير موجود', 'Space not found', 'Espace introuvable');
  if (!isDay(a.from_day) || !isDay(a.to_day) || a.to_day < a.from_day) throw why('dates');
  const reason = txt(a.reason);
  if (!reason) throw err('اكتب السبب', 'Write the reason', 'Écrivez la raison');
  // the bookings already there in those days are listed; the Director decides (they are not moved by the program)
  const w = await world(c);
  const hit: { id: number; name: string; days: string[] }[] = [];
  for (const b of w.bookings) {
    if (b.status === 'cancelled') continue;
    const days = occurrences(b, w.dates).filter((o) => o.day >= a.from_day && o.day <= a.to_day && (b.whole_centre || w.allocs.some((x) => x.booking_id === b.id && x.room_id === s.id))).map((o) => o.day);
    if (days.length) hit.push({ id: b.id, name: b.group_name, days });
  }
  if (hit.length && !a.force) return { saved: false as const, bookings: hit };
  await c.db.batch([
    { sql: 'INSERT INTO cal_space_closed (room_id, from_day, to_day, reason, who, at) VALUES (?,?,?,?,?,?)', params: [s.id, a.from_day, a.to_day, reason, c.who, nowIso()] },
    auditStmt(c.who, 'close', 'cal_space_closed', String(s.id), null, { space: s.name, from: a.from_day, to: a.to_day, reason, bookings: hit.map((h) => h.id) }),
  ]);
  return { saved: true as const, bookings: hit };
}

/** a closing or a closed period is never deleted: it is cancelled with a reason */
const cancelRow = (table: 'cal_space_closed' | 'cal_closed_period') => async (c: OpCtx, a: { id: number; reason: string }) => {
  const row = await one<{ id: number; cancelled: number }>(c.db, `SELECT id, cancelled FROM ${table} WHERE id = ?`, [Number(a.id)]);
  if (!row || row.cancelled) throw err('غير موجود', 'Not found', 'Introuvable');
  const reason = txt(a.reason);
  if (!reason) throw err('اكتب السبب', 'Write the reason', 'Écrivez la raison');
  await c.db.batch([{ sql: `UPDATE ${table} SET cancelled = 1, cancel_reason = ? WHERE id = ?`, params: [reason, row.id] }, auditStmt(c.who, 'cancel', table, String(row.id), null, { reason })]);
  return { ok: true as const };
};

async function savePeriod(c: OpCtx, a: { id?: number; name: string; from_day: string; to_day: string }) {
  const name = txt(a.name);
  if (!name) throw err('اكتب الاسم', 'Write the name', 'Écrivez le nom');
  if (!isDay(a.from_day) || !isDay(a.to_day) || a.to_day < a.from_day) throw why('dates');
  if (a.id && !(await one(c.db, 'SELECT 1 FROM cal_closed_period WHERE id = ? AND cancelled = 0', [a.id]))) throw err('غير موجود', 'Not found', 'Introuvable');
  await c.db.batch([
    a.id ? { sql: 'UPDATE cal_closed_period SET name = ?, from_day = ?, to_day = ? WHERE id = ?', params: [name, a.from_day, a.to_day, a.id] } : { sql: 'INSERT INTO cal_closed_period (name, from_day, to_day, who, at) VALUES (?,?,?,?,?)', params: [name, a.from_day, a.to_day, c.who, nowIso()] },
    auditStmt(c.who, a.id ? 'update' : 'add', 'cal_closed_period', a.id ? String(a.id) : null, null, { name, from: a.from_day, to: a.to_day }),
  ]);
  return { ok: true as const };
}

// ------------------------------------------------------------------ organisations and their persons

async function saveOrg(c: OpCtx, a: { id?: number; name: string; kind_id?: number | null; note?: string | null; active?: boolean; persons?: { id?: number; name: string; phone?: string | null; active?: boolean }[] }) {
  const name = txt(a.name);
  if (!name) throw err('اكتب اسم الجهة', 'Write the name of the organisation', 'Écrivez le nom de l’organisation');
  if (await one(c.db, 'SELECT 1 FROM cal_org WHERE name = ? AND id <> ?', [name, a.id ?? -1])) throw err('هذه الجهة مسجّلة من قبل', 'That organisation is already registered', 'Cette organisation est déjà inscrite');
  if (a.kind_id != null && !(await one(c.db, 'SELECT 1 FROM cal_org_kind WHERE id = ?', [Number(a.kind_id)]))) throw err('نوع غير موجود', 'That kind does not exist', 'Ce type n’existe pas');
  const old = a.id ? await one<CalOrg>(c.db, 'SELECT * FROM cal_org WHERE id = ?', [a.id]) : null;
  if (a.id && !old) throw err('الجهة غير موجودة', 'Organisation not found', 'Organisation introuvable');
  const id = old?.id ?? (await maxId(c, 'cal_org')) + 1;
  const stamp = nowIso();
  const stmts: Stmt[] = [old
    ? { sql: 'UPDATE cal_org SET name = ?, kind_id = ?, note = ?, active = ?, updated_at = ? WHERE id = ?', params: [name, a.kind_id ?? null, txt(a.note), a.active === false ? 0 : 1, stamp, id] }
    : { sql: 'INSERT INTO cal_org (id, name, kind_id, note, active, created_by, created_at) VALUES (?,?,?,?,?,?,?)', params: [id, name, a.kind_id ?? null, txt(a.note), a.active === false ? 0 : 1, c.who, stamp] }];
  // the persons in charge: added or changed; a person is never removed, only switched off
  const had = new Map((await c.db.query<CalPerson>('SELECT * FROM cal_org_person WHERE org_id = ?', [id])).map((p) => [p.id, p]));
  let sort = had.size;
  for (const p of Array.isArray(a.persons) ? a.persons : []) {
    const pn = txt(p.name);
    if (p.id != null) {
      if (!had.has(Number(p.id))) throw err('هذا الشخص ليس من هذه الجهة', 'That person is not of this organisation', 'Cette personne n’est pas de cette organisation');
      if (!pn) throw err('اكتب اسم الشخص', 'Write the name of the person', 'Écrivez le nom de la personne');
      stmts.push({ sql: 'UPDATE cal_org_person SET name = ?, phone = ?, active = ? WHERE id = ?', params: [pn, txt(p.phone), p.active === false ? 0 : 1, Number(p.id)] });
    } else if (pn) stmts.push({ sql: 'INSERT INTO cal_org_person (org_id, name, phone, active, sort) VALUES (?,?,?,?,?)', params: [id, pn, txt(p.phone), p.active === false ? 0 : 1, ++sort] });
  }
  stmts.push(auditStmt(c.who, old ? 'update' : 'add', 'cal_org', String(id), old ? { name: old.name } : null, { name, kind: a.kind_id ?? null, persons: (a.persons ?? []).map((p) => p.name) }));
  await c.db.batch(stmts);
  return { id };
}

// ------------------------------------------------------------------ lists (editable in the program)

const listSave = (table: 'cal_category' | 'cal_activity_kind' | 'cal_org_kind', withColor = false) => async (c: OpCtx, a: { id?: number; name: string; active?: boolean; color?: string | null }) => {
  const name = txt(a.name);
  if (!name) throw err('اكتب الاسم', 'Write the name', 'Écrivez le nom');
  if (await one(c.db, `SELECT 1 FROM ${table} WHERE name = ? AND id <> ?`, [name, a.id ?? -1])) throw err('الاسم موجود', 'That name exists', 'Ce nom existe déjà');
  if (a.id && !(await one(c.db, `SELECT 1 FROM ${table} WHERE id = ?`, [a.id]))) throw err('غير موجود', 'Not found', 'Introuvable');
  const active = a.active === false ? 0 : 1;
  const color = withColor ? colorOk(a.color) : null;
  const sort = await nextSort(c, table);
  const stmt: Stmt = a.id
    ? withColor ? { sql: `UPDATE ${table} SET name = ?, active = ?, color = COALESCE(?, color) WHERE id = ?`, params: [name, active, color, a.id] } : { sql: `UPDATE ${table} SET name = ?, active = ? WHERE id = ?`, params: [name, active, a.id] }
    : withColor ? { sql: `INSERT INTO ${table} (name, color, sort) VALUES (?,?,?)`, params: [name, color, sort] } : { sql: `INSERT INTO ${table} (name, sort) VALUES (?,?)`, params: [name, sort] };
  await c.db.batch([stmt, auditStmt(c.who, a.id ? 'update' : 'add', table, a.id ? String(a.id) : null, null, { name, active, color })]);
  return { id: a.id ?? (await one<{ id: number }>(c.db, `SELECT id FROM ${table} WHERE name = ?`, [name]))?.id ?? null };
};

/** a space: the 0.12 room (it stays a place of the inventory) with its floor, rentable or ours only, what is always in it, a note, a category */
async function saveSpace(c: OpCtx, a: Parameters<(typeof HOST_OPS)['host.room.save']['run']>[1] & { floor?: string | null; rentable?: boolean; bookable?: boolean; fixed?: string | null; note?: string | null; category_id?: number | null }) {
  // a space that holds bookings today or later stays bookable until they are moved or cancelled
  if (a.id != null && a.bookable === false) {
    const w = await world(c);
    const day = today();
    const held = w.bookings.filter((b) => b.status !== 'cancelled' && !b.whole_centre && w.allocs.some((x) => x.booking_id === b.id && x.room_id === Number(a.id)) && occurrences(b, w.dates).some((o) => o.day >= day));
    if (held.length) throw err(`في هذا المكان حجوزات قادمة (${held.map((b) => b.group_name).join('، ')}): انقلها أو ألغها أولاً`, `This space has bookings to come (${held.map((b) => b.group_name).join(', ')}): move or cancel them first`, `Cet espace a des réservations à venir (${held.map((b) => b.group_name).join(', ')}) : déplacez-les ou annulez-les d’abord`);
  }
  if (a.category_id != null && !(await one(c.db, 'SELECT 1 FROM cal_category WHERE id = ?', [Number(a.category_id)]))) throw err('الفئة غير موجودة', 'That category does not exist', 'Cette catégorie n’existe pas');
  const { id } = await HOST_OPS['host.room.save'].run(c, a);
  if (id == null) throw err('غير موجود', 'Not found', 'Introuvable');
  await c.db.batch([
    { sql: 'UPDATE host_room SET floor = ?, rentable = ?, bookable = ?, fixed = ?, note = ?, category_id = ? WHERE id = ?', params: [txt(a.floor), a.rentable === false ? 0 : 1, a.bookable === false ? 0 : 1, txt(a.fixed), txt(a.note), a.category_id ?? null, id] },
    auditStmt(c.who, 'update', 'host_room', String(id), null, { floor: txt(a.floor), rentable: a.rentable !== false, bookable: a.bookable !== false, fixed: txt(a.fixed), category: a.category_id ?? null }),
  ]);
  return { id };
}

/** a kind of space, with its category (the quick view it belongs to) */
async function saveKind(c: OpCtx, a: { id?: number; name: string; sleeps?: boolean; active?: boolean; category_id?: number | null }) {
  if (a.category_id != null && !(await one(c.db, 'SELECT 1 FROM cal_category WHERE id = ?', [Number(a.category_id)]))) throw err('الفئة غير موجودة', 'That category does not exist', 'Cette catégorie n’existe pas');
  await HOST_OPS['host.kind.save'].run(c, a);
  const k = await one<{ id: number }>(c.db, 'SELECT id FROM host_kind WHERE name = ?', [String(a.name).trim()]);
  const cat = a.category_id ?? (a.sleeps ? 2 : 1);
  if (k) await c.db.batch([{ sql: 'UPDATE host_kind SET category_id = ? WHERE id = ?', params: [cat, k.id] }]);
  return { id: k?.id ?? null };
}

// ------------------------------------------------------------------ the spaces and organisations from the Excel file

/** the sheet "Rooms · الغرف": dry = only say what would be added (nothing is changed); the spaces already there are left alone */
async function importSpaces(c: OpCtx, a: { rows: unknown[][]; dry?: boolean }) {
  const kinds = await c.db.query<CalKind>('SELECT * FROM host_kind WHERE active = 1');
  const { spaces, problems } = readSpacesSheet(Array.isArray(a.rows) ? a.rows : [], kinds);
  const areas = await c.db.query<HostBuilding>('SELECT * FROM host_building');
  const rooms = await c.db.query<CalSpace>('SELECT * FROM host_room');
  const same = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();
  const newAreas = [...new Set(spaces.map((s) => s.area))].filter((n) => !areas.some((b) => same(b.name, n)));
  const there = spaces.filter((s) => { const b = areas.find((x) => same(x.name, s.area)); return b && rooms.some((r) => r.building_id === b.id && same(r.name, s.name)); });
  const add = spaces.filter((s) => !there.includes(s));
  if (!a.dry) {
    for (const n of newAreas) await HOST_OPS['host.building.save'].run(c, { name: n });
    const nowAreas = await c.db.query<HostBuilding>('SELECT * FROM host_building');
    for (const s of add) {
      const b = nowAreas.find((x) => same(x.name, s.area))!;
      const kind = kinds.find((k) => k.id === s.kind_id)!;
      await saveSpace(c, { building_id: b.id, name: s.name, kind_id: kind.id, beds: s.beds, capacity: s.capacity, floor: s.floor, rentable: s.rentable, fixed: s.fixed, note: s.note });
    }
  }
  return { areas: newAreas, add, there: there.map((s) => ({ row: s.row, area: s.area, name: s.name })), problems, done: !a.dry };
}

/** the sheet "Organisations · الجهات": the organisations already registered are left alone */
async function importOrgs(c: OpCtx, a: { rows: unknown[][]; dry?: boolean }) {
  const kinds = await c.db.query<CalOrgKind>('SELECT * FROM cal_org_kind WHERE active = 1');
  const { orgs, problems } = readOrgsSheet(Array.isArray(a.rows) ? a.rows : [], kinds);
  const had = await c.db.query<CalOrg>('SELECT * FROM cal_org');
  const there = orgs.filter((o) => had.some((h) => h.name.trim().toLowerCase() === o.name.toLowerCase()));
  const add = orgs.filter((o) => !there.includes(o));
  if (!a.dry) for (const o of add) await saveOrg(c, { name: o.name, kind_id: o.kind_id, note: o.note, persons: o.persons });
  return { add, there: there.map((o) => ({ row: o.row, name: o.name })), problems, done: !a.dry };
}

// ------------------------------------------------------------------ the history (Director)

const HIST_TABLES = ['host_booking', 'cal_date', 'cal_org', 'cal_space_closed', 'cal_closed_period', 'host_room', 'host_building', 'host_kind', 'cal_category', 'cal_activity_kind', 'cal_org_kind'];
async function history(c: OpCtx, a: { booking_id?: number } = {}) {
  if (a?.booking_id != null) {
    const id = String(Number(a.booking_id));
    return {
      changes: await c.db.query<{ at: string; who: string; action: string; tbl: string; before: string | null; after: string | null }>("SELECT at, who, action, tbl, before, after FROM audit_log WHERE tbl IN ('host_booking', 'cal_date') AND row_id = ? ORDER BY id", [id]),
      prices: await c.db.query<PriceHist>('SELECT * FROM cal_price_hist WHERE booking_id = ? ORDER BY id', [Number(id)]),
      dates: await c.db.query<CalDate>('SELECT * FROM cal_date WHERE booking_id = ? ORDER BY id', [Number(id)]),
    };
  }
  return { changes: await c.db.query(`SELECT at, who, action, tbl, row_id, before, after FROM audit_log WHERE tbl IN (${HIST_TABLES.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 500`, HIST_TABLES), prices: [], dates: [] };
}

// ------------------------------------------------------------------ the operations

export const CAL_OPS = {
  'cal.get': { check: need('view'), run: (c: OpCtx) => loadCal(c) },
  'cal.history': { check: need('history'), run: (c: OpCtx, a: { booking_id?: number }) => history(c, a) },

  'cal.booking.save': { check: anyChange, run: (c: OpCtx, a: CalSaveInput) => saveBooking(c, a) },
  /** to confirm (with the date held) → confirmed; a guest stay: arrived → left; a cancelled booking put back "to confirm" */
  'cal.booking.status': { check: (c: OpCtx) => { const r = rightsOf(c); if (!r.programme && !r.outside && !r.whole && !r.arrive) throw refuse(); }, run: (c: OpCtx, a: Parameters<typeof setStatus>[1]) => setStatus(c, a) },
  /** cancelled with a reason, never deleted; with money received: keep all, give all back, or keep a part */
  'cal.booking.cancel': { check: anyChange, run: (c: OpCtx, a: Parameters<typeof cancelBooking>[1]) => cancelBooking(c, a) },
  /** the money of a cancelled booking decided later (Director, Coordinator) */
  'cal.booking.money': {
    check: need('money'),
    run: async (c: OpCtx, a: { id: number; money: CancelMoney; kept_usd?: number | null; kept_syp?: number | null }) => {
      const b = await bookingOf(c, a.id);
      if (b.status !== 'cancelled') throw err('الحجز غير ملغى', 'The booking is not cancelled', 'La réservation n’est pas annulée');
      const got = received(await c.db.query<HostPay>('SELECT * FROM host_pay WHERE booking_id = ?', [b.id]));
      const d = keptOf(got, a.money, a.kept_usd, a.kept_syp);
      await c.db.batch([
        { sql: 'UPDATE host_booking SET cancel_money = ?, kept_usd = ?, kept_syp = ?, updated_at = ? WHERE id = ?', params: [d.money, d.usd, d.syp, nowIso(), b.id] },
        auditStmt(c.who, 'money', 'host_booking', String(b.id), { money: b.cancel_money, kept_usd: b.kept_usd, kept_syp: b.kept_syp }, { money: d.money, kept_usd: d.usd, kept_syp: d.syp }),
      ]);
      return { ok: true as const, received: got, kept: { USD: d.usd, SYP: d.syp } };
    },
  },
  'cal.date.change': { check: anyChange, run: (c: OpCtx, a: Parameters<typeof dateChange>[1]) => dateChange(c, a) },
  'cal.date.undo': { check: anyChange, run: (c: OpCtx, a: { id: number }) => dateUndo(c, a) },

  'cal.org.save': { check: need('orgs'), run: (c: OpCtx, a: Parameters<typeof saveOrg>[1]) => saveOrg(c, a) },

  'cal.space.close': { check: need('whole'), run: (c: OpCtx, a: Parameters<typeof closeSpace>[1]) => closeSpace(c, a) },
  'cal.space.reopen': { check: need('whole'), run: cancelRow('cal_space_closed') },
  'cal.period.save': { check: need('setup'), run: (c: OpCtx, a: Parameters<typeof savePeriod>[1]) => savePeriod(c, a) },
  'cal.period.cancel': { check: need('setup'), run: cancelRow('cal_closed_period') },

  'cal.area.save': { check: need('setup'), run: (c: OpCtx, a: { id?: number; name: string; active?: boolean; color?: string | null }) => HOST_OPS['host.building.save'].run(c, a) },
  'cal.space.save': { check: need('setup'), run: (c: OpCtx, a: Parameters<typeof saveSpace>[1]) => saveSpace(c, a) },
  'cal.kind.save': { check: need('setup'), run: (c: OpCtx, a: Parameters<typeof saveKind>[1]) => saveKind(c, a) },
  'cal.category.save': { check: need('setup'), run: listSave('cal_category') },
  'cal.akind.save': { check: need('setup'), run: listSave('cal_activity_kind', true) },
  'cal.okind.save': { check: need('setup'), run: listSave('cal_org_kind') },
  'cal.import.spaces': { check: need('setup'), run: (c: OpCtx, a: { rows: unknown[][]; dry?: boolean }) => importSpaces(c, a) },
  'cal.import.orgs': { check: need('orgs'), run: (c: OpCtx, a: { rows: unknown[][]; dry?: boolean }) => importOrgs(c, a) },
} as const;

export const CAL_READ_ONLY = ['cal.get', 'cal.history'];

/** for the tests and the coming screens: who sees the amounts */
export const calSeesPrices = (c: OpCtx) => seesPrices(rightsOf(c));
