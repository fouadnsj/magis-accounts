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

// Only in the HR database (Fouad, 30 October 2026). Made detailed on 1 November 2026: who sees the salaries, who writes
// the agreements, who changes the scale, who only records the tutors' sessions, who prepares, approves and pays the runs.
export const HR_PERM_GROUPS = [
  {
    key: 'hr',
    label: m('الأشخاص', 'People', 'Personnes'),
    perms: [
      { key: 'hr.view', label: m('يرى أشخاص مراكزه (الاسم، المركز، الوظيفة، التواريخ) ومدونة السلوك', 'Sees the people of their centres (name, centre, position, dates) and the code of conduct', 'Voit les personnes de ses centres (nom, centre, poste, dates) et le code de conduite') },
      { key: 'hr.details', label: m('يرى التفاصيل الشخصية: الرقم الوطني، الولادة، العنوان، الهاتف', 'Sees the personal details: national number, birth, address, phone', 'Voit les détails personnels : numéro national, naissance, adresse, téléphone') },
      { key: 'hr.manage', label: m('يضيف ويعدّل الأشخاص، قوائم الوصول والمغادرة، التوقيعات، القوائم في الإعدادات', 'Adds and changes people, the arrival and leaving lists, signatures, the lists in Settings', "Ajoute et modifie les personnes, les listes d'arrivée et de départ, les signatures, les listes des Réglages") },
      { key: 'hr.vault', label: m('يفتح خزانة الوثائق (الهويات وغيرها) — كل فتح يُسجَّل', 'Opens the document vault (IDs and others) — every opening is logged', 'Ouvre le coffre des documents (pièces d\u2019identité, etc.) — chaque ouverture est notée') },
    ],
  },
  {
    key: 'hr-salary',
    label: m('الاتفاقيات والرواتب', 'Agreements and salaries', 'Accords et salaires'),
    perms: [
      { key: 'hr.salary', label: m('يرى المبالغ: الاتفاقيات، المكافآت، السلّم، الكشوف، التأمين، التمويل، التقارير', 'Sees the amounts: agreements, stipends, scale, payroll, insurance, funding, reports', 'Voit les montants : accords, gratifications, échelle, paies, assurance, financement, rapports') },
      { key: 'hr.agreements', label: m('يكتب الاتفاقيات ورسائل المكافأة، ويغيّر المكافأة ابتداءً من تاريخ', 'Writes the agreements and stipend letters, changes a stipend from a date', "Rédige les accords et lettres de gratification, change une gratification à partir d'une date") },
      { key: 'hr.scale', label: m('يغيّر سلّم الرواتب، سعر الدولار للمركز، وسعر الجلسة', "Changes the salary scale, the centre's dollar rate and the price of a session", "Change l'échelle, le taux du dollar du centre et le prix d'une séance") },
    ],
  },
  {
    key: 'hr-pay',
    label: m('الجلسات والكشوف', 'Sessions and payroll', 'Séances et paies'),
    perms: [
      { key: 'hr.sessions', label: m('يسجّل جلسات المدرّبين (لا يرى السعر إلا إن كان يرى المبالغ)', "Records the tutors' sessions (sees the price only if they see the amounts)", "Note les séances des animateurs (voit le prix seulement s'il voit les montants)") },
      { key: 'hr.pay', label: m('يحضّر كشوف الدفع، ساعات العمل، التأمين الصحي، تمويل كل شخص', 'Prepares the payroll runs, the hours worked, health insurance, the funding of each person', 'Prépare les paies, les heures travaillées, l\u2019assurance maladie, le financement de chacun') },
      { key: 'hr.approve', label: m('يعتمد كشف الدفع أو يعيد فتحه', 'Approves a payroll run or reopens it', 'Approuve une paie ou la rouvre') },
      { key: 'hr.paid', label: m('يسجّل أن الكشف المعتمد دُفع', 'Marks an approved run as paid', 'Marque une paie approuvée comme payée') },
    ],
  },
] as const satisfies readonly { key: string; label: Msg; perms: readonly { key: string; label: Msg }[] }[];

/** The admin ticks that mean something in the HR database (shown under the HR ones on its roles page). */
export const HR_ADMIN_PERMS = ['users.manage', 'data.backup', 'data.restore', 'data.export', 'audit.view'] as const;

/**
 * Ticks that bring others with them in the HR database: every HR tick needs to see the people; writing agreements,
 * changing the scale, preparing, approving or paying a run all show the amounts.
 */
export function withImplied(perms: Perm[]): Perm[] {
  const out = new Set(perms);
  if (perms.some((p) => p.startsWith('hr.'))) out.add('hr.view');
  if (perms.some((p) => p === 'hr.agreements' || p === 'hr.scale' || p === 'hr.pay' || p === 'hr.approve' || p === 'hr.paid')) out.add('hr.salary');
  return [...out];
}

export type Perm = (typeof PERM_GROUPS)[number]['perms'][number]['key'] | (typeof CTY_PERM_GROUPS)[number]['perms'][number]['key'] | (typeof HR_PERM_GROUPS)[number]['perms'][number]['key'];
export const ALL_PERMS: Perm[] = [...PERM_GROUPS, ...CTY_PERM_GROUPS, ...HR_PERM_GROUPS].flatMap((g) => g.perms.map((p) => p.key));

/** Keeps only known permissions (a stored list may be older or hand-edited). */
export function cleanPerms(xs: unknown): Perm[] {
  return Array.isArray(xs) ? (xs.filter((x) => (ALL_PERMS as string[]).includes(x)) as Perm[]) : [];
}
