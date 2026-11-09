// Building sites: the budget per heading, as the Data sheet of Homs compte.xlsx showed it
// (budget, USD paid, pounds converted at each row's rate, total, what is left), how each heading
// splits into materials, wages and other, and the expenses still to come (estimates, USD):
// expected total = spent + still to spend; postponed items are shown apart (Fouad, 9 Nov 2026).
import { Fragment, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { useApp } from '../state';
import { buildingBudget } from '../domain/reports';
import type { EstimateItem } from '../domain/types';
import { exportBuildingBudget, readEstimates } from '../io/budgetExport';
import { pickFile, saveFile } from '../platform';
import { confirmBox, errText, fmtPct, fmtUsd, parseAmount, t, toast, todayIso } from './kit';

/** the colour of what is used: under 75 % calm, to 90 % watch, to 100 % close, beyond: over */
const band = (p: number) => (p > 1 ? '#C0392B' : p > 0.9 ? '#D2691E' : p > 0.75 ? '#C9A227' : '#2A6FB0');
const red = (v: number) => (v < 0 ? { color: '#C0392B' } : undefined);

export function BuildingBudget() {
  const { s, d, can, reload } = useApp();
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const edit = can('lists.manage');
  const lines = useMemo(() => buildingBudget(d.rows, d.comp, d.lists, null, d.estimates), [d.rows, d.comp, d.lists, d.estimates]);
  const sum = (f: (x: (typeof lines)[number]) => number) => lines.reduce((a, x) => a + f(x), 0);
  const budget = sum((x) => x.budget);
  const total = sum((x) => x.total);
  const expected = sum((x) => x.expected);

  const call = async (name: string, args: unknown, done?: string) => {
    try {
      await s.api.call(name as never, args as never);
      await reload();
      if (done) toast(done);
      return true;
    } catch (e) {
      toast(errText(e), true);
      return false;
    }
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const bytes = await exportBuildingBudget(lines, d.rows, d.comp, d.lists, { title: `${s.organisation || 'Homs Building'} · Budget`, date: todayIso() });
      const path = await saveFile(`budget-${todayIso()}.xlsx`, ['xlsx'], bytes, t('احفظ ملف Excel', 'Save the Excel file'));
      if (path) toast(t('صُدّر', 'Exported') + ': ' + path);
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    const f = await pickFile(['xlsx'], t('اختر ملف Excel فيه ورقة Estimates', 'Choose an Excel file with an "Estimates" sheet'));
    if (!f) return;
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(f.bytes);
      const rows = readEstimates(wb);
      const n = d.estimates.length;
      if (!(await confirmBox(t(`ستحل ${rows.length} بنود الملف محل ${n} بنود الحالية (تبقى القديمة في سجل التعديلات). متابعة؟`, `The file's ${rows.length} items will replace the ${n} items now in the program (the old ones stay in the audit log). Continue?`)))) return;
      setBusy(true);
      await call('estimate.import', { rows, fileName: f.name }, t(`استُورد ${rows.length} بنداً`, `${rows.length} items imported`));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>{t('الموازنة', 'Budget')}</h1>
        <div className="row">
          <span className="muted small">{t('بالدولار · الليرة محوّلة بسعر كل سطر', 'In USD · pounds converted at each row’s rate')}</span>
          {edit && <button className="btn" disabled={busy} onClick={doImport}>{t('استيراد التقديرات (Excel)', 'Import estimates (Excel)')}</button>}
          <button className="btn primary" disabled={busy} onClick={doExport}>{t('تصدير إلى Excel', 'Export to Excel')}</button>
        </div>
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
                <th className="n">{t('المتبقي صرفه (تقدير)', 'Still to spend (estimate)')}</th>
                <th className="n">{t('المتوقع كلياً', 'Expected total')}</th>
                <th className="n">{t('الباقي المتوقع', 'Expected left')}</th>
                <th style={{ minWidth: 150 }}>{t('المستعمل المتوقع', 'Expected used')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = l.budget ? l.expected / l.budget : l.expected ? Infinity : 0;
                const isOpen = open === l.heading.id;
                return (
                  <Fragment key={l.heading.id}>
                    <tr onClick={() => setOpen(isOpen ? null : l.heading.id)} style={{ cursor: 'pointer' }} title={t('اضغط لترى الأنواع والتقديرات', 'Click for the kinds and the estimates')}>
                      <td className="code">{l.heading.code}</td>
                      <td>{isOpen ? '▾ ' : '▸ '}{l.heading.name}</td>
                      <td className="n">{l.budget ? fmtUsd(l.budget) : '—'}</td>
                      <td className="n">{fmtUsd(l.usd)}</td>
                      <td className="n">{fmtUsd(l.conv)}</td>
                      <td className="n"><b>{fmtUsd(l.total)}</b></td>
                      <td className="n" style={red(l.rest)}>{l.budget ? fmtUsd(l.rest) : '—'}</td>
                      <td className="n">{l.still ? fmtUsd(l.still) : '—'}{l.postponed ? <span className="muted small"> (+{fmtUsd(l.postponed)} {t('مؤجل', 'postponed')})</span> : null}</td>
                      <td className="n"><b>{fmtUsd(l.expected)}</b></td>
                      <td className="n" style={red(l.expectedLeft)}>{l.budget ? fmtUsd(l.expectedLeft) : '—'}</td>
                      <td>
                        {l.budget ? (
                          <div className="bar-track">
                            <div className="bar-fill" style={{ width: `${Math.min(100, p * 100)}%`, maxWidth: 100, background: band(p) }} />
                            <span className="bar-value">{fmtPct(p)}</span>
                          </div>
                        ) : l.expected ? <span className="muted small">{t('بلا موازنة', 'no budget')}</span> : null}
                      </td>
                    </tr>
                    {isOpen && l.byLine.map((x) => (
                      <tr key={x.line.id} className="off">
                        <td className="code">{x.line.code}</td>
                        <td style={{ paddingInlineStart: 28 }}>{x.line.name}</td>
                        <td /><td /><td />
                        <td className="n">{fmtUsd(x.total)}</td>
                        <td colSpan={5} className="muted small">{l.total ? fmtPct(x.total / l.total) : ''}</td>
                      </tr>
                    ))}
                    {isOpen && (
                      <tr>
                        <td />
                        <td colSpan={10}>
                          <Estimates headingId={l.heading.id} items={l.items} edit={edit} call={call} />
                        </td>
                      </tr>
                    )}
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
                <td className="n" style={red(budget - total)}>{fmtUsd(budget - total)}</td>
                <td className="n">{fmtUsd(sum((x) => x.still))}{sum((x) => x.postponed) ? <span className="muted small"> (+{fmtUsd(sum((x) => x.postponed))})</span> : null}</td>
                <td className="n">{fmtUsd(expected)}</td>
                <td className="n" style={red(budget - expected)}>{fmtUsd(budget - expected)}</td>
                <td>{budget ? fmtPct(expected / budget) : ''}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small">
          {t('المتوقع كلياً = المصروف + المتبقي صرفه. البنود المؤجلة تظهر ولا تُحسب. التصريف ليس صرفاً. الأسطر الملغاة بلا مبلغ.',
            'Expected total = spent + still to spend. Postponed items are shown, not counted. An exchange is not spending. Cancelled rows hold no amount.')}
        </p>
      </div>
    </>
  );
}

/** The items still to come on one heading: add, change, postpone, remove (USD only). */
function Estimates({ headingId, items, edit, call }: {
  headingId: number; items: EstimateItem[]; edit: boolean; call: (name: string, args: unknown, done?: string) => Promise<boolean>;
}) {
  const [desc, setDesc] = useState('');
  const [usd, setUsd] = useState('');
  const save = (e: EstimateItem, patch: Partial<EstimateItem>) => call('estimate.save', { ...e, ...patch, heading_id: headingId });
  const add = async () => {
    const amount = parseAmount(usd || '0');
    if (Number.isNaN(amount)) return toast(t('المبلغ غير مفهوم', 'The amount is not a number'), true);
    if (await call('estimate.save', { heading_id: headingId, description: desc, amount_usd: amount, postponed: 0 })) {
      setDesc('');
      setUsd('');
    }
  };
  return (
    <div style={{ padding: '6px 0 10px' }}>
      <b className="small">{t('المتبقي صرفه (تقدير، بالدولار)', 'Still to spend (estimate, USD)')}</b>
      <table className="t" style={{ marginTop: 6 }}>
        <tbody>
          {!items.length && <tr><td className="muted small">{t('لا تقديرات بعد', 'No estimates yet')}</td></tr>}
          {items.map((e) => (
            <tr key={e.id} className={e.postponed ? 'off' : ''}>
              <td style={{ width: '60%' }}>
                {edit ? <input className="inp" defaultValue={e.description} key={`d${e.id}|${e.description}`}
                  onBlur={(x) => x.target.value.trim() !== e.description && void save(e, { description: x.target.value })} /> : e.description}
              </td>
              <td className="n" style={{ width: 140 }}>
                {edit ? <input className="inp num" inputMode="decimal" defaultValue={e.amount_usd} key={`a${e.id}|${e.amount_usd}`}
                  onBlur={(x) => {
                    const v = parseAmount(x.target.value || '0');
                    if (Number.isNaN(v)) return toast(t('المبلغ غير مفهوم', 'The amount is not a number'), true);
                    if (v !== e.amount_usd) void save(e, { amount_usd: v });
                  }} /> : fmtUsd(e.amount_usd)}
              </td>
              <td className="nowrap">
                <label className="row small">
                  <input type="checkbox" disabled={!edit} checked={!!e.postponed} onChange={(x) => void save(e, { postponed: x.target.checked ? 1 : 0 })} /> {t('مؤجل', 'Postponed')}
                </label>
              </td>
              <td>{edit && <button className="btn small ghost" title={t('حذف', 'Remove')} onClick={async () => {
                if (await confirmBox(t(`حذف «${e.description}»؟`, `Remove "${e.description}"?`))) void call('estimate.delete', { id: e.id });
              }}>✕</button>}</td>
            </tr>
          ))}
          {edit && (
            <tr>
              <td><input className="inp" placeholder={t('بند جديد…', 'New item…')} value={desc} onChange={(x) => setDesc(x.target.value)} onKeyDown={(x) => x.key === 'Enter' && desc.trim() && void add()} /></td>
              <td><input className="inp num" inputMode="decimal" placeholder="USD" value={usd} onChange={(x) => setUsd(x.target.value)} onKeyDown={(x) => x.key === 'Enter' && desc.trim() && void add()} /></td>
              <td colSpan={2}><button className="btn small primary" disabled={!desc.trim()} onClick={add}>＋ {t('إضافة', 'Add')}</button></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
