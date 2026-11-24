// A short notice for the Administrator (roles step 2, 25 November 2026): roles made by hand before the update that still carry the
// Respo book (private books) or the donors and grants. Step 1 kept them so nobody is locked out; they cannot be given to anyone new.
// Nothing is removed here: the Administrator decides, role by role, in "Roles and permissions".
import { useEffect, useState } from 'react';
import { useApp } from '../state';
import type { AccessRow } from '../ops';
import { ADMIN_ONLY, SENSITIVE } from '../roles';
import { m, tx } from '../i18n';
import { biName } from './kit';

const tickName = (p: string) => SENSITIVE.find((x) => x.perms.some((q) => q === p))?.label;

export function OldRolesNotice() {
  const { s, can } = useApp();
  const [old, setOld] = useState<AccessRow[]>([]);
  const mine = can('lists.donors') && can('users.manage');
  useEffect(() => {
    if (!mine) return;
    s.api.call('access.list').then((all) => setOld(all.filter((a) => a.kind !== 'administrator' && a.perms.some((p) => ADMIN_ONLY.includes(p))))).catch(() => undefined);
  }, [s, mine]);
  if (!mine || !old.length) return null;
  return (
    <div className="alert warn small" style={{ marginBottom: 12 }}>
      <b>{tx(m('أدوار قديمة ما زالت تحمل دفتر المسؤول أو المانحين', 'Old roles that still carry the Respo book or the donors', 'Anciens rôles qui ont encore le livre du Respo ou les bailleurs'))}</b>
      <div>{tx(m(
        'من الآن دفتر المسؤول والمنح والمانحون لدور المشرف وحده. تركنا هذه الأدوار كما هي كي لا يُقفل الباب على أحد، لكن لا تُعطى لأحد جديد. لم يُحذف شيء: عدّلها أنت من «الأدوار والصلاحيات».',
        'From now on the Respo book, the grants and the donors belong to the Administrator role alone. These roles were left as they are so nobody is locked out, but they cannot be given to anyone new. Nothing was removed: change them yourself in "Roles and permissions".',
        'Désormais le livre du Respo, les subventions et les bailleurs sont pour le rôle Administrateur seul. Ces rôles sont laissés tels quels pour ne bloquer personne, mais ils ne peuvent plus être donnés à une nouvelle personne. Rien n’a été retiré : changez-les vous-même dans « Rôles et permissions ».'))}</div>
      <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
        {old.map((a) => (
          <li key={a.id}>
            <b>{biName(a.name)}</b> · {a.users} {tx(m('شخص', a.users === 1 ? 'person' : 'people', a.users > 1 ? 'personnes' : 'personne'))}
            {' — '}{a.perms.filter((p) => ADMIN_ONLY.includes(p)).map((p) => { const l = tickName(p); return l ? tx(l) : p; }).join(' · ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
