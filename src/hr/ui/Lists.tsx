// The lists a person's centre, account and budget line are chosen from (filled from the budget of a centre database,
// or by hand), and each centre's heading on the documents: its mark, its city, the first party and who signs, in
// Arabic and English.
import { useCallback, useEffect, useState } from 'react';
import { has } from '../../auth';
import type { Session } from '../../state';
import { CENTRES, type CentreKey } from '../../brand';
import { Field, Modal, confirmBox, toast } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import type { HrCheckItem, HrData, HrLeaveType, HrListItem } from '../hr';
import { centreChoices, centreLabel, centreVars, fail, markOf, type HrRights } from './common';
import { BackupsTab, HR_ROWS, RolesTab } from './Roles';
import { partyOf } from '../docs';
import { SessionPriceTab } from './Sessions';
import { SignAsButton } from '../../ui/SignAs';
import { GuideLink } from '../../guide/GuideView';

type Tab = 'lists' | 'checks' | 'price' | 'leave' | 'users' | 'roles' | 'backups';

/** The settings of HR (Fouad, 31 October 2026): the lists and the centres, what is done when someone arrives or leaves, the
 *  kinds of leave (prepared for later), and the users with the centres each one sees. */
export function ListsPage({ s, d, reload, r }: { s: Session; d: HrData; reload: () => Promise<void>; r: HrRights }) {
  const users = has(s.profile, 'users.manage');
  // each tab for who may use it (Fouad, 1 November 2026); the roles are changed by who manages users and sees every centre
  const tabs = ([
    ['lists', t3('القوائم والمراكز', 'Lists & centres', 'Listes et centres'), r.manage],
    ['checks', t3('الوصول والمغادرة', 'Arrival & leaving', 'Arrivée et départ'), r.manage],
    ['price', t3('سعر الجلسة', 'Session price', 'Prix de la séance'), r.scale],
    ['leave', t3('الإجازات (لاحقاً)', 'Leave (later)', 'Congés (plus tard)'), r.manage],
    ['users', t3('المستخدمون والمراكز', 'Users & centres', 'Utilisateurs et centres'), users],
    ['roles', t3('الأدوار والصلاحيات', 'Roles and rights', 'Rôles et droits'), users && !d.scope],
    ['backups', t3('النسخ الاحتياطية', 'Backups', 'Sauvegardes'), r.backups],
  ] as [Tab, string, boolean][]).filter((x) => x[2]);
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'lists');
  return (
    <>
      <div className="hr-head"><div><div className="hr-eyebrow">{t3('الموارد البشرية', 'Human resources', 'Ressources humaines')}</div><h1>{t3('الإعدادات', 'Settings', 'Réglages')}<GuideLink id="hr-settings" /></h1></div></div>
      <div className="hr-sheet" style={{ padding: '0 12px', borderTopWidth: 1, marginBottom: 14 }}><div className="hr-tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div></div>
      {tab === 'lists' && <ListsTab s={s} d={d} reload={reload} />}
      {tab === 'checks' && <ChecksTab s={s} d={d} reload={reload} />}
      {tab === 'price' && <SessionPriceTab s={s} d={d} />}
      {tab === 'leave' && <LeaveTab s={s} d={d} reload={reload} />}
      {tab === 'users' && users && <UsersTab s={s} d={d} />}
      {tab === 'roles' && users && !d.scope && <RolesTab s={s} />}
      {tab === 'backups' && r.backups && <BackupsTab s={s} />}
    </>
  );
}

