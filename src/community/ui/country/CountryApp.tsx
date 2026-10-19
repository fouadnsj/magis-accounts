// The country econome's screens (computer layout): the communities' monthly files,
// the claims to decide, the charges between communities, each community's account at
// the économat, the year-end reconciliation, the totals by code, the return files.
// He never sees a Jesuit's detail: only what the communities' files hold.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePalette } from '../usePalette';
import { GateCard } from '../CtyGate';
import { has } from '../../../auth';
import type { Session } from '../../../state';
import { getLang, setLang, type LangMode } from '../../../i18n';
import { errText, parseAmount, promptBox, toast, todayIso } from '../../../ui/kit';
import { pickFile, saveFile } from '../../../platform';
import type { CountryData } from '../../country';
import { CHART } from '../../chart';
import { CURS, monthsOfYear, totalUsd, yearOf, type Cur, type Money } from '../../domain';
import type { MonthFile } from '../../files';
import { compareSides, ledgerOf, reconcile, type Comparison as Cmp, type CountryClaim, type MoveKind, type MoveStatus, type SideLine } from '../../ledger';
import { curName, money, monthName, t3, yearName } from '../text';
import { claimName } from '../desk/Claims';
import { Comparison, kindName, statusName } from '../desk/Statement';
import { exportExcel } from '../desk/excel';
import { ChartTable } from '../desk/Chart';
import { Expenses } from './Expenses';
import { WhoIs } from '../CtyApp';
import { PageGuard, ServerTooOld } from '../Guard';
import { Ring } from '../charts';
import '../cty.css';
import '../desk/desk.css';

type Page = 'dash' | 'expenses' | 'claims' | 'charges' | 'accounts' | 'reco' | 'totals' | 'ctys' | 'chart' | 'settings';
let NAMES = new Map<string, { en: string; fr: string; ar: string }>(CHART.map((a) => [a.code, a]));
/** The name of a code, from the country's chart (kept up to date when the data loads). */
const codeName = (code: string) => {
  const a = NAMES.get(code);
  if (!a) return code;
  const l = getLang();
  return l === 'fr' ? a.fr : l === 'ar' ? a.ar : l === 'en' ? a.en : `${a.ar} · ${a.en}`;
};

export function CountryApp({ session, onLogout, onLang }: { session: Session; onLogout: () => void; onLang: () => void }) {
  const [d, setD] = useState<CountryData | null>(null);
  const [page, setPage] = useState<Page>('dash');
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const data = await session.api.call('country.data');
      NAMES = new Map(data.accounts.map((a) => [a.code, { en: a.name_en, fr: a.name_fr, ar: a.name_ar }]));
      setD(data);
      setErr(null);
    } catch (e) { setErr(errText(e)); }
  }, [session]);
  useEffect(() => { void reload(); }, [reload]);
  usePalette(d?.style);
  if (!d) return <div className="cty"><div className="cty-page">{err ? <div className="alert err">{err}</div> : '…'}</div></div>;
  if (!d.accounts || !d.proposals) return <ServerTooOld onLogout={onLogout} />;
  const waiting = d.claims.filter((c) => c.status === 'waiting').length;
  const proposed = d.proposals.filter((p) => p.status === 'waiting').length;
  const groups: { title: string; items: { p: Page; label: string; badge?: number }[] }[] = [
    { title: t3('كل شهر', 'Every month', 'Chaque mois'), items: [
      { p: 'dash', label: t3('البداية: ما يجب فعله', 'Home: what to do', 'Accueil : à faire') },
      { p: 'claims', label: t3('المطالبات', 'Claims', 'Réclamations'), badge: waiting },
      { p: 'charges', label: t3('بين الجماعات', 'Between communities', 'Entre communautés'), badge: proposed },
    ] },
    { title: t3('المال عند الإقليم', 'Money with the Province', 'Argent à la Province'), items: [
      { p: 'accounts', label: t3('الحسابات عند الإيكونوماتو', 'Accounts at the économat', "Comptes à l'économat") },
      { p: 'reco', label: t3('مصالحة آخر السنة', 'Year-end check', 'Vérification de fin d’année') },
    ] },
    { title: t3('معلومات', 'Information', 'Informations'), items: [
      { p: 'expenses', label: t3('النفقات بالتفصيل', 'Expenses in detail', 'Dépenses en détail') },
      { p: 'totals', label: t3('المجاميع حسب الرمز', 'Totals by code', 'Totaux par code') },
      { p: 'ctys', label: t3('الجماعات وملفات الرجوع', 'Communities & return files', 'Communautés et retours') },
      { p: 'chart', label: t3('دليل الحسابات', 'Chart of codes', 'Plan des comptes') },
      { p: 'settings', label: t3('الإعدادات', 'Settings', 'Réglages') },
    ] },
  ];
  const ctx = { s: session, d, reload };
  return (
    <div className="cty desk">
      <aside className="desk-side">
        <div className="desk-org"><b>{session.organisation}</b><WhoIs profile={session.profile} light /></div>
        {groups.map((g) => (
          <div key={g.title} className="desk-group">
            <div className="desk-group-title">{g.title}</div>
            {g.items.map((x) => (
              <button key={x.p} className={page === x.p ? 'on' : ''} onClick={() => setPage(x.p)}><span>{x.label}</span>{x.badge ? <i className="cty-badge static">{x.badge}</i> : null}</button>
            ))}
          </div>
        ))}
        <div className="desk-spacer" />
        <button onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
      </aside>
      <main className="desk-main">
        <PageGuard page={page}>
        {err && <div className="alert err">{err}</div>}
        {page === 'dash' && <Home {...ctx} go={setPage} />}
        {page === 'claims' && <Claims {...ctx} />}
        {page === 'charges' && <Charges {...ctx} />}
        {page === 'accounts' && <Accounts {...ctx} />}
        {page === 'reco' && <Reco {...ctx} />}
        {page === 'expenses' && <Expenses d={d} />}
        {page === 'totals' && <Totals {...ctx} />}
        {page === 'ctys' && <Ctys {...ctx} />}
        {page === 'chart' && (
          <ChartTable accounts={d.accounts} used={new Set()} may
            note={t3('هذا الدليل يُرسل إلى كل جماعة مع ملف الرجوع. لاحقاً يحفظه الإقليم.', 'This chart goes to every community with the return file. Later the Province will keep it.', "Ce plan part vers chaque communauté avec le fichier de retour. Plus tard, la Province le tiendra.")}
            save={async (account, reason) => { await session.api.call('country.account.save', { account, reason }); await reload(); }} />
        )}
        {page === 'settings' && <Settings onLang={onLang} onLogout={onLogout} s={session} d={d} reload={reload} />}
        </PageGuard>
      </main>
    </div>
  );
}

interface P { s: Session; d: CountryData; reload: () => Promise<void> }
/** The year (October → September) of the latest file received, or this year. */
const latestYear = (d: CountryData) => { const m = d.months.map((x) => x.ym).sort().pop(); return yearOf(m ? `${m}-01` : todayIso()); };
const fail = (e: unknown) => toast(errText(e), true);
const nameOf = (d: CountryData, id: number) => d.ctys.find((c) => c.id === id)?.name ?? '?';

// ---------------------------------------------------------------- home: what to do this month

