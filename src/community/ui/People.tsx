// The Superior's settings: everyone in the community and his roles, in one table, ticks
// to change them. Roles can change during the year (a Jesuit becomes econome instead of
// another): the books follow the roles, and a new econome sees every old record at once.
import { useCallback, useEffect, useState } from 'react';
import { errText, promptBox, toast } from '../../ui/kit';
import type { CtyPersonRow } from '../people';
import type { CtyRole } from '../setup';
import { useCty, Card } from './CtyApp';
import { t3 } from './text';

export const roleLabel = (r: CtyRole) => (r === 'superior' ? t3('الرئيس', 'Superior', 'Supérieur') : r === 'econome' ? t3('القيم', 'Econome', 'Économe') : r === 'minister' ? t3('المدبر', 'Minister', 'Ministre') : t3('يسوعي', 'Jesuit', 'Jésuite'));
const ROLES: CtyRole[] = ['superior', 'econome', 'minister'];

type Row = CtyPersonRow & { dirty?: boolean };

export function PeopleScreen() {
  const { s, reload, can } = useCty();
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ name: string; password: string; roles: CtyRole[]; hasBank: boolean } | null>(null);
  const load = useCallback(() => s.api.call('cty.people').then((ps) => { setRows(ps); setErr(null); }).catch((e) => setErr(errText(e))), [s]);
  useEffect(() => { void load(); }, [load]);
  const may = can('users.manage');

  const change = (id: number, p: Partial<Row>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...p, dirty: true } : r)));
  const toggle = (r: Row, role: CtyRole) => change(r.id, { roles: r.roles.includes(role) ? r.roles.filter((x) => x !== role) : [...r.roles, role] });
  const save = async (r: Row, password?: string | null) => {
    try {
      await s.api.call('cty.person.save', { id: r.id, name: r.name, roles: r.roles, active: r.active, hasBank: r.hasBank, password: password ?? null });
      await load();
      await reload();
      toast(t3('حُفظ ✓', 'Saved ✓', 'Enregistré ✓'));
    } catch (e) { toast(errText(e), true); }
  };
  const newPassword = async (r: Row) => {
    const pw = await promptBox(t3(`كلمة سر جديدة لـ ${r.name} (6+، يغيّرها عند الدخول)`, `New password for ${r.name} (6+; he changes it at sign-in)`, `Nouveau mot de passe pour ${r.name} (6+ ; il le change à la connexion)`));
    if (pw) await save(r, pw);
  };
  const add = async () => {
    if (!adding) return;
    try {
      await s.api.call('cty.person.save', { name: adding.name, roles: adding.roles, password: adding.password, hasBank: adding.hasBank });
      setAdding(null);
      await load();
      await reload();
      toast(t3('أُضيف ✓', 'Added ✓', 'Ajouté ✓'));
    } catch (e) { toast(errText(e), true); }
  };
  const tick = (on: boolean, onChange: () => void, disabled?: boolean) => <input type="checkbox" checked={on} onChange={onChange} disabled={disabled || !may} />;

  return (
    <>
      <h1>{t3('الأشخاص والأدوار', 'People and roles', 'Personnes et rôles')}</h1>
      <p className="muted small">{t3('كل الإخوة وأدوارهم. ضع علامة لتغيير دور، ثم «احفظ» في السطر. في كل جماعة رئيس وقيم ومدبر؛ الدفاتر تتبع الدور، والقيم الجديد يرى كل القيود القديمة.', 'Everyone and his roles. Tick to change a role, then "Save" on that row. Every community has a Superior, an econome and a minister; the books follow the role, and a new econome sees all the old records.', "Tous et leurs rôles. Cochez pour changer un rôle, puis « Enregistrer » sur la ligne. Chaque communauté a un Supérieur, un économe et un ministre ; les comptes suivent le rôle, et le nouvel économe voit toutes les anciennes écritures.")}</p>
      {err && <div className="alert err">{err}</div>}
      <Card className="cty-people-card">
        <table className="cty-people">
          <thead>
            <tr>
              <th>{t3('الاسم', 'Name', 'Nom')}</th>
              {ROLES.map((r) => <th key={r}>{roleLabel(r)}</th>)}
              <th>🏦</th>
              <th>{t3('حاضر', 'Present', 'Présent')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`${r.active ? '' : 'off'} ${r.dirty ? 'dirty' : ''}`}>
                <td><b>{r.name}</b>{!r.roles.length && <div className="muted small">{roleLabel('jesuit')}</div>}</td>
                {ROLES.map((role) => <td key={role} className="c">{tick(r.roles.includes(role), () => toggle(r, role))}</td>)}
                <td className="c">{tick(r.hasBank, () => change(r.id, { hasBank: !r.hasBank }))}</td>
                <td className="c">{tick(!!r.active, () => change(r.id, { active: r.active ? 0 : 1 }))}</td>
                <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  {may && r.dirty && <button className="btn primary" onClick={() => save(r)}>{t3('احفظ', 'Save', 'Enregistrer')}</button>}
                  {may && !r.dirty && <button className="btn ghost small" onClick={() => newPassword(r)} title={t3('كلمة سر جديدة', 'New password', 'Nouveau mot de passe')}>🔑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {may && !adding && <button className="btn cty-wide" onClick={() => setAdding({ name: '', password: '', roles: [], hasBank: false })}>＋ {t3('شخص جديد', 'A new person', 'Une nouvelle personne')}</button>}
        {adding && (
          <div className="cty-add-person">
            <div className="cty-label">{t3('شخص جديد', 'A new person', 'Une nouvelle personne')}</div>
            <div className="grid2">
              <label className="field"><span>{t3('الاسم', 'Name', 'Nom')}</span><input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></label>
              <label className="field"><span>{t3('كلمة سر أولى (6+)', 'First password (6+)', 'Premier mot de passe (6+)')}</span><input type="password" value={adding.password} onChange={(e) => setAdding({ ...adding, password: e.target.value })} /></label>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {ROLES.map((r) => (
                <label key={r} className="row" style={{ gap: 4 }}><input type="checkbox" checked={adding.roles.includes(r)} onChange={() => setAdding({ ...adding, roles: adding.roles.includes(r) ? adding.roles.filter((x) => x !== r) : [...adding.roles, r] })} />{roleLabel(r)}</label>
              ))}
              <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={adding.hasBank} onChange={() => setAdding({ ...adding, hasBank: !adding.hasBank })} />{t3('له حساب في المصرف', 'Has a bank account', 'A un compte en banque')}</label>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => setAdding(null)}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
              <button className="btn primary" disabled={!adding.name.trim() || adding.password.length < 6} onClick={add}>{t3('أضف', 'Add', 'Ajouter')}</button>
            </div>
          </div>
        )}
      </Card>
      <p className="muted small">🏦 = {t3('له حساب في المصرف', 'has a bank account', 'a un compte en banque')} · {t3('حاضر: ألغِ إذا غادر (يبقى دفتره).', 'Present: untick if he left (his book is kept).', "Présent : décochez s'il est parti (son compte est gardé).")}</p>
    </>
  );
}
