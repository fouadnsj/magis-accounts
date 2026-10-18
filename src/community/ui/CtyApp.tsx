// The community screens (Jesuit communities), phone first.
// One frame: the book on top (a minister switches between his book and the house's),
// the screens in the middle, a bar at the bottom, and the big "＋" to write an entry.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '../../state';
import { has } from '../../auth';
import type { Perm } from '../../perms';
import type { CtyData } from '../ops';
import type { CtyBook } from '../domain';
import { errText } from '../../ui/kit';
import { t3 } from './text';
import { MonthScreen } from './Month';
import { EntrySheet, type EntryStart } from './Entry';
import { LookBack } from './LookBack';
import { NotesScreen } from './Notes';
import { Approvals } from './Approvals';
import { SettingsScreen } from './Settings';
import './cty.css';

export type View = 'month' | 'look' | 'notes' | 'approvals' | 'settings';

interface Ctx {
  s: Session;
  d: CtyData;
  reload: () => Promise<void>;
  can: (p: Perm) => boolean;
  /** the book being looked at */
  book: CtyBook;
  setBook: (id: number) => void;
  /** the books this person keeps, his own first */
  myBooks: CtyBook[];
  /** opens the entry sheet */
  write: (start?: EntryStart) => void;
  go: (v: View) => void;
}
const CtyCtx = createContext<Ctx | null>(null);
export function useCty(): Ctx {
  const c = useContext(CtyCtx);
  if (!c) throw new Error('useCty outside CtyApp');
  return c;
}

const KIND_ORDER = ['personal', 'house', 'cash', 'bank', 'economat'];

