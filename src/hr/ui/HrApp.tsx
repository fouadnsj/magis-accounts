// The HR screens (Fouad, 30 October 2026), in the MAGIS design: an ink side with the gold line, the Jesuit logo and the
// MAGIS sun; the people in the colour and with the mark of their centre (Jaramana gold, Aleppo navy, Homs maroon); a
// person's page headed like their documents. One HR database serves the three centres.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { has } from '../../auth';
import type { Session } from '../../state';
import { CENTRES, type CentreKey } from '../../brand';
import { getLang } from '../../i18n';
import { Field, Modal, fmtDate, todayIso, errText } from '../../ui/kit';
import { WhoIs } from '../../community/ui/CtyApp';
import { t3 } from '../../community/ui/text';
import type { HrAlert, HrData, HrPerson } from '../hr';
import type { HrPayData } from '../payOps';
import { payOn } from '../pay';
import { ScalePage } from './Pay';
import { RunsPage } from './Runs';
import { DonorsPage, InsurancePage } from './Stage4';
import { ListsPage } from './Lists';
import { PersonPage } from './Person';
import { BudgetListPage } from './BudgetList';
import { ReportsPage } from './Reports';
import { TwoNames, centreOf, centreVars, chooseScan, fail, markOf, openScan, usd } from './common';
import './hr.css';

type Page = 'home' | 'people' | 'person' | 'scale' | 'runs' | 'budget' | 'insurance' | 'donors' | 'reports' | 'lists' | 'conduct' | 'log';

interface Ctx { s: Session; d: HrData; reload: () => Promise<void>; open: (p: HrPerson) => void }

const KEYS: CentreKey[] = ['jaramana', 'aleppo', 'homs'];
const centreName = (k: CentreKey) => { const n = CENTRES[k].name; const l = getLang(); return l === 'ar' ? n.ar : l === 'en' || l === 'fr' ? n.en : `${n.ar} · ${n.en}`; };

export function HrApp({ session, onLogout }: { session: Session; onLogout: () => void; onLang?: () => void }) {
  const [d, setD] = useState<HrData | null>(null);
  const [pd, setPd] = useState<HrPayData | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [err, setErr] = useState<string | null>(null);
  const [personId, setPersonId] = useState<number | 'new' | null>(null);
  const manage = has(session.profile, 'hr.manage');
  const vault = has(session.profile, 'hr.vault');
  const pay = has(session.profile, 'hr.pay');
  const sup = pay && has(session.profile, 'hr.approve');
  const reload = useCallback(async () => {
    try {
      setD(await session.api.call('hr.data', {}));
      if (has(session.profile, 'hr.pay')) setPd(await session.api.call('hr.pay.data', {}));
      setErr(null);
    } catch (e) { setErr(errText(e)); }
  }, [session]);
  useEffect(() => { void reload(); }, [reload]);
  if (!d) return <div className="hr"><div /><main className="hr-main">{err ? <div className="alert err">{err}</div> : '…'}</main></div>;
  const open = (p: HrPerson) => { setPersonId(p.id); setPage('person'); };
  const ctx: Ctx = { s: session, d, reload, open };
  const go = (p: Page) => { setPage(p); setPersonId(null); };
  const item = (p: Page, label: string, badge?: number) => <button key={p} className={page === p || (p === 'people' && page === 'person') ? 'on' : ''} onClick={() => go(p)}><span>{label}</span>{badge ? <i className="hr-badge">{badge}</i> : null}</button>;
  const person = typeof personId === 'number' ? d.people.find((p) => p.id === personId) ?? null : null;
  return (
    <div className="hr">
      <nav className="hr-side">
        <div className="hr-side-top">
          <div className="tile"><img src="/brand/jesuits.png" alt="" /></div>
          <div><b>{t3('الموارد البشرية', 'Human resources', 'Ressources humaines')}</b><span>{session.organisation}</span></div>
        </div>
        <div style={{ padding: '0 10px 8px' }}><WhoIs profile={session.profile} light /></div>
        {item('home', t3('البداية', 'Home', 'Accueil'), d.alerts.length)}
        {item('people', t3('الأشخاص', 'People', 'Personnes'))}
        {pay && <div className="group">{t3('المكافآت', 'Stipends', 'Gratifications')}</div>}
        {pay && item('scale', t3('سلّم الرواتب', 'Salary scale', 'Échelle'))}
        {pay && item('runs', t3('كشوف الدفع', 'Payroll', 'Paies'))}
        {pay && item('budget', t3('القائمة للموازنة', 'List for the budget', 'Liste pour le budget'))}
        {pay && item('insurance', t3('التأمين الصحي', 'Health insurance', 'Assurance maladie'))}
        {pay && item('donors', t3('حسب المانح', 'By donor', 'Par bailleur'))}
        {sup && item('reports', t3('التقارير', 'Reports', 'Rapports'))}
        <div className="group">{t3('أخرى', 'More', 'Plus')}</div>
        {item('conduct', t3('مدونة السلوك', 'Code of conduct', 'Code de conduite'))}
        {manage && item('lists', t3('القوائم والمراكز', 'Lists & centres', 'Listes et centres'))}
        {vault && item('log', t3('سجل فتح الوثائق', 'Document log', 'Journal des documents'))}
        <div className="spacer" />
        <div className="sun"><img src="/brand/magis-sun.png" alt="" /></div>
        <button onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
      </nav>
      <main className="hr-main">
        {err && <div className="alert err">{err}</div>}
        {page === 'home' && <Home {...ctx} pd={pd} go={go} />}
        {page === 'people' && <People {...ctx} pd={pd} manage={manage} add={() => { setPersonId('new'); setPage('person'); }} />}
        {page === 'person' && (personId === 'new' || person) && (
          <PersonPage key={personId ?? 'x'} s={session} d={d} pd={pd} reload={reload} manage={manage} vault={vault} pay={pay} person={person} onBack={() => go('people')} onCreated={(id) => setPersonId(id)} />
        )}
        {page === 'scale' && pd && <ScalePage s={session} hr={d} pd={pd} reload={reload} open={open} />}
        {page === 'runs' && <RunsPage s={session} hr={d} />}
        {page === 'budget' && <BudgetListPage s={session} hr={d} />}
        {page === 'insurance' && <InsurancePage s={session} hr={d} />}
        {page === 'donors' && <DonorsPage s={session} />}
        {page === 'reports' && pd && sup && <ReportsPage s={session} hr={d} pd={pd} open={open} />}
        {page === 'conduct' && <Conduct {...ctx} manage={manage} />}
        {page === 'lists' && <ListsPage s={session} d={d} reload={reload} />}
        {page === 'log' && <Log s={session} d={d} />}
      </main>
    </div>
  );
}

