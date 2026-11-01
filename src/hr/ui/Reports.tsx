// The reports of HR (Fouad, 31 October 2026: "more flexible and dynamic, as the dynamic report of the accounts"). One
// explorer: choose what to measure (the monthly cost, the yearly cost, how many people, the hours, the cost of an hour)
// and how to group it (centre, position, project, donor, currency, year of arrival); click a bar to look inside it. The
// people behind the bars are listed below, with the columns one chooses, and everything shown goes to Excel. The cost
// of an hour stays private: only the Superior (hr.approve) can choose it.
import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import type { Session } from '../../state';
import { saveFile } from '../../platform';
import { fmtDate, todayIso } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import type { CentreKey } from '../../brand';
import type { HrData, HrPerson } from '../hr';
import type { HrPayData } from '../payOps';
import { hourlyWithThirteenth, payOn, yearlyCost } from '../pay';
import { allocOn, type HrAlloc } from '../stage4';
import { accountFor, centreAccounts } from '../link';
import { SortTh, TwoNames, centreOf, centreVars, fail, markOf, sortRows, usd, useSort } from './common';
import { GuideLink } from '../../guide/GuideView';

type Dim = 'centre' | 'position' | 'project' | 'donor' | 'currency' | 'year';
type Measure = 'monthly' | 'yearly' | 'people' | 'weekly' | 'hour';
type Col = 'centre' | 'nameAr' | 'name' | 'position' | 'agreed' | 'currency' | 'monthly' | 'yearly' | 'weekly' | 'hour' | 'hour13' | 'projects' | 'donors' | 'started' | 'agreementEnd' | 'phone';

/** one person's share in one project (a person paid by two projects is two facts; their shares add up to 100%) */
interface Fact { p: HrPerson; pct: number; project: string; donors: string[]; monthly: number | null; syp: number | null; weekly: number | null; hourly: number | null }

