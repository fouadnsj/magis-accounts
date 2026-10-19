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
import { getMeta, setMetaStmt } from '../src/db/repo';
import { has, listProfiles, loadProfile, login, type Profile } from '../src/auth';
import { READ_ONLY, runOp, type BackupFile, type FileOps, type OpCtx } from '../src/ops';
import { createOffice } from '../src/setup';
import { createCommunity, type CommunitySetup } from '../src/community/setup';
import { createCountry, type CountrySetup } from '../src/community/country';
import { applySeed, readWorkbook } from '../src/io/importWorkbook';
import type { Msg } from '../src/i18n';
import type { Trx } from '../src/domain/types';

export const SERVER_VERSION = '0.7.0';

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
    if (!c) throw new HttpError(404, { ar: 'قاعدة البيانات غير موجودة', en: 'Database not found' });
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

    if (url === '/api/hello' && method === 'GET') {
      const dbs = await Promise.all([...centres.values()].map(describe));
      dbs.sort((a, b) => CENTRE_KEYS.indexOf(a.centre) - CENTRE_KEYS.indexOf(b.centre) || a.organisation.localeCompare(b.organisation));
      return send(res, 200, { server: true, version: SERVER_VERSION, local: isLocal(req), canCreate: mayCreate(req, found), dbs, current: found ? found[1].db : null, idleMinutes: config.idleMinutes });
    }

    // ---- a new database (a centre, a test, a new year…)
    if (url === '/api/dbs/create' && method === 'POST') {
      if (!mayCreate(req, found)) throw new HttpError(403, { ar: 'على حاسوب الخادم نفسه، أو لمن يدير المستخدمين', en: 'On the server computer itself, or by someone who manages users' });
      const body = (await readBody(req)) as { organisation?: string; centre?: string; color?: string | null; logo?: string | null; kind?: string | null };
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
        ...(body.kind === 'community' || body.kind === 'country' ? [setMetaStmt('kind', body.kind)] : []),
      ]);
      log(`new database ${slug} (${organisation}, ${centre})`);
      return send(res, 200, { slug });
    }

    // ---- setting up a new database: only while it has nobody
    if (url.startsWith('/api/setup/')) {
      if (!mayCreate(req, found)) throw new HttpError(403, { ar: 'الإعداد من حاسوب الخادم نفسه', en: 'Setup only from the server computer itself' });
      const body = (await readBody(req)) as Record<string, string>;
      const c = centreOf(body.db);
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
      if (url === '/api/setup/community') {
        const s = body as unknown as CommunitySetup;
        await createCommunity(c.handle.db, { community: s.community || ((await getMeta(c.handle.db, 'organisation')) ?? ''), country: s.country ?? '', localCurrency: s.localCurrency ?? 'SYP', people: Array.isArray(s.people) ? s.people : [], offices: s.offices, hasBank: s.hasBank, mustChange: s.mustChange, style: s.style });
        c.version++;
        log(`setup: ${c.slug} (community)`);
        return send(res, 200, { ok: true });
      }
      if (url === '/api/setup/country') {
        const s = body as unknown as CountrySetup;
        await createCountry(c.handle.db, { country: s.country || ((await getMeta(c.handle.db, 'organisation')) ?? ''), localCurrency: s.localCurrency ?? 'SYP', people: Array.isArray(s.people) ? s.people : [], style: s.style });
        c.version++;
        log(`setup: ${c.slug} (country)`);
        return send(res, 200, { ok: true });
      }
      if (url === '/api/setup/upload-db') {
        await replaceDatabase(c, body.base64 ?? '');
        log(`setup: ${c.slug} from a desktop database`);
        return send(res, 200, { ok: true });
      }
    }

    if (url === '/api/profiles' && method === 'GET') {
      const c = centreOf(query.get('db'));
      const ps = await listProfiles(c.handle.db);
      return send(res, 200, ps.map((p) => ({ id: p.id, name: p.name, role: p.role, access_id: p.access_id ?? null, access_name: p.access_name, books: p.books ?? null, office: p.office ?? null, held_by: p.held_by ?? null })));
    }

    if (url === '/api/login' && method === 'POST') {
      const f = failures.get(ip);
      if (f && f.until > Date.now())
        throw new HttpError(429, { ar: 'محاولات كثيرة — انتظر 5 دقائق', en: 'Too many attempts — wait 5 minutes' });
      const body = (await readBody(req)) as { db?: string; profileId?: number; password?: string };
      const c = centreOf(body.db);
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
