// What blocks saving a register row, and what only warns.
// The same rules flag migrated rows "to review", so a flag always means:
// "the app would not let you save this row as it is".

import { m, type Msg } from '../i18n';
import { rateOn } from './compute';
import type { Lists, Trx } from './types';

export interface Check {
  errors: Msg[];
  warnings: Msg[];
}

export interface ValidateContext {
  lists: Lists;
  /** every row already in the register (for duplicates and the exchange-rate check) */
  rows: Trx[];
  closedMonths: Set<string>; // 'YYYY-MM'
  today: string; // 'YYYY-MM-DD'
  /** The row's date before this edit: a row cannot be moved out of a closed month either. */
  previousDate?: string | null;
  /** an income or a transfer needs an explanation too (new rows, and rows that had one) */
  explainAll?: boolean;
}

const isDate = (s: string | null): s is string => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export function validateTrx(t: Trx, ctx: ValidateContext): Check {
  const errors: Msg[] = [];
  const warnings: Msg[] = [];
  const { lists } = ctx;

  // ---- Date
  if (!t.date) errors.push(m('التاريخ مطلوب', 'Date is required'));
  else if (!isDate(t.date)) errors.push(m('التاريخ غير صالح', 'Date is not valid'));
  else {
    if (t.date > ctx.today) warnings.push(m('التاريخ بعد اليوم', 'Date is later than today'));
    const fs = lists.settings.fiscal_start;
    if (fs && t.date < fs) errors.push(m(`التاريخ قبل بداية السنة المالية (${fs})`, `Date is before the fiscal year start (${fs})`));
    if (ctx.closedMonths.has(t.date.slice(0, 7)))
      errors.push(m(`الشهر ${t.date.slice(0, 7)} مغلق`, `Month ${t.date.slice(0, 7)} is closed`));
  }
  if (ctx.previousDate && ctx.closedMonths.has(ctx.previousDate.slice(0, 7)))
    errors.push(m(`الشهر ${ctx.previousDate.slice(0, 7)} مغلق — صحّح بقيد عكسي`, `Month ${ctx.previousDate.slice(0, 7)} is closed — correct with a reversing entry`));

  // ---- Classification
  if (t.book_id == null) errors.push(m('الدفتر مطلوب', 'Book is required'));
  if (t.account_id == null) errors.push(m('الحساب مطلوب', 'Account is required'));
  if (t.city_id == null) errors.push(m('المدينة مطلوبة', 'City is required'));
  if (!t.type) {
    errors.push(m('النوع مطلوب', 'Type is required'));
    return { errors, warnings };
  }
  if (t.heading_id == null) errors.push(m('بند الموازنة مطلوب', 'Budget heading is required'));
  else if (!lists.headingTypes.some((h) => h.heading_id === t.heading_id && h.type === t.type))
    errors.push(m('البند لا يناسب النوع', 'This heading does not belong to this type'));
  if (t.line_id == null) errors.push(m('خط الموازنة مطلوب', 'Budget line is required'));
  else {
    const line = lists.lines.find((l) => l.id === t.line_id);
    if (!line || line.heading_id !== t.heading_id)
      errors.push(m('الخط لا يتبع هذا البند', 'This line does not belong to this heading'));
  }

  // ---- Amounts
  const amounts = { inc_syp: t.inc_syp, exp_syp: t.exp_syp, inc_usd: t.inc_usd, exp_usd: t.exp_usd };
  const nonZero = Object.entries(amounts).filter(([, v]) => v !== 0);
  const hasTrf = t.trf_syp !== 0 || t.trf_usd !== 0;

  if (t.type === 'Income' || t.type === 'Exp') {
    const allowed = t.type === 'Income' ? ['inc_syp', 'inc_usd'] : ['exp_syp', 'exp_usd'];
    if (nonZero.length === 0) errors.push(m('أدخل مبلغاً', 'Enter an amount'));
    else if (nonZero.length > 1) errors.push(m('مبلغ واحد فقط بعملة واحدة — قسّم السطر إلى سطرين', 'Only one amount in one currency — split into two rows'));
    else if (!allowed.includes(nonZero[0][0]))
      errors.push(m('المبلغ في العمود الخطأ (إيراد/نفقة)', 'Amount is in the wrong column (income/expense)'));
    if (nonZero.some(([, v]) => v < 0)) errors.push(m('المبلغ يجب أن يكون موجباً', 'Amount must be positive'));
    if (hasTrf) errors.push(m('لا تحويل ولا تصريف في سطر إيراد/نفقة', 'No transfer/exchange amount on an income/expense row'));
    if (t.type === 'Exp' && !(t.explanation ?? '').trim()) errors.push(m('الشرح مطلوب للنفقة', 'Explanation is required for an expense'));
    if (t.type === 'Income' && ctx.explainAll && !(t.explanation ?? '').trim()) errors.push(m('الشرح مطلوب للإيراد: من أين جاء المال؟', 'Explanation is required for an income: where does the money come from?'));
  }

  if (t.type === 'Transfer') {
    if (ctx.explainAll && !(t.explanation ?? '').trim()) errors.push(m('الشرح مطلوب للتحويل', 'Explanation is required for a transfer'));
    if (nonZero.length) errors.push(m('التحويل ليس إيراداً ولا نفقة', 'A transfer is neither income nor expense'));
    if (!hasTrf) errors.push(m('أدخل مبلغ التحويل', 'Enter the transfer amount'));
    else if (t.trf_syp !== 0 && t.trf_usd !== 0) errors.push(m('عملة واحدة في كل سطر تحويل', 'One currency per transfer row'));
    const book = lists.books.find((b) => b.id === t.book_id);
    if (book?.is_main)
      errors.push(m('التحويل يُسجَّل على دفتر الأمين لا على الرئيسي', "A transfer is booked on the keeper's book, not on Main"));
  }

  if (t.type === 'Exchange') {
    if (nonZero.length) errors.push(m('التصريف ليس إيراداً ولا نفقة', 'An exchange is neither income nor expense'));
    if (!(t.trf_syp > 0) || !(t.trf_usd > 0))
      errors.push(m('التصريف: الليرات المقبوضة والدولارات المدفوعة كلاهما مطلوب', 'Exchange: both SYP received and USD given are required'));
    else if (t.date && isDate(t.date)) {
      const others = ctx.rows.filter((r) => r.id !== t.id);
      const last = rateOn(others, t.book_id, t.date, lists.settings.usd_rate);
      const rate = t.trf_syp / t.trf_usd;
      const tol = lists.settings.exchange_tolerance;
      if (last > 0 && Math.abs(rate - last) / last > tol)
        warnings.push(
          m(
            `السعر ${fmtRate(rate)} بعيد عن آخر سعر ${fmtRate(last)} — تحقق من الأصفار`,
            `Rate ${fmtRate(rate)} is far from the last rate ${fmtRate(last)} — check the zeros`,
          ),
        );
    }
  }

  // ---- Probable duplicate: same date, type, amount, party, book
  if (t.date) {
    const sig = (r: Trx) =>
      [r.date, r.type, r.book_id, r.party_id, r.inc_syp, r.exp_syp, r.inc_usd, r.exp_usd, r.trf_syp, r.trf_usd].join('|');
    const mine = sig(t);
    const dup = ctx.rows.find((r) => r.id !== t.id && sig(r) === mine);
    if (dup)
      warnings.push(
        m(
          `قد يكون مكرراً: سطر ${dup.n ?? '—'} بنفس التاريخ والمبلغ والجهة`,
          `Possible duplicate of row ${dup.n ?? '—'} (same date, amount, party, book)`,
        ),
      );
  }

  return { errors, warnings };
}

const fmtRate = (r: number) => (Math.round(r * 100) / 100).toLocaleString('en-US');