function ListsTab({ s, d, reload }: { s: Session; d: HrData; reload: () => Promise<void> }) {
  const [sources, setSources] = useState<{ slug: string; organisation: string }[]>([]);
  const [from, setFrom] = useState('');
  const [edit, setEdit] = useState<HrListItem | 'new' | null>(null);
  useEffect(() => {
    fetch('/api/hr/sources', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : [])).then(setSources).catch(() => setSources([]));
  }, []);
  const centres = d.lists.filter((x) => x.kind === 'centre');
  return (
    <>
      <div className="hr-panel">
        <b>{t3('ملء القوائم من موازنة مركز', 'Fill the lists from the budget of a centre', "Remplir les listes depuis le budget d'un centre")}</b>
        <p className="muted small">{t3('مع الخطوط يُنسخ مشروع كل خط في موازنة المركز، ومع المشاريع اسم المانح ورقم العقد. ', "With the lines comes the project of each line in the centre's budget, and with the projects the donor and contract. ", "Avec les lignes vient le projet de chaque ligne dans le budget du centre, et avec les projets le bailleur et le contrat. ")}{t3('تُنسخ الأسماء والرموز فقط، لا المبالغ. أعد النسخ بعد تغيير موازنة المركز. ثم اضغط على المركز لتختار بند الرواتب.', "Only names and codes are copied, never amounts. Copy again after the centre's budget changes. Then click the centre to choose its salary heading.", "Seuls les noms et codes sont copiés, jamais les montants. Recopiez après un changement du budget du centre. Puis cliquez le centre pour choisir sa rubrique des salaires.")}</p>
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

      <div className="hr-head" style={{ marginTop: 22 }}><div><h1 style={{ fontSize: 18 }}>{t3('المراكز على الوثائق', 'The centres on the documents', 'Les centres sur les documents')}</h1></div>{!d.scope && <button className="btn small" onClick={() => setEdit('new')}>＋ {t3('مركز', 'Add a centre', 'Ajouter un centre')}</button>}</div>
      <div className="hr-people">
        {centres.map((c) => {
          const key = (c.code ?? 'other') as CentreKey;
          const p = partyOf(c);
          return (
            <button key={c.id} className="hr-card" style={centreVars(key)} onClick={() => setEdit(c)}>
              <div className="mark"><img src={markOf(key)} alt="" /></div>
              <div className="body"><b>{c.name}</b><div className="meta" dir="rtl">{p.partyAr}</div><div className="meta">{c.salary_heading ? `💼 ${c.salary_heading} (${d.lists.filter((x) => x.kind === 'line' && x.source === c.source && x.heading === c.salary_heading).length})` : c.source ? <span className="desk-alert">{t3('أي بند للرواتب؟', 'Which salary heading?', 'Quelle rubrique des salaires ?')}</span> : ''}</div><div className="meta">{c.rep_ar || c.rep_en ? `✍ ${[c.rep_ar, c.rep_en].filter(Boolean).join(' · ')}` : <span className="desk-alert">{t3('من يوقّع؟', 'Who signs?', 'Qui signe ?')}</span>}</div></div>
            </button>
          );
        })}
        {!centres.length && <p className="muted">{t3('انسخ من موازنة مركز أو أضف مركزاً.', 'Copy from the budget of a centre, or add a centre.', "Copiez depuis le budget d'un centre ou ajoutez un centre.")}</p>}
      </div>

      {edit && <CentreModal s={s} d={d} item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} reload={reload} />}
    </>
  );
}

