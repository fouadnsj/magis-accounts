// The inventory's operations (Fouad, 21 November 2026): listing what the centre owns, linked to the purchases of the
// register. See inv.ts for the rules. Nothing is deleted once it has a history: an item is disposed or lost.
import { nowIso, one, type Stmt } from '../db/db';
import { auditStmt, getMeta, setMetaStmt, UserError } from '../db/repo';
import { has } from '../auth';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import {
  CONDITIONS, nextCodes, ORIGINS, prefixFor,
  type InvCategory, type InvData, type InvImportRow, type InvItem, type InvMove, type InvPlace, type InvSkip, type InvSource,
} from './inv';

const refuse = () => new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', "Non autorisé pour cet utilisateur"));
const view = (c: OpCtx) => { if (!has(c.profile, 'inventory.view') && !has(c.profile, 'inventory.manage')) throw refuse(); };
const manage = (c: OpCtx) => { if (!has(c.profile, 'inventory.manage')) throw refuse(); };

const txt = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim());
const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const today = () => nowIso().slice(0, 10);
const money = (x: unknown) => (x == null || x === '' ? null : Math.max(0, Math.round(Number(x) * 100) / 100));

async function prefixOf(c: OpCtx): Promise<string> {
  return (await getMeta(c.db, 'inv_prefix')) || prefixFor(await getMeta(c.db, 'centre'));
}

async function load(c: OpCtx): Promise<InvData> {
  return {
    categories: await c.db.query<InvCategory>('SELECT * FROM inv_category ORDER BY sort, name'),
    places: await c.db.query<InvPlace>('SELECT * FROM inv_place ORDER BY sort, name'),
    items: await c.db.query<InvItem>('SELECT * FROM inv_item ORDER BY code'),
    moves: await c.db.query<InvMove>('SELECT * FROM inv_move ORDER BY id'),
    sources: await c.db.query<InvSource>('SELECT kind, ref FROM inv_source'),
    skips: await c.db.query<InvSkip>('SELECT * FROM inv_skip'),
    prefix: await prefixOf(c),
  };
}

/** a purchase entry this person may list (it exists, is an expense, and is not in a private book he cannot see) */
async function entryOf(c: OpCtx, trxId: string) {
  const r = await one<{ id: string; type: string | null; book_id: number | null; date: string | null; party_id: number | null; private: number | null }>(
    c.db, 'SELECT t.id, t.type, t.book_id, t.date, t.party_id, b.private FROM trx t LEFT JOIN book b ON b.id = t.book_id WHERE t.id = ?', [trxId]);
  if (!r || r.type !== 'Exp') throw new UserError(m('القيد غير موجود أو ليس مصروفاً', 'That entry does not exist or is not an expense', "Cette écriture n'existe pas ou n'est pas une dépense"));
  if (r.private && !has(c.profile, 'register.private') && !(r.book_id != null && c.profile.books.includes(r.book_id))) throw refuse();
  return r;
}

export interface ItemInput {
  id?: number;
  name: string;
  category_id?: number | null;
  place_id?: number | null;
  qty?: number;
  brand?: string | null;
  model?: string | null;
  serial?: string | null;
  condition?: string;
  holder?: string | null;
  origin?: string;
  acquired_on?: string | null;
  trx_id?: string | null;
  party_id?: number | null;
  value_usd?: number | null;
  value_note?: string | null;
  note?: string | null;
  code?: string | null;
}

async function checkRefs(c: OpCtx, a: ItemInput) {
  if (a.category_id != null && !(await one(c.db, 'SELECT 1 FROM inv_category WHERE id = ?', [a.category_id]))) throw new UserError(m('الصنف غير موجود', 'Category not found', 'Catégorie introuvable'));
  if (a.place_id != null && !(await one(c.db, 'SELECT 1 FROM inv_place WHERE id = ?', [a.place_id]))) throw new UserError(m('المكان غير موجود', 'Place not found', 'Lieu introuvable'));
}

/** a serial number is the object's identity: never two living items with the same one */
async function checkSerial(c: OpCtx, serial: string | null, exceptId: number | null) {
  if (!serial) return;
  const o = await one<{ code: string; name: string }>(c.db, "SELECT code, name FROM inv_item WHERE lower(serial) = lower(?) AND status = 'in_use' AND id <> ?", [serial, exceptId ?? -1]);
  if (o) throw new UserError(m(`الرقم التسلسلي مستعمل في ${o.code} (${o.name})`, `The serial number is already used by ${o.code} (${o.name})`, `Ce numéro de série est déjà celui de ${o.code} (${o.name})`));
}

