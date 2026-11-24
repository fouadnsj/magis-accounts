// Roles as data (roles step 1, 25 November 2026; ROLES-AND-SIGNIN-ANALYSIS.md §9.1).
// A role is a named bundle of ticks stored in each centre database (access_profile). The ready-made roles carry a
// "kind"; any other role is "Custom" (the old profiles made by hand keep working as they are). A person may hold
// SEVERAL roles: their rights are all the ticks of all their roles put together, plus a few "Advanced" exceptions on
// that person. Each role only adds; nothing is taken away by adding a role.
import { m, type Msg } from './i18n';
import { cleanPerms, withImplied, type Perm } from './perms';

export type RoleKind = 'administrator' | 'director' | 'accountant' | 'holder' | 'reception' | 'coordinator' | 'keeper';

export interface RoleKindInfo {
  kind: RoleKind;
  label: Msg;
  /** one line: what this person does */
  about: Msg;
}

/** The ready-made roles, in the order they are shown. (HR keeper and HR Sessions wait for the HR reflection: not here yet.) */
export const ROLE_KINDS: RoleKindInfo[] = [
  { kind: 'administrator', label: m('المشرف', 'Administrator', 'Administrateur'), about: m('كل شيء، ومعه وحده دفتر المسؤول والمنح والمانحون؛ يعطي دور المدير.', 'Everything; he alone has the Respo book, the grants and the donors; he gives the role Director.', 'Tout ; lui seul a le livre du Respo, les subventions et les bailleurs ; il donne le rôle Directeur.') },
  { kind: 'director', label: m('المدير', 'Director', 'Directeur'), about: m('يرى الحسابات والتقارير والموازنة من دون أن يكتب، والتقويم كله، والجرد وقيمه؛ يعطي الأدوار الأخرى لأشخاص مركزه.', 'Looks at the books, reports and budget without writing, keeps the whole calendar, looks at the inventory and its values; gives the other roles to the people of the centre.', 'Regarde les comptes, rapports et budget sans écrire, tient tout le calendrier, regarde l’inventaire et ses valeurs ; donne les autres rôles aux personnes du centre.') },
  { kind: 'accountant', label: m('المحاسب', 'Accountant', 'Comptable'), about: m('يكتب في الدفتر الرئيسي ويغلق الأشهر.', 'Writes in the Main book and closes the months.', 'Écrit dans le livre principal et clôt les mois.') },
  { kind: 'holder', label: m('أمين صندوق', 'Book holder', 'Teneur de caisse'), about: m('يكتب في دفتره ويعدّ نقده.', 'Writes in his own book and counts his cash.', 'Écrit dans sa caisse et compte son argent.') },
  { kind: 'reception', label: m('الاستقبال', 'Reception', 'Accueil'), about: m('يرى التقويم وجهات الاتصال، يحجز للخارج، يستقبل الضيوف؛ لا يرى الأسعار.', 'Sees the calendar and its contacts, books outside groups, welcomes the guests; no prices.', 'Voit le calendrier et ses contacts, réserve pour l’extérieur, accueille les hôtes ; pas de prix.') },
  { kind: 'coordinator', label: m('المنسّق (الورش)', 'Coordinator (workshops)', 'Coordinateur (ateliers)'), about: m('برنامجنا والحجوزات والأسعار والدفعات؛ يرى الجرد من دون قيمه.', 'Our programme, bookings, prices and payments; looks at the inventory without its values.', 'Notre programme, les réservations, les prix et les paiements ; regarde l’inventaire sans ses valeurs.') },
  { kind: 'keeper', label: m('أمين المخزن', 'Store keeper', 'Magasinier'), about: m('يمسك الجرد ويرى قيمه.', 'Keeps the inventory and sees its values.', 'Tient l’inventaire et voit ses valeurs.') },
];

export const kindInfo = (k: string | null | undefined) => ROLE_KINDS.find((x) => x.kind === k) ?? null;

/** Only the Administrator role carries these: the Respo book and private books; grants, donors, coverage. Refused anywhere else. */
export const ADMIN_ONLY: Perm[] = ['register.private', 'lists.donors'];

/** Roles only the Administrator gives (and takes away). */
export const ADMIN_GIVES: RoleKind[] = ['administrator', 'director'];

/** The ready-made roles a Director (anyone who manages users without being the Administrator) may give. */
export const DIRECTOR_GIVES: RoleKind[] = ['accountant', 'holder', 'reception', 'coordinator', 'keeper'];

