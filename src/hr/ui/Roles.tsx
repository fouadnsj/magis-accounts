// HR Settings → Roles and Backups (Fouad, 1 November 2026). The roles as in the accounts: one column per role, one row
// per right, a tick changes it for everybody who has that role. Some ticks bring others with them (writing agreements,
// changing the scale, the payroll all show the amounts; every right shows the people), the server adds them on saving.
// The backups as in the accounts: one copy every day, one now, and putting a copy back.
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '../../state';
import type { AccessRow, BackupFile } from '../../ops';
import { HR_ADMIN_PERMS, HR_PERM_GROUPS, PERM_GROUPS, type Perm } from '../../perms';
import { getLang, tx, m } from '../../i18n';
import { Field, Modal, confirmBox, toast } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import { serverRestoreUpload } from '../../net';
import { pickFile, toBase64 } from '../../platform';
import { fail } from './common';

const ADMIN_LABEL: Record<string, string> = Object.fromEntries(PERM_GROUPS.find((g) => g.key === 'admin')!.perms.map((p) => [p.key, tx(p.label)]));
/** the rows of the roles page: the HR rights, then the admin ticks that mean something here */
export const HR_ROWS: { key: string; label: string; perms: { key: Perm; label: string }[] }[] = [
  ...HR_PERM_GROUPS.map((g) => ({ key: g.key, label: tx(g.label), perms: g.perms.map((p) => ({ key: p.key as Perm, label: tx(p.label) })) })),
  { key: 'admin', label: tx(m('الإدارة', 'Administration', 'Administration')), perms: HR_ADMIN_PERMS.map((k) => ({ key: k as Perm, label: ADMIN_LABEL[k] ?? k })) },
];
/** a role's name in the language shown (the usual roles are named "Arabic · English · French") */
const roleName = (n: string) => { const p = n.split(' · '); return p.length === 3 ? p[getLang() === 'ar' ? 0 : getLang() === 'fr' ? 2 : 1] : n; };
/** the rights that only show something */
const SEE = new Set<string>(['hr.view', 'hr.details', 'hr.salary', 'hr.hourly', 'hr.donors', 'hr.reports', 'data.export', 'audit.view']);

export function RolesTab({ s }: { s: Session }) {
  const [list, setList] = useState<AccessRow[] | null>(null);
  const [edit, setEdit] = useState<AccessRow | 'new' | null>(null);
  const load = useCallback(async () => { try { setList(await s.api.call('access.list', {})); } catch (e) { fail(e); } }, [s]);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (a: AccessRow, p: Perm) => {
    const perms = a.perms.includes(p) ? a.perms.filter((x) => x !== p) : [...a.perms, p];
    try { await s.api.call('access.save', { id: a.id, name: a.name, perms }); await load(); toast(t3('حُفظ', 'Saved', 'Enregistré')); } catch (e) { fail(e); }
  };
  const remove = async (a: AccessRow) => {
    if (!(await confirmBox(t3(`حذف «${a.name}»؟`, `Delete "${a.name}"?`, `Supprimer « ${a.name} » ?`), true))) return;
    try { await s.api.call('access.delete', { id: a.id }); await load(); } catch (e) { fail(e); }
  };
  if (!list) return <p className="muted">…</p>;
  return (
    <>
      <p className="muted">{t3('ماذا يستطيع كل دور. كل مستخدم يأخذ دوراً واحداً، والمراكز التي يراها تُختار في «المستخدمون والمراكز». تغيير علامة يغيّر كل من يحمل هذا الدور. بعض العلامات تجلب غيرها: كتابة الاتفاقيات وتغيير السلّم والكشوف وتكلفة الساعة والمانحون والتقارير تُظهر المبالغ. ملفات Excel تحتاج «يصدّر».', 'What each role may do. Each user has one role; the centres they see are chosen in Users & centres. A tick changes it for everybody who has the role. Some ticks bring others: writing agreements, changing the scale, the payroll, the cost of an hour, Donors and Reports all show the amounts. The Excel files need "Exports".', 'Ce que chaque rôle peut faire. Chaque utilisateur a un rôle ; ses centres se choisissent dans Utilisateurs et centres. Une case change tous ceux qui ont ce rôle. Certaines cases en entraînent d’autres : rédiger les accords, changer l’échelle, les paies, le coût d’une heure, les bailleurs et les rapports montrent les montants. Les fichiers Excel demandent « Exporter ».')}</p>
      <div className="hr-panel" style={{ overflowX: 'auto' }}>
        <table className="desk-table roles-matrix">
          <thead>
            <tr>
              <th />
              {list.map((a) => (
                <th key={a.id} className="c" title={a.name}>
                  {roleName(a.name)}
                  <div className="muted small">{a.users} {t3('مستخدم', 'users', 'utilisateurs')}</div>
                  <div className="nowrap">
                    <button className="btn small" title={t3('الاسم', 'Name', 'Nom')} onClick={() => setEdit(a)}>✎</button>
                    {a.users === 0 && <> <button className="btn small" onClick={() => remove(a)}>✕</button></>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HR_ROWS.map((g) => [
              <tr key={g.key} className="group"><td colSpan={list.length + 1}><b>{g.label}</b></td></tr>,
              ...g.perms.map((p) => (
                <tr key={p.key}>
                  <td><span className={`role-pill ${SEE.has(p.key) ? 'view' : 'modify'}`}>{SEE.has(p.key) ? t3('اطّلاع', 'See', 'Voir') : t3('عمل', 'Do', 'Faire')}</span> {p.label}</td>
                  {list.map((a) => <td key={a.id} className="c"><input type="checkbox" checked={a.perms.includes(p.key)} onChange={() => toggle(a, p.key)} /></td>)}
                </tr>
              )),
            ])}
          </tbody>
        </table>
        <div className="modal-foot"><button className="btn gold" onClick={() => setEdit('new')}>＋ {t3('دور جديد', 'New role', 'Nouveau rôle')}</button></div>
      </div>
      {edit && <RoleModal s={s} role={edit === 'new' ? null : edit} list={list} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); await load(); }} />}
    </>
  );
}

