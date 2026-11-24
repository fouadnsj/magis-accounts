// The door "Administration · الإدارة" (Fouad, 25 November 2026; roles step 3): the people of the centre and their roles.
// Self-contained: People (the Users window), Roles (the ready-made roles), and the Accountant's small Book holders window
// (shown in Accounts → Settings). Only whoever holds the role Administrator or Director sees the door (src/roles.ts peopleDoor).
import { useEffect, useState } from 'react';
import { SignAsButton } from './SignAs';
import { useApp } from '../state';
import type { Profile } from '../auth';
import type { AccessRow, UserRow } from '../ops';
import { PERM_GROUPS, withImplied, type Perm } from '../perms';
import { READY_ROLES, doorsOf } from '../doors';
import { doorName } from './Doors';
import { ADMIN_GIVES, ADMIN_ONLY, MSG_ADMIN_ONLY, MSG_NOT_SELF, ROLE_KINDS, kindInfo, peopleDoor, sensitiveOf, unionPerms, whyNotGive, type RoleLike } from '../roles';
import { m, tx, type Msg } from '../i18n';
import { Field, Modal, biName, confirmBox, errText, t, toast } from './kit';
import { GuideLink } from '../guide/GuideView';
import { Phones } from './Phones';
import { OldRolesNotice } from './OldRolesNotice';

/** The page "People": everyone of this centre, with their roles, doors and exceptions; the phones under it. */
export function PeoplePage() {
  return (
    <>
      <div className="page-head"><h1>{tx(m('الأشخاص', 'People', 'Personnes'))}<GuideLink id="people" /></h1></div>
      <OldRolesNotice />
      <Users />
      <Phones />
    </>
  );
}

/** The page "Roles": the ready-made roles, one sentence each; copies and every tick for the Administrator under "Advanced". */
export function RolesPage() {
  return (
    <>
      <div className="page-head"><h1>{tx(m('الأدوار', 'Roles', 'Rôles'))}<GuideLink id="people" /></h1></div>
      <AccessProfiles />
    </>
  );
}

// ---------------------------------------------------------------- users

// (roles step 3, 25 November 2026) The Users window, for people who are not technical: one line per person
// "Name · Roles · Doors · Exceptions". The Administrator gives every role; the Director adds and removes the people of his
// centre and gives the other ready-made roles; the Accountant ("Adds book holders") has his own small window, book holders only.
export function Users() {
  const { can } = useApp();
  if (!can('users.manage') && can('users.holders')) return <HolderUsers />;
  return <People />;
}

/** a person's roles, as rows of the roles list (his first role, then the others) */
const rolesOfUser = (u: Pick<UserRow, 'roles' | 'access_id'>, access: AccessRow[]) =>
  (u.roles?.length ? u.roles : u.access_id != null ? [u.access_id] : []).map((id) => access.find((a) => a.id === id)).filter((a): a is AccessRow => !!a);

/** the name of a tick, for the exceptions */
const permLabel = (p: Perm) => {
  const x = PERM_GROUPS.flatMap((g) => [...g.perms] as { key: Perm; label: Msg }[]).find((q) => q.key === p);
  return x ? tx(x.label) : p;
};

/** the doors this person gets from his roles and exceptions (HR is given from the HR database, not here) */
function doorsLine(roles: RoleLike[], extra: Perm[], hasBook: boolean, inventoryOn: boolean): string {
  const all = unionPerms(roles, extra);
  const ds = doorsOf({ can: (p) => all.includes(p), hasBook, inventoryOn, hr: false, people: peopleDoor(roles, (p) => all.includes(p)) });
  return ds.length ? ds.map((k) => tx(doorName(k))).join(' · ') : '—';
}