export function ReportsPage({ s, hr, pd, open, sup }: { s: Session; hr: HrData; pd: HrPayData; open: (p: HrPerson) => void; sup: boolean }) {
  const [allocs, setAllocs] = useState<HrAlloc[]>([]);
  useEffect(() => { s.api.call('hr.alloc.list', {}).then(setAllocs).catch(fail); }, [s]);
  const today = todayIso();
  const n = pd.settings.paymentsPerYear;
  const [measure, setMeasure] = useState<Measure>('monthly');
  const [dim, setDim] = useState<Dim>('centre');
  const [path, setPath] = useState<{ dim: Dim; value: string }[]>([]);
  const [cols, setCols] = useState<Col[]>(() => { try { const x = JSON.parse(localStorage.getItem('hr-report-cols') ?? 'null'); if (Array.isArray(x)) return x; } catch { /* */ } return ['centre', 'nameAr', 'name', 'position', 'agreed', 'monthly', 'yearly', 'weekly']; });
  const [pickCols, setPickCols] = useState(false);
  const sort = useSort<Col>('centre');

  const DIMS: Record<Dim, string> = {
    centre: t3('المركز', 'Centre', 'Centre'), position: t3('الوظيفة', 'Position', 'Poste'), project: t3('المشروع (الحساب)', 'Project (account)', 'Projet (compte)'),
    donor: t3('المانح', 'Donor', 'Bailleur'), currency: t3('عملة الاتفاقية', 'Currency agreed', "Devise de l'accord"), year: t3('سنة الوصول', 'Year of arrival', "Année d'arrivée"),
  };
  const MEASURES: [Measure, string][] = [
    ['monthly', t3('التكلفة الشهرية (USD)', 'Monthly cost (USD)', 'Coût mensuel (USD)')],
    ['yearly', t3(`التكلفة السنوية ×${n} (USD)`, `Yearly cost ×${n} (USD)`, `Coût annuel ×${n} (USD)`)],
    ['people', t3('عدد الأشخاص', 'Number of people', 'Nombre de personnes')],
    ['weekly', t3('ساعات الأسبوع (المعدل)', 'Hours a week (average)', 'Heures par semaine (moyenne)')],
    ...(sup ? [['hour', t3('تكلفة الساعة (المعدل، للرئيس)', 'Cost of an hour (average, Superior)', "Coût d'une heure (moyenne, Supérieur)")] as [Measure, string]] : []),
  ];
  const COLS: [Col, string, boolean?][] = [
    ['centre', t3('المركز', 'Centre', 'Centre')], ['nameAr', t3('الاسم بالعربية', 'Name (Arabic)', 'Nom (arabe)')], ['name', t3('الاسم بالإنكليزية', 'Name (English)', 'Nom (anglais)')],
    ['position', t3('الوظيفة', 'Position', 'Poste')], ['agreed', t3('كما في الاتفاقية', 'As agreed', "Selon l'accord")], ['currency', t3('العملة', 'Currency', 'Devise')],
    ['monthly', t3('شهرياً USD', 'Monthly USD', 'Mensuel USD')], ['yearly', t3(`سنوياً ×${n} USD`, `Yearly ×${n} USD`, `Annuel ×${n} USD`)], ['weekly', t3('س/أسبوع', 'h/week', 'h/sem')],
    ['hour', t3('تكلفة الساعة', 'Cost of an hour', "Coût d'une heure"), true], ['hour13', t3('الساعة مع الثالثة عشرة', 'Hour with the 13th', 'Heure avec le 13e'), true],
    ['projects', t3('المشاريع', 'Projects', 'Projets')], ['donors', t3('المانحون', 'Donors', 'Bailleurs')], ['started', t3('بدأ', 'Started', 'Début')],
    ['agreementEnd', t3('نهاية الاتفاقية', 'Agreement ends', "Fin de l'accord")], ['phone', t3('الهاتف', 'Phone', 'Téléphone')],
  ];
  const colsOk = COLS.filter(([, , priv]) => !priv || sup);
  const shownCols = cols.filter((c) => colsOk.some(([k]) => k === c));

  // the facts: every active person, divided between the projects that fund them
  const facts = useMemo<Fact[]>(() => hr.people.filter((p) => p.active).flatMap((p) => {
    const c = payOn(pd, p.id, today);
    const split = allocOn(allocs, p.id, today);
    const parts = split.length ? split.map((a) => ({ project: a.target, pct: a.pct })) : [{ project: accountFor(hr.lists, p) ?? '', pct: 100 }];
    return parts.map((a) => ({
      p, pct: a.pct, project: a.project,
      donors: (centreAccounts(hr.lists, p).find((x) => x.name.toLowerCase() === a.project.toLowerCase())?.donors ?? '').split(' | ').filter(Boolean),
      monthly: c?.monthly ?? null, syp: c?.syp ?? null, weekly: c?.weekly ?? null, hourly: c?.hourly ?? null,
    }));
  }), [hr, pd, allocs, today]);

  const keysOf = (f: Fact, d: Dim): string[] => {
    switch (d) {
      case 'centre': return [f.p.centre ?? ''];
      case 'position': return [f.p.role ?? ''];
      case 'project': return [f.project];
      case 'donor': return f.donors.length ? f.donors : [''];
      case 'currency': return [f.syp != null ? 'SYP' : f.monthly != null ? 'USD' : ''];
      case 'year': return [f.p.started?.slice(0, 4) ?? ''];
    }
  };
  const inPath = facts.filter((f) => path.every((x) => keysOf(f, x.dim).includes(x.value)));
  const valueOf = (xs: Fact[]): number | null => {
    const people = [...new Map(xs.map((f) => [f.p.id, f])).values()];
    const avg = (v: (f: Fact) => number | null) => { const ys = people.map(v).filter((y): y is number => y != null); return ys.length ? Math.round((ys.reduce((a, y) => a + y, 0) / ys.length) * 100) / 100 : null; };
    switch (measure) {
      case 'monthly': return Math.round(xs.reduce((a, f) => a + ((f.monthly ?? 0) * f.pct) / 100, 0) * 100) / 100;
      case 'yearly': return Math.round(xs.reduce((a, f) => a + (yearlyCost(f.monthly ?? 0, n) * f.pct) / 100, 0) * 100) / 100;
      case 'people': return people.length;
      case 'weekly': return avg((f) => f.weekly);
      case 'hour': return avg((f) => f.hourly);
    }
  };
  const groups = useMemo(() => {
    const m = new Map<string, Fact[]>();
    for (const f of inPath) for (const k of keysOf(f, dim)) m.set(k, [...(m.get(k) ?? []), f]);
    return [...m.entries()].map(([key, xs]) => ({ key, xs, value: valueOf(xs) ?? 0 })).sort((a, b) => b.value - a.value);
  }, [inPath, dim, measure]);
  const max = Math.max(1, ...groups.map((g) => g.value));
  const fmtV = (v: number | null) => (v == null ? '—' : measure === 'people' ? String(v) : usd(v));
  const label = (d: Dim, k: string) => (k ? (d === 'position' && hr.positionsAr[k] ? `${hr.positionsAr[k]} · ${k}` : k) : t3('— بلا —', '— none —', '— aucun —'));
  const nextDim = (used: Dim[]): Dim => (['centre', 'position', 'project', 'donor', 'currency', 'year'] as Dim[]).find((d) => !used.includes(d)) ?? 'position';
  const drill = (k: string) => { const p2 = [...path, { dim, value: k }]; setPath(p2); setDim(nextDim(p2.map((x) => x.dim))); };
  const keyOfCentre = (name: string) => centreOf(hr, { centre: name || null }).key;

  // the people behind what is shown (one line each; their shares joined)
  const people = useMemo(() => {
    const by = new Map<number, Fact[]>();
    for (const f of inPath) by.set(f.p.id, [...(by.get(f.p.id) ?? []), f]);
    return [...by.values()].map((fs) => {
      const f = fs[0];
      const ag = hr.papers.filter((x) => x.person_id === f.p.id && x.kind === 'agreement' && (!x.start_date || x.start_date <= today) && (!x.end_date || x.end_date >= today))[0];
      const v: Record<Col, string | number | null> = {
        centre: f.p.centre, nameAr: f.p.name_ar, name: [f.p.first_name, f.p.last_name].filter(Boolean).join(' ') || f.p.name, position: f.p.role ? (hr.positionsAr[f.p.role] ? `${hr.positionsAr[f.p.role]} · ${f.p.role}` : f.p.role) : null,
        agreed: f.syp ?? f.monthly, currency: f.syp != null ? 'SYP' : f.monthly != null ? 'USD' : null, monthly: f.monthly, yearly: f.monthly != null ? yearlyCost(f.monthly, n) : null, weekly: f.weekly,
        hour: f.hourly, hour13: f.monthly != null ? hourlyWithThirteenth(f.monthly, f.weekly, n) : null,
        projects: fs.map((x) => (x.pct < 100 ? `${x.project} ${x.pct}%` : x.project)).join(' · '), donors: [...new Set(fs.flatMap((x) => x.donors))].join(' · '),
        started: f.p.started, agreementEnd: ag?.end_date ?? null, phone: f.p.phone,
      };
      return { p: f.p, v };
    });
  }, [inPath, hr, n, today]);
  const rows = sortRows(people, (r) => r.v[sort.key], sort.dir);
  const NUM: Col[] = ['agreed', 'monthly', 'yearly', 'weekly', 'hour', 'hour13'];
  const cell = (c: Col, v: string | number | null) => (v == null || v === '' ? '—' : c === 'started' || c === 'agreementEnd' ? fmtDate(String(v)) : typeof v === 'number' ? usd(v) : v);
  const setColsKeep = (c: Col[]) => { setCols(c); try { localStorage.setItem('hr-report-cols', JSON.stringify(c)); } catch { /* */ } };
  const title = [MEASURES.find(([k]) => k === measure)?.[1], t3('حسب', 'by', 'par'), DIMS[dim]].join(' ');

  const download = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Summary');
    ws.addRow([`${title} · ${today}`]).font = { bold: true, size: 13 };
    if (path.length) ws.addRow([path.map((x) => `${DIMS[x.dim]}: ${label(x.dim, x.value)}`).join(' › ')]).font = { italic: true };
    ws.addRow([]);
    const h = ws.addRow([DIMS[dim], MEASURES.find(([k]) => k === measure)?.[1] ?? '']);
    h.font = { bold: true };
    const first = ws.rowCount + 1;
    for (const g of groups) ws.addRow([label(dim, g.key), g.value]);
    if (measure === 'monthly' || measure === 'yearly' || measure === 'people') ws.addRow(['Total', { formula: `SUM(B${first}:B${ws.rowCount})`, result: groups.reduce((a, g) => a + g.value, 0) }]).font = { bold: true };
    ws.columns = [{ width: 36 }, { width: 22 }];
    ws.getColumn(2).numFmt = measure === 'people' ? '0' : '#,##0.00';
    if (dim === 'donor') ws.addRow(['A project with several donors is counted under each of them.']).font = { italic: true, color: { argb: 'FF8A8577' } };
    const wp = wb.addWorksheet('People');
    const head = wp.addRow(shownCols.map((c) => COLS.find(([k]) => k === c)?.[1] ?? c));
    head.font = { bold: true };
    head.eachCell((x) => { x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEAE0' } }; });
    for (const r of rows) wp.addRow(shownCols.map((c) => r.v[c] ?? null));
    const last = wp.rowCount;
    wp.addRow(shownCols.map((c, i) => (i === 0 ? 'Total' : c === 'monthly' || c === 'yearly' ? { formula: `SUBTOTAL(9,${String.fromCharCode(65 + i)}2:${String.fromCharCode(65 + i)}${last})` } : null))).font = { bold: true };
    wp.columns = shownCols.map((c) => ({ width: c === 'nameAr' || c === 'name' || c === 'position' || c === 'projects' || c === 'donors' ? 28 : 14 }));
    shownCols.forEach((c, i) => { if (NUM.includes(c)) wp.getColumn(i + 1).numFmt = '#,##0.00'; });
    wp.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: shownCols.length } };
    wp.views = [{ state: 'frozen', ySplit: 1 }];
    await saveFile(`HR-report-${today}.xlsx`, ['xlsx'], new Uint8Array(await wb.xlsx.writeBuffer()), 'Excel');
  };

  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('اختر ما تقيسه وكيف تجمعه', 'Choose what to measure and how to group it', 'Choisissez quoi mesurer et comment regrouper')}</div><h1>{t3('التقارير', 'Reports', 'Rapports')}<GuideLink id="hr-funding" /></h1></div>
        <button className="btn gold" onClick={() => void download()}>⬇ {t3('Excel لما يظهر', 'Excel of what is shown', 'Excel de ce qui est affiché')}</button>
      </div>
      <div className="hr-explore">
        <select value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>{MEASURES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="muted">{t3('حسب', 'by', 'par')}</span>
        <select value={dim} onChange={(e) => setDim(e.target.value as Dim)}>{(Object.keys(DIMS) as Dim[]).map((k) => <option key={k} value={k}>{DIMS[k]}</option>)}</select>
      </div>
      <div className="hr-crumbs">
        <button onClick={() => { setPath([]); setDim('centre'); }}>{t3('الكل', 'Everything', 'Tout')}</button>
        {path.map((x, i) => <span key={i}>› <button onClick={() => { setPath(path.slice(0, i + 1)); setDim(nextDim(path.slice(0, i + 1).map((y) => y.dim))); }}>{DIMS[x.dim]}: {label(x.dim, x.value)}</button></span>)}
      </div>
      <div className="hr-panel" style={{ marginBottom: 14 }}>
        <b>{title}</b>
        <div className="hr-bars" style={{ marginTop: 10 }}>
          {groups.map((g) => (
            <button key={g.key} onClick={() => drill(g.key)} style={dim === 'centre' ? centreVars(keyOfCentre(g.key) as CentreKey) : undefined} title={t3('اضغط لترى ما بداخله', 'Click to look inside', "Cliquez pour voir l'intérieur")}>
              <span className="row" style={{ gap: 6 }}>{dim === 'centre' && <img src={markOf(keyOfCentre(g.key) as CentreKey)} alt="" style={{ height: 18 }} />}{label(dim, g.key)} <span className="muted small">({new Set(g.xs.map((f) => f.p.id)).size})</span></span>
              <span className="track"><i style={{ width: `${(g.value * 100) / max}%` }} /></span>
              <span className="v">{fmtV(g.value)}</span>
            </button>
          ))}
          {!groups.length && <p className="muted">{t3('لا شيء.', 'Nothing.', 'Rien.')}</p>}
        </div>
        {(measure === 'monthly' || measure === 'yearly' || measure === 'people') && groups.length > 0 && dim !== 'donor' && <p style={{ marginBottom: 0 }}><b>{t3('المجموع', 'Total', 'Total')}: {fmtV(valueOf(inPath))}</b>{measure !== 'people' ? ' USD' : ''}</p>}
        {dim === 'donor' && <p className="muted small">{t3('مشروع له عدة مانحين يُحسب تحت كل واحد منهم.', 'A project with several donors is counted under each of them.', 'Un projet avec plusieurs bailleurs est compté sous chacun.')}</p>}
        {pd.settings.rateSyp === 0 && Object.keys(pd.settings.rates ?? {}).length === 0 && facts.some((f) => f.syp != null) && <p className="desk-alert small">{t3('من بالليرة لا يدخلون في المبالغ: لا سعر دولار.', 'Those paid in pounds are not in the amounts: no dollar rate.', 'Ceux payés en livres ne sont pas dans les montants : pas de taux.')}</p>}
      </div>
      <div className="hr-panel desk-scroll">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <b>{t3('الأشخاص', 'The people', 'Les personnes')} · {rows.length}</b>
          <button className="btn small" onClick={() => setPickCols(!pickCols)}>☷ {t3('الأعمدة…', 'Columns…', 'Colonnes…')}</button>
        </div>
        {pickCols && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '8px 0', padding: 8, background: '#FBF7EE', borderRadius: 8 }}>
            {colsOk.map(([k, l]) => <label key={k} className="row" style={{ gap: 4 }}><input type="checkbox" checked={shownCols.includes(k)} onChange={(e) => setColsKeep(e.target.checked ? COLS.map(([c]) => c).filter((c) => c === k || shownCols.includes(c)) : shownCols.filter((c) => c !== k))} />{l}</label>)}
          </div>
        )}
        <table className="desk-table" style={{ marginTop: 6 }}>
          <thead><tr>{shownCols.map((c) => <SortTh key={c} k={c} sort={sort} n={NUM.includes(c)}>{COLS.find(([k]) => k === c)?.[1]}</SortTh>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.p.id} className="click" onClick={() => open(r.p)} style={centreVars(centreOf(hr, r.p).key)}>
                {shownCols.map((c) => <td key={c} className={NUM.includes(c) ? 'n' : ''}>{c === 'nameAr' && !r.v.nameAr ? <TwoNames p={r.p} /> : c === 'agreed' && r.v.agreed != null ? `${usd(Number(r.v.agreed))} ${r.v.currency ?? ''}` : cell(c, r.v[c])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{t3('المبالغ بالدولار؛ المكافأة بالليرة تُحسب بسعر مركزها. السنوي = الشهري × عدد الدفعات.', "Amounts in dollars; a stipend in pounds is counted at its centre's rate. Yearly = monthly × the number of payments.", 'Montants en dollars ; une gratification en livres est comptée au taux de son centre. Annuel = mensuel × le nombre de paiements.')}{sup ? ` ${t3('الساعة = شهري × 12 ÷ (ساعات الأسبوع × 52).', 'Hour = monthly × 12 ÷ (hours a week × 52).', 'Heure = mensuel × 12 ÷ (heures par semaine × 52).')}` : ''}</p>
      </div>
    </>
  );
}
