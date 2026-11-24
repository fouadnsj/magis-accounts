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
