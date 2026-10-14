// MAGIS Accounts — the centre's server on the local network.
//
// One computer in the centre (the mini-PC) runs this program. It keeps the only
// database, serves the screens to every browser on the LAN (computers and
// phones), checks every password and every permission, and backs up every day.
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
import { type Db, type Row, type SqlValue, type Stmt, migrate, one } from '../src/db/db';
import { getMeta } from '../src/db/repo';
import { listProfiles, login, type Profile } from '../src/auth';
import { READ_ONLY, runOp, type BackupFile, type FileOps, type OpCtx } from '../src/ops';
import { createOffice } from '../src/setup';
import { applySeed, readWorkbook } from '../src/io/importWorkbook';
import type { Msg } from '../src/i18n';

export const SERVER_VERSION = '0.2.0';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

// ---------------------------------------------------------------- configuration

export interface ServerConfig {
  httpsPort: number;
  httpPort: number;
  /** 'redirect': plain http only sends people to https. 'serve': plain http works too (tests, or a staff-only network). */
  httpMode: 'redirect' | 'serve' | 'off';
  /** A second folder (USB key / external disk) that receives a copy of every backup. */
  backupMirror: string | null;
}

const DEFAULT_CONFIG: ServerConfig = { httpsPort: 8443, httpPort: 8080, httpMode: 'redirect', backupMirror: null };

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

// ---------------------------------------------------------------- the server

interface Session {
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

const SESSION_IDLE_MS = 12 * 3600e3;
const MAX_BODY = 40 * 1024 * 1024;

class HttpError extends Error {
  constructor(public status: number, public msg: Msg) {
    super(msg.en);
  }
}

export async function startServer(opts: StartOptions = {}): Promise<Running> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const log = opts.log ?? ((m: string) => console.log(`[${new Date().toISOString()}] ${m}`));
  fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
  let config = { ...readConfig(dataDir), ...opts.config };
  if (!fs.existsSync(path.join(dataDir, 'config.json'))) writeConfig(dataDir, config);

  const dbFile = path.join(dataDir, 'magis.db');
  let handle = openDb(dbFile);
  await migrate(handle.db);
  const webRoot = opts.webRoot ?? path.join(path.dirname(process.argv[1] ?? '.'), 'web');

  /** Goes up by one after every change: browsers ask for it to know when to reload. */
  let version = 1;
  const sessions = new Map<string, Session>();
  const failures = new Map<string, { n: number; until: number }>();

  const setupNeeded = async () => !(await one(handle.db, 'SELECT 1 FROM profile WHERE active = 1 LIMIT 1'));
  const organisation = async () => (await getMeta(handle.db, 'organisation')) ?? '';

