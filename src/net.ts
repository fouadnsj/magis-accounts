// The screens talking to the centre's server over the local network.
// The server identifies the person by a session cookie; it never trusts
// the screen for permissions.
import type { Api } from './ops';
import type { LoginPerson, Profile } from './auth';
import type { Msg } from './i18n';

export interface DbInfo {
  slug: string;
  organisation: string;
  centre: string;
  color?: string | null;
  logo?: string | null;
  /** a community's set of colours (JSON) and its city */
  palette?: string | null;
  city?: string | null;
  setupNeeded: boolean;
  /** 'community' for a Jesuit community's accounts */
  kind?: string;
}

export interface DirInfo { on: boolean; enforced: boolean; person: { name: string; admin: boolean; mustChange: boolean } | null }
export interface DirPerson { id: number; name: string; admin: boolean; active: boolean; mustChange: boolean; grants: Record<string, number | null> }
export interface DirDb { slug: string; organisation: string; kind: string; profiles: { id: number; name: string; access_name: string; office: string | null }[] }

export interface Hello {
  server: true;
  version: string;
  /** true when the page is opened on the server computer itself */
  local: boolean;
  /** may create / set up databases from this browser */
  canCreate: boolean;
  /** may make a community or country (the communities' password was given, even from another computer) */
  canCreateCty?: boolean;
  /** may open the window that manages the databases (server computer, or someone who manages users) */
  canManage?: boolean;
  /** the sign-in directory: set up or not, enforced or not, and who is signed in to it in this browser */
  dir?: DirInfo;
  dbs: DbInfo[];
  /** the database of the session already open in this browser, if any */
  current: string | null;
  /** signed out after this many minutes without activity */
  idleMinutes?: number;
  /** the communities' side has a password; and whether it was given in this browser */
  ctyGate?: boolean;
  ctyOpen?: boolean;
}

/** Thrown with the server's bilingual message, so screens show it like any other refusal. */
export class ServerError extends Error {
  constructor(public msg: Msg) {
    super(msg.en);
  }
}

// Where requests go. In a browser: the page's own server (fetch). In the desktop
// app connected to a server: through the app (src-tauri/src/remote.rs), which
// keeps the session and checks the server's certificate.
/** `background`: an automatic check by the screen, not something the person did (it does not keep the session open). */
type Raw = (method: 'GET' | 'POST', path: string, body?: unknown, background?: boolean) => Promise<{ status: number; json: unknown }>;

