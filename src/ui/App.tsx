// Start-up. Three ways the same program runs:
//  - desktop: the Mac/Windows app, on a database file of this computer;
//  - server:  a browser page served by the centre's server (LAN);
//  - preview: a browser page without server, in memory (for testing).
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Db, migrate } from '../db/db';
import { getMeta } from '../db/repo';
import { tauriDb } from '../db/tauriDb';
import { webDb } from '../db/webDb';
import { dailyBackup, desktopFiles } from '../db/backup';
import { listProfiles, login, type LoginPerson, type Profile } from '../auth';
import { localApi } from '../ops';
import { getConfig, isDesktop, setConfig } from '../platform';
import { connectRemote, disconnectRemote, hello, httpApi, remoteBase, serverTouch, serverLogin, serverLogout, serverMe, serverProfiles, serverVersion, type DbInfo, type Hello } from '../net';
import { centreStyle, guessCentre, type BrandInfo } from '../brand';
import { m, tx } from '../i18n';
import { BrandFrame, Landing } from './Landing';
import { AppProvider, type Install, type Session } from '../state';
import { getLang } from '../i18n';
import type { Role } from '../domain/types';
import { ConfirmHost, PromptHost, ToastHost, biName, errText, t } from './kit';
import { Welcome } from './Welcome';
import { ICON, PersonIcon } from './icons';
import { Shell } from './Shell';
import { ServerSetup } from './ServerSetup';
import { IdleGuard } from './Idle';
import { dropDraft } from './draft';
import { CtyApp } from '../community/ui/CtyApp';
import { CountryApp } from '../community/ui/country/CountryApp';
import { triName, t3 } from '../community/ui/text';
import { officeLabel } from '../community/ui/People';

interface Opened {
  db: Db;
  dbPath: string | null;
  install: Install;
  organisation: string;
  centre: string;
  brandColor: string | null;
  brandLogo: string | null;
  kind: string;
}

