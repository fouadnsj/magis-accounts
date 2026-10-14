// Admin → Server: the address to type on other devices, backups, who is connected.
import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { serverConfig, serverStatus } from '../net';
import { Field, errText, fmtDate, t, toast } from './kit';

interface Status {
  version: string;
  addresses: string[];
  hostname: string;
  dataDir: string;
  dbSize: number;
  lastBackup: { name: string; modified: number } | null;
  backupCount: number;
  backupMirror: string | null;
  mirrorOk: boolean | null;
  users: string[];
  startedAt: string;
}

export function ServerTab() {
  const { can } = useApp();
  const isSup = can('users.manage');
  const [st, setSt] = useState<Status | null>(null);
  const [mirror, setMirror] = useState('');
  const load = () =>
    serverStatus<Status>().then((x) => {
      setSt(x);
      setMirror(x.backupMirror ?? '');
    }).catch((e) => toast(errText(e), true));
  useEffect(() => {
    void load();
  }, []);
  if (!st) return <p className="muted">…</p>;
  const lastAge = st.lastBackup ? (Date.now() - st.lastBackup.modified) / 3600e3 : Infinity;
  return (
    <div className="grid2">
      <div className="panel">
        <h3>{t('العنوان على الأجهزة الأخرى', 'Address on the other devices')}</h3>
        {st.addresses.map((a) => <div key={a} className="ltr" style={{ fontSize: 20, fontWeight: 700, margin: '6px 0' }}>{a}</div>)}
        <p className="muted small">
          {t('اكتب هذا العنوان في المتصفح (حاسوب أو هاتف على شبكة المركز). في أول مرة يحذّر المتصفح من الشهادة: اضغط «متقدم» ثم «متابعة».',
            'Type this address in the browser (computer or phone on the centre network). The first time, the browser warns about the certificate: press "Advanced" then "Proceed".')}
        </p>
        <p className="muted small">{t('اطلب من مسؤول الشبكة تثبيت عنوان هذا الحاسوب في الراوتر حتى لا يتغير.', 'Ask whoever manages the router to fix (reserve) this computer\'s address so it never changes.')}</p>
        <p className="small">{t('متصل الآن', 'Connected now')}: {st.users.join('، ') || '—'}</p>
        <p className="muted small ltr">v{st.version} · {st.hostname} · {t('منذ', 'since')} {st.startedAt.slice(0, 16).replace('T', ' ')}</p>
      </div>
      <div className="panel">
        <h3>{t('النسخ الاحتياطية', 'Backups')}</h3>
        <p>
          {t('آخر نسخة', 'Last backup')}:{' '}
          {st.lastBackup ? <span className={lastAge < 26 ? 'ok' : 'bad'}>{fmtDate(new Date(st.lastBackup.modified).toISOString().slice(0, 10))}</span> : <span className="bad">—</span>}
          <span className="muted small"> · {st.backupCount} {t('نسخة', 'copies')}</span>
        </p>
        <p className="muted small ltr">{st.dataDir}</p>
        <Field label={t('نسخة ثانية في (مفتاح USB أو قرص خارجي)', 'Second copy in (USB key or external disk)')}>
          <input className="ltr" placeholder="E:\MAGIS-backups" value={mirror} disabled={!isSup} onChange={(e) => setMirror(e.target.value)} />
        </Field>
        {st.backupMirror && (st.mirrorOk ? <p className="ok small">✓ {t('المجلد موجود', 'Folder found')}</p> : <p className="bad small">✗ {t('المجلد غير موجود — هل المفتاح موصول؟', 'Folder not found — is the key plugged in?')}</p>)}
        {isSup && (
          <div className="modal-foot">
            <button className="btn primary" onClick={async () => {
              try {
                await serverConfig({ backupMirror: mirror || null });
                toast(t('حُفظ', 'Saved'));
                await load();
              } catch (e) {
                toast(errText(e), true);
              }
            }}>{t('احفظ', 'Save')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
