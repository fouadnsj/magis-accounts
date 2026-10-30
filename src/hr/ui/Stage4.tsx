// HR stage 4 screens: the health insurance (the person and the family, paid yearly, with the end date),
// the split of a person's cost by donor or project, and the report of staff cost by donor or project.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '../../state';
import { errText, Field, Modal, confirmBox, fmtDate, toast, todayIso } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import type { HrData, HrPerson } from '../hr';
import type { HrAlloc, HrInsurance } from '../stage4';

const fail = (e: unknown) => toast(errText(e), true);
const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const daysTo = (d: string) => Math.round((Date.parse(d) - Date.parse(todayIso())) / 86400e3);

export function InsurancePage({ s, hr }: { s: Session; hr: HrData }) {
  const [rows, setRows] = useState<HrInsurance[] | null>(null);
  const [edit, setEdit] = useState<{ row: HrInsurance | null; personId: number | null } | null>(null);
  const load = useCallback(async () => { try { setRows(await s.api.call('hr.ins.list', {})); } catch (e) { fail(e); } }, [s]);
  useEffect(() => { void load(); }, [load]);
  if (!rows) return <p className="muted">…</p>;
  const people = hr.people.filter((p) => p.active || rows.some((r) => r.person_id === p.id));
  const total = rows.filter((r) => hr.people.find((p) => p.id === r.person_id)?.active).reduce((a, r) => a + r.amount_usd, 0);
  const due = (r: HrInsurance) => (r.end_date ? daysTo(r.end_date) : null);
  return (
    <>
      <div className="desk-head"><h1>{t3('التأمين الصحي', 'Health insurance', 'Assurance maladie')}</h1><button className="btn primary" onClick={() => setEdit({ row: null, personId: null })}>＋ {t3('مؤمَّن', 'Add an insured person', 'Ajouter un assuré')}</button></div>
      <p className="muted small">{t3('يُدفع سنوياً. يظهر تنبيه في الصفحة الأولى قبل انتهائه بـ 60 يوماً.', 'Paid yearly. A reminder appears on the home page 60 days before it ends.', "Payée chaque année. Un rappel apparaît sur la page d'accueil 60 jours avant la fin.")}</p>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الموظف', 'Staff member', 'Membre du personnel')}</th><th>{t3('المؤمَّن', 'Insured', 'Assuré')}</th><th className="n">{t3('سنوياً (دولار)', 'Yearly (USD)', 'Par an (USD)')}</th><th>{t3('ينتهي', 'Ends', 'Fin')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const dd = due(r);
              const p = people.find((x) => x.id === r.person_id);
              return (
                <tr key={r.id} style={{ opacity: p?.active ? 1 : 0.55 }}>
                  <td><b>{p?.name ?? '?'}</b></td>
                  <td>{r.member_name ? `${r.member_name}${r.relation ? ` (${r.relation})` : ''}` : t3('هو/هي نفسه', 'The staff member', 'Le membre lui-même')}</td>
                  <td className="n">{usd(r.amount_usd)}</td>
                  <td className={dd != null && dd <= 60 ? 'desk-alert' : ''}>{r.end_date ? fmtDate(r.end_date) : '—'}{dd != null && dd <= 60 ? ` ⚠ ${dd < 0 ? t3('منتهٍ', 'ended', 'terminée') : t3(`بعد ${dd} يوماً`, `in ${dd} days`, `dans ${dd} jours`)}` : ''}</td>
                  <td className="right"><button className="btn small" onClick={() => setEdit({ row: r, personId: r.person_id })}>{t3('تعديل', 'Edit', 'Modifier')}</button></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="muted">{t3('لا أحد مؤمَّن بعد.', 'Nobody insured yet.', 'Personne assuré pour le moment.')}</td></tr>}
            {rows.length > 0 && <tr><td colSpan={2}><b>{t3('المجموع السنوي', 'Yearly total', 'Total annuel')}</b></td><td className="n"><b>{usd(total)}</b></td><td colSpan={2} /></tr>}
          </tbody>
        </table>
      </div>
      {edit && <InsModal s={s} people={hr.people.filter((p) => p.active)} row={edit.row} personId={edit.personId} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); await load(); }} />}
    </>
  );
}

