import { createContext, useContext, useEffect, useState } from 'react';
import { useApp } from '../state';
import type { Trx, TrxType } from '../domain/types';
import { LangPick } from './LangPick';
import type { Perm } from '../perms';
import { t } from './kit';
import { brandStyle } from '../brand';
import { Home } from './Home';
import { EntryForm } from './EntryForm';
import { Register } from './Register';
import { Cash } from './Cash';
import { Reports } from './Reports';
import { BudgetPage } from './Budget';
import { Grants } from './Grants';
import { ListsPage } from './ListsPage';
import { Files } from './Files';
import { Admin } from './Admin';
import { draftFor, draftKey } from './draft';
import { PhoneShell } from './Phone';

/** A phone-sized screen (the phone window opens by itself there). */
function useNarrow() {
  const q = '(max-width: 700px)';
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setN(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return n;
}

export const REPORT_PERMS: Perm[] = ['reports.summary', 'reports.monthly', 'reports.accounts', 'reports.funding', 'reports.exchange'];
const ADMIN_PERMS: Perm[] = ['month.close', 'month.reopen', 'users.manage', 'data.backup', 'data.restore', 'audit.view'];

export type Page = 'home' | 'register' | 'cash' | 'reports' | 'budget' | 'grants' | 'lists' | 'files' | 'admin';

interface Nav {
  go: (p: Page, opts?: { review?: boolean; book?: number }) => void;
  /** Open the entry form: a type for a new row, or a row to edit. */
  entry: (x: TrxType | Trx) => void;
  reviewOnly: boolean;
  /** the register opens on this book (from a Home card) */
  bookOnly: number | null;
}
const NavCtx = createContext<Nav | null>(null);
export const useNav = () => useContext(NavCtx)!;

export function Shell({ onCloseDb, onToggleLang, onDatabases }: { onCloseDb: () => void; onToggleLang: () => void; onDatabases?: () => void }) {
  const { s, d, logout, can, myBooks, limited } = useApp();
  const [page, setPage] = useState<Page>('home');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [bookOnly, setBookOnly] = useState<number | null>(null);
  // an entry left half-typed at a sign-out for inactivity comes back
  const [editing, setEditing] = useState<TrxType | Trx | null>(() => (draftFor(draftKey(s))?.start as TrxType | Trx | undefined) ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const nav: Nav = {
    go: (p, o) => {
      setReviewOnly(!!o?.review);
      setBookOnly(o?.book ?? null);
      setPage(p);
    },
    entry: setEditing,
    reviewOnly,
    bookOnly,
  };
  const toReview = d.rows.filter((r) => r.review).length;

  const item = (p: Page, label: string, extra?: React.ReactNode) => (
    <button className={page === p ? 'on' : ''} onClick={() => nav.go(p)}>
      <span>{label}</span>
      {extra}
    </button>
  );

  const st = brandStyle({ centre: s.centre ?? 'other', color: s.brandColor, logo: s.brandLogo });
  const theme = { '--brand': st.deep, '--brand-2': st.deep, '--centre': st.color } as React.CSSProperties;

  // the light phone window on a phone (Fouad, 19 October 2026); the computer window stays as it was
  const narrow = useNarrow();
  const [pcOnPhone, setPcOnPhone] = useState(() => { try { return localStorage.getItem('magis-pc-view') === '1'; } catch { return false; } });
  const choosePc = (v: boolean) => { setPcOnPhone(v); try { localStorage.setItem('magis-pc-view', v ? '1' : '0'); } catch { /* no storage */ } };
  if (narrow && !pcOnPhone)
    return (
      <NavCtx.Provider value={nav}>
        <div style={theme}>
          <PhoneShell onComputer={() => choosePc(true)} onToggleLang={onToggleLang} onCloseDb={onCloseDb} onDatabases={onDatabases} onEntry={setEditing} />
          {editing && <EntryForm start={editing} onClose={() => setEditing(null)} />}
        </div>
      </NavCtx.Provider>
    );

  return (
    <NavCtx.Provider value={nav}>
      <div style={theme}>
      <div className="shell">
        <nav className={`side ${menuOpen ? 'open' : ''}`} onClick={(e) => (e.target as HTMLElement).closest('button:not(.menu-toggle)') && setMenuOpen(false)}>
          <div className="top">
            <div className="side-brand">
              <img src={st.mark ?? '/brand/magis-sun.png'} alt="" />
            </div>
            <div style={{ flex: 1 }}>
              <div className="org">{s.organisation || t('حسابات ماجيس', 'MAGIS Accounts')}</div>
              <div className="who">
                {s.profile.name}
                {myBooks.length > 0 && <> · {myBooks.map((id) => d.lists.books.find((b) => b.id === id)?.name).join('، ')}</>}
              </div>
            </div>
            <button className="menu-toggle" onClick={() => setMenuOpen((x) => !x)} aria-label="menu">☰ {t('القائمة', 'Menu')}</button>
          </div>
          {item('home', t('الرئيسية', 'Home'))}
          {item('register', limited ? t('قيودي', 'My entries') : t('السجل', 'Register'), toReview ? <span className="badge">{toReview}</span> : null)}
          {(myBooks.length > 0 || can('reports.cash')) && item('cash', t('النقد', 'Cash'))}
          {REPORT_PERMS.some(can) && item('reports', t('التقارير', 'Reports'))}
          {can('budget.view') && item('budget', t('الموازنة', 'Budget'))}
          {can('lists.donors') && item('grants', t('المنح', 'Grants'))}
          {can('lists.manage') && item('lists', t('القوائم', 'Lists'))}
          {(can('data.export') || can('data.import')) && item('files', t('التصدير', 'Export'))}
          {item('admin', ADMIN_PERMS.some((p) => p !== 'month.close' && can(p)) ? t('الإدارة', 'Admin') : t('الإعدادات', 'Settings'))}
          <div className="spacer" />
          {narrow && <button onClick={() => choosePc(false)}>📱 {t('عرض الهاتف', 'Phone view')}</button>}
          <LangPick onChange={onToggleLang} />
          {onDatabases && <button onClick={onDatabases}>{can('users.manage') ? t('قواعد البيانات · جديدة', 'Databases · new') : t('قواعد البيانات', 'Databases')}</button>}
          <button onClick={logout}>{t('خروج', 'Log out')}</button>
          {s.mode !== 'server' && <button onClick={onCloseDb} className="small">{t('إغلاق الملف', 'Close file')}</button>}
        </nav>
        <main className="main">
          {page === 'home' && <Home />}
          {page === 'register' && <Register key={`${reviewOnly}|${bookOnly}`} />}
          {page === 'cash' && <Cash />}
          {page === 'reports' && <Reports />}
          {page === 'budget' && can('budget.view') && <BudgetPage />}
          {page === 'grants' && can('lists.donors') && <Grants />}
          {page === 'lists' && <ListsPage />}
          {page === 'files' && <Files />}
          {page === 'admin' && <Admin />}
        </main>
      </div>
      {editing && <EntryForm start={editing} onClose={() => setEditing(null)} />}
      </div>
    </NavCtx.Provider>
  );
}