const viaFetch: Raw = async (method, path, body, background) => {
  const bg: Record<string, string> = background ? { 'X-Magis-Background': '1' } : {};
  const r = await fetch(path, method === 'POST'
    ? { method, headers: { 'Content-Type': 'application/json', ...bg }, body: JSON.stringify(body ?? {}), credentials: 'same-origin' }
    : { headers: bg, credentials: 'same-origin' });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

const viaApp: Raw = async (method, path, body, background) => {
  const { invoke } = await import('@tauri-apps/api/core');
  const r = await invoke<{ status: number; body: string }>('srv_request', { method, path, body: method === 'POST' ? JSON.stringify(body ?? {}) : null, background: !!background });
  let json: unknown = {};
  try {
    json = JSON.parse(r.body);
  } catch {
    /* not JSON */
  }
  return { status: r.status, json };
};

let raw: Raw = viaFetch;
/** The address of the server the desktop app is connected to (null in a browser). */
export let remoteBase: string | null = null;

async function call<T>(method: 'GET' | 'POST', url: string, body?: unknown, background?: boolean): Promise<T> {
  const { status, json } = await raw(method, url, body, background);
  const j = (json ?? {}) as { error?: Msg };
  if (status < 200 || status >= 300) {
    if (status === 401) window.dispatchEvent(new Event('magis-logged-out'));
    throw new ServerError(j.error ?? { ar: `خطأ ${status}`, en: `Error ${status}` });
  }
  return json as T;
}

const post = <T,>(url: string, body: unknown) => call<T>('POST', url, body);
const get = <T,>(url: string) => call<T>('GET', url);

/** Desktop app: tries `address` (e.g. 192.168.1.20). Returns the server's
 *  certificate fingerprint, to remember; refuses if it differs from `pin`. */
export async function connectRemote(address: string, pin: string | null): Promise<{ base: string; fingerprint: string; hello: Hello }> {
  const { invoke } = await import('@tauri-apps/api/core');
  let a = address.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(a)) a = `https://${a}`;
  a = a.replace(/^http:/i, 'https:');
  if (!/:\d+$/.test(a.replace(/^https:\/\//i, ''))) a = `${a}:8443`;
  try {
    const r = await invoke<{ fingerprint: string; hello: Hello }>('srv_connect', { base: a, pin });
    raw = viaApp;
    remoteBase = a;
    return { base: a, ...r };
  } catch (e) {
    const m = String(e);
    if (m.includes('CERT_CHANGED'))
      throw new ServerError({ ar: 'شهادة الخادم تغيّرت. إن أُعيد تثبيت الخادم فاضغط «نسيان الخادم» ثم اتصل من جديد؛ وإلا فلا تتابع.', en: "The server's certificate changed. If the server was reinstalled, click \"Forget this server\" and connect again; otherwise do not continue." });
    if (m.includes('NOT_MAGIS'))
      throw new ServerError({ ar: 'هذا العنوان ليس خادم ماجيس.', en: 'This address is not a MAGIS server.' });
    throw new ServerError({ ar: `تعذّر الوصول إلى ${a}. هل الخادم يعمل؟ هل الحاسوب على شبكة المركز؟`, en: `Could not reach ${a}. Is the server running? Is this computer on the centre's network?` });
  }
}

export async function disconnectRemote() {
  if (!remoteBase) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('srv_disconnect');
  raw = viaFetch;
  remoteBase = null;
}

/** Is this page served by a MAGIS server? (null = no: desktop or browser preview) */
export async function hello(): Promise<Hello | null> {
  try {
    const { status, json } = await raw('GET', '/api/hello');
    if (status !== 200) return null;
    const j = json as Hello;
    return j && j.server ? j : null;
  } catch {
    return null;
  }
}

export const serverProfiles = (db: string) => get<LoginPerson[]>(`/api/profiles?db=${encodeURIComponent(db)}`);

export const serverLogin = (db: string, profileId: number, password: string) =>
  post<{ profile: Profile; mustChange: boolean; install: 'office' }>('/api/login', { db, profileId, password });

/** kind: a Jesuit community or a country database (made from the communities' side); otherwise a centre */
export const serverCreateDb = (organisation: string, centre: string, color: string | null = null, logo: string | null = null, kind: 'community' | 'country' | 'hr' | null = null) =>
  post<{ slug: string }>('/api/dbs/create', { organisation, centre, color, logo, kind });
/** The communities' password: give it (the communities appear), or set / change it. */
export const serverCtyUnlock = (password: string) => post<{ ok: true }>('/api/cty/unlock', { password });
export const serverCtyGate = (password: string) => post<{ ok: true }>('/api/cty/gate', { password });
export const serverSetup = <T,>(kind: 'new' | 'upload-db' | 'community' | 'country' | 'hr', body: Record<string, unknown>) => post<T>(`/api/setup/${kind}`, body);

/** Managing the databases: all of them (also the switched-off ones) and the deleted ones kept in a folder. */
export interface ManagedDb { slug: string; organisation: string; kind: string; city: string | null; active: boolean; bytes: number; backups: number; lastBackup: string | null }
export interface DeletedDb { folder: string; organisation: string; bytes: number }
export const serverManageList = () => get<{ dbs: ManagedDb[]; deleted: DeletedDb[]; folder: string }>('/api/dbs/manage');
export const serverDbState = (db: string, active: boolean, password: string) => post<{ ok: true }>('/api/dbs/state', { db, active, password });
export const serverDbDelete = (db: string, name: string, password: string) => post<{ ok: true; folder: string }>('/api/dbs/delete', { db, name, password });
export const serverDbRestore = (folder: string) => post<{ ok: true; slug: string }>('/api/dbs/restore', { folder });

export const serverLogout = () => post('/api/logout', {}).catch(() => undefined);

/** Already logged in (cookie still valid)? */
export const serverMe = () => get<{ profile: Profile; mustChange: boolean; db: string } | null>('/api/me').catch(() => null);

/** Asked every 15 s by the screen: an automatic check, never counted as activity. */
export const serverVersion = async () => (await call<{ v: number }>('GET', '/api/version', undefined, true)).v;

/** Something the person did: keeps the session open on the server. */
export const serverTouch = () => get<unknown>('/api/me');

export const httpApi: Api = {
  call: (name, args, opts) => call('POST', `/api/op/${encodeURIComponent(name)}`, args ?? {}, opts?.background) as never,
};

export const serverStatus = <T,>() => get<T>('/api/server/status');
export const serverConfig = (c: Record<string, unknown>) => post('/api/server/config', c);
export const serverRestoreUpload = (base64: string, fileName: string) => post('/api/server/restore-upload', { base64, fileName });

// ---- the sign-in directory: one name and password, then the databases given to that person
export const dirSetup = (name: string, password: string) => post<{ ok: true }>('/api/dir/setup', { name, password });
export const dirLogin = (name: string, password: string) => post<{ person: DirPerson }>('/api/dir/login', { name, password });
export const dirLogout = () => post('/api/dir/logout', {}).catch(() => undefined);
export const dirPassword = (old: string, password: string) => post<{ ok: true }>('/api/dir/password', { old, password });
export const dirEnter = (db: string) => post<{ profile: Profile; mustChange: boolean; install: 'office' }>('/api/dir/enter', { db });
export const dirPeople = () => get<{ people: DirPerson[]; enforced: boolean; dbs: DirDb[] }>('/api/dir/people');
export const dirSave = (p: { id?: number | null; name: string; admin: boolean; active: boolean; password?: string; grants: Record<string, number | null> }) => post<{ person: DirPerson }>('/api/dir/save', p);
export const dirEnforce = (enforced: boolean) => post<{ ok: true }>('/api/dir/enforce', { enforced });
export const dirReset = (name: string, password: string, superior: string) => post<{ ok: true }>('/api/dir/reset', { name, password, superior });
