// HR stage 4 screens: the health insurance (the person and the family, paid yearly, with the end date),
// the split of a person's cost by donor or project, and the report of staff cost by donor or project.
import { has } from '../../auth';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import type { Session } from '../../state';
import { saveFile } from '../../platform';
import { errText, Field, Modal, confirmBox, fmtDate, toast, todayIso } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import type { HrData, HrPerson } from '../hr';
import { allocOn, type HrAlloc, type HrInsurance } from '../stage4';
import type { HrPayData } from '../payOps';
import { payOn } from '../pay';
import { accountFor, centreAccounts } from '../link';
import { SortTh, TwoNames, sortRows, useSort } from './common';
import { GuideLink } from '../../guide/GuideView';

const fail = (e: unknown) => toast(errText(e), true);
const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const daysTo = (d: string) => Math.round((Date.parse(d) - Date.parse(todayIso())) / 86400e3);

export function InsurancePage({ s, hr, only }: { s: Session; hr: HrData; /** one person's insurance only (their page) */ only?: number }) {
  const [rows, setRows] = useState<HrInsurance[] | null>(null);
  const [edit, setEdit] = useState<{ row: HrInsurance | null; personId: number | null; family: boolean } | null>(null);
  const load = useCallback(async () => { try { setRows(await s.api.call('hr.ins.list', {})); } catch (e) { fail(e); } }, [s]);
  useEffect(() => { void load(); }, [load]);
  if (!rows) return <p className="muted">…</p>;
  const active = (r: HrInsurance) => hr.people.find((p) => p.id === r.person_id)?.active;
  // what the centre pays, by currency (the staff member's own insurance); the family's is paid by the staff member and kept apart
  const centre = rows.filter((r) => r.paid_by === 'centre' && active(r));
  const sum = (xs: HrInsurance[], c: 'USD' | 'SYP') => xs.filter((r) => r.currency === c).reduce((a, r) => a + r.amount_usd, 0);
  const dd = (r: HrInsurance) => (r.end_date ? daysTo(r.end_date) : null);
  const money = (r: HrInsurance) => `${usd(r.amount_usd)} ${r.currency}`;
  const endCell = (r: HrInsurance) => (
    <td className={dd(r) != null && dd(r)! <= 60 ? 'desk-alert' : ''}>{r.end_date ? fmtDate(r.end_date) : '—'}{dd(r) != null && dd(r)! <= 60 ? ` ⚠ ${dd(r)! < 0 ? t3('منتهٍ', 'ended', 'terminée') : t3(`بعد ${dd(r)} يوماً`, `in ${dd(r)} days`, `dans ${dd(r)} jours`)}` : ''}</td>
  );
  const people = only ? hr.people.filter((p) => p.id === only) : hr.people.filter((p) => rows.some((r) => r.person_id === p.id));
  return (
    <>
      {!only && <div className="hr-head"><div><div className="hr-eyebrow">{t3('المكافآت', 'Stipends', 'Gratifications')}</div><h1>{t3('التأمين الصحي', 'Health insurance', 'Assurance maladie')}<GuideLink id="hr-funding" /></h1></div><button className="btn gold" onClick={() => setEdit({ row: null, personId: null, family: false })}>＋ {t3('تأمين', 'Add an insurance', 'Ajouter une assurance')}</button></div>}
      <p className="muted small">{t3('يُدفع سنوياً، بالدولار أو بالليرة. تأمين الموظف نفسه تدفعه المؤسسة، وتأمين عائلته يدفعه هو، ويُسجَّل منفصلاً. يظهر تنبيه قبل انتهائه بـ 60 يوماً.', "Paid yearly, in USD or SYP. The staff member's own insurance is paid by the centre; the family's is paid by the staff member and is kept apart. A reminder appears 60 days before it ends.", "Payée chaque année, en USD ou en SYP. L'assurance du membre du personnel est payée par le centre ; celle de sa famille par lui, et elle est séparée. Un rappel apparaît 60 jours avant la fin.")}</p>
      {people.map((p) => {
        const mine = rows.filter((r) => r.person_id === p.id);
        const own = mine.filter((r) => !r.member_name), family = mine.filter((r) => r.member_name);
        return (
          <div key={p.id} className="hr-panel" style={{ marginTop: only ? 0 : 10, opacity: p.active ? 1 : 0.55 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><b>{p.name_ar || p.name}</b><span className="row" style={{ gap: 6 }}><button className="btn small" onClick={() => setEdit({ row: null, personId: p.id, family: false })}>＋ {t3('تأمينه', 'His/her own', 'La sienne')}</button><button className="btn small" onClick={() => setEdit({ row: null, personId: p.id, family: true })}>＋ {t3('فرد من العائلة', 'A family member', 'Un membre de la famille')}</button></span></div>
            <div className="muted small">{t3('تدفعه المؤسسة', 'Paid by the centre', 'Payé par le centre')}</div>
            <table className="desk-table"><tbody>
              {own.map((r) => <tr key={r.id}><td>{t3('هو/هي نفسه', 'The staff member', 'Le membre lui-même')}</td><td className="n">{money(r)}</td>{endCell(r)}<td className="right"><button className="btn small" onClick={() => setEdit({ row: r, personId: p.id, family: false })}>{t3('تعديل', 'Edit', 'Modifier')}</button></td></tr>)}
              {!own.length && <tr><td className="muted">—</td></tr>}
            </tbody></table>
            <div className="muted small" style={{ marginTop: 6 }}>{t3('العائلة — يدفعها الموظف (منفصلة)', 'Family — paid by the staff member (separate)', 'Famille — payée par le membre du personnel (séparée)')}</div>
            <table className="desk-table"><tbody>
              {family.map((r) => <tr key={r.id}><td>{r.member_name}{r.relation ? ` (${r.relation})` : ''}</td><td className="n">{money(r)}</td>{endCell(r)}<td className="right"><button className="btn small" onClick={() => setEdit({ row: r, personId: p.id, family: true })}>{t3('تعديل', 'Edit', 'Modifier')}</button></td></tr>)}
              {!family.length && <tr><td className="muted">—</td></tr>}
            </tbody></table>
          </div>
        );
      })}
      {!rows.length && !only && <p className="muted">{t3('لا أحد مؤمَّن بعد.', 'Nobody insured yet.', 'Personne assuré pour le moment.')}</p>}
      {centre.length > 0 && !only && <p style={{ marginTop: 10 }}><b>{t3('تدفع المؤسسة سنوياً', 'The centre pays yearly', 'Le centre paie par an')}:</b> {sum(centre, 'USD') ? `${usd(sum(centre, 'USD'))} USD` : ''}{sum(centre, 'USD') && sum(centre, 'SYP') ? ' + ' : ''}{sum(centre, 'SYP') ? `${usd(sum(centre, 'SYP'))} SYP` : ''}</p>}
      {edit && <InsModal s={s} people={hr.people.filter((p) => p.active)} row={edit.row} personId={edit.personId} family={edit.family} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); await load(); }} />}
    </>
  );
}

