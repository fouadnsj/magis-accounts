// First start of the centre's server: bring the data in.
// Only possible on the server computer itself, and only while it has no user.
import { useState } from 'react';
import type { Hello } from '../net';
import { pickFile, toBase64 } from '../platform';
import type { ImportReport } from '../io/importWorkbook';
import { Field, errText, t } from './kit';
import { MigrationReport } from './Welcome';

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.en ?? 'Error'), { msg: j.error });
  return j;
}

export function ServerSetup({ hello }: { hello: Hello }) {
  const [mode, setMode] = useState<'choose' | 'upload' | 'new'>('choose');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [f, setF] = useState({ organisation: 'MAGIS Homs', supName: '', supPin: '', comName: '', comPin: '' });
  const [wbName, setWbName] = useState<string | null>(null);
  const [wb64, setWb64] = useState<string | null>(null);

  if (!hello.local)
    return (
      <div className="center-page">
        <div className="panel" style={{ maxWidth: 520 }}>
          <h1>{t('الخادم غير مُعدّ بعد', 'The server is not set up yet')}</h1>
          <p>{t('افتح هذه الصفحة على حاسوب الخادم نفسه: https://localhost:8443', 'Open this page on the server computer itself: https://localhost:8443')}</p>
        </div>
      </div>
    );

  const done = () => window.location.reload();

  const uploadDb = async () => {
    setErr(null);
    const file = await pickFile(['db'], t('اختر ملف قاعدة المكتب', 'Choose the office database file'));
    if (!file) return;
    setBusy(true);
    try {
      await post('/api/setup/upload-db', { base64: toBase64(file.bytes) });
      done();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await post('/api/setup/new', { ...f, workbook: wb64, workbookName: wbName });
      if (r.report) setReport(r.report);
      else done();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <div className="welcome">
        <h1>{t('إعداد خادم المركز', "Setting up the centre's server")}</h1>
        <p className="muted">{t('مرة واحدة فقط. بعدها يفتح الجميع البرنامج من المتصفح.', 'Only once. Afterwards everyone opens the program from a browser.')}</p>
        {err && <div className="alert err">{err}</div>}
        {report ? (
          <div className="panel">
            <MigrationReport r={report} />
            <div className="modal-foot"><button className="btn primary" onClick={done}>{t('متابعة', 'Continue')}</button></div>
          </div>
        ) : mode === 'choose' ? (
          <div className="choice" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <button onClick={() => setMode('upload')}>
              <b>{t('نقل قاعدة المكتب الحالية', 'Move the current office database')}</b>
              <span className="muted small">{t('الملف ‎.db الذي يستعمله البرنامج المكتبي الآن (موصى به).', 'The .db file the desktop program uses now (recommended).')}</span>
            </button>
            <button onClick={() => setMode('new')}>
              <b>{t('قاعدة جديدة', 'A new database')}</b>
              <span className="muted small">{t('من ملف Excel، أو فارغة.', 'From the Excel workbook, or empty.')}</span>
            </button>
          </div>
        ) : mode === 'upload' ? (
          <div className="panel">
            <ol>
              <li>{t('على حاسوب المكتب: البرنامج ← الإدارة ← النسخ الاحتياطية ← «نسخة الآن».', 'On the office computer: program → Admin → Backups → "Back up now".')}</li>
              <li>{t('انسخ ملف ‎.db (أو النسخة الأخيرة من مجلد backups) إلى هذا الحاسوب.', 'Copy the .db file (or the latest copy from the backups folder) to this computer.')}</li>
              <li>{t('اختره هنا. المستخدمون وكلمات السر تبقى كما هي.', 'Choose it here. Users and passwords stay the same.')}</li>
            </ol>
            <div className="modal-foot">
              <button className="btn" onClick={() => setMode('choose')}>{t('رجوع', 'Back')}</button>
              <button className="btn primary" disabled={busy} onClick={uploadDb}>{busy ? '…' : t('اختيار الملف…', 'Choose the file…')}</button>
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="grid2">
              <Field label={t('اسم المركز', 'Centre name')} className="span2"><input value={f.organisation} onChange={(e) => setF({ ...f, organisation: e.target.value })} /></Field>
              <Field label={t('اسم الرئيس', 'Superior name')}><input value={f.supName} onChange={(e) => setF({ ...f, supName: e.target.value })} /></Field>
              <Field label={t('كلمة سره (6+)', 'Password (6+)')}><input type="password" value={f.supPin} onChange={(e) => setF({ ...f, supPin: e.target.value })} /></Field>
              <Field label={t('اسم المحاسب', 'Accountant name')}><input value={f.comName} onChange={(e) => setF({ ...f, comName: e.target.value })} /></Field>
              <Field label={t('كلمة سره (6+)', 'Password (6+)')}><input type="password" value={f.comPin} onChange={(e) => setF({ ...f, comPin: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={async () => {
                const file = await pickFile(['xlsx'], t('اختر ملف Excel', 'Choose the Excel workbook'));
                if (file) {
                  setWbName(file.name);
                  setWb64(toBase64(file.bytes));
                }
              }}>{t('ملف Excel (اختياري)…', 'Excel workbook (optional)…')}</button>
              {wbName && <span className="ok">✓ {wbName}</span>}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setMode('choose')}>{t('رجوع', 'Back')}</button>
              <button className="btn primary" disabled={busy || !f.supName.trim() || !f.comName.trim()} onClick={create}>{busy ? '…' : t('إنشاء', 'Create')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
