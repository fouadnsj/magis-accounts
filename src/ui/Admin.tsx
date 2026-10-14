// Month closing, backups, users and passwords, audit log, and (on the network) the server.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { can, type Profile } from '../auth';
import type { AuditRow, BackupFile } from '../ops';
import type { Role } from '../domain/types';
import { Field, Modal, Select, Tabs, confirmBox, errText, t, toast } from './kit';
import { ServerTab } from './ServerTab';

type Tab = 'months' | 'backups' | 'profiles' | 'audit' | 'server';

export function Admin() {
  const { s, holder } = useApp();
  const [tab, setTab] = useState<Tab>(holder ? 'profiles' : 'months');
  const office = !holder;
  return (
    <>
      <div className="page-head"><h1>{holder ? t('الإعدادات', 'Settings') : t('الإدارة', 'Admin')}</h1></div>
      {s.mode === 'desktop' && <p className="muted small ltr" style={{ textAlign: 'start' }}>{s.dbPath}</p>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'months', label: t('إغلاق الأشهر', 'Month closing'), hidden: !office },
        { value: 'backups', label: t('النسخ الاحتياطية', 'Backups'), hidden: !office || s.mode === 'preview' },
        { value: 'profiles', label: holder ? t('كلمة السر', 'Password') : t('المستخدمون وكلمات السر', 'Users & passwords') },
        { value: 'audit', label: t('سجل التعديلات', 'Audit log'), hidden: !office },
        { value: 'server', label: t('الخادم', 'Server'), hidden: !office || s.mode !== 'server' },
      ]} />
      {tab === 'months' && office && <Months />}
      {tab === 'backups' && office && <Backups />}
      {tab === 'profiles' && <Profiles />}
      {tab === 'audit' && office && <Audit />}
      {tab === 'server' && office && s.mode === 'server' && <ServerTab />}
    </>
  );
}