/** a new role (its name, and the role it starts from), or renaming one */
function RoleModal({ s, role, list, onClose, onDone }: { s: Session; role: AccessRow | null; list: AccessRow[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState(role?.name ?? '');
  const [from, setFrom] = useState<number | ''>('');
  return (
    <Modal title={role ? role.name : t3('دور جديد', 'New role', 'Nouveau rôle')} onClose={onClose} narrow>
      <Field label={t3('الاسم (مثلاً: منسّق الورشات)', 'Name (e.g. Workshop coordinator)', 'Nom (ex. Coordinateur des ateliers)')}><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {!role && (
        <Field label={t3('يبدأ من', 'Starts from', 'Part de')}>
          <select value={from} onChange={(e) => setFrom(e.target.value ? Number(e.target.value) : '')}>
            <option value="">{t3('لا شيء (يرى الأشخاص فقط)', 'Nothing (sees the people only)', 'Rien (voit seulement les personnes)')}</option>
            {list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      )}
      <p className="muted small">{t3('ثم اختر العلامات في الجدول.', 'Then choose its ticks in the table.', 'Puis choisissez ses cases dans le tableau.')}</p>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!name.trim()} onClick={async () => {
          const perms: Perm[] = role ? role.perms : from !== '' ? list.find((a) => a.id === from)?.perms ?? [] : ['hr.view'];
          try { await s.api.call('access.save', { id: role?.id, name, perms }); await onDone(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

export function BackupsTab({ s }: { s: Session }) {
  const [list, setList] = useState<BackupFile[] | null>(null);
  const can = (p: Perm) => s.profile.perms.includes(p);
  const load = useCallback(async () => { try { setList(await s.api.call('backup.list', {})); } catch (e) { fail(e); } }, [s]);
  useEffect(() => { void load(); }, [load]);
  const now = async () => {
    try { await s.api.call('backup.now', {}); toast(t3('أُخذت نسخة', 'Backup made', 'Sauvegarde faite')); await load(); } catch (e) { fail(e); }
  };
  const restore = async (b: BackupFile) => {
    if (!(await confirmBox(t3(`استبدال قاعدة الموارد البشرية الحالية بالنسخة:\n${b.name}\n\nتُؤخذ نسخة من الحالية أولاً.`, `Replace the current HR database with:\n${b.name}\n\nA copy of the current one is taken first.`, `Remplacer la base RH actuelle par :\n${b.name}\n\nUne copie de l'actuelle est faite d'abord.`), true))) return;
    try { await s.api.call('backup.restore', { path: b.path }); window.location.reload(); } catch (e) { fail(e); }
  };
  // on the server: put back a .db file from this computer (a backup copied to a USB key, or the database of another server)
  const fromFile = async () => {
    const f = await pickFile(['db'], t3('اختر ملف قاعدة البيانات', 'Choose the database file', 'Choisissez le fichier de la base'));
    if (!f) return;
    if (!(await confirmBox(t3(`استبدال كل بيانات الموارد البشرية بالملف:\n${f.name}\n\nتُؤخذ نسخة من الحالية أولاً، ثم يدخل الجميع من جديد.`, `Replace ALL the HR data with the file:\n${f.name}\n\nA copy of the current data is taken first; then everybody signs in again.`, `Remplacer TOUTES les données RH par le fichier :\n${f.name}\n\nUne copie est faite d'abord ; puis chacun se reconnecte.`), true))) return;
    try { await serverRestoreUpload(toBase64(f.bytes), f.name); window.location.reload(); } catch (e) { fail(e); }
  };
  return (
    <div className="hr-panel">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <p className="muted small" style={{ margin: 0 }}>{t3('نسخة كل يوم، ونسخة قبل كل استرجاع. انسخ نسخة إلى مفتاح USB من حين لآخر.', 'One copy every day, and one before every restore. Copy one to a USB key from time to time.', 'Une copie chaque jour, et une avant chaque restauration. Copiez-en une sur une clé USB de temps en temps.')}</p>
        <span className="row" style={{ gap: 6 }}>
          {s.mode === 'server' && can('data.restore') && <button className="btn" onClick={fromFile}>{t3('استرجاع من ملف…', 'Restore from a file…', 'Restaurer depuis un fichier…')}</button>}
          {can('data.backup') && <button className="btn primary" onClick={now}>{t3('نسخة الآن', 'Back up now', 'Sauvegarder maintenant')}</button>}
        </span>
      </div>
      <table className="desk-table" style={{ marginTop: 10 }}>
        <thead><tr><th>{t3('الملف', 'File', 'Fichier')}</th><th>{t3('التاريخ', 'Date', 'Date')}</th><th className="n">KB</th><th /></tr></thead>
        <tbody>
          {(list ?? []).map((b) => (
            <tr key={b.path}>
              <td className="ltr small">{b.name}</td><td className="ltr">{new Date(b.modified).toLocaleString('en-GB')}</td><td className="n">{Math.round(b.size / 1024)}</td>
              <td className="right">{can('data.restore') && <button className="btn small" onClick={() => restore(b)}>{t3('استرجاع', 'Restore', 'Restaurer')}</button>}</td>
            </tr>
          ))}
          {list && !list.length && <tr><td colSpan={4} className="muted">{t3('لا نسخ بعد.', 'No backups yet.', 'Pas encore de sauvegarde.')}</td></tr>}
          {!list && <tr><td colSpan={4} className="muted">…</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
