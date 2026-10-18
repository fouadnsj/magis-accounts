// Creating a community database: the chart of codes, the econome's books (cash,
// bank, account at the économat), the house book, and the people with their roles.
// Every community has a Superior, an econome and a minister; one person may hold
// several roles (Homs: Fouad econome and minister; Damascus: Alvaro Superior and econome).

import { type Db, type Stmt, migrate, nowIso, one } from '../db/db';
import { auditStmt, setMetaStmt, UserError } from '../db/repo';
import { m } from '../i18n';
import { profileStmt } from '../auth';
import type { Perm } from '../perms';
import { CHART } from './chart';
import { DEFAULT_LIMITS } from './domain';
import { saveLimitsStmts } from './repo';

export type CtyRole = 'jesuit' | 'minister' | 'econome' | 'superior';

/** What each role may do. A person with several roles gets all their ticks. */
export const ROLE_PERMS: Record<CtyRole, Perm[]> = {
  jesuit: ['book.own'],
  minister: ['book.own'],
  // the chart of codes is kept by the country econome (cty.chart stays for a community that would need it)
  econome: ['book.own', 'cty.view_all', 'cty.write_all', 'cty.limits', 'month.close', 'data.backup', 'data.export', 'data.import', 'audit.view'],
  superior: ['book.own', 'cty.view_all', 'cty.month_seen', 'month.reopen', 'users.manage', 'data.backup', 'data.restore', 'audit.view'],
};
export const ROLE_NAME: Record<CtyRole, string> = {
  jesuit: 'يسوعي · Jesuit · Jésuite',
  minister: 'المدبّر · Minister · Ministre',
  econome: 'القيّم · Econome · Économe',
  superior: 'الرئيس · Superior · Supérieur',
};
const ORDER: CtyRole[] = ['superior', 'econome', 'minister', 'jesuit'];

export interface CtyPerson {
  name: string;
  password: string;
  roles: CtyRole[];
}

export interface CommunitySetup {
  /** e.g. "St Jean-François Régis – Homs" */
  community: string;
  country: string;
  /** the local currency, e.g. SYP */
  localCurrency: string;
  people: CtyPerson[];
  /** each person changes his password at the first sign-in (default yes; the browser demo says no) */
  mustChange?: boolean;
  /** the community has a bank account (default no: in Syria there is usually none) */
  hasBank?: boolean;
}

/** The permission profile of a set of roles: found, or made once (e.g. "Superior · Econome"). */
export async function accessFor(db: Db, roles: CtyRole[]): Promise<number> {
  const rs = ORDER.filter((r) => roles.includes(r));
  const name = rs.map((r) => ROLE_NAME[r]).join(' + ');
  const found = await one<{ id: number }>(db, 'SELECT id FROM access_profile WHERE name = ?', [name]);
  if (found) return found.id;
  const perms = [...new Set(rs.flatMap((r) => ROLE_PERMS[r]))];
  await db.batch([{ sql: 'INSERT INTO access_profile (name, perms, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM access_profile))', params: [name, JSON.stringify(perms)] }]);
  return (await one<{ id: number }>(db, 'SELECT id FROM access_profile WHERE name = ?', [name]))!.id;
}

/** The chart of codes as it starts (compt1 with Fouad's corrections), in the order of the sheet. */
export function chartSeedStmts(): Stmt[] {
  return CHART.map((a, i) => ({
    sql: `INSERT INTO cty_account (uid, code, parent_id, type, name_en, name_fr, name_ar, scope, claim, sort)
          VALUES (?, ?, (SELECT id FROM cty_account WHERE code = ?), ?, ?, ?, ?, ?, ?, ?)`,
    params: [`c${a.code}`, a.code, a.parent, a.type, a.en, a.fr, a.ar, a.scope, a.claim ?? null, i + 1],
  }));
}

