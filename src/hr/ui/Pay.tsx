// The salary scale (Fouad, 30 October 2026): each position has ONE reference monthly amount, a suggestion when an
// agreement is made. The stipend itself is fixed in each person's agreement at its beginning, and can change from a
// date in the middle of the year. Totals are in dollars; the cost of an hour is private (Reports, the Superior only).
import { Fragment, useCallback, useEffect, useState } from 'react';
import { has } from '../../auth';
import type { Session } from '../../state';
import { Field, Modal, confirmBox, toast, todayIso } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import type { HrData, HrPerson } from '../hr';
import type { HrGrade, HrPayData } from '../payOps';
import { monthlyHours, payOn, yearlyCost } from '../pay';
import { SortTh, TwoNames, centreLabel, centreOf, centreVars, codeOf, fail, markOf, centreChoices, sortRows, usd, useSort } from './common';
import { GuideLink } from '../../guide/GuideView';

export { payOn };

function usePayData(s: Session) {
  const [d, setD] = useState<HrPayData | null>(null);
  const reload = useCallback(async () => { try { setD(await s.api.call('hr.pay.data', {})); } catch (e) { fail(e); } }, [s]);
  useEffect(() => { void reload(); }, [reload]);
  return [d, reload] as const;
}

type GradeSort = 'position' | 'ref' | 'people' | 'avg' | 'diff' | 'hour';
type PeopleSort = 'name' | 'position' | 'monthly' | 'diff' | 'weekly';

/**
 * The salary scale of a centre (Fouad, 31 October 2026: each centre has its own scale and its own dollar rate). For each
 * position: the reference amount, and what the agreements really give (how many people, the average, the lowest and
 * the highest, the difference with the reference). The cost of an hour and the lowest–highest are shown to the Superior
 * only (Fouad, 2026-11-02: the spread of what people get on a position is private).
 */
