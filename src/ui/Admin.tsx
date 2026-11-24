// Month closing (two steps), backups, users, permission profiles, audit log, server.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import type { AccessRow, AuditRow, BackupFile } from '../ops';
import { tx } from '../i18n';
import { Field, Modal, Tabs, biName, confirmBox, errText, fmtSyp, fmtUsd, parseAmount, promptBox, t, toast } from './kit';
import type { CashCountRow } from '../ops';
import { ServerTab } from './ServerTab';
import { MonthReport } from './MonthReport';
import { CompareModal } from './Compare';
import { DbCard, OwnBrand } from './Landing';
import { CENTRES, RECEIPT_TITLE_AR, brandStyle, type CentreKey } from '../brand';
import { mainListApi, serverRestoreUpload } from '../net';
import { MainListPanel } from './MainListPanel';
import { pickFile, saveFile, toBase64 } from '../platform';
import type { ImportReport } from '../io/importWorkbook';
import { MigrationReport } from './Welcome';
import { pickDatabaseFile } from '../io/dbFile';
import { serverCopyPassword, serverStatus } from '../net';
import { notesOf } from './Cash';
import { GuideLink } from '../guide/GuideView';
import { Checks } from './Checks';
import { Phones } from './Phones';
import { Users } from './People';
import { holdsControlsOf, peopleDoor } from '../roles';

type Tab = 'start' | 'months' | 'checks' | 'controls' | 'backups' | 'users' | 'look' | 'audit' | 'lists' | 'sections' | 'server';

export function Admin() {
  const { s, d, can, myBooks, reload } = useApp();
  // the budget lists live in the Coordinator; a server with no sign-in directory yet (so no Coordinator) keeps them here,
  // for whoever manages the users on the server computer itself
  const [listsHere, setListsHere] = useState(false);
  useEffect(() => {
    if (s.mode === 'server' && can('lists.manage')) mainListApi.lists().then((x) => setListsHere(x.admin && !x.dir)).catch(() => setListsHere(false));
  }, [s]);
  const tabs: { value: Tab; label: string; hidden?: boolean }[] = [
    // starting from the Excel workbook: only while the register is empty (moved here from "Export", 25 November 2026)
    { value: 'start', label: t('البدء من ملف Excel', 'Start from the Excel workbook'), hidden: !(can('data.import') && !d.rows.length) },
    { value: 'months', label: t('إغلاق الأشهر', 'Month closing'), hidden: !(can('month.close') || can('month.reopen') || (can('book.own') && myBooks.length > 0)) },
    { value: 'checks', label: t('التحقق قبل الإغلاق', 'Checks before closing'), hidden: !(can('lists.donors') || can('budget.view') || can('month.close')) },
    { value: 'controls', label: t('الضوابط', 'Controls'), hidden: !holdsControlsOf(s.profile, can('users.manage')) },
    { value: 'backups', label: t('النسخ الاحتياطية', 'Backups'), hidden: !(can('data.backup') || can('data.restore') || (can('data.export') && s.mode === 'server')) || s.mode === 'preview' },
    // (Fouad, 25 November 2026) the people and their roles live in the door "Administration"; here stays the Accountant's
    // small window (book holders) and one's own password, for whoever has not that door
    { value: 'users', hidden: peopleDoor(s.profile.roles, can), label: can('users.manage') ? t('المستخدمون', 'Users') : can('users.holders') ? t('أمناء الصناديق', 'Book holders') : can('users.passwords') ? t('كلمات السر', 'Passwords') : t('كلمة السر', 'Password') },
    { value: 'look', label: t('المظهر', 'Appearance'), hidden: true },
    { value: 'audit', label: t('سجل التعديلات', 'Audit log'), hidden: !can('audit.view') },
    { value: 'lists', label: t('قوائم الموازنة', 'Budget lists'), hidden: !listsHere },
    { value: 'sections', label: t('الأقسام', 'Sections'), hidden: true },
    { value: 'server', label: t('الخادم', 'Server'), hidden: s.mode !== 'server' || !(can('data.backup') || holdsControlsOf(s.profile, can('users.manage'))) },
  ];
  const [tab, setTab] = useState<Tab>(tabs.find((x) => !x.hidden)!.value);
  return (
    <>
      <div className="page-head"><h1>{t('الإعدادات', 'Settings')}<GuideLink id={tab === 'months' || tab === 'controls' || tab === 'checks' ? 'months' : 'admin'} /></h1></div>
      {s.mode === 'desktop' && <p className="muted small ltr" style={{ textAlign: 'start' }}>{s.dbPath}</p>}
      <Tabs trail value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'start' && can('data.import') && !d.rows.length && <StartFromWorkbook />}
      {tab === 'months' && <Months />}
      {tab === 'checks' && <Checks />}
      {tab === 'controls' && holdsControlsOf(s.profile, can('users.manage')) && <Controls />}
      {tab === 'backups' && <Backups />}
      {tab === 'users' && <Users />}
      {tab === 'users' && <Phones />}
      {tab === 'look' && can('users.manage') && <Appearance />}
      {tab === 'audit' && can('audit.view') && <Audit />}
      {tab === 'lists' && listsHere && <MainListPanel dbs={[]} onReload={reload} />}
      {tab === 'sections' && can('lists.manage') && <Sections />}
      {tab === 'server' && s.mode === 'server' && <ServerTab />}
    </>
  );
}

