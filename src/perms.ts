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
      { key: 'reports.coverage', label: m('التغطية (سرّي)', 'Coverage (confidential)') },
      { key: 'reports.funds', label: m('أموال المشاريع (سرّي)', 'Project funds (confidential)') },
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
      { key: 'data.backup', label: m('النسخ الاحتياطية', 'Backups') },
      { key: 'data.restore', label: m('استرجاع نسخة', 'Restore a backup') },
      { key: 'data.export', label: m('التصدير إلى Excel', 'Export to Excel') },
      { key: 'data.import', label: m('الاستيراد (ملف Excel، ملفات قديمة)', 'Import (Excel workbook, old files)') },
      { key: 'audit.view', label: m('سجل التعديلات', 'Audit log') },
    ],
  },
] as const satisfies readonly { key: string; label: Msg; perms: readonly { key: string; label: Msg }[] }[];

export type Perm = (typeof PERM_GROUPS)[number]['perms'][number]['key'];
export const ALL_PERMS: Perm[] = PERM_GROUPS.flatMap((g) => g.perms.map((p) => p.key));

/** Keeps only known permissions (a stored list may be older or hand-edited). */
export function cleanPerms(xs: unknown): Perm[] {
  return Array.isArray(xs) ? (xs.filter((x) => (ALL_PERMS as string[]).includes(x)) as Perm[]) : [];
}
