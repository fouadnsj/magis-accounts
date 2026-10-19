// Reading and writing the community tables (no permission checks here: see ops.ts).
import type { Db, Stmt } from '../db/db';
import { noLimits, type CtyAccount, type CtyBook, type CtyEntry, type Limits } from './domain';
import type { CtyMonth, CtyNote } from './ops';

export const loadAccounts = (db: Db) => db.query<CtyAccount>('SELECT * FROM cty_account ORDER BY sort, code');
export const loadBooks = (db: Db) =>
  db.query<CtyBook>('SELECT id, name, keeper_name, cty_kind, opening_syp, opening_usd, opening_eur, active FROM book WHERE cty_kind IS NOT NULL ORDER BY sort, id');
export const loadEntries = (db: Db) => db.query<CtyEntry>('SELECT * FROM cty_entry ORDER BY date, n');
export const loadMonths = (db: Db) => db.query<CtyMonth>('SELECT * FROM cty_month');
export const loadNotes = (db: Db) => db.query<CtyNote>('SELECT * FROM cty_note ORDER BY created_at');

const LIMIT_KEY = (book: 'house' | 'personal') => `cty_limit_${book}_usd`;
export async function loadLimits(db: Db): Promise<Limits> {
  const rows = await db.query<{ key: string; value: string | null }>("SELECT key, value FROM setting WHERE key LIKE 'cty_limit_%'");
  const l = noLimits();
  for (const book of ['house', 'personal'] as const) l[book] = Number(rows.find((r) => r.key === LIMIT_KEY(book))?.value ?? 0) || 0;
  l.startRate = Number(rows.find((r) => r.key === 'cty_limit_start_rate')?.value ?? 0) || 0;
  return l;
}
export const saveLimitsStmts = (l: Limits): Stmt[] =>
  ([[LIMIT_KEY('house'), l.house], [LIMIT_KEY('personal'), l.personal], ['cty_limit_start_rate', l.startRate]] as const).map(([key, v]) => ({
    sql: 'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    params: [key, String(Math.max(0, Number(v) || 0))],
  }));

const COLS = ['id', 'n', 'book_id', 'date', 'type', 'account_id', 'cur', 'amount', 'cur2', 'amount2', 'to_book_id', 'note', 'claim', 'claim_note',
  'received_at', 'received_by', 'disputed_at', 'dispute_note', 'source', 'approval_needed', 'approval_usd', 'approved_at', 'approved_by', 'refused_at', 'refused_by', 'refused_note', 'created_at', 'created_by', 'updated_at'] as const;

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

