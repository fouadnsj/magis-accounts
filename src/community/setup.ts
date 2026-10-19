// Creating a community database (Fouad, 19 October 2026):
//  - every Jesuit has a PERSONAL account (his pocket, and his bank if he has one), the Superior
//    and the other office-holders included; it never changes;
//  - four OFFICES are accounts of their own, each with its password, held by a person:
//      Superior     sees everything, approves or refuses, comments; changes nothing;
//      Econome      sees everything; works only in his books (cash, bank, économat);
//      Minister     keeps the house and its envelopes;
//      Administrator manages accounts, passwords, permissions, settings; sees no record.
//  - the chart of codes (the country econome's one replaces it with his first return file).

import { type Db, type Stmt, migrate, nowIso, one } from '../db/db';
import { auditStmt, setMetaStmt, UserError } from '../db/repo';
import { m } from '../i18n';
import { profileStmt } from '../auth';
import type { Perm } from '../perms';
import { CHART } from './chart';
import { DEFAULT_LIMITS } from './domain';
import { saveLimitsStmts } from './repo';
import { styleStmts, type StyleInput } from './style';
import { OFFICES, OFFICE_SHORT, officeBooksStmts, type Office } from './people';

/** What each kind of account may do, as permission ticks. The administrator edits them on the roles page. */
export const OFFICE_PERMS: Record<Office | 'jesuit', Perm[]> = {
  jesuit: ['book.own'],
  minister: ['book.own'],
  econome: ['book.own', 'cty.view_all', 'cty.limits', 'cty.passwords', 'month.close', 'data.export', 'data.import', 'audit.view'],
  superior: ['cty.view_all', 'cty.month_seen', 'month.reopen', 'audit.view'],
  admin: ['users.manage', 'cty.passwords', 'cty.limits', 'data.backup', 'data.restore'],
};
export const ACCESS_NAME: Record<Office | 'jesuit', string> = {
  superior: 'الرئيس · Superior · Supérieur',
  econome: 'القيم · Econome · Économe',
  minister: 'المدبر · Minister · Ministre',
  admin: 'المشرف · Administrator · Administrateur',
  jesuit: 'يسوعي · Jesuit · Jésuite',
};
const ACCESS_ORDER: (Office | 'jesuit')[] = ['superior', 'econome', 'minister', 'admin', 'jesuit'];

export interface CtyPerson {
  name: string;
  password: string;
  /** has a bank account of his own */
  hasBank?: boolean;
}
export interface OfficeSetup {
  /** the name of the person who holds it (one of the Jesuits, or anyone for the administrator) */
  heldBy: string;
  password: string;
}

