// The welcome page, in the MAGIS design: warm off-white, a thin gold line,
// the Jesuit mark and the MAGIS sun, and one card per database in its centre's colour.
import { useEffect, useState, type ReactNode } from 'react';
import { CENTRES, brandStyle, guessCentre, logoToDataUrl, type BrandInfo, type CentreKey } from '../brand';
import { getLang, m, tx } from '../i18n';
import type { DbInfo, DirInfo } from '../net';
import { mainListApi, serverCreateDb } from '../net';
import { paletteOf } from '../community/style';
import { CtyUnlock, serverGateCheck } from '../community/ui/CtyGate';
import { Field, errText, t } from './kit';
import { ManageDbs } from './ManageDbs';
import { Coordinator } from './Coordinator';
import { DirAdmin, DirSetup } from './Directory';

/** The MAGIS Charter, in its three languages (Reference/MAGIS-charter.md): shown on the welcome page. */
const CHARTER = m(
  'فإنّنا نحلم بخلق مِساحاتٍ يستطيع فيها الجميع المضيّ أبعدَ وأعمق، فنجدَ معًا الشجاعة ونُحيي الرجاءَ لنكون فاعلين في حياتنا ومجتمعنا.',
  'We dream of a space in which everyone can go further, deeper, so that, together, we can find the courage to be actors of our lives and the hope to build our society.',
  "Nous rêvons d'espaces dans lesquels chacun puisse aller plus loin, davantage en profondeur, afin que, ensemble, nous puissions retrouver le courage d'être acteurs de nos vies et l'espérance pour bâtir notre société.",
);
const HOUSES: CentreKey[] = ['jaramana', 'aleppo', 'homs'];

/** The charter's dream: in Arabic, and smaller under it in English or French (Fouad, 31 October 2026). */
export function Charter() {
  const l = getLang();
  return (
    <blockquote className="mg-quote">
      <p dir="rtl" className="ar">«{CHARTER.ar}»</p>
      {l !== 'ar' && <p dir="ltr" className="tr">“{l === 'fr' ? CHARTER.fr : CHARTER.en}”</p>}
      <cite>— {tx(m('ميثاق ماجيس', 'The MAGIS Charter', 'La Charte MAGIS'))}</cite>
    </blockquote>
  );
}

/** The three houses: their marks, in their colours. */
function Houses({ small }: { small?: boolean }) {
  return (
    <div className={`mg-houses ${small ? 'small' : ''}`}>
      {HOUSES.map((k) => (
        <div key={k} className="mg-house" style={{ '--centre': CENTRES[k].color } as React.CSSProperties}>
          <img src={CENTRES[k].mark!} alt="" />
          <span>{tx(CENTRES[k].name)}</span>
        </div>
      ))}
    </div>
  );
}

/** The heading of the welcome: the MAGIS sun in its light, the name, the three houses, the charter. */
function Hero({ compact, mark }: { compact?: boolean; /** a centre's own mark (its sign-in page) */ mark?: string | null }) {
  return (
    <div className={`mg-hero ${compact ? 'compact' : ''}`}>
      <div className="mg-sun">
        <div className="mg-rays" />
        <img src={mark ?? '/brand/magis-sun.png'} alt="" />
      </div>
      <div className="mg-eyebrow">{t('الرهبنة اليسوعية · مراكز ماجيس في سوريا', 'Society of Jesus · MAGIS centres in Syria')}</div>
      <h1 className="mg-word"><span>MAGIS</span><span className="ar" dir="rtl">ماجيس</span></h1>
      <div className="mg-sub">{tx(m('شبكة رجاء: جرمانا · حلب · حمص', 'A network of hope: Jaramana · Aleppo · Homs', "Un réseau d'espérance : Jaramana · Alep · Homs"))}</div>
      {!compact && <Houses />}
      <Charter />
      {compact && <Houses small />}
    </div>
  );
}

/** The five values of the charter, at the foot of the welcome pages: in Arabic, the English small under each. */
const VALUE_LIST = [
  m('الضيافة والمشاركة', 'Hospitality & sharing', 'Hospitalité et partage'),
  m('الحرية والإبداع', 'Freedom & creativity', 'Liberté et créativité'),
  m('الشجاعة والانفتاح', 'Courage & openness', 'Courage et ouverture'),
  m('البساطة والجمال', 'Simplicity & beauty', 'Simplicité et beauté'),
  m('الثقة والمسؤولية', 'Trust & responsibility', 'Confiance et responsabilité'),
];
export function ValuesFoot() {
  const l = getLang();
  return (
    <footer className="brand-foot mg-values">
      {VALUE_LIST.map((v) => (
        <div key={v.en} className="mg-value">
          <b dir="rtl">{v.ar}</b>
          {l !== 'ar' && <span>{l === 'fr' ? v.fr : v.en}</span>}
        </div>
      ))}
    </footer>
  );
}

