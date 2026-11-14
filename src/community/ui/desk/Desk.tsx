// The econome's desk: the computer layout of the community database, for those who
// see every book (the econome, the Superior). A menu on the side, wide tables, and
// the same entry sheet as on the phone, opened as a panel on the right.
import { useState } from 'react';
import { accountBooks, balanceOf } from '../../domain';
import { BOOK_ICON } from '../icons';
import { curName, money } from '../text';
import { useCty, bookHelp, bookLabel, bookRole, Hats, HatBand, WhoIs, hatClass } from '../CtyApp';
import { PageGuard } from '../Guard';
import { t3 } from '../text';
import { MonthScreen } from '../Month';
import { Approvals } from '../Approvals';
import { SettingsScreen } from '../Settings';
import { Dashboard } from './Dashboard';
import { Register } from './Register';
import { MemberMonth } from './MemberMonth';
import { Claims } from './Claims';
import { Quarter } from './Quarter';
import { Books } from './Books';
import { Report } from '../Report';
import { Chart } from './Chart';
import { PeopleScreen } from '../People';
import { RolesScreen } from '../Roles';
import { SendMonth } from './SendMonth';
import { Statement } from './Statement';
import { HostCharges } from './HostCharges';

export type DeskPage = 'people' | 'dash' | 'books' | 'report' | 'register' | 'member' | 'approvals' | 'claims' | 'quarter' | 'send' | 'statement' | 'host' | 'chart' | 'mine' | 'settings' | 'roles';

export interface DeskNav {
  page: DeskPage;
  /** the book and month a page opens on (from a click on the dashboard) */
  bookId?: number | null;
  ym?: string;
}

