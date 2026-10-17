// The register: filters, search, totals. Only the visible rows are drawn,
// so 50,000 rows scroll without lag. Click a row to edit it.
import { useMemo, useRef, useState } from 'react';
import { useApp, useNames } from '../state';
import { TYPE_LABEL, tx } from '../i18n';
import { TYPES, type Trx } from '../domain/types';
import { useNav } from './Shell';
import { Select, fmtDate, fmtRate, fmtSyp, fmtUsd, t } from './kit';

const ROW_H = 30;

export function Register() {
  const { d, limited, myBooks } = useApp();
  const holder = limited && myBooks.length <= 1; // one book only: no Book column
  const nav = useNav();
  const names = useNames();
  const [month, setMonth] = useState('');
  const [book, setBook] = useState<number | null>(null);
  const [account, setAccount] = useState<number | null>(null);
  const [type, setType] = useState('');
  const [heading, setHeading] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [review, setReview] = useState(nav.reviewOnly);
  // sorting: a column and a direction (null = the register's own order)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const box = useRef<HTMLDivElement>(null);

  const withDocs = useMemo(() => new Set(d.attachments.map((x) => x.trx_id)), [d.attachments]);
  const months = useMemo(() => [...new Set(d.rows.map((r) => r.date?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse(), [d.rows]);

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return d.rows.filter((r) => {
      if (review && !r.review) return false;
      if (month === 'none' ? r.date : month && !r.date?.startsWith(month)) return false;
      if (book != null && r.book_id !== book) return false;
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
  }, [d.rows, review, month, book, account, type, heading, q, names]);

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

  const cell = (r: Trx) => {
    const c = d.comp.get(r.id)!;
    return (
      <tr key={r.id} className={r.type ?? ''} onClick={() => nav.entry(r)} title={r.review ?? undefined}>
        <td className="code">{withDocs.has(r.id) ? '📎' : ''}{r.review ? '⚠ ' : ''}{r.n == null ? (r.sent_at ? '✓' : '·') : String(r.n).padStart(4, '0')}</td>
        <td className="ltr">{fmtDate(r.date)}</td>
        {!holder && <td>{names.book(r.book_id)}</td>}
        <td>{names.account(r.account_id)}</td>
        <td>{r.type ? tx(TYPE_LABEL[r.type]) : '?'}{r.type === 'Transfer' && (r.disputed_at ? ' ✗' : r.received_at ? ' ✓' : ' ⏳')}</td>
        <td>{names.heading(r.heading_id)}</td>
        <td>{names.line(r.line_id)}</td>
        <td style={{ maxWidth: 280 }}>{r.explanation}</td>
        <td>{names.party(r.party_id)}</td>
        <td>{r.receipt}</td>
        <td className="n">{fmtSyp(r.inc_syp)}</td>
        <td className="n">{fmtSyp(r.exp_syp)}</td>
        <td className="n">{fmtUsd(r.inc_usd)}</td>
        <td className="n">{fmtUsd(r.exp_usd)}</td>
        <td className="n">{fmtSyp(r.trf_syp)}</td>
        <td className="n">{fmtUsd(r.trf_usd)}</td>
        <td className="n">{fmtRate(c.rate)}</td>
        <td className="n">{fmtUsd(c.incUsdTot - c.expUsdTot)}</td>
        <td className="code">{c.code}</td>
      </tr>
    );
  };

  return (
    <>
      <div className="page-head">
        <h1>{limited ? t('قيودي', 'My entries') : t('السجل', 'Register')}</h1>
        <div className="row">
          <span className="muted small">{rows.length} / {d.rows.length}</span>
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
              {th('n', 'N')}{th('date', t('التاريخ', 'Date'))}{!holder && th('book', t('الدفتر', 'Book'))}{th('account', t('الحساب', 'Account'))}{th('type', t('النوع', 'Type'))}
              {th('heading', t('البند', 'Heading'))}{th('line', t('الخط', 'Line'))}{th('explanation', t('الشرح', 'Explanation'))}{th('party', t('الجهة', 'Party'))}{th('receipt', t('الوصل', 'Receipt'))}
              {th('inc_syp', 'Inc SYP', true)}{th('exp_syp', 'Exp SYP', true)}{th('inc_usd', 'Inc USD', true)}{th('exp_usd', 'Exp USD', true)}{th('trf_syp', 'Trf SYP', true)}{th('trf_usd', 'Trf USD', true)}
              {th('rate', 'Rate', true)}{th('net', 'Net USD-eq', true)}{th('code', 'Code')}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr style={{ height: first * ROW_H }}><td colSpan={19} /></tr>}
            {visible.map(cell)}
            {last < rows.length && <tr style={{ height: (rows.length - last) * ROW_H }}><td colSpan={19} /></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={holder ? 9 : 10}>{t('المجموع', 'Total')} · {rows.length}</td>
              <td className="n">{fmtSyp(tot.inc_syp)}</td><td className="n">{fmtSyp(tot.exp_syp)}</td>
              <td className="n">{fmtUsd(tot.inc_usd)}</td><td className="n">{fmtUsd(tot.exp_usd)}</td>
              <td className="n">{fmtSyp(tot.trf_syp)}</td><td className="n">{fmtUsd(tot.trf_usd)}</td>
              <td />
              <td className="n">{fmtUsd(tot.inc - tot.exp)}</td><td />
            </tr>
          </tfoot>
        </table>
        {!rows.length && <p className="center muted">{t('لا سطور', 'No rows')}</p>}
      </div>
    </>
  );
}
