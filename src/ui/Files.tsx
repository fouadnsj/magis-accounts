import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { exportWorkbook } from '../io/exportExcel';
import type { ImportReport } from '../io/importWorkbook';
import { entriesFileName, listsFileName, parseListsPackage, type EntriesImportResult } from '../io/keeperFiles';
import type { ImportLogRow } from '../ops';
import { pickFile, saveFile, toBase64 } from '../platform';
import { Field, Select, confirmBox, errText, fmtDate, t, toast, todayIso } from './kit';
import { MigrationReport } from './Welcome';

const enc = (s: string) => new TextEncoder().encode(s);

export function Files() {
  const { fileHolder } = useApp();
  return (
    <>
      <div className="page-head"><h1>{t('استيراد وتصدير', 'Import / Export')}</h1></div>
      {fileHolder ? <HolderFiles /> : <OfficeFiles />}
    </>
  );
}

function HolderFiles() {
  const { s, d, myBook, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const book = d.lists.books.find((b) => b.id === myBook);
  const unsent = d.rows.filter((r) => !r.sent_at).length;

  const exp = async () => {
    setBusy(true);
    try {
      const { file, unsentIds } = await s.api.call('entries.build');
      const path = await saveFile(entriesFileName(book?.name ?? 'book'), ['json'], enc(JSON.stringify(file, null, 1)), t('احفظ ملف القيود', 'Save the entries file'));
      if (!path) return; // cancelled: nothing left the computer, nothing is marked as sent
      await s.api.call('entries.markSent', { ids: unsentIds, total: file.rows.length });
      await reload();
      toast(t(`صُدّر ${file.rows.length} قيداً (${unsentIds.length} جديد)`, `${file.rows.length} entries exported (${unsentIds.length} new)`));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const imp = async () => {
    const f = await pickFile(['json'], t('اختر حزمة القوائم من المكتب', 'Choose the lists package from the office'));
    if (!f) return;
    try {
      const p = parseListsPackage(new TextDecoder().decode(f.bytes));
      await s.api.call('lists.apply', { pkg: p });
      await reload();
      toast(t('حُدّثت القوائم', 'Lists updated'));
    } catch (e) {
      toast(errText(e), true);
    }
  };

  return (
    <div className="grid2">
      <div className="panel">
        <h2>{t('إرسال قيودي إلى المكتب', 'Send my entries to the office')}</h2>
        <p className="muted">{t('يحفظ ملفاً فيه كل قيود دفتري. أرسله إلى المحاسب. يمكن إرسال الملف نفسه مرتين: لا يتكرر شيء.', 'Saves a file with all the entries of my book. Send it to the accountant. Sending the same file twice is safe: nothing is doubled.')}</p>
        <p>{unsent ? <span className="warn">{t(`${unsent} قيداً جديداً`, `${unsent} new entries`)}</span> : <span className="ok">✓ {t('كل القيود أُرسلت', 'All entries sent')}</span>}</p>
        <p className="muted small">{t('بعد الإرسال لا يُعدَّل القيد هنا؛ للتصحيح أضف قيداً جديداً.', 'Once sent, an entry cannot be changed here; to correct it, add a new entry.')}</p>
        <button className="btn primary" disabled={busy} onClick={exp}>{t('تصدير القيود…', 'Export entries…')}</button>
      </div>
      <div className="panel">
        <h2>{t('تحديث القوائم', 'Update the lists')}</h2>
        <p className="muted">{t('حين يرسل المكتب حزمة قوائم جديدة (موازنة، جهات…).', 'When the office sends a new lists package (budget, parties…).')}</p>
        <p className="small">{t('النسخة الحالية', 'Current version')}: <span className="ltr">{d.listsVersion ? fmtDate(d.listsVersion.slice(0, 10)) + ' ' + d.listsVersion.slice(11, 16) : '—'}</span></p>
        <button className="btn" onClick={imp}>{t('استيراد حزمة القوائم…', 'Import lists package…')}</button>
      </div>
    </div>
  );
}


function OfficeFiles() {
  const { s, d, reload, can } = useApp();
  const isSup = can('lists.donors') || can('reports.coverage');
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
  const [result, setResult] = useState<EntriesImportResult | null>(null);
  const [seedReport, setSeedReport] = useState<ImportReport | null>(null);
  const [log, setLog] = useState<ImportLogRow[]>([]);

  useEffect(() => {
    s.api.call('importLog.list').then(setLog).catch(() => undefined);
  }, [s.api, d]);

  const doExport = async () => {
    setBusy(true);
    try {
      const bytes = await exportWorkbook(d.rows, d.comp, d.lists, {
        period: allPeriod ? null : { from, to }, bookId: book, accountId: account, registerOnly, withLists, withReports,
        confidential: isSup && confidential, grants: isSup && confidential ? d.grants : [], organisation: s.organisation,
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

  const doImportEntries = async () => {
    const f = await pickFile(['json'], t('اختر ملف قيود الأمين', "Choose the holder's entries file"));
    if (!f) return;
    setBusy(true);
    try {
      const r = await s.api.call('entries.import', { text: new TextDecoder().decode(f.bytes), fileName: f.name });
      setResult(r);
      await reload();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const doListsPackage = async () => {
    try {
      const p = await s.api.call('lists.export');
      const path = await saveFile(listsFileName(), ['json'], enc(JSON.stringify(p)), t('احفظ حزمة القوائم', 'Save the lists package'));
      if (path) toast(t('حُفظت حزمة القوائم', 'Lists package saved'));
      await reload();
    } catch (e) {
      toast(errText(e), true);
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
          {!registerOnly && isSup && <label className="row"><input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} /> {t('السرّي (المانحون، المنح، التغطية)', 'Confidential (donors, grants, coverage)')}</label>}
        </div>
        <div className="modal-foot"><button className="btn primary" disabled={busy} onClick={doExport}>{t('تصدير…', 'Export…')}</button></div>
      </div>}

      {/* Files between holders and the office: only for desktop installs. On the server everybody shares one database. */}
      {s.mode !== 'server' && can('data.import') && <div className="grid2">
        <div className="panel">
          <h2>{t('استيراد قيود أمين', "Import a holder's entries")}</h2>
          <p className="muted small">{t('ملف ‎.json يرسله الأمين. ما سبق استيراده يُتخطى ويُذكر. نسخة احتياطية تُؤخذ قبل الاستيراد.', 'The .json file a holder sends. Rows already imported are skipped and listed. A backup is taken first.')}</p>
          <button className="btn primary" disabled={busy} onClick={doImportEntries}>{t('استيراد…', 'Import…')}</button>
          {result && (
            <div style={{ marginTop: 12 }}>
              <div className="alert ok">{t(`${result.book}: أضيف ${result.added}`, `${result.book}: ${result.added} added`)}</div>
              {result.toReview > 0 && <div className="alert warn">{t(`${result.toReview} للمراجعة في السجل`, `${result.toReview} to review in the Register`)}</div>}
              {result.skipped.length > 0 && (
                <div className="alert info">
                  {t(`${result.skipped.length} سبق استيرادها — تُخطّيت:`, `${result.skipped.length} already imported — skipped:`)}
                  <div className="code" style={{ maxHeight: 120, overflowY: 'auto' }}>{result.skipped.map((x) => <div key={x}>{x}</div>)}</div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="panel">
          <h2>{t('حزمة القوائم للأمناء', 'Lists package for holders')}</h2>
          <p className="muted small">{t('الدفاتر والموازنة والجهات والإعدادات، والتحويلات المسجلة لكل دفتر. بلا مانحين ولا منح.', 'Books, budget, parties, settings, and the transfers booked for each book. No donors, no grants.')}</p>
          <button className="btn" onClick={doListsPackage}>{t('حفظ الحزمة…', 'Save package…')}</button>
        </div>
      </div>}

      {!d.rows.length && can('data.import') && (
        <div className="panel">
          <h2>{t('البدء من ملف Excel', 'Start from the Excel workbook')}</h2>
          <button className="btn" disabled={busy} onClick={doSeed}>{t('استيراد Master Sup / Master Com…', 'Import Master Sup / Master Com…')}</button>
          {seedReport && <div style={{ marginTop: 12 }}><MigrationReport r={seedReport} /></div>}
        </div>
      )}

      {log.length > 0 && can('data.import') && (
        <div className="panel">
          <h3>{t('سجل الاستيراد', 'Import log')}</h3>
          <table className="t">
            <thead><tr><th>{t('متى', 'When')}</th><th>{t('من', 'Who')}</th><th>{t('النوع', 'Kind')}</th><th>{t('الملف', 'File')}</th><th className="n">{t('أضيف', 'Added')}</th><th className="n">{t('تُخطّي', 'Skipped')}</th></tr></thead>
            <tbody>{log.map((l) => <tr key={l.id}><td className="ltr">{l.at.slice(0, 16).replace('T', ' ')}</td><td>{l.who}</td><td>{l.kind}</td><td>{l.file_name}</td><td className="n">{l.added}</td><td className="n">{l.skipped}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
