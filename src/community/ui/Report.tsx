// The report on the expenses (Fouad, 14 November 2026): "a wider vision, like the analysis report but simpler":
// a ring by category, month by month, by member; for a month, a quarter, the year or any months; compare months
// for one or more headings. The same page for each one, at his own height:
//  - the minister: the house (and its envelopes);
//  - the econome and the Superior: the whole community, and each member (personal expenses, month to month).
// (The country econome has his own, by community, in country/Expenses.tsx: never a person.)
import { Fragment, useMemo, useState } from 'react';
import { errText, toast, todayIso } from '../../ui/kit';
import { accountBooks, forHouse, lastDay, monthSheetOf, ownOnly, monthsOfYear, periodMonths, totalUsd, yearOf, type CtyBook, type Cur, type Money } from '../domain';
import { useCty, bookLabel, bookName } from './CtyApp';
import { headingOf } from './Month';
import { useRates } from './usd';
import { Columns, Ring, SHADES } from './charts';
import { iconOf } from './icons';
import { accName, curName, money, monthName, periodName, t3, yearName } from './text';
import { exportExcel } from './desk/excel';

type View = 'cat' | 'months' | 'members';
type CurPick = Cur | 'ALL';
interface Member { key: string; label: string; books: CtyBook[]; kind: 'personal' | 'house' | 'cash' }

