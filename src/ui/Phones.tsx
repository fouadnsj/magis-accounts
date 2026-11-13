// Admin → Users → Phones (Fouad, 2026-11-13): the phones linked to this database. Each person sees their own; whoever
// manages the users sees all of them. A phone can be cut off at once (lost, or its owner left).
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state';
import type { PhoneInfo } from '../ops';
import { m, tx } from '../i18n';
import { confirmBox, errText, toast } from './kit';

const t3 = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));
const DAYS = 30;

export function Phones() {
  const { s, can } = useApp();
  const [list, setList] = useState<PhoneInfo[] | null>(null);
  const load = useCallback(async () => { try { setList(await s.api.call('phone.list')); } catch { setList([]); } }, [s]);
  useEffect(() => { if (s.mode === 'server') void load(); }, [s, load]);
  if (s.mode !== 'server' || !list) return null;
  const address = `${location.origin}/phone.html`;
  const cut = async (p: PhoneInfo) => {
    if (!(await confirmBox(t3(`إيقاف الهاتف «${p.name}» (${p.user ?? '?'})؟ لا يرسل بعدها شيئاً؛ صاحبه يربطه من جديد في المركز.`, `Cut off the phone "${p.name}" (${p.user ?? '?'})? It sends nothing after that; its owner links it again at the centre.`, `Couper le téléphone « ${p.name} » (${p.user ?? '?'}) ? Il n'envoie plus rien ; son propriétaire le relie à nouveau au centre.`), true))) return;
    try { await s.api.call('phone.revoke', { id: p.id }); await load(); toast(t3('أُوقف', 'Cut off', 'Coupé')); } catch (e) { toast(errText(e)); }
  };
  const until = (p: PhoneInfo) => new Date(Date.parse(p.last_sync ?? p.created_at) + DAYS * 86_400_000).toISOString().slice(0, 10);
  const old = (p: PhoneInfo) => Date.now() > Date.parse(p.last_sync ?? p.created_at) + DAYS * 86_400_000;
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>📱 {t3('الهواتف', 'Phones', 'Téléphones')}</h3>
      <p className="muted small">
        {t3('من يكتب في دفتر يسجّل النفقات والإيرادات من هاتفه، بعيداً عن المركز، والهاتف يرسلها حين يعود إلى شبكة المركز. يفتح على الهاتف هذا العنوان ويربطه مرة واحدة:', "Someone who writes in a book can record expenses and income on a phone, away from the centre; the phone sends them when it is back on the centre's network. On the phone, open this address and link it once:", "Qui écrit dans un livre peut noter dépenses et recettes sur un téléphone, loin du centre ; le téléphone les envoie de retour sur le réseau du centre. Sur le téléphone, ouvrez cette adresse et reliez-le une fois :")}{' '}
        <b className="ltr">{address}</b>
      </p>
      {!list.length ? <p className="muted">{t3('لا هاتف مربوط بعد.', 'No phone is linked yet.', "Aucun téléphone n'est encore relié.")}</p> : (
        <table className="desk-table">
          <thead><tr>
            {can('users.manage') && <th>{t3('المستخدم', 'User', 'Utilisateur')}</th>}
            <th>{t3('الهاتف', 'Phone', 'Téléphone')}</th><th>{t3('رُبط', 'Linked', 'Relié')}</th><th>{t3('آخر مزامنة', 'Last sync', 'Dernière synchronisation')}</th><th>{t3('صالح حتى', 'Good until', "Valable jusqu'au")}</th><th />
          </tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className={p.revoked_at ? 'muted' : ''}>
                {can('users.manage') && <td>{p.user ?? '?'}</td>}
                <td>{p.name}</td>
                <td className="ltr">{p.created_at.slice(0, 10)}</td>
                <td className="ltr">{p.last_sync ? p.last_sync.slice(0, 16).replace('T', ' ') : '—'}</td>
                <td>{p.revoked_at ? t3(`أوقفه ${p.revoked_by ?? ''}`, `cut off by ${p.revoked_by ?? ''}`, `coupé par ${p.revoked_by ?? ''}`) : old(p) ? t3('انتهى: يُربط من جديد', 'over: to be linked again', 'terminé : à relier à nouveau') : <span className="ltr">{until(p)}</span>}</td>
                <td className="right">{!p.revoked_at && <button className="btn small danger" onClick={() => cut(p)}>{t3('أوقف', 'Cut off', 'Couper')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
