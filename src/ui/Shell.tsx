import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { LangPick } from './LangPick';
import type { Perm } from '../perms';
import { Modal, t } from './kit';
import { getLang, m, tx } from '../i18n';
import type { DbInfo } from '../net';
import { doorsOf, type DoorKey } from '../doors';
import { Doors } from './Doors';
import { applyLook, brandStyle, type MyLook } from '../brand';
import { MyLookWindow } from './MyLook';
import { Home } from './Home';
import { EntryForm, type EntryStart } from './EntryForm';
import { Register } from './Register';
import { Cash } from './Cash';
import { Reports } from './Reports';
import { BudgetPage } from './Budget';
import { Grants } from './Grants';
import { invEntries, pendingEntries } from '../inventory/inv';
import { ListsPage } from './ListsPage';
import { Files } from './Files';
import { Admin } from './Admin';
import { Calendar } from './Calendar';
import { InventoryHome } from './InvHome';
import { Guide } from './Guide';
import { GuideCtx, GuideSun } from '../guide/GuideView';
import { draftFor, draftKey } from './draft';
import { PhoneShell } from './Phone';
import { ReportButton } from './InvProblem';

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

export type Page = 'doors' | 'home' | 'register' | 'cash' | 'reports' | 'budget' | 'grants' | 'invmap' | 'calendar' | 'lists' | 'files' | 'admin' | 'guide';

/** "← MAGIS · الأبواب": the way back to the doors page, the arrow turned the way the language reads */
const backLabel = () => { const l = getLang(); return l === 'ar' || l === 'both' ? '→ MAGIS · الأبواب' : l === 'fr' ? '← MAGIS · Portes' : '← MAGIS · Doors'; };

const PAGES: Page[] = ['doors', 'home', 'register', 'cash', 'reports', 'budget', 'grants', 'invmap', 'calendar', 'lists', 'files', 'admin', 'guide'];

/** The door each page belongs to ('admin' and 'guide' belong to none: they keep the door the person came from). */
const DOOR_OF: Partial<Record<Page, DoorKey | null>> = { doors: null, home: 'accounts', register: 'accounts', cash: 'accounts', reports: 'accounts', budget: 'accounts', grants: 'accounts', lists: 'accounts', files: 'accounts', calendar: 'calendar', invmap: 'inventory' };
/** where a door opens */
const DOOR_HOME: Record<Exclude<DoorKey, 'hr'>, Page> = { accounts: 'home', calendar: 'calendar', inventory: 'invmap' };

