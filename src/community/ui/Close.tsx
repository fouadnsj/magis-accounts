// The end of the month: "count what is in your pocket", one number per currency.
// If it matches the book, the month closes; if not, add what was forgotten or write a note.
import { useEffect, useState } from 'react';
import { errText, parseAmount, toast } from '../../ui/kit';
import type { Msg } from '../../i18n';
import { tx } from '../../i18n';
import { balance, lastDay, r2, type Cur } from '../domain';
import { useCty, Card } from './CtyApp';
import { usedCurs } from './Month';
import { curName, money, monthName, t3 } from './text';

export function CloseMonth({ ym, onDone }: { ym: string; onDone: () => void }) {
  const { d, book, s, reload, write } = useCty();
  const curs = usedCurs(d.entries, book.id, { LOC: book.opening_syp, USD: book.opening_usd, EUR: book.opening_eur });
  const held = balance(d.entries, book, lastDay(ym));
  const [count, setCount] = useState<Record<Cur, string>>({ LOC: '', USD: '', EUR: '' });
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<Msg[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    s.api.call('cty.month.problems', { bookId: book.id, ym }).then(setProblems).catch((e) => setErr(errText(e)));
  }, [s, book.id, ym, d]);

  const counted = (c: Cur) => (count[c].trim() === '' ? (curs.includes(c) ? NaN : 0) : parseAmount(count[c]));
  const all = curs.every((c) => Number.isFinite(counted(c)));
  const diffs = curs.map((c) => [c, r2(counted(c) - held[c])] as const).filter(([, x]) => Number.isFinite(x) && x !== 0);

  const close = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.api.call('cty.month.close', { bookId: book.id, ym, counted: { LOC: counted('LOC'), USD: counted('USD') || 0, EUR: counted('EUR') || 0 }, note });
      await reload();
      toast(t3('أُغلق الشهر ✓', 'Month closed ✓', 'Mois clôturé ✓'));
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="cty-back" onClick={onDone}>‹ {monthName(ym)}</button>
      <h1>{t3('عُدَّ ما في جيبك', 'Count what is in your pocket', 'Comptez ce qui est dans votre poche')}</h1>
      <p className="muted">{t3('عملة عملة. البرنامج يقارن بدفترك.', 'Currency by currency. The program compares with your book.', 'Monnaie par monnaie. Le programme compare avec votre compte.')}</p>
      {problems.length > 0 && <div className="alert warn">{problems.map((p, i) => <div key={i}>{tx(p)}</div>)}</div>}
      <Card>
        {curs.map((c) => (
          <label key={c} className="cty-count">
            <span className="cty-count-cur">{curName(c, d.local)}</span>
            <input inputMode="decimal" value={count[c]} placeholder="0" onChange={(e) => setCount({ ...count, [c]: e.target.value })} />
            <span className="muted small">{t3('الدفتر', 'Book', 'Compte')}: {money(held[c], c)}</span>
          </label>
        ))}
      </Card>
      {all && diffs.length === 0 && <div className="alert ok">✓ {t3('مطابق للدفتر', 'It matches your book', 'Cela correspond à votre compte')}</div>}
      {all && diffs.length > 0 && (
        <Card>
          <div>{t3('الفرق', 'Difference', 'Écart')}: {diffs.map(([c, x]) => `${x > 0 ? '+' : ''}${money(x, c)} ${curName(c, d.local)}`).join(' · ')}</div>
          <button className="btn cty-wide" style={{ marginTop: 8 }} onClick={() => write({ kind: 'Exp' })}>＋ {t3('أضف نفقة نُسيت', 'Add a forgotten expense', 'Ajouter une dépense oubliée')}</button>
          <label className="field" style={{ marginTop: 8 }}><span>{t3('أو اكتب ملاحظة', 'Or write a note', 'Ou écrivez une note')}</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </Card>
      )}
      {err && <div className="alert err">{err}</div>}
      <button className="btn primary cty-wide" disabled={busy || !all || problems.length > 0 || (diffs.length > 0 && !note.trim())} onClick={close}>
        {busy ? '…' : t3('أغلق الشهر', 'Close the month', 'Clôturer le mois')}
      </button>
    </>
  );
}
