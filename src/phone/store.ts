// The phone's own storage (Fouad, 2026-11-13): what it keeps to work with no connection. Everything is in the phone's
// IndexedDB: the link with the server (its key, locked by the code chosen on this phone), the last pack taken from the
// server, the rows written here and the photos of their receipts.

export interface Msg { ar: string; en: string; fr?: string }

export interface Pack {
  phone: { id: string; name: string };
  user: string;
  organisation: string;
  centre: string;
  color: string | null;
  asOf: string;
  validUntil: string;
  /** rate: the book's latest exchange rate (older packs: none) */
  books: { id: number; name: string; main: boolean; usd: number; syp: number; rate?: number; bal?: Record<string, number>; kind?: string | null }[];
  headings: { id: number; name: string; code: string; types: Kind[]; names?: Msg }[];
  lines: { id: number; heading_id: number; name: string; code: string; names?: Msg; scope?: string | null; house?: boolean }[];
  parties: { id: number; name: string }[];
  closed: string[];
  bookClosed: { book_id: number; ym: string }[];
  fiscalStart: string | null;
  rate: number;
  tolerance?: number;
  /** a Jesuit community: its three currencies (LOC = the local one), any exchange (13 November 2026) */
  kind?: 'community';
  curs?: { code: string; label: string }[];
}

/** expense, income, and exchange (dollars given for pounds received) */
export type Kind = 'Exp' | 'Income' | 'Exchange';

/** a row written on the phone. waiting: not sent yet; sent: the server has it; fix: the server refused it (its reason) */
export interface Entry {
  id: string;
  book_id: number;
  date: string;
  type: Kind;
  heading_id: number;
  line_id: number;
  explanation: string;
  receipt: string;
  /** an exchange: amount = the dollars given, syp = the pounds received */
  amount: number;
  currency: string;
  syp?: number;
  /** an exchange in a community: what was received */
  cur2?: string;
  amount2?: number;
  /** a community: a Jesuit's expense paid for the house (Fouad, 15 November 2026) */
  for_house?: number;
  state: 'waiting' | 'sent' | 'fix';
  error?: Msg | null;
  made_at: string;
  sent_at?: string | null;
}

export interface Photo { key: string; trxId: string; mime: string; base64: string; sent: boolean }

/** the link with the server: the key is kept locked by the code (AES-GCM, the key made from the code) */
export interface Link { salt: string; iv: string; locked: string }

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('magis-phone', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('kv');
      r.result.createObjectStore('rows', { keyPath: 'id' });
      r.result.createObjectStore('photos', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
const run = async <T,>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const rq = f(tx.objectStore(store));
    tx.oncomplete = () => resolve(rq.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

export const kvGet = <T,>(k: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(k) as IDBRequest<T | undefined>);
export const kvSet = (k: string, v: unknown) => run('kv', 'readwrite', (s) => s.put(v, k));
export const kvDel = (k: string) => run('kv', 'readwrite', (s) => s.delete(k));

export const allRows = () => run<Entry[]>('rows', 'readonly', (s) => s.getAll() as IDBRequest<Entry[]>);
export const putRow = (r: Entry) => run('rows', 'readwrite', (s) => s.put(r));
export const delRow = (id: string) => run('rows', 'readwrite', (s) => s.delete(id));

export const allPhotos = () => run<Photo[]>('photos', 'readonly', (s) => s.getAll() as IDBRequest<Photo[]>);
export const putPhoto = (p: Photo) => run('photos', 'readwrite', (s) => s.put(p));
export const delPhoto = (key: string) => run('photos', 'readwrite', (s) => s.delete(key));

/** forgets everything on this phone (unlinking it) */
export async function wipe() {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(['kv', 'rows', 'photos'], 'readwrite');
    for (const s of ['kv', 'rows', 'photos']) tx.objectStore(s).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** a number of its own for a row or a photo: made on the phone, so the same one never comes twice */
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));

// ---------------------------------------------------------------- the code of this phone
const b64 = (u: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(u as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function keyFrom(code: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** locks the server's key with the code chosen on this phone */
export async function lockKey(serverKey: string, code: string): Promise<Link> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const locked = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(code, salt), new TextEncoder().encode(serverKey));
  return { salt: b64(salt), iv: b64(iv), locked: b64(locked) };
}
/** opens it again; null when the code is not the right one */
export async function openKey(link: Link, code: string): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(link.iv) }, await keyFrom(code, unb64(link.salt)), unb64(link.locked));
    return new TextDecoder().decode(plain);
  } catch { return null; }
}
