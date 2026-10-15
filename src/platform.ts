// Files and dialogs. In the desktop app they go through Tauri; in the browser
// preview they fall back to <input type=file> and downloads.
import { invoke } from '@tauri-apps/api/core';

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface Picked {
  name: string;
  path: string | null;
  bytes: Uint8Array;
}

export async function pickFile(extensions: string[], title: string): Promise<Picked | null> {
  if (isDesktop()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ title, multiple: false, filters: [{ name: extensions.join(', '), extensions }] });
    if (!path || Array.isArray(path)) return null;
    const buf = await invoke<ArrayBuffer>('file_read', { path });
    return { name: baseName(path), path, bytes: new Uint8Array(buf) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    input.click();
  });
}

/** Asks where to save, then writes. Returns the path (or the name in the browser), null if cancelled. */
export async function saveFile(defaultName: string, extensions: string[], bytes: Uint8Array, title: string): Promise<string | null> {
  if (isDesktop()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const docs = await invoke<string>('documents_dir').catch(() => '');
    const path = await save({ title, defaultPath: docs ? `${docs}/${defaultName}` : defaultName, filters: [{ name: extensions.join(', '), extensions }] });
    if (!path) return null;
    await invoke('file_write_b64', { path, data: toBase64(bytes) });
    return path;
  }
  const blob = new Blob([bytes]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return defaultName;
}

/** Asks for a NEW database file location (desktop only). */
export async function pickNewDbPath(defaultName: string, title: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const docs = await invoke<string>('documents_dir').catch(() => '');
  return (await save({ title, defaultPath: docs ? `${docs}/${defaultName}` : defaultName, filters: [{ name: 'Database', extensions: ['db'] }] })) ?? null;
}

export async function pickExistingDbPath(title: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const p = await open({ title, multiple: false, filters: [{ name: 'Database', extensions: ['db'] }] });
  return !p || Array.isArray(p) ? null : p;
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function dirName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? '.' : p.slice(0, i);
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export interface LocalConfig {
  dbPath?: string;
  recent?: string[];
  /** the centre's server this app opens on (desktop app used on the network) */
  server?: { address: string; fingerprint: string } | null;
}

export async function getConfig(): Promise<LocalConfig> {
  if (!isDesktop()) return {};
  return invoke<LocalConfig>('config_get');
}

export async function setConfig(c: LocalConfig): Promise<void> {
  if (isDesktop()) await invoke('config_set', { value: c });
}
