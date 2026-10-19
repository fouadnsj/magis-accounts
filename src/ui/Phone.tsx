// The light phone window of a MAGIS centre (Fouad, 19 October 2026): for the book holders and
// the accountant entering on a phone. Modelled on the communities' phone screens: a month card,
// the four big actions, the money to confirm, this month's entries, all records, a bottom bar.
// The computer window (Shell) does not change; the same entry form is used.
import { useMemo, useState } from 'react';
import { useApp, useIcons, useNames } from '../state';
import { holdersMonth } from '../domain/reports';
import { rateOn } from '../domain/compute';
import type { Trx, TrxType } from '../domain/types';
import type { TransferInfo } from '../domain/transfers';
import { TYPE_LABEL, getLang, tx } from '../i18n';
import { brandStyle } from '../brand';
import { errText, fmtDate, fmtSyp, fmtUsd, promptBox, t, toast } from './kit';
import { holderBalance } from './Cash';
import { TYPE_ICON } from './Home';
import { LangPick } from './LangPick';
import type { EntryStart } from './EntryForm';
import { Envelopes } from './Envelopes';
import '../community/ui/cty.css';

type View = 'month' | 'records';

const ymAdd = (ym: string, n: number) => {
  const [y, mo] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthName = (ym: string) => {
  const l = getLang();
  const loc = l === 'ar' ? 'ar-SY' : l === 'fr' ? 'fr-FR' : 'en-GB';
  return new Date(`${ym}-15T00:00:00Z`).toLocaleDateString(loc, { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** The amount of a row as the person sees it: + money in, − money out, in its currency. */
function rowMoney(r: Trx): { syp: number; usd: number } {
  if (r.type === 'Income') return { syp: r.inc_syp ?? 0, usd: r.inc_usd ?? 0 };
  if (r.type === 'Exp') return { syp: -(r.exp_syp ?? 0), usd: -(r.exp_usd ?? 0) };
  if (r.type === 'Exchange') return { syp: r.trf_syp ?? 0, usd: -(r.trf_usd ?? 0) };
  return { syp: r.trf_syp ?? 0, usd: r.trf_usd ?? 0 };
}

export function PhoneShell({ onComputer, onToggleLang, onCloseDb, onDatabases, onEntry }: {
  onComputer: () => void;
  onToggleLang: () => void;
  onCloseDb: () => void;
  onDatabases?: () => void;
  onEntry: (x: EntryStart) => void;
}) {
  const { s, d, can, writeBooks, myBooks, fileHolder, logout } = useApp();
  const names = useNames();
  // the books shown: those he writes in (his own; Main for the accountant), else those he keeps
  const books = (writeBooks.length ? writeBooks : myBooks).filter((id) => d.lists.books.some((b) => b.id === id && b.parent_id == null));
  const [bookId, setBookId] = useState<number | null>(books[0] ?? null);
  const [view, setView] = useState<View>('month');
  const st = brandStyle({ centre: s.centre ?? 'other', color: s.brandColor, logo: s.brandLogo });
  const theme = { '--c-gold': st.color, '--c-deep': st.deep } as React.CSSProperties;
  const types: TrxType[] = fileHolder ? ['Exp', 'Income', 'Exchange'] : ['Exp', 'Income', 'Transfer', 'Exchange'];
  const book = d.lists.books.find((b) => b.id === bookId) ?? null;

  return (
    <div className="cty magis-phone" style={theme}>
      <header className="cty-top">
        <div className="cty-org" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <img src={st.mark ?? '/brand/magis-sun.png'} alt="" style={{ height: 30 }} />
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <b>{s.organisation || t('حسابات ماجيس', 'MAGIS Accounts')}</b>
            <span>{s.profile.name}</span>
          </span>
        </div>
        <span className="cty-topbtns">
          <LangPick onChange={onToggleLang} compact />
          <button className="cty-signout" onClick={logout}>⏻ {t('خروج', 'Sign out')}</button>
        </span>
      </header>
      {books.length > 1 && (
        <nav className="cty-books">
          {books.map((id) => <button key={id} className={id === bookId ? 'on' : ''} onClick={() => setBookId(id)}>{names.book(id)}</button>)}
        </nav>
      )}
      <main className="cty-page">
        {!book ? (
          <div className="cty-card">
            <p>{t('لا دفتر تكتب فيه من الهاتف.', 'You have no book to write in from the phone.')}</p>
            <button className="btn cty-wide" onClick={onComputer}>🖥 {t('عرض الحاسوب', 'Computer view')}</button>
          </div>
        ) : view === 'month' ? (
          <MonthCard key={book.id} bookId={book.id} types={types} onEntry={onEntry} />
        ) : (
          <Records key={book.id} bookId={book.id} onEntry={onEntry} />
        )}
        <div className="cty-card">
          <div className="cty-tiles small">
            <button onClick={onComputer}>🖥 {t('عرض الحاسوب', 'Computer view')}</button>
            {onDatabases && <button onClick={onDatabases}>{t('قواعد البيانات', 'Databases')}</button>}
            {s.mode !== 'server' && <button onClick={onCloseDb}>{t('إغلاق الملف', 'Close file')}</button>}
          </div>
          {!can('book.own') && !can('register.edit') && !can('register.main') && <p className="muted small">{t('للقراءة فقط.', 'Read only.')}</p>}
        </div>
      </main>
      {book && (
        <nav className="cty-bar">
          <button className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}><span className="cty-tab-icon">◔</span><span>{t('شهري', 'My month')}</span></button>
          <button className={view === 'records' ? 'on' : ''} onClick={() => setView('records')}><span className="cty-tab-icon">☰</span><span>{t('كل القيود', 'Records')}</span></button>
        </nav>
      )}
    </div>
  );
}

function MonthCard({ bookId, types, onEntry }: { bookId: number; types: TrxType[]; onEntry: (x: EntryStart) => void }) {
  const { d, can, myBooks, fileHolder, reload } = useApp();
  const names = useNames();
  const icons = useIcons();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [ym, setYm] = useState(thisMonth);
  const book = d.lists.books.find((b) => b.id === bookId)!;
  const now = holderBalance(d, bookId, fileHolder);
  const month = useMemo(() => ({ syp: holdersMonth(d.rows, [book], 'SYP', ym)[0], usd: holdersMonth(d.rows, [book], 'USD', ym)[0] }), [d.rows, book, ym]);
  const rate = rateOn(d.rows, bookId, new Date().toISOString().slice(0, 10), d.lists.settings.usd_rate);
  const allUsd = now.usd.shouldHold + (rate ? now.syp.shouldHold / rate : 0);
  const rows = d.rows.filter((r) => r.book_id === bookId && r.date?.startsWith(ym)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.n ?? 0) - (a.n ?? 0));
  const mainId = d.lists.books.find((b) => b.is_main)?.id ?? null;
  const isMine = (id: number | null) => id === bookId || (id === mainId && (can('register.edit') || can('register.main')) && bookId === mainId);
  const toConfirm = d.transfers.filter((x) => !x.receivedAt && !x.disputedAt && isMine(x.to) && (myBooks.includes(x.to!) || x.to === mainId) && !d.closed.has((x.date ?? '').slice(0, 7)));
  const inOut = (l: typeof month.syp) => ({ in: l.income + Math.max(0, l.transfers) + Math.max(0, l.exchange), out: l.expenses + Math.max(0, -l.transfers) + Math.max(0, -l.exchange) });
  const ms = inOut(month.syp);
  const mu = inOut(month.usd);

  return (
    <>
      {toConfirm.map((x) => <Confirm key={x.key} x={x} onDone={reload} />)}
      <div className="cty-monthnav">
        <button onClick={() => setYm(ymAdd(ym, -1))} aria-label="‹">‹</button>
        <b>{monthName(ym)}</b>
        <button onClick={() => setYm(ymAdd(ym, 1))} disabled={ym >= thisMonth} aria-label="›">›</button>
      </div>
      <div className="cty-card cty-pocket">
        <div className="cty-label">{t('في الدفتر الآن', 'In the book now')} · {names.book(bookId)}</div>
        <div className="cty-pocket-row">
          <div className="cty-pocket-cur"><b className="ltr">{fmtSyp(now.syp.shouldHold)}</b><span>{t('ل.س', 'SYP')}</span></div>
          <div className="cty-pocket-cur"><b className="ltr">{fmtUsd(now.usd.shouldHold)}</b><span>$</span></div>
        </div>
        <p className="cty-help">≈ <b className="ltr">{fmtUsd(allUsd)} $</b> {t('الكل بالدولار', 'all in dollars')}{rate ? <> · <span className="ltr">{fmtSyp(rate)}</span> {t('ل.س = 1$', 'SYP = $1')}</> : null}</p>
      </div>

      {types.length > 0 && (can('book.own') || can('register.edit') || can('register.main')) && (
        <div className="cty-four four-eq">
          {types.map((ty) => (
            <button key={ty} className={ty === 'Exp' ? 'out' : ty === 'Income' ? 'in' : ty === 'Transfer' ? 'trf' : 'exc'} onClick={() => onEntry(ty)}>
              <i>{TYPE_ICON[ty]}</i>{tx(TYPE_LABEL[ty])}
            </button>
          ))}
        </div>
      )}

      {!book.is_main && <Envelopes bookId={bookId} onEntry={onEntry} compact />}

      <div className="cty-card">
        <div className="cty-label">{t('هذا الشهر', 'This month')}</div>
        <div className="cty-inout">
          <div><span className="muted small">{t('ل.س', 'SYP')}</span><span className="in">＋{fmtSyp(ms.in)}</span><span className="out">－{fmtSyp(ms.out)}</span></div>
          <div><span className="muted small">$</span><span className="in">＋{fmtUsd(mu.in)}</span><span className="out">－{fmtUsd(mu.out)}</span></div>
        </div>
        <p className="cty-help">{t('في البداية', 'At the start')}: <span className="ltr">{fmtSyp(month.syp.start)}</span> {t('ل.س', 'SYP')} · <span className="ltr">{fmtUsd(month.usd.start)}</span> $ — {t('في النهاية', 'at the end')}: <span className="ltr">{fmtSyp(month.syp.end)}</span> · <span className="ltr">{fmtUsd(month.usd.end)}</span> $</p>
      </div>

      <div className="cty-card">
        <div className="cty-label">{t('قيود الشهر', "The month's entries")} ({rows.length})</div>
        {!rows.length && <p className="muted small">{t('لا شيء بعد.', 'Nothing yet.')}</p>}
        {rows.map((r) => <RowLine key={r.id} r={r} icon={icons.line(r.line_id)} line={names.line(r.line_id)} onOpen={() => onEntry(r)} />)}
      </div>
    </>
  );
}

function RowLine({ r, icon, line, onOpen }: { r: Trx; icon: string; line: string; onOpen: () => void }) {
  const mny = rowMoney(r);
  return (
    <button className="cty-entry" onClick={onOpen} style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--c-soft2)', padding: '8px 0', display: 'flex', gap: 10, alignItems: 'center', textAlign: 'start', cursor: 'pointer', font: 'inherit' }}>
      <span className="cty-entry-day" style={{ minWidth: 44 }}>{fmtDate(r.date).slice(0, 5)}<small>{r.type ? tx(TYPE_LABEL[r.type]) : ""}</small></span>
      <span style={{ fontSize: 20 }}>{icon || '•'}</span>
      <span className="cty-entry-text" style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 14 }}>{line || (r.type ? tx(TYPE_LABEL[r.type]) : "—")}</b>
        <span className="muted small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.explanation ?? ''}{r.review ? ' ⚠' : ''}</span>
      </span>
      <span className="ltr" style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>
        {mny.syp ? <div style={{ color: mny.syp < 0 ? 'var(--c-out)' : 'var(--c-in)' }}>{mny.syp > 0 ? '+' : '−'}{fmtSyp(Math.abs(mny.syp))} <small>SYP</small></div> : null}
        {mny.usd ? <div style={{ color: mny.usd < 0 ? 'var(--c-out)' : 'var(--c-in)' }}>{mny.usd > 0 ? '+' : '−'}{fmtUsd(Math.abs(mny.usd))} <small>$</small></div> : null}
      </span>
    </button>
  );
}