interface Nav {
  go: (p: Page, opts?: { review?: boolean; book?: number }) => void;
  /** go through one of the doors (the doors page, the menu of that door) */
  door: (k: DoorKey) => void;
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

export function Shell({ onCloseDb, onToggleLang, onDatabases, onAllDatabases, hrDbs, onOpenHr }: { onCloseDb: () => void; onToggleLang: () => void; onDatabases?: () => void; /** the first choice: MAGIS centres, Jesuit communities, HR */ onAllDatabases?: () => void; /** the HR databases this person may enter (HR is one for all the centres, separated inside) */ hrDbs?: DbInfo[]; onOpenHr?: (db: DbInfo) => void }) {
  const { s, d, logout, can, myBooks, limited } = useApp();
  // entering a centre shows the doors page first (Fouad, 24 November 2026); each door has its own menu
  // after a reload of the browser the person comes back to the page they were on (kept in the history entry), else to the doors
  const kept = (() => { try { const h = history.state as { mgShell?: Page; mgDoor?: DoorKey | null } | null; const nav0 = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined; return h?.mgShell && PAGES.includes(h.mgShell) && nav0?.type === 'reload' ? h : null; } catch { return null; } })();
  const [page, setPage] = useState<Page>(kept?.mgShell ?? 'doors');
  const [door, setDoor] = useState<DoorKey | null>(kept?.mgDoor ?? null);
  const here = useRef<{ page: Page; door: DoorKey | null }>({ page, door });
  here.current = { page, door };
  const [hrPick, setHrPick] = useState(false);
  const [guideSection, setGuideSection] = useState<string | null>(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [bookOnly, setBookOnly] = useState<number | null>(null);
  // an entry left half-typed at a sign-out for inactivity comes back
  const [editing, setEditing] = useState<EntryStart | null>(() => (draftFor(draftKey(s))?.start as EntryStart | undefined) ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  // a new key each time a form is opened, so a copy opened from a form starts fresh
  const [formKey, setFormKey] = useState(0);
  const openEntry = (x: EntryStart | null) => { setFormKey((k) => k + 1); setEditing(x); };
  useEffect(() => {
    try { history.replaceState({ mgShell: here.current.page, mgDoor: here.current.door }, ''); } catch { /* no history */ }
    const on = (e: PopStateEvent) => {
      const h = e.state as { mgShell?: Page; mgDoor?: DoorKey | null } | null;
      const p = h?.mgShell && PAGES.includes(h.mgShell) ? h.mgShell : 'doors';
      setReviewOnly(false); setBookOnly(null); setPage(p); setDoor(p === 'doors' ? null : h?.mgDoor ?? null);
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const backTitle = tx(m('إلى صفحة الأبواب', 'Back to the doors page', 'Retour à la page des portes'));
  const hrOn = !!hrDbs?.length && !!onOpenHr && s.mode === 'server';
  const doors = doorsOf({ can, hasBook: myBooks.length > 0, inventoryOn: !!d.inv, hr: hrOn });
  const openHr = () => {
    if (!hrDbs?.length || !onOpenHr) return;
    if (hrDbs.length === 1) onOpenHr(hrDbs[0]);
    else setHrPick(true);
  };
  const nav: Nav = {
    go: (p, o) => {
      setReviewOnly(!!o?.review);
      setBookOnly(o?.book ?? null);
      const dr = p in DOOR_OF ? DOOR_OF[p] ?? null : here.current.door;
      setDoor(dr);
      setPage(p);
      // each page of a door is a step of the browser's history: its Back button goes to the page before, down to the doors page
      if (p !== here.current.page) { try { history.pushState({ mgShell: p, mgDoor: dr }, ''); } catch { /* no history */ } }
    },
    door: (k) => {
      if (k === 'hr') return openHr();
      nav.go(DOOR_HOME[k]);
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
            <div className="side-brand go" role="button" tabIndex={0} title={backTitle} onClick={() => nav.go('doors')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') nav.go('doors'); }}>
              <img src={st.mark ?? '/brand/magis-sun.png'} alt="" />
            </div>
            <div className="go" style={{ flex: 1 }} onClick={() => nav.go('doors')} title={backTitle}>
              <div className="org">{s.organisation || t('حسابات ماجيس', 'MAGIS Accounts')}</div>
              <div className="who">
                {s.profile.name}
                {myBooks.length > 0 && <> · {myBooks.map((id) => d.lists.books.find((b) => b.id === id)?.name).join('، ')}</>}
              </div>
            </div>
            <button className="menu-toggle" onClick={() => setMenuOpen((x) => !x)} aria-label="menu">☰ {t('القائمة', 'Menu')}</button>
          </div>
          {page !== 'doors' && (
            <button className="back" onClick={() => nav.go('doors')} title={backTitle}>
              {backLabel()}
            </button>
          )}
          {door === 'accounts' && <div className="door-name">{tx(m('الحسابات', 'Accounts', 'Comptes'))}</div>}
          {door === 'accounts' && <>
            {item('home', t('الرئيسية', 'Home'))}
            {finances && item('register', limited ? t('قيودي', 'My entries') : t('السجل', 'Register'), toReview ? <span className="badge">{toReview}</span> : null)}
            {(myBooks.length > 0 || can('reports.cash')) && item('cash', t('النقد', 'Cash'))}
            {REPORT_PERMS.some(can) && item('reports', t('التقارير', 'Reports'))}
            {can('budget.view') && item('budget', t('الموازنة', 'Budget'))}
            {can('lists.donors') && item('grants', t('المنح', 'Grants'))}
            {can('lists.manage') && item('lists', t('القوائم', 'Lists'))}
            {(can('data.export') || can('data.import')) && item('files', t('التصدير', 'Export'))}
          </>}
          {door === 'calendar' && can('cal.view') && item('calendar', t('التقويم', 'Calendar'))}
          {door === 'inventory' && can('inventory.view') && d.inv && item('invmap', t('الجرد', 'Inventory'), (d.problems?.open ?? 0) + toInventory ? <span className="badge">{(d.problems?.open ?? 0) + toInventory}</span> : null)}
          {(can('lists.manage') || can('lists.donors') || can('budget.view') || can('inventory.view')) && item('guide', <><GuideSun light /> {t('الدليل', 'Guide')}</>)}
          {item('admin', ADMIN_PERMS.some((p) => p !== 'month.close' && can(p)) ? t('الإدارة', 'Admin') : t('الإعدادات', 'Settings'))}
          <div className="spacer" />
          <ReportButton />
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
          {page !== 'doors' && (
            <div className="door-bar">
              <button className="door-back" onClick={() => nav.go('doors')} title={backTitle}>{backLabel()}</button>
              {door === 'accounts' && <span className="door-here">{tx(m('الحسابات', 'Accounts', 'Comptes'))}</span>}
              {door === 'calendar' && <span className="door-here">{tx(m('التقويم', 'Calendar', 'Calendrier'))}</span>}
              {door === 'inventory' && <span className="door-here">{tx(m('الجرد', 'Inventory', 'Inventaire'))}</span>}
            </div>
          )}
          {page === 'doors' && (
            <Doors doors={doors} centre={s.centre ?? 'other'} centreName={s.organisation || t('حسابات ماجيس', 'MAGIS Accounts')} mark={st.mark ?? '/brand/magis-sun.png'} who={s.profile.name}
              badges={{ accounts: toReview, inventory: (d.problems?.open ?? 0) + toInventory }} onEnter={nav.door} />
          )}
          {page === 'home' && <Home />}
          {page === 'register' && <Register key={`${reviewOnly}|${bookOnly}`} />}
          {page === 'cash' && <Cash />}
          {page === 'reports' && <Reports />}
          {page === 'budget' && can('budget.view') && <BudgetPage />}
          {page === 'grants' && can('lists.donors') && <Grants />}
          {page === 'invmap' && can('inventory.view') && d.inv && <InventoryHome />}
          {page === 'calendar' && can('cal.view') && <Calendar />}
          {page === 'lists' && <ListsPage />}
          {page === 'files' && <Files />}
          {page === 'admin' && <Admin />}
          {page === 'guide' && <Guide section={guideSection} />}
        </main>
      </div>
      {editing && <EntryForm key={formKey} start={editing} onClose={() => setEditing(null)} onCopy={openEntry} />}
      {hrPick && hrDbs && onOpenHr && (
        <Modal title={tx(m('الموارد البشرية', 'HR', 'RH'))} onClose={() => setHrPick(false)}>
          <div className="mg-places">
            {hrDbs.map((x) => <button key={x.slug} className="btn" onClick={() => { setHrPick(false); onOpenHr(x); }}>{x.organisation}</button>)}
          </div>
        </Modal>
      )}
      </div>
    </GuideCtx.Provider></NavCtx.Provider>
  );
}