const nameOf = (d: HrData, id: number) => { const p = d.people.find((x) => x.id === id); return p ? p.name_ar || p.name : '?'; };

function Home({ d, pd, open, go }: Ctx & { pd: HrPayData | null; go: (p: Page) => void }) {
  const active = d.people.filter((p) => p.active);
  const today = todayIso();
  const by = (k: CentreKey) => active.filter((p) => centreOf(d, p).key === k);
  const monthly = (ps: HrPerson[]) => (pd ? ps.reduce((a, p) => a + (payOn(pd, p.id, today)?.monthly ?? 0), 0) : null);
  const hour = new Date().getHours();
  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('الرهبانية اليسوعية · مراكز ماجيس', 'Society of Jesus · MAGIS centres', 'Compagnie de Jésus · centres MAGIS')}</div><h1>{hour < 12 ? t3('صباح الخير', 'Good morning', 'Bonjour') : t3('مساء الخير', 'Good evening', 'Bonsoir')}</h1></div>
      </div>
      <div className="hr-people" style={{ marginBottom: 16 }}>
        {KEYS.map((k) => (
          <button key={k} className="hr-card" style={centreVars(k)} onClick={() => go('people')}>
            <div className="mark"><img src={markOf(k)} alt="" /></div>
            <div className="body"><b>{centreName(k)}</b><div className="meta">{by(k).length} {t3('شخصاً', 'people', 'personnes')}</div></div>
            {pd && <div className="amount">{usd(monthly(by(k)))} $</div>}
          </button>
        ))}
      </div>
      <div className="hr-panel">
        <b>{t3('ما يحتاج انتباهاً', 'What needs attention', 'À surveiller')}</b>
        {d.alerts.length ? <Attention d={d} open={open} /> : <p className="ok">✓ {t3('كل شيء في موضعه', 'Everything is in order', 'Tout est en ordre')}</p>}
      </div>
    </>
  );
}

