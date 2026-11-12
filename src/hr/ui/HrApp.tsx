// The HR screens (Fouad, 30 October 2026), in the MAGIS design: an ink side with the gold line, the Jesuit logo and the
// MAGIS sun; the people in the colour and with the mark of their centre (Jaramana gold, Aleppo navy, Homs maroon); a
// person's page headed like their documents. One HR database serves the three centres.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { has } from '../../auth';
import type { Session } from '../../state';
import type { CentreKey } from '../../brand';
import { getLang } from '../../i18n';
import { Field, Modal, fmtDate, todayIso, errText, toast } from '../../ui/kit';
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
import { SessionsPage } from './Sessions';
import { rightsOf, SortTh, TwoNames, centreLabel, centreOf, centreVars, chooseScan, codeOf, fail, markOf, openScan, centreChoices, sortRows, usd, useSort } from './common';
import './hr.css';
import { GuideCtx, GuideLink, GuideSun, GuideView } from '../../guide/GuideView';
import { HR_GUIDE } from '../../guide/content';
import { accountFor, lineFor } from '../link';

type Page = 'home' | 'people' | 'person' | 'scale' | 'runs' | 'sessions' | 'budget' | 'insurance' | 'donors' | 'reports' | 'lists' | 'conduct' | 'log' | 'guide';

interface Ctx { s: Session; d: HrData; reload: () => Promise<void>; open: (p: HrPerson) => void }


/** What a user sees when one centre is chosen at the top: its people and what is theirs. */
function onlyCentre(d: HrData, code: string | null): HrData {
  if (!code) return d;
  const people = d.people.filter((p) => codeOf(d, p) === code);
  const ids = new Set(people.map((p) => p.id));
  const mine = <T extends { person_id: number }>(xs: T[]) => xs.filter((x) => ids.has(x.person_id));
  return { ...d, people, papers: mine(d.papers), signs: mine(d.signs), docs: d.docs ? mine(d.docs) : null, alerts: mine(d.alerts), checksDone: mine(d.checksDone) };
}

