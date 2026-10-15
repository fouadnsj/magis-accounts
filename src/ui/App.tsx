// Start-up. Three ways the same program runs:
//  - desktop: the Mac/Windows app, on a database file of this computer;
//  - server:  a browser page served by the centre's server (LAN);
//  - preview: a browser page without server, in memory (for testing).
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Db, migrate } from '../db/db';
import { getMeta } from '../db/repo';
import { tauriDb } from '../db/tauriDb';
import { webDb } from '../db/webDb';
import { dailyBackup, desktopFiles } from '../db/backup';
import { listProfiles, login, type Profile } from '../auth';
import { localApi } from '../ops';
import { getConfig, isDesktop, setConfig } from '../platform';
import { hello, httpApi, serverLogin, serverLogout, serverMe, serverProfiles, serverVersion, type DbInfo, type Hello } from '../net';
import { centreStyle, guessCentre, type BrandInfo } from '../brand';
import { tx } from '../i18n';
import { BrandFrame, Landing } from './Landing';
import { AppProvider, type Install, type Session } from '../state';
import { getLang, setLang } from '../i18n';
import type { Role } from '../domain/types';
import { ConfirmHost, PromptHost, ToastHost, biName, errText, t } from './kit';
import { Welcome } from './Welcome';
import { Shell } from './Shell';
import { ServerSetup } from './ServerSetup';

interface Opened {
  db: Db;
  dbPath: string | null;
  install: Install;
  organisation: string;
  centre: string;
  brandColor: string | null;
  brandLogo: string | null;
}

