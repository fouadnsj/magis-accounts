// Donors sheet, table A: every grant the Respo receives (Sup only).
// One donor may fund several projects: one row per project.
import { useState } from 'react';
import { useApp, useNames } from '../state';
import { auditStmt } from '../db/repo';
import { nowIso, uuid } from '../db/db';
import { Field, Modal, Select, confirmBox, fmtDate, fmtUsd, parseAmount, t, toast, todayIso } from './kit';

export function Grants() {
  const { s, d, reload, who } = useApp();
  const names = useNames();
  const [adding, setAdding] = useState(false);
  const total = d.grants.reduce((a, g) => a + g.amount_usd, 0);
  const del = async (id: string) => {
    if (!(await confirmBox(t('حذف هذه المنحة؟', 'Delete this grant?'), true))) return;
    const before = d.grants.find((g) => g.id === id);
    await s.db.batch([{ sql: 'DELETE FROM grant_row WHERE id = ?', params: [id] }, auditStmt(who, 'delete', 'grant_row', id, before, null)]);
    await reload();
  };
  return (
    <>
      <div className="page-head">
        <h1>{t('المنح · سجل مصادر التبرعات', 'Grants · donation source book')}</h1>
        <button className="btn primary" onClick={() => setAdding(true)}>＋ {t('منحة', 'Grant')}</button>
      </div>
      <div className="alert info small">{t('سرّي — يراه الرئيس فقط.', 'Confidential — only the Superior sees this.')}</div>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>{t('التاريخ', 'Date')}</th><th>{t('المانح', 'Donor')}</th><th>{t('المشروع', 'Project')}</th><th className="n">USD</th><th>{t('المرجع', 'Reference')}</th><th>{t('ملاحظة', 'Note')}</th><th /></tr></thead>
          <tbody>
            {d.grants.map((g) => (
              <tr key={g.id}>
                <td>{fmtDate(g.date)}</td><td>{names.donor(g.donor_id)}</td><td>{g.project_id == null ? <span className="warn">—</span> : names.project(g.project_id)}</td>
                <td className="n">{fmtUsd(g.amount_usd)}</td><td>{g.reference}</td><td>{g.note}</td>
                <td><button className="btn small ghost" onClick={() => del(g.id)}>✕</button></td>
              </tr>
            ))}
            <tr className="total"><td colSpan={3}>{t('المجموع', 'Total')}</td><td className="n">{fmtUsd(total)}</td><td colSpan={3} /></tr>
          </tbody>
        </table>
      </div>
      {adding && <GrantModal onClose={() => setAdding(false)} />}
    </>
  );
}

function GrantModal({ onClose }: { onClose: () => void }) {
  const { s, d, reload, who } = useApp();
  const [date, setDate] = useState(todayIso());
  const [donor, setDonor] = useState<number | null>(null);
  const [project, setProject] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const save = async () => {
    const a = parseAmount(amount);
    if (!date || donor == null || !(a > 0)) return toast(t('التاريخ والمانح والمبلغ مطلوبة', 'Date, donor and amount are required'), true);
    const id = uuid();
    await s.db.batch([
      { sql: 'INSERT INTO grant_row (id, date, donor_id, project_id, amount_usd, reference, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)', params: [id, date, donor, project, a, reference || null, note || null, nowIso(), who] },
      auditStmt(who, 'add', 'grant_row', id, null, { date, donor, project, a }),
    ]);
    await reload();
    toast(t('حُفظ', 'Saved'));
    onClose();
  };
  const active = <T extends { id: number; name: string; active: number }>(xs: T[]) => xs.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name }));
  return (
    <Modal title={t('منحة جديدة', 'New grant')} onClose={onClose} narrow>
      <div className="grid2">
        <Field label={t('التاريخ', 'Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('المبلغ $', 'Amount USD')}><input className="num" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('المانح', 'Donor')}>
          <Select value={donor} options={active(d.lists.donors)} onChange={(v) => {
            setDonor(v);
            setProject(d.lists.donors.find((x) => x.id === v)?.default_project_id ?? null);
          }} />
        </Field>
        <Field label={t('المشروع (يمكن تغييره)', 'Project (can be changed)')}>
          <Select value={project} options={active(d.lists.projects)} onChange={setProject} />
        </Field>
        <Field label={t('المرجع', 'Reference')}><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label={t('ملاحظة', 'Note')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <p className="muted small">{t('مانح يموّل عدة مشاريع: سطر لكل مشروع.', 'A donor funding several projects: one row per project.')}</p>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" onClick={save}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}
