// The econome's desk: the computer layout of the community database, for those who
// see every book (the econome, the Superior). A menu on the side, wide tables, and
// the same entry sheet as on the phone, opened as a panel on the right.
import { useState } from 'react';
import { accountBooks, balanceOf } from '../../domain';
import { BOOK_ICON } from '../icons';
import { curName, money } from '../text';
import { useCty, bookHelp, bookLabel, bookRole, WhoIs } from '../CtyApp';
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
import { ImportFdc } from './ImportFdc';
import { Chart } from './Chart';
import { PeopleScreen } from '../People';
import { RolesScreen } from '../Roles';
import { SendMonth } from './SendMonth';
import { Statement } from './Statement';
import { HostCharges } from './HostCharges';

export type DeskPage = 'people' | 'dash' | 'register' | 'member' | 'approvals' | 'claims' | 'quarter' | 'send' | 'statement' | 'host' | 'import' | 'chart' | 'mine' | 'settings' | 'roles';

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
  const [nav, setNav] = useState<DeskNav>({ page: sees ? 'dash' : 'people' });
  const go = (n: DeskNav) => setNav(n);
  const waiting = d.entries.filter((e) => e.approval_needed && !e.approved_at && !e.refused_at).length;
  // three short groups: every day, end of the period, settings
  const groups: { title: string; items: { page: DeskPage; label: string; badge?: number; hidden?: boolean }[] }[] = [
    { title: t3('كل يوم', 'Every day', 'Chaque jour'), items: !sees && !myBooks.length ? [] : [
      { page: 'dash', label: t3('اللوحة', 'Dashboard', 'Tableau de bord') },
      { page: 'register', label: t3('كل القيود', 'All entries', 'Toutes les écritures') },
      { page: 'member', label: t3('حساب كل واحد', "Each one's account", 'Le compte de chacun') },
      { page: 'approvals', label: t3('موافقات', 'Approvals', 'Accords'), badge: waiting, hidden: !can('cty.month_seen') },
      { page: 'mine', label: t3('دفاتري', 'My books', 'Mes comptes'), hidden: !myBooks.length },
    ] },
    { title: t3('آخر الفترة', 'End of the period', 'Fin de période'), items: !sees ? [] : [
      { page: 'send', label: t3('الموحّد ← البلد', 'Consolidated → country', 'Consolidé → pays') },
      { page: 'claims', label: t3('المطالبات', 'Claims', 'Réclamations') },
      { page: 'host', label: t3('تكاليف على جماعات أخرى', 'Charges to other communities', 'Charges à d’autres communautés') },
      { page: 'statement', label: t3('الحساب عند الإيكونوماتو', 'Account at the économat', "Compte à l'économat") },
      { page: 'quarter', label: t3('الفصول والبنود', 'Quarters & categories', 'Trimestres et catégories') },
    ] },
    { title: t3('الإعدادات', 'Settings', 'Réglages'), items: [
      { page: 'people', label: t3('الحسابات', 'Accounts', 'Comptes'), hidden: !can('users.manage') && !can('cty.passwords') },
      { page: 'roles', label: t3('الصلاحيات', 'Roles and permissions', 'Rôles et permissions'), hidden: !can('users.manage') },
      { page: 'settings', label: t3('اللغة واللوحة', 'Language & control panel', 'Langue et tableau de bord') },
      { page: 'chart', label: t3('دليل الحسابات', 'Chart of codes', 'Plan des comptes'), hidden: !sees && !can('cty.chart') },
      { page: 'import', label: t3('استيراد FDC', 'Import an FDC', 'Importer une FDC'), hidden: !can('data.import') },
    ] },
  ];

  return (
    <div className="cty desk">
      <aside className="desk-side">
        <div className="desk-org"><b>{s.organisation}</b><WhoIs profile={s.profile} light /></div>
        {groups.filter((g) => g.items.some((x) => !x.hidden)).map((g) => (
          <div key={g.title} className="desk-group">
            <div className="desk-group-title">{g.title}</div>
            {g.items.filter((x) => !x.hidden).map((x) => (
              <button key={x.page} className={nav.page === x.page ? 'on' : ''} onClick={() => go({ page: x.page })}>
                <span>{x.label}</span>{x.badge ? <i className="cty-badge static">{x.badge}</i> : null}
              </button>
            ))}
          </div>
        ))}
        <div className="desk-spacer" />
        {myBooks.length > 0 && <button onClick={onPhone}>📱 {t3('عرض الهاتف', 'Phone view', 'Vue téléphone')}</button>}
        <button onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
      </aside>
      <main className="desk-main">
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
        {nav.page === 'import' && <ImportFdc />}
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
