// Looking back, for himself alone: where the money went this month and this year
// (October to September), by heading and by line, month by month, beside last year.
// A mirror, not a control: no alarms, no "budget exceeded".
import { useMemo, useState } from 'react';
import { todayIso } from '../../ui/kit';
import { monthSheet, monthsOfYear, usdValue, yearOf, yearSheet, type Cur } from '../domain';
import { useCty, Card } from './CtyApp';
import { headingOf, usedCurs } from './Month';
import { accName, curName, money, monthName, t3, yearName } from './text';

export function LookBack() {
  const { d, book } = useCty();
  const today = todayIso();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [ym, setYm] = useState(today.slice(0, 7));
  const [year, setYear] = useState(yearOf(today));
  const curs = usedCurs(d.entries, book.id, { LOC: book.opening_syp, USD: book.opening_usd, EUR: book.opening_eur });
  const [cur, setCur] = useState<Cur>('LOC');
  const [open, setOpen] = useState<number | null>(null);

  const sheet = useMemo(() => (mode === 'month' ? monthSheet(d.entries, book, ym) : yearSheet(d.entries, book, year)), [mode, d.entries, book, ym, year]);
  // by heading, with the lines under each
  const groups = useMemo(() => {
    const out = new Map<number, { total: number; lines: Map<number, number> }>();
    for (const [id, v] of sheet.expenses) {
      const h = headingOf(d.accounts, id);
      if (!h || !v[cur]) continue;
      const g = out.get(h.id) ?? { total: 0, lines: new Map() };
      g.total += -v[cur];
      g.lines.set(id, (g.lines.get(id) ?? 0) - v[cur]);
      out.set(h.id, g);
    }
    return [...out.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [sheet, d.accounts, cur]);
  const total = groups.reduce((n, [, g]) => n + g.total, 0);

  // month by month, this year and last year
  const months = monthsOfYear(year);
  const spentIn = (m: string, c: Cur) => -monthSheet(d.entries, book, m).totalExpenses[c];
  const bars = months.map((m) => ({ m, now: spentIn(m, cur), before: spentIn(`${Number(m.slice(0, 4)) - 1}${m.slice(4)}`, cur) }));
  const max = Math.max(1, ...bars.flatMap((b) => [b.now, b.before]));
  const lastYear = -yearSheet(d.entries, book, year - 1).totalExpenses[cur];
  // all currencies together, about, in dollars (at the rate of each day)
  const aboutUsd = useMemo(() => {
    let x = 0;
    for (const e of d.entries) {
      if (e.type !== 'Exp' || e.book_id !== book.id) continue;
      if (mode === 'month' ? e.date.slice(0, 7) !== ym : yearOf(e.date) !== year) continue;
      x += usdValue(d.entries, e.cur, e.amount, e.date, d.limits.startRate) ?? 0;
    }
    return x;
  }, [d, book.id, mode, ym, year]);

  return (
    <>
      <div className="cty-seg">
        <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>{t3('الشهر', 'Month', 'Mois')}</button>
        <button className={mode === 'year' ? 'on' : ''} onClick={() => setMode('year')}>{t3('السنة', 'Year', 'Année')}</button>
      </div>
      <div className="cty-monthnav">
        <button onClick={() => (mode === 'month' ? setYm(shift(ym, -1)) : setYear(year - 1))}>‹</button>
        <h1>{mode === 'month' ? monthName(ym) : yearName(year)}</h1>
        <button onClick={() => (mode === 'month' ? setYm(shift(ym, 1)) : setYear(year + 1))}>›</button>
      </div>
      {curs.length > 1 && (
        <div className="cty-curs center">
          {curs.map((c) => <button key={c} className={c === cur ? 'on' : ''} onClick={() => setCur(c)}>{curName(c, d.local)}</button>)}
        </div>
      )}

      <Card>
        <div className="cty-inout big">
          <div><span className="muted small">{t3('دخل', 'Came in', 'Entré')}</span><span className="in">＋{money(sheet.totalIncome[cur] + sheet.received[cur], cur)}</span></div>
          <div><span className="muted small">{t3('صُرف', 'Spent', 'Dépensé')}</span><span className="out">－{money(-sheet.totalExpenses[cur], cur)}</span></div>
        </div>
        {curs.length > 1 && aboutUsd > 0 && <p className="muted small center">{t3('كل العملات معاً: نحو', 'All currencies together: about', 'Toutes monnaies ensemble : environ')} ${money(aboutUsd, 'USD')}</p>}
        {mode === 'year' && lastYear > 0 && (
          <p className="muted small center">{t3('السنة الماضية', 'Last year', "L'an dernier")}: {money(lastYear, cur)} {curName(cur, d.local)}</p>
        )}
      </Card>

      {mode === 'year' && (
        <Card>
          <div className="cty-label">{t3('شهراً بشهر', 'Month by month', 'Mois par mois')}</div>
          <div className="cty-cols">
            {bars.map((b) => (
              <div key={b.m} className="cty-col" title={`${monthName(b.m)}: ${money(b.now, cur)}`}>
                <div className="cty-col-bars">
                  <i className="before" style={{ height: `${(b.before / max) * 100}%` }} />
                  <i className="now" style={{ height: `${(b.now / max) * 100}%` }} />
                </div>
                <span>{monthName(b.m, true).slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <div className="muted small"><i className="cty-key now" /> {t3('هذه السنة', 'this year', 'cette année')} · <i className="cty-key before" /> {t3('السنة الماضية', 'last year', "l'an dernier")}</div>
        </Card>
      )}

      <Card>
        <div className="cty-label">{t3('أين ذهب المال', 'Where it went', "Où l'argent est allé")}</div>
        {groups.length === 0 && <p className="muted">{t3('لا نفقات.', 'No expenses.', 'Aucune dépense.')}</p>}
        {groups.map(([id, g]) => (
          <div key={id}>
            <button className="cty-hbar as-button" onClick={() => setOpen(open === id ? null : id)}>
              <div className="cty-hbar-text"><span>{accName(d.accounts.find((a) => a.id === id))}</span><b>{money(g.total, cur)} <small className="muted">{Math.round((g.total / total) * 100)}%</small></b></div>
              <div className="cty-hbar-track"><div style={{ width: `${Math.max(2, (g.total / total) * 100)}%` }} /></div>
            </button>
            {open === id && [...g.lines.entries()].sort((a, b) => b[1] - a[1]).map(([lid, x]) => (
              <div key={lid} className="cty-subline"><span>{accName(d.accounts.find((a) => a.id === lid))}</span><span>{money(x, cur)}</span></div>
            ))}
          </div>
        ))}
      </Card>
    </>
  );
}

const shift = (ym: string, k: number) => {
  const [y, mo] = ym.split('-').map(Number);
  const t = y * 12 + (mo - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
