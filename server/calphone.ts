// The calendar phones (baseline 2.1, step 5). Not the full phone app (server/phone.ts, which belongs to a person who writes
// in a book): a calendar phone has no account. A manager at the centre gives it a name and a role and gets a link code that
// works once; the phone sends the code, and receives a long key (the server keeps only its hash). After that the phone asks
// for its pack and gets the calendar from one month back to six months ahead, with no prices or payments. A cut phone is
// refused at once. Nothing is ever written from a calendar phone.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { nowIso, one, type Db } from '../src/db/db';
import { auditStmt, getMeta, UserError } from '../src/db/repo';
import { m } from '../src/i18n';
import { loadCalRaw } from '../src/hosting/calops';
import { phoneCut, windowOf, shaHex, normCode, isPhoneRole, type CalPhonePack, type PhoneRole } from '../src/hosting/calphone';
import type { CalRights } from '../src/hosting/calendar';
import { tvScreen, type TvScreen } from '../src/hosting/caltv';

export interface CalPhoneRow { id: string; name: string; role: PhoneRole; key_hash: string | null; revoked_at: string | null }

const cutOff = () => new UserError(m('أُوقف هذا الهاتف: راجع المكتب', 'This phone was cut off: see the office', 'Ce téléphone a été coupé : voyez le bureau'));
const unlinked = () => new UserError(m('هذا الهاتف غير مربوط: اطلب رمز ربط جديداً من المركز', 'This phone is not linked: ask the centre for a new link code', 'Ce téléphone n’est pas relié : demandez un nouveau code de liaison au centre'));

/** a link code typed on a phone: this database has it, still good and never used → the phone's key (given here, once) */
export async function claimLink(db: Db, code: string): Promise<{ id: string; key: string; name: string; role: PhoneRole } | null> {
  const hash = await shaHex(normCode(code));
  const p = await one<{ id: string; name: string; role: PhoneRole }>(db, 'SELECT id, name, role FROM cal_phone WHERE link_hash = ? AND link_until > ? AND key_hash IS NULL AND revoked_at IS NULL', [hash, nowIso()]);
  if (!p || !isPhoneRole(p.role)) return null;
  const key = randomBytes(32).toString('base64url');
  await db.batch([
    { sql: 'UPDATE cal_phone SET key_hash = ?, link_hash = NULL, linked_at = ? WHERE id = ?', params: [await shaHex(key), nowIso(), p.id] },
    auditStmt(p.name, 'cal-phone-linked', 'cal_phone', p.id, null, { role: p.role }),
  ]);
  return { id: p.id, key, name: p.name, role: p.role };
}

/** the phone behind this key; throws what the phone must show */
export async function calPhoneOf(db: Db, id: string, key: string): Promise<CalPhoneRow> {
  const p = await one<CalPhoneRow>(db, 'SELECT id, name, role, key_hash, revoked_at FROM cal_phone WHERE id = ?', [id]);
  if (!p || !p.key_hash || !isPhoneRole(p.role)) throw unlinked();
  const a = Buffer.from(p.key_hash, 'hex'), b = Buffer.from(await shaHex(key), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw unlinked();
  if (p.revoked_at) throw cutOff();
  return p;
}

/** the calendar a phone of this role keeps; its last sync is noted */
export async function calPhonePack(db: Db, p: CalPhoneRow, today: string): Promise<CalPhonePack> {
  const rights = { view: true, contacts: false, programme: false, outside: false, orgs: false, arrive: false, prices: false, money: false, whole: false, setup: false, history: false } as CalRights;
  const all = await loadCalRaw(db, rights);
  const asOf = nowIso();
  await db.batch([{ sql: 'UPDATE cal_phone SET last_sync = ? WHERE id = ?', params: [asOf, p.id] }]);
  const w = windowOf(today);
  return { phone: { id: p.id, name: p.name, role: p.role }, organisation: (await getMeta(db, 'organisation')) ?? '', asOf, from: w.from, to: w.to, data: phoneCut(all, p.role, today) };
}

/** the TV's screen (calendar step 7): the TV is a calendar phone, but whatever role it was given it is cut like a Team phone (no contacts) and receives only today's screen */
export async function tvPack(db: Db, p: CalPhoneRow, today: string): Promise<TvScreen> {
  const rights = { view: true, contacts: false, programme: false, outside: false, orgs: false, arrive: false, prices: false, money: false, whole: false, setup: false, history: false } as CalRights;
  const all = await loadCalRaw(db, rights);
  const asOf = nowIso();
  await db.batch([{ sql: 'UPDATE cal_phone SET last_sync = ? WHERE id = ?', params: [asOf, p.id] }]);
  return tvScreen(phoneCut(all, 'team', today), today, (await getMeta(db, 'organisation')) ?? '', asOf);
}