function clean(a: ItemInput) {
  const name = txt(a.name);
  if (!name) throw new UserError(m('اكتب اسم الغرض', 'Write the item\'s name', "Écrivez le nom de l'objet"));
  const qty = Math.round(Number(a.qty ?? 1));
  if (!(qty >= 1) || qty > 100000) throw new UserError(m('العدد يجب أن يكون 1 أو أكثر', 'The number must be 1 or more', 'Le nombre doit être 1 ou plus'));
  const condition = CONDITIONS.find((x) => x === a.condition) ?? 'good';
  const origin = ORIGINS.find((x) => x === a.origin) ?? 'bought';
  const acquired = a.acquired_on && isDay(a.acquired_on) ? a.acquired_on : null;
  if (a.acquired_on && !acquired) throw new UserError(m('تاريخ غير صالح', 'Not a valid date', 'Date non valide'));
  const value = money(a.value_usd);
  return { name, qty, condition, origin, acquired, value };
}

const moveStmt = (itemId: number, kind: string, who: string, o: { date?: string; place_id?: number | null; holder?: string | null; note?: string | null } = {}): Stmt => ({
  sql: 'INSERT INTO inv_move (item_id, on_date, kind, place_id, holder, note, who, at) VALUES (?,?,?,?,?,?,?,?)',
  params: [itemId, o.date ?? today(), kind, o.place_id ?? null, o.holder ?? null, o.note ?? null, who, nowIso()],
});

async function itemOf(c: OpCtx, id: number) {
  const x = await one<InvItem>(c.db, 'SELECT * FROM inv_item WHERE id = ?', [id]);
  if (!x) throw new UserError(m('الغرض غير موجود', 'Item not found', 'Objet introuvable'));
  return x;
}

/** Lists items. `trx_id` set: they are the purchase of that entry (several lines of one bill). Returns the new ids. */
async function addItems(c: OpCtx, inputs: ItemInput[], trxId: string | null): Promise<number[]> {
  if (!inputs.length) throw new UserError(m('لا غرض لتسجيله', 'No item to list', "Aucun objet à enregistrer"));
  const entry = trxId ? await entryOf(c, trxId) : null;
  const existing = (await c.db.query<{ code: string }>('SELECT code FROM inv_item')).map((x) => x.code);
  const need = inputs.filter((x) => !txt(x.code)).length;
  const fresh = nextCodes(existing, await prefixOf(c), need);
  const used = new Set(existing.map((x) => x.toLowerCase()));
  const base = (await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(id), 0) AS n FROM inv_item'))?.n ?? 0;
  const stmts: Stmt[] = [];
  const serials = new Set<string>();
  const ids: number[] = [];
  let k = 0;
  for (const [i, a] of inputs.entries()) {
    await checkRefs(c, a);
    const v = clean(a);
    const serial = txt(a.serial);
    if (serial) {
      if (serials.has(serial.toLowerCase())) throw new UserError(m(`الرقم التسلسلي ${serial} مكرّر`, `The serial number ${serial} is written twice`, `Le numéro de série ${serial} est écrit deux fois`));
      serials.add(serial.toLowerCase());
      await checkSerial(c, serial, null);
    }
    const code = txt(a.code) ?? fresh[k++];
    if (used.has(code.toLowerCase())) throw new UserError(m(`الرمز ${code} مستعمل`, `The label ${code} is already used`, `L'étiquette ${code} existe déjà`));
    used.add(code.toLowerCase());
    const id = base + i + 1;
    ids.push(id);
    stmts.push(
      { sql: `INSERT INTO inv_item (id, code, name, category_id, place_id, qty, brand, model, serial, condition, status, holder, origin, acquired_on, trx_id, party_id, value_usd, value_note, note, created_at, created_by)
              VALUES (?,?,?,?,?,?,?,?,?,?,'in_use',?,?,?,?,?,?,?,?,?,?)`,
        params: [id, code, v.name, a.category_id ?? null, a.place_id ?? null, v.qty, txt(a.brand), txt(a.model), serial, v.condition, txt(a.holder), trxId ? 'bought' : v.origin,
          trxId ? (entry?.date ?? v.acquired) : v.acquired, trxId, a.party_id ?? entry?.party_id ?? null, v.value, txt(a.value_note), txt(a.note), nowIso(), c.who] },
      moveStmt(id, 'added', c.who, { place_id: a.place_id, holder: txt(a.holder), note: trxId ? 'purchase' : v.origin }),
      auditStmt(c.who, 'add', 'inv_item', String(id), null, { code, name: v.name, qty: v.qty, trx: trxId }),
    );
  }
  await c.db.batch(stmts);
  return ids;
}

