import { createContext, useContext, useEffect, useState } from 'react';
import { useApp } from '../state';
import { LangPick } from './LangPick';
import type { Perm } from '../perms';
import { t } from './kit';
import { applyLook, brandStyle, type MyLook } from '../brand';
import { MyLookWindow } from './MyLook';
import { Home } from './Home';
import { EntryForm, type EntryStart } from './EntryForm';
import { Register } from './Register';
import { Cash } from './Cash';
import { Reports } from './Reports';
import { BudgetPage } from './Budget';
import { Grants } from './Grants';
import { Inventory } from './Inventory';
import { invEntries, pendingEntries } from '../inventory/inv';
import { ListsPage } from './ListsPage';
import { Files } from './Files';
import { Admin } from './Admin';
import { Hosting } from './Hosting';
import { Calendar } from './Calendar';
import { InventoryHome } from './InvHome';
import { Guide } from './Guide';
import { GuideCtx, GuideSun } from '../guide/GuideView';
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

export type Page = 'home' | 'register' | 'cash' | 'reports' | 'budget' | 'grants' | 'inventory' | 'invmap' | 'hosting' | 'calendar' | 'lists' | 'files' | 'admin' | 'guide';

interface Nav {
  go: (p: Page, opts?: { review?: boolean; book?: number }) => void;
  /** Open the entry form: a type for a new row, or a row to edit. */
  entry: (x: EntryStart) => void;
  reviewOnly: boolean;
  /** the register opens on this book (from a Home card) */
  bookOnly: number | null;
  /** the list of databases — for the administrator, the Coordinator */
  databases?: () => void;
}
const NavCtx = createContext<Nav | null>(null);
export const useNav = () => useContext(NavCtx)!;

