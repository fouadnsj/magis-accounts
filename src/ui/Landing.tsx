// The welcome page, in the MAGIS design: warm off-white, a thin gold line,
// the Jesuit mark and the MAGIS sun, and one card per database in its centre's colour.
import { useState, type ReactNode } from 'react';
import { CENTRES, brandStyle, guessCentre, logoToDataUrl, type BrandInfo, type CentreKey } from '../brand';
import { m, tx } from '../i18n';
import type { DbInfo } from '../net';
import { serverCreateDb } from '../net';
import { Field, errText, t } from './kit';

/** The page around every welcome, login and setup screen. */
export function BrandFrame({ children, brand, wide }: { children: ReactNode; brand?: BrandInfo | null; wide?: boolean }) {
  const st = brand ? brandStyle(brand) : null;
  return (
    <div className="brand-page">
      <div className="brand-spine" />
      <header className="brand-head">
        <img src="/brand/jesuits.png" alt="" className="brand-jesuits" />
        <div className="brand-title">
          <div className="brand-eyebrow">{t('الرهبنة اليسوعية · مراكز ماجيس في سوريا', 'Society of Jesus · MAGIS centres in Syria')}</div>
          <h1>{t('حسابات ماجيس', 'MAGIS Accounts')}</h1>
          <div className="brand-cities">{t('جرمانا · حلب · حمص', 'Jaramana · Aleppo · Homs')}</div>
        </div>
        {st?.mark ? <img src={st.mark} alt="" className="brand-sun" /> : <img src="/brand/magis-sun.png" alt="" className="brand-sun" />}
      </header>
      <main className={`brand-main ${wide ? 'wide' : ''}`} style={st ? ({ '--centre': st.color, '--centre-deep': st.deep } as React.CSSProperties) : undefined}>
        {children}
      </main>
      <footer className="brand-foot">
        <img src="/brand/marks-combined.png" alt="" />
        <span>{t('الضيافة والمشاركة · الحرية والإبداع · الشجاعة والانفتاح · البساطة والجمال · الثقة والمسؤولية', 'Hospitality & sharing · Freedom & creativity · Courage & openness · Simplicity & beauty · Trust & responsibility')}</span>
      </footer>
    </div>
  );
}

export function DbCard({ db, onOpen }: { db: DbInfo; onOpen: () => void }) {
  const st = brandStyle(db);
  return (
    <button className="db-card" onClick={onOpen} style={{ '--centre': st.color, '--centre-deep': st.deep } as React.CSSProperties}>
      <div className="db-card-mark">{st.mark ? <img src={st.mark} alt="" /> : <img src="/brand/magis-sun.png" alt="" />}</div>
      <div className="db-card-text">
        <b>{db.organisation}</b>
        <span>{db.kind === 'community' ? tx(m('جماعة يسوعية', 'Jesuit community', 'Communauté jésuite')) : db.kind === 'country' ? tx(m('قيّم البلد', 'Country econome', "Économe du pays")) : tx(st.name)}</span>
        {db.setupNeeded && <span className="pill" style={{ background: '#fff6e0', color: '#6d4b00' }}>{t('لم تُعدّ بعد', 'not set up yet')}</span>}
      </div>
    </button>
  );
}

/** Server: the list of databases, and a new one. */
export function Landing({ dbs, canCreate, onOpen, onCreated, signedIn, address, onLeave, onBackIn }: {
  dbs: DbInfo[];
  canCreate: boolean;
  onOpen: (db: DbInfo) => void;
  onCreated: (slug: string) => void;
  /** already signed in (came here from inside the program) */
  signedIn?: { name: string; db: string } | null;
  /** desktop app: the server's address, and the way back to this computer's files */
  address?: string | null;
  onLeave?: () => void;
  onBackIn?: () => void;
}) {
  const [creating, setCreating] = useState(dbs.length === 0 && canCreate);
  const [howTo, setHowTo] = useState(false);
  return (
    <BrandFrame wide>
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
          <h2 className="brand-h2">{t('اختر قاعدة البيانات', 'Choose a database')}</h2>
          <div className="db-grid">
            {dbs.map((d) => <DbCard key={d.slug} db={d} onOpen={() => onOpen(d)} />)}
            <button className="db-card db-new" onClick={() => (canCreate ? setCreating(true) : setHowTo((x) => !x))}>
              <div className="db-card-mark"><span>＋</span></div>
              <div className="db-card-text"><b>{t('قاعدة بيانات جديدة', 'New database')}</b><span>{t('مركز، تجربة، سنة جديدة…', 'a centre, a test, a new year…')}</span></div>
            </button>
          </div>
          {howTo && !canCreate && (
            <div className="alert info" style={{ marginTop: 14 }}>
              {dbs.length
                ? t('لإنشاء قاعدة بيانات: ادخل أولاً إلى قاعدة موجودة باسم من يدير المستخدمين (الرئيس)، ثم من القائمة اختر «قواعد البيانات · جديدة». أو افتح الصفحة على حاسوب الخادم نفسه.',
                  'To create a database: first sign in to an existing one as someone who manages users (the Superior), then in the menu choose "Databases · new". Or open this page on the server computer itself.')
                : t('أول قاعدة بيانات تُنشأ على حاسوب الخادم نفسه: https://localhost:8443', 'The first database is created on the server computer itself: https://localhost:8443')}
            </div>
          )}
        </>
      ) : (
        <CreateDb onCancel={() => setCreating(false)} onCreated={onCreated} />
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

function CreateDb({ onCancel, onCreated }: { onCancel?: () => void; onCreated: (slug: string) => void }) {
  const [name, setName] = useState('');
  const [centre, setCentre] = useState<CentreKey | 'own' | null>(null);
  const [color, setColor] = useState('#2E7D32');
  const [logo, setLogo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = centre ?? (name ? guessCentre(name) : null);
  const go = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = chosen === 'own' ? await serverCreateDb(name, 'other', color, logo) : await serverCreateDb(name, chosen ?? 'other');
      onCreated(r.slug);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 720, margin: '0 auto' }}>
      <h2>{t('قاعدة بيانات جديدة', 'New database')}</h2>
      <Field label={t('الاسم (مثلاً: ماجيس حمص، حمص 2027، تجربة)', 'Name (e.g. MAGIS Homs, Homs 2027, Test)')}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <h3 style={{ marginTop: 16 }}>{t('المركز: لونه ورمزه', 'Centre: its colour and mark')}</h3>
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
      <p className="muted small">{t('بعدها: تبدأ من ملف Excel، أو فارغة، أو من ملف البرنامج المكتبي.', 'Next: start from the Excel workbook, empty, or from the desktop program\'s file.')}</p>
      {err && <div className="alert err">{err}</div>}
      <div className="modal-foot">
        {onCancel && <button className="btn" onClick={onCancel}>{t('رجوع', 'Back')}</button>}
        <button className="btn primary" disabled={!name.trim() || busy} onClick={go}>{t('متابعة', 'Continue')}</button>
      </div>
    </div>
  );
}
