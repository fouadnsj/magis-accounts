// The staff list for the budget (Fouad, 30 October 2026): HR makes the list of the staff, finance puts it in the
// budget. Built from the agreements (and the changes of the year), in the columns of the salary sheet, one sheet per
// centre. No names: positions, how many people, how many times a year, the monthly amount, the total.
import { useEffect, useState } from 'react';
import ExcelJS from 'exceljs';
import type { Session } from '../../state';
import { saveFile } from '../../platform';
import { t3 } from '../../community/ui/text';
import type { HrData } from '../hr';
import type { HrBudgetRow } from '../payOps';
import { centreOf, centreVars, fail, markOf, usd } from './common';

export function BudgetListPage({ s, hr }: { s: Session; hr: HrData }) {
  const [year, setYear] = useState(new Date().getFullYear() + 1);
  const [data, setData] = useState<{ rows: HrBudgetRow[]; paymentsPerYear: number } | null>(null);
  useEffect(() => { setData(null); s.api.call('hr.budget.staff', { year }).then(setData).catch(fail); }, [s, year]);
  const centres = [...new Set((data?.rows ?? []).map((r) => r.centre ?? ''))];
  const download = async () => {
    if (!data) return;
    const wb = new ExcelJS.Workbook();
    for (const c of centres) {
      const ws = wb.addWorksheet((c || 'No centre').slice(0, 31));
      ws.addRow([`${c || 'No centre'} · staff ${year}`]).font = { bold: true, size: 13 };
      ws.addRow([`Made by HR from the agreements; ${data.paymentsPerYear} payments a year (the 13th is instead of social security). No names.`]).font = { italic: true, color: { argb: 'FF8A8577' } };
      ws.addRow([]);
      const head = ws.addRow(['Budget line', 'Unit', 'Quantity', 'Times per year', 'Budget (monthly USD)', 'Total (USD)']);
      head.font = { bold: true };
      head.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEAE0' } }; });
      const first = ws.rowCount + 1;
      for (const r of data.rows.filter((x) => (x.centre ?? '') === c)) {
        const n = ws.rowCount + 1;
        ws.addRow([r.position, 'person', r.people, r.times, r.monthly, { formula: `C${n}*D${n}*E${n}`, result: r.total }]);
      }
      const last = ws.rowCount;
      ws.addRow(['Total', '', { formula: `SUM(C${first}:C${last})` }, '', '', { formula: `SUM(F${first}:F${last})`, result: data.rows.filter((x) => (x.centre ?? '') === c).reduce((a, r) => a + r.total, 0) }]).font = { bold: true };
      ws.columns = [{ width: 28 }, { width: 10 }, { width: 10 }, { width: 15 }, { width: 22 }, { width: 16 }];
      ws.getColumn(5).numFmt = '#,##0.00';
      ws.getColumn(6).numFmt = '#,##0.00';
    }
    await saveFile(`Staff-for-the-budget-${year}.xlsx`, ['xlsx'], new Uint8Array(await wb.xlsx.writeBuffer()), 'Excel');
  };
  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('من الموارد البشرية إلى المالية', 'From HR to finance', 'Des RH aux finances')}</div><h1>{t3('قائمة الفريق للموازنة', 'Staff list for the budget', 'Liste du personnel pour le budget')}</h1></div>
        <div className="desk-filters">
          <input type="number" style={{ width: 90 }} value={year} onChange={(e) => setYear(Number(e.target.value))} />
          <button className="btn gold" disabled={!data?.rows.length} onClick={download}>{t3('تنزيل Excel للمالية', 'Download Excel for finance', 'Télécharger Excel pour les finances')}</button>
        </div>
      </div>
      <p className="muted small">{t3('تُبنى من الاتفاقيات وتغييرات السنة، بأعمدة جدول الرواتب. لا أسماء: الوظيفة، عدد الأشخاص، عدد المرات في السنة (الأشهر والدفعة الثالثة عشرة بالنسبة)، المبلغ الشهري، المجموع.', 'Built from the agreements and the changes of the year, in the columns of the salary sheet. No names: the position, how many people, how many times a year (the months, and the 13th payment in proportion), the monthly amount, the total.', "Construite à partir des accords et des changements de l'année, avec les colonnes de la feuille des salaires. Sans noms : le poste, combien de personnes, combien de fois par an (les mois, et le 13e au prorata), le montant mensuel, le total.")}</p>
      {!data ? <p className="muted">…</p> : !data.rows.length ? <p className="muted">{t3('لا اتفاقيات في هذه السنة.', 'No agreements in this year.', "Pas d'accords cette année.")}</p> : centres.map((c) => {
        const { key } = centreOf(hr, { centre: c || null });
        const rows = data.rows.filter((x) => (x.centre ?? '') === c);
        return (
          <div key={c} className="hr-panel" style={{ ...centreVars(key), borderTop: '4px solid var(--centre)', marginBottom: 14 }}>
            <div className="row" style={{ gap: 10, marginBottom: 6 }}><img src={markOf(key)} alt="" style={{ height: 30 }} /><b>{c || t3('بلا مركز', 'No centre', 'Sans centre')}</b></div>
            <table className="desk-table">
              <thead><tr><th>{t3('بند الموازنة', 'Budget line', 'Ligne budgétaire')}</th><th className="n">{t3('العدد', 'Quantity', 'Quantité')}</th><th className="n">{t3('مرات في السنة', 'Times per year', 'Fois par an')}</th><th className="n">{t3('شهرياً', 'Monthly', 'Mensuel')}</th><th className="n">{t3('المجموع', 'Total', 'Total')}</th></tr></thead>
              <tbody>
                {rows.map((r, i) => <tr key={i}><td>{r.position}{r.months < 12 ? <span className="muted small"> · {r.months} {t3('أشهر', 'months', 'mois')}</span> : null}</td><td className="n">{r.people}</td><td className="n">{r.times}</td><td className="n">{usd(r.monthly)}</td><td className="n"><b>{usd(r.total)}</b></td></tr>)}
                <tr><td><b>{t3('المجموع', 'Total', 'Total')}</b></td><td className="n"><b>{rows.reduce((a, r) => a + r.people, 0)}</b></td><td /><td /><td className="n"><b>{usd(rows.reduce((a, r) => a + r.total, 0))}</b></td></tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