function InsModal({ s, people, row, personId, family: fam, onClose, onDone }: { s: Session; people: HrPerson[]; row: HrInsurance | null; personId: number | null; family: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ personId: personId ? String(personId) : '', member: row?.member_name ?? '', relation: row?.relation ?? '', amount: row ? String(row.amount_usd) : '', currency: (row?.currency ?? 'USD') as 'USD' | 'SYP', end: row?.end_date ?? '', paidOn: row?.paid_on ?? '' });
  return (
    <Modal title={fam ? t3('تأمين فرد من العائلة (يدفعه الموظف)', 'Insurance of a family member (paid by the staff member)', "Assurance d'un membre de la famille (payée par le membre du personnel)") : t3('تأمين الموظف (تدفعه المؤسسة)', 'Insurance of the staff member (paid by the centre)', 'Assurance du membre du personnel (payée par le centre)')} onClose={onClose} narrow>
      <Field label={t3('الموظف', 'Staff member', 'Membre du personnel')}>
        <select value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}><option value="" />{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </Field>
      {fam && <div className="grid2"><Field label={t3('الاسم', 'Name', 'Nom')}><input value={f.member} onChange={(e) => setF({ ...f, member: e.target.value })} /></Field><Field label={t3('القرابة', 'Relation', 'Lien')}><input value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} /></Field></div>}
      <div className="grid2">
        <Field label={t3('المبلغ السنوي', 'Yearly amount', 'Montant annuel')}><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t3('العملة', 'Currency', 'Devise')}><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'SYP' })}><option value="USD">USD</option><option value="SYP">SYP</option></select></Field>
        <Field label={t3('تاريخ انتهاء التأمين', 'End date of the insurance', "Date de fin de l'assurance")}><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        <Field label={t3('دُفع في', 'Paid on', 'Payée le')}><input type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
      </div>
      <div className="modal-foot">
        {row && <button className="btn danger" onClick={async () => { if (await confirmBox(t3('حذف؟', 'Delete?', 'Supprimer ?'), true)) { try { await s.api.call('hr.ins.delete', { id: row.id }); await onDone(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        <button className="btn primary" disabled={!f.personId || f.amount === '' || (fam && !f.member.trim())} onClick={async () => {
          try { await s.api.call('hr.ins.save', { id: row?.id ?? null, personId: Number(f.personId), memberName: fam ? f.member : null, relation: fam ? f.relation : null, amountUsd: Number(f.amount), currency: f.currency, paidBy: fam ? 'staff' : 'centre', endDate: f.end || null, paidOn: f.paidOn || null }); await onDone(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

type FundSort = 'project' | 'donors' | 'people' | 'monthly';

/**
 * Donors and funding (Fouad, 31 October 2026): today, which project (account) and which donors pay for whom, and how
 * much a month; and, from the approved runs, what each project really cost month by month.
 */
export function DonorsPage({ s, hr, pd, open }: { s: Session; hr: HrData; pd: HrPayData; open: (p: HrPerson) => void }) {
  const [tab, setTab] = useState<'today' | 'paid'>('today');
  const [allocs, setAllocs] = useState<HrAlloc[] | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => { s.api.call('hr.alloc.list', {}).then(setAllocs).catch(fail); }, [s]);
  const sort = useSort<FundSort>('monthly', -1);
  const today = todayIso();
  // every active person's monthly cost, divided between the projects that fund it
  const rows = useMemo(() => {
    const acc = new Map<string, { project: string; centre: string | null; donors: string | null; people: { p: HrPerson; pct: number; usd: number }[]; monthly: number }>();
    for (const p of hr.people.filter((x) => x.active)) {
      const m = payOn(pd, p.id, today)?.monthly ?? 0;
      const split = allocOn(allocs ?? [], p.id, today);
      const parts = split.length ? split.map((a) => ({ target: a.target, pct: a.pct })) : [{ target: accountFor(hr.lists, p) ?? '', pct: 100 }];
      for (const a of parts) {
        const k = `${p.centre ?? ''}|${a.target}`;
        const accItem = centreAccounts(hr.lists, p).find((x) => x.name.toLowerCase() === a.target.toLowerCase());
        const g = acc.get(k) ?? { project: a.target, centre: p.centre, donors: accItem?.donors ?? null, people: [], monthly: 0 };
        const share = Math.round(m * a.pct) / 100;
        g.people.push({ p, pct: a.pct, usd: share });
        g.monthly = Math.round((g.monthly + share) * 100) / 100;
        acc.set(k, g);
      }
    }
    return [...acc.values()];
  }, [hr, pd, allocs, today]);
  const sorted = sortRows(rows, (r) => (sort.key === 'project' ? r.project : sort.key === 'donors' ? r.donors : sort.key === 'people' ? r.people.length : r.monthly), sort.dir);
  const total = rows.reduce((a, r) => a + r.monthly, 0);
  // the same seen by donor (a project with several donors is counted under each of them, so no total here)
  const donors = [...new Set(rows.flatMap((r) => (r.donors ?? '').split(' | ').filter(Boolean)))].sort();
  const download = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Funding');
    ws.addRow([`Who funds whom · ${today}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    const head = ws.addRow(['Centre', 'Project (account)', 'Donors', 'Name', 'Position', 'Share %', 'Monthly USD']);
    head.font = { bold: true };
    for (const r of sorted) for (const x of r.people) ws.addRow([r.centre ?? '', r.project, (r.donors ?? '').split(' | ').join(', '), x.p.name_ar ? `${x.p.name_ar} · ${x.p.name}` : x.p.name, x.p.role ?? '', x.pct, x.usd]);
    ws.addRow(['Total', '', '', '', '', '', total]).font = { bold: true };
    ws.columns = [{ width: 16 }, { width: 26 }, { width: 30 }, { width: 32 }, { width: 22 }, { width: 9 }, { width: 14 }];
    ws.getColumn(7).numFmt = '#,##0.00';
    ws.autoFilter = { from: 'A3', to: 'G3' };
    await saveFile(`Funding-${today}.xlsx`, ['xlsx'], new Uint8Array(await wb.xlsx.writeBuffer()), 'Excel');
  };
  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('كما في المحاسبة والموازنات', 'As in the accounts and the budgets', 'Comme en comptabilité et dans les budgets')}</div><h1>{t3('المانحون والتمويل', 'Donors & funding', 'Bailleurs et financement')}<GuideLink id="hr-funding" /></h1></div>
        <div className="desk-filters">
          <button className={`btn small ${tab === 'today' ? 'primary' : ''}`} onClick={() => setTab('today')}>{t3('من يموّل من (اليوم)', 'Who funds whom (today)', "Qui finance qui (aujourd'hui)")}</button>
          <button className={`btn small ${tab === 'paid' ? 'primary' : ''}`} onClick={() => setTab('paid')}>{t3('ما دُفع شهراً بشهر', 'What was paid, month by month', 'Ce qui a été payé, mois par mois')}</button>
          {tab === 'today' && has(s.profile, 'data.export') && <button className="btn" onClick={() => void download()}>⬇ Excel</button>}
        </div>
      </div>
      {tab === 'paid' ? <PaidByProject s={s} /> : (
        <>
          <p className="muted small">{t3('مكافأة كل شخص يدفعها مشروع خط موازنته في المركز؛ المانح هو صاحب منحة هذا المشروع. أعد نسخ القوائم في «الإعدادات» بعد تغيير مشاريع الموازنة.', "Each person's stipend is paid by the project of their budget line in the centre; the donor is the one whose grant funds that project. Copy the lists again in Settings after the budget's projects change.", "La gratification de chacun est payée par le projet de sa ligne budgétaire dans le centre ; le bailleur est celui dont la subvention finance ce projet. Recopiez les listes dans Réglages après un changement des projets du budget.")}</p>
          <div className="hr-panel desk-scroll">
            <table className="desk-table">
              <thead><tr><SortTh k="project" sort={sort}>{t3('المشروع', 'Project', 'Projet')}</SortTh><SortTh k="donors" sort={sort}>{t3('المانحون', 'Donors', 'Bailleurs')}</SortTh><SortTh k="people" sort={sort} n>{t3('الأشخاص', 'People', 'Personnes')}</SortTh><SortTh k="monthly" sort={sort} n>{t3('شهرياً USD', 'Monthly USD', 'Mensuel USD')}</SortTh><th className="n">{t3(`سنوياً ×${pd.settings.paymentsPerYear}`, `Yearly ×${pd.settings.paymentsPerYear}`, `Annuel ×${pd.settings.paymentsPerYear}`)}</th></tr></thead>
              <tbody>
                {sorted.map((r) => {
                  const k = `${r.centre}|${r.project}`;
                  return (
                    <Fragment key={k}>
                      <tr className="click" onClick={() => setShown(shown === k ? null : k)}>
                        <td><b>{shown === k ? '▾' : '▸'} {r.project || <span className="desk-alert">{t3('غير ممول', 'Not funded', 'Non financé')}</span>}</b><div className="muted small">{r.centre ?? ''}</div></td>
                        <td>{r.donors ? r.donors.split(' | ').join(' · ') : <span className="muted">—</span>}</td>
                        <td className="n">{r.people.length}</td><td className="n"><b>{usd(r.monthly)}</b></td><td className="n">{usd(r.monthly * pd.settings.paymentsPerYear)}</td>
                      </tr>
                      {shown === k && r.people.map((x) => <tr key={`${k}-${x.p.id}`} className="click" onClick={() => open(x.p)}><td style={{ paddingInlineStart: 28 }} colSpan={2}><TwoNames p={x.p} /> <span className="muted small">· {x.p.role ?? ''}</span></td><td className="n">{x.pct}%</td><td className="n">{usd(x.usd)}</td><td /></tr>)}
                    </Fragment>
                  );
                })}
                {rows.length > 0 && <tr><td colSpan={3}><b>{t3('المجموع', 'Total', 'Total')}</b></td><td className="n"><b>{usd(total)}</b></td><td className="n"><b>{usd(total * pd.settings.paymentsPerYear)}</b></td></tr>}
              </tbody>
            </table>
          </div>
          {donors.length > 0 && (
            <div className="hr-panel" style={{ marginTop: 14 }}>
              <b>{t3('حسب المانح', 'By donor', 'Par bailleur')}</b>
              <table className="desk-table" style={{ marginTop: 6 }}>
                <tbody>{donors.map((dn) => { const xs = rows.filter((r) => (r.donors ?? '').split(' | ').includes(dn)); return <tr key={dn}><td><b>{dn}</b></td><td>{xs.map((r) => r.project).join(' · ')}</td><td className="n">{xs.reduce((a, r) => a + r.people.length, 0)} {t3('أشخاص', 'people', 'personnes')}</td><td className="n">{usd(xs.reduce((a, r) => a + r.monthly, 0))} USD</td></tr>; })}</tbody>
              </table>
              <p className="muted small">{t3('مشروع له عدة مانحين يظهر تحت كل واحد منهم.', 'A project with several donors shows under each of them.', 'Un projet avec plusieurs bailleurs apparaît sous chacun.')}</p>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Staff cost by project, month by month, from the approved and paid runs. */
function PaidByProject({ s }: { s: Session }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<{ ym: string; target: string | null; total_usd: number }[] | null>(null);
  useEffect(() => { setRows(null); s.api.call('hr.alloc.report', { year }).then(setRows).catch(fail); }, [s, year]);
  const targets = useMemo(() => [...new Set((rows ?? []).map((r) => r.target ?? ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))), [rows]);
  const months = useMemo(() => [...new Set((rows ?? []).map((r) => r.ym))].sort(), [rows]);
  const cell = (ym: string, t: string) => (rows ?? []).find((r) => r.ym === ym && (r.target ?? '') === t)?.total_usd ?? 0;
  return (
    <div className="hr-panel desk-scroll">
      <div className="row" style={{ gap: 8, marginBottom: 8 }}><span className="muted">{t3('السنة', 'Year', 'Année')}</span><input type="number" style={{ width: 90 }} value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
      <table className="desk-table">
        <thead><tr><th>{t3('الشهر', 'Month', 'Mois')}</th>{targets.map((t) => <th key={t} className="n">{t || t3('حساب المركز (غير موزَّع)', "Centre's account (not split)", 'Compte du centre (non réparti)')}</th>)}<th className="n">{t3('المجموع', 'Total', 'Total')}</th></tr></thead>
        <tbody>
          {months.map((ym) => <tr key={ym}><td>{ym}</td>{targets.map((t) => <td key={t} className="n">{cell(ym, t) ? usd(cell(ym, t)) : ''}</td>)}<td className="n"><b>{usd(targets.reduce((a, t) => a + cell(ym, t), 0))}</b></td></tr>)}
          {rows && !rows.length && <tr><td className="muted">{t3('لا كشوف معتمدة في هذه السنة.', 'No approved runs this year.', 'Aucune paie approuvée cette année.')}</td></tr>}
          {months.length > 0 && <tr><td><b>{t3('المجموع', 'Total', 'Total')}</b></td>{targets.map((t) => <td key={t} className="n"><b>{usd(months.reduce((a, ym) => a + cell(ym, t), 0))}</b></td>)}<td className="n"><b>{usd(months.reduce((a, ym) => a + targets.reduce((b, t) => b + cell(ym, t), 0), 0))}</b></td></tr>}
        </tbody>
      </table>
    </div>
  );
}
