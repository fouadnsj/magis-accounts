// What every screen can read: the open database, the person logged in, the
// lists, the register with its computed columns. After any write, call reload().
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Db } from './db/db';
import { closedMonths, getMeta, loadLists, loadTrx } from './db/repo';
import { computeAll } from './domain/compute';
import type { GrantRow } from './domain/reports';
import type { Computed, Lists, Trx } from './domain/types';
import type { Profile } from './auth';
import { can } from './auth';

export type Install = 'office' | 'holder';

export interface Session {
  db: Db;
  dbPath: string | null; // null in the browser preview
  install: Install;
  organisation: string;
  profile: Profile;
}

export interface HolderReceipt {
  id: string;
  date: string;
  amount_syp: number;
  amount_usd: number;
  receipt: string | null;
  note: string | null;
}

export interface Data {
  lists: Lists;
  rows: Trx[];
  comp: Map<string, Computed>;
  closed: Set<string>;
  grants: GrantRow[];
  receipts: HolderReceipt[];
  officeTransfers: Record<string, { date: string | null; trf_syp: number; trf_usd: number; explanation: string | null; n: number | null }[]>;
  listsVersion: string | null;
}

interface Ctx {
  s: Session;
  d: Data;
  reload: () => Promise<void>;
  who: string;
  /** The holder's own book on a holder install, else null. */
  myBook: number | null;
  isSup: boolean;
  logout: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

async function loadData(db: Db, profile: Profile, install: Install): Promise<Data> {
  const [lists, allRows, closed] = await Promise.all([loadLists(db), loadTrx(db), closedMonths(db)]);
  // A holder sees and computes with his own book only.
  const rows = install === 'holder' && profile.book_id != null ? allRows.filter((r) => r.book_id === profile.book_id) : allRows;
  const grants = can.confidential(profile.role) ? await db.query<GrantRow>('SELECT * FROM grant_row ORDER BY date') : [];
  const receipts = install === 'holder' ? await db.query<HolderReceipt>('SELECT * FROM holder_receipt ORDER BY date') : [];
  const ot = await getMeta(db, 'office_transfers');
  return {
    lists,
    rows,
    comp: computeAll(rows, lists),
    closed,
    grants,
    receipts,
    officeTransfers: ot ? JSON.parse(ot) : {},
    listsVersion: await getMeta(db, 'lists_version'),
  };
}

export function AppProvider({ session, onLogout, children }: { session: Session; onLogout: () => void; children: ReactNode }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setD(await loadData(session.db, session.profile, session.install));
    } catch (e) {
      setErr(String(e));
    }
  }, [session]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const value = useMemo<Ctx | null>(
    () =>
      d && {
        s: session,
        d,
        reload,
        who: `${session.profile.name} (${session.profile.role})`,
        myBook: session.install === 'holder' ? session.profile.book_id : null,
        isSup: can.confidential(session.profile.role),
        logout: onLogout,
      },
    [d, session, reload, onLogout],
  );
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
