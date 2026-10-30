// The reports of the Superior (Fouad, 30 October 2026): the cost of an hour is private, so it is shown only here, to
// the person who approves the payroll (hr.approve). Every stipend as agreed (pounds or dollars) and its value in
// dollars; the totals are always in dollars, like the budgets.
import ExcelJS from 'exceljs';
import type { Session } from '../../state';
import { saveFile } from '../../platform';
import { todayIso } from '../../ui/kit';
import { t3 } from '../../community/ui/text';
import type { HrData, HrPerson } from '../hr';
import type { HrPayData } from '../payOps';
import { hourlyWithThirteenth, payOn, yearlyCost } from '../pay';
import { TwoNames, centreOf, centreVars, markOf, usd } from './common';

export function ReportsPage({ hr, pd, open }: { s: Session; hr: HrData; pd: HrPayData; open: (p: HrPerson) => void }) {
  const today = todayIso();
  const n = pd.settings.paymentsPerYear;
  const rows = hr.people.filter((p) => p.active).map((p) => {
    const c = payOn(pd, p.id, today);
    return { p, c, centre: p.centre ?? '', position: c?.grade?.name ?? p.role ?? '', with13: c?.monthly != null ? hourlyWithThirteenth(c.monthly, c.weekly, n) : null };
  }).sort((a, b) => a.centre.localeCompare(b.centre) || a.position.localeCompare(b.position));
  const centres = [...new Set(rows.map((r) => r.centre))];
  const sum = (xs: typeof rows) => xs.reduce((a, r) => a + (r.c?.monthly ?? 0), 0);
  const noRate = rows.filter((r) => r.c?.needsRate).length;
  const posName = (x: string) => (x ? (hr.positionsAr[x] ? `${hr.positionsAr[x]} · ${x}` : x) : '—');

  const download = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Stipends');
    ws.addRow([`Stipends and cost of an hour · ${today}`]).font = { bold: true, size: 13 };
    ws.addRow([`Private (the Superior). Dollar rate: ${pd.settings.rateSyp || '—'} SYP. Cost of an hour = monthly × 12 ÷ (hours a week × 52); with the 13th = monthly × ${n} ÷ (hours a week × 52).`]).font = { italic: true, color: { argb: 'FF8A8577' } };
    ws.addRow([]);
    const head = ws.addRow(['Centre', 'Name', 'Position', 'As agreed', 'Currency', 'Monthly (USD)', 'Hours a week', 'Cost of an hour (USD)', 'With the 13th (USD)', `Yearly ×${n} (USD)`]);
    head.font = { bold: true };
    head.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEAE0' } }; });
    for (const r of rows) {
      ws.addRow([r.centre, [r.p.name_ar, [r.p.first_name, r.p.last_name].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || r.p.name, r.position, r.c?.syp ?? r.c?.monthly ?? null, r.c ? (r.c.syp != null ? 'SYP' : 'USD') : '', r.c?.monthly ?? null, r.c?.weekly ?? null, r.c?.hourly ?? null, r.with13, r.c?.monthly != null ? yearlyCost(r.c.monthly, n) : null]);
    }
    ws.addRow(['Total (USD)', '', '', '', '', sum(rows), '', '', '', yearlyCost(sum(rows), n)]).font = { bold: true };
    ws.columns = [{ width: 16 }, { width: 30 }, { width: 24 }, { width: 14 }, { width: 9 }, { width: 14 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 16 }];
    for (const i of [4, 6, 8, 9, 10]) ws.getColumn(i).numFmt = '#,##0.00';
    await saveFile(`Stipends-report-${today}.xlsx`, ['xlsx'], new Uint8Array(await wb.xlsx.writeBuffer()), 'Excel');
  };

  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('للرئيس فقط', 'For the Superior only', 'Pour le Supérieur seulement')}</div><h1>{t3('التقارير', 'Reports', 'Rapports')}</h1></div>
        <button className="btn" onClick={() => void download()}>⬇ Excel</button>
      </div>
      {noRate > 0 && <p className="desk-alert">{t3(`${noRate} بالليرة ولا سعر دولار: لا يدخلون في المجاميع. اكتب السعر في «سلّم الرواتب ← الإعدادات».`, `${noRate} paid in pounds and no dollar rate: they are not in the totals. Write the rate in "Salary scale → Settings".`, `${noRate} payés en livres sans taux du dollar : hors des totaux. Écrivez le taux dans « Échelle → Réglages ».`)}</p>}
      <div className="hr-people" style={{ marginBottom: 14 }}>
        {centres.map((c) => {
          const xs = rows.filter((r) => r.centre === c);
          const key = xs[0] ? centreOf(hr, xs[0].p).key : 'other';
          return (
            <div key={c} className="hr-card" style={{ ...centreVars(key), cursor: 'default' }}>
              <div className="mark"><img src={markOf(key)} alt="" /></div>
              <div className="body"><b>{c || '—'}</b><div className="meta">{xs.length} {t3('شخصاً', 'people', 'personnes')} · {t3('سنوياً', 'yearly', 'annuel')} {usd(yearlyCost(sum(xs), n))} USD</div></div>
              <div className="amount">{usd(sum(xs))} $</div>
            </div>
          );
        })}
      </div>
      <div className="hr-panel desk-scroll">
        <b>{t3('المكافآت وتكلفة الساعة', 'Stipends and the cost of an hour', 'Gratifications et coût horaire')}</b>
        <table className="desk-table" style={{ marginTop: 6 }}>
          <thead><tr><th /><th>{t3('الاسم', 'Name', 'Nom')}</th><th>{t3('الوظيفة', 'Position', 'Poste')}</th><th className="n">{t3('كما في الاتفاقية', 'As agreed', "Selon l'accord")}</th><th className="n">{t3('شهرياً USD', 'Monthly USD', 'Mensuel USD')}</th><th className="n">{t3('س/أسبوع', 'h/week', 'h/sem')}</th><th className="n">{t3('تكلفة الساعة', 'Cost of an hour', 'Coût horaire')}</th><th className="n">{t3('مع الثالثة عشرة', 'With the 13th', 'Avec le 13e')}</th><th className="n">{t3(`سنوياً ×${n}`, `Yearly ×${n}`, `Annuel ×${n}`)}</th></tr></thead>
          <tbody>
            {rows.map(({ p, c, position, with13 }) => {
              const { key } = centreOf(hr, p);
              return (
                <tr key={p.id} className="click" onClick={() => open(p)} style={centreVars(key)}>
                  <td style={{ width: 30 }}><img src={markOf(key)} alt="" style={{ height: 22 }} /></td>
                  <td><TwoNames p={p} /></td>
                  <td>{posName(position)}</td>
                  <td className="n">{c?.syp != null ? `${usd(c.syp)} SYP` : c?.monthly != null ? `${usd(c.monthly)} USD` : '—'}</td>
                  <td className="n"><b>{c?.monthly != null ? usd(c.monthly) : c?.needsRate ? <span className="desk-alert">{t3('بلا سعر', 'no rate', 'pas de taux')}</span> : '—'}</b></td>
                  <td className="n">{c?.weekly ?? '—'}</td>
                  <td className="n"><b>{usd(c?.hourly)}</b></td>
                  <td className="n">{usd(with13)}</td>
                  <td className="n">{c?.monthly != null ? usd(yearlyCost(c.monthly, n)) : '—'}</td>
                </tr>
              );
            })}
            {rows.length > 0 && <tr><td /><td colSpan={3}><b>{t3('المجموع بالدولار', 'Total in USD', 'Total en USD')}</b></td><td className="n"><b>{usd(sum(rows))}</b></td><td /><td /><td /><td className="n"><b>{usd(yearlyCost(sum(rows), n))}</b></td></tr>}
          </tbody>
        </table>
        <p className="muted small">{t3(`المكافأة بالليرة تُحسب بالدولار بسعر ${usd(pd.settings.rateSyp) || '—'}. تكلفة الساعة = شهري × 12 ÷ (ساعات الأسبوع × 52)؛ مع الثالثة عشرة = شهري × ${n} ÷ (ساعات الأسبوع × 52).`, `A stipend in pounds is counted in dollars at ${usd(pd.settings.rateSyp) || '—'}. Cost of an hour = monthly × 12 ÷ (hours a week × 52); with the 13th = monthly × ${n} ÷ (hours a week × 52).`, `Une gratification en livres est comptée en dollars au taux ${usd(pd.settings.rateSyp) || '—'}. Coût horaire = mensuel × 12 ÷ (heures par semaine × 52) ; avec le 13e = mensuel × ${n} ÷ (heures par semaine × 52).`)}</p>
      </div>
    </>
  );
}