export function HrApp({ session, onLogout, onDatabases, onAllDatabases }: { session: Session; onLogout: () => void; onLang?: () => void; /** the other databases of this person (server) */ onDatabases?: () => void; /** the first choice: MAGIS centres, Jesuit communities, HR */ onAllDatabases?: () => void }) {
  const [all, setAll] = useState<HrData | null>(null);
  const [pd, setPd] = useState<HrPayData | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [guideSection, setGuideSection] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [personId, setPersonId] = useState<number | 'new' | null>(null);
  // a new person: staff (with an agreement) or tutor (paid by session)
  const [newKind, setNewKind] = useState<'staff' | 'tutor'>('staff');
  // the centre chosen at the top (null = every centre the user sees); kept for the next visit
  const [cx, setCx] = useState<string | null>(() => { try { return localStorage.getItem('hr-centre') || null; } catch { return null; } });
  // the rights in detail (Fouad, 1 November 2026): each part of the menu for who may use it
  const rt = rightsOf(session.profile);
  const { manage, vault, pay } = rt;
  const reload = useCallback(async () => {
    try {
      setAll(await session.api.call('hr.data', {}));
      if (has(session.profile, 'hr.salary')) setPd(await session.api.call('hr.pay.data', {}));
      setErr(null);
    } catch (e) { setErr(errText(e)); }
  }, [session]);
  useEffect(() => { void reload(); }, [reload]);
  // on the server: the centres whose budget or lists changed since the last copy are copied again, by themselves
  useEffect(() => {
    if (session.mode !== 'server' || !manage) return;
    fetch('/api/hr/refresh-lists', { method: 'POST', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { refreshed: [] }))
      .then((j: { refreshed: string[] }) => {
        if (!j.refreshed?.length) return;
        toast(t3(`نُسخت القوائم من جديد (تغيّرت الموازنة): ${j.refreshed.join('، ')}`, `The lists were copied again (the budget changed): ${j.refreshed.join(', ')}`, `Les listes ont été recopiées (le budget a changé) : ${j.refreshed.join(', ')}`));
        void reload();
      })
      .catch(() => undefined);
  }, [session, manage, reload]);
  if (!all) return <div className="hr"><div /><main className="hr-main">{err ? <div className="alert err">{err}</div> : '…'}</main></div>;
  // the centres this user sees; one only: it is always that one, and there is nothing to choose
  const mineCentres = centreChoices(all);
  const single = all.scope?.length === 1 ? all.scope[0] : null;
  const centre = single ?? (cx && mineCentres.some((x) => x.code === cx) ? cx : null);
  const choose = (c: string | null) => { setCx(c); try { localStorage.setItem('hr-centre', c ?? ''); } catch { /* private window */ } };
  const d = onlyCentre(all, centre);
  const open = (p: HrPerson) => { setPersonId(p.id); setPage('person'); };
  const ctx: Ctx = { s: session, d, reload, open };
  const go = (p: Page) => { setPage(p); setPersonId(null); };
  const item = (p: Page, label: React.ReactNode, badge?: number) => <button key={p} className={page === p || (p === 'people' && page === 'person') ? 'on' : ''} onClick={() => go(p)}><span>{label}</span>{badge ? <i className="hr-badge">{badge}</i> : null}</button>;
  const person = typeof personId === 'number' ? all.people.find((p) => p.id === personId) ?? null : null;
  return (
    <GuideCtx.Provider value={(id) => { setGuideSection(id); go('guide'); }}>
    <div className="hr">
      <nav className="hr-side">
        <div className="hr-side-top">
          <div className="tile"><img src="/brand/jesuits.png" alt="" /></div>
          <div><b>{t3('الموارد البشرية', 'Human resources', 'Ressources humaines')}</b><span>{single ? centreLabel(all, single) : session.organisation}</span></div>
        </div>
        <div style={{ padding: '0 10px 8px' }}><WhoIs profile={session.profile} light /></div>
        {item('home', t3('البداية', 'Home', 'Accueil'), d.alerts.length)}
        {item('people', t3('الأشخاص', 'People', 'Personnes'))}
        {(rt.salary || rt.sessions || rt.runs) && <div className="group">{t3('المكافآت', 'Stipends', 'Gratifications')}</div>}
        {rt.salary && item('scale', t3('سلّم الرواتب', 'Salary scale', 'Échelle'))}
        {rt.sessions && item('sessions', t3('جلسات المدرّبين', "Tutors' sessions", 'Séances des animateurs'))}
        {rt.runs && item('runs', t3('كشوف الدفع', 'Payroll', 'Paies'))}
        {rt.donors && item('donors', t3('المانحون والتمويل', 'Donors & funding', 'Bailleurs et financement'))}
        {pay && item('insurance', t3('التأمين الصحي', 'Health insurance', 'Assurance maladie'))}
        {rt.salary && item('budget', t3('القائمة للموازنة', 'List for the budget', 'Liste pour le budget'))}
        {rt.reports && item('reports', t3('التقارير و Excel', 'Reports & Excel', 'Rapports et Excel'))}
        <div className="group">{t3('أخرى', 'More', 'Plus')}</div>
        {item('conduct', t3('مدونة السلوك', 'Code of conduct', 'Code de conduite'))}
        {(manage || rt.scale || rt.users || rt.backups) && item('lists', t3('الإعدادات', 'Settings', 'Réglages'))}
        {vault && item('log', t3('سجل فتح الوثائق', 'Document log', 'Journal des documents'))}
        {item('guide', <><GuideSun light /> {t3('الدليل', 'Guide', 'Guide')}</>)}
        <div className="spacer" />
        <div className="sun"><img src="/brand/magis-sun.png" alt="" /></div>
        {onDatabases && <button onClick={onDatabases}>{t3('قواعد البيانات', 'Databases', 'Bases de données')}</button>}
        {onAllDatabases && <button onClick={onAllDatabases}>🏠 {t3('الصفحة الأولى', 'Home page', "Page d'accueil")}</button>}
        <button onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
      </nav>
      <main className="hr-main">
        {err && <div className="alert err">{err}</div>}
        {!single && mineCentres.length > 1 && page !== 'person' && (
          <div className="hr-centrebar">
            <div className="hr-chips">
              <button className={centre === null ? 'on' : ''} onClick={() => choose(null)}><img src="/brand/magis-sun.png" alt="" />{t3('كل المراكز', 'All centres', 'Tous les centres')}</button>
              {mineCentres.map((c) => { const k = c.code as CentreKey; return <button key={c.code} className={centre === c.code ? 'on' : ''} style={centreVars(k)} onClick={() => choose(c.code)}><img src={markOf(k)} alt="" />{c.name}</button>; })}
            </div>
          </div>
        )}
        {page === 'home' && <Home {...ctx} pd={pd} go={go} centres={mineCentres} choose={choose} />}
        {page === 'people' && <People {...ctx} pd={pd} manage={manage} add={() => { setNewKind('staff'); setPersonId('new'); setPage('person'); }} />}
        {page === 'person' && (personId === 'new' || person) && (
          <PersonPage key={`${personId ?? 'x'}${newKind}`} s={session} d={all} pd={pd} reload={reload} manage={manage} vault={vault} pay={pay} r={rt} person={person} preset={centre} kind={newKind} onBack={() => go('people')} onSessions={() => go('sessions')} onOpen={(id) => { setPersonId(id); setPage('person'); }} />
        )}
        {page === 'scale' && pd && <ScalePage s={session} hr={d} pd={pd} reload={reload} open={open} centre={centre} />}
        {page === 'sessions' && <SessionsPage r={rt} s={session} hr={d} pd={pd} open={open} addTutor={() => { setNewKind('tutor'); setPersonId('new'); setPage('person'); }} />}
        {page === 'runs' && <RunsPage s={session} hr={d} centre={centre} pd={pd} />}
        {page === 'budget' && <BudgetListPage s={session} hr={d} centre={centre} />}
        {page === 'insurance' && <InsurancePage s={session} hr={d} />}
        {page === 'donors' && pd && rt.donors && <DonorsPage s={session} hr={d} pd={pd} open={open} />}
        {page === 'reports' && pd && rt.reports && <ReportsPage s={session} hr={d} pd={pd} open={open} sup={rt.hourly} />}
        {page === 'conduct' && <Conduct {...ctx} manage={manage} />}
        {page === 'lists' && <ListsPage s={session} d={all} reload={reload} r={rt} />}
        {page === 'log' && <Log s={session} d={all} />}
        {page === 'guide' && <><div className="hr-head"><div><div className="hr-eyebrow">{t3('الموارد البشرية', 'Human resources', 'Ressources humaines')}</div><h1><GuideSun size={30} /> {t3('الدليل', 'Guide', 'Guide')}</h1></div></div><GuideView key={guideSection ?? ''} sections={HR_GUIDE} initial={guideSection} /></>}
      </main>
    </div>
    </GuideCtx.Provider>
  );
}