export function App() {
  const [server, setServer] = useState<Hello | null>(null);
  /** server: the database chosen on the welcome page, and whether it is being set up */
  const [serverDb, setServerDb] = useState<DbInfo | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [mustChange, setMustChange] = useState(false);
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
    const centre = (await getMeta(tauriDb, 'centre')) ?? guessCentre(organisation);
    const cfg = await getConfig();
    await setConfig({ ...cfg, dbPath, recent: [dbPath, ...(cfg.recent ?? []).filter((p) => p !== dbPath)].slice(0, 8) });
    setOpened({ db: tauriDb, dbPath, install, organisation, centre, brandColor: await getMeta(tauriDb, 'brand_color'), brandLogo: await getMeta(tauriDb, 'brand_logo') });
  }, []);

  const serverSession = useCallback((db: DbInfo, profile: Profile): Session => ({
    api: httpApi, mode: 'server', dbPath: null, install: 'office', organisation: db.organisation, centre: db.centre,
    brandColor: db.color ?? null, brandLogo: db.logo ?? null, profile, version: serverVersion,
  }), []);

  /** Asks the server again for its databases (after a creation or a setup). */
  const refreshServer = useCallback(async (select?: string) => {
    const h = await hello();
    setServer(h);
    if (h && select) setServerDb(h.dbs.find((d) => d.slug === select) ?? null);
    return h;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (isDesktop()) {
          const cfg = await getConfig();
          if (cfg.dbPath && (await invoke<boolean>('file_exists', { path: cfg.dbPath }))) await openPath(cfg.dbPath);
          return;
        }
        const h = await hello();
        if (h) {
          setServer(h);
          const me = await serverMe();
          const db = me ? h.dbs.find((d) => d.slug === me.db) : undefined;
          if (me?.profile && db) {
            setServerDb(db);
            setMustChange(me.mustChange);
            setSession(serverSession(db, me.profile));
          }
        }
      } catch (e) {
        setBootErr(errText(e));
      } finally {
        setBooting(false);
      }
    })();
  }, [openPath, serverSession]);

  // The server ended the session (timeout, restart): back to the login page.
  useEffect(() => {
    const out = () => setSession(null);
    window.addEventListener('magis-logged-out', out);
    return () => window.removeEventListener('magis-logged-out', out);
  }, []);

  const onCreated = useCallback(async (db: Db, dbPath: string | null) => {
    if (dbPath) await openPath(dbPath);
    else {
      const install = ((await getMeta(db, 'install')) ?? 'office') as Install;
      const organisation = (await getMeta(db, 'organisation')) ?? '';
      setOpened({ db, dbPath: null, install, organisation, centre: (await getMeta(db, 'centre')) ?? guessCentre(organisation), brandColor: await getMeta(db, 'brand_color'), brandLogo: await getMeta(db, 'brand_logo') });
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

  const logout = useCallback(() => {
    if (server) {
      void serverLogout();
      void refreshServer();
    }
    setSession(null);
    setMustChange(false);
  }, [server, refreshServer]);

  const toggleLang = () => {
    setLang(getLang() === 'en' ? 'both' : 'en');
    force((x) => x + 1);
  };

  const localLogin = (o: Opened) => async (profileId: number, secret: string) => {
    const { profile, given } = await login(o.db, profileId, secret);
    setMustChange(given);
    const who = profile.name;
    const files = desktopFiles(o.dbPath);
    setSession({
      api: localApi({ db: o.db, profile, who, install: o.install, files }),
      mode: o.dbPath ? 'desktop' : 'preview', dbPath: o.dbPath, install: o.install, organisation: o.organisation, centre: o.centre,
      brandColor: o.brandColor, brandLogo: o.brandLogo, profile,
    });
  };

  let body;
  if (booting) body = <div className="center-page muted">…</div>;
  else if (server && !session && !serverDb)
    body = (
      <Landing
        dbs={server.dbs}
        canCreate={server.canCreate}
        onOpen={(db) => {
          setServerDb(db);
          setSettingUp(db.setupNeeded);
        }}
        onCreated={async (slug) => {
          await refreshServer(slug);
          setSettingUp(true);
        }}
      />
    );
  else if (server && !session && serverDb && (settingUp || serverDb.setupNeeded))
    body = server.canCreate ? (
      <ServerSetup
        db={serverDb}
        onDone={async () => {
          setSettingUp(false);
          await refreshServer(serverDb.slug);
        }}
        onBack={() => setServerDb(null)}
      />
    ) : (
      <BrandFrame brand={serverDb}>
        <div className="panel">
          <h2>{serverDb.organisation}</h2>
          <p>{t('لم تُعدّ بعد. تُعدّ على حاسوب الخادم نفسه.', 'Not set up yet. It is set up on the server computer itself.')}</p>
          <button className="btn" onClick={() => setServerDb(null)}>{t('كل قواعد البيانات', 'All databases')}</button>
        </div>
      </BrandFrame>
    );
  else if (server && !session && serverDb)
    body = (
      <Login
        key={serverDb.slug}
        title={serverDb.organisation}
        subtitle={serverDb.color || serverDb.logo ? t('خادم ماجيس', 'MAGIS server') : tx(centreStyle(serverDb.centre).name)}
        brand={serverDb}
        loadProfiles={() => serverProfiles(serverDb.slug)}
        onLogin={async (id, pw) => {
          const r = await serverLogin(serverDb.slug, id, pw);
          setMustChange(r.mustChange);
          setSession(serverSession(serverDb, r.profile));
        }}
        onBack={() => setServerDb(null)}
      />
    );
  else if (session && mustChange)
    body = <ForcePassword session={session} onDone={() => setMustChange(false)} onLogout={logout} />;
  else if (!server && !opened)
    body = <Welcome onCreated={onCreated} onOpenPath={openPath} newWebDb={webDb} bootErr={bootErr} />;
  else if (!server && opened && !session)
    body = (
      <Login
        title={opened.organisation || t('حسابات ماجيس', 'MAGIS Accounts')}
        subtitle={opened.dbPath ?? t('معاينة', 'Preview')}
        brand={{ centre: opened.centre, color: opened.brandColor, logo: opened.brandLogo }}
        loadProfiles={() => listProfiles(opened.db)}
        onLogin={localLogin(opened)}
        onClose={closeDb}
      />
    );
  else
    body = (
      <AppProvider session={session!} onLogout={logout}>
        <Shell onCloseDb={closeDb} onToggleLang={toggleLang} />
      </AppProvider>
    );

  return (
    <>
      {!isDesktop() && !server && <div className="preview-banner">{t('معاينة في المتصفح — لا يُحفظ شيء', 'Browser preview — nothing is saved')}</div>}
      {body}
      <ConfirmHost />
      <PromptHost />
      <ToastHost />
    </>
  );
}

export const roleName = (r: Role) => (r === 'sup' ? t('الرئيس', 'Superior') : r === 'com' ? t('المحاسب', 'Accountant') : t('أمين الصندوق', 'Cash holder'));

function Login({ title, subtitle, brand, loadProfiles, onLogin, onClose, onBack }: {
  title: string;
  subtitle: string;
  brand?: BrandInfo;
  onBack?: () => void;
  loadProfiles: () => Promise<{ id: number; name: string; role: Role; access_name?: string }[]>;
  onLogin: (profileId: number, secret: string) => Promise<void>;
  onClose?: () => void;
}) {
  const [profiles, setProfiles] = useState<{ id: number; name: string; role: Role; access_name?: string }[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadProfiles().then((ps) => {
      setProfiles(ps);
      if (ps.length === 1) setPick(ps[0].id);
    }).catch((e) => setErr(errText(e)));
  }, [loadProfiles]);
  const go = async () => {
    if (pick == null) return;
    setBusy(true);
    try {
      await onLogin(pick, pin);
    } catch (e) {
      setErr(errText(e));
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <BrandFrame brand={brand}>
      <div className="panel login-panel">
        <h2 style={{ marginBottom: 2 }}>{title || t('حسابات ماجيس', 'MAGIS Accounts')}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>{subtitle}</p>
        <div className="profiles">
          {profiles.map((p) => (
            <button key={p.id} className={pick === p.id ? 'on' : ''} onClick={() => setPick(p.id)}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
              <div className="muted small">{p.access_name ? biName(p.access_name) : roleName(p.role)}</div>
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void go(); }} style={{ marginTop: 14 }}>
          <label className="field">
            <span>{t('كلمة السر', 'Password')}</span>
            <input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} />
          </label>
          {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
          <div className="modal-foot">
            {onClose && <button type="button" className="btn ghost" onClick={onClose}>{t('فتح ملف آخر', 'Open another file')}</button>}
            {onBack && <button type="button" className="btn ghost" onClick={onBack}>{t('كل قواعد البيانات', 'All databases')}</button>}
            <button className="btn primary" disabled={pick == null || !pin || busy}>{t('دخول', 'Enter')}</button>
          </div>
        </form>
      </div>
    </BrandFrame>
  );
}

/** On the network, an old 4-digit PIN must be replaced before anything else. */
function ForcePassword({ session, onDone, onLogout }: { session: Session; onDone: () => void; onLogout: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="center-page">
      <div className="panel" style={{ width: 'min(440px, 100%)' }}>
        <h1>{t('كلمة سر جديدة', 'New password')}</h1>
        <p className="muted">{t('البرنامج الآن على الشبكة: اختر كلمة سر أقوى (6 أحرف أو أرقام على الأقل).', 'The program is now on the network: choose a stronger password (at least 6 characters).')}</p>
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (a !== b) return setErr(t('كلمة السر وتأكيدها مختلفان', 'Password and confirmation differ'));
          try {
            await session.api.call('profile.setPin', { id: session.profile.id, pin: a });
            onDone();
          } catch (x) {
            setErr(errText(x));
          }
        }}>
          <div className="grid2">
            <label className="field"><span>{t('كلمة السر', 'Password')}</span><input type="password" autoFocus value={a} onChange={(e) => setA(e.target.value)} /></label>
            <label className="field"><span>{t('تأكيد', 'Again')}</span><input type="password" value={b} onChange={(e) => setB(e.target.value)} /></label>
          </div>
          {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={onLogout}>{t('خروج', 'Log out')}</button>
            <button className="btn primary">{t('احفظ', 'Save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
