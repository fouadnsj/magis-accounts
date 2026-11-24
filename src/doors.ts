// The doors of a centre (Fouad, 24 November 2026): entering a centre shows four badges - Accounts, Calendar, Inventory, HR.
// Which doors show is decided by the person's ticks (no new right): this file says how, and holds the ready-made roles
// (sets of ticks to start a new permission profile from; the Superior or the Director still edits them).
import { m, type Msg } from './i18n';
import type { Perm } from './perms';

export type DoorKey = 'accounts' | 'calendar' | 'inventory' | 'hr' | 'admin';
/** (25 November 2026) the fifth door, "Administration": the people of the centre and their roles */
export const DOOR_ORDER: DoorKey[] = ['accounts', 'calendar', 'inventory', 'hr', 'admin'];

/** The ticks that bring a person to the reports (as in the old menu). */
const REPORTS: Perm[] = ['reports.summary', 'reports.monthly', 'reports.accounts', 'reports.funding', 'reports.exchange', 'reports.cash'];

export interface DoorFacts {
  can: (p: Perm) => boolean;
  /** keeps at least one book */
  hasBook: boolean;
  /** this database has the inventory (every centre database has it once updated) */
  inventoryOn: boolean;
  /** this person has a place in an HR database on this server (the sign-in ring, or the Coordinator's grants) */
  hr: boolean;
  /** holds the role Administrator or Director (src/roles.ts peopleDoor): the door "Administration" */
  people?: boolean;
}

/**
 * The doors this person sees, in their usual order. A person with a single door still sees the page (Fouad: "it would be a
 * pity to avoid it"); a person with no door sees a gentle note.
 * - Accounts: keeps a book, looks at the books, the reports or the budget, the donors, the lists, the exports, closes months.
 * - Calendar: "Sees the calendar" (every calendar tick brings it).
 * - Inventory: "Sees the inventory".
 * - HR: there is an HR database this person may enter (HR is one for all the centres, separated inside).
 */
export function doorsOf(f: DoorFacts): DoorKey[] {
  const { can } = f;
  const out: DoorKey[] = [];
  if (f.hasBook || can('register.view') || can('register.main') || can('register.edit') || REPORTS.some(can) || can('budget.view') || can('lists.donors') || can('lists.manage') || can('data.export') || can('data.import') || can('month.close') || can('month.reopen')) out.push('accounts');
  if (can('cal.view')) out.push('calendar');
  if (f.inventoryOn && can('inventory.view')) out.push('inventory');
  if (f.hr) out.push('hr');
  if (f.people) out.push('admin');
  return out;
}

export interface ReadyRole {
  key: 'director' | 'accountant' | 'reception' | 'keeper' | 'coordinator';
  /** the name the new profile starts with ("عربي · English"), as the other profiles are named */
  name: string;
  /** one line: what this person does, and the doors they get */
  about: Msg;
  perms: Perm[];
}

const CAL_ALL: Perm[] = ['cal.view', 'cal.contacts', 'cal.programme', 'cal.outside', 'cal.orgs', 'cal.arrive', 'cal.prices', 'cal.money', 'cal.whole', 'cal.setup', 'cal.history'];

/**
 * The ready-made roles, as the two baselines define them (calendar 2.1 section 3, inventory 1.1 section 2):
 * - Director: every calendar tick; looks at the inventory with its values; looks at the books, reports and budget; sees the history.
 * - Accountant: the accounts (as the Accountant profile: writes in the Main book, sees every book, closes the months) and looks at the calendar. No inventory tick:
 *   "the accountant is a keeper" in the inventory baseline, so a centre whose accountant keeps the inventory ticks "Keeps the inventory".
 * - Reception: looks at the calendar and its contacts, books outside groups, keeps the organisations, welcomes the guests; never the prices.
 * - Store keeper: the keeper of the inventory (adds, moves, counts, takes out, sees the values).
 * - Coordinator (workshops, academic): looks at the calendar and its contacts, our programme, outside bookings, organisations, prices and payments; looks at the inventory.
 */
export const READY_ROLES: ReadyRole[] = [
  {
    key: 'director',
    name: 'المدير · Director',
    about: m('يرى كل شيء ويدير التقويم كله، ويرى الجرد وقيمه والحسابات؛ لا يكتب في الدفاتر.', 'Sees everything and keeps the whole calendar; looks at the inventory with its values and at the books, without writing in them.', 'Voit tout et tient tout le calendrier ; regarde l’inventaire avec ses valeurs et les comptes, sans écrire dans les livres.'),
    // (roles step 1) no donors: grants and donors stay in the Administrator role; the Director gives the other roles
    perms: ['register.view', 'reports.summary', 'reports.monthly', 'reports.accounts', 'reports.exchange', 'reports.cash', 'reports.funding', 'budget.view', 'audit.view', 'users.manage', ...CAL_ALL, 'inventory.view', 'inventory.values'],
  },
  {
    key: 'accountant',
    name: 'المحاسب والتقويم · Accountant and calendar',
    about: m('الحسابات كما هي، ويرى التقويم.', 'The accounts, and looks at the calendar.', 'Les comptes, et regarde le calendrier.'),
    perms: ['book.own', 'register.view', 'register.main', 'reports.summary', 'reports.monthly', 'reports.accounts', 'reports.exchange', 'reports.cash', 'lists.manage', 'month.close', 'users.passwords', 'data.backup', 'data.export', 'data.import', 'audit.view', 'cal.view'],
  },
  {
    key: 'reception',
    name: 'الاستقبال · Reception',
    about: m('يرى التقويم وجهات الاتصال، يحجز للجهات الخارجية، يستقبل الضيوف؛ لا يرى الأسعار.', 'Sees the calendar and its contacts, books outside groups, welcomes the guests; never sees the prices.', 'Voit le calendrier et ses contacts, réserve pour les groupes extérieurs, accueille les hôtes ; ne voit jamais les prix.'),
    perms: ['cal.view', 'cal.contacts', 'cal.outside', 'cal.orgs', 'cal.arrive'],
  },
  {
    key: 'keeper',
    name: 'أمين المخزن · Store keeper',
    about: m('يمسك الجرد: يضيف وينقل ويعدّ ويُخرج غرضاً، ويرى القيم.', 'Keeps the inventory: adds, moves, counts, takes an item out, sees the values.', 'Tient l’inventaire : ajoute, déplace, compte, sort un objet, voit les valeurs.'),
    perms: ['inventory.view', 'inventory.values', 'inventory.manage'],
  },
  {
    key: 'coordinator',
    name: 'المنسّق · Coordinator (workshops, academic)',
    about: m('ينسّق الورش والبرنامج الدراسي: يرى التقويم وجهات الاتصال، يضيف برنامجنا، يحجز للخارج، يحدّد الأسعار ويسجّل الدفعات؛ ويرى الجرد من دون قيمه.', 'Coordinates the workshops and the academic programme: sees the calendar and its contacts, adds our programme, books outside groups, sets prices and records payments; looks at the inventory without its values.', 'Coordonne les ateliers et le programme académique : voit le calendrier et ses contacts, ajoute notre programme, réserve pour l’extérieur, fixe les prix et note les paiements ; regarde l’inventaire sans ses valeurs.'),
    perms: ['cal.view', 'cal.contacts', 'cal.programme', 'cal.outside', 'cal.orgs', 'cal.prices', 'cal.money', 'inventory.view'],
  },
];
