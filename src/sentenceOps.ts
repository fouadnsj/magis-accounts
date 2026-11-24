// The sentences of a centre (Fouad, 26 November 2026; update 78): ONE pool for the doors page and the TV (src/sentencePool.ts).
//  - sentence.pool    every person signed in to the centre: the sentences that are ON, for the doors page (the TV never uses this: it receives
//                     only its own phrases, server/calphone.ts);
//  - sentence.get     the Administrator and the Director: the whole list with sources, the places and the TV interval;
//  - sentence.save    …: switch a built-in sentence off/on, edit it, restore it, move it (the places), or write one;
//  - sentence.delete  …: only a sentence the centre wrote; a built-in one is switched off or edited;
//  - sentence.minutes …: how long one phrase stays on the TV (1-15 minutes).
// The rule is the same as the pages People and Roles (src/roles.ts peopleDoor), checked here on the server.
import { nowIso, one } from './db/db';
import { auditStmt, getMeta, setMetaStmt, UserError } from './db/repo';
import { m } from './i18n';
import type { OpCtx } from './ops';
import { peopleDoor } from './roles';
import type { Perm } from './perms';
import { SENTENCES } from './ui/doorSentences';
import { activeSentences, cleanPlaces, cleanTvLang, clampPhraseMinutes, isDefault, poolList, sameSet, SENTENCE_LENGTH, type PoolItem, type SentenceRow } from './sentencePool';
import type { Sentence } from './ui/doorSentences';
import type { Stmt } from './db/db';

const err = (ar: string, en: string, fr: string) => new UserError(m(ar, en, fr));
const COLS = 'id, builtin_key, ar, en, fr, active, edited, places, sort';
const centreKey = async (c: OpCtx) => (await getMeta(c.db, 'centre')) ?? 'other';
const rowsOf = (c: OpCtx) => c.db.query<SentenceRow>(`SELECT ${COLS} FROM sentence ORDER BY sort, id`);

/** only the Administrator and the Director (a database from before the ready-made roles: whoever manages the users) */
function manage(c: OpCtx) {
  if (!peopleDoor(c.profile.roles, (p: Perm) => c.profile.perms.includes(p))) throw err('للمشرف والمدير فقط', 'For the Administrator and the Director only', 'Pour l’Administrateur et le Directeur seulement');
}

/** the sentences that are ON, for the doors page */
async function pool(c: OpCtx): Promise<Sentence[]> {
  return activeSentences(await centreKey(c), await rowsOf(c));
}

async function get(c: OpCtx): Promise<{ minutes: number; lang: string; items: PoolItem[] }> {
  return { lang: cleanTvLang(await getMeta(c.db, 'tv_language')), minutes: clampPhraseMinutes((await getMeta(c.db, 'tv_phrase_minutes')) ?? undefined), items: poolList(await centreKey(c), await rowsOf(c)) };
}

const text = (x: unknown): string => {
  const v = String(x ?? '').replace(/\s+/g, ' ').trim();
  if (v.length > SENTENCE_LENGTH) throw err(`الجملة طويلة: ${SENTENCE_LENGTH} حرفاً على الأكثر`, `The sentence is too long: ${SENTENCE_LENGTH} letters at most`, `La phrase est trop longue : ${SENTENCE_LENGTH} lettres au plus`);
  return v;
};
const noText = () => err('اكتب الجملة بلغة واحدة على الأقل', 'Write the sentence in at least one language', 'Écrivez la phrase dans une langue au moins');

export interface SaveArgs { key?: string | null; id?: number | null; ar?: string; en?: string; fr?: string; active?: boolean; places?: string[]; restore?: boolean; restorePlaces?: boolean }

/**
 * Change one sentence. A built-in one (key) can be switched off/on, edited, moved (the places) or restored; a sentence of the centre (id)
 * is edited; with neither, a new sentence is written. Only what differs from the code is stored. No check but the length and that
 * something is written in one language. A testimony is never on the TV.
 */
