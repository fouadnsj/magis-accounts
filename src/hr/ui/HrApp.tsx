// The HR screens (Fouad, 30 October 2026), stage 1: what needs attention, the people (with their yearly
// volunteer agreements, one-time stipend letters and code of conduct), the code of conduct, the vault of
// document copies and the log of every opening. Pay (scale, timesheet, payroll) comes in the next stages.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { has } from '../../auth';
import type { Session } from '../../state';
import { errText, Field, Modal, confirmBox, fmtDate, toast, todayIso } from '../../ui/kit';
import { pickFile, toBase64 } from '../../platform';
import { WhoIs } from '../../community/ui/CtyApp';
import { t3 } from '../../community/ui/text';
import type { HrAlert, HrData, HrPaper, HrPerson } from '../hr';
import { HoursPage, ScalePage } from './Pay';
import '../../community/ui/cty.css';
import '../../community/ui/desk/desk.css';

type Page = 'home' | 'people' | 'scale' | 'hours' | 'conduct' | 'log';
const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const fail = (e: unknown) => toast(errText(e), true);

interface Ctx { s: Session; d: HrData; reload: () => Promise<void>; open: (p: HrPerson) => void }

/** Opens a scan in a new tab (every opening is written in the log on the server). */
async function openScan(s: Session, kind: 'paper' | 'conduct' | 'sign' | 'doc', id: number) {
  try {
    const f = await s.api.call('hr.file.get', { kind, id });
    const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    window.open(URL.createObjectURL(new Blob([bytes], { type: f.mime })), '_blank');
  } catch (e) { fail(e); }
}

/** Chooses a PDF or a picture; returns what the server needs. */
async function chooseScan(title: string) {
  const f = await pickFile(['pdf', 'png', 'jpg', 'jpeg'], title);
  if (!f) return null;
  const mime = MIME[f.name.split('.').pop()?.toLowerCase() ?? ''];
  if (!mime) { toast(t3('PDF أو صورة فقط', 'PDF or picture only', 'PDF ou image seulement'), true); return null; }
  return { base64: toBase64(f.bytes), mime, name: f.name };
}

export function HrApp({ session, onLogout }: { session: Session; onLogout: () => void; onLang?: () => void }) {
  const [d, setD] = useState<HrData | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [err, setErr] = useState<string | null>(null);
  const [person, setPerson] = useState<HrPerson | 'new' | null>(null);
  const reload = useCallback(async () => {
    try { setD(await session.api.call('hr.data', {})); setErr(null); } catch (e) { setErr(errText(e)); }
  }, [session]);
  useEffect(() => { void reload(); }, [reload]);
  const manage = has(session.profile, 'hr.manage');
  const vault = has(session.profile, 'hr.vault');
  const pay = has(session.profile, 'hr.pay');
  if (!d) return <div className="cty"><div className="cty-page">{err ? <div className="alert err">{err}</div> : '…'}</div></div>;
  const ctx: Ctx = { s: session, d, reload, open: (p) => setPerson(p) };
  const items: { p: Page; label: string; badge?: number }[] = [
    { p: 'home', label: t3('البداية: ما يحتاج انتباهاً', 'Home: what needs attention', 'Accueil : à surveiller'), badge: d.alerts.length },
    { p: 'people', label: t3('الأشخاص', 'People', 'Personnes') },
    ...(pay ? [{ p: 'scale' as Page, label: t3('سلّم الرواتب والمكافآت', 'Salary scale & stipends', 'Échelle et gratifications') }, { p: 'hours' as Page, label: t3('ساعات العمل', 'Hours worked', 'Heures travaillées') }] : []),
    { p: 'conduct', label: t3('مدونة السلوك', 'Code of conduct', 'Code de conduite') },
    ...(vault ? [{ p: 'log' as Page, label: t3('سجل فتح الوثائق', 'Log of document openings', "Journal d'ouverture des documents") }] : []),
  ];
  return (
    <div className="cty desk">
      <aside className="desk-side">
        <div className="desk-org"><b>{session.organisation}</b><WhoIs profile={session.profile} light /></div>
        <div className="desk-group">
          {items.map((x) => <button key={x.p} className={page === x.p ? 'on' : ''} onClick={() => setPage(x.p)}><span>{x.label}</span>{x.badge ? <i className="cty-badge static">{x.badge}</i> : null}</button>)}
        </div>
        <div className="desk-spacer" />
        <button onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
      </aside>
      <main className="desk-main">
        {err && <div className="alert err">{err}</div>}
        {page === 'home' && <Home {...ctx} />}
        {page === 'people' && <People {...ctx} manage={manage} add={() => setPerson('new')} />}
        {page === 'scale' && <ScalePage s={session} hr={d} />}
        {page === 'hours' && <HoursPage s={session} hr={d} />}
        {page === 'conduct' && <Conduct {...ctx} manage={manage} />}
        {page === 'log' && <Log s={session} d={d} />}
        {person && <PersonModal {...ctx} manage={manage} vault={vault} person={person === 'new' ? null : person} onClose={() => setPerson(null)} />}
      </main>
    </div>
  );
}

