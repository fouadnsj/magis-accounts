// The Db interface on Node's built-in SQLite, for automatic tests only.
import { createRequire } from 'node:module';
import type { Db, Row, SqlValue, Stmt } from '../src/db/db';

// Loaded at run time: the test bundler does not know the new node:sqlite module.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

export function nodeDb(path = ':memory:'): Db {
  const sq = new DatabaseSync(path);
  sq.exec('PRAGMA foreign_keys = ON');
  return {
    async query<T = Row>(sql: string, params: SqlValue[] = []) {
      return sq.prepare(sql).all(...params) as T[];
    },
    async batch(stmts: Stmt[]) {
      sq.exec('BEGIN');
      try {
        for (const s of stmts) sq.prepare(s.sql).run(...(s.params ?? []));
        sq.exec('COMMIT');
      } catch (e) {
        sq.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
