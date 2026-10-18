// The econome's desk: the computer layout of the community database, for those who
// see every book (the econome, the Superior). A menu on the side, wide tables, and
// the same entry sheet as on the phone, opened as a panel on the right.
import { useState } from 'react';
import { useCty, bookLabel } from '../CtyApp';
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
import { SendMonth } from './SendMonth';
import { Statement } from './Statement';
import { HostCharges } from './HostCharges';

export type DeskPage = 'people' | 'dash' | 'register' | 'member' | 'approvals' | 'claims' | 'quarter' | 'send' | 'statement' | 'host' | 'import' | 'chart' | 'mine' | 'settings';

export interface DeskNav {
  page: DeskPage;
  /** the book and month a page opens on (from a click on the dashboard) */
  bookId?: number | null;
  ym?: string;
}

export function Desk({ onPhone, onLang, onLogout, onCloseDb, onDatabases }: {
  onPhone: () => void; onLang: () => void; onLogout: () => void; onCloseDb?: () => void; onDatabases?: () => void;
}) {
  const { s, d, can } = useCty();
  const [nav, setNav] = useState<DeskNav>({ page: 'dash' });
  const go = (n: DeskNav) => setNav(n);
  const waiting = d.entries.filter((e) => e.approval_needed && !e.approved_at).length;
  // three short groups: every day, end of the period, settings
  const groups: { title: string; items: { page: DeskPage; label: string; badge?: number; hidden?: boolean }[] }[] = [
    { title: t3('كل يوم', 'Every day', 'Chaque jour'), items: [
      { page: 'dash', label: t3('اللوحة', 'Dashboard', 'Tableau de bord') },
      { page: 'register', label: t3('كل القيود', 'All entries', 'Toutes les écritures') },
      { page: 'member', label: t3('حساب كل واحد', "Each one's account", 'Le compte de chacun') },
      { page: 'approvals', label: t3('موافقات', 'Approvals', 'Accords'), badge: waiting, hidden: !can('cty.month_seen') },
      { page: 'mine', label: t3('دفاتري', 'My books', 'Mes comptes') },
    ] },
    { title: t3('آخر الفترة', 'End of the period', 'Fin de période'), items: [
      { page: 'send', label: t3('الموحّد ← البلد', 'Consolidated → country', 'Consolidé → pays') },
      { page: 'claims', label: t3('المطالبات', 'Claims', 'Réclamations') },
      { page: 'host', label: t3('تكاليف على جماعات أخرى', 'Charges to other communities', 'Charges à d’autres communautés') },
      { page: 'statement', label: t3('الحساب عند الإيكونوماتو', 'Account at the économat', "Compte à l'économat") },
      { page: 'quarter', label: t3('الملف الفصلي', 'Quarterly file', 'Fichier trimestriel') },
    ] },
    { title: t3('الإعدادات', 'Settings', 'Réglages'), items: [
      { page: 'people', label: t3('الأشخاص والأدوار', 'People and roles', 'Personnes et rôles') },
      { page: 'settings', label: t3('اللغة واللوحة', 'Language & control panel', 'Langue et tableau de bord') },
      { page: 'chart', label: t3('دليل الحسابات', 'Chart of codes', 'Plan des comptes') },
      { page: 'import', label: t3('استيراد FDC', 'Import an FDC', 'Importer une FDC'), hidden: !can('data.import') && !can('cty.write_all') },
    ] },
  ];

  return (
    <div className="cty desk">
      <aside className="desk-side">
        <div className="desk-org"><b>{s.organisation}</b><span>{s.profile.name}</span></div>
        {groups.map((g) => (
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
        <button onClick={onPhone}>📱 {t3('عرض الهاتف', 'Phone view', 'Vue téléphone')}</button>
        <button onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
      </aside>
      <main className="desk-main">
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
      </main>
    </div>
  );
}

/** His own books, as on the phone (his personal book, the house, the cash…). */
function MyBooks() {
  const { myBooks, book, setBook } = useCty();
  return (
    <>
      {myBooks.length > 1 && (
        <nav className="cty-books" style={{ padding: 0 }}>
          {myBooks.map((b) => <button key={b.id} className={b.id === book.id ? 'on' : ''} onClick={() => setBook(b.id)}>{bookLabel(b)}</button>)}
        </nav>
      )}
      <MonthScreen />
    </>
  );
}