export function App() {
  const [server, setServer] = useState<Hello | null>(null);
  /** server: the database chosen on the welcome page, and whether it is being set up */
  const [serverDb, setServerDb] = useState<DbInfo | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  /** logged in, but looking at the list of databases (to create one, or change) */
  const [browsing, setBrowsing] = useState(false);
  /** signed out for inactivity: said on the login page */
  const [idleOut, setIdleOut] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => {
    sessionRef.current = session;
    if (session) setIdleOut(false);
  }, [session]);
  const [mustChange, setMustChange] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const l = getLang();
    document.documentElement.dir = l === 'en' || l === 'fr' ? 'ltr' : 'rtl';
    document.documentElement.lang = l === 'both' ? 'ar' : l;
  });

  const openPath = useCallback(async (dbPath: string) => {
    await invoke('db_open', { path: dbPath });
    await migrate(tauriDb);
    await dailyBackup(dbPath);
    const install = ((await getMeta(tauriDb, 'install')) ?? 'office') as Install;
    const organisation = (await getMeta(tauriDb, 'organisation')) ?? '';
    const centre = (await getMeta(tauriDb, 'centre')) ?? guessCentre(organisation);
    const cfg = await getConfig();
    const recent = [dbPath, ...(cfg.recent ?? []).filter((p) => p !== dbPath)].slice(0, 8);
    // what the file is, for its card on the first page (centre or community, its colours)
    const info = { organisation, centre, kind: (await getMeta(tauriDb, 'kind')) ?? 'centre', color: await getMeta(tauriDb, 'brand_color'), palette: await getMeta(tauriDb, 'brand_palette'), city: await getMeta(tauriDb, 'city') };
    const known = Object.fromEntries(Object.entries({ ...(cfg.known ?? {}), [dbPath]: info }).filter(([p]) => recent.includes(p)));
    await setConfig({ ...cfg, dbPath, recent, known });
    setOpened({ db: tauriDb, dbPath, install, organisation, centre, brandColor: await getMeta(tauriDb, 'brand_color'), brandLogo: await getMeta(tauriDb, 'brand_logo'), kind: (await getMeta(tauriDb, 'kind')) ?? 'centre' });
  }, []);

  const serverSession = useCallback((db: DbInfo, profile: Profile): Session => ({
    api: httpApi, mode: 'server', dbPath: null, install: 'office', organisation: db.organisation, centre: db.centre,
    brandColor: db.color ?? null, brandLogo: db.logo ?? null, profile, version: serverVersion, kind: db.kind,
  }), []);

  /** Asks the server again for its databases (after a creation or a setup). */
  const refreshServer = useCallback(async (select?: string) => {
    const h = await hello();
    setServer(h);
    if (h && select) setServerDb(h.dbs.find((d) => d.slug === select) ?? null);
    return h;
  }, []);

  /** Desktop app: connect to the centre's server and remember it. */
  const connect = useCallback(async (address: string) => {
    const cfg = await getConfig();
    const same = cfg.server && cfg.server.address === address;
    const r = await connectRemote(address, same ? cfg.server!.fingerprint : null);
    await setConfig({ ...cfg, server: { address, fingerprint: r.fingerprint } });
    setBootErr(null);
    setServer(r.hello);
  }, []);

  /** Desktop app: stop using the server; back to the files of this computer. */
  const leaveServer = useCallback(async () => {
    await serverLogout();
    await disconnectRemote();
    const cfg = await getConfig();
    await setConfig({ ...cfg, server: null });
    setSession(null);
    setServerDb(null);
    setBrowsing(false);
    setServer(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (isDesktop()) {
          const cfg = await getConfig();
          if (cfg.server) {
            // the app is used as a window on the centre's server
            await connectRemote(cfg.server.address, cfg.server.fingerprint);
          } else {
            if (cfg.dbPath && (await invoke<boolean>('file_exists', { path: cfg.dbPath }))) await openPath(cfg.dbPath);
            return;
          }
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
    // (a refused password also answers 401: only a session that was open counts)
    const out = () => {
      if (sessionRef.current) setIdleOut(true);
      setSession(null);
    };
    window.addEventListener('magis-logged-out', out);
    return () => window.removeEventListener('magis-logged-out', out);
  }, []);

  const onCreated = useCallback(async (db: Db, dbPath: string | null) => {
    if (dbPath) await openPath(dbPath);
    else {
      const install = ((await getMeta(db, 'install')) ?? 'office') as Install;
      const organisation = (await getMeta(db, 'organisation')) ?? '';
      setOpened({ db, dbPath: null, install, organisation, centre: (await getMeta(db, 'centre')) ?? guessCentre(organisation), brandColor: await getMeta(db, 'brand_color'), brandLogo: await getMeta(db, 'brand_logo'), kind: (await getMeta(db, 'kind')) ?? 'centre' });
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
    dropDraft();
    setIdleOut(false);
    setSession(null);
    setMustChange(false);
  }, [server, refreshServer]);

  /** No activity for too long: out, but a half-typed entry is kept for the same person. */
  const idleLogout = useCallback(() => {
    if (server) void serverLogout();
    setBrowsing(false);
    setSettingUp(false);
    setSession(null);
    setMustChange(false);
    setIdleOut(true);
  }, [server]);

  /** the language was chosen (Shell, phone): draw everything again */
  const toggleLang = () => force((x) => x + 1);

  const localLogin = (o: Opened) => async (profileId: number, secret: string) => {
    const { profile, given } = await login(o.db, profileId, secret);
    setMustChange(given);
    const who = profile.name;
    const files = desktopFiles(o.dbPath);
    setSession({
      api: localApi({ db: o.db, profile, who, install: o.install, files }),
      mode: o.dbPath ? 'desktop' : 'preview', dbPath: o.dbPath, install: o.install, organisation: o.organisation, centre: o.centre,
      brandColor: o.brandColor, brandLogo: o.brandLogo, profile, kind: o.kind,
    });
  };

  let body;
  if (booting) body = <div className="center-page muted">…</div>;
  else if (server && ((!session && !serverDb) || (session && browsing)))
    body = (
      <Landing
        dbs={server.dbs}
        canCreate={server.canCreate}
        signedIn={session ? { name: session.profile.name, db: serverDb?.organisation ?? '' } : null}
        address={remoteBase}
        onLeave={remoteBase ? leaveServer : undefined}
        onBackIn={session ? () => setBrowsing(false) : undefined}
        onOpen={(db) => {
          if (session && db.slug === serverDb?.slug && !db.setupNeeded) return setBrowsing(false);
          if (session) {
            // another database: a new sign-in there
            void serverLogout();
            setSession(null);
            setMustChange(false);
            setBrowsing(false);
          }
          setServerDb(db);
          setSettingUp(db.setupNeeded);
        }}
        onCreated={async (slug) => {
          await refreshServer(slug);
          setSettingUp(true);
          setBrowsing(false);
        }}
      />
    );
  else if (server && session && settingUp && serverDb)
    body = (
      <ServerSetup
        db={serverDb}
        onDone={async () => {
          // the new database is ready: sign in there
          setSettingUp(false);
          void serverLogout();
          setSession(null);
          setMustChange(false);
          await refreshServer(serverDb.slug);
        }}
        onBack={() => {
          setSettingUp(false);
          setBrowsing(true);
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
        subtitle={serverDb.kind === 'community' ? tx(m('جماعة يسوعية', 'Jesuit community', 'Communauté jésuite')) : serverDb.kind === 'country' ? tx(m('قيم البلد', 'Country econome', "Économe du pays")) : serverDb.color || serverDb.logo ? t('خادم ماجيس', 'MAGIS server') : tx(centreStyle(serverDb.centre).name)}
        brand={serverDb}
        community={serverDb.kind === 'community' || serverDb.kind === 'country'}
        loadProfiles={() => serverProfiles(serverDb.slug)}
        onLogin={async (id, pw) => {
          const r = await serverLogin(serverDb.slug, id, pw);
          setMustChange(r.mustChange);
          setSession(serverSession(serverDb, r.profile));
        }}
        onBack={() => setServerDb(null)}
        notice={idleOut}
      />
    );
  else if (session && mustChange)
    body = <ForcePassword session={session} onDone={() => setMustChange(false)} onLogout={logout} />;
  else if (!server && !opened)
    body = <Welcome onCreated={onCreated} onOpenPath={openPath} newWebDb={webDb} bootErr={bootErr} onConnect={connect} />;
  else if (!server && opened && !session)
    body = (
      <Login
        title={opened.organisation || t('حسابات ماجيس', 'MAGIS Accounts')}
        subtitle={opened.dbPath ?? t('معاينة', 'Preview')}
        brand={{ centre: opened.centre, color: opened.brandColor, logo: opened.brandLogo }}
        community={opened.kind === 'community' || opened.kind === 'country'}
        loadProfiles={() => listProfiles(opened.db)}
        onLogin={localLogin(opened)}
        onClose={closeDb}
        notice={idleOut}
      />
    );
  else if (session?.kind === 'country')
    body = (
      <>
        <IdleGuard minutes={server?.idleMinutes ?? 15} onTimeout={idleLogout} touch={server ? serverTouch : undefined} />
        <CountryApp session={session} onLogout={logout} onLang={() => force((x) => x + 1)} />
      </>
    );
  else if (session?.kind === 'community')
    body = (
      <>
        <IdleGuard minutes={server?.idleMinutes ?? 15} onTimeout={idleLogout} touch={server ? serverTouch : undefined} />
        <CtyApp session={session} onLogout={logout} onLang={() => force((x) => x + 1)} onCloseDb={server ? undefined : closeDb} onDatabases={server ? async () => { await refreshServer(); setBrowsing(true); } : undefined} />
      </>
    );
  else
    body = (
      <AppProvider session={session!} onLogout={logout}>
        <IdleGuard minutes={server?.idleMinutes ?? 15} onTimeout={idleLogout} touch={server ? serverTouch : undefined} />
        <Shell onCloseDb={closeDb} onToggleLang={toggleLang} onDatabases={server ? async () => { await refreshServer(); setBrowsing(true); } : undefined} />
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

/** Which icon a person gets: from the profile (Superior 1, Accountant 2) or, failing that, the role. */
const kindOf = (p: LoginPerson): keyof typeof ICON =>
  p.access_id === 1 || (!p.access_id && p.role === 'sup') ? 'superior'
    : p.access_id === 2 || (!p.access_id && p.role === 'com') ? 'accountant'
      : p.role === 'holder' || p.books ? 'holder' : 'person';

function Login({ title, subtitle, brand, loadProfiles, onLogin, onClose, onBack, notice, community }: {
  /** signed out for inactivity */
  notice?: boolean;
  /** a Jesuit community: one group of people, roles in three languages */
  community?: boolean;
  title: string;
  subtitle: string;
  brand?: BrandInfo;
  onBack?: () => void;
  loadProfiles: () => Promise<LoginPerson[]>;
  onLogin: (profileId: number, secret: string) => Promise<void>;
  onClose?: () => void;
}) {
  const [profiles, setProfiles] = useState<LoginPerson[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    loadProfiles().then((ps) => {
      setProfiles(ps);
      if (ps.length === 1) setPick(ps[0].id);
    }).catch((e) => setErr(errText(e)));
  }, [loadProfiles]);
  const choose = (id: number) => {
    setPick(id);
    setErr(null);
    setPin('');
    setTimeout(() => pwRef.current?.focus(), 30);
  };
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
  const office = community ? [] : profiles.filter((p) => kindOf(p) !== 'holder');
  const holders = community ? [] : profiles.filter((p) => kindOf(p) === 'holder');
  const chosen = profiles.find((p) => p.id === pick);
  const roleLabel = (p: LoginPerson) => (p.access_name ? (community ? triName(p.access_name) : biName(p.access_name)) : roleName(p.role));
  const ctyTile = (p: LoginPerson) => (
    <button key={p.id} type="button" className={`person ${p.office ? `office-${p.office}` : ''} ${pick === p.id ? 'on' : ''}`} onClick={() => choose(p.id)} aria-pressed={pick === p.id}>
      <PersonIcon kind="person" />
      <span className="person-name">{p.office ? officeLabel(p.office) : p.name}</span>
      <span className="person-sub">{p.office ? `${t3('بيد', 'held by', 'tenu par')} ${p.held_by ?? ''}` : roleLabel(p)}</span>
    </button>
  );

  const tile = (p: LoginPerson) => (
    <button key={p.id} type="button" className={`person ${pick === p.id ? 'on' : ''}`} onClick={() => choose(p.id)} aria-pressed={pick === p.id}>
      <PersonIcon kind={kindOf(p)} />
      <span className="person-name">{p.name}</span>
      <span className="person-sub">{kindOf(p) === 'holder' && p.books ? `${t('دفتر', 'Book')} ${p.books}` : roleLabel(p)}</span>
    </button>
  );

  return (
    <BrandFrame brand={brand} jesuit={community}>
      <div className="panel login-panel">
        <h2 style={{ marginBottom: 2 }}>{title || t('حسابات ماجيس', 'MAGIS Accounts')}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>{subtitle}</p>
        {notice && <div className="alert info">{t('خرجتَ تلقائياً بعد مدة بلا نشاط. ادخل من جديد لتتابع.', 'You were signed out after a while without activity. Sign in again to continue.')}</div>}
        {community && (
          <>
            {profiles.some((p) => p.office) && (
              <>
                <div className="people-group">{t3('المناصب', 'Offices', 'Fonctions')}</div>
                <div className="people">{profiles.filter((p) => p.office).map(ctyTile)}</div>
              </>
            )}
            {profiles.some((p) => p.office) && <div className="people-group">{t3('الإخوة', 'Jesuits', 'Jésuites')}</div>}
            <div className="people">{profiles.filter((p) => !p.office).map(ctyTile)}</div>
          </>
        )}
        {office.length > 0 && (
          <>
            <div className="people-group">{t('المكتب', 'Office')}</div>
            <div className="people">{office.map(tile)}</div>
          </>
        )}
        {holders.length > 0 && (
          <>
            <div className="people-group">{t('أمناء الصناديق', 'Book holders')}</div>
            <div className="people">{holders.map(tile)}</div>
          </>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void go(); }} className={`login-pass ${chosen ? 'open' : ''}`}>
          {chosen ? (
            <label className="field">
              <span>{t(`كلمة سر ${chosen.name}`, `Password for ${chosen.name}`)}</span>
              <input ref={pwRef} type="password" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} />
            </label>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>{t('اضغط على اسمك.', 'Tap your name.')}</p>
          )}
          {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
          <div className="modal-foot">
            {onClose && <button type="button" className="btn ghost" onClick={onClose}>{t('فتح ملف آخر', 'Open another file')}</button>}
            {onBack && <button type="button" className="btn ghost" onClick={onBack}>{t('كل قواعد البيانات', 'All databases')}</button>}
            {chosen && <button className="btn primary" disabled={!pin || busy}>{t('دخول', 'Enter')}</button>}
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
