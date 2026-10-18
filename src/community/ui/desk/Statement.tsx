// The community's account at the économat, as the country econome keeps it (from his
// last return file): claims accepted, charges between communities, payments, cotisations.
// Each line visible; each currency apart. > 0 the Province owes the community, < 0 it owes.
import { CURS, yearOf, type Money } from '../../domain';
import { useCty } from '../CtyApp';
import { curName, money, t3, yearName } from '../text';

export const kindName = (k: string): string =>
  k === 'claim' ? t3('مطالبة مقبولة', 'Claim accepted', 'Réclamation acceptée')
    : k === 'host' ? t3('استضافة لجماعة أخرى', 'Hosting for another community', "Accueil pour une autre communauté")
      : k === 'charged' ? t3('تكلفة من جماعة أخرى', 'Charged by another community', 'Facturé par une autre communauté')
        : k === 'paid_by_cty' ? t3('دفعته الجماعة', 'Paid by the community', 'Payé par la communauté')
          : k === 'paid_to_cty' ? t3('دُفع للجماعة', 'Paid to the community', 'Payé à la communauté')
            : k === 'cotisation' ? t3('مساهمة', 'Cotisation', 'Cotisation') : t3('غير ذلك', 'Other', 'Autre');

export function Statement() {
  const { d } = useCty();
  const total: Money = { LOC: 0, USD: 0, EUR: 0 };
  for (const l of d.statement) total[l.cur] += l.amount;
  const years = [...new Set(d.statement.map((l) => yearOf(l.date)))].sort((a, b) => b - a);
  return (
    <>
      <div className="desk-head"><h1>{t3('الحساب عند الإيكونوماتو', 'Account at the économat', "Compte à l'économat")}</h1></div>
      <p className="muted">{d.lastReturnAt ? `${t3('كما أرسله مدبّر البلد في', 'As the country econome sent it on', "Tel que l'économe du pays l'a envoyé le")} ${d.lastReturnAt.slice(0, 10)}.` : t3('لم يصل ملف رجوع بعد (صفحة «شهر الجماعة»).', "No return file yet (page “Consolidated month”).", 'Pas encore de fichier de retour (page « Mois consolidé »).')}</p>
      <div className="desk-cards">
        {CURS.filter((c) => c === 'LOC' || total[c]).map((c) => (
          <div key={c} className="cty-card desk-card">
            <div className="cty-label">{curName(c, d.local)}</div>
            <div className="desk-bal"><b className={total[c] < 0 ? 'desk-alert' : ''}>{money(total[c], c)}</b></div>
            <div className="small muted">{total[c] > 0 ? t3('للجماعة', 'in the community’s favour', 'en faveur de la communauté') : total[c] < 0 ? t3('على الجماعة أن تدفع', 'the community must pay', 'la communauté doit payer') : t3('متوازن', 'balanced', 'équilibré')}</div>
          </div>
        ))}
      </div>
      {years.map((y) => (
        <div key={y} className="cty-card desk-scroll">
          <div className="cty-label">{yearName(y)}</div>
          <table className="desk-table">
            <thead><tr><th>{t3('التاريخ', 'Date', 'Date')}</th><th>{t3('النوع', 'Kind', 'Type')}</th><th>{t3('الشرح', 'What', 'Quoi')}</th>{CURS.map((c) => <th key={c} className="num">{curName(c, d.local)}</th>)}</tr></thead>
            <tbody>
              {d.statement.filter((l) => yearOf(l.date) === y).map((l) => (
                <tr key={l.id}><td>{l.date}</td><td>{kindName(l.kind)}</td><td className="desk-note">{l.note}</td>{CURS.map((c) => <td key={c} className={`num ${l.cur === c ? (l.amount < 0 ? 'out' : 'in') : ''}`}>{l.cur === c ? money(l.amount, c) : ''}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