/**
 * The page around every welcome, login and setup screen (Fouad, 31 October 2026: "beautiful, with the logos, and an
 * invitation to sign in"): the MAGIS Charter look — warm off-white, the gold, the sun in its light, the three houses and
 * the charter. The list of databases opens under the heading; a sign-in page puts the heading beside the card.
 */
export function BrandFrame({ children, brand, wide, jesuit, title, invite = true, aside }: { children: ReactNode; brand?: BrandInfo | null; wide?: boolean; jesuit?: boolean; title?: string; /** "choose your place, then sign in" (not once signed in) */ invite?: boolean; /** a sign-in page: what stands beside the card (a house and its sentence), instead of the MAGIS heading */ aside?: ReactNode }) {
  const st = brand ? brandStyle(brand) : null;
  // the Jesuit communities: only the Jesuit logo, no centres (Fouad, 18 October 2026)
  if (jesuit)
    return (
      <div className="brand-page jesuit mg-page">
        <div className="brand-spine" />
        <header className="mg-jhead">
          <div className="mg-sun small"><div className="mg-rays" /><img src="/brand/jesuits.png" alt="" /></div>
          <div className="mg-eyebrow">{tx(m('الرهبنة اليسوعية · إقليم الشرق الأدنى', 'Society of Jesus · Province of the Near East', 'Compagnie de Jésus · Province du Proche-Orient'))}</div>
          <h1 className="mg-title">{title ?? tx(m('حسابات الجماعات', "Communities' accounts", 'Comptes des communautés'))}</h1>
        </header>
        <main className={`brand-main ${wide ? 'wide' : ''}`}>{children}</main>
      </div>
    );
  const vars = st ? ({ '--centre': st.color, '--centre-deep': st.deep } as React.CSSProperties) : undefined;
  if (!wide)
    // a sign-in (or a setup): the heading beside, the card in the colour of its centre
    return (
      <div className="brand-page mg-page">
        <div className="brand-spine" />
        <div className="mg-split">
          <aside className="mg-aside">{aside ?? <Hero compact />}</aside>
          <main className="mg-signin" style={vars}>
            {st?.mark && !aside && <img className="mg-card-mark" src={st.mark} alt="" />}
            {children}
          </main>
        </div>
        <ValuesFoot />
      </div>
    );
  return (
    <div className="brand-page mg-page">
      <div className="brand-spine" />
      <img src="/brand/jesuits.png" alt="" className="mg-jesuits" />
      <Hero />
      <main className="brand-main wide" style={vars}>
        {invite && (
          <div className="mg-invite">
            <b>{tx(m('أهلاً وسهلاً', 'Welcome', 'Bienvenue'))}</b>
            <span>{tx(m('اختر مكانك، ثم ادخل باسمك وكلمة سرّك.', 'Choose your place, then sign in with your name and password.', 'Choisissez votre lieu, puis entrez avec votre nom et votre mot de passe.'))}</span>
          </div>
        )}
        {children}
      </main>
      <ValuesFoot />
    </div>
  );
}

export function DbCard({ db, onOpen, path }: { db: DbInfo; onOpen: () => void; /** desktop: the file */ path?: string }) {
  const cty = db.kind === 'community' || db.kind === 'country';
  const pal = cty ? paletteOf(db.color, db.palette) : null;
  const st = pal ? { ...brandStyle(db), color: pal.main, deep: pal.deep } : brandStyle(db);
  return (
    <button className="db-card" onClick={onOpen} style={{ '--centre': st.color, '--centre-deep': st.deep } as React.CSSProperties}>
      <div className="db-card-mark">{db.kind === 'community' || db.kind === 'country' ? <img src="/brand/jesuits.png" alt="" /> : st.mark ? <img src={st.mark} alt="" /> : <img src="/brand/magis-sun.png" alt="" />}</div>
      <div className="db-card-text">
        <b>{db.organisation}</b>
        <span>{db.kind === 'hr' ? tx(m('الموارد البشرية', 'Human resources', 'Ressources humaines')) : db.kind === 'community' ? tx(m('جماعة يسوعية', 'Jesuit community', 'Communauté jésuite')) + (db.city ? ` · ${db.city}` : '') : db.kind === 'country' ? tx(m('قيم البلد', 'Country econome', "Économe du pays")) : tx(st.name)}</span>
        {path && <span className="ltr" style={{ textAlign: 'start', fontSize: 11 }}>{path}</span>}
        {db.setupNeeded && <span className="pill" style={{ background: '#fff6e0', color: '#6d4b00' }}>{t('لم تُعدّ بعد', 'not set up yet')}</span>}
      </div>
    </button>
  );
}

