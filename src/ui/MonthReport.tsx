// The month-end report: one page (or a few) to print or save as PDF, signed by
// each holder, the Accountant and the Superior. Cash of every book with the count
// made at closing, income and expenses by heading, transfers and exchanges, what is
// still missing (documents, approvals, rows to review), and the budget if the
// person may see it.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { holdersMonth } from '../domain/reports';
import { MONTHS_AR, MONTHS_EN } from '../domain/types';
import { WHOLE, assignExpenses, followUp, inPeriod, type BudgetBook } from '../domain/budget';
import { needsApproval, needsDoc, type BudgetPayload, type UserRow } from '../ops';
import { brandStyle } from '../brand';
import { fmtDate, fmtPct, fmtSyp, fmtUsd, t } from './kit';

export function MonthReport({ ym, onClose }: { ym: string; onClose: () => void }) {
  const { s, d, can } = useApp();
  const [budget, setBudget] = useState<BudgetPayload | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  useEffect(() => {
    if (can('budget.view')) s.api.call('budget.get', {}).then(setBudget).catch(() => undefined);
    s.api.call('users.list').then(setUsers).catch(() => undefined);
  }, [s, can, year]);

  const L = d.lists;
  const rows = useMemo(() => d.rows.filter((r) => r.date?.startsWith(ym)), [d, ym]);
  const books = L.books.filter((b) => b.is_main || d.rows.some((r) => r.book_id === b.id));
  const syp = holdersMonth(d.rows, books, 'SYP', ym).filter((x) => x.book);
  const usd = holdersMonth(d.rows, books, 'USD', ym).filter((x) => x.book);
  const comp = d.comp;

  // income and expenses by heading
  const byHeading = useMemo(() => {
    const m = new Map<number, { inc: [number, number, number]; exp: [number, number, number] }>();
    for (const r of rows) {
      if (r.type !== 'Income' && r.type !== 'Exp') continue;
      const h = r.heading_id ?? -1;
      const x = m.get(h) ?? { inc: [0, 0, 0], exp: [0, 0, 0] };
      const c = comp.get(r.id);
      if (r.type === 'Income') x.inc = [x.inc[0] + r.inc_syp, x.inc[1] + r.inc_usd, x.inc[2] + (c?.incUsdTot ?? 0)];
      else x.exp = [x.exp[0] + r.exp_syp, x.exp[1] + r.exp_usd, x.exp[2] + (c?.expUsdTot ?? 0)];
      m.set(h, x);
    }
    return [...m].map(([h, x]) => ({ name: L.headings.find((y) => y.id === h)?.name ?? t('بلا بند', 'No heading'), ...x })).sort((a, b) => b.exp[2] + b.inc[2] - (a.exp[2] + a.inc[2]));
  }, [rows, comp, L]);
  const tot = byHeading.reduce((a, x) => ({ inc: a.inc.map((v, i) => v + x.inc[i]), exp: a.exp.map((v, i) => v + x.exp[i]) }), { inc: [0, 0, 0], exp: [0, 0, 0] });

  const transfers = d.transfers.filter((x) => x.date?.startsWith(ym));
  const exchanges = rows.filter((r) => r.type === 'Exchange');
  const S = L.settings;
  const withDoc = new Set(d.attachments.map((a) => a.trx_id));
  const missingDocs = rows.filter((r) => needsDoc(S, r, comp.get(r.id)?.expUsdTot ?? 0) && !withDoc.has(r.id)).length;
  const waiting = rows.filter((r) => needsApproval(S, r, comp.get(r.id)?.expUsdTot ?? 0)).length;
  const review = rows.filter((r) => r.review).length;

  // every budget running this month, each with only the expenses that belong to it
  const budgetTables = useMemo(() => {
    if (!budget) return [];
    const books: BudgetBook[] = budget.books.map((x) => ({ budget: x.budget, cells: x.cells, lumped: new Set(x.lumped) }));
    const assigned = assignExpenses(d.rows, comp, books);
    const headingOf = new Map(L.lines.map((l) => [l.id, l.heading_id]));
    const outside = new Set(L.accounts.filter((a) => a.outside_budget).map((a) => a.id));
    return books.filter((bk) => inPeriod(bk.budget, ym)).map((bk) => {
      const amounts = bk.cells.filter((c) => c.line_id !== WHOLE);
      const accounts = bk.cells.filter((c) => c.line_id === WHOLE).map((c) => ({ version_id: 0, account_id: c.account_id, contingency_pct: 0, lump_usd: c.amount_usd }));
      const rowsB = followUp({ rows: d.rows, comp, budget: bk.budget, upToYm: ym, amounts, original: null, headingOf, outside, accounts, assigned: books.length > 1 ? assigned : undefined });
      const m = new Map<number, { budget: number; spent: number }>();
      for (const r of rowsB) {
        const x = m.get(r.heading_id) ?? { budget: 0, spent: 0 };
        m.set(r.heading_id, { budget: x.budget + r.budget, spent: x.spent + r.spent });
      }
      return {
        name: bk.budget.name,
        rows: [...m].map(([h, x]) => ({ name: h === WHOLE ? t('حسابات بمبلغ واحد', 'Accounts with one amount') : L.headings.find((y) => y.id === h)?.name ?? '?', ...x })),
      };
    });
  }, [budget, d, comp, L, ym]);
  const hasBudget = budgetTables.some((x) => x.rows.length > 0);

  const monthLabel = `${MONTHS_EN[month - 1]} ${year} · ${MONTHS_AR[month - 1]} ${year}`;
  const st = brandStyle({ centre: s.centre ?? 'other', color: s.brandColor, logo: s.brandLogo });
  const holdersToSign = books.filter((b) => !b.is_main && rows.some((r) => r.book_id === b.id));
  const nameOf = (accessId: number) => users.filter((u) => u.access_id === accessId && u.active).map((u) => u.name).join(' / ');
  const officeClosed = d.closed.has(ym);

  return (
    <div className="report-overlay">
      <div className="report-bar no-print">
        <button className="btn" onClick={onClose}>✕ {t('إغلاق', 'Close')}</button>
        <span className="muted small">{t('للطباعة أو الحفظ بصيغة PDF: «طباعة» ثم «حفظ كـ PDF».', 'To print or save as PDF: "Print", then "Save as PDF".')}</span>
        <button className="btn primary" onClick={() => window.print()}>🖨 {t('طباعة / PDF', 'Print / PDF')}</button>
      </div>
      <div className="report-page print-area">
        <header className="report-head">
          <img src={st.mark ?? '/brand/magis-sun.png'} alt="" />
          <div>
            <h1>{s.organisation || 'MAGIS'}</h1>
            <div className="report-title">{t('التقرير الشهري', 'Monthly report')} — {monthLabel}</div>
            <div className="muted small">
              {officeClosed ? `🔒 ${t('الشهر مغلق', 'Month closed')}` : `🔓 ${t('الشهر غير مغلق بعد', 'Month not closed yet')}`} · {t('طُبع في', 'printed on')} {fmtDate(new Date().toISOString().slice(0, 10))}
            </div>
          </div>
        </header>

        <h2>1. {t('النقد في كل دفتر', 'Cash in each book')}</h2>
        <table className="t rep">
          <thead>
            <tr><th>{t('الدفتر', 'Book')}</th><th /><th className="n">{t('أول الشهر', 'Start')}</th><th className="n">{t('إيرادات', 'Income')}</th><th className="n">{t('نفقات', 'Expenses')}</th><th className="n">{t('تحويلات', 'Transfers')}</th><th className="n">{t('تصريف', 'Exchange')}</th><th className="n">{t('آخر الشهر', 'End')}</th><th className="n">{t('المعدود', 'Counted')}</th><th className="n">{t('الفرق', 'Difference')}</th></tr>
          </thead>
          <tbody>
            {syp.map((x, i) => {
              const bm = d.bookMonths.find((b) => b.book_id === x.book!.id && b.ym === ym);
              const u = usd[i];
              const line = (cur: 'SYP' | 'USD', v: typeof x, counted: number | null | undefined) => {
                const f = cur === 'SYP' ? fmtSyp : fmtUsd;
                const diff = counted != null ? counted - v.end : null;
                return (
                  <tr key={`${x.book!.id}${cur}`} className={cur === 'USD' ? 'sub' : ''}>
                    {cur === 'SYP' && <td rowSpan={2}><b>{x.book!.name}</b>{x.book!.keeper_name ? <div className="muted small">{x.book!.keeper_name}</div> : null}</td>}
                    <td className="small muted">{cur}</td>
                    <td className="n">{f(v.start)}</td><td className="n">{f(v.income)}</td><td className="n">{f(v.expenses)}</td><td className="n">{f(v.transfers)}</td><td className="n">{f(v.exchange)}</td>
                    <td className="n"><b>{f(v.end)}</b></td>
                    <td className="n">{counted != null ? f(counted) : '—'}</td>
                    <td className={`n ${diff && Math.abs(diff) >= (cur === 'SYP' ? 0.5 : 0.005) ? 'bad' : ''}`}>{diff != null ? f(diff) : ''}</td>
                  </tr>
                );
              };
              return [line('SYP', x, bm?.counted_syp), line('USD', u, bm?.counted_usd), bm?.count_note ? <tr key={`${x.book!.id}n`}><td /><td colSpan={9} className="small">↳ {bm.count_note}</td></tr> : null];
            })}
          </tbody>
        </table>

        <h2>2. {t('الإيرادات والنفقات حسب البند', 'Income and expenses by heading')}</h2>
        <table className="t rep">
          <thead>
            <tr><th>{t('البند', 'Heading')}</th><th className="n">{t('إيرادات', 'Income')} SYP</th><th className="n">USD</th><th className="n">{t('نفقات', 'Expenses')} SYP</th><th className="n">USD</th><th className="n">{t('نفقات بالدولار', 'Expenses all in USD')}</th></tr>
          </thead>
          <tbody>
            {byHeading.map((x) => (
              <tr key={x.name}><td>{x.name}</td><td className="n">{fmtSyp(x.inc[0])}</td><td className="n">{fmtUsd(x.inc[1])}</td><td className="n">{fmtSyp(x.exp[0])}</td><td className="n">{fmtUsd(x.exp[1])}</td><td className="n">{fmtUsd(x.exp[2])}</td></tr>
            ))}
            <tr className="group"><td><b>{t('المجموع', 'Total')}</b></td><td className="n"><b>{fmtSyp(tot.inc[0])}</b></td><td className="n"><b>{fmtUsd(tot.inc[1])}</b></td><td className="n"><b>{fmtSyp(tot.exp[0])}</b></td><td className="n"><b>{fmtUsd(tot.exp[1])}</b></td><td className="n"><b>{fmtUsd(tot.exp[2])}</b></td></tr>
          </tbody>
        </table>

        <h2>3. {t('التحويلات والتصريف', 'Transfers and exchanges')}</h2>
        {!transfers.length && !exchanges.length ? <p className="muted">{t('لا شيء هذا الشهر', 'None this month')}</p> : (
          <table className="t rep">
            <tbody>
              {transfers.map((x) => (
                <tr key={x.key}>
                  <td className="nowrap">{fmtDate(x.date)}</td>
                  <td>{L.books.find((b) => b.id === x.from)?.name} → {L.books.find((b) => b.id === x.to)?.name}</td>
                  <td className="n">{x.currency === 'SYP' ? fmtSyp(x.amount) : fmtUsd(x.amount)} {x.currency}</td>
                  <td className="small">{x.receivedAt ? `✓ ${t('استُلم', 'received')}` : x.disputedAt ? `✗ ${t('لم يصل', 'not received')}` : `⏳ ${t('ينتظر', 'waiting')}`}</td>
                </tr>
              ))}
              {exchanges.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDate(r.date)}</td>
                  <td>{t('تصريف', 'Exchange')} · {L.books.find((b) => b.id === r.book_id)?.name}</td>
                  <td className="n">{fmtUsd(r.trf_usd)} USD → {fmtSyp(r.trf_syp)} SYP</td>
                  <td className="small">{t('السعر', 'rate')} {r.trf_usd ? fmtSyp(r.trf_syp / r.trf_usd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {hasBudget && (
          <>
            <h2>4. {t('الموازنة: المصروف حتى نهاية الشهر', 'Budget: spent up to the end of the month')}</h2>
            {budgetTables.filter((x) => x.rows.length).map((bt) => (
              <table key={bt.name} className="t rep" style={{ marginBottom: 8 }}>
                <thead><tr><th>{bt.name}</th><th className="n">{t('الموازنة', 'Budget')} $</th><th className="n">{t('المصروف', 'Spent')} $</th><th className="n">%</th></tr></thead>
                <tbody>
                  {bt.rows.map((x) => (
                    <tr key={x.name}><td>{x.name}</td><td className="n">{fmtUsd(x.budget)}</td><td className="n">{fmtUsd(x.spent)}</td><td className={`n ${x.budget > 0 && x.spent > x.budget ? 'bad' : ''}`}>{x.budget > 0 ? fmtPct(x.spent / x.budget) : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            ))}
          </>
        )}

        <h2>{hasBudget ? 5 : 4}. {t('ما ينقص', 'What is still missing')}</h2>
        <ul className="rep-list">
          <li>{t('نفقات بلا مستند', 'Expenses without their document')}: <b>{missingDocs}</b></li>
          {!!S.approval_on && <li>{t('نفقات تنتظر الموافقة', 'Expenses waiting for approval')}: <b>{waiting}</b></li>}
          <li>{t('أسطر للمراجعة', 'Rows to review')}: <b>{review}</b></li>
          <li>{t('عدد القيود', 'Entries this month')}: <b>{rows.length}</b></li>
        </ul>

        <h2>{t('التواقيع', 'Signatures')}</h2>
        <div className="signs">
          {holdersToSign.map((b) => (
            <div key={b.id} className="sign"><div className="sign-role">{t('أمين الصندوق', 'Book holder')} · {b.name}</div><div className="sign-name">{b.keeper_name ?? ''}</div><div className="sign-line">{t('التوقيع والتاريخ', 'Signature and date')}</div></div>
          ))}
          <div className="sign"><div className="sign-role">{t('المحاسب', 'The Accountant')}</div><div className="sign-name">{nameOf(2)}</div><div className="sign-line">{t('التوقيع والتاريخ', 'Signature and date')}</div></div>
          <div className="sign"><div className="sign-role">{t('الرئيس', 'The Superior')}</div><div className="sign-name">{nameOf(1)}</div><div className="sign-line">{t('التوقيع والتاريخ', 'Signature and date')}</div></div>
        </div>
      </div>
    </div>
  );
}
