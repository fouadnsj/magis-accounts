// The sign-in directory (Fouad, 30 October 2026): the first page asks for a name and a password; then the
// person sees only the databases given to them and enters without a second password. The administrator
// gives each person their databases (and, in each, the account to enter as) in "People & access".
import { useCallback, useEffect, useState } from 'react';
import { m, tx } from '../i18n';
import { dirEnforce, dirLogin, dirPassword, dirPeople, dirReset, dirSave, dirSetup, type DirDb, type DirPerson } from '../net';
import { BrandFrame } from './Landing';
import { Field, Modal, errText, toast } from './kit';

const t3 = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));

/** The first page once a directory exists. */
export function DirSignIn({ local, onDone }: { local: boolean; onDone: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await dirLogin(name, pw);
      await onDone();
    } catch (e) {
      setErr(errText(e));
      setPw('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <BrandFrame>
      <div className="panel login-panel">
        <h2 style={{ marginBottom: 2 }}>{t3('تسجيل الدخول', 'Sign in', 'Connexion')}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>{t3('اسمك وكلمة سرك. بعدها ترى القواعد المسموحة لك فقط.', 'Your name and your password. Then you see only the databases given to you.', 'Votre nom et votre mot de passe. Vous ne verrez ensuite que les bases qui vous sont données.')}</p>
        <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
          <Field label={t3('الاسم', 'Name', 'Nom')}><input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t3('كلمة السر', 'Password', 'Mot de passe')}><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
          <div className="modal-foot">
            {local && <button type="button" className="btn ghost" onClick={() => setForgot(true)}>{t3('نسيت كلمة السر؟', 'Forgot the password?', 'Mot de passe oublié ?')}</button>}
            <button className="btn primary" disabled={!name.trim() || !pw || busy}>{t3('دخول', 'Enter', 'Entrer')}</button>
          </div>
        </form>
      </div>
      {forgot && <Forgot onClose={() => setForgot(false)} />}
    </BrandFrame>
  );
}

