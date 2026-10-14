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
  const { d, holder } = useApp();
  const nav = useNav();
  const names = useNames();
  const [month, setMonth] = useState('');
  const [book, setBook] = useState<number | null>(null);
  const [account, setAccount] = useState<number | null>(null);
  const [type, setType] = useState('');
  const [heading, setHeading] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [review, setReview] = useState(nav.reviewOnly);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const box = useRef<HTMLDivElement>(null);

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
  const last = Math.min(rows.length, first + Math.ceil(height / ROW_H) + 20);
  const visible = rows.slice(first, last);

  const clear = () => {
    setMonth(''); setBook(null); setAccount(null); setType(''); setHeading(null); setQ(''); setReview(false);
  };

  const cell = (r: Trx) => {
    const c = d.comp.get(r.id)!;
    return (
      <tr key={r.id} className={r.type ?? ''} onClick={() => nav.entry(r)} title={r.review ?? undefined}>
        <td className="code">{r.review ? '⚠ ' : ''}{r.n == null ? (r.sent_at ? '✓' : '·') : String(r.n).padStart(4, '0')}</td>
        <td className="ltr">{fmtDate(r.date)}</td>
        {!holder && <td>{names.book(r.book_id)}</td>}
        <td>{names.account(r.account_id)}</td>
        <td>{r.type ? tx(TYPE_LABEL[r.type]) : '?'}</td>
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
        <h1>{holder ? t('قيودي', 'My entries') : t('السجل', 'Register')}</h1>
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
              <th>N</th><th>{t('التاريخ', 'Date')}</th>{!holder && <th>{t('الدفتر', 'Book')}</th>}<th>{t('الحساب', 'Account')}</th><th>{t('النوع', 'Type')}</th>
              <th>{t('البند', 'Heading')}</th><th>{t('الخط', 'Line')}</th><th>{t('الشرح', 'Explanation')}</th><th>{t('الجهة', 'Party')}</th><th>{t('الوصل', 'Receipt')}</th>
              <th>Inc SYP</th><th>Exp SYP</th><th>Inc USD</th><th>Exp USD</th><th>Trf SYP</th><th>Trf USD</th><th>Rate</th><th>Net USD-eq</th><th>Code</th>
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
