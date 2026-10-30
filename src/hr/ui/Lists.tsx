// The lists a person's centre, account and budget line are chosen from (filled from the budget of a centre database,
// or by hand), and each centre's heading on the documents: its mark, its city, the first party and who signs, in
// Arabic and English.
import { useEffect, useState } from 'react';
import type { Session } from '../../state';
import { CENTRES, type CentreKey } from '../../brand';
import { Field, Modal, confirmBox, toast } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import type { HrData, HrListItem } from '../hr';
import { centreVars, fail, markOf } from './common';
import { partyOf } from '../docs';

export function ListsPage({ s, d, reload }: { s: Session; d: HrData; reload: () => Promise<void> }) {
  const [sources, setSources] = useState<{ slug: string; organisation: string }[]>([]);
  const [from, setFrom] = useState('');
  const [edit, setEdit] = useState<HrListItem | 'new' | null>(null);
  const [add, setAdd] = useState({ kind: 'line' as 'account' | 'line', name: '', code: '' });
  useEffect(() => {
    fetch('/api/hr/sources', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : [])).then(setSources).catch(() => setSources([]));
  }, []);
  const centres = d.lists.filter((x) => x.kind === 'centre');
  const kinds = [['account', t3('الحسابات', 'Accounts', 'Comptes')], ['line', t3('بنود الموازنة', 'Budget lines', 'Lignes budgétaires')]] as const;
  return (
    <>
      <div className="hr-head"><div><div className="hr-eyebrow">{t3('من الموازنات', 'From the budgets', 'Depuis les budgets')}</div><h1>{t3('القوائم والمراكز', 'Lists & centres', 'Listes et centres')}</h1></div></div>

      <div className="hr-panel">
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
        {!sources.length && <p className="muted small">{t3('لا قاعدة مركز متاحة لك.', 'No centre database is available to you.', "Aucune base de centre n'est disponible pour vous.")}</p>}
      </div>

      <div className="hr-head" style={{ marginTop: 22 }}><div><h1 style={{ fontSize: 18 }}>{t3('المراكز على الوثائق', 'The centres on the documents', 'Les centres sur les documents')}</h1></div><button className="btn small" onClick={() => setEdit('new')}>＋ {t3('مركز', 'Add a centre', 'Ajouter un centre')}</button></div>
      <div className="hr-people">
        {centres.map((c) => {
          const key = (c.code ?? 'other') as CentreKey;
          const p = partyOf(c);
          return (
            <button key={c.id} className="hr-card" style={centreVars(key)} onClick={() => setEdit(c)}>
              <div className="mark"><img src={markOf(key)} alt="" /></div>
              <div className="body"><b>{c.name}</b><div className="meta" dir="rtl">{p.partyAr}</div><div className="meta">{c.rep_ar || c.rep_en ? `✍ ${[c.rep_ar, c.rep_en].filter(Boolean).join(' · ')}` : <span className="desk-alert">{t3('من يوقّع؟', 'Who signs?', 'Qui signe ?')}</span>}</div></div>
            </button>
          );
        })}
        {!centres.length && <p className="muted">{t3('انسخ من موازنة مركز أو أضف مركزاً.', 'Copy from the budget of a centre, or add a centre.', "Copiez depuis le budget d'un centre ou ajoutez un centre.")}</p>}
      </div>

      {kinds.map(([kind, title]) => (
        <div key={kind} className="hr-panel" style={{ marginTop: 14 }}>
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
      <div className="hr-panel" style={{ marginTop: 14 }}>
        <b>{t3('إضافة يدوية', 'Add by hand', 'Ajouter à la main')}</b>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <select value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value as 'account' | 'line' })}>{kinds.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          {add.kind === 'line' && <input style={{ width: 90 }} placeholder={t3('الرمز', 'Code', 'Code')} value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value })} />}
          <input placeholder={t3('الاسم', 'Name', 'Nom')} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <button className="btn" disabled={!add.name.trim()} onClick={async () => { try { await s.api.call('hr.list.save', { kind: add.kind, name: add.name, code: add.code || null }); setAdd({ ...add, name: '', code: '' }); await reload(); } catch (e) { fail(e); } }}>＋</button>
        </div>
      </div>
      {edit && <CentreModal s={s} item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} reload={reload} />}
    </>
  );
}