const nameOf = (d: HrData, id: number) => d.people.find((p) => p.id === id)?.name ?? '?';

function alertText(a: HrAlert, d: HrData): string {
  const n = nameOf(d, a.person_id);
  switch (a.kind) {
    case 'agreement_missing': return t3(`${n}: لا اتفاقية سارية`, `${n}: no agreement in force`, `${n} : aucun accord en vigueur`);
    case 'agreement_ending': return a.days != null && a.days < 0
      ? t3(`${n}: انتهت الاتفاقية في ${fmtDate(a.date)}`, `${n}: the agreement ended on ${fmtDate(a.date)}`, `${n} : l'accord a pris fin le ${fmtDate(a.date)}`)
      : t3(`${n}: تنتهي الاتفاقية في ${fmtDate(a.date)} (بعد ${a.days} يوماً)`, `${n}: the agreement ends on ${fmtDate(a.date)} (in ${a.days} days)`, `${n} : l'accord se termine le ${fmtDate(a.date)} (dans ${a.days} jours)`);
    case 'doc_expiring': return a.days != null && a.days < 0
      ? t3(`${n}: وثيقة منتهية منذ ${fmtDate(a.date)}`, `${n}: a document expired on ${fmtDate(a.date)}`, `${n} : un document a expiré le ${fmtDate(a.date)}`)
      : t3(`${n}: وثيقة تنتهي في ${fmtDate(a.date)}`, `${n}: a document expires on ${fmtDate(a.date)}`, `${n} : un document expire le ${fmtDate(a.date)}`);
    case 'conduct_unsigned': return t3(`${n}: لم يوقّع آخر نسخة من مدونة السلوك`, `${n}: has not signed the latest code of conduct`, `${n} : n'a pas signé le dernier code de conduite`);
    case 'unsigned_paper': return t3(`${n}: ورقة بلا نسخة موقّعة`, `${n}: a paper without its signed copy`, `${n} : un document sans copie signée`);
  }
}

function Home({ d, open }: Ctx) {
  const active = d.people.filter((p) => p.active).length;
  return (
    <>
      <div className="desk-head"><h1>{t3('الموارد البشرية', 'Human resources', 'Ressources humaines')}</h1></div>
      <div className="desk-cards">
        <div className="cty-card desk-card"><div className="muted small">{t3('أشخاص نشطون', 'Active people', 'Personnes actives')}</div><div className="desk-bal"><b>{active}</b></div></div>
        <div className="cty-card desk-card"><div className="muted small">{t3('ما يحتاج انتباهاً', 'Needs attention', 'À surveiller')}</div><div className="desk-bal"><b>{d.alerts.length}</b></div></div>
      </div>
      <div className="cty-card desk-todo" style={{ marginTop: 12 }}>
        <b>{t3('ما يحتاج انتباهاً', 'What needs attention', 'À surveiller')}</b>
        {d.alerts.length ? (
          <ul>
            {d.alerts.map((a, i) => <li key={i}><button className="link" onClick={() => open(d.people.find((p) => p.id === a.person_id)!)}>{alertText(a, d)}</button></li>)}
          </ul>
        ) : <p className="ok">✓ {t3('كل شيء في موضعه', 'Everything is in order', 'Tout est en ordre')}</p>}
      </div>
    </>
  );
}

