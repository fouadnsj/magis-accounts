// The community's consolidated month, and sending it to the country econome.
// 1. See the whole community's month: members and house together, by code, the cash,
//    the bank, the économat, and the claims: exactly what the file will hold.
// 2. Close the community's month (every book must be closed).
// 3. Make the file and send it to the country econome.
// Below: bring in the country econome's return file.
import { useEffect, useState } from 'react';
import { errText, toast, todayIso } from '../../../ui/kit';
import { pickFile, saveFile } from '../../../platform';
import { CURS, periodMonths, prevMonth, type Money } from '../../domain';
import { MONTH_BUNDLE, type MonthBundle, type MonthFile, type ReturnFile } from '../../files';
import { useCty, bookLabel, bookName } from '../CtyApp';
import { accName, curName, money, monthName, t3 } from '../text';
import { claimName } from './Claims';
import { exportExcel } from './excel';

export function SendMonth() {
  const { d, s, reload, can } = useCty();
  const today = todayIso();
  const [ym, setYm] = useState(prevMonth(today.slice(0, 7)));
  const [file, setFile] = useState<MonthFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const period = periodMonths(ym, d.settings.closePeriod);
  const quarterly = period.length > 1;
  const closed = d.closed.includes(period[period.length - 1]);
  useEffect(() => {
    setErr(null);
    s.api.call('cty.month.consolidated', { ym }).then(setFile).catch((e) => setErr(errText(e)));
  }, [s, ym, d]);

  const books = d.books.filter((b) => b.active && b.cty_kind != null);
  const used = (id: number) => d.entries.some((e) => (e.book_id === id || e.to_book_id === id) && e.date.slice(0, 7) <= ym);
  const status = books.filter((b) => used(b.id)).map((b) => ({ b, m: d.months.find((x) => x.book_id === b.id && x.ym === period[period.length - 1]) }));
  const allClosed = status.every((x) => x.m);
  const accByCode = new Map(d.accounts.map((a) => [a.code, a]));
  const codes = file ? Object.keys(file.totals).sort() : [];

  const closeIt = async () => {
    try {
      await s.api.call('cty.community.close', { ym });
      await reload();
      toast(t3('أُغلق شهر الجماعة ✓', "The community's month is closed ✓", 'Le mois de la communauté est clôturé ✓'));
    } catch (e) { toast(errText(e), true); }
  };
  const makeFile = async () => {
    try {
      // a quarter: its three months in one file
      const fs: MonthFile[] = [];
      for (const m of period) fs.push(await s.api.call('cty.month.file', { ym: m }));
      const out: MonthFile | MonthBundle = fs.length === 1 ? fs[0] : { kind: MONTH_BUNDLE, version: 1, files: fs };
      const name = `${(fs[0].community.name || 'community').replace(/[^\w\u0600-\u06FF -]/g, '').trim()}-${period.length > 1 ? `${period[0]}_${period[2]}` : ym}.json`;
      await saveFile(name, ['json'], new TextEncoder().encode(JSON.stringify(out, null, 1)), name);
      toast(t3('الملف جاهز: أرسله إلى قيّم البلد', 'The file is ready: send it to the country econome', "Le fichier est prêt : envoyez-le à l'économe du pays"));
    } catch (e) { toast(errText(e), true); }
  };
  const bringReturn = async () => {
    const f = await pickFile(['json'], t3('ملف الرجوع من قيّم البلد', "The country econome's return file", "Le fichier de retour de l'économe du pays"));
    if (!f) return;
    try {
      const r = await s.api.call('cty.return.import', { file: JSON.parse(new TextDecoder().decode(f.bytes)) as ReturnFile });
      await reload();
      toast(t3(`✓ ${r.decisions} قراراً، ${r.lines} سطراً في الحساب`, `✓ ${r.decisions} decisions, ${r.lines} lines in the account`, `✓ ${r.decisions} décisions, ${r.lines} lignes dans le compte`));
    } catch (e) { toast(errText(e), true); }
  };
  const exportIt = async () => {
    if (!file) return;
    try {
      await exportExcel(`consolidated-${ym}.xlsx`, [{
        name: ym,
        header: [t3('الرمز', 'Code', 'Code'), t3('البند', 'Line', 'Ligne'), ...CURS.map((c) => curName(c, d.local))],
        rows: codes.map((k) => [k, accName(accByCode.get(k)), ...CURS.map((c) => file.totals[k][c] || null)]),
        money: [2, 3, 4],
      }]);
    } catch (e) { toast(errText(e), true); }
  };

  const Line = ({ label, v, cls }: { label: string; v: Money; cls?: string }) => (
    <tr className={cls}><td /><td>{label}</td>{CURS.map((c) => <td key={c} className="num">{v[c] ? money(v[c], c) : ''}</td>)}</tr>
  );

  return (
    <>
      <div className="desk-head">
        <h1>{t3('شهر الجماعة الموحّد', "The community's consolidated month", 'Le mois consolidé de la communauté')}</h1>
        <div className="row">
          <button className="btn" onClick={exportIt} disabled={!file}>Excel</button>
          <button className="btn" onClick={() => window.print()}>{t3('طباعة', 'Print', 'Imprimer')}</button>
        </div>
      </div>
      <div className="desk-filters">
        <button className="btn" onClick={() => setYm(prevMonth(ym))}>‹</button>
        <span><b>{monthName(ym)}</b></span>
        <button className="btn" disabled={ym >= today.slice(0, 7)} onClick={() => setYm(next(ym))}>›</button>
        {closed ? <span className="ok">✓ {t3('شهر الجماعة مغلق', "The community's month is closed", 'Le mois de la communauté est clôturé')}</span> : <span className="muted">{t3('غير مغلق بعد', 'not closed yet', 'pas encore clôturé')}</span>}
      </div>
      {err && <div className="alert err">{err}</div>}

      <div className="desk-two">
        <div className="cty-card">
          <div className="cty-label">{t3('الأعضاء والبيت معاً', 'Members and house together', 'Membres et maison ensemble')}{file ? ` · ${file.members} ${t3('أعضاء', 'members', 'membres')}` : ''}</div>
          {file && (
            <table className="desk-table fdc">
              <thead><tr><th /><th /><th className="num">{curName('LOC', d.local)}</th><th className="num">$</th><th className="num">€</th></tr></thead>
              <tbody>
                <Line label={t3('رصيد سابق', 'Carried over', 'Report')} v={file.cash.carried} />
                <Line label={t3('من القيّم', 'Received from the econome', "Reçu de l'économe")} v={file.cash.received} />
                <tr className="fdc-part"><td colSpan={5}>{t3('الدخل والنفقات حسب الرمز', 'Income and expenses by code', 'Revenus et dépenses par code')}</td></tr>
                {codes.map((k) => (
                  <tr key={k}><td className="muted small">{k}</td><td>{accName(accByCode.get(k))}</td>{CURS.map((c) => <td key={c} className="num">{file.totals[k][c] ? money(file.totals[k][c], c) : ''}</td>)}</tr>
                ))}
                {codes.length === 0 && <tr><td /><td className="muted">{t3('لا شيء هذا الشهر.', 'Nothing this month.', 'Rien ce mois-ci.')}</td><td /><td /><td /></tr>}
                <Line label={t3('مجموع الدخل', 'Total income', 'Total revenus')} v={file.cash.income} cls="fdc-total" />
                <Line label={t3('مجموع النفقات', 'Total expenses', 'Total dépenses')} v={file.cash.expenses} cls="fdc-total" />
                <Line label={t3('أعيد إلى القيّم', 'Given back to the econome', "Rendu à l'économe")} v={file.cash.givenBack} />
                <Line label={t3('في أيدي الأعضاء والبيت', 'Held by the members and the house', 'Gardé par les membres et la maison')} v={file.cash.kept} cls="fdc-total" />
                <tr className="fdc-part"><td colSpan={5}>{t3('دفاتر القيّم في آخر الشهر', "The econome's books at the end of the month", "Les comptes de l'économe en fin de mois")}</td></tr>
                <Line label={t3('الصندوق', 'Cash', 'Caisse')} v={file.books.cash} />
                <Line label={t3('المصرف', 'Bank', 'Banque')} v={file.books.bank} />
                <Line label={t3('الإيكونوماتو', 'Économat', 'Économat')} v={file.books.economat} />
              </tbody>
            </table>
          )}
        </div>
        <div>
          <div className="cty-card">
            <div className="cty-label">{t3('هل أُغلقت كل الدفاتر؟', 'Is every book closed?', 'Chaque compte est-il clôturé ?')}</div>
            <table className="desk-table small">
              <tbody>
                {status.map(({ b, m }) => (
                  <tr key={b.id}><td>{b.cty_kind === 'personal' ? bookName(b) : bookLabel(b)}</td><td>{m ? <span className="ok">✓</span> : <span className="desk-alert">{t3('مفتوح', 'open', 'ouvert')}</span>}</td></tr>
                ))}
              </tbody>
            </table>
            {quarterly && <p className="muted small">{t3('الإغلاق كل فصل', 'Closing every quarter', 'Clôture chaque trimestre')}: {monthName(period[0], true)} – {monthName(period[2])}</p>}
            {!closed && can('month.close') && <button className="btn primary cty-wide" disabled={!allClosed} onClick={closeIt}>{quarterly ? t3('أغلق فصل الجماعة', "Close the community's quarter", 'Clôturer le trimestre de la communauté') : t3('أغلق شهر الجماعة', "Close the community's month", 'Clôturer le mois de la communauté')}</button>}
            {closed && can('month.close') && <button className="btn primary cty-wide" onClick={makeFile}>{t3('اصنع الملف لقيّم البلد', 'Make the file for the country econome', "Faire le fichier pour l'économe du pays")}{quarterly ? ` (${t3('3 أشهر', '3 months', '3 mois')})` : ''}</button>}
            <p className="muted small">{t3('الملف فيه المجاميع حسب الرمز فقط، لا تفاصيل أي يسوعي.', "The file holds totals by code only, no Jesuit's detail.", "Le fichier ne contient que des totaux par code, aucun détail d'un jésuite.")}</p>
          </div>
          {file && file.claims.length > 0 && (
            <div className="cty-card">
              <div className="cty-label">↺ {t3('المطالبات في هذا الملف', 'Claims in this file', 'Réclamations dans ce fichier')}</div>
              <table className="desk-table small">
                <tbody>
                  {file.claims.map((cl) => (
                    <tr key={cl.id}><td>{cl.date.slice(8, 10)}/{cl.date.slice(5, 7)}</td><td>{claimName(cl.reason as never)}</td><td>{cl.code}</td><td className="num">{money(cl.amount, cl.cur)} {curName(cl.cur, d.local)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {can('month.close') && (
            <div className="cty-card">
              <div className="cty-label">{t3('من قيّم البلد', 'From the country econome', "De l'économe du pays")}</div>
              <p className="muted small">{d.lastReturnAt ? `${t3('آخر ملف رجوع', 'Last return file', 'Dernier fichier de retour')}: ${d.lastReturnAt.slice(0, 10)}` : t3('لم يصل ملف رجوع بعد.', 'No return file yet.', 'Pas encore de fichier de retour.')}</p>
              <button className="btn" onClick={bringReturn}>{t3('أدخل ملف الرجوع…', 'Bring in the return file…', 'Importer le fichier de retour…')}</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const next = (ym: string) => {
  const [y, mo] = ym.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