/** Server: the list of databases, and a new one. */
export function Landing({ dbs, canCreate: canCreateAll, canCreateCty, canManage, onManaged, dir, isLocal, onDirChanged, onDirSignOut, onOpen, onCreated, signedIn, address, onLeave, onBackIn, startArea, ctyLocked, onCtyUnlocked, onHome, home }: {
  dbs: DbInfo[];
  canCreate: boolean;
  canCreateCty?: boolean;
  /** the "Manage databases" window: switch off / on, delete, restore */
  canManage?: boolean;
  onManaged?: () => Promise<void>;
  /** the sign-in directory: who is signed in, and what changed (people, access) */
  dir?: DirInfo;
  isLocal?: boolean;
  onDirChanged?: () => Promise<void>;
  onDirSignOut?: () => void;
  onOpen: (db: DbInfo) => void;
  onCreated: (slug: string) => void;
  /** already signed in (came here from inside the program) */
  signedIn?: { name: string; db: string } | null;
  /** desktop app: the server's address, and the way back to this computer's files */
  address?: string | null;
  onLeave?: () => void;
  onBackIn?: () => void;
  /** signed in from a community (or a centre): the list opens on that side */
  startArea?: 'centres' | 'cty' | null;
  /** opened from "Home page": the first choice (MAGIS centres or Jesuit communities), even when signed in */
  home?: boolean;
  /** the communities' side has a password not given yet in this browser */
  ctyLocked?: boolean;
  onCtyUnlocked?: () => Promise<void>;
  /** came from the first page (the communities' side): "Back" goes there */
  onHome?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const [managing, setManaging] = useState(false);
  const [dirAdmin, setDirAdmin] = useState(false);
  const [dirSetup, setDirSetup] = useState(false);
  // one program: first "centres" or "communities", when the server holds both
  const isCty = (x: DbInfo) => x.kind === 'community' || x.kind === 'country';
  // (also when only one kind exists but the person may create: he can start the other kind)
  const both = (dbs.some(isCty) && dbs.some((x) => !isCty(x))) || canCreateAll || !!canCreateCty || !!ctyLocked;
  const [area, setArea] = useState<'centres' | 'cty' | null>(startArea ?? null);
  // on the communities' side, the communities' password is enough to make a new one
  const canCreate = canCreateAll || (area === 'cty' && !!canCreateCty);
  const shown = both && area ? dbs.filter((x) => (area === 'cty') === isCty(x)) : dbs;
  const choosing = both && area === null && (!signedIn || !!home) && !creating;
  // the administrator: the Coordinator's space (the databases, the people), not a list of databases
  if (dir?.person?.admin && area !== 'cty' && !creating)
    return <Coordinator dbs={dbs} dir={dir} onOpen={onOpen} onCreated={onCreated} onChanged={async () => { await onDirChanged?.(); await onManaged?.(); }}
      onSignOut={onDirSignOut ?? (() => undefined)} onCommunities={both ? () => setArea('cty') : undefined} signedIn={signedIn} onBackIn={onBackIn} />;
  // the communities are hidden behind their password (the server does not even name them)
  if (area === 'cty' && ctyLocked)
    return (
      <BrandFrame wide jesuit>
        <CtyUnlock check={serverGateCheck} onBack={() => (onHome ? onHome() : setArea(null))} onOpen={() => { void onCtyUnlocked?.(); }} />
      </BrandFrame>
    );
  if (choosing)
    return (
      <BrandFrame wide jesuit title={tx(m('حسابات اليسوعيين', 'Jesuit accounts', 'Comptes jésuites'))}>
        <div className="mg-invite">
          <b>{tx(m('أهلاً وسهلاً', 'Welcome', 'Bienvenue'))}</b>
          <span>{tx(m('ماذا تريد أن تفتح؟', 'What do you want to open?', 'Que voulez-vous ouvrir ?'))}</span>
        </div>
        <div className="area-grid">
          <button className="area-card" onClick={() => setArea('centres')}>
            <img src="/brand/magis-sun.png" alt="" />
            <b>{tx(m('مراكز ماجيس', 'MAGIS centres', 'Centres MAGIS'))}</b>
            <span>{tx(m('جرمانا · حلب · حمص', 'Jaramana · Aleppo · Homs', 'Jaramana · Alep · Homs'))}</span>
            <Houses small />
          </button>
          <button className="area-card" onClick={() => setArea('cty')}>
            <img src="/brand/jesuits.png" alt="" />
            <b>{tx(m('جماعات اليسوعيين', 'Jesuit communities', 'Communautés jésuites'))}</b>
            <span>{tx(m('اليسوعيون وبيتهم، والقيم', 'The Jesuits, their house, the econome', "Les jésuites, leur maison, l'économe"))}</span>
          </button>
        </div>
        {dir?.person && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button className="btn small ghost" onClick={onDirSignOut}>{dir.person.name} · {tx(m('خروج', 'Sign out', 'Se déconnecter'))}</button>
          </div>
        )}
      </BrandFrame>
    );
  return (
    <BrandFrame wide jesuit={area === 'cty' || (shown.length > 0 && shown.every(isCty))} invite={!signedIn && !dir?.person}>
      {address && (
        <div className="row muted small" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <span>{t('متصل بخادم المركز', "Connected to the centre's server")} · <span className="ltr">{address}</span></span>
          {onLeave && <button className="btn small ghost" onClick={onLeave}>{t('ترك الخادم (ملفات هذا الحاسوب)', "Leave the server (this computer's files)")}</button>}
        </div>
      )}
      {!creating ? (
        <>
          {signedIn && (
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="muted">{signedIn.name} · {signedIn.db}</span>
              {onBackIn && <button className="btn small" onClick={onBackIn}>{t('رجوع إلى', 'Back to')} {signedIn.db}</button>}
            </div>
          )}
          {((both && area) || onHome) && <button className="cty-back" onClick={() => (onHome ? onHome() : setArea(null))}>‹ {tx(m('رجوع', 'Back', 'Retour'))}</button>}
          <div className="db-grid">
            {shown.map((d) => <DbCard key={d.slug} db={d} onOpen={() => onOpen(d)} />)}
            <button className="db-card db-new" onClick={() => (canCreate ? setCreating(true) : setHowTo((x) => !x))}>
              <div className="db-card-mark"><span>＋</span></div>
              <div className="db-card-text">{area === 'cty'
                ? <><b>{tx(m('جماعة أو بلد جديد', 'A new community or country', 'Une nouvelle communauté ou un pays'))}</b><span>{tx(m('الاسم، العنوان، الألوان، الأشخاص', 'name, address, colours, people', 'nom, adresse, couleurs, personnes'))}</span></>
                : <><b>{t('قاعدة بيانات جديدة', 'New database')}</b><span>{t('مركز، تجربة، سنة جديدة…', 'a centre, a test, a new year…')}</span></>}</div>
            </button>
          </div>
          {(canManage || dir?.person || signedIn || (isLocal && dir && !dir.on)) && (
            <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {dir?.person?.admin && <button className="btn small ghost" onClick={() => setDirAdmin(true)}>👥 {tx(m('الأشخاص والصلاحيات', 'People & access', 'Personnes et accès'))}</button>}
              {isLocal && dir && !dir.on && <button className="btn small ghost" onClick={() => setDirSetup(true)}>🔑 {tx(m('تفعيل دليل الدخول', 'Set up the sign-in directory', "Mettre en place l'annuaire de connexion"))}</button>}
              {canManage && <button className="btn small ghost" onClick={() => setManaging(true)}>⚙ {tx(m('إدارة قواعد البيانات', 'Manage databases', 'Gérer les bases de données'))}</button>}
              {(dir?.person || signedIn) && <button className="btn small ghost" onClick={onDirSignOut}>{dir?.person?.name ?? signedIn?.name} · {tx(m('خروج', 'Sign out', 'Se déconnecter'))}</button>}
            </div>
          )}
          {managing && <ManageDbs onClose={() => setManaging(false)} onChanged={async () => { await onManaged?.(); }} />}
          {dirAdmin && <DirAdmin onClose={() => setDirAdmin(false)} onChanged={async () => { await onDirChanged?.(); }} />}
          {dirSetup && <DirSetup onClose={() => setDirSetup(false)} onDone={async () => { setDirSetup(false); await onDirChanged?.(); }} />}
          {howTo && !canCreate && (
            <div className="alert info" style={{ marginTop: 14 }}>
              {area === 'cty'
                ? tx(m('أول جماعة تُنشأ على حاسوب الخادم نفسه: https://localhost:8443 (وهي تضع كلمة سر الجماعات). بعدها يستطيع من يعرف كلمة السر إنشاء جماعة من أي حاسوب.', "The first community is made on the server computer itself (https://localhost:8443): it sets the communities' password. After that, anyone who knows that password can make a community from any computer.", "La première communauté se crée sur l'ordinateur du serveur (https://localhost:8443) : elle fixe le mot de passe des communautés. Ensuite, toute personne qui le connaît peut en créer une depuis n'importe quel ordinateur."))
                : dbs.length
                ? t('لإنشاء قاعدة بيانات: ادخل أولاً إلى قاعدة موجودة باسم من يدير المستخدمين (الرئيس)، ثم من القائمة اختر «قواعد البيانات · جديدة». أو افتح الصفحة على حاسوب الخادم نفسه.',
                  'To create a database: first sign in to an existing one as someone who manages users (the Superior), then in the menu choose "Databases · new". Or open this page on the server computer itself.')
                : t('أول قاعدة بيانات تُنشأ على حاسوب الخادم نفسه: https://localhost:8443', 'The first database is created on the server computer itself: https://localhost:8443')}
            </div>
          )}
        </>
      ) : (
        <CreateDb onCancel={() => setCreating(false)} onCreated={onCreated} community={area === 'cty' || (!both && dbs.length > 0 && dbs.every(isCty))} />
      )}
    </BrandFrame>
  );
}

