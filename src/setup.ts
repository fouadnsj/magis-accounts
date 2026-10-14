// Creating a database: an office one (Sup + Com) or a holder's one.
import { type Db, migrate, nowIso } from './db/db';
import { auditStmt, setMetaStmt, setSettingStmt } from './db/repo';
import { profileStmt } from './auth';
import { applyListsPackage, type ListsPackage } from './io/keeperFiles';

export interface OfficeSetup {
  organisation: string;
  supName: string;
  supPin: string;
  comName: string;
  comPin: string;
}

export async function createOffice(db: Db, o: OfficeSetup): Promise<void> {
  await migrate(db);
  await db.batch([
    setMetaStmt('install', 'office'),
    setMetaStmt('organisation', o.organisation.trim()),
    setMetaStmt('created_at', nowIso()),
    // The main fund always exists: "Main" is a word, never a blank.
    { sql: 'INSERT INTO book (name, is_main, sort) VALUES (?, 1, 0)', params: ['Main'] },
    setSettingStmt('usd_rate', 130),
    setSettingStmt('exchange_tolerance', 0.25),
    await profileStmt({ name: o.supName.trim(), role: 'sup', pin: o.supPin }),
    await profileStmt({ name: o.comName.trim(), role: 'com', pin: o.comPin }),
    auditStmt('setup', 'create', 'meta', null, null, { organisation: o.organisation }),
  ]);
}

export async function createHolder(db: Db, pkg: ListsPackage, bookId: number, name: string, pin: string): Promise<void> {
  await migrate(db);
  await applyListsPackage(db, pkg, name);
  await db.batch([
    setMetaStmt('install', 'holder'),
    setMetaStmt('holder_book_id', String(bookId)),
    setMetaStmt('created_at', nowIso()),
    await profileStmt({ name: name.trim(), role: 'holder', pin, book_id: bookId }),
    { sql: 'INSERT INTO user_book (profile_id, book_id) SELECT MAX(id), ? FROM profile', params: [bookId] },
    auditStmt(name, 'create', 'meta', null, null, { install: 'holder', bookId }),
  ]);
}
