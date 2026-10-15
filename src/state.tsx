// What every screen can read: the person logged in, the lists, the register
// with its computed columns, and `api` — the only way to read or change data.
// After any write, call reload(). On the network, other people's changes are
// picked up automatically (the server says when its data changed).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeAll } from './domain/compute';
import type { GrantRow } from './domain/reports';
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
  transfers: TransferInfo[];
  keptBooks: number[];
  grants: GrantRow[];
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

async function loadData(s: Session): Promise<Data> {
  const p = await s.api.call('data');
  return {
    lists: p.lists,
    rows: p.rows,
    comp: computeAll(p.rows, p.lists),
    closed: new Set(p.closed),
    bookClosed: new Set(p.bookMonths.map((b) => `${b.book_id}|${b.ym}`)),
    bookMonths: p.bookMonths,
    transfers: p.transfers,
    keptBooks: p.keptBooks,
    grants: p.grants,
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
  const reload = useCallback(async () => {
    try {
      if (session.version) seen.current = await session.version();
      setD(await loadData(session));
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
        if (seen.current != null && v !== seen.current && !document.querySelector('.overlay')) await reload();
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
      reload,
      who: p.name,
      can: (perm: Perm) => has(p, perm),
      myBooks: p.books,
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
