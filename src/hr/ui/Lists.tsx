// The stored lists the person's centre, account and budget line are chosen from (filled from the budget of a
// centre database, or by hand), and the name that signs the agreements and letters.
import { useEffect, useState } from 'react';
import type { Session } from '../../state';
import { errText, Field, confirmBox, toast } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import type { HrData } from '../hr';

const fail = (e: unknown) => toast(errText(e), true);

export function ListsPage({ s, d, reload }: { s: Session; d: HrData; reload: () => Promise<void> }) {
  const [sources, setSources] = useState<{ slug: string; organisation: string }[]>([]);
  const [from, setFrom] = useState('');
  const [rep, setRep] = useState(d.docSettings);
  const [add, setAdd] = useState({ kind: 'line' as 'centre' | 'account' | 'line', name: '', code: '' });
  useEffect(() => {
    fetch('/api/hr/sources', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : [])).then(setSources).catch(() => setSources([]));
  }, []);
  const kinds = [['centre', t3('المراكز', 'Centres', 'Centres')], ['account', t3('الحسابات', 'Accounts', 'Comptes')], ['line', t3('بنود الموازنة', 'Budget lines', 'Lignes budgétaires')]] as const;
  return (
    <>
      <div className="desk-head"><h1>{t3('القوائم والتوقيع', 'Lists & signatory', 'Listes et signataire')}</h1></div>
      <div className="cty-card">
        <b>{t3('ملء القوائم من موازنة مركز', 'Fill the lists from the budget of a centre', "Remplir les listes depuis le budget d'un centre")}</b>
        <p className="muted small">{t3('تُنسخ الأسماء والرموز فقط (المركز، الحسابات، بنود الموازنة)، لا المبالغ. يمكن تكراره بعد تغيير الموازنة.', 'Only names and codes are copied (the centre, the accounts, the budget lines), never amounts. It can be repeated after the budget changes.', 'Seuls les noms et codes sont copiés (le centre, les comptes, les lignes budgétaires), jamais les montants. On peut le refaire après un changement du budget.')}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">{t3('— اختر المركز —', '— choose the centre —', '— choisissez le centre —')}</option>{sources.map((x) => <option key={x.slug} value={x.slug}>{x.organisation}</option>)}</select>
          <button className="btn primary" disabled={!from} onClick={async () => {
            try {
              const r = await fetch('/api/hr/import-lists', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from }) });
              const j = await r.json();
              if (!r.ok) throw new Error(j?.error?.en ?? 'Error');
              toast(t3(`${j.accounts} حساب و${j.lines} بنداً`, `${j.accounts} accounts and ${j.lines} budget lines`, `${j.accounts} comptes et ${j.lines} lignes`));
              await reload();
            } catch (e) { fail(e); }
          }}>{t3('نسخ', 'Copy', 'Copier')}</button>
        </div>
        {!sources.length && <p className="muted small">{t3('لا قاعدة مركز متاحة لك. أنشئ المركز أولاً أو اطلب من المدير إعطاءك حق الدخول إليه.', 'No centre database is available to you. Create the centre first, or ask the administrator for access to it.', "Aucune base de centre n'est disponible pour vous. Créez d'abord le centre ou demandez l'accès à l'administrateur.")}</p>}
      </div>

      {kinds.map(([kind, title]) => (
        <div key={kind} className="cty-card" style={{ marginTop: 12 }}>
          <b>{title}</b>
          <table className="desk-table">
            <tbody>
              {d.lists.filter((x) => x.kind === kind).map((x) => (
                <tr key={x.id}>
                  <td>{x.code ? <b>{x.code}</b> : null} {x.name}{x.heading ? <span className="muted small"> · {x.heading}</span> : null}</td>
                  <td className="right"><button className="btn small danger" onClick={async () => { if (await confirmBox(t3('إزالة من القائمة؟', 'Remove from the list?', 'Retirer de la liste ?'), true)) { try { await s.api.call('hr.list.delete', { id: x.id }); await reload(); } catch (e) { fail(e); } } }}>✕</button></td>
                </tr>
              ))}
              {!d.lists.some((x) => x.kind === kind) && <tr><td className="muted">{t3('فارغة.', 'Empty.', 'Vide.')}</td></tr>}
            </tbody>
          </table>
        </div>
      ))}
      <div className="cty-card" style={{ marginTop: 12 }}>
        <b>{t3('إضافة يدوية', 'Add by hand', 'Ajouter à la main')}</b>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <select value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value as 'centre' | 'account' | 'line' })}>{kinds.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          {add.kind === 'line' && <input style={{ width: 90 }} placeholder={t3('الرمز', 'Code', 'Code')} value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value })} />}
          <input placeholder={t3('الاسم', 'Name', 'Nom')} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <button className="btn" disabled={!add.name.trim()} onClick={async () => { try { await s.api.call('hr.list.save', { kind: add.kind, name: add.name, code: add.code || null }); setAdd({ ...add, name: '', code: '' }); await reload(); } catch (e) { fail(e); } }}>＋</button>
        </div>
      </div>

      <div className="cty-card" style={{ marginTop: 12 }}>
        <b>{t3('من يوقّع باسم الرهبانية على الاتفاقيات والرسائل', 'Who signs for the Society of Jesus on agreements and letters', 'Qui signe pour la Compagnie sur les accords et lettres')}</b>
        <div className="grid2" style={{ marginTop: 6 }}>
          <Field label={t3('بالعربية', 'In Arabic', 'En arabe')}><input value={rep.repAr} onChange={(e) => setRep({ ...rep, repAr: e.target.value })} /></Field>
          <Field label={t3('بالإنكليزية', 'In English', 'En anglais')}><input value={rep.repEn} onChange={(e) => setRep({ ...rep, repEn: e.target.value })} /></Field>
        </div>
        <button className="btn small" onClick={async () => { try { await s.api.call('hr.docs.settings', rep); toast(t3('حُفظ', 'Saved', 'Enregistré')); await reload(); } catch (e) { fail(e); } }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </>
  );
}
