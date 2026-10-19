// The roles page (the administrator): what each kind of account may see and do.
// One column per kind of account (Superior, Econome, Minister, Administrator, Jesuit),
// one row per thing; "view" rows only show, "modify" rows change something.
import { useCallback, useEffect, useState } from 'react';
import { errText, toast } from '../../ui/kit';
import type { AccessRow } from '../../ops';
import type { Perm } from '../../perms';
import { Card, useCty } from './CtyApp';
import { triName, t3 } from './text';

interface Row { key: Perm; kind: 'view' | 'modify'; label: string }
const ROWS: { title: string; rows: Row[] }[] = [
  {
    title: t3('الاطّلاع', 'Seeing', 'Voir'),
    rows: [
      { key: 'cty.view_all', kind: 'view', label: t3('يرى كل قيود الجماعة', 'Sees all the records of the community', 'Voit toutes les écritures de la communauté') },
      { key: 'audit.view', kind: 'view', label: t3('يرى سجل التعديلات', 'Sees the audit log', 'Voit le journal des modifications') },
    ],
  },
  {
    title: t3('العمل في الدفاتر', 'Working in books', 'Travailler dans les comptes'),
    rows: [
      { key: 'book.own', kind: 'modify', label: t3('يكتب في دفتره ويغلق شهره', 'Writes in his own book(s)', 'Écrit dans ses propres comptes') },
      { key: 'month.close', kind: 'modify', label: t3('يغلق الفصل ويرسله إلى البلد', 'Closes the quarter and sends it to the country', 'Clôture le trimestre et l’envoie au pays') },
      { key: 'month.reopen', kind: 'modify', label: t3('يعيد فتح شهر مغلق', 'Reopens a closed month', 'Rouvre un mois clos') },
      { key: 'cty.month_seen', kind: 'modify', label: t3('يوافق أو يرفض النفقات ويعلّق', 'Approves or refuses expenses, comments', 'Approuve ou refuse les dépenses, commente') },
    ],
  },
  {
    title: t3('الإعدادات', 'Settings', 'Réglages'),
    rows: [
      { key: 'cty.limits', kind: 'modify', label: t3('الحدود والإعدادات', 'Limits and settings', 'Plafonds et réglages') },
      { key: 'cty.chart', kind: 'modify', label: t3('دليل الحسابات', 'Chart of codes', 'Plan des comptes') },
      { key: 'cty.passwords', kind: 'modify', label: t3('كلمات السر الجديدة', 'Resets passwords', 'Réinitialise les mots de passe') },
      { key: 'users.manage', kind: 'modify', label: t3('الحسابات والمناصب والصلاحيات', 'Accounts, offices and permissions', 'Comptes, fonctions et permissions') },
    ],
  },
  {
    title: t3('الملفات', 'Files', 'Fichiers'),
    rows: [
      { key: 'data.export', kind: 'view', label: t3('تصدير Excel وملفات البلد', 'Exports to Excel and country files', 'Exporte vers Excel et fichiers du pays') },
      { key: 'data.import', kind: 'modify', label: t3('استيراد ملف قديم', 'Imports an old file', 'Importe un ancien fichier') },
      { key: 'data.backup', kind: 'modify', label: t3('نسخة احتياطية', 'Backup', 'Sauvegarde') },
      { key: 'data.restore', kind: 'modify', label: t3('استرجاع نسخة', 'Restore a backup', 'Restaure une sauvegarde') },
    ],
  },
];

export function RolesScreen() {
  const { s, reload } = useCty();
  const [list, setList] = useState<AccessRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => s.api.call('access.list').then((l) => { setList(l); setErr(null); }).catch((e) => setErr(errText(e))), [s]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (a: AccessRow, p: Perm) => {
    const perms = a.perms.includes(p) ? a.perms.filter((x) => x !== p) : [...a.perms, p];
    try {
      await s.api.call('access.save', { id: a.id, name: a.name, perms });
      await load();
      await reload();
      toast(t3('حُفظ ✓', 'Saved ✓', 'Enregistré ✓'));
    } catch (e) { toast(errText(e), true); }
  };

  return (
    <>
      <h1>{t3('الصلاحيات', 'Roles and permissions', 'Rôles et permissions')}</h1>
      <p className="muted small">{t3('ماذا يستطيع كل نوع من الحسابات: «اطّلاع» يعرض فقط، و«تعديل» يغيّر شيئاً. تسري التغييرات عند الدخول التالي.', 'What each kind of account may do. “View” only shows; “modify” changes something. Changes apply at the next sign-in.', 'Ce que chaque type de compte peut faire. « Voir » montre seulement ; « modifier » change quelque chose. Les changements s’appliquent à la prochaine connexion.')}</p>
      {err && <div className="alert err">{err}</div>}
      <Card className="desk-scroll">
        <table className="desk-table cty-roles">
          <thead>
            <tr><th />{list.map((a) => <th key={a.id} className="c">{triName(a.name).split(' · ')[0]}<div className="muted small">{a.users}</div></th>)}</tr>
          </thead>
          <tbody>
            {ROWS.map((g) => (
              <>
                <tr key={g.title} className="fdc-head"><td colSpan={list.length + 1}>{g.title}</td></tr>
                {g.rows.map((r) => (
                  <tr key={r.key}>
                    <td><span className={`cty-pill ${r.kind}`}>{r.kind === 'view' ? t3('اطّلاع', 'View', 'Voir') : t3('تعديل', 'Modify', 'Modifier')}</span> {r.label}</td>
                    {list.map((a) => <td key={a.id} className="c"><input type="checkbox" checked={a.perms.includes(r.key)} onChange={() => toggle(a, r.key)} /></td>)}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