function CentreModal({ s, item, onClose, reload }: { s: Session; item: HrListItem | null; onClose: () => void; reload: () => Promise<void> }) {
  const [f, setF] = useState({ name: item?.name ?? '', code: (item?.code ?? 'aleppo') as CentreKey, city_ar: item?.city_ar ?? '', city_en: item?.city_en ?? '', party_ar: item?.party_ar ?? '', party_en: item?.party_en ?? '', rep_ar: item?.rep_ar ?? '', rep_en: item?.rep_en ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const preview = partyOf({ ...(item ?? { id: 0, kind: 'centre', heading: null, source: null }), ...f } as HrListItem);
  return (
    <Modal title={item?.name ?? t3('مركز جديد', 'New centre', 'Nouveau centre')} onClose={onClose}>
      <div className="hr-chips">
        {(['jaramana', 'aleppo', 'homs', 'other'] as CentreKey[]).map((k) => <button key={k} className={f.code === k ? 'on' : ''} style={centreVars(k)} onClick={() => setF({ ...f, code: k })}><img src={markOf(k)} alt="" />{CENTRES[k].name.en}</button>)}
      </div>
      <Field label={t3('الاسم في القوائم', 'Name in the lists', 'Nom dans les listes')}><input value={f.name} onChange={set('name')} /></Field>
      <div className="hr-two" style={{ marginTop: 10 }}>
        <div dir="rtl">
          <h4>العربية</h4>
          <Field label="المدينة"><input dir="rtl" value={f.city_ar} onChange={set('city_ar')} /></Field>
          <Field label="الفريق الأول (مثلاً: دير الآباء اليسوعيين في حلب)"><input dir="rtl" value={f.party_ar} onChange={set('party_ar')} /></Field>
          <Field label="يمثله (من يوقّع)"><input dir="rtl" value={f.rep_ar} onChange={set('rep_ar')} /></Field>
        </div>
        <div dir="ltr">
          <h4>English</h4>
          <Field label="City"><input dir="ltr" value={f.city_en} onChange={set('city_en')} /></Field>
          <Field label="First party"><input dir="ltr" value={f.party_en} onChange={set('party_en')} /></Field>
          <Field label="Represented by (who signs)"><input dir="ltr" value={f.rep_en} onChange={set('rep_en')} /></Field>
        </div>
      </div>
      <div className="hr-panel" style={{ marginTop: 12, background: '#FBF7EE' }}>
        <div className="muted small">{t3('هكذا يبدأ العقد:', 'The agreement will begin:', "L'accord commencera :")}</div>
        <div dir="rtl">الفريق الأول: {preview.partyAr} يمثله في هذا العقد {preview.repAr}</div>
        <div dir="ltr">First party: {preview.partyEn}, represented by {preview.repEn}</div>
      </div>
      <div className="modal-foot">
        {item && <button className="btn danger" onClick={async () => { if (await confirmBox(t3('إزالة هذا المركز من القائمة؟', 'Remove this centre from the list?', 'Retirer ce centre de la liste ?'), true)) { try { await s.api.call('hr.list.delete', { id: item.id }); await reload(); onClose(); } catch (e) { fail(e); } } }}>{t3('إزالة', 'Remove', 'Retirer')}</button>}
        <button className="btn primary" disabled={!f.name.trim()} onClick={async () => { try { await s.api.call('hr.list.save', { id: item?.id ?? null, kind: 'centre', ...f }); toast(t3('حُفظ', 'Saved', 'Enregistré')); await reload(); onClose(); } catch (e) { fail(e); } }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}
