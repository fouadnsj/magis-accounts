// Payments and refunds of the Calendar waiting for the books (M1 of the review before 0.13.0). The Calendar records each
// payment (receipt H2026-0001) and each refund (HR2026-0001) as a suggestion; here the people who write entries turn it into
// an entry. They see only what an entry needs: the number, the date, the amount, the group and which way the money went
// (never the prices, the contacts or the notes of the booking). The entry opens already filled; the number goes in the
// Receipt box, which is how the entry and the payment stay together.
import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { m, tx } from '../i18n';
import type { PayWaiting } from '../hosting/calops';
import { fmtDate } from './kit';
import { useNav } from './Shell';

const L = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));

/** the money of one payment, as "1,250 USD" */
const amountText = (p: PayWaiting) => `${p.currency === 'SYP' ? Math.round(p.amount).toLocaleString('en') : p.amount.toLocaleString('en', { maximumFractionDigits: 2 })} ${p.currency}`;

/** the list of what waits, for whoever writes entries (null for everyone else); read again each time the entries change */
export function usePaysWaiting(): { rows: PayWaiting[]; ever: boolean } | null {
  const { s, d, can } = useApp();
  const may = can('register.edit') || can('register.main');
  const [x, setX] = useState<{ rows: PayWaiting[]; ever: boolean } | null>(null);
  useEffect(() => {
    if (!may) { setX(null); return undefined; }
    let live = true;
    s.api.call('cal.pay.waiting').then((r) => { if (live) setX(r); }).catch(() => { if (live) setX(null); });
    return () => { live = false; };
  }, [s.api, s.profile.id, may, d.rows]);
  return x;
}

/** the notice on the Accounts home */
export function PaysWaitingNotice() {
  const nav = useNav();
  const w = usePaysWaiting();
  if (!w || !w.rows.length) return null;
  const n = w.rows.length;
  return (
    <div className="alert warn row" style={{ justifyContent: 'space-between' }}>
      <span>{L(`${n} مدفوعات تنتظر الدفاتر`, `${n} payment${n === 1 ? '' : 's'} waiting for the books`, `${n} paiement${n === 1 ? '' : 's'} en attente des livres`)}</span>
      <button className="btn small" onClick={() => nav.go('paywait')}>{L('عرضها', 'Show them', 'Les voir')}</button>
    </div>
  );
}

/** the page of the Accounts menu */
export function PaysWaitingPage() {
  const nav = useNav();
  const w = usePaysWaiting();
  const rows = w?.rows ?? [];
  const make = (p: PayWaiting) => nav.entry({
    preset: true, type: p.kind === 'back' ? 'Exp' : 'Income', date: p.paid_on,
    prefill: { amount: p.amount, currency: p.currency, explanation: `${p.kind === 'back' ? 'Given back · مُعاد: ' : ''}${p.name} · ${p.code}`.trim(), receipt: p.receipt_no, locked: true },
  });
  return (
    <>
      <div className="page-head"><h1>{L('مدفوعات تنتظر الدفاتر', 'Payments waiting for the books', 'Paiements en attente des livres')}</h1></div>
      <p className="small muted">{L(
        'كل دفعة قُبضت وكل مبلغ أُعيد في التقويم يظهر هنا حتى تجعله قيداً. اضغط «اجعلها قيداً»: يُفتح القيد وفيه التاريخ والمبلغ والعملة ورقم الوصل من الدفعة؛ تختار أنت الدفتر والبند. رقم الوصل هو الذي يربط القيد بالدفعة.',
        'Each payment received and each amount given back in the Calendar shows here until it is an entry. Press "Make the entry": the entry opens with the date, the amount, the currency and the receipt number taken from the payment; you choose the book and the line. The receipt number is what keeps the entry and the payment together.',
        'Chaque paiement reçu et chaque somme rendue dans le Calendrier apparaît ici jusqu’à ce qu’il devienne une écriture. Appuyez sur « Faire l’écriture » : elle s’ouvre avec la date, le montant, la devise et le numéro du reçu pris du paiement ; vous choisissez la caisse et la ligne. Le numéro du reçu garde l’écriture et le paiement ensemble.')}</p>
      <div className="tbl-wrap"><table className="t small">
        <thead><tr><th>{L('الوصل', 'Receipt', 'Reçu')}</th><th>{L('التاريخ', 'Date', 'Date')}</th><th>{L('المجموعة', 'Group', 'Groupe')}</th><th>{L('النوع', 'Kind', 'Sorte')}</th><th className="n">{L('المبلغ', 'Amount', 'Montant')}</th><th /></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.receipt_no}>
              <td dir="ltr">{p.receipt_no}</td><td>{fmtDate(p.paid_on)}</td><td>{p.name} <small className="muted" dir="ltr">{p.code}</small></td>
              <td>{p.kind === 'back' ? L('مُعاد (مصروف)', 'Given back (expense)', 'Rendu (dépense)') : L('مقبوض (دخل)', 'Received (income)', 'Reçu (recette)')}</td>
              <td className="n" dir="ltr">{amountText(p)}</td>
              <td><button className="btn primary small" onClick={() => make(p)}>{L('اجعلها قيداً', 'Make the entry', 'Faire l’écriture')}</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="muted">✓ {L('لا شيء ينتظر', 'Nothing is waiting', 'Rien n’attend')}</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