export const INV_OPS = {
  'inv.get': { check: view, run: (c: OpCtx) => load(c) },

  /** a new item (a gift, something old, or one bought outside the register) */
  'inv.item.add': {
    check: manage,
    run: async (c: OpCtx, a: ItemInput) => {
      if (a.trx_id) throw new UserError(m('استعمل «سجّل مشتريات»', 'Use "Register a purchase"', 'Utilisez « Enregistrer un achat »'));
      const [id] = await addItems(c, [a], null);
      return { id };
    },
  },

  /** the items of one purchase entry (one bill may hold several things) */
  'inv.register': {
    check: manage,
    run: async (c: OpCtx, a: { trx_id: string; items: ItemInput[] }) => ({ ids: await addItems(c, a.items, a.trx_id) }),
  },

  /** changes what is written about an item; a new place, holder or state is written in its history */
  'inv.item.save': {
    check: manage,
    run: async (c: OpCtx, a: ItemInput & { id: number }) => {
      const x = await itemOf(c, a.id);
      await checkRefs(c, a);
      const v = clean(a);
      const serial = txt(a.serial);
      await checkSerial(c, serial, x.id);
      const stmts: Stmt[] = [
        { sql: `UPDATE inv_item SET name=?, category_id=?, qty=?, brand=?, model=?, serial=?, origin=?, acquired_on=?, party_id=?, value_usd=?, value_note=?, note=?, updated_at=? WHERE id=?`,
          params: [v.name, a.category_id ?? null, v.qty, txt(a.brand), txt(a.model), serial, x.trx_id ? 'bought' : v.origin, v.acquired, a.party_id ?? null, v.value, txt(a.value_note), txt(a.note), nowIso(), x.id] },
        auditStmt(c.who, 'update', 'inv_item', String(x.id), { name: x.name, qty: x.qty, serial: x.serial, value_usd: x.value_usd }, { name: v.name, qty: v.qty, serial, value_usd: v.value }),
      ];
      const place = a.place_id ?? null;
      const holder = txt(a.holder);
      if (place !== x.place_id || holder !== x.holder) {
        stmts.push({ sql: 'UPDATE inv_item SET place_id = ?, holder = ? WHERE id = ?', params: [place, holder, x.id] },
          moveStmt(x.id, holder !== x.holder && holder ? 'given' : holder !== x.holder ? 'returned' : 'moved', c.who, { place_id: place, holder }));
      }
      if (v.condition !== x.condition) {
        stmts.push({ sql: 'UPDATE inv_item SET condition = ? WHERE id = ?', params: [v.condition, x.id] }, moveStmt(x.id, v.condition === 'good' ? 'repaired' : v.condition === 'broken' ? 'broken' : 'repair', c.who));
      }
      await c.db.batch(stmts);
      return { ok: true };
    },
  },

  /** the item leaves: disposed (thrown away, given away) or lost; it stays in the list with its history */
  'inv.item.out': {
    check: manage,
    run: async (c: OpCtx, a: { id: number; status: 'disposed' | 'lost'; why?: string | null; date?: string }) => {
      const x = await itemOf(c, a.id);
      if (x.status !== 'in_use') throw new UserError(m('الغرض خارج الجرد أصلاً', 'The item is already out', "L'objet est déjà sorti"));
      const date = a.date && isDay(a.date) ? a.date : today();
      const st = a.status === 'lost' ? 'lost' : 'disposed';
      await c.db.batch([
        { sql: 'UPDATE inv_item SET status = ?, disposed_on = ?, disposed_why = ?, holder = NULL, updated_at = ? WHERE id = ?', params: [st, date, txt(a.why), nowIso(), x.id] },
        moveStmt(x.id, st, c.who, { date, note: txt(a.why) }),
        auditStmt(c.who, st, 'inv_item', String(x.id), { status: x.status }, { status: st, why: txt(a.why) }),
      ]);
      return { ok: true };
    },
  },
  'inv.item.back': {
    check: manage,
    run: async (c: OpCtx, a: { id: number }) => {
      const x = await itemOf(c, a.id);
      if (x.status === 'in_use') return { ok: true };
      await c.db.batch([
        { sql: "UPDATE inv_item SET status = 'in_use', disposed_on = NULL, disposed_why = NULL, updated_at = ? WHERE id = ?", params: [nowIso(), x.id] },
        moveStmt(x.id, 'returned', c.who, { note: 'back in the list' }),
        auditStmt(c.who, 'restore', 'inv_item', String(x.id), { status: x.status }, { status: 'in_use' }),
      ]);
      return { ok: true };
    },
  },
  /** an item entered by mistake and never used: only when its history is just "added" */
  'inv.item.delete': {
    check: manage,
    run: async (c: OpCtx, a: { id: number }) => {
      const x = await itemOf(c, a.id);
      const n = (await one<{ n: number }>(c.db, "SELECT COUNT(*) AS n FROM inv_move WHERE item_id = ? AND kind <> 'added'", [x.id]))?.n ?? 0;
      if (n > 0) throw new UserError(m('للغرض تاريخ: أخرجه بدل أن تحذفه', 'The item has a history: take it out instead of deleting it', "L'objet a un historique : sortez-le au lieu de le supprimer"));
      await c.db.batch([{ sql: 'DELETE FROM inv_move WHERE item_id = ?', params: [x.id] }, { sql: 'DELETE FROM inv_item WHERE id = ?', params: [x.id] },
        auditStmt(c.who, 'delete', 'inv_item', String(x.id), { code: x.code, name: x.name, trx: x.trx_id }, null)]);
      return { ok: true };
    },
  },

  /** a count: these items were seen, in this place, on this day */
  'inv.count': {
    check: manage,
    run: async (c: OpCtx, a: { ids: number[]; placeId?: number | null; date?: string }) => {
      const date = a.date && isDay(a.date) ? a.date : today();
      const ids = [...new Set((a.ids ?? []).map(Number).filter(Number.isFinite))];
      if (!ids.length) throw new UserError(m('لم تختر شيئاً', 'Nothing chosen', 'Rien de choisi'));
      const stmts: Stmt[] = [];
      for (const id of ids) {
        const x = await itemOf(c, id);
        if (x.status !== 'in_use') continue;
        stmts.push({ sql: 'UPDATE inv_item SET counted_on = ? WHERE id = ?', params: [date, id] }, moveStmt(id, 'counted', c.who, { date, place_id: a.placeId ?? x.place_id }));
      }
      stmts.push(auditStmt(c.who, 'count', 'inv_item', null, null, { items: ids.length, date, place: a.placeId ?? null }));
      await c.db.batch(stmts);
      return { counted: ids.length };
    },
  },

  /** a purchase on an inventory line that is not an item (a repair, a delivery fee) */
  'inv.skip': {
    check: manage,
    run: async (c: OpCtx, a: { trx_id: string; reason?: string | null }) => {
      await entryOf(c, a.trx_id);
      if (await one(c.db, 'SELECT 1 FROM inv_item WHERE trx_id = ?', [a.trx_id])) throw new UserError(m('لهذا القيد أغراض مسجَّلة', 'This entry already has items', 'Cette écriture a déjà des objets'));
      await c.db.batch([
        { sql: 'INSERT OR REPLACE INTO inv_skip (trx_id, reason, who, at) VALUES (?,?,?,?)', params: [a.trx_id, txt(a.reason), c.who, nowIso()] },
        auditStmt(c.who, 'skip', 'inv_skip', a.trx_id, null, { reason: txt(a.reason) }),
      ]);
      return { ok: true };
    },
  },
  'inv.unskip': {
    check: manage,
    run: async (c: OpCtx, a: { trx_id: string }) => {
      await c.db.batch([{ sql: 'DELETE FROM inv_skip WHERE trx_id = ?', params: [a.trx_id] }, auditStmt(c.who, 'unskip', 'inv_skip', a.trx_id, null, null)]);
      return { ok: true };
    },
  },

  /** which headings / lines are inventory purchases */
  'inv.source': {
    check: manage,
    run: async (c: OpCtx, a: { kind: 'heading' | 'line'; ref: number; on: boolean }) => {
      if (a.kind !== 'heading' && a.kind !== 'line') throw new UserError(m('نوع غير معروف', 'Unknown kind'));
      const ok = await one(c.db, a.kind === 'heading' ? 'SELECT 1 FROM heading WHERE id = ?' : 'SELECT 1 FROM budget_line WHERE id = ?', [a.ref]);
      if (!ok) throw new UserError(m('غير موجود', 'Not found', 'Introuvable'));
      await c.db.batch([
        a.on ? { sql: 'INSERT OR IGNORE INTO inv_source (kind, ref) VALUES (?,?)', params: [a.kind, a.ref] } : { sql: 'DELETE FROM inv_source WHERE kind = ? AND ref = ?', params: [a.kind, a.ref] },
        auditStmt(c.who, a.on ? 'add' : 'remove', 'inv_source', `${a.kind}:${a.ref}`, null, null),
      ]);
      return { ok: true };
    },
  },

  /** categories and places: add, rename, switch off (never deleted) */
  'inv.list.save': {
    check: manage,
    run: async (c: OpCtx, a: { table: 'category' | 'place'; id?: number; name: string; serial?: boolean; active?: boolean }) => {
      const name = txt(a.name);
      if (!name) throw new UserError(m('اكتب الاسم', 'Write the name', 'Écrivez le nom'));
      const tbl = a.table === 'category' ? 'inv_category' : a.table === 'place' ? 'inv_place' : null;
      if (!tbl) throw new UserError(m('قائمة غير معروفة', 'Unknown list'));
      const dup = await one(c.db, `SELECT 1 FROM ${tbl} WHERE name = ? AND id <> ?`, [name, a.id ?? -1]);
      if (dup) throw new UserError(m('الاسم موجود', 'That name exists', 'Ce nom existe déjà'));
      const serial = a.table === 'category' && a.serial ? 1 : 0;
      const active = a.active === false ? 0 : 1;
      const sort = ((await one<{ n: number }>(c.db, `SELECT COALESCE(MAX(sort), 0) AS n FROM ${tbl}`))?.n ?? 0) + 1;
      const stmts: Stmt[] = [];
      if (a.id) stmts.push(a.table === 'category'
        ? { sql: 'UPDATE inv_category SET name = ?, serial = ?, active = ? WHERE id = ?', params: [name, serial, active, a.id] }
        : { sql: 'UPDATE inv_place SET name = ?, active = ? WHERE id = ?', params: [name, active, a.id] });
      else stmts.push(a.table === 'category'
        ? { sql: 'INSERT INTO inv_category (name, serial, sort) VALUES (?,?,?)', params: [name, serial, sort] }
        : { sql: 'INSERT INTO inv_place (name, sort) VALUES (?,?)', params: [name, sort] });
      stmts.push(auditStmt(c.who, a.id ? 'update' : 'add', tbl, a.id ? String(a.id) : null, null, { name, serial, active }));
      await c.db.batch(stmts);
      const id = a.id ?? (await one<{ id: number }>(c.db, `SELECT id FROM ${tbl} WHERE name = ?`, [name]))?.id ?? null;
      return { id };
    },
  },
  'inv.prefix': {
    check: manage,
    run: async (c: OpCtx, a: { prefix: string }) => {
      const p = (a.prefix ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9]{2,6}$/.test(p)) throw new UserError(m('البادئة: حروف لاتينية أو أرقام، من 2 إلى 6', 'The prefix: 2 to 6 letters or digits', 'Le préfixe : 2 à 6 lettres ou chiffres'));
      await c.db.batch([setMetaStmt('inv_prefix', p), auditStmt(c.who, 'update', 'inv_prefix', null, null, { prefix: p })]);
      return { ok: true };
    },
  },

  /** brings in a table (a Snipe-IT export, an Excel list): new categories and places are made; a label already used is skipped */
  'inv.import': {
    check: manage,
    run: async (c: OpCtx, a: { rows: InvImportRow[] }) => {
      const rows = (a.rows ?? []).filter((r) => txt(r.name));
      if (!rows.length) throw new UserError(m('لا صفوف للاستيراد', 'No rows to import', 'Aucune ligne à importer'));
      if (rows.length > 5000) throw new UserError(m('أكثر من 5000 صف', 'More than 5000 rows', 'Plus de 5000 lignes'));
      const cats = new Map((await c.db.query<InvCategory>('SELECT * FROM inv_category')).map((x) => [x.name.toLowerCase(), x.id]));
      const places = new Map((await c.db.query<InvPlace>('SELECT * FROM inv_place')).map((x) => [x.name.toLowerCase(), x.id]));
      const parties = new Map((await c.db.query<{ id: number; name: string }>('SELECT id, name FROM party')).map((x) => [x.name.toLowerCase(), x.id]));
      const stmts: Stmt[] = [];
      let catSort = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(sort), 0) AS n FROM inv_category'))?.n ?? 0);
      let placeSort = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(sort), 0) AS n FROM inv_place'))?.n ?? 0);
      let nextCat = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(id), 0) AS n FROM inv_category'))?.n ?? 0);
      let nextPlace = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(id), 0) AS n FROM inv_place'))?.n ?? 0);
      const existing = await c.db.query<{ code: string; serial: string | null }>('SELECT code, serial FROM inv_item');
      const usedCodes = new Set(existing.map((x) => x.code.toLowerCase()));
      const usedSerials = new Set(existing.map((x) => (x.serial ?? '').toLowerCase()).filter(Boolean));
      const prefix = await prefixOf(c);
      const withCode = rows.filter((r) => txt(r.code)).map((r) => String(r.code));
      const fresh = nextCodes([...existing.map((x) => x.code), ...withCode], prefix, rows.length);
      let k = 0;
      let nextId = (await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(id), 0) AS n FROM inv_item'))?.n ?? 0;
      let added = 0;
      const skipped: string[] = [];
      for (const r of rows) {
        const code = txt(r.code) ?? fresh[k++];
        const serial = txt(r.serial);
        if (usedCodes.has(code.toLowerCase())) { skipped.push(`${code}: label used`); continue; }
        if (serial && usedSerials.has(serial.toLowerCase())) { skipped.push(`${code}: serial used`); continue; }
        usedCodes.add(code.toLowerCase());
        if (serial) usedSerials.add(serial.toLowerCase());
        let cat: number | null = null;
        const cn = txt(r.category);
        if (cn) {
          cat = cats.get(cn.toLowerCase()) ?? null;
          if (cat == null) { cat = ++nextCat; cats.set(cn.toLowerCase(), cat); stmts.push({ sql: 'INSERT INTO inv_category (id, name, serial, sort) VALUES (?,?,?,?)', params: [cat, cn, /it |computer|laptop|معلوم|حاسوب/i.test(cn) ? 1 : 0, ++catSort] }); }
        }
        let place: number | null = null;
        const pn = txt(r.place);
        if (pn) {
          place = places.get(pn.toLowerCase()) ?? null;
          if (place == null) { place = ++nextPlace; places.set(pn.toLowerCase(), place); stmts.push({ sql: 'INSERT INTO inv_place (id, name, sort) VALUES (?,?,?)', params: [place, pn, ++placeSort] }); }
        }
        const sup = txt(r.supplier);
        const party = sup ? parties.get(sup.toLowerCase()) ?? null : null;
        const id = ++nextId;
        const v = clean({ name: r.name, qty: r.qty ?? 1, condition: r.condition, origin: r.origin ?? 'old', acquired_on: r.acquired_on, value_usd: r.value_usd });
        const status = r.status === 'disposed' || r.status === 'lost' ? r.status : 'in_use';
        stmts.push(
          { sql: `INSERT INTO inv_item (id, code, name, category_id, place_id, qty, brand, model, serial, condition, status, holder, origin, acquired_on, party_id, value_usd, value_note, note, disposed_on, created_at, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            params: [id, code, v.name, cat, place, v.qty, txt(r.brand), txt(r.model), serial, v.condition, status, txt(r.holder), v.origin, v.acquired, party, v.value, v.value != null ? 'imported' : null,
              [txt(r.note), sup && !party ? `Supplier: ${sup}` : null].filter(Boolean).join(' · ') || null, status === 'in_use' ? null : today(), nowIso(), c.who] },
          moveStmt(id, 'added', c.who, { place_id: place, holder: txt(r.holder), note: 'import' }),
        );
        added++;
      }
      stmts.push(auditStmt(c.who, 'import', 'inv_item', null, null, { added, skipped: skipped.length }));
      await c.db.batch(stmts);
      return { added, skipped };
    },
  },
} as const;

export const INV_READ_ONLY = ['inv.get'];

/** what the main data call carries (for those who see the inventory) */
export async function invLite(c: OpCtx) {
  if (!has(c.profile, 'inventory.view') && !has(c.profile, 'inventory.manage')) return null;
  const sources = await c.db.query<InvSource>('SELECT kind, ref FROM inv_source');
  const done = (await c.db.query<{ trx_id: string }>('SELECT trx_id FROM inv_item WHERE trx_id IS NOT NULL UNION SELECT trx_id FROM inv_skip')).map((x) => x.trx_id);
  return { sources, done };
}