function People({ d, open, manage, add }: Ctx & { manage: boolean; add: () => void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const today = todayIso();
  const rows = d.people.filter((p) => (all || p.active) && (!q || `${p.name} ${p.role ?? ''} ${p.centre ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const agreement = (p: HrPerson) => {
    const ag = d.papers.filter((x) => x.person_id === p.id && x.kind === 'agreement' && (!x.end_date || x.end_date >= today) && (!x.start_date || x.start_date <= today));
    return ag.length ? `${t3('حتى', 'until', "jusqu'au")} ${fmtDate(ag.map((x) => x.end_date).filter(Boolean).sort().pop() ?? null)}` : '—';
  };
  return (
    <>
      <div className="desk-head">
        <h1>{t3('الأشخاص', 'People', 'Personnes')}</h1>
        <div className="desk-filters">
          <input placeholder={t3('بحث…', 'Search…', 'Chercher…')} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t3('مع من غادروا', 'Including people who left', 'Avec ceux qui sont partis')}</label>
          {manage && <button className="btn primary" onClick={add}>＋ {t3('شخص', 'Add a person', 'Ajouter')}</button>}
        </div>
      </div>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الاسم', 'Name', 'Nom')}</th><th>{t3('الدور', 'Role', 'Rôle')}</th><th>{t3('المركز', 'Centre', 'Centre')}</th><th>{t3('الاتفاقية', 'Agreement', 'Accord')}</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} onClick={() => open(p)} style={{ cursor: 'pointer', opacity: p.active ? 1 : 0.55 }}>
                <td><b>{p.name}</b></td><td>{p.role ?? ''}</td><td>{p.centre ?? ''}</td><td>{agreement(p)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="muted">{t3('لا أحد بعد.', 'Nobody yet.', 'Personne pour le moment.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PersonModal({ s, d, reload, person, manage, vault, onClose }: Ctx & { person: HrPerson | null; manage: boolean; vault: boolean; onClose: () => void }) {
  const [f, setF] = useState<Partial<HrPerson>>(person ?? { active: 1 });
  const [paper, setPaper] = useState<HrPaper | 'agreement' | 'stipend' | null>(null);
  const [docForm, setDocForm] = useState(false);
  const set = (k: keyof HrPerson) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const saveP = async () => {
    try {
      const r = await s.api.call('hr.person.save', { ...(f as HrPerson), name: f.name ?? '' });
      toast(t3('حُفظ', 'Saved', 'Enregistré'));
      await reload();
      if (!person) onClose();
      else setF({ ...f, id: r.id });
    } catch (e) { fail(e); }
  };
  const papers = person ? d.papers.filter((x) => x.person_id === person.id) : [];
  const docs = person && d.docs ? d.docs.filter((x) => x.person_id === person.id) : [];
  const latest = d.conducts[0];
  const sign = person ? d.signs.find((x) => x.person_id === person.id && x.conduct_id === latest?.id) : null;
  const paperTitle = (p: HrPaper) => p.kind === 'agreement'
    ? `${t3('اتفاقية تطوع', 'Volunteer agreement', 'Accord de bénévolat')} ${fmtDate(p.start_date)} → ${fmtDate(p.end_date)}`
    : `${t3('رسالة مكافأة', 'Stipend letter', 'Lettre de gratification')} · ${p.service ?? ''}`;
  return (
    <Modal title={person?.name ?? t3('شخص جديد', 'New person', 'Nouvelle personne')} onClose={onClose}>
      <div className="grid2">
        <Field label={t3('الاسم', 'Name', 'Nom')}><input value={f.name ?? ''} onChange={set('name')} disabled={!manage} /></Field>
        <Field label={t3('اسم الأب', "Father's name", 'Nom du père')}><input value={f.father_name ?? ''} onChange={set('father_name')} disabled={!manage} /></Field>
        <Field label={t3('الرقم الوطني / رقم الهوية', 'National / ID number', "N° national / pièce d'identité")}><input value={f.national_id ?? ''} onChange={set('national_id')} disabled={!manage} /></Field>
        <Field label={t3('الهاتف', 'Phone', 'Téléphone')}><input value={f.phone ?? ''} onChange={set('phone')} disabled={!manage} /></Field>
        <Field label={t3('مكان الولادة', 'Place of birth', 'Lieu de naissance')}><input value={f.birth_place ?? ''} onChange={set('birth_place')} disabled={!manage} /></Field>
        <Field label={t3('تاريخ الولادة', 'Date of birth', 'Date de naissance')}><input type="date" value={f.birth_date ?? ''} onChange={set('birth_date')} disabled={!manage} /></Field>
        <Field label={t3('العنوان', 'Address', 'Adresse')} className="span2"><input value={f.address ?? ''} onChange={set('address')} disabled={!manage} /></Field>
        <Field label={t3('الدور', 'Role', 'Rôle')}><input value={f.role ?? ''} onChange={set('role')} disabled={!manage} /></Field>
        <Field label={t3('المركز', 'Centre', 'Centre')}><input value={f.centre ?? ''} onChange={set('centre')} disabled={!manage} /></Field>
        <Field label={t3('بدأ في', 'Started', 'Début')}><input type="date" value={f.started ?? ''} onChange={set('started')} disabled={!manage} /></Field>
        <Field label={t3('غادر في (اتركه فارغاً إن كان مستمراً)', 'Left on (empty if still here)', 'Parti le (vide si toujours là)')}><input type="date" value={f.ended ?? ''} onChange={set('ended')} disabled={!manage} /></Field>
        <Field label={t3('ملاحظة', 'Note', 'Note')} className="span2"><input value={f.note ?? ''} onChange={set('note')} disabled={!manage} /></Field>
      </div>
      {manage && <div className="modal-foot"><button className="btn primary" disabled={!f.name?.trim()} onClick={saveP}>{t3('حفظ', 'Save', 'Enregistrer')}</button></div>}

      {person && (
        <>
          <h3 style={{ marginTop: 14 }}>{t3('الاتفاقيات ورسائل المكافأة', 'Agreements and stipend letters', 'Accords et lettres de gratification')}</h3>
          <table className="desk-table">
            <tbody>
              {papers.map((p) => (
                <tr key={p.id}>
                  <td>{paperTitle(p)}{p.amount != null ? ` · ${p.amount} ${p.currency}` : ''}{p.kind === 'stipend' && p.paid_on ? ` · ${fmtDate(p.paid_on)}` : ''}</td>
                  <td className="right nowrap">
                    {p.file_name ? <button className="btn small" onClick={() => openScan(s, 'paper', p.id)}>📎 {t3('النسخة الموقّعة', 'Signed copy', 'Copie signée')}</button> : <span className="desk-alert small">{t3('بلا نسخة موقّعة', 'no signed copy', 'sans copie signée')}</span>}{' '}
                    {manage && <button className="btn small" onClick={() => setPaper(p)}>{t3('تعديل', 'Edit', 'Modifier')}</button>}
                  </td>
                </tr>
              ))}
              {!papers.length && <tr><td className="muted">{t3('لا شيء بعد.', 'Nothing yet.', 'Rien pour le moment.')}</td></tr>}
            </tbody>
          </table>
          {manage && <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button className="btn small" onClick={() => setPaper('agreement')}>＋ {t3('اتفاقية سنوية', 'Yearly agreement', 'Accord annuel')}</button>
            <button className="btn small" onClick={() => setPaper('stipend')}>＋ {t3('رسالة مكافأة', 'Stipend letter', 'Lettre de gratification')}</button>
          </div>}

          <h3 style={{ marginTop: 14 }}>{t3('مدونة السلوك', 'Code of conduct', 'Code de conduite')}</h3>
          {!latest ? <p className="muted small">{t3('لم تُدخل نسخة بعد (صفحة مدونة السلوك).', 'No version entered yet (code of conduct page).', "Aucune version saisie (page Code de conduite).")}</p>
            : sign ? <p className="ok">✓ {t3(`وقّع النسخة ${latest.version} في ${fmtDate(sign.signed_on)}`, `Signed version ${latest.version} on ${fmtDate(sign.signed_on)}`, `A signé la version ${latest.version} le ${fmtDate(sign.signed_on)}`)}</p>
              : <p className="desk-alert">{t3(`لم يوقّع النسخة ${latest.version}`, `Has not signed version ${latest.version}`, `N'a pas signé la version ${latest.version}`)}</p>}

          {vault && (
            <>
              <h3 style={{ marginTop: 14 }}>{t3('خزانة الوثائق', 'Document vault', 'Coffre des documents')}</h3>
              <p className="muted small">{t3('كل فتح لوثيقة يُسجَّل باسمك.', 'Every opening of a document is logged with your name.', 'Chaque ouverture est notée à votre nom.')}</p>
              <table className="desk-table">
                <tbody>
                  {docs.map((x) => (
                    <tr key={x.id}>
                      <td><b>{x.label}</b>{x.expires_on ? ` · ${t3('ينتهي', 'expires', 'expire')} ${fmtDate(x.expires_on)}` : ''}</td>
                      <td className="right nowrap">
                        <button className="btn small" onClick={() => openScan(s, 'doc', x.id)}>👁 {t3('فتح', 'Open', 'Ouvrir')}</button>{' '}
                        <button className="btn small danger" onClick={async () => {
                          if (!(await confirmBox(t3('إزالة هذه الوثيقة؟ يبقى الملف على القرص وفي السجل.', 'Remove this document? The file stays on the disk and in the log.', 'Retirer ce document ? Le fichier reste sur le disque et dans le journal.'), true))) return;
                          try { await s.api.call('hr.vault.delete', { id: x.id }); await reload(); } catch (e) { fail(e); }
                        }}>✕</button>
                      </td>
                    </tr>
                  ))}
                  {!docs.length && <tr><td className="muted">{t3('لا وثائق.', 'No documents.', 'Aucun document.')}</td></tr>}
                </tbody>
              </table>
              <div style={{ marginTop: 6 }}><button className="btn small" onClick={() => setDocForm(true)}>＋ {t3('وثيقة', 'Add a document', 'Ajouter un document')}</button></div>
            </>
          )}
        </>
      )}
      {paper && person && <PaperModal s={s} person={person} paper={typeof paper === 'string' ? null : paper} kind={typeof paper === 'string' ? paper : paper.kind} onClose={() => setPaper(null)} reload={reload} />}
      {docForm && person && <DocModal s={s} person={person} onClose={() => setDocForm(false)} reload={reload} />}
    </Modal>
  );
}