/** The alerts grouped by kind: one line each, with how many people; the names inside. Urgent ones first. */
function Attention({ d, open }: { d: HrData; open: (p: HrPerson) => void }) {
  const [shown, setShown] = useState<string | null>(null);
  const ORDER: [HrAlert['kind'], string, string][] = [
    ['agreement_ending', '⏳', t3('اتفاقيات تنتهي قريباً', 'Agreements ending soon', 'Accords qui finissent bientôt')],
    ['insurance_ending', '🩺', t3('تأمين صحي ينتهي قريباً', 'Health insurance ending soon', 'Assurances qui finissent bientôt')],
    ['doc_expiring', '🪪', t3('وثائق تنتهي صلاحيتها', 'Documents expiring', 'Documents qui expirent')],
    ['agreement_missing', '📝', t3('بلا اتفاقية سارية', 'No agreement in force', 'Sans accord en vigueur')],
    ['unsigned_paper', '✍️', t3('أوراق بلا نسخة موقّعة', 'Papers without their signed copy', 'Documents sans copie signée')],
    ['conduct_unsigned', '🤝', t3('لم يوقّعوا مدونة السلوك', 'Have not signed the code of conduct', "N'ont pas signé le code de conduite")],
  ];
  return (
    <div className="hr-attn">
      {ORDER.map(([kind, icon, label]) => {
        const xs = d.alerts.filter((a) => a.kind === kind);
        if (!xs.length) return null;
        const people = [...new Set(xs.map((a) => a.person_id))];
        return (
          <div key={kind} className={`hr-attn-row ${shown === kind ? 'open' : ''}`}>
            <button onClick={() => setShown(shown === kind ? null : kind)}><span className="ico">{icon}</span><span className="lbl">{label}</span><span className="n">{people.length}</span><span className="chev">{shown === kind ? '▾' : '▸'}</span></button>
            {shown === kind && (
              <ul>{xs.map((a, i) => <li key={i}><button className="link" onClick={() => open(d.people.find((p) => p.id === a.person_id)!)}>{alertText(a, d)}</button></li>)}</ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function People({ d, pd, open, manage, add }: Ctx & { pd: HrPayData | null; manage: boolean; add: () => void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [only, setOnly] = useState<CentreKey | null>(null);
  const today = todayIso();
  const rows = useMemo(() => d.people.filter((p) => (all || p.active) && (!only || centreOf(d, p).key === only)
    && (!q || `${p.name} ${p.name_ar ?? ''} ${p.role ?? ''} ${p.centre ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [d, all, only, q]);
  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('المتطوعون والفريق', 'Volunteers and team', 'Bénévoles et équipe')}</div><h1>{t3('الأشخاص', 'People', 'Personnes')}</h1></div>
        <div className="desk-filters">
          <input placeholder={t3('بحث…', 'Search…', 'Chercher…')} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t3('مع من غادروا', 'With those who left', 'Avec ceux partis')}</label>
        </div>
      </div>
      <div className="hr-chips">
        <button className={only === null ? 'on' : ''} onClick={() => setOnly(null)}><img src="/brand/magis-sun.png" alt="" />{t3('كل المراكز', 'All centres', 'Tous les centres')}</button>
        {KEYS.map((k) => <button key={k} className={only === k ? 'on' : ''} style={centreVars(k)} onClick={() => setOnly(k)}><img src={markOf(k)} alt="" />{centreName(k)}</button>)}
      </div>
      <div className="hr-people">
        {rows.map((p) => {
          const { key } = centreOf(d, p);
          const now = pd ? payOn(pd, p.id, today) : null;
          return (
            <button key={p.id} className={`hr-card ${p.active ? '' : 'off'}`} style={centreVars(key)} onClick={() => open(p)}>
              <div className="mark"><img src={markOf(key)} alt="" /></div>
              <div className="body"><TwoNames p={p} /><div className="meta">{p.role ? (d.positionsAr[p.role] ? `${d.positionsAr[p.role]} · ${p.role}` : p.role) : '—'}</div></div>
              {now?.syp != null ? <div className="amount" style={{ textAlign: 'end' }}>{usd(now.syp)} SYP<div className="meta" style={{ fontWeight: 400 }}>{now.monthly != null ? `≈ ${usd(now.monthly)} $` : t3('بلا سعر دولار', 'no dollar rate', 'pas de taux')}</div></div> : now?.monthly != null && <div className="amount">{usd(now.monthly)} $</div>}
            </button>
          );
        })}
        {manage && <button className="hr-card new" onClick={add}>＋ {t3('شخص جديد', 'New person', 'Nouvelle personne')}</button>}
      </div>
      {!rows.length && !manage && <p className="muted">{t3('لا أحد.', 'Nobody.', 'Personne.')}</p>}
    </>
  );
}

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
    case 'insurance_ending': return a.days != null && a.days < 0
      ? t3(`${n}: انتهى التأمين الصحي في ${fmtDate(a.date)}`, `${n}: the health insurance ended on ${fmtDate(a.date)}`, `${n} : l'assurance maladie a pris fin le ${fmtDate(a.date)}`)
      : t3(`${n}: ينتهي التأمين الصحي في ${fmtDate(a.date)} (بعد ${a.days} يوماً)`, `${n}: the health insurance ends on ${fmtDate(a.date)} (in ${a.days} days)`, `${n} : l'assurance maladie se termine le ${fmtDate(a.date)} (dans ${a.days} jours)`);
    case 'unsigned_paper': return t3(`${n}: ورقة بلا نسخة موقّعة`, `${n}: a paper without its signed copy`, `${n} : un document sans copie signée`);
  }
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
      <div className="hr-head"><div><div className="hr-eyebrow">{t3('ما نلتزم به معاً', 'What we commit to together', 'Ce à quoi nous nous engageons ensemble')}</div><h1>{t3('مدونة السلوك', 'Code of conduct', 'Code de conduite')}</h1></div>{manage && <button className="btn primary" onClick={() => setForm({ version: '', validFrom: todayIso(), note: '' })}>＋ {t3('نسخة جديدة', 'New version', 'Nouvelle version')}</button>}</div>
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
                    <td><button className="link" onClick={() => open(p)}><TwoNames p={p} /></button></td>
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