function Months() {
  const { s, d, reload } = useApp();
  const months = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of d.rows) if (r.date) m.set(r.date.slice(0, 7), (m.get(r.date.slice(0, 7)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [d.rows]);
  const review = (ym: string) => d.rows.filter((r) => r.date?.startsWith(ym) && r.review).length;
  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const close = async (ym: string) => {
    const rv = review(ym);
    if (!(await confirmBox(
      t(`إغلاق ${ym}؟ بعد الإغلاق لا تعديل في هذا الشهر؛ التصحيح بقيد عكسي.`, `Close ${ym}? After closing, no edits in that month; corrections by a reversing entry.`) +
        (rv ? '\n\n' + t(`⚠ ما زال ${rv} سطراً للمراجعة في هذا الشهر.`, `⚠ ${rv} rows of this month still need review.`) : ''),
    ))) return;
    await run(() => s.api.call('month.close', { ym }));
  };
  const reopen = async (ym: string) => {
    if (await confirmBox(t(`إعادة فتح ${ym}؟`, `Reopen ${ym}?`))) await run(() => s.api.call('month.reopen', { ym }));
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
  const refresh = () => s.api.call('backup.list').then(setList).catch((e) => toast(errText(e), true));
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const now = async () => {
    try {
      const p = await s.api.call('backup.now');
      toast(t('نسخة احتياطية', 'Backup') + ': ' + (p ?? ''));
      await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const restore = async (b: BackupFile) => {
    if (!(await confirmBox(t(`استبدال قاعدة البيانات الحالية بالنسخة:\n${b.name}\n\nتُؤخذ نسخة من الحالية أولاً.`, `Replace the current database with:\n${b.name}\n\nA copy of the current one is taken first.`), true))) return;
    try {
      await s.api.call('backup.restore', { path: b.path });
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
        <p className="muted small" style={{ margin: 0 }}>{t('نسخة كل يوم، ونسخة قبل كل استيراد أو استرجاع.', 'One copy every day, and one before every import or restore.')}</p>
        <button className="btn primary" onClick={now}>{t('نسخة الآن', 'Back up now')}</button>
      </div>
      <table className="t">
        <thead><tr><th>{t('الملف', 'File')}</th><th>{t('التاريخ', 'Date')}</th><th className="n">KB</th><th /></tr></thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.path}><td className="code">{b.name}</td><td className="ltr">{new Date(b.modified).toLocaleString('en-GB')}</td><td className="n">{Math.round(b.size / 1024)}</td>
              <td className="right">{can.profiles(s.profile.role) && <button className="btn small" onClick={() => restore(b)}>{t('استرجاع', 'Restore')}</button>}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const roleName = (r: Role) => (r === 'sup' ? t('الرئيس', 'Superior') : r === 'com' ? t('المحاسب', 'Accountant') : t('أمين صندوق', 'Cash holder'));

function Profiles() {
  const { s, d } = useApp();
  const [list, setList] = useState<Profile[]>([]);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => s.api.call('profiles.list').then(setList);
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sup = can.profiles(s.profile.role);
  const deactivate = async (p: Profile) => {
    if (!(await confirmBox(t(`إيقاف ${p.name}؟ لن يستطيع الدخول.`, `Deactivate ${p.name}? They will no longer be able to log in.`), true))) return;
    try {
      await s.api.call('profile.deactivate', { id: p.id });
      await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <table className="t">
        <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('الدور', 'Role')}</th><th /></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{roleName(p.role)}{p.book_id != null && ` · ${d.lists.books.find((b) => b.id === p.book_id)?.name ?? ''}`}</td>
              <td className="right nowrap">
                <button className="btn small" onClick={() => setPinFor(p)}>{t('تغيير كلمة السر', 'Change password')}</button>
                {sup && p.id !== s.profile.id && <button className="btn small ghost" onClick={() => deactivate(p)}>✕</button>}
              </td></tr>
          ))}
        </tbody>
      </table>
      {sup && s.install === 'office' && (
        <div className="modal-foot"><button className="btn" onClick={() => setAdding(true)}>＋ {t('مستخدم', 'User')}</button></div>
      )}
      {pinFor && <PinModal p={pinFor} onClose={() => setPinFor(null)} />}
      {adding && <AddUser onClose={() => setAdding(false)} onDone={refresh} />}
    </div>
  );
}

export function PinModal({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone?: () => void }) {
  const { s } = useApp();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={<>{t('كلمة سر جديدة', 'New password')} · {p.name}</>} onClose={onClose} narrow>
      <div className="grid2">
        <Field label={t('كلمة السر', 'Password')}><input type="password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label={t('تأكيد', 'Again')}><input type="password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
      </div>
      <p className="muted small">{t('6 أحرف أو أرقام على الأقل.', 'At least 6 characters.')}</p>
      {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" onClick={async () => {
          if (a !== b) return setErr(t('كلمة السر وتأكيدها مختلفان', 'Password and confirmation differ'));
          try {
            await s.api.call('profile.setPin', { id: p.id, pin: a });
            toast(t('تغيّرت كلمة السر', 'Password changed'));
            onDone?.();
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
  const { s, d } = useApp();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('holder');
  const [book, setBook] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const books = d.lists.books.filter((b) => !b.is_main && b.active).map((b) => ({ value: b.id, label: b.name }));
  return (
    <Modal title={t('مستخدم جديد', 'New user')} onClose={onClose} narrow>
      <div className="grid2">
        <Field label={t('الاسم', 'Name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('الدور', 'Role')}>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="holder">{t('أمين صندوق', 'Cash holder')}</option>
            <option value="com">{t('المحاسب', 'Accountant')}</option>
            <option value="sup">{t('الرئيس', 'Superior')}</option>
          </select>
        </Field>
        {role === 'holder' && (
          <Field label={t('دفتره', 'Their book')}><Select value={book} options={books} onChange={setBook} /></Field>
        )}
        <Field label={t('كلمة السر (6 على الأقل)', 'Password (6+)')}><input type="password" value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
      </div>
      {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!name.trim()} onClick={async () => {
          try {
            await s.api.call('profile.add', { name, role, pin, book_id: role === 'holder' ? book : null });
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

function Audit() {
  const { s, d } = useApp();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [open, setOpen] = useState<AuditRow | null>(null);
  useEffect(() => {
    s.api.call('audit.list').then(setRows).catch(() => undefined);
  }, [s.api, d]);
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
