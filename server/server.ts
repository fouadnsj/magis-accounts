// MAGIS Accounts — the centre's server on the local network.
//
// One computer in the centre (the mini-PC) runs this program. It keeps the
// databases (one per centre, or per purpose: Homs, a test, a new year…), serves
// the screens to every browser on the LAN (computers and phones), checks every
// password and every permission, and backs up every database every day.
// The accounting rules are the same files as the desktop app (src/ops.ts,
// src/domain/*), so the two can never disagree.
//
// Safety, because visitors may share the Wi-Fi:
//  - HTTPS with a certificate made by the server itself (browsers warn once);
//  - passwords hashed slowly (PBKDF2), sessions in HttpOnly cookies;
//  - login attempts limited per address;
//  - first setup only from the server computer itself.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import selfsigned from 'selfsigned';
import ExcelJS from 'exceljs';
import { type Db, type Row, type SqlValue, type Stmt, migrate, one, pendingMigrations } from '../src/db/db';
import { blankTrx, getMeta, loadLists, setMetaStmt } from '../src/db/repo';
import { checkSecretShape, has, hashSecret, listProfiles, loadProfile, login, verifySecret, type Profile } from '../src/auth';
import { READ_ONLY, runOp, type BackupFile, type FileOps, type OpCtx } from '../src/ops';
import { createOffice } from '../src/setup';
import { createCommunity, type CommunitySetup } from '../src/community/setup';
import { createCountry, type CountrySetup } from '../src/community/country';
import { createHr, type HrListItem, type HrPerson } from '../src/hr/hr';
import { accountFor, centreItem, lineFor } from '../src/hr/link';
import { allocOn, splitAmount, type HrAlloc } from '../src/hr/stage4';
import { applySeed, readWorkbook } from '../src/io/importWorkbook';
import type { Msg } from '../src/i18n';
import type { Trx } from '../src/domain/types';

export const SERVER_VERSION = '0.8.0';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

// ---------------------------------------------------------------- configuration

export interface ServerConfig {
  httpsPort: number;
  httpPort: number;
  /** 'redirect': plain http only sends people to https. 'serve': plain http works too (tests, or a staff-only network). */
  httpMode: 'redirect' | 'serve' | 'off';
  /** A second folder (USB key / external disk) that receives a copy of every backup. */
  backupMirror: string | null;
  /** Signed out after this many minutes without real activity (clicks, typing). */
  idleMinutes: number;
  /** The password of the Jesuit communities' side (Fouad, 19 October 2026: "to keep the privacy"):
   *  until it is given, the server does not show the communities, their accounts or their sign-in. */
  ctyGate?: { salt: string; hash: string } | null;
  /** Databases switched off (Fouad, 29 October 2026): kept on the disk, not shown, nobody can sign in. */
  inactive?: string[];
}

const DEFAULT_CONFIG: ServerConfig = { httpsPort: 8443, httpPort: 8080, httpMode: 'redirect', backupMirror: null, idleMinutes: 15 };

export function defaultDataDir(): string {
  if (process.env.MAGIS_DATA) return process.env.MAGIS_DATA;
  if (process.platform === 'win32') return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'MAGIS');
  return path.join(os.homedir(), 'MAGIS-server');
}

function readConfig(dataDir: string): ServerConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(dataDir: string, c: ServerConfig) {
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(c, null, 2));
}

function readDirectory(dataDir: string): Directory {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, 'directory.json'), 'utf8')) as Directory;
    return { enforced: !!d.enforced, next: d.next ?? 1, people: Array.isArray(d.people) ? d.people : [] };
  } catch {
    return { enforced: false, next: 1, people: [] };
  }
}

function writeDirectory(dataDir: string, d: Directory) {
  const f = path.join(dataDir, 'directory.json');
  // the file before this change is kept, and the new one is written whole then moved into place
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dataDir, 'directory.prev.json'));
  fs.writeFileSync(f + '.tmp', JSON.stringify(d, null, 2));
  fs.renameSync(f + '.tmp', f);
}

// ---------------------------------------------------------------- database

function openDb(file: string): { db: Db; close: () => void } {
  const sq = new DatabaseSync(file);
  // DELETE journal: the database stays ONE file, easy to back up and to copy.
  sq.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  const db: Db = {
    async query<T = Row>(sql: string, params: SqlValue[] = []) {
      return sq.prepare(sql).all(...params) as T[];
    },
    async batch(stmts: Stmt[]) {
      sq.exec('BEGIN IMMEDIATE');
      try {
        for (const s of stmts) sq.prepare(s.sql).run(...(s.params ?? []));
        sq.exec('COMMIT');
      } catch (e) {
        sq.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, close: () => sq.close() };
}

// ---------------------------------------------------------------- network addresses and certificate

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

/** A certificate made by the server, valid for its name and LAN addresses. Remade if an address changes. */
async function certificate(dataDir: string): Promise<{ key: string; cert: string }> {
  const dir = path.join(dataDir, 'tls');
  fs.mkdirSync(dir, { recursive: true });
  const names = ['localhost', os.hostname()];
  const ips = ['127.0.0.1', ...lanAddresses()];
  const metaFile = path.join(dir, 'covers.json');
  try {
    const covers = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as { ips: string[]; until: string };
    if (ips.every((ip) => covers.ips.includes(ip)) && new Date(covers.until) > new Date(Date.now() + 30 * 86400e3))
      return { key: fs.readFileSync(path.join(dir, 'key.pem'), 'utf8'), cert: fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8') };
  } catch {
    /* no certificate yet */
  }
  const until = new Date();
  until.setFullYear(until.getFullYear() + 5);
  const pems = await selfsigned.generate([{ name: 'commonName', value: `MAGIS ${os.hostname()}` }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: until,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [...names.map((value) => ({ type: 2 as const, value })), ...ips.map((ip) => ({ type: 7 as const, ip }))] },
    ],
  });
  fs.writeFileSync(path.join(dir, 'key.pem'), pems.private, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'cert.pem'), pems.cert);
  fs.writeFileSync(metaFile, JSON.stringify({ ips, until: until.toISOString() }));
  return { key: pems.private, cert: pems.cert };
}

// ---------------------------------------------------------------- centres (one database each)

/** The colour code of the MAGIS design: Jaramana gold, Aleppo navy, Homs maroon. */
export const CENTRE_KEYS = ['jaramana', 'aleppo', 'homs', 'other'] as const;
export type CentreKey = (typeof CENTRE_KEYS)[number];

/** Guess the centre from a name (for databases made before centres existed). */
function guessCentre(name: string): CentreKey {
  const n = name.toLowerCase();
  if (/homs|حمص/.test(n)) return 'homs';
  if (/alep|aleppo|حلب/.test(n)) return 'aleppo';
  if (/jaramana|جرمانا|damas|دمشق|alberto/.test(n)) return 'jaramana';
  return 'other';
}

/** Folder name for a database: latin letters, digits and dashes only. */
function slugify(name: string): string {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'centre';
}

interface Centre {
  slug: string;
  dir: string;
  file: string;
  backupsDir: string;
  handle: { db: Db; close: () => void };
  /** Goes up by one after every change: browsers ask for it to know when to reload. */
  version: number;
  files: FileOps;
}

interface Session {
  db: string; // slug of the database this session belongs to
  profile: Profile;
  mustChange: boolean;
  last: number;
  ip: string;
}

/** The sign-in directory (Fouad, 30 October 2026): one person, one password, and the list of databases that person may enter. */
interface DirPerson {
  id: number;
  name: string;
  salt: string;
  hash: string;
  /** sees every database and manages the directory */
  admin: boolean;
  active: boolean;
  /** a password given by the administrator must be replaced first */
  mustChange: boolean;
  /** database slug → the profile (person) of that database to enter as; null = its Superior */
  grants: Record<string, number | null>;
}
interface Directory {
  /** true = the databases are shown and opened only through the directory (old sign-in refused, except on the server computer) */
  enforced: boolean;
  next: number;
  people: DirPerson[];
}

export interface StartOptions {
  dataDir?: string;
  webRoot?: string;
  /** tests: overrides of the configuration file */
  config?: Partial<ServerConfig>;
  log?: (msg: string) => void;
}

export interface Running {
  close: () => Promise<void>;
  httpsPort: number | null;
  httpPort: number | null;
  dataDir: string;
}

const MAX_BODY = 40 * 1024 * 1024;

class HttpError extends Error {
  constructor(public status: number, public msg: Msg) {
    super(msg.en);
  }
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export async function startServer(opts: StartOptions = {}): Promise<Running> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const log = opts.log ?? ((m: string) => console.log(`[${new Date().toISOString()}] ${m}`));
  const dbsDir = path.join(dataDir, 'dbs');
  fs.mkdirSync(dbsDir, { recursive: true });
  let config = { ...readConfig(dataDir), ...opts.config };
  if (!fs.existsSync(path.join(dataDir, 'config.json'))) writeConfig(dataDir, config);
  const webRoot = opts.webRoot ?? path.join(path.dirname(process.argv[1] ?? '.'), 'web');

  const centres = new Map<string, Centre>();
  const sessions = new Map<string, Session>();
  const failures = new Map<string, { n: number; until: number }>();
  let directory = readDirectory(dataDir);
  /** directory sign-ins: cookie magis_dir → person id */
  const dirSessions = new Map<string, { id: number; last: number }>();

