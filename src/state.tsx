// What every screen can read: the person logged in, the lists, the register
// with its computed columns, and `api` — the only way to read or change data.
// After any write, call reload(). On the network, other people's changes are
// picked up automatically (the server says when its data changed).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { catIcon } from './ui/catIcons';
import { computeAll } from './domain/compute';
import type { GrantCard, GrantPart } from './domain/grants';
import type { Computed, Lists, Trx } from './domain/types';
import { has, type Profile } from './auth';
import type { Perm } from './perms';
import type { TransferInfo } from './domain/transfers';
import type { Api, AttachmentRow, BookMonth, HolderReceipt, Install, OfficeTransfer } from './ops';

export type { HolderReceipt, Install } from './ops';

/** desktop = this computer's file · server = the centre's server over the LAN · preview = in memory */
export type Mode = 'desktop' | 'server' | 'preview';

export interface Session {
  api: Api;
  mode: Mode;
  dbPath: string | null;
  install: Install;
  organisation: string;
  /** jaramana | aleppo | homs | other: the colour and mark of the menus */
  centre?: string;
  /** this database's own colour and logo, if it has them (they win over the centre's) */
  brandColor?: string | null;
  brandLogo?: string | null;
  profile: Profile;
  /** 'community' for a Jesuit community's accounts (its own screens); otherwise a MAGIS centre */
  kind?: string;
  /** server mode: asks the server whether data changed since `v` */
  version?: () => Promise<number>;
}

export interface Data {
  lists: Lists;
  rows: Trx[];
  comp: Map<string, Computed>;
  closed: Set<string>;
  /** step 1 of month closing: 'bookId|YYYY-MM' */
  bookClosed: Set<string>;
  bookMonths: BookMonth[];
  closedYears: Set<number>;
  transfers: TransferInfo[];
  keptBooks: number[];
  grants: GrantCard[];
  grantParts: GrantPart[];
  /** the books this person may see the cash of (a private book only by its keepers) */
  shownBooks: Lists['books'];
  /** the Respo book (grants, the Province's money) */
  grantsBookId: number | null;
  /** the register without the Respo book: what the centre's reports count */
  centreRows: Trx[];
  receipts: HolderReceipt[];
  officeTransfers: Record<string, OfficeTransfer[]>;
  listsVersion: string | null;
  attachments: AttachmentRow[];
}

interface Ctx {
  s: Session;
  d: Data;
  reload: () => Promise<void>;
  who: string;
  /** Has this person this permission? */
  can: (p: Perm) => boolean;
  /** The books this person keeps (none, one or several). */
  myBooks: number[];
  /** the books he may write in: his own, plus Main with "writes in the Main book" */
  writeBooks: number[];
  /** First book kept (or null). */
  myBook: number | null;
  /** Sees only his own books (no "see every book" permission). */
  limited: boolean;
  /** A holder working on his own computer with files (desktop holder install, not the server). */
  fileHolder: boolean;
  logout: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

async function loadData(s: Session, background = false): Promise<Data> {
  const p = await s.api.call('data', undefined, { background });
  return {
    lists: p.lists,
    rows: p.rows,
    comp: computeAll(p.rows, p.lists),
    closed: new Set(p.closed),
    bookClosed: new Set(p.bookMonths.map((b) => `${b.book_id}|${b.ym}`)),
    bookMonths: p.bookMonths,
    closedYears: new Set(p.closedYears ?? []),
    transfers: p.transfers,
    keptBooks: p.keptBooks,
    grants: p.grants,
    grantParts: p.grantParts ?? [],
    shownBooks: p.lists.books.filter((b) => !b.private || s.profile.books.includes(b.id)),
    grantsBookId: p.grantsBookId ?? null,
    centreRows: p.rows.filter((r) => r.book_id == null || r.book_id !== p.grantsBookId),
    receipts: p.receipts,
    officeTransfers: p.officeTransfers,
    listsVersion: p.listsVersion,
    attachments: p.attachments ?? [],
  };
}

export function AppProvider({ session, onLogout, children }: { session: Session; onLogout: () => void; children: ReactNode }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seen = useRef<number | null>(null);
  /** `background`: asked by the automatic check, not by the person */
  const reload = useCallback(async (background = false) => {
    try {
      if (session.version) seen.current = await session.version();
      setD(await loadData(session, background));
    } catch (e) {
      setErr(String(e));
    }
  }, [session]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // Network: every 15 seconds, reload if someone else changed something.
  useEffect(() => {
    if (!session.version) return;
    const timer = window.setInterval(async () => {
      try {
        const v = await session.version!();
        if (seen.current != null && v !== seen.current && !document.querySelector('.overlay')) await reload(true);
      } catch {
        /* server unreachable for a moment: try again later */
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [session, reload]);

  const value = useMemo<Ctx | null>(() => {
    if (!d) return null;
    const p = session.profile;
    return {
      s: session,
      d,
      reload: () => reload(false),
      who: p.name,
      can: (perm: Perm) => has(p, perm),
      myBooks: p.books,
      writeBooks: (() => {
        const main = d.lists.books.find((b) => b.is_main)?.id;
        return has(p, 'register.main') && main != null && !p.books.includes(main) ? [main, ...p.books] : p.books;
      })(),
      myBook: p.books[0] ?? null,
      limited: !has(p, 'register.view'),
      fileHolder: session.install === 'holder',
      logout: onLogout,
    };
  }, [d, session, reload, onLogout]);
  if (err) return <div className="center-page"><div className="alert err">{err}</div></div>;
  if (!value) return <div className="center-page muted">…</div>;
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Names for ids, from the lists. */
/** The icon of each budget heading and line (catIcons.ts), by id. */
export function useIcons() {
  const { d } = useApp();
  return useMemo(() => {
    const hName = new Map(d.lists.headings.map((h) => [h.id, h.name]));
    const heading = new Map(d.lists.headings.map((h) => [h.id, catIcon(h.name)]));
    const line = new Map(d.lists.lines.map((l) => [l.id, catIcon(l.name, hName.get(l.heading_id))]));
    return {
      heading: (id: number | null | undefined) => (id == null ? '' : heading.get(id) ?? ''),
      line: (id: number | null | undefined) => (id == null ? '' : line.get(id) ?? ''),
    };
  }, [d.lists]);
}

export function useNames() {
  const { d } = useApp();
  return useMemo(() => {
    const map = <T extends { id: number; name: string }>(arr: T[]) => new Map(arr.map((x) => [x.id, x.name]));
    const city = map(d.lists.cities);
    const account = map(d.lists.accounts);
    const book = map(d.lists.books);
    const heading = map(d.lists.headings);
    const line = map(d.lists.lines);
    const party = map(d.lists.parties);
    const project = map(d.lists.projects);
    const donor = map(d.lists.donors);
    const get = (m: Map<number, string>) => (id: number | null | undefined) => (id == null ? '' : m.get(id) ?? '?');
    return {
      city: get(city), account: get(account), book: get(book), heading: get(heading), line: get(line),
      party: get(party), project: get(project), donor: get(donor),
    };
  }, [d.lists]);
}
