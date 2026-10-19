// The password of the Jesuit communities' side (Fouad, 19 October 2026: "to keep the privacy"):
// asked before anyone sees a community. On the centre's server the server keeps it; in the
// desktop app (files on this computer) this computer keeps it.
import { useState } from 'react';
import { checkSecretShape, hashSecret } from '../../auth';
import { getConfig, isDesktop, setConfig } from '../../platform';
import { serverCtyGate, serverCtyUnlock } from '../../net';
import { errText, toast } from '../../ui/kit';
import { t3 } from './text';

// ---- the desktop app's own password (this computer)
let localOpen = false;
export const localGateSet = async () => !!(isDesktop() && (await getConfig()).ctyGate);
export const localGateOpen = () => localOpen;
export async function localGateCheck(pw: string): Promise<boolean> {
  const g = (await getConfig()).ctyGate;
  if (!g) return (localOpen = true);
  localOpen = (await hashSecret(g.salt, pw)) === g.hash;
  return localOpen;
}
export async function localGateSave(pw: string) {
  checkSecretShape(pw);
  const salt = crypto.randomUUID();
  const cfg = await getConfig();
  await setConfig({ ...cfg, ctyGate: { salt, hash: await hashSecret(salt, pw) } });
  localOpen = true;
}

/** The question before the communities: their password. */
export function CtyUnlock({ check, onOpen, onBack }: { check: (pw: string) => Promise<boolean>; onOpen: () => void; onBack: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (await check(pw)) onOpen();
      else setErr(t3('كلمة السر غير صحيحة', 'Wrong password', 'Mot de passe incorrect'));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 460, margin: '0 auto' }}>
      <h2>🔒 {t3('جماعات اليسوعيين', 'Jesuit communities', 'Communautés jésuites')}</h2>
      <p className="muted">{t3('اكتب كلمة سر الجماعات لترى جماعاتها.', "Give the communities' password to see the communities.", 'Donnez le mot de passe des communautés pour les voir.')}</p>
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <label className="field"><span>{t3('كلمة سر الجماعات', "Communities' password", 'Mot de passe des communautés')}</span>
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onBack}>{t3('رجوع', 'Back', 'Retour')}</button>
          <button className="btn primary" disabled={busy || !pw}>{busy ? '…' : t3('دخول', 'Enter', 'Entrer')}</button>
        </div>
      </form>
    </div>
  );
}

/** Server: give the password; true when right. */
export async function serverGateCheck(pw: string): Promise<boolean> {
  try {
    await serverCtyUnlock(pw);
    return true;
  } catch (e) {
    if (/wrong|غير صحيحة/i.test(errText(e))) return false;
    throw e;
  }
}

/** Choosing the password (with the first community, or to change it). */
export function GateFields({ a, b, setA, setB }: { a: string; b: string; setA: (v: string) => void; setB: (v: string) => void }) {
  return (
    <div className="grid2">
      <label className="field"><span>{t3('كلمة سر الجماعات (6+)', "Communities' password (6+)", 'Mot de passe des communautés (6+)')}</span><input type="password" value={a} onChange={(e) => setA(e.target.value)} /></label>
      <label className="field"><span>{t3('مرة أخرى', 'Again', 'Encore')}</span><input type="password" value={b} onChange={(e) => setB(e.target.value)} /></label>
    </div>
  );
}
export const gateProblem = (a: string, b: string): string | null =>
  a.length < 6 ? t3('كلمة سر الجماعات: 6 أحرف أو أرقام على الأقل', "Communities' password: at least 6 characters", 'Mot de passe des communautés : au moins 6 caractères')
    : a !== b ? t3('كلمة سر الجماعات وتأكيدها مختلفان', "The communities' password and its confirmation differ", 'Le mot de passe des communautés et sa confirmation diffèrent') : null;

/** Settings (the administrator): change the communities' password. */
export function GateCard({ server }: { server: boolean }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const p = gateProblem(a, b);
    if (p) return toast(p, true);
    setBusy(true);
    try {
      if (server) await serverCtyGate(a);
      else await localGateSave(a);
      setA('');
      setB('');
      toast(t3('تغيّرت كلمة سر الجماعات', "The communities' password is changed", 'Le mot de passe des communautés est changé'));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cty-card">
      <div className="cty-label">🔒 {t3('كلمة سر الجماعات', "The communities' password", 'Le mot de passe des communautés')}</div>
      <p className="cty-help" style={{ marginTop: 0 }}>{server
        ? t3('تُطلب قبل أن يرى أحد الجماعات على هذا الخادم. أعطها فقط لمن يعمل في الجماعات.', 'Asked before anyone sees the communities on this server. Give it only to those who work in the communities.', 'Demandé avant que quiconque voie les communautés sur ce serveur. Ne le donnez qu’à ceux qui travaillent dans les communautés.')
        : t3('تُطلب على هذا الحاسوب قبل رؤية ملفات الجماعات.', "Asked on this computer before seeing the communities' files.", 'Demandé sur cet ordinateur avant de voir les fichiers des communautés.')}</p>
      <GateFields a={a} b={b} setA={setA} setB={setB} />
      <button className="btn primary cty-wide" disabled={busy} onClick={save}>{t3('تغيير', 'Change', 'Changer')}</button>
    </div>
  );
}
