// A person's page (Fouad, 30 October 2026). Its heading is the heading of their documents: the mark of their centre,
// their names in Arabic and English, the Jesuit logo. Then: who they are (both languages), their agreement and stipend
// (fixed by the agreement, changed from a date when needed), their stipend letters, insurance, documents, code of conduct.
import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '../../state';
import { has } from '../../auth';
import { Field, Modal, confirmBox, fmtDate, toast, todayIso } from '../../ui/kit';
import { saveFile } from '../../platform';
import { t3 } from '../../community/ui/text';
import type { HrAlert, HrCheckItem, HrData, HrPaper, HrPerson } from '../hr';
import type { HrPay, HrPayData } from '../payOps';
import { hourlyFromMonthly, payOn, rateOf, yearlyCost } from '../pay';
import { getLang } from '../../i18n';
import { agreementDoc, stipendDoc } from '../docs';
import { InsurancePage } from './Stage4';
import { TwoNames, centreOf, centreVars, chooseScan, codeOf, fail, headOf, markOf, openScan, positionsFor, seenCentres, centreChoices, mainCentreName, usd, type HrRights } from './common';
import { accountFor, centreLines, lineFor, lineLabel, linesFor } from '../link';
import { TutorSessions } from './Sessions';
import { priceOn, type HrSession, type HrSessionPrice } from '../sessions';
import { GuideLink } from '../../guide/GuideView';

type Section = 'overview' | 'identity' | 'sessions' | 'agreement' | 'letters' | 'insurance' | 'documents' | 'checklist' | 'conduct';

interface P { s: Session; d: HrData; pd: HrPayData | null; reload: () => Promise<void>; manage: boolean; vault: boolean; pay: boolean; /** the HR rights in detail (Fouad, 1 November 2026) */ r: HrRights }

/** the position of the scale for a person's centre: the centre's own, else the one shared by every centre */
export const gradeFor = (pd: HrPayData | null, name: string | null | undefined, code: string | null) => (name ? pd?.grades.find((g) => g.name === name && g.centre === code) ?? pd?.grades.find((g) => g.name === name && g.centre == null) ?? null : null);

/**
 * A person's page (Fouad, 31 October 2026: easier to find one's way): the heading of their documents, then the sections
 * on the side (with a dot where something is missing) and the chosen section beside. It opens on an overview that says
 * what is in place and what is missing, each line leading to its section. A new person is made in steps.
 */
