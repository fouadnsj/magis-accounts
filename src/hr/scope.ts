// Who sees which centre in the HR database (Fouad, 31 October 2026): there is an HR keeper for every centre, who sees
// only the people of that centre (and their agreements, pay, payroll…); the MAGIS manager sees the three. The server
// keeps to it: what is outside a person's centres is never sent, and cannot be changed.
import { one } from '../db/db';
import { UserError } from '../db/repo';
import { m } from '../i18n';
import type { OpCtx } from '../ops';
import type { Perm } from '../perms';

/** The centres the user sees (codes); null = every centre. */
export const scopeOf = (c: Pick<OpCtx, 'profile'>): string[] | null => c.profile.hrCentres ?? null;
export const seesAll = (c: Pick<OpCtx, 'profile'>) => scopeOf(c) == null;
/** whether a centre code is seen (a person without a centre is seen only by those who see every centre) */
export const sees = (c: Pick<OpCtx, 'profile'>, code: string | null | undefined) => { const s = scopeOf(c); return s == null || (!!code && s.includes(code)); };

const outside = () => new UserError(m('خارج مراكزك', 'Outside your centres', 'Hors de vos centres'));

/** centre name (as kept on a person) → its code */
export async function centreCodes(c: Pick<OpCtx, 'db'>): Promise<Map<string, string | null>> {
  return new Map((await c.db.query<{ name: string; code: string | null }>("SELECT name, code FROM hr_list WHERE kind = 'centre'")).map((x) => [x.name, x.code]));
}

/** the centre code of a person (null: no centre, or a centre without a code) */
export async function personCode(c: Pick<OpCtx, 'db'>, personId: number): Promise<string | null> {
  return (await one<{ code: string | null }>(c.db, "SELECT l.code FROM hr_person p LEFT JOIN hr_list l ON l.kind = 'centre' AND l.name = p.centre WHERE p.id = ?", [personId]))?.code ?? null;
}

/** refuses a person outside the user's centres */
export async function needPerson(c: OpCtx, personId: number | null | undefined) {
  if (personId == null || seesAll(c)) return;
  if (!sees(c, await personCode(c, personId))) throw outside();
}

/** refuses a centre code outside the user's centres */
export function needCentre(c: OpCtx, code: string | null | undefined) {
  if (!sees(c, code)) throw outside();
}

/** refuses what only those who see every centre may do (shared settings, positions shared by every centre…) */
export function needAll(c: OpCtx) {
  if (!seesAll(c)) throw new UserError(m('لمن يرى كل المراكز فقط', 'Only for someone who sees every centre', 'Seulement pour qui voit tous les centres'));
}

/** the ids of the people the user sees (null = everyone) */
export async function seenPeople(c: OpCtx): Promise<Set<number> | null> {
  if (seesAll(c)) return null;
  const codes = await centreCodes(c);
  const rows = await c.db.query<{ id: number; centre: string | null }>('SELECT id, centre FROM hr_person');
  return new Set(rows.filter((p) => sees(c, p.centre ? codes.get(p.centre) : null)).map((p) => p.id));
}

/** refuses a user who has none of these rights (Fouad, 1 November 2026: the HR rights in detail) */
export function needRight(c: Pick<OpCtx, 'profile'>, ...perms: Perm[]) {
  if (!perms.some((p) => c.profile.perms.includes(p))) throw new UserError(m('غير مسموح لهذا المستخدم', 'Not allowed for this user', 'Non permis pour cet utilisateur'));
}
