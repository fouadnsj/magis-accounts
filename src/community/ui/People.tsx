// The accounts of the community: the four OFFICES (who holds each one now, and its password)
// and the JESUITS (each his own account). The administrator manages them; the econome may
// reset a password. When an office is handed over: choose the new holder and give a new
// password; the office keeps its books and its whole history.
import { useCallback, useEffect, useState } from 'react';
import { errText, promptBox, toast } from '../../ui/kit';
import type { Office, OfficeRow, PeoplePayload, PersonRow } from '../people';
import { useCty, Card } from './CtyApp';
import { t3 } from './text';

export const officeLabel = (o: Office | string | null | undefined) =>
  o === 'superior' ? t3('الرئيس', 'Superior', 'Supérieur') : o === 'econome' ? t3('القيم', 'Econome', 'Économe') : o === 'minister' ? t3('المدبر', 'Minister', 'Ministre') : o === 'admin' ? t3('المشرف', 'Administrator', 'Administrateur') : t3('يسوعي', 'Jesuit', 'Jésuite');
export const officeHelp = (o: Office) =>
  o === 'superior' ? t3('يرى كل شيء، يوافق أو يرفض، يعلّق. لا يغيّر شيئاً.', 'Sees everything, approves or refuses, comments. Changes nothing.', 'Voit tout, approuve ou refuse, commente. Ne change rien.')
    : o === 'econome' ? t3('يرى كل شيء؛ يعمل في دفاتره فقط: الصندوق والمصرف والإيكونوماتو.', 'Sees everything; works in his own books only: cash, bank, économat.', 'Voit tout ; ne travaille que dans ses comptes : caisse, banque, économat.')
      : o === 'minister' ? t3('يمسك حساب البيت وأظرفته.', 'Keeps the house account and its envelopes.', 'Tient le compte de la maison et ses enveloppes.')
        : t3('الحسابات وكلمات السر والصلاحيات والإعدادات. لا يرى أي قيد.', 'Accounts, passwords, permissions, settings. Sees no record.', 'Comptes, mots de passe, permissions, réglages. Ne voit aucune écriture.');

