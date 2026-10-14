// First screen when no database is open: create the office database, set up
// a holder's computer, or open an existing file.
import { useState } from 'react';
import ExcelJS from 'exceljs';
import { invoke } from '@tauri-apps/api/core';
import type { Db } from '../db/db';
import { tauriDb } from '../db/tauriDb';
import { createHolder, createOffice } from '../setup';
import { applySeed, readWorkbook, type ImportReport } from '../io/importWorkbook';
import { parseListsPackage, type ListsPackage } from '../io/keeperFiles';
import { baseName, isDesktop, pickExistingDbPath, pickFile, pickNewDbPath } from '../platform';
import { Field, errText, t } from './kit';

type Mode = 'choose' | 'office' | 'holder';

export function Welcome({ onCreated, onOpenPath, newWebDb, bootErr }: {
  onCreated: (db: Db, path: string | null) => Promise<void>;
  onOpenPath: (path: string) => Promise<void>;
  newWebDb: () => Promise<Db>;
  bootErr: string | null;
}) {
  const [mode, setMode] = useState<Mode>('choose');
  const [err, setErr] = useState<string | null>(bootErr);

  const openExisting = async () => {
    try {
      const p = await pickExistingDbPath(t('افتح ملف قاعدة البيانات', 'Open the database file'));
      if (p) await onOpenPath(p);
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <div className="center-page">
      <div className="welcome">
        <h1>{t('حسابات ماجيس', 'MAGIS Accounts')}</h1>
        <p className="muted">{t('الصندوق النقدي بالليرة والدولار — بلا إنترنت', 'Cash accounts in SYP and USD — fully offline')}</p>
        {err && <div className="alert err">{err}</div>}
        {mode === 'choose' && (
          <div className="choice">
            <button onClick={() => setMode('office')}>
              <b>{t('قاعدة المكتب', 'Office database')}</b>
              <span className="muted small">{t('للرئيس والمحاسب. تبدأ من ملف Excel الحالي.', 'For the Superior and the Accountant. Starts from your current Excel workbook.')}</span>
            </button>
            <button onClick={() => setMode('holder')}>
              <b>{t('حاسوب أمين صندوق', "A cash holder's computer")}</b>
              <span className="muted small">{t('يحتاج حزمة القوائم التي يرسلها المكتب.', 'Needs the lists package sent by the office.')}</span>
            </button>
            <button onClick={openExisting} disabled={!isDesktop()}>
              <b>{t('فتح ملف موجود', 'Open an existing file')}</b>
              <span className="muted small">{t('ملف ‎.db أنشئ سابقاً', 'A .db file created before')}</span>
            </button>
          </div>
        )}
        {mode === 'office' && <OfficeForm onBack={() => setMode('choose')} onCreated={onCreated} newWebDb={newWebDb} />}
        {mode === 'holder' && <HolderForm onBack={() => setMode('choose')} onCreated={onCreated} newWebDb={newWebDb} />}
      </div>
    </div>
  );
}

async function newDb(newWebDb: () => Promise<Db>, defaultName: string): Promise<{ db: Db; path: string | null } | null> {
  if (!isDesktop()) return { db: await newWebDb(), path: null };
  const path = await pickNewDbPath(defaultName, t('أين يُحفظ ملف قاعدة البيانات؟', 'Where should the database file be saved?'));
  if (!path) return null;
  if (await invoke<boolean>('file_exists', { path })) throw new Error(t('الملف موجود: اختر اسماً جديداً', 'That file already exists: choose a new name'));
  await invoke('db_open', { path });
  return { db: tauriDb, path };
}

function OfficeForm({ onBack, onCreated, newWebDb }: { onBack: () => void; onCreated: (db: Db, path: string | null) => Promise<void>; newWebDb: () => Promise<Db> }) {
  const [f, setF] = useState({ organisation: 'MAGIS Homs', supName: '', supPin: '', supPin2: '', comName: '', comPin: '', comPin2: '' });
  const [fromWorkbook, setFromWorkbook] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<{ r: ImportReport; db: Db; path: string | null } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const go = async () => {
    setErr(null);
    if (!f.supName.trim() || !f.comName.trim()) return setErr(t('اكتب الاسمين', 'Write both names'));
    if (f.supPin !== f.supPin2 || f.comPin !== f.comPin2) return setErr(t('كلمة السر وتأكيدها مختلفان', 'Password and confirmation differ'));
    setBusy(true);
    try {
      let wbFile = null;
      if (fromWorkbook) {
        wbFile = await pickFile(['xlsx'], t('اختر ملف Excel (Master Sup أو Master Com)', 'Choose the Excel workbook (Master Sup or Master Com)'));
        if (!wbFile) return;
      }
      const target = await newDb(newWebDb, `${f.organisation.replace(/[^\w؀-ۿ -]/g, '').trim() || 'centre'}.db`);
      if (!target) return;
      await createOffice(target.db, f);
      if (wbFile) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(wbFile.bytes);
        const r = await applySeed(target.db, readWorkbook(wb), f.comName.trim() || 'setup', wbFile.name);
        setReport({ r, db: target.db, path: target.path });
      } else await onCreated(target.db, target.path);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (report)
    return (
      <div className="panel">
        <h2>{t('تم النقل من Excel', 'Migrated from Excel')}</h2>
        <MigrationReport r={report.r} />
        <div className="modal-foot">
          <button className="btn primary" onClick={() => onCreated(report.db, report.path)}>
            {t('متابعة', 'Continue')}
          </button>
        </div>
      </div>
    );

  return (
    <div className="panel">
      <h2>{t('قاعدة المكتب', 'Office database')}</h2>
      <div className="grid2">
        <Field label={t('اسم المركز', 'Centre name')} className="span2">
          <input value={f.organisation} onChange={set('organisation')} />
        </Field>
        <Field label={t('اسم الرئيس (وصول كامل)', 'Superior — full access')}>
          <input value={f.supName} onChange={set('supName')} />
        </Field>
        <div className="grid2">
          <Field label={t('كلمة السر', 'Password')}><input type="password" value={f.supPin} onChange={set('supPin')} /></Field>
          <Field label={t('تأكيد', 'Again')}><input type="password" value={f.supPin2} onChange={set('supPin2')} /></Field>
        </div>
        <Field label={t('اسم المحاسب (بلا المانحين والتغطية)', 'Accountant — all except donors & coverage')}>
          <input value={f.comName} onChange={set('comName')} />
        </Field>
        <div className="grid2">
          <Field label={t('كلمة السر', 'Password')}><input type="password" value={f.comPin} onChange={set('comPin')} /></Field>
          <Field label={t('تأكيد', 'Again')}><input type="password" value={f.comPin2} onChange={set('comPin2')} /></Field>
        </div>
        <label className="row span2">
          <input type="checkbox" checked={fromWorkbook} onChange={(e) => setFromWorkbook(e.target.checked)} />
          {t('ابدأ من ملف Excel الحالي: القوائم والموازنة والسجل كله', 'Start from the current Excel workbook: lists, budget and the whole register')}
        </label>
      </div>
      <p className="muted small">{t('كلمة السر 6 أحرف أو أرقام على الأقل.', 'Passwords: at least 6 characters.')}</p>
      {err && <div className="alert err">{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onBack}>{t('رجوع', 'Back')}</button>
        <button className="btn primary" disabled={busy} onClick={go}>{busy ? '…' : t('إنشاء', 'Create')}</button>
      </div>
    </div>
  );
}

export function MigrationReport({ r }: { r: ImportReport }) {
  return (
    <>
      <div className="alert ok">
        {t(`نُقل ${r.rows} سطراً من السجل.`, `${r.rows} register rows imported, exactly as they were.`)}
      </div>
      {r.toReview > 0 && (
        <div className="alert warn">
          {t(
            `${r.toReview} سطراً بحاجة إلى مراجعة (بلا تاريخ، أو بلا خط موازنة، أو بمبلغين…). ستجدها في السجل تحت «للمراجعة». لم يُحذف شيء.`,
            `${r.toReview} rows need review (no date, no budget line, two amounts…). Find them in the Register under "To review". Nothing was dropped.`,
          )}
        </div>
      )}
      {r.addedToLists.length > 0 && (
        <div className="alert info">
          {t('قيم في السجل لم تكن في القوائم، فأضيفت:', 'Values used in the register but missing from the lists were added:')}
          <ul>{r.addedToLists.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {r.warnings.length > 0 && (
        <div className="alert warn"><ul>{r.warnings.map((x) => <li key={x}>{x}</li>)}</ul></div>
      )}
    </>
  );
}

function HolderForm({ onBack, onCreated, newWebDb }: { onBack: () => void; onCreated: (db: Db, path: string | null) => Promise<void>; newWebDb: () => Promise<Db> }) {
  const [pkg, setPkg] = useState<ListsPackage | null>(null);
  const [pkgName, setPkgName] = useState('');
  const [bookId, setBookId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const books = (pkg?.tables.book ?? []).filter((b) => !b.is_main && b.active) as { id: number; name: string; keeper_name: string | null }[];

  const load = async () => {
    setErr(null);
    try {
      const f = await pickFile(['json'], t('اختر حزمة القوائم من المكتب', 'Choose the lists package from the office'));
      if (!f) return;
      setPkg(parseListsPackage(new TextDecoder().decode(f.bytes)));
      setPkgName(f.name);
    } catch (e) {
      setErr(errText(e));
    }
  };

  const go = async () => {
    if (!pkg || bookId == null) return;
    if (pin !== pin2) return setErr(t('كلمة السر وتأكيدها مختلفان', 'Password and confirmation differ'));
    setBusy(true);
    try {
      const book = books.find((b) => b.id === bookId)!;
      const target = await newDb(newWebDb, `${book.name}.db`);
      if (!target) return;
      await createHolder(target.db, pkg, bookId, name || book.keeper_name || book.name, pin);
      await onCreated(target.db, target.path);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>{t('حاسوب أمين صندوق', "A cash holder's computer")}</h2>
      <ol className="muted">
        <li>{t('يرسل المكتب «حزمة القوائم» (ملف ‎.json).', 'The office sends the "lists package" (a .json file).')}</li>
        <li>{t('اختر دفترك، واكتب كلمة سر.', 'Choose your book and a password.')}</li>
      </ol>
      <div className="row">
        <button className="btn" onClick={load}>{t('اختيار حزمة القوائم…', 'Choose lists package…')}</button>
        {pkg && <span className="ok">✓ {baseName(pkgName)}</span>}
      </div>
      {pkg && (
        <div className="grid3" style={{ marginTop: 14 }}>
          <Field label={t('دفتري', 'My book')}>
            <select value={bookId ?? ''} onChange={(e) => {
              const id = Number(e.target.value);
              setBookId(id);
              setName(books.find((b) => b.id === id)?.keeper_name ?? '');
            }}>
              <option value="">—</option>
              {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label={t('اسمي', 'My name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid2">
            <Field label={t('كلمة السر', 'Password')}><input type="password" value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
            <Field label={t('تأكيد', 'Again')}><input type="password" value={pin2} onChange={(e) => setPin2(e.target.value)} /></Field>
          </div>
        </div>
      )}
      {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onBack}>{t('رجوع', 'Back')}</button>
        <button className="btn primary" disabled={busy || !pkg || bookId == null || !pin} onClick={go}>{t('إنشاء', 'Create')}</button>
      </div>
    </div>
  );
}
