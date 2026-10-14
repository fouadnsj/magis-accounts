import { createContext, useContext, useState } from 'react';
import { useApp } from '../state';
import type { Trx, TrxType } from '../domain/types';
import { getLang } from '../i18n';
import type { Perm } from '../perms';
import { t } from './kit';
import { Home } from './Home';
import { EntryForm } from './EntryForm';
import { Register } from './Register';
import { Cash } from './Cash';
import { Reports } from './Reports';
import { Grants } from './Grants';
import { ListsPage } from './ListsPage';
import { Files } from './Files';
import { Admin } from './Admin';

export const REPORT_PERMS: Perm[] = ['reports.summary', 'reports.monthly', 'reports.accounts', 'reports.exchange', 'reports.coverage', 'reports.funds'];
const ADMIN_PERMS: Perm[] = ['month.close', 'month.reopen', 'users.manage', 'data.backup', 'data.restore', 'audit.view'];

export type Page = 'home' | 'register' | 'cash' | 'reports' | 'grants' | 'lists' | 'files' | 'admin';

interface Nav {
  go: (p: Page, opts?: { review?: boolean }) => void;
  /** Open the entry form: a type for a new row, or a row to edit. */
  entry: (x: TrxType | Trx) => void;
  reviewOnly: boolean;
}
const NavCtx = createContext<Nav | null>(null);
export const useNav = () => useContext(NavCtx)!;

export function Shell({ onCloseDb, onToggleLang }: { onCloseDb: () => void; onToggleLang: () => void }) {
  const { s, d, logout, can, myBooks, limited, fileHolder } = useApp();
  const [page, setPage] = useState<Page>('home');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [editing, setEditing] = useState<TrxType | Trx | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const nav: Nav = {
    go: (p, o) => {
      setReviewOnly(!!o?.review);
      setPage(p);
    },
    entry: setEditing,
    reviewOnly,
  };
  const toReview = d.rows.filter((r) => r.review).length;

  const item = (p: Page, label: string, extra?: React.ReactNode) => (
    <button className={page === p ? 'on' : ''} onClick={() => nav.go(p)}>
      <span>{label}</span>
      {extra}
    </button>
  );

  return (
    <NavCtx.Provider value={nav}>
      <div className="shell">
        <nav className={`side ${menuOpen ? 'open' : ''}`} onClick={(e) => (e.target as HTMLElement).closest('button:not(.menu-toggle)') && setMenuOpen(false)}>
          <div className="top">
            <div>
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
          {can('lists.donors') && item('grants', t('المنح', 'Grants'))}
          {can('lists.manage') && item('lists', t('القوائم', 'Lists'))}
          {(fileHolder || can('data.export') || can('data.import')) && item('files', s.mode === 'server' ? t('التصدير', 'Export') : t('استيراد وتصدير', 'Import / Export'))}
          {item('admin', ADMIN_PERMS.some((p) => p !== 'month.close' && can(p)) ? t('الإدارة', 'Admin') : t('الإعدادات', 'Settings'))}
          <div className="spacer" />
          <button onClick={onToggleLang}>{getLang() === 'en' ? 'عربي · English' : 'English only'}</button>
          <button onClick={logout}>{t('خروج', 'Log out')}</button>
          {s.mode !== 'server' && <button onClick={onCloseDb} className="small">{t('إغلاق الملف', 'Close file')}</button>}
        </nav>
        <main className="main">
          {page === 'home' && <Home />}
          {page === 'register' && <Register key={String(reviewOnly)} />}
          {page === 'cash' && <Cash />}
          {page === 'reports' && <Reports />}
          {page === 'grants' && can('lists.donors') && <Grants />}
          {page === 'lists' && <ListsPage />}
          {page === 'files' && <Files />}
          {page === 'admin' && <Admin />}
        </main>
      </div>
      {editing && <EntryForm start={editing} onClose={() => setEditing(null)} />}
    </NavCtx.Provider>
  );
}