/** On the server computer: a new password, with the password of the Superior of any database. */
function Forgot({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [sup, setSup] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={t3('كلمة سر جديدة', 'A new password', 'Un nouveau mot de passe')} onClose={onClose} narrow>
      <p className="muted small">{t3('من حاسوب الخادم فقط، وبكلمة سر رئيس أي قاعدة بيانات. تُستبدل كلمة السر عند الدخول التالي.', "On the server computer only, with the password of the Superior of any database. It is replaced at the next sign-in.", "Sur l'ordinateur du serveur seulement, avec le mot de passe du Supérieur d'une base. Il sera remplacé à la prochaine connexion.")}</p>
      <Field label={t3('الاسم', 'Name', 'Nom')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t3('كلمة سر مؤقتة جديدة', 'New temporary password', 'Nouveau mot de passe provisoire')}><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label={t3('كلمة سر رئيس قاعدة', "A Superior's password", "Mot de passe d'un Supérieur")}><input type="password" value={sup} onChange={(e) => setSup(e.target.value)} /></Field>
      {err && <div className="alert err">{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!name || !pw || !sup} onClick={async () => {
          try {
            await dirReset(name, pw, sup);
            toast(t3('تم', 'Done', 'Fait'));
            onClose();
          } catch (e) {
            setErr(errText(e));
          }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

/** The very first person: the administrator, made on the server computer. */
export function DirSetup({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={t3('تفعيل دليل الدخول', 'Set up the sign-in directory', "Mettre en place l'annuaire de connexion")} onClose={onClose} narrow>
      <p className="muted small">{t3('بعد ذلك يسجّل كل شخص دخوله باسمه وكلمة سره، ولا يرى إلا قواعد البيانات التي تُعطى له. أنت المدير الأول وترى كل شيء. لا شيء يتغير في القواعد نفسها.', 'After this, everyone signs in with their own name and password and sees only the databases given to them. You are the first administrator and see everything. Nothing changes inside the databases themselves.', "Ensuite chacun se connecte avec son nom et son mot de passe et ne voit que les bases qui lui sont données. Vous êtes le premier administrateur et voyez tout. Rien ne change dans les bases elles-mêmes.")}</p>
      <Field label={t3('اسمك', 'Your name', 'Votre nom')}><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t3('كلمة سر (6 أحرف على الأقل)', 'A password (at least 6 characters)', 'Un mot de passe (6 caractères au moins)')}><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {err && <div className="alert err">{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!name.trim() || pw.length < 6} onClick={async () => {
          try {
            await dirSetup(name, pw);
            await onDone();
          } catch (e) {
            setErr(errText(e));
          }
        }}>{t3('تفعيل', 'Set up', 'Mettre en place')}</button>
      </div>
    </Modal>
  );
}

/** A password given by the administrator is replaced before anything else. */
export function DirMustChange({ name, onDone, onLogout }: { name: string; onDone: () => Promise<void>; onLogout: () => void }) {
  const [old, setOld] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <BrandFrame>
      <div className="panel login-panel">
        <h2>{t3('كلمة سر جديدة', 'Choose a new password', 'Choisissez un nouveau mot de passe')}</h2>
        <p className="muted small">{name} · {t3('كلمة السر الحالية أعطاها لك المدير. اختر كلمة سر خاصة بك.', 'The current password was given to you by the administrator. Choose your own.', "Le mot de passe actuel vous a été donné par l'administrateur. Choisissez le vôtre.")}</p>
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (a !== b) return setErr(t3('الكلمتان مختلفتان', 'The two do not match', 'Les deux ne correspondent pas'));
          try {
            await dirPassword(old, a);
            await onDone();
          } catch (x) {
            setErr(errText(x));
          }
        }}>
          <Field label={t3('كلمة السر الحالية', 'Current password', 'Mot de passe actuel')}><input type="password" autoFocus value={old} onChange={(e) => setOld(e.target.value)} /></Field>
          <Field label={t3('الجديدة (6 أحرف على الأقل)', 'New (at least 6 characters)', 'Nouveau (6 caractères au moins)')}><input type="password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
          <Field label={t3('أعدها', 'Again', 'Encore')}><input type="password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
          {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={onLogout}>{t3('خروج', 'Sign out', 'Se déconnecter')}</button>
            <button className="btn primary" disabled={!old || a.length < 6 || !b}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
          </div>
        </form>
      </div>
    </BrandFrame>
  );
}

const AUTO = 'auto';

/** The administrator: who may sign in, and which databases each person may enter. */
export function DirAdmin({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<{ people: DirPerson[]; enforced: boolean; dbs: DirDb[] } | null>(null);
  const [edit, setEdit] = useState<DirPerson | 'new' | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await dirPeople());
    } catch (e) {
      toast(errText(e), true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const dbName = (slug: string) => data?.dbs.find((d) => d.slug === slug)?.organisation ?? slug;
  return (
    <Modal title={t3('الأشخاص والصلاحيات', 'People & access', 'Personnes et accès')} onClose={onClose}>
      {!data ? <p className="muted">…</p> : (
        <>
          <p className="muted small">{t3('لكل شخص اسم وكلمة سر واحدة، ويدخل فقط قواعد البيانات التي تعطيها له. في كل قاعدة تختار الحساب الذي يدخل به (الرئيس، المحاسب…).', 'Each person has one name and one password, and enters only the databases you give them. In each database you choose the account they enter as (Superior, Accountant…).', "Chaque personne a un nom et un mot de passe, et n'entre que dans les bases que vous lui donnez. Dans chaque base, vous choisissez le compte avec lequel elle entre (Supérieur, Comptable…).")}</p>
          <table className="t">
            <thead><tr><th>{t3('الاسم', 'Name', 'Nom')}</th><th>{t3('القواعد', 'Databases', 'Bases')}</th><th /></tr></thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'off'}>
                  <td><b>{p.name}</b>{p.admin && <span className="pill" style={{ marginInlineStart: 6 }}>{t3('مدير', 'Administrator', 'Administrateur')}</span>}{!p.active && <span className="pill" style={{ marginInlineStart: 6 }}>{t3('موقوف', 'Off', 'Désactivé')}</span>}</td>
                  <td className="small">{p.admin ? t3('كلها', 'All', 'Toutes') : Object.keys(p.grants).map(dbName).join(' · ') || '—'}</td>
                  <td className="right"><button className="btn small" onClick={() => setEdit(p)}>{t3('تعديل', 'Edit', 'Modifier')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}><button className="btn" onClick={() => setEdit('new')}>＋ {t3('شخص جديد', 'Add a person', 'Ajouter une personne')}</button></div>
          <div className="alert info" style={{ marginTop: 16 }}>
            <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={data.enforced} onChange={async (e) => {
                try {
                  await dirEnforce(e.target.checked);
                  await load();
                  await onChanged();
                } catch (x) {
                  toast(errText(x), true);
                }
              }} />
              <span>
                <b>{t3('الدخول عبر الدليل فقط', 'Sign in only through the directory', "Connexion uniquement par l'annuaire")}</b>
                <div className="small">{t3('عند التفعيل لا يعمل الدخول القديم (قاعدة ثم اسم) إلا على حاسوب الخادم. فعّله بعد أن تعمل الطريقة الجديدة عند الجميع. التطبيق المكتبي القديم لن يستطيع الدخول حتى يُحدَّث.', 'When on, the old way (database, then name) works only on the server computer. Turn it on once the new way works for everyone. An older desktop app cannot sign in until it is updated.', "Quand c'est activé, l'ancienne façon (base puis nom) ne marche plus que sur l'ordinateur du serveur. Activez-le quand la nouvelle façon marche pour tous. Une ancienne application de bureau ne pourra plus se connecter avant sa mise à jour.")}</div>
              </span>
            </label>
          </div>
        </>
      )}
      {edit && data && <EditPerson person={edit === 'new' ? null : edit} dbs={data.dbs} onCancel={() => setEdit(null)} onSaved={async () => { setEdit(null); await load(); await onChanged(); }} />}
      <div className="modal-foot"><button className="btn primary" onClick={onClose}>{t3('تم', 'Done', 'Terminé')}</button></div>
    </Modal>
  );
}

function EditPerson({ person, dbs, onCancel, onSaved }: { person: DirPerson | null; dbs: DirDb[]; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(person?.name ?? '');
  const [admin, setAdmin] = useState(person?.admin ?? false);
  const [active, setActive] = useState(person?.active ?? true);
  const [pw, setPw] = useState('');
  // per database: '' = no access, 'auto' = the Superior, else the id of the account
  const [links, setLinks] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(person?.grants ?? {}).map(([k, v]) => [k, v == null ? AUTO : String(v)])));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const grants: Record<string, number | null> = {};
      for (const [slug, v] of Object.entries(links)) if (v) grants[slug] = v === AUTO ? null : Number(v);
      await dirSave({ id: person?.id ?? null, name, admin, active, password: pw || undefined, grants });
      toast(t3('حُفظ', 'Saved', 'Enregistré'));
      await onSaved();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const kind = (d: DirDb) => (d.kind === 'community' ? t3('جماعة', 'Community', 'Communauté') : d.kind === 'country' ? t3('بلد', 'Country', 'Pays') : '');
  return (
    <Modal title={person ? person.name : t3('شخص جديد', 'Add a person', 'Ajouter une personne')} onClose={onCancel}>
      <Field label={t3('الاسم', 'Name', 'Nom')}><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={person ? t3('كلمة سر مؤقتة جديدة (اتركها فارغة للإبقاء)', 'New temporary password (leave empty to keep)', 'Nouveau mot de passe provisoire (vide = inchangé)') : t3('كلمة سر مؤقتة (يغيّرها عند أول دخول)', 'Temporary password (replaced at the first sign-in)', 'Mot de passe provisoire (remplacé à la première connexion)')}>
        <input type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
      <div className="row" style={{ gap: 18, margin: '8px 0' }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> {t3('مدير: يرى كل القواعد ويدير الأشخاص', 'Administrator: sees every database and manages the people', 'Administrateur : voit toutes les bases et gère les personnes')}</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t3('نشط', 'Active', 'Actif')}</label>
      </div>
      {admin ? (
        <p className="muted small">{t3('المدير يدخل كل قاعدة بحساب رئيسها (أو الحساب الذي تختاره أدناه).', "The administrator enters every database as its Superior (or the account chosen below).", "L'administrateur entre dans chaque base comme son Supérieur (ou le compte choisi ci-dessous).")}</p>
      ) : null}
      <h3 style={{ marginTop: 12 }}>{t3('قواعد البيانات', 'Databases', 'Bases de données')}</h3>
      <table className="t">
        <tbody>
          {dbs.map((d) => (
            <tr key={d.slug}>
              <td><b>{d.organisation}</b> <span className="muted small">{kind(d)}</span></td>
              <td>
                <select value={links[d.slug] ?? ''} onChange={(e) => setLinks({ ...links, [d.slug]: e.target.value })}>
                  <option value="">{admin ? t3('الرئيس (تلقائي)', 'Superior (automatic)', 'Supérieur (automatique)') : t3('— لا دخول —', '— no access —', '— pas d\'accès —')}</option>
                  {!admin && <option value={AUTO}>{t3('حساب رئيس القاعدة', 'The Superior account', 'Le compte du Supérieur')}</option>}
                  {d.profiles.map((p) => <option key={p.id} value={String(p.id)}>{p.office ?? p.name}{p.access_name ? ` · ${p.access_name}` : ''}</option>)}
                </select>
              </td>
            </tr>
          ))}
          {!dbs.length && <tr><td className="muted">{t3('لا قواعد بيانات.', 'No databases.', 'Aucune base.')}</td></tr>}
        </tbody>
      </table>
      {err && <div className="alert err">{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onCancel}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={busy || !name.trim() || (!person && pw.length < 6)} onClick={save}>{busy ? '…' : t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}
