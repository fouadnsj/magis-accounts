// The salary scale (Fouad, 30 October 2026): each position has ONE reference monthly amount, a suggestion when an
// agreement is made. The stipend itself is fixed in each person's agreement at its beginning, and can change from a
// date in the middle of the year. The cost of an hour is calculated from each person's own amount and weekly hours.
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '../../state';
import { Field, Modal, confirmBox, toast, todayIso } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import type { HrData, HrPerson } from '../hr';
import type { HrGrade, HrPayData } from '../payOps';
import { hourlyWithThirteenth, monthlyHours, payOn, yearlyCost } from '../pay';
import { TwoNames, centreOf, centreVars, fail, markOf, usd } from './common';

export { payOn };

function usePayData(s: Session) {
  const [d, setD] = useState<HrPayData | null>(null);
  const reload = useCallback(async () => { try { setD(await s.api.call('hr.pay.data', {})); } catch (e) { fail(e); } }, [s]);
  useEffect(() => { void reload(); }, [reload]);
  return [d, reload] as const;
}

export function ScalePage({ s, hr, pd, reload, open }: { s: Session; hr: HrData; pd: HrPayData; reload: () => Promise<void>; open: (p: HrPerson) => void }) {
  const [grade, setGrade] = useState<HrGrade | 'new' | null>(null);
  const [fromBudget, setFromBudget] = useState(false);
  const today = todayIso();
  const people = hr.people.filter((p) => p.active);
  const rows = people.map((p) => ({ p, c: payOn(pd, p.id, today) }));
  const total = rows.reduce((a, r) => a + (r.c?.monthly ?? 0), 0);
  const on = (g: HrGrade) => rows.filter((r) => (r.c?.pay.grade_id ?? null) === g.id || (!r.c && r.p.role === g.name));
  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('المكافآت', 'Stipends', 'Gratifications')}</div><h1>{t3('سلّم الرواتب', 'Salary scale', 'Échelle des gratifications')}</h1></div>
        <span className="row" style={{ gap: 6 }}>
          <button className="btn" onClick={() => setFromBudget(true)}>{t3('استيراد الوظائف من الموازنات…', 'Import positions from the budgets…', 'Importer les postes depuis les budgets…')}</button>
          <button className="btn gold" onClick={() => setGrade('new')}>＋ {t3('وظيفة', 'Add a position', 'Ajouter un poste')}</button>
        </span>
      </div>
      <div className="hr-panel" style={{ marginBottom: 14 }}>
        <p className="muted small" style={{ marginTop: 0 }}>{t3('المبلغ المرجعي اقتراح عند كتابة اتفاقية. المكافأة نفسها تُثبَّت في اتفاقية كل شخص عند بدايتها، ويمكن تغييرها ابتداءً من تاريخ. تكلفة الساعة = شهري × 12 ÷ (ساعات الأسبوع × 52).', "The reference amount is a suggestion when an agreement is written. The stipend itself is fixed in each person's agreement at its beginning, and can be changed from a date. Cost of an hour = monthly × 12 ÷ (hours a week × 52).", "Le montant de référence est une suggestion quand un accord est rédigé. La gratification est fixée dans l'accord de chaque personne à son début, et peut changer à partir d'une date. Coût horaire = mensuel × 12 ÷ (heures par semaine × 52).")}</p>
        {!pd.grades.length ? (
          <button className="btn primary" onClick={async () => { try { await s.api.call('hr.grade.seed', {}); await reload(); } catch (e) { fail(e); } }}>{t3('حمّل الوظائف من جدول الرواتب', 'Load the positions from the salary sheet', 'Charger les postes depuis la feuille de salaires')}</button>
        ) : (
          <table className="desk-table">
            <thead><tr><th>{t3('الوظيفة', 'Position', 'Poste')}</th><th className="n">{t3('المرجع شهرياً', 'Reference, monthly', 'Référence, mensuel')}</th><th>{t3('من يشغلها اليوم', 'Who holds it today', "Qui l'occupe aujourd'hui")}</th><th /></tr></thead>
            <tbody>
              {pd.grades.map((g) => (
                <tr key={g.id}>
                  <td><b dir="rtl">{g.name_ar ?? ''}</b>{g.name_ar ? ' · ' : ''}<b>{g.name}</b>{g.note ? <div className="muted small">{g.note}</div> : null}</td>
                  <td className="n"><b>{usd(g.monthly_usd)}</b> $</td>
                  <td className="small">{on(g).map((r) => r.p.name_ar || r.p.name).join('، ') || '—'}</td>
                  <td className="right"><button className="btn small" onClick={() => setGrade(g)}>{t3('تعديل', 'Edit', 'Modifier')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="hr-panel">
        <b>{t3('مكافأة كل شخص اليوم', "Each person's stipend today", "La gratification de chacun aujourd'hui")}</b>
        <div className="desk-scroll">
          <table className="desk-table" style={{ marginTop: 6 }}>
            <thead><tr><th /><th>{t3('الاسم', 'Name', 'Nom')}</th><th>{t3('الوظيفة', 'Position', 'Poste')}</th><th className="n">{t3('شهرياً', 'Monthly', 'Mensuel')}</th><th className="n">{t3('س/أسبوع', 'h/week', 'h/sem')}</th><th className="n">{t3('تكلفة الساعة', 'Cost of an hour', 'Coût horaire')}</th><th className="n">{t3(`سنوياً (×${pd.settings.paymentsPerYear})`, `Yearly (×${pd.settings.paymentsPerYear})`, `Annuel (×${pd.settings.paymentsPerYear})`)}</th></tr></thead>
            <tbody>
              {rows.map(({ p, c }) => {
                const { key } = centreOf(hr, p);
                const ref = c?.grade?.monthly_usd;
                return (
                  <tr key={p.id} className="click" onClick={() => open(p)} style={centreVars(key)}>
                    <td style={{ width: 30 }}><img src={markOf(key)} alt="" style={{ height: 22 }} /></td>
                    <td><TwoNames p={p} /></td>
                    <td>{(() => { const n = c?.grade?.name ?? p.role; return n ? (hr.positionsAr[n] ? `${hr.positionsAr[n]} · ${n}` : n) : '—'; })()}{c?.monthly != null && ref != null && c.monthly !== ref ? <div className="muted small">{t3('المرجع', 'reference', 'référence')} {usd(ref)}</div> : null}</td>
                    <td className="n">{c?.syp != null ? <><b>{usd(c.syp)}</b> SYP<div className="muted small">{c.monthly != null ? `≈ ${usd(c.monthly)} USD` : t3('بلا سعر دولار', 'no dollar rate', 'pas de taux')}</div></> : <b>{usd(c?.monthly)}</b>}</td>
                    <td className="n">{c?.weekly ?? '—'}{c?.weekly && c.weekly > pd.settings.maxWeekly ? <span className="desk-alert" title={t3('أكثر من حد الاتفاقية', "Above the agreement's maximum", "Au-dessus du maximum de l'accord")}> ⚠</span> : null}</td>
                    <td className="n" title={c?.monthly != null ? t3(`مع الدفعة الثالثة عشرة: ${usd(hourlyWithThirteenth(c.monthly, c.weekly, pd.settings.paymentsPerYear))}`, `With the 13th payment: ${usd(hourlyWithThirteenth(c.monthly, c.weekly, pd.settings.paymentsPerYear))}`, `Avec le 13e : ${usd(hourlyWithThirteenth(c.monthly, c.weekly, pd.settings.paymentsPerYear))}`) : ''}>{usd(c?.hourly)}</td>
                    <td className="n">{c?.monthly != null ? usd(yearlyCost(c.monthly, pd.settings.paymentsPerYear)) : '—'}</td>
                  </tr>
                );
              })}
              {rows.length > 0 && <tr><td /><td colSpan={2}><b>{t3('المجموع', 'Total', 'Total')}</b></td><td className="n"><b>{usd(total)}</b></td><td /><td /><td className="n"><b>{usd(yearlyCost(total, pd.settings.paymentsPerYear))}</b></td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small">{t3('الدفعة الثالثة عشرة مكافأة بدل الضمان الاجتماعي. مرّر المؤشر على تكلفة الساعة لتراها معها. اضغط على شخص لتغيير مكافأته.', 'The 13th payment is a bonus instead of social security. Hover the cost of an hour to see it with the 13th. Click a person to change their stipend.', 'Le 13e paiement remplace la sécurité sociale. Survolez le coût horaire pour le voir avec le 13e. Cliquez une personne pour changer sa gratification.')}</p>
      </div>
      <Settings s={s} d={pd} reload={reload} />
      {fromBudget && <FromBudget s={s} onClose={() => setFromBudget(false)} reload={reload} />}
      {grade && <GradeModal s={s} grade={grade === 'new' ? null : grade} onClose={() => setGrade(null)} reload={reload} />}
    </>
  );
}

function Settings({ s, d, reload }: { s: Session; d: HrPayData; reload: () => Promise<void> }) {
  const [f, setF] = useState({ paymentsPerYear: String(d.settings.paymentsPerYear), maxWeekly: String(d.settings.maxWeekly), rateSyp: d.settings.rateSyp ? String(d.settings.rateSyp) : '' });
  return (
    <div className="hr-panel" style={{ marginTop: 14 }}>
      <b>{t3('الإعدادات', 'Settings', 'Réglages')}</b>
      <div className="grid2" style={{ marginTop: 6 }}>
        <Field label={t3('عدد الدفعات في السنة (الثالثة عشرة = بدل الضمان)', 'Payments a year (the 13th = instead of social security)', 'Paiements par an (le 13e = à la place de la sécurité sociale)')}><input inputMode="decimal" value={f.paymentsPerYear} onChange={(e) => setF({ ...f, paymentsPerYear: e.target.value })} /></Field>
        <Field label={t3('سعر الدولار بالليرة (لإظهار المكافآت بالليرة بالدولار)', 'Dollar rate in pounds (to show pound stipends in dollars)', 'Taux du dollar en livres (pour voir en dollars les gratifications en livres)')}><input inputMode="decimal" placeholder={t3('اتركه فارغاً: آخر كشف', 'empty: the last payroll\'s', 'vide : celui de la dernière paie')} value={f.rateSyp} onChange={(e) => setF({ ...f, rateSyp: e.target.value })} /></Field>
        <Field label={t3('الحد الأقصى لساعات الأسبوع (الاتفاقية)', "Maximum weekly hours (the agreement's)", "Maximum d'heures par semaine (l'accord)")}><input inputMode="decimal" value={f.maxWeekly} onChange={(e) => setF({ ...f, maxWeekly: e.target.value })} /></Field>
      </div>
      <button className="btn small" onClick={async () => {
        try { await s.api.call('hr.pay.settings', { paymentsPerYear: Number(f.paymentsPerYear), maxWeekly: Number(f.maxWeekly), rateSyp: Number(f.rateSyp) || 0 }); toast(t3('حُفظ', 'Saved', 'Enregistré')); await reload(); } catch (e) { fail(e); }
      }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
    </div>
  );
}

function GradeModal({ s, grade, onClose, reload }: { s: Session; grade: HrGrade | null; onClose: () => void; reload: () => Promise<void> }) {
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
      <p className="muted small">{t3('تغيير المرجع لا يغيّر مكافأة أحد: المكافأة مثبّتة في الاتفاقية.', "Changing the reference does not change anyone's stipend: it is fixed in the agreement.", "Changer la référence ne change la gratification de personne : elle est fixée dans l'accord.")}</p>
      <div className="modal-foot">
        {grade && <button className="btn danger" onClick={async () => { if (await confirmBox(t3('حذف هذه الوظيفة؟', 'Delete this position?', 'Supprimer ce poste ?'), true)) { try { await s.api.call('hr.grade.delete', { id: grade.id }); await reload(); onClose(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        <button className="btn primary" disabled={!name.trim()} onClick={async () => {
          try { await s.api.call('hr.grade.save', { id: grade?.id ?? null, name, nameAr, note, monthlyUsd: amount === '' ? null : Number(amount) }); await reload(); onClose(); } catch (e) { fail(e); }
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
function FromBudget({ s, onClose, reload }: { s: Session; onClose: () => void; reload: () => Promise<void> }) {
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
          try { for (const r of rows ?? []) if (on[r.name] && !r.exists) await s.api.call('hr.grade.save', { name: r.name, monthlyUsd: r.amount }); toast(t3(`أُنشئت ${n} وظيفة`, `${n} positions created`, `${n} postes créés`)); await reload(); onClose(); } catch (e) { fail(e); } finally { setBusy(false); }
        }}>{t3(`إنشاء (${n})`, `Create (${n})`, `Créer (${n})`)}</button>
      </div>
    </Modal>
  );
}