export function Report({ scope }: { scope: 'house' | 'community' }) {
  const { d } = useCty();
  const rates = useRates();
  const today = todayIso();
  const thisYm = today.slice(0, 7);
  const [from, setFrom] = useState(periodMonths(thisYm, 'quarter')[0]);
  const [to, setTo] = useState(thisYm);
  const [view, setView] = useState<View>('cat');
  const [cur, setCur] = useState<CurPick>('LOC');
  const [heads, setHeads] = useState<number[]>([]);
  const [who, setWho] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  // the members of the report
  const members = useMemo<Member[]>(() => {
    const live = d.books.filter((b) => b.active);
    const house = live.find((b) => b.cty_kind === 'house');
    const out: Member[] = [];
    if (scope === 'community') {
      for (const b of live.filter((x) => x.cty_kind === 'personal').sort((a, b) => bookName(a).localeCompare(bookName(b))))
        out.push({ key: `p${b.id}`, label: bookName(b), books: accountBooks(d.books, b), kind: 'personal' });
    }
    if (house) out.push({ key: `h${house.id}`, label: t3('البيت', 'The house', 'La maison'), books: accountBooks(d.books, house), kind: 'house' });
    if (scope === 'community') {
      const cash = live.find((b) => b.cty_kind === 'cash');
      if (cash) out.push({ key: `c${cash.id}`, label: t3('صندوق الجماعة (القيم)', 'Community cash (econome)', 'Caisse de la communauté (économe)'), books: accountBooks(d.books, cash), kind: 'cash' });
    }
    return out;
  }, [d.books, scope]);
  const shown = who.length ? members.filter((m) => who.includes(m.key)) : members;

  // the months of the period, in order
  const months = useMemo(() => {
    const out: string[] = [];
    const [a, b] = from <= to ? [from, to] : [to, from];
    for (let m = a; m <= b && out.length < 60; m = shift(m, 1)) out.push(m);
    return out;
  }, [from, to]);

  // expenses (positive) by member, month and line
  const own = useMemo(() => ownOnly(d.entries), [d.entries]);
  const data = useMemo(() => {
    const out = new Map<string, Map<string, Map<number, Money>>>();
    for (const mb of members) {
      const per = new Map<string, Map<number, Money>>();
      for (const m of months) {
        // a Jesuit's own expenses only; what the brothers paid "For the house" counts with the house (Fouad, 15 November 2026)
        const s = monthSheetOf(mb.kind === 'house' ? d.entries : own, mb.books, m);
        const lines = new Map<number, Money>();
        const add = (id: number, v: Money) => { const t = lines.get(id) ?? { LOC: 0, USD: 0, EUR: 0 }; lines.set(id, { LOC: t.LOC - v.LOC, USD: t.USD - v.USD, EUR: t.EUR - v.EUR }); };
        for (const [id, v] of s.expenses) add(id, v);
        if (mb.kind === 'house') for (const [id, v] of forHouse(d.entries, null, `${m}-01`, lastDay(m))) add(id, v);
        per.set(m, lines);
      }
      out.set(mb.key, per);
    }
    return out;
  }, [members, months, d.entries, own]);

  const val = (m: Money) => (cur === 'ALL' ? totalUsd(m, rates).usd : m[cur]);
  const fmt = (n: number) => money(n, cur === 'ALL' ? 'USD' : cur);
  const unit = cur === 'ALL' ? t3('≈ $ (كل العملات)', '≈ $ (all currencies)', '≈ $ (toutes monnaies)') : curName(cur, d.local);

  /** total of one member, months, by heading (only the chosen headings) */
  const sum = (mbs: Member[], ms: string[], headId: number | null, lineId: number | null = null): number => {
    let n = 0;
    for (const mb of mbs) for (const m of ms) for (const [id, v] of data.get(mb.key)?.get(m) ?? []) {
      if (lineId != null && id !== lineId) continue;
      const h = headingOf(d.accounts, id);
      if (!h) continue;
      if (headId != null ? h.id !== headId : heads.length && !heads.includes(h.id)) continue;
      n += val(v);
    }
    return n;
  };

  // the headings that have expenses in the period
  const usedHeads = useMemo(() => {
    const ids = new Set<number>();
    for (const mb of members) for (const m of months) for (const id of data.get(mb.key)?.get(m)?.keys() ?? []) { const h = headingOf(d.accounts, id); if (h) ids.add(h.id); }
    return d.accounts.filter((a) => ids.has(a.id));
  }, [members, months, data, d.accounts]);
  const headsShown = heads.length ? usedHeads.filter((h) => heads.includes(h.id)) : usedHeads;
  const total = headsShown.reduce((n, h) => n + sum(shown, months, h.id), 0);
  const headName = (h: { code: string } & Parameters<typeof accName>[0]) => `${iconOf(h.code)} ${accName(h)}`;

  // the period's name
  const y = yearOf(`${months[0]}-01`);
  const isYear = months.length === 12 && months[0] === `${y}-10`;
  const title = isYear ? yearName(y) : periodName(months.length === 3 && periodMonths(months[0], 'quarter')[0] === months[0] ? months : [months[0], ...(months.length > 1 ? [months[months.length - 1]] : [])]);
  const preset = (a: string, b: string) => { setFrom(a); setTo(b); setOpen(null); };
  const q = periodMonths(thisYm, 'quarter');
  const lastQ = periodMonths(shift(q[0], -1), 'quarter');
  const yr = monthsOfYear(yearOf(today));
  const firstYm = d.entries.reduce((mn, e) => (e.date.slice(0, 7) < mn ? e.date.slice(0, 7) : mn), thisYm);

  const toggle = <T,>(list: T[], x: T, set: (l: T[]) => void) => set(list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  const exportIt = async () => {
    try {
      const sheets = [{
        name: t3('حسب البند', 'By category', 'Par catégorie'),
        header: [t3('البند', 'Heading', 'Rubrique'), ...months.map((m) => monthName(m)), t3('المجموع', 'Total', 'Total')],
        rows: headsShown.map((h) => [accName(h), ...months.map((m) => sum(shown, [m], h.id) || null), sum(shown, months, h.id) || null]),
        money: Array.from({ length: months.length + 1 }, (_, i) => i + 1),
      }];
      if (scope === 'community') sheets.push({
        name: t3('حسب العضو', 'By member', 'Par membre'),
        header: [t3('العضو', 'Member', 'Membre'), ...months.map((m) => monthName(m)), t3('المجموع', 'Total', 'Total')],
        rows: shown.map((mb) => [mb.label, ...months.map((m) => sum([mb], [m], null) || null), sum([mb], months, null) || null]),
        money: Array.from({ length: months.length + 1 }, (_, i) => i + 1),
      });
      await exportExcel(`report-${months[0]}_${months[months.length - 1]}.xlsx`, sheets);
    } catch (e) { toast(errText(e), true); }
  };

  const parts = headsShown.map((h) => ({ key: h.id, label: headName(h), value: sum(shown, months, h.id) }));
  const opened = open != null ? d.accounts.find((a) => a.id === open) : undefined;
  const openedLines = opened ? d.accounts.filter((a) => a.id !== opened.id && headingOf(d.accounts, a.id)?.id === opened.id)
    .map((a) => ({ a, v: sum(shown, months, opened.id, a.id) })).filter((x) => x.v).sort((x, z) => z.v - x.v) : [];

  return (
    <div className="cty-report">
      <div className="desk-head">
        <h1>{scope === 'house' ? t3('تقرير البيت', 'The house report', 'Rapport de la maison') : t3('تقرير النفقات', 'Expenses report', 'Rapport des dépenses')} · {title}</h1>
        <button className="btn" onClick={exportIt}>Excel</button>
      </div>

      {/* 1. the period */}
      <div className="cty-card rep-controls">
        <div className="rep-row">
          <span className="cty-label">{t3('الفترة', 'Period', 'Période')}</span>
          <button className={`chip ${months.length === 1 && from === thisYm ? 'on' : ''}`} onClick={() => preset(thisYm, thisYm)}>{t3('هذا الشهر', 'This month', 'Ce mois')}</button>
          <button className={`chip ${from === q[0] && to === thisYm ? 'on' : ''}`} onClick={() => preset(q[0], thisYm)}>{t3('هذا الفصل', 'This quarter', 'Ce trimestre')}</button>
          <button className={`chip ${from === lastQ[0] && to === lastQ[2] ? 'on' : ''}`} onClick={() => preset(lastQ[0], lastQ[2])}>{t3('الفصل الماضي', 'Last quarter', 'Trimestre passé')}</button>
          <button className={`chip ${from === yr[0] && to === thisYm ? 'on' : ''}`} onClick={() => preset(yr[0], thisYm)}>{t3('هذه السنة (من تشرين الأول)', 'This year (from October)', 'Cette année (depuis octobre)')}</button>
          <button className={`chip ${from === firstYm && to === thisYm ? 'on' : ''}`} onClick={() => preset(firstYm, thisYm)}>{t3('منذ البداية', 'The whole time', 'Depuis le début')}</button>
          <span className="rep-fromto">
            {t3('من', 'From', 'De')} <input type="month" value={from} max={thisYm} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            {' '}{t3('إلى', 'to', 'à')} <input type="month" value={to} max={thisYm} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </span>
        </div>
        <div className="rep-row">
          <span className="cty-label">{t3('العملة', 'Currency', 'Monnaie')}</span>
          {(['LOC', 'USD', 'EUR', 'ALL'] as CurPick[]).map((c) => (
            <button key={c} className={`chip ${cur === c ? 'on' : ''}`} onClick={() => setCur(c)}>{c === 'ALL' ? t3('الكل ≈ $', 'All ≈ $', 'Tout ≈ $') : curName(c, d.local)}</button>
          ))}
        </div>
        {usedHeads.length > 0 && (
          <div className="rep-row">
            <span className="cty-label">{t3('البنود', 'Headings', 'Rubriques')}</span>
            <button className={`chip ${!heads.length ? 'on' : ''}`} onClick={() => setHeads([])}>{t3('الكل', 'All', 'Toutes')}</button>
            {usedHeads.map((h) => <button key={h.id} className={`chip ${heads.includes(h.id) ? 'on' : ''}`} onClick={() => toggle(heads, h.id, setHeads)}>{headName(h)}</button>)}
          </div>
        )}
        {scope === 'community' && (
          <div className="rep-row">
            <span className="cty-label">{t3('من', 'Who', 'Qui')}</span>
            <button className={`chip ${!who.length ? 'on' : ''}`} onClick={() => setWho([])}>{t3('الجماعة كلها', 'The whole community', 'Toute la communauté')}</button>
            {members.map((m) => <button key={m.key} className={`chip ${who.includes(m.key) ? 'on' : ''}`} onClick={() => toggle(who, m.key, setWho)}>{m.label}</button>)}
          </div>
        )}
      </div>

      {/* 2. the view */}
      <div className="desk-tabs" role="tablist">
        <button role="tab" className={view === 'cat' ? 'on' : ''} onClick={() => setView('cat')}>{t3('حسب البند', 'By category', 'Par catégorie')}</button>
        <button role="tab" className={view === 'months' ? 'on' : ''} onClick={() => setView('months')}>{t3('شهراً بشهر', 'Month by month', 'Mois par mois')}</button>
        {scope === 'community' && <button role="tab" className={view === 'members' ? 'on' : ''} onClick={() => setView('members')}>{t3('حسب العضو', 'By member', 'Par membre')}</button>}
      </div>

      {total === 0 && view !== 'members' && <div className="cty-card"><p className="muted">{t3('لا نفقات في هذه الفترة.', 'No expenses in this period.', 'Aucune dépense sur cette période.')}</p></div>}

      {view === 'cat' && total > 0 && (
        <div className="desk-two">
          <div className="cty-card">
            <div className="cty-label">{t3('أين ذهب المال', 'Where the money went', "Où l'argent est allé")} · {unit}</div>
            <Ring parts={parts} fmt={fmt} center={unit} onPick={(p) => setOpen(typeof p.key === 'number' ? (open === p.key ? null : p.key) : null)} />
            <p className="muted small">{t3('اضغط على بند لترى تفاصيله.', 'Click a heading to see its lines.', 'Cliquez sur une rubrique pour voir ses lignes.')}</p>
          </div>
          <div className="cty-card">
            <table className="desk-table">
              <thead><tr><th>{t3('البند', 'Heading', 'Rubrique')}</th><th className="num">{unit}</th><th className="num">%</th></tr></thead>
              <tbody>
                {parts.filter((p) => p.value).sort((a, b) => b.value - a.value).map((p) => (
                  <Fragment key={p.key}>
                    <tr className={`click ${open === p.key ? 'picked' : ''}`} onClick={() => setOpen(open === p.key ? null : (p.key as number))}>
                      <td><b>{p.label}</b></td><td className="num">{fmt(p.value)}</td><td className="num">{Math.round((p.value / total) * 100)}%</td>
                    </tr>
                    {open === p.key && openedLines.map((l) => (
                      <tr key={l.a.id} className="fdc-line"><td>{l.a.code} {accName(l.a)}</td><td className="num">{fmt(l.v)}</td><td className="num muted">{Math.round((l.v / p.value) * 100)}%</td></tr>
                    ))}
                  </Fragment>
                ))}
                <tr className="fdc-total"><td>{t3('المجموع', 'Total', 'Total')}</td><td className="num">{fmt(total)}</td><td className="num">100%</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'months' && total > 0 && (
        <>
          <div className="cty-card">
            <div className="cty-label">{t3('النفقات شهراً بشهر', 'Expenses month by month', 'Dépenses mois par mois')} · {unit}{heads.length ? ` · ${headsShown.map((h) => accName(h)).join(', ')}` : ''}</div>
            <Columns cols={months.map((m) => ({ label: monthName(m, true).slice(0, 3), title: monthName(m), now: sum(shown, [m], null), before: sum(shown, [shift(m, -12)], null) || undefined }))} fmt={(n) => `${fmt(n)} ${unit}`} />
            <div className="muted small"><i className="cty-key now" /> {t3('هذه الفترة', 'this period', 'cette période')} · <i className="cty-key before" /> {t3('قبل سنة', 'a year before', 'un an avant')}</div>
          </div>
          <div className="cty-card desk-scroll">
            <p className="muted small">{t3('لتقارن أشهراً لبند أو أكثر: اختر البنود في الأعلى، والأشهر بـ«من… إلى».', 'To compare months for one or more headings: choose the headings above, and the months with "From… to".', 'Pour comparer des mois pour une ou plusieurs rubriques : choisissez les rubriques en haut, et les mois avec « De… à ».')}</p>
            <table className="desk-table">
              <thead><tr><th>{t3('الشهر', 'Month', 'Mois')}</th>{headsShown.map((h, i) => <th key={h.id} className="num"><i className="rep-dot" style={{ background: SHADES[i % SHADES.length] }} /> {accName(h)}</th>)}<th className="num">{t3('المجموع', 'Total', 'Total')}</th></tr></thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m}><td>{monthName(m)}</td>{headsShown.map((h) => <td key={h.id} className="num">{sum(shown, [m], h.id) ? fmt(sum(shown, [m], h.id)) : <span className="muted">-</span>}</td>)}<td className="num"><b>{fmt(sum(shown, [m], null))}</b></td></tr>
                ))}
                <tr className="fdc-total"><td>{t3('المجموع', 'Total', 'Total')}</td>{headsShown.map((h) => <td key={h.id} className="num">{fmt(sum(shown, months, h.id))}</td>)}<td className="num">{fmt(total)}</td></tr>
                {months.length > 1 && <tr className="muted"><td>{t3('معدّل الشهر', 'Average a month', 'Moyenne par mois')}</td>{headsShown.map((h) => <td key={h.id} className="num">{fmt(sum(shown, months, h.id) / months.length)}</td>)}<td className="num">{fmt(total / months.length)}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'members' && scope === 'community' && (
        <div className="cty-card desk-scroll">
          <div className="cty-label">{t3('نفقات كل عضو', "Each member's expenses", 'Les dépenses de chaque membre')} · {unit}{heads.length ? ` · ${headsShown.map((h) => accName(h)).join(', ')}` : ''}</div>
          <table className="desk-table">
            <thead><tr><th>{t3('العضو', 'Member', 'Membre')}</th>{months.map((m) => <th key={m} className="num">{monthName(m, true)}</th>)}<th className="num">{t3('المجموع', 'Total', 'Total')}</th><th className="num">{t3('معدّل الشهر', 'Average a month', 'Moyenne par mois')}</th></tr></thead>
            <tbody>
              {(() => {
                const ps = shown.filter((m) => m.kind === 'personal');
                const row = (mb: Member) => {
                  const t = sum([mb], months, null);
                  return (
                    <tr key={mb.key} className={mb.kind !== 'personal' ? 'rep-house' : ''}>
                      <td><b>{mb.kind === 'house' ? bookLabel(mb.books[0]) : mb.label}</b></td>
                      {months.map((m) => <td key={m} className="num">{sum([mb], [m], null) ? fmt(sum([mb], [m], null)) : <span className="muted">-</span>}</td>)}
                      <td className="num"><b>{fmt(t)}</b></td><td className="num muted">{fmt(t / months.length)}</td>
                    </tr>
                  );
                };
                return (
                  <>
                    {ps.map(row)}
                    {ps.length > 1 && (
                      <tr className="fdc-head"><td>{t3('النفقات الشخصية معاً', 'Personal expenses together', 'Dépenses personnelles ensemble')}</td>{months.map((m) => <td key={m} className="num">{fmt(sum(ps, [m], null))}</td>)}<td className="num">{fmt(sum(ps, months, null))}</td><td className="num muted">{fmt(sum(ps, months, null) / months.length)}</td></tr>
                    )}
                    {shown.filter((m) => m.kind !== 'personal').map(row)}
                  </>
                );
              })()}
              <tr className="fdc-total"><td>{t3('المجموع', 'Total', 'Total')}</td>{months.map((m) => <td key={m} className="num">{fmt(sum(shown, [m], null))}</td>)}<td className="num">{fmt(sum(shown, months, null))}</td><td className="num">{fmt(sum(shown, months, null) / months.length)}</td></tr>
            </tbody>
          </table>
          {months.length > 14 && <p className="muted small">{t3('فترة طويلة: مرّر الجدول أفقياً.', 'A long period: scroll the table sideways.', 'Une longue période : faites défiler le tableau.')}</p>}
        </div>
      )}
    </div>
  );
}

const shift = (ym: string, k: number) => {
  const [y, mo] = ym.split('-').map(Number);
  const t = y * 12 + (mo - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
