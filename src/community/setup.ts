// Creating a community database: the chart of codes, the econome's books (cash,
// bank, account at the économat), the house book, and the people with their roles.
// Every community has a Superior, an econome and a minister; one person may hold
// several roles (Homs: Fouad econome and minister; Damascus: Alvaro Superior and econome).

import { type Db, type Stmt, migrate, nowIso, one } from '../db/db';
import { auditStmt, setMetaStmt } from '../db/repo';
import { profileStmt } from '../auth';
import type { Perm } from '../perms';
import { CHART } from './chart';

export type CtyRole = 'jesuit' | 'minister' | 'econome' | 'superior';

/** What each role may do. A person with several roles gets all their ticks. */
export const ROLE_PERMS: Record<CtyRole, Perm[]> = {
  jesuit: ['book.own'],
  minister: ['book.own'],
  econome: ['book.own', 'cty.view_all', 'cty.write_all', 'cty.limits', 'cty.chart', 'month.close', 'data.backup', 'data.export', 'data.import', 'audit.view'],
  superior: ['book.own', 'cty.view_all', 'cty.month_seen', 'month.reopen', 'users.manage', 'data.backup', 'data.restore', 'audit.view'],
};
export const ROLE_NAME: Record<CtyRole, string> = {
  jesuit: 'يسوعي · Jesuit · Jésuite',
  minister: 'الوزير · Minister · Ministre',
  econome: 'المدبّر · Econome · Économe',
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
}

/** The permission profile of a set of roles: found, or made once (e.g. "Superior · Econome"). */
async function accessFor(db: Db, roles: CtyRole[]): Promise<number> {
  const rs = ORDER.filter((r) => roles.includes(r));
  const name = rs.map((r) => ROLE_NAME[r]).join(' + ');
  const found = await one<{ id: number }>(db, 'SELECT id FROM access_profile WHERE name = ?', [name]);
  if (found) return found.id;
  const perms = [...new Set(rs.flatMap((r) => ROLE_PERMS[r]))];
  await db.batch([{ sql: 'INSERT INTO access_profile (name, perms, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM access_profile))', params: [name, JSON.stringify(perms)] }]);
  return (await one<{ id: number }>(db, 'SELECT id FROM access_profile WHERE name = ?', [name]))!.id;
}

export async function createCommunity(db: Db, s: CommunitySetup): Promise<void> {
  await migrate(db);
  if (await one(db, "SELECT 1 AS x FROM meta WHERE key = 'install'")) throw new Error('This database is already set up');
  const roles = s.people.flatMap((p) => p.roles);
  for (const r of ['superior', 'econome', 'minister'] as const) if (!roles.includes(r)) throw new Error(`The community needs a ${r}`);

  // The MAGIS centre profiles made by migration 2 mean nothing here: community profiles replace them.
  const stmts: Stmt[] = [
    { sql: 'DELETE FROM access_profile' },
    setMetaStmt('install', 'office'),
    setMetaStmt('kind', 'community'),
    setMetaStmt('organisation', s.community.trim()),
    setMetaStmt('country', s.country.trim()),
    setMetaStmt('local_currency', s.localCurrency.trim().toUpperCase()),
    setMetaStmt('created_at', nowIso()),
  ];
  // the chart of codes, in the order of the sheet
  CHART.forEach((a, i) => {
    stmts.push({
      sql: `INSERT INTO cty_account (code, parent_id, type, name_en, name_fr, name_ar, scope, claim, sort)
            VALUES (?, (SELECT id FROM cty_account WHERE code = ?), ?, ?, ?, ?, ?, ?, ?)`,
      params: [a.code, a.parent, a.type, a.en, a.fr, a.ar, a.scope, a.claim ?? null, i + 1],
    });
  });
  // the econome's books and the house book
  const shared: [string, string][] = [
    ['Cash · الصندوق · Caisse', 'cash'],
    ['Bank · المصرف · Banque', 'bank'],
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
      { sql: "INSERT INTO user_book (profile_id, book_id) SELECT (SELECT MAX(id) FROM profile), (SELECT MAX(id) FROM book WHERE cty_kind = 'personal')" },
      ...(p.roles.includes('minister') ? [{ sql: "INSERT INTO user_book (profile_id, book_id) SELECT (SELECT MAX(id) FROM profile), id FROM book WHERE cty_kind = 'house'" }] : []),
      ...(p.roles.includes('econome') ? [{ sql: "INSERT INTO user_book (profile_id, book_id) SELECT (SELECT MAX(id) FROM profile), id FROM book WHERE cty_kind IN ('cash', 'bank', 'economat')" }] : []),
    ]);
  }
  await db.batch([auditStmt('setup', 'create', 'meta', null, null, { kind: 'community', community: s.community, people: s.people.map((p) => ({ name: p.name, roles: p.roles })) })]);
}