export function Desk({ onPhone, onLang, onLogout, onCloseDb, onDatabases }: {
  onPhone: () => void; onLang: () => void; onLogout: () => void; onCloseDb?: () => void; onDatabases?: () => void;
}) {
  const { s, d, can, myBooks } = useCty();
  // the Administrator sees no record: his window starts on the accounts
  const sees = can('cty.view_all');
  // the Superior's own short screen (Fouad, 13 November 2026): approve, read each one's month, see the community
  const superior = can('cty.month_seen') && !can('book.own') && !can('users.manage');
  const waiting = d.entries.filter((e) => e.approval_needed && !e.approved_at && !e.refused_at).length;
  const [nav, setNav] = useState<DeskNav>({ page: superior ? (waiting ? 'approvals' : 'member') : sees ? 'dash' : 'people' });
  const go = (n: DeskNav) => setNav(n);
  // six places at most (Fouad, 13 November 2026: "simple"); a place with several pages shows them as tabs
  type Tab = { page: DeskPage; label: string; hidden?: boolean };
  const T = {
    today: t3('اليوم', 'Today', "Aujourd'hui"),
    list: t3('القائمة', 'List', 'Liste'),
    charts: t3('الفصول والبنود', 'Quarters & categories', 'Trimestres et catégories'),
    each: t3('حساب كل واحد', "Each one's account", 'Le compte de chacun'),
    mine: t3('دفاتري', 'My books', 'Mes comptes'),
    approvals: t3('للموافقة', 'To approve', 'À approuver'),
    report: t3('تقرير النفقات', 'Expenses report', 'Rapport des dépenses'),
  };
  const sections: { key: string; label: string; badge?: number; tabs: Tab[] }[] = superior ? [
    { key: 'approve', label: T.approvals, badge: waiting, tabs: [{ page: 'approvals', label: T.approvals }] },
    { key: 'read', label: t3('قراءة الشهر', 'Read the month', 'Lire le mois'), tabs: [{ page: 'member', label: T.each }] },
    { key: 'cty', label: t3('الجماعة', 'The community', 'La communauté'), tabs: [{ page: 'dash', label: T.today }] },
    { key: 'entries', label: t3('القيود', 'Entries', 'Écritures'), tabs: [{ page: 'register', label: T.list }, { page: 'quarter', label: T.charts }] },
    { key: 'settings', label: t3('الإعدادات', 'Settings', 'Réglages'), tabs: [{ page: 'settings', label: t3('اللغة واللوحة', 'Language & control panel', 'Langue et tableau de bord') }] },
  ] : [
    { key: 'today', label: T.today, tabs: [{ page: 'dash', label: T.today, hidden: !sees }] },
    // the entries and the report on the expenses (Fouad, 14 November 2026: "a wider vision")
    { key: 'entries', label: t3('القيود والتقارير', 'Entries & reports', 'Écritures et rapports'), tabs: [
      { page: 'register', label: T.list, hidden: !sees }, { page: 'report', label: T.report, hidden: !sees }, { page: 'quarter', label: T.charts, hidden: !sees }] },
    // "The books": every brother, the house, the cash, the économat, as the holders in MAGIS (Fouad, 14 November 2026)
    { key: 'books', label: t3('الدفاتر', 'The books', 'Les comptes'), badge: can('cty.month_seen') ? waiting : undefined, tabs: [
      { page: 'books', label: t3('كل الدفاتر', 'All the books', 'Tous les comptes'), hidden: !sees }, { page: 'mine', label: T.mine, hidden: !myBooks.length },
      { page: 'approvals', label: T.approvals, hidden: !can('cty.month_seen') }] },
    { key: 'end', label: t3('آخر الفترة', 'End of the period', 'Fin de période'), tabs: [
      { page: 'send', label: t3('الموحّد ← البلد', 'Consolidated → country', 'Consolidé → pays'), hidden: !sees }] },
    { key: 'province', label: t3('مع الإقليم', 'With the Province', 'Avec la Province'), tabs: [
      { page: 'claims', label: t3('المطالبات', 'Claims', 'Réclamations'), hidden: !sees },
      { page: 'host', label: t3('تكاليف على جماعات أخرى', 'Charges to other communities', 'Charges à d’autres communautés'), hidden: !sees },
      { page: 'statement', label: t3('الحساب عند الإيكونوماتو', 'Account at the économat', "Compte à l'économat"), hidden: !sees }] },
    { key: 'settings', label: t3('الإعدادات', 'Settings', 'Réglages'), tabs: [
      { page: 'people', label: t3('الحسابات', 'Accounts', 'Comptes'), hidden: !can('users.manage') && !can('cty.passwords') },
      { page: 'roles', label: t3('الصلاحيات', 'Roles and permissions', 'Rôles et permissions'), hidden: !can('users.manage') },
      { page: 'settings', label: t3('اللغة واللوحة', 'Language & control panel', 'Langue et tableau de bord') },
      { page: 'chart', label: t3('دليل الحسابات', 'Chart of codes', 'Plan des comptes'), hidden: !sees && !can('cty.chart') }] },
    // ("Import an FDC" is no longer in the menu: Fouad, 14 November 2026, "not relevant"; ImportFdc.tsx stays in the code)
  ];
  const shown = sections.map((x) => ({ ...x, tabs: x.tabs.filter((t) => !t.hidden) })).filter((x) => x.tabs.length);
  const here = shown.find((x) => x.tabs.some((t) => t.page === nav.page));

  return (
    <div className={`cty desk ${hatClass(s.profile.office)}`}>
      <aside className="desk-side">
        <div className="desk-org"><b>{s.organisation}</b><WhoIs profile={s.profile} light />{s.mode === 'server' && <Hats light />}</div>
        <div className="desk-group">
          {shown.map((x) => (
            <button key={x.key} className={here?.key === x.key ? 'on' : ''} onClick={() => go({ page: x.tabs[0].page })}>
              <span>{x.label}</span>{x.badge ? <i className="cty-badge static">{x.badge}</i> : null}
            </button>
          ))}
        </div>
        <div className="desk-spacer" />
        {myBooks.length > 0 && <button onClick={onPhone}>📱 {t3('عرض الهاتف', 'Phone view', 'Vue téléphone')}</button>}
        <button onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
      </aside>
      <main className="desk-main">
        <HatBand />
        {here && here.tabs.length > 1 && (
          <div className="desk-tabs" role="tablist">
            {here.tabs.map((t) => <button key={t.page} role="tab" aria-selected={t.page === nav.page} className={t.page === nav.page ? 'on' : ''} onClick={() => go({ page: t.page })}>{t.label}{t.page === 'approvals' && waiting ? <i className="cty-badge static">{waiting}</i> : null}</button>)}
          </div>
        )}
        <PageGuard page={`${nav.page}:${nav.bookId ?? ''}`}>
        {nav.page === 'dash' && <Dashboard go={go} />}
        {nav.page === 'register' && <Register initialBook={nav.bookId ?? null} initialYm={nav.ym} />}
        {nav.page === 'member' && <MemberMonth initialBook={nav.bookId ?? null} initialYm={nav.ym} />}
        {nav.page === 'approvals' && <div className="desk-narrow"><Approvals /></div>}
        {nav.page === 'claims' && <Claims />}
        {nav.page === 'quarter' && <Quarter />}
        {nav.page === 'send' && <SendMonth />}
        {nav.page === 'statement' && <Statement />}
        {nav.page === 'host' && <HostCharges />}
        {nav.page === 'report' && <Report scope="community" />}
        {nav.page === 'books' && <Books initialBook={nav.bookId ?? null} initialYm={nav.ym} />}
        {nav.page === 'chart' && <Chart />}
        {nav.page === 'mine' && <div className="desk-narrow"><MyBooks /></div>}
        {nav.page === 'settings' && <div className="desk-narrow"><SettingsScreen inDesk onLang={onLang} onLogout={onLogout} onCloseDb={onCloseDb} onDatabases={onDatabases} /></div>}
        {nav.page === 'people' && <div className="desk-narrow"><PeopleScreen /></div>}
        {nav.page === 'roles' && <div className="desk-narrow" style={{ maxWidth: 900 }}><RolesScreen /></div>}
        </PageGuard>
      </main>
    </div>
  );
}