// ---------------------------------------------------------------- start from the Excel workbook (an empty register only)

function StartFromWorkbook() {
  const { s, d, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const [seedReport, setSeedReport] = useState<ImportReport | null>(null);
  const doSeed = async () => {
    if (d.rows.length) return toast(t('السجل ليس فارغاً', 'The register is not empty'), true);
    if (!(await confirmBox(t('ستحل قوائم ملف Excel محل القوائم الحالية. متابعة؟', "The workbook's lists will replace the current lists. Continue?")))) return;
    const f = await pickFile(['xlsx'], t('اختر ملف Excel', 'Choose the Excel workbook'));
    if (!f) return;
    setBusy(true);
    try {
      setSeedReport(await s.api.call('workbook.import', { base64: toBase64(f.bytes), fileName: f.name }));
      await reload();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <h2>{t('البدء من ملف Excel', 'Start from the Excel workbook')}</h2>
      <p className="muted small">{t('لا يظهر هذا إلا والسجل فارغ.', 'This shows only while the register is empty.')}</p>
      <button className="btn" disabled={busy} onClick={doSeed}>{t('استيراد Master Sup / Master Com…', 'Import Master Sup / Master Com…')}</button>
      {seedReport && <div style={{ marginTop: 12 }}><MigrationReport r={seedReport} /></div>}
    </div>
  );
}

// ---------------------------------------------------------------- sections: which parts of the program this centre uses

function Sections() {
  const { s, d, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const set = async (section: 'hosting' | 'inventory', on: boolean) => {
    setBusy(true);
    try { await s.api.call('host.section', { section, on }); await reload(); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const hostOn = !!d.host?.on;
  const invOn = d.host ? d.host.inventoryOn : true;
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>{t('أقسام هذا المركز', 'Sections of this centre')}</h3>
      <p className="small muted">{t('كل مركز يختار ما يحتاجه. إيقاف قسم يخفيه من القائمة، ولا يمحو شيئاً.', 'Each centre chooses what it needs. Switching a section off hides it from the menu; nothing is erased.')}</p>
      <label style={{ display: 'block', margin: '8px 0' }}><input type="checkbox" disabled={busy} checked={invOn} onChange={(e) => void set('inventory', e.target.checked)} /> <b>{t('الجرد', 'Inventory')}</b> — {t('الأغراض والأماكن والعدّ', 'items, places, counts')}</label>
      <label style={{ display: 'block', margin: '8px 0' }}><input type="checkbox" disabled={busy} checked={hostOn} onChange={(e) => void set('hosting', e.target.checked)} /> <b>{t('الإقامة والتقويم', 'Accommodation and calendar')}</b> — {t('المباني والغرف والحجوزات والأنشطة والدفعات', 'buildings, rooms, bookings, events, payments')}</label>
      <h3>{t('قائمة المزرعة (الأرض)', "The farm's list (Al-Ard)")}</h3>
      <p className="small muted">{t('بنود وخطوط أولية لمزرعة: مبيعات زراعية، مخيمات، مصاريف تشغيلية. تُعدَّل لاحقاً. ما هو موجود يبقى كما هو.', 'A first list of headings and lines for a farm: farm sales, camps, running costs. Changed later as needed; what already exists is left alone.')}</p>
      <button className="btn small" disabled={busy} onClick={async () => {
        if (!(await confirmBox(t('أضف بنود وخطوط المزرعة إلى هذه القاعدة؟', "Add the farm's headings and lines to this database?")))) return;
        setBusy(true);
        try { const r = await s.api.call('host.farm.seed'); await reload(); toast(`${r.headings} ${t('بنداً', 'headings')} · ${r.lines} ${t('خطاً', 'lines')}`); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
      }}>{t('أضف قائمة المزرعة', "Add the farm's list")}</button>
      {hostOn && <p className="small muted">{t('من يرى ماذا: في «الأدوار والصلاحيات» (الإقامة والتقويم). الأسعار لمن أُعطي «يرى الأسعار والدفعات» (أو «يمسك التقويم») فقط.', 'Who sees what: in "Roles and permissions" (Hosting and calendar). Only roles given "Sees and sets the prices and the payments" (or "Keeps the calendar") see the prices.')}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- months: step 1 per book, step 2 office

function Months() {
  const { s, d, reload, can, myBooks, limited } = useApp();
  const books = useMemo(
    () => d.lists.books.filter((b) => !b.is_main && b.parent_id == null && (limited ? myBooks.includes(b.id) : true) && d.rows.some((r) => r.book_id === b.id)), // (an envelope closes with its book)
    [d, limited, myBooks],
  );
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const r of d.rows) if (r.date) set.add(r.date.slice(0, 7));
    return [...set].sort().reverse();
  }, [d.rows]);
  const used = (bookId: number, ym: string) => d.rows.some((r) => r.book_id === bookId && r.date?.startsWith(ym));
  const mayCloseBook = (bookId: number) => myBooks.includes(bookId) || (can('month.close') && (can('register.edit') || can('register.view')));

  const run = async (f: () => Promise<unknown>, ok: string) => {
    try {
      await f();
      await reload();
      toast(ok);
    } catch (e) {
      toast(errText(e), true);
    }
  };

  const [closing, setClosing] = useState<{ bookId: number; ym: string } | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const closeBook = async (bookId: number, ym: string) => {
    const problems = await s.api.call('closing.problems', { ym, bookId });
    if (problems.length) return toast(problems.map(tx).join(' · '), true);
    setClosing({ bookId, ym }); // the cash count comes first
  };
  const closeOffice = async (ym: string) => {
    const problems = await s.api.call('closing.problems', { ym, bookId: null });
    if (problems.length) return toast(problems.map(tx).join(' · '), true);
    if (!(await confirmBox(t(`إغلاق الشهر ${ym} للمركز كله؟ بعدها لا يغيّر أحد شيئاً؛ الرئيس وحده يعيد الفتح.`, `Close ${ym} for the whole centre? After that nobody changes anything; only the Superior can reopen.`)))) return;
    await run(() => s.api.call('month.close', { ym }), t('أُغلق الشهر', 'Month closed'));
  };

  // years: closed once every month with rows is closed and the year is over
  const years = [...new Set(months.map((x) => Number(x.slice(0, 4))))].sort().reverse();
  const thisYear = new Date().getFullYear();
  const yearBar = !limited && years.length > 0 && (
    <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
      {years.map((y) => {
        const closedY = d.closedYears.has(y);
        const allClosed = months.filter((x) => x.startsWith(String(y))).every((x) => d.closed.has(x));
        return (
          <span key={y} className="pill" style={{ padding: '4px 10px' }}>
            {y}: {closedY ? `🔒 ${t('السنة مغلقة', 'year closed')}` : allClosed && y < thisYear ? t('كل الأشهر مغلقة', 'all months closed') : t('مفتوحة', 'open')}{' '}
            {!closedY && allClosed && y < thisYear && can('month.close') && (
              <button className="btn small primary" onClick={async () => (await confirmBox(t(`إغلاق سنة ${y}؟ تبقى الأرصدة كما هي وتستمر في ${y + 1}.`, `Close the year ${y}? Balances stay as they are and carry on into ${y + 1}.`))) && run(() => s.api.call('year.close', { year: y }), t('أُغلقت السنة', 'Year closed'))}>
                {t('إغلاق السنة', 'Close the year')}
              </button>
            )}
            {closedY && can('month.reopen') && (
              <button className="btn small ghost" onClick={async () => (await confirmBox(t(`إعادة فتح سنة ${y}؟`, `Reopen the year ${y}?`))) && run(() => s.api.call('year.reopen', { year: y }), t('أعيد الفتح', 'Reopened'))}>↺</button>
            )}
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="panel">
      {yearBar}
      <p className="muted small">
        {t('١ — كل أمين يغلق شهر دفتره بعد عدّ نقده. ٢ — ثم يغلق المكتب الشهر كله. الرئيس وحده يعيد الفتح.',
          '1 — Each holder closes his book\'s month after counting his cash. 2 — Then the office closes the whole month. Only the Superior can reopen.')}
      </p>
      <div className="tbl-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>{t('الشهر', 'Month')}</th>
              {books.map((b) => <th key={b.id} className="center">{b.name}</th>)}
              {!limited && <th className="center">{t('المكتب', 'Office')}</th>}
              {!limited && <th />}
            </tr>
          </thead>
          <tbody>
            {months.map((ym) => {
              const office = d.closed.has(ym);
              return (
                <tr key={ym}>
                  <td className="ltr nowrap">{ym}</td>
                  {books.map((b) => {
                    if (!used(b.id, ym)) return <td key={b.id} className="center muted">—</td>;
                    const closed = d.bookClosed.has(`${b.id}|${ym}`);
                    const bm = d.bookMonths.find((x) => x.book_id === b.id && x.ym === ym);
                    const diff = bm && bm.counted_syp != null ? { syp: (bm.counted_syp ?? 0) - (bm.book_syp ?? 0), usd: (bm.counted_usd ?? 0) - (bm.book_usd ?? 0) } : null;
                    const differs = diff && (Math.abs(diff.syp) >= 0.5 || Math.abs(diff.usd) >= 0.005);
                    return (
                      <td key={b.id} className="center nowrap">
                        {closed ? <span className="ok" title={bm?.counted_syp != null ? `${t('معدود', 'counted')}: ${fmtSyp(bm.counted_syp)} SYP · ${fmtUsd(bm.counted_usd ?? 0)} USD` : ''}>🔒</span> : <span className="muted">{t('مفتوح', 'open')}</span>}
                        {differs && <span className="bad small" title={bm?.count_note ?? ''}> Δ {diff!.syp ? `${fmtSyp(diff!.syp)} SYP` : ''}{diff!.usd ? ` ${fmtUsd(diff!.usd)} USD` : ''}</span>}{' '}
                        {!closed && !office && mayCloseBook(b.id) && <button className="btn small" onClick={() => closeBook(b.id, ym)}>{t('إغلاق', 'Close')}</button>}
                        {closed && !office && can('month.reopen') && (
                          <button className="btn small ghost" onClick={() => run(() => s.api.call('bookMonth.reopen', { bookId: b.id, ym }), t('أعيد الفتح', 'Reopened'))}>↺</button>
                        )}
                      </td>
                    );
                  })}
                  {!limited && (
                    <td className="center nowrap">
                      {office ? <span className="ok">🔒 {t('مغلق', 'closed')}</span> : <span className="muted">{t('مفتوح', 'open')}</span>}{' '}
                      {!office && can('month.close') && <button className="btn small primary" onClick={() => closeOffice(ym)}>{t('إغلاق الشهر', 'Close month')}</button>}
                      {office && can('month.reopen') && (
                        <button className="btn small" onClick={async () => (await confirmBox(t(`إعادة فتح ${ym}؟`, `Reopen ${ym}?`))) && run(() => s.api.call('month.reopen', { ym }), t('أعيد الفتح', 'Reopened'))}>
                          {t('إعادة فتح', 'Reopen')}
                        </button>
                      )}
                    </td>
                  )}
                  {!limited && <td><button className="btn small ghost" onClick={() => setReport(ym)}>📄 {t('التقرير', 'Report')}</button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {report && <MonthReport ym={report} onClose={() => setReport(null)} />}
      {closing && <CloseBook {...closing} onClose={() => setClosing(null)} onDone={async () => { setClosing(null); await reload(); toast(t('أُغلق', 'Closed')); }} />}
    </div>
  );
}

/** Step 1: the holder counts his cash; a difference with the book is explained, then the month is closed. */
function CloseBook({ bookId, ym, onClose, onDone }: { bookId: number; ym: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { s, d } = useApp();
  const name = d.lists.books.find((b) => b.id === bookId)?.name;
  const [bal, setBal] = useState<{ syp: number; usd: number } | null>(null);
  const [syp, setSyp] = useState('');
  const [usd, setUsd] = useState('');
  const [note, setNote] = useState('');
  const [fromCount, setFromCount] = useState<string | null>(null);
  // the cash counted note by note, right here (Fouad, 21 October 2026): the totals below follow it
  const [q, setQ] = useState<Record<string, string>>({});
  const noteQty = (cur: 'SYP' | 'USD', den: number) => parseAmount(q[`${cur}${den}`] ?? '') || 0;
  const NOTES = notesOf(d.lists.settings);
  const noteTot = (cur: 'SYP' | 'USD') => NOTES[cur].reduce((n, den) => n + den * noteQty(cur, den), 0);
  const byNotes = Object.values(q).some((v) => (parseAmount(v) || 0) > 0);
  useEffect(() => {
    s.api.call('bookMonth.balance', { bookId, ym }).then(setBal).catch((e) => toast(errText(e), true));
    // the last note-by-note count of this book, if any, fills the boxes
    s.api.call('cash.counts').then((rows: CashCountRow[]) => {
      const mine = rows.filter((r) => r.book_id === bookId);
      if (!mine.length) return;
      // the book's last count fills the grid (he checks it, corrects it, or counts again)
      const o: Record<string, string> = {};
      for (const r of mine) if (r.qty) o[`${r.currency}${r.denomination}`] = String(r.qty);
      setQ(o);
      setFromCount(mine[0].counted_at?.slice(0, 10) ?? null);
    }).catch(() => undefined);
  }, [s, bookId, ym]);
  const cs = byNotes ? noteTot('SYP') : parseAmount(syp), cu = byNotes ? noteTot('USD') : parseAmount(usd);
  const ready = byNotes || (syp.trim() !== '' && usd.trim() !== '');
  const dSyp = bal && ready ? cs - bal.syp : 0;
  const dUsd = bal && ready ? cu - bal.usd : 0;
  const differs = Math.abs(dSyp) >= 0.5 || Math.abs(dUsd) >= 0.005;
  const noteList = () => (['SYP', 'USD'] as const).flatMap((currency) => NOTES[currency].map((denomination) => ({ currency, denomination, qty: noteQty(currency, denomination) })));
  /** keep the count without closing (to finish later, or to look at it on the Cash page) */
  const saveOnly = async () => {
    // a count saved by hand goes into the history of the book: ask first (closing itself saves its count without asking)
    if (!(await confirmBox(t(`حفظ هذا العدّ في سجل دفتر «${name}»؟ يبقى مسجّلاً بتاريخه وساعته واسمك، ولا يُمحى.`, `Save this count in the history of the book "${name}"? It stays recorded with its date, hour and your name, and cannot be erased.`)))) return;
    try {
      await s.api.call('cash.saveCount', { bookId, counts: noteList() });
      setFromCount(new Date().toISOString().slice(0, 10));
      toast(t('حُفظ العدّ', 'Count saved'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const go = async () => {
    try {
      const counts = byNotes
        ? (['SYP', 'USD'] as const).flatMap((currency) => NOTES[currency].map((denomination) => ({ currency, denomination, qty: noteQty(currency, denomination) })).filter((x) => x.qty > 0))
        : undefined;
      await s.api.call('bookMonth.close', { bookId, ym, counted_syp: cs, counted_usd: cu, note: note.trim() || null, counts });
      await onDone();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <Modal title={t(`إغلاق ${ym} — ${name}`, `Close ${ym} — ${name}`)} onClose={onClose}>
      <p className="muted">{t('عُدّ النقد الموجود فعلاً واكتبه. إن اختلف عن الدفتر فاكتب السبب. بعد الإغلاق لا تعديل.', 'Count the cash really there and write it. If it differs from the book, write why. After closing, no more changes.')}</p>
      <table className="t">
        <thead><tr><th /><th className="n">SYP</th><th className="n">USD</th></tr></thead>
        <tbody>
          <tr><td>{t(`الدفتر في نهاية ${ym}`, `The book at the end of ${ym}`)}</td><td className="n">{bal ? fmtSyp(bal.syp) : '…'}</td><td className="n">{bal ? fmtUsd(bal.usd) : '…'}</td></tr>
          <tr>
            <td>{t('النقد المعدود', 'Cash counted')}{byNotes && fromCount && <div className="muted small">{t('من عدّك في', 'from your count of')} {fromCount}</div>}</td>
            <td className="n">{byNotes ? <b>{fmtSyp(cs)}</b> : <input className="ltr num" inputMode="decimal" value={syp} onChange={(e) => setSyp(e.target.value)} style={{ width: 140 }} />}</td>
            <td className="n">{byNotes ? <b>{fmtUsd(cu)}</b> : <input className="ltr num" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} style={{ width: 110 }} />}</td>
          </tr>
          {ready && bal && (
            <tr><td><b>{t('الفرق', 'Difference')}</b></td><td className={`n ${Math.abs(dSyp) >= 0.5 ? 'bad' : 'ok'}`}><b>{fmtSyp(dSyp)}</b></td><td className={`n ${Math.abs(dUsd) >= 0.005 ? 'bad' : 'ok'}`}><b>{fmtUsd(dUsd)}</b></td></tr>
          )}
        </tbody>
      </table>
      <details className="count-grid" open={byNotes || undefined}>
        <summary>🧮 {t('عدّ النقد ورقة ورقة هنا', 'Count the cash note by note here')}</summary>
        <p className="muted small" style={{ margin: '6px 0' }}>{t('اكتب عدد كل فئة؛ يملأ المجموع تلقائياً، ويُحفظ العدّ مع هذا الشهر.', 'Write how many of each note; the total fills in by itself, and the count is kept with this month.')}</p>
        <div className="notes-grid">
          {(['SYP', 'USD'] as const).map((cur) => (
            <table className="t" key={cur}>
              <thead><tr><th className="n">{cur === 'SYP' ? t('الفئة ل.س', 'SYP note') : t('الفئة $', 'USD note')}</th><th className="n">{t('العدد', 'How many')}</th><th className="n">{t('المجموع', 'Total')}</th></tr></thead>
              <tbody>
                {NOTES[cur].map((den) => (
                  <tr key={den}>
                    <td className="n">{den.toLocaleString('en-US')}</td>
                    <td style={{ width: 90 }}><input className="inp num" inputMode="numeric" value={q[`${cur}${den}`] ?? ''} onChange={(e) => setQ({ ...q, [`${cur}${den}`]: e.target.value })} /></td>
                    <td className="n">{(cur === 'SYP' ? fmtSyp : fmtUsd)(den * noteQty(cur, den))}</td>
                  </tr>
                ))}
                <tr className="total"><td>{t('المجموع', 'Total')}</td><td /><td className="n"><b>{(cur === 'SYP' ? fmtSyp : fmtUsd)(noteTot(cur))}</b></td></tr>
              </tbody>
            </table>
          ))}
        </div>
      </details>
      {ready && differs && (
        <Field label={t('لماذا يختلف؟ (يُحفظ مع الشهر)', 'Why does it differ? (kept with the month)')}>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        {byNotes && <button className="btn" onClick={saveOnly} title={t('يحفظ العدّ دون إغلاق الشهر', 'Keeps the count without closing the month')}>💾 {t('احفظ العدّ', 'Save the count')}</button>}
        <button className="btn primary" disabled={!bal || !ready || (differs && !note.trim())} onClick={go}>🔒 {t('إغلاق الشهر لهذا الدفتر', 'Close the month for this book')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- controls (the Superior's rules)

function Controls() {
  const { s, d, reload } = useApp();
  const S = d.lists.settings;
  const [doc, setDoc] = useState(String(S.doc_required_usd));
  const [on, setOn] = useState(!!S.approval_on);
  const [amount, setAmount] = useState(String(S.approval_usd));
  const [who, setWho] = useState<number | null>(S.approval_profile_id);
  const [profiles, setProfiles] = useState<AccessRow[]>([]);
  useEffect(() => {
    s.api.call('access.list').then(setProfiles).catch(() => undefined);
  }, [s]);
  const save = async () => {
    try {
      await s.api.call('settings.save', { doc_required_usd: parseAmount(doc) || 0, approval_on: on ? 1 : 0, approval_usd: parseAmount(amount) || 0, approval_profile_id: who });
      await reload();
      toast(t('حُفظ', 'Saved'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="grid2">
      <div className="panel">
        <h3>📎 {t('المستندات', 'Documents')}</h3>
        <p className="muted small">{t('كل نفقة من هذا المبلغ (بالدولار، كل العملات محسوبة) تحتاج مستندها الممسوح. لا يُغلق الشهر قبل ذلك. 0 = بلا قاعدة.', 'Every expense from this amount (in USD, all currencies counted) needs its scanned document. The month cannot close before. 0 = no rule.')}</p>
        <Field label={t('من مبلغ ($)', 'From the amount ($)')}><input className="ltr" inputMode="decimal" value={doc} onChange={(e) => setDoc(e.target.value)} style={{ width: 140 }} /></Field>
      </div>
      <div className="panel">
        <h3>✓ {t('الموافقة على النفقات الكبيرة', 'Approval of large expenses')}</h3>
        <label className="row"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> {t('مفعّلة', 'On')}</label>
        <div className="grid2" style={{ opacity: on ? 1 : 0.5 }}>
          <Field label={t('من مبلغ ($)', 'From the amount ($)')}><input className="ltr" inputMode="decimal" disabled={!on} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={t('يوافق', 'Approved by')}>
            <select className="inp" disabled={!on} value={who ?? ''} onChange={(e) => setWho(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('من يدير المستخدمين (الرئيس)', 'Whoever manages users (the Superior)')}</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{biName(p.name)}</option>)}
            </select>
          </Field>
        </div>
        <p className="muted small">{t('تُسجَّل النفقة ثم تنتظر الموافقة؛ لا يُغلق الشهر قبلها. تغيير المبلغ بعد الموافقة يلغيها.', 'The expense is recorded, then waits for approval; the month cannot close before. Changing the amount after approval cancels it.')}</p>
      </div>
      <div className="span2 modal-foot"><button className="btn primary" onClick={save}>{t('احفظ', 'Save')}</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- backups

/**
 * The copy password (Fouad, 21 November 2026): the owner decides it, once. Every copy that leaves the server (the
 * downloaded one, the one sent to the mirror folder) is protected with it; whoever downloads does not choose it.
 */
function CopyPassword() {
  const { s: me, can } = useApp();
  const mayControl = holdsControlsOf(me.profile, can('users.manage'));
  type St = { copyProtected: boolean; copyProtectedAt: string | null; copyProtectedBy: string | null; local: boolean };
  const [st, setSt] = useState<St | null>(null);
  const load = () => serverStatus<St>().then(setSt).catch(() => setSt(null));
  useEffect(() => { void load(); }, []);
  if (!st) return null;
  const set = async (forgot = false) => {
    // changing it asks the old one (a signed-in session alone is not enough)
    let oldPassword: string | undefined;
    if (st.copyProtected && !forgot) {
      const o = await promptBox(t('كلمة سر النسخ الحالية (القديمة)', 'The current (old) copy password'), '', true);
      if (!o) return;
      oldPassword = o;
    }
    if (forgot && !(await confirmBox(t('نسيت الكلمة؟ تُستبدل الآن بأخرى، لكن النسخ المحمية القديمة لا تُفتح إلا بكلمتها القديمة: إن ضاعت فلا سبيل إلى فتحها. أتابع؟', 'Forgotten? It is replaced now, but the old protected copies open only with their old password: if it is lost there is no way to open them. Continue?'), true))) return;
    const a = await promptBox(t('كلمة سر النسخ (10 أحرف على الأقل). احفظها في مكان آمن: بدونها لا يفتح أحد النسخ المحمية.', 'The copy password (at least 10 characters). Keep it in a safe place: without it nobody can open the protected copies.'), '', true);
    if (!a) return;
    const b = await promptBox(t('اكتبها مرة ثانية', 'Write it again'), '', true);
    if (a !== b) return toast(t('الكلمتان مختلفتان', 'The two are not the same'), true);
    try {
      await serverCopyPassword(a, { oldPassword, forgot });
      toast(t('حُفظت كلمة سر النسخ ✓', 'Copy password saved ✓'));
      await load();
    } catch (e) { toast(errText(e), true); }
  };
  return (
    <div className="panel" style={{ background: st.copyProtected ? '#f3faf4' : '#fff8ec', margin: '8px 0 12px' }}>
      <b>{st.copyProtected ? '🔒 ' : '⚠ '}{t('كلمة سر النسخ', 'The copy password')}</b>
      <p className="small" style={{ margin: '4px 0' }}>
        {st.copyProtected
          ? t(`محدَّدة (${st.copyProtectedBy ?? ''}، ${(st.copyProtectedAt ?? '').slice(0, 10)}). كل نسخة تغادر الخادم (التي تُنزَّل، وتلك المرسلة إلى المجلد الاحتياطي) محمية بها. لا يعرفها الخادم: يحتفظ بمفتاح مشتق منها فقط.`, `Set (${st.copyProtectedBy ?? ''}, ${(st.copyProtectedAt ?? '').slice(0, 10)}). Every copy that leaves the server (the downloaded one, the one sent to the mirror folder) is protected with it. The server does not know it: it keeps only a key derived from it.`)
          : t('لم تُحدَّد بعد. حتى تُحدَّد لا يمكن تنزيل نسخة، والنسخ المرسلة إلى المجلد الاحتياطي غير محمية.', 'Not set yet. Until it is set, no copy can be downloaded, and the copies sent to the mirror folder are not protected.')}
      </p>
      <p className="muted small" style={{ margin: '4px 0' }}>{t('إن ضاعت الكلمة لا يستطيع أحد فتح النسخ المحمية. غيّرها فتحمي النسخ الجديدة بها (القديمة تبقى بكلمتها القديمة).', 'If the password is lost, nobody can open the protected copies. Changing it protects the new copies with the new one (the old ones keep their old password).')}</p>
      {mayControl ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => void set()}>{st.copyProtected ? t('غيّر كلمة السر (تحتاج القديمة)', 'Change the password (needs the old one)') : t('حدّد كلمة سر النسخ', 'Set the copy password')}</button>
          {st.copyProtected && st.local && <button className="btn ghost small" onClick={() => void set(true)}>{t('نسيتُ القديمة', 'I forgot the old one')}</button>}
        </div>
      ) : <p className="muted small">{t('يحدّدها من يدير المستخدمين (الرئيس).', 'It is set by whoever manages the users (the Superior).')}</p>}
      {st.copyProtected && !st.local && mayControl && <p className="muted small" style={{ margin: '4px 0 0' }}>{t('نسيتَ الكلمة القديمة؟ تُستبدل من حاسوب الخادم نفسه فقط.', 'Forgot the old one? It can be replaced on the server computer itself only.')}</p>}
    </div>
  );
}

function Backups() {
  const { s, reload, can } = useApp();
  const [list, setList] = useState<BackupFile[]>([]);
  const [comparing, setComparing] = useState<BackupFile | null>(null);
  const refresh = () => (can('data.backup') || can('data.restore') ? s.api.call('backup.list').then(setList).catch((e) => toast(errText(e), true)) : Promise.resolve());
  // a copy to send by mail (Fouad, 14 November 2026): a fresh one, or one from the list; saved where the person chooses
  const download = async (b?: BackupFile) => {
    try {
      const r = await s.api.call('backup.download', { name: b?.name ?? null });
      const bytes = Uint8Array.from(atob(r.base64), (ch) => ch.charCodeAt(0));
      const label = (s.organisation || 'magis').replace(/[^\w\u0600-\u06FF -]/g, '').trim().replace(/\s+/g, '-');
      const name = `${label}_${r.name}`;
      await saveFile(name, ['magisbak'], bytes, t('احفظ النسخة', 'Save the copy'));
      if (!b) await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const now = async () => {
    try {
      const p = await s.api.call('backup.now');
      toast(t('نسخة احتياطية', 'Backup') + ': ' + (p ?? ''));
      await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const restore = async (b: BackupFile) => {
    if (!(await confirmBox(t(`استبدال قاعدة البيانات الحالية بالنسخة:\n${b.name}\n\nتُؤخذ نسخة من الحالية أولاً.`, `Replace the current database with:\n${b.name}\n\nA copy of the current one is taken first.`), true))) return;
    try {
      await s.api.call('backup.restore', { path: b.path });
      if (s.mode === 'server') return window.location.reload();
      await reload();
      await refresh();
      toast(t('استُرجعت النسخة', 'Backup restored'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  // Server only: replace the data by a .db file from this computer (desktop app file or a backup copy).
  const fromFile = async () => {
    const f = await pickDatabaseFile(t('اختر ملف قاعدة البيانات', 'Choose the database file'));
    if (!f) return;
    if (!(await confirmBox(
      t(`استبدال كل بيانات الخادم بالملف:\n${f.name}\n\nتُؤخذ نسخة من الحالية أولاً، ثم يخرج الجميع ويدخلون من جديد.`,
        `Replace ALL the server's data with the file:\n${f.name}\n\nA copy of the current data is taken first; then everybody logs in again.`),
      true,
    ))) return;
    try {
      await serverRestoreUpload(toBase64(f.bytes), f.name);
      window.location.reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <p className="muted small" style={{ margin: 0 }}>{t('نسخة كل يوم، ونسخة قبل كل استيراد أو استرجاع. «مقارنة» تُظهر ما تغيّر منذ النسخة، وتعيد سطراً واحداً كما كان.', 'One copy every day, and one before every import or restore. "Compare" shows what changed since the copy, and puts one row back as it was.')}</p>
        <div className="row">
          {s.mode === 'server' && can('data.restore') && <button className="btn" onClick={fromFile}>{t('استرجاع من ملف…', 'Restore from a file…')}</button>}
          {s.mode === 'server' && can('data.download') && <button className="btn" onClick={() => void download()}>⬇ {t('نزّل آخر نسخة (لإرسالها)', 'Download the latest copy (to send)')}</button>}
          {can('data.backup') && <button className="btn primary" onClick={now}>{t('نسخة الآن', 'Back up now')}</button>}
        </div>
      </div>
      {s.mode === 'server' && <p className="muted small" style={{ marginTop: 0 }}>{t('«نزّل آخر نسخة» يأخذ نسخة الآن ويحفظها حيث تختار، لترسلها بالبريد. النسخة محمية بكلمة سر النسخ، وتُسجَّل في سجل التدقيق. الصور والمستندات المرفقة ليست فيها.', '"Download the latest copy" takes a copy now and saves it where you choose, to send it by mail. The copy is protected by the copy password, and the download is written in the audit trail. The attached photos and documents are not in it.')}</p>}
      {s.mode === 'server' && <CopyPassword />}
      <table className="t">
        <thead><tr><th>{t('الملف', 'File')}</th><th>{t('التاريخ', 'Date')}</th><th className="n">KB</th><th /></tr></thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.path}><td className="code">{b.name}</td><td className="ltr">{new Date(b.modified).toLocaleString('en-GB')}</td><td className="n">{Math.round(b.size / 1024)}</td>
              <td className="right nowrap">
                {s.mode === 'server' && <button className="btn small" onClick={() => void download(b)} title={t('تنزيل', 'Download')}>⬇</button>}{' '}
                {can('data.restore') && <button className="btn small primary" onClick={() => setComparing(b)}>⇄ {t('مقارنة', 'Compare')}</button>}{' '}
                {can('data.restore') && <button className="btn small" onClick={() => restore(b)}>{t('استرجاع', 'Restore')}</button>}
              </td></tr>
          ))}
        </tbody>
      </table>
      {comparing && <CompareModal backup={comparing} onClose={() => setComparing(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- appearance: name, centre, own colour and logo

function Appearance() {
  const { s } = useApp();
  const [b, setB] = useState<{ organisation: string; centre: string; color: string | null; logo: string | null; receipt_title: string | null } | null>(null);
  const [rt, setRt] = useState('');
  const [own, setOwn] = useState(false);
  const [color, setColor] = useState('#2E7D32');
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    s.api.call('brand.get').then((x) => {
      setB(x);
      setRt(x.receipt_title ?? RECEIPT_TITLE_AR[x.centre] ?? '');
      setOwn(!!(x.color || x.logo));
      if (x.color) setColor(x.color);
      setLogo(x.logo);
    });
  }, [s.api]);
  if (!b) return <p className="muted">…</p>;
  const preview = { slug: '', organisation: b.organisation, centre: b.centre, color: own ? color : null, logo: own ? logo : null, setupNeeded: false };
  const save = async () => {
    try {
      await s.api.call('brand.save', { organisation: b.organisation, centre: b.centre, color: own ? color : null, logo: own ? logo : null, receipt_title: rt.trim() === (RECEIPT_TITLE_AR[b.centre] ?? '') ? null : rt });
      toast(t('حُفظ — يُعاد فتح البرنامج', 'Saved — reopening the program'));
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <Field label={t('اسم قاعدة البيانات', 'Name of the database')}><input value={b.organisation} onChange={(e) => setB({ ...b, organisation: e.target.value })} /></Field>
      <Field label={t('عنوان وصل الاستلام (تحت اسم المركز، بالعربية)', 'Title of the receipt (under the name, in Arabic)')}><input dir="rtl" value={rt} placeholder={RECEIPT_TITLE_AR[b.centre] ?? ''} onChange={(e) => setRt(e.target.value)} /></Field>
      <p className="small muted">{t('يُطبع تحت اسم المركز على وصل الاستلام في التقويم. اتركه فارغاً ليُستعمل العنوان المعتاد للمركز.', 'Printed under the name on the receipt in the calendar. Leave it empty to use the house\'s usual title.')}</p>
      <h3 style={{ marginTop: 16 }}>{t('المركز: لونه ورمزه', 'Centre: its colour and mark')}</h3>
      <div className="centre-pick">
        {(Object.keys(CENTRES) as CentreKey[]).map((k) => (
          <button key={k} type="button" className={!own && b.centre === k ? 'on' : ''} onClick={() => { setOwn(false); setB({ ...b, centre: k }); }}
            style={{ '--centre': CENTRES[k].color, '--centre-deep': CENTRES[k].deep } as React.CSSProperties}>
            <img src={CENTRES[k].mark ?? '/brand/magis-sun.png'} alt="" />
            <span>{tx(CENTRES[k].name)}</span>
          </button>
        ))}
        <button type="button" className={own ? 'on' : ''} onClick={() => setOwn(true)} style={{ '--centre': color, '--centre-deep': brandStyle({ centre: 'other', color }).deep } as React.CSSProperties}>
          {logo ? <img src={logo} alt="" /> : <span style={{ fontSize: 34, lineHeight: '56px', color }}>●</span>}
          <span>{t('شعار ولون خاصّان', 'Own logo & colour')}</span>
        </button>
      </div>
      {own && <OwnBrand color={color} setColor={setColor} logo={logo} setLogo={setLogo} />}
      <h3 style={{ marginTop: 16 }}>{t('معاينة', 'Preview')}</h3>
      <div style={{ maxWidth: 360 }}><DbCard db={preview} onOpen={() => undefined} /></div>
      <div className="modal-foot"><button className="btn primary" onClick={save}>{t('احفظ', 'Save')}</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- audit

function Audit() {
  const { s, d } = useApp();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [open, setOpen] = useState<AuditRow | null>(null);
  useEffect(() => {
    s.api.call('audit.list').then(setRows).catch(() => undefined);
  }, [s.api, d]);
  return (
    <div className="panel">
      <table className="t">
        <thead><tr><th>{t('متى', 'When')}</th><th>{t('من', 'Who')}</th><th>{t('ماذا', 'What')}</th><th>{t('الجدول', 'Table')}</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => setOpen(r)}>
              <td className="ltr nowrap">{r.at.slice(0, 19).replace('T', ' ')}</td><td>{r.who}</td><td>{r.action}</td><td>{r.tbl}</td><td className="code">{r.row_id?.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <Modal title={`${open.action} · ${open.tbl}`} onClose={() => setOpen(null)}>
          <div className="grid2">
            <div><h3>{t('قبل', 'Before')}</h3><pre className="code" style={{ whiteSpace: 'pre-wrap' }}>{open.before ? JSON.stringify(JSON.parse(open.before), null, 1) : '—'}</pre></div>
            <div><h3>{t('بعد', 'After')}</h3><pre className="code" style={{ whiteSpace: 'pre-wrap' }}>{open.after ? JSON.stringify(JSON.parse(open.after), null, 1) : '—'}</pre></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