function PaperModal({ s, person, paper, kind, onClose, reload }: { s: Session; person: HrPerson; paper: HrPaper | null; kind: 'agreement' | 'stipend'; onClose: () => void; reload: () => Promise<void> }) {
  const year = new Date().getFullYear();
  const [f, setF] = useState({
    start: paper?.start_date ?? (kind === 'agreement' ? `${year}-01-01` : ''), end: paper?.end_date ?? (kind === 'agreement' ? `${year}-12-31` : ''),
    service: paper?.service ?? '', amount: paper?.amount != null ? String(paper.amount) : '', currency: (paper?.currency ?? 'USD') as 'USD' | 'SYP', paidOn: paper?.paid_on ?? '', note: paper?.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await s.api.call('hr.paper.save', { id: paper?.id ?? null, personId: person.id, kind, start: f.start || null, end: f.end || null, service: f.service || null, amount: f.amount === '' ? null : Number(f.amount), currency: f.currency, paidOn: f.paidOn || null, note: f.note || null });
      toast(t3('حُفظ', 'Saved', 'Enregistré'));
      await reload();
      if (!paper) { /* stay: the signed copy can be attached right away */ }
      onClose();
      return r.id;
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const attach = async () => {
    if (!paper) return;
    const x = await chooseScan(t3('اختر النسخة الموقّعة', 'Choose the signed copy', 'Choisissez la copie signée'));
    if (!x) return;
    try { await s.api.call('hr.file.add', { kind: 'paper', id: paper.id, ...x }); toast(t3('أُرفقت', 'Attached', 'Jointe')); await reload(); } catch (e) { fail(e); }
  };
  return (
    <Modal title={kind === 'agreement' ? t3('اتفاقية تطوع سنوية', 'Yearly volunteer agreement', 'Accord annuel de bénévolat') : t3('رسالة مكافأة لمرة واحدة', 'One-time stipend letter', 'Lettre de gratification unique')} onClose={onClose} narrow>
      <p className="muted small">{person.name}</p>
      {kind === 'agreement' ? (
        <div className="grid2">
          <Field label={t3('من', 'From', 'Du')}><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label={t3('إلى', 'To', 'Au')}><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        </div>
      ) : (
        <>
          <Field label={t3('الخدمة التي تخصها المكافأة', 'The service this stipend is for', 'Le service concerné')}><input value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} /></Field>
          <div className="grid2">
            <Field label={t3('من', 'From', 'Du')}><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
            <Field label={t3('تاريخ الدفع', 'Paid on', 'Payé le')}><input type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
          </div>
        </>
      )}
      <div className="grid2">
        <Field label={kind === 'agreement' ? t3('المكافأة الشهرية المتفق عليها (اختياري)', 'Agreed monthly stipend (optional)', 'Gratification mensuelle convenue (facultatif)') : t3('المبلغ', 'Amount', 'Montant')}><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t3('العملة', 'Currency', 'Devise')}>
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'SYP' })}><option value="USD">USD</option><option value="SYP">SYP</option></select>
        </Field>
      </div>
      <Field label={t3('ملاحظة', 'Note', 'Note')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div className="modal-foot">
        {paper && <button className="btn danger" onClick={async () => {
          if (!(await confirmBox(t3('حذف هذه الورقة؟', 'Delete this paper?', 'Supprimer ce document ?'), true))) return;
          try { await s.api.call('hr.paper.delete', { id: paper.id }); await reload(); onClose(); } catch (e) { fail(e); }
        }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        {paper && <button className="btn" onClick={attach}>📎 {paper.file_name ? t3('استبدال النسخة الموقّعة', 'Replace the signed copy', 'Remplacer la copie signée') : t3('إرفاق النسخة الموقّعة', 'Attach the signed copy', 'Joindre la copie signée')}</button>}
        <button className="btn primary" disabled={busy} onClick={save}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
      {!paper && <p className="muted small">{t3('بعد الحفظ افتح الورقة لإرفاق النسخة الموقّعة.', 'After saving, open the paper to attach the signed copy.', 'Après enregistrement, ouvrez le document pour joindre la copie signée.')}</p>}
    </Modal>
  );
}

function DocModal({ s, person, onClose, reload }: { s: Session; person: HrPerson; onClose: () => void; reload: () => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [exp, setExp] = useState('');
  const [file, setFile] = useState<{ base64: string; mime: string; name: string } | null>(null);
  return (
    <Modal title={t3('وثيقة جديدة', 'New document', 'Nouveau document')} onClose={onClose} narrow>
      <p className="muted small">{person.name}</p>
      <Field label={t3('ما هي (هوية، شهادة…)', 'What it is (ID card, certificate…)', "De quoi il s'agit (pièce d'identité, diplôme…)")}><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      <Field label={t3('تاريخ الانتهاء (إن وُجد)', 'Expiry date (if any)', "Date d'expiration (s'il y en a une)")}><input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></Field>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={async () => setFile(await chooseScan(t3('اختر الملف', 'Choose the file', 'Choisissez le fichier')))}>📎 {t3('اختيار الملف…', 'Choose the file…', 'Choisir le fichier…')}</button>
        {file && <span className="ok">✓ {file.name}</span>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!label.trim() || !file} onClick={async () => {
          try { await s.api.call('hr.vault.add', { personId: person.id, label, expiresOn: exp || null, ...file! }); await reload(); onClose(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

function Conduct({ s, d, reload, manage, open }: Ctx & { manage: boolean }) {
  const [form, setForm] = useState<{ version: string; validFrom: string; note: string } | null>(null);
  const latest = d.conducts[0];
  const active = d.people.filter((p) => p.active);
  const attach = async (id: number) => {
    const x = await chooseScan(t3('اختر النص', 'Choose the text', 'Choisissez le texte'));
    if (!x) return;
    try { await s.api.call('hr.file.add', { kind: 'conduct', id, ...x }); await reload(); } catch (e) { fail(e); }
  };
  const record = async (personId: number, signed: boolean, signId?: number) => {
    try {
      if (signed && signId) await s.api.call('hr.conduct.unsign', { id: signId });
      else await s.api.call('hr.conduct.sign', { conductId: latest!.id, personId, signedOn: todayIso() });
      await reload();
    } catch (e) { fail(e); }
  };
  const attachSign = async (signId: number) => {
    const x = await chooseScan(t3('اختر النسخة الموقّعة', 'Choose the signed copy', 'Choisissez la copie signée'));
    if (!x) return;
    try { await s.api.call('hr.file.add', { kind: 'sign', id: signId, ...x }); await reload(); } catch (e) { fail(e); }
  };
  return (
    <>
      <div className="desk-head"><h1>{t3('مدونة السلوك', 'Code of conduct', 'Code de conduite')}</h1>{manage && <button className="btn primary" onClick={() => setForm({ version: '', validFrom: todayIso(), note: '' })}>＋ {t3('نسخة جديدة', 'New version', 'Nouvelle version')}</button>}</div>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('النسخة', 'Version', 'Version')}</th><th>{t3('سارية من', 'In force from', 'En vigueur depuis')}</th><th>{t3('النص', 'Text', 'Texte')}</th></tr></thead>
          <tbody>
            {d.conducts.map((c) => (
              <tr key={c.id}>
                <td><b>{c.version}</b>{c.note ? ` · ${c.note}` : ''}</td><td>{fmtDate(c.valid_from)}</td>
                <td className="right nowrap">
                  {c.file_name && <button className="btn small" onClick={() => openScan(s, 'conduct', c.id)}>📎 {t3('فتح', 'Open', 'Ouvrir')}</button>}{' '}
                  {manage && <button className="btn small" onClick={() => attach(c.id)}>{c.file_name ? t3('استبدال', 'Replace', 'Remplacer') : t3('إرفاق النص', 'Attach the text', 'Joindre le texte')}</button>}
                </td>
              </tr>
            ))}
            {!d.conducts.length && <tr><td colSpan={3} className="muted">{t3('لم تُدخل نسخة بعد.', 'No version yet.', 'Aucune version pour le moment.')}</td></tr>}
          </tbody>
        </table>
      </div>
      {latest && (
        <div className="cty-card desk-scroll" style={{ marginTop: 12 }}>
          <b>{t3(`من وقّع النسخة ${latest.version}`, `Who signed version ${latest.version}`, `Qui a signé la version ${latest.version}`)}</b>
          <table className="desk-table">
            <tbody>
              {active.map((p) => {
                const sg = d.signs.find((x) => x.person_id === p.id && x.conduct_id === latest.id);
                return (
                  <tr key={p.id}>
                    <td><button className="link" onClick={() => open(p)}>{p.name}</button></td>
                    <td>{sg ? <span className="ok">✓ {fmtDate(sg.signed_on)}</span> : <span className="desk-alert">{t3('لم يوقّع', 'not signed', 'pas signé')}</span>}</td>
                    <td className="right nowrap">
                      {sg?.file_name && <button className="btn small" onClick={() => openScan(s, 'sign', sg.id)}>📎</button>}{' '}
                      {manage && sg && <button className="btn small" onClick={() => attachSign(sg.id)}>{t3('إرفاق النسخة الموقّعة', 'Attach signed copy', 'Joindre la copie signée')}</button>}{' '}
                      {manage && <button className={`btn small ${sg ? '' : 'primary'}`} onClick={() => record(p.id, !!sg, sg?.id)}>{sg ? t3('إلغاء', 'Undo', 'Annuler') : t3('سجّل التوقيع اليوم', 'Record signed today', "Noter signé aujourd'hui")}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <Modal title={t3('نسخة جديدة من المدونة', 'New version of the code', 'Nouvelle version du code')} onClose={() => setForm(null)} narrow>
          <Field label={t3('رقم النسخة', 'Version', 'Version')}><input autoFocus value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
          <Field label={t3('سارية من', 'In force from', 'En vigueur depuis')}><input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} /></Field>
          <Field label={t3('ملاحظة', 'Note', 'Note')}><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <div className="modal-foot">
            <button className="btn" onClick={() => setForm(null)}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
            <button className="btn primary" disabled={!form.version.trim()} onClick={async () => {
              try { await s.api.call('hr.conduct.save', form); await reload(); setForm(null); } catch (e) { fail(e); }
            }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Log({ s, d }: { s: Session; d: HrData }) {
  const [rows, setRows] = useState<{ id: number; at: string; who: string; action: string; what: string; person_id: number | null; detail: string | null }[] | null>(null);
  useEffect(() => { s.api.call('hr.access.list', {}).then(setRows).catch(fail); }, [s]);
  const verb = useMemo(() => ({ open: t3('فتح', 'opened', 'a ouvert'), add: t3('أضاف', 'added', 'a ajouté'), delete: t3('أزال', 'removed', 'a retiré'), edit: t3('عدّل', 'edited', 'a modifié') } as Record<string, string>), []);
  return (
    <>
      <div className="desk-head"><h1>{t3('سجل فتح الوثائق', 'Log of document openings', "Journal d'ouverture des documents")}</h1></div>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('متى', 'When', 'Quand')}</th><th>{t3('من', 'Who', 'Qui')}</th><th>{t3('ماذا', 'What', 'Quoi')}</th><th>{t3('الشخص', 'Person', 'Personne')}</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => <tr key={r.id}><td className="ltr">{r.at.slice(0, 16).replace('T', ' ')}</td><td>{r.who}</td><td>{verb[r.action] ?? r.action} · {r.what}{r.detail ? ` · ${r.detail}` : ''}</td><td>{r.person_id ? nameOf(d, r.person_id) : ''}</td></tr>)}
            {rows && !rows.length && <tr><td colSpan={4} className="muted">{t3('لا شيء بعد.', 'Nothing yet.', 'Rien pour le moment.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