function InsModal({ s, people, row, personId, onClose, onDone }: { s: Session; people: HrPerson[]; row: HrInsurance | null; personId: number | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ personId: personId ? String(personId) : '', member: row?.member_name ?? '', relation: row?.relation ?? '', amount: row ? String(row.amount_usd) : '', end: row?.end_date ?? '', paidOn: row?.paid_on ?? '' });
  const [family, setFamily] = useState(!!row?.member_name);
  return (
    <Modal title={t3('تأمين صحي', 'Health insurance', 'Assurance maladie')} onClose={onClose} narrow>
      <Field label={t3('الموظف', 'Staff member', 'Membre du personnel')}>
        <select value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}><option value="" />{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </Field>
      <label className="row" style={{ gap: 6, margin: '6px 0' }}><input type="checkbox" checked={family} onChange={(e) => setFamily(e.target.checked)} /> {t3('فرد من العائلة', 'A family member', 'Un membre de la famille')}</label>
      {family && <div className="grid2"><Field label={t3('الاسم', 'Name', 'Nom')}><input value={f.member} onChange={(e) => setF({ ...f, member: e.target.value })} /></Field><Field label={t3('القرابة', 'Relation', 'Lien')}><input value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} /></Field></div>}
      <div className="grid2">
        <Field label={t3('المبلغ السنوي (دولار)', 'Yearly amount (USD)', 'Montant annuel (USD)')}><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t3('تاريخ انتهاء التأمين', 'End date of the insurance', "Date de fin de l'assurance")}><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        <Field label={t3('دُفع في', 'Paid on', 'Payée le')}><input type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
      </div>
      <div className="modal-foot">
        {row && <button className="btn danger" onClick={async () => { if (await confirmBox(t3('حذف؟', 'Delete?', 'Supprimer ?'), true)) { try { await s.api.call('hr.ins.delete', { id: row.id }); await onDone(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        <button className="btn primary" disabled={!f.personId || f.amount === '' || (family && !f.member.trim())} onClick={async () => {
          try { await s.api.call('hr.ins.save', { id: row?.id ?? null, personId: Number(f.personId), memberName: family ? f.member : null, relation: family ? f.relation : null, amountUsd: Number(f.amount), endDate: f.end || null, paidOn: f.paidOn || null }); await onDone(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

/** The split of one person's cost by donor or project, from a date (the earlier ones stay as history). */
export function SplitModal({ s, person, onClose }: { s: Session; person: HrPerson; onClose: () => void }) {
  const [all, setAll] = useState<HrAlloc[] | null>(null);
  const load = useCallback(async () => { try { setAll((await s.api.call('hr.alloc.list', {})).filter((a) => a.person_id === person.id)); } catch (e) { fail(e); } }, [s, person.id]);
  useEffect(() => { void load(); }, [load]);
  const dates = useMemo(() => [...new Set((all ?? []).map((a) => a.valid_from))].sort().reverse(), [all]);
  const [from, setFrom] = useState(todayIso());
  const [parts, setParts] = useState<{ target: string; pct: string }[]>([{ target: '', pct: '100' }]);
  const sum = parts.reduce((a, p) => a + (Number(p.pct) || 0), 0);
  const edit = (d: string) => { setFrom(d); setParts((all ?? []).filter((a) => a.valid_from === d).map((a) => ({ target: a.target, pct: String(a.pct) }))); };
  return (
    <Modal title={`${t3('توزيع التكلفة', 'Cost split', 'Répartition du coût')} · ${person.name}`} onClose={onClose}>
      <p className="muted small">{t3('نسبة من تكلفة هذا الشخص لكل مانح أو مشروع (المجموع 100%). تُستعمل في القسيمة وتقرير المانحين.', 'The share of this person\'s cost for each donor or project (total 100%). Used in the voucher and the donor report.', 'La part du coût de cette personne pour chaque bailleur ou projet (total 100 %). Utilisée dans le bon et le rapport bailleurs.')}</p>
      {dates.length > 0 && <table className="desk-table"><tbody>
        {dates.map((d) => <tr key={d}><td>{t3('من', 'From', 'Dès le')} {fmtDate(d)}</td><td>{(all ?? []).filter((a) => a.valid_from === d).map((a) => `${a.target} ${a.pct}%`).join(' · ')}</td><td className="right nowrap"><button className="btn small" onClick={() => edit(d)}>{t3('تعديل', 'Edit', 'Modifier')}</button>{' '}<button className="btn small danger" onClick={async () => { if (await confirmBox(t3('حذف هذا التوزيع؟', 'Delete this split?', 'Supprimer cette répartition ?'), true)) { try { await s.api.call('hr.alloc.delete', { personId: person.id, validFrom: d }); await load(); } catch (e) { fail(e); } } }}>✕</button></td></tr>)}
      </tbody></table>}
      <h3 style={{ marginTop: 12 }}>{t3('توزيع جديد', 'A split', 'Une répartition')}</h3>
      <Field label={t3('ابتداءً من', 'From', 'À partir du')}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      {parts.map((p, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 4 }}>
          <input style={{ flex: 1 }} placeholder={t3('المانح أو المشروع', 'Donor or project', 'Bailleur ou projet')} value={p.target} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
          <input style={{ width: 80 }} inputMode="decimal" value={p.pct} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} /> %
          {parts.length > 1 && <button className="btn small" onClick={() => setParts(parts.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      <button className="btn small" onClick={() => setParts([...parts, { target: '', pct: String(Math.max(0, 100 - sum)) }])}>＋ {t3('مانح أو مشروع', 'Add a donor or project', 'Ajouter un bailleur ou projet')}</button>
      <p className={Math.abs(sum - 100) < 0.01 ? 'ok' : 'desk-alert'}>{t3('المجموع', 'Total', 'Total')}: {usd(sum)}%</p>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إغلاق', 'Close', 'Fermer')}</button>
        <button className="btn primary" disabled={Math.abs(sum - 100) > 0.01 || parts.some((p) => !p.target.trim())} onClick={async () => {
          try { await s.api.call('hr.alloc.save', { personId: person.id, validFrom: from, parts: parts.map((p) => ({ target: p.target, pct: Number(p.pct) })) }); toast(t3('حُفظ', 'Saved', 'Enregistré')); await load(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

/** Staff cost by donor or project, month by month, from the approved and paid runs. */
export function DonorsPage({ s }: { s: Session }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<{ ym: string; target: string | null; total_usd: number }[] | null>(null);
  useEffect(() => { setRows(null); s.api.call('hr.alloc.report', { year }).then(setRows).catch(fail); }, [s, year]);
  const targets = useMemo(() => [...new Set((rows ?? []).map((r) => r.target ?? ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))), [rows]);
  const months = useMemo(() => [...new Set((rows ?? []).map((r) => r.ym))].sort(), [rows]);
  const cell = (ym: string, t: string) => (rows ?? []).find((r) => r.ym === ym && (r.target ?? '') === t)?.total_usd ?? 0;
  return (
    <>
      <div className="desk-head"><h1>{t3('تكلفة الموظفين حسب المانح', 'Staff cost by donor or project', 'Coût du personnel par bailleur ou projet')}</h1><div className="desk-filters"><input type="number" style={{ width: 90 }} value={year} onChange={(e) => setYear(Number(e.target.value))} /></div></div>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الشهر', 'Month', 'Mois')}</th>{targets.map((t) => <th key={t} className="n">{t || t3('غير موزَّع', 'Not split', 'Non réparti')}</th>)}<th className="n">{t3('المجموع', 'Total', 'Total')}</th></tr></thead>
          <tbody>
            {months.map((ym) => <tr key={ym}><td>{ym}</td>{targets.map((t) => <td key={t} className="n">{cell(ym, t) ? usd(cell(ym, t)) : ''}</td>)}<td className="n"><b>{usd(targets.reduce((a, t) => a + cell(ym, t), 0))}</b></td></tr>)}
            {rows && !rows.length && <tr><td className="muted">{t3('لا كشوف معتمدة في هذه السنة.', 'No approved runs this year.', 'Aucune paie approuvée cette année.')}</td></tr>}
            {months.length > 0 && <tr><td><b>{t3('المجموع', 'Total', 'Total')}</b></td>{targets.map((t) => <td key={t} className="n"><b>{usd(months.reduce((a, ym) => a + cell(ym, t), 0))}</b></td>)}<td className="n"><b>{usd(months.reduce((a, ym) => a + targets.reduce((b, t) => b + cell(ym, t), 0), 0))}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
