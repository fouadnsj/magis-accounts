// Manage the databases (Fouad, 29 October 2026), from the welcome page: switch a database off (kept, hidden,
// nobody can sign in) or on again, delete one, or put a deleted one back. A change needs the password of that
// database's Superior; a deleted database is not erased: its whole folder moves to "deleted" on the server.
import { useCallback, useEffect, useState } from 'react';
import { m, tx } from '../i18n';
import { serverDbDelete, serverDbRestore, serverDbState, serverManageList, type DeletedDb, type ManagedDb } from '../net';
import { Field, Modal, errText, toast } from './kit';

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
const t3 = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));

type Action = { kind: 'off' | 'on' | 'delete'; db: ManagedDb };

export function ManageDbs({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<{ dbs: ManagedDb[]; deleted: DeletedDb[]; folder: string } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await serverManageList());
    } catch (e) {
      toast(errText(e), true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const done = async () => {
    setAction(null);
    await load();
    await onChanged();
  };
  const kindName = (d: ManagedDb) => d.kind === 'community' ? t3('جماعة', 'Community', 'Communauté') : d.kind === 'country' ? t3('بلد', 'Country', 'Pays') : t3('مركز', 'Centre', 'Centre');

  return (
    <Modal title={t3('إدارة قواعد البيانات', 'Manage databases', 'Gérer les bases de données')} onClose={onClose}>
      {!data ? <p className="muted">…</p> : (
        <>
          <p className="muted small">{t3('إيقاف قاعدة: تبقى على القرص لكن تختفي ولا يدخلها أحد. الحذف: لا يمحو شيئاً، ينقل المجلد كله (القاعدة والنسخ والوثائق) إلى مجلد «deleted». كل تغيير يحتاج كلمة سر رئيس القاعدة.', 'Switch off: the database stays on the disk but is hidden and nobody can sign in. Delete: nothing is erased — the whole folder (database, backups, documents) moves to the "deleted" folder. Every change needs the password of that database\'s Superior.', 'Désactiver : la base reste sur le disque mais disparaît et personne ne peut s\'y connecter. Supprimer : rien n\'est effacé — tout le dossier (base, sauvegardes, documents) passe dans le dossier « deleted ». Chaque changement demande le mot de passe du Supérieur de cette base.')}</p>
          <table className="t">
            <thead><tr><th>{t3('القاعدة', 'Database', 'Base')}</th><th>{t3('النوع', 'Kind', 'Type')}</th><th className="n">{t3('الحجم', 'Size', 'Taille')}</th><th className="n">{t3('نسخ', 'Backups', 'Sauvegardes')}</th><th /></tr></thead>
            <tbody>
              {data.dbs.map((d) => (
                <tr key={d.slug} className={d.active ? '' : 'off'}>
                  <td><b>{d.organisation}</b>{!d.active && <span className="pill" style={{ marginInlineStart: 6 }}>{t3('موقوفة', 'Switched off', 'Désactivée')}</span>}</td>
                  <td>{kindName(d)}{d.city ? ` · ${d.city}` : ''}</td>
                  <td className="n ltr">{mb(d.bytes)}</td>
                  <td className="n">{d.backups}</td>
                  <td className="nowrap right">
                    <button className="btn small" onClick={() => setAction({ kind: d.active ? 'off' : 'on', db: d })}>{d.active ? t3('إيقاف', 'Switch off', 'Désactiver') : t3('تشغيل', 'Switch on', 'Activer')}</button>{' '}
                    <button className="btn small danger" onClick={() => setAction({ kind: 'delete', db: d })}>{t3('حذف', 'Delete', 'Supprimer')}</button>
                  </td>
                </tr>
              ))}
              {!data.dbs.length && <tr><td colSpan={5} className="muted">{t3('لا قواعد بيانات.', 'No databases.', 'Aucune base.')}</td></tr>}
            </tbody>
          </table>
          {data.deleted.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>{t3('المحذوفة (محفوظة في مجلد)', 'Deleted (kept in a folder)', 'Supprimées (gardées dans un dossier)')}</h3>
              <table className="t">
                <tbody>
                  {data.deleted.map((x) => (
                    <tr key={x.folder}>
                      <td><b>{x.organisation}</b><div className="muted small ltr">{x.folder}</div></td>
                      <td className="n ltr">{mb(x.bytes)}</td>
                      <td className="right"><button className="btn small" onClick={async () => {
                        try {
                          await serverDbRestore(x.folder);
                          toast(t3('أُعيدت', 'Put back', 'Remise en place'));
                          await done();
                        } catch (e) {
                          toast(errText(e), true);
                        }
                      }}>{t3('استعادة', 'Put back', 'Remettre')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="muted small ltr" style={{ marginTop: 10 }}>{t3('مجلد المحذوفات', 'Folder of the deleted', 'Dossier des supprimées')}: {data.folder}</p>
        </>
      )}
      {action && <Confirm action={action} onCancel={() => setAction(null)} onDone={done} />}
      <div className="modal-foot"><button className="btn primary" onClick={onClose}>{t3('تم', 'Done', 'Terminé')}</button></div>
    </Modal>
  );
}

/** The Superior's password (and, to delete, the name of the database typed) */
function Confirm({ action, onCancel, onDone }: { action: Action; onCancel: () => void; onDone: () => Promise<void> }) {
  const { kind, db } = action;
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (kind === 'delete') await serverDbDelete(db.slug, name, password);
      else await serverDbState(db.slug, kind === 'on', password);
      toast(kind === 'delete' ? t3('نُقلت إلى المحذوفات', 'Moved to the deleted folder', 'Déplacée dans le dossier des supprimées') : t3('حُفظ', 'Saved', 'Enregistré'));
      await onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const title = kind === 'delete' ? t3('حذف', 'Delete', 'Supprimer') : kind === 'off' ? t3('إيقاف', 'Switch off', 'Désactiver') : t3('تشغيل', 'Switch on', 'Activer');
  return (
    <Modal title={`${title} · ${db.organisation}`} onClose={onCancel} narrow>
      {kind === 'delete' && <div className="alert warn">{t3('لن يظهر بعد الآن. لا شيء يُمحى: المجلد كله يُحفظ في «deleted» ويمكن استعادته.', 'It will no longer appear. Nothing is erased: the whole folder is kept in "deleted" and can be put back.', 'Elle n\'apparaîtra plus. Rien n\'est effacé : tout le dossier est gardé dans « deleted » et peut être remis.')}</div>}
      {kind === 'delete' && (
        <Field label={t3(`اكتب الاسم للتأكيد: ${db.organisation}`, `Type the name to confirm: ${db.organisation}`, `Tapez le nom pour confirmer : ${db.organisation}`)}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <Field label={t3('كلمة سر رئيس هذه القاعدة', "Password of this database's Superior", 'Mot de passe du Supérieur de cette base')}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && password && (kind !== 'delete' || name) && void go()} />
      </Field>
      {err && <div className="alert err">{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onCancel}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className={`btn ${kind === 'delete' ? 'danger' : 'primary'}`} disabled={busy || !password || (kind === 'delete' && name.trim() !== db.organisation)} onClick={go}>{busy ? '…' : title}</button>
      </div>
    </Modal>
  );
}
