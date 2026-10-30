// HR stage 3 screens: the payroll runs (a month, or the 13th payment), their lines, approval and payment by
// the Superior, the payslips (to print) and the voucher of totals for Accounts (an Excel file, no names).
import { useCallback, useEffect, useState } from 'react';
import ExcelJS from 'exceljs';
import { has } from '../../auth';
import type { Session } from '../../state';
import { errText, Field, Modal, confirmBox, fmtDate, toast, todayIso } from '../../ui/kit';
import { saveFile } from '../../platform';
import { tx, type Msg } from '../../i18n';
const getLangText = (m?: Msg) => (m ? tx(m) : 'Error');
import { payslipsDoc, type DocHead } from '../docs';
import { TwoNames, centreVars, headOf, markOf } from './common';
import { accountFor, centreItem, lineFor, lineLabel } from '../link';
import type { CentreKey } from '../../brand';
import { t3 } from '../../community/ui/text';
import type { HrData } from '../hr';
import type { HrRun, HrRunLine, HrVoucherRow } from '../runOps';

const fail = (e: unknown) => toast(errText(e), true);
const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const KIND = (k: string) => (k === 'thirteenth' ? t3('الدفعة الثالثة عشرة', 'The 13th payment', 'Le 13e paiement') : t3('مكافآت الشهر', 'Monthly stipends', 'Gratifications du mois'));
const STATUS = (s: string) => (s === 'paid' ? t3('مدفوع', 'Paid', 'Payée') : s === 'approved' ? t3('معتمد', 'Approved', 'Approuvée') : t3('مسودة', 'Draft', 'Brouillon'));
const monthName = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export function RunsPage({ s, hr }: { s: Session; hr: HrData }) {
  const [runs, setRuns] = useState<HrRun[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState(false);
  const load = useCallback(async () => { try { setRuns(await s.api.call('hr.run.list', {})); } catch (e) { fail(e); } }, [s]);
  useEffect(() => { void load(); }, [load]);
  if (open != null) return <RunView s={s} hr={hr} id={open} onBack={() => { setOpen(null); void load(); }} />;
  return (
    <>
      <div className="desk-head"><h1>{t3('كشوف الرواتب', 'Payroll runs', 'Paies')}</h1><button className="btn primary" onClick={() => setForm(true)}>＋ {t3('كشف جديد', 'New run', 'Nouvelle paie')}</button></div>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الشهر', 'Month', 'Mois')}</th><th>{t3('النوع', 'Kind', 'Type')}</th><th className="n">{t3('الأسطر', 'Lines', 'Lignes')}</th><th className="n">USD</th><th>{t3('الحالة', 'Status', 'État')}</th></tr></thead>
          <tbody>
            {(runs ?? []).map((r) => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(r.id)}>
                <td><b>{monthName(r.ym)}</b></td><td>{KIND(r.kind)}</td><td className="n">{r.lines}</td><td className="n">{usd(r.total_usd)}</td>
                <td className={r.status === 'paid' ? 'ok' : ''}>{STATUS(r.status)}{r.paid_on ? ` · ${fmtDate(r.paid_on)}` : ''}</td>
              </tr>
            ))}
            {runs && !runs.length && <tr><td colSpan={5} className="muted">{t3('لا كشوف بعد.', 'No runs yet.', 'Aucune paie pour le moment.')}</td></tr>}
          </tbody>
        </table>
      </div>
      {form && <NewRun s={s} onClose={() => setForm(false)} onDone={async (id) => { setForm(false); await load(); setOpen(id); }} />}
    </>
  );
}

