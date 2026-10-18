// The expenses to claim from the Province (health, a scholastic's stay, asked by the
// Provincial, other), by quarter or year, with their totals: what the community claims.
import { useMemo, useState } from 'react';
import { errText, toast, todayIso } from '../../../ui/kit';
import { CURS, quarterOf, yearOf, type Money } from '../../domain';
import type { ClaimReason } from '../../chart';
import { useCty, bookName } from '../CtyApp';
import { accName, curName, money, t3, yearName } from '../text';
import { exportExcel } from './excel';

export const claimName = (r: ClaimReason | null): string =>
  r === 'health' ? t3('صحة', 'Health', 'Santé')
    : r === 'scholastic' ? t3('إقامة دارس', 'A scholastic’s stay', 'Séjour d’un scolastique')
      : r === 'provincial' ? t3('بطلب من الإقليمي', 'Asked by the Provincial', 'Demandé par le Provincial')
        : t3('غير ذلك', 'Other', 'Autre');

export function Claims() {
  const { d, write } = useCty();
  const [year, setYear] = useState(yearOf(todayIso()));
  const [q, setQ] = useState<number>(0); // 0 = whole year
  const rows = useMemo(() => d.entries.filter((e) => e.type === 'Exp' && e.claim && yearOf(e.date) === year && (!q || quarterOf(e.date) === q)), [d.entries, year, q]);
  const byReason = useMemo(() => {
    const m = new Map<ClaimReason, Money>();
    for (const e of rows) {
      const t = m.get(e.claim!) ?? { LOC: 0, USD: 0, EUR: 0 };
      t[e.cur] += e.amount;
      m.set(e.claim!, t);
    }
    return m;
  }, [rows]);

  const exportIt = async () => {
    try {
      await exportExcel(`claims-${year}${q ? `-T${q}` : ''}.xlsx`, [{
        name: 'Claims',
        header: [t3('التاريخ', 'Date', 'Date'), t3('الدفتر', 'Book', 'Compte'), t3('السبب', 'Reason', 'Motif'), t3('الرمز', 'Code', 'Code'), t3('البند', 'Line', 'Ligne'), t3('ملاحظة', 'Note', 'Note'), ...CURS.map((c) => curName(c, d.local))],
        rows: rows.map((e) => {
          const a = d.accounts.find((x) => x.id === e.account_id);
          return [e.date, bookName(d.books.find((b) => b.id === e.book_id)), claimName(e.claim), a?.code ?? '', accName(a), [e.note, e.claim_note].filter(Boolean).join(' · '), ...CURS.map((c) => (e.cur === c ? e.amount : null))];
        }),
        money: [6, 7, 8],
      }]);
    } catch (e) { toast(errText(e), true); }
  };

  return (
    <>
      <div className="desk-head">
        <h1>{t3('المطالبات من الإقليم', 'Claims from the Province', 'Réclamations à la Province')}</h1>
        <button className="btn" onClick={exportIt}>Excel</button>
      </div>
      <div className="desk-filters">
        <button className="btn" onClick={() => setYear(year - 1)}>‹</button><span>{yearName(year)}</span><button className="btn" onClick={() => setYear(year + 1)}>›</button>
        <select value={q} onChange={(e) => setQ(Number(e.target.value))}>
          <option value={0}>{t3('السنة كلها', 'Whole year', 'Toute l’année')}</option>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>T{n}</option>)}
        </select>
      </div>
      <div className="desk-cards">
        {[...byReason.entries()].map(([r, t]) => (
          <div key={r} className="cty-card desk-card">
            <div className="cty-label">{claimName(r)}</div>
            {CURS.filter((c) => t[c]).map((c) => <div key={c} className="desk-bal"><b>{money(t[c], c)}</b> <span className="muted">{curName(c, d.local)}</span></div>)}
          </div>
        ))}
      </div>
      <div className="cty-card desk-scroll">
        {rows.length === 0 ? <p className="muted">{t3('لا شيء للمطالبة.', 'Nothing to claim.', 'Rien à réclamer.')}</p> : (
          <table className="desk-table">
            <thead><tr><th>{t3('التاريخ', 'Date', 'Date')}</th><th>{t3('الدفتر', 'Book', 'Compte')}</th><th>{t3('السبب', 'Reason', 'Motif')}</th><th>{t3('البند', 'Line', 'Ligne')}</th><th>{t3('ملاحظة', 'Note', 'Note')}</th>{CURS.map((c) => <th key={c} className="num">{curName(c, d.local)}</th>)}</tr></thead>
            <tbody>
              {rows.map((e) => {
                const a = d.accounts.find((x) => x.id === e.account_id);
                return (
                  <tr key={e.id} className="click" onClick={() => write({ kind: e.type, edit: e })}>
                    <td>{e.date}</td><td>{bookName(d.books.find((b) => b.id === e.book_id))}</td><td>{claimName(e.claim)}</td>
                    <td>{a?.code} {accName(a)}</td><td className="desk-note">{[e.note, e.claim_note].filter(Boolean).join(' · ')}</td>
                    {CURS.map((c) => <td key={c} className="num">{e.cur === c ? money(e.amount, c) : ''}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted small">{t3('قبول المطالبات أو رفضها يكون عند مدبّر البلد (المرحلة التالية).', "Accepting or refusing claims is done by the country econome (next step).", "L'acceptation ou le refus des réclamations se fait chez l'économe du pays (étape suivante).")}</p>
    </>
  );
}
