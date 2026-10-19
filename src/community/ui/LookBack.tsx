// Looking back, for himself alone: where the money went, by heading, with the share of
// each (a ring and its %), for a month, a quarter or the year (October to September);
// a tap on a heading shows its lines; month by month beside last year.
// A mirror, not a control: no alarms, no "budget exceeded".
import { useMemo, useState } from 'react';
import { todayIso } from '../../ui/kit';
import { accountBooks, monthSheetOf, monthsOfYear, periodMonths, quarterOf, sheetOf, usdValue, yearOf, type Cur } from '../domain';
import { iconOf } from './icons';
import { useCty, Card, bookLabel } from './CtyApp';
import { headingOf, usedCurs } from './Month';
import { Columns, Ring } from './charts';
import { accName, curName, money, monthName, t3, yearName } from './text';

type Mode = 'month' | 'quarter' | 'year';

export function LookBack() {
  const { d, book } = useCty();
  const today = todayIso();
  const [mode, setMode] = useState<Mode>('quarter');
  const [ym, setYm] = useState(today.slice(0, 7));
  const curs = usedCurs(d.entries, book.id, { LOC: book.opening_syp, USD: book.opening_usd, EUR: book.opening_eur });
  const [cur, setCur] = useState<Cur>('LOC');
  const [open, setOpen] = useState<number | null>(null);

  // the period shown
  const months = mode === 'month' ? [ym] : mode === 'quarter' ? periodMonths(ym, 'quarter') : monthsOfYear(yearOf(`${ym}-01`));
  const from = `${months[0]}-01`;
  const to = `${months[months.length - 1]}-31`;
  const title = mode === 'month' ? monthName(ym) : mode === 'quarter' ? `T${quarterOf(from)} · ${monthName(months[0], true)} – ${monthName(months[2])}` : yearName(yearOf(from));
  const step = (k: number) => setYm(shift(ym, k * (mode === 'month' ? 1 : mode === 'quarter' ? 3 : 12)));

  const group = useMemo(() => accountBooks(d.books, book), [d.books, book]);
  const sh = useMemo(() => sheetOf(d.entries, group, from, to), [d.entries, group, from, to]);
  const groups = useMemo(() => {
    const out = new Map<number, { total: number; lines: Map<number, number> }>();
    for (const [id, v] of sh.expenses) {
      const h = headingOf(d.accounts, id);
      if (!h || !v[cur]) continue;
      const g = out.get(h.id) ?? { total: 0, lines: new Map() };
      g.total += -v[cur];
      g.lines.set(id, (g.lines.get(id) ?? 0) - v[cur]);
      out.set(h.id, g);
    }
    return out;
  }, [sh, d.accounts, cur]);
  const parts = [...groups.entries()].map(([id, g]) => ({ key: id, label: `${iconOf(d.accounts.find((a) => a.id === id)?.code)} ${accName(d.accounts.find((a) => a.id === id))}`, value: g.total }));
  const spent = -sh.totalExpenses[cur];
  const lastYear = -sheetOf(d.entries, group, shiftDate(from, -12), shiftDate(to, -12)).totalExpenses[cur];
  const cols = months.map((m) => ({
    label: monthName(m, true).slice(0, 3), title: monthName(m),
    now: -monthSheetOf(d.entries, group, m).totalExpenses[cur],
    before: -monthSheetOf(d.entries, group, shift(m, -12)).totalExpenses[cur],
  }));
  // all currencies together, about, in dollars (at the rate of each day)
  const aboutUsd = useMemo(() => {
    let x = 0;
    for (const e of d.entries) if (e.type === 'Exp' && group.some((b) => b.id === e.book_id) && e.date >= from && e.date <= to) x += usdValue(d.entries, e.cur, e.amount, e.date, d.limits.startRate) ?? 0;
    return x;
  }, [d, book.id, from, to]);
  const opened = open != null ? groups.get(open) : undefined;

  return (
    <>
      <div className="cty-seg">
        {(['month', 'quarter', 'year'] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setOpen(null); }}>
            {m === 'month' ? t3('الشهر', 'Month', 'Mois') : m === 'quarter' ? t3('الفصل', 'Quarter', 'Trimestre') : t3('السنة', 'Year', 'Année')}
          </button>
        ))}
      </div>
      <div className="cty-monthnav">
        <button onClick={() => step(-1)}>‹</button>
        <h1 style={{ fontSize: 17 }}>{title}</h1>
        <button onClick={() => step(1)}>›</button>
      </div>
      <p className="muted small center" style={{ margin: 0 }}>{bookLabel(book)}</p>
      {curs.length > 1 && (
        <div className="cty-curs center">
          {curs.map((c) => <button key={c} className={c === cur ? 'on' : ''} onClick={() => setCur(c)}>{curName(c, d.local)}</button>)}
        </div>
      )}

      <Card>
        <div className="cty-inout big">
          <div><span className="muted small">{t3('دخل', 'Came in', 'Entré')}</span><span className="in">＋{money(sh.totalIncome[cur] + sh.received[cur], cur)}</span></div>
          <div><span className="muted small">{t3('صُرف', 'Spent', 'Dépensé')}</span><span className="out">－{money(spent, cur)}</span></div>
        </div>
        {lastYear > 0 && <p className="muted small center">{t3('في السنة الماضية، نفس الفترة', 'Last year, same period', "L'an dernier, même période")}: {money(lastYear, cur)} {curName(cur, d.local)} · {spent >= lastYear ? '+' : '−'}{Math.abs(Math.round(((spent - lastYear) / lastYear) * 100))}%</p>}
        {curs.length > 1 && aboutUsd > 0 && <p className="muted small center">{t3('كل العملات معاً: نحو', 'All currencies together: about', 'Toutes monnaies ensemble : environ')} ${money(aboutUsd, 'USD')}</p>}
      </Card>

      <Card>
        <div className="cty-label">{t3('أين صرفتُ أكثر', 'Where I spent the most', "Où j'ai dépensé le plus")}</div>
        {parts.length === 0 ? <p className="muted">{t3('لا نفقات.', 'No expenses.', 'Aucune dépense.')}</p> : (
          <Ring parts={parts} fmt={(n) => money(n, cur)} center={curName(cur, d.local)} onPick={(p) => setOpen(typeof p.key === 'number' ? (open === p.key ? null : p.key) : null)} />
        )}
        {opened && (
          <div className="cty-lines">
            <div className="cty-label">{iconOf(d.accounts.find((a) => a.id === open)?.code)} {accName(d.accounts.find((a) => a.id === open))}</div>
            {[...opened.lines.entries()].sort((a, b) => b[1] - a[1]).map(([lid, x]) => (
              <div key={lid} className="cty-subline"><span>{iconOf(d.accounts.find((a) => a.id === lid)?.code)} {accName(d.accounts.find((a) => a.id === lid))}</span><span>{money(x, cur)} · {Math.round((x / opened.total) * 100)}%</span></div>
            ))}
          </div>
        )}
        {parts.length > 0 && <p className="muted small">{t3('اضغط على بند لترى تفاصيله.', 'Tap a heading to see its lines.', 'Touchez une rubrique pour voir ses lignes.')}</p>}
      </Card>

      {mode !== 'month' && (
        <Card>
          <div className="cty-label">{t3('شهراً بشهر', 'Month by month', 'Mois par mois')}</div>
          <Columns cols={cols} fmt={(n) => `${money(n, cur)} ${curName(cur, d.local)}`} />
          <div className="muted small"><i className="cty-key now" /> {t3('هذه السنة', 'this year', 'cette année')} · <i className="cty-key before" /> {t3('السنة الماضية', 'last year', "l'an dernier")}</div>
        </Card>
      )}
    </>
  );
}

const shift = (ym: string, k: number) => {
  const [y, mo] = ym.split('-').map(Number);
  const t = y * 12 + (mo - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const shiftDate = (date: string, months: number) => `${shift(date.slice(0, 7), months)}${date.slice(7)}`;
