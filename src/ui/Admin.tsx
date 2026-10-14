// Month closing, backups, PINs, audit log.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { auditStmt } from '../db/repo';
import { nowIso } from '../db/db';
import { backupNow, listBackups, restoreBackup, type BackupFile } from '../db/backup';
import { can, changePin, listProfiles, profileStmt, type Profile } from '../auth';
import { isDesktop } from '../platform';
import type { Role } from '../domain/types';
import { Field, Modal, Tabs, confirmBox, errText, t, toast } from './kit';

type Tab = 'months' | 'backups' | 'profiles' | 'audit';

export function Admin() {
  const { s } = useApp();
  const holder = s.install === 'holder';
  const [tab, setTab] = useState<Tab>(holder ? 'backups' : 'months');
  return (
    <>
      <div className="page-head"><h1>{holder ? t('الإعدادات', 'Settings') : t('الإدارة', 'Admin')}</h1></div>
      <p className="muted small ltr" style={{ textAlign: 'start' }}>{s.dbPath ?? t('معاينة — في الذاكرة', 'Preview — in memory')}</p>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'months', label: t('إغلاق الأشهر', 'Month closing'), hidden: holder },
        { value: 'backups', label: t('النسخ الاحتياطية', 'Backups') },
        { value: 'profiles', label: t('المستخدمون والرموز', 'Users & PINs') },
        { value: 'audit', label: t('سجل التعديلات', 'Audit log') },
      ]} />
      {tab === 'months' && !holder && <Months />}
      {tab === 'backups' && <Backups />}
      {tab === 'profiles' && <Profiles />}
      {tab === 'audit' && <Audit />}
    </>
  );
}

