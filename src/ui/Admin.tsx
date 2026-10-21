// Month closing (two steps), backups, users, permission profiles, audit log, server.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import type { Profile } from '../auth';
import type { AccessRow, AuditRow, BackupFile, UserRow } from '../ops';
import { PERM_GROUPS, type Perm } from '../perms';
import { tx } from '../i18n';
import { Field, Modal, Tabs, biName, confirmBox, errText, fmtSyp, fmtUsd, parseAmount, t, toast } from './kit';
import type { CashCountRow } from '../ops';
import { ServerTab } from './ServerTab';
import { MonthReport } from './MonthReport';
import { CompareModal } from './Compare';
import { DbCard, OwnBrand } from './Landing';
import { CENTRES, brandStyle, type CentreKey } from '../brand';
import { serverRestoreUpload } from '../net';
import { pickFile, toBase64 } from '../platform';
import { NOTES } from './Cash';

type Tab = 'months' | 'controls' | 'backups' | 'users' | 'access' | 'look' | 'audit' | 'server';

export function Admin() {
  const { s, can, myBooks } = useApp();
  const tabs: { value: Tab; label: string; hidden?: boolean }[] = [
    { value: 'months', label: t('إغلاق الأشهر', 'Month closing'), hidden: !(can('month.close') || can('month.reopen') || (can('book.own') && myBooks.length > 0)) },
    { value: 'controls', label: t('الضوابط', 'Controls'), hidden: !can('users.manage') },
    { value: 'backups', label: t('النسخ الاحتياطية', 'Backups'), hidden: !(can('data.backup') || can('data.restore')) || s.mode === 'preview' },
    { value: 'users', label: can('users.manage') ? t('المستخدمون', 'Users') : can('users.passwords') ? t('كلمات السر', 'Passwords') : t('كلمة السر', 'Password') },
    { value: 'access', label: t('الأدوار والصلاحيات', 'Roles and permissions'), hidden: !can('users.manage') },
    { value: 'look', label: t('المظهر', 'Appearance'), hidden: !can('users.manage') },
    { value: 'audit', label: t('سجل التعديلات', 'Audit log'), hidden: !can('audit.view') },
    { value: 'server', label: t('الخادم', 'Server'), hidden: s.mode !== 'server' || !(can('data.backup') || can('users.manage')) },
  ];
  const [tab, setTab] = useState<Tab>(tabs.find((x) => !x.hidden)!.value);
  return (
    <>
      <div className="page-head"><h1>{tabs.some((x) => !x.hidden && x.value !== 'users' && x.value !== 'months') ? t('الإدارة', 'Admin') : t('الإعدادات', 'Settings')}</h1></div>
      {s.mode === 'desktop' && <p className="muted small ltr" style={{ textAlign: 'start' }}>{s.dbPath}</p>}
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'months' && <Months />}
      {tab === 'controls' && can('users.manage') && <Controls />}
      {tab === 'backups' && <Backups />}
      {tab === 'users' && <Users />}
      {tab === 'access' && can('users.manage') && <AccessProfiles />}
      {tab === 'look' && can('users.manage') && <Appearance />}
      {tab === 'audit' && can('audit.view') && <Audit />}
      {tab === 'server' && s.mode === 'server' && <ServerTab />}
    </>
  );
}

// ---------------------------------------------------------------- months: step 1 per book, step 2 office