export function PersonPage({ person, preset, kind, onBack, onOpen, onSessions, ...x }: P & { person: HrPerson | null; /** the centre chosen at the top (a new person's centre) */ preset: string | null; /** a new person: staff or tutor */ kind?: 'staff' | 'tutor'; onBack: () => void; onOpen: (id: number) => void; /** the Tutors' sessions page: the one place sessions are recorded */ onSessions: () => void }) {
  const [sec, setSec] = useState<Section>('overview');
  if (!person) return <NewPerson {...x} preset={preset} kind={kind ?? 'staff'} onBack={onBack} onOpen={onOpen} />;
  const { key } = centreOf(x.d, person);
  const alerts = x.d.alerts.filter((a) => a.person_id === person.id);
  const has = (...k: HrAlert['kind'][]) => alerts.some((a) => k.includes(a.kind));
  const docs = (x.d.docs ?? []).filter((q) => q.person_id === person.id);
  const check = checkState(x.d, person);
  const tutor = person.category === 'tutor';
  // a tutor (paid by session) has no agreement, stipend letters, insurance or arrival list
  const nav: [Section, string, string, ReactNode?][] = tutor ? [
    ['overview', '◎', t3('نظرة عامة', 'Overview', "Vue d'ensemble")],
    ['identity', '👤', t3('الهوية', 'Identity', 'Identité')],
    ...(x.r.sessions ? [['sessions', '🎓', t3('الجلسات', 'Sessions', 'Séances')] as [Section, string, string]] : []),
    ...(x.vault ? [['documents', '🪪', t3('الوثائق', 'Documents', 'Documents'), has('doc_expiring') ? <i className="dot" /> : <span className="count">{docs.length || ''}</span>] as [Section, string, string, ReactNode]] : []),
    ['conduct', '🤝', t3('مدونة السلوك', 'Code of conduct', 'Code de conduite'), has('conduct_unsigned') ? <i className="dot" /> : null],
  ] : [
    ['overview', '◎', t3('نظرة عامة', 'Overview', "Vue d'ensemble")],
    ['identity', '👤', t3('الهوية', 'Identity', 'Identité')],
    ['agreement', '📝', t3('الاتفاقية والمكافأة', 'Agreement & stipend', 'Accord et gratification'), has('agreement_missing', 'agreement_ending', 'unsigned_paper') ? <i className="dot" /> : null],
    ['letters', '✉️', t3('رسائل المكافأة', 'Stipend letters', 'Lettres de gratification'), <span className="count">{x.d.papers.filter((q) => q.person_id === person.id && q.kind === 'stipend').length || ''}</span>],
    ...(x.pay ? [['insurance', '🩺', t3('التأمين الصحي', 'Health insurance', 'Assurance maladie'), has('insurance_ending') ? <i className="dot" /> : null] as [Section, string, string, ReactNode]] : []),
    ...(x.vault ? [['documents', '🪪', t3('الوثائق', 'Documents', 'Documents'), has('doc_expiring') ? <i className="dot" /> : <span className="count">{docs.length || ''}</span>] as [Section, string, string, ReactNode]] : []),
    ['checklist', '✅', person.active ? t3('قائمة الوصول', 'Arrival list', "Liste d'arrivée") : t3('قائمة المغادرة', 'Leaving list', 'Liste de départ'), <span className="count">{check.items.length ? `${check.done}/${check.items.length}` : ''}</span>],
    ['conduct', '🤝', t3('مدونة السلوك', 'Code of conduct', 'Code de conduite'), has('conduct_unsigned') ? <i className="dot" /> : null],
  ];
  return (
    <div style={centreVars(key)}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="link" onClick={onBack}>‹ {t3('الأشخاص', 'People', 'Personnes')}</button>
        <GuideLink id="hr-person" />
      </div>
      <div className="hr-sheet" style={{ marginTop: 8, paddingBottom: 12 }}>
        <div className="hr-sheet-top" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <img src={markOf(key)} alt="" />
          <div className="mid">
            <TwoNames p={person} big />
            <div className="sub">{[tutor ? `🎓 ${t3('مدرّب، بالجلسة', 'Tutor, paid by session', 'Animateur, à la séance')}${person.activity ? ` · ${person.activity}` : ''}` : person.role ? (x.d.positionsAr[person.role] ? `${x.d.positionsAr[person.role]} · ${person.role}` : person.role) : null, person.centre].filter(Boolean).join(' · ') || '—'}{!person.active ? ` · ${t3('غادر', 'left', 'parti')} ${fmtDate(person.ended)}` : ''}</div>
          </div>
          <img className="jesuit" src="/brand/jesuits.png" alt="" />
        </div>
      </div>
      <div className="hr-person">
        <nav className="hr-person-nav">
          {nav.map(([k, ico, label, extra]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}><span className="ico">{ico}</span><span className="lbl">{label}</span>{extra}</button>)}
        </nav>
        <div>
          {sec === 'overview' && (tutor ? <TutorOverview {...x} person={person} go={setSec} onSessions={onSessions} /> : <Overview {...x} person={person} go={setSec} />)}
          {sec === 'sessions' && x.r.sessions && <TutorSessions s={x.s} hr={x.d} pd={x.pd} person={person} manage={x.r.sessions} reload={x.reload} onRecord={onSessions} />}
          {sec === 'identity' && <Identity {...x} person={person} onCreated={() => undefined} onDeleted={onBack} />}
          {sec === 'agreement' && <Agreement {...x} person={person} />}
          {sec === 'letters' && <Letters {...x} person={person} />}
          {sec === 'insurance' && <InsurancePage s={x.s} hr={x.d} only={person.id} />}
          {sec === 'documents' && <Vault {...x} person={person} />}
          {sec === 'checklist' && <Checklist {...x} person={person} />}
          {sec === 'conduct' && <Conduct {...x} person={person} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the overview: what is in place, what is missing

/** a tutor's overview: this month's sessions, their usual activity, the code of conduct, the documents */
function TutorOverview({ s, d, reload, manage, r: { sessions: pay, details }, vault, person, go, onSessions }: P & { person: HrPerson; go: (s: Section) => void; onSessions: () => void }) {
  const [leave, setLeave] = useState(false);
  const ym = todayIso().slice(0, 7);
  const [m, setM] = useState<{ sessions: HrSession[]; prices: HrSessionPrice[] } | null>(null);
  useEffect(() => { if (pay) s.api.call('hr.sessions.get', { ym }).then(setM).catch(() => setM({ sessions: [], prices: [] })); }, [s, pay, ym]);
  const mine = m ? m.sessions.filter((x) => x.person_id === person.id) : [];
  const by = { USD: 0, SYP: 0 };
  for (const x of mine) { const p = m ? priceOn(m.prices, x.on_date) : null; if (p) by[p.currency] += p.amount; }
  const latest = d.conducts[0];
  const sign = latest ? d.signs.find((q) => q.person_id === person.id && q.conduct_id === latest.id) : null;
  const docs = (d.docs ?? []).filter((q) => q.person_id === person.id);
  const tile = (sec: Section, label: string, body: ReactNode, sub?: ReactNode, warn?: boolean) => (
    <button className="tile" onClick={() => go(sec)} style={warn ? { borderColor: '#e2b4a6', background: '#FFF8F5' } : undefined}>
      <small>{label}</small>{body}{sub ? <div className="sub">{sub}</div> : null}
    </button>
  );
  return (
    <>
      <div className="hr-over">
        {pay && tile('sessions', t3('جلسات هذا الشهر', 'Sessions this month', 'Séances ce mois-ci'), <b className="big">{m ? mine.length : '…'}</b>,
          [by.USD ? `${usd(by.USD)} $` : '', by.SYP ? `${usd(by.SYP)} SYP` : ''].filter(Boolean).join(' + ') || null)}
        {tile('identity', t3('النشاط المعتاد', 'Usual activity', 'Activité habituelle'), <b>{person.activity ?? '—'}</b>, details ? person.phone ?? null : null)}
        {tile('conduct', t3('مدونة السلوك', 'Code of conduct', 'Code de conduite'),
          !latest ? <b className="muted">—</b> : sign ? <b className="ok">✓ {latest.version}</b> : <b className="desk-alert">{t3('لم يوقّع', 'Not signed', 'Pas signé')} {latest.version}</b>, sign ? fmtDate(sign.signed_on) : null, !!latest && !sign)}
        {vault && tile('documents', t3('الوثائق', 'Documents', 'Documents'), <b className="big">{docs.length}</b>, docs.map((q) => q.label).join(' · ') || t3('لا وثائق', 'none', 'aucun'))}
      </div>
      <div className="hr-panel" style={{ marginTop: 14 }}>
        <b>{t3('ما يمكن عمله', 'What you can do', 'Ce que vous pouvez faire')}</b>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {pay && <button className="btn gold" onClick={onSessions}>🎓 {t3('تسجيل الجلسات', 'Record sessions', 'Noter des séances')}</button>}
          <button className="btn" onClick={() => go('identity')}>👤 {t3('تعديل الهوية', 'Edit the identity', "Modifier l'identité")}</button>
          {manage && person.active ? <button className="btn danger" onClick={() => setLeave(true)}>🚪 {t3('تسجيل المغادرة…', 'Record leaving…', 'Noter le départ…')}</button>
            : manage && <button className="btn" onClick={async () => { try { await s.api.call('hr.person.leave', { id: person.id, ended: null }); await reload(); } catch (e) { fail(e); } }}>↩ {t3('عاد إلى الفريق', 'Back in the team', "De retour dans l'équipe")}</button>}
        </div>
      </div>
      {leave && <LeaveModal s={s} person={person} onClose={() => setLeave(false)} onDone={async () => { setLeave(false); await reload(); }} />}
    </>
  );
}

function Overview({ s, d, pd, reload, manage, pay, vault, person, go, r: { papers, salary } }: P & { person: HrPerson; go: (s: Section) => void }) {
  const today = todayIso();
  const [leave, setLeave] = useState(false);
  const ags = d.papers.filter((q) => q.person_id === person.id && q.kind === 'agreement');
  const cur = ags.find((q) => (!q.start_date || q.start_date <= today) && (!q.end_date || q.end_date >= today));
  const next = ags.filter((q) => q.start_date && q.start_date > today).sort((p, q) => p.start_date!.localeCompare(q.start_date!))[0];
  const now = pd ? payOn(pd, person.id, today) : null;
  const latest = d.conducts[0];
  const sign = latest ? d.signs.find((q) => q.person_id === person.id && q.conduct_id === latest.id) : null;
  const docs = (d.docs ?? []).filter((q) => q.person_id === person.id);
  const check = checkState(d, person);
  const project = accountFor(d.lists, person);
  const tile = (sec: Section, label: string, body: ReactNode, sub?: ReactNode, warn?: boolean) => (
    <button className="tile" onClick={() => go(sec)} style={warn ? { borderColor: '#e2b4a6', background: '#FFF8F5' } : undefined}>
      <small>{label}</small>{body}{sub ? <div className="sub">{sub}</div> : null}
    </button>
  );
  return (
    <>
      <div className="hr-over">
        {tile('agreement', t3('الاتفاقية السارية', 'Agreement in force', 'Accord en vigueur'),
          cur ? <b className="big">{fmtDate(cur.start_date)} → {fmtDate(cur.end_date)}</b> : <b className="desk-alert">{t3('لا اتفاقية سارية', 'No agreement in force', "Pas d'accord en vigueur")}</b>,
          cur ? (cur.file_name ? <span className="ok">✓ {t3('النسخة الموقّعة مرفقة', 'signed copy attached', 'copie signée jointe')}</span> : <span className="desk-alert">{t3('بلا نسخة موقّعة', 'not signed yet', 'pas encore signé')}</span>) : next ? `${t3('تبدأ', 'starts', 'commence')} ${fmtDate(next.start_date)}` : papers ? t3('اضغط لكتابتها', 'click to write it', 'cliquez pour le rédiger') : null,
          !cur && !next)}
        {salary && pd && tile('agreement', t3('المكافأة الشهرية', 'Monthly stipend', 'Gratification mensuelle'),
          now?.syp != null ? <b className="big">{usd(now.syp)} SYP</b> : now?.monthly != null ? <b className="big">{usd(now.monthly)} USD</b> : <b className="muted">—</b>,
          now?.syp != null ? (now.monthly != null ? `≈ ${usd(now.monthly)} USD` : t3('بلا سعر دولار', 'no dollar rate', 'pas de taux')) : now?.weekly ? `${now.weekly} ${t3('س/أسبوع', 'h/week', 'h/sem')}` : null)}
        {pay && tile('identity', t3('من يموّل', 'Who funds it', 'Qui finance'),
          project ? <b>{project}</b> : <b className="desk-alert">{t3('غير ممول', 'Not funded', 'Non financé')}</b>,
          <>{t3('مشروع خط الموازنة', 'the project of the budget line', 'le projet de la ligne budgétaire')}{project ? <><br />{donorsText(d, [{ target: project }])}</> : null}</>, !project)}
        {tile('checklist', person.active ? t3('قائمة الوصول', 'Arrival list', "Liste d'arrivée") : t3('قائمة المغادرة', 'Leaving list', 'Liste de départ'),
          <><b className="big">{check.done}/{check.items.length}</b><div className="hr-bar" style={{ marginTop: 6 }}><i style={{ width: `${check.items.length ? (check.done * 100) / check.items.length : 0}%` }} /></div></>,
          check.items.length > check.done ? check.items.find((i) => !check.ticks.has(i.id))?.[lang() === 'ar' ? 'label_ar' : 'label_en'] ?? '' : t3('كل شيء تمّ', 'all done', 'tout est fait'), check.items.length > check.done && !person.active)}
        {tile('conduct', t3('مدونة السلوك', 'Code of conduct', 'Code de conduite'),
          !latest ? <b className="muted">—</b> : sign ? <b className="ok">✓ {latest.version}</b> : <b className="desk-alert">{t3('لم يوقّع', 'Not signed', 'Pas signé')} {latest.version}</b>, sign ? fmtDate(sign.signed_on) : null, !!latest && !sign)}
        {vault && tile('documents', t3('الوثائق', 'Documents', 'Documents'), <b className="big">{docs.length}</b>, docs.map((q) => q.label).join(' · ') || t3('لا وثائق', 'none', 'aucun'))}
      </div>
      <div className="hr-panel" style={{ marginTop: 14 }}>
        <b>{t3('ما يمكن عمله', 'What you can do', 'Ce que vous pouvez faire')}</b>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {papers && <button className="btn gold" onClick={() => go('agreement')}>📝 {cur || next ? t3('الاتفاقيات', 'Agreements', 'Accords') : t3('كتابة الاتفاقية', 'Write the agreement', "Rédiger l'accord")}</button>}
          <button className="btn" onClick={() => go('identity')}>👤 {t3('تعديل الهوية', 'Edit the identity', "Modifier l'identité")}</button>
          {papers && <button className="btn" onClick={() => go('letters')}>✉️ {t3('رسالة مكافأة', 'A stipend letter', 'Une lettre de gratification')}</button>}
          {manage && person.active ? <button className="btn danger" onClick={() => setLeave(true)}>🚪 {t3('تسجيل المغادرة…', 'Record leaving…', 'Noter le départ…')}</button>
            : manage && <button className="btn" onClick={async () => { try { await s.api.call('hr.person.leave', { id: person.id, ended: null }); await reload(); } catch (e) { fail(e); } }}>↩ {t3('عاد إلى الفريق', 'Back in the team', "De retour dans l'équipe")}</button>}
        </div>
      </div>
      {leave && <LeaveModal s={s} person={person} onClose={() => setLeave(false)} onDone={async () => { setLeave(false); await reload(); go('checklist'); }} />}
    </>
  );
}

const lang = () => getLang();
/** the donors of the accounts of a split (from the accounts' grants) */
function donorsText(d: HrData, split: { target: string }[]) {
  const names = [...new Set(split.flatMap((a) => (d.lists.find((x) => x.kind === 'account' && x.name.toLowerCase() === a.target.toLowerCase())?.donors ?? '').split(' | ').filter(Boolean)))];
  return names.length ? `${t3('المانحون', 'Donors', 'Bailleurs')}: ${names.join(' · ')}` : null;
}

function LeaveModal({ s, person, onClose, onDone }: { s: Session; person: HrPerson; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ ended: todayIso(), note: '' });
  return (
    <Modal title={t3('تسجيل المغادرة', 'Record leaving', 'Noter le départ')} onClose={onClose} narrow>
      <p className="muted small">{t3('يبقى الشخص وتاريخه في البرنامج. بعد التاريخ لا يدخل في الكشوف. تظهر قائمة المغادرة على بطاقته.', 'The person and their history stay in the program. After this date they are not in the payroll. The leaving list shows on their card.', "La personne et son historique restent dans le programme. Après cette date elle n'est plus dans les paies. La liste de départ s'affiche sur sa fiche.")}</p>
      <Field label={t3('آخر يوم', 'Last day', 'Dernier jour')}><input type="date" value={f.ended} onChange={(e) => setF({ ...f, ended: e.target.value })} /></Field>
      <Field label={t3('السبب (اختياري)', 'Why (optional)', 'Pourquoi (facultatif)')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!f.ended} onClick={async () => { try { await s.api.call('hr.person.leave', { id: person.id, ended: f.ended, note: f.note || null }); toast(t3('سُجّلت المغادرة', 'Leaving recorded', 'Départ noté')); await onDone(); } catch (e) { fail(e); } }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- arrival and leaving lists

/** the list that applies to a person (arrival while they are here, leaving once they left) and what is ticked */
function checkState(d: HrData, person: HrPerson) {
  const kind = person.active ? 'arrival' : 'leaving';
  const items = d.checkItems.filter((i) => i.kind === kind && i.active);
  const ticks = new Map(d.checksDone.filter((x) => x.person_id === person.id).map((x) => [x.item_id, x]));
  return { kind, items, ticks, done: items.filter((i) => ticks.has(i.id)).length };
}

function Checklist({ s, d, reload, manage, person }: P & { person: HrPerson }) {
  const [other, setOther] = useState(false);
  const st = checkState(d, person);
  const kind = other ? (st.kind === 'arrival' ? 'leaving' : 'arrival') : st.kind;
  const items = d.checkItems.filter((i) => i.kind === kind && i.active);
  const tick = async (itemId: number, done: boolean) => { try { await s.api.call('hr.check.tick', { personId: person.id, itemId, done }); await reload(); } catch (e) { fail(e); } };
  const label = (i: HrCheckItem) => (lang() === 'ar' ? i.label_ar || i.label_en : i.label_en);
  const n = items.filter((i) => st.ticks.has(i.id)).length;
  return (
    <div className="hr-panel">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <b>{kind === 'arrival' ? t3('عند الوصول', 'When someone arrives', "À l'arrivée") : t3('عند المغادرة', 'When someone leaves', 'Au départ')} · {n}/{items.length}</b>
        <button className="link" onClick={() => setOther(!other)}>{kind === 'arrival' ? t3('قائمة المغادرة ←', 'Leaving list →', 'Liste de départ →') : t3('قائمة الوصول ←', 'Arrival list →', "Liste d'arrivée →")}</button>
      </div>
      <div className="hr-bar" style={{ margin: '8px 0' }}><i style={{ width: `${items.length ? (n * 100) / items.length : 0}%` }} /></div>
      <ul className="hr-check">
        {items.map((i) => {
          const t = st.ticks.get(i.id);
          return (
            <li key={i.id} className={t ? 'done' : ''}>
              <input type="checkbox" checked={!!t} disabled={!manage} onChange={(e) => void tick(i.id, e.target.checked)} />
              <span className="lbl">{label(i)}{lang() !== 'ar' && i.label_ar && i.label_ar !== i.label_en ? <span className="muted small" style={{ display: 'block' }}><bdi dir="rtl">{i.label_ar}</bdi></span> : null}</span>
              {t && <span className="muted small">{fmtDate(t.done_on)}{t.done_by ? ` · ${t.done_by}` : ''}</span>}
            </li>
          );
        })}
        {!items.length && <li className="muted">{t3('القائمة فارغة: تُكتب في «الإعدادات».', 'The list is empty: it is written in Settings.', 'La liste est vide : elle se remplit dans Réglages.')}</li>}
      </ul>
      <p className="muted small">{t3('القائمتان تُعدّلان في «الإعدادات ← الوصول والمغادرة».', 'Both lists are changed in Settings → Arrival & leaving.', 'Les deux listes se modifient dans Réglages → Arrivée et départ.')}</p>
    </div>
  );
}

// ---------------------------------------------------------------- a new person, in steps

function NewPerson({ preset, kind: kind0, onBack, onOpen, ...x }: P & { preset: string | null; kind: 'staff' | 'tutor'; onBack: () => void; onOpen: (id: number) => void }) {
  const [kind, setKind] = useState(kind0);
  const [step, setStep] = useState(1);
  const [made, setMade] = useState<HrPerson | null>(null);
  const [again, setAgain] = useState(0);
  // the newly made person, as the data now holds them
  const person = made ? x.d.people.find((p) => p.id === made.id) ?? made : null;
  const { key } = centreOf(x.d, person ?? (preset ? { centre: mainCentreName(x.d, preset) } : null));
  // a tutor: who only; no agreement and no arrival list (who funds a person: the project of their budget line)
  const tutor = kind === 'tutor';
  const steps = tutor ? [t3('من هو', 'Who', 'Qui')]
    : [t3('من هو', 'Who', 'Qui'), ...(x.r.papers ? [t3('الاتفاقية والمكافأة', 'Agreement & stipend', 'Accord et gratification')] : []), t3('قائمة الوصول', 'Arrival list', "Liste d'arrivée")];
  // the step of the agreement (there only for who may write it)
  const agreeStep = x.r.papers ? 2 : -1;
  const last = steps.length;
  const restart = () => { setMade(null); setStep(1); setAgain(again + 1); window.scrollTo({ top: 0 }); };
  return (
    <div style={centreVars(key)}>
      <button className="link" onClick={onBack}>‹ {t3('الأشخاص', 'People', 'Personnes')}</button>
      <div className="hr-head" style={{ marginTop: 8 }}><div><div className="hr-eyebrow">{tutor ? t3('مدرّب جديد', 'New tutor', 'Nouvel animateur') : t3('شخص جديد', 'New person', 'Nouvelle personne')}</div><h1>{person ? <TwoNames p={person} /> : tutor ? t3('مدرّب جديد', 'New tutor', 'Nouvel animateur') : t3('شخص جديد', 'New person', 'Nouvelle personne')}<GuideLink id="hr-start" /></h1></div></div>
      <div className="hr-steps">{steps.map((t, i) => <span key={t} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>{step > i + 1 ? '✓ ' : `${i + 1}. `}{t}</span>)}</div>
      {step === 1 && <Essentials key={again} {...x} preset={preset} kind={kind} setKind={setKind} onMade={(p) => { setMade(p); setStep(2); }} />}
      {tutor && step > last && person && (
        <div className="hr-panel" style={{ marginTop: 14 }}>
          <p className="ok" style={{ marginTop: 0 }}>✓ {t3('أُضيف', 'Added', 'Ajouté')}: <b>{person.name_ar || person.name}</b> · {t3('تُسجَّل جلساته في «جلسات المدرّبين» أو على بطاقته.', "Their sessions are recorded in Tutors' sessions, or on their card.", 'Ses séances se notent dans Séances des animateurs, ou sur sa fiche.')}</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn gold" onClick={restart}>＋ {t3('إضافة مدرّب آخر', 'Add another tutor', 'Ajouter un autre animateur')}</button>
            <button className="btn primary" onClick={() => onOpen(person.id)}>{t3('فتح بطاقته', 'Open the card', 'Ouvrir la fiche')}</button>
            <button className="btn" onClick={onBack}>{t3('إغلاق', 'Close', 'Fermer')}</button>
          </div>
        </div>
      )}
      {!tutor && step === agreeStep && person && (
        <div className="hr-panel">
          <AgreementForm {...x} person={person} paper={null} firstOne onDone={() => setStep(agreeStep + 1)} onCancel={() => setStep(agreeStep + 1)} cancelLabel={t3('لاحقاً', 'Later', 'Plus tard')} />
        </div>
      )}
      {!tutor && step === last && last > 1 && person && (
        <>
          <Checklist {...x} person={person} />
          <div className="hr-panel" style={{ marginTop: 14 }}>
            <p className="ok" style={{ marginTop: 0 }}>✓ {t3('أُضيف', 'Added', 'Ajouté')}: <b>{person.name_ar || person.name}</b></p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn gold" onClick={restart}>＋ {t3('إضافة شخص آخر', 'Add another person', 'Ajouter une autre personne')}</button>
              <button className="btn primary" onClick={() => onOpen(person.id)}>{t3('فتح بطاقته', 'Open the card', 'Ouvrir la fiche')}</button>
              <button className="btn" onClick={onBack}>{t3('إغلاق', 'Close', 'Fermer')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** the first step: only what is needed to begin (the rest is written later on the card) */
function Essentials({ s, d, reload, preset, kind, setKind, onMade, r: rights }: P & { preset: string | null; kind: 'staff' | 'tutor'; setKind: (k: 'staff' | 'tutor') => void; onMade: (p: HrPerson) => void }) {
  const only = centreChoices(d);
  const presetName = preset ? mainCentreName(d, preset) : only.length === 1 ? mainCentreName(d, only[0].code) : null;
  const [f, setF] = useState<Partial<HrPerson>>({ active: 1, centre: presetName, started: todayIso() });
  const set = (k: keyof HrPerson) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const inp = (k: keyof HrPerson, o: { dir?: 'rtl' | 'ltr'; type?: string; auto?: boolean } = {}) => <input dir={o.dir} type={o.type} autoFocus={o.auto} value={(f[k] as string | null) ?? ''} onChange={set(k)} />;
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await s.api.call('hr.person.save', { ...(f as HrPerson), name: f.first_name ?? f.first_name_ar ?? '', category: kind, role: kind === 'tutor' ? null : f.role });
      await reload();
      onMade({ ...(f as HrPerson), category: kind, id: r.id, name: [f.first_name, f.last_name].filter(Boolean).join(' ') || [f.first_name_ar, f.last_name_ar].filter(Boolean).join(' '), name_ar: [f.first_name_ar, f.last_name_ar].filter(Boolean).join(' ') || null });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const ok = !!(f.first_name?.trim() || f.first_name_ar?.trim()) && (!d.scope || !!f.centre);
  return (
    <div className="hr-panel">
      <div className="hr-kind">
        <button className={kind === 'staff' ? 'on' : ''} onClick={() => setKind('staff')}><b>👥 {t3('فريق العمل', 'Staff', 'Équipe')}</b><span>{t3('باتفاقية سنوية ومكافأة شهرية', 'with a yearly agreement and a monthly stipend', 'avec un accord annuel et une gratification mensuelle')}</span></button>
        <button className={kind === 'tutor' ? 'on' : ''} onClick={() => setKind('tutor')}><b>🎓 {t3('مدرّب', 'Tutor', 'Animateur')}</b><span>{t3('بلا اتفاقية، يُدفع له بالجلسة', 'no agreement, paid by session', 'sans accord, payé à la séance')}</span></button>
      </div>
      <div className="hr-two">
        <div dir="rtl"><h4>العربية</h4><div className="grid2"><Field label="الاسم الأول">{inp('first_name_ar', { dir: 'rtl', auto: true })}</Field><Field label="الكنية">{inp('last_name_ar', { dir: 'rtl' })}</Field></div></div>
        <div dir="ltr"><h4>English</h4><div className="grid2"><Field label="First name">{inp('first_name', { dir: 'ltr' })}</Field><Field label="Last name">{inp('last_name', { dir: 'ltr' })}</Field></div></div>
      </div>
      <div className="grid2" style={{ marginTop: 12 }}>
        <Pick label={t3('المركز', 'Centre', 'Centre')} value={f.centre ?? ''} options={seenCentres(d).map((x) => ({ value: x.name, label: x.name }))} onChange={(v) => setF({ ...f, centre: v || null, role: null })} />
        {kind === 'tutor'
          ? <Field label={t3('النشاط المعتاد (مثلاً المسرح، الإنكليزية)', 'Usual activity (e.g. Theatre, English)', 'Activité habituelle (ex. Théâtre, Anglais)')}>{inp('activity')}</Field>
          : <Pick label={t3('الوظيفة (من سلّم مركزه)', "Position (from their centre's scale)", "Poste (de l'échelle de son centre)")} value={f.role ?? ''} options={positionsFor(d, f.centre).map((p) => ({ value: p, label: d.positionsAr[p] ? `${d.positionsAr[p]} · ${p}` : p }))} onChange={(v) => setF({ ...f, role: v || null })} />}
        {rights.details && <Field label={t3('الهاتف', 'Phone', 'Téléphone')}>{inp('phone', { dir: 'ltr' })}</Field>}
        <Field label={t3('يبدأ في', 'Starts on', 'Commence le')}>{inp('started', { type: 'date' })}</Field>
      </div>
      <p className="muted small">{t3('الباقي (اسم الأب، الرقم الوطني، العنوان…) يُكتب لاحقاً في «الهوية» على بطاقته.', "The rest (father's name, national number, address…) is written later in Identity on the card.", "Le reste (nom du père, numéro national, adresse…) s'écrit plus tard dans Identité sur la fiche.")}</p>
      <div className="modal-foot"><button className="btn primary" disabled={!ok || busy} onClick={save}>{t3('إنشاء ومتابعة', 'Create and continue', 'Créer et continuer')} →</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- who they are, in Arabic and English

function Identity({ s, d, reload, manage, person, preset, onCreated, onDeleted, r: { details } }: P & { person: HrPerson | null; preset?: string | null; onCreated: (id: number, p: Partial<HrPerson>) => void; onDeleted: () => void }) {
  const [f, setF] = useState<Partial<HrPerson>>(person ? { ...person, first_name: person.first_name ?? (person.name_ar ? null : person.name) } : { active: 1, centre: preset ?? null });
  const set = (k: keyof HrPerson) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const inp = (k: keyof HrPerson, o: { dir?: 'rtl' | 'ltr'; type?: string } = {}) => <input dir={o.dir} type={o.type} value={(f[k] as string | null) ?? ''} onChange={set(k)} disabled={!manage} />;
  const list = (_kind: 'centre') => seenCentres(d).map((x) => ({ value: x.name, label: x.name }));
  const save = async () => {
    try {
      const r = await s.api.call('hr.person.save', { ...(f as HrPerson), name: f.first_name ?? f.first_name_ar ?? '' });
      toast(t3('حُفظ', 'Saved', 'Enregistré'));
      await reload();
      if (!person) onCreated(r.id, { ...f, name: [f.first_name, f.last_name].filter(Boolean).join(' '), name_ar: [f.first_name_ar, f.last_name_ar].filter(Boolean).join(' ') || null });
    } catch (e) { fail(e); }
  };
  return (
    <div className="hr-panel">
      <div className="hr-two">
        <div dir="rtl">
          <h4>العربية</h4>
          <div className="grid2">
            <Field label="الاسم الأول">{inp('first_name_ar', { dir: 'rtl' })}</Field>
            <Field label="الكنية">{inp('last_name_ar', { dir: 'rtl' })}</Field>
            <Field label="اسم الأب">{inp('father_name_ar', { dir: 'rtl' })}</Field>
            {details && <Field label="مكان الولادة">{inp('birth_place', { dir: 'rtl' })}</Field>}
            {details && <Field label="العنوان (الموطن المختار)" className="span2">{inp('address_ar', { dir: 'rtl' })}</Field>}
          </div>
        </div>
        <div dir="ltr">
          <h4>English</h4>
          <div className="grid2">
            <Field label="First name">{inp('first_name', { dir: 'ltr' })}</Field>
            <Field label="Last name">{inp('last_name', { dir: 'ltr' })}</Field>
            <Field label="Father's name">{inp('father_name', { dir: 'ltr' })}</Field>
            {details && <Field label="Phone">{inp('phone', { dir: 'ltr' })}</Field>}
            {details && <Field label="Address (chosen domicile)" className="span2">{inp('address', { dir: 'ltr' })}</Field>}
          </div>
        </div>
      </div>
      <div className="grid2" style={{ marginTop: 14 }}>
        {details && <Field label={t3('الرقم الوطني', 'National number', 'Numéro national')}>{inp('national_id', { dir: 'ltr' })}</Field>}
        {details && <Field label={t3('تاريخ الولادة', 'Date of birth', 'Date de naissance')}>{inp('birth_date', { type: 'date' })}</Field>}
        <Pick label={t3('المركز (شعاره على الوثائق)', 'Centre (its mark on the documents)', 'Centre (son logo sur les documents)')} value={f.centre ?? ''} options={list('centre')} onChange={(v) => setF({ ...f, centre: v, budget_line: null, account: null })} disabled={!manage} />
        <Field label={t3('الفئة', 'Category', 'Catégorie')}><select value={f.category ?? 'staff'} disabled={!manage} onChange={(e) => setF({ ...f, category: e.target.value as 'staff' | 'tutor', role: e.target.value === 'tutor' ? null : f.role })}><option value="staff">👥 {t3('فريق العمل (باتفاقية)', 'Staff (with an agreement)', 'Équipe (avec accord)')}</option><option value="tutor">🎓 {t3('مدرّب (بالجلسة)', 'Tutor (paid by session)', 'Animateur (à la séance)')}</option></select></Field>
        {f.category === 'tutor'
          ? <Field label={t3('النشاط المعتاد', 'Usual activity', 'Activité habituelle')}>{inp('activity')}</Field>
          : <Pick label={t3('الوظيفة (من سلّم الرواتب)', 'Position (from the scale)', "Poste (de l'échelle)")} value={f.role ?? ''} options={positionsFor(d, f.centre).map((p) => ({ value: p, label: d.positionsAr[p] ? `${d.positionsAr[p]} · ${p}` : p }))} onChange={(v) => setF({ ...f, role: v })} disabled={!manage} />}
        <GoesTo d={d} f={f} setF={setF} manage={manage} />
        <Field label={t3('بدأ في', 'Started', 'Début')}>{inp('started', { type: 'date' })}</Field>
        <Field label={t3('غادر في (فارغ إن كان مستمراً)', 'Left on (empty if still here)', 'Parti le (vide si toujours là)')}>{inp('ended', { type: 'date' })}</Field>
        <Field label={t3('ملاحظة', 'Note', 'Note')} className="span2">{inp('note')}</Field>
      </div>
      {manage && <div className="modal-foot">{person && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={async () => {
        if (!(await confirmBox(t3(`حذف ${person.name_ar || person.name} نهائياً، مع اتفاقياته ومكافآته وتأمينه ووثائقه؟`, `Delete ${person.name || person.name_ar} for good, with their agreements, stipend, insurance and documents?`, `Supprimer définitivement ${person.name || person.name_ar}, avec ses accords, gratifications, assurance et documents ?`), true))) return;
        try { await s.api.call('hr.person.delete', { id: person.id }); toast(t3('حُذف', 'Deleted', 'Supprimé')); await reload(); onDeleted(); } catch (e) { fail(e); }
      }}>{t3('حذف الشخص', 'Delete the person', 'Supprimer la personne')}</button>}<button className="btn primary" disabled={!(f.first_name?.trim() || f.first_name_ar?.trim())} onClick={save}>{person ? t3('حفظ', 'Save', 'Enregistrer') : t3('إنشاء', 'Create', 'Créer')}</button></div>}
    </div>
  );
}

/**
 * Where the stipend goes in the centre's accounts, found by the program: the line of the person's position in their
 * centre's salary heading (changed here only for an exception), and the project of that line in the centre's budget
 * (Fouad, 2026-11-01: a salary follows its line; there is no other choice and no split).
 */
function GoesTo({ d, f, setF, manage }: { d: HrData; f: Partial<HrPerson>; setF: (f: Partial<HrPerson>) => void; manage: boolean }) {
  const [open, setOpen] = useState(false);
  const line = lineFor(d.lists, f as HrPerson);
  const acc = accountFor(d.lists, f as HrPerson);
  const own = !line.guessed && !!line.line;
  const centreName = f.centre ?? '';
  const tutor = f.category === 'tutor';
  return (
    <div className="span2 hr-panel" style={{ background: '#FBF7EE', padding: '10px 14px' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span>
          <span className="muted small">{tutor ? t3('تذهب الجلسات في الحسابات إلى', 'In the accounts, the sessions go to', 'Dans la comptabilité, les séances vont à') : t3('تذهب المكافأة في الحسابات إلى', 'In the accounts, the stipend goes to', 'Dans la comptabilité, la gratification va à')}: </span>
          {!f.centre ? <span className="desk-alert">{t3('اختر المركز', 'choose the centre', 'choisissez le centre')}</span>
            : line.line ? <b>{lineLabel(line.line)} · {acc ?? <span className="desk-alert">{t3('غير ممول', 'Not funded', 'Non financé')}</span>}</b>
            : tutor ? <span className="desk-alert">⚠ {t3('اختر خط المدرّب (الورشات، الإنكليزية، الأكاديمي…)', 'choose the tutor line (workshops, English, academic…)', "choisissez la ligne de l'animateur (ateliers, anglais, académique…)")}</span>
            : <span className="desk-alert">⚠ {t3(`لا خط لهذه الوظيفة في موازنة ${centreName}: أضفه في الحسابات، أو اختر خطاً`, `no line for this position in the budget of ${centreName}: add it in the accounts, or choose one`, `pas de ligne pour ce poste dans le budget de ${centreName} : ajoutez-la en comptabilité, ou choisissez-en une`)}</span>}
          {line.line && <span className="muted small"> {own ? t3('(مختار باليد)', '(chosen by hand)', '(choisi à la main)') : t3('(تلقائياً)', '(automatic)', '(automatique)')}</span>}
        </span>
        {manage && f.centre && <button type="button" className="link" onClick={() => setOpen(!open)}>{open ? t3('إغلاق', 'close', 'fermer') : t3('تغيير (استثناء)', 'change (exception)', 'changer (exception)')}</button>}
      </div>
      {tutor && !!f.centre && !centreLines(d.lists, f).some((x) => x.tutor) && (
        <p className="desk-alert small" style={{ margin: '6px 0 0' }}>⚠ {t3('لم تُحدَّد خطوط المدرّبين لهذا المركز، فتظهر كل الخطوط. حدّدها في الإعدادات ← المركز ← خطوط المدرّبين.', 'No tutor lines are ticked for this centre, so every line is shown. Tick them in Settings → the centre → Tutor lines.', "Aucune ligne d'animateurs n'est cochée pour ce centre : toutes les lignes sont montrées. Cochez-les dans Réglages → le centre → Lignes des animateurs.")}</p>
      )}
      {(open || (!line.line && !!f.centre && manage)) && (
        <div className="grid2" style={{ marginTop: 8 }}>
          <Pick label={t3('خط الموازنة', 'Budget line', 'Ligne budgétaire')} value={f.budget_line ?? ''} options={[...linesFor(d.lists, f), ...(f.budget_line && !linesFor(d.lists, f).some((l) => lineLabel(l) === f.budget_line) && line.line ? [line.line] : [])].map((l) => ({ value: lineLabel(l), label: [lineLabel(l), l.heading].filter(Boolean).join(' · ') }))} onChange={(v) => setF({ ...f, budget_line: v || null })} empty={tutor ? t3('— اختر —', '— choose —', '— choisir —') : t3('— تلقائياً حسب الوظيفة —', '— automatic, from the position —', '— automatique, selon le poste —')} />
        </div>
      )}
    </div>
  );
}

/** A choice from a stored list. An old value no longer in the list is kept as an option, so nothing is lost. */
export function Pick({ label, value, options, onChange, disabled, empty }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean; /** what an empty choice means */ empty?: string }) {
  const stray = !!value && !options.some((o) => o.value === value);
  const all = stray ? [{ value, label: `⚠ ${value}` }, ...options] : options;
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{empty ?? (all.length ? '—' : t3('— القائمة فارغة: املأها من «القوائم» —', '— the list is empty: fill it in "Lists" —', '— liste vide : remplissez-la dans « Listes » —'))}</option>
        {all.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {stray && options.length > 0 && <div className="desk-alert small">{t3('⚠ ليس في قائمة هذا المركز: اختر من جديد', "⚠ Not in this centre's list: choose again", '⚠ Pas dans la liste de ce centre : choisissez à nouveau')}</div>}
    </Field>
  );
}

// ---------------------------------------------------------------- the agreement fixes the stipend; it can change from a date

async function makeDoc(d: HrData, pd: HrPayData | null, person: HrPerson, p: HrPaper) {
  try {
    const ctx = { person, head: await headOf(d, person), maxWeekly: pd?.settings.maxWeekly ?? 40 };
    const bytes = p.kind === 'agreement' ? await agreementDoc(ctx, p) : await stipendDoc(ctx, p);
    const who = (person.name || person.name_ar || 'person').replace(/[^\w؀-ۿ]+/g, '_');
    await saveFile(`${p.kind === 'agreement' ? 'Volunteer-agreement' : 'Stipend-letter'}_${who}_${p.start_date ?? p.paid_on ?? ''}.docx`, ['docx'], bytes, 'Word');
  } catch (e) { fail(e); }
}

function Agreement({ s, d, pd, reload, r: { papers: manage, salary: pay }, person }: P & { person: HrPerson }) {
  const [form, setForm] = useState<HrPaper | 'new' | null>(null);
  const [change, setChange] = useState(false);
  const today = todayIso();
  const rate = pd ? rateOf(pd.settings, codeOf(d, person)) : 0;
  const agreements = d.papers.filter((x) => x.person_id === person.id && x.kind === 'agreement');
  const sup = has(s.profile, 'hr.approve');
  const now = pd ? payOn(pd, person.id, today) : null;
  const lines = pd ? pd.pays.filter((x) => x.person_id === person.id).sort((a, b) => a.valid_from.localeCompare(b.valid_from) || a.id - b.id) : [];
  const fromAgreement = (l: HrPay) => (l.paper_id ? agreements.find((a) => a.id === l.paper_id) : undefined);
  const amountOf = (l: HrPay) => l.monthly_usd ?? (l.monthly_syp != null ? (rate > 0 ? Math.round((l.monthly_syp / rate) * 100) / 100 : null) : pd?.grades.find((g) => g.id === l.grade_id)?.monthly_usd ?? null);
  return (
    <>
      {pay && pd && (
        <div className="hr-panel" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <b>{t3('المكافأة اليوم', 'The stipend today', "La gratification aujourd'hui")}</b>
            <span className="row" style={{ gap: 6 }}>
              {manage && now && <button className="btn" onClick={() => setChange(true)}>{t3('تغيير المكافأة ابتداءً من تاريخ…', 'Change the stipend from a date…', 'Changer la gratification à partir d’une date…')}</button>}
            </span>
          </div>
          {now?.syp != null && now.needsRate && <p className="desk-alert">{t3('المكافأة بالليرة: اكتب سعر الدولار في «سلّم الرواتب ← الإعدادات» لتظهر بالدولار.', 'The stipend is in pounds: write the dollar rate in "Salary scale → Settings" to see it in dollars.', 'La gratification est en livres : écrivez le taux du dollar dans « Échelle → Réglages » pour la voir en dollars.')}</p>}
          {now && (now.monthly != null || now.syp != null) ? (
            <div className="hr-stats">
              <div><small>{t3('شهرياً', 'Monthly', 'Mensuel')}</small>{now.syp != null ? <><span className="hr-big">{usd(now.syp)}</span> SYP<div className="muted small">{now.monthly != null ? `≈ ${usd(now.monthly)} USD · ${t3('بسعر', 'at', 'au taux')} ${usd(rate)}` : '—'}</div></> : <><span className="hr-big">{usd(now.monthly)}</span> USD</>}</div>
              <div><small>{t3('ساعات الأسبوع', 'Hours a week', 'Heures par semaine')}</small><span className="hr-big">{now.weekly ?? '—'}</span>{now.weekly && now.weekly > (pd.settings.maxWeekly) ? <span className="desk-alert"> ⚠ &gt; {pd.settings.maxWeekly}</span> : null}</div>
              {sup && <div><small>{t3('تكلفة الساعة (للرئيس)', 'Cost of an hour (Superior)', "Coût d'une heure (Supérieur)")}</small><span className="hr-big">{usd(now.hourly)}</span> USD</div>}
              <div><small>{t3(`سنوياً (×${pd.settings.paymentsPerYear})`, `Yearly (×${pd.settings.paymentsPerYear})`, `Annuel (×${pd.settings.paymentsPerYear})`)}</small>{now.syp != null ? <><span className="hr-big">{usd(now.syp * pd.settings.paymentsPerYear)}</span> SYP<div className="muted small">{now.monthly != null ? `≈ ${usd(yearlyCost(now.monthly, pd.settings.paymentsPerYear))} USD` : '—'}</div></> : <><span className="hr-big">{usd(yearlyCost(now.monthly!, pd.settings.paymentsPerYear))}</span> USD</>}</div>
            </div>
          ) : <p className="muted">{t3('لا مكافأة بعد: تُحدَّد في الاتفاقية.', 'No stipend yet: it is fixed in the agreement.', "Pas encore de gratification : elle est fixée dans l'accord.")}</p>}
          {lines.length > 0 && (
            <ul className="hr-timeline">
              {lines.map((l) => {
                const ag = fromAgreement(l);
                const amount = amountOf(l);
                return (
                  <li key={l.id} className={now?.pay.id === l.id ? 'now' : ''}>
                    <div className="when">{fmtDate(l.valid_from)} · {ag ? t3('الاتفاقية', 'the agreement', "l'accord") : `${t3('تغيير', 'change', 'changement')}${l.note ? ` — ${l.note}` : ''}`}</div>
                    <b>{l.monthly_syp != null ? `${usd(l.monthly_syp)} SYP` : `${usd(amount)} USD`}</b>{l.monthly_syp != null && amount != null ? ` ≈ ${usd(amount)} USD` : ''} · {l.weekly_hours ?? '—'} {t3('س/أسبوع', 'h/week', 'h/sem')}{sup ? <> · {t3('الساعة', 'hour', 'heure')} {usd(amount != null ? hourlyFromMonthly(amount, l.weekly_hours) : null)}</> : null}
                    {manage && !ag && <button className="link" style={{ marginInlineStart: 10 }} onClick={async () => { if (await confirmBox(t3('حذف هذا التغيير؟', 'Delete this change?', 'Supprimer ce changement ?'), true)) { try { await s.api.call('hr.pay.delete', { id: l.id }); await reload(); } catch (e) { fail(e); } } }}>✕</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div className="hr-panel">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <b>{t3('اتفاقيات التطوع السنوية', 'Yearly volunteer agreements', 'Accords annuels de bénévolat')}</b>
          {manage && <button className="btn gold" onClick={() => setForm('new')}>＋ {t3('اتفاقية جديدة', 'New agreement', 'Nouvel accord')}</button>}
        </div>
        <table className="desk-table" style={{ marginTop: 8 }}>
          <tbody>
            {agreements.map((p) => (
              <tr key={p.id}>
                <td><b>{fmtDate(p.start_date)} → {fmtDate(p.end_date)}</b><div className="muted small">{[p.position, p.amount != null ? `${usd(p.amount)} ${p.currency}` : null, p.weekly_hours ? `${p.weekly_hours} ${t3('س/أسبوع', 'h/week', 'h/sem')}` : null].filter(Boolean).join(' · ')}</div></td>
                <td className="right nowrap">
                  {pay && <button className="btn small" onClick={() => makeDoc(d, pd, person, p)}>📄 Word</button>}{' '}
                  {p.file_name ? (pay ? <button className="btn small" onClick={() => openScan(s, 'paper', p.id)}>📎 {t3('الموقّعة', 'Signed', 'Signé')}</button> : <span className="ok small">✓ {t3('موقّعة', 'signed', 'signé')}</span>) : <span className="desk-alert small">{t3('بلا نسخة موقّعة', 'not signed yet', 'pas encore signé')}</span>}{' '}
                  {manage && <button className="btn small" onClick={() => setForm(p)}>{t3('تعديل', 'Edit', 'Modifier')}</button>}
                </td>
              </tr>
            ))}
            {!agreements.length && <tr><td className="muted">{t3('لا اتفاقية بعد.', 'No agreement yet.', "Pas encore d'accord.")}</td></tr>}
          </tbody>
        </table>
      </div>
      {form && <AgreementModal s={s} d={d} pd={pd} person={person} paper={form === 'new' ? null : form} onClose={() => setForm(null)} reload={reload} />}
      {change && pd && now && <ChangeModal s={s} pd={pd} person={person} now={now} rate={rate} onClose={() => setChange(false)} reload={reload} />}
    </>
  );
}

function AgreementModal({ onClose, ...x }: { s: Session; d: HrData; pd: HrPayData | null; person: HrPerson; paper: HrPaper | null; onClose: () => void; reload: () => Promise<void> }) {
  return (
    <Modal title={t3('اتفاقية تطوع سنوية', 'Yearly volunteer agreement', 'Accord annuel de bénévolat')} onClose={onClose}>
      <AgreementForm {...x} onDone={onClose} onCancel={onClose} />
    </Modal>
  );
}

/**
 * The agreement's form (in a window on the card, or as the second step of a new person). The stipend is fixed here; the
 * reference of the person's centre's scale is suggested, and the difference with it is shown.
 */
function AgreementForm({ s, d, pd, person, paper, reload, onDone, onCancel, cancelLabel, firstOne }: { s: Session; d: HrData; pd: HrPayData | null; person: HrPerson; paper: HrPaper | null; reload: () => Promise<void>; onDone: () => void; onCancel: () => void; cancelLabel?: string; /** the first agreement of a new person: from their start date to the end of that year */ firstOne?: boolean }) {
  // a new agreement starts on the 1st of January of next year by default (they are yearly), from the person's position
  const y = new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0);
  const code = codeOf(d, person);
  const last = d.papers.filter((x) => x.person_id === person.id && x.kind === 'agreement')[0];
  const refOf = (pos: string) => gradeFor(pd, pos, code)?.monthly_usd ?? null;
  const pos0 = paper?.position ?? last?.position ?? person.role ?? '';
  const start0 = firstOne && person.started ? person.started : `${y}-01-01`;
  const [f, setF] = useState({
    start: paper?.start_date ?? start0, end: paper?.end_date ?? `${start0.slice(0, 4)}-12-31`, position: pos0,
    amount: paper?.amount != null ? String(paper.amount) : last?.amount != null ? String(last.amount) : refOf(pos0) != null ? String(refOf(pos0)) : '',
    currency: (paper?.currency ?? last?.currency ?? 'USD') as 'USD' | 'SYP', weekly: paper?.weekly_hours != null ? String(paper.weekly_hours) : last?.weekly_hours != null ? String(last.weekly_hours) : '', note: paper?.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const rate = rateOf(pd?.settings, code);
  const asUsd = f.amount === '' ? null : f.currency === 'USD' ? Number(f.amount) : rate > 0 ? Math.round((Number(f.amount) / rate) * 100) / 100 : null;
  const hourly = asUsd != null ? hourlyFromMonthly(asUsd, Number(f.weekly) || null) : null;
  const ref = refOf(f.position);
  const sup = has(s.profile, 'hr.approve');
  const grades = positionsFor(d, person.centre).map((name) => gradeFor(pd, name, code) ?? { name, monthly_usd: null });
  const save = async () => {
    setBusy(true);
    try {
      await s.api.call('hr.paper.save', { id: paper?.id ?? null, personId: person.id, kind: 'agreement', start: f.start || null, end: f.end || null, amount: f.amount === '' ? null : Number(f.amount), currency: f.currency, position: f.position || null, weeklyHours: f.weekly === '' ? null : Number(f.weekly), note: f.note || null });
      toast(t3('حُفظ', 'Saved', 'Enregistré'));
      await reload();
      onDone();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>{t3('المكافأة تُحدَّد هنا في بداية الاتفاقية. إن تغيّرت خلال السنة: «تغيير المكافأة ابتداءً من تاريخ».', 'The stipend is fixed here, at the beginning of the agreement. If it changes during the year: "Change the stipend from a date".', "La gratification est fixée ici, au début de l'accord. Si elle change dans l'année : « Changer la gratification à partir d'une date ».")}</p>
      <div className="grid2">
        <Field label={t3('من', 'From', 'Du')}><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label={t3('إلى', 'To', 'Au')}><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        <Pick label={t3('الوظيفة (سلّم المركز)', "Position (the centre's scale)", "Poste (l'échelle du centre)")} value={f.position} options={grades.map((g) => ({ value: g.name, label: `${d.positionsAr[g.name] ? `${d.positionsAr[g.name]} · ` : ''}${g.name}${g.monthly_usd != null ? ` · ${usd(g.monthly_usd)} USD` : ''}` }))} onChange={(v) => setF({ ...f, position: v, amount: f.amount === '' || Number(f.amount) === refOf(f.position) ? String(refOf(v) ?? '') : f.amount })} />
        <Field label={t3('ساعات الأسبوع المتفق عليها', 'Agreed hours a week', 'Heures par semaine convenues')}><input inputMode="decimal" value={f.weekly} onChange={(e) => setF({ ...f, weekly: e.target.value })} /></Field>
        <Field label={t3('المكافأة الشهرية', 'Monthly stipend', 'Gratification mensuelle')}><div className="row" style={{ gap: 6 }}><input style={{ flex: 1 }} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'SYP' })}><option value="USD">USD</option><option value="SYP">SYP</option></select></div></Field>
        <Field label={t3('ملاحظة', 'Note', 'Note')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {f.currency === 'SYP' && f.amount !== '' && <p className="muted">{asUsd != null ? <>≈ <b>{usd(asUsd)} USD</b> {t3('بسعر', 'at', 'au taux')} {usd(rate)}</> : t3('اكتب سعر الدولار في «سلّم الرواتب ← الإعدادات» لترى المعادل بالدولار.', 'Write the dollar rate in Salary scale, Settings, to see the equivalent in dollars.', 'Écrivez le taux du dollar dans Échelle, Réglages, pour voir l équivalent en dollars.')}</p>}
      {ref != null && asUsd != null && Math.abs(asUsd - ref) > 0.005 && <p className={`small hr-diff ${asUsd > ref ? 'up' : 'down'}`}>{t3('مقارنة بالسلّم', 'Compared with the scale', "Par rapport à l'échelle")} ({usd(ref)} USD): <b>{asUsd > ref ? '+' : ''}{usd(Math.round((asUsd - ref) * 100) / 100)} USD</b> ({asUsd > ref ? '+' : ''}{Math.round(((asUsd - ref) * 100) / ref)}%)</p>}
      {sup && hourly != null && <p className="ok">{t3('تكلفة الساعة', 'Cost of an hour', "Coût d'une heure")}: <b>{usd(hourly)} USD</b> <span className="muted small">({t3('شهري × 12 ÷ (ساعات الأسبوع × 52)', 'monthly × 12 ÷ (hours a week × 52)', 'mensuel × 12 ÷ (heures par semaine × 52)')})</span></p>}
      {Number(f.weekly) > (pd?.settings.maxWeekly ?? 40) && <p className="desk-alert">⚠ {t3('ساعات أكثر من حد الاتفاقية', "Hours above the agreement's maximum", "Heures au-dessus du maximum de l'accord")} ({pd?.settings.maxWeekly ?? 40})</p>}
      <div className="modal-foot">
        {paper && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={async () => { if (await confirmBox(t3('حذف هذه الاتفاقية؟', 'Delete this agreement?', 'Supprimer cet accord ?'), true)) { try { await s.api.call('hr.paper.delete', { id: paper.id }); await reload(); onDone(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        {paper && <button className="btn" onClick={async () => { const x = await chooseScan(t3('اختر النسخة الموقّعة', 'Choose the signed copy', 'Choisissez la copie signée')); if (x) { try { await s.api.call('hr.file.add', { kind: 'paper', id: paper.id, ...x }); toast(t3('أُرفقت', 'Attached', 'Jointe')); await reload(); } catch (e) { fail(e); } } }}>📎 {paper.file_name ? t3('استبدال النسخة الموقّعة', 'Replace the signed copy', 'Remplacer la copie signée') : t3('إرفاق النسخة الموقّعة', 'Attach the signed copy', 'Joindre la copie signée')}</button>}
        <button className="btn" onClick={onCancel}>{cancelLabel ?? t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!f.start || busy} onClick={save}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </>
  );
}

function ChangeModal({ s, pd, person, now, rate, onClose, reload }: { s: Session; pd: HrPayData; person: HrPerson; now: NonNullable<ReturnType<typeof payOn>>; rate: number; onClose: () => void; reload: () => Promise<void> }) {
  const [f, setF] = useState({ from: todayIso().slice(0, 8) + '01', amount: now.syp != null ? String(now.syp) : now.monthly != null ? String(now.monthly) : '', currency: (now.syp != null ? 'SYP' : 'USD') as 'USD' | 'SYP', weekly: now.weekly != null ? String(now.weekly) : '', note: '' });
  const asUsd = f.amount === '' ? null : f.currency === 'USD' ? Number(f.amount) : rate > 0 ? Math.round((Number(f.amount) / rate) * 100) / 100 : null;
  const hourly = asUsd != null ? hourlyFromMonthly(asUsd, Number(f.weekly) || null) : null;
  const sup = has(s.profile, 'hr.approve');
  return (
    <Modal title={t3('تغيير المكافأة ابتداءً من تاريخ', 'Change the stipend from a date', "Changer la gratification à partir d'une date")} onClose={onClose} narrow>
      <p className="muted small">{t3('تبقى المكافأة السابقة في التاريخ. الكشوف التالية تأخذ الجديدة.', 'The earlier stipend stays in the history. The next payroll runs take the new one.', "L'ancienne gratification reste dans l'historique. Les paies suivantes prennent la nouvelle.")}</p>
      <Field label={t3('ابتداءً من', 'From', 'À partir du')}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
      <div className="grid2">
        <Field label={t3('المكافأة الشهرية', 'Monthly stipend', 'Gratification mensuelle')}><div className="row" style={{ gap: 6 }}><input style={{ flex: 1 }} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'SYP' })}><option value="USD">USD</option><option value="SYP">SYP</option></select></div></Field>
        <Field label={t3('ساعات الأسبوع', 'Hours a week', 'Heures par semaine')}><input inputMode="decimal" value={f.weekly} onChange={(e) => setF({ ...f, weekly: e.target.value })} /></Field>
      </div>
      <Field label={t3('السبب', 'Why', 'Pourquoi')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      {f.currency === 'SYP' && asUsd != null && <p className="muted">≈ <b>{usd(asUsd)} USD</b> {t3('بسعر', 'at', 'au taux')} {usd(rate)}</p>}
      {sup && hourly != null && <p className="ok">{t3('تكلفة الساعة', 'Cost of an hour', "Coût d'une heure")}: <b>{usd(hourly)} USD</b></p>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!f.from || f.amount === ''} onClick={async () => {
          try { await s.api.call('hr.pay.save', { personId: person.id, validFrom: f.from, gradeId: now.pay.grade_id, ...(f.currency === 'SYP' ? { monthlySyp: Number(f.amount) } : { monthlyUsd: Number(f.amount) }), weeklyHours: f.weekly === '' ? null : Number(f.weekly), note: f.note || null }); toast(t3('حُفظ', 'Saved', 'Enregistré')); await reload(); onClose(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
      <p className="muted small">{pd.settings.paymentsPerYear}× · {t3('الدفعة الثالثة عشرة بدل الضمان', 'the 13th is instead of social security', 'le 13e remplace la sécurité sociale')}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- one-time stipend letters

function Letters({ s, d, pd, reload, r: { papers: manage, salary: pay }, person }: P & { person: HrPerson }) {
  const [form, setForm] = useState<HrPaper | 'new' | null>(null);
  const letters = d.papers.filter((x) => x.person_id === person.id && x.kind === 'stipend');
  return (
    <div className="hr-panel">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <b>{t3('رسائل المكافأة لمرة واحدة', 'One-time stipend letters', 'Lettres de gratification uniques')}</b>
        {manage && <button className="btn gold" onClick={() => setForm('new')}>＋ {t3('رسالة مكافأة', 'Stipend letter', 'Lettre de gratification')}</button>}
      </div>
      <table className="desk-table" style={{ marginTop: 8 }}>
        <tbody>
          {letters.map((p) => (
            <tr key={p.id}>
              <td><b>{p.service}</b><div className="muted small">{[p.amount != null ? `${usd(p.amount)} ${p.currency}` : null, p.paid_on ? `${t3('دُفعت', 'paid', 'payée')} ${fmtDate(p.paid_on)}` : null].filter(Boolean).join(' · ')}</div></td>
              <td className="right nowrap">
                {pay && <button className="btn small" onClick={() => makeDoc(d, pd, person, p)}>📄 Word</button>}{' '}
                {p.file_name && pay ? <button className="btn small" onClick={() => openScan(s, 'paper', p.id)}>📎</button> : null}{' '}
                {manage && <button className="btn small" onClick={() => setForm(p)}>{t3('تعديل', 'Edit', 'Modifier')}</button>}
              </td>
            </tr>
          ))}
          {!letters.length && <tr><td className="muted">{t3('لا شيء بعد.', 'Nothing yet.', 'Rien pour le moment.')}</td></tr>}
        </tbody>
      </table>
      {form && <LetterModal s={s} person={person} paper={form === 'new' ? null : form} onClose={() => setForm(null)} reload={reload} />}
    </div>
  );
}

function LetterModal({ s, person, paper, onClose, reload }: { s: Session; person: HrPerson; paper: HrPaper | null; onClose: () => void; reload: () => Promise<void> }) {
  const [f, setF] = useState({ service: paper?.service ?? '', start: paper?.start_date ?? todayIso(), paidOn: paper?.paid_on ?? '', amount: paper?.amount != null ? String(paper.amount) : '', currency: (paper?.currency ?? 'USD') as 'USD' | 'SYP', note: paper?.note ?? '' });
  return (
    <Modal title={t3('رسالة مكافأة لمرة واحدة', 'One-time stipend letter', 'Lettre de gratification unique')} onClose={onClose} narrow>
      <Field label={t3('الخدمة التي تخصها المكافأة', 'The service this stipend is for', 'Le service concerné')}><input value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} /></Field>
      <div className="grid2">
        <Field label={t3('من', 'From', 'Du')}><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label={t3('تاريخ الدفع', 'Paid on', 'Payé le')}><input type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
        <Field label={t3('المبلغ', 'Amount', 'Montant')}><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t3('العملة', 'Currency', 'Devise')}><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'SYP' })}><option value="USD">USD</option><option value="SYP">SYP</option></select></Field>
      </div>
      <div className="modal-foot">
        {paper && <button className="btn danger" onClick={async () => { if (await confirmBox(t3('حذف؟', 'Delete?', 'Supprimer ?'), true)) { try { await s.api.call('hr.paper.delete', { id: paper.id }); await reload(); onClose(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        {paper && <button className="btn" onClick={async () => { const x = await chooseScan(t3('اختر النسخة الموقّعة', 'Choose the signed copy', 'Choisissez la copie signée')); if (x) { try { await s.api.call('hr.file.add', { kind: 'paper', id: paper.id, ...x }); await reload(); } catch (e) { fail(e); } } }}>📎</button>}
        <button className="btn primary" disabled={!f.service.trim()} onClick={async () => {
          try { await s.api.call('hr.paper.save', { id: paper?.id ?? null, personId: person.id, kind: 'stipend', service: f.service, start: f.start || null, paidOn: f.paidOn || null, amount: f.amount === '' ? null : Number(f.amount), currency: f.currency, note: f.note || null }); await reload(); onClose(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- the vault and the code of conduct

function Vault({ s, d, reload, person }: P & { person: HrPerson }) {
  const [form, setForm] = useState(false);
  const [label, setLabel] = useState('');
  const [exp, setExp] = useState('');
  const [file, setFile] = useState<{ base64: string; mime: string; name: string } | null>(null);
  const docs = (d.docs ?? []).filter((x) => x.person_id === person.id);
  return (
    <div className="hr-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}><b>{t3('خزانة الوثائق', 'Document vault', 'Coffre des documents')}</b><button className="btn gold" onClick={() => setForm(true)}>＋ {t3('وثيقة', 'Add a document', 'Ajouter un document')}</button></div>
      <p className="muted small">{t3('كل فتح لوثيقة يُسجَّل باسمك.', 'Every opening of a document is logged with your name.', 'Chaque ouverture est notée à votre nom.')}</p>
      <table className="desk-table"><tbody>
        {docs.map((x) => (
          <tr key={x.id}>
            <td><b>{x.label}</b>{x.expires_on ? <span className="muted small"> · {t3('ينتهي', 'expires', 'expire')} {fmtDate(x.expires_on)}</span> : null}</td>
            <td className="right nowrap"><button className="btn small" onClick={() => openScan(s, 'doc', x.id)}>👁 {t3('فتح', 'Open', 'Ouvrir')}</button>{' '}<button className="btn small danger" onClick={async () => { if (await confirmBox(t3('إزالة هذه الوثيقة؟ يبقى الملف على القرص وفي السجل.', 'Remove this document? The file stays on the disk and in the log.', 'Retirer ce document ? Le fichier reste sur le disque et dans le journal.'), true)) { try { await s.api.call('hr.vault.delete', { id: x.id }); await reload(); } catch (e) { fail(e); } } }}>✕</button></td>
          </tr>
        ))}
        {!docs.length && <tr><td className="muted">{t3('لا وثائق.', 'No documents.', 'Aucun document.')}</td></tr>}
      </tbody></table>
      {form && (
        <Modal title={t3('وثيقة جديدة', 'New document', 'Nouveau document')} onClose={() => setForm(false)} narrow>
          <Field label={t3('ما هي (هوية، شهادة…)', 'What it is (ID card, certificate…)', "De quoi il s'agit (pièce d'identité, diplôme…)")}><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label={t3('تاريخ الانتهاء (إن وُجد)', 'Expiry date (if any)', "Date d'expiration (s'il y en a une)")}><input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></Field>
          <div className="row" style={{ gap: 8 }}><button className="btn" onClick={async () => setFile(await chooseScan(t3('اختر الملف', 'Choose the file', 'Choisissez le fichier')))}>📎 {t3('اختيار الملف…', 'Choose the file…', 'Choisir le fichier…')}</button>{file && <span className="ok">✓ {file.name}</span>}</div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setForm(false)}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
            <button className="btn primary" disabled={!label.trim() || !file} onClick={async () => { try { await s.api.call('hr.vault.add', { personId: person.id, label, expiresOn: exp || null, ...file! }); setForm(false); setLabel(''); setExp(''); setFile(null); await reload(); } catch (e) { fail(e); } }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Conduct({ s, d, reload, manage, person }: P & { person: HrPerson }) {
  const latest = d.conducts[0];
  const sign = latest ? d.signs.find((x) => x.person_id === person.id && x.conduct_id === latest.id) : null;
  return (
    <div className="hr-panel">
      <b>{t3('مدونة السلوك', 'Code of conduct', 'Code de conduite')}</b>
      {!latest ? <p className="muted">{t3('لم تُدخل نسخة بعد (صفحة مدونة السلوك).', 'No version entered yet (code of conduct page).', 'Aucune version saisie (page Code de conduite).')}</p>
        : sign ? <p className="ok">✓ {t3(`وقّع النسخة ${latest.version} في ${fmtDate(sign.signed_on)}`, `Signed version ${latest.version} on ${fmtDate(sign.signed_on)}`, `A signé la version ${latest.version} le ${fmtDate(sign.signed_on)}`)}{sign.file_name ? <> · <button className="link" onClick={() => openScan(s, 'sign', sign.id)}>📎</button></> : null}</p>
          : (
            <p className="desk-alert">{t3(`لم يوقّع النسخة ${latest.version}`, `Has not signed version ${latest.version}`, `N'a pas signé la version ${latest.version}`)}
              {manage && <button className="btn small primary" style={{ marginInlineStart: 10 }} onClick={async () => { try { await s.api.call('hr.conduct.sign', { conductId: latest.id, personId: person.id, signedOn: todayIso() }); await reload(); } catch (e) { fail(e); } }}>{t3('سجّل التوقيع اليوم', 'Record signed today', "Noter signé aujourd'hui")}</button>}
            </p>
          )}
      {sign && manage && <button className="btn small" onClick={async () => { const x = await chooseScan(t3('اختر النسخة الموقّعة', 'Choose the signed copy', 'Choisissez la copie signée')); if (x) { try { await s.api.call('hr.file.add', { kind: 'sign', id: sign.id, ...x }); await reload(); } catch (e) { fail(e); } } }}>📎 {t3('إرفاق النسخة الموقّعة', 'Attach the signed copy', 'Joindre la copie signée')}</button>}
    </div>
  );
}
