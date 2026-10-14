// The real app: SQL runs in Rust (src-tauri/src/lib.rs).
import { invoke } from '@tauri-apps/api/core';
import type { Db, Row, SqlValue, Stmt } from './db';

export const tauriDb: Db = {
  query: <T = Row>(sql: string, params: SqlValue[] = []) => invoke<T[]>('db_query', { sql, params }),
  batch: (stmts: Stmt[]) => invoke<void>('db_batch', { stmts: stmts.map((s) => ({ sql: s.sql, params: s.params ?? [] })) }),
};
