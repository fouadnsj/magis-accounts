// Browser preview only (npm run dev without the desktop shell): an in-memory
// SQLite (sql.js). Nothing is saved when the page closes.
import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { Db, Row, SqlValue, Stmt } from './db';

export async function webDb(): Promise<Db> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const sq: Database = new SQL.Database();
  sq.run('PRAGMA foreign_keys = ON');
  return {
    async query<T = Row>(sql: string, params: SqlValue[] = []) {
      const st = sq.prepare(sql);
      st.bind(params);
      const out: T[] = [];
      while (st.step()) out.push(st.getAsObject() as T);
      st.free();
      return out;
    },
    async batch(stmts: Stmt[]) {
      sq.run('BEGIN');
      try {
        for (const s of stmts) sq.run(s.sql, s.params ?? []);
        sq.run('COMMIT');
      } catch (e) {
        sq.run('ROLLBACK');
        throw e;
      }
    },
  };
}