async function save(c: OpCtx, a: SaveArgs) {
  const now = nowIso();
  const texts = a.ar !== undefined || a.en !== undefined || a.fr !== undefined;
  const ar = text(a.ar), en = text(a.en), fr = text(a.fr);
  if (a.key) {
    const sent = SENTENCES.find((x) => x.id === a.key);
    if (!sent || (sent.centre && sent.centre !== (await centreKey(c)))) throw err('جملة غير معروفة', 'Unknown sentence', 'Phrase inconnue');
    const row = (await one<SentenceRow>(c.db, `SELECT ${COLS} FROM sentence WHERE builtin_key = ?`, [a.key])) ?? null;
    let active = row ? row.active : 1, edited = row ? row.edited : 0;
    let [tar, ten, tfr] = [row?.ar ?? null, row?.en ?? null, row?.fr ?? null];
    let places: string | null = row?.places ?? null;
    if (a.active !== undefined) active = a.active ? 1 : 0;
    if (a.restore) { edited = 0; tar = ten = tfr = null; }
    if (texts) {
      if (!ar && !en && !fr) throw noText();
      const o = { ar: sent.msg.ar, en: sent.msg.en, fr: sent.msg.fr ?? sent.msg.en };
      if (ar === o.ar && en === o.en && fr === o.fr) { edited = 0; tar = ten = tfr = null; } else { edited = 1; [tar, ten, tfr] = [ar, en, fr]; }
    }
    if (a.restorePlaces) places = null;
    if (a.places) {
      const p = cleanPlaces(a.places, sent.kind === 'testimony');
      places = sameSet(p, sent.for) ? null : JSON.stringify(p);
    }
    const stmts: Stmt[] = [];
    if (active && !edited && !places) { if (row) stmts.push({ sql: 'DELETE FROM sentence WHERE id = ?', params: [row.id] }); }
    else if (row) stmts.push({ sql: 'UPDATE sentence SET active = ?, edited = ?, ar = ?, en = ?, fr = ?, places = ?, edited_by = ?, edited_at = ? WHERE id = ?', params: [active, edited, tar, ten, tfr, places, c.who, now, row.id] });
    else stmts.push({ sql: 'INSERT INTO sentence (builtin_key, ar, en, fr, active, edited, places, created_by, created_at, edited_by, edited_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', params: [a.key, tar, ten, tfr, active, edited, places, c.who, now, c.who, now] });
    await c.db.batch([...stmts, auditStmt(c.who, 'sentence', 'sentence', a.key, row ? { active: row.active, edited: row.edited, places: row.places } : null, { active, edited, places })]);
    return { ok: true };
  }
  if (a.id) {
    const row = await one<SentenceRow>(c.db, `SELECT ${COLS} FROM sentence WHERE id = ? AND builtin_key IS NULL`, [a.id]);
    if (!row) throw err('جملة غير موجودة', 'Sentence not found', 'Phrase introuvable');
    const [nar, nen, nfr] = texts ? [ar, en, fr] : [row.ar ?? '', row.en ?? '', row.fr ?? ''];
    if (!nar && !nen && !nfr) throw noText();
    const active = a.active === undefined ? row.active : a.active ? 1 : 0;
    const places = a.places ? JSON.stringify(cleanPlaces(a.places)) : row.places;
    await c.db.batch([
      { sql: 'UPDATE sentence SET ar = ?, en = ?, fr = ?, active = ?, places = ?, edited_by = ?, edited_at = ? WHERE id = ?', params: [nar, nen, nfr, active, places, c.who, now, row.id] },
      auditStmt(c.who, 'sentence', 'sentence', String(row.id), { ar: row.ar, en: row.en, fr: row.fr, active: row.active, places: row.places }, { ar: nar, en: nen, fr: nfr, active, places }),
    ]);
    return { id: row.id };
  }
  if (!ar && !en && !fr) throw noText();
  const sort = ((await one<{ n: number }>(c.db, 'SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM sentence'))?.n) ?? 1;
  // a new sentence is on every place unless the Director chooses (the doors, the heading of the page, the TV)
  const places = JSON.stringify(a.places ? cleanPlaces(a.places) : cleanPlaces(['centre', 'accounts', 'calendar', 'inventory', 'hr', 'admin', 'tv']));
  await c.db.batch([
    { sql: 'INSERT INTO sentence (builtin_key, ar, en, fr, active, edited, places, sort, created_by, created_at) VALUES (NULL,?,?,?,?,0,?,?,?,?)', params: [ar, en, fr, a.active === false ? 0 : 1, places, sort, c.who, now] },
    auditStmt(c.who, 'sentence', 'sentence', null, null, { ar, en, fr, places }),
  ]);
  return { id: (await one<{ id: number }>(c.db, 'SELECT MAX(id) AS id FROM sentence'))?.id ?? null };
}

async function remove(c: OpCtx, a: { id: number }) {
  const row = await one<SentenceRow>(c.db, `SELECT ${COLS} FROM sentence WHERE id = ?`, [a.id]);
  if (!row) throw err('جملة غير موجودة', 'Sentence not found', 'Phrase introuvable');
  if (row.builtin_key) throw err('الجملة الأصلية تُطفأ أو تُعدَّل فقط', 'A built-in sentence can only be switched off or edited', 'Une phrase d’origine ne peut qu’être éteinte ou modifiée');
  await c.db.batch([{ sql: 'DELETE FROM sentence WHERE id = ?', params: [row.id] }, auditStmt(c.who, 'sentence-delete', 'sentence', String(row.id), { ar: row.ar, en: row.en, fr: row.fr }, null)]);
  return { ok: true };
}

async function minutes(c: OpCtx, a: { minutes: number }) {
  const n = Number(a.minutes);
  if (!Number.isFinite(n) || n < 1 || n > 15) throw err('المدة بين دقيقة و15 دقيقة', 'The time is between 1 and 15 minutes', 'La durée est de 1 à 15 minutes');
  const v = clampPhraseMinutes(n);
  await c.db.batch([setMetaStmt('tv_phrase_minutes', String(v)), auditStmt(c.who, 'tv-phrase-minutes', 'meta', 'tv_phrase_minutes', null, { minutes: v })]);
  return { minutes: v };
}

/** the language under the Arabic on the TV screen */
async function tvLang(c: OpCtx, a: { lang: string }) {
  if (!['en', 'fr', 'ar'].includes(a.lang)) throw err('اللغة غير معروفة', 'Unknown language', 'Langue inconnue');
  await c.db.batch([setMetaStmt('tv_language', a.lang), auditStmt(c.who, 'tv-language', 'meta', 'tv_language', null, { lang: a.lang })]);
  return { lang: a.lang };
}

export const SENTENCE_OPS = {
  'sentence.pool': { check: (_c: OpCtx) => undefined, run: (c: OpCtx) => pool(c) },
  'sentence.get': { check: manage, run: (c: OpCtx) => get(c) },
  'sentence.save': { check: manage, run: (c: OpCtx, a: SaveArgs) => save(c, a) },
  'sentence.delete': { check: manage, run: (c: OpCtx, a: { id: number }) => remove(c, a) },
  'sentence.lang': { check: manage, run: (c: OpCtx, a: { lang: string }) => tvLang(c, a) },
  'sentence.minutes': { check: manage, run: (c: OpCtx, a: { minutes: number }) => minutes(c, a) },
} as const;
export const SENTENCE_READ_ONLY = ['sentence.pool', 'sentence.get'];
void isDefault;