function Months() {
  const { s, d, reload, who } = useApp();
  const months = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of d.rows) if (r.date) m.set(r.date.slice(0, 7), (m.get(r.date.slice(0, 7)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [d.rows]);
  const review = (ym: string) => d.rows.filter((r) => r.date?.startsWith(ym) && r.review).length;
  const close = async (ym: string) => {
    const rv = review(ym);
    if (!(await confirmBox(
      t(`إغلاق ${ym}؟ بعد الإغلاق لا تعديل في هذا الشهر؛ التصحيح بقيد عكسي.`, `Close ${ym}? After closing, no edits in that month; corrections by a reversing entry.`) +
        (rv ? '\n\n' + t(`⚠ ما زال ${rv} سطراً للمراجعة في هذا الشهر.`, `⚠ ${rv} rows of this month still need review.`) : ''),
    ))) return;
    await s.db.batch([
      { sql: 'INSERT INTO closed_month (ym, closed_at, closed_by) VALUES (?, ?, ?)', params: [ym, nowIso(), who] },
      auditStmt(who, 'close', 'closed_month', ym, null, null),
    ]);
    await reload();
  };
  const reopen = async (ym: string) => {
    if (!(await confirmBox(t(`إعادة فتح ${ym}؟`, `Reopen ${ym}?`)))) return;
    await s.db.batch([{ sql: 'DELETE FROM closed_month WHERE ym = ?', params: [ym] }, auditStmt(who, 'reopen', 'closed_month', ym, null, null)]);
    await reload();
  };
  return (
    <div className="panel" style={{ maxWidth: 700 }}>
      <table className="t">
        <thead><tr><th>{t('الشهر', 'Month')}</th><th className="n">{t('سطور', 'Rows')}</th><th className="n">{t('للمراجعة', 'To review')}</th><th>{t('الحالة', 'Status')}</th><th /></tr></thead>
        <tbody>
          {months.map(([ym, n]) => (
            <tr key={ym}>
              <td className="ltr">{ym}</td><td className="n">{n}</td><td className="n">{review(ym) || ''}</td>
              <td>{d.closed.has(ym) ? <span className="ok">🔒 {t('مغلق', 'closed')}</span> : <span className="muted">{t('مفتوح', 'open')}</span>}</td>
              <td className="right">
                {d.closed.has(ym)
                  ? can.reopenMonth(s.profile.role) && <button className="btn small" onClick={() => reopen(ym)}>{t('إعادة فتح', 'Reopen')}</button>
                  : <button className="btn small" onClick={() => close(ym)}>{t('إغلاق', 'Close')}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{t('الرئيس وحده يعيد فتح شهر.', 'Only the Superior can reopen a month.')}</p>
    </div>
  );
}

function Backups() {
  const { s, reload } = useApp();
  const [list, setList] = useState<BackupFile[]>([]);
  const refresh = () => s.dbPath && listBackups(s.dbPath).then(setList);
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isDesktop() || !s.dbPath) return <div className="alert info">{t('النسخ الاحتياطية في التطبيق المكتبي فقط.', 'Backups exist in the desktop app only.')}</div>;
  const now = async () => {
    const p = await backupNow(s.dbPath!, 'manual');
    toast(t('نسخة احتياطية', 'Backup') + ': ' + p);
    await refresh();
  };
  const restore = async (b: BackupFile) => {
    if (!(await confirmBox(t(`استبدال قاعدة البيانات الحالية بالنسخة:\n${b.name}\n\nتُؤخذ نسخة من الحالية أولاً.`, `Replace the current database with:\n${b.name}\n\nA copy of the current one is taken first.`), true))) return;
    try {
      await restoreBackup(s.dbPath!, b.path);
      await reload();
      await refresh();
      toast(t('استُرجعت النسخة', 'Backup restored'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <p className="muted small" style={{ margin: 0 }}>{t('نسخة كل يوم عند الفتح، ونسخة قبل كل استيراد أو استرجاع. انسخ مجلد backups إلى مفتاح USB من حين لآخر.', 'One copy a day on opening, and one before every import or restore. Copy the backups folder to a USB key from time to time.')}</p>
        <button className="btn primary" onClick={now}>{t('نسخة الآن', 'Back up now')}</button>
      </div>
      <table className="t">
        <thead><tr><th>{t('الملف', 'File')}</th><th>{t('التاريخ', 'Date')}</th><th className="n">KB</th><th /></tr></thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.path}><td className="code">{b.name}</td><td className="ltr">{new Date(b.modified).toLocaleString('en-GB')}</td><td className="n">{Math.round(b.size / 1024)}</td>
              <td className="right"><button className="btn small" onClick={() => restore(b)}>{t('استرجاع', 'Restore')}</button></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Profiles() {
  const { s, d, who } = useApp();
  const [list, setList] = useState<Profile[]>([]);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => listProfiles(s.db).then(setList);
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mayEdit = (p: Profile) => p.id === s.profile.id || can.profiles(s.profile.role);
  const role = (r: Role) => (r === 'sup' ? t('الرئيس', 'Superior') : r === 'com' ? t('المحاسب', 'Accountant') : t('أمين', 'Holder'));
  return (
    <div className="panel" style={{ maxWidth: 700 }}>
      <table className="t">
        <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('الدور', 'Role')}</th><th /></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{role(p.role)}{p.book_id != null && ` · ${d.lists.books.find((b) => b.id === p.book_id)?.name ?? ''}`}</td>
              <td className="right">{mayEdit(p) && <button className="btn small" onClick={() => setPinFor(p)}>{t('تغيير الرمز', 'Change PIN')}</button>}</td></tr>
          ))}
        </tbody>
      </table>
      {can.profiles(s.profile.role) && s.install === 'office' && (
        <div className="modal-foot"><button className="btn" onClick={() => setAdding(true)}>＋ {t('مستخدم', 'User')}</button></div>
      )}
      {pinFor && <PinModal p={pinFor} onClose={() => setPinFor(null)} onDone={async (pin) => {
        await changePin(s.db, pinFor.id, pin, who);
        toast(t('تغيّر الرمز', 'PIN changed'));
      }} />}
      {adding && <AddUser onClose={() => setAdding(false)} onDone={refresh} />}
    </div>
  );
}

function PinModal({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone: (pin: string) => Promise<void> }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={<>{t('رمز جديد', 'New PIN')} · {p.name}</>} onClose={onClose} narrow>
      <div className="grid2">
        <Field label={t('الرمز', 'PIN')}><input type="password" inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label={t('تأكيد', 'Again')}><input type="password" inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} /></Field>
      </div>
      {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" onClick={async () => {
          if (a !== b) return setErr(t('الرمز وتأكيده مختلفان', 'PIN and confirmation differ'));
          try {
            await onDone(a);
            onClose();
          } catch (e) {
            setErr(errText(e));
          }
        }}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

function AddUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { s, who } = useApp();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('com');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={t('مستخدم جديد', 'New user')} onClose={onClose} narrow>
      <div className="grid2">
        <Field label={t('الاسم', 'Name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('الدور', 'Role')}>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="com">{t('المحاسب', 'Accountant')}</option>
            <option value="sup">{t('الرئيس', 'Superior')}</option>
          </select>
        </Field>
        <Field label={t('الرمز', 'PIN')}><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
      </div>
      {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!name.trim()} onClick={async () => {
          try {
            await s.db.batch([await profileStmt({ name, role, pin }), auditStmt(who, 'add', 'profile', null, null, { name, role })]);
            onDone();
            onClose();
          } catch (e) {
            setErr(errText(e));
          }
        }}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

interface AuditRow { id: number; at: string; who: string; action: string; tbl: string; row_id: string | null; before: string | null; after: string | null }

function Audit() {
  const { s, d } = useApp();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [open, setOpen] = useState<AuditRow | null>(null);
  useEffect(() => {
    s.db.query<AuditRow>('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500').then(setRows);
  }, [s.db, d]);
  return (
    <div className="panel">
      <table className="t">
        <thead><tr><th>{t('متى', 'When')}</th><th>{t('من', 'Who')}</th><th>{t('ماذا', 'What')}</th><th>{t('الجدول', 'Table')}</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => setOpen(r)}>
              <td className="ltr nowrap">{r.at.slice(0, 19).replace('T', ' ')}</td><td>{r.who}</td><td>{r.action}</td><td>{r.tbl}</td><td className="code">{r.row_id?.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <Modal title={`${open.action} · ${open.tbl}`} onClose={() => setOpen(null)}>
          <div className="grid2">
            <div><h3>{t('قبل', 'Before')}</h3><pre className="code" style={{ whiteSpace: 'pre-wrap' }}>{open.before ? JSON.stringify(JSON.parse(open.before), null, 1) : '—'}</pre></div>
            <div><h3>{t('بعد', 'After')}</h3><pre className="code" style={{ whiteSpace: 'pre-wrap' }}>{open.after ? JSON.stringify(JSON.parse(open.after), null, 1) : '—'}</pre></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
