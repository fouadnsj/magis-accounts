// Setting up a new database on the server: bring the data in.
// Allowed on the server computer itself, or to someone who manages users.
import { useState } from 'react';
import { serverSetup, type DbInfo } from '../net';
import { pickFile, toBase64 } from '../platform';
import type { ImportReport } from '../io/importWorkbook';
import { Field, errText, t } from './kit';
import { MigrationReport } from './Welcome';
import { BrandFrame } from './Landing';
import { CommunityForm, CountryForm } from '../community/ui/NewCommunity';
import { t3 } from '../community/ui/text';

export function ServerSetup({ db, onDone, onBack, askGate }: { db: DbInfo; onDone: () => void; onBack: () => void; /** no communities' password on this server yet */ askGate?: boolean }) {
  // (a database made from the communities' side already says what it is: straight to its form)
  const fixed = db.kind === 'community' || db.kind === 'country' ? db.kind : null;
  const [mode, setMode] = useState<'choose' | 'upload' | 'new' | 'community' | 'country'>(fixed ?? 'choose');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [f, setF] = useState({ organisation: db.organisation, supName: '', supPin: '', comName: '', comPin: '' });
  const [wbName, setWbName] = useState<string | null>(null);
  const [wb64, setWb64] = useState<string | null>(null);

  const uploadDb = async () => {
    setErr(null);
    const file = await pickFile(['db'], t('اختر ملف قاعدة المكتب', 'Choose the office database file'));
    if (!file) return;
    setBusy(true);
    try {
      await serverSetup('upload-db', { db: db.slug, base64: toBase64(file.bytes) });
      onDone();
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
      const r = await serverSetup<{ report: ImportReport | null }>('new', { db: db.slug, ...f, workbook: wb64, workbookName: wbName });
      if (r.report) setReport(r.report);
      else onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BrandFrame brand={db} jesuit={mode === 'community' || mode === 'country'}>
      <div className={fixed ? '' : 'panel'}>
        <h2 style={fixed ? { display: 'none' } : undefined}>{t('إعداد', 'Setting up')} · {db.organisation}</h2>
        <p className="muted" style={fixed ? { display: 'none' } : undefined}>{t('مرة واحدة فقط. بعدها يفتح الجميع البرنامج من المتصفح.', 'Only once. Afterwards everyone opens the program from a browser.')}</p>
        {err && <div className="alert err">{err}</div>}
        {report ? (
          <>
            <MigrationReport r={report} />
            <div className="modal-foot"><button className="btn primary" onClick={onDone}>{t('متابعة', 'Continue')}</button></div>
          </>
        ) : mode === 'choose' ? (
          <>
            <div className="choice" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
              <button onClick={() => setMode('upload')}>
                <b>{t('من ملف البرنامج المكتبي', "From the desktop program's file")}</b>
                <span className="muted small">{t('ملف ‎.db (أو نسخة احتياطية منه): الحسابات والقوائم والمستخدمون كما هم.', 'A .db file (or a backup copy of it): accounts, lists and users as they are.')}</span>
              </button>
              <button onClick={() => setMode('new')}>
                <b>{t('قاعدة جديدة', 'A new database')}</b>
                <span className="muted small">{t('من ملف Excel، أو فارغة.', 'From the Excel workbook, or empty.')}</span>
              </button>
              {db.kind !== 'centre' && <><button onClick={() => setMode('community')}>
                <b>{t3('جماعة يسوعية', 'Jesuit community', 'Communauté jésuite')}</b>
                <span className="muted small">{t3('حسابات اليسوعيين وبيتهم.', 'The accounts of the Jesuits and their house.', 'Les comptes des jésuites et de leur maison.')}</span>
              </button>
              <button onClick={() => setMode('country')}>
                <b>{t3('قيم البلد', 'Country econome', "Économe du pays")}</b>
                <span className="muted small">{t3('ملفات الجماعات، المطالبات، المصالحة.', "The communities' files, claims, reconciliation.", 'Fichiers des communautés, réclamations, réconciliation.')}</span>
              </button></>}
            </div>
            <div className="modal-foot"><button className="btn" onClick={onBack}>{t('كل قواعد البيانات', 'All databases')}</button></div>
          </>
        ) : mode === 'community' ? (
          <CommunityForm askGate={askGate} initialName={db.organisation} onBack={() => (fixed ? onBack() : setMode('choose'))} onSubmit={async (s) => { await serverSetup('community', { db: db.slug, ...s }); onDone(); }} />
        ) : mode === 'country' ? (
          <CountryForm askGate={askGate} initialName={db.organisation} onBack={() => (fixed ? onBack() : setMode('choose'))} onSubmit={async (s) => { await serverSetup('country', { db: db.slug, ...s }); onDone(); }} />
        ) : mode === 'upload' ? (
          <>
            <ol>
              <li>{t('في البرنامج المكتبي: الإدارة ← النسخ الاحتياطية ← «نسخة الآن».', 'In the desktop program: Admin → Backups → "Back up now".')}</li>
              <li>{t('اختر الملف ‎.db أو النسخة الأخيرة من مجلد backups.', 'Choose the .db file, or the latest copy from the backups folder.')}</li>
            </ol>
            <div className="modal-foot">
              <button className="btn" onClick={() => setMode('choose')}>{t('رجوع', 'Back')}</button>
              <button className="btn primary" disabled={busy} onClick={uploadDb}>{busy ? '…' : t('اختيار الملف…', 'Choose the file…')}</button>
            </div>
          </>
        ) : (
          <>
            <div className="grid2">
              <Field label={t('الاسم', 'Name')} className="span2"><input value={f.organisation} onChange={(e) => setF({ ...f, organisation: e.target.value })} /></Field>
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
          </>
        )}
      </div>
    </BrandFrame>
  );
}
