// The phone in a community (Fouad, 13 November 2026): the address to open on the phone (once, at home, on its Wi-Fi),
// and the phones linked to this account, each one cut off with one tap. The administrator sees every phone.
import { useCallback, useEffect, useState } from 'react';
import { confirmBox, errText, toast } from '../../ui/kit';
import { phoneWhere } from '../../net';
import type { PhoneInfo } from '../../ops';
import { useCty, Card } from './CtyApp';
import { t3 } from './text';

export function CtyPhones() {
  const { s, can } = useCty();
  const [list, setList] = useState<PhoneInfo[]>([]);
  const [start, setStart] = useState<string[]>([]);
  const load = useCallback(async () => { try { setList(await s.api.call('phone.list')); } catch { setList([]); } }, [s]);
  useEffect(() => { if (s.mode === 'server') { void load(); phoneWhere().then((w) => setStart(w.start), () => setStart([])); } }, [s, load]);
  if (s.mode !== 'server') return null;
  const cut = async (p: PhoneInfo) => {
    if (!(await confirmBox(t3(`إيقاف الهاتف «${p.name}»؟ لا يرسل بعدها شيئاً؛ يُربط من جديد في البيت.`, `Cut off the phone "${p.name}"? It sends nothing after that; it is linked again at home.`, `Couper le téléphone « ${p.name} » ? Il n'envoie plus rien ; on le relie à nouveau à la maison.`), true))) return;
    try { await s.api.call('phone.revoke', { id: p.id }); await load(); } catch (e) { toast(errText(e), true); }
  };
  return (
    <Card>
      <div className="cty-label">📱 {t3('الهاتف', 'The phone', 'Le téléphone')}</div>
      <p className="muted small">{t3('سجّل نفقاتك على هاتفك حتى بلا اتصال؛ يرسلها الهاتف حين يعود إلى شبكة البيت. مرة واحدة، على الواي فاي، افتح هذا العنوان واتبع الخطوات، واختر «جماعات اليسوعيين»:', "Record your expenses on your phone, even with no connection; the phone sends them when it is back on the house's network. Once, on the Wi-Fi, open this address, follow the steps, and choose \"Jesuit communities\":", "Notez vos dépenses sur votre téléphone, même sans connexion ; il les envoie de retour sur le réseau de la maison. Une fois, sur le Wi-Fi, ouvrez cette adresse, suivez les étapes et choisissez « Communautés jésuites » :")}</p>
      {start.length ? start.map((a) => <div key={a} className="ltr" style={{ fontWeight: 700, fontSize: 17, margin: '2px 0' }}>{a}</div>) : <p className="muted small">{t3('عنوان الهواتف لا يعمل على هذا الخادم.', "The phones' address is not running on this server.", "L'adresse des téléphones ne fonctionne pas sur ce serveur.")}</p>}
      {list.length > 0 && (
        <table className="desk-table small" style={{ marginTop: 8 }}>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className={p.revoked_at ? 'muted' : ''}>
                {can('users.manage') && <td>{p.user}</td>}
                <td>{p.name}</td>
                <td className="ltr">{(p.last_sync ?? p.created_at).slice(0, 10)}</td>
                <td>{p.revoked_at ? t3('موقوف', 'cut off', 'coupé') : <button className="btn small danger" onClick={() => void cut(p)}>{t3('أوقف', 'Cut off', 'Couper')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