function NewRun({ s, onClose, onDone }: { s: Session; onClose: () => void; onDone: (id: number) => Promise<void> }) {
  const [ym, setYm] = useState(todayIso().slice(0, 7));
  const [kind, setKind] = useState<'monthly' | 'thirteenth'>('monthly');
  const [rate, setRate] = useState('');
  return (
    <Modal title={t3('كشف جديد', 'New run', 'Nouvelle paie')} onClose={onClose} narrow>
      <Field label={t3('الشهر', 'Month', 'Mois')}><input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></Field>
      <Field label={t3('النوع', 'Kind', 'Type')}>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'monthly' | 'thirteenth')}><option value="monthly">{KIND('monthly')}</option><option value="thirteenth">{KIND('thirteenth')}</option></select>
      </Field>
      <Field label={t3('سعر الدولار بالليرة السورية', 'Dollar rate in Syrian pounds', 'Taux du dollar en livres syriennes')}><input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
      <p className="muted small">{t3('يُملأ الكشف من رواتب الأشخاص النشطين، ومن رسائل المكافأة المدفوعة في هذا الشهر. تعدّل الأسطر قبل الاعتماد.', 'The run is filled from the pay of the people who are active, and from the stipend letters paid in this month. You edit the lines before approval.', 'La paie est remplie avec la paie des personnes actives et les lettres de gratification payées ce mois. Vous modifiez les lignes avant approbation.')}</p>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!ym || !(Number(rate) > 0)} onClick={async () => {
          try {
            const r = await s.api.call('hr.run.create', { ym, kind, rateSyp: Number(rate) });
            if (r.skipped.length) toast(t3(`${r.skipped.length} أشخاص بلا راتب محدد، لم يُدرجوا`, `${r.skipped.length} people have no pay set and were left out`, `${r.skipped.length} personnes sans paie définie ont été laissées de côté`));
            await onDone(r.id);
          } catch (e) { fail(e); }
        }}>{t3('إنشاء', 'Create', 'Créer')}</button>
      </div>
    </Modal>
  );
}