const nameOf = (d: HrData, id: number) => { const p = d.people.find((x) => x.id === id); return p ? p.name_ar || p.name : '?'; };

function Home({ d, pd, open, go, centres, choose }: Ctx & { pd: HrPayData | null; go: (p: Page) => void; centres: { code: string; name: string }[]; choose: (c: string | null) => void }) {
  const active = d.people.filter((p) => p.active);
  const today = todayIso();
  const by = (code: string | null) => active.filter((p) => codeOf(d, p) === code);
  const monthly = (ps: HrPerson[]) => (pd ? ps.reduce((a, p) => a + (payOn(pd, p.id, today)?.monthly ?? 0), 0) : null);
  const hour = new Date().getHours();
  const shown = centres.filter((c) => by(c.code).length || centres.length === 1);
  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('الرهبانية اليسوعية · مراكز ماجيس', 'Society of Jesus · MAGIS centres', 'Compagnie de Jésus · centres MAGIS')}</div><h1>{hour < 12 ? t3('صباح الخير', 'Good morning', 'Bonjour') : t3('مساء الخير', 'Good evening', 'Bonsoir')}<GuideLink id="hr-start" /></h1></div>
      </div>
      <div className="hr-people" style={{ marginBottom: 16 }}>
        {(shown.length ? shown : centres).map((c) => {
          const k = (c.code ?? 'other') as CentreKey;
          return (
            <button key={c.code} className="hr-card" style={centreVars(k)} onClick={() => { if (centres.length > 1) choose(c.code); go('people'); }}>
              <div className="mark"><img src={markOf(k)} alt="" /></div>
              <div className="body"><b>{c.name}</b><div className="meta">{by(c.code).length} {t3('شخصاً', 'people', 'personnes')}</div></div>
              {pd && <div className="amount">{usd(monthly(by(c.code)))} $</div>}
            </button>
          );
        })}
      </div>
      <div className="hr-panel">
        <b>{t3('ما يحتاج انتباهاً', 'What needs attention', 'À surveiller')}</b>
        {d.alerts.length ? <Attention d={d} open={open} /> : <p className="ok">✓ {t3('كل شيء في موضعه', 'Everything is in order', 'Tout est en ordre')}</p>}
        <Funding d={d} open={open} />
      </div>
    </>
  );
}

