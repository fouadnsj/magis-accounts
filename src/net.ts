// The screens talking to the centre's server over the local network.
// The server identifies the person by a session cookie; it never trusts
// the screen for permissions.
import type { Api } from './ops';
import type { Profile } from './auth';
import type { Msg } from './i18n';

export interface Hello {
  server: true;
  organisation: string;
  setupNeeded: boolean;
  /** true when the page is opened on the server computer itself */
  local: boolean;
  version: string;
}

/** Thrown with the server's bilingual message, so screens show it like any other refusal. */
export class ServerError extends Error {
  constructor(public msg: Msg) {
    super(msg.en);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event('magis-logged-out'));
    throw new ServerError(j.error ?? { ar: `خطأ ${r.status}`, en: `Error ${r.status}` });
  }
  return j as T;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event('magis-logged-out'));
    throw new ServerError(j.error ?? { ar: `خطأ ${r.status}`, en: `Error ${r.status}` });
  }
  return j as T;
}

/** Is this page served by a MAGIS server? (null = no: desktop or browser preview) */
export async function hello(): Promise<Hello | null> {
  try {
    const r = await fetch('/api/hello', { credentials: 'same-origin' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.server ? (j as Hello) : null;
  } catch {
    return null;
  }
}

export const serverProfiles = () => get<{ id: number; name: string; role: Profile['role']; access_name: string }[]>('/api/profiles');

export const serverLogin = (profileId: number, password: string) =>
  post<{ profile: Profile; mustChange: boolean; install: 'office' }>('/api/login', { profileId, password });

export const serverLogout = () => post('/api/logout', {}).catch(() => undefined);

/** Already logged in (cookie still valid)? */
export const serverMe = () => get<{ profile: Profile; mustChange: boolean } | null>('/api/me').catch(() => null);

export const serverVersion = async () => (await get<{ v: number }>('/api/version')).v;

export const httpApi: Api = {
  call: (name, args) => post(`/api/op/${encodeURIComponent(name)}`, args ?? {}) as never,
};

export const serverStatus = <T,>() => get<T>('/api/server/status');
export const serverConfig = (c: Record<string, unknown>) => post('/api/server/config', c);
export const serverRestoreUpload = (base64: string, fileName: string) => post('/api/server/restore-upload', { base64, fileName });
