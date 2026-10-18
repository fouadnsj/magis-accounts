// The Superior's settings: the people of the community and their roles. Roles can change
// during the year (a Jesuit becomes econome instead of another); the books follow the roles,
// and a new econome sees every old record at once.
import { useCallback, useEffect, useState } from 'react';
import { errText, toast } from '../../ui/kit';
import type { CtyPersonRow } from '../people';
import type { CtyRole } from '../setup';
import { useCty, Card } from './CtyApp';
import { t3 } from './text';

export const roleLabel = (r: CtyRole) => (r === 'superior' ? t3('الرئيس', 'Superior', 'Supérieur') : r === 'econome' ? t3('القيّم', 'Econome', 'Économe') : r === 'minister' ? t3('المدبّر', 'Minister', 'Ministre') : t3('يسوعي', 'Jesuit', 'Jésuite'));
const ROLES: CtyRole[] = ['superior', 'econome', 'minister'];

export function PeopleScreen() {
  const { s, reload, can } = useCty();
  const [people, setPeople] = useState<CtyPersonRow[]>([]);
  const [edit, setEdit] = useState<(Partial<CtyPersonRow> & { password?: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => s.api.call('cty.people').then(setPeople).catch((e) => setErr(errText(e))), [s]);
  useEffect(() => { void load(); }, [load]);
  const may = can('users.manage');

  const save = async () => {
    if (!edit) return;
    try {
      await s.api.call('cty.person.save', { id: edit.id ?? null, name: edit.name ?? '', roles: edit.roles ?? [], active: edit.active ?? 1, password: edit.password || null, hasBank: edit.hasBank ?? false });
      setEdit(null);
      await load();
      await reload();
      toast(t3('حُفظ ✓', 'Saved ✓', 'Enregistré ✓'));
    } catch (e) { toast(errText(e), true); }
  };

  return (
    <>
      <h1>{t3('الأشخاص والأدوار', 'People and roles', 'Personnes et rôles')}</h1>
      <p className="muted small">{t3('في كل جماعة رئيس وقيّم ومدبّر. تتغيّر الأدوار خلال السنة: الدفاتر تتبع الدور، والقيّم الجديد يرى كل القيود القديمة.', 'Every community has a Superior, an econome and a minister. Roles can change during the year: the books follow the role, and a new econome sees all the old records.', "Chaque communauté a un Supérieur, un économe et un ministre. Les rôles peuvent changer pendant l'année : les comptes suivent le rôle, et le nouvel économe voit toutes les anciennes écritures.")}</p>
      {err && <div className="alert err">{err}</div>}
      <Card>
        {people.map((p) => (
          <div key={p.id} className={`cty-person ${p.active ? '' : 'off'}`}>
            <div>
              <b>{p.name}</b>
              <div className="cty-chips" style={{ margin: '4px 0 0' }}>
                {(p.roles.length ? p.roles : ['jesuit' as CtyRole]).map((r) => <span key={r} className="cty-role">{roleLabel(r)}</span>)}
                {p.hasBank && <span className="cty-role">🏦</span>}
                {!p.active && <span className="cty-role off">{t3('غادر', 'left', 'parti')}</span>}
              </div>
            </div>
            {may && <button className="btn" onClick={() => setEdit({ ...p })}>{t3('تغيير', 'Change', 'Modifier')}</button>}
          </div>
        ))}
        {may && <button className="btn primary cty-wide" onClick={() => setEdit({ name: '', roles: [], active: 1, hasBank: false })}>＋ {t3('شخص جديد', 'A new person', 'Une nouvelle personne')}</button>}
      </Card>
      {edit && (
        <div className="cty-sheet" role="dialog">
          <div className="cty-sheet-head"><button className="cty-icon" onClick={() => setEdit(null)}>✕</button><b>{edit.id ? edit.name : t3('شخص جديد', 'A new person', 'Une nouvelle personne')}</b></div>
          <div className="cty-sheet-body">
            <label className="field"><span>{t3('الاسم', 'Name', 'Nom')}</span><input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <div className="cty-label" style={{ marginTop: 10 }}>{t3('الأدوار (لا شيء = يسوعي)', 'Roles (none = a Jesuit)', 'Rôles (aucun = un jésuite)')}</div>
            <div className="cty-tiles small">
              {ROLES.map((r) => {
                const on = edit.roles?.includes(r);
                return <button key={r} className={on ? 'on' : ''} onClick={() => setEdit({ ...edit, roles: on ? edit.roles!.filter((x) => x !== r) : [...(edit.roles ?? []), r] })}>{roleLabel(r)}</button>;
              })}
            </div>
            <label className="cty-check"><input type="checkbox" checked={!!edit.hasBank} onChange={(e) => setEdit({ ...edit, hasBank: e.target.checked })} /><span>{t3('له حساب في المصرف', 'Has a bank account', 'A un compte en banque')}</span></label>
            {edit.id && (
              <label className="cty-check"><input type="checkbox" checked={edit.active !== 0} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /><span>{t3('في الجماعة (ألغِ إن غادر؛ يبقى دفتره)', 'In the community (untick if he left; his book is kept)', "Dans la communauté (décocher s'il est parti ; son compte est gardé)")}</span></label>
            )}
            <label className="field"><span>{edit.id ? t3('كلمة سر جديدة (اختيارية، يغيّرها عند الدخول)', 'New password (optional; he changes it at sign-in)', 'Nouveau mot de passe (facultatif ; il le change à la connexion)') : t3('كلمة سر أولى (6+، يغيّرها عند الدخول)', 'First password (6+; he changes it at sign-in)', 'Premier mot de passe (6+ ; il le change à la connexion)')}</span>
              <input type="password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></label>
            <button className="btn primary cty-wide" onClick={save}>{t3('احفظ', 'Save', 'Enregistrer')}</button>
          </div>
        </div>
      )}
    </>
  );
}