export function PeopleScreen() {
  const { s, reload, can } = useCty();
  const [data, setData] = useState<PeoplePayload>({ persons: [], offices: [] });
  const [err, setErr] = useState<string | null>(null);
  const [held, setHeld] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<{ name: string; password: string; hasBank: boolean } | null>(null);
  const load = useCallback(() => s.api.call('cty.people').then((d) => { setData(d); setErr(null); }).catch((e) => setErr(errText(e))), [s]);
  useEffect(() => { void load(); }, [load]);
  const manage = can('users.manage');
  const passwords = manage || can('cty.passwords');
  const done = async () => { await load(); await reload(); toast(t3('حُفظ ✓', 'Saved ✓', 'Enregistré ✓')); };

  const reset = async (id: number, name: string) => {
    const pw = await promptBox(t3(`كلمة سر جديدة لـ ${name} (6+، يغيّرها عند الدخول)`, `New password for ${name} (6+; changed at the next sign-in)`, `Nouveau mot de passe pour ${name} (6+ ; changé à la prochaine connexion)`));
    if (!pw) return;
    try { await s.api.call('cty.password.reset', { profileId: id, password: pw }); toast(t3('تم ✓', 'Done ✓', 'Fait ✓')); } catch (e) { toast(errText(e), true); }
  };
  const handover = async (o: OfficeRow) => {
    const heldBy = held[o.office] ?? o.heldBy;
    const pw = await promptBox(t3('كلمة سر جديدة للمنصب (اتركها فارغة إن لم تتغيّر)', 'New password for the office (leave empty to keep it)', 'Nouveau mot de passe de la fonction (vide = inchangé)'));
    try { await s.api.call('cty.office.save', { office: o.office, heldBy, password: pw || null }); setHeld({ ...held, [o.office]: heldBy }); await done(); } catch (e) { toast(errText(e), true); }
  };
  const savePerson = async (p: PersonRow, patch: Partial<PersonRow>) => {
    try { await s.api.call('cty.person.save', { id: p.id, name: patch.name ?? p.name, active: patch.active ?? p.active, hasBank: patch.hasBank ?? p.hasBank }); await done(); } catch (e) { toast(errText(e), true); }
  };
  const rename = async (p: PersonRow) => {
    const name = await promptBox(t3('الاسم', 'Name', 'Nom'), p.name);
    if (name && name !== p.name) await savePerson(p, { name });
  };
  const add = async () => {
    if (!adding) return;
    try { await s.api.call('cty.person.save', { name: adding.name, password: adding.password, hasBank: adding.hasBank }); setAdding(null); await done(); } catch (e) { toast(errText(e), true); }
  };
  const holders = data.persons.filter((p) => p.active);

  return (
    <>
      <h1>{t3('الحسابات', 'Accounts', 'Comptes')}</h1>
      {err && <div className="alert err">{err}</div>}

      <Card>
        <div className="cty-label">{t3('المناصب', 'The offices', 'Les fonctions')}</div>
        <p className="muted small">{t3('لكل منصب كلمة سر خاصة به، ويحتفظ بدفاتره وتاريخه عند تسليمه لغيرك.', 'Each office has its own password, and keeps its books and history when it is handed over.', 'Chaque fonction a son mot de passe, et garde ses comptes et son historique quand elle est transmise.')}</p>
        {data.offices.map((o) => (
          <div key={o.office} className="cty-office">
            <div><b>{officeLabel(o.office)}</b><div className="muted small">{officeHelp(o.office)}</div></div>
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              {manage ? (
                <>
                  <select value={held[o.office] ?? o.heldBy} onChange={(e) => setHeld({ ...held, [o.office]: e.target.value })}>
                    {[...new Set([o.heldBy, ...holders.map((p) => p.name)])].filter(Boolean).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button className="btn" onClick={() => handover(o)}>{t3('تسليم', 'Hand over', 'Transmettre')}</button>
                </>
              ) : <span>{o.heldBy}</span>}
              {passwords && (o.office !== 'admin' || manage) && <button className="btn ghost" onClick={() => reset(o.profileId, officeLabel(o.office))} title={t3('كلمة سر جديدة', 'New password', 'Nouveau mot de passe')}>🔑</button>}
            </div>
          </div>
        ))}
      </Card>

      <Card>
        <div className="cty-label">{t3('الإخوة', 'The Jesuits', 'Les jésuites')}</div>
        <table className="cty-people">
          <thead><tr><th>{t3('الاسم', 'Name', 'Nom')}</th><th>🏦</th><th>{t3('حاضر', 'Present', 'Présent')}</th><th /></tr></thead>
          <tbody>
            {data.persons.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'off'}>
                <td><b>{p.name}</b></td>
                <td className="c"><input type="checkbox" checked={p.hasBank} disabled={!manage} onChange={() => savePerson(p, { hasBank: !p.hasBank })} /></td>
                <td className="c"><input type="checkbox" checked={!!p.active} disabled={!manage} onChange={() => savePerson(p, { active: p.active ? 0 : 1 })} /></td>
                <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  {manage && <button className="btn ghost small" onClick={() => rename(p)} title={t3('تغيير الاسم', 'Rename', 'Renommer')}>✎</button>}
                  {passwords && <button className="btn ghost small" onClick={() => reset(p.id, p.name)} title={t3('كلمة سر جديدة', 'New password', 'Nouveau mot de passe')}>🔑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {manage && !adding && <button className="btn cty-wide" onClick={() => setAdding({ name: '', password: '', hasBank: false })}>＋ {t3('يسوعي جديد', 'A new Jesuit', 'Un nouveau jésuite')}</button>}
        {adding && (
          <div className="cty-add-person">
            <div className="grid2">
              <label className="field"><span>{t3('الاسم', 'Name', 'Nom')}</span><input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></label>
              <label className="field"><span>{t3('كلمة سر أولى (6+)', 'First password (6+)', 'Premier mot de passe (6+)')}</span><input type="password" value={adding.password} onChange={(e) => setAdding({ ...adding, password: e.target.value })} /></label>
            </div>
            <label className="row" style={{ gap: 4, marginTop: 6 }}><input type="checkbox" checked={adding.hasBank} onChange={() => setAdding({ ...adding, hasBank: !adding.hasBank })} />{t3('له حساب في المصرف', 'Has a bank account', 'A un compte en banque')}</label>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => setAdding(null)}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
              <button className="btn primary" disabled={!adding.name.trim() || adding.password.length < 6} onClick={add}>{t3('أضف', 'Add', 'Ajouter')}</button>
            </div>
          </div>
        )}
      </Card>
      <p className="muted small">🔑 = {t3('كلمة سر جديدة (يغيّرها صاحبها عند دخوله)', 'a new password (its owner changes it at his next sign-in)', 'un nouveau mot de passe (son titulaire le change à sa prochaine connexion)')} · 🏦 = {t3('له حساب في المصرف', 'has a bank account', 'a un compte en banque')}</p>
    </>
  );
}
