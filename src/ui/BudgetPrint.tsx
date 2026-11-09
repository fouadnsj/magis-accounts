// Building sites: print the budget (or save it as PDF), choosing what goes on paper:
// the general table, which headings, and for each one its kinds, its estimated items, its expenses.
// Same way as the month-end report: a preview, then the system's "Print" (Fouad, 9 Nov 2026).
import { useMemo, useState } from 'react';
import { useApp } from '../state';
import type { BuildingBudgetLine } from '../domain/reports';
import { brandStyle } from '../brand';
import { fmtDate, fmtPct, fmtUsd, t } from './kit';

interface Choice {
  general: boolean;
  /** the "paid in USD" and "SYP in USD" columns of the general table */
  detailCols: boolean;
  estimateCols: boolean;
  kinds: boolean;
  items: boolean;
  postponed: boolean;
  expenses: boolean;
  newPage: boolean;
  landscape: boolean;
  headings: Set<number>;
}

const red = (v: number) => (v < 0 ? 'bad' : '');

export function BudgetPrint({ lines, onClose }: { lines: BuildingBudgetLine[]; onClose: () => void }) {
  const { s, d } = useApp();
  const [c, setC] = useState<Choice>(() => ({
    general: true, detailCols: false, estimateCols: true, kinds: false, items: true, postponed: true, expenses: false, newPage: false, landscape: false,
    headings: new Set(lines.filter((l) => l.budget || l.total || l.items.length).map((l) => l.heading.id)),
  }));
  const set = <K extends keyof Choice>(k: K, v: Choice[K]) => setC((x) => ({ ...x, [k]: v }));
  const flip = (id: number) => setC((x) => {
    const h = new Set(x.headings);
    if (h.has(id)) h.delete(id); else h.add(id);
    return { ...x, headings: h };
  });
  const chosen = lines.filter((l) => c.headings.has(l.heading.id));
  const perHeading = c.kinds || c.items || c.expenses;
  const st = brandStyle({ centre: s.centre ?? 'other', color: s.brandColor, logo: s.brandLogo });
  const kindOf = useMemo(() => new Map(d.lists.lines.map((l) => [l.id, l.name])), [d.lists.lines]);
  const party = useMemo(() => new Map(d.lists.parties.map((p) => [p.id, p.name])), [d.lists.parties]);
  const sum = (f: (l: BuildingBudgetLine) => number) => chosen.reduce((a, l) => a + f(l), 0);
  const box = (k: keyof Choice, label: string, disabled = false) => (
    <label className="row small" style={{ opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" disabled={disabled} checked={c[k] as boolean} onChange={(e) => set(k, e.target.checked as never)} /> {label}
    </label>
  );

  return (
    <div className="report-overlay">
      {/* the page's orientation follows the choice */}
      <style>{`@media print { @page { size: A4 ${c.landscape ? 'landscape' : 'portrait'}; margin: 12mm; } }`}</style>
      <div className="report-bar no-print" style={{ flexWrap: 'wrap', alignItems: 'flex-start', gap: 14 }}>
        <button className="btn" onClick={onClose}>✕ {t('إغلاق', 'Close')}</button>
        <div>
          <b className="small">{t('ماذا يُطبع؟', 'What to print?')}</b>
          {box('general', t('الجدول العام (كل البنود المختارة)', 'The general table (the chosen headings)'))}
          {box('detailCols', t('مع عمودَي «مدفوع بالدولار» و«الليرة بالدولار»', 'With the "Paid in USD" and "SYP in USD" columns'), !c.general)}
          {box('estimateCols', t('مع أعمدة التقدير (المتبقي، المتوقع)', 'With the estimate columns (still to spend, expected)'), !c.general)}
        </div>
        <div>
          <b className="small">{t('لكل بند مختار', 'For each chosen heading')}</b>
          {box('kinds', t('الأنواع (مواد، أجور، أخرى)', 'Its kinds (materials, wages, other)'))}
          {box('items', t('بنود التقدير', 'Its estimated items'))}
          {box('postponed', t('مع البنود المؤجلة', 'With the postponed items'), !c.items)}
          {box('expenses', t('كل مصاريفه سطراً سطراً', 'All its expenses, row by row'))}
          {box('newPage', t('كل بند على صفحة جديدة', 'Each heading on a new page'), !perHeading)}
        </div>
        <div>
          <b className="small">{t('الصفحة', 'Page')}</b>
          {box('landscape', t('بالعرض', 'Landscape'))}
        </div>
        <div style={{ maxWidth: 420 }}>
          <b className="small">{t('البنود', 'Headings')}</b>{' '}
          <button className="btn small ghost" onClick={() => set('headings', new Set(lines.map((l) => l.heading.id)))}>{t('الكل', 'All')}</button>
          <button className="btn small ghost" onClick={() => set('headings', new Set())}>{t('لا شيء', 'None')}</button>
          <div className="chips" style={{ marginTop: 4 }}>
            {lines.map((l) => (
              <button key={l.heading.id} className={`chip ${c.headings.has(l.heading.id) ? 'on' : ''}`} onClick={() => flip(l.heading.id)}>
                {l.heading.code} · {l.heading.name}
              </button>
            ))}
          </div>
        </div>
        <button className="btn primary" disabled={!chosen.length || (!c.general && !perHeading)} onClick={() => window.print()}>🖨 {t('طباعة / PDF', 'Print / PDF')}</button>
      </div>

      <div className="report-page print-area">
        <header className="report-head">
          <img src={st.mark ?? '/brand/magis-sun.png'} alt="" />
          <div>
            <h1>{s.organisation || 'Homs Building'}</h1>
            <div className="report-title">{t('الموازنة', 'Budget')} · USD</div>
            <div className="muted small">{t('طُبع في', 'printed on')} {fmtDate(new Date().toISOString().slice(0, 10))}</div>
          </div>
        </header>
        {!chosen.length && <p className="muted no-print">{t('اختر بنداً واحداً على الأقل', 'Choose at least one heading')}</p>}

        {c.general && chosen.length > 0 && (
          <table className="t rep">
            <thead>
              <tr>
                <th>{t('الرمز', 'Code')}</th><th>{t('البند', 'Heading')}</th><th className="n">{t('الموازنة', 'Budget')}</th>
                {c.detailCols && <><th className="n">{t('مدفوع بالدولار', 'Paid in USD')}</th><th className="n">{t('الليرة بالدولار', 'SYP in USD')}</th></>}
                <th className="n">{t('المصروف', 'Spent')}</th><th className="n">{t('الباقي', 'Left')}</th>
                {c.estimateCols && <><th className="n">{t('المتبقي صرفه', 'Still to spend')}</th><th className="n">{t('المتوقع كلياً', 'Expected total')}</th><th className="n">{t('الباقي المتوقع', 'Expected left')}</th></>}
                <th className="n">{c.estimateCols ? t('المستعمل المتوقع', 'Expected used') : t('المستعمل', 'Used')}</th>
              </tr>
            </thead>
            <tbody>
              {chosen.map((l) => {
                const used = c.estimateCols ? l.expected : l.total;
                return (
                  <tr key={l.heading.id}>
                    <td>{l.heading.code}</td><td>{l.heading.name}</td><td className="n">{l.budget ? fmtUsd(l.budget) : '—'}</td>
                    {c.detailCols && <><td className="n">{fmtUsd(l.usd)}</td><td className="n">{fmtUsd(l.conv)}</td></>}
                    <td className="n"><b>{fmtUsd(l.total)}</b></td><td className={`n ${red(l.rest)}`}>{l.budget ? fmtUsd(l.rest) : '—'}</td>
                    {c.estimateCols && <>
                      <td className="n">{fmtUsd(l.still)}</td><td className="n"><b>{fmtUsd(l.expected)}</b></td>
                      <td className={`n ${red(l.expectedLeft)}`}>{l.budget ? fmtUsd(l.expectedLeft) : '—'}</td>
                    </>}
                    <td className="n">{l.budget ? fmtPct(used / l.budget) : ''}</td>
                  </tr>
                );
              })}
              <tr className="total">
                <td /><td><b>{t('المجموع', 'Total')}</b></td><td className="n">{fmtUsd(sum((l) => l.budget))}</td>
                {c.detailCols && <><td className="n">{fmtUsd(sum((l) => l.usd))}</td><td className="n">{fmtUsd(sum((l) => l.conv))}</td></>}
                <td className="n">{fmtUsd(sum((l) => l.total))}</td><td className={`n ${red(sum((l) => l.budget - l.total))}`}>{fmtUsd(sum((l) => l.budget - l.total))}</td>
                {c.estimateCols && <>
                  <td className="n">{fmtUsd(sum((l) => l.still))}</td><td className="n">{fmtUsd(sum((l) => l.expected))}</td>
                  <td className={`n ${red(sum((l) => l.budget - l.expected))}`}>{fmtUsd(sum((l) => l.budget - l.expected))}</td>
                </>}
                <td className="n">{sum((l) => l.budget) ? fmtPct(sum((l) => (c.estimateCols ? l.expected : l.total)) / sum((l) => l.budget)) : ''}</td>
              </tr>
            </tbody>
          </table>
        )}
        {c.general && c.estimateCols && chosen.some((l) => l.postponed) && (
          <p className="muted small">{t('المؤجل (غير محسوب)', 'Postponed (not counted)')}: {fmtUsd(sum((l) => l.postponed))} USD</p>
        )}

        {perHeading && chosen.map((l, i) => {
          const items = l.items.filter((e) => c.postponed || !e.postponed);
          const exps = c.expenses
            ? d.rows.filter((r) => r.type === 'Exp' && r.heading_id === l.heading.id && !r.cancelled_at)
              .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.n ?? 0) - (b.n ?? 0))
            : [];
          return (
            <section key={l.heading.id} style={c.newPage && (i > 0 || c.general) ? { breakBefore: 'page' } : undefined}>
              <h2>{l.heading.code} · {l.heading.name}</h2>
              <p className="small">
                {t('الموازنة', 'Budget')} <b>{l.budget ? fmtUsd(l.budget) : '—'}</b> · {t('المصروف', 'Spent')} <b>{fmtUsd(l.total)}</b> · {t('الباقي', 'Left')} <b>{l.budget ? fmtUsd(l.rest) : '—'}</b>
                {' · '}{t('المتبقي صرفه', 'Still to spend')} <b>{fmtUsd(l.still)}</b> · {t('المتوقع كلياً', 'Expected total')} <b>{fmtUsd(l.expected)}</b>
                {l.budget ? <> · {t('الباقي المتوقع', 'Expected left')} <b className={red(l.expectedLeft)}>{fmtUsd(l.expectedLeft)}</b></> : null}
              </p>
              {c.kinds && (
                <table className="t rep">
                  <thead><tr><th>{t('النوع', 'Kind')}</th><th className="n">{t('المصروف', 'Spent')}</th><th className="n">%</th></tr></thead>
                  <tbody>
                    {l.byLine.map((x) => <tr key={x.line.id}><td>{x.line.name}</td><td className="n">{fmtUsd(x.total)}</td><td className="n">{l.total ? fmtPct(x.total / l.total) : ''}</td></tr>)}
                  </tbody>
                </table>
              )}
              {c.items && (
                <table className="t rep">
                  <thead><tr><th>{t('المتبقي صرفه (تقدير)', 'Still to spend (estimate)')}</th><th className="n">USD</th></tr></thead>
                  <tbody>
                    {!items.length && <tr><td className="muted">—</td><td /></tr>}
                    {items.map((e) => (
                      <tr key={e.id} className={e.postponed ? 'off' : ''}><td>{e.description}{e.postponed ? ` (${t('مؤجل', 'postponed')})` : ''}</td><td className="n">{fmtUsd(e.amount_usd)}</td></tr>
                    ))}
                    {items.length > 0 && <tr className="total"><td>{t('المجموع (بلا المؤجل)', 'Total (postponed apart)')}</td><td className="n">{fmtUsd(l.still)}</td></tr>}
                  </tbody>
                </table>
              )}
              {c.expenses && (
                <table className="t rep">
                  <thead><tr><th>{t('رمز الفاتورة', 'Bill code')}</th><th>{t('تاريخ الدفع', 'Paid on')}</th><th>{t('النوع', 'Kind')}</th><th>{t('من', 'From')}</th><th>{t('التفاصيل', 'Details')}</th><th className="n">USD</th></tr></thead>
                  <tbody>
                    {exps.map((r) => (
                      <tr key={r.id}>
                        <td className="ltr nowrap">{d.comp.get(r.id)?.billCode}</td><td className="ltr nowrap">{fmtDate(r.date)}</td>
                        <td>{r.line_id != null ? kindOf.get(r.line_id) : ''}</td><td>{r.party_id != null ? party.get(r.party_id) : ''}</td>
                        <td>{r.explanation}</td><td className="n">{fmtUsd(d.comp.get(r.id)?.expUsdTot ?? 0)}</td>
                      </tr>
                    ))}
                    <tr className="total"><td colSpan={5}>{t('المجموع', 'Total')} · {exps.length}</td><td className="n">{fmtUsd(l.total)}</td></tr>
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
