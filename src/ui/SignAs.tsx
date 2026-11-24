// "Sign in as" (Fouad, 31 October 2026): someone who manages the users sees the program exactly as another person sees
// it, to test everything and to help them. Chosen each time: "see only" (nothing can be saved) or "see and act" (what is
// done is written "Fouad as Salim" in the history). A band at the top says it, with the way back. On the server only.
import { useEffect, useState } from 'react';
import { has } from '../auth';
import type { Session } from '../state';
import { serverSignAs, serverSignAsBack, type SignedAs } from '../net';
import { m, tx } from '../i18n';
import { kindInfo, testAsChoices } from '../roles';
import type { AccessRow, UserRow } from '../ops';
import { Modal, biName, errText, toast } from './kit';

/** may this person use "sign in as" from here (themself signed in, managing the users, on the server) */
export const maySignAs = (s: Session) => s.mode === 'server' && !s.as && has(s.profile, 'users.manage');

export function SignAsButton({ s, profileId, name, small }: { s: Session; profileId: number; name: string; small?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!maySignAs(s) || profileId === s.profile.id) return null;
  return (
    <>
      <button type="button" className={`btn ${small ? 'small' : ''}`} title={tx(m(`الدخول باسم ${name}`, `Sign in as ${name}`, `Se connecter en tant que ${name}`))} onClick={() => setOpen(true)}>👁 {tx(m('الدخول باسمه', 'Sign in as', 'Se connecter en tant que'))}</button>
      {open && <SignAsModal profileId={profileId} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function SignAsModal({ profileId, name, onClose }: { profileId: number; name: string; onClose: () => void }) {
  const [mode, setMode] = useState<'view' | 'act'>('view');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await serverSignAs(profileId, mode);
      location.reload();
    } catch (e) { toast(errText(e), true); setBusy(false); }
  };
  return (
    <Modal title={tx(m(`الدخول باسم ${name}`, `Sign in as ${name}`, `Se connecter en tant que ${name}`))} onClose={onClose} narrow>
      <p className="muted small" style={{ marginTop: 0 }}>{tx(m('ترى البرنامج كما يراه هذا الشخص تماماً: قوائمه وصلاحياته ومراكزه. ترجع إلى حسابك بزر في أعلى الصفحة.', 'You see the program exactly as this person sees it: their menus, rights and centres. A button at the top of the page brings you back to your own account.', "Vous voyez le programme exactement comme cette personne : ses menus, ses droits, ses centres. Un bouton en haut de la page vous ramène à votre compte."))}</p>
      <div className="choice signas-choice">
        <button type="button" className={mode === 'view' ? 'on' : ''} onClick={() => setMode('view')}>
          <b>👁 {tx(m('مشاهدة فقط', 'See only', 'Voir seulement'))}</b>
          <span>{tx(m('لا يُحفظ شيء. آمن على البيانات الحقيقية.', 'Nothing can be saved. Safe on real data.', 'Rien ne peut être enregistré. Sans risque pour les vraies données.'))}</span>
        </button>
        <button type="button" className={mode === 'act' ? 'on' : ''} onClick={() => setMode('act')}>
          <b>✍️ {tx(m('مشاهدة وعمل', 'See and act', 'Voir et agir'))}</b>
          <span>{tx(m(`ما تفعله يُكتب في السجل «أنت باسم ${name}».`, `What you do is written in the history as "you as ${name}".`, `Ce que vous faites est écrit dans l'historique « vous en tant que ${name} ».`))}</span>
        </button>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{tx(m('إلغاء', 'Cancel', 'Annuler'))}</button>
        <button className="btn primary" disabled={busy} onClick={go}>{tx(m(`الدخول باسم ${name}`, `Sign in as ${name}`, `Se connecter en tant que ${name}`))}</button>
      </div>
    </Modal>
  );
}

/** the band at the top while signed in as someone else */
export function SignAsBanner({ name, as }: { name: string; as: SignedAs }) {
  const [busy, setBusy] = useState(false);
  const back = async () => {
    setBusy(true);
    try { await serverSignAsBack(); location.reload(); } catch (e) { toast(errText(e), true); setBusy(false); }
  };
  return (
    <div className={`signas-band ${as.mode}`} role="status">
      <span>{as.mode === 'view' ? '👁' : '✍️'} {tx(m(`أنت ترى باسم ${name}`, `You are seeing as ${name}`, `Vous voyez en tant que ${name}`))} · <b>{as.mode === 'view' ? tx(m('مشاهدة فقط: لا يُحفظ شيء', 'see only: nothing is saved', 'voir seulement : rien n’est enregistré')) : tx(m(`مشاهدة وعمل: يُكتب «${as.by} باسم ${name}»`, `see and act: written "${as.by} as ${name}"`, `voir et agir : écrit « ${as.by} en tant que ${name} »`))}</b></span>
      <button className="btn small" disabled={busy} onClick={back}>↩ {tx(m(`الرجوع إلى ${as.by}`, `Back to ${as.by}`, `Revenir à ${as.by}`))}</button>
    </div>
  );
}

/**
 * "Test as… · الدخول باسم…" (26 November 2026), at the top of the Administration door: pick a person of this centre and open the
 * program as them in one step (same function and same rules as the 👁 button on People). "See only" is the default and is
 * remembered here while the program is open. After signing in the person lands on their own doors page.
 */
let lastMode: 'view' | 'act' = 'view';
export function TestAs({ s }: { s: Session }) {
  const [people, setPeople] = useState<ReturnType<typeof testAsChoices<UserRow>>>([]);
  const [who, setWho] = useState<number | ''>('');
  const [mode, setMode] = useState<'view' | 'act'>(lastMode);
  const [busy, setBusy] = useState(false);
  const may = maySignAs(s);
  useEffect(() => {
    if (!may) return;
    let live = true;
    void (async () => {
      try {
        const [users, access] = await Promise.all([s.api.call('users.list') as Promise<UserRow[]>, s.api.call('access.list') as Promise<AccessRow[]>]);
        if (live) setPeople(testAsChoices(users, access, s.profile.id, !!s.profile.admin));
      } catch { /* the list stays empty */ }
    })();
    return () => { live = false; };
  }, [may, s.profile.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!may || !people.length) return null;
  const roleText = (rs: { kind: string | null; name?: string }[]) => rs.map((a) => (a.kind && kindInfo(a.kind) ? tx(kindInfo(a.kind)!.label) : biName((a as AccessRow).name ?? ''))).join(' + ');
  const pick = people.find((p) => p.id === who);
  const go = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await serverSignAs(pick.id, mode);
      // the person lands on their own doors page, not on the page of Administration this was chosen from
      try { history.replaceState({ mgShell: 'doors', mgDoor: null }, ''); } catch { /* no history */ }
      location.reload();
    } catch (e) { toast(errText(e), true); setBusy(false); }
  };
  return (
    <div className="testas" role="group" aria-label={tx(m('الدخول باسم', 'Test as', 'Tester en tant que'))}>
      <b>👁 {tx(m('الدخول باسم…', 'Test as…', 'Tester en tant que…'))}</b>
      <select className="inp" value={who} onChange={(e) => setWho(e.target.value ? Number(e.target.value) : '')} aria-label={tx(m('اختر شخصاً', 'Choose a person', 'Choisir une personne'))}>
        <option value="">{tx(m('اختر شخصاً', 'Choose a person', 'Choisir une personne'))}</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.roleRows.length ? ` · ${roleText(p.roleRows as never)}` : ''}</option>)}
      </select>
      <span className="chips" role="radiogroup" style={{ display: 'inline-flex' }}>
        <button type="button" role="radio" aria-checked={mode === 'view'} className={`chip ${mode === 'view' ? 'on' : ''}`} onClick={() => { lastMode = 'view'; setMode('view'); }}>👁 {tx(m('مشاهدة فقط', 'See only', 'Voir seulement'))}</button>
        <button type="button" role="radio" aria-checked={mode === 'act'} className={`chip ${mode === 'act' ? 'on' : ''}`} onClick={() => { lastMode = 'act'; setMode('act'); }}>✍️ {tx(m('مشاهدة وعمل', 'See and act', 'Voir et agir'))}</button>
      </span>
      <button type="button" className="btn small primary" disabled={!pick || busy} onClick={go}>{tx(m('دخول', 'Go', 'Entrer'))}</button>
    </div>
  );
}