/** The sensitive things: for each, the screen says which role brings it ("Sees prices because of: Coordinator"). */
export const SENSITIVE: { key: string; label: Msg; perms: Perm[] }[] = [
  { key: 'prices', label: m('الأسعار', 'prices', 'prix'), perms: ['cal.prices', 'cal.money', 'hosting.prices'] },
  { key: 'values', label: m('قيم الجرد', 'inventory values', 'valeurs de l’inventaire'), perms: ['inventory.values'] },
  { key: 'salaries', label: m('الرواتب', 'salaries', 'salaires'), perms: ['hr.salary'] },
  { key: 'donors', label: m('المانحون والمنح', 'donors and grants', 'bailleurs et subventions'), perms: ['lists.donors'] },
  { key: 'respo', label: m('دفتر المسؤول', 'Respo book', 'livre du Respo'), perms: ['register.private'] },
];

export interface RoleLike {
  id: number;
  name: string;
  kind: string | null;
  perms: Perm[];
}

/** The "Advanced" exceptions as stored on a person: known ticks only, never an Administrator-only one. */
export function cleanExtra(xs: unknown): Perm[] {
  return cleanPerms(xs).filter((p) => !ADMIN_ONLY.includes(p));
}

/**
 * A person's rights: every tick of every role, plus the exceptions (with what they bring). A person with one role and
 * no exception gets exactly that role's stored ticks, as before the update.
 */
export function unionPerms(roles: Pick<RoleLike, 'perms'>[], extra: Perm[]): Perm[] {
  const out = new Set<Perm>();
  for (const r of roles) for (const p of r.perms) out.add(p);
  const ex = cleanExtra(extra);
  if (ex.length) for (const p of withImplied(ex)) out.add(p);
  return [...out];
}

/** Which roles (by name) bring this tick; "exception" when it comes from the Advanced ticks only. */
export function broughtBy(perm: Perm, roles: RoleLike[], extra: Perm[]): { roles: RoleLike[]; exception: boolean } {
  const from = roles.filter((r) => r.perms.includes(perm));
  return { roles: from, exception: !from.length && withImplied(cleanExtra(extra)).includes(perm) };
}

/** The sensitive things this person has, each with the roles that bring it. */
export function sensitiveOf(roles: RoleLike[], extra: Perm[]): { key: string; label: Msg; roles: RoleLike[]; exception: boolean }[] {
  const all = unionPerms(roles, extra);
  return SENSITIVE.filter((s) => s.perms.some((p) => all.includes(p))).map((s) => {
    const why = s.perms.filter((p) => all.includes(p)).map((p) => broughtBy(p, roles, extra));
    const rs = [...new Map(why.flatMap((w) => w.roles).map((r) => [r.id, r])).values()];
    return { key: s.key, label: s.label, roles: rs, exception: !rs.length && why.some((w) => w.exception) };
  });
}

// ---- who gives what (roles step 3, 25 November 2026; ROLES-AND-SIGNIN-ANALYSIS.md §4.2, §9.1)
// The Administrator gives every role (Administrator and Director included). Whoever manages the users of the centre (the
// Director) gives the other ready-made roles, and a Custom role only within what he has himself. Whoever "adds book holders"
// (the Accountant) gives a book holder's role only. Nobody gives himself a role. The server checks all of it (src/ops.ts).

/** rights a book holder's role never has */
export const NOT_A_HOLDER: string[] = ['register.edit', 'register.main', 'users.manage', 'users.holders', 'users.passwords', 'data.backup', 'data.restore', 'data.import', 'month.reopen', 'lists.manage', 'lists.donors', 'budget.edit'];

/** a book holder's role: keeps a book, no office right, nothing the giver has not himself */
export const isHolderRole = (perms: string[], can: (p: Perm) => boolean) => perms.includes('book.own') && !perms.some((p) => NOT_A_HOLDER.includes(p)) && perms.every((p) => p === 'book.own' || can(p as Perm));

export interface Giver {
  /** holds the role Administrator */
  admin: boolean;
  can: (p: Perm) => boolean;
}

export const MSG_ADMIN_ONLY = m('للمشرف فقط', 'For the Administrator only', 'Pour l’Administrateur seulement');
export const MSG_ADMIN_TICK = m('دفتر المسؤول والدفاتر الخاصة، والمنح والمانحون: لدور المشرف فقط', 'The Respo book and private books, grants and donors: only in the role Administrator', 'Le livre du Respo et les livres privés, les subventions et les bailleurs : seulement dans le rôle Administrateur');
export const MSG_NOT_MORE = m('لا تعطي أكثر مما عندك', 'You cannot give more than you have yourself', 'Vous ne pouvez pas donner plus que ce que vous avez');
export const MSG_HOLDERS = m('دور أمين صندوق فقط', "A book holder's role only", 'Un rôle de teneur de caisse seulement');
export const MSG_NOT_SELF = m('لا أحد يعطي نفسه دوراً', 'Nobody gives himself a role', 'Personne ne se donne un rôle à soi-même');

