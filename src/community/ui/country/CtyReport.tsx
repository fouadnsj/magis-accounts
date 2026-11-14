// The country econome's report by community (Fouad, 14 November 2026): "he deals with the communities as books":
// a general view first (each community: personal expenses, house, income, per member), then he goes deeper into one
// community (its headings, then the lines of a heading), month by month, for any period. Never a person: the
// communities' files hold the members' personal expenses together, not each Jesuit's.
import { Fragment, useMemo, useState } from 'react';
import { errText, toast, todayIso } from '../../../ui/kit';
import type { CountryData } from '../../country';
import { CURS, monthsOfYear, totalUsd, yearOf, zero, type CtyAccount, type Cur, type Money, type Rates } from '../../domain';
import { Columns, Ring, SHADES } from '../charts';
import { iconOf } from '../icons';
import { accName, curName, money, monthName, periodName, t3, yearName } from '../text';
import { exportExcel } from '../desk/excel';

type Part = 'all' | 'personal' | 'house';
type View = 'ctys' | 'cat' | 'months';

export function CtyReport({ d }: { d: CountryData }) {
  const today = todayIso();
  const latest = d.months.map((m) => m.ym).sort().pop() ?? today.slice(0, 7);
  const yr = monthsOfYear(yearOf(`${latest}-01`));
  const [from, setFrom] = useState(yr[0]);
  const [to, setTo] = useState(latest);
  const [cur, setCur] = useState<Cur | 'ALL'>('ALL');
  const [part, setPart] = useState<Part>('all');
  const [view, setView] = useState<View>('ctys');
  const [ctys, setCtys] = useState<number[]>([]);
  const [heads, setHeads] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  const rates: Rates = { loc: d.rates.startRate > 0 ? 1 / d.rates.startRate : null, eur: d.rates.eurUsd };
  const val = (m: Money | undefined) => (!m ? 0 : cur === 'ALL' ? totalUsd(m, rates).usd : m[cur]);
  const fmt = (n: number) => money(n, cur === 'ALL' ? 'USD' : cur);
  const unit = cur === 'ALL' ? t3('≈ $ (كل العملات)', '≈ $ (all currencies)', '≈ $ (toutes monnaies)') : curName(cur, d.local);
  const byCode = useMemo(() => new Map(d.accounts.map((a) => [a.code, a])), [d.accounts]);
  const depth = (a: CtyAccount) => { let n = 0; for (let p = a.parent_id; p != null; p = d.accounts.find((x) => x.id === p)?.parent_id ?? null) n++; return n; };
  const headOf = (a: CtyAccount | undefined): CtyAccount | undefined => {
    let x = a;
    while (x && depth(x) > 1) x = d.accounts.find((p) => p.id === x!.parent_id);
    return x && depth(x) === 1 ? x : undefined;
  };

  const months = useMemo(() => {
    const out: string[] = [];
    const [a, b] = from <= to ? [from, to] : [to, from];
    for (let m = a; m <= b && out.length < 60; m = shift(m, 1)) out.push(m);
    return out;
  }, [from, to]);
  const active = d.ctys.filter((c) => c.active);
  const shown = ctys.length ? active.filter((c) => ctys.includes(c.id)) : active;

  /** one file's amounts by code for the part chosen (null: the file has no parts, made before 14 November 2026) */
  const codesOf = (f: CountryData['months'][number]['file'], p: Part): Record<string, Money> | null =>
    p === 'all' ? f.totals : f.parts ? f.parts[p] : null;

  // expenses (positive) and income, by community, month and line; and which months lack the parts
  const data = useMemo(() => {
    const exp = new Map<string, Map<number, Money>>(); // key `${cty}:${ym}`
    const inc = new Map<string, Money>();
    const noParts = new Set<string>();
    for (const f of d.months) {
      if (!months.includes(f.ym)) continue;
      const k = `${f.cty_id}:${f.ym}`;
      const codes = codesOf(f.file, part);
      if (!codes) { noParts.add(k); continue; }
      const lines = new Map<number, Money>();
      const income = zero();
      for (const [code, v] of Object.entries(codes)) {
        const a = byCode.get(code);
        if (!a) continue;
        if (a.type === 'Exp') lines.set(a.id, { LOC: -v.LOC, USD: -v.USD, EUR: -v.EUR });
        else if (a.type === 'Income') for (const c of CURS) income[c] += v[c];
      }
      exp.set(k, lines);
      inc.set(k, income);
    }
    return { exp, inc, noParts };
  }, [d.months, months, part, byCode]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the expenses of some communities and months, of one heading (or the chosen ones), of one line */
  const sum = (cs: { id: number }[], ms: string[], headId: number | null, lineId: number | null = null) => {
    let n = 0;
    for (const c of cs) for (const m of ms) for (const [id, v] of data.exp.get(`${c.id}:${m}`) ?? []) {
      if (lineId != null && id !== lineId) continue;
      const h = headOf(d.accounts.find((a) => a.id === id));
      if (!h) continue;
      if (headId != null ? h.id !== headId : heads.length && !heads.includes(h.id)) continue;
      n += val(v);
    }
    return n;
  };
  const income = (cs: { id: number }[], ms: string[]) => cs.reduce((n, c) => n + ms.reduce((k, m) => k + val(data.inc.get(`${c.id}:${m}`)), 0), 0);
  /** the parts of a community over the period, whatever the part chosen above */
  const partOf = (c: { id: number }, p: 'personal' | 'house') => {
    let n = 0;
    let missing = false;
    for (const f of d.months) {
      if (f.cty_id !== c.id || !months.includes(f.ym)) continue;
      if (!f.file.parts) { missing = true; continue; }
      for (const [code, v] of Object.entries(f.file.parts[p])) {
        const a = byCode.get(code);
        if (a?.type !== 'Exp') continue;
        if (heads.length && !heads.includes(headOf(a)?.id ?? -1)) continue;
        n -= val(v);
      }
    }
    return { n, missing };
  };
  const membersOf = (c: { id: number }) => {
    const fs = d.months.filter((f) => f.cty_id === c.id && months.includes(f.ym));
    return fs.length ? fs[fs.length - 1].file.members : 0;
  };

  const usedHeads = useMemo(() => {
    const ids = new Set<number>();
    for (const lines of data.exp.values()) for (const id of lines.keys()) { const h = headOf(d.accounts.find((a) => a.id === id)); if (h) ids.add(h.id); }
    return d.accounts.filter((a) => ids.has(a.id));
  }, [data, d.accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const headsShown = heads.length ? usedHeads.filter((h) => heads.includes(h.id)) : usedHeads;
  const total = sum(shown, months, null);
  const toggle = <T,>(list: T[], x: T, set: (l: T[]) => void) => set(list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const isYear = months.length === 12 && months[0].endsWith('-10');
  const title = isYear ? yearName(Number(months[0].slice(0, 4))) : periodName(months.length === 3 && ['10', '01', '04', '07'].includes(months[0].slice(5)) ? months : [months[0], ...(months.length > 1 ? [months[months.length - 1]] : [])]);
  const missingParts = part !== 'all' && data.noParts.size > 0;
  const anyMissing = shown.some((c) => partOf(c, 'personal').missing);
  const headName = (h: CtyAccount) => `${iconOf(h.code)} ${accName(h)}`;
  const parts = headsShown.map((h) => ({ key: h.id, label: headName(h), value: sum(shown, months, h.id) }));
  const opened = open != null ? d.accounts.find((a) => a.id === open) : undefined;
  const openedLines = opened ? d.accounts.filter((a) => a.id !== opened.id && headOf(a)?.id === opened.id)
    .map((a) => ({ a, v: sum(shown, months, opened.id, a.id) })).filter((x) => x.v).sort((x, z) => z.v - x.v) : [];
  const preset = (a: string, b: string) => { setFrom(a); setTo(b); };
  const firstYm = d.months.reduce((mn, f) => (f.ym < mn ? f.ym : mn), latest);

  const exportIt = async () => {
    try {
      await exportExcel(`communities-${months[0]}_${months[months.length - 1]}.xlsx`, [
        {
          name: t3('الجماعات', 'Communities', 'Communautés'),
          header: [t3('الجماعة', 'Community', 'Communauté'), t3('الأعضاء', 'Members', 'Membres'), t3('النفقات الشخصية', 'Personal expenses', 'Dépenses personnelles'), t3('البيت', 'House', 'Maison'), t3('مجموع النفقات', 'Total expenses', 'Total dépenses'), t3('الدخل', 'Income', 'Revenus')],
          rows: shown.map((c) => [c.name, membersOf(c), partOf(c, 'personal').n || null, partOf(c, 'house').n || null, sum([c], months, null) || null, income([c], months) || null]),
          money: [2, 3, 4, 5],
        },
        {
          name: t3('حسب البند', 'By category', 'Par catégorie'),
          header: [t3('البند', 'Heading', 'Rubrique'), ...shown.map((c) => c.name), t3('المجموع', 'Total', 'Total')],
          rows: headsShown.map((h) => [accName(h), ...shown.map((c) => sum([c], months, h.id) || null), sum(shown, months, h.id) || null]),
          money: Array.from({ length: shown.length + 1 }, (_, i) => i + 1),
        },
      ]);
    } catch (e) { toast(errText(e), true); }
  };

  return (
    <div className="cty-report">
      <div className="desk-head">
        <h1>{t3('تقرير الجماعات', 'Communities report', 'Rapport des communautés')} · {title}</h1>
        <button className="btn" onClick={exportIt}>Excel</button>
      </div>
      <p className="muted small">{t3('كل جماعة كدفتر: نظرة عامة، ثم التفاصيل. النفقات الشخصية معاً لكل جماعة، لا تفاصيل أي شخص.', "Each community as a book: a general view, then the details. The personal expenses of each community together, never a person's detail.", "Chaque communauté comme un compte : une vue générale, puis le détail. Les dépenses personnelles de chaque communauté ensemble, jamais le détail d'une personne.")}</p>

      <div className="cty-card rep-controls">
        <div className="rep-row">
          <span className="cty-label">{t3('الفترة', 'Period', 'Période')}</span>
          <button className={`chip ${from === latest && to === latest ? 'on' : ''}`} onClick={() => preset(latest, latest)}>{t3('آخر شهر', 'Last month received', 'Dernier mois reçu')}</button>
          <button className={`chip ${from === yr[0] && to === latest ? 'on' : ''}`} onClick={() => preset(yr[0], latest)}>{t3('هذه السنة (من تشرين الأول)', 'This year (from October)', 'Cette année (depuis octobre)')}</button>
          <button className={`chip ${from === firstYm && to === latest ? 'on' : ''}`} onClick={() => preset(firstYm, latest)}>{t3('منذ البداية', 'The whole time', 'Depuis le début')}</button>
          <span className="rep-fromto">
            {t3('من', 'From', 'De')} <input type="month" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            {' '}{t3('إلى', 'to', 'à')} <input type="month" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </span>
        </div>
        <div className="rep-row">
          <span className="cty-label">{t3('العملة', 'Currency', 'Monnaie')}</span>
          {(['ALL', ...CURS] as (Cur | 'ALL')[]).map((c) => <button key={c} className={`chip ${cur === c ? 'on' : ''}`} onClick={() => setCur(c)}>{c === 'ALL' ? t3('الكل ≈ $', 'All ≈ $', 'Tout ≈ $') : curName(c, d.local)}</button>)}
        </div>
        <div className="rep-row">
          <span className="cty-label">{t3('أي نفقات', 'Which expenses', 'Quelles dépenses')}</span>
          {([['all', t3('الكل', 'All', 'Toutes')], ['personal', t3('الشخصية (الأعضاء معاً)', 'Personal (the members together)', 'Personnelles (les membres ensemble)')], ['house', t3('البيت', 'The house', 'La maison')]] as [Part, string][]).map(([p, l]) => (
            <button key={p} className={`chip ${part === p ? 'on' : ''}`} onClick={() => setPart(p)}>{l}</button>
          ))}
        </div>
        <div className="rep-row">
          <span className="cty-label">{t3('الجماعات', 'Communities', 'Communautés')}</span>
          <button className={`chip ${!ctys.length ? 'on' : ''}`} onClick={() => setCtys([])}>{t3('كلها', 'All', 'Toutes')}</button>
          {active.map((c) => <button key={c.id} className={`chip ${ctys.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(ctys, c.id, setCtys)}>{c.name}</button>)}
        </div>
        {usedHeads.length > 0 && (
          <div className="rep-row">
            <span className="cty-label">{t3('البنود', 'Headings', 'Rubriques')}</span>
            <button className={`chip ${!heads.length ? 'on' : ''}`} onClick={() => setHeads([])}>{t3('الكل', 'All', 'Toutes')}</button>
            {usedHeads.map((h) => <button key={h.id} className={`chip ${heads.includes(h.id) ? 'on' : ''}`} onClick={() => toggle(heads, h.id, setHeads)}>{headName(h)}</button>)}
          </div>
        )}
      </div>
      {(missingParts || anyMissing) && <div className="alert info">{t3('بعض الأشهر أُرسلت قبل ١٤ تشرين الثاني ٢٠٢٦، بلا فصل بين الشخصي والبيت. اطلب من الجماعة أن ترسلها مرة أخرى (القرارات المتخذة تبقى).', 'Some months were sent before 14 November 2026, without personal and house apart. Ask the community to send them again (the decisions already taken stay).', "Certains mois ont été envoyés avant le 14 novembre 2026, sans séparer personnel et maison. Demandez à la communauté de les renvoyer (les décisions déjà prises restent).")}</div>}

      <div className="desk-tabs" role="tablist">
        <button role="tab" className={view === 'ctys' ? 'on' : ''} onClick={() => setView('ctys')}>{t3('الجماعات جنباً إلى جنب', 'Communities side by side', 'Communautés côte à côte')}</button>
        <button role="tab" className={view === 'cat' ? 'on' : ''} onClick={() => setView('cat')}>{t3('حسب البند', 'By category', 'Par catégorie')}</button>
        <button role="tab" className={view === 'months' ? 'on' : ''} onClick={() => setView('months')}>{t3('شهراً بشهر', 'Month by month', 'Mois par mois')}</button>
      </div>

      {view === 'ctys' && (
        <div className="cty-card desk-scroll">
          <table className="desk-table">
            <thead><tr>
              <th>{t3('الجماعة', 'Community', 'Communauté')}</th><th className="num">{t3('الأعضاء', 'Members', 'Membres')}</th>
              <th className="num">{t3('النفقات الشخصية', 'Personal expenses', 'Dépenses personnelles')}</th><th className="num">{t3('للعضو', 'a member', 'par membre')}</th>
              <th className="num">{t3('البيت', 'House', 'Maison')}</th><th className="num">{t3('مجموع النفقات', 'Total expenses', 'Total dépenses')}</th>
              <th className="num">{t3('معدّل الشهر', 'Average a month', 'Moyenne par mois')}</th><th className="num">{t3('الدخل', 'Income', 'Revenus')}</th>
            </tr></thead>
            <tbody>
              {shown.map((c) => {
                const p = partOf(c, 'personal');
                const h = partOf(c, 'house');
                const t = sum([c], months, null);
                const n = membersOf(c);
                return (
                  <tr key={c.id} className="click" onClick={() => { setCtys([c.id]); setView('cat'); }} title={t3('اضغط لترى تفاصيل الجماعة', 'Click to see the community in detail', 'Cliquez pour voir la communauté en détail')}>
                    <td><b>{c.name}</b></td><td className="num">{n || '—'}</td>
                    <td className="num">{p.missing && !p.n ? <span className="muted">?</span> : fmt(p.n)}</td><td className="num muted">{n && p.n ? fmt(p.n / n) : '-'}</td>
                    <td className="num">{h.missing && !h.n ? <span className="muted">?</span> : fmt(h.n)}</td>
                    <td className="num"><b>{fmt(t)}</b></td><td className="num muted">{fmt(t / months.length)}</td>
                    <td className="num">{fmt(income([c], months))}</td>
                  </tr>
                );
              })}
              <tr className="fdc-total">
                <td>{t3('المجموع', 'Total', 'Total')}</td><td className="num">{shown.reduce((n, c) => n + membersOf(c), 0)}</td>
                <td className="num">{fmt(shown.reduce((n, c) => n + partOf(c, 'personal').n, 0))}</td><td />
                <td className="num">{fmt(shown.reduce((n, c) => n + partOf(c, 'house').n, 0))}</td>
                <td className="num">{fmt(total)}</td><td className="num">{fmt(total / months.length)}</td><td className="num">{fmt(income(shown, months))}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">{t3('اضغط على جماعة لترى نفقاتها حسب البند. «للعضو»: النفقات الشخصية مقسومة على عدد الأعضاء.', 'Click a community to see its expenses by category. "A member": the personal expenses divided by the number of members.', 'Cliquez sur une communauté pour voir ses dépenses par catégorie. « Par membre » : les dépenses personnelles divisées par le nombre de membres.')}</p>
        </div>
      )}

      {view === 'cat' && (total === 0 ? <div className="cty-card"><p className="muted">{t3('لا نفقات في هذه الفترة.', 'No expenses in this period.', 'Aucune dépense sur cette période.')}</p></div> : (
        <div className="desk-two">
          <div className="cty-card">
            <div className="cty-label">{shown.length === 1 ? shown[0].name : t3('الجماعات المختارة', 'The communities chosen', 'Les communautés choisies')} · {unit}</div>
            <Ring parts={parts} fmt={fmt} center={unit} onPick={(p) => setOpen(typeof p.key === 'number' ? (open === p.key ? null : p.key) : null)} />
          </div>
          <div className="cty-card desk-scroll">
            <table className="desk-table">
              <thead><tr><th>{t3('البند', 'Heading', 'Rubrique')}</th>{shown.length > 1 && shown.length <= 6 && shown.map((c) => <th key={c.id} className="num">{c.name}</th>)}<th className="num">{unit}</th><th className="num">%</th></tr></thead>
              <tbody>
                {parts.filter((p) => p.value).sort((a, b) => b.value - a.value).map((p) => (
                  <Fragment key={p.key}>
                    <tr className={`click ${open === p.key ? 'picked' : ''}`} onClick={() => setOpen(open === p.key ? null : (p.key as number))}>
                      <td><b>{p.label}</b></td>
                      {shown.length > 1 && shown.length <= 6 && shown.map((c) => <td key={c.id} className="num">{fmt(sum([c], months, p.key as number))}</td>)}
                      <td className="num">{fmt(p.value)}</td><td className="num">{Math.round((p.value / total) * 100)}%</td>
                    </tr>
                    {open === p.key && openedLines.map((l) => (
                      <tr key={l.a.id} className="fdc-line"><td>{l.a.code} {accName(l.a)}</td>
                        {shown.length > 1 && shown.length <= 6 && shown.map((c) => <td key={c.id} className="num muted">{fmt(sum([c], months, p.key as number, l.a.id))}</td>)}
                        <td className="num">{fmt(l.v)}</td><td className="num muted">{Math.round((l.v / p.value) * 100)}%</td></tr>
                    ))}
                  </Fragment>
                ))}
                <tr className="fdc-total"><td>{t3('المجموع', 'Total', 'Total')}</td>{shown.length > 1 && shown.length <= 6 && shown.map((c) => <td key={c.id} className="num">{fmt(sum([c], months, null))}</td>)}<td className="num">{fmt(total)}</td><td className="num">100%</td></tr>
              </tbody>
            </table>
            <p className="muted small">{t3('اضغط على بند لترى خطوطه.', 'Click a heading to see its lines.', 'Cliquez sur une rubrique pour voir ses lignes.')}</p>
          </div>
        </div>
      ))}

      {view === 'months' && (
        <>
          <div className="cty-card">
            <div className="cty-label">{t3('النفقات شهراً بشهر', 'Expenses month by month', 'Dépenses mois par mois')} · {unit}</div>
            <Columns cols={months.map((m) => ({ label: monthName(m, true).slice(0, 3), title: monthName(m), now: sum(shown, [m], null), before: sum(shown, [shift(m, -12)], null) || undefined }))} fmt={(n) => `${fmt(n)} ${unit}`} />
            <div className="muted small"><i className="cty-key now" /> {t3('هذه الفترة', 'this period', 'cette période')} · <i className="cty-key before" /> {t3('قبل سنة', 'a year before', 'un an avant')}</div>
          </div>
          <div className="cty-card desk-scroll">
            <table className="desk-table">
              <thead><tr><th>{t3('الشهر', 'Month', 'Mois')}</th>{shown.map((c, i) => <th key={c.id} className="num"><i className="rep-dot" style={{ background: SHADES[i % SHADES.length] }} /> {c.name}</th>)}<th className="num">{t3('المجموع', 'Total', 'Total')}</th></tr></thead>
              <tbody>
                {months.map((m) => <tr key={m}><td>{monthName(m)}</td>{shown.map((c) => <td key={c.id} className="num">{d.months.some((f) => f.cty_id === c.id && f.ym === m) ? fmt(sum([c], [m], null)) : <span className="muted" title={t3('لم يصل الملف', 'file not received', 'fichier non reçu')}>·</span>}</td>)}<td className="num"><b>{fmt(sum(shown, [m], null))}</b></td></tr>)}
                <tr className="fdc-total"><td>{t3('المجموع', 'Total', 'Total')}</td>{shown.map((c) => <td key={c.id} className="num">{fmt(sum([c], months, null))}</td>)}<td className="num">{fmt(total)}</td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const shift = (ym: string, k: number) => {
  const [y, mo] = ym.split('-').map(Number);
  const t = y * 12 + (mo - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
