// The first page of the server (Fouad, 31 October 2026): no database is shown before someone signs in. The MAGIS
// animation, the charter, and an invitation: choose your house, then your name and your password; or the administrator.
// Then the person sees only the databases where that name has that password (their house's accounts, HR).
import { useEffect, useRef, useState } from 'react';
import { CENTRES, type CentreKey } from '../brand';
import { m, tx } from '../i18n';
import { serverEnter, serverSignIn, type DbInfo, type Hello } from '../net';
import type { Profile } from '../auth';
import { BrandFrame, Charter, DbCard, VALUES } from './Landing';
import { DirSetup } from './Directory';
import { Field, errText } from './kit';

const HOUSES: CentreKey[] = ['jaramana', 'aleppo', 'homs'];
const t3 = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));

/** the house and the name last used in this browser (never the password) */
const remembered = (): { house?: CentreKey; name?: string } => {
  try { return JSON.parse(localStorage.getItem('magis.signin') ?? '{}') as { house?: CentreKey; name?: string }; } catch { return {}; }
};
const remember = (house: CentreKey, name: string) => {
  try { localStorage.setItem('magis.signin', JSON.stringify({ house, name })); } catch { /* private window */ }
};

/** The MAGIS animation (the bumper made in July): plays once and stays on the three houses. Still, without motion. */
function Bumper() {
  const ref = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const toEnd = () => { const v = ref.current; if (v && v.duration) v.currentTime = Math.max(0, v.duration - 0.05); };
  return (
    <div className="mg-stage">
      <video ref={ref} src="/brand/magis-bumper.mp4" muted playsInline preload="auto" autoPlay={!still}
        onLoadedMetadata={() => { if (still) toEnd(); }} onEnded={() => setEnded(true)} aria-label="MAGIS" />
      {ended && <button type="button" className="mg-replay" title={t3('مرة أخرى', 'Play again', 'Revoir')} onClick={() => { const v = ref.current; if (v) { setEnded(false); v.currentTime = 0; void v.play(); } }}>↻</button>}
    </div>
  );
}