/** Why this person may not give that role (null: he may). Used by the Users window; the server says the same. */
export function whyNotGive(g: Giver, r: Pick<RoleLike, 'kind' | 'perms'>): Msg | null {
  if (r.kind !== 'administrator' && r.perms.some((p) => ADMIN_ONLY.includes(p))) return MSG_ADMIN_TICK;
  if (g.admin) return null;
  if (r.kind && ADMIN_GIVES.includes(r.kind as RoleKind)) return MSG_ADMIN_ONLY;
  if (g.can('users.manage')) {
    if (r.kind && DIRECTOR_GIVES.includes(r.kind as RoleKind)) return null;
    return r.perms.every((p) => g.can(p)) ? null : MSG_NOT_MORE;
  }
  if (g.can('users.holders')) return isHolderRole(r.perms, g.can) ? null : MSG_HOLDERS;
  return MSG_ADMIN_ONLY;
}

/**
 * The door "Administration" (people and roles; Fouad, 25 November 2026): for whoever holds the role Administrator or Director.
 * A database not updated yet (no ready-made roles) opens it to whoever manages the users, as before.
 */
export function peopleDoor(roles: { kind?: string | null }[] | undefined, can: (p: Perm) => boolean): boolean {
  if (roles?.some((r) => r.kind === 'administrator' || r.kind === 'director')) return true;
  return !roles?.some((r) => r.kind) && can('users.manage');
}

// ---- the book made with the person (roles step 5, 25 November 2026; ROLES-AND-SIGNIN-ANALYSIS.md §9.3)
// A person with the role Book holder "keeps a cash book": the program makes the book with their name (not private, in the
// Main book's city and account), links it to them, and shows the temporary password once. Switching the person off switches
// their book off with them (never deleted: its rows stay).

export const KEEPS_BOOK = m('يمسك دفتر صندوق', 'keeps a cash book', 'tient un livre de caisse');

/** a role that keeps a book of its own (the Book holder) */
export const keepsBook = (perms: readonly string[]) => perms.includes('book.own');

/**
 * The books that go off with this person: the books they keep that nobody else active keeps, never the Main book, never a
 * private book (the Respo book), never a community's book; and the envelopes inside them.
 */
export function booksSwitchedOffWith(
  personId: number,
  users: { id: number; active: number; books: number[] }[],
  books: { id: number; name: string; active: number; is_main: number; private?: number; parent_id?: number | null; cty_kind?: string | null }[],
): { id: number; name: string }[] {
  const mine = users.find((u) => u.id === personId)?.books ?? [];
  const others = new Set(users.filter((u) => u.active && u.id !== personId).flatMap((u) => u.books));
  const own = (b: (typeof books)[number]) => b.active && !b.is_main && !b.private && !b.cty_kind;
  const main = books.filter((b) => own(b) && mine.includes(b.id) && !others.has(b.id));
  const ids = new Set(main.map((b) => b.id));
  const inside = books.filter((b) => own(b) && b.parent_id != null && ids.has(b.parent_id) && !ids.has(b.id));
  return [...main, ...inside].map((b) => ({ id: b.id, name: b.name }));
}

/**
 * "Test as…" (26 November 2026): the people one may open the program as, from the top of Administration. The same rule as
 * the 👁 button on People: the active people of this centre, never oneself, and — unless one is the Administrator — never the
 * Administrator or Director lines (the server refuses those too).
 */
export function testAsChoices<U extends { id: number; active: number; roles?: number[]; access_id?: number | null }>(
  users: U[], access: Pick<RoleLike, 'id' | 'kind'>[], myId: number, iAmAdmin: boolean,
): (U & { roleRows: Pick<RoleLike, 'id' | 'kind'>[] })[] {
  return users
    .filter((u) => u.active && u.id !== myId)
    .map((u) => ({ ...u, roleRows: (u.roles?.length ? u.roles : u.access_id != null ? [u.access_id] : []).map((id) => access.find((a) => a.id === id)).filter((a): a is Pick<RoleLike, 'id' | 'kind'> => !!a) }))
    .filter((u) => iAmAdmin || !u.roleRows.some((a) => !!a.kind && ADMIN_GIVES.includes(a.kind as RoleKind)));
}
