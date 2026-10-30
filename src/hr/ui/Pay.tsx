// HR stage 2 screens: the salary scale (grades with an hourly rate per year), the pay of each person
// (grade + weekly hours, or an agreed monthly amount) with the true hourly rate, and the hours of each month.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '../../state';
import { errText, Field, Modal, confirmBox, fmtDate, toast, todayIso } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import type { HrData, HrPerson } from '../hr';
import type { HrGrade, HrPay, HrPayData } from '../payOps';
import { hourlyFromMonthly, hourlyWithThirteenth, monthlyFromRate, monthlyHours, payOn, rateFor, yearlyCost } from '../pay';

const fail = (e: unknown) => toast(errText(e), true);
const usd = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

export { payOn, rateFor };

function usePayData(s: Session) {
  const [d, setD] = useState<HrPayData | null>(null);
  const reload = useCallback(async () => { try { setD(await s.api.call('hr.pay.data', {})); } catch (e) { fail(e); } }, [s]);
  useEffect(() => { void reload(); }, [reload]);
  return [d, reload] as const;
}

export function ScalePage({ s, hr }: { s: Session; hr: HrData }) {
  const [d, reload] = usePayData(s);
  const [grade, setGrade] = useState<HrGrade | 'new' | null>(null);
  const [editPay, setEditPay] = useState<HrPerson | null>(null);
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  if (!d) return <p className="muted">…</p>;
  const people = hr.people.filter((p) => p.active);
  const rows = people.map((p) => ({ p, c: payOn(d, p.id, today) }));
  const monthlyTotal = rows.reduce((a, r) => a + (r.c?.monthly ?? 0), 0);
  const typical = [30, 40, 48];
  return (
    <>
      <div className="desk-head"><h1>{t3('سلّم الرواتب والمكافآت', 'Salary scale and stipends', 'Échelle et gratifications')}</h1></div>

      <div className="cty-card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <b>{t3('الدرجات: أجر الساعة الأساسي بالدولار', 'Grades: base hourly rate in USD', 'Grades : taux horaire de base en USD')}</b>
          <button className="btn small" onClick={() => setGrade('new')}>＋ {t3('درجة', 'Add a grade', 'Ajouter un grade')}</button>
        </div>
        <p className="muted small">{t3('المكافأة الشهرية = أجر الساعة × ساعات الأسبوع × 52 ÷ 12 (تُقرَّب). ساعات الأسبوع تختلف من شخص لآخر.', 'Monthly stipend = hourly rate × weekly hours × 52 ÷ 12 (rounded). Weekly hours differ from person to person.', 'Gratification mensuelle = taux horaire × heures par semaine × 52 ÷ 12 (arrondie). Les heures varient selon la personne.')}</p>
        {!d.grades.length ? (
          <div>
            <p>{t3('لا درجات بعد.', 'No grades yet.', 'Aucun grade pour le moment.')}</p>
            <button className="btn primary" onClick={async () => { try { await s.api.call('hr.grade.seed', { year }); await reload(); } catch (e) { fail(e); } }}>{t3('حمّل السلّم المقترح (أربع درجات) لتعدّله', 'Load the proposed scale (four grades) to edit', "Charger l'échelle proposée (quatre grades) à modifier")}</button>
          </div>
        ) : (
          <div className="desk-scroll">
            <table className="desk-table">
              <thead><tr><th>{t3('الدرجة', 'Grade', 'Grade')}</th><th>{t3('الأدوار', 'Roles', 'Rôles')}</th><th>{year}</th>{typical.map((h) => <th key={h} className="n">{h} {t3('س', 'h/week', 'h/sem')}</th>)}<th /></tr></thead>
              <tbody>
                {d.grades.map((g) => {
                  const r = rateFor(g, year);
                  return (
                    <tr key={g.id}>
                      <td><b>{g.name}</b></td><td className="small">{g.note ?? ''}</td><td className="n">{usd(r)}</td>
                      {typical.map((h) => <td key={h} className="n">{r != null ? usd(monthlyFromRate(r, h, d.settings.roundTo)) : '—'}</td>)}
                      <td className="right"><button className="btn small" onClick={() => setGrade(g)}>{t3('تعديل', 'Edit', 'Modifier')}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cty-card" style={{ marginTop: 12 }}>
        <b>{t3('ما يُعطى لكل شخص اليوم', 'What each person gets today', "Ce que reçoit chaque personne aujourd'hui")}</b>
        <div className="desk-scroll">
          <table className="desk-table">
            <thead><tr><th>{t3('الاسم', 'Name', 'Nom')}</th><th>{t3('الدرجة', 'Grade', 'Grade')}</th><th className="n">{t3('س/أسبوع', 'h/week', 'h/sem')}</th><th className="n">{t3('شهرياً', 'Monthly', 'Mensuel')}</th><th className="n">{t3('الساعة', 'Hourly', 'Horaire')}</th><th className="n">{t3(`سنوياً (×${d.settings.paymentsPerYear})`, `Yearly (×${d.settings.paymentsPerYear})`, `Annuel (×${d.settings.paymentsPerYear})`)}</th><th /></tr></thead>
            <tbody>
              {rows.map(({ p, c }) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b><div className="muted small">{p.role ?? ''}</div></td>
                  <td>{c ? (c.grade?.name ?? t3('مبلغ خاص', 'own amount', 'montant propre')) : '—'}</td>
                  <td className="n">{c?.weekly ?? '—'}{c?.weekly && c.weekly > d.settings.maxWeekly ? <span className="desk-alert" title={t3(`أكثر من ${d.settings.maxWeekly} ساعة (حد الاتفاقية)`, `Above ${d.settings.maxWeekly} h (the agreement's maximum)`, `Au-dessus de ${d.settings.maxWeekly} h (maximum de l'accord)`)}> ⚠</span> : null}</td>
                  <td className="n"><b>{usd(c?.monthly)}</b></td>
                  <td className="n" title={c?.monthly != null ? t3(`مع الدفعة الثالثة عشرة: ${usd(hourlyWithThirteenth(c.monthly, c.weekly, d.settings.paymentsPerYear))}`, `With the 13th payment: ${usd(hourlyWithThirteenth(c.monthly, c.weekly, d.settings.paymentsPerYear))}`, `Avec le 13e paiement : ${usd(hourlyWithThirteenth(c.monthly, c.weekly, d.settings.paymentsPerYear))}`) : ''}>{c?.monthly != null ? usd(hourlyFromMonthly(c.monthly, c.weekly)) : '—'}</td>
                  <td className="n">{c?.monthly != null ? usd(yearlyCost(c.monthly, d.settings.paymentsPerYear)) : '—'}</td>
                  <td className="right"><button className="btn small" onClick={() => setEditPay(p)}>{t3('الراتب', 'Pay', 'Paie')}</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="muted">{t3('أضف الأشخاص أولاً.', 'Add the people first.', "Ajoutez d'abord les personnes.")}</td></tr>}
              {rows.length > 0 && <tr><td colSpan={3}><b>{t3('المجموع', 'Total', 'Total')}</b></td><td className="n"><b>{usd(monthlyTotal)}</b></td><td /><td className="n"><b>{usd(yearlyCost(monthlyTotal, d.settings.paymentsPerYear))}</b></td><td /></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small">{t3('الدفعة الثالثة عشرة مكافأة بدل الضمان الاجتماعي. مرّر المؤشر على أجر الساعة لتراه معها.', 'The 13th payment is a bonus instead of social security. Hover the hourly rate to see it with the 13th.', 'Le 13e paiement est une gratification à la place de la sécurité sociale. Survolez le taux horaire pour le voir avec le 13e.')}</p>
      </div>

      <Settings s={s} d={d} reload={reload} />
      {grade && <GradeModal s={s} grade={grade === 'new' ? null : grade} onClose={() => setGrade(null)} reload={reload} />}
      {editPay && <PayModal s={s} d={d} person={editPay} onClose={() => setEditPay(null)} reload={reload} />}
    </>
  );
}

function Settings({ s, d, reload }: { s: Session; d: HrPayData; reload: () => Promise<void> }) {
  const [f, setF] = useState({ paymentsPerYear: String(d.settings.paymentsPerYear), roundTo: String(d.settings.roundTo), maxWeekly: String(d.settings.maxWeekly) });
  return (
    <div className="cty-card" style={{ marginTop: 12 }}>
      <b>{t3('الإعدادات', 'Settings', 'Réglages')}</b>
      <div className="grid2" style={{ marginTop: 6 }}>
        <Field label={t3('عدد الدفعات في السنة (الثالثة عشرة = بدل الضمان)', 'Payments a year (the 13th = instead of social security)', 'Paiements par an (le 13e = à la place de la sécurité sociale)')}><input inputMode="decimal" value={f.paymentsPerYear} onChange={(e) => setF({ ...f, paymentsPerYear: e.target.value })} /></Field>
        <Field label={t3('تقريب المبلغ الشهري إلى أقرب', 'Round the monthly amount to the nearest', 'Arrondir le mensuel au plus proche de')}><input inputMode="decimal" value={f.roundTo} onChange={(e) => setF({ ...f, roundTo: e.target.value })} /></Field>
        <Field label={t3('الحد الأقصى لساعات الأسبوع (الاتفاقية)', "Maximum weekly hours (the agreement's)", "Maximum d'heures par semaine (l'accord)")}><input inputMode="decimal" value={f.maxWeekly} onChange={(e) => setF({ ...f, maxWeekly: e.target.value })} /></Field>
      </div>
      <button className="btn small" onClick={async () => {
        try { await s.api.call('hr.pay.settings', { paymentsPerYear: Number(f.paymentsPerYear), roundTo: Number(f.roundTo), maxWeekly: Number(f.maxWeekly) }); toast(t3('حُفظ', 'Saved', 'Enregistré')); await reload(); } catch (e) { fail(e); }
      }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
    </div>
  );
}

function GradeModal({ s, grade, onClose, reload }: { s: Session; grade: HrGrade | null; onClose: () => void; reload: () => Promise<void> }) {
  const y = new Date().getFullYear();
  const years = useMemo(() => [...new Set([y, y + 1, y + 2, ...Object.keys(grade?.rates ?? {}).map(Number)])].sort(), [grade, y]);
  const [name, setName] = useState(grade?.name ?? '');
  const [note, setNote] = useState(grade?.note ?? '');
  const [rates, setRates] = useState<Record<number, string>>(() => Object.fromEntries(years.map((yr) => [yr, grade?.rates[yr] != null ? String(grade.rates[yr]) : ''])));
  return (
    <Modal title={grade?.name ?? t3('درجة جديدة', 'New grade', 'Nouveau grade')} onClose={onClose} narrow>
      <Field label={t3('الاسم', 'Name', 'Nom')}><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t3('الأدوار (للتذكير)', 'Roles (a reminder)', 'Rôles (pour mémoire)')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <h3>{t3('أجر الساعة الأساسي (دولار)', 'Base hourly rate (USD)', 'Taux horaire de base (USD)')}</h3>
      <div className="grid2">
        {years.map((yr) => <Field key={yr} label={String(yr)}><input inputMode="decimal" value={rates[yr] ?? ''} onChange={(e) => setRates({ ...rates, [yr]: e.target.value })} /></Field>)}
      </div>
      <div className="modal-foot">
        {grade && <button className="btn danger" onClick={async () => {
          if (!(await confirmBox(t3('حذف هذه الدرجة؟', 'Delete this grade?', 'Supprimer ce grade ?'), true))) return;
          try { await s.api.call('hr.grade.delete', { id: grade.id }); await reload(); onClose(); } catch (e) { fail(e); }
        }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        <button className="btn primary" disabled={!name.trim()} onClick={async () => {
          try {
            await s.api.call('hr.grade.save', { id: grade?.id ?? null, name, note, rates: Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, v === '' ? null : Number(v)])) });
            await reload(); onClose();
          } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

function PayModal({ s, d, person, onClose, reload }: { s: Session; d: HrPayData; person: HrPerson; onClose: () => void; reload: () => Promise<void> }) {
  const mine = d.pays.filter((x) => x.person_id === person.id).sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  const cur = payOn(d, person.id, todayIso());
  const [f, setF] = useState({ validFrom: todayIso(), gradeId: String(cur?.pay.grade_id ?? ''), weekly: String(cur?.weekly ?? ''), monthly: '', note: '' });
  const rate = f.gradeId ? rateFor(d.grades.find((g) => g.id === Number(f.gradeId))!, Number(f.validFrom.slice(0, 4))) : null;
  const preview = f.monthly !== '' ? Number(f.monthly) : rate != null && Number(f.weekly) > 0 ? monthlyFromRate(rate, Number(f.weekly), d.settings.roundTo) : null;
  const label = (p: HrPay) => `${fmtDate(p.valid_from)} · ${p.grade_id ? d.grades.find((g) => g.id === p.grade_id)?.name : t3('مبلغ خاص', 'own amount', 'montant propre')} · ${p.weekly_hours ?? '—'} ${t3('س/أسبوع', 'h/week', 'h/sem')}${p.monthly_usd != null ? ` · ${usd(p.monthly_usd)}` : ''}`;
  return (
    <Modal title={`${t3('الراتب', 'Pay', 'Paie')} · ${person.name}`} onClose={onClose}>
      <table className="desk-table">
        <tbody>
          {mine.map((p) => (
            <tr key={p.id}><td>{label(p)}</td><td className="right"><button className="btn small danger" onClick={async () => {
              if (!(await confirmBox(t3('حذف هذا السطر؟', 'Delete this line?', 'Supprimer cette ligne ?'), true))) return;
              try { await s.api.call('hr.pay.delete', { id: p.id }); await reload(); } catch (e) { fail(e); }
            }}>✕</button></td></tr>
          ))}
          {!mine.length && <tr><td className="muted">{t3('لا شيء بعد.', 'Nothing yet.', 'Rien pour le moment.')}</td></tr>}
        </tbody>
      </table>
      <h3 style={{ marginTop: 12 }}>{t3('سطر جديد (يبقى القديم كتاريخ)', 'A new line (the old ones stay as history)', "Une nouvelle ligne (les anciennes restent comme historique)")}</h3>
      <div className="grid2">
        <Field label={t3('ابتداءً من', 'From', 'À partir du')}><input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field>
        <Field label={t3('ساعات الأسبوع', 'Weekly hours', 'Heures par semaine')}><input inputMode="decimal" value={f.weekly} onChange={(e) => setF({ ...f, weekly: e.target.value })} /></Field>
        <Field label={t3('الدرجة', 'Grade', 'Grade')}>
          <select value={f.gradeId} onChange={(e) => setF({ ...f, gradeId: e.target.value })}>
            <option value="">{t3('— بلا درجة (مبلغ خاص) —', '— no grade (own amount) —', '— sans grade (montant propre) —')}</option>
            {d.grades.map((g) => <option key={g.id} value={g.id}>{g.name}{g.note ? ` · ${g.note}` : ''}</option>)}
          </select>
        </Field>
        <Field label={t3('أو مبلغ شهري خاص (دولار)', 'Or an own monthly amount (USD)', 'Ou un montant mensuel propre (USD)')}><input inputMode="decimal" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} /></Field>
      </div>
      <Field label={t3('ملاحظة', 'Note', 'Note')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      {preview != null && <p className="ok">{t3('شهرياً', 'Monthly', 'Mensuel')}: <b>{usd(preview)}</b> · {t3('الساعة', 'hourly', 'horaire')} {usd(hourlyFromMonthly(preview, Number(f.weekly)))} · {t3('سنوياً', 'yearly', 'annuel')} {usd(yearlyCost(preview, d.settings.paymentsPerYear))}</p>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إغلاق', 'Close', 'Fermer')}</button>
        <button className="btn primary" disabled={!f.validFrom || (!f.gradeId && f.monthly === '')} onClick={async () => {
          try {
            await s.api.call('hr.pay.save', { personId: person.id, validFrom: f.validFrom, gradeId: f.gradeId ? Number(f.gradeId) : null, weeklyHours: f.weekly === '' ? null : Number(f.weekly), monthlyUsd: f.monthly === '' ? null : Number(f.monthly), note: f.note || null });
            toast(t3('حُفظ', 'Saved', 'Enregistré')); await reload(); onClose();
          } catch (e) { fail(e); }
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