function Months() {
  const { s, d, reload, can, myBooks, limited } = useApp();
  const books = useMemo(
    () => d.lists.books.filter((b) => !b.is_main && (limited ? myBooks.includes(b.id) : true) && d.rows.some((r) => r.book_id === b.id)),
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

function Backups() {
  const { s, reload, can } = useApp();
  const [list, setList] = useState<BackupFile[]>([]);
  const [comparing, setComparing] = useState<BackupFile | null>(null);
  const refresh = () => s.api.call('backup.list').then(setList).catch((e) => toast(errText(e), true));
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
    const f = await pickFile(['db'], t('اختر ملف قاعدة البيانات', 'Choose the database file'));
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
          {can('data.backup') && <button className="btn primary" onClick={now}>{t('نسخة الآن', 'Back up now')}</button>}
        </div>
      </div>
      <table className="t">
        <thead><tr><th>{t('الملف', 'File')}</th><th>{t('التاريخ', 'Date')}</th><th className="n">KB</th><th /></tr></thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.path}><td className="code">{b.name}</td><td className="ltr">{new Date(b.modified).toLocaleString('en-GB')}</td><td className="n">{Math.round(b.size / 1024)}</td>
              <td className="right nowrap">
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

// ---------------------------------------------------------------- users

function Users() {
  const { s, d, can } = useApp();
  const [list, setList] = useState<UserRow[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [edit, setEdit] = useState<Partial<UserRow> | null>(null);
  const [pinFor, setPinFor] = useState<UserRow | null>(null);
  const manage = can('users.manage');
  const refresh = async () => {
    setList(await s.api.call('users.list'));
    if (manage) setAccess(await s.api.call('access.list'));
  };
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bookName = (id: number) => d.lists.books.find((b) => b.id === id)?.name ?? '?';
  const [created, setCreated] = useState<{ name: string; book: string; password: string }[] | null>(null);
  const keptIds = new Set(list.filter((u) => u.active).flatMap((u) => u.books));
  const unkept = d.lists.books.filter((b) => b.active && !b.is_main && !keptIds.has(b.id));
  const createKeepers = async () => {
    const names = unkept.map((b) => b.keeper_name || b.name).join('، ');
    if (!(await confirmBox(t(`إنشاء حساب «أمين صندوق» لكل من: ${names}؟\nلكلٍّ كلمة سر مؤقتة يغيّرها عند أول دخول.`, `Create a "Book holder" account for: ${names}?\nEach gets a temporary password, to change at first login.`)))) return;
    try {
      setCreated(await s.api.call('users.createKeepers'));
      await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const deactivate = async (u: UserRow) => {
    if (!(await confirmBox(t(`إيقاف ${u.name}؟ لن يستطيع الدخول.`, `Deactivate ${u.name}? They will no longer be able to log in.`), true))) return;
    try {
      await s.api.call('user.deactivate', { id: u.id });
      await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 900 }}>
      <table className="t">
        <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('ملف الصلاحيات', 'Permission profile')}</th><th>{t('الدفاتر', 'Books kept')}</th><th /></tr></thead>
        <tbody>
          {list.filter((u) => u.active).map((u) => (
            <tr key={u.id}>
              <td><b>{u.name}</b></td><td>{biName(u.access_name)}</td><td>{u.books.map(bookName).join('، ') || '—'}</td>
              <td className="right nowrap">
                {manage && <button className="btn small" onClick={() => setEdit(u)}>✎</button>}{' '}
                <button className="btn small" onClick={() => setPinFor(u)}>{t('كلمة السر', 'Password')}</button>{' '}
                {manage && u.id !== s.profile.id && <button className="btn small ghost" onClick={() => deactivate(u)}>✕</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {manage && s.install === 'office' && (
        <div className="modal-foot">
          {unkept.length > 0 && (
            <button className="btn" onClick={createKeepers}>
              {t(`إنشاء حسابات لكل أمناء الدفاتر (${unkept.length})`, `Create accounts for all book keepers (${unkept.length})`)}
            </button>
          )}
          <button className="btn primary" onClick={() => setEdit({ books: [] })}>＋ {t('مستخدم', 'User')}</button>
        </div>
      )}
      {created && <CreatedModal rows={created} onClose={() => setCreated(null)} />}
      {edit && <UserModal user={edit} access={access} onClose={() => setEdit(null)} onDone={refresh} />}
      {pinFor && <PinModal p={{ id: pinFor.id, name: pinFor.name }} onClose={() => setPinFor(null)} />}
    </div>
  );
}

/** The temporary passwords, shown once: to hand to each person (or print). */
function CreatedModal({ rows, onClose }: { rows: { name: string; book: string; password: string }[]; onClose: () => void }) {
  return (
    <Modal title={t('الحسابات الجديدة', 'New accounts')} onClose={onClose} narrow>
      <div className="alert warn small">
        {t('اكتب كلمات السر المؤقتة الآن: لن تظهر مرة أخرى. عند أول دخول يختار كل واحد كلمة سره.', 'Write these temporary passwords down now: they will not be shown again. At first login, each person chooses his own password.')}
      </div>
      <table className="t">
        <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('الدفتر', 'Book')}</th><th>{t('كلمة السر المؤقتة', 'Temporary password')}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.name}><td><b>{r.name}</b></td><td>{r.book}</td><td className="code" style={{ fontSize: 16 }}>{r.password}</td></tr>)}</tbody>
      </table>
      <div className="modal-foot">
        <button className="btn" onClick={() => window.print()}>{t('طباعة', 'Print')}</button>
        <button className="btn primary" onClick={onClose}>{t('كتبتها', 'I wrote them down')}</button>
      </div>
    </Modal>
  );
}

function UserModal({ user, access, onClose, onDone }: { user: Partial<UserRow>; access: AccessRow[]; onClose: () => void; onDone: () => Promise<void> }) {
  const { s, d } = useApp();
  const [name, setName] = useState(user.name ?? '');
  const [accessId, setAccessId] = useState<number | null>(user.access_id ?? access.find((a) => a.id === 3)?.id ?? access[0]?.id ?? null);
  const [books, setBooks] = useState<number[]>(user.books ?? []);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const toggle = (id: number) => setBooks((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const save = async () => {
    if (accessId == null) return setErr(t('اختر ملف الصلاحيات', 'Choose a permission profile'));
    try {
      await s.api.call('user.save', { id: user.id, name, access_id: accessId, books, pin: pin || undefined });
      await onDone();
      onClose();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal title={user.id ? t('تعديل مستخدم', 'Edit user') : t('مستخدم جديد', 'New user')} onClose={onClose} narrow>
      <div className="grid2">
        <Field label={t('الاسم', 'Name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('ملف الصلاحيات', 'Permission profile')}>
          <select value={accessId ?? ''} onChange={(e) => setAccessId(Number(e.target.value))}>
            {access.map((a) => <option key={a.id} value={a.id}>{biName(a.name)}</option>)}
          </select>
        </Field>
        <Field label={user.id ? t('كلمة سر جديدة (اتركها فارغة إن لم تتغير)', 'New password (empty = unchanged)') : t('كلمة السر (6 على الأقل)', 'Password (6+)')} className="span2">
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
        </Field>
      </div>
      <h3 style={{ marginTop: 14 }}>{t('الدفاتر التي يحملها', 'Books this person keeps')}</h3>
      <div className="chips">
        {d.lists.books.filter((b) => b.active).map((b) => (
          <button key={b.id} type="button" className={`chip ${books.includes(b.id) ? 'on' : ''}`} onClick={() => toggle(b.id)}>{b.name}</button>
        ))}
      </div>
      <p className="muted small">{t('يكتب في هذه الدفاتر ويؤكّد ما يصلها ويغلق شهرها، إن سمح ملف صلاحياته بذلك.', 'He writes in these books, confirms what reaches them and closes their month — if his permission profile allows "Book".')}</p>
      {err && <div className="alert err">{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!name.trim()} onClick={save}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

export function PinModal({ p, onClose, onDone }: { p: Pick<Profile, 'id' | 'name'>; onClose: () => void; onDone?: () => void }) {
  const { s } = useApp();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={<>{t('كلمة سر جديدة', 'New password')} · {p.name}</>} onClose={onClose} narrow>
      <div className="grid2">
        <Field label={t('كلمة السر', 'Password')}><input type="password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label={t('تأكيد', 'Again')}><input type="password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
      </div>
      <p className="muted small">{t('6 أحرف أو أرقام على الأقل.', 'At least 6 characters.')}</p>
      {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" onClick={async () => {
          if (a !== b) return setErr(t('كلمة السر وتأكيدها مختلفان', 'Password and confirmation differ'));
          try {
            await s.api.call('profile.setPin', { id: p.id, pin: a });
            toast(t('تغيّرت كلمة السر', 'Password changed'));
            onDone?.();
            onClose();
          } catch (e) {
            setErr(errText(e));
          }
        }}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- permission profiles

/** What is only seen (reports, registers) and what changes something, for the tags of the roles matrix. */
const VIEW_PERMS = new Set<Perm>(['register.view', 'reports.summary', 'reports.monthly', 'reports.accounts', 'reports.exchange', 'reports.cash', 'reports.funding', 'budget.view', 'data.export', 'audit.view']);

/** The roles page (as in the communities): one column per permission profile, one row per thing it may do. */
function AccessProfiles() {
  const { s, reload } = useApp();
  const [list, setList] = useState<AccessRow[]>([]);
  const [edit, setEdit] = useState<Partial<AccessRow> | null>(null);
  const refresh = () => s.api.call('access.list').then(setList);
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (a: AccessRow) => {
    if (!(await confirmBox(t(`حذف «${a.name}»؟`, `Delete "${a.name}"?`), true))) return;
    try {
      await s.api.call('access.delete', { id: a.id });
      await refresh();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const toggle = async (a: AccessRow, p: Perm) => {
    const perms = a.perms.includes(p) ? a.perms.filter((x) => x !== p) : [...a.perms, p];
    try {
      await s.api.call('access.save', { id: a.id, name: a.name, perms });
      await refresh();
      await reload();
      toast(t('حُفظ ✓', 'Saved ✓'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="panel">
      <p className="muted small">{t('ماذا يستطيع كل ملف صلاحيات: «اطّلاع» يعرض فقط، و«تعديل» يغيّر شيئاً. كل مستخدم يأخذ ملفاً واحداً؛ تغيير علامة يغيّر صلاحيات كل من يحمل الملف، عند دخوله التالي.', 'What each permission profile may do. "View" only shows; "modify" changes something. Each user has one profile; a tick changes the rights of everybody who has it, at their next sign-in.')}</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="t roles-matrix">
          <thead>
            <tr>
              <th />
              {list.map((a) => (
                <th key={a.id} className="c">
                  {biName(a.name)}
                  <div className="muted small">{a.users} {t('مستخدم', 'users')}</div>
                  <div className="nowrap">
                    <button className="btn small ghost" onClick={() => setEdit(a)} title={t('الاسم وكل العلامات', 'Name and all ticks')}>✎</button>
                    {a.users === 0 && <button className="btn small ghost" onClick={() => remove(a)}>✕</button>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERM_GROUPS.map((g) => [
              <tr key={g.key} className="group"><td colSpan={list.length + 1}><b>{tx(g.label)}</b></td></tr>,
              ...g.perms.map((p) => (
                <tr key={p.key}>
                  <td><span className={`role-pill ${VIEW_PERMS.has(p.key) ? 'view' : 'modify'}`}>{VIEW_PERMS.has(p.key) ? t('اطّلاع', 'View') : t('تعديل', 'Modify')}</span> {tx(p.label)}</td>
                  {list.map((a) => <td key={a.id} className="c"><input type="checkbox" checked={a.perms.includes(p.key)} onChange={() => toggle(a, p.key)} /></td>)}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <div className="modal-foot"><button className="btn primary" onClick={() => setEdit({ name: '', perms: [] })}>＋ {t('ملف صلاحيات', 'Permission profile')}</button></div>
      {edit && <AccessModal a={edit} onClose={() => setEdit(null)} onDone={async () => { await refresh(); await reload(); }} />}
    </div>
  );
}

function AccessModal({ a, onClose, onDone }: { a: Partial<AccessRow>; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useApp();
  const [name, setName] = useState(a.name ?? '');
  const [perms, setPerms] = useState<Perm[]>(a.perms ?? []);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (p: Perm) => setPerms((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  return (
    <Modal title={a.id ? t('تعديل ملف صلاحيات', 'Edit permission profile') : t('ملف صلاحيات جديد', 'New permission profile')} onClose={onClose}>
      <Field label={t('الاسم', 'Name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid2" style={{ marginTop: 14 }}>
        {PERM_GROUPS.map((g) => (
          <div key={g.key} className="panel" style={{ padding: 12, marginBottom: 0 }}>
            <h3>{tx(g.label)}</h3>
            {g.perms.map((p) => (
              <label key={p.key} className="row" style={{ alignItems: 'flex-start', marginBottom: 6, flexWrap: 'nowrap' }}>
                <input type="checkbox" checked={perms.includes(p.key)} onChange={() => toggle(p.key)} style={{ marginTop: 3 }} />
                <span className="small">{tx(p.label)}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      {err && <div className="alert err" style={{ marginTop: 10 }}>{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!name.trim()} onClick={async () => {
          try {
            await s.api.call('access.save', { id: a.id, name, perms });
            await onDone();
            onClose();
          } catch (e) {
            setErr(errText(e));
          }
        }}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- appearance: name, centre, own colour and logo

function Appearance() {
  const { s } = useApp();
  const [b, setB] = useState<{ organisation: string; centre: string; color: string | null; logo: string | null } | null>(null);
  const [own, setOwn] = useState(false);
  const [color, setColor] = useState('#2E7D32');
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    s.api.call('brand.get').then((x) => {
      setB(x);
      setOwn(!!(x.color || x.logo));
      if (x.color) setColor(x.color);
      setLogo(x.logo);
    });
  }, [s.api]);
  if (!b) return <p className="muted">…</p>;
  const preview = { slug: '', organisation: b.organisation, centre: b.centre, color: own ? color : null, logo: own ? logo : null, setupNeeded: false };
  const save = async () => {
    try {
      await s.api.call('brand.save', { organisation: b.organisation, centre: b.centre, color: own ? color : null, logo: own ? logo : null });
      toast(t('حُفظ — يُعاد فتح البرنامج', 'Saved — reopening the program'));
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <Field label={t('اسم قاعدة البيانات', 'Name of the database')}><input value={b.organisation} onChange={(e) => setB({ ...b, organisation: e.target.value })} /></Field>
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