export interface CommunitySetup {
  /** e.g. "St Jean-François Régis – Homs" */
  community: string;
  country: string;
  /** the local currency, e.g. SYP */
  localCurrency: string;
  people: CtyPerson[];
  offices: Record<Office, OfficeSetup>;
  /** each account changes its password at the first sign-in (default yes; the browser demo says no) */
  mustChange?: boolean;
  /** the community has a bank account (default no: in Syria there is usually none) */
  hasBank?: boolean;
  /** its colour or set of colours, its address and city (Fouad, 19 October 2026) */
  style?: StyleInput;
  /** the communities' password, chosen with the first community (kept by the server or this computer, not here) */
  gate?: string;
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
  if (!names.length) throw new UserError(m('أضف يسوعياً واحداً على الأقل', 'Add at least one Jesuit', 'Ajoutez au moins un jésuite'));
  if (names.some((n) => !n) || new Set(names).size !== names.length) throw new UserError(m('لكل شخص اسم مختلف', 'Each person needs a different name', 'Chaque personne a besoin d’un nom différent'));
  const asked: Record<Office, ReturnType<typeof m>> = {
    superior: m('من هو الرئيس؟', 'Who is the Superior?', 'Qui est le Supérieur ?'),
    econome: m('من هو القيم؟', 'Who is the econome?', "Qui est l'économe ?"),
    minister: m('من هو المدبر؟', 'Who is the minister?', 'Qui est le ministre ?'),
    admin: m('من هو المشرف؟', 'Who is the administrator?', "Qui est l'administrateur ?"),
  };
  for (const o of OFFICES) if (!(s.offices?.[o]?.heldBy ?? '').trim()) throw new UserError(asked[o]);

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
    ...(s.style ? styleStmts(s.style) : []),
    // the limits Fouad gave (18 October 2026); the econome changes them
    ...saveLimitsStmts(DEFAULT_LIMITS),
    { sql: "INSERT INTO setting (key, value) VALUES ('cty_has_bank', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params: [s.hasBank ? '1' : '0'] },
  ];
  // the chart of codes (the country econome's one replaces it with the first return file)
  stmts.push(...chartSeedStmts());
  // the permission profiles: one per kind of account, editable on the roles page
  ACCESS_ORDER.forEach((k, i) => stmts.push({ sql: 'INSERT INTO access_profile (id, name, perms, sort) VALUES (?, ?, ?, ?)', params: [i + 1, ACCESS_NAME[k], JSON.stringify(OFFICE_PERMS[k]), i + 1] }));
  // the community's books: the house, the econome's cash, bank (if any) and account at the économat
  const shared: [string, string][] = [
    ['Cash · الصندوق · Caisse', 'cash'],
    ...(s.hasBank ? ([['Bank · المصرف · Banque', 'bank']] as [string, string][]) : []),
    ['Économat · الإيكونوماتو · Économat', 'economat'],
    ['House · البيت · Maison', 'house'],
  ];
  shared.forEach(([name, kind], i) => stmts.push({ sql: 'INSERT INTO book (name, cty_kind, is_main, sort) VALUES (?, ?, 0, ?)', params: [name, kind, i + 1] }));
  await db.batch(stmts);

  const forceChange = s.mustChange !== false;
  // the offices: each an account of its own, held by a person
  for (const o of OFFICES) {
    const { heldBy, password } = s.offices[o];
    const role = o === 'superior' ? 'sup' : o === 'econome' ? 'com' : 'holder';
    await db.batch([
      await profileStmt({ name: `${OFFICE_SHORT[o]} (${heldBy.trim()})`, role, pin: password, access_id: ACCESS_ORDER.indexOf(o) + 1 }),
      { sql: 'UPDATE profile SET cty_office = ?, held_by = ?, must_change = ? WHERE id = (SELECT MAX(id) FROM profile)', params: [o, heldBy.trim(), forceChange ? 1 : 0] },
    ]);
  }
  // the Jesuits: each his personal account (his pocket, and his bank if he has one)
  const jesuitAccess = ACCESS_ORDER.indexOf('jesuit') + 1;
  for (const [i, p] of s.people.entries()) {
    await db.batch([
      { sql: 'INSERT INTO book (name, keeper_name, cty_kind, is_main, sort) VALUES (?, ?, ?, 0, ?)', params: [p.name.trim(), p.name.trim(), 'personal', 10 + i * 2] },
      await profileStmt({ name: p.name, role: 'holder', pin: p.password, access_id: jesuitAccess }),
      { sql: 'UPDATE profile SET must_change = ? WHERE id = (SELECT MAX(id) FROM profile)', params: [forceChange ? 1 : 0] },
      { sql: "INSERT INTO user_book (profile_id, book_id) SELECT (SELECT MAX(id) FROM profile), (SELECT MAX(id) FROM book WHERE cty_kind = 'personal')" },
      ...(p.hasBank ? [
        { sql: "INSERT INTO book (name, keeper_name, cty_kind, is_main, sort) VALUES (?, ?, 'personal_bank', 0, ?)", params: [`${p.name.trim()} · bank`, p.name.trim(), 11 + i * 2] },
        { sql: "INSERT INTO user_book (profile_id, book_id) SELECT (SELECT MAX(id) FROM profile), (SELECT MAX(id) FROM book WHERE cty_kind = 'personal_bank')" },
      ] : []),
    ]);
  }
  // the shared books go to their offices
  await db.batch([...(await officeBooksStmts(db)), auditStmt('setup', 'create', 'meta', null, null, { kind: 'community', community: s.community, people: s.people.map((p) => p.name), offices: Object.fromEntries(OFFICES.map((o) => [o, s.offices[o].heldBy])) })]);
}
