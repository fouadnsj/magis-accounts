// Every permission a person can be given, grouped by category.
// A permission profile (Superior, Accountant, Book holder, or any the Superior
// creates) is a set of these ticks. The server checks them on every action.
import { m, type Msg } from './i18n';

export const PERM_GROUPS = [
  {
    key: 'book',
    label: m('الدفتر', 'Book'),
    perms: [
      { key: 'book.own', label: m('يكتب في دفتره، يؤكد ما يقبضه، يعدّ نقده، يغلق شهره', 'Writes in his own book(s), confirms what he receives, counts his cash, closes his month') },
    ],
  },
  {
    key: 'register',
    label: m('السجل', 'Register'),
    perms: [
      { key: 'register.view', label: m('يرى كل الدفاتر والسجل كله', 'Sees every book and the whole register') },
      { key: 'register.main', label: m('يكتب ويصحّح في الدفتر الرئيسي فقط، ويؤكد ما يصله', 'Writes and corrects in the Main book only, confirms what Main receives') },
      { key: 'register.edit', label: m('يكتب ويصحّح في كل الدفاتر (والرئيسي)، ويسجّل أي تحويل', 'Writes and corrects in every book (and Main), records any transfer') },
    ],
  },
  {
    key: 'reports',
    label: m('التقارير', 'Reports'),
    perms: [
      { key: 'reports.summary', label: m('الملخص', 'Summary') },
      { key: 'reports.monthly', label: m('شهرياً', 'Monthly') },
      { key: 'reports.accounts', label: m('حسب الحساب', 'By account') },
      { key: 'reports.exchange', label: m('سجل التصريف', 'Exchange log') },
      { key: 'reports.cash', label: m('نقد كل الصناديق', 'Cash of every holder') },
      { key: 'reports.funding', label: m('التمويل: الإيراد الذاتي وما يرسله المسؤول (سرّي)', 'Funding: own income and what the Respo sends (confidential)') },
    ],
  },
  {
    key: 'budget',
    label: m('الموازنة', 'Budget'),
    perms: [
      { key: 'budget.view', label: m('يرى الموازنة ونسبة الصرف لكل خط', 'Sees the budget and how much of each line is spent') },
      { key: 'budget.manage', label: m('يكتب الموازنة ويعدّلها', 'Writes and revises the budget') },
    ],
  },
  {
    key: 'lists',
    label: m('القوائم', 'Lists'),
    perms: [
      { key: 'lists.manage', label: m('الموازنة، الدفاتر، الجهات، الحسابات، المشاريع، القواعد، الإعدادات', 'Budget, books, parties, accounts, projects, rules, settings') },
      { key: 'lists.donors', label: m('المانحون والمنح (سرّي)', 'Donors and grants (confidential)') },
    ],
  },
  {
    key: 'admin',
    label: m('الإدارة', 'Admin'),
    perms: [
      { key: 'month.close', label: m('إغلاق الشهر (المكتب)', 'Close the month (office)') },
      { key: 'month.reopen', label: m('إعادة فتح شهر', 'Reopen a month') },
      { key: 'users.manage', label: m('المستخدمون وملفات الصلاحيات', 'Users and permission profiles') },
      { key: 'users.passwords', label: m('يعيد تعيين كلمة سر أي شخص (إلا من يدير المستخدمين)', "Resets anyone's password (except those who manage users)", "Réinitialise le mot de passe de chacun (sauf de ceux qui gèrent les utilisateurs)") },
      { key: 'data.backup', label: m('النسخ الاحتياطية', 'Backups') },
      { key: 'data.restore', label: m('استرجاع نسخة', 'Restore a backup') },
      { key: 'data.export', label: m('التصدير إلى Excel', 'Export to Excel') },
      { key: 'data.import', label: m('الاستيراد (ملف Excel، ملفات قديمة)', 'Import (Excel workbook, old files)') },
      { key: 'audit.view', label: m('سجل التعديلات', 'Audit log') },
    ],
  },
] as const satisfies readonly { key: string; label: Msg; perms: readonly { key: string; label: Msg }[] }[];

