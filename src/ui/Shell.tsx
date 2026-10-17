import { createContext, useContext, useState } from 'react';
import { useApp } from '../state';
import type { Trx, TrxType } from '../domain/types';
import { getLang } from '../i18n';
import type { Perm } from '../perms';
import { t } from './kit';
import { brandStyle } from '../brand';
import { Home } from './Home';
import { EntryForm } from './EntryForm';
import { Register } from './Register';
import { Cash } from './Cash';
import { Reports } from './Reports';
import { BudgetPage } from './Budget';
import { BuildingBudget } from './BuildingBudget';
import { Grants } from './Grants';
import { ListsPage } from './ListsPage';
import { Files } from './Files';
import { Admin } from './Admin';
import { draftFor, draftKey } from './draft';

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
  // a building site: its own budget page (per heading), no grants
  const building = !!d.lists.settings.building;
  const seesBudget = building ? can('budget.view') || can('reports.summary') : can('budget.view');

  const item = (p: Page, label: string, extra?: React.ReactNode) => (
    <button className={page === p ? 'on' : ''} onClick={() => nav.go(p)}>
      <span>{label}</span>
      {extra}
    </button>
  );

  const st = brandStyle({ centre: s.centre ?? 'other', color: s.brandColor, logo: s.brandLogo });
  const theme = { '--brand': st.deep, '--brand-2': st.deep, '--centre': st.color } as React.CSSProperties;

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
          {seesBudget && item('budget', t('الموازنة', 'Budget'))}
          {!building && can('lists.donors') && item('grants', t('المنح', 'Grants'))}
          {can('lists.manage') && item('lists', t('القوائم', 'Lists'))}
          {(can('data.export') || can('data.import')) && item('files', t('التصدير', 'Export'))}
          {item('admin', ADMIN_PERMS.some((p) => p !== 'month.close' && can(p)) ? t('الإدارة', 'Admin') : t('الإعدادات', 'Settings'))}
          <div className="spacer" />
          <button onClick={onToggleLang}>{getLang() === 'en' ? 'عربي · English' : 'English only'}</button>
          {onDatabases && <button onClick={onDatabases}>{can('users.manage') ? t('قواعد البيانات · جديدة', 'Databases · new') : t('قواعد البيانات', 'Databases')}</button>}
          <button onClick={logout}>{t('خروج', 'Log out')}</button>
          {s.mode !== 'server' && <button onClick={onCloseDb} className="small">{t('إغلاق الملف', 'Close file')}</button>}
        </nav>
        <main className="main">
          {page === 'home' && <Home />}
          {page === 'register' && <Register key={`${reviewOnly}|${bookOnly}`} />}
          {page === 'cash' && <Cash />}
          {page === 'reports' && <Reports />}
          {page === 'budget' && seesBudget && (building ? <BuildingBudget /> : <BudgetPage />)}
          {page === 'grants' && !building && can('lists.donors') && <Grants />}
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
