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
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import selfsigned from 'selfsigned';
import ExcelJS from 'exceljs';
import { type Db, type Row, type SqlValue, type Stmt, migrate, one, pendingMigrations } from '../src/db/db';
import { addHeading, addLine, addNamed, auditStmt, blankTrx, getMeta, loadLists, setMetaStmt } from '../src/db/repo';
import { checkSecretShape, has, hashSecret, listProfiles, loadProfile, login, verifySecret, type Profile } from '../src/auth';
import { READ_ONLY, runOp, type BackupFile, type BudgetPayload, type DataPayload, type FileOps, type OpCtx } from '../src/ops';
import { ALL_PERMS } from '../src/perms';
import { deleteNetGrant, listNetGrants, partAmount, saveNetGrant, type NetGrant } from '../src/domain/netGrants';
import { grantReport, type GrantReportPartIn } from '../src/domain/grantReport';
import { projectReport } from '../src/domain/projects';
import { periodEnd } from '../src/domain/budget';
import { allCentresReport, exploreRows, type CentreInput, type ExploreRow } from '../src/domain/allCentres';
import { computeAll } from '../src/domain/compute';
import { addToList, applyMainList, CENTRES_LIST, checkMainList, followedList, listId, MAIN_LIST, mainListChanges, mainListFromDb, newUid, type MainChanges, type MainList, type MainRequest } from '../src/io/mainList';
import { createOffice } from '../src/setup';
import { createCommunity, type CommunitySetup } from '../src/community/setup';
import { createCountry, type CountrySetup } from '../src/community/country';
import { createHr, type HrListItem, type HrPerson } from '../src/hr/hr';
import { accountFor, centreItem, lineFor } from '../src/hr/link';
import { applySeed, readWorkbook } from '../src/io/importWorkbook';
import type { Msg } from '../src/i18n';
import type { Trx, TrxType } from '../src/domain/types';

export const SERVER_VERSION = '0.9.0';

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
  /** This server's own identity: the main list it makes carries it (Fouad, 2026-11-03). */
  serverId?: string;
  /** Copies of centres from other servers (Fouad, 2026-11-07): read only, nobody signs in to them; the Coordinator's
   *  reports count them. When it was brought, from which centre, and the newest change written in it. */
  copies?: Record<string, { at: string; from: string | null; latest: string | null }>;
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

// The main lists of headings and lines (Fouad, 2026-11-07: several, one per kind of project), in main-lists/: each
// list published (what the databases take) and the administrator's draft. The first one (0.8.7) moves in as "centres".
const listsDir = (dataDir: string) => path.join(dataDir, 'main-lists');
const listFile = (dataDir: string, id: string, which: 'published' | 'draft') => path.join(listsDir(dataDir), `${id}${which === 'draft' ? '.draft' : ''}.json`);

function readMainList(dataDir: string, id: string, which: 'published' | 'draft'): MainList | null {
  try {
    const l = JSON.parse(fs.readFileSync(listFile(dataDir, id, which), 'utf8')) as MainList;
    return { ...l, id, title: l.title || (id === CENTRES_LIST ? 'Centres' : id) };
  } catch {
    return null;
  }
}

function writeMainList(dataDir: string, id: string, which: 'published' | 'draft', list: MainList) {
  fs.mkdirSync(listsDir(dataDir), { recursive: true });
  const f = listFile(dataDir, id, which);
  if (fs.existsSync(f)) fs.copyFileSync(f, f.replace(/\.json$/, '.prev'));
  fs.writeFileSync(f + '.tmp', JSON.stringify({ ...list, id }, null, 1));
  fs.renameSync(f + '.tmp', f);
}

/** the lists on this server (by their files), in the order they were made */
function mainListIds(dataDir: string): string[] {
  // the single list of 0.8.7 becomes the Centres list
  for (const [old, which] of [['main-list.json', 'published'], ['main-list-draft.json', 'draft']] as const) {
    const f = path.join(dataDir, old);
    if (fs.existsSync(f) && !fs.existsSync(listFile(dataDir, CENTRES_LIST, which))) {
      fs.mkdirSync(listsDir(dataDir), { recursive: true });
      fs.renameSync(f, listFile(dataDir, CENTRES_LIST, which));
    }
  }
  try {
    return [...new Set(fs.readdirSync(listsDir(dataDir)).filter((x) => x.endsWith('.json')).map((x) => x.replace(/(\.draft)?\.json$/, '')))]
      .sort((a, b) => fs.statSync(listFile(dataDir, a, fs.existsSync(listFile(dataDir, a, 'published')) ? 'published' : 'draft')).birthtimeMs
        - fs.statSync(listFile(dataDir, b, fs.existsSync(listFile(dataDir, b, 'published')) ? 'published' : 'draft')).birthtimeMs);
  } catch {
    return [];
  }
}

function readRequests(dataDir: string): MainRequest[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'main-list-requests.json'), 'utf8')) as MainRequest[];
  } catch {
    return [];
  }
}