export async function createCommunity(db: Db, s: CommunitySetup): Promise<void> {
  await migrate(db);
  // (a database made on the server already has its name and "install": it is new while nobody is in it)
  if (await one(db, 'SELECT 1 AS x FROM profile LIMIT 1')) throw new UserError(m('قاعدة البيانات مُعدّة مسبقاً', 'This database is already set up', 'Cette base est déjà préparée'));
  if (!s.community.trim()) throw new UserError(m('اكتب اسم الجماعة', 'Write the name of the community', 'Écrivez le nom de la communauté'));
  const names = s.people.map((p) => p.name.trim().toLowerCase());
  if (names.some((n) => !n) || new Set(names).size !== names.length) throw new UserError(m('لكل شخص اسم مختلف', 'Each person needs a different name', 'Chaque personne a besoin d\u2019un nom différent'));
  const roles = s.people.flatMap((p) => p.roles);
  const need: [CtyRole, ReturnType<typeof m>][] = [
    ['superior', m('من هو الرئيس؟', 'Who is the Superior?', 'Qui est le Supérieur ?')],
    ['econome', m('من هو القيّم؟', 'Who is the econome?', "Qui est l'économe ?")],
    ['minister', m('من هو المدبّر؟', 'Who is the minister?', 'Qui est le ministre ?')],
  ];
  for (const [r, msg] of need) if (!roles.includes(r)) throw new UserError(msg);

  // The MAGIS centre profiles made by migration 2 mean nothing here: community profiles replace them.
  const stmts: Stmt[] = [
    { sql: 'DELETE FROM access_profile' },
    setMetaStmt('install', 'office'),
    setMetaStmt('kind', 'community'),
    setMetaStmt('organisation', s.community.trim()),
    setMetaStmt('country', s.country.trim()),
    setMetaStmt('local_currency', s.localCurrency.trim().toUpperCase()),
    // the community's identity in its files to the country econome
    setMetaStmt('cty_uid', crypto.randomUUID()),
    setMetaStmt('created_at', nowIso()),
    // the limits Fouad gave (18 October 2026); the econome changes them
    ...saveLimitsStmts(DEFAULT_LIMITS),
    { sql: "INSERT INTO setting (key, value) VALUES ('cty_has_bank', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params: [s.hasBank ? '1' : '0'] },
  ];
  // the chart of codes (the country econome's one replaces it with the first return file)
  stmts.push(...chartSeedStmts());
  // the econome's books and the house book
  const shared: [string, string][] = [
    ['Cash · الصندوق · Caisse', 'cash'],
    ...(s.hasBank ? ([['Bank · المصرف · Banque', 'bank']] as [string, string][]) : []),
    ['Économat · الإيكونوماتو · Économat', 'economat'],
    ['House · البيت · Maison', 'house'],
  ];
  shared.forEach(([name, kind], i) => stmts.push({ sql: 'INSERT INTO book (name, cty_kind, is_main, sort) VALUES (?, ?, 0, ?)', params: [name, kind, i + 1] }));
  await db.batch(stmts);

  // the people: each has his personal book; the minister also keeps the house book,
  // the econome the cash, the bank and the account at the économat
  for (const [i, p] of s.people.entries()) {
    const access = await accessFor(db, p.roles.length ? p.roles : ['jesuit']);
    const role = p.roles.includes('superior') ? 'sup' : p.roles.includes('econome') ? 'com' : 'holder';
    await db.batch([
      { sql: 'INSERT INTO book (name, keeper_name, cty_kind, is_main, sort) VALUES (?, ?, ?, 0, ?)', params: [p.name.trim(), p.name.trim(), 'personal', 10 + i] },
      await profileStmt({ name: p.name, role, pin: p.password, access_id: access }),
      { sql: 'UPDATE profile SET cty_roles = ? WHERE id = (SELECT MAX(id) FROM profile)', params: [JSON.stringify(p.roles)] },
      ...(s.mustChange !== false ? [{ sql: 'UPDATE profile SET must_change = 1 WHERE id = (SELECT MAX(id) FROM profile)' }] : []),
      { sql: "INSERT INTO user_book (profile_id, book_id) SELECT (SELECT MAX(id) FROM profile), (SELECT MAX(id) FROM book WHERE cty_kind = 'personal')" },
      ...(p.roles.includes('minister') ? [{ sql: "INSERT INTO user_book (profile_id, book_id) SELECT (SELECT MAX(id) FROM profile), id FROM book WHERE cty_kind = 'house'" }] : []),
      ...(p.roles.includes('econome') ? [{ sql: "INSERT INTO user_book (profile_id, book_id) SELECT (SELECT MAX(id) FROM profile), id FROM book WHERE cty_kind IN ('cash', 'bank', 'economat')" }] : []),
    ]);
  }
  await db.batch([auditStmt('setup', 'create', 'meta', null, null, { kind: 'community', community: s.community, people: s.people.map((p) => ({ name: p.name, roles: p.roles })) })]);
}