function People() {
  const { s, d, can } = useApp();
  const [list, setList] = useState<UserRow[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [edit, setEdit] = useState<Partial<UserRow> | null>(null);
  const [pinFor, setPinFor] = useState<UserRow | null>(null);
  const manage = can('users.manage');
  const admin = !!s.profile.admin;
  const refresh = async () => {
    setList(await s.api.call('users.list'));
    if (manage) setAccess(await s.api.call('access.list'));
  };
  const hasKinds = access.some((a) => a.kind);
  // the Administrator's line and the Directors' lines are the Administrator's to change (the server refuses it too)
  const adminsLine = (u: UserRow) => hasKinds && !admin && u.id !== s.profile.id && rolesOfUser(u, access).some((a) => !!a.kind && ADMIN_GIVES.includes(a.kind as never));
  const mine = (u: UserRow) => manage && !adminsLine(u);
  const pinOk = (u: UserRow) => (manage || u.id === s.profile.id || can('users.passwords')) && !adminsLine(u);
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bookName = (id: number) => d.lists.books.find((b) => b.id === id)?.name ?? '?';
  const [created, setCreated] = useState<{ name: string; book: string; password: string }[] | null>(null);
  const keptIds = new Set(list.filter((u) => u.active).flatMap((u) => u.books));
  const unkept = d.lists.books.filter((b) => b.active && !b.is_main && !keptIds.has(b.id));
  const createKeepers = async () => {
    const names = unkept.map((b) => b.keeper_name || b.name).join('، ');
    if (!(await confirmBox(t(`إنشاء حساب «أمين صندوق» لكل من: ${names}؟\nلكلٍّ كلمة سر مؤقتة يغيّرها عند أول دخول.`, `Create a "Book holder" account for: ${names}?\nEach gets a temporary password, to change at first login.`)))) return;
    try {
      setCreated(await s.api.call('users.createKeepers'));
      await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const deactivate = async (u: UserRow) => {
    if (!(await confirmBox(tx(m(`إيقاف ${u.name}؟ لن يستطيع الدخول. دفاتره تبقى كما هي.`, `Switch off ${u.name}? They will no longer be able to sign in. Their books stay as they are.`, `Désactiver ${u.name} ? Cette personne ne pourra plus se connecter. Ses livres restent tels quels.`)), true))) return;
    try {
      await s.api.call('user.deactivate', { id: u.id });
      await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const off = list.filter((u) => !u.active);
  return (
    <div className="panel" style={{ maxWidth: 1000 }}>
      {manage && hasKinds && (
        <p className="muted small">
          {admin
            ? tx(m('أنت المشرف: تعطي كل الأدوار، ومنها المدير والمشرف. المدير يضيف أشخاص مركزه ويعطيهم الأدوار الأخرى. لا أحد يعطي نفسه دوراً.', 'You are the Administrator: you give every role, Director and Administrator included. The Director adds the people of the centre and gives them the other roles. Nobody gives himself a role.', 'Vous êtes l’Administrateur : vous donnez tous les rôles, Directeur et Administrateur compris. Le Directeur ajoute les personnes du centre et leur donne les autres rôles. Personne ne se donne un rôle.'))
            : tx(m('تضيف أشخاص مركزك وتوقفهم وتعطيهم الأدوار. المشرف وحده يعطي دور المدير ودور المشرف، ويغيّر سطورهما.', 'You add and switch off the people of your centre and give them their roles. Only the Administrator gives the roles Director and Administrator, and changes their lines.', 'Vous ajoutez et désactivez les personnes de votre centre et leur donnez leurs rôles. Seul l’Administrateur donne les rôles Directeur et Administrateur, et change leurs lignes.'))}
        </p>
      )}
      <table className="t">
        <thead>
          <tr>
            <th>{t('الاسم', 'Name')}</th>
            <th>{tx(m('الأدوار', 'Roles', 'Rôles'))}</th>
            {manage && <th>{tx(m('الأبواب', 'Doors', 'Portes'))}</th>}
            {manage && hasKinds && <th>{tx(m('استثناءات', 'Exceptions', 'Exceptions'))}</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {list.filter((u) => u.active).map((u) => {
            const rs = rolesOfUser(u, access);
            return (
              <tr key={u.id}>
                <td>
                  <b>{u.name}</b>
                  {u.books.length > 0 && <div className="muted small">{tx(m('يحمل:', 'Keeps:', 'Tient :'))} {u.books.map(bookName).join('، ')}</div>}
                </td>
                <td>
                  {rs.length ? <RoleChips roles={rs} /> : biName(u.access_name)}
                  {rs.length > 0 && <BecauseOf roles={rs} extra={u.extra ?? []} />}
                </td>
                {manage && <td className="small">{doorsLine(rs, u.extra ?? [], u.books.length > 0, !!d.inv)}</td>}
                {manage && hasKinds && (
                  <td className="small">
                    {u.extra?.length ? <span className="pill" style={{ background: '#FFF1CC' }} title={u.extra.map(permLabel).join('\n')}>+{u.extra.length}</span> : '—'}
                  </td>
                )}
                <td className="right nowrap">
                  {!adminsLine(u) && <SignAsButton s={s} profileId={u.id} name={u.name} small />}{' '}
                  {mine(u) && <button className="btn small" onClick={() => setEdit(u)} title={tx(m('تعديل', 'Change', 'Modifier'))}>✎</button>}{' '}
                  {pinOk(u) && <button className="btn small" onClick={() => setPinFor(u)}>{t('كلمة السر', 'Password')}</button>}{' '}
                  {mine(u) && u.id !== s.profile.id && <button className="btn small ghost" onClick={() => deactivate(u)} title={tx(m('إيقاف', 'Switch off', 'Désactiver'))}>✕</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {manage && off.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="small muted">{tx(m(`موقوفون (${off.length})`, `Switched off (${off.length})`, `Désactivés (${off.length})`))}</summary>
          <p className="small muted">{off.map((u) => u.name).join('، ')}</p>
        </details>
      )}
      {manage && s.install === 'office' && (
        <div className="modal-foot">
          {unkept.length > 0 && (
            <button className="btn" onClick={createKeepers}>
              {t(`إنشاء حسابات لكل أمناء الدفاتر (${unkept.length})`, `Create accounts for all book keepers (${unkept.length})`)}
            </button>
          )}
          <button className="btn primary" onClick={() => setEdit({ books: [] })}>＋ {tx(m('شخص', 'Person', 'Personne'))}</button>
        </div>
      )}
      {created && <CreatedModal rows={created} onClose={() => setCreated(null)} />}
      {edit && <UserModal user={edit} access={access} onClose={() => setEdit(null)} onDone={refresh} />}
      {pinFor && <PinModal p={{ id: pinFor.id, name: pinFor.name }} onClose={() => setPinFor(null)} />}
    </div>
  );
}

/** The Accountant's own window ("Adds book holders"): the book holders only — their name, their book, their password, switched off. */
function HolderUsers() {
  const { s, d, can } = useApp();
  const [list, setList] = useState<UserRow[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [edit, setEdit] = useState<Partial<UserRow> | null>(null);
  const [pinFor, setPinFor] = useState<UserRow | null>(null);
  const refresh = async () => {
    setList(await s.api.call('users.list'));
    setAccess(await s.api.call('access.list')); // (the server sends the book holders' roles only)
  };
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bookName = (id: number) => d.lists.books.find((b) => b.id === id)?.name ?? '?';
  const isHolder = (u: UserRow) => u.id !== s.profile.id && !u.extra?.length && (u.roles?.length ? u.roles : [u.access_id]).every((id) => access.some((a) => a.id === id));
  const holders = list.filter((u) => u.active && isHolder(u));
  const others = list.filter((u) => u.active && !isHolder(u) && u.id !== s.profile.id);
  const me = list.find((u) => u.id === s.profile.id);
  const deactivate = async (u: UserRow) => {
    if (!(await confirmBox(tx(m(`إيقاف ${u.name}؟ لن يستطيع الدخول. دفتره يبقى كما هو.`, `Switch off ${u.name}? They will no longer be able to sign in. The book stays as it is.`, `Désactiver ${u.name} ? Cette personne ne pourra plus se connecter. Le livre reste tel quel.`)), true))) return;
    try {
      await s.api.call('user.deactivate', { id: u.id });
      await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 800 }}>
      <p className="muted small">{tx(m('تضيف أمناء الصناديق: الاسم، دفتره، وكلمة سر تعطيها له مرة واحدة (يختار كلمته عند أول دخول). وتوقفهم. الأشخاص الآخرون والأدوار للمدير.', 'You add the book holders: the name, the book, and a password you give once (they choose their own at the first sign-in). You switch them off too. The other people and the roles are for the Director.', 'Vous ajoutez les teneurs de caisse : le nom, la caisse, et un mot de passe donné une fois (ils choisissent le leur à la première connexion). Vous les désactivez aussi. Les autres personnes et les rôles sont pour le Directeur.'))}</p>
      <table className="t">
        <thead><tr><th>{t('الاسم', 'Name')}</th><th>{tx(m('الدفتر', 'Book', 'Caisse'))}</th><th /></tr></thead>
        <tbody>
          {holders.map((u) => (
            <tr key={u.id}>
              <td><b>{u.name}</b></td>
              <td>{u.books.map(bookName).join('، ') || '—'}</td>
              <td className="right nowrap">
                <button className="btn small" onClick={() => setEdit(u)} title={tx(m('تعديل', 'Change', 'Modifier'))}>✎</button>{' '}
                <button className="btn small" onClick={() => setPinFor(u)}>{t('كلمة السر', 'Password')}</button>{' '}
                <button className="btn small ghost" onClick={() => deactivate(u)} title={tx(m('إيقاف', 'Switch off', 'Désactiver'))}>✕</button>
              </td>
            </tr>
          ))}
          {!holders.length && <tr><td colSpan={3} className="muted small">{tx(m('لا أمين صندوق بعد.', 'No book holder yet.', 'Pas encore de teneur de caisse.'))}</td></tr>}
        </tbody>
      </table>
      {s.install === 'office' && access.length > 0 && (
        <div className="modal-foot">
          <button className="btn primary" onClick={() => setEdit({ books: [] })}>＋ {t('أمين صندوق', 'Book holder')}</button>
        </div>
      )}
      {me && (
        <p className="small" style={{ marginTop: 10 }}>
          {tx(m('كلمة سرّي:', 'My password:', 'Mon mot de passe :'))} <button className="btn small" onClick={() => setPinFor(me)}>{tx(m('أغيّرها', 'Change it', 'Le changer'))}</button>
        </p>
      )}
      {can('users.passwords') && others.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="small">{tx(m('كلمة سر شخص آخر (ليس من يدير المستخدمين)', 'Password of another person (not someone who manages users)', 'Mot de passe d’une autre personne (pas un gestionnaire)'))}</summary>
          <div className="chips" style={{ marginTop: 6 }}>
            {others.map((u) => <button key={u.id} type="button" className="chip" onClick={() => setPinFor(u)}>{u.name}</button>)}
          </div>
        </details>
      )}
      {edit && <HolderModal user={edit} access={access} onClose={() => setEdit(null)} onDone={refresh} />}
      {pinFor && <PinModal p={{ id: pinFor.id, name: pinFor.name }} onClose={() => setPinFor(null)} />}
    </div>
  );
}

/** Add or change a book holder: name, book, password given once. The role is the book holder's (nothing else to choose). */
function HolderModal({ user, access, onClose, onDone }: { user: Partial<UserRow>; access: AccessRow[]; onClose: () => void; onDone: () => Promise<void> }) {
  const { s, d } = useApp();
  const [name, setName] = useState(user.name ?? '');
  const first = (access.find((a) => a.kind === 'holder') ?? access[0])?.id ?? null;
  const [roleId, setRoleId] = useState<number | null>(user.roles?.[0] ?? user.access_id ?? first);
  const [books, setBooks] = useState<number[]>(user.books ?? []);
  const [newPin, setNewPin] = useState(!user.id);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const toggle = (id: number) => setBooks((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const save = async () => {
    try {
      if (roleId == null) return setErr(tx(m('اختر دوراً', 'Choose a role', 'Choisissez un rôle')));
      await s.api.call('user.save', { id: user.id, name, roles: [roleId], books, pin: newPin && pin ? pin : undefined });
      await onDone();
      onClose();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal title={user.id ? tx(m('تعديل أمين صندوق', 'Change a book holder', 'Modifier un teneur de caisse')) : tx(m('أمين صندوق جديد', 'New book holder', 'Nouveau teneur de caisse'))} onClose={onClose} narrow>
      <Field label={t('الاسم', 'Name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {access.length > 1 && (
        <Field label={tx(m('الدور', 'Role', 'Rôle'))}>
          <select value={roleId ?? ''} onChange={(e) => setRoleId(Number(e.target.value))}>
            {access.map((a) => <option key={a.id} value={a.id}>{roleName(a)}</option>)}
          </select>
        </Field>
      )}
      <PasswordOnce isNew={!user.id} open={newPin} setOpen={setNewPin} pin={pin} setPin={setPin} />
      <h3 style={{ marginTop: 14 }}>{tx(m('الدفتر', 'The book', 'La caisse'))}</h3>
      <div className="chips">
        {d.lists.books.filter((b) => b.active && !b.is_main && (!b.private || books.includes(b.id))).map((b) => (
          <button key={b.id} type="button" className={`chip ${books.includes(b.id) ? 'on' : ''}`} onClick={() => toggle(b.id)}>{b.name}</button>
        ))}
      </div>
      {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!name.trim()} onClick={save}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

/** The password, given once: for a new person it is asked; for a known person a button opens the field. */
function PasswordOnce({ isNew, open, setOpen, pin, setPin, self }: { isNew: boolean; open: boolean; setOpen: (b: boolean) => void; pin: string; setPin: (v: string) => void; self?: boolean }) {
  if (!open)
    return (
      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn small" onClick={() => setOpen(true)}>{self ? tx(m('أغيّر كلمة سرّي', 'Change my password', 'Changer mon mot de passe')) : tx(m('أعطي كلمة سر جديدة', 'Give a new password', 'Donner un nouveau mot de passe'))}</button>
      </div>
    );
  return (
    <Field label={self ? tx(m('كلمة سرّي الجديدة (6 على الأقل)', 'My new password (6 or more)', 'Mon nouveau mot de passe (6 ou plus)')) : isNew ? tx(m('كلمة السر التي تعطيها له (6 على الأقل)', 'The password you give (6 or more)', 'Le mot de passe que vous donnez (6 ou plus)')) : tx(m('كلمة السر الجديدة التي تعطيها له (6 على الأقل)', 'The new password you give (6 or more)', 'Le nouveau mot de passe que vous donnez (6 ou plus)'))}>
      <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" />
      {!self && <div className="muted small">{tx(m('تُعطى مرة واحدة: عند أول دخول يختار كلمة سره.', 'Given once: at the first sign-in the person chooses their own.', 'Donné une fois : à la première connexion la personne choisit le sien.'))}</div>}
    </Field>
  );
}

/** A role's name on screen: the ready-made ones in the reader's language, the others as they were typed ("Custom"). */
export const roleName = (a: Pick<AccessRow, 'name' | 'kind'>) => (a.kind && kindInfo(a.kind) ? tx(kindInfo(a.kind)!.label) : biName(a.name));

/** The roles of a person as chips (a Custom role says so). */
function RoleChips({ roles }: { roles: RoleLike[] }) {
  return (
    <span className="chips" style={{ display: 'inline-flex' }}>
      {roles.map((a) => (
        <span key={a.id} className="chip on" style={{ cursor: 'default' }} title={a.kind && kindInfo(a.kind) ? tx(kindInfo(a.kind)!.about) : tx(m('دور خاص', 'Custom role', 'Rôle personnalisé'))}>
          {roleName(a)}{!a.kind ? ` · ${tx(m('خاص', 'Custom', 'Personnalisé'))}` : ''}
        </span>
      ))}
    </span>
  );
}

/** For each sensitive thing the person has, which role brings it ("Sees: prices — because of: Coordinator"), one line per role. */
function BecauseOf({ roles, extra }: { roles: RoleLike[]; extra: Perm[] }) {
  const why = sensitiveOf(roles, extra);
  if (!why.length) return null;
  const lines = new Map<string, { by: string; what: string[] }>();
  for (const w of why) {
    const by = w.roles.length ? w.roles.map((r) => roleName(r)).join(' + ') : tx(m('استثناء', 'an exception', 'une exception'));
    const l = lines.get(by) ?? { by, what: [] };
    l.what.push(tx(w.label));
    lines.set(by, l);
  }
  return (
    <div className="muted small">
      {[...lines.values()].map((l) => (
        <div key={l.by}>{tx(m('يرى:', 'Sees:', 'Voit :'))} {l.what.join(' · ')} — {tx(m('بسبب:', 'because of:', 'à cause de :'))} {l.by}</div>
      ))}
    </div>
  );
}

/** The temporary passwords, shown once: to hand to each person (or print). */
function CreatedModal({ rows, onClose }: { rows: { name: string; book: string; password: string }[]; onClose: () => void }) {
  return (
    <Modal title={t('الحسابات الجديدة', 'New accounts')} onClose={onClose} narrow>
      <div className="alert warn small">
        {t('اكتب كلمات السر المؤقتة الآن: لن تظهر مرة أخرى. عند أول دخول يختار كل واحد كلمة سره.', 'Write these temporary passwords down now: they will not be shown again. At first login, each person chooses his own password.')}
      </div>
      <table className="t">
        <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('الدفتر', 'Book')}</th><th>{t('كلمة السر المؤقتة', 'Temporary password')}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.name}><td><b>{r.name}</b></td><td>{r.book}</td><td className="code" style={{ fontSize: 16 }}>{r.password}</td></tr>)}</tbody>
      </table>
      <div className="modal-foot">
        <button className="btn" onClick={() => window.print()}>{t('طباعة', 'Print')}</button>
        <button className="btn primary" onClick={onClose}>{t('كتبتها', 'I wrote them down')}</button>
      </div>
    </Modal>
  );
}

/** Add or change a person (for who manages the users): name, password given once, roles as chips, "because of", exceptions folded. */
function UserModal({ user, access, onClose, onDone }: { user: Partial<UserRow>; access: AccessRow[]; onClose: () => void; onDone: () => Promise<void> }) {
  const { s, d, can } = useApp();
  const admin = !!s.profile.admin;
  const self = !!user.id && user.id === s.profile.id;
  const [name, setName] = useState(user.name ?? '');
  // several roles: the whole list; the first one is the person's first role
  const [roles, setRoles] = useState<number[]>(user.roles?.length ? user.roles : user.access_id != null ? [user.access_id] : []);
  const [extra, setExtra] = useState<Perm[]>(user.extra ?? []);
  const [books, setBooks] = useState<number[]>(user.books ?? []);
  const [newPin, setNewPin] = useState(!user.id);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const toggle = (id: number) => setBooks((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const toggleRole = (id: number) => setRoles((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const toggleExtra = (p: Perm) => setExtra((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  // roles in their order: the ready-made ones first, then the Custom ones
  const order = (a: AccessRow) => (a.kind ? ROLE_KINDS.findIndex((k) => k.kind === a.kind) : 100 + a.id);
  const sorted = [...access].sort((a, b) => order(a) - order(b));
  const chosen = sorted.filter((a) => roles.includes(a.id));
  const fromRoles = new Set(unionPerms(chosen, []));
  const ownExtra = extra.filter((p) => !fromRoles.has(p));
  const hasKinds = access.some((a) => a.kind);
  const had = new Set(user.roles?.length ? user.roles : user.access_id != null ? [user.access_id] : []);
  /** why a role chip is greyed (null: it may be given, or taken away) — the server says the same */
  const why = (a: AccessRow): Msg | null => {
    if (!hasKinds) return null;
    if (had.has(a.id)) return !admin && !!a.kind && ADMIN_GIVES.includes(a.kind as never) ? MSG_ADMIN_ONLY : null;
    if (self) return MSG_NOT_SELF;
    return whyNotGive({ admin, can }, a);
  };
  // the greyed roles, grouped by reason, said in words (not only on hover)
  const greyed = new Map<string, string[]>();
  for (const a of sorted) {
    const w = why(a);
    if (w && !roles.includes(a.id)) greyed.set(tx(w), [...(greyed.get(tx(w)) ?? []), roleName(a)]);
  }
  const save = async () => {
    try {
      if (!roles.length) return setErr(tx(m('اختر دوراً واحداً على الأقل', 'Choose at least one role', 'Choisissez au moins un rôle')));
      await s.api.call('user.save', { id: user.id, name, roles, extra: ownExtra, books, pin: newPin && pin ? pin : undefined });
      await onDone();
      onClose();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal title={user.id ? tx(m('تعديل شخص', 'Change a person', 'Modifier une personne')) : tx(m('شخص جديد', 'New person', 'Nouvelle personne'))} onClose={onClose} narrow>
      <Field label={t('الاسم', 'Name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <PasswordOnce isNew={!user.id} open={newPin} setOpen={setNewPin} pin={pin} setPin={setPin} self={self} />
      <h3 style={{ marginTop: 14 }}>{tx(m('الأدوار (واحد أو أكثر)', 'Roles (one or several)', 'Rôles (un ou plusieurs)'))}</h3>
      <div className="chips">
        {sorted.map((a) => {
          const w = why(a);
          return (
            <button key={a.id} type="button" disabled={!!w} title={w ? tx(w) : a.kind ? tx(kindInfo(a.kind)!.about) : tx(m('دور خاص', 'Custom role', 'Rôle personnalisé'))}
              className={`chip ${roles.includes(a.id) ? 'on' : ''}`} style={w ? { opacity: 0.45, cursor: 'not-allowed' } : undefined} onClick={() => toggleRole(a.id)}>
              {roleName(a)}{!a.kind && hasKinds ? ` · ${tx(m('خاص', 'Custom', 'Personnalisé'))}` : ''}
            </button>
          );
        })}
      </div>
      {greyed.size > 0 && (
        <div className="muted small" style={{ marginTop: 4 }}>
          {[...greyed.entries()].map(([w, names]) => <div key={w}>{names.join(' · ')}: {w}</div>)}
        </div>
      )}
      {chosen.length > 0 && (
        <ul className="small" style={{ margin: '8px 0', paddingInlineStart: 18 }}>
          {chosen.map((a) => (
            <li key={a.id}><b>{roleName(a)}</b>: {a.kind && kindInfo(a.kind) ? tx(kindInfo(a.kind)!.about) : tx(m('دور خاص، علاماته في صفحة الأدوار.', 'a Custom role; its ticks are on the Roles page.', 'un rôle personnalisé ; ses cases sont sur la page des rôles.'))}</li>
          ))}
        </ul>
      )}
      <p className="muted small">{tx(m('حقوق الشخص هي كل علامات أدواره معاً؛ كل دور يضيف فقط.', 'The rights of the person are all the ticks of their roles together; each role only adds.', 'Les droits de la personne sont toutes les cases de ses rôles ensemble ; chaque rôle ne fait qu’ajouter.'))}</p>
      <BecauseOf roles={chosen} extra={ownExtra} />
      <div className="small" style={{ marginTop: 4 }}>{tx(m('الأبواب:', 'Doors:', 'Portes :'))} {doorsLine(chosen, ownExtra, books.length > 0, !!d.inv)}</div>
      {hasKinds && (
        <details style={{ marginTop: 10 }}>
          <summary className="small">{tx(m('متقدّم: استثناءات على هذا الشخص', 'Advanced: exceptions on this person', 'Avancé : exceptions pour cette personne'))}{ownExtra.length > 0 ? ` (+${ownExtra.length})` : ''}</summary>
          <p className="muted small">{tx(m('علامة تُضاف لهذا الشخص وحده، فوق أدواره. دفتر المسؤول والمنح للمشرف فقط.', 'A tick added for this person only, on top of their roles. The Respo book and the grants are for the Administrator only.', 'Une case ajoutée pour cette personne seule, en plus de ses rôles. Le livre du Respo et les subventions sont pour l’Administrateur seul.'))}</p>
          {PERM_GROUPS.map((g) => (
            <div key={g.key} style={{ marginBottom: 6 }}>
              <b className="small">{tx(g.label)}</b>
              {g.perms.map((p) => {
                const byRole = fromRoles.has(p.key);
                const adminOnly = ADMIN_ONLY.includes(p.key);
                const notMine = !admin && !can(p.key);
                const noSelf = self && !extra.includes(p.key);
                return (
                  <label key={p.key} className="row small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', opacity: byRole || adminOnly || notMine || noSelf ? 0.55 : 1 }}>
                    <input type="checkbox" checked={byRole || extra.includes(p.key)} disabled={byRole || adminOnly || noSelf || (notMine && !extra.includes(p.key))} onChange={() => toggleExtra(p.key)} style={{ marginTop: 3 }} />
                    <span>{tx(p.label)}{byRole ? ` · ${tx(m('من دور', 'from a role', 'par un rôle'))}` : adminOnly ? ` · ${tx(m('للمشرف فقط', 'Administrator only', 'Administrateur seulement'))}` : ''}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </details>
      )}
      <h3 style={{ marginTop: 14 }}>{t('الدفاتر التي يحملها', 'Books this person keeps')}</h3>
      <div className="chips">
        {d.lists.books.filter((b) => b.active && (admin || !b.private || books.includes(b.id))).map((b) => (
          <button key={b.id} type="button" className={`chip ${books.includes(b.id) ? 'on' : ''}`} onClick={() => toggle(b.id)}>{b.name}</button>
        ))}
      </div>
      <p className="muted small">{tx(m('يكتب في هذه الدفاتر ويؤكّد ما يصلها ويغلق شهرها، إن كان أحد أدواره يحمل «الدفتر».', 'They write in these books, confirm what reaches them and close their month — if one of their roles has "Book".', 'La personne écrit dans ces caisses, confirme ce qui y arrive et clôt leur mois — si l’un de ses rôles a « Caisse ».'))}</p>
      {err && <div className="alert err">{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!name.trim()} onClick={save}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

export function PinModal({ p, onClose, onDone }: { p: Pick<Profile, 'id' | 'name'>; onClose: () => void; onDone?: () => void }) {
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

// ---------------------------------------------------------------- the roles page

/** What is only seen (reports, registers) and what changes something, for the tags of the roles matrix. */
const VIEW_PERMS = new Set<Perm>(['register.view', 'reports.summary', 'reports.monthly', 'reports.accounts', 'reports.exchange', 'reports.cash', 'reports.funding', 'budget.view', 'data.export', 'audit.view']);

/**
 * The roles page (roles step 3): the ready-made roles, one plain sentence each, how many people hold them, and "Make a copy
 * to adapt" (the copy is a Custom role). The Custom roles below. Every tick of every role folded under "Advanced".
 */
function AccessProfiles() {
  const { s, reload } = useApp();
  const admin = !!s.profile.admin;
  const [list, setList] = useState<AccessRow[]>([]);
  const [edit, setEdit] = useState<(Partial<AccessRow> & { copy?: boolean }) | null>(null);
  const refresh = () => s.api.call('access.list').then(setList);
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hasKinds = list.some((a) => a.kind);
  // (Fouad, 25 November 2026) the ticks of a role, the copies and the Custom roles are the Administrator's; the Director reads
  // the list and gives the roles (the server refuses the rest). A database not updated yet keeps the old page for its manager.
  const locked = (_a: AccessRow) => hasKinds && !admin;
  const copy = (a: AccessRow) => {
    const info = a.kind ? kindInfo(a.kind) : null;
    const name = info ? `${info.label.ar} (نسخة) · ${info.label.en} (copy)` : `${a.name} (2)`;
    setEdit({ name, perms: a.perms.filter((p) => !ADMIN_ONLY.includes(p)), copy: true });
  };
  const remove = async (a: AccessRow) => {
    if (!(await confirmBox(t(`حذف «${a.name}»؟`, `Delete "${a.name}"?`), true))) return;
    try {
      await s.api.call('access.delete', { id: a.id });
      await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const toggle = async (a: AccessRow, p: Perm) => {
    const perms = a.perms.includes(p) ? a.perms.filter((x) => x !== p) : [...a.perms, p];
    try {
      await s.api.call('access.save', { id: a.id, name: a.name, perms });
      await refresh();
      await reload();
      toast(t('حُفظ ✓', 'Saved ✓'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const ready = ROLE_KINDS.map((k) => list.find((a) => a.kind === k.kind)).filter((a): a is AccessRow => !!a);
  const custom = list.filter((a) => !a.kind);
  const peopleCount = (a: AccessRow) => tx(m(`الأشخاص: ${a.users}`, `${a.users} ${a.users === 1 ? 'person' : 'people'}`, `${a.users} personne${a.users === 1 ? '' : 's'}`));
  const matrix = (
    <>
      <p className="muted small">{tx(m('ماذا يستطيع كل دور: «اطّلاع» يعرض فقط، و«تعديل» يغيّر شيئاً. تغيير علامة يغيّر حقوق كل من يحمل الدور، عند دخوله التالي.', 'What each role may do. "View" only shows; "modify" changes something. A tick changes the rights of everybody who has the role, at their next sign-in.', 'Ce que chaque rôle peut faire. « Voir » montre seulement ; « modifier » change quelque chose. Une case change les droits de tous ceux qui ont le rôle, à leur prochaine connexion.'))}</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="t roles-matrix">
          <thead>
            <tr>
              <th />
              {list.map((a) => (
                <th key={a.id} className="c">
                  {roleName(a)}
                  {hasKinds && <div className="muted small">{a.kind ? tx(m('دور جاهز', 'ready-made', 'rôle prêt')) : tx(m('خاص', 'Custom', 'Personnalisé'))}</div>}
                  <div className="muted small">{peopleCount(a)}</div>
                  <div className="nowrap">
                    {!locked(a) && <button className="btn small ghost" onClick={() => setEdit(a)} title={t('الاسم وكل العلامات', 'Name and all ticks')}>✎</button>}
                    {a.users === 0 && !a.kind && <button className="btn small ghost" onClick={() => remove(a)}>✕</button>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERM_GROUPS.map((g) => [
              <tr key={g.key} className="group"><td colSpan={list.length + 1}><b>{tx(g.label)}</b></td></tr>,
              ...g.perms.map((p) => (
                <tr key={p.key}>
                  <td><span className={`role-pill ${VIEW_PERMS.has(p.key) ? 'view' : 'modify'}`}>{VIEW_PERMS.has(p.key) ? t('اطّلاع', 'View') : t('تعديل', 'Modify')}</span> {tx(p.label)}</td>
                  {list.map((a) => <td key={a.id} className="c"><input type="checkbox" checked={a.perms.includes(p.key)} disabled={locked(a)} onChange={() => toggle(a, p.key)} /></td>)}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
  const editDone = async () => { await refresh(); await reload(); };
  if (!hasKinds)
    return (
      <div className="panel">
        {matrix}
        <div className="modal-foot"><button className="btn primary" onClick={() => setEdit({ name: '', perms: [] })}>＋ {t('ملف صلاحيات', 'Permission profile')}</button></div>
        {edit && <AccessModal a={edit} onClose={() => setEdit(null)} onDone={editDone} />}
      </div>
    );
  return (
    <div className="panel">
      <p className="muted small">{tx(m('الأدوار الجاهزة. قد يحمل الشخص دوراً أو أكثر؛ كل دور يضيف فقط. تُعطى الأدوار من صفحة «الأشخاص».', 'The ready-made roles. A person may hold one or several; each role only adds. The roles are given on the page "People".', 'Les rôles prêts. Une personne peut en avoir un ou plusieurs ; chaque rôle ne fait qu’ajouter. Les rôles se donnent sur la page « Personnes ».'))}</p>
      {ready.map((a) => (
        <div key={a.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <b>{roleName(a)}</b>
            <span className="small muted">· {peopleCount(a)}</span>
          </div>
          <div className="small">{tx(kindInfo(a.kind)!.about)}</div>
        </div>
      ))}
      {custom.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>{tx(m('أدوار خاصة', 'Custom roles', 'Rôles personnalisés'))}</h3>
          {custom.map((a) => (
            <div key={a.id} className="row" style={{ gap: 8, alignItems: 'center', borderTop: '1px solid var(--line)', padding: '6px 0' }}>
              <b>{roleName(a)}</b>
              <span className="small muted">· {tx(m(`العلامات: ${a.perms.length}`, `${a.perms.length} ticks`, `${a.perms.length} cases`))} · {peopleCount(a)}</span>
              {admin && (
                <span className="nowrap" style={{ marginInlineStart: 'auto' }}>
                  <button className="btn small" onClick={() => setEdit(a)} title={t('الاسم وكل العلامات', 'Name and all ticks')}>✎</button>{' '}
                  <button className="btn small" onClick={() => copy(a)}>{tx(m('نسخة', 'Copy', 'Copier'))}</button>{' '}
                  {a.users === 0 && <button className="btn small ghost" onClick={() => remove(a)}>✕</button>}
                </span>
              )}
            </div>
          ))}
        </>
      )}
      {admin && (
        <details style={{ marginTop: 14 }}>
          <summary className="small">{tx(m('متقدّم (للمشرف): نسخة لتكييفها، وكل علامات كل الأدوار', 'Advanced (the Administrator): a copy to adapt, and every tick of every role', 'Avancé (l’Administrateur) : une copie à adapter, et toutes les cases de chaque rôle'))}</summary>
          <p className="small" style={{ marginTop: 8 }}>{tx(m('نسخة لتكييفها (تصير دوراً «خاصاً»):', 'Make a copy to adapt (it becomes a "Custom" role):', 'Faire une copie à adapter (elle devient un rôle « personnalisé ») :'))}</p>
          <div className="chips" style={{ marginBottom: 10 }}>
            {ready.map((a) => <button key={a.id} type="button" className="chip" onClick={() => copy(a)}>{roleName(a)}</button>)}
          </div>
          {matrix}
          <div className="modal-foot"><button className="btn" onClick={() => setEdit({ name: '', perms: [] })}>＋ {tx(m('دور خاص فارغ', 'Empty Custom role', 'Rôle personnalisé vide'))}</button></div>
        </details>
      )}
      {edit && <AccessModal a={edit} onClose={() => setEdit(null)} onDone={editDone} />}
    </div>
  );
}

function AccessModal({ a, onClose, onDone }: { a: Partial<AccessRow> & { copy?: boolean }; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useApp();
  const [name, setName] = useState(a.name ?? '');
  const [perms, setPerms] = useState<Perm[]>(a.perms ?? []);
  const [ready, setReady] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (p: Perm) => setPerms((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  return (
    <Modal title={a.id ? tx(m('تعديل دور', 'Change a role', 'Modifier un rôle')) : a.copy ? tx(m('نسخة لتكييفها', 'A copy to adapt', 'Une copie à adapter')) : tx(m('دور خاص جديد', 'New Custom role', 'Nouveau rôle personnalisé'))} onClose={onClose}>
      <Field label={t('الاسم', 'Name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {!a.id && !a.copy && (
        <div className="ready-roles" style={{ marginTop: 12 }}>
          <div className="small muted">{tx(m('ابدأ من دور جاهز (تبقى العلامات قابلة للتعديل):', 'Start from a ready-made role (the ticks stay yours to change):', 'Partir d’un rôle prêt (les cases restent à vous) :'))}</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
            {READY_ROLES.map((r) => (
              <button key={r.key} type="button" className={`btn small ${ready === r.key ? 'primary' : ''}`} onClick={() => { setReady(r.key); setName(r.name); setPerms(withImplied(r.perms)); }}>{biName(r.name)}</button>
            ))}
          </div>
          {ready && <div className="small">{tx(READY_ROLES.find((r) => r.key === ready)!.about)}</div>}
        </div>
      )}
      <div className="grid2" style={{ marginTop: 14 }}>
        {PERM_GROUPS.map((g) => (
          <div key={g.key} className="panel" style={{ padding: 12, marginBottom: 0 }}>
            <h3>{tx(g.label)}</h3>
            {g.perms.map((p) => (
              <label key={p.key} className="row" style={{ alignItems: 'flex-start', marginBottom: 6, flexWrap: 'nowrap' }}>
                <input type="checkbox" checked={perms.includes(p.key)} onChange={() => toggle(p.key)} style={{ marginTop: 3 }} />
                <span className="small">{tx(p.label)}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!name.trim()} onClick={async () => {
          try {
            await s.api.call('access.save', { id: a.id, name, perms });
            await onDone();
            onClose();
          } catch (e) {
            setErr(errText(e));
          }
        }}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

