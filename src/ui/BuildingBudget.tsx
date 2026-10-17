// Building sites: the budget per heading, as the Data sheet of Homs compte.xlsx showed it
// (budget, USD paid, pounds converted at each row's rate, total, what is left), and how
// each heading splits into materials, wages and other. Exchanges are not spending.
import { Fragment, useMemo, useState } from 'react';
import { useApp } from '../state';
import { buildingBudget } from '../domain/reports';
import { fmtPct, fmtUsd, t } from './kit';

/** the colour of what is used: under 75 % calm, to 90 % watch, to 100 % close, beyond: over */
const band = (p: number) => (p > 1 ? '#C0392B' : p > 0.9 ? '#D2691E' : p > 0.75 ? '#C9A227' : '#2A6FB0');

export function BuildingBudget() {
  const { d } = useApp();
  const [open, setOpen] = useState<number | null>(null);
  const lines = useMemo(() => buildingBudget(d.rows, d.comp, d.lists), [d.rows, d.comp, d.lists]);
  const sum = (f: (x: (typeof lines)[number]) => number) => lines.reduce((a, x) => a + f(x), 0);
  const budget = sum((x) => x.budget);
  const total = sum((x) => x.total);

  return (
    <>
      <div className="page-head">
        <h1>{t('الموازنة', 'Budget')}</h1>
        <span className="muted small">{t('بالدولار · الليرة محوّلة بسعر كل سطر', 'In USD · pounds converted at each row’s rate')}</span>
      </div>
      <div className="panel">
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t('الرمز', 'Code')}</th>
                <th>{t('البند', 'Heading')}</th>
                <th className="n">{t('الموازنة', 'Budget')}</th>
                <th className="n">{t('مدفوع بالدولار', 'Paid in USD')}</th>
                <th className="n">{t('الليرة بالدولار', 'SYP in USD')}</th>
                <th className="n">{t('المصروف', 'Spent')}</th>
                <th className="n">{t('الباقي', 'Left')}</th>
                <th style={{ minWidth: 160 }}>{t('المستعمل', 'Used')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = l.budget ? l.total / l.budget : l.total ? Infinity : 0;
                return (
                  <Fragment key={l.heading.id}>
                    <tr onClick={() => setOpen(open === l.heading.id ? null : l.heading.id)} style={{ cursor: 'pointer' }} title={t('اضغط لترى المواد والأجور', 'Click for materials and wages')}>
                      <td className="code">{l.heading.code}</td>
                      <td>{open === l.heading.id ? '▾ ' : '▸ '}{l.heading.name}</td>
                      <td className="n">{l.budget ? fmtUsd(l.budget) : '—'}</td>
                      <td className="n">{fmtUsd(l.usd)}</td>
                      <td className="n">{fmtUsd(l.conv)}</td>
                      <td className="n"><b>{fmtUsd(l.total)}</b></td>
                      <td className="n" style={{ color: l.rest < 0 ? '#C0392B' : undefined }}>{l.budget ? fmtUsd(l.rest) : '—'}</td>
                      <td>
                        {l.budget ? (
                          <div className="bar-track">
                            <div className="bar-fill" style={{ width: `${Math.min(100, p * 100)}%`, maxWidth: 110, background: band(p) }} />
                            <span className="bar-value">{fmtPct(p)}</span>
                          </div>
                        ) : l.total ? <span className="muted small">{t('بلا موازنة', 'no budget')}</span> : null}
                      </td>
                    </tr>
                    {open === l.heading.id && l.byLine.map((x) => (
                      <tr key={x.line.id} className="off">
                        <td className="code">{x.line.code}</td>
                        <td style={{ paddingInlineStart: 28 }}>{x.line.name}</td>
                        <td /><td /><td />
                        <td className="n">{fmtUsd(x.total)}</td>
                        <td />
                        <td className="muted small">{l.total ? fmtPct(x.total / l.total) : ''}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
              <tr className="total">
                <td />
                <td>{t('المجموع', 'Total')}</td>
                <td className="n">{fmtUsd(budget)}</td>
                <td className="n">{fmtUsd(sum((x) => x.usd))}</td>
                <td className="n">{fmtUsd(sum((x) => x.conv))}</td>
                <td className="n">{fmtUsd(total)}</td>
                <td className="n">{fmtUsd(budget - total)}</td>
                <td>{budget ? fmtPct(total / budget) : ''}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small">
          {t('التصريف ليس صرفاً: الدولارات تصير ليرات، وتُحسب حين تُصرف. الأسطر الملغاة بلا مبلغ.',
            'An exchange is not spending: the dollars become pounds, counted when they are spent. Cancelled rows hold no amount.')}
        </p>
      </div>
    </>
  );
}
