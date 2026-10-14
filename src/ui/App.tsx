import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Db, migrate } from '../db/db';
import { getMeta } from '../db/repo';
import { tauriDb } from '../db/tauriDb';
import { webDb } from '../db/webDb';
import { dailyBackup } from '../db/backup';
import { listProfiles, login, type Profile } from '../auth';
import { getConfig, isDesktop, setConfig } from '../platform';
import { AppProvider, type Install, type Session } from '../state';
import { getLang, setLang } from '../i18n';
import { ConfirmHost, PromptHost, ToastHost, errText, t } from './kit';
import { Welcome } from './Welcome';
import { Shell } from './Shell';

interface Opened {
  db: Db;
  dbPath: string | null;
  install: Install;
  organisation: string;
}

export function App() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    document.documentElement.dir = getLang() === 'en' ? 'ltr' : 'rtl';
    document.documentElement.lang = getLang() === 'en' ? 'en' : 'ar';
  });

  const openPath = useCallback(async (dbPath: string) => {
    await invoke('db_open', { path: dbPath });
    await migrate(tauriDb);
    await dailyBackup(dbPath);
    const install = ((await getMeta(tauriDb, 'install')) ?? 'office') as Install;
    const organisation = (await getMeta(tauriDb, 'organisation')) ?? '';
    const cfg = await getConfig();
    await setConfig({ ...cfg, dbPath, recent: [dbPath, ...(cfg.recent ?? []).filter((p) => p !== dbPath)].slice(0, 5) });
    setOpened({ db: tauriDb, dbPath, install, organisation });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (isDesktop()) {
          const cfg = await getConfig();
          if (cfg.dbPath && (await invoke<boolean>('file_exists', { path: cfg.dbPath }))) await openPath(cfg.dbPath);
        }
      } catch (e) {
        setBootErr(errText(e));
      } finally {
        setBooting(false);
      }
    })();
  }, [openPath]);

  const onCreated = useCallback(async (db: Db, dbPath: string | null) => {
    if (dbPath) await openPath(dbPath);
    else {
      const install = ((await getMeta(db, 'install')) ?? 'office') as Install;
      setOpened({ db, dbPath: null, install, organisation: (await getMeta(db, 'organisation')) ?? '' });
    }
  }, [openPath]);

  const closeDb = useCallback(async () => {
    setSession(null);
    setOpened(null);
    if (isDesktop()) {
      await invoke('db_close');
      const cfg = await getConfig();
      await setConfig({ ...cfg, dbPath: undefined });
    }
  }, []);

  const toggleLang = () => {
    setLang(getLang() === 'en' ? 'both' : 'en');
    force((x) => x + 1);
  };

  let body;
  if (booting) body = <div className="center-page muted">…</div>;
  else if (!opened)
    body = <Welcome onCreated={onCreated} onOpenPath={openPath} newWebDb={webDb} bootErr={bootErr} />;
  else if (!session)
    body = <Login opened={opened} onLogin={(profile) => setSession({ ...opened, profile })} onClose={closeDb} />;
  else
    body = (
      <AppProvider session={session} onLogout={() => setSession(null)}>
        <Shell onCloseDb={closeDb} onToggleLang={toggleLang} />
      </AppProvider>
    );

  return (
    <>
      {!isDesktop() && <div className="preview-banner">{t('معاينة في المتصفح — لا يُحفظ شيء', 'Browser preview — nothing is saved')}</div>}
      {body}
      <ConfirmHost />
      <PromptHost />
      <ToastHost />
    </>
  );
}

function Login({ opened, onLogin, onClose }: { opened: Opened; onLogin: (p: Profile) => void; onClose: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    listProfiles(opened.db).then((ps) => {
      setProfiles(ps);
      if (ps.length === 1) setPick(ps[0].id);
    });
  }, [opened.db]);
  const roleName = (r: string) => (r === 'sup' ? t('الرئيس', 'Superior') : r === 'com' ? t('المحاسب', 'Accountant') : t('أمين الصندوق', 'Cash holder'));
  const go = async () => {
    if (pick == null) return;
    try {
      onLogin(await login(opened.db, pick, pin));
    } catch (e) {
      setErr(errText(e));
      setPin('');
    }
  };
  return (
    <div className="center-page">
      <div className="panel" style={{ width: 'min(420px, 100%)' }}>
        <h1>{opened.organisation || t('حسابات ماجيس', 'MAGIS Accounts')}</h1>
        <p className="muted small">{opened.dbPath ?? t('معاينة', 'Preview')}</p>
        <div className="profiles">
          {profiles.map((p) => (
            <button key={p.id} className={pick === p.id ? 'on' : ''} onClick={() => setPick(p.id)}>
              <b>{p.name}</b> <span className="muted">· {roleName(p.role)}</span>
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
          style={{ marginTop: 14 }}
        >
          <label className="field">
            <span>{t('الرمز السري', 'PIN')}</span>
            <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} />
          </label>
          {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={onClose}>
              {t('فتح ملف آخر', 'Open another file')}
            </button>
            <button className="btn primary" disabled={pick == null || !pin}>
              {t('دخول', 'Enter')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