// Only in a community database (Jesuit communities). The MAGIS centres' screens show PERM_GROUPS only.
export const CTY_PERM_GROUPS = [
  {
    key: 'community',
    label: m('الجماعة', 'Community', 'Communauté'),
    perms: [
      { key: 'cty.view_all', label: m('يرى دفاتر كل أعضاء الجماعة', 'Sees the books of every member of the community', 'Voit les comptes de tous les membres de la communauté') },
      { key: 'cty.write_all', label: m('يكتب لأي عضو (ورقة مطبوعة)، ويسجّل ما يعطيه الصندوق', 'Writes for any member (paper sheet) and records what the cash gives', 'Écrit pour tout membre (feuille papier) et enregistre ce que la caisse donne') },
      { key: 'cty.month_seen', label: m('يقرأ شهر كل عضو (اطّلعت ✓ أو سؤال خاص)، ويوافق على النفقات الكبيرة', "Reads each member's month (seen ✓ or a private question), approves large expenses", "Lit le mois de chaque membre (vu ✓ ou une question privée), approuve les grosses dépenses") },
      { key: 'cty.limits', label: m('يحدد المبلغ الذي تحتاج فوقه النفقة إلى موافقة الرئيس', "Sets the amount above which an expense needs the Superior's approval", "Fixe le montant au-delà duquel une dépense demande l'accord du Supérieur") },
      { key: 'cty.passwords', label: m('يعيد تعيين كلمة سر أي شخص أو منصب (ما عدا المشرف)', 'Resets the password of anyone or of an office (except the administrator)', "Réinitialise le mot de passe de n'importe qui ou d'une fonction (sauf l'administrateur)") },
      { key: 'cty.chart', label: m('يعدّل دليل الحسابات (الرموز والأسماء والخطوط)', 'Changes the chart of codes (codes, names, lines)', 'Modifie le plan des comptes (codes, noms, lignes)') },
    ],
  },
  {
    key: 'country',
    label: m('البلد', 'Country', 'Pays'),
    perms: [
      { key: 'country.manage', label: m('قيم البلد: ملفات الجماعات، المطالبات، التكاليف بين الجماعات، المصالحة', 'Country econome: the communities\u2019 files, claims, charges between communities, reconciliation', "Économe du pays : fichiers des communautés, réclamations, charges entre communautés, réconciliation") },
    ],
  },
] as const satisfies readonly { key: string; label: Msg; perms: readonly { key: string; label: Msg }[] }[];

// Only in the HR database (Fouad, 30 October 2026).
export const HR_PERM_GROUPS = [
  {
    key: 'hr',
    label: m('الموارد البشرية', 'Human resources', 'Ressources humaines'),
    perms: [
      { key: 'hr.view', label: m('يرى الأشخاص والاتفاقيات ورسائل المكافأة ومدونة السلوك', 'Sees the people, agreements, stipend letters and the code of conduct', 'Voit les personnes, accords, lettres de gratification et le code de conduite') },
      { key: 'hr.manage', label: m('يضيف ويعدّل الأشخاص والاتفاقيات والرسائل والتوقيعات', 'Adds and changes people, agreements, letters and signatures', 'Ajoute et modifie personnes, accords, lettres et signatures') },
      { key: 'hr.vault', label: m('يفتح خزانة الوثائق (الهويات وغيرها) — كل فتح يُسجَّل', 'Opens the document vault (IDs and others) — every opening is logged', 'Ouvre le coffre des documents (pièces d\u2019identité, etc.) — chaque ouverture est notée') },
    ],
  },
] as const satisfies readonly { key: string; label: Msg; perms: readonly { key: string; label: Msg }[] }[];

export type Perm = (typeof PERM_GROUPS)[number]['perms'][number]['key'] | (typeof CTY_PERM_GROUPS)[number]['perms'][number]['key'] | (typeof HR_PERM_GROUPS)[number]['perms'][number]['key'];
export const ALL_PERMS: Perm[] = [...PERM_GROUPS, ...CTY_PERM_GROUPS, ...HR_PERM_GROUPS].flatMap((g) => g.perms.map((p) => p.key));

/** Keeps only known permissions (a stored list may be older or hand-edited). */
export function cleanPerms(xs: unknown): Perm[] {
  return Array.isArray(xs) ? (xs.filter((x) => (ALL_PERMS as string[]).includes(x)) as Perm[]) : [];
}