  // ---------------------------------------------------------------- one centre = one folder
  const makeFiles = (c: Centre): FileOps => ({
    async backupNow(reason) {
      // two copies in the same second get -2, -3… instead of failing
      const base = `magis_${stamp()}_${reason.replace(/[^\w-]/g, '')}`;
      let dest = path.join(c.backupsDir, `${base}.db`);
      for (let i = 2; fs.existsSync(dest); i++) dest = path.join(c.backupsDir, `${base}-${i}.db`);
      await c.handle.db.query('VACUUM INTO ?', [dest]);
      if (config.backupMirror) {
        try {
          const mirror = path.join(config.backupMirror, c.slug);
          fs.mkdirSync(mirror, { recursive: true });
          fs.copyFileSync(dest, path.join(mirror, path.basename(dest)));
        } catch (e) {
          log(`backup mirror failed (${config.backupMirror}): ${e}`);
        }
      }
      log(`backup ${c.slug}/${path.basename(dest)}`);
      return dest;
    },
    async list(): Promise<BackupFile[]> {
      return fs
        .readdirSync(c.backupsDir)
        .filter((f) => f.endsWith('.db'))
        .map((name) => {
          const st = fs.statSync(path.join(c.backupsDir, name));
          return { name, path: name, size: st.size, modified: st.mtimeMs };
        })
        .sort((a, b) => b.modified - a.modified);
    },
    // Attached documents: dbs/<slug>/attachments/<year>/<Bill_Code>.pdf — never a path from outside that folder.
    async docWrite(rel, bytes) {
      const file = docPath(c, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      if (config.backupMirror) {
        try {
          const mirror = path.join(config.backupMirror, c.slug, 'attachments', rel);
          fs.mkdirSync(path.dirname(mirror), { recursive: true });
          fs.copyFileSync(file, mirror);
        } catch (e) {
          log(`document mirror failed: ${e}`);
        }
      }
    },
    async docRead(rel) {
      return new Uint8Array(fs.readFileSync(docPath(c, rel)));
    },
    async docExists(rel) {
      return fs.existsSync(docPath(c, rel));
    },
    async backupRows(name) {
      const base = path.basename(name);
      const from = path.join(c.backupsDir, base);
      if (base !== name || !fs.existsSync(from)) throw new HttpError(400, { ar: 'نسخة غير موجودة', en: 'Backup not found' });
      const sq = new DatabaseSync(from, { readOnly: true });
      try {
        return sq.prepare('SELECT * FROM trx').all() as unknown as Trx[];
      } finally {
        sq.close();
      }
    },
    async restore(name) {
      // Only a file of this database's backups folder, by its bare name: never a path from the browser.
      const base = path.basename(name);
      const from = path.join(c.backupsDir, base);
      if (base !== name || !fs.existsSync(from)) throw new HttpError(400, { ar: 'نسخة غير موجودة', en: 'Backup not found' });
      await c.files.backupNow('before-restore');
      c.handle.close();
      fs.copyFileSync(from, c.file);
      c.handle = openDb(c.file);
      await migrate(c.handle.db);
      c.version++;
      log(`restored ${c.slug}/${base}`);
    },
  });

  const docPath = (c: Centre, rel: string) => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(rel) || rel.includes('..')) throw new HttpError(400, { ar: 'اسم ملف غير صالح', en: 'Invalid file name' });
    return path.join(c.dir, 'attachments', rel);
  };

  const openCentre = async (slug: string): Promise<Centre> => {
    const dir = path.join(dbsDir, slug);
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const file = path.join(dir, 'magis.db');
    const handle = openDb(file);
    // A new version that changes the database: a copy of it as it was, first.
    if (fs.existsSync(file) && fs.statSync(file).size > 0 && (await pendingMigrations(handle.db)) > 0 && (await handle.db.query("SELECT 1 FROM sqlite_master WHERE name = 'schema_migration'")).length) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.copyFileSync(file, path.join(backupsDir, `${stamp}_before-update-${SERVER_VERSION}.db`));
      log(`${slug}: copy taken before the update to ${SERVER_VERSION}`);
    }
    await migrate(handle.db);
    const c = { slug, dir, file, backupsDir, handle, version: 1 } as Centre;
    c.files = makeFiles(c);
    centres.set(slug, c);
    return c;
  };

  // A server of an earlier version kept ONE database at the top of its folder: move it in, once.
  const oldFile = path.join(dataDir, 'magis.db');
  if (fs.existsSync(oldFile)) {
    const tmp = openDb(oldFile);
    await migrate(tmp.db);
    const org = (await getMeta(tmp.db, 'organisation')) ?? '';
    const centre = (await getMeta(tmp.db, 'centre')) ?? guessCentre(org);
    await tmp.db.batch([setMetaStmt('centre', centre)]);
    tmp.close();
    let slug = slugify(org);
    for (let i = 2; fs.existsSync(path.join(dbsDir, slug)); i++) slug = `${slugify(org)}-${i}`;
    fs.mkdirSync(path.join(dbsDir, slug, 'backups'), { recursive: true });
    fs.renameSync(oldFile, path.join(dbsDir, slug, 'magis.db'));
    const oldBackups = path.join(dataDir, 'backups');
    if (fs.existsSync(oldBackups)) {
      for (const f of fs.readdirSync(oldBackups)) fs.renameSync(path.join(oldBackups, f), path.join(dbsDir, slug, 'backups', f));
      fs.rmSync(oldBackups, { recursive: true, force: true });
    }
    log(`moved the database into dbs/${slug}`);
  }

  for (const slug of fs.readdirSync(dbsDir)) {
    if (fs.existsSync(path.join(dbsDir, slug, 'magis.db'))) await openCentre(slug);
  }

  const setupNeeded = async (c: Centre) => !(await one(c.handle.db, 'SELECT 1 FROM profile WHERE active = 1 LIMIT 1'));
  const describe = async (c: Centre) => ({
    slug: c.slug,
    organisation: (await getMeta(c.handle.db, 'organisation')) ?? c.slug,
    centre: ((await getMeta(c.handle.db, 'centre')) ?? 'other') as CentreKey,
    color: await getMeta(c.handle.db, 'brand_color'),
    logo: await getMeta(c.handle.db, 'brand_logo'),
    /** a community's set of colours (JSON), if it chose one */
    palette: await getMeta(c.handle.db, 'brand_palette'),
    city: await getMeta(c.handle.db, 'city'),
    setupNeeded: await setupNeeded(c),
    /** community = a Jesuit community's accounts; otherwise a MAGIS centre */
    kind: (await getMeta(c.handle.db, 'kind')) ?? 'centre',
  });
  const centreOf = (slug: unknown): Centre => {
    const c = typeof slug === 'string' ? centres.get(slug) : undefined;
    if (!c || (config.inactive ?? []).includes(c.slug)) throw new HttpError(404, { ar: 'قاعدة البيانات غير موجودة', en: 'Database not found' });
    return c;
  };

  // ---------------------------------------------------------------- backups, every day, for every database
  const dailyBackup = async () => {
    const today = stamp().slice(0, 10);
    for (const c of centres.values()) {
      try {
        if (await setupNeeded(c)) continue;
        const all = await c.files.list();
        if (all.some((b) => b.name.startsWith(`magis_${today}`) && b.name.endsWith('_daily.db'))) continue;
        await c.files.backupNow('daily');
        const daily = (await c.files.list()).filter((b) => b.name.endsWith('_daily.db'));
        for (const old of daily.slice(60)) fs.rmSync(path.join(c.backupsDir, old.name), { force: true });
      } catch (e) {
        log(`daily backup failed (${c.slug}): ${e}`);
      }
    }
  };
  await dailyBackup();
  const dailyTimer = setInterval(() => void dailyBackup(), 3600e3);

  // ---------------------------------------------------------------- helpers
  const ipOf = (req: http.IncomingMessage) => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const isLocal = (req: http.IncomingMessage) => ['127.0.0.1', '::1'].includes(ipOf(req));

  const readBody = (req: http.IncomingMessage) =>
    new Promise<unknown>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new HttpError(413, { ar: 'الملف كبير جداً', en: 'File too large' }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(new HttpError(400, { ar: 'طلب غير صالح', en: 'Bad request' }));
        }
      });
      req.on('error', reject);
    });

  const cookie = (req: http.IncomingMessage) => /(?:^|;\s*)magis_sid=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;

  // ---- the communities' side: one password before anyone sees a community (cookie magis_cty, 12 hours)
  const ctyPasses = new Map<string, number>();
  const ctyCookie = (req: http.IncomingMessage) => /(?:^|;\s*)magis_cty=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
  const ctyPassCookie = (viaHttps: boolean) => {
    const t = randomBytes(32).toString('base64url');
    ctyPasses.set(t, Date.now() + 12 * 3600e3);
    return `magis_cty=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${viaHttps ? '; Secure' : ''}`;
  };

  const dirCookie = (req: http.IncomingMessage) => /(?:^|;\s*)magis_dir=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
  const dirPersonOf = (req: http.IncomingMessage): DirPerson | null => {
    const t = dirCookie(req);
    const x = t ? dirSessions.get(t) : undefined;
    if (!t || !x) return null;
    const p = directory.people.find((q) => q.id === x.id && q.active);
    if (!p || Date.now() - x.last > Math.max(1, Number(config.idleMinutes) || 15) * 60e3) {
      dirSessions.delete(t);
      return null;
    }
    if (req.headers['x-magis-background'] !== '1') x.last = Date.now();
    return p;
  };

  /** The person behind this request, re-read from his database (a deactivated user is out at once). */
  const idleMs = () => Math.max(1, Number(config.idleMinutes) || 15) * 60e3;

  const sessionOf = async (req: http.IncomingMessage): Promise<[string, Session, Centre] | null> => {
    const sid = cookie(req);
    const s = sid ? sessions.get(sid) : undefined;
    if (!sid || !s) return null;
    const c = centres.get(s.db);
    if (!c || Date.now() - s.last > idleMs()) {
      sessions.delete(sid);
      return null;
    }
    const p = await loadProfile(c.handle.db, s.profile.id);
    if (!p) {
      sessions.delete(sid);
      return null;
    }
    s.profile = p;
    // The screen's automatic checks (every 15 s) do not count as activity:
    // only what the person does keeps the session open.
    if (req.headers['x-magis-background'] !== '1') s.last = Date.now();
    return [sid, s, c];
  };

  /** Creating or setting up a database: on the server computer itself, or by someone who manages users. */
  const mayCreate = (req: http.IncomingMessage, found: [string, Session, Centre] | null) =>
    isLocal(req) || (!!found && has(found[1].profile, 'users.manage'));

  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body === undefined ? null : body));
  };

  const SEC_HEADERS: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'",
  };

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  };

  const serveStatic = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const root = path.resolve(webRoot);
    let file = path.resolve(root, '.' + url);
    if (!file.startsWith(root + path.sep) && file !== root) return send(res, 403, { error: { ar: 'ممنوع', en: 'Forbidden' } });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html'); // one-page app
    if (!fs.existsSync(file)) {
      res.writeHead(500, SEC_HEADERS);
      return res.end('Web files missing: ' + root);
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      ...SEC_HEADERS,
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  };

  const secure = () => config.httpsPort > 0;

  /**
   * Replaces a database by an uploaded office database (from the desktop app,
   * or a backup copy). Checked in a temporary file first: it must open, must be
   * an office database (not a holder's), and must have at least one user.
   */
  const replaceDatabase = async (c: Centre, base64: string) => {
    const keepCentre = await getMeta(c.handle.db, 'centre');
    const tmp = path.join(c.dir, `upload-${Date.now()}.db`);
    fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));
    try {
      const test = openDb(tmp);
      try {
        await migrate(test.db);
        const install = await getMeta(test.db, 'install');
        const users = await one<{ c: number }>(test.db, 'SELECT COUNT(*) AS c FROM profile WHERE active = 1');
        if (install === 'holder') throw new HttpError(400, { ar: 'هذا ملف أمين صندوق، لا ملف المكتب', en: "This is a holder's file, not the office database" });
        if (!users?.c) throw new HttpError(400, { ar: 'لا مستخدمين في هذا الملف', en: 'No users in this file' });
      } finally {
        test.close();
      }
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, { ar: 'ليس ملف قاعدة بيانات صالحاً', en: 'Not a valid database file' });
    }
    c.handle.close();
    fs.copyFileSync(tmp, c.file);
    fs.rmSync(tmp, { force: true });
    c.handle = openDb(c.file);
    await migrate(c.handle.db);
    // the centre chosen for this database stays (its colour and mark)
    if (keepCentre) await c.handle.db.batch([setMetaStmt('centre', keepCentre)]);
    c.version++;
    for (const [sid, x] of sessions) if (x.db === c.slug) sessions.delete(sid); // other users: everybody logs in again
  };

  // ---------------------------------------------------------------- API
  const api = async (req: http.IncomingMessage, res: http.ServerResponse, url: string, query: URLSearchParams, viaHttps: boolean) => {
    const method = req.method ?? 'GET';
    const ip = ipOf(req);
    const found = await sessionOf(req);
    const dirPerson = dirPersonOf(req);
    /** may this directory person enter this database? (the administrator: all) */
    const dirSees = (p: DirPerson, slug: string) => p.admin || Object.prototype.hasOwnProperty.call(p.grants, slug);
    const dirInfo = () => ({ on: directory.people.length > 0, enforced: directory.enforced, person: dirPerson ? { name: dirPerson.name, admin: dirPerson.admin, mustChange: dirPerson.mustChange } : null });
    const isCtyKind = (k: string | null | undefined) => k === 'community' || k === 'country';
    // the communities' side is open: no password set yet, or given in this browser, or signed in to a community
    const ctyOpen = (): boolean => {
      if (!config.ctyGate) return true;
      const t = ctyCookie(req);
      const until = t ? ctyPasses.get(t) : undefined;
      if (until && until > Date.now()) return true;
      if (dirPerson && (dirPerson.admin || Object.keys(dirPerson.grants).some((x) => ctyKinds.get(x)))) return true; // given to this person in the directory
      return !!found && ctyKinds.get(found[2].slug) === true;
    };
    const ctyKinds = new Map<string, boolean>();
    for (const c of centres.values()) ctyKinds.set(c.slug, isCtyKind(await getMeta(c.handle.db, 'kind')));
    const needCtyOpen = (slug: unknown) => {
      if (typeof slug === 'string' && ctyKinds.get(slug) && !ctyOpen())
        throw new HttpError(403, { ar: 'اكتب أولاً كلمة سر الجماعات', en: "First give the communities' password" });
    };
    // Once the communities' password is given in this browser, a community (or a country) may also be made from
    // another computer, not only on the server computer: the password is what protects that side (Fouad, 28 Oct 2026).
    const mayCreateCty = () => mayCreate(req, found) || (!!config.ctyGate && ctyOpen());
    // Managing the databases (Fouad, 29 October 2026): the window is for the server computer or someone who manages
    // users; every change also needs the PASSWORD of that database's Superior (a user who manages users there).
    const mayManage = () => isLocal(req) || (!!found && has(found[1].profile, 'users.manage'));
    const checkGate = async (password: string) => {
      const g = config.ctyGate;
      if (!g) return true;
      return (await hashSecret(g.salt, password)) === g.hash;
    };

    if (url === '/api/hello' && method === 'GET') {
      // the communities are not even named until their password is given
      let dbs = (await Promise.all([...centres.values()].filter((x) => !(config.inactive ?? []).includes(x.slug)).map(describe))).filter((d) => ctyOpen() || !isCtyKind(d.kind));
      // the directory: a signed-in person sees only what was given to them; when it is enforced, nobody else sees anything
      if (dirPerson) dbs = dbs.filter((d) => dirSees(dirPerson, d.slug));
      else if (directory.enforced && !isLocal(req)) dbs = [];
      dbs.sort((a, b) => CENTRE_KEYS.indexOf(a.centre) - CENTRE_KEYS.indexOf(b.centre) || a.organisation.localeCompare(b.organisation));
      return send(res, 200, { server: true, version: SERVER_VERSION, local: isLocal(req), canCreate: mayCreate(req, found), canCreateCty: mayCreateCty(), canManage: mayManage(), dir: dirInfo(), dbs, current: found ? found[1].db : null, idleMinutes: config.idleMinutes, ctyGate: !!config.ctyGate, ctyOpen: ctyOpen() });
    }

    // ---- the communities' password: give it (unlock), or set / change it
    if (url === '/api/cty/unlock' && method === 'POST') {
      const f = failures.get(ip);
      if (f && f.until > Date.now()) throw new HttpError(429, { ar: 'محاولات كثيرة — انتظر 5 دقائق', en: 'Too many attempts — wait 5 minutes' });
      const body = (await readBody(req)) as { password?: string };
      if (!(await checkGate(String(body.password ?? '')))) {
        const n = f && f.until > 0 && f.until <= Date.now() ? 1 : (f?.n ?? 0) + 1;
        failures.set(ip, { n, until: n >= 8 ? Date.now() + 5 * 60e3 : 0 });
        log(`wrong communities' password from ${ip}`);
        throw new HttpError(403, { ar: 'كلمة السر غير صحيحة', en: 'Wrong password' });
      }
      failures.delete(ip);
      return send(res, 200, { ok: true }, { 'Set-Cookie': ctyPassCookie(viaHttps) });
    }
    if (url === '/api/cty/gate' && method === 'POST') {
      // set: on the server computer itself, or by someone who manages users; change: by the
      // administrator of a community (or the country econome), or here once the side is open
      const inCty = !!found && ctyKinds.get(found[2].slug) === true && has(found[1].profile, 'users.manage');
      const allowed = config.ctyGate ? inCty || (isLocal(req) && ctyOpen()) : inCty || mayCreate(req, found);
      if (!allowed) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const body = (await readBody(req)) as { password?: string };
      const pw = String(body.password ?? '');
      checkSecretShape(pw);
      const salt = randomBytes(16).toString('base64url');
      config = { ...config, ctyGate: { salt, hash: await hashSecret(salt, pw) } };
      writeConfig(dataDir, config);
      log(`communities' password ${found ? `set by ${found[1].profile.name}` : 'set on the server'}`);
      return send(res, 200, { ok: true }, { 'Set-Cookie': ctyPassCookie(viaHttps) });
    }

    // ---- managing the databases: list, switch off / on, delete (kept in the "deleted" folder), restore
    const folderSize = (dir: string): number => {
      let n = 0;
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? folderSize(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size;
      } catch { /* a folder that vanished */ }
      return n;
    };
    const needManage = () => {
      if (!mayManage()) throw new HttpError(403, { ar: 'على حاسوب الخادم نفسه، أو لمن يدير المستخدمين', en: 'On the server computer itself, or by someone who manages users' });
    };
    /** the password of a user who manages users in THAT database (its Superior) */
    const needSuperior = async (c: Centre, password: unknown) => {
      const f = failures.get(ip);
      if (f && f.until > Date.now()) throw new HttpError(429, { ar: 'محاولات كثيرة — انتظر 5 دقائق', en: 'Too many attempts — wait 5 minutes' });
      for (const p of await listProfiles(c.handle.db)) {
        try {
          const r = await login(c.handle.db, p.id, String(password ?? ''));
          if (has(r.profile, 'users.manage')) {
            failures.delete(ip);
            return r.profile.name;
          }
        } catch { /* not this one */ }
      }
      const n = f && f.until > 0 && f.until <= Date.now() ? 1 : (f?.n ?? 0) + 1;
      failures.set(ip, { n, until: n >= 8 ? Date.now() + 5 * 60e3 : 0 });
      throw new HttpError(403, { ar: 'كلمة سر رئيس هذه القاعدة غير صحيحة', en: "The password of this database's Superior is not right" });
    };
    const deletedDir = path.join(dataDir, 'deleted');
    if (url === '/api/dbs/manage' && method === 'GET') {
      needManage();
      const off = new Set(config.inactive ?? []);
      const list = [];
      for (const c of centres.values()) {
        const d = await describe(c);
        if (isCtyKind(d.kind) && !ctyOpen()) continue;
        const backups = await c.files.list();
        list.push({ slug: c.slug, organisation: d.organisation, kind: d.kind, city: d.city, active: !off.has(c.slug), bytes: folderSize(c.dir), backups: backups.length, lastBackup: backups[0]?.name ?? null });
      }
      const deleted = fs.existsSync(deletedDir)
        ? fs.readdirSync(deletedDir).filter((f) => fs.existsSync(path.join(deletedDir, f, 'magis.db'))).sort().reverse().map((folder) => {
            let organisation = folder;
            try {
              const tmp = new DatabaseSync(path.join(deletedDir, folder, 'magis.db'), { readOnly: true });
              organisation = (tmp.prepare("SELECT value FROM meta WHERE key = 'organisation'").get() as { value?: string } | undefined)?.value ?? folder;
              tmp.close();
            } catch { /* the name stays the folder's */ }
            return { folder, organisation, bytes: folderSize(path.join(deletedDir, folder)) };
          })
        : [];
      return send(res, 200, { dbs: list, deleted, folder: deletedDir });
    }
    if (url === '/api/dbs/state' && method === 'POST') {
      needManage();
      const body = (await readBody(req)) as { db?: string; active?: boolean; password?: string };
      const c = centres.get(String(body.db));
      if (!c) throw new HttpError(404, { ar: 'قاعدة البيانات غير موجودة', en: 'Database not found' });
      if (isCtyKind(await getMeta(c.handle.db, 'kind')) && !ctyOpen()) throw new HttpError(403, { ar: 'اكتب أولاً كلمة سر الجماعات', en: "First give the communities' password" });
      const who = await needSuperior(c, body.password);
      const off = new Set(config.inactive ?? []);
      if (body.active) off.delete(c.slug);
      else {
        off.add(c.slug);
        for (const [sid, x] of sessions) if (x.db === c.slug) sessions.delete(sid);
      }
      config = { ...config, inactive: [...off] };
      writeConfig(dataDir, config);
      log(`database ${c.slug} switched ${body.active ? 'on' : 'off'} (password of ${who})`);
      return send(res, 200, { ok: true });
    }
    if (url === '/api/dbs/delete' && method === 'POST') {
      needManage();
      const body = (await readBody(req)) as { db?: string; name?: string; password?: string };
      const c = centres.get(String(body.db));
      if (!c) throw new HttpError(404, { ar: 'قاعدة البيانات غير موجودة', en: 'Database not found' });
      const d = await describe(c);
      if (isCtyKind(d.kind) && !ctyOpen()) throw new HttpError(403, { ar: 'اكتب أولاً كلمة سر الجماعات', en: "First give the communities' password" });
      if (String(body.name ?? '').trim() !== d.organisation) throw new HttpError(400, { ar: 'اكتب اسم قاعدة البيانات كما هو للتأكيد', en: 'Type the name of the database exactly, to confirm' });
      const who = await needSuperior(c, body.password);
      // a last copy, then the WHOLE folder (database, backups, documents) moves to "deleted": nothing is erased
      try { await c.files.backupNow('before-delete'); } catch { /* the folder is kept anyway */ }
      c.handle.close();
      centres.delete(c.slug);
      for (const [sid, x] of sessions) if (x.db === c.slug) sessions.delete(sid);
      fs.mkdirSync(deletedDir, { recursive: true });
      const dest = path.join(deletedDir, `${c.slug}_${stamp()}`);
      fs.renameSync(c.dir, dest);
      config = { ...config, inactive: (config.inactive ?? []).filter((x) => x !== c.slug) };
      writeConfig(dataDir, config);
      log(`database ${c.slug} deleted: folder kept in ${dest} (password of ${who})`);
      return send(res, 200, { ok: true, folder: dest });
    }
    if (url === '/api/dbs/restore' && method === 'POST') {
      needManage();
      const body = (await readBody(req)) as { folder?: string };
      const folder = String(body.folder ?? '');
      if (!/^[\w.-]+$/.test(folder) || !fs.existsSync(path.join(deletedDir, folder, 'magis.db'))) throw new HttpError(404, { ar: 'لا نسخة محذوفة بهذا الاسم', en: 'No deleted database with this name' });
      const base = folder.replace(/_\d{4}-\d{2}-\d{2}_\d{6}$/, '') || 'centre';
      let slug = base;
      for (let i = 2; centres.has(slug) || fs.existsSync(path.join(dbsDir, slug)); i++) slug = `${base}-${i}`;
      fs.renameSync(path.join(deletedDir, folder), path.join(dbsDir, slug));
      const c = await openCentre(slug);
      if (isCtyKind(await getMeta(c.handle.db, 'kind')) && !ctyOpen()) log(`restored a community database ${slug} while the communities' side is closed`);
      log(`database restored from deleted/${folder} as ${slug}`);
      return send(res, 200, { ok: true, slug });
    }

    // ---- the sign-in directory: one name and password, then the databases given to that person
    const dirCookieSet = (token: string, viaHttps: boolean) => `magis_dir=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${viaHttps ? '; Secure' : ''}`;
    const dirTooMany = () => {
      const f = failures.get(ip);
      if (f && f.until > Date.now()) throw new HttpError(429, { ar: 'محاولات كثيرة — انتظر 5 دقائق', en: 'Too many attempts — wait 5 minutes' });
    };
    const dirFail = () => {
      const f = failures.get(ip);
      const n = f && f.until > 0 && f.until <= Date.now() ? 1 : (f?.n ?? 0) + 1;
      failures.set(ip, { n, until: n >= 8 ? Date.now() + 5 * 60e3 : 0 });
    };
    const needDirAdmin = () => {
      if (!(dirPerson?.admin || (isLocal(req) && !directory.people.length))) throw new HttpError(403, { ar: 'لمدير الدليل فقط', en: 'For the directory administrator only' });
    };
    const publicPerson = (p: DirPerson) => ({ id: p.id, name: p.name, admin: p.admin, active: p.active, mustChange: p.mustChange, grants: p.grants });
    /** the profile of a database this person enters as: the one chosen, else (for the administrator) its Superior */
    const dirProfile = async (p: DirPerson, c: Centre): Promise<Profile | null> => {
      const linked = p.grants[c.slug];
      if (typeof linked === 'number') return loadProfile(c.handle.db, linked);
      if (!p.admin && !Object.prototype.hasOwnProperty.call(p.grants, c.slug)) return null;
      for (const q of await listProfiles(c.handle.db)) {
        const pr = await loadProfile(c.handle.db, q.id);
        if (pr && has(pr, 'users.manage')) return pr;
      }
      return null;
    };

    if (url === '/api/dir/setup' && method === 'POST') {
      // the very first person: the administrator, made on the server computer itself
      if (directory.people.length) throw new HttpError(409, { ar: 'الدليل مُعدّ مسبقاً', en: 'The directory is already set up' });
      if (!isLocal(req)) throw new HttpError(403, { ar: 'الإعداد من حاسوب الخادم نفسه', en: 'Setup only from the server computer itself' });
      const body = (await readBody(req)) as { name?: string; password?: string };
      const name = String(body.name ?? '').trim();
      if (!name) throw new HttpError(400, { ar: 'اكتب الاسم', en: 'Write the name' });
      checkSecretShape(String(body.password ?? ''));
      const salt = randomBytes(16).toString('base64url');
      directory = { enforced: false, next: 2, people: [{ id: 1, name, salt, hash: await hashSecret(salt, String(body.password)), admin: true, active: true, mustChange: false, grants: {} }] };
      writeDirectory(dataDir, directory);
      const token = randomBytes(32).toString('base64url');
      dirSessions.set(token, { id: 1, last: Date.now() });
      log(`directory set up: administrator ${name}`);
      return send(res, 200, { ok: true }, { 'Set-Cookie': dirCookieSet(token, viaHttps) });
    }
    if (url === '/api/dir/login' && method === 'POST') {
      dirTooMany();
      const body = (await readBody(req)) as { name?: string; password?: string };
      const name = String(body.name ?? '').trim().toLowerCase();
      const p = directory.people.find((q) => q.active && q.name.toLowerCase() === name);
      const ok = p ? (await verifySecret(p.salt, String(body.password ?? ''), p.hash)).ok : false;
      if (!p || !ok) {
        dirFail();
        log(`failed directory sign-in from ${ip}`);
        throw new HttpError(403, { ar: 'الاسم أو كلمة السر غير صحيحة', en: 'The name or the password is not right' });
      }
      failures.delete(ip);
      const token = randomBytes(32).toString('base64url');
      dirSessions.set(token, { id: p.id, last: Date.now() });
      log(`directory sign-in: ${p.name} from ${ip}`);
      return send(res, 200, { person: publicPerson(p) }, { 'Set-Cookie': dirCookieSet(token, viaHttps) });
    }
    if (url === '/api/dir/logout' && method === 'POST') {
      const t = dirCookie(req);
      if (t) dirSessions.delete(t);
      if (found) sessions.delete(found[0]);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'magis_dir=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (url === '/api/dir/password' && method === 'POST') {
      if (!dirPerson) throw new HttpError(401, { ar: 'سجّل الدخول', en: 'Please log in' });
      dirTooMany();
      const body = (await readBody(req)) as { old?: string; password?: string };
      if (!(await verifySecret(dirPerson.salt, String(body.old ?? ''), dirPerson.hash)).ok) {
        dirFail();
        throw new HttpError(403, { ar: 'كلمة السر الحالية غير صحيحة', en: 'The current password is not right' });
      }
      checkSecretShape(String(body.password ?? ''));
      const salt = randomBytes(16).toString('base64url');
      dirPerson.salt = salt;
      dirPerson.hash = await hashSecret(salt, String(body.password));
      dirPerson.mustChange = false;
      writeDirectory(dataDir, directory);
      log(`directory: ${dirPerson.name} changed their password`);
      return send(res, 200, { ok: true });
    }
    if (url === '/api/dir/enter' && method === 'POST') {
      if (!dirPerson) throw new HttpError(401, { ar: 'سجّل الدخول', en: 'Please log in' });
      if (dirPerson.mustChange) throw new HttpError(403, { ar: 'غيّر كلمة السر أولاً', en: 'Change your password first' });
      const body = (await readBody(req)) as { db?: string };
      const c = centreOf(body.db);
      if (!dirSees(dirPerson, c.slug)) throw new HttpError(403, { ar: 'لا إذن لك في قاعدة البيانات هذه', en: 'You have no access to this database' });
      if (await setupNeeded(c)) throw new HttpError(409, { ar: 'لم تُعدّ هذه القاعدة بعد', en: 'This database is not set up yet' });
      const profile = await dirProfile(dirPerson, c);
      if (!profile) throw new HttpError(403, { ar: 'لا حساب لك في هذه القاعدة. اطلب من المدير ربطه.', en: 'You have no account in this database. Ask the administrator to link one.' });
      if (found) sessions.delete(found[0]);
      const sid = randomBytes(32).toString('base64url');
      sessions.set(sid, { db: c.slug, profile, mustChange: false, last: Date.now(), ip });
      log(`directory entry ${c.slug}: ${dirPerson.name} as ${profile.name} from ${ip}`);
      return send(res, 200, { profile, mustChange: false, install: 'office' }, { 'Set-Cookie': `magis_sid=${sid}; HttpOnly; SameSite=Strict; Path=/${viaHttps ? '; Secure' : ''}` });
    }
    if (url === '/api/dir/people' && method === 'GET') {
      needDirAdmin();
      const dbs = await Promise.all([...centres.values()].filter((x) => ctyOpen() || !ctyKinds.get(x.slug)).map(async (x) => ({ ...(await describe(x)), profiles: (await listProfiles(x.handle.db)).map((q) => ({ id: q.id, name: q.name, access_name: q.access_name, office: q.office ?? null })) })));
      return send(res, 200, { people: directory.people.map(publicPerson), enforced: directory.enforced, dbs: dbs.map((d) => ({ slug: d.slug, organisation: d.organisation, kind: d.kind, profiles: d.profiles })) });
    }
    if (url === '/api/dir/save' && method === 'POST') {
      needDirAdmin();
      const body = (await readBody(req)) as { id?: number | null; name?: string; admin?: boolean; active?: boolean; password?: string; grants?: Record<string, number | null> };
      const name = String(body.name ?? '').trim();
      if (!name) throw new HttpError(400, { ar: 'اكتب الاسم', en: 'Write the name' });
      if (directory.people.some((q) => q.id !== body.id && q.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, { ar: 'هذا الاسم موجود', en: 'This name already exists' });
      const grants: Record<string, number | null> = {};
      for (const [slug, link] of Object.entries(body.grants ?? {})) {
        const cc = centres.get(slug);
        if (!cc) continue;
        if (typeof link === 'number' && !(await loadProfile(cc.handle.db, link))) throw new HttpError(400, { ar: 'حساب غير موجود في القاعدة', en: 'That account does not exist in the database' });
        grants[slug] = typeof link === 'number' ? link : null;
      }
      let p = directory.people.find((q) => q.id === body.id);
      const wasAdmin = !!p?.admin && p.active;
      const admin = !!body.admin, active = body.active !== false;
      if (wasAdmin && (!admin || !active) && directory.people.filter((q) => q.admin && q.active && q.id !== p!.id).length === 0)
        throw new HttpError(409, { ar: 'يجب أن يبقى مدير واحد على الأقل', en: 'There must stay at least one administrator' });
      if (!p) {
        checkSecretShape(String(body.password ?? ''));
        const salt = randomBytes(16).toString('base64url');
        p = { id: directory.next++, name, salt, hash: await hashSecret(salt, String(body.password)), admin, active, mustChange: true, grants };
        directory.people.push(p);
      } else {
        p.name = name; p.admin = admin; p.active = active; p.grants = grants;
        if (body.password) {
          checkSecretShape(String(body.password));
          p.salt = randomBytes(16).toString('base64url');
          p.hash = await hashSecret(p.salt, String(body.password));
          p.mustChange = true; // a password given by the administrator is replaced at the next sign-in
        }
      }
      writeDirectory(dataDir, directory);
      // an inactive person, or one with fewer databases, is out at once
      for (const [t, x] of dirSessions) if (x.id === p.id && !p.active) dirSessions.delete(t);
      log(`directory: ${dirPerson?.name ?? 'the server computer'} saved ${p.name}`);
      return send(res, 200, { person: publicPerson(p) });
    }
    if (url === '/api/dir/enforce' && method === 'POST') {
      needDirAdmin();
      const body = (await readBody(req)) as { enforced?: boolean };
      directory.enforced = !!body.enforced;
      writeDirectory(dataDir, directory);
      log(`directory ${directory.enforced ? 'enforced' : 'not enforced'}`);
      return send(res, 200, { ok: true });
    }
    if (url === '/api/dir/reset' && method === 'POST') {
      // forgot: on the server computer, with the password of the Superior of any database
      if (!isLocal(req)) throw new HttpError(403, { ar: 'من حاسوب الخادم نفسه', en: 'From the server computer itself' });
      const body = (await readBody(req)) as { name?: string; password?: string; superior?: string };
      const p = directory.people.find((q) => q.name.toLowerCase() === String(body.name ?? '').trim().toLowerCase());
      if (!p) throw new HttpError(404, { ar: 'الاسم غير موجود', en: 'Name not found' });
      let who: string | null = null;
      for (const cc of centres.values()) {
        try { who = await needSuperior(cc, body.superior); break; } catch (e) { if (e instanceof HttpError && e.status === 429) throw e; }
      }
      if (!who) throw new HttpError(403, { ar: 'كلمة سر الرئيس غير صحيحة', en: "The Superior's password is not right" });
      checkSecretShape(String(body.password ?? ''));
      p.salt = randomBytes(16).toString('base64url');
      p.hash = await hashSecret(p.salt, String(body.password));
      p.mustChange = true;
      p.active = true;
      writeDirectory(dataDir, directory);
      log(`directory: password of ${p.name} reset on the server (password of ${who})`);
      return send(res, 200, { ok: true });
    }

    // ---- HR: fill the lists (centre, accounts, budget lines) from the budget of a centre database. Names and codes only.
    if (url === '/api/hr/sources' && method === 'GET') {
      if (!found || (await getMeta(found[2].handle.db, 'kind')) !== 'hr' || !has(found[1].profile, 'hr.manage')) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const out = [];
      for (const x of centres.values()) {
        if ((config.inactive ?? []).includes(x.slug)) continue;
        const k = (await getMeta(x.handle.db, 'kind')) ?? 'centre';
        if (k !== 'centre' || (dirPerson && !dirSees(dirPerson, x.slug))) continue;
        out.push({ slug: x.slug, organisation: (await getMeta(x.handle.db, 'organisation')) ?? x.slug });
      }
      return send(res, 200, out);
    }
    if (url === '/api/hr/import-lists' && method === 'POST') {
      if (!found || (await getMeta(found[2].handle.db, 'kind')) !== 'hr' || !has(found[1].profile, 'hr.manage')) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const body = (await readBody(req)) as { from?: string };
      const src = centres.get(String(body.from));
      if (!src || (config.inactive ?? []).includes(src.slug) || ((await getMeta(src.handle.db, 'kind')) ?? 'centre') !== 'centre' || (dirPerson && !dirSees(dirPerson, src.slug)))
        throw new HttpError(404, { ar: 'قاعدة المصدر غير موجودة', en: 'Source database not found' });
      const org = (await getMeta(src.handle.db, 'organisation')) ?? src.slug;
      const centreKey = (await getMeta(src.handle.db, 'centre')) ?? guessCentre(org);
      const CITY: Record<string, [string, string]> = { aleppo: ['حلب', 'Aleppo'], homs: ['حمص', 'Homs'], jaramana: ['جرمانا', 'Jaramana'] };
      const accounts = await src.handle.db.query<{ name: string }>('SELECT name FROM account WHERE active = 1 ORDER BY sort, name');
      const lines = await src.handle.db.query<{ name: string; code: string; heading: string }>('SELECT l.name, l.code, h.name AS heading FROM budget_line l JOIN heading h ON h.id = l.heading_id WHERE l.active = 1 AND h.active = 1 ORDER BY h.sort, l.code');
      const stmts: Stmt[] = [
        // the centre with its mark and city; the first party and who signs are filled for Aleppo from Fouad's agreement
        // (the others are written by hand in the Lists page)
        { sql: "INSERT OR IGNORE INTO hr_list (kind, name, code, source, city_ar, city_en, party_ar, rep_ar) VALUES ('centre', ?, ?, ?, ?, ?, ?, ?)", params: [org, centreKey, src.slug, CITY[centreKey]?.[0] ?? null, CITY[centreKey]?.[1] ?? null, centreKey === 'aleppo' ? 'دير الآباء اليسوعيين في حلب' : null, centreKey === 'aleppo' ? 'الأب فؤاد نخلة اليسوعي' : null] },
        ...accounts.map((a) => ({ sql: "INSERT OR IGNORE INTO hr_list (kind, name, source) VALUES ('account', ?, ?)", params: [a.name, src.slug] })),
        ...lines.map((l) => ({ sql: "INSERT OR IGNORE INTO hr_list (kind, name, code, heading, source) VALUES ('line', ?, ?, ?, ?)", params: [l.name, l.code, l.heading, src.slug] })),
      ];
      // what the centre no longer has (a line or an account switched off or removed) leaves the HR lists too
      stmts.push(
        { sql: `DELETE FROM hr_list WHERE kind = 'line' AND source = ? AND (code || '|' || name) NOT IN (${lines.map(() => '?').join(',') || "''"})`, params: [src.slug, ...lines.map((l) => `${l.code}|${l.name}`)] },
        { sql: `DELETE FROM hr_list WHERE kind = 'account' AND source = ? AND name NOT IN (${accounts.map(() => '?').join(',') || "''"})`, params: [src.slug, ...accounts.map((a) => a.name)] },
      );
      // the heading that holds the salaries, and the centre's usual account (its default in the accounts), when not set yet
      const hs = lines.map((l) => l.heading);
      const salaryHeading = hs.find((h) => /staff/i.test(h) && /salar/i.test(h)) ?? hs.find((h) => /salar|رات/i.test(h)) ?? hs.find((h) => /staff/i.test(h)) ?? null;
      const defAcc = await one<{ name: string }>(src.handle.db, "SELECT a.name FROM account a JOIN setting s ON s.key = 'def_account_id' AND CAST(s.value AS INTEGER) = a.id");
      stmts.push({ sql: "UPDATE hr_list SET salary_heading = COALESCE(salary_heading, ?), account = COALESCE(account, ?) WHERE kind = 'centre' AND source = ?", params: [salaryHeading, defAcc?.name ?? accounts[0]?.name ?? null, src.slug] });
      await found[2].handle.db.batch(stmts);
      found[2].version++;
      log(`HR lists filled from ${src.slug}: ${accounts.length} accounts, ${lines.length} lines (by ${found[1].profile.name})`);
      return send(res, 200, { centres: 1, accounts: accounts.length, lines: lines.length });
    }

    // ---- HR: an approved payroll run goes into the accounts of each centre (Fouad, 30 October 2026). Totals only: one
    // expense per account, budget line and currency, in the centre's Main book, with no names. Nobody types it twice.
    const hrApprover = async () => {
      if (!found || (await getMeta(found[2].handle.db, 'kind')) !== 'hr' || !has(found[1].profile, 'hr.approve')) throw new HttpError(403, { ar: 'لمن يعتمد الكشوف فقط', en: 'For the person who approves the payroll only' });
      return found;
    };
    if (url === '/api/hr/send-run' && method === 'POST') {
      const [, hs, hc] = await hrApprover();
      const hdb = hc.handle.db;
      // one centre at a time (body.centre), so a centre that is ready is not held back by another
      const body = (await readBody(req)) as { runId?: number; centre?: string };
      const run = await one<{ id: number; ym: string; kind: string; status: string; paid_on: string | null }>(hdb, 'SELECT id, ym, kind, status, paid_on FROM hr_run WHERE id = ?', [Number(body.runId)]);
      if (!run) throw new HttpError(404, { ar: 'الكشف غير موجود', en: 'Run not found' });
      if (run.status === 'draft') throw new HttpError(400, { ar: 'اعتمد الكشف أولاً', en: 'Approve the run first' });
      const lists = await hdb.query<HrListItem>('SELECT * FROM hr_list');
      const people = await hdb.query<HrPerson>('SELECT * FROM hr_person');
      const allocs = await hdb.query<HrAlloc>('SELECT person_id, valid_from, target, pct FROM hr_alloc');
      const lines = await hdb.query<{ person_id: number; paid_in: 'USD' | 'SYP'; amount_paid: number; total_usd: number }>('SELECT person_id, paid_in, amount_paid, total_usd FROM hr_run_line WHERE run_id = ?', [run.id]);
      const sent = new Set((await hdb.query<{ centre: string }>('SELECT centre FROM hr_run_sent WHERE run_id = ?', [run.id])).map((x) => x.centre));
      const last = `${run.ym}-${String(new Date(Date.UTC(Number(run.ym.slice(0, 4)), Number(run.ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
      // every line: its centre, its account (the donor split, when it names accounts of the centre) and its budget line
      type Part = { account: string; line: string; cur: 'USD' | 'SYP'; amount: number; usd: number; person: number };
      const byCentre = new Map<string, Part[]>();
      const missing: string[] = [];
      for (const l of lines) {
        const p = people.find((x) => x.id === l.person_id);
        const who = p ? p.name : `#${l.person_id}`;
        const c = p ? centreItem(lists, p) : null;
        if (body.centre && c?.source !== body.centre) continue;
        if (!p || !c?.source) { missing.push(`${who}: centre`); continue; }
        const line = lineFor(lists, p).line;
        const own = accountFor(lists, p);
        if (!line) missing.push(`${who}: budget line`);
        const split = allocOn(allocs, p.id, last);
        const accs = lists.filter((x) => x.kind === 'account' && x.source === c.source).map((x) => x.name);
        const parts = split.length && split.every((x) => accs.some((a) => a.toLowerCase() === x.target.toLowerCase())) ? split.map((x) => ({ acc: accs.find((a) => a.toLowerCase() === x.target.toLowerCase())!, pct: x.pct })) : own ? [{ acc: own, pct: 100 }] : [];
        if (!parts.length) missing.push(`${who}: account`);
        if (!line || !parts.length) continue;
        const amounts = splitAmount(l.amount_paid, parts, l.paid_in === 'SYP' ? 0 : 2), usds = splitAmount(l.total_usd, parts);
        parts.forEach((x, i) => byCentre.set(c.source!, [...(byCentre.get(c.source!) ?? []), { account: x.acc, line: line.code ?? line.name, cur: l.paid_in, amount: amounts[i], usd: usds[i], person: p.id }]));
      }
      if (missing.length) throw new HttpError(400, { ar: `ينقص: ${missing.join('، ')}`, en: `Missing: ${missing.join(' · ')}` });
      const done: { centre: string; rows: number; total_usd: number }[] = [];
      for (const [slug, parts] of byCentre) {
        if (sent.has(slug)) continue;
        const cc = centres.get(slug);
        if (!cc) throw new HttpError(404, { ar: `قاعدة المركز غير موجودة: ${slug}`, en: `Centre database not found: ${slug}` });
        const cl = await loadLists(cc.handle.db);
        const book = cl.settings.def_book_id ?? cl.books.find((b) => b.is_main)?.id ?? null;
        const city = cl.settings.def_city_id ?? cl.cities[0]?.id ?? null;
        const groups = new Map<string, { account: string; line: string; cur: 'USD' | 'SYP'; amount: number; usd: number; people: Set<number> }>();
        for (const x of parts) {
          const k = JSON.stringify([x.account, x.line, x.cur]);
          const g = groups.get(k) ?? { account: x.account, line: x.line, cur: x.cur, amount: 0, usd: 0, people: new Set<number>() };
          g.amount += x.amount; g.usd += x.usd; g.people.add(x.person);
          groups.set(k, g);
        }
        const what = run.kind === 'thirteenth' ? `13th payment ${run.ym.slice(0, 4)} · الدفعة الثالثة عشرة` : `Stipends ${run.ym} · مكافآت`;
        const rows = [...groups.values()].map((g) => {
          const acc = cl.accounts.find((a) => a.name.toLowerCase() === g.account.toLowerCase());
          const bl = cl.lines.find((l) => l.code === g.line) ?? cl.lines.find((l) => l.name === g.line);
          if (!acc || !bl) throw new HttpError(400, { ar: `غير موجود في حسابات ${slug}: ${!acc ? g.account : g.line}`, en: `Not in the accounts of ${slug}: ${!acc ? g.account : g.line}` });
          return { ...blankTrx(), date: run.paid_on ?? last, type: 'Exp' as const, book_id: book, city_id: city, account_id: acc.id, heading_id: bl.heading_id, line_id: bl.id,
            explanation: `${what} · HR (${g.people.size})`, exp_syp: g.cur === 'SYP' ? Math.round(g.amount) : 0, exp_usd: g.cur === 'USD' ? Math.round(g.amount * 100) / 100 : 0, source_file: `hr-run:${run.id}` };
        });
        const ctx: OpCtx = { db: cc.handle.db, profile: { id: 0, name: `HR · ${hs.profile.name}`, role: 'com', book_id: null, active: 1, access_id: null, access_name: 'HR', perms: ['register.edit', 'register.view'], books: [] }, who: `HR · ${hs.profile.name}`, install: 'office', files: cc.files };
        await runOp(ctx, 'trx.save', { rows });
        cc.version++;
        const total = Math.round(parts.reduce((a, x) => a + x.usd, 0) * 100) / 100;
        await hdb.batch([{ sql: 'INSERT INTO hr_run_sent (run_id, centre, sent_at, sent_by, trx_ids, total_usd) VALUES (?,?,?,?,?,?)', params: [run.id, slug, new Date().toISOString(), hs.profile.name, JSON.stringify(rows.map((r) => r.id)), total] }]);
        hc.version++;
        log(`HR run ${run.id} (${run.ym}) sent to ${slug}: ${rows.length} rows by ${hs.profile.name}`);
        done.push({ centre: slug, rows: rows.length, total_usd: total });
      }
      return send(res, 200, { sent: done });
    }
    if (url === '/api/hr/take-back' && method === 'POST') {
      const [, hs, hc] = await hrApprover();
      const body = (await readBody(req)) as { runId?: number; centre?: string };
      const row = await one<{ trx_ids: string }>(hc.handle.db, 'SELECT trx_ids FROM hr_run_sent WHERE run_id = ? AND centre = ?', [Number(body.runId), String(body.centre)]);
      const cc = centres.get(String(body.centre));
      if (!row || !cc) throw new HttpError(404, { ar: 'لم يُرسل', en: 'Not sent' });
      const ids = (JSON.parse(row.trx_ids) as string[]).filter(Boolean);
      const still = (await cc.handle.db.query<{ id: string }>(`SELECT id FROM trx WHERE id IN (${ids.map(() => '?').join(',') || "''"})`, ids)).map((x) => x.id);
      const ctx: OpCtx = { db: cc.handle.db, profile: { id: 0, name: `HR · ${hs.profile.name}`, role: 'com', book_id: null, active: 1, access_id: null, access_name: 'HR', perms: ['register.edit', 'register.view'], books: [] }, who: `HR · ${hs.profile.name}`, install: 'office', files: cc.files };
      if (still.length) await runOp(ctx, 'trx.delete', { ids: still, reason: 'payroll taken back by HR · سحبته الموارد البشرية' });
      cc.version++;
      await hc.handle.db.batch([{ sql: 'DELETE FROM hr_run_sent WHERE run_id = ? AND centre = ?', params: [Number(body.runId), String(body.centre)] }]);
      hc.version++;
      log(`HR run ${body.runId} taken back from ${body.centre} by ${hs.profile.name}`);
      return send(res, 200, { ok: true, removed: still.length });
    }

    // ---- a new database (a centre, a test, a new year…)
    if (url === '/api/dbs/create' && method === 'POST') {
      const body = (await readBody(req)) as { organisation?: string; centre?: string; color?: string | null; logo?: string | null; kind?: string | null };
      if (!(isCtyKind(body.kind) ? mayCreateCty() : mayCreate(req, found))) throw new HttpError(403, { ar: 'على حاسوب الخادم نفسه، أو لمن يدير المستخدمين', en: 'On the server computer itself, or by someone who manages users' });
      if (isCtyKind(body.kind) && !ctyOpen()) throw new HttpError(403, { ar: 'اكتب أولاً كلمة سر الجماعات', en: "First give the communities' password" });
      const organisation = (body.organisation ?? '').trim();
      if (!organisation) throw new HttpError(400, { ar: 'اكتب اسم قاعدة البيانات', en: 'Write the name of the database' });
      const centre = (CENTRE_KEYS as readonly string[]).includes(body.centre ?? '') ? (body.centre as CentreKey) : guessCentre(organisation);
      let slug = slugify(organisation);
      for (let i = 2; centres.has(slug) || fs.existsSync(path.join(dbsDir, slug)); i++) slug = `${slugify(organisation)}-${i}`;
      const c = await openCentre(slug);
      const color = body.color && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : null;
      const logo = body.logo && body.logo.startsWith('data:image/png;base64,') && body.logo.length < 400_000 ? body.logo : null;
      await c.handle.db.batch([
        setMetaStmt('organisation', organisation), setMetaStmt('centre', centre), setMetaStmt('install', 'office'),
        setMetaStmt('brand_color', color), setMetaStmt('brand_logo', logo),
        // made from the communities' side: it is a community (or a country) from the start, so it is
        // listed there and its setup goes straight to the community (or country) form
        ...(body.kind === 'community' || body.kind === 'country' || body.kind === 'hr' ? [setMetaStmt('kind', body.kind)] : []),
      ]);
      log(`new database ${slug} (${organisation}, ${centre})`);
      return send(res, 200, { slug });
    }

    // ---- setting up a new database: only while it has nobody
    if (url.startsWith('/api/setup/')) {
      const body = (await readBody(req)) as Record<string, string>;
      const c = centreOf(body.db);
      if (!(ctyKinds.get(c.slug) ? mayCreateCty() : mayCreate(req, found))) throw new HttpError(403, { ar: 'الإعداد من حاسوب الخادم نفسه', en: 'Setup only from the server computer itself' });
      needCtyOpen(c.slug);
      if (!(await setupNeeded(c))) throw new HttpError(409, { ar: 'قاعدة البيانات مُعدّة مسبقاً', en: 'This database is already set up' });
      if (url === '/api/setup/new') {
        const organisation = body.organisation || ((await getMeta(c.handle.db, 'organisation')) ?? '');
        await createOffice(c.handle.db, { organisation, supName: body.supName ?? '', supPin: body.supPin ?? '', comName: body.comName ?? '', comPin: body.comPin ?? '' });
        let report = null;
        if (body.workbook) {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(Buffer.from(body.workbook, 'base64'));
          report = await applySeed(c.handle.db, readWorkbook(wb), body.comName || 'setup', body.workbookName || 'workbook.xlsx');
        }
        c.version++;
        log(`setup: ${c.slug} (${organisation})`);
        return send(res, 200, { ok: true, report });
      }
      // the first community (or country) on this server sets the communities' password
      const firstGate = async () => {
        if (config.ctyGate) return null;
        const pw = String((body as { gate?: string }).gate ?? '');
        if (!pw) throw new HttpError(400, { ar: 'اختر كلمة سر لجانب الجماعات', en: "Choose a password for the communities' side" });
        checkSecretShape(pw);
        const salt = randomBytes(16).toString('base64url');
        return { salt, hash: await hashSecret(salt, pw) };
      };
      if (url === '/api/setup/hr') {
        const s = body as unknown as { organisation?: string; people?: { name: string; password: string }[]; mustChange?: boolean };
        await createHr(c.handle.db, { organisation: s.organisation || ((await getMeta(c.handle.db, 'organisation')) ?? ''), people: Array.isArray(s.people) ? s.people : [], mustChange: s.mustChange });
        c.version++;
        log(`setup: ${c.slug} (HR)`);
        return send(res, 200, { ok: true });
      }
      if (url === '/api/setup/community') {
        const gate = await firstGate();
        const s = body as unknown as CommunitySetup;
        await createCommunity(c.handle.db, { community: s.community || ((await getMeta(c.handle.db, 'organisation')) ?? ''), country: s.country ?? '', localCurrency: s.localCurrency ?? 'SYP', people: Array.isArray(s.people) ? s.people : [], offices: s.offices, hasBank: s.hasBank, mustChange: s.mustChange, style: s.style });
        c.version++;
        log(`setup: ${c.slug} (community)`);
        if (gate) { config = { ...config, ctyGate: gate }; writeConfig(dataDir, config); }
        return send(res, 200, { ok: true }, gate ? { 'Set-Cookie': ctyPassCookie(viaHttps) } : {});
      }
      if (url === '/api/setup/country') {
        const gate = await firstGate();
        const s = body as unknown as CountrySetup;
        await createCountry(c.handle.db, { country: s.country || ((await getMeta(c.handle.db, 'organisation')) ?? ''), localCurrency: s.localCurrency ?? 'SYP', people: Array.isArray(s.people) ? s.people : [], style: s.style });
        c.version++;
        log(`setup: ${c.slug} (country)`);
        if (gate) { config = { ...config, ctyGate: gate }; writeConfig(dataDir, config); }
        return send(res, 200, { ok: true }, gate ? { 'Set-Cookie': ctyPassCookie(viaHttps) } : {});
      }
      if (url === '/api/setup/upload-db') {
        await replaceDatabase(c, body.base64 ?? '');
        log(`setup: ${c.slug} from a desktop database`);
        return send(res, 200, { ok: true });
      }
    }

    const oldSignInClosed = () => {
      if (directory.enforced && !isLocal(req)) throw new HttpError(403, { ar: 'الدخول من الدليل: اكتب اسمك وكلمة سرك في الصفحة الأولى', en: 'Sign in through the directory: your name and password on the first page' });
    };
    if (url === '/api/profiles' && method === 'GET') {
      oldSignInClosed();
      const c = centreOf(query.get('db'));
      needCtyOpen(c.slug);
      const ps = await listProfiles(c.handle.db);
      return send(res, 200, ps.map((p) => ({ id: p.id, name: p.name, role: p.role, access_id: p.access_id ?? null, access_name: p.access_name, books: p.books ?? null, office: p.office ?? null, held_by: p.held_by ?? null })));
    }

    if (url === '/api/login' && method === 'POST') {
      oldSignInClosed();
      const f = failures.get(ip);
      if (f && f.until > Date.now())
        throw new HttpError(429, { ar: 'محاولات كثيرة — انتظر 5 دقائق', en: 'Too many attempts — wait 5 minutes' });
      const body = (await readBody(req)) as { db?: string; profileId?: number; password?: string };
      const c = centreOf(body.db);
      needCtyOpen(c.slug);
      try {
        const { profile, weak, given } = await login(c.handle.db, Number(body.profileId), String(body.password ?? ''));
        failures.delete(ip);
        if (found) sessions.delete(found[0]); // one session per browser
        const sid = randomBytes(32).toString('base64url');
        // An old 4-digit PIN, or a password given by the Superior, must be replaced first.
        const mustChange = weak || given;
        sessions.set(sid, { db: c.slug, profile, mustChange, last: Date.now(), ip });
        log(`login ${c.slug}: ${profile.name} (${profile.access_name}) from ${ip}`);
        return send(res, 200, { profile, mustChange, install: 'office' }, {
          'Set-Cookie': `magis_sid=${sid}; HttpOnly; SameSite=Strict; Path=/${viaHttps ? '; Secure' : ''}`,
        });
      } catch (e) {
        // count again from zero only once a past 5-minute block is over
        const n = f && f.until > 0 && f.until <= Date.now() ? 1 : (f?.n ?? 0) + 1;
        failures.set(ip, { n, until: n >= 8 ? Date.now() + 5 * 60e3 : 0 });
        log(`failed login from ${ip}`);
        throw e;
      }
    }

    if (url === '/api/logout') {
      if (found) sessions.delete(found[0]);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'magis_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (url === '/api/me')
      return send(res, found ? 200 : 401, found ? { profile: found[1].profile, mustChange: found[1].mustChange, db: found[1].db } : { error: { ar: 'سجّل الدخول', en: 'Please log in' } });
    if (!found) throw new HttpError(401, { ar: 'سجّل الدخول', en: 'Please log in' });
    const [, s, c] = found;

    if (url === '/api/version') return send(res, 200, { v: c.version });

    if (url === '/api/server/status' && method === 'GET') {
      if (!has(s.profile, 'data.backup') && !has(s.profile, 'users.manage')) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const backups = await c.files.list();
      return send(res, 200, {
        version: SERVER_VERSION,
        addresses: lanAddresses().map((a) => (secure() ? `https://${a}:${config.httpsPort}` : `http://${a}:${config.httpPort}`)),
        hostname: os.hostname(),
        dataDir: c.dir,
        dbSize: fs.statSync(c.file).size,
        lastBackup: backups[0] ?? null,
        backupCount: backups.length,
        backupMirror: config.backupMirror,
        idleMinutes: config.idleMinutes,
        mirrorOk: config.backupMirror ? fs.existsSync(config.backupMirror) : null,
        users: [...new Set([...sessions.values()].filter((x) => x.db === c.slug && Date.now() - x.last < 15 * 60e3).map((x) => x.profile.name))],
        startedAt,
      });
    }
    if (url === '/api/server/restore-upload' && method === 'POST') {
      if (!has(s.profile, 'data.restore')) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const body = (await readBody(req)) as { base64?: string; fileName?: string };
      await c.files.backupNow('before-restore');
      await replaceDatabase(c, body.base64 ?? '');
      log(`restored ${c.slug} from uploaded file ${body.fileName ?? ''} by ${s.profile.name}`);
      return send(res, 200, { ok: true });
    }
    if (url === '/api/server/config' && method === 'POST') {
      if (!has(s.profile, 'users.manage')) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const body = (await readBody(req)) as { backupMirror?: string | null; idleMinutes?: number };
      if (body.idleMinutes !== undefined) {
        const n = Math.round(Number(body.idleMinutes));
        if (!(n >= 1 && n <= 480)) throw new HttpError(400, { ar: 'بين 1 و480 دقيقة', en: 'Between 1 and 480 minutes' });
        config = { ...config, idleMinutes: n };
        log(`idle sign-out set to ${n} min`);
      }
      if (body.backupMirror !== undefined) {
        const mirror = body.backupMirror?.trim() || null;
        config = { ...config, backupMirror: mirror };
        log(`backup mirror set to ${mirror}`);
      }
      writeConfig(dataDir, config);
      return send(res, 200, { ok: true });
    }

    const op = /^\/api\/op\/([\w.]+)$/.exec(url)?.[1];
    if (op && method === 'POST') {
      if (s.mustChange && op !== 'profile.setPin')
        throw new HttpError(403, { ar: 'غيّر كلمة السر أولاً', en: 'Change your password first' });
      const args = await readBody(req);
      const ctx: OpCtx = { db: c.handle.db, profile: s.profile, who: s.profile.name, install: 'office', files: c.files };
      const result = await runOp(ctx, op, args);
      if (op === 'profile.setPin' && (args as { id?: number }).id === s.profile.id) s.mustChange = false;
      if (!READ_ONLY.has(op)) c.version++;
      // A restored database may hold other users: everybody of that database logs in again.
      if (op === 'backup.restore') for (const [sid, x] of sessions) if (x.db === c.slug) sessions.delete(sid);
      return send(res, 200, result);
    }
    throw new HttpError(404, { ar: 'غير موجود', en: 'Not found' });
  };

  const startedAt = new Date().toISOString();

  const handler = (viaHttps: boolean) => async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const [url, qs] = (req.url ?? '/').split('?');
    try {
      if (url.startsWith('/api/')) await api(req, res, url, new URLSearchParams(qs ?? ''), viaHttps);
      else serveStatic(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.msg });
      if (e && typeof e === 'object' && 'msg' in e) return send(res, 400, { error: (e as { msg: Msg }).msg }); // UserError: a refused action
      log(`error ${url}: ${e instanceof Error ? e.stack : e}`);
      send(res, 500, { error: { ar: 'خطأ في الخادم', en: 'Server error' } });
    }
  };

  // ---------------------------------------------------------------- listen
  const servers: http.Server[] = [];
  let httpsPort: number | null = null;
  let httpPort: number | null = null;
  const listen = (srv: http.Server, port: number) =>
    new Promise<number>((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(port, '0.0.0.0', () => resolve((srv.address() as { port: number }).port));
    });

  if (config.httpsPort >= 0 && config.httpMode !== 'serve') {
    const tls = await certificate(dataDir);
    const srv = https.createServer({ key: tls.key, cert: tls.cert }, handler(true));
    httpsPort = await listen(srv, config.httpsPort);
    servers.push(srv);
  }
  if (config.httpMode !== 'off') {
    const srv = http.createServer((req, res) => {
      if (config.httpMode === 'serve') return handler(false)(req, res);
      const host = (req.headers.host ?? 'localhost').replace(/:\d+$/, '');
      // 307, not 301: a browser must not remember the redirect for ever (the mode can change)
      res.writeHead(307, { Location: `https://${host}:${httpsPort}${req.url ?? '/'}` });
      res.end();
    });
    httpPort = await listen(srv, config.httpPort);
    servers.push(srv);
  }

  log(`MAGIS server ${SERVER_VERSION} · data ${dataDir} · ${centres.size} database(s)`);
  for (const a of lanAddresses()) log(`open: ${httpsPort ? `https://${a}:${httpsPort}` : `http://${a}:${httpPort}`}`);

  return {
    dataDir,
    httpsPort,
    httpPort,
    close: async () => {
      clearInterval(dailyTimer);
      await Promise.all(servers.map((srv) => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); })));
      for (const c of centres.values()) c.handle.close();
    },
  };
}