/** One step of the month, in plain words: what it is, where we are, and the button to do it. */
function Step({ n, title, help, status, ok, button, onClick }: { n: number; title: string; help: string; status: string; ok: boolean; button: string; onClick: () => void }) {
  return (
    <div className={`cty-card desk-step ${ok ? 'done' : ''}`}>
      <div className="desk-step-n">{ok ? '✓' : n}</div>
      <div className="desk-step-body">
        <b>{title}</b>
        <div className="muted small">{help}</div>
        <div className={ok ? 'ok' : 'desk-alert'} style={{ marginTop: 4 }}>{status}</div>
      </div>
      <button className={`btn ${ok ? '' : 'primary'}`} onClick={onClick}>{button}</button>
    </div>
  );
}

/** Each community at a glance, from its latest file: its money, what it spent this year, what waits. */
function CommunityStatus({ d, go }: { d: CountryData; go: (p: Page) => void }) {
  const rates = { loc: d.rates.startRate > 0 ? 1 / d.rates.startRate : null, eur: d.rates.eurUsd };
  const usd = (m: Money) => totalUsd(m, rates).usd;
  const year = latestYear(d);
  const rows = d.ctys.filter((c) => c.active).map((c) => {
    const files = d.months.filter((m) => m.cty_id === c.id).sort((a, b) => a.ym.localeCompare(b.ym));
    const last = files[files.length - 1];
    const spent: Money = { LOC: 0, USD: 0, EUR: 0 };
    for (const f of files) if (yearOf(`${f.ym}-01`) === year) for (const [code, v] of Object.entries(f.file.totals)) {
      const a = d.accounts.find((x) => x.code === code);
      if (a?.type === 'Exp') for (const k of CURS) spent[k] -= v[k];
    }
    return { c, last, spent, claims: d.claims.filter((x) => x.cty_id === c.id && x.status === 'waiting').length, diffs: disagreements(sidesOf(d, c.id)) };
  });
  const total = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
  return (
    <div className="cty-card desk-scroll">
      <table className="desk-table">
        <thead><tr>
          <th>{t3('الجماعة', 'Community', 'Communauté')}</th><th>{t3('آخر ملف', 'Last file', 'Dernier fichier')}</th>
          <th className="num">{t3('الصندوق ≈ $', 'Cash ≈ $', 'Caisse ≈ $')}</th><th className="num">{t3('المصرف ≈ $', 'Bank ≈ $', 'Banque ≈ $')}</th><th className="num">{t3('الإيكونوماتو ≈ $', 'Économat ≈ $', 'Économat ≈ $')}</th>
          <th className="num">{t3('صُرف منذ أول السنة ≈ $', 'Spent this year ≈ $', 'Dépensé cette année ≈ $')}</th>
          <th className="num">{t3('مطالبات', 'Claims', 'Réclamations')}</th><th>{t3('مع الإقليم', 'With the Province', 'Avec la Province')}</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.c.id} className="click" onClick={() => go('expenses')}>
              <td><b>{r.c.name}</b></td>
              <td>{r.last ? monthName(r.last.ym) : <span className="desk-alert">{t3('لا ملف', 'no file', 'aucun fichier')}</span>}</td>
              <td className="num">{r.last ? money(usd(r.last.file.books.cash), 'USD') : '—'}</td>
              <td className="num">{r.last ? money(usd(r.last.file.books.bank), 'USD') : '—'}</td>
              <td className="num">{r.last ? money(usd(r.last.file.books.economat), 'USD') : '—'}</td>
              <td className="num"><b>{money(usd(r.spent), 'USD')}</b></td>
              <td className="num">{r.claims ? <span className="desk-alert">{r.claims}</span> : ''}</td>
              <td>{r.diffs ? <span className="desk-alert">⚠ {r.diffs}</span> : <span className="ok">✓</span>}</td>
            </tr>
          ))}
          <tr className="fdc-total"><td>{t3('المجموع', 'Total', 'Total')}</td><td />
            <td className="num">{money(total((r) => (r.last ? usd(r.last.file.books.cash) : 0)), 'USD')}</td>
            <td className="num">{money(total((r) => (r.last ? usd(r.last.file.books.bank) : 0)), 'USD')}</td>
            <td className="num">{money(total((r) => (r.last ? usd(r.last.file.books.economat) : 0)), 'USD')}</td>
            <td className="num">{money(total((r) => usd(r.spent)), 'USD')}</td><td /><td /></tr>
        </tbody>
      </table>
      <p className="muted small">{t3('كل شيء بالدولار (الأسعار في «الإعدادات»). الأرصدة كما في آخر ملف أرسلته الجماعة.', 'Everything in dollars (rates in “Settings”). Balances are as in the last file each community sent.', 'Tout en dollars (taux dans « Réglages »). Les soldes sont ceux du dernier fichier envoyé par chaque communauté.')} {t3('اضغط على جماعة لترى نفقاتها بالتفصيل.', 'Click a community to see its expenses in detail.', 'Cliquez une communauté pour voir ses dépenses en détail.')}</p>
    </div>
  );
}