function RunView({ s, hr, id, onBack }: { s: Session; hr: HrData; id: number; onBack: () => void }) {
  const [d, setD] = useState<{ run: HrRun; lines: HrRunLine[]; sent: { centre: string; sent_at: string; sent_by: string | null; total_usd: number }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState(false);
  const [voucher, setVoucher] = useState<{ run: { ym: string; kind: string; rate_syp: number; status: string; approved_by: string | null; paid_on: string | null }; rows: HrVoucherRow[]; total_usd: number } | null>(null);
  const approver = has(s.profile, 'hr.approve');
  const load = useCallback(async () => { try { setD(await s.api.call('hr.run.get', { id })); } catch (e) { fail(e); } }, [s, id]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <p className="muted">…</p>;
  const { run, lines, sent } = d;
  const post = async (url: string, body: object) => {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(getLangText(j?.error));
    return j;
  };
  const draft = run.status === 'draft';
  const total = lines.reduce((a, l) => a + l.total_usd, 0);
  const act = (op: 'hr.run.approve' | 'hr.run.reopen', msg?: string) => async () => {
    try { await s.api.call(op, { id }); if (msg) toast(msg); await load(); } catch (e) { fail(e); }
  };
  const saveLine = async (l: HrRunLine, patch: object) => { try { await s.api.call('hr.run.line.save', { id: l.id, ...patch }); await load(); } catch (e) { fail(e); } };
  const num = (v: string) => (v === '' ? 0 : Number(v));
  return (
    <>
      <div className="desk-head">
        <div><button className="link" onClick={onBack}>‹ {t3('الكشوف', 'Runs', 'Paies')}</button><h1>{KIND(run.kind)} · {monthName(run.ym)}</h1></div>
        <div className="desk-filters">
          <span className="pill">{STATUS(run.status)}</span>
          {draft && approver && <button className="btn primary" onClick={act('hr.run.approve', t3('اعتُمد', 'Approved', 'Approuvée'))}>{t3('اعتماد', 'Approve', 'Approuver')}</button>}
          {run.status === 'approved' && approver && <button className="btn primary" onClick={async () => {
            try { await s.api.call('hr.run.paid', { id, paidOn: todayIso() }); await load(); } catch (e) { fail(e); }
          }}>{t3('سُجّل الدفع اليوم', 'Mark paid today', "Marquer payée aujourd'hui")}</button>}
          {run.status === 'approved' && approver && <button className="btn" onClick={act('hr.run.reopen')}>{t3('إعادة فتح', 'Reopen', 'Rouvrir')}</button>}
          {draft && <button className="btn danger" onClick={async () => { if (await confirmBox(t3('حذف هذا الكشف؟', 'Delete this run?', 'Supprimer cette paie ?'), true)) { try { await s.api.call('hr.run.delete', { id }); onBack(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        </div>
      </div>
      {draft && !approver && <p className="muted small">{t3('يعتمدها الرئيس.', 'The Superior approves it.', 'Le Supérieur l’approuve.')}</p>}
      <p className="muted small">{t3('سعر الدولار', 'Dollar rate', 'Taux du dollar')}: {usd(run.rate_syp)} · {run.approved_by ? `${t3('اعتمدها', 'approved by', 'approuvée par')} ${run.approved_by}` : ''}</p>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الاسم', 'Name', 'Nom')}</th><th className="n">{t3('ساعات', 'Hours', 'Heures')}</th><th className="n">{t3('الأساس', 'Base', 'Base')}</th><th className="n">{t3('مكافأة إضافية', 'Bonus', 'Prime')}</th><th className="n">{t3('حسم', 'Deduction', 'Retenue')}</th><th className="n">USD</th><th>{t3('يُدفع بـ', 'Paid in', 'Payé en')}</th><th className="n">{t3('المبلغ المدفوع', 'Amount paid', 'Montant payé')}</th><th /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{(() => { const p = hr.people.find((x) => x.id === l.person_id); return p ? <TwoNames p={p} /> : <b>{l.person_name}</b>; })()}{l.label ? <div className="muted small">{l.label}</div> : null}</td>
                <td className="n">{l.hours_worked ?? '—'}</td>
                <td className="n">{draft ? <input style={{ width: 70 }} inputMode="decimal" defaultValue={l.base_usd} onBlur={(e) => { if (num(e.target.value) !== l.base_usd) void saveLine(l, { baseUsd: num(e.target.value) }); }} /> : usd(l.base_usd)}</td>
                <td className="n">{draft ? <input style={{ width: 70 }} inputMode="decimal" defaultValue={l.bonus_usd || ''} onBlur={(e) => { if (num(e.target.value) !== l.bonus_usd) void saveLine(l, { bonusUsd: num(e.target.value) }); }} /> : l.bonus_usd ? usd(l.bonus_usd) : ''}</td>
                <td className="n">{draft ? <input style={{ width: 70 }} inputMode="decimal" defaultValue={l.deduction_usd || ''} onBlur={(e) => { if (num(e.target.value) !== l.deduction_usd) void saveLine(l, { deductionUsd: num(e.target.value) }); }} /> : l.deduction_usd ? usd(l.deduction_usd) : ''}</td>
                <td className="n"><b>{usd(l.total_usd)}</b></td>
                <td>{draft && !l.paper_id ? <select value={l.paid_in} onChange={(e) => void saveLine(l, { paidIn: e.target.value })}><option value="USD">USD</option><option value="SYP">SYP</option></select> : l.paid_in}</td>
                <td className="n">{usd(l.amount_paid)} {l.paid_in}</td>
                <td className="right nowrap"><button className="btn small" onClick={() => saveSlips(hr, run, lines.filter((x) => x.person_id === l.person_id))}>📄</button>{draft && <>{' '}<button className="btn small danger" onClick={async () => { try { await s.api.call('hr.run.line.delete', { id: l.id }); await load(); } catch (e) { fail(e); } }}>✕</button></>}</td>
              </tr>
            ))}
            <tr><td colSpan={5}><b>{t3('المجموع', 'Total', 'Total')}</b></td><td className="n"><b>{usd(total)}</b></td><td colSpan={3} /></tr>
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {draft && <button className="btn" onClick={() => setAdd(true)}>＋ {t3('سطر (مكافأة من حين لآخر…)', 'Add a line (an occasional bonus…)', 'Ajouter une ligne (prime ponctuelle…)')}</button>}
        <button className="btn" onClick={() => saveSlips(hr, run, lines)}>📄 {t3('كل قسائم الدفع (Word)', 'All payslips (Word)', 'Toutes les fiches (Word)')}</button>
        {!draft && <button className="btn" onClick={async () => { try { setVoucher(await s.api.call('hr.run.voucher', { id })); } catch (e) { fail(e); } }}>{t3('قسيمة للمحاسبة (مجاميع فقط)', 'Voucher for Accounts (totals only)', 'Bon pour la comptabilité (totaux seulement)')}</button>}
      </div>
      {!draft && approver && <ToAccounts hr={hr} runId={id} lines={lines} sent={sent} busy={busy} setBusy={setBusy} post={post} reload={load} />}
      {add && <AddLine s={s} hr={hr} runId={id} onClose={() => setAdd(false)} onDone={async () => { setAdd(false); await load(); }} />}
      {voucher && <Voucher org={s.organisation} v={voucher} onClose={() => setVoucher(null)} />}
    </>
  );
}

function AddLine({ s, hr, runId, onClose, onDone }: { s: Session; hr: HrData; runId: number; onClose: () => void; onDone: () => Promise<void> }) {
  const [personId, setPersonId] = useState('');
  const [label, setLabel] = useState('');
  const [bonus, setBonus] = useState('');
  return (
    <Modal title={t3('سطر جديد', 'New line', 'Nouvelle ligne')} onClose={onClose} narrow>
      <Field label={t3('الشخص', 'Person', 'Personne')}>
        <select value={personId} onChange={(e) => setPersonId(e.target.value)}><option value="" />{hr.people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </Field>
      <Field label={t3('لماذا (مثلاً مكافأة العيد)', 'What for (e.g. Eid bonus)', 'Pourquoi (ex. prime de l’Aïd)')}><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      <Field label={t3('المبلغ بالدولار', 'Amount in USD', 'Montant en USD')}><input inputMode="decimal" value={bonus} onChange={(e) => setBonus(e.target.value)} /></Field>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!personId || !label.trim() || !(Number(bonus) > 0)} onClick={async () => { try { await s.api.call('hr.run.line.add', { runId, personId: Number(personId), label, bonusUsd: Number(bonus) }); await onDone(); } catch (e) { fail(e); } }}>{t3('إضافة', 'Add', 'Ajouter')}</button>
      </div>
    </Modal>
  );
}

function Voucher({ org, v, onClose }: { org: string; v: { run: { ym: string; kind: string; rate_syp: number; status: string; approved_by: string | null; paid_on: string | null }; rows: HrVoucherRow[]; total_usd: number }; onClose: () => void }) {
  const download = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Voucher');
    ws.addRow([`${org} · ${KIND(v.run.kind)} · ${v.run.ym}`]).font = { bold: true };
    ws.addRow([`Dollar rate: ${v.run.rate_syp} · Approved by: ${v.run.approved_by ?? ''}${v.run.paid_on ? ` · Paid on: ${v.run.paid_on}` : ''}`]);
    ws.addRow([]);
    ws.addRow(['Account', 'Budget line', 'Donor / project', 'Paid in', 'Amount paid', 'USD']).font = { bold: true };
    for (const r of v.rows) ws.addRow([r.account ?? '', r.budget_line ?? '', r.target ?? '', r.paid_in, r.amount_paid, r.total_usd]);
    const first = 5, last = 4 + v.rows.length;
    const tot = ws.addRow(['Total', '', '', '', '', { formula: `SUM(F${first}:F${last})`, result: v.total_usd }]);
    tot.font = { bold: true };
    ws.columns = [{ width: 16 }, { width: 28 }, { width: 22 }, { width: 10 }, { width: 16 }, { width: 14 }];
    ws.getColumn(5).numFmt = '#,##0';
    ws.getColumn(6).numFmt = '#,##0.00';
    await saveFile(`HR-voucher-${v.run.ym}-${v.run.kind}.xlsx`, ['xlsx'], new Uint8Array(await wb.xlsx.writeBuffer()), 'Voucher');
  };
  return (
    <Modal title={t3('قسيمة للمحاسبة', 'Voucher for Accounts', 'Bon pour la comptabilité')} onClose={onClose}>
      <p className="muted small">{t3('مجاميع فقط: لا أسماء ولا رواتب فردية. تُسجَّل في الحسابات كنفقة.', 'Totals only: no names, no individual pay. It is entered in Accounts as an expense.', 'Totaux seulement : ni noms ni paies individuelles. Elle est saisie en comptabilité comme une dépense.')}</p>
      <table className="desk-table">
        <thead><tr><th>{t3('الحساب', 'Account', 'Compte')}</th><th>{t3('بند الموازنة', 'Budget line', 'Ligne budgétaire')}</th><th>{t3('المانح / المشروع', 'Donor / project', 'Bailleur / projet')}</th><th>{t3('بـ', 'In', 'En')}</th><th className="n">{t3('المبلغ', 'Amount', 'Montant')}</th><th className="n">USD</th></tr></thead>
        <tbody>
          {v.rows.map((r, i) => <tr key={i}><td>{r.account ?? '—'}</td><td>{r.budget_line ?? '—'}</td><td>{r.target ?? '—'}</td><td>{r.paid_in}</td><td className="n">{usd(r.amount_paid)}</td><td className="n">{usd(r.total_usd)}</td></tr>)}
          <tr><td colSpan={5}><b>{t3('المجموع', 'Total', 'Total')}</b></td><td className="n"><b>{usd(v.total_usd)}</b></td></tr>
        </tbody>
      </table>
      {v.rows.some((r) => !r.account || !r.budget_line) && <p className="desk-alert small">{t3('بعض الأسطر بلا حساب أو بند: أكملهما في بطاقة الشخص.', "Some lines have no account or budget line: fill them in on the person's card.", "Certaines lignes n'ont pas de compte ou de ligne budgétaire : complétez-les sur la fiche de la personne.")}</p>}
      <div className="modal-foot"><button className="btn" onClick={onClose}>{t3('إغلاق', 'Close', 'Fermer')}</button><button className="btn primary" onClick={download}>{t3('تنزيل Excel', 'Download Excel', 'Télécharger Excel')}</button></div>
    </Modal>
  );
}

/** The payslips as a Word file (one per person, one per page), like the agreement. */
async function saveSlips(hr: HrData, run: HrRun, lines: HrRunLine[]) {
  try {
    const heads = new Map<number, DocHead>();
    for (const id of new Set(lines.map((l) => l.person_id))) heads.set(id, await headOf(hr, hr.people.find((p) => p.id === id)));
    const bytes = await payslipsDoc(run, lines, hr.people, (p) => heads.get(p?.id ?? -1) ?? { centre: null, mark: null, jesuit: null });
    await saveFile(`Payslips-${run.ym}-${run.kind}.docx`, ['docx'], bytes, 'Word');
  } catch (e) { fail(e); }
}

/**
 * Into the accounts of each centre (Fouad, 30 October 2026): one line per centre with its total, what is still missing
 * (a person with no budget line or account in that centre) and its own button. Sent, it shows who sent it and when,
 * and can be taken back.
 */
function ToAccounts({ hr, runId, lines, sent, busy, setBusy, post, reload }: { hr: HrData; runId: number; lines: HrRunLine[]; sent: { centre: string; sent_at: string; sent_by: string | null; total_usd: number }[]; busy: boolean; setBusy: (b: boolean) => void; post: (url: string, body: object) => Promise<{ sent?: { centre: string }[] }>; reload: () => Promise<void> }) {
  const groups = new Map<string, { item: ReturnType<typeof centreItem>; usd: number; people: Set<number>; missing: string[]; lines: string[] }>();
  for (const l of lines) {
    const p = hr.people.find((x) => x.id === l.person_id);
    const c = p ? centreItem(hr.lists, p) : null;
    const key = c?.source ?? '';
    const g = groups.get(key) ?? { item: c, usd: 0, people: new Set<number>(), missing: [], lines: [] };
    g.usd += l.total_usd;
    g.people.add(l.person_id);
    const who = p ? p.name_ar || p.name : l.person_name;
    if (p && c?.source) {
      const line = lineFor(hr.lists, p).line;
      if (!line) g.missing.push(t3(`${who}: خط الموازنة`, `${who}: budget line`, `${who} : ligne budgétaire`));
      else if (!g.lines.includes(lineLabel(line))) g.lines.push(lineLabel(line));
      if (!accountFor(hr.lists, p)) g.missing.push(t3(`${who}: الحساب`, `${who}: account`, `${who} : compte`));
    } else g.missing.push(t3(`${who}: المركز`, `${who}: centre`, `${who} : centre`));
    groups.set(key, g);
  }
  return (
    <div className="hr-panel" style={{ marginTop: 14 }}>
      <b>{t3('إلى المحاسب: حسابات كل مركز', "To the accountant: each centre's accounts", 'Au comptable : la comptabilité de chaque centre')}</b>
      <p className="muted small" style={{ margin: '4px 0 10px' }}>{t3('يُكتب في الدفتر الرئيسي للمركز نفقة لكل حساب وخط موازنة وعملة: مجاميع فقط، بلا أسماء. يراها المحاسب في السجل كأي نفقة، ولا يكتبها أحد مرة ثانية.', "Written in the centre's Main book: one expense per account, budget line and currency — totals only, no names. The accountant sees them in the register like any expense; nobody types them again.", 'Écrit dans le livre principal du centre : une dépense par compte, ligne budgétaire et devise — totaux seulement, sans noms. Le comptable les voit dans le registre comme toute dépense ; personne ne les retape.')}</p>
      {[...groups.entries()].map(([slug, g]) => {
        const key = ((g.item?.code ?? 'other') as CentreKey);
        const done = sent.find((x) => x.centre === slug);
        return (
          <div key={slug || 'none'} className="hr-card" style={{ ...centreVars(key), cursor: 'default', marginBottom: 8 }}>
            <div className="mark"><img src={markOf(key)} alt="" /></div>
            <div className="body">
              <b>{g.item?.name ?? t3('بلا مركز', 'No centre', 'Sans centre')}</b>
              <div className="meta">{g.people.size} {t3('شخصاً', 'people', 'personnes')} · {usd(g.usd)} USD{g.lines.length ? ` · ${g.lines.join(', ')}` : ''}</div>
              {done ? <div className="ok small">✓ {t3('أُرسل', 'sent', 'envoyé')} {fmtDate(done.sent_at.slice(0, 10))} · {done.sent_by}</div>
                : g.missing.length ? <div className="desk-alert small">{t3('ينقص', 'Missing', 'Manque')}: {g.missing.join(' · ')}</div>
                : <div className="ok small">{t3('جاهز', 'Ready', 'Prêt')}</div>}
            </div>
            {slug && (done
              ? <button className="btn small" disabled={busy} onClick={async () => { if (!(await confirmBox(t3('سحب هذه النفقات من حسابات المركز؟', "Take these expenses back out of the centre's accounts?", 'Retirer ces dépenses de la comptabilité du centre ?'), true))) return; setBusy(true); try { await post('/api/hr/take-back', { runId, centre: slug }); toast(t3('سُحب', 'Taken back', 'Retiré')); await reload(); } catch (e) { fail(e); } finally { setBusy(false); } }}>{t3('سحب', 'Take back', 'Retirer')}</button>
              : <button className="btn gold" disabled={busy || g.missing.length > 0} onClick={async () => { setBusy(true); try { await post('/api/hr/send-run', { runId, centre: slug }); toast(t3('أُرسل إلى الحسابات', 'Sent to the accounts', 'Envoyé à la comptabilité')); await reload(); } catch (e) { fail(e); } finally { setBusy(false); } }}>{t3('إرسال', 'Send', 'Envoyer')}</button>)}
          </div>
        );
      })}
    </div>
  );
}
