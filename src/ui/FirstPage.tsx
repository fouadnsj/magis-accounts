// The first page of the server (Fouad, 31 October 2026): no database is shown before someone signs in. The marks come
// in, with the sentence of hope; each house shows its own sentence (on the mouse, and beside its sign-in), as in the
// MAGIS animation of July. Then: choose your house, your name and your password; or the administrator.
// Then the person sees only the databases where that name has that password (their house's accounts, HR).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CENTRES, type CentreKey } from '../brand';
import { getLang, m, tx, type Msg } from '../i18n';
import { serverEnter, serverSignIn, type DbInfo, type Hello } from '../net';
import type { Profile } from '../auth';
import { BrandFrame, Charter, DbCard, ValuesFoot } from './Landing';
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

/** The sentences of the MAGIS animation (July 2026): one for each house, and the hope that holds them together. */
const HOPE = m('رغم كلِّ شيء، الرجاء ممكن', 'Despite everything, hope is possible', "Malgré tout, l'espérance est possible");
const SENTENCE: Record<'jaramana' | 'aleppo' | 'homs', Msg> = {
  jaramana: m('في هذا البيت، البابُ مفتوحٌ قبل أن تصل', 'In this house the door is open before you arrive', 'Dans cette maison, la porte est ouverte avant que tu arrives'),
  aleppo: m('كلُّ إنسانٍ يدخل من هنا هو بداية', 'Everyone who comes through here is a beginning', 'Chaque personne qui entre ici est un commencement'),
  homs: m('أيدٍ مفتوحة، بعد كلِّ ما فُقد', 'Open hands, after everything that was lost', 'Des mains ouvertes, après tout ce qui a été perdu'),
};
const houseVars = (k: CentreKey) => ({ '--centre': CENTRES[k].color, '--centre-deep': CENTRES[k].deep } as CSSProperties);

/** A sentence in Arabic and, under it, in English or French (Arabic alone when the program is in Arabic). */
function Said({ msg, className }: { msg: Msg; className?: string }) {
  const l = getLang();
  return (
    <div className={`mg-said ${className ?? ''}`}>
      <p className="ar" dir="rtl">{msg.ar}</p>
      {l !== 'ar' && <p className="tr" dir="ltr">{l === 'fr' ? msg.fr ?? msg.en : msg.en}</p>}
    </div>
  );
}

/** The opening: the Jesuit sun, then the three houses one after the other, then the sentence of hope. */
function Opening() {
  return (
    <div className="mg-opening">
      <div className="mg-o-sun"><span className="mg-rays" /><img src="/brand/jesuits.png" alt="" /></div>
      <div className="mg-o-houses">
        {HOUSES.map((k, i) => <img key={k} src={CENTRES[k].mark!} alt="" style={{ animationDelay: `${0.7 + i * 0.35}s` }} />)}
      </div>
      <Said msg={HOPE} className="mg-o-hope" />
    </div>
  );
}

/** Beside a house's sign-in: its mark in its light, its name, its sentence. */
function HouseHero({ house }: { house: CentreKey }) {
  return (
    <div className="mg-househero" style={houseVars(house)} key={house}>
      <div className="mg-hh-mark"><span className="mg-hh-halo" /><img src={CENTRES[house].mark!} alt="" /></div>
      <div className="mg-eyebrow">MAGIS · {tx(CENTRES[house].name)}</div>
      <Said msg={SENTENCE[house as keyof typeof SENTENCE]} className="mg-hh-said" />
      <div className="mg-hh-hope">{tx(HOPE)}</div>
    </div>
  );
}

/** The Jesuits' door (Fouad, 13 November 2026): the sun, and the communities' own words. */
function JesuitHero() {
  return (
    <div className="mg-househero">
      <div className="mg-hh-mark"><span className="mg-hh-halo" /><img src="/brand/jesuits.png" alt="" /></div>
      <div className="mg-eyebrow">{t3('الرهبنة اليسوعية · إقليم الشرق الأدنى', 'Society of Jesus · Province of the Near East', 'Compagnie de Jésus · Province du Proche-Orient')}</div>
      <div className="mg-hh-hope">{t3('حسابات الجماعات', "The communities' accounts", 'Les comptes des communautés')}</div>
    </div>
  );
}
type Step = CentreKey | 'admin' | 'jesuits';
/** the Jesuits' door has its own address: …/jesuits */
const atJesuits = () => { try { return location.pathname.replace(/\/+$/, '') === '/jesuits'; } catch { return false; } };