export function ScalePage({ s, hr, pd, reload, open, centre }: { s: Session; hr: HrData; pd: HrPayData; reload: () => Promise<void>; open: (p: HrPerson) => void; centre: string | null }) {
  const centres = centreChoices(hr);
  const [pick, setPick] = useState<string | null>(centre ?? (hr.scope ? hr.scope[0] : centres[0]?.code ?? null));
  const code = centre ?? pick;
  const [grade, setGrade] = useState<HrGrade | 'new' | null>(null);
  const [fromBudget, setFromBudget] = useState(false);
  const [copy, setCopy] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const sup = has(s.profile, 'hr.approve');
  // changing the scale and the dollar rate is its own right (Fouad, 1 November 2026); the others only read it
  const edit = has(s.profile, 'hr.scale');
  const today = todayIso();
  const gs = useSort<GradeSort>('position');
  const ps = useSort<PeopleSort>('name');
  const grades = pd.grades.filter((g) => g.centre === code || (g.centre == null && !pd.grades.some((x) => x.centre === code && x.name === g.name)));
  const people = hr.people.filter((p) => p.active && (!code || codeOf(hr, p) === code));
  const rows = people.map((p) => {
    const c = payOn(pd, p.id, today);
    const g = c?.grade ?? grades.find((x) => x.name === p.role) ?? null;
    const ref = g ? (grades.find((x) => x.name === g.name)?.monthly_usd ?? g.monthly_usd) : null;
    return { p, c, g, ref, diff: c?.monthly != null && ref != null ? Math.round((c.monthly - ref) * 100) / 100 : null };
  });
  const total = rows.reduce((a, r) => a + (r.c?.monthly ?? 0), 0);
  const noRate = rows.filter((r) => r.c?.needsRate).length;
  const holders = (g: HrGrade) => rows.filter((r) => r.g?.name === g.name);
  const stats = (g: HrGrade) => {
    const xs = holders(g).map((r) => r.c?.monthly).filter((v): v is number => v != null);
    const hours = holders(g).map((r) => r.c?.hourly).filter((v): v is number => v != null);
    const avg = xs.length ? Math.round((xs.reduce((a, v) => a + v, 0) / xs.length) * 100) / 100 : null;
    return { n: holders(g).length, avg, min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null, diff: avg != null && g.monthly_usd != null ? Math.round((avg - g.monthly_usd) * 100) / 100 : null, hour: hours.length ? Math.round((hours.reduce((a, v) => a + v, 0) / hours.length) * 100) / 100 : null };
  };
  const gRows = sortRows(grades, (g) => { const st = stats(g); return gs.key === 'position' ? g.name : gs.key === 'ref' ? g.monthly_usd : gs.key === 'people' ? st.n : gs.key === 'avg' ? st.avg : gs.key === 'diff' ? st.diff : st.hour; }, gs.dir);
  const pRows = sortRows(rows, (r) => (ps.key === 'name' ? r.p.name_ar || r.p.name : ps.key === 'position' ? r.g?.name ?? r.p.role : ps.key === 'monthly' ? r.c?.monthly : ps.key === 'diff' ? r.diff : r.c?.weekly), ps.dir);
  const diffCell = (v: number | null, ref: number | null) => (v == null || ref == null || Math.abs(v) < 0.005 ? <span className="muted">{v == null ? '—' : '='}</span> : <span className={`hr-diff ${v > 0 ? 'up' : 'down'}`}>{v > 0 ? '+' : ''}{usd(v)} <span className="small">({v > 0 ? '+' : ''}{Math.round((v * 100) / ref)}%)</span></span>);
  const posName = (n: string) => (hr.positionsAr[n] ? `${hr.positionsAr[n]} · ${n}` : n);
  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('المكافآت', 'Stipends', 'Gratifications')} · {centreLabel(hr, code)}</div><h1>{t3('سلّم الرواتب', 'Salary scale', 'Échelle des gratifications')}<GuideLink id="hr-scale" /></h1></div>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {!centre && centres.length > 1 && <select value={pick ?? ''} onChange={(e) => setPick(e.target.value || null)}>{centres.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}{!hr.scope && <option value="">{t3('المشترك بين كل المراكز', 'Shared by every centre', 'Commun à tous les centres')}</option>}</select>}
          {edit && code && <button className="btn" onClick={() => setCopy(true)}>{t3('نسخ سلّم آخر…', 'Copy another scale…', 'Copier une autre échelle…')}</button>}
          {edit && <button className="btn" onClick={() => setFromBudget(true)}>{t3('من الموازنات…', 'From the budgets…', 'Depuis les budgets…')}</button>}
          {edit && <button className="btn gold" onClick={() => setGrade('new')}>＋ {t3('وظيفة', 'Add a position', 'Ajouter un poste')}</button>}
        </span>
      </div>
      <div className="hr-panel" style={{ marginBottom: 14 }}>
        <b>{t3('السلّم والاتفاقيات الفعلية', 'The scale and the actual agreements', "L'échelle et les accords réels")}</b>
        <p className="muted small" style={{ marginTop: 4 }}>{t3('المرجع اقتراح عند كتابة اتفاقية. «الفعلي» هو ما تعطيه الاتفاقيات اليوم (بالدولار). الفرق = المعدل الفعلي − المرجع. اضغط على وظيفة لترى أصحابها.', 'The reference is a suggestion when an agreement is written. "Actual" is what the agreements give today (in dollars). Difference = actual average − reference. Click a position to see who holds it.', "La référence est une suggestion quand un accord est rédigé. « Réel » est ce que donnent les accords aujourd'hui (en dollars). Écart = moyenne réelle − référence. Cliquez un poste pour voir qui l'occupe.")}</p>
        {!pd.grades.length ? (!edit ? <p className="muted">—</p> :
          <button className="btn primary" onClick={async () => { try { await s.api.call('hr.grade.seed', {}); await reload(); } catch (e) { fail(e); } }}>{t3('حمّل الوظائف من جدول الرواتب', 'Load the positions from the salary sheet', 'Charger les postes depuis la feuille de salaires')}</button>
        ) : (
          <div className="desk-scroll">
            <table className="desk-table">
              <thead><tr>
                <SortTh k="position" sort={gs}>{t3('الوظيفة', 'Position', 'Poste')}</SortTh>
                <SortTh k="ref" sort={gs} n>{t3('المرجع شهرياً', 'Reference, monthly', 'Référence, mensuel')}</SortTh>
                <SortTh k="people" sort={gs} n>{t3('الأشخاص', 'People', 'Personnes')}</SortTh>
                <SortTh k="avg" sort={gs} n>{t3('الفعلي (المعدل)', 'Actual (average)', 'Réel (moyenne)')}</SortTh>
                <th className="n">{sup ? t3('الأدنى – الأعلى', 'Lowest – highest', 'Min – max') : t3('ساعات الأسبوع', 'Hours a week', 'Heures par semaine')}</th>
                <SortTh k="diff" sort={gs} n>{t3('الفرق', 'Difference', 'Écart')}</SortTh>
                {sup && <SortTh k="hour" sort={gs} n>{t3('الساعة (للرئيس)', 'Hour (Superior)', 'Heure (Supérieur)')}</SortTh>}
                <th />
              </tr></thead>
              <tbody>
                {gRows.map((g) => {
                  const st = stats(g);
                  return (
                    <Fragment key={g.id}>
                      <tr className="click" onClick={() => setShown(shown === g.id ? null : g.id)}>
                        <td><b>{st.n ? (shown === g.id ? '▾ ' : '▸ ') : ''}{posName(g.name)}</b>{g.centre == null && code ? <span className="muted small"> · {t3('مشترك', 'shared', 'commun')}</span> : null}{g.note ? <div className="muted small">{g.note}</div> : null}</td>
                        <td className="n"><b>{usd(g.monthly_usd)}</b></td>
                        <td className="n">{st.n || ''}</td>
                        <td className="n">{usd(st.avg)}</td>
                        <td className="n">{sup ? (st.min != null ? (st.min === st.max ? usd(st.min) : `${usd(st.min)} – ${usd(st.max)}`) : '—') : ''}</td>
                        <td className="n">{diffCell(st.diff, g.monthly_usd)}</td>
                        {sup && <td className="n">{usd(st.hour)}</td>}
                        <td className="right" onClick={(e) => e.stopPropagation()}>{edit && <button className="btn small" onClick={() => setGrade(g)}>{t3('تعديل', 'Edit', 'Modifier')}</button>}</td>
                      </tr>
                      {shown === g.id && holders(g).map((r) => (
                        <tr key={`${g.id}-${r.p.id}`} className="click" onClick={() => open(r.p)}>
                          <td style={{ paddingInlineStart: 28 }}><TwoNames p={r.p} /></td><td /><td />
                          <td className="n">{r.c?.syp != null ? <>{usd(r.c.syp)} SYP<div className="muted small">≈ {usd(r.c.monthly)}</div></> : usd(r.c?.monthly)}</td><td className="n">{r.c?.weekly ?? '—'} {t3('س/أسبوع', 'h/week', 'h/sem')}</td>
                          <td className="n">{diffCell(r.diff, r.ref)}</td>{sup && <td className="n">{usd(r.c?.hourly)}</td>}<td />
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                {!grades.length && <tr><td colSpan={8} className="muted">{t3('لا وظائف لهذا المركز بعد: أضف وظيفة، أو انسخ سلّماً آخر.', 'No positions for this centre yet: add one, or copy another scale.', "Pas encore de postes pour ce centre : ajoutez-en un, ou copiez une autre échelle.")}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="hr-panel">
        <b>{t3('مكافأة كل شخص اليوم', "Each person's stipend today", "La gratification de chacun aujourd'hui")}</b>
        <div className="desk-scroll">
          <table className="desk-table" style={{ marginTop: 6 }}>
            <thead><tr><th /><SortTh k="name" sort={ps}>{t3('الاسم', 'Name', 'Nom')}</SortTh><SortTh k="position" sort={ps}>{t3('الوظيفة', 'Position', 'Poste')}</SortTh><SortTh k="monthly" sort={ps} n>{t3('شهرياً', 'Monthly', 'Mensuel')}</SortTh><SortTh k="diff" sort={ps} n>{t3('مقارنة بالسلّم', 'Against the scale', "Face à l'échelle")}</SortTh><SortTh k="weekly" sort={ps} n>{t3('س/أسبوع', 'h/week', 'h/sem')}</SortTh><th className="n">{t3(`سنوياً (×${pd.settings.paymentsPerYear})`, `Yearly (×${pd.settings.paymentsPerYear})`, `Annuel (×${pd.settings.paymentsPerYear})`)}</th></tr></thead>
            <tbody>
              {pRows.map(({ p, c, g, ref, diff }) => {
                const { key } = centreOf(hr, p);
                return (
                  <tr key={p.id} className="click" onClick={() => open(p)} style={centreVars(key)}>
                    <td style={{ width: 30 }}><img src={markOf(key)} alt="" style={{ height: 22 }} /></td>
                    <td><TwoNames p={p} /></td>
                    <td>{(() => { const n = g?.name ?? p.role; return n ? posName(n) : '—'; })()}</td>
                    <td className="n">{c?.syp != null ? <><b>{usd(c.syp)}</b> SYP<div className="muted small">{c.monthly != null ? `≈ ${usd(c.monthly)} USD` : t3('بلا سعر دولار', 'no dollar rate', 'pas de taux')}</div></> : c?.monthly != null ? <><b>{usd(c.monthly)}</b> USD</> : '—'}</td>
                    <td className="n">{diffCell(diff, ref)}</td>
                    <td className="n">{c?.weekly ?? '—'}{c?.weekly && c.weekly > pd.settings.maxWeekly ? <span className="desk-alert" title={t3('أكثر من حد الاتفاقية', "Above the agreement's maximum", "Au-dessus du maximum de l'accord")}> ⚠</span> : null}</td>
                    <td className="n">{c?.monthly != null ? `${usd(yearlyCost(c.monthly, pd.settings.paymentsPerYear))} USD` : '—'}</td>
                  </tr>
                );
              })}
              {rows.length > 0 && <tr><td /><td colSpan={2}><b>{t3('المجموع بالدولار', 'Total in USD', 'Total en USD')}</b>{noRate > 0 && <div className="desk-alert small">{t3(`${noRate} بالليرة غير محسوبين: لا سعر دولار`, `${noRate} in pounds not counted: no dollar rate`, `${noRate} en livres non comptés : pas de taux`)}</div>}</td><td className="n"><b>{usd(total)} USD</b></td><td /><td /><td className="n"><b>{usd(yearlyCost(total, pd.settings.paymentsPerYear))} USD</b></td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small">{t3('الدفعة الثالثة عشرة مكافأة بدل الضمان الاجتماعي. اضغط على شخص لتغيير مكافأته.', 'The 13th payment is a bonus instead of social security. Click a person to change their stipend.', 'Le 13e paiement remplace la sécurité sociale. Cliquez une personne pour changer sa gratification.')}</p>
      </div>
      {edit && <Settings s={s} d={pd} hr={hr} code={code} reload={reload} />}
      {fromBudget && <FromBudget s={s} centre={code} onClose={() => setFromBudget(false)} reload={reload} />}
      {copy && code && <CopyScale s={s} hr={hr} pd={pd} to={code} onClose={() => setCopy(false)} reload={reload} />}
      {grade && <GradeModal s={s} grade={grade === 'new' ? null : grade} centre={code} onClose={() => setGrade(null)} reload={reload} />}
    </>
  );
}

function CopyScale({ s, hr, pd, to, onClose, reload }: { s: Session; hr: HrData; pd: HrPayData; to: string; onClose: () => void; reload: () => Promise<void> }) {
  const sources = [...new Set(pd.grades.map((g) => g.centre))].filter((c) => c !== to);
  const [from, setFrom] = useState<string>(sources[0] ?? '');
  return (
    <Modal title={t3('نسخ سلّم آخر', 'Copy another scale', 'Copier une autre échelle')} onClose={onClose} narrow>
      <p className="muted small">{t3(`تُنسخ إلى ${centreLabel(hr, to)} الوظائف التي ليست فيه بعد، بمبالغها المرجعية. ثم تعدّلها كما تريد.`, `The positions ${centreLabel(hr, to)} does not have yet are copied, with their reference amounts. Then change them as you wish.`, `Les postes que ${centreLabel(hr, to)} n'a pas encore sont copiés, avec leurs montants de référence. Puis modifiez-les à votre guise.`)}</p>
      <Field label={t3('من', 'From', 'Depuis')}><select value={from} onChange={(e) => setFrom(e.target.value)}>{sources.map((c) => <option key={c ?? ''} value={c ?? ''}>{c ? centreLabel(hr, c) : t3('المشترك بين كل المراكز', 'Shared by every centre', 'Commun à tous les centres')} ({pd.grades.filter((g) => g.centre === c).length})</option>)}</select></Field>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!sources.length} onClick={async () => { try { const r = await s.api.call('hr.grade.copy', { from: from || null, to }); toast(t3(`نُسخت ${r.added} وظيفة`, `${r.added} positions copied`, `${r.added} postes copiés`)); await reload(); onClose(); } catch (e) { fail(e); } }}>{t3('نسخ', 'Copy', 'Copier')}</button>
      </div>
    </Modal>
  );
}

function Settings({ s, d, hr, code, reload }: { s: Session; d: HrPayData; hr: HrData; code: string | null; reload: () => Promise<void> }) {
  const own = code ? d.settings.rates?.[code] : undefined;
  const [f, setF] = useState({ paymentsPerYear: String(d.settings.paymentsPerYear), maxWeekly: String(d.settings.maxWeekly), rateSyp: d.settings.rateSyp ? String(d.settings.rateSyp) : '', rate: own ? String(own) : '' });
  useEffect(() => { setF((x) => ({ ...x, rate: code && d.settings.rates?.[code] ? String(d.settings.rates[code]) : '' })); }, [code, d.settings.rates]);
  const whole = !hr.scope;
  return (
    <div className="hr-panel" style={{ marginTop: 14 }}>
      <b>{t3('الإعدادات', 'Settings', 'Réglages')}</b>
      <div className="grid2" style={{ marginTop: 6 }}>
        {code && <Field label={t3(`سعر الدولار بالليرة في ${centreLabel(hr, code)}`, `Dollar rate in pounds in ${centreLabel(hr, code)}`, `Taux du dollar en livres à ${centreLabel(hr, code)}`)}><input inputMode="decimal" placeholder={d.settings.rateSyp ? `${t3('المشترك', 'shared', 'commun')}: ${d.settings.rateSyp}` : t3('فارغ: آخر كشف للمركز', "empty: the centre's last payroll", 'vide : la dernière paie du centre')} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>}
        {whole && <Field label={t3('سعر الدولار المشترك (لمن ليس له سعر)', 'Shared dollar rate (for a centre without its own)', 'Taux du dollar commun (pour un centre sans le sien)')}><input inputMode="decimal" placeholder={t3('فارغ: آخر كشف', "empty: the last payroll's", 'vide : celui de la dernière paie')} value={f.rateSyp} onChange={(e) => setF({ ...f, rateSyp: e.target.value })} /></Field>}
        {whole && <Field label={t3('عدد الدفعات في السنة (الثالثة عشرة = بدل الضمان)', 'Payments a year (the 13th = instead of social security)', 'Paiements par an (le 13e = à la place de la sécurité sociale)')}><input inputMode="decimal" value={f.paymentsPerYear} onChange={(e) => setF({ ...f, paymentsPerYear: e.target.value })} /></Field>}
        {whole && <Field label={t3('الحد الأقصى لساعات الأسبوع (الاتفاقية)', "Maximum weekly hours (the agreement's)", "Maximum d'heures par semaine (l'accord)")}><input inputMode="decimal" value={f.maxWeekly} onChange={(e) => setF({ ...f, maxWeekly: e.target.value })} /></Field>}
      </div>
      <button className="btn small" onClick={async () => {
        try {
          await s.api.call('hr.pay.settings', { ...(whole ? { paymentsPerYear: Number(f.paymentsPerYear), maxWeekly: Number(f.maxWeekly), rateSyp: Number(f.rateSyp) || 0 } : {}), ...(code ? { rates: { [code]: Number(f.rate) || 0 } } : {}) });
          toast(t3('حُفظ', 'Saved', 'Enregistré')); await reload();
        } catch (e) { fail(e); }
      }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      {!whole && <p className="muted small">{t3(`عدد الدفعات في السنة: ${d.settings.paymentsPerYear} · الحد الأقصى للساعات: ${d.settings.maxWeekly} (يغيّرهما من يرى كل المراكز).`, `Payments a year: ${d.settings.paymentsPerYear} · maximum hours: ${d.settings.maxWeekly} (changed by someone who sees every centre).`, `Paiements par an : ${d.settings.paymentsPerYear} · heures maximum : ${d.settings.maxWeekly} (changés par qui voit tous les centres).`)}</p>}
    </div>
  );
}

function GradeModal({ s, grade, centre, onClose, reload }: { s: Session; grade: HrGrade | null; /** the centre whose scale is shown (null: the shared one) */ centre: string | null; onClose: () => void; reload: () => Promise<void> }) {
  const [name, setName] = useState(grade?.name ?? '');
  const [nameAr, setNameAr] = useState(grade?.name_ar ?? '');
  const [note, setNote] = useState(grade?.note ?? '');
  const [amount, setAmount] = useState(grade?.monthly_usd != null ? String(grade.monthly_usd) : '');
  return (
    <Modal title={grade ? `${grade.name_ar ? `${grade.name_ar} · ` : ''}${grade.name}` : t3('وظيفة جديدة', 'New position', 'Nouveau poste')} onClose={onClose} narrow>
      <div className="grid2">
        <Field label="اسم الوظيفة بالعربية"><input dir="rtl" autoFocus value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></Field>
        <Field label="Position in English"><input dir="ltr" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <Field label={t3('المبلغ المرجعي الشهري (USD)', 'Reference monthly amount (USD)', 'Montant mensuel de référence (USD)')}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label={t3('ملاحظة', 'Note', 'Note')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {grade && grade.centre == null && centre && <p className="desk-alert small">{t3('وظيفة مشتركة بين كل المراكز: تغييرها يغيّرها للجميع. لمبلغ خاص بهذا المركز انسخ السلّم المشترك إليه.', 'A position shared by every centre: changing it changes it for all. For an amount of this centre only, copy the shared scale into it.', "Un poste commun à tous les centres : le changer le change pour tous. Pour un montant propre à ce centre, copiez-y l'échelle commune.")}</p>}
      <p className="muted small">{t3('تغيير المرجع لا يغيّر مكافأة أحد: المكافأة مثبّتة في الاتفاقية.', "Changing the reference does not change anyone's stipend: it is fixed in the agreement.", "Changer la référence ne change la gratification de personne : elle est fixée dans l'accord.")}</p>
      <div className="modal-foot">
        {grade && <button className="btn danger" onClick={async () => { if (await confirmBox(t3('حذف هذه الوظيفة؟', 'Delete this position?', 'Supprimer ce poste ?'), true)) { try { await s.api.call('hr.grade.delete', { id: grade.id }); await reload(); onClose(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        <button className="btn primary" disabled={!name.trim()} onClick={async () => {
          try { await s.api.call('hr.grade.save', { id: grade?.id ?? null, name, nameAr, note, monthlyUsd: amount === '' ? null : Number(amount), centre: grade ? grade.centre : centre }); await reload(); onClose(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

/** The hours each person worked in a month, next to what is expected from their weekly hours. */
export function HoursPage({ s, hr }: { s: Session; hr: HrData }) {
  const [d, reload] = usePayData(s);
  const [ym, setYm] = useState(todayIso().slice(0, 7));
  if (!d) return <p className="muted">…</p>;
  const day = `${ym}-28`;
  const people = hr.people.filter((p) => p.active || d.hours.some((h) => h.person_id === p.id && h.ym === ym));
  const save = async (personId: number, hours: string, note: string | null) => {
    try { await s.api.call('hr.hours.save', { personId, ym, hours: hours === '' ? null : Number(hours), note }); await reload(); } catch (e) { fail(e); }
  };
  return (
    <>
      <div className="desk-head">
        <h1>{t3('ساعات العمل', 'Hours worked', 'Heures travaillées')}</h1>
        <div className="desk-filters"><input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></div>
      </div>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الاسم', 'Name', 'Nom')}</th><th className="n">{t3('المتوقّع', 'Expected', 'Attendues')}</th><th className="n">{t3('الفعلي', 'Worked', 'Faites')}</th><th>{t3('ملاحظة', 'Note', 'Note')}</th></tr></thead>
          <tbody>
            {people.map((p) => {
              const c = payOn(d, p.id, day);
              const row = d.hours.find((h) => h.person_id === p.id && h.ym === ym);
              return (
                <tr key={`${p.id}-${ym}-${row?.hours ?? ''}`}>
                  <td><b>{p.name}</b></td>
                  <td className="n">{c?.weekly ? Math.round(monthlyHours(c.weekly)) : '—'}</td>
                  <td className="n"><input style={{ width: 80 }} inputMode="decimal" defaultValue={row?.hours ?? ''} onBlur={(e) => { if (e.target.value !== String(row?.hours ?? '')) void save(p.id, e.target.value, row?.note ?? null); }} /></td>
                  <td><input defaultValue={row?.note ?? ''} onBlur={(e) => { if (row && e.target.value !== (row.note ?? '')) void save(p.id, String(row.hours), e.target.value || null); }} disabled={!row} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">{t3('ساعات عادية فقط. المتوقّع = ساعات الأسبوع × 52 ÷ 12. الأجر الإضافي مكافأة تُعطى من حين لآخر.', 'Normal hours only. Expected = weekly hours × 52 ÷ 12. Extra pay is a bonus given from time to time.', 'Heures normales seulement. Attendues = heures par semaine × 52 ÷ 12. Un supplément est une gratification donnée de temps en temps.')}</p>
      </div>
    </>
  );
}

/** The salary lines of the centres' budgets, as positions: tick the ones to create (the amount is the unit cost of the latest budget). */
function FromBudget({ s, centre, onClose, reload }: { s: Session; centre: string | null; onClose: () => void; reload: () => Promise<void> }) {
  const [rows, setRows] = useState<{ name: string; centres: string[]; amount: number | null; exists: boolean }[] | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/hr/positions-from-budget', { credentials: 'same-origin' }).then((r) => r.json()).then((x) => { setRows(Array.isArray(x) ? x : []); setOn(Object.fromEntries((Array.isArray(x) ? x : []).filter((y: { exists: boolean }) => !y.exists).map((y: { name: string }) => [y.name, true]))); }).catch(() => setRows([]));
  }, []);
  const n = Object.values(on).filter(Boolean).length;
  return (
    <Modal title={t3('الوظائف من موازنات المراكز', "Positions from the centres' budgets", 'Postes depuis les budgets des centres')} onClose={onClose}>
      <p className="muted small">{t3('بنود الرواتب في موازنة كل مركز (بلا التأمين). المبلغ هو تكلفة الوحدة في آخر موازنة، وهو اقتراح يمكنك تعديله. لتظهر هنا اختر أولاً بند الرواتب لكل مركز في «القوائم والمراكز».', 'The salary lines of the budget of each centre (insurance left out). The amount is the unit cost in the latest budget, a suggestion you can change. To appear here, first choose the salary heading of each centre in Lists and centres.', "Les lignes de salaires du budget de chaque centre (sans l'assurance). Le montant est le coût unitaire du dernier budget, une suggestion modifiable. Pour apparaître ici, choisissez d'abord la rubrique des salaires de chaque centre dans Listes et centres.")}</p>
      {!rows ? <p className="muted">…</p> : !rows.length ? <p className="desk-alert">{t3('لا شيء: انسخ القوائم من المراكز واختر بند الرواتب لكل مركز.', "Nothing found: copy the lists from the centres and choose each centre's salary heading.", "Rien : copiez les listes des centres et choisissez la rubrique des salaires de chacun.")}</p> : (
        <table className="desk-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} style={{ opacity: r.exists ? 0.5 : 1 }}>
                <td style={{ width: 28 }}><input type="checkbox" disabled={r.exists} checked={!!on[r.name]} onChange={(e) => setOn({ ...on, [r.name]: e.target.checked })} /></td>
                <td><b>{r.name}</b><div className="muted small">{r.centres.join(' · ')}</div></td>
                <td className="n">{r.amount != null ? `${usd(r.amount)} $` : '—'}</td>
                <td className="small">{r.exists ? t3('موجودة', 'exists', 'existe') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={busy || !n} onClick={async () => {
          setBusy(true);
          try { for (const r of rows ?? []) if (on[r.name] && !r.exists) await s.api.call('hr.grade.save', { name: r.name, monthlyUsd: r.amount, centre }); toast(t3(`أُنشئت ${n} وظيفة`, `${n} positions created`, `${n} postes créés`)); await reload(); onClose(); } catch (e) { fail(e); } finally { setBusy(false); }
        }}>{t3(`إنشاء (${n})`, `Create (${n})`, `Créer (${n})`)}</button>
      </div>
    </Modal>
  );
}
