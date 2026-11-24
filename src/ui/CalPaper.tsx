// The calendar's money and paper (baseline 2.1, section 7, step 4): record a payment (at any time, even before confirming),
// the receipt of each payment and of the whole booking (وصل استلام — never an invoice), cancelling with the money kept,
// given back or a part kept, the booking sheet for the group, the week of one hall, a short page for a day or a week, and
// the Excel list. Every payment and every amount given back is a suggestion for the books, with its number.
import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { Field, Modal, errText, toast, todayIso } from './kit';
import { m, tx } from '../i18n';
import { saveFile } from '../platform';
import { RECEIPT_TITLE_AR, brandStyle } from '../brand';
import type { Currency, Totals } from '../hosting/host';
import { calTotals, occurrences, received, sleepsIn, stillDue, type CalBooking, type CalData } from '../hosting/calendar';
import { mondayOf } from '../hosting/calview';
import type { ReceiptRow } from '../io/hostReceipt';
import type { HouseLook } from '../io/pdfCanvas';
import { ReceiptWindow } from './Hosting';

const L = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));
export const fmtTotals = (x: Totals) => [x.USD ? `${x.USD.toLocaleString('en', { maximumFractionDigits: 2 })} USD` : '', x.SYP ? `${Math.round(x.SYP).toLocaleString('en')} SYP` : ''].filter(Boolean).join(' + ') || '0';
const METHOD: Record<string, () => string> = { cash: () => L('نقداً', 'Cash', 'Espèces'), transfer: () => L('حوالة', 'Transfer', 'Virement'), other: () => L('غير ذلك', 'Other', 'Autre') };

/** the look of the house for every printed page: the two logos, the name, the Arabic title, the Amiri font */
export function useHouseLook() {
  const { s } = useApp();
  return async (): Promise<HouseLook> => {
    const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
    const custom = await s.api.call('brand.get').then((x) => x.receipt_title).catch(() => null);
    const st = brandStyle({ centre: s.centre ?? 'other', color: s.brandColor, logo: s.brandLogo });
    const [arabic, arabicBold, jesuit, centre] = await Promise.all([get('/fonts/amiri-arabic-400.ttf'), get('/fonts/amiri-arabic-700.ttf'), get('/brand/jesuits.png').catch(() => null), st.mark ? get(st.mark).catch(() => null) : Promise.resolve(null)]);
    return { organisation: s.organisation ?? '', titleAr: custom || RECEIPT_TITLE_AR[s.centre ?? ''], logos: { jesuit, centre }, fonts: { arabic, arabicBold }, accent: st.deep };
  };
}

/** the money of one booking: agreed (price + services), received, given back, still due */
export function moneyOf(d: CalData, b: CalBooking) {
  const pays = d.pays.filter((p) => p.booking_id === b.id);
  const total = calTotals(b, d.lines.filter((l) => l.booking_id === b.id), d.dates);
  const got = received(pays);
  return { pays, total, got, due: stillDue(total, got) };
}

const dayText = (b: CalBooking) => `${b.from_day}${b.to_day !== b.from_day ? ` → ${b.to_day}` : ''}${b.time_from && b.time_to ? `  ${b.time_from}-${b.time_to}` : ''}`;

/** saves a PDF; true when it was saved (not when the person closed the dialog) */
async function savePdf(name: string, bytes: Uint8Array) {
  return (await saveFile(name, ['pdf'], bytes, L('احفظ الملف', 'Save the file', 'Enregistrer le fichier'))) !== null;
}

