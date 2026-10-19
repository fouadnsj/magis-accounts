// Creating a community database: its name, its currency, its Jesuits (each with his own
// account) and its four offices (Superior, Econome, Minister, Administrator), each held by
// a person and with its own password (Fouad, 19 October 2026). Three steps: the community
// (name, address, city, country, currency), its colours, then the people and offices.
import { useState } from 'react';
import { errText } from '../../ui/kit';
import type { CommunitySetup, CtyPerson } from '../setup';
import type { Office } from '../people';
import type { CountrySetup } from '../country';
import { t3 } from './text';
import { getLang } from '../../i18n';
import { COUNTRIES, currencyOf } from '../places';
import type { StyleInput } from '../style';
import { DEFAULT_STYLE, StylePicker } from './StylePicker';
import { GateFields, gateProblem } from './CtyGate';

const OFFICE_LIST: { o: Office; label: () => string; help: () => string }[] = [
  { o: 'superior', label: () => t3('الرئيس', 'Superior', 'Supérieur'), help: () => t3('يرى كل شيء، يوافق أو يرفض، يعلّق. لا يغيّر شيئاً.', 'Sees everything, approves or refuses, comments. Changes nothing.', 'Voit tout, approuve ou refuse, commente. Ne change rien.') },
  { o: 'econome', label: () => t3('القيم', 'Econome', 'Économe'), help: () => t3('يرى كل شيء؛ يعمل في صندوقه فقط: يعطي المال ويستلمه.', 'Sees everything; works in his own books only: gives and receives money.', 'Voit tout ; ne travaille que dans ses comptes : donne et reçoit de l’argent.') },
  { o: 'minister', label: () => t3('المدبر', 'Minister', 'Ministre'), help: () => t3('يمسك حساب البيت وأظرفته.', 'Keeps the house account and its envelopes.', 'Tient le compte de la maison et ses enveloppes.') },
  { o: 'admin', label: () => t3('المشرف', 'Administrator', 'Administrateur'), help: () => t3('الحسابات وكلمات السر والصلاحيات والإعدادات؛ لا يرى أي قيد.', 'Accounts, passwords, permissions, settings; sees no record.', 'Comptes, mots de passe, permissions, réglages ; ne voit aucune écriture.') },
];

export const CURRENCIES: { code: string; name: () => string }[] = [
  { code: 'SYP', name: () => t3('الليرة السورية', 'Syrian pound', 'Livre syrienne') },
  { code: 'LBP', name: () => t3('الليرة اللبنانية', 'Lebanese pound', 'Livre libanaise') },
  { code: 'EGP', name: () => t3('الجنيه المصري', 'Egyptian pound', 'Livre égyptienne') },
  { code: 'JOD', name: () => t3('الدينار الأردني', 'Jordanian dinar', 'Dinar jordanien') },
  { code: 'IQD', name: () => t3('الدينار العراقي', 'Iraqi dinar', 'Dinar irakien') },
  { code: 'ILS', name: () => t3('الشيكل', 'Shekel', 'Shekel') },
  { code: 'DZD', name: () => t3('الدينار الجزائري', 'Algerian dinar', 'Dinar algérien') },
  { code: 'MAD', name: () => t3('الدرهم المغربي', 'Moroccan dirham', 'Dirham marocain') },
  { code: 'TRY', name: () => t3('الليرة التركية', 'Turkish lira', 'Livre turque') },
];
/** The country and its local currency (the currency follows the country unless chosen). */
function CountryAndCurrency({ country, setCountry, local, setLocal }: { country: string; setCountry: (c: string) => void; local: string; setLocal: (c: string) => void }) {
  const known = CURRENCIES.some((c) => c.code === local);
  return (
    <>
      <label className="field"><span>{t3('البلد', 'Country', 'Pays')}</span>
        <input list="cty-countries" value={country} onChange={(e) => { setCountry(e.target.value); const c = currencyOf(e.target.value); if (c) setLocal(c); }} />
        <datalist id="cty-countries">{COUNTRIES.map((c) => <option key={c.en} value={countryName(c)} />)}</datalist>
      </label>
      <label className="field"><span>{t3('العملة المحلية', 'Local currency', 'Monnaie locale')}</span>
        <select value={known ? local : '*'} onChange={(e) => setLocal(e.target.value === '*' ? '' : e.target.value)}>
          {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name()}</option>)}
          <option value="*">{t3('عملة أخرى…', 'Another currency…', 'Une autre monnaie…')}</option>
        </select>
        {!known && <input style={{ marginTop: 6 }} value={local} maxLength={3} placeholder="XXX" onChange={(e) => setLocal(e.target.value.toUpperCase())} />}
      </label>
    </>
  );
}

