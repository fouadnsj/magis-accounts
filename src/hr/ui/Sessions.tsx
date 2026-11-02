// Tutors paid by session (Fouad, 31 October 2026). The page is a register: one line per tutor, one column per day of
// the month; a click on a day records a session (with the tutor's usual activity), a click on a filled day shows that
// day's sessions. At the end of the line: how many sessions and how much (each session at the price of its date). The
// month sheet goes to Excel (one line per tutor, and every session by date). The price is one, kept in the settings.
import { useCallback, useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import type { Session } from '../../state';
import { saveFile } from '../../platform';
import { Field, Modal, confirmBox, fmtDate, todayIso } from '../../ui/kit';
import { getLang } from '../../i18n';
import { t3 } from '../../community/ui/text';
import type { HrData, HrPerson } from '../hr';
import type { HrPayData } from '../payOps';
import { rateOf } from '../pay';
import { priceOn, type HrSession, type HrSessionPrice } from '../sessions';
import { TwoNames, centreOf, centreVars, codeOf, fail, markOf, usd, type HrRights } from './common';
import { has } from '../../auth';
import { GuideLink } from '../../guide/GuideView';

interface Month { sessions: HrSession[]; prices: HrSessionPrice[]; activities: string[] }

const thisMonth = () => todayIso().slice(0, 7);
const shift = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const dayOf = (ym: string, d: number) => `${ym}-${String(d).padStart(2, '0')}`;
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const monthLabel = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString(getLang() === 'ar' ? 'ar-SY' : getLang() === 'fr' ? 'fr-FR' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const priceText = (p: HrSessionPrice | null) => (p ? `${usd(p.amount)} ${p.currency === 'USD' ? '$' : 'SYP'}` : '—');

/** what a tutor's sessions of the month come to: by currency, and in dollars (pounds at the centre's rate) */
function amounts(xs: HrSession[], prices: HrSessionPrice[], rate: number) {
  const by = { USD: 0, SYP: 0 };
  let missing = 0;
  for (const x of xs) { const p = priceOn(prices, x.on_date); if (p) by[p.currency] += p.amount; else missing++; }
  return { ...by, usd: by.USD + (by.SYP && rate > 0 ? by.SYP / rate : 0), missing };
}
const amountText = (a: { USD: number; SYP: number }) => [a.USD ? `${usd(a.USD)} $` : '', a.SYP ? `${usd(a.SYP)} SYP` : ''].filter(Boolean).join(' + ') || '—';

/** the tutors who count in a month: here during the month, or with a session in it */
const tutorsOf = (d: HrData, ym: string, xs: HrSession[]) => d.people.filter((p) => p.category === 'tutor'
  && (xs.some((x) => x.person_id === p.id) || ((!p.started || p.started <= dayOf(ym, daysIn(ym))) && (!p.ended || p.ended >= `${ym}-01`) && (p.active || p.ended))));

function useMonth(s: Session, ym: string) {
  const [m, setM] = useState<Month | null>(null);
  const load = useCallback(async () => { try { setM(await s.api.call('hr.sessions.get', { ym })); } catch (e) { fail(e); } }, [s, ym]);
  useEffect(() => { setM(null); void load(); }, [load]);
  return { m, load };
}

function MonthNav({ ym, set }: { ym: string; set: (ym: string) => void }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <button className="btn small" onClick={() => set(shift(ym, -1))} title={t3('الشهر السابق', 'Previous month', 'Mois précédent')}>‹</button>
      <input type="month" value={ym} onChange={(e) => e.target.value && set(e.target.value)} />
      <button className="btn small" onClick={() => set(shift(ym, 1))} title={t3('الشهر التالي', 'Next month', 'Mois suivant')}>›</button>
    </span>
  );
}

export function SessionsPage({ s, hr, pd, open, addTutor, r: rt }: { s: Session; hr: HrData; pd: HrPayData | null; open: (p: HrPerson) => void; addTutor: () => void; r: HrRights }) {
  // who only records the sessions sees neither the price nor the amounts (Fouad, 1 November 2026)
  const see = rt.salary;
  const [ym, setYm] = useState(thisMonth);
  const { m, load } = useMonth(s, ym);
  const [day, setDay] = useState<{ p: HrPerson; date: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const n = daysIn(ym);
  const today = todayIso();
  const sessions = useMemo(() => (m ? m.sessions.filter((x) => hr.people.some((p) => p.id === x.person_id)) : []), [m, hr]);
  const tutors = useMemo(() => tutorsOf(hr, ym, sessions), [hr, ym, sessions]);
  const groups = [...new Set(tutors.map((p) => p.centre ?? ''))].sort((a, b) => a.localeCompare(b));
  const now = m ? priceOn(m.prices, today) : null;
  const rateFor = (p: HrPerson) => rateOf(pd?.settings, codeOf(hr, p));

  const quickAdd = async (p: HrPerson, date: string) => {
    if (!p.activity) { setDay({ p, date }); return; }
    setBusy(true);
    try { await s.api.call('hr.session.add', { personId: p.id, date, activity: p.activity }); await load(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const download = async () => {
    if (!m) return;
    const wb = new ExcelJS.Workbook();
    const head = (ws: ExcelJS.Worksheet, cols: string[]) => {
      const r = ws.addRow(cols);
      r.font = { bold: true };
      r.eachCell((x) => { x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEAE0' } }; });
    };
    // one line per tutor (and currency)
    const ws = wb.addWorksheet('Month');
    ws.addRow([`Tutors' sessions · ${ym}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    head(ws, ['Centre', 'Tutor (Arabic)', 'Tutor', 'Usual activity', 'Sessions', 'Price', 'Amount', 'Currency', 'In USD']);
    const first = ws.rowCount + 1;
    for (const p of tutors) {
      const xs = sessions.filter((x) => x.person_id === p.id);
      if (!xs.length) continue;
      for (const cur of ['USD', 'SYP'] as const) {
        const mine = xs.filter((x) => priceOn(m.prices, x.on_date)?.currency === cur);
        if (!mine.length) continue;
        const unit = [...new Set(mine.map((x) => priceOn(m.prices, x.on_date)!.amount))];
        const total = mine.reduce((a, x) => a + priceOn(m.prices, x.on_date)!.amount, 0);
        const rate = rateFor(p);
        ws.addRow([p.centre ?? '', p.name_ar ?? '', p.name, p.activity ?? '', mine.length, unit.length === 1 ? unit[0] : null, total, cur, cur === 'USD' ? total : rate > 0 ? Math.round((total / rate) * 100) / 100 : null]);
      }
      const unpriced = xs.filter((x) => !priceOn(m.prices, x.on_date)).length;
      if (unpriced) ws.addRow([p.centre ?? '', p.name_ar ?? '', p.name, p.activity ?? '', unpriced, null, null, 'no price', null]);
    }
    const last = ws.rowCount;
    ws.addRow(['Total', '', '', '', { formula: `SUM(E${first}:E${last})` }, '', '', '', { formula: `SUM(I${first}:I${last})` }]).font = { bold: true };
    ws.columns = [{ width: 18 }, { width: 24 }, { width: 24 }, { width: 22 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 10 }, { width: 12 }];
    [6, 7, 9].forEach((c) => { ws.getColumn(c).numFmt = '#,##0.##'; });
    ws.addRow([]);
    ws.addRow(['Pounds are counted in dollars at the dollar rate of the tutor\'s centre.']).font = { italic: true, color: { argb: 'FF8A8577' } };
    // every session by date
    const wd = wb.addWorksheet('By date');
    head(wd, ['Date', 'Day', 'Centre', 'Tutor (Arabic)', 'Tutor', 'Activity', 'Price', 'Currency', 'In a payroll run']);
    const names = new Map(hr.people.map((p) => [p.id, p]));
    for (const x of [...sessions].sort((a, b) => a.on_date.localeCompare(b.on_date) || (names.get(a.person_id)?.name ?? '').localeCompare(names.get(b.person_id)?.name ?? ''))) {
      const p = names.get(x.person_id)!;
      const pr = priceOn(m.prices, x.on_date);
      wd.addRow([x.on_date, new Date(`${x.on_date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }), p.centre ?? '', p.name_ar ?? '', p.name, x.activity ?? '', pr?.amount ?? null, pr?.currency ?? 'no price', x.run_line_id ? 'yes' : 'no']);
    }
    wd.columns = [{ width: 12 }, { width: 12 }, { width: 18 }, { width: 24 }, { width: 24 }, { width: 22 }, { width: 10 }, { width: 10 }, { width: 14 }];
    wd.getColumn(7).numFmt = '#,##0.##';
    wd.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
    wd.views = [{ state: 'frozen', ySplit: 1 }];
    await saveFile(`HR-sessions-${ym}.xlsx`, ['xlsx'], new Uint8Array(await wb.xlsx.writeBuffer()), 'Excel');
  };

  const grand = m ? amounts(sessions, m.prices, 0) : null;
  return (
    <>
      <div className="hr-head">
        <div><div className="hr-eyebrow">{t3('المدرّبون والمنشّطون', 'Tutors and animators', 'Animateurs et tuteurs')}</div><h1>{t3('الجلسات', 'Sessions', 'Séances')} · {monthLabel(ym)}<GuideLink id="hr-sessions" /></h1></div>
        <div className="desk-filters">
          <MonthNav ym={ym} set={setYm} />
          {see && <button className="btn" disabled={!sessions.length} onClick={download}>⬇ Excel</button>}
          {rt.manage && <button className="btn gold" onClick={addTutor}>＋ {t3('مدرّب', 'Tutor', 'Animateur')}</button>}
        </div>
      </div>
      {m && see && (now
        ? <p className="muted small">{t3('سعر الجلسة', 'Price of a session', "Prix d'une séance")}: <b>{priceText(now)}</b> {t3('منذ', 'since', 'depuis')} {fmtDate(now.valid_from)} · {t3('يُغيَّر في «الإعدادات ← سعر الجلسة»', 'changed in Settings → Session price', 'se change dans Réglages → Prix de la séance')}</p>
        : <div className="alert err">{t3('لم يُكتب سعر الجلسة بعد: اكتبه في «الإعدادات ← سعر الجلسة».', 'The price of a session is not written yet: write it in Settings → Session price.', "Le prix d'une séance n'est pas encore écrit : écrivez-le dans Réglages → Prix de la séance.")}</div>)}
      <p className="muted small">{t3('اضغط على يوم لتسجيل جلسة (بالنشاط المعتاد للمدرّب)، واضغط على يوم مسجَّل لرؤية جلساته. 🔒 = في كشف دفع.', "Click a day to record a session (with the tutor's usual activity); click a filled day to see its sessions. 🔒 = in a payroll run.", "Cliquez sur un jour pour noter une séance (avec l'activité habituelle) ; cliquez sur un jour rempli pour voir ses séances. 🔒 = dans une paie.")}</p>
      {!m ? <p className="muted">…</p> : !tutors.length ? (
        <div className="hr-panel"><p className="muted" style={{ margin: 0 }}>{t3('لا مدرّبين بعد. أضف مدرّباً بالزر «＋ مدرّب».', 'No tutors yet. Add one with "＋ Tutor".', 'Pas encore d’animateurs. Ajoutez-en un avec « ＋ Animateur ».')}</p></div>
      ) : groups.map((g) => {
        const xs = tutors.filter((p) => (p.centre ?? '') === g);
        const key = centreOf(hr, xs[0]).key;
        const sub = amounts(sessions.filter((x) => xs.some((p) => p.id === x.person_id)), m.prices, 0);
        return (
          <section key={g} className="hr-group" style={centreVars(key)}>
            {groups.length > 1 && <h3><img src={markOf(key)} alt="" />{g || t3('بلا مركز', 'No centre', 'Sans centre')} <span className="n">· {xs.length}</span></h3>}
            <div className="hr-panel hr-reg-wrap">
              <table className="hr-reg">
                <thead>
                  <tr>
                    <th className="who">{t3('المدرّب', 'Tutor', 'Animateur')}</th>
                    <th className="n tot">{t3('جلسات', 'Sessions', 'Séances')}</th>
                    <th className="n tot">{see ? t3('المبلغ', 'Amount', 'Montant') : ''}</th>
                    {Array.from({ length: n }, (_, i) => { const date = dayOf(ym, i + 1); const w = weekday(date); return <th key={i} className={`${w === 5 ? 'fri' : ''} ${date === today ? 'today' : ''}`}><small>{['S', 'M', 'T', 'W', 'T', 'F', 'S'][w]}</small>{i + 1}</th>; })}
                  </tr>
                </thead>
                <tbody>
                  {xs.map((p) => {
                    const mine = sessions.filter((x) => x.person_id === p.id);
                    const a = amounts(mine, m.prices, rateFor(p));
                    return (
                      <tr key={p.id} style={{ opacity: p.active ? 1 : 0.6 }}>
                        <td className="who"><button className="link" onClick={() => open(p)}><TwoNames p={p} /></button><div className="muted small">{p.activity ?? t3('بلا نشاط معتاد', 'no usual activity', "pas d'activité habituelle")}</div></td>
                        <td className="n tot"><b>{mine.length || ''}</b></td>
                        <td className="n nowrap tot">{see && <>{mine.length ? amountText(a) : ''}{a.SYP && a.USD + a.SYP && rateFor(p) > 0 ? <div className="muted small">≈ {usd(Math.round(a.usd))} $</div> : null}{a.missing ? <div className="desk-alert small">{a.missing} {t3('بلا سعر', 'no price', 'sans prix')}</div> : null}</>}</td>
                        {Array.from({ length: n }, (_, i) => {
                          const date = dayOf(ym, i + 1);
                          const here = mine.filter((x) => x.on_date === date);
                          const locked = here.length > 0 && here.every((x) => x.run_line_id);
                          return (
                            <td key={i} className={`${weekday(date) === 5 ? 'fri' : ''} ${here.length ? 'on' : ''}`}>
                              <button disabled={busy} title={here.map((x) => x.activity ?? '').join(' · ') || t3('سجّل جلسة', 'Record a session', 'Noter une séance')} onClick={() => (here.length ? setDay({ p, date }) : void quickAdd(p, date))}>
                                {here.length ? (locked ? '🔒' : here.length > 1 ? here.length : '●') : ''}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr><td className="who"><b>{t3('المجموع', 'Total', 'Total')}</b></td><td className="n tot"><b>{sessions.filter((x) => xs.some((p) => p.id === x.person_id)).length}</b></td><td className="n nowrap tot"><b>{see ? amountText(sub) : ''}</b></td><td colSpan={n} /></tr>
                </tfoot>
              </table>
            </div>
          </section>
        );
      })}
      {m && groups.length > 1 && grand && <p style={{ textAlign: 'end' }}><b>{t3('مجموع الشهر', 'Total of the month', 'Total du mois')}: {sessions.length} {t3('جلسة', 'sessions', 'séances')}{see ? ` · ${amountText(grand)}` : ''}</b></p>}
      {day && m && <DayModal s={s} p={day.p} date={day.date} m={m} onClose={() => setDay(null)} reload={load} />}
    </>
  );
}

/** a day of a tutor: its sessions (activity, remove) and one more */
function DayModal({ s, p, date, m, onClose, reload }: { s: Session; p: HrPerson; date: string; m: Month; onClose: () => void; reload: () => Promise<void> }) {
  const here = m.sessions.filter((x) => x.person_id === p.id && x.on_date === date);
  const [activity, setActivity] = useState(p.activity ?? '');
  const add = async () => { try { await s.api.call('hr.session.add', { personId: p.id, date, activity: activity || null }); await reload(); onClose(); } catch (e) { fail(e); } };
  return (
    <Modal title={`${p.name_ar || p.name} · ${fmtDate(date)}`} onClose={onClose} narrow>
      {here.length > 0 && (
        <ul className="hr-check" style={{ marginBottom: 12 }}>
          {here.map((x) => (
            <li key={x.id}>
              <span className="lbl">{x.activity ?? <span className="muted">{t3('بلا نشاط', 'no activity', 'sans activité')}</span>}{x.source !== 'hand' ? <span className="muted small"> · {t3('من التقويم', 'from the calendar', 'du calendrier')}</span> : null}</span>
              {x.run_line_id ? <span className="muted small">🔒 {t3('في كشف دفع', 'in a payroll run', 'dans une paie')}</span>
                : <button className="btn small danger" onClick={async () => { if (await confirmBox(t3('حذف هذه الجلسة؟', 'Remove this session?', 'Retirer cette séance ?'), true)) { try { await s.api.call('hr.session.delete', { id: x.id }); await reload(); onClose(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Remove', 'Retirer')}</button>}
            </li>
          ))}
        </ul>
      )}
      <Field label={here.length ? t3('جلسة أخرى في اليوم نفسه: النشاط', 'Another session the same day: activity', 'Une autre séance le même jour : activité') : t3('النشاط', 'Activity', 'Activité')}>
        <input list="hr-activities" autoFocus value={activity} onChange={(e) => setActivity(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
        <datalist id="hr-activities">{m.activities.map((a) => <option key={a} value={a} />)}</datalist>
      </Field>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إغلاق', 'Close', 'Fermer')}</button>
        <button className="btn primary" onClick={add}>＋ {here.length ? t3('جلسة أخرى', 'Another session', 'Une autre séance') : t3('سجّل الجلسة', 'Record the session', 'Noter la séance')}</button>
      </div>
    </Modal>
  );
}

/**
 * A tutor's card: their sessions of a month, to read. Sessions are recorded in one place only, the Tutors' sessions page
 * (Fouad, 2026-11-02): the button opens it. Here only the tutor's usual activity is changed.
 */
export function TutorSessions({ s, hr, pd, person, manage, reload, onRecord }: { s: Session; hr: HrData; pd: HrPayData | null; person: HrPerson; manage: boolean; reload: () => Promise<void>; /** opens the Tutors' sessions page */ onRecord: () => void }) {
  const [ym, setYm] = useState(thisMonth);
  const { m } = useMonth(s, ym);
  const [usual, setUsual] = useState(person.activity ?? '');
  const mine = m ? m.sessions.filter((x) => x.person_id === person.id) : [];
  const a = m ? amounts(mine, m.prices, rateOf(pd?.settings, codeOf(hr, person))) : null;
  const see = has(s.profile, 'hr.salary');
  return (
    <>
      <div className="hr-panel">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <b>{t3('الجلسات', 'Sessions', 'Séances')} · {monthLabel(ym)}</b>
          <MonthNav ym={ym} set={setYm} />
        </div>
        {!m ? <p className="muted">…</p> : (
          <>
            <table className="desk-table" style={{ marginTop: 8 }}>
              <thead><tr><th>{t3('التاريخ', 'Date', 'Date')}</th><th>{t3('النشاط', 'Activity', 'Activité')}</th>{see && <th className="n">{t3('السعر', 'Price', 'Prix')}</th>}<th /></tr></thead>
              <tbody>
                {mine.map((x) => (
                  <tr key={x.id}>
                    <td>{fmtDate(x.on_date)}</td><td>{x.activity ?? '—'}</td>{see && <td className="n">{priceText(priceOn(m.prices, x.on_date))}</td>}
                    <td className="right">{x.run_line_id ? <span className="muted small">🔒 {t3('في كشف دفع', 'in a payroll run', 'dans une paie')}</span> : null}</td>
                  </tr>
                ))}
                {!mine.length && <tr><td colSpan={4} className="muted">{t3('لا جلسات في هذا الشهر.', 'No sessions this month.', 'Aucune séance ce mois-ci.')}</td></tr>}
              </tbody>
              {mine.length > 0 && a && <tfoot><tr><td colSpan={2}><b>{mine.length} {t3('جلسة', 'sessions', 'séances')}</b></td>{see && <td className="n"><b>{amountText(a)}</b></td>}<td /></tr></tfoot>}
            </table>
            {manage && (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn gold" onClick={onRecord}>🎓 {t3('سجّل أو عدّل الجلسات في «جلسات المدرّبين»', "Record or change sessions in the Tutors' sessions page", 'Noter ou changer les séances dans la page Séances des animateurs')}</button>
                <datalist id="hr-activities-p">{m.activities.map((x) => <option key={x} value={x} />)}</datalist>
              </div>
            )}
          </>
        )}
      </div>
      {manage && (
        <div className="hr-panel" style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t3('النشاط المعتاد (يُقترح عند تسجيل جلسة)', 'Usual activity (offered when a session is recorded)', 'Activité habituelle (proposée quand une séance est notée)')}><input list="hr-activities-p" value={usual} onChange={(e) => setUsual(e.target.value)} /></Field>
            <button className="btn" disabled={usual === (person.activity ?? '')} onClick={async () => { try { await s.api.call('hr.person.save', { ...person, activity: usual || null }); await reload(); } catch (e) { fail(e); } }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Settings → the price of a session: one for every centre, from a date (a new price leaves the months before it) */
export function SessionPriceTab({ s, d }: { s: Session; d: HrData }) {
  const [prices, setPrices] = useState<HrSessionPrice[] | null>(null);
  const [f, setF] = useState({ validFrom: todayIso(), amount: '', currency: 'USD' as 'USD' | 'SYP' });
  const load = useCallback(async () => { try { setPrices(await s.api.call('hr.session.prices', {})); } catch (e) { fail(e); } }, [s]);
  useEffect(() => { void load(); }, [load]);
  const all = !d.scope;
  return (
    <>
      <p className="muted">{t3('المدرّبون والمنشّطون يُدفع لهم بالجلسة، بلا اتفاقية. السعر واحد لكل المراكز. سعر جديد يبدأ من تاريخه ولا يغيّر الأشهر السابقة.', 'Tutors and animators are paid by session, without an agreement. The price is one for every centre. A new price starts from its date and does not change the months before.', "Les animateurs sont payés à la séance, sans accord. Le prix est le même pour tous les centres. Un nouveau prix commence à sa date et ne change pas les mois d'avant.")}</p>
      <div className="hr-panel">
        <b>{t3('سعر الجلسة', 'Price of a session', "Prix d'une séance")}</b>
        <table className="desk-table" style={{ marginTop: 6 }}>
          <thead><tr><th>{t3('من تاريخ', 'From', 'À partir du')}</th><th className="n">{t3('السعر', 'Price', 'Prix')}</th><th /></tr></thead>
          <tbody>
            {(prices ?? []).map((p, i) => (
              <tr key={p.id}><td>{fmtDate(p.valid_from)}{i === 0 && p.valid_from <= todayIso() ? <span className="ok small"> · {t3('الحالي', 'current', 'actuel')}</span> : null}</td><td className="n"><b>{priceText(p)}</b></td>
                <td className="right">{all && <button className="btn small" onClick={async () => { if (await confirmBox(t3('حذف هذا السعر؟', 'Remove this price?', 'Retirer ce prix ?'), true)) { try { await s.api.call('hr.session.price.delete', { id: p.id }); await load(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Remove', 'Retirer')}</button>}</td></tr>
            ))}
            {prices && !prices.length && <tr><td colSpan={3} className="muted">{t3('لا سعر بعد.', 'No price yet.', 'Pas encore de prix.')}</td></tr>}
          </tbody>
        </table>
        {all ? (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
            <Field label={t3('من تاريخ', 'From', 'À partir du')}><input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field>
            <Field label={t3('السعر', 'Price', 'Prix')}><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="10" /></Field>
            <Field label={t3('العملة', 'Currency', 'Devise')}><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'SYP' })}><option value="USD">USD $</option><option value="SYP">SYP</option></select></Field>
            <button className="btn primary" disabled={!(Number(f.amount) > 0) || !f.validFrom} onClick={async () => { try { await s.api.call('hr.session.price.save', { validFrom: f.validFrom, amount: Number(f.amount), currency: f.currency }); setF({ ...f, amount: '' }); await load(); } catch (e) { fail(e); } }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
          </div>
        ) : <p className="muted small">{t3('يغيّره من يرى كل المراكز.', 'Changed by someone who sees every centre.', 'Changé par quelqu’un qui voit tous les centres.')}</p>}
      </div>
    </>
  );
}