/** the receipt of one payment: its number is the one in the books; printed again it carries "copy" */
export function usePayReceipt(data: CalData, refresh: () => Promise<void>) {
  const { s } = useApp();
  const look = useHouseLook();
  return async (b: CalBooking, payId: number) => {
    const p = data.pays.find((x) => x.id === payId);
    if (!p) return;
    try {
      // the print is counted first: "copy" is printed when the SERVER says it was printed before (two people printing together)
      const { before } = (await s.api.call('cal.paper.printed', { what: 'pay', id: p.id })) as { before: number };
      void refresh();
      const { payReceiptPdf } = await import('../io/hostReceipt');
      const org = data.orgs.find((o) => o.id === b.org_id);
      const spaces = data.allocs.filter((a) => a.booking_id === b.id).map((a) => data.spaces.find((x) => x.id === a.room_id)?.name).filter(Boolean).join(', ');
      const { due } = moneyOf(data, b);
      const bytes = await payReceiptPdf({
        ...(await look()), receipt_no: p.receipt_no, paid_on: p.paid_on, amount: p.amount, currency: p.currency, method: p.method,
        from: { name: org?.name ?? b.group_name, person: b.contact ?? '', phone: b.phone ?? '' },
        booking: { code: b.code, name: `${b.group_name}${b.subject ? ` · ${b.subject}` : ''}`, days: dayText(b), spaces: b.whole_centre ? 'The whole centre · المركز كله' : b.outside_place ?? spaces },
        due: b.price_state === 'priced' ? due : null, copy: before > 0,
      });
      await savePdf(`receipt_${p.receipt_no}.pdf`, bytes);
    } catch (e) { toast(errText(e), true); }
  };
}

// ---------------------------------------------------------------- record a payment