export function FirstPage({ hello, notice, refresh, onEnter, onDir, onCommunities, jesuits, server }: {
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
  /** open on the Jesuits' door (after a Jesuit signs out) */
  jesuits?: boolean;
  /** the desktop app: the server it is connected to, and going to another one */
  server?: { address: string; onChange: () => void };
}) {
  const last = remembered();
  const [step, setStep] = useState<Step | null>(jesuits || atJesuits() ? 'jesuits' : notice && last.house ? last.house : null);
  // the address follows the door: …/jesuits for the Jesuits, / for the houses
  useEffect(() => {
    try {
      const want = step === 'jesuits' ? '/jesuits' : '/';
      if (location.pathname !== want) history.replaceState(null, '', want);
    } catch { /* not in a browser window */ }
  }, [step]);
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
      if (step !== 'admin') remember(step as CentreKey, name.trim());
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
  const house = step && step !== 'admin' && step !== 'jesuits' ? step : null;
  if (places)
    return (
      <BrandFrame brand={house ? { centre: house } : null} aside={house ? <HouseHero house={house} /> : step === 'jesuits' ? <JesuitHero /> : undefined}>
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
    const jes = step === 'jesuits';
    const noAdmin = admin && !hello.dir?.on;
    return (
      <BrandFrame brand={house ? { centre: house } : null} aside={house ? <HouseHero house={house} /> : jes ? <JesuitHero /> : undefined}>
        <div className="panel login-panel">
          <h2 style={{ marginBottom: 2 }}>{admin ? t3('المدير', 'Administrator', 'Administrateur') : jes ? t3('جماعات اليسوعيين', 'Jesuit communities', 'Communautés jésuites') : `MAGIS ${tx(CENTRES[house!].name)}`}</h2>
          <p className="muted small" style={{ marginTop: 0 }}>{admin
            ? t3('المدير يرى كل قواعد البيانات، ويستطيع أن يدخل باسم أي مستخدم ليرى ما يراه.', 'The administrator sees every database, and can sign in as any user to see what they see.', "L'administrateur voit toutes les bases, et peut se connecter en tant que n'importe quel utilisateur pour voir ce qu'il voit.")
            : jes ? t3('اسمك وكلمة سرك. تدخل إلى جماعتك؛ إن كنت قيّماً أو مدبّراً أو رئيساً تختار ذلك في الداخل، بلا كلمة سر أخرى.', 'Your name and your password. You go into your community; if you are also econome, minister or Superior, you choose it inside, with no other password.', "Votre nom et votre mot de passe. Vous entrez dans votre communauté ; si vous êtes aussi économe, ministre ou supérieur, vous le choisissez à l'intérieur, sans autre mot de passe.")
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
                <button type="button" className="btn ghost" onClick={() => setStep(null)}>‹ {jes ? t3('مراكز ماجيس', 'MAGIS centres', 'Centres MAGIS') : t3('رجوع', 'Back', 'Retour')}</button>
                <button className="btn primary" disabled={!name.trim() || !pw || busy}>{t3('دخول', 'Enter', 'Entrer')}</button>
              </div>
            </form>
          )}
          {jes && onCommunities && (
            <p className="small" style={{ marginTop: 14, textAlign: 'center' }}>
              <button type="button" className="btn ghost small" onClick={onCommunities}>{t3('قواعد بيانات الجماعات (إنشاء، إدارة)', "The communities' databases (make one, manage)", 'Les bases des communautés (en créer, gérer)')}</button>
            </p>
          )}
        </div>
        {setup && <DirSetup onClose={() => setSetup(false)} onDone={async () => { setSetup(false); await onDir(); }} />}
      </BrandFrame>
    );
  }

  return (
    <div className="brand-page mg-page mg-home">
      <div className="brand-spine" />
      <div className="mg-hero">
        <Opening />
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
            <button key={k} type="button" className="mg-door" style={houseVars(k)} onClick={() => setStep(k)} aria-label={`${tx(CENTRES[k].name)} · ${t3('دخول', 'Sign in', 'Entrer')}`}>
              <div className="mg-door-mark"><span className="mg-hh-halo" /><img src={CENTRES[k].mark!} alt="" /></div>
              <b>{tx(CENTRES[k].name)}</b>
              <Said msg={SENTENCE[k as keyof typeof SENTENCE]} className="mg-door-said" />
              <span className="mg-door-go">{t3('دخول', 'Sign in', 'Entrer')} ›</span>
            </button>
          ))}
        </div>
        {server && (
          <p className="muted small" style={{ textAlign: 'center' }}>
            {t3('متصل بالخادم', 'Connected to the server', 'Connecté au serveur')} <span className="ltr">{server.address.replace(/^https:\/\//, '')}</span> ·{' '}
            <button type="button" className="btn ghost small" onClick={server.onChange}>{t3('تغيير الخادم', 'Change server', 'Changer de serveur')}</button>
          </p>
        )}
      </main>
      <ValuesFoot />
      {/* under the values (Fouad, 15 November 2026): the Jesuit communities and the administrator, as two badges */}
      <div className="mg-badges">
        {onCommunities && (
          <button type="button" className="mg-badge jesuits" onClick={() => setStep('jesuits')} aria-label={`${t3('جماعات اليسوعيين', 'Jesuit communities', 'Communautés jésuites')} · ${t3('دخول', 'Sign in', 'Entrer')}`}>
            <img src="/brand/jesuits.png" alt="" />
            <span className="mg-badge-text">
              <b>{t3('جماعات اليسوعيين', 'Jesuit communities', 'Communautés jésuites')}</b>
              <i className="amdg"><span dir="rtl">لمجد الله الأعظم</span><span>Ad Majorem Dei Gloriam</span><span>{t3('', 'For the greater glory of God', 'Pour la plus grande gloire de Dieu')}</span></i>
            </span>
            <span className="mg-badge-go">{t3('دخول', 'Sign in', 'Entrer')} ›</span>
          </button>
        )}
        <button type="button" className="mg-badge admin" onClick={() => setStep('admin')}>
          <span className="mg-badge-icon">🔑</span>
          <span className="mg-badge-text"><b>{t3('الدخول كمدير', 'Sign in as administrator', 'Entrer comme administrateur')}</b></span>
          <span className="mg-badge-go">›</span>
        </button>
      </div>
    </div>
  );
}