export function FirstPage({ hello, notice, refresh, onEnter, onDir, onCommunities }: {
  hello: Hello;
  /** signed out after a while without activity */
  notice?: boolean;
  refresh: () => Promise<Hello | null>;
  /** signed in to a database */
  onEnter: (db: DbInfo, profile: Profile, mustChange: boolean) => void;
  /** signed in as a person of the sign-in directory (the administrator): their list of databases */
  onDir: () => Promise<void>;
  /** the communities' side, as before (its own password, then its people) */
  onCommunities?: () => void;
}) {
  const last = remembered();
  const [step, setStep] = useState<CentreKey | 'admin' | null>(notice && last.house ? last.house : null);
  const [places, setPlaces] = useState<DbInfo[] | null>(null);
  const [name, setName] = useState(last.name ?? '');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setErr(null); setPw(''); }, [step]);

  const go = async () => {
    if (!step) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await serverSignIn(step, name, pw);
      if (step !== 'admin') remember(step, name.trim());
      if (r.dir) return await onDir();
      const h = await refresh();
      const dbs = (r.places ?? []).map((s) => h?.dbs.find((d) => d.slug === s)).filter((d): d is DbInfo => !!d);
      if (dbs.length > 1) return setPlaces(dbs);
      if (dbs[0] && r.profile) onEnter(dbs[0], r.profile, !!r.mustChange);
    } catch (e) {
      setErr(errText(e));
      setPw('');
      pwRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };
  const enter = async (db: DbInfo) => {
    try {
      const r = await serverEnter(db.slug);
      onEnter(db, r.profile, r.mustChange);
    } catch (e) {
      setErr(errText(e));
    }
  };

  // several databases for this name: where to go first (the others stay one click away, in the menu "Databases")
  if (places)
    return (
      <BrandFrame brand={step && step !== 'admin' ? { centre: step } : null}>
        <div className="panel login-panel">
          <h2 style={{ marginBottom: 2 }}>{t3(`أهلاً ${name.trim()}`, `Welcome, ${name.trim()}`, `Bienvenue, ${name.trim()}`)}</h2>
          <p className="muted small" style={{ marginTop: 0 }}>{t3('إلى أين تريد أن تذهب؟ تنتقل من واحدة إلى أخرى دون كلمة سر جديدة.', 'Where do you want to go? You can move from one to the other without signing in again.', "Où voulez-vous aller ? Vous passerez de l'une à l'autre sans vous reconnecter.")}</p>
          <div className="mg-places">{places.map((d) => <DbCard key={d.slug} db={d} onOpen={() => void enter(d)} />)}</div>
          {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
        </div>
      </BrandFrame>
    );

  if (step) {
    const admin = step === 'admin';
    const noAdmin = admin && !hello.dir?.on;
    return (
      <BrandFrame brand={admin ? null : { centre: step }}>
        <div className="panel login-panel">
          <h2 style={{ marginBottom: 2 }}>{admin ? t3('المدير', 'Administrator', 'Administrateur') : `MAGIS ${tx(CENTRES[step].name)}`}</h2>
          <p className="muted small" style={{ marginTop: 0 }}>{admin
            ? t3('المدير يرى كل قواعد البيانات، ويستطيع أن يدخل باسم أي مستخدم ليرى ما يراه.', 'The administrator sees every database, and can sign in as any user to see what they see.', "L'administrateur voit toutes les bases, et peut se connecter en tant que n'importe quel utilisateur pour voir ce qu'il voit.")
            : t3('اسمك وكلمة سرك. بعدها ترى ما هو لك فقط.', 'Your name and your password. Then you see only what is yours.', 'Votre nom et votre mot de passe. Ensuite vous ne voyez que ce qui est à vous.')}</p>
          {notice && <div className="alert info">{t3('خرجتَ تلقائياً بعد مدة بلا نشاط. ادخل من جديد لتتابع.', 'You were signed out after a while without activity. Sign in again to continue.', "Vous avez été déconnecté après un moment sans activité. Reconnectez-vous pour continuer.")}</div>}
          {noAdmin ? (
            <>
              <div className="alert info">{t3('لم يُعدّ المدير بعد على هذا الخادم. يُعدّ مرة واحدة من حاسوب الخادم نفسه.', 'No administrator is set up on this server yet. It is set up once, on the server computer itself.', "Aucun administrateur n'est encore défini sur ce serveur. Il se définit une fois, sur l'ordinateur du serveur.")}</div>
              <div className="modal-foot">
                <button type="button" className="btn ghost" onClick={() => setStep(null)}>‹ {t3('رجوع', 'Back', 'Retour')}</button>
                {hello.local && <button type="button" className="btn primary" onClick={() => setSetup(true)}>{t3('إعداد المدير', 'Set up the administrator', "Définir l'administrateur")}</button>}
              </div>
            </>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
              <Field label={t3('الاسم', 'Name', 'Nom')}><input autoFocus={!name} autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label={t3('كلمة السر', 'Password', 'Mot de passe')}><input ref={pwRef} autoFocus={!!name} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
              {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
              <div className="modal-foot">
                <button type="button" className="btn ghost" onClick={() => setStep(null)}>‹ {t3('رجوع', 'Back', 'Retour')}</button>
                <button className="btn primary" disabled={!name.trim() || !pw || busy}>{t3('دخول', 'Enter', 'Entrer')}</button>
              </div>
            </form>
          )}
        </div>
        {setup && <DirSetup onClose={() => setSetup(false)} onDone={async () => { setSetup(false); await onDir(); }} />}
      </BrandFrame>
    );
  }

  return (
    <div className="brand-page mg-page mg-home">
      <div className="brand-spine" />
      <img src="/brand/jesuits.png" alt="" className="mg-jesuits" />
      <div className="mg-hero">
        <Bumper />
        <div className="mg-eyebrow">{t3('الرهبنة اليسوعية · مراكز ماجيس في سوريا', 'Society of Jesus · MAGIS centres in Syria', 'Compagnie de Jésus · Centres MAGIS en Syrie')}</div>
        <Charter />
      </div>
      <main className="brand-main wide">
        <div className="mg-invite">
          <b>{t3('أهلاً وسهلاً', 'Welcome', 'Bienvenue')}</b>
          <span>{t3('اختر بيتك، ثم ادخل باسمك وكلمة سرك.', 'Choose your house, then sign in with your name and your password.', 'Choisissez votre maison, puis entrez avec votre nom et votre mot de passe.')}</span>
        </div>
        <div className="mg-doors">
          {HOUSES.map((k) => (
            <button key={k} type="button" className="mg-door" style={{ '--centre': CENTRES[k].color, '--centre-deep': CENTRES[k].deep } as React.CSSProperties} onClick={() => setStep(k)}>
              <img src={CENTRES[k].mark!} alt="" />
              <b>{tx(CENTRES[k].name)}</b>
              <span>{t3('دخول', 'Sign in', 'Entrer')} ›</span>
            </button>
          ))}
        </div>
        <div className="mg-others">
          {onCommunities && <button type="button" className="btn ghost" onClick={onCommunities}><img src="/brand/jesuits.png" alt="" /> {t3('جماعات اليسوعيين', 'Jesuit communities', 'Communautés jésuites')}</button>}
          <button type="button" className="btn ghost" onClick={() => setStep('admin')}>🔑 {t3('الدخول كمدير', 'Sign in as administrator', 'Entrer comme administrateur')}</button>
        </div>
      </main>
      <footer className="brand-foot"><img src="/brand/marks-combined.png" alt="" /><span>{VALUES()}</span></footer>
    </div>
  );
}
