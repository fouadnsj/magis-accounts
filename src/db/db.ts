// One small interface between the app and SQLite. Three implementations:
// - Tauri (the real app): SQL runs in Rust, every batch in one transaction;
// - sql.js (browser preview while building);
// - node:sqlite (automatic tests).
// All the accounting logic is written once, above this interface.

import { MIGRATIONS } from './migrations';

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;
export interface Stmt {
  sql: string;
  params?: SqlValue[];
}

export interface Db {
  query<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Runs every statement in ONE transaction: all succeed or nothing is written. */
  batch(stmts: Stmt[]): Promise<void>;
}

export async function one<T = Row>(db: Db, sql: string, params?: SqlValue[]): Promise<T | undefined> {
  const rows = await db.query<T>(sql, params);
  return rows[0];
}

export async function migrate(db: Db): Promise<number[]> {
  await db.batch([
    { sql: 'CREATE TABLE IF NOT EXISTS schema_migration (n INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)' },
  ]);
  const done = new Set((await db.query<{ n: number }>('SELECT n FROM schema_migration')).map((r) => r.n));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.n)) continue;
    const stmts: Stmt[] = splitSql(m.sql).map((sql) => ({ sql }));
    stmts.push({
      sql: 'INSERT INTO schema_migration (n, name, applied_at) VALUES (?, ?, ?)',
      params: [m.n, m.name, new Date().toISOString()],
    });
    await db.batch(stmts);
    applied.push(m.n);
  }
  return applied;
}

/** Splits a migration into statements. Comments are removed first, because a
 *  comment may hold a semicolon (no "--" or ";" inside our string literals). */
export function splitSql(sql: string): string[] {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}