/**
 * "My books": one card per account he keeps, each saying in which role he keeps it and what it
 * is (Fouad: "when I open my books it's confusing; explain what every book means").
 */
function MyBooks() {
  const { d, myBooks, book, setBook } = useCty();
  const today = new Date().toISOString().slice(0, 10);
  const mains = myBooks.filter((b) => !['personal_bank', 'envelope', 'bank'].includes(b.cty_kind ?? ''));
  return (
    <>
      <h1>{t3('دفاتري', 'My books', 'Mes comptes')}</h1>
      <p className="muted small">{t3('كل حساب تمسكه، وبأي صفة، وما هو. اضغط على بطاقة لتفتحه.', 'Every account you keep, in which role, and what it is. Tap a card to open it.', 'Chaque compte que vous tenez, dans quel rôle, et ce que c’est. Touchez une carte pour l’ouvrir.')}</p>
      <div className="desk-mybooks">
        {mains.map((b) => {
          const group = accountBooks(d.books, b);
          const bal = balanceOf(d.entries, group, today);
          return (
            <button key={b.id} className={`desk-mybook ${b.id === book.id ? 'on' : ''}`} onClick={() => setBook(b.id)}>
              <span className="desk-mybook-role">{BOOK_ICON[b.cty_kind ?? ''] ?? ''} {bookRole(b.cty_kind)}</span>
              <b>{bookLabel(b)}</b>
              <span className="desk-mybook-bal">{money(bal.LOC, 'LOC')} <small>{curName('LOC', d.local)}</small>{bal.USD ? <> · {money(bal.USD, 'USD')} $</> : null}{bal.EUR ? <> · {money(bal.EUR, 'EUR')} €</> : null}</span>
              <small className="muted">{bookHelp(b.cty_kind)}</small>
            </button>
          );
        })}
      </div>
      <MonthScreen key={book.id} />
    </>
  );
}
