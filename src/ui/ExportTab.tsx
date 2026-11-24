import { useState } from 'react';
import { useApp } from '../state';
import { exportWorkbook } from '../io/exportExcel';
import { saveFile } from '../platform';
import { Field, Select, errText, t, toast, todayIso } from './kit';

// Export to Excel: the register (a Transactions sheet in the workbook's column order), with a month or a period, a book,
// a project, and the lists / reports / confidential parts (the donors and grants only for the Administrator).
// It lives in Reports (Fouad, 25 November 2026); the start from the Excel workbook is in Settings.
export function ExportTab() {
  const { s, d, can } = useApp();
  const isSup = can('lists.donors');
  const years = [...new Set(d.rows.map((r) => r.date?.slice(0, 4)).filter(Boolean) as string[])].sort();
  const y = years[years.length - 1] ?? todayIso().slice(0, 4);
  const [when, setWhen] = useState<'all' | 'month' | 'range'>('all');
  const [month, setMonth] = useState(`${y}-${todayIso().slice(5, 7)}`);
  const [from, setFrom] = useState(`${y}-01`);
  const [to, setTo] = useState(`${y}-12`);
  const [book, setBook] = useState<number | null>(null);
  const [account, setAccount] = useState<number | null>(null);
  const [registerOnly, setRegisterOnly] = useState(false);
  const [withLists, setWithLists] = useState(true);
  const [withReports, setWithReports] = useState(true);
  const [confidential, setConfidential] = useState(false);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const period = when === 'all' ? null : when === 'month' ? { from: month, to: month } : { from, to };
      const bytes = await exportWorkbook(d.rows, d.comp, { ...d.lists, books: d.shownBooks }, {
        period, bookId: book, accountId: account, registerOnly, withLists, withReports,
        confidential: isSup && confidential, grants: isSup && confidential ? d.grants : [], grantParts: isSup && confidential ? d.grantParts : [], organisation: s.organisation,
      });
      const name = `${registerOnly ? 'register-BQ' : 'accounts'}-${todayIso()}.xlsx`;
      const path = await saveFile(name, ['xlsx'], bytes, t('احفظ ملف Excel', 'Save the Excel file'));
      if (path) toast(t('صُدّر', 'Exported') + ': ' + path);
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const books = d.shownBooks.map((b) => ({ value: b.id, label: b.name }));
  const accounts = d.lists.accounts.map((b) => ({ value: b.id, label: b.name }));

  return (
    <div className="panel">
      <h2>{t('تصدير السجل إلى Excel', 'Export the register to Excel')}</h2>
      <p className="muted small">{t('ورقة Transactions بجدول TRX بنفس ترتيب الأعمدة تماماً، قيم بلا معادلات. أما تقرير على الشاشة فزر «Excel» فوقه.', 'A Transactions sheet with a TRX table in exactly the same column order — values, no formulas. For a report as shown on the screen, use the "Excel" button above it.')}</p>
      <div className="grid4">
        <Field label={t('الفترة', 'Period')}>
          <select className="inp" value={when} onChange={(e) => setWhen(e.target.value as typeof when)}>
            <option value="all">{t('كل الفترات', 'All periods')}</option>
            <option value="month">{t('شهر واحد', 'One month')}</option>
            <option value="range">{t('من شهر إلى شهر', 'From month to month')}</option>
          </select>
        </Field>
        {when === 'month' && <Field label={t('الشهر', 'Month')}><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>}
        {when === 'range' && <Field label={t('من شهر', 'From month')}><input type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>}
        {when === 'range' && <Field label={t('إلى شهر', 'To month')}><input type="month" value={to} onChange={(e) => setTo(e.target.value)} /></Field>}
        <Field label={t('الدفتر', 'Book')}><Select value={book} options={books} onChange={setBook} placeholder={t('الكل', 'All')} /></Field>
        <Field label={t('المشروع', 'Project')}><Select value={account} options={accounts} onChange={setAccount} placeholder={t('الكل', 'All')} /></Field>
      </div>
      <div className="row" style={{ marginTop: 12, gap: 18 }}>
        <label className="row"><input type="checkbox" checked={registerOnly} onChange={(e) => setRegisterOnly(e.target.checked)} /> {t('السجل فقط (B:Q + Entry_ID) للصق في الملف القديم', 'Register only (B:Q + Entry_ID) to paste into the old workbook')}</label>
        {!registerOnly && <label className="row"><input type="checkbox" checked={withLists} onChange={(e) => setWithLists(e.target.checked)} /> {t('القوائم', 'Lists')}</label>}
        {!registerOnly && <label className="row"><input type="checkbox" checked={withReports} onChange={(e) => setWithReports(e.target.checked)} /> {t('التقارير', 'Reports')}</label>}
        {!registerOnly && isSup && <label className="row"><input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} /> {t('السرّي (المانحون والمنح)', 'Confidential (donors and grants)')}</label>}
      </div>
      <div className="modal-foot"><button className="btn primary" disabled={busy} onClick={doExport}>{t('تصدير…', 'Export…')}</button></div>
    </div>
  );
}