  // ---------------------------------------------------------------- backups
  const backupsDir = path.join(dataDir, 'backups');
  const stamp = () => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };
  const files: FileOps = {
    async backupNow(reason) {
      const dest = path.join(backupsDir, `magis_${stamp()}_${reason.replace(/[^\w-]/g, '')}.db`);
      await handle.db.query('VACUUM INTO ?', [dest]);
      if (config.backupMirror) {
        try {
          fs.mkdirSync(config.backupMirror, { recursive: true });
          fs.copyFileSync(dest, path.join(config.backupMirror, path.basename(dest)));
        } catch (e) {
          log(`backup mirror failed (${config.backupMirror}): ${e}`);
        }
      }
      log(`backup ${path.basename(dest)}`);
      return dest;
    },
    async list(): Promise<BackupFile[]> {
      return fs
        .readdirSync(backupsDir)
        .filter((f) => f.endsWith('.db'))
        .map((name) => {
          const st = fs.statSync(path.join(backupsDir, name));
          return { name, path: name, size: st.size, modified: st.mtimeMs };
        })
        .sort((a, b) => b.modified - a.modified);
    },
    async restore(name) {
      // Only a file of the backups folder, by its bare name: never a path from the browser.
      const base = path.basename(name);
      const from = path.join(backupsDir, base);
      if (base !== name || !fs.existsSync(from)) throw new HttpError(400, { ar: 'نسخة غير موجودة', en: 'Backup not found' });
      await files.backupNow('before-restore');
      handle.close();
      fs.copyFileSync(from, dbFile);
      handle = openDb(dbFile);
      await migrate(handle.db);
      version++;
      log(`restored ${base}`);
    },
  };

  const dailyBackup = async () => {
    const today = stamp().slice(0, 10);
    const all = await files.list();
    if (await setupNeeded()) return;
    if (all.some((b) => b.name.startsWith(`magis_${today}`) && b.name.endsWith('_daily.db'))) return;
    await files.backupNow('daily');
    const daily = (await files.list()).filter((b) => b.name.endsWith('_daily.db'));
    for (const old of daily.slice(60)) fs.rmSync(path.join(backupsDir, old.name), { force: true });
  };
  await dailyBackup().catch((e) => log(`daily backup failed: ${e}`));
  const dailyTimer = setInterval(() => dailyBackup().catch((e) => log(`daily backup failed: ${e}`)), 3600e3);

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

  /** The person behind this request, re-read from the database (a deactivated user is out at once). */
  const sessionOf = async (req: http.IncomingMessage): Promise<[string, Session] | null> => {
    const sid = cookie(req);
    const s = sid ? sessions.get(sid) : undefined;
    if (!sid || !s) return null;
    if (Date.now() - s.last > SESSION_IDLE_MS) {
      sessions.delete(sid);
      return null;
    }
    const p = await one<Profile>(handle.db, 'SELECT id, name, role, book_id, active FROM profile WHERE id = ? AND active = 1', [s.profile.id]);
    if (!p) {
      sessions.delete(sid);
      return null;
    }
    s.profile = p;
    s.last = Date.now();
    return [sid, s];
  };

  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body === undefined ? null : body));
  };

  const SEC_HEADERS: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
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

  // ---------------------------------------------------------------- API
  const api = async (req: http.IncomingMessage, res: http.ServerResponse, url: string, viaHttps: boolean) => {
    const method = req.method ?? 'GET';
    const ip = ipOf(req);

    if (url === '/api/hello' && method === 'GET')
      return send(res, 200, { server: true, organisation: await organisation(), setupNeeded: await setupNeeded(), local: isLocal(req), version: SERVER_VERSION });

    // ---- first setup: only from the server computer itself, only while nobody exists
    if (url.startsWith('/api/setup/')) {
      if (!isLocal(req)) throw new HttpError(403, { ar: 'الإعداد من حاسوب الخادم نفسه فقط', en: 'Setup only from the server computer itself' });
      if (!(await setupNeeded())) throw new HttpError(409, { ar: 'الخادم مُعدّ مسبقاً', en: 'The server is already set up' });
      const body = (await readBody(req)) as Record<string, string>;
      if (url === '/api/setup/new') {
        await createOffice(handle.db, { organisation: body.organisation ?? '', supName: body.supName ?? '', supPin: body.supPin ?? '', comName: body.comName ?? '', comPin: body.comPin ?? '' });
        let report = null;
        if (body.workbook) {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(Buffer.from(body.workbook, 'base64'));
          report = await applySeed(handle.db, readWorkbook(wb), body.comName || 'setup', body.workbookName || 'workbook.xlsx');
        }
        version++;
        log(`setup: new database for ${body.organisation}`);
        return send(res, 200, { ok: true, report });
      }
      if (url === '/api/setup/upload-db') {
        // A database made by the desktop app: checked in a temporary file before replacing.
        const tmp = path.join(dataDir, `upload-${Date.now()}.db`);
        fs.writeFileSync(tmp, Buffer.from(body.base64 ?? '', 'base64'));
        try {
          const test = openDb(tmp);
          await migrate(test.db);
          const install = await getMeta(test.db, 'install');
          const users = await one<{ c: number }>(test.db, 'SELECT COUNT(*) AS c FROM profile WHERE active = 1');
          test.close();
          if (install === 'holder') throw new HttpError(400, { ar: 'هذا ملف أمين صندوق، لا ملف المكتب', en: "This is a holder's file, not the office database" });
          if (!users?.c) throw new HttpError(400, { ar: 'لا مستخدمين في هذا الملف', en: 'No users in this file' });
        } catch (e) {
          fs.rmSync(tmp, { force: true });
          if (e instanceof HttpError) throw e;
          throw new HttpError(400, { ar: 'ليس ملف قاعدة بيانات صالحاً', en: 'Not a valid database file' });
        }
        handle.close();
        fs.copyFileSync(tmp, dbFile);
        fs.rmSync(tmp, { force: true });
        handle = openDb(dbFile);
        await migrate(handle.db);
        version++;
        log('setup: database uploaded from the desktop app');
        return send(res, 200, { ok: true });
      }
    }

    if (url === '/api/profiles' && method === 'GET') {
      const ps = await listProfiles(handle.db);
      return send(res, 200, ps.map((p) => ({ id: p.id, name: p.name, role: p.role })));
    }

    if (url === '/api/login' && method === 'POST') {
      const f = failures.get(ip);
      if (f && f.until > Date.now())
        throw new HttpError(429, { ar: 'محاولات كثيرة — انتظر 5 دقائق', en: 'Too many attempts — wait 5 minutes' });
      const body = (await readBody(req)) as { profileId?: number; password?: string };
      try {
        const { profile, weak } = await login(handle.db, Number(body.profileId), String(body.password ?? ''));
        failures.delete(ip);
        const sid = randomBytes(32).toString('base64url');
        // An old 4-digit PIN (or any old-style hash) must be replaced on the network.
        const mustChange = weak;
        sessions.set(sid, { profile, mustChange, last: Date.now(), ip });
        log(`login ${profile.name} (${profile.role}) from ${ip}`);
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

    const found = await sessionOf(req);
    if (url === '/api/logout') {
      if (found) sessions.delete(found[0]);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'magis_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (url === '/api/me') return send(res, found ? 200 : 401, found ? { profile: found[1].profile, mustChange: found[1].mustChange } : { error: { ar: 'سجّل الدخول', en: 'Please log in' } });
    if (!found) throw new HttpError(401, { ar: 'سجّل الدخول', en: 'Please log in' });
    const [, s] = found;

    if (url === '/api/version') return send(res, 200, { v: version });

    if (url === '/api/server/status' && method === 'GET') {
      if (s.profile.role === 'holder') throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const backups = await files.list();
      return send(res, 200, {
        version: SERVER_VERSION,
        addresses: lanAddresses().map((a) => (secure() ? `https://${a}:${config.httpsPort}` : `http://${a}:${config.httpPort}`)),
        hostname: os.hostname(),
        dataDir,
        dbSize: fs.statSync(dbFile).size,
        lastBackup: backups[0] ?? null,
        backupCount: backups.length,
        backupMirror: config.backupMirror,
        mirrorOk: config.backupMirror ? fs.existsSync(config.backupMirror) : null,
        users: [...new Set([...sessions.values()].filter((x) => Date.now() - x.last < 15 * 60e3).map((x) => x.profile.name))],
        startedAt,
      });
    }
    if (url === '/api/server/config' && method === 'POST') {
      if (s.profile.role !== 'sup') throw new HttpError(403, { ar: 'للرئيس فقط', en: 'Superior only' });
      const body = (await readBody(req)) as { backupMirror?: string | null };
      const mirror = body.backupMirror?.trim() || null;
      config = { ...config, backupMirror: mirror };
      writeConfig(dataDir, config);
      log(`backup mirror set to ${mirror}`);
      return send(res, 200, { ok: true });
    }

    const op = /^\/api\/op\/([\w.]+)$/.exec(url)?.[1];
    if (op && method === 'POST') {
      if (s.mustChange && op !== 'profile.setPin')
        throw new HttpError(403, { ar: 'غيّر كلمة السر أولاً', en: 'Change your password first' });
      const args = await readBody(req);
      const ctx: OpCtx = { db: handle.db, profile: s.profile, who: `${s.profile.name} (${s.profile.role})`, install: 'office', files };
      const result = await runOp(ctx, op, args);
      if (op === 'profile.setPin' && (args as { id?: number }).id === s.profile.id) s.mustChange = false;
      if (!READ_ONLY.has(op)) version++;
      // A restored database may hold other users: everybody logs in again.
      if (op === 'backup.restore') sessions.clear();
      // backups are listed by bare names; nothing else of the disk is shown
      return send(res, 200, result);
    }
    throw new HttpError(404, { ar: 'غير موجود', en: 'Not found' });
  };

  const startedAt = new Date().toISOString();

  const handler = (viaHttps: boolean) => async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = (req.url ?? '/').split('?')[0];
    try {
      if (url.startsWith('/api/')) await api(req, res, url, viaHttps);
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
      res.writeHead(301, { Location: `https://${host}:${httpsPort}${req.url ?? '/'}` });
      res.end();
    });
    httpPort = await listen(srv, config.httpPort);
    servers.push(srv);
  }

  log(`MAGIS server ${SERVER_VERSION} · data ${dataDir}`);
  for (const a of lanAddresses()) log(`open: ${httpsPort ? `https://${a}:${httpsPort}` : `http://${a}:${httpPort}`}`);

  return {
    dataDir,
    httpsPort,
    httpPort,
    close: async () => {
      clearInterval(dailyTimer);
      await Promise.all(servers.map((srv) => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); })));
      handle.close();
    },
  };
}
