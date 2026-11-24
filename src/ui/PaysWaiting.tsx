// Payments and refunds of the Calendar waiting for the books (M1 of the review before 0.13.0). The Calendar records each
// payment (receipt H2026-0001) and each refund (HR2026-0001) as a suggestion; here the people who write entries turn it into
// an entry. They see only what an entry needs: the number, the date, the amount, the group and which way the money went
// (never the prices, the contacts or the notes of the booking). The entry opens already filled; the number goes in the
// Receipt box, which is how the entry and the payment stay together.
import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { m, tx } from '../i18n';
import type { PayWaiting } from '../hosting/calops';
import { errText, fmtDate, toast } from './kit';
import { useNav } from './Shell';
import { incomeClassForPay } from '../domain/incomeClass';

const L = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));

/** the money of one payment, as "1,250 USD" */
const amountText = (p: PayWaiting) => `${p.currency === 'SYP' ? Math.round(p.amount).toLocaleString('en') : p.amount.toLocaleString('en', { maximumFractionDigits: 2 })} ${p.currency}`;

/** the list of what waits, for whoever writes entries (null for everyone else); read again each time the entries change */
export function usePaysWaiting(): { rows: PayWaiting[]; ever: boolean; elsewhere: number } | null {
  const { s, d, can } = useApp();
  // the Administrator and the Accountant, and a Book holder who takes the calendar's money (his own book's payments)
  const may = can('register.edit') || can('register.main') || (can('book.own') && can('cal.money') && s.profile.books.length > 0);
  const [x, setX] = useState<{ rows: PayWaiting[]; ever: boolean; elsewhere: number } | null>(null);
  useEffect(() => {
    if (!may) { setX(null); return undefined; }
    let live = true;
    s.api.call('cal.pay.waiting').then((r) => { if (live) setX(r); }).catch(() => { if (live) setX(null); });
    return () => { live = false; };
  }, [s.api, s.profile.id, may, d.rows]);
  return x;
}

/** the plain count the Accountant sees of the payments that wait in the books of the holders: no amount, no name */
const elsewhereText = (n: number) => L(`${n} مدفوعات في دفاتر أمناء الصناديق (يقيّدها كلٌّ في دفتره)`, `${n} payment${n === 1 ? ' is' : 's are'} in the books of holders (each holder enters his own)`, `${n} paiement${n === 1 ? ' est' : 's sont'} dans les caisses des responsables (chacun écrit le sien)`);

/** the notice on the Accounts home */
export function PaysWaitingNotice() {
  const nav = useNav();
  const w = usePaysWaiting();
  if (!w) return null;
  const n = w.rows.length, e = w.elsewhere;
  return (
    <>
      {n > 0 && (
        <div className="alert warn row" style={{ justifyContent: 'space-between' }}>
          <span>{L(`${n} مدفوعات تنتظر الدفاتر`, `${n} payment${n === 1 ? '' : 's'} waiting for the books`, `${n} paiement${n === 1 ? '' : 's'} en attente des livres`)}</span>
          <button className="btn small" onClick={() => nav.go('paywait')}>{L('عرضها', 'Show them', 'Les voir')}</button>
        </div>
      )}
      {e > 0 && <p className="small muted">{elsewhereText(e)}</p>}
    </>
  );
}

/** the page of the Accounts menu */
export function PaysWaitingPage() {
  const nav = useNav();
  const w = usePaysWaiting();
  const rows = w?.rows ?? [];
  const { s, d, reload } = useApp();
  // the Administrator may move a payment (or a refund) to another book that takes the calendar's money
  const admin = !!s.profile.admin;
  const choices = d.lists.books.filter((b) => b.active && !b.private && b.parent_id == null);
  const move = async (p: PayWaiting, book: number) => {
    try { await s.api.call('cal.pay.book', { receipt_no: p.receipt_no, book_id: book }); await reload(); } catch (e) { toast(errText(e), true); }
  };
  // money received: the Income heading, and the line when the booking says what it is; a refund: nothing is guessed
  const make = (p: PayWaiting) => nav.entry({
    preset: true, type: p.kind === 'back' ? 'Exp' : 'Income', date: p.paid_on, bookId: p.book_id,
    ...(p.kind === 'back' ? {} : (([headingId, lineId]) => ({ headingId, lineId }))(incomeClassForPay(d.lists, p.hint ?? null))),
    prefill: { amount: p.amount, currency: p.currency, explanation: `${p.kind === 'back' ? 'Given back · مُعاد: ' : ''}${p.name} · ${p.code}`.trim(), receipt: p.receipt_no, locked: true },
  });
  return (
    <>
      <div className="page-head"><h1>{L('مدفوعات تنتظر الدفاتر', 'Payments waiting for the books', 'Paiements en attente des livres')}</h1></div>
      <p className="small muted">{L(
        'كل دفعة قُبضت وكل مبلغ أُعيد في التقويم يظهر هنا حتى تجعله قيداً. اضغط «اجعلها قيداً»: يُفتح القيد وفيه التاريخ والمبلغ والعملة ورقم الوصل من الدفعة؛ يُقيَّد في دفتر الدفعة (دفتر من قبض المال)، وتختار أنت البند. رقم الوصل هو الذي يربط القيد بالدفعة.',
        'Each payment received and each amount given back in the Calendar shows here, for the book you write in, until it is an entry. Press "Make the entry": the entry opens with the date, the amount, the currency and the receipt number taken from the payment; it goes into the book of the payment (the book of the person who took the money) and you choose the line. The receipt number is what keeps the entry and the payment together.',
        'Chaque paiement reçu et chaque somme rendue dans le Calendrier apparaît ici jusqu’à ce qu’il devienne une écriture. Appuyez sur « Faire l’écriture » : elle s’ouvre avec la date, le montant, la devise et le numéro du reçu pris du paiement ; elle va dans la caisse du paiement (celle de la personne qui a reçu l’argent) et vous choisissez la ligne. Le numéro du reçu garde l’écriture et le paiement ensemble.')}</p>
      {w && w.elsewhere > 0 && <p className="small muted">{elsewhereText(w.elsewhere)}</p>}
      <div className="tbl-wrap"><table className="t small">
        <thead><tr><th>{L('الوصل', 'Receipt', 'Reçu')}</th><th>{L('التاريخ', 'Date', 'Date')}</th><th>{L('المجموعة', 'Group', 'Groupe')}</th><th>{L('النوع', 'Kind', 'Sorte')}</th><th>{L('الدفتر', 'Book', 'Caisse')}</th><th className="n">{L('المبلغ', 'Amount', 'Montant')}</th><th /></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.receipt_no}>
              <td dir="ltr">{p.receipt_no}</td><td>{fmtDate(p.paid_on)}</td><td>{p.name} <small className="muted" dir="ltr">{p.code}</small></td>
              <td>{p.kind === 'back' ? L('مُعاد (مصروف)', 'Given back (expense)', 'Rendu (dépense)') : L('مقبوض (دخل)', 'Received (income)', 'Reçu (recette)')}</td>
              <td>{admin
                ? <select value={p.book_id} onChange={(e) => void move(p, Number(e.target.value))}>{choices.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                : p.book}</td>
              <td className="n" dir="ltr">{amountText(p)}</td>
              <td><button className="btn primary small" onClick={() => make(p)}>{L('اجعلها قيداً', 'Make the entry', 'Faire l’écriture')}</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="muted">✓ {L('لا شيء ينتظر', 'Nothing is waiting', 'Rien n’attend')}</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
