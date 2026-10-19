// Creating a community database: its name, its currency, and its people with their roles.
// Every community has a Superior, an econome and a minister; one person may hold several roles.
import { useState } from 'react';
import { errText } from '../../ui/kit';
import type { CommunitySetup, CtyPerson, CtyRole } from '../setup';
import type { CountrySetup } from '../country';
import { t3 } from './text';

const ROLES: { r: CtyRole; label: () => string }[] = [
  { r: 'superior', label: () => t3('الرئيس', 'Superior', 'Supérieur') },
  { r: 'econome', label: () => t3('القيم', 'Econome', 'Économe') },
  { r: 'minister', label: () => t3('المدبر', 'Minister', 'Ministre') },
];

export function CommunityForm({ initialName = '', onSubmit, onBack, demo }: {
  initialName?: string;
  onSubmit: (s: CommunitySetup) => Promise<void>;
  onBack: () => void;
  /** the browser preview: offers a demo community with invented names */
  demo?: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [country, setCountry] = useState('Syria');
  const [local, setLocal] = useState('SYP');
  const [people, setPeople] = useState<CtyPerson[]>([
    { name: '', password: '', roles: ['superior'] },
    { name: '', password: '', roles: ['econome', 'minister'] },
    { name: '', password: '', roles: [] },
  ]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (i: number, p: Partial<CtyPerson>) => setPeople(people.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const toggle = (i: number, r: CtyRole) => set(i, { roles: people[i].roles.includes(r) ? people[i].roles.filter((x) => x !== r) : [...people[i].roles, r] });

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
  const go = () => submit({ community: name, country, localCurrency: local, people: people.filter((p) => p.name.trim()) });

  return (
    <div className="panel">
      <h2>{t3('جماعة يسوعية', 'A Jesuit community', 'Une communauté jésuite')}</h2>
      <p className="muted">{t3('لكل يسوعي دفتره. المدبر يمسك أيضاً دفتر البيت، والقيم الصندوق والمصرف والإيكونوماتو.', 'Each Jesuit has his book. The minister also keeps the house book; the econome keeps the cash, the bank and the économat.', "Chaque jésuite a son compte. Le ministre tient aussi celui de la maison ; l'économe la caisse, la banque et l'économat.")}</p>
      {err && <div className="alert err">{err}</div>}
      <div className="grid3">
        <label className="field span3"><span>{t3('اسم الجماعة', 'Name of the community', 'Nom de la communauté')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="St … – Homs" /></label>
        <label className="field"><span>{t3('البلد', 'Country', 'Pays')}</span><input value={country} onChange={(e) => setCountry(e.target.value)} /></label>
        <label className="field"><span>{t3('العملة المحلية', 'Local currency', 'Monnaie locale')}</span><input value={local} onChange={(e) => setLocal(e.target.value)} /></label>
      </div>
      <h3 style={{ marginTop: 14 }}>{t3('الأشخاص', 'The people', 'Les personnes')}</h3>
      {people.map((p, i) => (
        <div key={i} className="grid3" style={{ alignItems: 'end', marginBottom: 8 }}>
          <label className="field"><span>{t3('الاسم', 'Name', 'Nom')}</span><input value={p.name} onChange={(e) => set(i, { name: e.target.value })} /></label>
          <label className="field"><span>{t3('كلمة سر (6+)', 'Password (6+)', 'Mot de passe (6+)')}</span><input type="password" value={p.password} onChange={(e) => set(i, { password: e.target.value })} /></label>
          <div className="row small">
            {ROLES.map(({ r, label }) => (
              <label key={r} className="row" style={{ gap: 4 }}><input type="checkbox" checked={p.roles.includes(r)} onChange={() => toggle(i, r)} />{label()}</label>
            ))}
          </div>
        </div>
      ))}
      <button className="btn ghost" onClick={() => setPeople([...people, { name: '', password: '', roles: [] }])}>＋ {t3('شخص', 'Person', 'Personne')}</button>
      <p className="muted small">{t3('من لا دور له: يسوعي بدفتره. كلمة السر يغيّرها كل واحد عند أول دخول.', 'No role ticked: a Jesuit with his own book. Each one changes his password at the first sign-in.', 'Sans rôle coché : un jésuite avec son compte. Chacun change son mot de passe à la première connexion.')}</p>
      <div className="modal-foot">
        <button className="btn" onClick={onBack}>{t3('رجوع', 'Back', 'Retour')}</button>
        {demo && (
          <button className="btn" disabled={busy} onClick={() => submit({
            community: 'Demo community', country: 'Syria', localCurrency: 'SYP',
            people: [
              { name: 'Paul', password: 'demo-pass', roles: ['superior'] },
              { name: 'Marc', password: 'demo-pass', roles: ['econome', 'minister'] },
              { name: 'Jean', password: 'demo-pass', roles: [] },
            ],
          })}>{t3('جماعة تجريبية', 'Demo community', 'Communauté de démonstration')}</button>
        )}
        <button className="btn primary" disabled={busy || !name.trim()} onClick={go}>{busy ? '…' : t3('إنشاء', 'Create', 'Créer')}</button>
      </div>
    </div>
  );
}

/** Creating the country econome's database (e.g. "Syria"): the country, its currency, and who keeps it. */
export function CountryForm({ initialName = '', onSubmit, onBack, demo }: {
  initialName?: string;
  onSubmit: (s: CountrySetup) => Promise<void>;
  onBack: () => void;
  demo?: boolean;
}) {
  const [country, setCountry] = useState(initialName || 'Syria');
  const [local, setLocal] = useState('SYP');
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
        <label className="field"><span>{t3('البلد', 'Country', 'Pays')}</span><input value={country} onChange={(e) => setCountry(e.target.value)} /></label>
        <label className="field"><span>{t3('العملة المحلية', 'Local currency', 'Monnaie locale')}</span><input value={local} onChange={(e) => setLocal(e.target.value)} /></label>
        <label className="field"><span>{t3('اسم قيم البلد', 'Name of the country econome', "Nom de l'économe du pays")}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>{t3('كلمة سر (6+)', 'Password (6+)', 'Mot de passe (6+)')}</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onBack}>{t3('رجوع', 'Back', 'Retour')}</button>
        {demo && <button className="btn" disabled={busy} onClick={() => submit({ country: 'Syria', localCurrency: 'SYP', people: [{ name: 'Country econome', password: 'demo-pass' }], mustChange: false })}>{t3('بلد تجريبي', 'Demo country', 'Pays de démonstration')}</button>}
        <button className="btn primary" disabled={busy || !country.trim() || !name.trim()} onClick={() => submit({ country, localCurrency: local, people: [{ name, password }] })}>{busy ? '…' : t3('إنشاء', 'Create', 'Créer')}</button>
      </div>
    </div>
  );
}