/** A country's name in the reader's language (one name, never two: it is stored). */
const countryName = (c: { en: string; fr: string; ar: string }) => { const l = getLang(); return l === 'ar' ? c.ar : l === 'fr' ? c.fr : c.en; };

function Steps({ step, titles }: { step: number; titles: string[] }) {
  return <div className="sty-steps">{titles.map((x, i) => <span key={x} className={i === step ? 'on' : i < step ? 'done' : ''}>{i < step ? '✓' : i + 1} · {x}</span>)}</div>;
}

export function CommunityForm({ initialName = '', onSubmit, onBack, demo, askGate }: {
  initialName?: string;
  /** the first community here: choose the communities' password too */
  askGate?: boolean;
  onSubmit: (s: CommunitySetup) => Promise<void>;
  onBack: () => void;
  /** the browser preview: offers a demo community with invented names */
  demo?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState(countryName(COUNTRIES[0]));
  const [local, setLocal] = useState('SYP');
  const [hasBank, setHasBank] = useState(false);
  const [style, setStyle] = useState<StyleInput>(DEFAULT_STYLE);
  const [people, setPeople] = useState<CtyPerson[]>([{ name: '', password: '' }, { name: '', password: '' }, { name: '', password: '' }]);
  const [offices, setOffices] = useState<Record<Office, { heldBy: string; password: string }>>({
    superior: { heldBy: '', password: '' }, econome: { heldBy: '', password: '' }, minister: { heldBy: '', password: '' }, admin: { heldBy: '', password: '' },
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gateA, setGateA] = useState('');
  const [gateB, setGateB] = useState('');

  const set = (i: number, p: Partial<CtyPerson>) => setPeople(people.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const names = people.map((p) => p.name.trim()).filter(Boolean);
  const setOffice = (o: Office, p: Partial<{ heldBy: string; password: string }>) => setOffices({ ...offices, [o]: { ...offices[o], ...p } });

  const submit = async (s: CommunitySetup) => {
    setErr(null);
    setBusy(true);
    try {
      await onSubmit(s);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const fullStyle: StyleInput = { ...style, address, city };
  const go = () => {
    const p = askGate ? gateProblem(gateA, gateB) : null;
    if (p) return setErr(p);
    return submit({ community: name, country, localCurrency: local, hasBank, people: people.filter((p) => p.name.trim()), offices, style: fullStyle, ...(askGate ? { gate: gateA } : {}) });
  };
  const next = () => {
    setErr(null);
    if (step === 0 && !name.trim()) return setErr(t3('اكتب اسم الجماعة', 'Write the name of the community', 'Écrivez le nom de la communauté'));
    if (step === 0 && !/^[A-Z]{3}$/.test(local)) return setErr(t3('اختر العملة المحلية', 'Choose the local currency', 'Choisissez la monnaie locale'));
    setStep(step + 1);
  };
  const titles = [t3('الجماعة', 'The community', 'La communauté'), t3('ألوانها', 'Its colours', 'Ses couleurs'), t3('الأشخاص والمناصب', 'People and offices', 'Personnes et fonctions')];

  return (
    <div className="panel">
      <h2>{t3('جماعة يسوعية جديدة', 'A new Jesuit community', 'Une nouvelle communauté jésuite')}</h2>
      <Steps step={step} titles={titles} />
      {err && <div className="alert err">{err}</div>}

      {step === 0 && (
        <div className="grid2">
          <label className="field span2"><span>{t3('اسم الجماعة', 'Name of the community', 'Nom de la communauté')}</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="St … – Homs" /></label>
          <label className="field span2"><span>{t3('العنوان', 'Address', 'Adresse')}</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t3('الشارع، الحي…', 'Street, quarter…', 'Rue, quartier…')} /></label>
          <label className="field"><span>{t3('المدينة', 'City', 'Ville')}</span><input value={city} onChange={(e) => setCity(e.target.value)} /></label>
          <div />
          <CountryAndCurrency country={country} setCountry={setCountry} local={local} setLocal={setLocal} />
          <label className="row span2" style={{ gap: 6 }}><input type="checkbox" checked={hasBank} onChange={(e) => setHasBank(e.target.checked)} />{t3('للجماعة حساب في المصرف', 'The community has a bank account', 'La communauté a un compte en banque')}</label>
        </div>
      )}

      {step === 1 && <StylePicker value={style} onChange={setStyle} name={name} sub={[city, country].filter(Boolean).join(' · ')} />}

      {step === 2 && (
        <>
          <p className="muted">{t3('لكل يسوعي حسابه الشخصي الذي لا يتغيّر. وللمناصب (الرئيس، القيم، المدبر، المشرف) حساباتها وكلمات سرها، يتولاها أشخاص ويمكن تسليمها.', 'Each Jesuit has his own personal account, which never changes. The offices (Superior, Econome, Minister, Administrator) are accounts of their own, with their own passwords, held by a person and handed over when needed.', 'Chaque jésuite a son compte personnel, qui ne change jamais. Les fonctions (Supérieur, Économe, Ministre, Administrateur) sont des comptes à part, avec leur mot de passe, tenus par une personne et transmis au besoin.')}</p>
          <h3 style={{ marginTop: 14 }}>{t3('الإخوة', 'The Jesuits', 'Les jésuites')}</h3>
          {people.map((p, i) => (
            <div key={i} className="grid3" style={{ alignItems: 'end', marginBottom: 8 }}>
              <label className="field"><span>{t3('الاسم', 'Name', 'Nom')}</span><input value={p.name} onChange={(e) => set(i, { name: e.target.value })} /></label>
              <label className="field"><span>{t3('كلمة سر (6+)', 'Password (6+)', 'Mot de passe (6+)')}</span><input type="password" value={p.password} onChange={(e) => set(i, { password: e.target.value })} /></label>
              <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={!!p.hasBank} onChange={(e) => set(i, { hasBank: e.target.checked })} />{t3('له حساب في المصرف', 'has a bank account', 'a un compte en banque')}</label>
            </div>
          ))}
          <button className="btn ghost" onClick={() => setPeople([...people, { name: '', password: '' }])}>＋ {t3('يسوعي', 'A Jesuit', 'Un jésuite')}</button>

          <h3 style={{ marginTop: 14 }}>{t3('المناصب', 'The offices', 'Les fonctions')}</h3>
          {OFFICE_LIST.map(({ o, label, help }) => (
            <div key={o} className="grid3" style={{ alignItems: 'end', marginBottom: 6 }}>
              <div><b>{label()}</b><div className="muted small">{help()}</div></div>
              <label className="field"><span>{t3('يتولاه', 'Held by', 'Tenu par')}</span>
                <select value={offices[o].heldBy} onChange={(e) => setOffice(o, { heldBy: e.target.value })}>
                  <option value="">—</option>
                  {names.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="field"><span>{t3('كلمة سر المنصب (6+)', 'Office password (6+)', 'Mot de passe de la fonction (6+)')}</span><input type="password" value={offices[o].password} onChange={(e) => setOffice(o, { password: e.target.value })} /></label>
            </div>
          ))}
          <p className="muted small">{t3('كل حساب يغيّر كلمة سره عند أول دخول.', 'Every account changes its password at the first sign-in.', 'Chaque compte change son mot de passe à la première connexion.')}</p>
          {askGate && (
            <>
              <h3 style={{ marginTop: 14 }}>🔒 {t3('كلمة سر الجماعات', "The communities' password", 'Le mot de passe des communautés')}</h3>
              <p className="muted small">{t3('أول جماعة هنا: اختر كلمة سر تُطلب قبل أن يرى أحد الجماعات. أعطها فقط لمن يعمل في الجماعات. يغيّرها المشرف في الإعدادات.', 'The first community here: choose a password asked before anyone sees the communities. Give it only to those who work in the communities. The Administrator changes it in Settings.', 'Première communauté ici : choisissez un mot de passe demandé avant que quiconque voie les communautés. Ne le donnez qu’à ceux qui y travaillent. L’Administrateur le change dans les Réglages.')}</p>
              <GateFields a={gateA} b={gateB} setA={setGateA} setB={setGateB} />
            </>
          )}
        </>
      )}

      <div className="modal-foot">
        <button className="btn" onClick={() => (step ? setStep(step - 1) : onBack())}>{t3('رجوع', 'Back', 'Retour')}</button>
        {demo && step === 0 && (
          <button className="btn" disabled={busy} onClick={() => submit({
            community: 'Demo community', country: 'Syria', localCurrency: 'SYP', mustChange: false,
            people: [{ name: 'Paul', password: 'demo-pass' }, { name: 'Marc', password: 'demo-pass' }, { name: 'Jean', password: 'demo-pass' }],
            offices: {
              superior: { heldBy: 'Paul', password: 'demo-pass' }, econome: { heldBy: 'Marc', password: 'demo-pass' },
              minister: { heldBy: 'Marc', password: 'demo-pass' }, admin: { heldBy: 'Paul', password: 'demo-pass' },
            },
            style: { ...style, address: 'Demo street', city: 'Homs' },
          })}>{t3('جماعة تجريبية', 'Demo community', 'Communauté de démonstration')}</button>
        )}
        {step < 2
          ? <button className="btn primary" onClick={next}>{t3('التالي', 'Next', 'Suivant')} ›</button>
          : <button className="btn primary" disabled={busy || !name.trim()} onClick={go}>{busy ? '…' : t3('إنشاء', 'Create', 'Créer')}</button>}
      </div>
    </div>
  );
}

/** Creating the country econome's database (e.g. "Syria"): the country, its currency, and who keeps it. */
export function CountryForm({ initialName = '', onSubmit, onBack, demo, askGate }: {
  initialName?: string;
  askGate?: boolean;
  onSubmit: (s: CountrySetup) => Promise<void>;
  onBack: () => void;
  demo?: boolean;
}) {
  const [country, setCountry] = useState(initialName || countryName(COUNTRIES[0]));
  const [local, setLocal] = useState('SYP');
  const [style, setStyle] = useState<StyleInput>(DEFAULT_STYLE);
  const [gateA, setGateA] = useState('');
  const [gateB, setGateB] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (s: CountrySetup) => {
    setErr(null);
    setBusy(true);
    try { await onSubmit(s); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="panel">
      <h2>{t3('قيم البلد', 'The country econome', "L'économe du pays")}</h2>
      <p className="muted">{t3('يستلم ملف كل جماعة كل شهر، يقرّر في المطالبات، يسجّل ما بين الجماعات، ويصنع مصالحة آخر السنة. لا يرى إلا المجاميع.', "He receives each community's monthly file, decides on the claims, records the charges between communities, and makes the year-end reconciliation. He sees totals only.", "Il reçoit le fichier mensuel de chaque communauté, décide des réclamations, enregistre les charges entre communautés et fait la réconciliation annuelle. Il ne voit que des totaux.")}</p>
      {err && <div className="alert err">{err}</div>}
      <div className="grid2">
        <CountryAndCurrency country={country} setCountry={setCountry} local={local} setLocal={setLocal} />
        <label className="field"><span>{t3('اسم قيم البلد', 'Name of the country econome', "Nom de l'économe du pays")}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>{t3('كلمة سر (6+)', 'Password (6+)', 'Mot de passe (6+)')}</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      </div>
      <h3 style={{ marginTop: 16 }}>{t3('الألوان', 'Colours', 'Couleurs')}</h3>
      <StylePicker value={style} onChange={setStyle} name={country} sub={t3('قيم البلد', 'Country econome', "Économe du pays")} />
      {askGate && (
        <>
          <h3 style={{ marginTop: 14 }}>🔒 {t3('كلمة سر الجماعات', "The communities' password", 'Le mot de passe des communautés')}</h3>
          <p className="muted small">{t3('تُطلب قبل أن يرى أحد الجماعات.', 'Asked before anyone sees the communities.', 'Demandé avant que quiconque voie les communautés.')}</p>
          <GateFields a={gateA} b={gateB} setA={setGateA} setB={setGateB} />
        </>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={onBack}>{t3('رجوع', 'Back', 'Retour')}</button>
        {demo && <button className="btn" disabled={busy} onClick={() => submit({ country: 'Syria', localCurrency: 'SYP', people: [{ name: 'Country econome', password: 'demo-pass' }], mustChange: false, style })}>{t3('بلد تجريبي', 'Demo country', 'Pays de démonstration')}</button>}
        <button className="btn primary" disabled={busy || !country.trim() || !name.trim()} onClick={() => { const p = askGate ? gateProblem(gateA, gateB) : null; if (p) { setErr(p); return; } void submit({ country, localCurrency: local, people: [{ name, password }], style, ...(askGate ? { gate: gateA } : {}) }); }}>{busy ? '…' : t3('إنشاء', 'Create', 'Créer')}</button>
      </div>
    </div>
  );
}
