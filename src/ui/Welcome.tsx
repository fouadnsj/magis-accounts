// First screen when no database is open: create the office database, set up
// a holder's computer, or open an existing file.
import { useEffect, useState } from 'react';
import ExcelJS from 'exceljs';
import { invoke } from '@tauri-apps/api/core';
import type { Db } from '../db/db';
import { tauriDb } from '../db/tauriDb';
import { createHolder, createOffice } from '../setup';
import { applySeed, readWorkbook, type ImportReport } from '../io/importWorkbook';
import { parseListsPackage, type ListsPackage } from '../io/keeperFiles';
import { baseName, getConfig, setConfig, isDesktop, pickExistingDbPath, pickFile, pickNewDbPath, type KnownDb } from '../platform';
import { Field, errText, t } from './kit';
import { BrandFrame, DbCard } from './Landing';
import { CommunityForm, CountryForm } from '../community/ui/NewCommunity';
import { createCountry } from '../community/country';
import { createCommunity } from '../community/setup';
import { t3 } from '../community/ui/text';

type Mode = 'choose' | 'office' | 'holder' | 'server' | 'community' | 'country';

export function Welcome({ onCreated, onOpenPath, newWebDb, bootErr, onConnect }: {
  onConnect?: (address: string) => Promise<void>;
  onCreated: (db: Db, path: string | null) => Promise<void>;
  onOpenPath: (path: string) => Promise<void>;
  newWebDb: () => Promise<Db>;
  bootErr: string | null;
}) {
  const [mode, setMode] = useState<Mode>('choose');
  /** the first choice: the MAGIS centres, or the Jesuit communities */
  const [area, setArea] = useState<'centres' | 'cty' | null>(null);
  const [err, setErr] = useState<string | null>(bootErr);
  // the databases opened recently on this computer (and what each one is, when known)
  const [recent, setRecent] = useState<string[]>([]);
  const [known, setKnown] = useState<Record<string, KnownDb>>({});
  useEffect(() => {
    if (!isDesktop()) return;
    getConfig().then(async (c) => {
      const all = c.recent ?? [];
      const exist = await Promise.all(all.map((p) => invoke<boolean>('file_exists', { path: p }).catch(() => false)));
      setRecent(all.filter((_, i) => exist[i]));
      setKnown(c.known ?? {});
    });
  }, []);
  const isCty = (p: string) => ['community', 'country'].includes(known[p]?.kind ?? '');
  // a file opened before this version (kind unknown) is shown in both places
  const recentHere = recent.filter((p) => !known[p] || (area === 'cty') === isCty(p));
  const open = async (p: string) => {
    try {
      await onOpenPath(p);
    } catch (e) {
      setErr(errText(e));
    }
  };

  const openExisting = async () => {
    try {
      const p = await pickExistingDbPath(t('افتح ملف قاعدة البيانات', 'Open the database file'));
      if (p) await onOpenPath(p);
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <BrandFrame wide jesuit={mode === 'community' || mode === 'country' || (mode === 'choose' && area !== 'centres')} title={mode === 'choose' && area === null ? t3('حسابات اليسوعيين', 'Jesuit accounts', 'Comptes jésuites') : undefined}>
        {err && <div className="alert err">{err}</div>}
        {mode === 'choose' && area === null && (
          <>
            <h2 className="brand-h2">{t3('ماذا تريد أن تفتح؟', 'What do you want to open?', 'Que voulez-vous ouvrir ?')}</h2>
            <div className="area-grid">
              <button className="area-card" onClick={() => setArea('centres')}>
                <img src="/brand/magis-sun.png" alt="" />
                <b>{t3('مراكز ماجيس', 'MAGIS centres', 'Centres MAGIS')}</b>
                <span>{t3('جرمانا · حلب · حمص', 'Jaramana · Aleppo · Homs', 'Jaramana · Alep · Homs')}</span>
              </button>
              <button className="area-card" onClick={() => setArea('cty')}>
                <img src="/brand/jesuits.png" alt="" />
                <b>{t3('جماعات اليسوعيين', 'Jesuit communities', 'Communautés jésuites')}</b>
                <span>{t3('اليسوعيون وبيتهم، والقيم', 'The Jesuits, their house, the econome', "Les jésuites, leur maison, l'économe")}</span>
              </button>
            </div>
            {onConnect && isDesktop() && (
              <div className="choice" style={{ marginTop: 16 }}>
                <button onClick={() => setMode('server')}>
                  <b>{t3('خادم المركز', "The centre's server", 'Le serveur du centre')}</b>
                  <span className="muted small">{t3('الاتصال بقاعدة البيانات المشتركة على الشبكة.', 'Connect to the shared database on the network.', 'Se connecter à la base partagée sur le réseau.')}</span>
                </button>
              </div>
            )}
          </>
        )}
        {mode === 'choose' && area !== null && (
          <>
            <button className="cty-back" onClick={() => setArea(null)}>‹ {t3('رجوع', 'Back', 'Retour')}</button>
            <h2 className="brand-h2">{area === 'centres' ? t3('فتح مركز', 'Open a centre', 'Ouvrir un centre') : t3('فتح جماعة أو بلد', 'Open a community or a country', 'Ouvrir une communauté ou un pays')}</h2>
            <div className="db-grid" style={{ marginBottom: 22 }}>
              {recentHere.map((p) => (
                <DbCard
                  key={p}
                  db={known[p] ? { slug: p, setupNeeded: false, ...known[p] } : { slug: p, organisation: baseName(p).replace(/\.db$/i, ''), centre: 'other', setupNeeded: false, kind: area === 'cty' ? 'community' : 'centre' }}
                  path={p}
                  onOpen={() => open(p)}
                />
              ))}
              <button className="db-card db-new" onClick={openExisting} disabled={!isDesktop()}>
                <div className="db-card-mark"><span>📂</span></div>
                <div className="db-card-text"><b>{t3('فتح ملف آخر…', 'Open another file…', 'Ouvrir un autre fichier…')}</b><span>{t3('ملف ‎.db أنشئ سابقاً', 'A .db file created before', 'Un fichier .db créé avant')}</span></div>
              </button>
            </div>
            <h2 className="brand-h2">{t3('إنشاء', 'Create', 'Créer')}</h2>
            <div className="choice">
              {area === 'centres' && (
                <button onClick={() => setMode('office')}>
                  <b>{t3('مركز جديد', 'A new centre', 'Un nouveau centre')}</b>
                  <span className="muted small">{t3('للرئيس والمحاسب. تبدأ من ملف Excel الحالي.', 'For the Superior and the Accountant. Starts from your current Excel workbook.', 'Pour le Supérieur et le comptable. Part de votre classeur Excel actuel.')}</span>
                </button>
              )}
              {area === 'cty' && (
                <>
                  <button onClick={() => setMode('community')}>
                    <b>{t3('جماعة جديدة', 'A new community', 'Une nouvelle communauté')}</b>
                    <span className="muted small">{t3('الاسم والعنوان، الألوان، ثم الأشخاص والمناصب.', 'Name and address, colours, then the people and offices.', 'Nom et adresse, couleurs, puis les personnes et les fonctions.')}</span>
                  </button>
                  <button onClick={() => setMode('country')}>
                    <b>{t3('بلد جديد (قيم البلد)', 'A new country (country econome)', 'Un nouveau pays (économe du pays)')}</b>
                    <span className="muted small">{t3('ملفات الجماعات، المطالبات، المصالحة.', "The communities' files, claims, reconciliation.", 'Fichiers des communautés, réclamations, réconciliation.')}</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {mode === 'server' && onConnect && <ServerForm onBack={() => setMode('choose')} onConnect={onConnect} />}
        {mode === 'office' && <OfficeForm onBack={() => setMode('choose')} onCreated={onCreated} newWebDb={newWebDb} />}
        {mode === 'community' && (
          <CommunityForm
            demo={!isDesktop()}
            onBack={() => setMode('choose')}
            onSubmit={async (s) => {
              const target = await newDb(newWebDb, `${s.community.replace(/[^\w؀-ۿ -]/g, '').trim() || 'community'}.db`);
              if (!target) return;
              await createCommunity(target.db, { ...s, mustChange: isDesktop() });
              await onCreated(target.db, target.path);
            }}
          />
        )}
        {mode === 'country' && (
          <CountryForm
            demo={!isDesktop()}
            onBack={() => setMode('choose')}
            onSubmit={async (s) => {
              const target = await newDb(newWebDb, `${s.country.replace(/[^\w؀-ۿ -]/g, '').trim() || 'country'}.db`);
              if (!target) return;
              await createCountry(target.db, { ...s, mustChange: s.mustChange ?? isDesktop() });
              await onCreated(target.db, target.path);
            }}
          />
        )}
        {mode === 'holder' && <HolderForm onBack={() => setMode('choose')} onCreated={onCreated} newWebDb={newWebDb} />}
    </BrandFrame>
  );
}

function ServerForm({ onBack, onConnect }: { onBack: () => void; onConnect: (address: string) => Promise<void> }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getConfig().then((c) => c.server && setAddress(c.server.address));
  }, []);
  const go = async () => {
    setErr(null);
    setBusy(true);
    try {
      await onConnect(address.trim());
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const forget = async () => {
    const c = await getConfig();
    await setConfig({ ...c, server: null });
    setErr(null);
  };
  return (
    <div className="panel" style={{ maxWidth: 620, margin: '0 auto' }}>
      <h2>{t('خادم المركز', "The centre's server")}</h2>
      <p className="muted">{t('العنوان موجود على الخادم في: الإدارة ← الخادم (مثلاً 192.168.1.20).', 'The address is shown on the server in Admin → Server (e.g. 192.168.1.20).')}</p>
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <Field label={t('عنوان الخادم', 'Server address')}>
          <input className="ltr" autoFocus value={address} placeholder="192.168.1.20" onChange={(e) => setAddress(e.target.value)} />
        </Field>
        {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onBack}>{t('رجوع', 'Back')}</button>
          {err && <button type="button" className="btn ghost" onClick={forget}>{t('نسيان الخادم', 'Forget this server')}</button>}
          <button className="btn primary" disabled={busy || !address.trim()}>{busy ? '…' : t('اتصال', 'Connect')}</button>
        </div>
      </form>
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