/** A colour and a logo of one's own (e.g. the scouts). */
export function OwnBrand({ color, setColor, logo, setLogo }: { color: string; setColor: (c: string) => void; logo: string | null; setLogo: (l: string | null) => void }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid2" style={{ marginTop: 12 }}>
      <Field label={t('اللون', 'Colour')}>
        <div className="row"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 64, height: 40, padding: 2 }} /><span className="code">{color}</span></div>
      </Field>
      <Field label={t('الشعار (PNG أو JPG أو SVG)', 'Logo (PNG, JPG or SVG)')}>
        <div className="row">
          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              setErr(null);
              setLogo(await logoToDataUrl(f));
            } catch (x) {
              setErr(errText(x));
            }
          }} />
          {logo && <><img src={logo} alt="" style={{ height: 40 }} /><button type="button" className="btn small ghost" onClick={() => setLogo(null)}>✕</button></>}
        </div>
      </Field>
      {err && <div className="alert err span2">{err}</div>}
    </div>
  );
}

export function CreateDb({ onCancel, onCreated, community }: { onCancel?: () => void; onCreated: (slug: string) => void; /** a community or country: no centre colours (they are chosen at setup) */ community?: boolean }) {
  const [name, setName] = useState('');
  const [centre, setCentre] = useState<CentreKey | 'own' | null>(null);
  const [color, setColor] = useState('#2E7D32');
  const [logo, setLogo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ctyKind, setCtyKind] = useState<'community' | 'country'>('community');
  const [isHr, setIsHr] = useState(false);
  // the list of headings and lines it follows (Fouad, 2026-11-07), when the server has lists
  const [lists, setLists] = useState<{ id: string; title: string }[]>([]);
  const [mainList, setMainList] = useState<string | null>(null);
  useEffect(() => {
    if (!community) mainListApi.names().then((x) => { setLists(x); setMainList(x[0]?.id ?? null); }).catch(() => setLists([]));
  }, [community]);
  const chosen = centre ?? (name ? guessCentre(name) : null);
  const go = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = community ? await serverCreateDb(name, 'other', null, null, ctyKind) : isHr ? await serverCreateDb(name, 'other', null, null, 'hr') : chosen === 'own' ? await serverCreateDb(name, 'other', color, logo, null, mainList) : await serverCreateDb(name, chosen ?? 'other', null, null, null, mainList);
      onCreated(r.slug);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 720, margin: '0 auto' }}>
      <h2>{community ? tx(m('جماعة أو بلد جديد', 'A new community or country', 'Une nouvelle communauté ou un pays')) : t('قاعدة بيانات جديدة', 'New database')}</h2>
      {community && (
        <div className="choice" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', marginBottom: 12 }}>
          <button type="button" className={ctyKind === 'community' ? 'on' : ''} onClick={() => setCtyKind('community')}>
            <b>{tx(m('جماعة جديدة', 'A new community', 'Une nouvelle communauté'))}</b>
            <span className="muted small">{tx(m('اليسوعيون وبيتهم، والقيم.', 'The Jesuits, their house, the econome.', "Les jésuites, leur maison, l'économe."))}</span>
          </button>
          <button type="button" className={ctyKind === 'country' ? 'on' : ''} onClick={() => setCtyKind('country')}>
            <b>{tx(m('بلد جديد (قيم البلد)', 'A new country (country econome)', 'Un nouveau pays (économe du pays)'))}</b>
            <span className="muted small">{tx(m('ملفات الجماعات، المطالبات، المصالحة.', "The communities' files, claims, reconciliation.", 'Fichiers des communautés, réclamations, réconciliation.'))}</span>
          </button>
        </div>
      )}
      <Field label={community ? (ctyKind === 'country' ? tx(m('اسم البلد', 'Name of the country', 'Nom du pays')) : tx(m('اسم الجماعة', 'Name of the community', 'Nom de la communauté'))) : t('الاسم (مثلاً: ماجيس حمص، حمص 2027، تجربة)', 'Name (e.g. MAGIS Homs, Homs 2027, Test)')}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {!community && (
        <label className="row" style={{ gap: 8, marginTop: 12 }}>
          <input type="checkbox" checked={isHr} onChange={(e) => setIsHr(e.target.checked)} />
          <span><b>{tx(m('هذه قاعدة الموارد البشرية', 'This is the HR database', "C'est la base des ressources humaines"))}</b> <span className="muted small">{tx(m('خاصة: الأشخاص والاتفاقيات والوثائق', 'private: people, agreements, documents', 'privée : personnes, accords, documents'))}</span></span>
        </label>
      )}
      {!community && !isHr && <><h3 style={{ marginTop: 16 }}>{t('المركز: لونه ورمزه', 'Centre: its colour and mark')}</h3>
      <div className="centre-pick">
        {(Object.keys(CENTRES) as CentreKey[]).map((k) => {
          const st = CENTRES[k];
          return (
            <button key={k} type="button" className={chosen === k ? 'on' : ''} onClick={() => setCentre(k)} style={{ '--centre': st.color, '--centre-deep': st.deep } as React.CSSProperties}>
              {st.mark ? <img src={st.mark} alt="" /> : <img src="/brand/magis-sun.png" alt="" />}
              <span>{tx(st.name)}</span>
            </button>
          );
        })}
        <button type="button" className={chosen === 'own' ? 'on' : ''} onClick={() => setCentre('own')} style={{ '--centre': color, '--centre-deep': brandStyle({ centre: 'other', color }).deep } as React.CSSProperties}>
          {logo ? <img src={logo} alt="" /> : <span style={{ fontSize: 34, lineHeight: '56px', color }}>●</span>}
          <span>{t('شعار ولون خاصّان', 'Own logo & colour')}</span>
        </button>
      </div>
      {chosen === 'own' && <OwnBrand color={color} setColor={setColor} logo={logo} setLogo={setLogo} />}
      {lists.length > 0 && (
        <Field label={t('قائمة البنود والخطوط (تُؤخذ كلها، ثم يُوقف ما لا يُستعمل)', 'List of headings and lines (taken whole; then switch off what is not used)')}>
          <select value={mainList ?? ''} onChange={(e) => setMainList(e.target.value || null)}>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
          </select>
        </Field>
      )}</>}
      <p className="muted small">{community
        ? tx(m('بعدها: العنوان والألوان والأشخاص.', 'Next: its address, colours and people.', 'Ensuite : adresse, couleurs et personnes.'))
        : t('بعدها: تبدأ من ملف Excel، أو فارغة، أو من ملف البرنامج المكتبي.', 'Next: start from the Excel workbook, empty, or from the desktop program\'s file.')}</p>
      {err && <div className="alert err">{err}</div>}
      <div className="modal-foot">
        {onCancel && <button className="btn" onClick={onCancel}>{t('رجوع', 'Back')}</button>}
        <button className="btn primary" disabled={!name.trim() || busy} onClick={go}>{t('متابعة', 'Continue')}</button>
      </div>
    </div>
  );
}