export function PayWindow({ data, b, onClose, refresh }: { data: CalData; b: CalBooking; onClose: () => void; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const { due } = moneyOf(data, b);
  const firstCur: Currency = due.USD > 0 || !due.SYP ? (b.currency === 'SYP' && due.SYP > 0 ? 'SYP' : 'USD') : 'SYP';
  const [f, setF] = useState({ amount: due[firstCur] ? String(due[firstCur]) : '', currency: firstCur, paid_on: todayIso(), method: 'cash', note: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: number; receipt_no: string; book: string } | null>(null);
  const printPay = usePayReceipt(data, refresh);
  // the book the money goes into: his own book when he keeps one, else the Main book; he may choose the Main book instead
  const [books, setBooks] = useState<{ options: { id: number; name: string; main: boolean }[]; default: number } | null>(null);
  const [book, setBook] = useState<number | null>(null);
  useEffect(() => { void s.api.call('cal.pay.books').then((x) => { setBooks(x); setBook(x.default); }).catch(() => setBooks(null)); }, [s.api]);
  const bookName = (id: number | null) => books?.options.find((o) => o.id === id);
  const save = async () => {
    setBusy(true);
    try {
      const r = (await s.api.call('cal.pay.add', { booking_id: b.id, amount: Number(f.amount), currency: f.currency, paid_on: f.paid_on, method: f.method, note: f.note, ...(book != null ? { book_id: book } : {}) })) as { id: number; receipt_no: string };
      await refresh();
      setDone({ ...r, book: bookName(book) ? (bookName(book)!.main ? L('الدفتر الرئيسي', 'the Main book', 'la caisse principale') : bookName(book)!.name) : '' });
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Modal title={L('سُجّلت الدفعة', 'Payment recorded', 'Paiement enregistré')} onClose={onClose} narrow>
        <p>{L('رقم الوصل', 'Receipt number', 'Numéro du reçu')}: <b dir="ltr">{done.receipt_no}</b></p>
        <p className="small muted">{done.book
          ? L(`تنتظر أن تصير قيداً في «${done.book}» بالرقم نفسه.`, `It waits to be made an entry in ${done.book}, with the same number.`, `Elle attend de devenir une écriture dans ${done.book}, avec le même numéro.`)
          : L('تنتظر أن تصير قيداً في الدفاتر بالرقم نفسه.', 'It waits to be made an entry of the books, with the same number.', 'Elle attend de devenir une écriture des livres, avec le même numéro.')}</p>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
          <button className="btn" onClick={onClose}>{L('إغلاق', 'Close', 'Fermer')}</button>
          <button className="btn primary" onClick={() => void printPay(b, done.id).then(onClose)}>🖨 {L('وصل الاستلام', 'The receipt', 'Le reçu')}</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`${L('دفعة مقبوضة', 'A payment received', 'Un paiement reçu')} · ${b.group_name}`} onClose={onClose} narrow>
      <div className="cal-form">
        {(due.USD > 0 || due.SYP > 0) && <p className="small muted">{L('المتبقي', 'Still due', 'Reste dû')}: <b dir="ltr">{fmtTotals(due)}</b></p>}
        {b.status === 'option' && <p className="small muted">{L('الحجز لم يُؤكَّد بعد: يمكن قبض دفعة مقدّمة.', 'The booking is not confirmed yet: an advance can be received.', 'La réservation n’est pas encore confirmée : une avance peut être reçue.')}</p>}
        <div className="row" style={{ gap: 6 }}>
          <Field label={L('المبلغ', 'Amount', 'Montant')}><input className="inp" autoFocus inputMode="decimal" dir="ltr" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
          <Field label={L('العملة', 'Currency', 'Devise')}><select className="inp" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}><option value="USD">USD</option><option value="SYP">SYP</option></select></Field>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Field label={L('التاريخ', 'Date', 'Date')}><input className="inp" type="date" max={todayIso()} value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></Field>
          <Field label={L('طريقة الدفع', 'Paid by', 'Payé par')}><select className="inp" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.keys(METHOD).map((k) => <option key={k} value={k}>{METHOD[k]()}</option>)}</select></Field>
        </div>
        <Field label={L('ملاحظة', 'Note', 'Note')}><input className="inp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {books && book != null && (
          <Field label={L('المال يدخل في', 'The money goes into', 'L’argent va dans')}>
            {books.options.length > 1
              ? <select className="inp" value={book} onChange={(e) => setBook(Number(e.target.value))}>{books.options.map((o) => <option key={o.id} value={o.id}>{o.main ? L('الدفتر الرئيسي (للمكتب)', 'The Main book (the office)', 'La caisse principale (le bureau)') : `${o.name} · ${L('دفتري', 'my book', 'ma caisse')}`}</option>)}</select>
              : <b>{L('الدفتر الرئيسي (للمكتب)', 'The Main book (the office)', 'La caisse principale (le bureau)')}</b>}
          </Field>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
        <button className="btn" onClick={onClose}>{L('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={busy || !(Number(f.amount) > 0)} onClick={() => void save()}>{L('سجّل الدفعة', 'Record the payment', 'Enregistrer le paiement')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- cancelling: the money kept, given back, or a part kept

type Choice = 'all' | 'none' | 'part';
/** the choice of what happens to the money received (also used later, for a booking cancelled before deciding) */
function MoneyChoice({ got, choice, setChoice, part, setPart }: { got: Totals; choice: Choice | null; setChoice: (c: Choice) => void; part: { USD: string; SYP: string }; setPart: (p: { USD: string; SYP: string }) => void }) {
  const curs = (['USD', 'SYP'] as Currency[]).filter((k) => got[k] > 0);
  return (
    <div className="cal-money-choice">
      <p className="small">{L('قُبض', 'Received', 'Reçu')}: <b dir="ltr">{fmtTotals(got)}</b>. {L('ماذا نفعل بالمال؟', 'What happens to the money?', 'Que devient l’argent ?')}</p>
      {([['all', L('نحتفظ بالكل', 'Keep all', 'Tout garder')], ['none', L('نعيد الكل', 'Give all back', 'Tout rendre')], ['part', L('نحتفظ بجزء', 'Keep a part', 'Garder une part')]] as [Choice, string][]).map(([k, label]) => (
        <label key={k} className="small cal-check"><input type="radio" name="cal-money" checked={choice === k} onChange={() => setChoice(k)} /> {label}</label>
      ))}
      {choice === 'part' && (
        <div className="row" style={{ gap: 6 }}>
          {curs.map((k) => <Field key={k} label={`${L('نحتفظ بـ', 'Kept', 'Gardé')} (${k}, ${L('من', 'of', 'sur')} ${got[k]})`}><input className="inp" inputMode="decimal" dir="ltr" value={part[k]} onChange={(e) => setPart({ ...part, [k]: e.target.value.replace(/[^\d.]/g, '') })} /></Field>)}
        </div>
      )}
      {choice && choice !== 'all' && <p className="small muted">{L('ما يُعاد يذهب إلى الدفاتر اقتراحاً (مصروف) برقم HR…', 'What is given back goes to the books as a suggestion (an expense), numbered HR…', 'Ce qui est rendu va aux livres comme suggestion (une dépense), numérotée HR…')}</p>}
    </div>
  );
}
const partOf = (choice: Choice | null, part: { USD: string; SYP: string }) => ({ money: choice, kept_usd: choice === 'part' && part.USD !== '' ? Number(part.USD) : null, kept_syp: choice === 'part' && part.SYP !== '' ? Number(part.SYP) : null });

export function CancelWindow({ data, b, onClose, onDone }: { data: CalData; b: CalBooking; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useApp();
  const { got } = moneyOf(data, b);
  const hasMoney = got.USD > 0 || got.SYP > 0;
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState<Choice | null>(null);
  const [part, setPart] = useState({ USD: '', SYP: '' });
  const [busy, setBusy] = useState(false);
  const decide = hasMoney && data.rights.money;
  const go = async () => {
    setBusy(true);
    try {
      await s.api.call('cal.booking.cancel', { id: b.id, reason, ...(decide && choice ? partOf(choice, part) : {}) });
      await onDone();
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${L('إلغاء الحجز', 'Cancel the booking', 'Annuler la réservation')} · ${b.group_name}`} onClose={onClose} narrow>
      <div className="cal-form">
        <Field label={L('السبب (يبقى الحجز محفوظاً)', 'The reason (the booking is kept)', 'La raison (la réservation est gardée)')}><input className="inp" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {decide && <MoneyChoice got={got} choice={choice} setChoice={setChoice} part={part} setPart={setPart} />}
        {decide && !choice && <p className="small muted">{L('يمكن أن يُقرَّر المال لاحقاً.', 'The money can be decided later.', 'L’argent peut être décidé plus tard.')}</p>}
        {hasMoney && !data.rights.money && <p className="small muted">{L('قُبض مال على هذا الحجز: المدير أو المنسّق يقرّر ما يُعاد.', 'Money was received for this booking: the Director or the Coordinator decides what is given back.', 'De l’argent a été reçu : le directeur ou le coordinateur décide de ce qui est rendu.')}</p>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
        <button className="btn" onClick={onClose}>{L('رجوع', 'Back', 'Retour')}</button>
        <button className="btn danger" disabled={busy || !reason.trim() || (choice === 'part' && part.USD === '' && part.SYP === '')} onClick={() => void go()}>{L('ألغِ الحجز', 'Cancel the booking', 'Annuler la réservation')}</button>
      </div>
    </Modal>
  );
}

/** a booking cancelled before the money was decided, or decided again while nothing is in the books yet */
export function MoneyWindow({ data, b, onClose, refresh }: { data: CalData; b: CalBooking; onClose: () => void; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const { got } = moneyOf(data, b);
  const [choice, setChoice] = useState<Choice | null>((b.cancel_money as Choice | null) ?? null);
  const [part, setPart] = useState({ USD: b.kept_usd != null ? String(b.kept_usd) : '', SYP: b.kept_syp != null ? String(b.kept_syp) : '' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await s.api.call('cal.booking.money', { id: b.id, ...partOf(choice, part), money: choice! }); await refresh(); onClose(); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${L('المال بعد الإلغاء', 'The money after cancelling', 'L’argent après l’annulation')} · ${b.group_name}`} onClose={onClose} narrow>
      <MoneyChoice got={got} choice={choice} setChoice={setChoice} part={part} setPart={setPart} />
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
        <button className="btn" onClick={onClose}>{L('رجوع', 'Back', 'Retour')}</button>
        <button className="btn primary" disabled={busy || !choice || (choice === 'part' && part.USD === '' && part.SYP === '')} onClick={() => void go()}>{L('احفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- the receipt of the whole booking, and the booking sheet

/** the first lines of the receipt, as the calendar counts them: the price (per person per night, for each date, or for the whole booking), then the services */
export function calReceiptRows(d: CalData, b: CalBooking): { rows: ReceiptRow[]; nights: number } {
  const n = occurrences({ ...b, status: b.status === 'cancelled' ? 'confirmed' : b.status }, d.dates).length;
  const ev = b.kind === 'event';
  const rows: ReceiptRow[] = [];
  if (b.price_state === 'priced' && b.rate != null && b.price_mode) {
    const what = ev ? 'Hall rental · إيجار القاعة' : 'Accommodation · الإقامة';
    if (b.price_mode === 'person') rows.push({ label: what, sub: `${b.people} people x ${n} ${ev ? 'day(s)' : 'night(s)'}`, qty: b.people * n, unit: b.rate, currency: b.currency });
    else if (b.price_each) rows.push({ label: what, sub: `${n} date(s)`, qty: n, unit: b.rate, currency: b.currency });
    else rows.push({ label: `${what} (fixed price)`, qty: 1, unit: b.rate, currency: b.currency });
  }
  for (const l of d.lines.filter((x) => x.booking_id === b.id)) rows.push({ label: l.label, qty: l.qty, unit: l.qty > 0 ? Math.round((l.amount / l.qty) * 100) / 100 : l.amount, currency: l.currency });
  return { rows, nights: Math.max(1, n) };
}

export function BookingReceipt({ data, b, onClose, refresh }: { data: CalData; b: CalBooking; onClose: () => void; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const { rows, nights } = calReceiptRows(data, b);
  return (
    <ReceiptWindow
      data={{ pays: data.pays, lines: data.lines, allocs: data.allocs, rooms: data.spaces, buildings: data.areas, needs: data.needs, equip: data.equip }}
      booking={b} rows0={rows} nights={nights} printed={b.receipt_printed ?? 0}
      claim={async () => { const r = (await s.api.call('cal.paper.printed', { what: 'booking', id: b.id })) as { before: number }; void refresh(); return r.before; }}
      onClose={onClose}
    />
  );
}

export function useBookingSheet(data: CalData) {
  const look = useHouseLook();
  return async (b: CalBooking) => {
    try {
      const { bookingSheetPdf } = await import('../io/calPaper');
      await savePdf(`booking_${b.code}.pdf`, await bookingSheetPdf(await look(), data, b, todayIso()));
    } catch (e) { toast(errText(e), true); }
  };
}

// ---------------------------------------------------------------- the printed pages of the bar, and the Excel list

export function PrintWindow({ data, anchor, onClose }: { data: CalData; anchor: string; onClose: () => void }) {
  const { s } = useApp();
  const look = useHouseLook();
  // the spaces that can be booked; halls first (a hall's week goes on its door), bedrooms after
  const halls = data.spaces.filter((x) => x.active && x.bookable !== 0).sort((a, b) => Number(sleepsIn(a, data.kinds)) - Number(sleepsIn(b, data.kinds)));
  const [what, setWhat] = useState<'hall' | 'day' | 'week' | 'excel'>('week');
  const [hall, setHall] = useState<number | null>(halls[0]?.id ?? null);
  const [day, setDay] = useState(anchor);
  const [from, setFrom] = useState(`${anchor.slice(0, 7)}-01`);
  const [to, setTo] = useState(() => { const x = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10); });
  const [busy, setBusy] = useState(false);
  // a look at the page before saving it (as the receipt): the same PDF in the window
  const [view, setView] = useState<{ url: string; name: string; bytes: Uint8Array } | null>(null);
  const build = async (): Promise<{ name: string; bytes: Uint8Array }> => {
    const paper = await import('../io/calPaper');
    const lk = await look();
    const mon = mondayOf(day);
    const sun = new Date(`${mon}T00:00:00Z`); sun.setUTCDate(sun.getUTCDate() + 6);
    const end = sun.toISOString().slice(0, 10);
    if (what === 'hall' && hall != null) return { name: `week_${data.spaces.find((x) => x.id === hall)?.name.replace(/[^A-Za-z0-9-]+/g, '') || hall}_${mon}.pdf`, bytes: await paper.hallWeekPdf(lk, data, hall, day) };
    if (what === 'day') return { name: `day_${day}.pdf`, bytes: await paper.shortPagePdf(lk, data, day, day) };
    return { name: `week_${mon}.pdf`, bytes: await paper.shortPagePdf(lk, data, mon, end) };
  };
  const go = async () => {
    setBusy(true);
    try {
      if (what === 'excel') {
        const { calWorkbook } = await import('../io/calFile');
        await saveFile(`calendar_${from}_${to}.xlsx`, ['xlsx'], await calWorkbook(data, from, to, s.organisation ?? ''), L('احفظ الملف', 'Save the file', 'Enregistrer le fichier'));
      } else {
        const x = view ?? (await build());
        await savePdf(x.name, x.bytes);
      }
      onClose();
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const preview = async () => {
    setBusy(true);
    try { const x = await build(); setView({ ...x, url: URL.createObjectURL(new Blob([x.bytes as BlobPart], { type: 'application/pdf' })) }); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  if (view) {
    return (
      <Modal title={`${L('معاينة', 'Preview', 'Aperçu')} · ${view.name}`} onClose={() => { URL.revokeObjectURL(view.url); setView(null); }}>
        <iframe title="page" src={view.url} style={{ width: '100%', height: '68vh', minHeight: 360, border: '1px solid var(--line, #ccc)', borderRadius: 6 }} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
          <button className="btn" onClick={() => { URL.revokeObjectURL(view.url); setView(null); }}>{L('رجوع', 'Back', 'Retour')}</button>
          <button className="btn primary" disabled={busy} onClick={() => void go()}>{L('احفظ PDF', 'Save PDF', 'Enregistrer le PDF')}</button>
        </div>
      </Modal>
    );
  }
  const opt = (k: typeof what, label: string, hint: string) => (
    <label className="cal-print-opt"><input type="radio" name="cal-print" checked={what === k} onChange={() => setWhat(k)} /> <span><b>{label}</b><br /><span className="small muted">{hint}</span></span></label>
  );
  return (
    <Modal title={`🖨 ${L('طباعة', 'Print', 'Imprimer')}`} onClose={onClose} narrow>
      <div className="cal-form">
        {opt('week', L('صفحة قصيرة للأسبوع', 'A short page for the week', 'Une page courte pour la semaine'), L('للاستقبال أو الحارس: كل يوم، الساعات، الأماكن', 'For the reception or the guard: each day, the hours, the spaces', 'Pour l’accueil ou le gardien : chaque jour, les heures, les espaces'))}
        {opt('day', L('صفحة قصيرة لليوم', 'A short page for the day', 'Une page courte pour le jour'), L('اليوم المختار', 'The day chosen', 'Le jour choisi'))}
        {opt('hall', L('أسبوع قاعة واحدة', 'The week of one hall', 'La semaine d’une salle'), L('لتُعلَّق على بابها', 'To put on its door', 'À mettre sur sa porte'))}
        {opt('excel', L('قائمة الحجوزات (Excel)', 'The list of bookings (Excel)', 'La liste des réservations (Excel)'), data.rights.prices || data.rights.money ? L('مع المبالغ والدفعات', 'With the amounts and the payments', 'Avec les montants et les paiements') : L('بلا مبالغ', 'Without amounts', 'Sans montants'))}
        {what === 'hall' && <Field label={L('القاعة', 'The hall', 'La salle')}><select className="inp" value={hall ?? ''} onChange={(e) => setHall(Number(e.target.value))}>{halls.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
        {what !== 'excel' && <Field label={what === 'day' ? L('اليوم', 'The day', 'Le jour') : L('يوم من الأسبوع', 'A day of the week', 'Un jour de la semaine')}><input className="inp" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>}
        {what === 'excel' && (
          <div className="row" style={{ gap: 6 }}>
            <Field label={L('من', 'From', 'Du')}><input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label={L('إلى', 'To', 'Au')}><input className="inp" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
        <button className="btn" onClick={onClose}>{L('إلغاء', 'Cancel', 'Annuler')}</button>
        {what !== 'excel' && <button className="btn" disabled={busy || (what === 'hall' && hall == null)} onClick={() => void preview()}>{L('معاينة', 'Preview', 'Aperçu')}</button>}
        <button className="btn primary" disabled={busy || (what === 'hall' && hall == null) || (what === 'excel' && from > to)} onClick={() => void go()}>{what === 'excel' ? L('احفظ Excel', 'Save Excel', 'Enregistrer Excel') : L('احفظ PDF', 'Save PDF', 'Enregistrer le PDF')}</button>
      </div>
    </Modal>
  );
}

export { METHOD };