export function CtyApp({ session, onLogout, onLang, onCloseDb, onDatabases }: {
  session: Session;
  onLogout: () => void;
  onLang: () => void;
  onCloseDb?: () => void;
  onDatabases?: () => void;
}) {
  const [d, setD] = useState<CtyData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>('month');
  const [bookId, setBookId] = useState<number | null>(null);
  const [sheet, setSheet] = useState<EntryStart | null>(null);

  const reload = useCallback(async () => {
    try {
      setD(await session.api.call('cty.data'));
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    }
  }, [session]);
  useEffect(() => {
    void reload();
  }, [reload]);
  // On the network: reload when someone else changed something (every 15 s).
  useEffect(() => {
    if (!session.version) return;
    let seen: number | null = null;
    const id = window.setInterval(async () => {
      try {
        const v = await session.version!();
        if (seen != null && v !== seen) void reload();
        seen = v;
      } catch { /* offline for a moment: try again later */ }
    }, 15000);
    return () => window.clearInterval(id);
  }, [session, reload]);

  const myBooks = useMemo(() => {
    if (!d) return [];
    const mine = d.books.filter((b) => d.kept.includes(b.id) && b.active);
    return mine.sort((a, b) => KIND_ORDER.indexOf(a.cty_kind ?? '') - KIND_ORDER.indexOf(b.cty_kind ?? ''));
  }, [d]);
  const book = myBooks.find((b) => b.id === bookId) ?? myBooks[0];
  const can = useCallback((p: Perm) => has(session.profile, p), [session]);

  if (err && !d) return <div className="cty"><div className="cty-page"><div className="alert err">{err}</div><button className="btn" onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button></div></div>;
  if (!d) return <div className="cty"><div className="cty-page muted">…</div></div>;
  if (!book)
    return (
      <div className="cty"><div className="cty-page">
        <p>{t3('لا دفتر لك في هذه الجماعة.', 'You keep no book in this community.', 'Vous ne tenez aucun compte dans cette communauté.')}</p>
        <button className="btn" onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
      </div></div>
    );

  const unread = d.notes.filter((n) => !n.read_at && n.author_id !== session.profile.id).length;
  const ctx: Ctx = {
    s: session, d, reload, can, book, myBooks,
    setBook: (id) => setBookId(id),
    write: (start) => setSheet(start ?? { kind: 'Exp' }),
    go: setView,
  };
  const approver = can('cty.month_seen');

  return (
    <CtyCtx.Provider value={ctx}>
      <div className="cty">
        <header className="cty-top">
          <div className="cty-org">
            <b>{session.organisation}</b>
            <span>{session.profile.name}</span>
          </div>
          <button className="cty-icon" onClick={() => setView('settings')} aria-label={t3('الإعدادات', 'Settings', 'Réglages')}>⚙︎</button>
        </header>
        {myBooks.length > 1 && view !== 'settings' && view !== 'approvals' && (
          <nav className="cty-books">
            {myBooks.map((b) => (
              <button key={b.id} className={b.id === book.id ? 'on' : ''} onClick={() => setBookId(b.id)}>{bookLabel(b)}</button>
            ))}
          </nav>
        )}
        <main className="cty-page">
          {err && <div className="alert err">{err}</div>}
          {view === 'month' && <MonthScreen />}
          {view === 'look' && <LookBack />}
          {view === 'notes' && <NotesScreen />}
          {view === 'approvals' && approver && <Approvals />}
          {view === 'settings' && <SettingsScreen onLang={onLang} onLogout={onLogout} onCloseDb={onCloseDb} onDatabases={onDatabases} />}
        </main>
        {view !== 'settings' && (
          <button className="cty-plus" onClick={() => setSheet({ kind: 'Exp' })} aria-label={t3('صرفتُ', 'I spent', "J'ai dépensé")}>＋</button>
        )}
        <nav className="cty-bar">
          <Tab on={view === 'month'} onClick={() => setView('month')} icon="◔" label={t3('شهري', 'My month', 'Mon mois')} />
          <Tab on={view === 'look'} onClick={() => setView('look')} icon="▤" label={t3('نظرة', 'Look back', 'Regard')} />
          <Tab on={view === 'notes'} onClick={() => setView('notes')} icon="✉︎" label={t3('ملاحظات', 'Notes', 'Notes')} badge={unread} />
          {approver && <Tab on={view === 'approvals'} onClick={() => setView('approvals')} icon="✓" label={t3('موافقات', 'Approvals', 'Accords')} badge={approvalsWaiting(d)} />}
        </nav>
        {sheet && <EntrySheet start={sheet} onClose={() => setSheet(null)} />}
      </div>
    </CtyCtx.Provider>
  );
}

/** Expenses waiting for the Superior, as far as this person sees them. */
const approvalsWaiting = (d: CtyData) => d.entries.filter((e) => e.approval_needed && !e.approved_at).length;

export function bookLabel(b: CtyBook): string {
  if (b.cty_kind === 'personal') return t3('دفتري', 'My book', 'Mon compte') + (b.keeper_name ? '' : ` · ${b.name}`);
  if (b.cty_kind === 'house') return t3('البيت', 'House', 'Maison');
  if (b.cty_kind === 'cash') return t3('الصندوق', 'Cash', 'Caisse');
  if (b.cty_kind === 'bank') return t3('المصرف', 'Bank', 'Banque');
  if (b.cty_kind === 'economat') return t3('الإيكونوماتو', 'Économat', 'Économat');
  return b.name;
}

/** The name of any book of the community, for "from / to". */
export function bookName(b: CtyBook | undefined): string {
  if (!b) return '—';
  return b.cty_kind === 'personal' ? b.keeper_name ?? b.name : bookLabel(b);
}

function Tab({ on, onClick, icon, label, badge }: { on: boolean; onClick: () => void; icon: string; label: string; badge?: number }) {
  return (
    <button className={on ? 'on' : ''} onClick={onClick}>
      <span className="cty-tab-icon">{icon}{badge ? <i className="cty-badge">{badge}</i> : null}</span>
      <span>{label}</span>
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={`cty-card ${className ?? ''}`}>{children}</section>;
}
