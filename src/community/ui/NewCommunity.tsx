// Creating a community database: its name, its currency, its Jesuits (each with his own
// account) and its four offices (Superior, Econome, Minister, Administrator), each held by
// a person and with its own password (Fouad, 19 October 2026).
import { useState } from 'react';
import { errText } from '../../ui/kit';
import type { CommunitySetup, CtyPerson } from '../setup';
import type { Office } from '../people';
import type { CountrySetup } from '../country';
import { t3 } from './text';

const OFFICE_LIST: { o: Office; label: () => string; help: () => string }[] = [
  { o: 'superior', label: () => t3('الرئيس', 'Superior', 'Supérieur'), help: () => t3('يرى كل شيء، يوافق أو يرفض، يعلّق. لا يغيّر شيئاً.', 'Sees everything, approves or refuses, comments. Changes nothing.', 'Voit tout, approuve ou refuse, commente. Ne change rien.') },
  { o: 'econome', label: () => t3('القيم', 'Econome', 'Économe'), help: () => t3('يرى كل شيء؛ يعمل في صندوقه فقط: يعطي المال ويستلمه.', 'Sees everything; works in his own books only: gives and receives money.', 'Voit tout ; ne travaille que dans ses comptes : donne et reçoit de l’argent.') },
  { o: 'minister', label: () => t3('المدبر', 'Minister', 'Ministre'), help: () => t3('يمسك حساب البيت وأظرفته.', 'Keeps the house account and its envelopes.', 'Tient le compte de la maison et ses enveloppes.') },
  { o: 'admin', label: () => t3('المشرف', 'Administrator', 'Administrateur'), help: () => t3('الحسابات وكلمات السر والصلاحيات والإعدادات؛ لا يرى أي قيد.', 'Accounts, passwords, permissions, settings; sees no record.', 'Comptes, mots de passe, permissions, réglages ; ne voit aucune écriture.') },
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
  const [hasBank, setHasBank] = useState(false);
  const [people, setPeople] = useState<CtyPerson[]>([{ name: '', password: '' }, { name: '', password: '' }, { name: '', password: '' }]);
  const [offices, setOffices] = useState<Record<Office, { heldBy: string; password: string }>>({
    superior: { heldBy: '', password: '' }, econome: { heldBy: '', password: '' }, minister: { heldBy: '', password: '' }, admin: { heldBy: '', password: '' },
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  const go = () => submit({ community: name, country, localCurrency: local, hasBank, people: people.filter((p) => p.name.trim()), offices });

  return (
    <div className="panel">
      <h2>{t3('جماعة يسوعية', 'A Jesuit community', 'Une communauté jésuite')}</h2>
      <p className="muted">{t3('لكل يسوعي حسابه الشخصي الذي لا يتغيّر. وللمناصب (الرئيس، القيم، المدبر، المشرف) حساباتها وكلمات سرها، يتولاها أشخاص ويمكن تسليمها.', 'Each Jesuit has his own personal account, which never changes. The offices (Superior, Econome, Minister, Administrator) are accounts of their own, with their own passwords, held by a person and handed over when needed.', 'Chaque jésuite a son compte personnel, qui ne change jamais. Les fonctions (Supérieur, Économe, Ministre, Administrateur) sont des comptes à part, avec leur mot de passe, tenus par une personne et transmis au besoin.')}</p>
      {err && <div className="alert err">{err}</div>}
      <div className="grid3">
        <label className="field span3"><span>{t3('اسم الجماعة', 'Name of the community', 'Nom de la communauté')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="St … – Homs" /></label>
        <label className="field"><span>{t3('البلد', 'Country', 'Pays')}</span><input value={country} onChange={(e) => setCountry(e.target.value)} /></label>
        <label className="field"><span>{t3('العملة المحلية', 'Local currency', 'Monnaie locale')}</span><input value={local} onChange={(e) => setLocal(e.target.value)} /></label>
        <label className="row" style={{ gap: 6, alignSelf: 'end' }}><input type="checkbox" checked={hasBank} onChange={(e) => setHasBank(e.target.checked)} />{t3('للجماعة حساب في المصرف', 'The community has a bank account', 'La communauté a un compte en banque')}</label>
      </div>

      <h3 style={{ marginTop: 14 }}>1 · {t3('الإخوة', 'The Jesuits', 'Les jésuites')}</h3>
      {people.map((p, i) => (
        <div key={i} className="grid3" style={{ alignItems: 'end', marginBottom: 8 }}>
          <label className="field"><span>{t3('الاسم', 'Name', 'Nom')}</span><input value={p.name} onChange={(e) => set(i, { name: e.target.value })} /></label>
          <label className="field"><span>{t3('كلمة سر (6+)', 'Password (6+)', 'Mot de passe (6+)')}</span><input type="password" value={p.password} onChange={(e) => set(i, { password: e.target.value })} /></label>
          <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={!!p.hasBank} onChange={(e) => set(i, { hasBank: e.target.checked })} />{t3('له حساب في المصرف', 'has a bank account', 'a un compte en banque')}</label>
        </div>
      ))}
      <button className="btn ghost" onClick={() => setPeople([...people, { name: '', password: '' }])}>＋ {t3('يسوعي', 'A Jesuit', 'Un jésuite')}</button>

      <h3 style={{ marginTop: 14 }}>2 · {t3('المناصب', 'The offices', 'Les fonctions')}</h3>
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
      <div className="modal-foot">
        <button className="btn" onClick={onBack}>{t3('رجوع', 'Back', 'Retour')}</button>
        {demo && (
          <button className="btn" disabled={busy} onClick={() => submit({
            community: 'Demo community', country: 'Syria', localCurrency: 'SYP', mustChange: false,
            people: [{ name: 'Paul', password: 'demo-pass' }, { name: 'Marc', password: 'demo-pass' }, { name: 'Jean', password: 'demo-pass' }],
            offices: {
              superior: { heldBy: 'Paul', password: 'demo-pass' }, econome: { heldBy: 'Marc', password: 'demo-pass' },
              minister: { heldBy: 'Marc', password: 'demo-pass' }, admin: { heldBy: 'Paul', password: 'demo-pass' },
            },
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
