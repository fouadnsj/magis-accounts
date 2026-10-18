// The end of the period (the quarter, or the month: the econome's choice): count what you
// have, banknote by banknote. Each note of the currency is listed with how many you have;
// the total is computed and compared with the book. If it matches, the period closes;
// if not, add what was forgotten or write a note.
import { useEffect, useState } from 'react';
import { errText, parseAmount, toast } from '../../ui/kit';
import { tx, type Msg } from '../../i18n';
import { balance, lastDay, periodMonths, quarterOf, r2, type Cur } from '../domain';
import { useCty, Card, bookLabel } from './CtyApp';
import { usedCurs } from './Month';
import { curName, money, monthName, t3 } from './text';

export function CloseMonth({ ym, onDone }: { ym: string; onDone: () => void }) {
  const { d, book, s, reload, write } = useCty();
  const months = periodMonths(ym, d.settings.closePeriod);
  const last = months[months.length - 1];
  const curs = usedCurs(d.entries, book.id, { LOC: book.opening_syp, USD: book.opening_usd, EUR: book.opening_eur });
  const held = balance(d.entries, book, lastDay(last));
  // how many of each note, and loose change / other, per currency
  const [qty, setQty] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<Cur, string>>({ LOC: '', USD: '', EUR: '' });
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<Msg[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    s.api.call('cty.month.problems', { bookId: book.id, ym: last }).then(setProblems).catch((e) => setErr(errText(e)));
  }, [s, book.id, last, d]);

  const n = (k: string) => parseAmount(qty[k] ?? '') || 0;
  const counted = (c: Cur) => r2(d.settings.notes[c].reduce((sum, v) => sum + v * n(`${c}${v}`), 0) + (parseAmount(other[c]) || 0));
  const diffs = curs.map((c) => [c, r2(counted(c) - held[c])] as const).filter(([, x]) => x !== 0);
  const title = months.length > 1 ? `T${quarterOf(`${months[0]}-01`)} (${months[0].slice(5)}–${last.slice(5)}/${last.slice(0, 4)})` : monthName(last);

  const close = async () => {
    setBusy(true);
    setErr(null);
    try {
      const detail: Record<string, Record<string, number>> = {};
      for (const c of curs) {
        detail[c] = Object.fromEntries(d.settings.notes[c].map((v) => [String(v), n(`${c}${v}`)]).filter(([, q]) => q));
        if (parseAmount(other[c])) detail[c].other = parseAmount(other[c]);
      }
      await s.api.call('cty.month.close', { bookId: book.id, ym: last, counted: { LOC: counted('LOC'), USD: counted('USD'), EUR: counted('EUR') }, note, detail });
      await reload();
      toast(months.length > 1 ? t3('أُغلق الفصل ✓', 'Quarter closed ✓', 'Trimestre clôturé ✓') : t3('أُغلق الشهر ✓', 'Month closed ✓', 'Mois clôturé ✓'));
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="cty-back" onClick={onDone}>‹ {t3('رجوع', 'Back', 'Retour')}</button>
      <h1>{t3('عُدَّ ما معك', 'Count what you have', 'Comptez ce que vous avez')}</h1>
      <p className="muted">{bookLabel(book)} · {title}. {t3('اكتب عدد كل ورقة نقدية؛ البرنامج يجمع ويقارن بدفترك.', 'Write how many of each banknote; the program adds up and compares with your book.', 'Écrivez combien de chaque billet ; le programme additionne et compare avec votre compte.')}</p>
      {problems.length > 0 && <div className="alert warn">{problems.map((p, i) => <div key={i}>{tx(p)}</div>)}</div>}
      {curs.map((c) => (
        <Card key={c}>
          <div className="cty-notes-head"><b>{curName(c, d.local)}</b><span className="muted small">{t3('الدفتر', 'Book', 'Compte')}: {money(held[c], c)}</span></div>
          <div className="cty-notes">
            {d.settings.notes[c].map((v) => (
              <label key={v} className="cty-note">
                <span className="cty-note-face">{money(v, c)}</span>
                <span className="muted">×</span>
                <input inputMode="numeric" value={qty[`${c}${v}`] ?? ''} placeholder="0" onChange={(e) => setQty({ ...qty, [`${c}${v}`]: e.target.value })} />
                <span className="cty-note-sum">{n(`${c}${v}`) ? money(v * n(`${c}${v}`), c) : ''}</span>
              </label>
            ))}
            <label className="cty-note">
              <span className="cty-note-face small">{t3('فراطة / غير ذلك', 'Coins / other', 'Pièces / autre')}</span>
              <span />
              <input inputMode="decimal" value={other[c]} placeholder="0" onChange={(e) => setOther({ ...other, [c]: e.target.value })} />
              <span />
            </label>
          </div>
          <div className={`cty-notes-total ${counted(c) === held[c] ? 'ok' : ''}`}>
            {t3('المجموع', 'Total', 'Total')}: <b>{money(counted(c), c)}</b> {curName(c, d.local)} {counted(c) === held[c] ? '✓' : <span className="muted small">({t3('الفرق', 'difference', 'écart')} {money(counted(c) - held[c], c)})</span>}
          </div>
        </Card>
      ))}
      {diffs.length === 0 && <div className="alert ok">✓ {t3('مطابق للدفتر', 'It matches your book', 'Cela correspond à votre compte')}</div>}
      {diffs.length > 0 && (
        <Card>
          <button className="btn cty-wide" onClick={() => write({ kind: 'Exp' })}>＋ {t3('أضف نفقة نُسيت', 'Add a forgotten expense', 'Ajouter une dépense oubliée')}</button>
          <label className="field" style={{ marginTop: 8 }}><span>{t3('أو اكتب ملاحظة تشرح الفرق', 'Or write a note explaining the difference', "Ou écrivez une note qui explique l'écart")}</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </Card>
      )}
      {err && <div className="alert err">{err}</div>}
      <button className="btn primary cty-wide" disabled={busy || problems.length > 0 || (diffs.length > 0 && !note.trim())} onClick={close}>
        {busy ? '…' : months.length > 1 ? t3('أغلق الفصل', 'Close the quarter', 'Clôturer le trimestre') : t3('أغلق الشهر', 'Close the month', 'Clôturer le mois')}
      </button>
    </>
  );
}
