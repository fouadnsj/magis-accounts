import { createContext, useContext, useState } from 'react';
import { useApp } from '../state';
import type { Trx, TrxType } from '../domain/types';
import { can } from '../auth';
import { getLang } from '../i18n';
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
  const { s, d, logout, isSup, myBook } = useApp();
  const role = s.profile.role;
  const [page, setPage] = useState<Page>('home');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [editing, setEditing] = useState<TrxType | Trx | null>(null);
  const nav: Nav = {
    go: (p, o) => {
      setReviewOnly(!!o?.review);
      setPage(p);
    },
    entry: setEditing,
    reviewOnly,
  };
  const toReview = d.rows.filter((r) => r.review).length;
  const holder = s.install === 'holder';

  const item = (p: Page, label: string, extra?: React.ReactNode) => (
    <button className={page === p ? 'on' : ''} onClick={() => nav.go(p)}>
      <span>{label}</span>
      {extra}
    </button>
  );

  return (
    <NavCtx.Provider value={nav}>
      <div className="shell">
        <nav className="side">
          <div className="org">{s.organisation || t('حسابات ماجيس', 'MAGIS Accounts')}</div>
          <div className="who">
            {s.profile.name}
            {holder && myBook != null && <> · {d.lists.books.find((b) => b.id === myBook)?.name}</>}
          </div>
          {item('home', t('الرئيسية', 'Home'))}
          {item('register', holder ? t('قيودي', 'My entries') : t('السجل', 'Register'), toReview ? <span className="badge">{toReview}</span> : null)}
          {item('cash', t('النقد', 'Cash'))}
          {!holder && item('reports', t('التقارير', 'Reports'))}
          {!holder && isSup && item('grants', t('المنح', 'Grants'))}
          {!holder && can.manageLists(role) && item('lists', t('القوائم', 'Lists'))}
          {item('files', t('استيراد وتصدير', 'Import / Export'))}
          {item('admin', holder ? t('الإعدادات', 'Settings') : t('الإدارة', 'Admin'))}
          <div className="spacer" />
          <button onClick={onToggleLang}>{getLang() === 'en' ? 'عربي · English' : 'English only'}</button>
          <button onClick={logout}>{t('خروج', 'Log out')}</button>
          <button onClick={onCloseDb} className="small">{t('إغلاق الملف', 'Close file')}</button>
        </nav>
        <main className="main">
          {page === 'home' && <Home />}
          {page === 'register' && <Register key={String(reviewOnly)} />}
          {page === 'cash' && <Cash />}
          {page === 'reports' && <Reports />}
          {page === 'grants' && isSup && <Grants />}
          {page === 'lists' && <ListsPage />}
          {page === 'files' && <Files />}
          {page === 'admin' && <Admin />}
        </main>
      </div>
      {editing && <EntryForm start={editing} onClose={() => setEditing(null)} />}
    </NavCtx.Provider>
  );
}