function Home({ s, d, reload, go }: P & { go: (p: Page) => void }) {
  const latest = d.months.map((m) => m.ym).sort().pop();
  const [ym, setYm] = useState(latest ?? todayIso().slice(0, 7));
  const active = d.ctys.filter((c) => c.active);
  const got = active.filter((c) => d.months.some((x) => x.cty_id === c.id && x.ym === ym));
  const missing = active.filter((c) => !got.includes(c));
  const claims = d.claims.filter((c) => c.status === 'waiting').length;
  const charges = d.proposals.filter((p) => p.status === 'waiting').length;
  const step = (ymv: string, k: number) => { const [y, m] = ymv.split('-').map(Number); const t = y * 12 + (m - 1) + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  return (
    <>
      <div className="desk-head">
        <h1>{t3('ما يجب فعله هذا الشهر', 'What to do this month', 'À faire ce mois-ci')}</h1>
      </div>
      <div className="cty-monthnav" style={{ margin: '0 0 10px' }}>
        <button onClick={() => setYm(step(ym, -1))} aria-label="previous">‹</button>
        <h1>{monthName(ym)}</h1>
        <button onClick={() => setYm(step(ym, 1))} aria-label="next">›</button>
      </div>
      <Step n={1} ok={active.length > 0 && missing.length === 0}
        title={t3('استلام ملفات الجماعات', 'Receive the communities’ files', 'Recevoir les fichiers des communautés')}
        help={t3('كل جماعة ترسل لك ملفها (بالبريد أو على مفتاح USB). اضغط «أدخل ملفاً» لكل ملف.', 'Each community sends you its file (by email or USB key). Press “Bring in a file” for each one.', 'Chaque communauté vous envoie son fichier (par courriel ou clé USB). Appuyez sur « Importer un fichier » pour chacun.')}
        status={active.length === 0 ? t3('لا جماعة بعد', 'No community yet', 'Aucune communauté encore') : missing.length === 0 ? t3(`وصلت كل الملفات (${got.length})`, `All files received (${got.length})`, `Tous les fichiers sont reçus (${got.length})`) : t3(`وصل ${got.length} من ${active.length} · ينقص: ${missing.map((c) => c.name).join('، ')}`, `${got.length} of ${active.length} received · missing: ${missing.map((c) => c.name).join(', ')}`, `${got.length} sur ${active.length} reçus · manque : ${missing.map((c) => c.name).join(', ')}`)}
        button={t3('أدخل ملفاً…', 'Bring in a file…', 'Importer un fichier…')}
        onClick={async () => {
          const f = await pickFile(['json'], t3('ملف شهري من جماعة', 'A monthly file from a community', "Un fichier mensuel d'une communauté"));
          if (!f) return;
          try {
            const r = await s.api.call('country.import', { file: JSON.parse(new TextDecoder().decode(f.bytes)) });
            await reload();
            setYm(r.ym);
            toast(`${r.community} · ${monthName(r.ym)} · ${r.status === 'same' ? t3('موجود سابقاً', 'already in', 'déjà là') : r.status === 'new' ? t3('جديد', 'new', 'nouveau') : t3('صُحّح', 'corrected', 'corrigé')}`);
          } catch (e) { fail(e); }
        }} />
      <Step n={2} ok={claims === 0}
        title={t3('البتّ في المطالبات', 'Decide the claims', 'Décider des réclamations')}
        help={t3('نفقات يطلب الإخوة أن يعوّضها الإقليم (صحة، دراسة…). اقبل أو ارفض كل واحدة.', 'Expenses that the brothers ask the Province to refund (health, studies…). Accept or refuse each one.', 'Dépenses que les frères demandent à la Province de rembourser (santé, études…). Acceptez ou refusez chacune.')}
        status={claims === 0 ? t3('لا شيء ينتظر', 'Nothing is waiting', "Rien n'attend") : t3(`${claims} تنتظر قرارك`, `${claims} waiting for your decision`, `${claims} attendent votre décision`)}
        button={t3('افتح المطالبات', 'Open the claims', 'Ouvrir les réclamations')} onClick={() => go('claims')} />
      <Step n={3} ok={charges === 0}
        title={t3('التكاليف بين الجماعات', 'Charges between communities', 'Charges entre communautés')}
        help={t3('جماعة استضافت أخاً من جماعة أخرى وتطلب كلفة الإقامة. راجعها ووافق عليها.', 'A community hosted a brother from another one and asks for the cost. Check it and approve it.', 'Une communauté a accueilli un frère d’une autre et demande le coût. Vérifiez et approuvez.')}
        status={charges === 0 ? t3('لا شيء ينتظر', 'Nothing is waiting', "Rien n'attend") : t3(`${charges} تنتظر`, `${charges} waiting`, `${charges} en attente`)}
        button={t3('افتح', 'Open', 'Ouvrir')} onClick={() => go('charges')} />
      <Step n={4} ok={false}
        title={t3('إرسال الأجوبة إلى الجماعات', 'Send the answers back', 'Renvoyer les réponses aux communautés')}
        help={t3('لكل جماعة ملف رجوع: قراراتك وحسابها عند الإيكونوماتو. أعطه لها.', 'Each community gets a return file: your decisions and its account at the économat. Give it back.', 'Chaque communauté reçoit un fichier de retour : vos décisions et son compte à l’économat. Remettez-le.')}
        status={t3('بعد القرارات', 'After your decisions', 'Après vos décisions')}
        button={t3('ملفات الرجوع', 'Return files', 'Fichiers de retour')} onClick={() => go('ctys')} />
      {(() => {
        const n = active.reduce((k, c) => k + disagreements(sidesOf(d, c.id)), 0);
        return (
          <Step n={5} ok={n === 0}
            title={t3('المال بين الإقليم والجماعات', 'Money between the Province and the communities', 'L’argent entre la Province et les communautés')}
            help={t3('إعانات ومساهمات: يسجّل كل طرف جانبه. قارن بينهما.', 'Grants and cotisations: each side records its part. Compare them.', 'Aides et cotisations : chaque côté note sa part. Comparez-les.')}
            status={n === 0 ? t3('الطرفان متفقان', 'Both sides agree', 'Les deux côtés sont d’accord') : t3(`${n} فروق بين الطرفين`, `${n} difference(s) between the two sides`, `${n} différence(s) entre les deux côtés`)}
            button={t3('افتح الحسابات', 'Open the accounts', 'Ouvrir les comptes')} onClick={() => go('accounts')} />
        );
      })()}
      <h2 style={{ marginTop: 18 }}>{t3('حال كل جماعة', 'State of each community', 'État de chaque communauté')}</h2>
      <CommunityStatus d={d} go={go} />
      <h2 style={{ marginTop: 18 }}>{t3('من أرسل ماذا', 'Who sent what', 'Qui a envoyé quoi')}</h2>
      <Files s={s} d={d} reload={reload} bare />
    </>
  );
}

// ---------------------------------------------------------------- the monthly files

function Files({ s, d, reload, bare }: P & { bare?: boolean }) {
  // opens on the year of the latest file received
  const latest = d.months.map((m) => m.ym).sort().pop();
  const [year, setYear] = useState(yearOf(latest ? `${latest}-01` : todayIso()));
  const [shown, setShown] = useState<MonthFile | null>(null);
  const months = monthsOfYear(year);
  const bring = async () => {
    const f = await pickFile(['json'], t3('ملف شهري من جماعة', 'A monthly file from a community', "Un fichier mensuel d'une communauté"));
    if (!f) return;
    try {
      const r = await s.api.call('country.import', { file: JSON.parse(new TextDecoder().decode(f.bytes)) });
      await reload();
      toast(r.status === 'same' ? t3('هذا الملف موجود سابقاً: لا تغيير', 'This file was already in: nothing changed', 'Ce fichier était déjà là : rien ne change')
        : `${r.community} · ${monthName(r.ym)} · ${r.status === 'new' ? t3('جديد', 'new', 'nouveau') : t3('صُحّح', 'corrected', 'corrigé')} · ${r.claims} ${t3('مطالبة', 'claims', 'réclamations')}`);
    } catch (e) { fail(e); }
  };
  return (
    <>
      {!bare && (
        <div className="desk-head">
          <h1>{t3('الملفات الشهرية للجماعات', "The communities' monthly files", 'Les fichiers mensuels des communautés')}</h1>
          <button className="btn primary" onClick={bring}>{t3('أدخل ملفاً…', 'Bring in a file…', 'Importer un fichier…')}</button>
        </div>
      )}
      <div className="desk-filters"><button className="btn" onClick={() => setYear(year - 1)}>‹</button><span>{yearName(year)}</span><button className="btn" onClick={() => setYear(year + 1)}>›</button></div>
      <div className="cty-card desk-scroll">
        {d.ctys.length === 0 ? <p className="muted">{t3('لم يصل أي ملف بعد. كل جماعة تصنع ملفها في صفحة «شهر الجماعة ← البلد».', 'No file yet. Each community makes its file on the page "Consolidated month → country".', 'Aucun fichier encore. Chaque communauté fait son fichier dans la page « Mois consolidé → pays ».')}</p> : (
          <table className="desk-table">
            <thead><tr><th>{t3('الجماعة', 'Community', 'Communauté')}</th>{months.map((m) => <th key={m} className="num" title={monthName(m)}>{m.slice(5)}</th>)}</tr></thead>
            <tbody>
              {d.ctys.filter((c) => c.active).map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  {months.map((m) => {
                    const f = d.months.find((x) => x.cty_id === c.id && x.ym === m);
                    return <td key={m} className="num">{f ? <button className="cty-link" title={f.received_at.slice(0, 10)} onClick={() => setShown(f.file)}>✓</button> : <span className="muted">·</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {shown && <MonthView f={shown} local={d.local} onClose={() => setShown(null)} />}
    </>
  );
}

function MonthView({ f, local, onClose }: { f: MonthFile; local: string; onClose: () => void }) {
  const codes = Object.keys(f.totals).sort();
  const row = (label: string, v: Money, cls?: string) => <tr className={cls}><td /><td>{label}</td>{CURS.map((c) => <td key={c} className="num">{v[c] ? money(v[c], c) : ''}</td>)}</tr>;
  return (
    <div className="cty-card">
      <div className="desk-head"><h2>{f.community.name} · {monthName(f.ym)}</h2><button className="btn" onClick={onClose}>✕</button></div>
      <p className="muted small">{t3('أرسله', 'Sent by', 'Envoyé par')} {f.made_by} · {f.made_at.slice(0, 10)} · {f.members} {t3('أعضاء', 'members', 'membres')}</p>
      <table className="desk-table fdc">
        <thead><tr><th /><th /><th className="num">{curName('LOC', local)}</th><th className="num">$</th><th className="num">€</th></tr></thead>
        <tbody>
          {codes.map((k) => <tr key={k}><td className="muted small">{k}</td><td>{codeName(k)}</td>{CURS.map((c) => <td key={c} className="num">{f.totals[k][c] ? money(f.totals[k][c], c) : ''}</td>)}</tr>)}
          {row(t3('مجموع الدخل', 'Total income', 'Total revenus'), f.cash.income, 'fdc-total')}
          {row(t3('مجموع النفقات', 'Total expenses', 'Total dépenses'), f.cash.expenses, 'fdc-total')}
          {row(t3('الصندوق', 'Cash', 'Caisse'), f.books.cash)}
          {row(t3('المصرف', 'Bank', 'Banque'), f.books.bank)}
          {row(t3('الإيكونوماتو', 'Économat', 'Économat'), f.books.economat)}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- claims

function Claims({ s, d, reload }: P) {
  const [show, setShow] = useState<'waiting' | 'all'>('waiting');
  const rows = d.claims.filter((c) => (show === 'waiting' ? c.status === 'waiting' : true));
  const decide = async (c: CountryClaim, status: 'accepted' | 'refused' | 'waiting', part = false) => {
    try {
      let accepted: number | null = null;
      let note: string | null = null;
      if (part) {
        const a = await promptBox(t3('المبلغ المقبول؟', 'Amount accepted?', 'Montant accepté ?'), String(c.amount));
        if (!a) return;
        accepted = parseAmount(a);
      }
      if (status === 'refused' || part) {
        note = await promptBox(t3('السبب؟', 'Why?', 'Pourquoi ?'));
        if (!note) return;
      }
      await s.api.call('country.claim.decide', { id: c.id, status, accepted, note });
      await reload();
    } catch (e) { fail(e); }
  };
  return (
    <>
      <div className="desk-head">
        <h1>{t3('المطالبات من الإقليم', 'Claims from the Province', 'Réclamations à la Province')}</h1>
        <div className="cty-seg" style={{ margin: 0 }}>
          <button className={show === 'waiting' ? 'on' : ''} onClick={() => setShow('waiting')}>{t3('بانتظار', 'Waiting', 'En attente')}</button>
          <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>{t3('الكل', 'All', 'Toutes')}</button>
        </div>
      </div>
      <p className="muted small">{t3('كل سطر نفقة يطلب أخ أن يعوّضها الإقليم. «أقبل» يعني أن الإقليم سيدفعها، «أرفض» يعني لا (اكتب السبب ليفهم الأخ).', 'Each line is an expense a brother asks the Province to refund. “Accept” means the Province will pay it; “Refuse” means no (write why, so the brother understands).', 'Chaque ligne est une dépense qu’un frère demande à la Province de rembourser. « Accepter » : la Province la paiera ; « Refuser » : non (écrivez pourquoi, pour que le frère comprenne).')}</p>
      <div className="cty-card desk-scroll">
        {rows.length === 0 ? <p className="muted">✓ {t3('لا شيء ينتظر.', 'Nothing is waiting.', "Rien n'attend.")}</p> : (
          <table className="desk-table">
            <thead><tr><th>{t3('الجماعة', 'Community', 'Communauté')}</th><th>{t3('من', 'Who', 'Qui')}</th><th>{t3('التاريخ', 'Date', 'Date')}</th><th>{t3('السبب', 'Reason', 'Motif')}</th><th>{t3('البند', 'Line', 'Ligne')}</th><th>{t3('ملاحظة', 'Note', 'Note')}</th><th className="num">{t3('المبلغ', 'Amount', 'Montant')}</th><th>{t3('القرار', 'Decision', 'Décision')}</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{nameOf(d, c.cty_id)}</td><td><b>{c.person}</b></td><td>{c.date}</td><td>{claimName(c.reason as never)}</td>
                  <td>{c.code} {c.code ? codeName(c.code) : c.line}</td><td className="desk-note">{c.note}</td>
                  <td className="num">{money(c.amount, c.cur)} {curName(c.cur, d.local)}</td>
                  <td>
                    {c.status === 'waiting' ? (
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn primary" onClick={() => decide(c, 'accepted')}>✓ {t3('أقبل', 'Accept', 'Accepter')}</button>
                        <button className="btn" onClick={() => decide(c, 'accepted', true)}>{t3('جزءاً منها', 'Accept part', 'En partie')}</button>
                        <button className="btn ghost" onClick={() => decide(c, 'refused')}>{t3('أرفض', 'Refuse', 'Refuser')}</button>
                      </div>
                    ) : c.status === 'withdrawn' ? <span className="muted">{t3('سحبتها الجماعة', 'withdrawn', 'retirée')}</span> : (
                      <>
                        {c.status === 'accepted' ? <span className="ok">✓ {money(c.accepted ?? c.amount, c.cur)}</span> : <span className="desk-alert">✗</span>}
                        {c.decision_note && <span className="muted small"> · {c.decision_note}</span>}
                        <button className="cty-link" style={{ marginInlineStart: 6 }} onClick={() => decide(c, 'waiting')}>{t3('تراجع', 'undo', 'annuler')}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- charges between communities

function Charges({ s, d, reload }: P) {
  const active = d.ctys.filter((c) => c.active);
  const [f, setF] = useState({ date: todayIso(), host_id: active[0]?.id ?? 0, charged_id: active[1]?.id ?? 0, cur: 'LOC' as Cur, amount: '', note: '' });
  const save = async () => {
    try {
      await s.api.call('country.charge.save', { charge: { ...f, amount: parseAmount(f.amount) } });
      setF({ ...f, amount: '', note: '' });
      await reload();
      toast(t3('سُجّل ✓', 'Recorded ✓', 'Enregistré ✓'));
    } catch (e) { fail(e); }
  };
  const del = async (id: string) => {
    const reason = await promptBox(t3('سبب الحذف؟', 'Why delete it?', 'Pourquoi le supprimer ?'));
    if (!reason) return;
    try { await s.api.call('country.delete', { table: 'country_charge', id, reason }); await reload(); } catch (e) { fail(e); }
  };
  return (
    <>
      <div className="desk-head"><h1>{t3('تكاليف بين الجماعات', 'Charges between communities', 'Charges entre communautés')}</h1></div>
      <p className="muted">{t3('مثلاً: يسوعي من حمص أقام 3 ليالٍ في بيروت. بيروت تستضيف، وحمص تُحمَّل.', 'E.g. a Jesuit of Homs stayed 3 nights in Beirut: Beirut hosted, Homs is charged.', 'P. ex. un jésuite de Homs a passé 3 nuits à Beyrouth : Beyrouth a accueilli, Homs est facturé.')}</p>
      <Proposals s={s} d={d} reload={reload} />
      <div className="cty-label" style={{ marginTop: 14 }}>{t3('أو سجّلها بنفسك', 'Or record one yourself', 'Ou enregistrez-en une vous-même')}</div>
      <div className="cty-card">
        <p className="muted small" style={{ marginTop: 0 }}>{t3('أجب: من استضاف؟ من سيدفع؟ كم؟ ولماذا؟', 'Answer: who hosted? who pays? how much? and for what?', 'Répondez : qui a accueilli ? qui paie ? combien ? et pourquoi ?')}</p>
        <div className="desk-filters" style={{ marginBottom: 0 }}>
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <label>{t3('استضافت', 'Hosted by', 'Accueilli par')} <select value={f.host_id} onChange={(e) => setF({ ...f, host_id: Number(e.target.value) })}>{active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{t3('تدفع', 'Pays', 'Paie')} <select value={f.charged_id} onChange={(e) => setF({ ...f, charged_id: Number(e.target.value) })}>{active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <input inputMode="decimal" placeholder={t3('المبلغ', 'Amount', 'Montant')} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ width: 120 }} />
          <select value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value as Cur })}>{CURS.map((c) => <option key={c} value={c}>{curName(c, d.local)}</option>)}</select>
          <input placeholder={t3('الشرح: من؟ كم ليلة؟', 'What: who? how many nights?', 'Quoi : qui ? combien de nuits ?')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ minWidth: 240 }} />
          <button className="btn primary" onClick={save}>{t3('سجّل', 'Record', 'Enregistrer')}</button>
        </div>
      </div>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('التاريخ', 'Date', 'Date')}</th><th>{t3('استضافت', 'Host', 'Accueil')}</th><th>{t3('تُحمَّل', 'Charged', 'Facturé')}</th><th>{t3('الشرح', 'What', 'Quoi')}</th><th className="num">{t3('المبلغ', 'Amount', 'Montant')}</th><th /></tr></thead>
          <tbody>
            {[...d.charges].reverse().map((c) => (
              <tr key={c.id}><td>{c.date}</td><td>{nameOf(d, c.host_id)}</td><td>{nameOf(d, c.charged_id)}</td><td>{c.note}</td><td className="num">{money(c.amount, c.cur)} {curName(c.cur, d.local)}</td><td><button className="cty-link" onClick={() => del(c.id)}>{t3('حذف', 'delete', 'supprimer')}</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The charges marked by host communities, waiting for the country econome. */
function Proposals({ s, d, reload }: P) {
  const waiting = d.proposals.filter((p) => p.status === 'waiting');
  const [pick, setPick] = useState<Record<string, number>>({});
  const decide = async (id: string, status: 'approved' | 'refused', chargedId?: number) => {
    try {
      const note = status === 'refused' ? await promptBox(t3('السبب؟', 'Why?', 'Pourquoi ?')) : null;
      if (status === 'refused' && !note) return;
      await s.api.call('country.proposal.decide', { id, status, chargedId: chargedId ?? null, note });
      await reload();
    } catch (e) { fail(e); }
  };
  if (!d.proposals.length) return null;
  return (
    <div className="cty-card desk-scroll">
      <div className="cty-label">{t3('سجّلتها الجماعات المضيفة', 'Marked by the host communities', "Marquées par les communautés d'accueil")} {waiting.length ? `· ${waiting.length} ${t3('بانتظار', 'waiting', 'en attente')}` : ''}</div>
      <p className="muted small">{t3('اختر الجماعة التي ستدفع ثم اضغط «أوافق».', 'Choose which community pays, then press “Approve”.', 'Choisissez la communauté qui paie, puis « Approuver ».')}</p>
      <table className="desk-table">
        <thead><tr><th>{t3('التاريخ', 'Date', 'Date')}</th><th>{t3('استضافت', 'Host', 'Accueil')}</th><th>{t3('تُحمَّل', 'Charged', 'Facturé')}</th><th>{t3('من', 'Who', 'Qui')}</th><th>{t3('الشرح', 'What', 'Quoi')}</th><th className="num">{t3('المبلغ', 'Amount', 'Montant')}</th><th>{t3('القرار', 'Decision', 'Décision')}</th></tr></thead>
        <tbody>
          {[...d.proposals].reverse().map((p) => {
            const match = p.charged_uid ? d.ctys.find((c) => c.uid === p.charged_uid)?.id : d.ctys.find((c) => c.name.toLowerCase() === p.charged_name.toLowerCase())?.id;
            const chosen = pick[p.id] ?? match ?? 0;
            return (
              <tr key={p.id}>
                <td>{p.date}</td><td>{nameOf(d, p.host_id)}</td>
                <td>{p.status === 'waiting' ? (
                  <select value={chosen} onChange={(e) => setPick({ ...pick, [p.id]: Number(e.target.value) })}>
                    <option value={0}>— {p.charged_name} ?</option>
                    {d.ctys.filter((c) => c.id !== p.host_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : p.charged_name}</td>
                <td><b>{p.person}</b></td><td>{p.note}</td>
                <td className="num">{money(p.amount, p.cur)} {curName(p.cur, d.local)}</td>
                <td>{p.status === 'waiting' ? (
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn primary" disabled={!chosen} onClick={() => decide(p.id, 'approved', chosen)}>✓ {t3('أوافق', 'Approve', 'Approuver')}</button>
                    <button className="btn ghost" onClick={() => decide(p.id, 'refused')}>{t3('أرفض', 'Refuse', 'Refuser')}</button>
                  </div>
                ) : p.status === 'approved' ? <span className="ok">✓</span> : p.status === 'refused' ? <span className="desk-alert">✗ {p.decision_note}</span> : <span className="muted">{t3('سحبتها الجماعة', 'withdrawn', 'retirée')}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- each community's account

/** The two sides for one community: his records, and what the community wrote in its latest file. */
function sidesOf(d: CountryData, ctyId: number): Cmp {
  const mine: SideLine[] = d.moves.filter((m) => m.cty_id === ctyId).map((m) => ({ id: m.id, date: m.date, kind: m.kind, cur: m.cur, amount: Math.abs(m.amount), note: m.note, status: m.status }));
  const last = d.months.filter((m) => m.cty_id === ctyId).sort((a, b) => a.ym.localeCompare(b.ym)).pop();
  const theirs: SideLine[] = (last?.file.province ?? []).map((x) => ({ ...x }));
  return compareSides(mine, theirs);
}
const disagreements = (c: Cmp) => c.onlyCountry.length + c.onlyCommunity.length + c.matched.filter((x) => !x.sameStatus).length;

function Accounts({ s, d, reload }: P) {
  const [ctyId, setCtyId] = useState<number>(d.ctys[0]?.id ?? 0);
  const [f, setF] = useState({ date: todayIso(), kind: 'paid_to_cty' as MoveKind, cur: 'LOC' as Cur, amount: '', note: '', status: 'promised' as MoveStatus });
  const names = useMemo(() => new Map(d.ctys.map((c) => [c.id, c.name])), [d.ctys]);
  const lines = ledgerOf(ctyId, d.claims, d.charges, d.moves, names);
  const run: Money = { LOC: 0, USD: 0, EUR: 0 };
  const save = async () => {
    try {
      await s.api.call('country.move.save', { move: { cty_id: ctyId, ...f, amount: parseAmount(f.amount) } });
      setF({ ...f, amount: '', note: '' });
      await reload();
    } catch (e) { fail(e); }
  };
  const advance = async (id: string, status: MoveStatus) => { try { await s.api.call('country.move.status', { id, status }); await reload(); } catch (e) { fail(e); } };
  const del = async (id: string) => {
    const reason = await promptBox(t3('سبب الحذف؟', 'Why delete it?', 'Pourquoi le supprimer ?'));
    if (!reason) return;
    try { await s.api.call('country.delete', { table: 'country_move', id: id.replace(/^move:/, ''), reason }); await reload(); } catch (e) { fail(e); }
  };
  const kinds: MoveKind[] = ['paid_by_cty', 'paid_to_cty', 'cotisation', 'other'];
  return (
    <>
      <div className="desk-head">
        <h1>{t3('الحساب عند الإيكونوماتو', 'Account at the économat', "Compte à l'économat")}</h1>
        <select value={ctyId} onChange={(e) => setCtyId(Number(e.target.value))}>{d.ctys.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <p className="muted small">{t3('هنا تظهر حركات المال بين الجماعة والإقليم. الأرقام الموجبة (+) لصالح الجماعة، والسالبة (−) عليها.', 'Here is the money between the community and the Province. A plus (+) is in the community’s favour, a minus (−) is what the community owes.', 'Ici, l’argent entre la communauté et la Province. Un plus (+) est en faveur de la communauté, un moins (−) est ce qu’elle doit.')}</p>
      <div className="desk-tiles">
        {CURS.map((c) => { const bal = lines.reduce((n, l) => n + (l.cur === c && (!l.status || l.status === 'received') ? l.amount : 0), 0); const exp = lines.reduce((n, l) => n + (l.cur === c && l.status && l.status !== 'received' ? l.amount : 0), 0); return (
          <div key={c} className="cty-card desk-card"><div className="cty-label">{curName(c, d.local)}</div>
            <b className="desk-big">{money(bal, c)}</b>
            {exp !== 0 && <div className="small" style={{ color: '#8a5a10' }}>{t3('متوقَّع (لم يُستلم بعد)', 'Expected (not received yet)', 'Attendu (pas encore reçu)')}: {money(exp, c)}</div>}
            <div className="small muted">{bal < 0 ? t3('الجماعة مدينة', 'the community owes', 'la communauté doit') : bal > 0 ? t3('الإقليم مدين للجماعة', 'the Province owes the community', 'la Province doit à la communauté') : '—'}</div></div>
        ); })}
      </div>
      <div className="cty-label">{t3('إضافة حركة', 'Add a movement', 'Ajouter un mouvement')}</div>
      <p className="muted small">{t3('مثلاً: إعانة يمنحها الإقليم للجماعة، أو مساهمة تدفعها الجماعة. تبدأ «موعودة»، ثم «في الطريق»، ثم «مستلمة». المبلغ المستلم فقط يدخل في الرصيد. تصل الحركة إلى الجماعة في ملف الرجوع.', 'For example a grant the Province gives the community, or a cotisation the community pays. It starts as “Promised”, then “On the way”, then “Received”. Only what is received counts in the balance. The community sees it in the return file.', 'Par exemple une aide que la Province donne à la communauté, ou une cotisation que la communauté verse. Elle commence « Promise », puis « En route », puis « Reçue ». Seul ce qui est reçu compte dans le solde. La communauté la voit dans le fichier de retour.')}</p>
      <div className="cty-card">
        <div className="desk-filters" style={{ marginBottom: 0 }}>
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as MoveKind })}>{kinds.map((k) => <option key={k} value={k}>{kindName(k)}</option>)}</select>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as MoveStatus })}>{(['promised', 'on_the_way', 'received'] as MoveStatus[]).map((x) => <option key={x} value={x}>{statusName(x)}</option>)}</select>
          <input inputMode="decimal" placeholder={t3('المبلغ', 'Amount', 'Montant')} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ width: 120 }} />
          <select value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value as Cur })}>{CURS.map((c) => <option key={c} value={c}>{curName(c, d.local)}</option>)}</select>
          <input placeholder={t3('الشرح', 'What', 'Quoi')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ minWidth: 220 }} />
          <button className="btn primary" disabled={!ctyId} onClick={save}>{t3('أضف', 'Add', 'Ajouter')}</button>
        </div>
      </div>
      <Comparison cmp={sidesOf(d, ctyId)} local={d.local} countrySays={t3('أنت', 'you', 'vous')} communitySays={t3('الجماعة', 'the community', 'la communauté')} />
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('التاريخ', 'Date', 'Date')}</th><th>{t3('النوع', 'Kind', 'Type')}</th><th>{t3('الشرح', 'What', 'Quoi')}</th>{CURS.map((c) => <th key={c} className="num">{curName(c, d.local)}</th>)}{CURS.map((c) => <th key={'b' + c} className="num muted">{t3('الرصيد', 'Balance', 'Solde')} {curName(c, d.local)}</th>)}<th /></tr></thead>
          <tbody>
            {lines.map((l) => {
              if (!l.status || l.status === 'received') run[l.cur] += l.amount;
              const mv = l.id.startsWith('move:') ? d.moves.find((x) => x.id === l.id.slice(5)) : undefined;
              const next: MoveStatus | null = l.status === 'promised' ? 'on_the_way' : l.status === 'on_the_way' ? 'received' : null;
              return (
                <tr key={l.id}>
                  <td>{l.date}</td><td>{kindName(l.kind)}{l.status && l.status !== 'received' ? <span className="cty-pill modify" style={{ marginInlineStart: 6 }}>{statusName(l.status)}</span> : null}{mv && next && <button className="cty-link" style={{ marginInlineStart: 6 }} onClick={() => advance(mv.id, next)}>→ {statusName(next)}</button>}</td><td className="desk-note">{l.note}</td>
                  {CURS.map((c) => <td key={c} className={`num ${l.cur === c ? (l.amount < 0 ? 'out' : 'in') : ''}`}>{l.cur === c ? money(l.amount, c) : ''}</td>)}
                  {CURS.map((c) => <td key={'b' + c} className="num muted">{money(run[c], c)}</td>)}
                  <td>{l.id.startsWith('move:') && <button className="cty-link" onClick={() => del(l.id)}>{t3('حذف', 'delete', 'supprimer')}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- year-end reconciliation

function Reco({ d }: P) {
  const [year, setYear] = useState(latestYear(d));
  const [cur, setCur] = useState<Cur>('LOC');
  const r = reconcile(year, d.ctys, d.claims, d.charges, d.moves);
  const kinds = ['claim', 'host', 'charged', 'paid_by_cty', 'paid_to_cty', 'cotisation', 'other'];
  const v = (m: Money | undefined, c: Cur) => (m ? m[c] : 0);
  const exportIt = async () => {
    try {
      await exportExcel(`reconciliation-${year}.xlsx`, CURS.map((c) => ({
        name: c === 'LOC' ? d.local : c,
        header: [t3('الجماعة', 'Community', 'Communauté'), t3('من قبل', 'Before', 'Avant'), ...kinds.map(kindName), t3('في النهاية', 'At the end', 'À la fin'), t3('مطالبات بانتظار', 'Claims waiting', 'Réclamations en attente')],
        rows: r.map((x) => [nameOf(d, x.ctyId), x.before[c] || null, ...kinds.map((k) => v(x.byKind[k], c) || null), x.end[c] || null, x.waiting[c] || null]),
        money: Array.from({ length: kinds.length + 3 }, (_, i) => i + 1),
      })));
    } catch (e) { fail(e); }
  };
  return (
    <>
      <div className="desk-head">
        <h1>{t3('مصالحة آخر السنة', 'Year-end reconciliation', 'Réconciliation annuelle')}</h1>
        <button className="btn" onClick={exportIt}>Excel</button>
      </div>
      <div className="desk-filters">
        <button className="btn" onClick={() => setYear(year - 1)}>‹</button><span>{yearName(year)}</span><button className="btn" onClick={() => setYear(year + 1)}>›</button>
        <div className="cty-curs" style={{ margin: 0 }}>{CURS.map((c) => <button key={c} className={c === cur ? 'on' : ''} onClick={() => setCur(c)}>{curName(c, d.local)}</button>)}</div>
      </div>
      <div className="cty-card">
        <div className="cty-label">{t3('الخلاصة', 'In short', 'En résumé')} · {curName(cur, d.local)}</div>
        {r.map((x) => (
          <div key={x.ctyId} className="cty-office">
            <b>{nameOf(d, x.ctyId)}</b>
            <span className={x.end[cur] < 0 ? 'desk-alert' : x.end[cur] > 0 ? 'ok' : 'muted'}>
              {x.end[cur] < 0 ? t3(`عليها أن تدفع ${money(-x.end[cur], cur)}`, `must pay ${money(-x.end[cur], cur)}`, `doit payer ${money(-x.end[cur], cur)}`) : x.end[cur] > 0 ? t3(`لها ${money(x.end[cur], cur)}`, `is owed ${money(x.end[cur], cur)}`, `a ${money(x.end[cur], cur)} à recevoir`) : t3('لا شيء', 'nothing owed', 'rien à régler')}
            </span>
          </div>
        ))}
      </div>
      <details>
      <summary className="muted small" style={{ cursor: 'pointer', margin: '8px 0' }}>{t3('أرني التفصيل', 'Show the detail', 'Voir le détail')}</summary>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الجماعة', 'Community', 'Communauté')}</th><th className="num">{t3('من قبل', 'Before', 'Avant')}</th>{kinds.map((k) => <th key={k} className="num">{kindName(k)}</th>)}<th className="num">{t3('في النهاية', 'At the end', 'À la fin')}</th><th>{t3('أي', 'So', 'Donc')}</th><th className="num muted">{t3('بانتظار', 'Waiting', 'En attente')}</th></tr></thead>
          <tbody>
            {r.map((x) => (
              <tr key={x.ctyId}>
                <td><b>{nameOf(d, x.ctyId)}</b></td>
                <td className="num">{money(x.before[cur], cur)}</td>
                {kinds.map((k) => <td key={k} className="num">{v(x.byKind[k], cur) ? money(v(x.byKind[k], cur), cur) : ''}</td>)}
                <td className="num"><b className={x.end[cur] < 0 ? 'desk-alert' : ''}>{money(x.end[cur], cur)}</b></td>
                <td className="small">{x.end[cur] < 0 ? t3('تدفع', 'must pay', 'doit payer') : x.end[cur] > 0 ? t3('تطالب', 'can claim', 'peut réclamer') : '—'}</td>
                <td className="num muted">{x.waiting[cur] ? money(x.waiting[cur], cur) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>
      <p className="muted small">{t3('كل عملة على حدة. المطالبات التي لم يُقرَّر فيها لا تُحسب.', 'Each currency apart. Claims not yet decided are not counted.', 'Chaque monnaie à part. Les réclamations non décidées ne sont pas comptées.')}</p>
    </>
  );
}

// ---------------------------------------------------------------- totals by code (from the files)

function Totals({ d }: P) {
  const [year, setYear] = useState(latestYear(d));
  const [cur, setCur] = useState<Cur>('LOC');
  const files = d.months.filter((m) => yearOf(`${m.ym}-01`) === year);
  const ctys = d.ctys.filter((c) => files.some((f) => f.cty_id === c.id));
  const sum = new Map<string, Map<number, Money>>();
  for (const f of files) for (const [k, v] of Object.entries(f.file.totals)) {
    const byCty = sum.get(k) ?? new Map<number, Money>();
    const t = byCty.get(f.cty_id) ?? { LOC: 0, USD: 0, EUR: 0 };
    for (const c of CURS) t[c] += v[c];
    byCty.set(f.cty_id, t);
    sum.set(k, byCty);
  }
  const codes = [...sum.keys()].sort();
  // the year's expenses at a glance: by heading (the code under its family) and by community
  const headOf = (code: string): string => {
    let a = d.accounts.find((x) => x.code === code);
    while (a) {
      const p = d.accounts.find((x) => x.id === a!.parent_id);
      if (!p || p.parent_id == null) return a.code;
      a = p;
    }
    return code;
  };
  const byHead = new Map<string, number>();
  const byCty = new Map<number, number>();
  for (const [k, m] of sum) for (const [cid, v] of m) if (v[cur] < 0) {
    byHead.set(headOf(k), (byHead.get(headOf(k)) ?? 0) - v[cur]);
    byCty.set(cid, (byCty.get(cid) ?? 0) - v[cur]);
  }
  const exportIt = async () => {
    try {
      await exportExcel(`totals-${year}.xlsx`, CURS.map((c) => ({
        name: c === 'LOC' ? d.local : c,
        header: [t3('الرمز', 'Code', 'Code'), t3('البند', 'Line', 'Ligne'), ...ctys.map((x) => x.name), t3('البلد', 'Country', 'Pays')],
        rows: codes.map((k) => [k, codeName(k), ...ctys.map((x) => sum.get(k)!.get(x.id)?.[c] || null), ctys.reduce((n, x) => n + (sum.get(k)!.get(x.id)?.[c] ?? 0), 0) || null]),
        money: Array.from({ length: ctys.length + 1 }, (_, i) => i + 2),
      })));
    } catch (e) { fail(e); }
  };
  return (
    <>
      <div className="desk-head"><h1>{t3('المجاميع حسب الرمز', 'Totals by code', 'Totaux par code')}</h1><button className="btn" onClick={exportIt}>Excel</button></div>
      <div className="desk-filters">
        <button className="btn" onClick={() => setYear(year - 1)}>‹</button><span>{yearName(year)}</span><button className="btn" onClick={() => setYear(year + 1)}>›</button>
        <div className="cty-curs" style={{ margin: 0 }}>{CURS.map((c) => <button key={c} className={c === cur ? 'on' : ''} onClick={() => setCur(c)}>{curName(c, d.local)}</button>)}</div>
        <span className="muted small">{files.length} {t3('ملف', 'files', 'fichiers')}</span>
      </div>
      <p className="muted small">{t3('مجموع ما صرفته كل جماعة، من ملفاتها الشهرية، بحسب البند.', 'What each community spent, from its monthly files, by category.', 'Ce que chaque communauté a dépensé, d’après ses fichiers mensuels, par catégorie.')}</p>
      {byHead.size > 0 && (
        <div className="desk-two">
          <div className="cty-card">
            <div className="cty-label">{t3('النفقات حسب البند', 'Expenses by heading', 'Dépenses par rubrique')} · {curName(cur, d.local)}</div>
            <Ring parts={[...byHead.entries()].map(([k, v]) => ({ key: k, label: codeName(k), value: v }))} fmt={(n) => money(n, cur)} center={curName(cur, d.local)} />
          </div>
          <div className="cty-card">
            <div className="cty-label">{t3('النفقات حسب الجماعة', 'Expenses by community', 'Dépenses par communauté')} · {curName(cur, d.local)}</div>
            <Ring parts={[...byCty.entries()].map(([k, v]) => ({ key: k, label: nameOf(d, k), value: v }))} fmt={(n) => money(n, cur)} center={curName(cur, d.local)} />
          </div>
        </div>
      )}
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الرمز', 'Code', 'Code')}</th><th>{t3('البند', 'Line', 'Ligne')}</th>{ctys.map((x) => <th key={x.id} className="num">{x.name}</th>)}<th className="num">{t3('البلد', 'Country', 'Pays')}</th></tr></thead>
          <tbody>
            {codes.map((k) => (
              <tr key={k}><td className="muted small">{k}</td><td>{codeName(k)}</td>
                {ctys.map((x) => { const val = sum.get(k)!.get(x.id)?.[cur] ?? 0; return <td key={x.id} className="num">{val ? money(val, cur) : ''}</td>; })}
                <td className="num"><b>{money(ctys.reduce((n, x) => n + (sum.get(k)!.get(x.id)?.[cur] ?? 0), 0), cur)}</b></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- communities and return files

function Ctys({ s, d, reload }: P) {
  const rename = async (id: number, name: string, active: number) => {
    const n = await promptBox(t3('اسم الجماعة', 'Name of the community', 'Nom de la communauté'), name);
    if (!n) return;
    try { await s.api.call('country.cty.save', { id, name: n, active }); await reload(); } catch (e) { fail(e); }
  };
  const giveBack = async (id: number, name: string) => {
    try {
      const f = await s.api.call('country.return.build', { ctyId: id });
      const fname = `return-${name.replace(/[^\w؀-ۿ -]/g, '').trim()}-${todayIso()}.json`;
      await saveFile(fname, ['json'], new TextEncoder().encode(JSON.stringify(f, null, 1)), fname);
      toast(t3('ملف الرجوع جاهز: أرسله إلى الجماعة', 'The return file is ready: send it to the community', 'Le fichier de retour est prêt : envoyez-le à la communauté'));
    } catch (e) { fail(e); }
  };
  return (
    <>
      <div className="desk-head"><h1>{t3('الجماعات', 'Communities', 'Communautés')}</h1></div>
      <p className="muted">{t3('تُضاف كل جماعة تلقائياً عند أول ملف منها. ملف الرجوع يحمل قرارات المطالبات وحسابها عند الإيكونوماتو.', 'Each community is added by its first file. The return file carries the decisions on its claims and its account at the économat.', 'Chaque communauté est ajoutée par son premier fichier. Le fichier de retour porte les décisions sur ses réclamations et son compte à l’économat.')}</p>
      <div className="cty-card">
        <table className="desk-table">
          <thead><tr><th>{t3('الجماعة', 'Community', 'Communauté')}</th><th className="num">{t3('ملفات', 'Files', 'Fichiers')}</th><th>{t3('آخر شهر', 'Last month', 'Dernier mois')}</th><th className="num">{t3('مطالبات بانتظار', 'Claims waiting', 'Réclamations en attente')}</th><th /></tr></thead>
          <tbody>
            {d.ctys.map((c) => {
              const ms = d.months.filter((m) => m.cty_id === c.id).map((m) => m.ym).sort();
              return (
                <tr key={c.id} className={c.active ? '' : 'off'}>
                  <td><b>{c.name}</b></td><td className="num">{ms.length}</td><td>{ms.length ? monthName(ms[ms.length - 1]) : '—'}</td>
                  <td className="num">{d.claims.filter((x) => x.cty_id === c.id && x.status === 'waiting').length || ''}</td>
                  <td className="row" style={{ gap: 6 }}>
                    <button className="btn primary" onClick={() => giveBack(c.id, c.name)}>{t3('ملف الرجوع', 'Return file', 'Fichier de retour')}</button>
                    <button className="cty-link" onClick={() => rename(c.id, c.name, c.active)}>{t3('تغيير الاسم', 'rename', 'renommer')}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Settings({ onLang, onLogout, s, d, reload }: { onLang: () => void; onLogout: () => void } & P) {
  const lang = getLang();
  const [rate, setRate] = useState(String(d.rates.startRate));
  const [eur, setEur] = useState(d.rates.eurUsd ? String(d.rates.eurUsd) : '');
  const saveRates = async () => {
    try { await s.api.call('country.rates.save', { startRate: parseAmount(rate), eurUsd: eur.trim() ? parseAmount(eur) : null }); await reload(); toast(t3('حُفظ ✓', 'Saved ✓', 'Enregistré ✓')); } catch (e) { fail(e); }
  };
  const LANGS: { l: LangMode; label: string }[] = [{ l: 'en', label: 'English' }, { l: 'fr', label: 'Français' }, { l: 'ar', label: 'العربية' }, { l: 'both', label: 'عربي · English' }];
  return (
    <div className="desk-narrow">
      <h1>{t3('الإعدادات', 'Settings', 'Réglages')}</h1>
      <div className="cty-card">
        <div className="cty-label">{t3('اللغة', 'Language', 'Langue')}</div>
        <div className="cty-tiles small">{LANGS.map((x) => <button key={x.l} className={lang === x.l ? 'on' : ''} onClick={() => { setLang(x.l); onLang(); }}>{x.label}</button>)}</div>
      </div>
      <div className="cty-card">
        <div className="cty-label">{t3('أسعار التحويل إلى الدولار', 'Rates for the total in dollars', 'Taux pour le total en dollars')}</div>
        <p className="muted small">{t3('لعرض مجموع واحد بالدولار لكل العملات. تُستعمل في «النفقات بالتفصيل».', 'To show ONE total in dollars for all currencies. Used in “Expenses in detail”.', 'Pour afficher UN total en dollars pour toutes les monnaies. Utilisé dans « Dépenses en détail ».')}</p>
        <div className="desk-filters" style={{ marginBottom: 0 }}>
          <label>$1 = <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} style={{ width: 90 }} /> {curName('LOC', d.local)}</label>
          <label>€1 = $ <input inputMode="decimal" value={eur} onChange={(e) => setEur(e.target.value)} style={{ width: 90 }} placeholder="?" /></label>
          <button className="btn primary" onClick={saveRates}>{t3('احفظ', 'Save', 'Enregistrer')}</button>
        </div>
      </div>
      {s.mode !== 'preview' && has(s.profile, 'users.manage') && <GateCard server={s.mode === 'server'} />}
      <button className="btn" onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
    </div>
  );
}