/** Money given to this book: "Yes, I received it" or "No". */
function Confirm({ x, onDone }: { x: TransferInfo; onDone: () => Promise<void> }) {
  const { s } = useApp();
  const names = useNames();
  const [busy, setBusy] = useState(false);
  const reply = async (ok: boolean) => {
    let note: string | null = null;
    if (!ok) {
      note = await promptBox(t('ماذا حدث؟ (مثلاً: وصلني أقل، لم يصل شيء)', 'What happened? (e.g. received less, nothing arrived)'), '');
      if (note == null) return;
    }
    setBusy(true);
    try {
      await s.api.call('transfer.answer', { id: x.rowIds[0], ok, note });
      await onDone();
      toast(ok ? t('شكراً — أُكِّد الاستلام', 'Thank you — receipt confirmed') : t('أُبلغ المكتب', 'The office is told'));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cty-card cty-confirm">
      <div className="cty-label">⏳ {t('هل استلمتَ هذا المال؟', 'Did you receive this money?')}</div>
      <p style={{ margin: '4px 0' }}><b className="ltr">{x.currency === 'SYP' ? fmtSyp(x.amount) : fmtUsd(x.amount)} {x.currency === 'SYP' ? t('ل.س', 'SYP') : '$'}</b> — {names.book(x.from)} · {fmtDate(x.date)}</p>
      {x.explanation && <p className="muted small" style={{ margin: 0 }}>{x.explanation}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" disabled={busy} onClick={() => reply(true)}>✓ {t('نعم، استلمته', 'Yes, I received it')}</button>
        <button className="btn danger" disabled={busy} onClick={() => reply(false)}>✗ {t('لم يصل', 'Not received')}</button>
      </div>
    </div>
  );
}

/** Every record of the book: by month or all, by kind, by a word. */
function Records({ bookId, onEntry }: { bookId: number; onEntry: (x: EntryStart) => void }) {
  const { d } = useApp();
  const names = useNames();
  const icons = useIcons();
  const [kind, setKind] = useState<TrxType | ''>('');
  const [word, setWord] = useState('');
  const [ym, setYm] = useState('');
  const all = d.rows.filter((r) => r.book_id === bookId);
  const months = [...new Set(all.map((r) => r.date?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse();
  const w = word.trim().toLowerCase();
  const rows = all
    .filter((r) => (!kind || r.type === kind) && (!ym || r.date?.startsWith(ym)))
    .filter((r) => !w || [r.explanation, r.receipt, names.line(r.line_id), names.heading(r.heading_id), names.party(r.party_id), String(r.n ?? '')].some((x) => (x ?? '').toLowerCase().includes(w)))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.n ?? 0) - (a.n ?? 0));
  return (
    <>
      <h1 style={{ margin: '6px 0' }}>{t('كل القيود', 'Records')} · {names.book(bookId)}</h1>
      <div className="cty-card cty-filters">
        <input placeholder={t('كلمة…', 'A word…')} value={word} onChange={(e) => setWord(e.target.value)} />
        <select value={ym} onChange={(e) => setYm(e.target.value)}>
          <option value="">{t('كل الأشهر', 'All months')}</option>
          {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as TrxType | '')}>
          <option value="">{t('كل الأنواع', 'All kinds')}</option>
          {(['Exp', 'Income', 'Transfer', 'Exchange'] as TrxType[]).map((k) => <option key={k} value={k}>{tx(TYPE_LABEL[k])}</option>)}
        </select>
      </div>
      <div className="cty-card">
        <div className="cty-label">{rows.length} {t('قيداً', 'records')}</div>
        {rows.slice(0, 300).map((r) => <RowLine key={r.id} r={r} icon={icons.line(r.line_id)} line={names.line(r.line_id)} onOpen={() => onEntry(r)} />)}
        {rows.length > 300 && <p className="muted small">{t('اكتب كلمة أو اختر شهراً لترى الباقي.', 'Type a word or choose a month to see the rest.')}</p>}
      </div>
    </>
  );
}