function writeRequests(dataDir: string, list: MainRequest[]) {
  const f = path.join(dataDir, 'main-list-requests.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(list, null, 1));
  fs.renameSync(f + '.tmp', f);
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
  /** "sign in as" (Fouad, 31 October 2026): someone who manages the users sees the program as another person; 'view'
   *  saves nothing, 'act' acts as them, written "Fouad as Salim" */
  as?: { byId: number; by: string; mode: 'view' | 'act' };
  /** signed in from the first page with a house, a name and a password (Fouad, 31 October 2026): every database of
   *  that house (and HR) where this name has this password; the person goes from one to another without signing in again */
  ring?: { db: string; profileId: number; mustChange: boolean }[];
}
/** who did it, as written in the history */
const whoOf = (s: Session) => (s.as ? `${s.as.by} as ${s.profile.name}` : s.profile.name);

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
/** a whole database file, sent as base64 (about a third more than the file itself): up to about 190 MB of file */
const UPLOAD_BODY = 256 * 1024 * 1024;

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
  if (!config.serverId) { config = { ...config, serverId: newUid() }; writeConfig(dataDir, config); }
  // a main list can be changed here: it was started here (or does not exist yet)
  const mainEditable = (id: string) => {
    const x = readMainList(dataDir, id, 'published') ?? readMainList(dataDir, id, 'draft');
    return !x || x.home === config.serverId;
  };
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
  const describe = async (c: Centre) => {
    const organisation = (await getMeta(c.handle.db, 'organisation')) ?? c.slug;
    return {
    slug: c.slug,
    organisation,
    // a database made before centres existed has none written: guessed from its name (MAGIS Aleppo had the colour of "Other")
    centre: ((await getMeta(c.handle.db, 'centre')) ?? guessCentre(organisation)) as CentreKey,
    color: await getMeta(c.handle.db, 'brand_color'),
    logo: await getMeta(c.handle.db, 'brand_logo'),
    /** a community's set of colours (JSON), if it chose one */
    palette: await getMeta(c.handle.db, 'brand_palette'),
    city: await getMeta(c.handle.db, 'city'),
    setupNeeded: await setupNeeded(c),
    /** community = a Jesuit community's accounts; otherwise a MAGIS centre */
    kind: (await getMeta(c.handle.db, 'kind')) ?? 'centre',
    };
  };
  const centreOf = (slug: unknown): Centre => {
    const c = typeof slug === 'string' ? centres.get(slug) : undefined;
    if (!c || (config.inactive ?? []).includes(c.slug) || config.copies?.[c.slug]) throw new HttpError(404, { ar: 'قاعدة البيانات غير موجودة', en: 'Database not found' });
    return c;
  };

  // ---------------------------------------------------------------- the Province account (Fouad, 2026-11-07)
  // The Coordinator's own book: the money of the grants arrives on the Province's account, is exchanged, and is sent to
  // the centres. A database of its own, kept apart from the centres (in province/, never listed with them), opened
  // only from the Coordinator.
  let province: Centre | null = null;
  const getProvince = async (): Promise<Centre> => {
    if (province) return province;
    const dir = path.join(dataDir, 'province');
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const file = path.join(dir, 'magis.db');
    const fresh = !fs.existsSync(file) || fs.statSync(file).size === 0;
    const handle = openDb(file);
    await migrate(handle.db);
    const c = { slug: 'province', dir, file, backupsDir, handle, version: 1 } as Centre;
    c.files = makeFiles(c);
    if (fresh) {
      const pin = () => randomBytes(12).toString('base64url');
      await createOffice(handle.db, { organisation: 'Province account', supName: 'Coordinator', supPin: pin(), comName: 'Province', comPin: pin() });
      const who = 'Coordinator (setup)';
      await addHeading(handle.db, 'Income', ['Income'], who);
      await addHeading(handle.db, 'Exchange', ['Exchange'], who);
      const L = await loadLists(handle.db);
      const inc = L.headings.find((h) => h.name === 'Income')!.id;
      for (const n of ['Grant', 'Other']) await addLine(handle.db, inc, n, who);
      await addLine(handle.db, L.headings.find((h) => h.name === 'Exchange')!.id, 'Currency exchange', who);
      await addNamed(handle.db, 'city', 'Province', who);
      await handle.db.batch([
        setMetaStmt('kind', 'province'),
        { sql: "UPDATE book SET name = 'Province account' WHERE is_main = 1" },
        { sql: 'UPDATE book SET active = 0 WHERE is_main = 0' },
      ]);
      log('Province account created');
    }
    if (!(await handle.db.query("SELECT 1 FROM book WHERE name = 'Sent to the centres'")).length)
      await handle.db.batch([{ sql: "INSERT INTO book (name, is_main, sort, active) VALUES ('Sent to the centres', 0, 5, 1)" }]);
    province = c;
    return c;
  };

  // ---------------------------------------------------------------- backups, every day, for every database
  const dailyBackup = async () => {
    const today = stamp().slice(0, 10);
    // (the Province account, once it exists, is backed up like the others even if nobody opened it since the start)
    if (!province && fs.existsSync(path.join(dataDir, 'province', 'magis.db'))) await getProvince();
    for (const c of [...centres.values(), ...(province ? [province] : [])]) {
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

  // (a database file taken whole — an HR database with its documents, a backup — may be much bigger than a form: UPLOAD_BODY)
  const readBody = (req: http.IncomingMessage, limit = MAX_BODY) =>
    new Promise<unknown>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, { ar: `الملف كبير جداً (الحد ${Math.round(limit / 1048576)} ميغابايت)`, en: `File too large (the limit is ${Math.round(limit / 1048576)} MB)` }));
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
    return `magis_cty=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${viaHttps ? '; Secure' : ''}`;
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
    isLocal(req) || (!!found && has(found[1].profile, 'users.manage')) || !!dirPersonOf(req)?.admin;

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
    const headers = {
      ...SEC_HEADERS,
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    // the big script (2.7 MB) and the wasm go through the network once per browser: compress them (once, kept in memory)
    if (['.js', '.css', '.wasm', '.html', '.svg', '.json'].includes(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      let z = gzipCache.get(file);
      if (!z) { z = zlib.gzipSync(fs.readFileSync(file), { level: 9 }); gzipCache.set(file, z); }
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': z.length, Vary: 'Accept-Encoding' });
      return res.end(z);
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  };
  const gzipCache = new Map<string, Buffer>();

  const secure = () => config.httpsPort > 0;

  /**
   * Replaces a database by an uploaded office database (from the desktop app,
   * or a backup copy). Checked in a temporary file first: it must open, must be
   * an office database (not a holder's), and must have at least one user.
   */
  /**
   * What a .db file is, before it becomes a database (Fouad, 2026-11-12): checked as when it replaces one — not a holder's
   * file, with users, not a community's, a country's or the Province's — and read: its name, its house, its colour, and its
   * users with the centres each is limited to (an HR keeper of a centre sees only that centre's people).
   */
  const peekDb = async (base64: string) => {
    const tmp = path.join(dataDir, `peek-${Date.now()}-${randomBytes(4).toString('hex')}.db`);
    fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));
    try {
      const test = openDb(tmp);
      try {
        await migrate(test.db);
        const users = await test.db.query<{ name: string; role: string | null; hr_centres: string | null; access: string | null }>(
          'SELECT p.name, p.role, p.hr_centres, a.name AS access FROM profile p LEFT JOIN access_profile a ON a.id = p.access_id WHERE p.active = 1 ORDER BY p.id');
        if ((await getMeta(test.db, 'install')) === 'holder') throw new HttpError(400, { ar: 'هذا ملف أمين صندوق، لا ملف المكتب', en: "This is a holder's file, not the office database" });
        if (!users.length) throw new HttpError(400, { ar: 'لا مستخدمين في هذا الملف', en: 'No users in this file' });
        const kind = (await getMeta(test.db, 'kind')) ?? 'centre';
        if (kind === 'community' || kind === 'country' || kind === 'province')
          throw new HttpError(400, kind === 'province' ? { ar: 'هذا ملف حساب الإقليم', en: "This is the Province account's file" } : { ar: 'هذا ملف جماعة أو بلد: يُنشأ من جانب الجماعات', en: "This is a community's or a country's file: make it from the communities' side" });
        const scope = (x: string | null) => { try { const a = JSON.parse(x ?? 'null'); return Array.isArray(a) ? (a as string[]) : null; } catch { return null; } };
        return {
          organisation: (await getMeta(test.db, 'organisation')) ?? '', kind, centre: (await getMeta(test.db, 'centre')) as string | null,
          color: await getMeta(test.db, 'brand_color'), hasLogo: !!(await getMeta(test.db, 'brand_logo')),
          users: users.map((u) => ({ name: u.name, access: u.access, centres: scope(u.hr_centres) })),
        };
      } finally {
        test.close();
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, { ar: 'ليس ملف قاعدة بيانات صالحاً', en: 'Not a valid database file' });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  };

  const replaceDatabase = async (c: Centre, base64: string) => {
    const keepCentre = await getMeta(c.handle.db, 'centre');
    const curKind = await getMeta(c.handle.db, 'kind');
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
        // a community's or a country's file is made from the communities' side (behind their password); the Province's
        // account is the Coordinator's own: neither comes in through a plain database
        const fileKind = await getMeta(test.db, 'kind');
        if ((fileKind === 'community' || fileKind === 'country' || fileKind === 'province') && fileKind !== curKind)
          throw new HttpError(400, fileKind === 'province'
            ? { ar: 'هذا ملف حساب الإقليم', en: "This is the Province account's file" }
            : { ar: 'هذا ملف جماعة أو بلد: يُنشأ من جانب الجماعات', en: "This is a community's or a country's file: make it from the communities' side" });
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
    // signed in as someone else, to see only: nothing is saved (reading stays possible)
    if (found?.[1].as?.mode === 'view' && method === 'POST' && !['/api/logout', '/api/as', '/api/as/back', '/api/me'].includes(url)) {
      const name = /^\/api\/op\/([\w.]+)$/.exec(url)?.[1];
      if (!name || !READ_ONLY.has(name)) throw new HttpError(403, { ar: 'تشاهد بحساب شخص آخر: لا يُحفظ شيء', en: "You are seeing as someone else: nothing can be saved", fr: "Vous voyez avec le compte d'un autre : rien ne peut être enregistré" });
    }
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
    // (the Coordinator — the directory's administrator — manages every database, Fouad 2026-11-07)
    const mayManage = () => isLocal(req) || (!!found && has(found[1].profile, 'users.manage')) || !!dirPerson?.admin;
    const checkGate = async (password: string) => {
      const g = config.ctyGate;
      if (!g) return true;
      return (await hashSecret(g.salt, password)) === g.hash;
    };

    if (url === '/api/hello' && method === 'GET') {
      // the communities are not even named until their password is given
      let dbs = (await Promise.all([...centres.values()].filter((x) => !(config.inactive ?? []).includes(x.slug) && !config.copies?.[x.slug]).map(describe))).filter((d) => ctyOpen() || !isCtyKind(d.kind));
      // the directory: a signed-in person sees only what was given to them; when it is enforced, nobody else sees anything
      if (dirPerson) dbs = dbs.filter((d) => dirSees(dirPerson, d.slug));
      else if (found?.[1].ring) dbs = dbs.filter((d) => found[1].ring!.some((r) => r.db === d.slug));
      else if (directory.enforced && !isLocal(req)) dbs = [];
      dbs.sort((a, b) => CENTRE_KEYS.indexOf(a.centre) - CENTRE_KEYS.indexOf(b.centre) || a.organisation.localeCompare(b.organisation));
      return send(res, 200, { server: true, version: SERVER_VERSION, local: isLocal(req), canCreate: mayCreate(req, found), canCreateCty: mayCreateCty(), canManage: mayManage(), dir: dirInfo(), dbs, ring: found?.[1].ring?.map((r) => r.db) ?? null, current: found ? found[1].db : null, idleMinutes: config.idleMinutes, ctyGate: !!config.ctyGate, ctyOpen: ctyOpen() });
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
    const needSuperior = async (c: Centre, password: unknown, coordinatorToo = false) => {
      // switching a database off or deleting it: the Coordinator does not need each Superior's password
      if (coordinatorToo && dirPerson?.admin) return `${dirPerson.name} (Coordinator)`;
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
        const followed = (d.kind ?? 'centre') === 'centre' ? await followedList(c.handle.db) : null;
        list.push({ slug: c.slug, organisation: d.organisation, kind: d.kind, city: d.city, active: !off.has(c.slug), bytes: folderSize(c.dir), backups: backups.length, lastBackup: backups[0]?.name ?? null,
          list: followed ? (readMainList(dataDir, followed, 'published') ?? readMainList(dataDir, followed, 'draft'))?.title ?? null : null,
          copy: config.copies?.[c.slug] ?? null });
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
      const who = await needSuperior(c, body.password, true);
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
      const who = await needSuperior(c, body.password, true);
      // a last copy, then the WHOLE folder (database, backups, documents) moves to "deleted": nothing is erased
      try { await c.files.backupNow('before-delete'); } catch { /* the folder is kept anyway */ }
      c.handle.close();
      centres.delete(c.slug);
      for (const [sid, x] of sessions) if (x.db === c.slug) sessions.delete(sid);
      fs.mkdirSync(deletedDir, { recursive: true });
      const dest = path.join(deletedDir, `${c.slug}_${stamp()}`);
      fs.renameSync(c.dir, dest);
      const { [c.slug]: _gone, ...copies } = config.copies ?? {};
      config = { ...config, inactive: (config.inactive ?? []).filter((x) => x !== c.slug), copies };
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
    const dirCookieSet = (token: string, viaHttps: boolean) => `magis_dir=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${viaHttps ? '; Secure' : ''}`;
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
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'magis_dir=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
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
      return send(res, 200, { profile, mustChange: false, install: 'office' }, { 'Set-Cookie': `magis_sid=${sid}; HttpOnly; SameSite=Lax; Path=/${viaHttps ? '; Secure' : ''}` });
    }
    if (url === '/api/dir/people' && method === 'GET') {
      needDirAdmin();
      const dbs = await Promise.all([...centres.values()].filter((x) => (ctyOpen() || !ctyKinds.get(x.slug)) && !config.copies?.[x.slug]).map(async (x) => ({ ...(await describe(x)), profiles: (await listProfiles(x.handle.db)).map((q) => ({ id: q.id, name: q.name, access_name: q.access_name, office: q.office ?? null })) })));
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
    // who may see every centre together (Fouad, 2026-11-02): the administrator only — the directory's administrator; a
    // server with no directory yet: whoever manages the users, on the server computer itself
    const allCentresAllowed = () => !!dirPerson?.admin || (!directory.people.length && isLocal(req) && !!found && has(found[1].profile, 'users.manage'));
    if (url === '/api/all-centres/allowed' && method === 'GET') return send(res, 200, { allowed: !!found && allCentresAllowed() });

    // ---- The main lists of headings and lines (Fouad, 2026-11-03; several, one per kind of project, 2026-11-07): kept on
    // this server, apart from every database. The administrator changes a list's draft, then publishes it: each database
    // following that list is backed up and follows it (names, codes, moves and merges, with their rows). A server of
    // another city takes a list as a file and never changes it.
    const centreDbs = async (id?: string) => {
      const out: { c: Centre; org: string }[] = [];
      for (const x of centres.values()) {
        if ((config.inactive ?? []).includes(x.slug) || config.copies?.[x.slug] || ((await getMeta(x.handle.db, 'kind')) ?? 'centre') !== 'centre') continue;
        if (id && (await followedList(x.handle.db)) !== id) continue;
        out.push({ c: x, org: (await getMeta(x.handle.db, 'organisation')) ?? x.slug });
      }
      return out;
    };
    const listSummary = async () => {
      const out = [];
      for (const id of mainListIds(dataDir)) {
        const pub = readMainList(dataDir, id, 'published');
        const draft = readMainList(dataDir, id, 'draft');
        const l = (pub ?? draft)!;
        out.push({ id, title: l.title!, version: pub?.version ?? 0, published_at: pub?.published_at ?? null, from: l.from, editable: mainEditable(id),
          centres: (await centreDbs(id)).map((x) => x.org) });
      }
      return out;
    };
    // the names of the lists, to choose one for a new database
    if (url === '/api/main-lists/names' && method === 'GET') {
      if (!found && !mayCreate(req, found)) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      return send(res, 200, mainListIds(dataDir).filter((id) => readMainList(dataDir, id, 'published')).map((id) => ({ id, title: readMainList(dataDir, id, 'published')!.title })));
    }
    // (the Coordinator reaches the lists without entering a database, Fouad 2026-11-07)
    const mayLists = () => allCentresAllowed() || (!!found && has(found[1].profile, 'lists.manage'));
    if (url === '/api/main-lists' && method === 'GET') {
      if (!mayLists()) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      return send(res, 200, { admin: allCentresAllowed(), dir: directory.people.length > 0, mine: found ? await followedList(found[2].handle.db) : null, lists: allCentresAllowed() ? await listSummary() : [] });
    }
    if (url === '/api/main-list') {
      if (method !== 'GET') throw new HttpError(405, { ar: 'غير مسموح', en: 'Not allowed' });
      if (!mayLists()) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const id = new URL(req.url ?? '/', 'http://x').searchParams.get('id') || (found ? await followedList(found[2].handle.db) : CENTRES_LIST);
      const admin = allCentresAllowed();
      return send(res, 200, { id, list: readMainList(dataDir, id, 'published'), draft: admin ? readMainList(dataDir, id, 'draft') : null, admin, editable: mainEditable(id), home: config.serverId });
    }
    // a database asks the administrator for a heading or a line of its list (it does not add one itself)
    if (url === '/api/main-list/request' && method === 'POST') {
      if (!found || !has(found[1].profile, 'lists.manage')) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const b = (await readBody(req)) as Partial<MainRequest>;
      const listOf = await followedList(found[2].handle.db);
      const pub = readMainList(dataDir, listOf, 'published');
      const name = String(b.name ?? '').trim();
      if (!name) throw new HttpError(400, { ar: 'الاسم فارغ', en: 'The name is empty' });
      const head = b.kind === 'line' ? pub?.headings.find((h) => h.uid === b.heading_uid) : null;
      if (b.kind === 'line' && !head) throw new HttpError(400, { ar: 'اختر البند', en: 'Choose the heading' });
      const r: MainRequest = {
        id: newUid(), list_id: listOf, kind: b.kind === 'heading' ? 'heading' : 'line', name, heading_uid: head?.uid ?? null, heading_name: head?.name ?? null,
        type: b.kind === 'heading' ? ((['Income', 'Exp', 'Transfer', 'Exchange'] as const).find((x) => x === b.type) ?? 'Exp') : null,
        why: String(b.why ?? '').trim(), centre: found[2].slug, organisation: (await getMeta(found[2].handle.db, 'organisation')) ?? found[2].slug,
        server: config.serverId ?? null, by: found[1].profile.name, at: new Date().toISOString(),
        meanwhile_line_uid: typeof b.meanwhile_line_uid === 'string' ? b.meanwhile_line_uid : null,
        status: 'open', answer_uid: null, answer_name: null, note: null, answered_at: null,
      };
      writeRequests(dataDir, [...readRequests(dataDir), r]);
      log(`Main list ${listOf}: ${r.organisation} asks for the ${r.kind} "${r.name}" (by ${r.by})`);
      return send(res, 200, r);
    }
    // the requests: the administrator sees those of a list; a database, its own
    if (url === '/api/main-list/requests' && method === 'GET') {
      if (!mayLists()) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const all = readRequests(dataDir);
      const id = new URL(req.url ?? '/', 'http://x').searchParams.get('id');
      if (allCentresAllowed()) return send(res, 200, id ? all.filter((r) => (r.list_id || CENTRES_LIST) === id) : all);
      return send(res, 200, all.filter((r) => r.centre === found![2].slug && r.server === config.serverId));
    }
    if (url.startsWith('/api/main-list/') && method === 'POST') {
      if (!allCentresAllowed()) throw new HttpError(403, { ar: 'للمدير فقط', en: 'For the administrator only' });
      const byName = found?.[1].profile.name ?? dirPerson?.name ?? 'administrator';
      const who = `${byName} (main list)`;
      const body = (await readBody(req)) as { id?: string; list?: MainList } & Record<string, unknown>;
      const id = String(body.id ?? (body.list ? listId(body.list) : '') ?? '') || CENTRES_LIST;
      const pub = readMainList(dataDir, id, 'published');
      const draft = readMainList(dataDir, id, 'draft');
      const notHere = () => new HttpError(400, { ar: 'تُغيَّر القائمة على خادمها فقط', en: 'A list is changed on its own server only' });
      // every database following the list follows it (a backup of each first)
      const applyAll = async (list: MainList) => {
        const out: { organisation: string; renamed: number; moved: number; merged: number }[] = [];
        for (const j of await centreDbs(listId(list))) {
          await j.c.files.backupNow('before-main-list');
          const r = await applyMainList(j.c.handle.db, list, who);
          j.c.version++;
          out.push({ organisation: j.org, renamed: r.renamed, moved: r.moved, merged: r.merged });
        }
        return out;
      };
      // the administrator answers a request: added to the draft of its list, the same as one that exists, or refused
      if (url === '/api/main-list/answer') {
        const b = body as { id?: string; how?: 'add' | 'same' | 'refuse'; name?: string; heading_uid?: string | null; type?: TrxType; uid?: string; note?: string };
        const all = readRequests(dataDir);
        const r = all.find((x) => x.id === b.id);
        if (!r) throw new HttpError(404, { ar: 'الطلب غير موجود', en: 'Request not found' });
        const lid = r.list_id || CENTRES_LIST;
        if (!mainEditable(lid)) throw notHere();
        const base = readMainList(dataDir, lid, 'draft') ?? readMainList(dataDir, lid, 'published');
        if (!base) throw new HttpError(400, { ar: 'القائمة غير موجودة', en: 'The list does not exist' });
        const at = new Date().toISOString();
        if (b.how === 'add') {
          const x = addToList(base, { kind: r.kind, name: b.name ?? r.name, heading_uid: b.heading_uid ?? r.heading_uid, type: b.type ?? r.type });
          writeMainList(dataDir, lid, 'draft', x.list);
          Object.assign(r, { status: 'added', answer_uid: x.uid, answer_name: (b.name ?? r.name).trim(), note: b.note?.trim() || null, answered_at: at });
        } else if (b.how === 'same') {
          const x = [...base.headings, ...base.lines].find((y) => y.uid === b.uid);
          if (!x) throw new HttpError(400, { ar: 'اختر بنداً أو خطاً من القائمة', en: 'Choose a heading or a line of the list' });
          Object.assign(r, { status: 'same', answer_uid: x.uid, answer_name: x.name, note: b.note?.trim() || null, answered_at: at });
        } else if (b.how === 'refuse') {
          Object.assign(r, { status: 'refused', answer_uid: null, answer_name: null, note: b.note?.trim() || null, answered_at: at });
        } else throw new HttpError(400, { ar: 'جواب غير معروف', en: 'Unknown answer' });
        writeRequests(dataDir, all);
        return send(res, 200, { request: r, draft: readMainList(dataDir, lid, 'draft') });
      }
      // requests from a file (a centre on its own computer, or another city's server)
      if (url === '/api/main-list/requests-import') {
        const incoming = (body as { requests?: MainRequest[] }).requests ?? [];
        const all = readRequests(dataDir);
        const known = new Set(all.map((x) => x.id));
        const fresh = incoming.filter((x) => !known.has(x.id)).map((x) => ({ ...x, status: x.status ?? 'open' }) as MainRequest);
        writeRequests(dataDir, [...all, ...fresh]);
        return send(res, 200, { added: fresh.length });
      }
      // a new list: empty, a copy of another list, a list file (a template), or this database's own list
      if (url === '/api/main-list/new') {
        const b = body as { title?: string; from?: 'empty' | 'db' | 'list' | 'file'; source?: string; list?: MainList };
        const title = String(b.title ?? '').trim();
        if (!title) throw new HttpError(400, { ar: 'اكتب اسم القائمة', en: 'Write the name of the list' });
        if (mainListIds(dataDir).some((x) => (readMainList(dataDir, x, 'draft') ?? readMainList(dataDir, x, 'published'))?.title?.toLowerCase() === title.toLowerCase()))
          throw new HttpError(400, { ar: 'قائمة بهذا الاسم موجودة', en: 'A list with this name already exists' });
        let nid = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
        if (!mainListIds(dataDir).length && b.from === 'db') nid = CENTRES_LIST; // the first one, as in 0.8.7
        for (let i = 2; mainListIds(dataDir).includes(nid); i++) nid = `${nid.replace(/-\d+$/, '')}-${i}`;
        const empty: MainList = { kind: MAIN_LIST, home: config.serverId!, version: 0, published_at: null, from: null, headings: [], lines: [], merged: [] };
        let start: MainList = empty;
        if (b.from === 'db') {
          // the list of a centre's database (chosen in the Coordinator; or the one this session is in)
          const src = (b.source ? centres.get(b.source) : null) ?? found?.[2];
          if (!src || ((await getMeta(src.handle.db, 'kind')) ?? 'centre') !== 'centre') throw new HttpError(400, { ar: 'اختر قاعدة مركز', en: "Choose a centre's database" });
          start = await mainListFromDb(src.handle.db, config.serverId!, (await getMeta(src.handle.db, 'organisation')) ?? src.slug);
        } else if (b.from === 'list') {
          const src = readMainList(dataDir, String(b.source ?? ''), 'draft') ?? readMainList(dataDir, String(b.source ?? ''), 'published');
          if (!src) throw new HttpError(400, { ar: 'القائمة غير موجودة', en: 'The list does not exist' });
          // a copy: its own identities, so that the two lists never mix
          const map = new Map<string, string>();
          const u = (x: string) => { if (!map.has(x)) map.set(x, newUid()); return map.get(x)!; };
          start = { ...empty, from: src.title ?? null, headings: src.headings.map((h) => ({ ...h, uid: u(h.uid) })), lines: src.lines.map((l) => ({ ...l, uid: u(l.uid), heading_uid: u(l.heading_uid) })) };
        } else if (b.from === 'file') {
          const src = checkMainList(b.list!);
          start = { ...empty, from: src.title ?? src.from ?? null, headings: src.headings, lines: src.lines };
        }
        const list = checkMainList({ ...start, id: nid, title });
        writeMainList(dataDir, nid, 'draft', list);
        log(`Main list "${title}" (${nid}) started (by ${byName})`);
        return send(res, 200, { id: nid, draft: list });
      }
      if (url === '/api/main-list/start') {
        // (0.8.7: the first list, from this database)
        if (!found) throw new HttpError(400, { ar: 'افتح قاعدة مركز', en: "Open a centre's database" });
        if (pub || draft) throw new HttpError(400, { ar: 'القائمة الرئيسية موجودة', en: 'The main list already exists' });
        if (((await getMeta(found[2].handle.db, 'kind')) ?? 'centre') !== 'centre') throw new HttpError(400, { ar: 'افتح قاعدة مركز', en: "Open a centre's database" });
        const list = { ...(await mainListFromDb(found[2].handle.db, config.serverId!, (await getMeta(found[2].handle.db, 'organisation')) ?? found[2].slug)), id, title: id === CENTRES_LIST ? 'Centres' : id };
        writeMainList(dataDir, id, 'draft', list);
        log(`Main list ${id} started from ${found[2].slug} (by ${byName})`);
        return send(res, 200, { draft: list });
      }
      if (url === '/api/main-list/draft') {
        if (!mainEditable(id)) throw notHere();
        const list = checkMainList(body.list!);
        writeMainList(dataDir, id, 'draft', { ...list, id, title: (pub ?? draft)?.title ?? list.title, home: config.serverId!, version: pub?.version ?? 0, published_at: pub?.published_at ?? null });
        return send(res, 200, { ok: true });
      }
      if (url === '/api/main-list/rename') {
        if (!mainEditable(id)) throw notHere();
        const title = String(body.title ?? '').trim();
        if (!title) throw new HttpError(400, { ar: 'اكتب اسم القائمة', en: 'Write the name of the list' });
        for (const w of ['draft', 'published'] as const) { const l = readMainList(dataDir, id, w); if (l) writeMainList(dataDir, id, w, { ...l, title }); }
        return send(res, 200, { ok: true });
      }
      if (url === '/api/main-list/discard') {
        if (!mainEditable(id) || !pub) throw new HttpError(400, { ar: 'لا شيء منشور بعد', en: 'Nothing is published yet' });
        writeMainList(dataDir, id, 'draft', pub);
        return send(res, 200, { draft: pub });
      }
      if (url === '/api/main-list/preview') {
        if (!draft) return send(res, 200, { centres: [] });
        const out: ({ organisation: string } & MainChanges)[] = [];
        for (const j of await centreDbs(id)) out.push({ organisation: j.org, ...(await mainListChanges(j.c.handle.db, draft)) });
        return send(res, 200, { centres: out });
      }
      if (url === '/api/main-list/publish') {
        if (!mainEditable(id) || !draft) throw new HttpError(400, { ar: 'لا مسودة', en: 'There is no draft' });
        const list = { ...checkMainList(draft), id, home: config.serverId!, version: (pub?.version ?? 0) + 1, published_at: new Date().toISOString() };
        writeMainList(dataDir, id, 'published', list);
        writeMainList(dataDir, id, 'draft', list);
        const out = await applyAll(list);
        log(`Main list ${id} version ${list.version} published (by ${byName})`);
        return send(res, 200, { list, centres: out });
      }
      if (url === '/api/main-list/import') {
        const list = checkMainList(body.list!);
        if (list.home === config.serverId) throw new HttpError(400, { ar: 'هذا الملف من هذا الخادم نفسه', en: 'This file comes from this server itself' });
        if ((pub && pub.home === config.serverId) || (draft && draft.home === config.serverId))
          throw new HttpError(400, { ar: 'هذا الخادم يصنع هذه القائمة: لا يأخذها من ملف', en: 'This server makes this list: it does not take it from a file' });
        if (!list.version) throw new HttpError(400, { ar: 'هذه القائمة لم تُنشر بعد', en: 'This list was never published' });
        if (pub && pub.home === list.home && list.version <= pub.version)
          throw new HttpError(400, { ar: `عندك النسخة ${pub.version}؛ هذا الملف ${list.version} — ليس أحدث`, en: `You have version ${pub.version}; this file is ${list.version} — not newer` });
        writeMainList(dataDir, id, 'published', list);
        writeMainList(dataDir, id, 'draft', list);
        const out = await applyAll(list);
        log(`Main list ${id} version ${list.version} taken from a file (by ${byName})`);
        return send(res, 200, { list, centres: out });
      }
    }
    // ---- A centre on another server takes the Province's sends from a file (Fouad, 2026-11-07): each waits for its
    // answer here; one already accepted is not touched.
    // whether the Province's account is on this server (then its sends arrive by themselves, not by file)
    if (url === '/api/province-here' && method === 'GET') return send(res, 200, { here: fs.existsSync(path.join(dataDir, 'province', 'magis.db')) });
    if (url === '/api/province-take' && method === 'POST') {
      if (!found) throw new HttpError(401, { ar: 'ادخل أولاً', en: 'Sign in first' });
      const [, sess, c] = found;
      if (!has(sess.profile, 'lists.donors')) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      if (fs.existsSync(path.join(dataDir, 'province', 'magis.db'))) throw new HttpError(400, { ar: 'الإقليم على هذا الخادم: الإرسال يصل وحده', en: "The Province is on this server: its sends arrive by themselves" });
      const b = (await readBody(req)) as { kind?: string; sends?: { id: string; date: string; usd: number; syp: number; project_id: number | null; donor: string | null; reference: string | null; explanation: string | null; sent_by: string | null }[] };
      if (b.kind !== 'magis-province-sends' || !Array.isArray(b.sends)) throw new HttpError(400, { ar: 'الملف ليس إرسالاً من الإقليم', en: 'This file is not a send of the Province' });
      const stmts = b.sends.map((x) => ({
        sql: `INSERT INTO province_send (id, date, usd, syp, project_id, donor, reference, explanation, sent_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')
              ON CONFLICT(id) DO UPDATE SET date = excluded.date, usd = excluded.usd, syp = excluded.syp, project_id = excluded.project_id, donor = excluded.donor,
              reference = excluded.reference, explanation = excluded.explanation, sent_by = excluded.sent_by, status = 'waiting', note = NULL, answered_at = NULL, answered_by = NULL
              WHERE province_send.status <> 'accepted'`,
        params: [x.id, x.date, Number(x.usd) || 0, Number(x.syp) || 0, x.project_id ?? null, x.donor ?? null, x.reference ?? null, x.explanation ?? null, x.sent_by ?? null],
      }));
      await c.handle.db.batch([...stmts, auditStmt(whoOf(sess), 'take', 'province_send', null, null, { sends: b.sends.length })]);
      c.version++;
      return send(res, 200, { taken: b.sends.length });
    }
    // ---- A centre answers a send of the Province (Fouad, 2026-11-07): in the centre (an income, or "not received"),
    // then on the Province's account (the transfer confirmed, or marked "not received" with the centre's word).
    if (url === '/api/province-answer' && method === 'POST') {
      if (!found) throw new HttpError(401, { ar: 'ادخل أولاً', en: 'Sign in first' });
      const [, sess, c] = found;
      const b = (await readBody(req)) as { id?: string; ok?: boolean; note?: string | null };
      const cctx: OpCtx = { db: c.handle.db, profile: sess.profile, who: whoOf(sess), install: 'office', files: c.files };
      const r = (await runOp(cctx, 'province.answer', { id: String(b.id ?? ''), ok: !!b.ok, note: b.note ?? null })) as { status: string };
      // (a centre on another server: its answer travels in its next copy)
      if (!fs.existsSync(path.join(dataDir, 'province', 'magis.db'))) return send(res, 200, r);
      const pv = await getProvince();
      await pv.handle.db.batch([
        b.ok
          ? { sql: 'UPDATE trx SET received_at = ?, received_by = ?, disputed_at = NULL, dispute_note = NULL WHERE id = ?', params: [new Date().toISOString(), `${whoOf(sess)} (${c.slug})`, String(b.id)] }
          : { sql: 'UPDATE trx SET received_at = NULL, received_by = NULL, disputed_at = ?, dispute_note = ? WHERE id = ?', params: [new Date().toISOString(), (b.note ?? '').trim() || null, String(b.id)] },
      ]);
      c.version++;
      pv.version++;
      return send(res, 200, r);
    }
    // ---- What is waiting (Fouad, 2026-11-12): the first page of the Coordinator — what needs the administrator, gathered
    // from every centre, the Province account and the grants. Reads only; each group says where to go (area).
    if (url === '/api/coordinator/waiting' && method === 'GET') {
      if (!allCentresAllowed()) throw new HttpError(403, { ar: 'للمنسّق فقط', en: 'For the Coordinator only' });
      const now = Date.now();
      const today = new Date().toISOString().slice(0, 10);
      const thisMonth = today.slice(0, 7);
      const daysSince = (iso: string) => Math.floor((now - new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).getTime()) / 86400e3);
      type W = { text: string; days?: number; note?: string | null; usd?: number; syp?: number; state?: string };
      const groups: { key: string; area: 'dbs' | 'grants' | 'province' | 'lists'; items: W[] }[] = [];
      const add = (key: string, area: 'dbs' | 'grants' | 'province' | 'lists', items: W[]) => { if (items.length) groups.push({ key, area, items }); };
      const titleOf = (id: string | undefined) => (readMainList(dataDir, id || CENTRES_LIST, 'published') ?? readMainList(dataDir, id || CENTRES_LIST, 'draft'))?.title ?? id ?? '';

      // the centres' requests for a heading or a line
      add('requests', 'lists', readRequests(dataDir).filter((r) => r.status === 'open').map((r) => ({
        text: `${r.organisation}: ${r.kind === 'line' ? `${r.heading_name ?? ''} › ` : ''}${r.name}`, days: daysSince(r.at), note: [titleOf(r.list_id), r.why].filter(Boolean).join(' · '),
      })));

      // the live centres: months not closed, copies getting old
      const live: Centre[] = [];
      for (const x of centres.values()) {
        if ((config.inactive ?? []).includes(x.slug) || ((await getMeta(x.handle.db, 'kind')) ?? 'centre') !== 'centre' || (await setupNeeded(x))) continue;
        live.push(x);
      }
      const orgOf = async (x: Centre) => (await getMeta(x.handle.db, 'organisation')) ?? x.slug;
      const openMonths = async (db: Db) => (await db.query<{ ym: string }>(
        `SELECT DISTINCT substr(date, 1, 7) AS ym FROM trx WHERE date IS NOT NULL AND substr(date, 1, 7) < ? AND substr(date, 1, 7) NOT IN (SELECT ym FROM closed_month) ORDER BY ym`, [thisMonth])).map((r) => r.ym);
      const months: W[] = [];
      for (const x of live) {
        if (config.copies?.[x.slug]) continue; // a copy is closed (or not) where it is kept
        const open = await openMonths(x.handle.db);
        if (open.length) months.push({ text: await orgOf(x), note: `${open.slice(-6).join(' · ')}${open.length > 6 ? ` (+${open.length - 6})` : ''}`, days: open.length });
      }
      const provinceHere = fs.existsSync(path.join(dataDir, 'province', 'magis.db'));
      const pv = provinceHere ? await getProvince() : null;
      if (pv) {
        const open = await openMonths(pv.handle.db);
        if (open.length) months.push({ text: 'Province account', note: `${open.slice(-6).join(' · ')}${open.length > 6 ? ` (+${open.length - 6})` : ''}`, days: open.length, state: 'province' });
      }
      add('months', 'dbs', months);
      add('copies', 'dbs', Object.entries(config.copies ?? {}).filter(([, c]) => daysSince(c.at) >= 30).map(([, c]) => ({ text: c.from ?? '', days: daysSince(c.at) })));

      if (pv) {
        // sends not answered, or "not received"
        const sends = await pv.handle.db.query<{ centre_name: string | null; project_name: string | null; date: string; usd: number; syp: number; received_at: string | null; disputed_at: string | null; dispute_note: string | null }>(
          `SELECT s.centre_name, s.project_name, t.date, t.trf_usd AS usd, t.trf_syp AS syp, t.received_at, t.disputed_at, t.dispute_note
             FROM net_send s JOIN trx t ON t.id = s.trx_id WHERE t.received_at IS NULL ORDER BY t.date`);
        add('sends', 'province', sends.map((x) => ({ text: `${x.centre_name ?? ''} › ${x.project_name ?? '—'}`, days: daysSince(x.date), usd: x.usd, syp: x.syp, state: x.disputed_at ? 'disputed' : 'waiting', note: x.dispute_note })));

        // the grants: money in the account not yet sent, an end near, a split not finished
        const grants = await listNetGrants(pv.handle.db);
        const sentUsd = new Map((await pv.handle.db.query<{ grant_id: string; usd: number }>("SELECT t.grant_id, SUM(t.trf_usd) AS usd FROM net_send s JOIN trx t ON t.id = s.trx_id WHERE t.grant_id IS NOT NULL GROUP BY t.grant_id")).map((x) => [x.grant_id, x.usd]));
        const name = (g: { donor: string; reference: string | null }) => `${g.donor}${g.reference ? ` · ${g.reference}` : ''}`;
        const open = grants.filter((g) => !g.closed);
        add('unsent', 'province', open.filter((g) => g.received_usd - (sentUsd.get(g.id) ?? 0) > 0.5).map((g) => ({ text: name(g), usd: g.received_usd - (sentUsd.get(g.id) ?? 0) })));
        add('ending', 'grants', open.filter((g) => g.end_date && daysSince(g.end_date) > -60).map((g) => ({ text: name(g), days: -daysSince(g.end_date!), note: g.end_date })));
        add('unsplit', 'grants', open.filter((g) => g.amount - g.parts.reduce((a, p) => a + partAmount(g, p), 0) > 0.5).map((g) => ({ text: name(g), usd: g.amount - g.parts.reduce((a, p) => a + partAmount(g, p), 0), note: g.currency })));
        // a project that cannot receive a send: no dates, or no budget line given to it
        const notReady: W[] = [];
        for (const g of open) for (const part of g.parts) {
          const c = centres.get(part.centre);
          if (!c || part.project_id == null) { if (c) notReady.push({ text: `${part.centre_name} › ${g.donor}`, note: 'project' }); continue; }
          const d = (await c.handle.db.query<{ start_date: string | null; end_date: string | null }>('SELECT start_date, end_date FROM account WHERE id = ?', [part.project_id]))[0];
          const hasLine = (await c.handle.db.query('SELECT 1 FROM budget_amount WHERE account_id = ? LIMIT 1', [part.project_id])).length > 0;
          const missing = [!d?.start_date || !d?.end_date ? 'dates' : '', !hasLine ? 'line' : ''].filter(Boolean).join('+');
          if (missing && !config.copies?.[c.slug]) notReady.push({ text: `${part.centre_name} › ${part.project_name ?? ''}`, note: missing });
        }
        add('notready', 'grants', notReady);
        // money in the account that no grant explains
        const loose = (await pv.handle.db.query<{ n: number; usd: number; syp: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(inc_usd), 0) AS usd, COALESCE(SUM(inc_syp), 0) AS syp FROM trx WHERE type = 'Income' AND grant_id IS NULL"))[0];
        add('loose', 'province', loose.n ? [{ text: String(loose.n), usd: loose.usd, syp: loose.syp }] : []);
      }
      return send(res, 200, { at: new Date().toISOString(), count: groups.reduce((a, g) => a + g.items.length, 0), groups });
    }
    // ---- The Province account, for the Coordinator only: its rows, its balance, its months; and the operations allowed
    // on it (the rows, the month closing). Nobody signs in to it: the Coordinator acts on it as its Superior.
    if (url.startsWith('/api/province')) {
      if (!allCentresAllowed()) throw new HttpError(403, { ar: 'للمنسّق فقط', en: 'For the Coordinator only' });
      const p = await getProvince();
      const byName = found?.[1].profile.name ?? dirPerson?.name ?? 'Coordinator';
      const books = (await p.handle.db.query<{ id: number }>('SELECT id FROM book')).map((b) => b.id);
      const ctx: OpCtx = { db: p.handle.db, profile: { id: 0, name: 'Coordinator', role: 'sup', book_id: null, active: 1, access_id: null, access_name: 'Coordinator', perms: ALL_PERMS, books }, who: `${byName} (Coordinator)`, install: 'office', files: p.files };
      if (url === '/api/province' && method === 'GET') {
        const d = (await runOp(ctx, 'data', {})) as DataPayload;
        const main = d.lists.books.find((b) => b.is_main)!;
        const eur = Object.fromEntries((await p.handle.db.query<{ trx_id: string; eur: number }>('SELECT trx_id, eur FROM net_eur_in')).map((x) => [x.trx_id, x.eur]));
        const balance = await runOp(ctx, 'bookMonth.balance', { bookId: main.id, ym: '9999-12' });
        const comp = computeAll(d.rows, d.lists);
        return send(res, 200, { rows: d.rows, comp: Object.fromEntries(comp), lists: d.lists, closed: d.closed, balance, bookId: main.id, eur });
      }
      // the Coordinator's grants: their split between the centres' projects, and what arrived
      if (url === '/api/province/grants' && method === 'GET') return send(res, 200, await listNetGrants(p.handle.db));
      if (url === '/api/province/grant' && method === 'POST') {
        const g = (await readBody(req)) as NetGrant;
        if (!g.id) g.id = newUid();
        // each part's centre and project are checked, and their names kept (for the report and the files)
        for (const part of g.parts ?? []) {
          const c = centres.get(part.centre);
          if (!c || ((await getMeta(c.handle.db, 'kind')) ?? 'centre') !== 'centre') throw new HttpError(400, { ar: 'المركز غير موجود', en: 'Centre not found' });
          part.centre_name = (await getMeta(c.handle.db, 'organisation')) ?? c.slug;
          if (part.project_id != null) {
            const pr = (await c.handle.db.query<{ name: string }>('SELECT name FROM account WHERE id = ?', [part.project_id]))[0];
            if (!pr) throw new HttpError(400, { ar: 'المشروع غير موجود', en: 'Project not found' });
            part.project_name = pr.name;
          }
        }
        await saveNetGrant(p.handle.db, g, ctx.who, new Date().toISOString());
        p.version++;
        return send(res, 200, { id: g.id });
      }
      if (url === '/api/province/grant/delete' && method === 'POST') {
        await deleteNetGrant(p.handle.db, String(((await readBody(req)) as { id?: string }).id ?? ''), ctx.who);
        return send(res, 200, { ok: true });
      }
      // the projects of every centre on this server (to split a grant between them); a new one in a centre
      if (url === '/api/province/projects' && method === 'GET') {
        const out = [];
        for (const x of centres.values()) {
          if ((config.inactive ?? []).includes(x.slug) || ((await getMeta(x.handle.db, 'kind')) ?? 'centre') !== 'centre' || (await setupNeeded(x))) continue;
          const projects = await x.handle.db.query<{ id: number; name: string; start_date: string | null; end_date: string | null; outside_budget: number; active: number }>(
            'SELECT id, name, start_date, end_date, outside_budget, active FROM account ORDER BY sort, name');
          out.push({ slug: x.slug, organisation: (await getMeta(x.handle.db, 'organisation')) ?? x.slug, projects, copy: config.copies?.[x.slug]?.at ?? null });
        }
        return send(res, 200, out);
      }
      if (url === '/api/province/project' && method === 'POST') {
        const b = (await readBody(req)) as { centre?: string; name?: string; start_date?: string | null; end_date?: string | null };
        const c = centres.get(String(b.centre ?? ''));
        if (!c) throw new HttpError(404, { ar: 'المركز غير موجود', en: 'Centre not found' });
        if (config.copies?.[c.slug]) throw new HttpError(400, { ar: 'هذه نسخة من خادم آخر: يُنشأ المشروع هناك', en: 'This is a copy from another server: the project is made there' });
        const books = (await c.handle.db.query<{ id: number }>('SELECT id FROM book')).map((x) => x.id);
        const cctx: OpCtx = { db: c.handle.db, profile: { ...ctx.profile, books }, who: ctx.who, install: 'office', files: c.files };
        const name = String(b.name ?? '').trim();
        await runOp(cctx, 'list.add', { table: 'account', name });
        const id = (await c.handle.db.query<{ id: number }>('SELECT id FROM account WHERE name = ?', [name]))[0].id;
        if (b.start_date || b.end_date) await runOp(cctx, 'account.setDates', { id, start_date: b.start_date ?? null, end_date: b.end_date ?? null });
        c.version++;
        log(`Coordinator: project "${name}" made in ${c.slug} (by ${byName})`);
        return send(res, 200, { id });
      }
      // ---- the report of one grant across the centres (Fouad, 2026-11-07): each part's project, in its centre (or a
      // copy from another server) — planned, sent, accepted, its budget and what it spent; by activity and by line
      if (url === '/api/province/grant-report' && method === 'GET') {
        const gid = new URL(req.url ?? '/', 'http://x').searchParams.get('id') ?? '';
        const g = (await listNetGrants(p.handle.db)).find((x) => x.id === gid);
        if (!g) throw new HttpError(404, { ar: 'المنحة غير موجودة', en: 'Grant not found' });
        const sends = await p.handle.db.query<{ centre: string; project_id: number | null; usd: number; syp: number; ok: number }>(
          'SELECT s.centre, s.project_id, t.trf_usd AS usd, t.trf_syp AS syp, (t.received_at IS NOT NULL) AS ok FROM net_send s JOIN trx t ON t.id = s.trx_id WHERE t.grant_id = ?', [gid]);
        const period = { from: g.start_date?.slice(0, 7) ?? '2000-01', to: g.end_date?.slice(0, 7) ?? '2999-12' };
        const parts: GrantReportPartIn[] = [];
        for (const part of g.parts) {
          const c = centres.get(part.centre);
          const mine = sends.filter((x) => x.centre === part.centre && x.project_id === part.project_id);
          const base: GrantReportPartIn = {
            centre: part.centre, centre_name: part.centre_name ?? part.centre, project_name: part.project_name, copy_at: config.copies?.[part.centre]?.at ?? null,
            planned: partAmount(g, part), sent_usd: mine.reduce((a, x) => a + x.usd, 0), sent_syp: mine.reduce((a, x) => a + x.syp, 0),
            accepted_usd: mine.filter((x) => x.ok).reduce((a, x) => a + x.usd, 0), accepted_syp: mine.filter((x) => x.ok).reduce((a, x) => a + x.syp, 0), lines: [],
          };
          if (c && part.project_id != null) {
            const books = (await c.handle.db.query<{ id: number }>('SELECT id FROM book')).map((x) => x.id);
            const cctx: OpCtx = { db: c.handle.db, profile: { ...ctx.profile, books }, who: ctx.who, install: 'office', files: c.files };
            const d = (await runOp(cctx, 'data', {})) as DataPayload;
            const comp = computeAll(d.rows, d.lists);
            const pr = projectReport({ rows: d.rows, comp, lists: d.lists, grants: d.grants, grantParts: d.grantParts, grantShares: d.grantShares, period }).find((x) => x.id === part.project_id);
            // its budget: the lines given to it in every budget of the grant's period (e.g. Jan–Jun 2027, then Jul 2027–Dec 2028)
            const all = (await runOp(cctx, 'budget.get', {})) as BudgetPayload;
            const bud: BudgetPayload['amounts'] = [];
            for (const x of all.budgets.filter((y) => y.start_ym <= period.to && periodEnd(y) >= period.from))
              bud.push(...((await runOp(cctx, 'budget.get', { budgetId: x.id })) as BudgetPayload).amounts.filter((a) => a.account_id === part.project_id));
            const line = (id: number | null) => d.lists.lines.find((l) => l.id === id);
            const head = (id: number | null) => d.lists.headings.find((h) => h.id === id)?.name ?? '—';
            const keys = new Set<number | null>([...bud.map((x) => x.line_id), ...(pr?.lines ?? []).map((x) => x.line_id)]);
            for (const lid of keys) {
              const l = line(lid);
              base.lines.push({
                key: l?.uid ?? `${head(l?.heading_id ?? null)}|${l?.name ?? '—'}`, heading: head(l?.heading_id ?? pr?.lines.find((x) => x.line_id === lid)?.heading_id ?? null), line: l?.name ?? '—',
                budget: bud.filter((x) => x.line_id === lid).reduce((a, x) => a + x.amount_usd, 0),
                spent: (pr?.lines ?? []).filter((x) => x.line_id === lid).reduce((a, x) => a + x.spent, 0),
              });
            }
          }
          parts.push(base);
        }
        return send(res, 200, { grant: g, report: grantReport(parts) });
      }
      // ---- a copy of a centre from another server (Fouad, 2026-11-07): a backup brought here, read only, counted in
      // the Coordinator's reports. Updated by a newer backup of the same centre; an older one is refused.
      if (url === '/api/province/copy' && method === 'POST') {
        const b = (await readBody(req)) as { base64?: string; slug?: string };
        const tmp = path.join(dataDir, `copy-${Date.now()}.db`);
        fs.writeFileSync(tmp, Buffer.from(String(b.base64 ?? ''), 'base64'));
        let org: string | null = null, latest: string | null = null, kind: string | null = null;
        try {
          const test = openDb(tmp);
          try {
            await migrate(test.db);
            org = await getMeta(test.db, 'organisation');
            kind = await getMeta(test.db, 'kind');
            latest = (await test.db.query<{ m: string | null }>('SELECT MAX(at) AS m FROM audit_log'))[0]?.m ?? null;
          } finally {
            test.close();
          }
        } catch {
          fs.rmSync(tmp, { force: true });
          throw new HttpError(400, { ar: 'ليس ملف قاعدة بيانات صالحاً', en: 'Not a valid database file' });
        }
        if ((kind ?? 'centre') !== 'centre') { fs.rmSync(tmp, { force: true }); throw new HttpError(400, { ar: 'ليست قاعدة مركز', en: "This is not a centre's database" }); }
        let c: Centre;
        if (b.slug) {
          const was = config.copies?.[b.slug];
          const cur = centres.get(b.slug);
          if (!was || !cur) { fs.rmSync(tmp, { force: true }); throw new HttpError(404, { ar: 'النسخة غير موجودة', en: 'Copy not found' }); }
          if (was.latest && latest && latest < was.latest) { fs.rmSync(tmp, { force: true }); throw new HttpError(400, { ar: 'هذه النسخة أقدم من التي عندك', en: 'This backup is older than the copy you have' }); }
          c = cur;
        } else {
          const base = `${slugify(org ?? 'centre')}-copy`;
          let slug = base;
          for (let i = 2; centres.has(slug) || fs.existsSync(path.join(dbsDir, slug)); i++) slug = `${base}-${i}`;
          c = await openCentre(slug);
        }
        c.handle.close();
        fs.copyFileSync(tmp, c.file);
        fs.rmSync(tmp, { force: true });
        c.handle = openDb(c.file);
        await migrate(c.handle.db);
        config = { ...config, copies: { ...(config.copies ?? {}), [c.slug]: { at: new Date().toISOString(), from: org, latest } } };
        writeConfig(dataDir, config);
        for (const [sid, x] of sessions) if (x.db === c.slug) sessions.delete(sid);
        c.version++;
        // its answers to the Province's sends (accepted, or "not received") reach the Province's account
        const answers = await c.handle.db.query<{ id: string; status: string; note: string | null; answered_at: string | null; answered_by: string | null }>(
          "SELECT id, status, note, answered_at, answered_by FROM province_send WHERE status <> 'waiting'");
        const ours = new Set((await p.handle.db.query<{ trx_id: string }>('SELECT trx_id FROM net_send WHERE centre = ?', [c.slug])).map((x) => x.trx_id));
        await p.handle.db.batch(answers.filter((x) => ours.has(x.id)).map((x) => x.status === 'accepted'
          ? { sql: 'UPDATE trx SET received_at = ?, received_by = ?, disputed_at = NULL, dispute_note = NULL WHERE id = ?', params: [x.answered_at, `${x.answered_by ?? ''} (${org ?? c.slug})`, x.id] }
          : { sql: 'UPDATE trx SET received_at = NULL, received_by = NULL, disputed_at = ?, dispute_note = ? WHERE id = ? AND received_at IS NULL', params: [x.answered_at, x.note, x.id] }));
        log(`Copy of ${org} ${b.slug ? 'updated' : 'brought'} as ${c.slug} (by ${byName})`);
        return send(res, 200, { slug: c.slug, organisation: org, latest, answers: answers.filter((x) => ours.has(x.id)).length });
      }
      // ---- sends to the centres (Fouad, 2026-11-07): a transfer from the Province account to "Sent to the centres", and
      // the same send waiting in the centre for its answer. Corrected or cancelled only while the centre has not accepted.
      const sentBook = async () => (await p.handle.db.query<{ id: number }>("SELECT id FROM book WHERE name = 'Sent to the centres'"))[0].id;
      if (url === '/api/province/sends' && method === 'GET') {
        const rows = await p.handle.db.query<Record<string, unknown>>(
          `SELECT s.*, t.date, t.trf_usd AS usd, t.trf_syp AS syp, t.grant_id, t.explanation, t.received_at, t.disputed_at, t.dispute_note
             FROM net_send s JOIN trx t ON t.id = s.trx_id ORDER BY t.date DESC, t.n DESC`);
        return send(res, 200, rows);
      }
      if (url === '/api/province/send' && method === 'POST') {
        const b = (await readBody(req)) as { id?: string; date?: string; centre?: string; project_id?: number | null; grant_id?: string | null; cur?: 'USD' | 'SYP'; amount?: number; explanation?: string };
        const c = centres.get(String(b.centre ?? ''));
        if (!c || ((await getMeta(c.handle.db, 'kind')) ?? 'centre') !== 'centre') throw new HttpError(400, { ar: 'المركز غير موجود', en: 'Centre not found' });
        const amount = Number(b.amount);
        if (!(amount > 0)) throw new HttpError(400, { ar: 'المبلغ مطلوب', en: 'The amount is required' });
        if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new HttpError(400, { ar: 'التاريخ مطلوب', en: 'The date is required' });
        const project = b.project_id != null ? (await c.handle.db.query<{ id: number; name: string }>('SELECT id, name FROM account WHERE id = ?', [b.project_id]))[0] : null;
        if (b.project_id != null && !project) throw new HttpError(400, { ar: 'المشروع غير موجود', en: 'Project not found' });
        const grant = b.grant_id ? (await p.handle.db.query<{ donor: string; reference: string | null }>('SELECT donor, reference FROM net_grant WHERE id = ?', [b.grant_id]))[0] : null;
        const org = (await getMeta(c.handle.db, 'organisation')) ?? c.slug;
        if (!project) throw new HttpError(400, { ar: 'اختر المشروع', en: 'Choose the project' });
        // (as a grant's money leaves the Respo only when its steps are done: the project has its dates and a budget line)
        const pDates = (await c.handle.db.query<{ start_date: string | null; end_date: string | null }>('SELECT start_date, end_date FROM account WHERE id = ?', [project.id]))[0];
        if (!pDates?.start_date || !pDates.end_date) throw new HttpError(400, { ar: `للمشروع «${project.name}» تاريخا بداية ونهاية أولاً`, en: `The project "${project.name}" needs its start and end dates first` });
        if (!(await c.handle.db.query('SELECT 1 FROM budget_amount WHERE account_id = ? LIMIT 1', [project.id])).length)
          throw new HttpError(400, { ar: `أعطِ المشروع «${project.name}» خطاً واحداً على الأقل في موازنة المركز أولاً`, en: `Give the project "${project.name}" at least one line of the centre's budget first` });
        const id = b.id || `send-${newUid()}`;
        // a correction: the send exists on the Province's account, and the centre has not accepted it (a copy from
        // another server knows its answer only from its last copy)
        const sentRow = b.id ? (await p.handle.db.query<{ received_at: string | null }>('SELECT t.received_at FROM net_send s JOIN trx t ON t.id = s.trx_id WHERE s.trx_id = ?', [id]))[0] : null;
        if (b.id && !sentRow) throw new HttpError(404, { ar: 'الإرسال غير موجود', en: 'Send not found' });
        const old = b.id ? (config.copies?.[c.slug] ? { status: 'waiting' } : (await c.handle.db.query<{ status: string }>('SELECT status FROM province_send WHERE id = ?', [id]))[0] ?? { status: 'waiting' }) : null;
        if (sentRow?.received_at || old?.status === 'accepted') throw new HttpError(400, { ar: 'قبله المركز: لا يتغير', en: 'The centre accepted it: it no longer changes' });
        const L = await loadLists(p.handle.db);
        const tHead = L.headings.find((h) => h.name === 'Transfer')!;
        const tLine = L.lines.find((l) => l.heading_id === tHead.id)!;
        const usd = b.cur === 'SYP' ? 0 : amount;
        const syp = b.cur === 'SYP' ? amount : 0;
        const explanation = `${String(b.explanation ?? '').trim() || (grant ? `${grant.donor}${grant.reference ? ` · ${grant.reference}` : ''}` : 'Province')} → ${org}${project ? ` · ${project.name}` : ''}`;
        await runOp(ctx, 'trx.save', { rows: [{ ...blankTrx(), id, type: 'Transfer', date: b.date, book_id: await sentBook(), city_id: L.cities[0]?.id ?? null, heading_id: tHead.id, line_id: tLine.id, trf_usd: usd, trf_syp: syp, grant_id: b.grant_id || null, explanation }], reason: old ? 'send corrected' : null });
        await p.handle.db.batch([
          { sql: 'INSERT OR REPLACE INTO net_send (trx_id, centre, centre_name, project_id, project_name) VALUES (?, ?, ?, ?, ?)', params: [id, c.slug, org, project?.id ?? null, project?.name ?? null] },
          { sql: 'UPDATE trx SET received_at = NULL, received_by = NULL, disputed_at = NULL, dispute_note = NULL WHERE id = ?', params: [id] },
        ]);
        // the centre sees it, waiting for its answer (a correction waits again). A copy from another server is only
        // read here: that centre takes the send from a file (see /api/province/send-file)
        if (!config.copies?.[c.slug]) await c.handle.db.batch([
          { sql: `INSERT INTO province_send (id, date, usd, syp, project_id, donor, reference, explanation, sent_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')
                  ON CONFLICT(id) DO UPDATE SET date = excluded.date, usd = excluded.usd, syp = excluded.syp, project_id = excluded.project_id, donor = excluded.donor,
                  reference = excluded.reference, explanation = excluded.explanation, sent_by = excluded.sent_by, status = 'waiting', note = NULL, answered_at = NULL, answered_by = NULL`,
            params: [id, b.date, usd, syp, project?.id ?? null, grant?.donor ?? null, grant?.reference ?? null, explanation, byName] },
          auditStmt(ctx.who, old ? 'correct' : 'send', 'province_send', id, null, { usd, syp, date: b.date }),
        ]);
        c.version++;
        p.version++;
        log(`Province: ${usd ? `$${usd}` : `${syp} SYP`} sent to ${c.slug} (by ${byName})`);
        return send(res, 200, { id });
      }
      // the sends still waiting for a centre on another server, as a file for that centre
      if (url === '/api/province/send-file' && method === 'GET') {
        const centre = new URL(req.url ?? '/', 'http://x').searchParams.get('centre') ?? '';
        const rows = await p.handle.db.query<{ id: string; date: string; usd: number; syp: number; project_id: number | null; explanation: string | null; grant_id: string | null; received_at: string | null }>(
          `SELECT t.id, t.date, t.trf_usd AS usd, t.trf_syp AS syp, s.project_id, t.explanation, t.grant_id, t.received_at
             FROM net_send s JOIN trx t ON t.id = s.trx_id WHERE s.centre = ? AND t.received_at IS NULL ORDER BY t.date`, [centre]);
        const grants = await listNetGrants(p.handle.db);
        const sends = rows.map((r) => {
          const g = grants.find((x) => x.id === r.grant_id);
          return { id: r.id, date: r.date, usd: r.usd, syp: r.syp, project_id: r.project_id, donor: g?.donor ?? null, reference: g?.reference ?? null, explanation: r.explanation, sent_by: byName };
        });
        return send(res, 200, { kind: 'magis-province-sends', centre, organisation: config.copies?.[centre]?.from ?? centre, made_at: new Date().toISOString(), sends });
      }
      if (url === '/api/province/send/cancel' && method === 'POST') {
        const id = String(((await readBody(req)) as { id?: string }).id ?? '');
        const ns = (await p.handle.db.query<{ centre: string }>('SELECT centre FROM net_send WHERE trx_id = ?', [id]))[0];
        if (!ns) throw new HttpError(404, { ar: 'الإرسال غير موجود', en: 'Send not found' });
        const c = centres.get(ns.centre);
        if (c && (await c.handle.db.query<{ status: string }>('SELECT status FROM province_send WHERE id = ?', [id]))[0]?.status === 'accepted')
          throw new HttpError(400, { ar: 'قبله المركز: لا يُلغى', en: 'The centre accepted it: it is not cancelled' });
        await runOp(ctx, 'trx.delete', { ids: [id], reason: 'send cancelled' });
        await p.handle.db.batch([{ sql: 'DELETE FROM net_send WHERE trx_id = ?', params: [id] }]);
        if (c && !config.copies?.[c.slug]) {
          await c.handle.db.batch([{ sql: 'DELETE FROM province_send WHERE id = ?', params: [id] }, auditStmt(ctx.who, 'cancel', 'province_send', id, null, null)]);
          c.version++;
        }
        p.version++;
        return send(res, 200, { ok: true });
      }
      const pop = /^\/api\/province\/op\/([\w.]+)$/.exec(url)?.[1];
      if (pop && method === 'POST') {
        if (!['trx.save', 'trx.delete', 'month.close', 'month.reopen', 'closing.problems'].includes(pop)) throw new HttpError(400, { ar: 'غير مسموح', en: 'Not allowed' });
        const args = (await readBody(req)) as { ym?: string };
        // "Sent to the centres" holds no cash: its month closes and reopens with the Province's
        const ym = String(args.ym ?? '');
        if (pop === 'month.close' || pop === 'month.reopen') {
          const sb = await sentBook();
          if (pop === 'month.close') await p.handle.db.batch([{ sql: "INSERT OR IGNORE INTO book_month (book_id, ym, closed_at, closed_by, book_syp, book_usd, counted_syp, counted_usd, count_note) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'sent to the centres')", params: [sb, ym, new Date().toISOString(), ctx.who] }]);
          try {
            const result = await runOp(ctx, pop, args);
            if (pop === 'month.reopen') await p.handle.db.batch([{ sql: 'DELETE FROM book_month WHERE book_id = ? AND ym = ?', params: [sb, ym] }]);
            p.version++;
            return send(res, 200, result ?? { ok: true });
          } catch (e) {
            if (pop === 'month.close') await p.handle.db.batch([{ sql: 'DELETE FROM book_month WHERE book_id = ? AND ym = ? AND count_note = ?', params: [sb, ym, 'sent to the centres'] }]);
            throw e;
          }
        }
        const result = await runOp(ctx, pop, args);
        // euros received with a dollar row: kept beside it (and gone with it)
        const eur = (args as { eur?: Record<string, number> }).eur;
        if (pop === 'trx.save' && eur) await p.handle.db.batch(Object.entries(eur).map(([id, v]) => (Number(v) > 0
          ? { sql: 'INSERT OR REPLACE INTO net_eur_in (trx_id, eur) VALUES (?, ?)', params: [id, Number(v)] }
          : { sql: 'DELETE FROM net_eur_in WHERE trx_id = ?', params: [id] })));
        if (pop === 'trx.delete') await p.handle.db.batch(((args as { ids?: string[] }).ids ?? []).map((id) => ({ sql: 'DELETE FROM net_eur_in WHERE trx_id = ?', params: [id] })));
        p.version++;
        return send(res, 200, result ?? { ok: true });
      }
    }
    // ---- All centres together (Fouad, 2026-11-01; /rows: their incomes and expenses for Explore): every centre database on this server (a copy of another centre's,
    // brought here, counts like the others), joined by project and by grant. For who keeps the grants and manages the
    // users of the database they are in; with the directory, only the centres given to the person.
    if ((url === '/api/all-centres' || url === '/api/all-centres/rows') && method === 'POST') {
      if (!found || !allCentresAllowed()) throw new HttpError(403, { ar: 'لمدير الخادم فقط', en: 'For the administrator only' });
      const body = (await readBody(req)) as { from?: string; to?: string };
      const ym = (x: unknown, d: string) => (typeof x === 'string' && /^\d{4}-\d{2}$/.test(x) ? x : d);
      const year = new Date().toISOString().slice(0, 4);
      const period = { from: ym(body.from, `${year}-01`), to: ym(body.to, `${year}-12`) };
      const inputs: CentreInput[] = [];
      const explore: ExploreRow[] = [];
      for (const x of centres.values()) {
        if ((config.inactive ?? []).includes(x.slug) || ((await getMeta(x.handle.db, 'kind')) ?? 'centre') !== 'centre' || (dirPerson && !dirSees(dirPerson, x.slug))) continue;
        const org = (await getMeta(x.handle.db, 'organisation')) ?? x.slug;
        const books = (await x.handle.db.query<{ id: number }>('SELECT id FROM book')).map((b) => b.id);
        const ctx: OpCtx = { db: x.handle.db, profile: { id: 0, name: 'All centres', role: 'sup', book_id: null, active: 1, access_id: null, access_name: 'All centres', perms: ['register.view', 'lists.donors'], books }, who: `All centres · ${found[1].profile.name}`, install: 'office', files: x.files };
        const d = (await runOp(ctx, 'data', {})) as DataPayload;
        const rows = d.rows.filter((r) => r.book_id == null || r.book_id !== d.grantsBookId);
        const key = (await getMeta(x.handle.db, 'centre')) ?? guessCentre(org);
        const comp = computeAll(rows, d.lists);
        inputs.push({ slug: x.slug, organisation: org, centre: key, rows, comp, lists: d.lists, grants: d.grants, grantParts: d.grantParts, grantShares: d.grantShares });
        // (Explore: the incomes and expenses, with names and the common list's identities, so the centres go together)
        if (url === '/api/all-centres/rows') explore.push(...exploreRows({ rows, comp, lists: d.lists, centre: key, organisation: org, period }));
      }
      if (url === '/api/all-centres/rows') return send(res, 200, explore);
      inputs.sort((a, b) => CENTRE_KEYS.indexOf(a.centre as CentreKey) - CENTRE_KEYS.indexOf(b.centre as CentreKey) || a.organisation.localeCompare(b.organisation));
      return send(res, 200, { period, ...allCentresReport(inputs, period) });
    }
    if (url === '/api/hr/sources' && method === 'GET') {
      if (!found || (await getMeta(found[2].handle.db, 'kind')) !== 'hr' || !has(found[1].profile, 'hr.manage')) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const out = [];
      for (const x of centres.values()) {
        if ((config.inactive ?? []).includes(x.slug) || config.copies?.[x.slug]) continue;
        const k = (await getMeta(x.handle.db, 'kind')) ?? 'centre';
        if (k !== 'centre' || (dirPerson && !dirSees(dirPerson, x.slug))) continue;
        const org = (await getMeta(x.handle.db, 'organisation')) ?? x.slug;
        const sc = found[1].profile.hrCentres;
        if (sc?.length && !sc.includes((await getMeta(x.handle.db, 'centre')) ?? guessCentre(org))) continue;
        out.push({ slug: x.slug, organisation: org });
      }
      return send(res, 200, out);
    }
    // ---- HR: the lists of a centre copied into HR (Fouad, 30 October 2026; 2 November: by the lines' identity, and by
    // itself when the centre's budget changed). Names and codes only, never amounts: the centre, its projects with
    // their donor, its lines with each line's project. A line renamed or recoded keeps its people; a line merged into
    // another when the centre joined the common list takes its people to that line.
    const hrListsOf = async (src: Centre) => {
      const org = (await getMeta(src.handle.db, 'organisation')) ?? src.slug;
      const centreKey = (await getMeta(src.handle.db, 'centre')) ?? guessCentre(org);
      const accounts = await src.handle.db.query<{ name: string }>('SELECT name FROM account WHERE active = 1 ORDER BY sort, name');
      // the donor of each project: the donor (and contract) of its grant (Fouad, 2026-11-01: a project has one grant)
      const grants = await src.handle.db.query<{ donor: string; reference: string | null; account: string }>('SELECT d.name AS donor, g.reference, a.name AS account FROM grant_card g JOIN donor d ON d.id = g.donor_id JOIN grant_part p ON p.grant_id = g.id JOIN account a ON a.id = p.account_id');
      const donorsOf = (acc: string) => [...new Set(grants.filter((g) => g.account.toLowerCase() === acc.toLowerCase()).map((g) => (g.reference ? `${g.donor} ${g.reference}` : g.donor)))].sort().join(' | ') || null;
      // each line with its project in the centre's budget (the one running today, else the latest): a salary follows it
      const now = new Date().toISOString().slice(0, 7);
      const budget = (await src.handle.db.query<{ id: number; start_ym: string; months: number }>('SELECT id, start_ym, months FROM budget ORDER BY start_ym, id'))
        .reduce<{ id: number } | null>((best, b) => (now >= b.start_ym ? b : best ?? b), null);
      const lines = await src.handle.db.query<{ uid: string; name: string; code: string; heading: string; project: string | null }>(
        `SELECT l.uid, l.name, l.code, h.name AS heading,
                (SELECT a.name FROM budget_amount x JOIN account a ON a.id = x.account_id
                  WHERE x.line_id = l.id AND x.version_id = (SELECT v.id FROM budget_version v WHERE v.budget_id = ? ORDER BY v.rev DESC LIMIT 1)) AS project
           FROM budget_line l JOIN heading h ON h.id = l.heading_id
          WHERE l.active = 1 AND h.active = 1 AND EXISTS (SELECT 1 FROM heading_type t WHERE t.heading_id = h.id AND t.type = 'Exp')
          ORDER BY h.sort, l.code`, [budget?.id ?? -1]);
      const merged = await src.handle.db.query<{ uid: string; into: string }>('SELECT l.uid, t.uid AS "into" FROM budget_line l JOIN budget_line t ON t.id = l.merged_into');
      const hash = JSON.stringify([lines, accounts.map((a) => [a.name, donorsOf(a.name)])]);
      return { org, centreKey, accounts, donorsOf, lines, merged, hash };
    };
    const copyHrLists = async (hdb: Db, src: Centre, who: string) => {
      const { org, centreKey, accounts, donorsOf, lines, merged, hash } = await hrListsOf(src);
      const CITY: Record<string, [string, string]> = { aleppo: ['حلب', 'Aleppo'], homs: ['حمص', 'Homs'], jaramana: ['جرمانا', 'Jaramana'] };
      const label = (l: { code: string | null; name: string }) => (l.code ? `${l.code} · ${l.name}` : l.name);
      const have = await hdb.query<{ id: number; uid: string | null; code: string | null; name: string }>("SELECT id, uid, code, name FROM hr_list WHERE kind = 'line' AND source = ?", [src.slug]);
      const byUid = new Map(lines.map((l) => [l.uid, l]));
      const mergedInto = new Map(merged.map((x) => [x.uid, x.into]));
      // the people of this centre (a label like "E01.8 · Reception" may be the same in another centre)
      const people = `centre IN (SELECT name FROM hr_list WHERE kind = 'centre' AND source = ?)`;
      const stmts: Stmt[] = [
        // the centre with its mark and city; the first party and who signs are filled for Aleppo from Fouad's agreement
        // (the others are written by hand in the Lists page)
        { sql: "INSERT OR IGNORE INTO hr_list (kind, name, code, source, city_ar, city_en, party_ar, rep_ar) VALUES ('centre', ?, ?, ?, ?, ?, ?, ?)", params: [org, centreKey, src.slug, CITY[centreKey]?.[0] ?? null, CITY[centreKey]?.[1] ?? null, centreKey === 'aleppo' ? 'دير الآباء اليسوعيين في حلب' : null, centreKey === 'aleppo' ? 'الأب فؤاد نخلة اليسوعي' : null] },
        // (an account has no code, and NULL codes are all different for UNIQUE: so a copy again checks by name and source)
        ...accounts.map((a) => ({ sql: "INSERT INTO hr_list (kind, name, source) SELECT 'account', ?, ? WHERE NOT EXISTS (SELECT 1 FROM hr_list WHERE kind = 'account' AND name = ? AND source = ?)", params: [a.name, src.slug, a.name, src.slug] })),
        ...accounts.map((a) => ({ sql: "UPDATE hr_list SET donors = ? WHERE kind = 'account' AND name = ? AND source = ?", params: [donorsOf(a.name), a.name, src.slug] })),
      ];
      const kept = new Set<string>();
      const relabel: { from: string; to: string }[] = [];
      const recode: { id: number; code: string | null }[] = [];
      for (const h of have) {
        // a line copied before the identities: known by its code and name
        const uid = h.uid ?? lines.find((l) => l.code === h.code && l.name === h.name)?.uid ?? null;
        const now = uid ? byUid.get(uid) ?? (mergedInto.has(uid) ? byUid.get(mergedInto.get(uid)!) : undefined) : undefined;
        if (!now) continue; // gone from the centre: removed below
        if (label(h) !== label(now)) relabel.push({ from: label(h), to: label(now) });
        if (kept.has(now.uid)) { stmts.push({ sql: 'DELETE FROM hr_list WHERE id = ?', params: [h.id] }); continue; }
        kept.add(now.uid);
        // (the list allows one row per name and code: two lines of the same name that swap codes go through a marker)
        const moves = h.code !== now.code;
        if (moves) recode.push({ id: h.id, code: now.code });
        stmts.push({ sql: 'UPDATE hr_list SET uid = ?, name = ?, code = ?, heading = ?, account = ? WHERE id = ?', params: [now.uid, now.name, moves ? `\u0001${h.id}` : now.code, now.heading, now.project, h.id] });
      }
      // (a Renumber can swap two labels, e.g. "E01.2 · Reception" and "E02.2 · Reception": first every changed label goes to a
      // marker, then to its new one — else the second change would also take the people of the first)
      relabel.forEach((x, i) => stmts.push({ sql: `UPDATE hr_person SET budget_line = ? WHERE budget_line = ? AND ${people}`, params: [`\u0001${i}`, x.from, src.slug] }));
      relabel.forEach((x, i) => stmts.push({ sql: `UPDATE hr_person SET budget_line = ? WHERE budget_line = ? AND ${people}`, params: [x.to, `\u0001${i}`, src.slug] }));
      for (const x of recode) stmts.push({ sql: 'UPDATE hr_list SET code = ? WHERE id = ?', params: [x.code, x.id] });
      for (const l of lines) if (!kept.has(l.uid)) stmts.push({ sql: "INSERT OR IGNORE INTO hr_list (kind, name, code, heading, source, uid, account) VALUES ('line', ?, ?, ?, ?, ?, ?)", params: [l.name, l.code, l.heading, src.slug, l.uid, l.project] });
      // what the centre no longer has (a line or an account switched off or removed) leaves the HR lists too
      stmts.push(
        { sql: `DELETE FROM hr_list WHERE kind = 'line' AND source = ? AND (uid IS NULL OR uid NOT IN (${lines.map(() => '?').join(',') || "''"}))`, params: [src.slug, ...lines.map((l) => l.uid)] },
        { sql: `DELETE FROM hr_list WHERE kind = 'account' AND source = ? AND name NOT IN (${accounts.map(() => '?').join(',') || "''"})`, params: [src.slug, ...accounts.map((a) => a.name)] },
      );
      // the heading that holds the salaries, when not set yet
      const hs = lines.map((l) => l.heading);
      // the staff heading(s): one with both words, else those with "salary", else those with "staff" (e.g. Implementation staff | Operational staff)
      const uniq = [...new Set(hs)];
      const both = uniq.filter((h) => /staff/i.test(h) && /salar/i.test(h)), sal = uniq.filter((h) => /salar|رات/i.test(h)), staff = uniq.filter((h) => /staff/i.test(h) && !/care/i.test(h));
      const salaryHeading = (both.length ? both : sal.length ? sal : staff).join(' | ') || null;
      stmts.push({ sql: "UPDATE hr_list SET salary_heading = COALESCE(salary_heading, ?), copied_hash = ? WHERE kind = 'centre' AND source = ?", params: [salaryHeading, hash, src.slug] });
      // the lines tutors are paid on: suggested the first time (the courses and the facilitators), then the centre's own choice stays
      stmts.push({ sql: `UPDATE hr_list SET tutor = 1 WHERE kind = 'line' AND source = ?
          AND NOT EXISTS (SELECT 1 FROM hr_list x WHERE x.kind = 'line' AND x.source = ? AND x.tutor = 1)
          AND (heading LIKE '%formation%' OR heading LIKE '%teacher%' OR name LIKE '%facilitator%' OR name LIKE '%teacher%')`, params: [src.slug, src.slug] });
      await hdb.batch(stmts);
      log(`HR lists filled from ${src.slug}: ${accounts.length} projects, ${lines.length} lines (by ${who})`);
      return { accounts: accounts.length, lines: lines.length };
    };
    // a centre this HR keeper may copy from
    const hrSource = async (slug: unknown, profile: Profile) => {
      const src = centres.get(String(slug));
      if (!src || (config.inactive ?? []).includes(src.slug) || config.copies?.[src.slug] || ((await getMeta(src.handle.db, 'kind')) ?? 'centre') !== 'centre' || (dirPerson && !dirSees(dirPerson, src.slug))) return null;
      const org = (await getMeta(src.handle.db, 'organisation')) ?? src.slug;
      const key = (await getMeta(src.handle.db, 'centre')) ?? guessCentre(org);
      // an HR keeper of some centres fills the lists of those centres only
      if (profile.hrCentres?.length && !profile.hrCentres.includes(key)) return null;
      return src;
    };
    if (url === '/api/hr/import-lists' && method === 'POST') {
      if (!found || (await getMeta(found[2].handle.db, 'kind')) !== 'hr' || !has(found[1].profile, 'hr.manage')) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const body = (await readBody(req)) as { from?: string };
      const src = await hrSource(body.from, found[1].profile);
      if (!src) throw new HttpError(404, { ar: 'قاعدة المصدر غير موجودة أو خارج مراكزك', en: 'Source database not found, or outside your centres' });
      const r = await copyHrLists(found[2].handle.db, src, found[1].profile.name);
      found[2].version++;
      return send(res, 200, { centres: 1, ...r });
    }
    // HR opened: the centres whose budget or lists changed since the last copy are copied again, by themselves
    if (url === '/api/hr/refresh-lists' && method === 'POST') {
      if (!found || (await getMeta(found[2].handle.db, 'kind')) !== 'hr' || !has(found[1].profile, 'hr.manage')) return send(res, 200, { refreshed: [] });
      const hdb = found[2].handle.db;
      const refreshed: string[] = [];
      for (const c of await hdb.query<{ name: string; source: string; copied_hash: string | null }>("SELECT name, source, copied_hash FROM hr_list WHERE kind = 'centre' AND source IS NOT NULL")) {
        const src = await hrSource(c.source, found[1].profile);
        if (!src) continue;
        if ((await hrListsOf(src)).hash === c.copied_hash) continue;
        await copyHrLists(hdb, src, `${found[1].profile.name} (by itself)`);
        refreshed.push(c.name);
      }
      if (refreshed.length) found[2].version++;
      return send(res, 200, { refreshed });
    }

    // ---- HR: the positions of the scale can come from the salary lines of the centres' budgets (Fouad, 30 October 2026).
    // This only LISTS what it finds (name, centre, the unit cost of the latest budget); the screen creates the ones ticked.
    if (url === '/api/hr/positions-from-budget' && method === 'GET') {
      if (!found || (await getMeta(found[2].handle.db, 'kind')) !== 'hr' || !has(found[1].profile, 'hr.pay')) throw new HttpError(403, { ar: 'غير مسموح', en: 'Not allowed' });
      const hdb = found[2].handle.db;
      const have = new Set((await hdb.query<{ name: string }>('SELECT name FROM hr_grade')).map((x) => x.name.toLowerCase()));
      const out = new Map<string, { name: string; centres: string[]; amount: number | null; exists: boolean }>();
      const hrScope = found[1].profile.hrCentres;
      for (const c of await hdb.query<{ name: string; source: string; salary_heading: string | null; code: string | null }>("SELECT name, source, salary_heading, code FROM hr_list WHERE kind = 'centre' AND source IS NOT NULL AND salary_heading IS NOT NULL")) {
        if (hrScope?.length && (!c.code || !hrScope.includes(c.code))) continue;
        const src = centres.get(c.source);
        if (!src || (config.inactive ?? []).includes(src.slug) || (dirPerson && !dirSees(dirPerson, src.slug))) continue;
        const heads = c.salary_heading!.split('|').map((h) => h.trim()).filter(Boolean);
        const lines = await src.handle.db.query<{ id: number; name: string }>(`SELECT l.id, l.name FROM budget_line l JOIN heading h ON h.id = l.heading_id WHERE l.active = 1 AND h.name IN (${heads.map(() => '?').join(',')}) ORDER BY l.code`, heads);
        for (const l of lines) {
          if (/insurance|تأمين|care/i.test(l.name)) continue;
          const cost = (await src.handle.db.query<{ unit_cost: number }>('SELECT i.unit_cost FROM budget_item i WHERE i.line_id = ? ORDER BY i.version_id DESC, i.id LIMIT 1', [l.id]))[0]?.unit_cost ?? null;
          const key = l.name.toLowerCase();
          const cur = out.get(key) ?? { name: l.name, centres: [], amount: null, exists: have.has(key) };
          cur.centres.push(c.name);
          if (cur.amount == null) cur.amount = cost;
          out.set(key, cur);
        }
      }
      return send(res, 200, [...out.values()]);
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
      const run = await one<{ id: number; ym: string; kind: string; status: string; paid_on: string | null; centre: string | null }>(hdb, 'SELECT id, ym, kind, status, paid_on, centre FROM hr_run WHERE id = ?', [Number(body.runId)]);
      if (!run) throw new HttpError(404, { ar: 'الكشف غير موجود', en: 'Run not found' });
      const hrScope = hs.profile.hrCentres;
      if (hrScope?.length && (!run.centre || !hrScope.includes(run.centre))) throw new HttpError(403, { ar: 'خارج مراكزك', en: 'Outside your centres' });
      if (run.status === 'draft') throw new HttpError(400, { ar: 'اعتمد الكشف أولاً', en: 'Approve the run first' });
      const lists = await hdb.query<HrListItem>('SELECT * FROM hr_list');
      const people = await hdb.query<HrPerson>('SELECT * FROM hr_person');
      const lines = await hdb.query<{ person_id: number; paid_in: 'USD' | 'SYP'; amount_paid: number; total_usd: number }>('SELECT person_id, paid_in, amount_paid, total_usd FROM hr_run_line WHERE run_id = ?', [run.id]);
      const sent = new Set((await hdb.query<{ centre: string }>('SELECT centre FROM hr_run_sent WHERE run_id = ?', [run.id])).map((x) => x.centre));
      const last = `${run.ym}-${String(new Date(Date.UTC(Number(run.ym.slice(0, 4)), Number(run.ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
      // every line: its centre, its budget line, and the project of that line (none: not funded)
      type Part = { account: string | null; line: string; cur: 'USD' | 'SYP'; amount: number; usd: number; person: number };
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
        if (!line) continue;
        byCentre.set(c.source!, [...(byCentre.get(c.source!) ?? []), { account: own, line: line.code ?? line.name, cur: l.paid_in, amount: l.amount_paid, usd: l.total_usd, person: p.id }]);
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
        const groups = new Map<string, { account: string | null; line: string; cur: 'USD' | 'SYP'; amount: number; usd: number; people: Set<number> }>();
        for (const x of parts) {
          const k = JSON.stringify([x.account, x.line, x.cur]);
          const g = groups.get(k) ?? { account: x.account, line: x.line, cur: x.cur, amount: 0, usd: 0, people: new Set<number>() };
          g.amount += x.amount; g.usd += x.usd; g.people.add(x.person);
          groups.set(k, g);
        }
        const what = run.kind === 'thirteenth' ? `13th payment ${run.ym.slice(0, 4)} · الدفعة الثالثة عشرة` : `Stipends ${run.ym} · مكافآت`;
        const rows = [...groups.values()].map((g) => {
          // (the project of an expense comes from its line in the accounts; it is written here as the HR lists knew it)
          const acc = g.account ? cl.accounts.find((a) => a.name.toLowerCase() === g.account!.toLowerCase()) : null;
          const bl = cl.lines.find((l) => l.code === g.line) ?? cl.lines.find((l) => l.name === g.line);
          if (!bl) throw new HttpError(400, { ar: `غير موجود في حسابات ${slug}: ${g.line}`, en: `Not in the accounts of ${slug}: ${g.line}` });
          return { ...blankTrx(), date: run.paid_on ?? last, type: 'Exp' as const, book_id: book, city_id: city, account_id: acc && !acc.outside_budget ? acc.id : null, heading_id: bl.heading_id, line_id: bl.id,
            explanation: `${what} · HR (${g.people.size})`, exp_syp: g.cur === 'SYP' ? Math.round(g.amount) : 0, exp_usd: g.cur === 'USD' ? Math.round(g.amount * 100) / 100 : 0, source_file: `hr-run:${run.id}` };
        });
        const ctx: OpCtx = { db: cc.handle.db, profile: { id: 0, name: `HR · ${hs.profile.name}`, role: 'com', book_id: null, active: 1, access_id: null, access_name: 'HR', perms: ['register.edit', 'register.view'], books: [] }, who: `HR · ${whoOf(hs)}`, install: 'office', files: cc.files };
        await runOp(ctx, 'trx.save', { rows });
        cc.version++;
        const total = Math.round(parts.reduce((a, x) => a + x.usd, 0) * 100) / 100;
        await hdb.batch([{ sql: 'INSERT INTO hr_run_sent (run_id, centre, sent_at, sent_by, trx_ids, total_usd) VALUES (?,?,?,?,?,?)', params: [run.id, slug, new Date().toISOString(), whoOf(hs), JSON.stringify(rows.map((r) => r.id)), total] }]);
        hc.version++;
        log(`HR run ${run.id} (${run.ym}) sent to ${slug}: ${rows.length} rows by ${hs.profile.name}`);
        done.push({ centre: slug, rows: rows.length, total_usd: total });
      }
      return send(res, 200, { sent: done });
    }
    if (url === '/api/hr/take-back' && method === 'POST') {
      const [, hs, hc] = await hrApprover();
      const body = (await readBody(req)) as { runId?: number; centre?: string };
      const hrScope = hs.profile.hrCentres;
      const runCentre = (await one<{ centre: string | null }>(hc.handle.db, 'SELECT centre FROM hr_run WHERE id = ?', [Number(body.runId)]))?.centre;
      if (hrScope?.length && (!runCentre || !hrScope.includes(runCentre))) throw new HttpError(403, { ar: 'خارج مراكزك', en: 'Outside your centres' });
      const row = await one<{ trx_ids: string }>(hc.handle.db, 'SELECT trx_ids FROM hr_run_sent WHERE run_id = ? AND centre = ?', [Number(body.runId), String(body.centre)]);
      const cc = centres.get(String(body.centre));
      if (!row || !cc) throw new HttpError(404, { ar: 'لم يُرسل', en: 'Not sent' });
      const ids = (JSON.parse(row.trx_ids) as string[]).filter(Boolean);
      const still = (await cc.handle.db.query<{ id: string }>(`SELECT id FROM trx WHERE id IN (${ids.map(() => '?').join(',') || "''"})`, ids)).map((x) => x.id);
      const ctx: OpCtx = { db: cc.handle.db, profile: { id: 0, name: `HR · ${hs.profile.name}`, role: 'com', book_id: null, active: 1, access_id: null, access_name: 'HR', perms: ['register.edit', 'register.view'], books: [] }, who: `HR · ${whoOf(hs)}`, install: 'office', files: cc.files };
      if (still.length) await runOp(ctx, 'trx.delete', { ids: still, reason: 'payroll taken back by HR · سحبته الموارد البشرية' });
      cc.version++;
      await hc.handle.db.batch([{ sql: 'DELETE FROM hr_run_sent WHERE run_id = ? AND centre = ?', params: [Number(body.runId), String(body.centre)] }]);
      hc.version++;
      log(`HR run ${body.runId} taken back from ${body.centre} by ${hs.profile.name}`);
      return send(res, 200, { ok: true, removed: still.length });
    }

    // ---- a new database (a centre, a test, a new year…)
    // ---- a database brought from a file (Fouad, 2026-11-12): looked at first (its name, its users), then created under ITS
    // OWN NAME unless a new one is given, with the house, colour and logo chosen; one step, so a refused file leaves nothing.
    if (url === '/api/dbs/peek' && method === 'POST') {
      if (!mayCreate(req, found)) throw new HttpError(403, { ar: 'على حاسوب الخادم نفسه، أو لمن يدير المستخدمين', en: 'On the server computer itself, or by someone who manages users' });
      const body = (await readBody(req, UPLOAD_BODY)) as { base64?: string };
      const info = await peekDb(String(body.base64 ?? ''));
      const same = [];
      for (const x of centres.values()) if (((await getMeta(x.handle.db, 'organisation')) ?? x.slug).trim().toLowerCase() === info.organisation.trim().toLowerCase()) same.push(x.slug);
      return send(res, 200, { ...info, nameTaken: info.organisation.trim() !== '' && same.length > 0 });
    }
    if (url === '/api/dbs/import' && method === 'POST') {
      if (!mayCreate(req, found)) throw new HttpError(403, { ar: 'على حاسوب الخادم نفسه، أو لمن يدير المستخدمين', en: 'On the server computer itself, or by someone who manages users' });
      const body = (await readBody(req, UPLOAD_BODY)) as { base64?: string; organisation?: string; centre?: string | null; color?: string | null; logo?: string | null };
      const info = await peekDb(String(body.base64 ?? ''));
      const organisation = (body.organisation ?? '').trim() || info.organisation.trim();
      if (!organisation) throw new HttpError(400, { ar: 'هذا الملف بلا اسم: اكتب اسماً', en: 'This file has no name: write one' });
      for (const x of centres.values())
        if (((await getMeta(x.handle.db, 'organisation')) ?? x.slug).trim().toLowerCase() === organisation.toLowerCase())
          throw new HttpError(409, { ar: `قاعدة باسم «${organisation}» موجودة: اختر اسماً آخر`, en: `A database named "${organisation}" already exists: choose another name` });
      let slug = slugify(organisation);
      for (let i = 2; centres.has(slug) || fs.existsSync(path.join(dbsDir, slug)); i++) slug = `${slugify(organisation)}-${i}`;
      const c = await openCentre(slug);
      await replaceDatabase(c, String(body.base64));
      // what the screen chose (the rest stays as in the file)
      const centreKey = (CENTRE_KEYS as readonly string[]).includes(body.centre ?? '') ? (body.centre as CentreKey) : null;
      const color = body.color && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : null;
      const logo = body.logo && body.logo.startsWith('data:image/png;base64,') && body.logo.length < 400_000 ? body.logo : null;
      await c.handle.db.batch([
        setMetaStmt('organisation', organisation),
        ...(centreKey ? [setMetaStmt('centre', centreKey), setMetaStmt('brand_color', centreKey === 'other' ? color : null), setMetaStmt('brand_logo', centreKey === 'other' ? logo : null)] : []),
        auditStmt(found?.[1].profile.name ?? dirPerson?.name ?? 'import', 'import', 'meta', null, null, { organisation, kind: info.kind, users: info.users.length }),
      ]);
      c.version++;
      log(`database ${slug} brought from a file (${organisation}, ${info.kind}, ${info.users.length} users)`);
      return send(res, 200, { slug, organisation, kind: info.kind });
    }
    if (url === '/api/dbs/create' && method === 'POST') {
      const body = (await readBody(req)) as { organisation?: string; centre?: string; color?: string | null; logo?: string | null; kind?: string | null; mainList?: string | null };
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
        // the list of headings and lines it follows (Fouad, 2026-11-07): taken whole when it is set up
        ...(!body.kind && body.mainList && readMainList(dataDir, body.mainList, 'published') ? [setMetaStmt('main_list', body.mainList)] : []),
      ]);
      log(`new database ${slug} (${organisation}, ${centre})`);
      return send(res, 200, { slug });
    }

    // ---- setting up a new database: only while it has nobody
    if (url.startsWith('/api/setup/')) {
      const body = (await readBody(req, url === '/api/setup/upload-db' ? UPLOAD_BODY : MAX_BODY)) as Record<string, string>;
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
        // its list: every heading and line comes in, switched on; the centre then switches off what it does not use
        const chosen = await getMeta(c.handle.db, 'main_list');
        const list = chosen ? readMainList(dataDir, chosen, 'published') : null;
        if (list) await applyMainList(c.handle.db, list, 'setup', { take: [...list.headings, ...list.lines].filter((x) => x.active).map((x) => x.uid) });
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
    // ---- the first page (Fouad, 31 October 2026): a house, a name and a password. A person of the sign-in directory
    // enters with it (and sees what was given to them); otherwise every database of that house, and HR, where this name
    // has this password. Several: the person chooses, then goes from one to another without signing in again.
    if (url === '/api/signin' && method === 'POST') {
      const f = failures.get(ip);
      if (f && f.until > Date.now()) throw new HttpError(429, { ar: 'محاولات كثيرة — انتظر 5 دقائق', en: 'Too many attempts — wait 5 minutes', fr: 'Trop de tentatives — attendez 5 minutes' });
      const body = (await readBody(req)) as { centre?: string; name?: string; password?: string };
      const name = String(body.name ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const wrong = () => {
        const n = f && f.until > 0 && f.until <= Date.now() ? 1 : (f?.n ?? 0) + 1;
        failures.set(ip, { n, until: n >= 8 ? Date.now() + 5 * 60e3 : 0 });
        log(`failed sign-in from ${ip}`);
        return new HttpError(403, { ar: 'الاسم أو كلمة السر غير صحيحة', en: 'The name or the password is not right', fr: "Le nom ou le mot de passe n'est pas juste" });
      };
      const person = directory.people.find((q) => q.active && q.name.toLowerCase() === name);
      if (person && (await verifySecret(person.salt, password, person.hash)).ok) {
        failures.delete(ip);
        if (found) sessions.delete(found[0]);
        const token = randomBytes(32).toString('base64url');
        dirSessions.set(token, { id: person.id, last: Date.now() });
        log(`directory sign-in: ${person.name} from ${ip}`);
        return send(res, 200, { dir: true }, { 'Set-Cookie': dirCookieSet(token, viaHttps) });
      }
      if (body.centre === 'admin') throw wrong(); // "the administrator": the directory only
      if (directory.enforced && !isLocal(req)) throw wrong();
      const house = (CENTRE_KEYS as readonly string[]).includes(body.centre ?? '') ? body.centre : null;
      const ring: NonNullable<Session['ring']> = [];
      let first: Profile | null = null;
      for (const c of centres.values()) {
        if ((config.inactive ?? []).includes(c.slug) || config.copies?.[c.slug] || (await setupNeeded(c))) continue;
        const d = await describe(c);
        if (!(d.kind === 'hr' || (d.kind === 'centre' && d.centre === house))) continue;
        for (const q of await listProfiles(c.handle.db)) {
          if (q.name.trim().toLowerCase() !== name) continue;
          try {
            const r = await login(c.handle.db, q.id, password);
            // the house's own accounts first, HR after
            const item = { db: c.slug, profileId: r.profile.id, mustChange: r.weak || r.given };
            if (d.kind === 'hr') ring.push(item);
            else ring.unshift(item);
            if (d.kind !== 'hr' || !first) first = r.profile;
            break;
          } catch { /* not this one */ }
        }
      }
      if (!ring.length) throw wrong();
      failures.delete(ip);
      if (found) sessions.delete(found[0]);
      const sid = randomBytes(32).toString('base64url');
      const profile = (await loadProfile(centres.get(ring[0].db)!.handle.db, ring[0].profileId)) ?? first!;
      sessions.set(sid, { db: ring[0].db, profile, mustChange: ring[0].mustChange, last: Date.now(), ip, ring });
      log(`sign-in ${ring.map((r) => r.db).join(', ')}: ${profile.name} from ${ip}`);
      return send(res, 200, { places: ring.map((r) => r.db), db: ring[0].db, profile, mustChange: ring[0].mustChange }, {
        'Set-Cookie': `magis_sid=${sid}; HttpOnly; SameSite=Lax; Path=/${viaHttps ? '; Secure' : ''}`,
      });
    }
    if (url === '/api/signin/enter' && method === 'POST') {
      if (!found?.[1].ring) throw new HttpError(401, { ar: 'سجّل الدخول', en: 'Please log in', fr: 'Connectez-vous' });
      const body = (await readBody(req)) as { db?: string };
      const ring = found[1].ring;
      const r = ring.find((x) => x.db === body.db);
      if (!r) throw new HttpError(403, { ar: 'لا إذن لك في قاعدة البيانات هذه', en: 'You have no access to this database', fr: "Vous n'avez pas accès à cette base" });
      const c = centreOf(r.db);
      const profile = await loadProfile(c.handle.db, r.profileId);
      if (!profile) throw new HttpError(403, { ar: 'هذا الحساب موقوف', en: 'This account is switched off', fr: 'Ce compte est désactivé' });
      sessions.delete(found[0]);
      const sid = randomBytes(32).toString('base64url');
      sessions.set(sid, { db: c.slug, profile, mustChange: r.mustChange, last: Date.now(), ip, ring });
      log(`sign-in ${c.slug}: ${profile.name} from ${ip}`);
      return send(res, 200, { profile, mustChange: r.mustChange }, { 'Set-Cookie': `magis_sid=${sid}; HttpOnly; SameSite=Lax; Path=/${viaHttps ? '; Secure' : ''}` });
    }

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
          'Set-Cookie': `magis_sid=${sid}; HttpOnly; SameSite=Lax; Path=/${viaHttps ? '; Secure' : ''}`,
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
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'magis_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }
    if (url === '/api/me')
      // idleMs: how long since the person last did something (in any tab of this browser); read by a background check
      return send(res, found ? 200 : 401, found ? { profile: found[1].profile, mustChange: found[1].mustChange, db: found[1].db, idleMs: Date.now() - found[1].last, as: found[1].as ? { by: found[1].as.by, mode: found[1].as.mode } : null } : { error: { ar: 'سجّل الدخول', en: 'Please log in' } });
    // "sign in as": only someone who manages the users of this database; the way back is always open
    if (url === '/api/as' && method === 'POST') {
      if (!found) throw new HttpError(401, { ar: 'سجّل الدخول', en: 'Please log in' });
      const [, s, c] = found;
      const real = await loadProfile(c.handle.db, s.as?.byId ?? s.profile.id);
      if (!real || !has(real, 'users.manage')) throw new HttpError(403, { ar: 'لمن يدير المستخدمين فقط', en: 'Only for someone who manages the users', fr: 'Seulement pour qui gère les utilisateurs' });
      const body = (await readBody(req)) as { profileId?: number; mode?: string };
      const target = await loadProfile(c.handle.db, Number(body.profileId));
      if (!target) throw new HttpError(400, { ar: 'المستخدم غير موجود أو موقوف', en: 'This user does not exist or is switched off', fr: "Cet utilisateur n'existe pas ou est désactivé" });
      const mode = body.mode === 'act' ? 'act' : 'view';
      if (target.id === real.id) { s.profile = real; s.as = undefined; return send(res, 200, { ok: true }); }
      s.profile = target;
      s.as = { byId: real.id, by: real.name, mode };
      s.mustChange = false;
      await c.handle.db.batch([auditStmt(real.name, 'sign-as', 'profile', String(target.id), null, { as: target.name, mode })]);
      log(`${c.slug}: ${real.name} signed in as ${target.name} (${mode === 'act' ? 'see and act' : 'see only'})`);
      return send(res, 200, { ok: true });
    }
    if (url === '/api/as/back' && method === 'POST') {
      if (!found) throw new HttpError(401, { ar: 'سجّل الدخول', en: 'Please log in' });
      const [, s, c] = found;
      if (s.as) {
        const real = await loadProfile(c.handle.db, s.as.byId);
        if (!real) throw new HttpError(401, { ar: 'سجّل الدخول', en: 'Please log in' });
        log(`${c.slug}: ${real.name} back from ${s.profile.name}`);
        s.profile = real;
        s.as = undefined;
      }
      return send(res, 200, { ok: true });
    }
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
      const body = (await readBody(req, UPLOAD_BODY)) as { base64?: string; fileName?: string };
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
      const ctx: OpCtx = { db: c.handle.db, profile: s.profile, who: whoOf(s), install: 'office', files: c.files };
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
