// The register: filters, search, totals. Only the visible rows are drawn,
// so 50,000 rows scroll without lag. Click a row to edit it.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, useNames, useIcons } from '../state';
import { TYPE_LABEL, tx } from '../i18n';
import { TYPES, type Trx } from '../domain/types';
import { useNav } from './Shell';
import { Select, fmtDate, fmtRate, fmtSyp, fmtUsd, t } from './kit';

const ROW_H = 30;

type Layout = { order: string[]; hidden: string[] };

export function Register() {
  const { s, d, limited, myBooks } = useApp();
  const holder = limited && myBooks.length <= 1; // one book only: no Book column
  const nav = useNav();
  const names = useNames();
  const icons = useIcons();
  const [month, setMonth] = useState('');
  const [book, setBook] = useState<number | null>(nav.bookOnly);
  const [account, setAccount] = useState<number | null>(null);
  const [type, setType] = useState('');
  const [heading, setHeading] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [review, setReview] = useState(nav.reviewOnly);
  // sorting: a column and a direction (null = the register's own order)
  // columns: order and hidden ones, remembered on this device for this person
  const layoutKey = `magis.registerColumns.${s.profile.id}`;
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(layoutKey) ?? 'null');
      if (v && Array.isArray(v.order) && Array.isArray(v.hidden)) return v;
    } catch { /* nothing kept */ }
    return { order: [], hidden: [] };
  });
  const [colsOpen, setColsOpen] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const box = useRef<HTMLDivElement>(null);

  const withDocs = useMemo(() => new Set(d.attachments.map((x) => x.trx_id)), [d.attachments]);
  const months = useMemo(() => [...new Set(d.rows.map((r) => r.date?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse(), [d.rows]);

  // a transfer between Main and another book is written once, on the other book: Main's side is implicit,
  // so Main's register shows it too (the money is in Main's balance)
  const mainId = d.lists.books.find((b) => b.is_main)?.id;
  const lonely = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of d.rows) if (r.type === 'Transfer' && r.transfer_group) n.set(r.transfer_group, (n.get(r.transfer_group) ?? 0) + 1);
    return n;
  }, [d.rows]);
  const mainSide = (r: Trx, book: number) => book === mainId && r.type === 'Transfer' && r.book_id !== mainId && (!r.transfer_group || lonely.get(r.transfer_group) === 1);

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return d.rows.filter((r) => {
      if (review && !r.review) return false;
      if (month === 'none' ? r.date : month && !r.date?.startsWith(month)) return false;
      if (book != null && r.book_id !== book && !mainSide(r, book)) return false;
      if (account != null && r.account_id !== account) return false;
      if (type && r.type !== type) return false;
      if (heading != null && r.heading_id !== heading) return false;
      if (qq) {
        const hay = [r.explanation, r.receipt, names.party(r.party_id), names.line(r.line_id), names.heading(r.heading_id), r.n == null ? '' : String(r.n).padStart(4, '0'),
          r.inc_syp, r.exp_syp, r.inc_usd, r.exp_usd, r.trf_syp, r.trf_usd].join(' ').toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [d.rows, review, month, book, account, type, heading, q, names, mainId, lonely]);

  // what each column sorts by
  const sortValue = useMemo((): Record<string, (r: Trx) => string | number> => ({
    n: (r) => r.n ?? -1,
    date: (r) => r.date ?? '',
    book: (r) => names.book(r.book_id),
    account: (r) => names.account(r.account_id),
    type: (r) => (r.type ? tx(TYPE_LABEL[r.type]) : ''),
    heading: (r) => names.heading(r.heading_id),
    line: (r) => names.line(r.line_id),
    explanation: (r) => r.explanation ?? '',
    party: (r) => names.party(r.party_id),
    receipt: (r) => r.receipt ?? '',
    inc_syp: (r) => r.inc_syp, exp_syp: (r) => r.exp_syp, inc_usd: (r) => r.inc_usd, exp_usd: (r) => r.exp_usd,
    trf_syp: (r) => r.trf_syp, trf_usd: (r) => r.trf_usd,
    rate: (r) => d.comp.get(r.id)?.rate ?? 0,
    net: (r) => (d.comp.get(r.id)?.incUsdTot ?? 0) - (d.comp.get(r.id)?.expUsdTot ?? 0),
    code: (r) => d.comp.get(r.id)?.code ?? '',
  }), [names, d.comp]);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const get = sortValue[sort.key];
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return c * sort.dir;
    });
  }, [rows, sort, sortValue]);
  const th = (key: string, label: string, n = false) => {
    const on = sort?.key === key;
    return (
      <th key={key} className={`sortable ${n ? 'n' : ''} ${on ? 'on' : ''}`} onClick={() => setSort(!on ? { key, dir: 1 } : sort!.dir === 1 ? { key, dir: -1 } : null)}
        title={t('اضغط للترتيب', 'Click to sort')}>
        {label}<span className="sort-mark">{on ? (sort!.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
      </th>
    );
  };

  const tot = useMemo(() => {
    const o = { inc_syp: 0, exp_syp: 0, inc_usd: 0, exp_usd: 0, trf_syp: 0, trf_usd: 0, inc: 0, exp: 0 };
    for (const r of rows) {
      o.inc_syp += r.inc_syp; o.exp_syp += r.exp_syp; o.inc_usd += r.inc_usd; o.exp_usd += r.exp_usd; o.trf_syp += r.trf_syp; o.trf_usd += r.trf_usd;
      const c = d.comp.get(r.id)!;
      o.inc += c.incUsdTot;
      o.exp += c.expUsdTot;
    }
    return o;
  }, [rows, d.comp]);

  const first = Math.max(0, Math.floor(scroll / ROW_H) - 10);
  const last = Math.min(sorted.length, first + Math.ceil(height / ROW_H) + 20);
  const visible = sorted.slice(first, last);

  const clear = () => {
    setMonth(''); setBook(null); setAccount(null); setType(''); setHeading(null); setQ(''); setReview(false); setSort(null);
  };

  // the columns, in the order and with the visibility this person chose
  type Col = { key: string; label: string; n?: boolean; td: (r: Trx) => ReactNode; foot?: () => ReactNode };
  const COLS: Col[] = [
    { key: 'n', label: 'N', td: (r) => <>{withDocs.has(r.id) ? '📎' : ''}{r.review ? '⚠ ' : ''}{r.n == null ? (r.sent_at ? '✓' : '·') : String(r.n).padStart(4, '0')}</> },
    { key: 'date', label: t('التاريخ', 'Date'), td: (r) => <span className="ltr">{fmtDate(r.date)}</span> },
    ...(holder ? [] : [{ key: 'book', label: t('الدفتر', 'Book'), td: (r: Trx) => names.book(r.book_id) }]),
    { key: 'account', label: t('الحساب', 'Account'), td: (r) => names.account(r.account_id) },
    { key: 'type', label: t('النوع', 'Type'), td: (r) => <>{r.type ? tx(TYPE_LABEL[r.type]) : '?'}{r.type === 'Transfer' && (r.disputed_at ? ' ✗' : r.received_at ? ' ✓' : ' ⏳')}</> },
    { key: 'heading', label: t('البند', 'Heading'), td: (r) => r.heading_id == null ? '' : `${icons.heading(r.heading_id)} ${names.heading(r.heading_id)}` },
    { key: 'line', label: t('الخط', 'Line'), td: (r) => r.line_id == null ? '' : `${icons.line(r.line_id)} ${names.line(r.line_id)}` },
    { key: 'explanation', label: t('الشرح', 'Explanation'), td: (r) => (r.private_book && !r.private_total && r.type === 'Transfer' ? <i className="muted">{t('تحويل من دفتر خاص', 'Transfer from a private book')}</i> : r.explanation) },
    { key: 'party', label: t('الجهة', 'Party'), td: (r) => names.party(r.party_id) },
    { key: 'receipt', label: t('الوصل', 'Receipt'), td: (r) => r.receipt },
    { key: 'inc_syp', label: 'Inc SYP', n: true, td: (r) => fmtSyp(r.inc_syp), foot: () => fmtSyp(tot.inc_syp) },
    { key: 'exp_syp', label: 'Exp SYP', n: true, td: (r) => fmtSyp(r.exp_syp), foot: () => fmtSyp(tot.exp_syp) },
    { key: 'inc_usd', label: 'Inc USD', n: true, td: (r) => fmtUsd(r.inc_usd), foot: () => fmtUsd(tot.inc_usd) },
    { key: 'exp_usd', label: 'Exp USD', n: true, td: (r) => fmtUsd(r.exp_usd), foot: () => fmtUsd(tot.exp_usd) },
    { key: 'trf_syp', label: 'Trf SYP', n: true, td: (r) => fmtSyp(r.trf_syp), foot: () => fmtSyp(tot.trf_syp) },
    { key: 'trf_usd', label: 'Trf USD', n: true, td: (r) => fmtUsd(r.trf_usd), foot: () => fmtUsd(tot.trf_usd) },
    { key: 'rate', label: 'Rate', n: true, td: (r) => fmtRate(d.comp.get(r.id)!.rate) },
    { key: 'net', label: 'Net USD-eq', n: true, td: (r) => fmtUsd(d.comp.get(r.id)!.incUsdTot - d.comp.get(r.id)!.expUsdTot), foot: () => fmtUsd(tot.inc - tot.exp) },
    { key: 'code', label: 'Code', td: (r) => d.comp.get(r.id)!.code },
  ];
  const byKey = new Map(COLS.map((c) => [c.key, c]));
  const ordered = [...layout.order.filter((k) => byKey.has(k)), ...COLS.map((c) => c.key).filter((k) => !layout.order.includes(k))].map((k) => byKey.get(k)!);
  const shown = ordered.filter((c) => !layout.hidden.includes(c.key));
  const save = (l: Layout) => {
    setLayout(l);
    try { localStorage.setItem(layoutKey, JSON.stringify(l)); } catch { /* the choice is kept for this visit only */ }
  };
  const move = (key: string, by: -1 | 1) => {
    const keys = ordered.map((c) => c.key);
    const i = keys.indexOf(key);
    const j = i + by;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    save({ ...layout, order: keys });
  };
  const toggle = (key: string) =>
    save({ ...layout, hidden: layout.hidden.includes(key) ? layout.hidden.filter((k) => k !== key) : [...layout.hidden, key] });

  const cell = (r: Trx) => (
    <tr key={r.id} className={r.type ?? ''} onClick={() => !r.private_book && nav.entry(r)} title={r.private_total ? t('مجموع الشهر فقط', "The month's total only") : r.private_book ? t('دفتر خاص: المبلغ فقط', 'Private book: the amount only') : r.review ?? undefined}>
      {shown.map((c) => (
        <td key={c.key} className={c.n ? 'n' : c.key === 'n' || c.key === 'code' ? 'code' : ''} style={c.key === 'explanation' ? { maxWidth: 280 } : undefined}>{c.td(r)}</td>
      ))}
    </tr>
  );

  return (
    <>
      <div className="page-head">
        <h1>{limited ? t('قيودي', 'My entries') : t('السجل', 'Register')}</h1>
        <div className="row">
          <span className="muted small">{rows.length} / {d.rows.length}</span>
          <button className="btn" onClick={() => setColsOpen(!colsOpen)}>☰ {t('الأعمدة', 'Columns')}</button>
          <button className="btn primary" onClick={() => nav.entry('Exp')}>＋ {t('قيد جديد', 'New entry')}</button>
        </div>
      </div>

      <div className="panel row" style={{ padding: 10 }}>
        <select className="inp" style={{ minWidth: 200, width: 'auto' }} value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">{t('كل الأشهر', 'All months')}</option>
          <option value="none">{t('بلا تاريخ', 'No date')}</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {!holder && (
          <div style={{ minWidth: 190, width: 'auto' }} className="field">
            <Select value={book} options={d.lists.books.map((b) => ({ value: b.id, label: b.name }))} onChange={setBook} placeholder={t('كل الدفاتر', 'All books')} />
          </div>
        )}
        <div style={{ minWidth: 190, width: 'auto' }} className="field">
          <Select value={account} options={d.lists.accounts.map((b) => ({ value: b.id, label: b.name }))} onChange={setAccount} placeholder={t('كل الحسابات', 'All accounts')} />
        </div>
        <select className="inp" style={{ minWidth: 180, width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t('كل الأنواع', 'All types')}</option>
          {TYPES.map((ty) => <option key={ty} value={ty}>{tx(TYPE_LABEL[ty])}</option>)}
        </select>
        <div style={{ minWidth: 250, width: 'auto' }} className="field">
          <Select value={heading} options={d.lists.headings.map((b) => ({ value: b.id, label: b.name }))} onChange={setHeading} placeholder={t('كل البنود', 'All headings')} />
        </div>
        <input className="inp" style={{ minWidth: 230, width: 'auto' }} placeholder={t('بحث…', 'Search…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row small">
          <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> ⚠ {t('للمراجعة', 'To review')}
        </label>
        <button className="btn small ghost" onClick={clear}>{t('مسح', 'Clear')}</button>
      </div>

      {colsOpen && (
        <div className="panel cols-panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{t('الأعمدة: إظهار وترتيب', 'Columns: show and order')}</b>
            <div className="row">
              <button className="btn small ghost" onClick={() => save({ order: [], hidden: [] })}>{t('كما كانت', 'Reset')}</button>
              <button className="btn small" onClick={() => setColsOpen(false)}>{t('تم', 'Done')}</button>
            </div>
          </div>
          <p className="muted small">{t('يُحفظ اختيارك على هذا الجهاز.', 'Your choice is kept on this device.')}</p>
          <div className="cols-list">
            {ordered.map((c, i) => (
              <div key={c.key} className={`cols-item ${layout.hidden.includes(c.key) ? 'off' : ''}`}>
                <label className="row"><input type="checkbox" checked={!layout.hidden.includes(c.key)} onChange={() => toggle(c.key)} /> {c.label}</label>
                <span>
                  <button className="btn small ghost" disabled={i === 0} onClick={() => move(c.key, -1)} title={t('قبل', 'Earlier')}>▲</button>
                  <button className="btn small ghost" disabled={i === ordered.length - 1} onClick={() => move(c.key, 1)} title={t('بعد', 'Later')}>▼</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="reg"
        ref={box}
        onScroll={(e) => {
          setScroll(e.currentTarget.scrollTop);
          setHeight(e.currentTarget.clientHeight);
        }}
      >
        <table>
          <thead>
            <tr>
              {shown.map((c) => th(c.key, c.label, c.n))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr style={{ height: first * ROW_H }}><td colSpan={shown.length} /></tr>}
            {visible.map(cell)}
            {last < rows.length && <tr style={{ height: (rows.length - last) * ROW_H }}><td colSpan={shown.length} /></tr>}
          </tbody>
          <tfoot>
            <tr>
              {shown.map((c, i) => (
                <td key={c.key} className={c.n ? 'n' : ''}>{i === 0 ? <span className="nowrap">{t('المجموع', 'Total')} · {rows.length}</span> : c.foot?.()}</td>
              ))}
            </tr>
          </tfoot>
        </table>
        {!rows.length && <p className="center muted">{t('لا سطور', 'No rows')}</p>}
      </div>
    </>
  );
}
