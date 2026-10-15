// Automatic backups, next to the database in a "backups" folder:
// one copy per day when the app opens, and one before every import or restore.
import { invoke } from '@tauri-apps/api/core';
import { baseName, dirName, isDesktop, toBase64 } from '../platform';

const KEEP_DAILY = 60;

export function backupDir(dbPath: string) {
  return `${dirName(dbPath)}/backups`;
}

const stamp = (withTime: boolean) => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${day}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` : day;
};

export interface BackupFile {
  name: string;
  path: string;
  size: number;
  modified: number;
}

export async function listBackups(dbPath: string): Promise<BackupFile[]> {
  if (!isDesktop()) return [];
  return invoke<BackupFile[]>('dir_list', { path: backupDir(dbPath) });
}

export async function backupNow(dbPath: string, reason: string): Promise<string | null> {
  if (!isDesktop()) return null;
  const base = baseName(dbPath).replace(/\.db$/i, '');
  const dest = `${backupDir(dbPath)}/${base}_${stamp(true)}_${reason}.db`;
  await invoke('db_backup', { dest });
  return dest;
}

/** Once a day, on opening. Old daily copies beyond KEEP_DAILY are removed. */
export async function dailyBackup(dbPath: string): Promise<void> {
  if (!isDesktop()) return;
  const base = baseName(dbPath).replace(/\.db$/i, '');
  const dest = `${backupDir(dbPath)}/${base}_${stamp(false)}_daily.db`;
  if (await invoke<boolean>('file_exists', { path: dest })) return;
  await invoke('db_backup', { dest });
  const daily = (await listBackups(dbPath)).filter((b) => b.name.endsWith('_daily.db'));
  for (const old of daily.slice(KEEP_DAILY)) await invoke('file_delete', { path: old.path }).catch(() => undefined);
}

export async function restoreBackup(dbPath: string, from: string): Promise<void> {
  const base = baseName(dbPath).replace(/\.db$/i, '');
  const safety = `${backupDir(dbPath)}/${base}_${stamp(true)}_before-restore.db`;
  await invoke('db_restore', { from, safetyCopy: safety });
}

/** The desktop app's way of making backups and keeping documents, as the operations expect it. */
export function desktopFiles(dbPath: string | null): import('../ops').FileOps {
  if (!dbPath || !isDesktop()) {
    // browser preview: documents live in memory only
    const mem = new Map<string, Uint8Array>();
    return {
      backupNow: async () => null, list: async () => [], restore: async () => undefined,
      docWrite: async (rel, bytes) => void mem.set(rel, bytes),
      docRead: async (rel) => mem.get(rel) ?? new Uint8Array(),
      docExists: async (rel) => mem.has(rel),
    };
  }
  // Documents in a folder next to the database: <name>-attachments/<year>/<Bill_Code>.pdf
  const docs = `${dirName(dbPath)}/${baseName(dbPath).replace(/\.db$/i, '')}-attachments`;
  return {
    backupNow: (reason) => backupNow(dbPath, reason),
    list: () => listBackups(dbPath),
    restore: (path) => restoreBackup(dbPath, path),
    docWrite: (rel, bytes) => invoke('file_write_b64', { path: `${docs}/${rel}`, data: toBase64(bytes) }),
    docRead: async (rel) => new Uint8Array(await invoke<ArrayBuffer>('file_read', { path: `${docs}/${rel}` })),
    docExists: (rel) => invoke<boolean>('file_exists', { path: `${docs}/${rel}` }),
  };
}