export function Shell({ onCloseDb, onToggleLang, onDatabases, onAllDatabases }: { onCloseDb: () => void; onToggleLang: () => void; onDatabases?: () => void; /** the first choice: MAGIS centres, Jesuit communities, HR */ onAllDatabases?: () => void }) {
  const { s, d, logout, can, myBooks, limited } = useApp();
  const [page, setPage] = useState<Page>('home');
  const [guideSection, setGuideSection] = useState<string | null>(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [bookOnly, setBookOnly] = useState<number | null>(null);
  // an entry left half-typed at a sign-out for inactivity comes back
  const [editing, setEditing] = useState<EntryStart | null>(() => (draftFor(draftKey(s))?.start as EntryStart | undefined) ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  // a new key each time a form is opened, so a copy opened from a form starts fresh
  const [formKey, setFormKey] = useState(0);
  const openEntry = (x: EntryStart | null) => { setFormKey((k) => k + 1); setEditing(x); };
  const nav: Nav = {
    go: (p, o) => {
      setReviewOnly(!!o?.review);
      setBookOnly(o?.book ?? null);
      setPage(p);
    },
    entry: openEntry,
    reviewOnly,
    bookOnly,
    databases: onDatabases,
  };
  const toReview = d.rows.filter((r) => r.review).length;
  const toInventory = can('inventory.manage') ? pendingEntries(invEntries(d).rows, d.lists, d.inv).length : 0;
  // the register is for those who write in a book or look at the books (not for the reception or a stock keeper with no book)
  const finances = myBooks.length > 0 || can('register.view') || can('register.main') || can('register.edit');

  const item = (p: Page, label: React.ReactNode, extra?: React.ReactNode) => (
    <button className={page === p ? 'on' : ''} onClick={() => nav.go(p)}>
      <span>{label}</span>
      {extra}
    </button>
  );

  const st = brandStyle({ centre: s.centre ?? 'other', color: s.brandColor, logo: s.brandLogo });
  // my own colour and page background (kept on my login; shown at once while I choose)
  const [savedLook, setSavedLook] = useState<MyLook>({ color: null, bg: null });
  const [look, setLook] = useState<MyLook>({ color: null, bg: null });
  const [lookOpen, setLookOpen] = useState(false);
  const [lookOwn, setLookOwn] = useState(false);
  useEffect(() => {
    let live = true;
    s.api.call('me.look').then((x) => { if (live) { const l = { color: x.color, bg: x.bg }; setSavedLook(l); setLook(l); setLookOwn(x.own); } }).catch(() => undefined);
    return () => { live = false; };
  }, [s.api, s.profile.id]);
  const lk = applyLook(st, look);
  useEffect(() => {
    const root = document.documentElement;
    if (lk.bg) root.style.setProperty('--bg', lk.bg); else root.style.removeProperty('--bg');
    return () => { root.style.removeProperty('--bg'); };
  }, [lk.bg]);
  const theme = { '--brand': lk.deep, '--brand-2': lk.deep, '--centre': lk.color } as React.CSSProperties;

  // the light phone window on a phone (Fouad, 19 October 2026); the computer window stays as it was
  const narrow = useNarrow();
  // the person's choice, kept on this device: 'phone', 'pc', or none (a phone-sized screen opens the phone window by itself)
  const [pref, setPref] = useState<'phone' | 'pc' | null>(() => { try { const v = localStorage.getItem('magis-view'); return v === 'phone' || v === 'pc' ? v : localStorage.getItem('magis-pc-view') === '1' ? 'pc' : null; } catch { return null; } });
  const choose = (v: 'phone' | 'pc') => { setPref(v); try { localStorage.setItem('magis-view', v); } catch { /* no storage */ } };
  const phone = pref === 'phone' || (narrow && pref !== 'pc');
  if (phone)
    return (
      <NavCtx.Provider value={nav}><GuideCtx.Provider value={(id) => { setGuideSection(id); nav.go('guide'); }}>
        <div style={theme}>
          <PhoneShell onComputer={() => choose('pc')} onToggleLang={onToggleLang} onCloseDb={onCloseDb} onDatabases={onDatabases} onEntry={openEntry} />
          {editing && <EntryForm key={formKey} start={editing} onClose={() => setEditing(null)} onCopy={openEntry} />}
        </div>
      </GuideCtx.Provider></NavCtx.Provider>
    );

  return (
    <NavCtx.Provider value={nav}><GuideCtx.Provider value={(id) => { setGuideSection(id); nav.go('guide'); }}>
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
          {finances && item('register', limited ? t('قيودي', 'My entries') : t('السجل', 'Register'), toReview ? <span className="badge">{toReview}</span> : null)}
          {(myBooks.length > 0 || can('reports.cash')) && item('cash', t('النقد', 'Cash'))}
          {REPORT_PERMS.some(can) && item('reports', t('التقارير', 'Reports'))}
          {can('budget.view') && item('budget', t('الموازنة', 'Budget'))}
          {can('lists.donors') && item('grants', t('المنح', 'Grants'))}
          {can('inventory.view') && d.inv && item('inventory', t('الجرد', 'Inventory'), toInventory ? <span className="badge">{toInventory}</span> : null)}
          {can('inventory.view') && d.inv && item('invmap', t('الجرد الجديد', 'New inventory'))}
          {d.host?.on && item('hosting', t('الإقامة والتقويم', 'Calendar'), d.host.review + d.host.toEnter ? <span className="badge">{d.host.review + d.host.toEnter}</span> : null)}
          {can('cal.view') && item('calendar', t('التقويم الجديد', 'New calendar'))}
          {can('lists.manage') && item('lists', t('القوائم', 'Lists'))}
          {(can('data.export') || can('data.import')) && item('files', t('التصدير', 'Export'))}
          {(can('lists.manage') || can('lists.donors') || can('budget.view') || can('inventory.view')) && item('guide', <><GuideSun light /> {t('الدليل', 'Guide')}</>)}
          {item('admin', ADMIN_PERMS.some((p) => p !== 'month.close' && can(p)) ? t('الإدارة', 'Admin') : t('الإعدادات', 'Settings'))}
          <div className="spacer" />
          <button onClick={() => choose('phone')}>📱 {t('عرض الهاتف', 'Phone view')}</button>
          <LangPick onChange={onToggleLang} />
          {lookOwn && <button onClick={() => setLookOpen(true)}>🎨 {t('لوني', 'My colour')}</button>}
          {onDatabases && <button onClick={onDatabases}>{can('users.manage') ? t('قواعد البيانات · جديدة', 'Databases · new') : t('قواعد البيانات', 'Databases')}</button>}
          {onAllDatabases && <button onClick={onAllDatabases}>🏠 {t('الصفحة الأولى', 'Home page')}</button>}
          <button onClick={logout}>{t('خروج', 'Log out')}</button>
          {s.mode !== 'server' && <button onClick={onCloseDb} className="small">{t('إغلاق الملف', 'Close file')}</button>}
        </nav>
        {lookOpen && <MyLookWindow base={st} saved={savedLook} onPreview={setLook} onSaved={(l) => { setSavedLook(l); setLook(l); }} onClose={() => setLookOpen(false)} />}
        <main className="main">
          {page === 'home' && <Home />}
          {page === 'register' && <Register key={`${reviewOnly}|${bookOnly}`} />}
          {page === 'cash' && <Cash />}
          {page === 'reports' && <Reports />}
          {page === 'budget' && can('budget.view') && <BudgetPage />}
          {page === 'grants' && can('lists.donors') && <Grants />}
          {page === 'inventory' && can('inventory.view') && <Inventory />}
          {page === 'invmap' && can('inventory.view') && d.inv && <InventoryHome />}
          {page === 'hosting' && d.host?.on && <Hosting />}
          {page === 'calendar' && can('cal.view') && <Calendar />}
          {page === 'lists' && <ListsPage />}
          {page === 'files' && <Files />}
          {page === 'admin' && <Admin />}
          {page === 'guide' && <Guide section={guideSection} />}
        </main>
      </div>
      {editing && <EntryForm key={formKey} start={editing} onClose={() => setEditing(null)} onCopy={openEntry} />}
      </div>
    </GuideCtx.Provider></NavCtx.Provider>
  );
}
