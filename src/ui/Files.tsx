import { useState } from 'react';
import { useApp } from '../state';
import { exportWorkbook } from '../io/exportExcel';
import type { ImportReport } from '../io/importWorkbook';
import { pickFile, saveFile, toBase64 } from '../platform';
import { Field, Select, confirmBox, errText, t, toast, todayIso } from './kit';
import { MigrationReport } from './Welcome';

// Export to Excel (and, on an empty database, starting from the Excel workbook).
// Everybody works in the same database (the server), so no files go between holders and the office.
export function Files() {
  return (
    <>
      <div className="page-head"><h1>{t('التصدير', 'Export')}</h1></div>
      <OfficeFiles />
    </>
  );
}

function OfficeFiles() {
  const { s, d, reload, can } = useApp();
  const isSup = can('lists.donors');
  const years = [...new Set(d.rows.map((r) => r.date?.slice(0, 4)).filter(Boolean) as string[])].sort();
  const y = years[years.length - 1] ?? todayIso().slice(0, 4);
  const [allPeriod, setAllPeriod] = useState(true);
  const [from, setFrom] = useState(`${y}-01`);
  const [to, setTo] = useState(`${y}-12`);
  const [book, setBook] = useState<number | null>(null);
  const [account, setAccount] = useState<number | null>(null);
  const [registerOnly, setRegisterOnly] = useState(false);
  const [withLists, setWithLists] = useState(true);
  const [withReports, setWithReports] = useState(true);
  const [confidential, setConfidential] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seedReport, setSeedReport] = useState<ImportReport | null>(null);

  const doExport = async () => {
    setBusy(true);
    try {
      const bytes = await exportWorkbook(d.rows, d.comp, d.lists, {
        period: allPeriod ? null : { from, to }, bookId: book, accountId: account, registerOnly, withLists, withReports,
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

  const doSeed = async () => {
    if (d.rows.length) return toast(t('السجل ليس فارغاً', 'The register is not empty'), true);
    if (!(await confirmBox(t('ستحل قوائم ملف Excel محل القوائم الحالية. متابعة؟', "The workbook's lists will replace the current lists. Continue?")))) return;
    const f = await pickFile(['xlsx'], t('اختر ملف Excel', 'Choose the Excel workbook'));
    if (!f) return;
    setBusy(true);
    try {
      setSeedReport(await s.api.call('workbook.import', { base64: toBase64(f.bytes), fileName: f.name }));
      await reload();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const books = d.lists.books.map((b) => ({ value: b.id, label: b.name }));
  const accounts = d.lists.accounts.map((b) => ({ value: b.id, label: b.name }));

  return (
    <>
      {can('data.export') && <div className="panel">
        <h2>{t('تصدير إلى Excel', 'Export to Excel')}</h2>
        <p className="muted small">{t('ورقة Transactions بجدول TRX بنفس ترتيب الأعمدة تماماً، قيم بلا معادلات.', 'A Transactions sheet with a TRX table in exactly the same column order — values, no formulas.')}</p>
        <div className="grid4">
          <label className="row"><input type="checkbox" checked={allPeriod} onChange={(e) => setAllPeriod(e.target.checked)} /> {t('كل الفترات', 'All periods')}</label>
          <Field label={t('من شهر', 'From month')}><input type="month" disabled={allPeriod} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('إلى شهر', 'To month')}><input type="month" disabled={allPeriod} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div />
          <Field label={t('الدفتر', 'Book')}><Select value={book} options={books} onChange={setBook} placeholder={t('الكل', 'All')} /></Field>
          <Field label={t('الحساب', 'Account')}><Select value={account} options={accounts} onChange={setAccount} placeholder={t('الكل', 'All')} /></Field>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 18 }}>
          <label className="row"><input type="checkbox" checked={registerOnly} onChange={(e) => setRegisterOnly(e.target.checked)} /> {t('السجل فقط (B:Q + Entry_ID) للصق في الملف القديم', 'Register only (B:Q + Entry_ID) to paste into the old workbook')}</label>
          {!registerOnly && <label className="row"><input type="checkbox" checked={withLists} onChange={(e) => setWithLists(e.target.checked)} /> {t('القوائم', 'Lists')}</label>}
          {!registerOnly && <label className="row"><input type="checkbox" checked={withReports} onChange={(e) => setWithReports(e.target.checked)} /> {t('التقارير', 'Reports')}</label>}
          {!registerOnly && isSup && <label className="row"><input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} /> {t('السرّي (المانحون والمنح)', 'Confidential (donors and grants)')}</label>}
        </div>
        <div className="modal-foot"><button className="btn primary" disabled={busy} onClick={doExport}>{t('تصدير…', 'Export…')}</button></div>
      </div>}

      {!d.rows.length && can('data.import') && (
        <div className="panel">
          <h2>{t('البدء من ملف Excel', 'Start from the Excel workbook')}</h2>
          <button className="btn" disabled={busy} onClick={doSeed}>{t('استيراد Master Sup / Master Com…', 'Import Master Sup / Master Com…')}</button>
          {seedReport && <div style={{ marginTop: 12 }}><MigrationReport r={seedReport} /></div>}
        </div>
      )}

    </>
  );
}
