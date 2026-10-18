// Reading and writing the community tables (no permission checks here: see ops.ts).
import type { Db, Stmt } from '../db/db';
import type { CtyAccount, CtyBook, CtyEntry } from './domain';
import type { CtyMonth } from './ops';

export const loadAccounts = (db: Db) => db.query<CtyAccount>('SELECT * FROM cty_account ORDER BY sort, code');
export const loadBooks = (db: Db) =>
  db.query<CtyBook>('SELECT id, name, keeper_name, cty_kind, opening_syp, opening_usd, opening_eur, active FROM book WHERE cty_kind IS NOT NULL ORDER BY sort, id');
export const loadEntries = (db: Db) => db.query<CtyEntry>('SELECT * FROM cty_entry ORDER BY date, n');
export const loadMonths = (db: Db) => db.query<CtyMonth>('SELECT * FROM cty_month');

const COLS = ['id', 'n', 'book_id', 'date', 'type', 'account_id', 'cur', 'amount', 'cur2', 'amount2', 'to_book_id', 'note', 'claim', 'claim_note',
  'received_at', 'received_by', 'disputed_at', 'dispute_note', 'source', 'created_at', 'created_by', 'updated_at'] as const;

/** Insert (a new number, the next one) or replace an entry. */
export function writeEntryStmts(row: CtyEntry, isNew: boolean, opts: { orIgnore?: boolean } = {}): Stmt[] {
  if (!isNew) {
    const set = COLS.filter((k) => k !== 'id' && k !== 'n').map((k) => `${k} = ?`).join(', ');
    return [{ sql: `UPDATE cty_entry SET ${set} WHERE id = ?`, params: [...COLS.filter((k) => k !== 'id' && k !== 'n').map((k) => row[k]), row.id] }];
  }
  const cols = COLS.filter((k) => k !== 'n');
  return [{
    sql: `INSERT ${opts.orIgnore ? 'OR IGNORE ' : ''}INTO cty_entry (n, ${cols.join(', ')}) VALUES ((SELECT COALESCE(MAX(n), 0) + 1 FROM cty_entry), ${cols.map(() => '?').join(', ')})`,
    params: cols.map((k) => row[k]),
  }];
}