function CentreModal({ s, d, item, onClose, reload }: { s: Session; d: HrData; item: HrListItem | null; onClose: () => void; reload: () => Promise<void> }) {
  const [f, setF] = useState({ name: item?.name ?? '', code: (item?.code ?? 'aleppo') as CentreKey, city_ar: item?.city_ar ?? '', city_en: item?.city_en ?? '', party_ar: item?.party_ar ?? '', party_en: item?.party_en ?? '', rep_ar: item?.rep_ar ?? '', rep_en: item?.rep_en ?? '', salary_heading: item?.salary_heading ?? '', account: item?.account ?? '' });
  const headings = [...new Set(d.lists.filter((x) => x.kind === 'line' && x.source && x.source === item?.source).map((x) => x.heading).filter((h): h is string => !!h))];
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
      {item?.source && (
        <div className="grid2" style={{ marginTop: 12 }}>
          <Field label={t3('بنود الرواتب في موازنة المركز', "The salary heading(s) of the centre's budget", 'Les rubriques des salaires du budget du centre')}>
            <div>{headings.map((h) => { const on = f.salary_heading.split('|').map((x) => x.trim()).includes(h); return (
              <label key={h} className="row" style={{ gap: 6 }}><input type="checkbox" checked={on} onChange={() => { const cur = f.salary_heading.split('|').map((x) => x.trim()).filter(Boolean); setF({ ...f, salary_heading: (on ? cur.filter((x) => x !== h) : [...cur, h]).join(' | ') }); }} /> {h}</label>
            ); })}</div>
          </Field>
        </div>
      )}
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

// ---------------------------------------------------------------- what is done when someone arrives or leaves

function ChecksTab({ s, d, reload }: { s: Session; d: HrData; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState<{ item: HrCheckItem | null; kind: 'arrival' | 'leaving' } | null>(null);
  const whole = !d.scope;
  const col = (kind: 'arrival' | 'leaving', title: string, hint: string) => {
    const items = d.checkItems.filter((i) => i.kind === kind);
    return (
      <div className="hr-panel">
        <div className="row" style={{ justifyContent: 'space-between' }}><b>{title}</b>{whole && <button className="btn small gold" onClick={() => setEdit({ item: null, kind })}>＋ {t3('بند', 'Add', 'Ajouter')}</button>}</div>
        <p className="muted small">{hint}</p>
        <ul className="hr-check">
          {items.map((i, n) => (
            <li key={i.id} style={{ opacity: i.active ? 1 : 0.45 }}>
              <span className="muted small" style={{ width: 18 }}>{n + 1}.</span>
              <span className="lbl">{i.label_en}{i.label_ar ? <div className="muted small" dir="rtl">{i.label_ar}</div> : null}{!i.active ? <span className="muted small"> · {t3('موقوف', 'off', 'désactivé')}</span> : null}</span>
              {whole && <span className="nowrap"><button className="btn small" disabled={n === 0} onClick={async () => { try { await s.api.call('hr.check.move', { id: i.id, by: -1 }); await reload(); } catch (e) { fail(e); } }}>↑</button>{' '}<button className="btn small" disabled={n === items.length - 1} onClick={async () => { try { await s.api.call('hr.check.move', { id: i.id, by: 1 }); await reload(); } catch (e) { fail(e); } }}>↓</button>{' '}<button className="btn small" onClick={() => setEdit({ item: i, kind })}>{t3('تعديل', 'Edit', 'Modifier')}</button></span>}
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <>
      <p className="muted">{t3('ما يجب عمله حين يصل أحد وحين يغادر. يظهر على بطاقة كل شخص ويُعلَّم بتاريخه.', "What is to be done when someone arrives and when someone leaves. It shows on each person's card and is ticked with its date.", "Ce qui est à faire quand quelqu'un arrive et quand quelqu'un part. Cela s'affiche sur la fiche de chacun et se coche avec sa date.")}{!whole ? ` ${t3('(يغيّر القائمتين من يرى كل المراكز.)', '(The two lists are changed by someone who sees every centre.)', '(Les deux listes sont changées par qui voit tous les centres.)')}` : ''}</p>
      <div className="grid2" style={{ alignItems: 'start' }}>
        {col('arrival', t3('عند الوصول', 'When someone arrives', "À l'arrivée"), t3('الاتفاقية، المدونة، الوثائق، التعريف بالفريق…', 'The agreement, the code, the documents, meeting the team…', "L'accord, le code, les documents, la rencontre de l'équipe…"))}
        {col('leaving', t3('عند المغادرة (براءة الذمة)', 'When someone leaves (clearance)', 'Au départ (quitus)'), t3('رسالة نهاية الاتفاقية، إعادة الأدوات، آخر مكافأة…', 'The end-of-agreement letter, things returned, the last stipend…', "La lettre de fin d'accord, le matériel rendu, la dernière gratification…"))}
      </div>
      {edit && <CheckModal s={s} item={edit.item} kind={edit.kind} onClose={() => setEdit(null)} reload={reload} />}
    </>
  );
}

function CheckModal({ s, item, kind, onClose, reload }: { s: Session; item: HrCheckItem | null; kind: 'arrival' | 'leaving'; onClose: () => void; reload: () => Promise<void> }) {
  const [f, setF] = useState({ ar: item?.label_ar ?? '', en: item?.label_en ?? '', active: item ? !!item.active : true });
  return (
    <Modal title={kind === 'arrival' ? t3('بند عند الوصول', 'On arrival', "À l'arrivée") : t3('بند عند المغادرة', 'On leaving', 'Au départ')} onClose={onClose} narrow>
      <Field label="بالعربية"><input dir="rtl" autoFocus value={f.ar} onChange={(e) => setF({ ...f, ar: e.target.value })} /></Field>
      <Field label="In English"><input dir="ltr" value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} /></Field>
      {item && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t3('مستعمل (أزل العلامة لإيقافه دون حذف ما سُجّل)', 'In use (untick to stop it without losing what was ticked)', 'En usage (décochez pour l’arrêter sans perdre ce qui a été coché)')}</label>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!f.en.trim() && !f.ar.trim()} onClick={async () => { try { await s.api.call('hr.check.save', { id: item?.id ?? null, kind, labelAr: f.ar || null, labelEn: f.en || f.ar, active: f.active }); await reload(); onClose(); } catch (e) { fail(e); } }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- leave: prepared (the kinds only, for now)

function LeaveTab({ s, d, reload }: { s: Session; d: HrData; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState<HrLeaveType | 'new' | null>(null);
  return (
    <>
      <p className="muted">{t3('الإجازات ستأتي لاحقاً: البرنامج جاهز لها. هنا أنواعها وعدد أيامها في السنة (الاتفاقية: 10 أيام سنوية و12 يوماً مرضية).', 'Leave will come later: the program is ready for it. Here are its kinds and their days a year (the agreement: 10 days of annual leave and 12 days of sick leave).', "Les congés viendront plus tard : le programme est prêt. Voici leurs types et leurs jours par an (l'accord : 10 jours de congé annuel et 12 jours de maladie).")}</p>
      <div className="hr-panel">
        <div className="row" style={{ justifyContent: 'space-between' }}><b>{t3('أنواع الإجازات', 'Kinds of leave', 'Types de congé')}</b>{!d.scope && <button className="btn small gold" onClick={() => setEdit('new')}>＋ {t3('نوع', 'Add', 'Ajouter')}</button>}</div>
        <table className="desk-table" style={{ marginTop: 6 }}>
          <thead><tr><th>{t3('النوع', 'Kind', 'Type')}</th><th className="n">{t3('أيام في السنة', 'Days a year', 'Jours par an')}</th><th>{t3('مدفوعة', 'Paid', 'Payé')}</th><th /></tr></thead>
          <tbody>{d.leaveTypes.map((x) => <tr key={x.id} style={{ opacity: x.active ? 1 : 0.45 }}><td><b>{x.name_en}</b>{x.name_ar ? <span className="muted" dir="rtl"> · {x.name_ar}</span> : null}</td><td className="n">{x.days_per_year ?? '—'}</td><td>{x.paid ? '✓' : '—'}</td><td className="right">{!d.scope && <button className="btn small" onClick={() => setEdit(x)}>{t3('تعديل', 'Edit', 'Modifier')}</button>}</td></tr>)}</tbody>
        </table>
      </div>
      {edit && <LeaveTypeModal s={s} item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} reload={reload} />}
    </>
  );
}

function LeaveTypeModal({ s, item, onClose, reload }: { s: Session; item: HrLeaveType | null; onClose: () => void; reload: () => Promise<void> }) {
  const [f, setF] = useState({ ar: item?.name_ar ?? '', en: item?.name_en ?? '', days: item?.days_per_year != null ? String(item.days_per_year) : '', paid: item ? !!item.paid : true, active: item ? !!item.active : true });
  return (
    <Modal title={t3('نوع إجازة', 'Kind of leave', 'Type de congé')} onClose={onClose} narrow>
      <div className="grid2"><Field label="بالعربية"><input dir="rtl" value={f.ar} onChange={(e) => setF({ ...f, ar: e.target.value })} /></Field><Field label="In English"><input value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} /></Field></div>
      <Field label={t3('أيام في السنة', 'Days a year', 'Jours par an')}><input inputMode="decimal" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} />{t3('مدفوعة', 'Paid', 'Payé')}</label>
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t3('مستعمل', 'In use', 'En usage')}</label>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!f.en.trim() && !f.ar.trim()} onClick={async () => { try { await s.api.call('hr.leave.type.save', { id: item?.id ?? null, nameAr: f.ar || null, nameEn: f.en || f.ar, daysPerYear: f.days === '' ? null : Number(f.days), paid: f.paid, active: f.active }); await reload(); onClose(); } catch (e) { fail(e); } }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- the users and the centres each one sees

interface HrUser { id: number; name: string; access_id: number | null; access_name: string | null; active: number; centres: string[] | null }

function UsersTab({ s, d }: { s: Session; d: HrData }) {
  const [data, setData] = useState<{ users: HrUser[]; access: { id: number; name: string; perms: string[] }[] } | null>(null);
  const [edit, setEdit] = useState<HrUser | 'new' | null>(null);
  const load = useCallback(async () => { try { setData(await s.api.call('hr.users.list', {})); } catch (e) { fail(e); } }, [s]);
  useEffect(() => { void load(); }, [load]);
  const centres = centreChoices(d);
  const nameOf = (code: string) => centreLabel(d, code);
  return (
    <>
      <p className="muted">{t3('لكل مركز مسؤول موارد بشرية لا يرى إلا مركزه. الرئيس يعتمد الكشوف. مدير ماجيس يرى المراكز الثلاثة. «كل المراكز» = يرى الجميع.', 'Each centre has an HR keeper who sees only that centre. The Superior approves the payroll. The MAGIS manager sees the three centres. "Every centre" = sees everyone.', 'Chaque centre a un responsable RH qui ne voit que son centre. Le Supérieur approuve les paies. Le directeur MAGIS voit les trois centres. « Tous les centres » = voit tout le monde.')}</p>
      <div className="hr-panel">
        <div className="row" style={{ justifyContent: 'space-between' }}><b>{t3('المستخدمون', 'Users', 'Utilisateurs')}</b><button className="btn small gold" onClick={() => setEdit('new')}>＋ {t3('مستخدم', 'Add a user', 'Ajouter un utilisateur')}</button></div>
        <table className="desk-table" style={{ marginTop: 6 }}>
          <thead><tr><th>{t3('الاسم', 'Name', 'Nom')}</th><th>{t3('الصلاحيات', 'Rights', 'Droits')}</th><th>{t3('المراكز التي يراها', 'Centres seen', 'Centres vus')}</th><th /></tr></thead>
          <tbody>
            {(data?.users ?? []).map((u) => (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.45 }}>
                <td><b>{u.name}</b>{!u.active ? <span className="muted small"> · {t3('موقوف', 'off', 'désactivé')}</span> : null}</td>
                <td className="small">{u.access_name ?? '—'}</td>
                <td>{u.centres ? u.centres.map((c) => <span key={c} className="row" style={{ gap: 4, display: 'inline-flex', marginInlineEnd: 8 }}><img src={markOf(c as CentreKey)} alt="" style={{ height: 18 }} />{nameOf(c)}</span>) : <b>{t3('كل المراكز', 'Every centre', 'Tous les centres')}</b>}</td>
                <td className="right nowrap">{u.active ? <SignAsButton s={s} profileId={u.id} name={u.name} small /> : null} <button className="btn small" onClick={() => setEdit(u)}>{t3('تعديل', 'Edit', 'Modifier')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{t3('يُطبَّق التغيير عند الطلب التالي للمستخدم (لا حاجة لخروجه).', "A change applies from the user's next action (no need to sign out).", "Un changement s'applique dès la prochaine action de l'utilisateur (pas besoin de se déconnecter).")}</p>
      </div>
      {edit && data && <UserModal s={s} d={d} user={edit === 'new' ? null : edit} access={data.access} centres={centres} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); await load(); }} />}
    </>
  );
}

function UserModal({ s, d, user, access, centres, onClose, onDone }: { s: Session; d: HrData; user: HrUser | null; access: { id: number; name: string; perms: string[] }[]; centres: { code: string; name: string }[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ name: user?.name ?? '', accessId: user?.access_id ?? access[0]?.id ?? 0, all: user ? !user.centres : !d.scope, centres: user?.centres ?? (d.scope ?? []), password: '', active: user ? !!user.active : true });
  const toggle = (c: string, on: boolean) => setF({ ...f, centres: on ? [...f.centres, c] : f.centres.filter((x) => x !== c) });
  return (
    <Modal title={user ? user.name : t3('مستخدم جديد', 'New user', 'Nouvel utilisateur')} onClose={onClose} narrow>
      <Field label={t3('الاسم', 'Name', 'Nom')}><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t3('الصلاحيات', 'Rights', 'Droits')}><select value={f.accessId} onChange={(e) => setF({ ...f, accessId: Number(e.target.value) })}>{access.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <ul className="muted small" style={{ marginTop: 0, paddingInlineStart: 18 }}>{HR_ROWS.flatMap((g) => g.perms).filter((p) => access.find((a) => a.id === f.accessId)?.perms.includes(p.key)).map((p) => <li key={p.key}>{p.label}</li>)}</ul>
      <Field label={t3('المراكز التي يراها', 'Centres seen', 'Centres vus')}>
        <div>
          {!d.scope && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.all} onChange={(e) => setF({ ...f, all: e.target.checked })} /><b>{t3('كل المراكز (مدير ماجيس)', 'Every centre (MAGIS manager)', 'Tous les centres (directeur MAGIS)')}</b></label>}
          {!f.all && centres.map((c) => <label key={c.code} className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.centres.includes(c.code)} onChange={(e) => toggle(c.code, e.target.checked)} /><img src={markOf(c.code as CentreKey)} alt="" style={{ height: 18 }} />{c.name}</label>)}
        </div>
      </Field>
      <Field label={user ? t3('كلمة سر جديدة (فارغ = لا تغيير)', 'New password (empty = no change)', 'Nouveau mot de passe (vide = inchangé)') : t3('كلمة السر الأولى (يغيّرها عند دخوله)', 'First password (changed at first sign-in)', 'Premier mot de passe (changé à la première connexion)')}><input type="text" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      {user && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t3('نشط', 'Active', 'Actif')}</label>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!f.name.trim() || (!f.all && !f.centres.length) || (!user && !f.password)} onClick={async () => {
          try { await s.api.call('hr.user.save', { id: user?.id ?? null, name: f.name, accessId: f.accessId, centres: f.all ? null : f.centres, password: f.password || null, active: f.active }); toast(t3('حُفظ', 'Saved', 'Enregistré')); await onDone(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}