/** Who has no budget line in their centre, or a line with no project (Fouad, 2026-11-02: checks before closing). */
function Funding({ d, open }: { d: HrData; open: (p: HrPerson) => void }) {
  const [shown, setShown] = useState<string | null>(null);
  const staff = d.people.filter((p) => p.active && p.centre);
  const noLine = staff.filter((p) => !lineFor(d.lists, p).line);
  const notFunded = staff.filter((p) => lineFor(d.lists, p).line && !accountFor(d.lists, p));
  const rows: [string, string, HrPerson[]][] = [
    ['line', t3('بلا خط موازنة في مركزه', 'No budget line in their centre', 'Pas de ligne budgétaire dans son centre'), noLine],
    ['funded', t3('خطه بلا مشروع (غير ممول)', 'Their line has no project (not funded)', "Sa ligne n'a pas de projet (non financé)"), notFunded],
  ];
  if (!noLine.length && !notFunded.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {rows.filter(([, , ps]) => ps.length).map(([k, label, ps]) => (
        <div key={k}>
          <button className="link" onClick={() => setShown(shown === k ? null : k)}>⚠ {label} · {ps.length}</button>
          {shown === k && <div className="small" style={{ margin: '4px 0 8px 18px' }}>{ps.map((p) => <button key={p.id} className="link" style={{ marginInlineEnd: 10 }} onClick={() => open(p)}>{p.name_ar || p.name}</button>)}</div>}
        </div>
      ))}
    </div>
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

type PeopleSort = 'name' | 'position' | 'stipend' | 'started' | 'centre';

function People({ d, pd, open, manage, add }: Ctx & { pd: HrPayData | null; manage: boolean; add: () => void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [view, setView] = useState<'cards' | 'table'>(() => { try { return (localStorage.getItem('hr-people-view') as 'cards' | 'table') || 'cards'; } catch { return 'cards'; } });
  const sort = useSort<PeopleSort>('name');
  const today = todayIso();
  const pos = (p: HrPerson) => (p.category === 'tutor' ? `🎓 ${t3('مدرّب', 'Tutor', 'Animateur')}${p.activity ? ` · ${p.activity}` : ''}` : p.role ? (d.positionsAr[p.role] ? `${d.positionsAr[p.role]} · ${p.role}` : p.role) : '');
  const pay = (p: HrPerson) => (pd ? payOn(pd, p.id, today) : null);
  const val = (p: HrPerson, k: PeopleSort) => (k === 'name' ? (getLang() === 'ar' ? p.name_ar || p.name : p.name || p.name_ar) : k === 'position' ? p.role : k === 'stipend' ? pay(p)?.monthly ?? null : k === 'started' ? p.started : p.centre);
  const rows = useMemo(() => sortRows(d.people.filter((p) => (all || p.active)
    && (!q || `${p.name} ${p.name_ar ?? ''} ${p.role ?? ''} ${d.positionsAr[p.role ?? ''] ?? ''} ${p.centre ?? ''} ${p.phone ?? ''}`.toLowerCase().includes(q.toLowerCase()))), (p) => val(p, sort.key), sort.dir), [d, all, q, sort.key, sort.dir, pd]);
  const groups = [...new Set(rows.map((p) => p.centre ?? ''))].sort((a, b) => a.localeCompare(b));
  const setV = (v: 'cards' | 'table') => { setView(v); try { localStorage.setItem('hr-people-view', v); } catch { /* */ } };
  const amount = (p: HrPerson) => { const now = pay(p); return now?.syp != null ? <div className="amount" style={{ textAlign: 'end' }}>{usd(now.syp)} SYP<div className="meta" style={{ fontWeight: 400 }}>{now.monthly != null ? `≈ ${usd(now.monthly)} $` : t3('بلا سعر دولار', 'no dollar rate', 'pas de taux')}</div></div> : now?.monthly != null ? <div className="amount">{usd(now.monthly)} $</div> : null; };
  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('المتطوعون والفريق', 'Volunteers and team', 'Bénévoles et équipe')}</div><h1>{t3('الأشخاص', 'People', 'Personnes')} <span className="muted" style={{ fontSize: 15, fontWeight: 400 }}>· {rows.length}</span><GuideLink id="hr-start" /></h1></div>
        <div className="desk-filters">
          <input placeholder={t3('بحث…', 'Search…', 'Chercher…')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={sort.key} onChange={(e) => sort.by(e.target.value as PeopleSort)} title={t3('الترتيب', 'Order', 'Ordre')}>
            <option value="name">{t3('حسب الاسم', 'By name', 'Par nom')}</option>
            <option value="position">{t3('حسب الوظيفة', 'By position', 'Par poste')}</option>
            {pd && <option value="stipend">{t3('حسب المكافأة', 'By stipend', 'Par gratification')}</option>}
            <option value="started">{t3('حسب تاريخ البدء', 'By start date', 'Par date de début')}</option>
          </select>
          <button className="btn small" onClick={() => sort.by(sort.key)} title={t3('عكس الترتيب', 'Reverse the order', "Inverser l'ordre")}>{sort.dir === 1 ? '▲' : '▼'}</button>
          <span className="row" style={{ gap: 0 }}>
            <button className={`btn small ${view === 'cards' ? 'primary' : ''}`} onClick={() => setV('cards')}>▦ {t3('بطاقات', 'Cards', 'Cartes')}</button>
            <button className={`btn small ${view === 'table' ? 'primary' : ''}`} onClick={() => setV('table')}>☰ {t3('جدول', 'Table', 'Tableau')}</button>
          </span>
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t3('مع من غادروا', 'With those who left', 'Avec ceux partis')}</label>
          {manage && <button className="btn gold" onClick={add}>＋ {t3('شخص جديد', 'New person', 'Nouvelle personne')}</button>}
        </div>
      </div>
      {view === 'table' ? (
        <div className="hr-panel desk-scroll">
          <table className="desk-table">
            <thead><tr><th /><SortTh k="name" sort={sort}>{t3('الاسم', 'Name', 'Nom')}</SortTh><SortTh k="centre" sort={sort}>{t3('المركز', 'Centre', 'Centre')}</SortTh><SortTh k="position" sort={sort}>{t3('الوظيفة', 'Position', 'Poste')}</SortTh>{pd && <SortTh k="stipend" sort={sort} n>{t3('المكافأة', 'Stipend', 'Gratification')}</SortTh>}<SortTh k="started" sort={sort}>{t3('بدأ', 'Started', 'Début')}</SortTh><th>{t3('الهاتف', 'Phone', 'Téléphone')}</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const { key } = centreOf(d, p);
                const now = pay(p);
                return (
                  <tr key={p.id} className="click" style={{ ...centreVars(key), opacity: p.active ? 1 : 0.55 }} onClick={() => open(p)}>
                    <td style={{ width: 30 }}><img src={markOf(key)} alt="" style={{ height: 22 }} /></td>
                    <td><TwoNames p={p} /></td><td>{p.centre ?? '—'}</td><td>{pos(p) || '—'}</td>
                    {pd && <td className="n">{now?.syp != null ? <>{usd(now.syp)} SYP<div className="muted small">{now.monthly != null ? `≈ ${usd(now.monthly)} $` : ''}</div></> : now?.monthly != null ? `${usd(now.monthly)} $` : '—'}</td>}
                    <td>{fmtDate(p.started)}{!p.active ? <div className="muted small">{t3('غادر', 'left', 'parti')} {fmtDate(p.ended)}</div> : null}</td>
                    <td className="ltr">{p.phone ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : groups.map((g) => {
        const xs = rows.filter((p) => (p.centre ?? '') === g);
        const key = xs[0] ? centreOf(d, xs[0]).key : 'other';
        const card = (p: HrPerson) => (
          <button key={p.id} className={`hr-card ${p.active ? '' : 'off'}`} style={centreVars(centreOf(d, p).key)} onClick={() => open(p)}>
            <div className="mark"><img src={markOf(centreOf(d, p).key)} alt="" /></div>
            <div className="body"><TwoNames p={p} /><div className="meta">{pos(p) || '—'}</div></div>
            {amount(p)}
          </button>
        );
        const staff = xs.filter((p) => p.category !== 'tutor'), tutors = xs.filter((p) => p.category === 'tutor');
        return (
          <section key={g} className="hr-group" style={centreVars(key)}>
            {groups.length > 1 && <h3><img src={markOf(key)} alt="" />{g || t3('بلا مركز', 'No centre', 'Sans centre')} <span className="n">· {xs.length}</span></h3>}
            {staff.length > 0 && <div className="hr-people">{staff.map(card)}</div>}
            {tutors.length > 0 && (
              <>
                <div className="hr-subgroup">🎓 {t3('المدرّبون (بالجلسة)', 'Tutors (paid by session)', 'Animateurs (à la séance)')} · {tutors.length}</div>
                <div className="hr-people">{tutors.map(card)}</div>
              </>
            )}
          </section>
        );
      })}
      {!rows.length && <p className="muted">{t3('لا أحد.', 'Nobody.', 'Personne.')}</p>}
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
      <div className="hr-head"><div><div className="hr-eyebrow">{t3('ما نلتزم به معاً', 'What we commit to together', 'Ce à quoi nous nous engageons ensemble')}</div><h1>{t3('مدونة السلوك', 'Code of conduct', 'Code de conduite')}<GuideLink id="hr-person" /></h1></div>{manage && <button className="btn primary" onClick={() => setForm({ version: '', validFrom: todayIso(), note: '' })}>＋ {t3('نسخة جديدة', 'New version', 'Nouvelle version')}</button>}</div>
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
      <div className="desk-head"><h1>{t3('سجل فتح الوثائق', 'Log of document openings', "Journal d'ouverture des documents")}<GuideLink id="hr-person" /></h1></div>
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
