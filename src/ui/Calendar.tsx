// The MAGIS Calendar (baseline 2.1 §8, step 2): the laptop screen. One slim bar (‹ Today › · period · Day | Week | Month
// | List · area · search · + New), the quick views (Everything, Halls, Rooms and the categories added in the settings, kept
// per person), the Today strip (each tile opens its list with its buttons), and the views. Selecting on the calendar
// (dragging over hours in the day view, over days and spaces in the week, over days in the month) opens a new booking with
// everything selected already filled in. The rules: hosting/calendar.ts; what is shown: hosting/calview.ts.
// The full windows (price, services, equipment, organisations) come in step 3; here a first booking window.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import { Field, Modal, Seg, Tabs, biName, confirmBox, errText, parseAmount, promptBox, t, toast, todayIso } from './kit';
import { m, tx, monthWord } from '../i18n';
import { addDays, colorOf, type Currency } from '../hosting/host';
import { calTotals, givenBack, holdDate, holdPassed, inCalendar, mayChange, occurrences, received, seesPrices, sleepsIn, type CalBooking, type CalData, type CalOrg, type CalSpace, type Totals } from '../hosting/calendar';
import { bandOf, hm, itemsBetween, listOf, monthGrid, nextDate, search, shutOf, spacesShown, prepareOf, todayFigures, weekOf, type DayItem, type ListKind } from '../hosting/calview';
import { CalSettings, inRoomText } from './CalSettings';
import { BookingReceipt, CancelWindow, METHOD, MoneyWindow, PayWindow, PrintWindow, useBookingSheet, usePayReceipt } from './CalPaper';

type Screen = 'calendar' | 'settings';
type View = 'day' | 'week' | 'month' | 'list';

// ---------------------------------------------------------------- words, days and colours

const L = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));
// Monday first in every language (baseline §8); digits 0–9 everywhere
const WD = [
  ['الإثنين', 'Mon', 'lun.'], ['الثلاثاء', 'Tue', 'mar.'], ['الأربعاء', 'Wed', 'mer.'], ['الخميس', 'Thu', 'jeu.'],
  ['الجمعة', 'Fri', 'ven.'], ['السبت', 'Sat', 'sam.'], ['الأحد', 'Sun', 'dim.'],
];
const MONTHS_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const wdIndex = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
const wdName = (d: string) => { const w = WD[wdIndex(d)]; return L(w[0], w[1], w[2]); };
const monthName = (d: string) => monthWord(Number(d.slice(5, 7)) - 1, MONTHS_AR, MONTHS_EN);
export const fmtDay = (d: string) => `${wdName(d)} ${Number(d.slice(8, 10))} ${monthName(d)}`;
const fmtShort = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
/** the weekday chips of a weekly repeat: Monday … Sunday, stored 1 … 6, 0 */
const REPEAT_ORDER = [1, 2, 3, 4, 5, 6, 0];

const STATUS: Record<string, () => string> = {
  option: () => L('للتأكيد', 'To confirm', 'À confirmer'), confirmed: () => L('مؤكَّد', 'Confirmed', 'Confirmé'), arrived: () => L('وصلوا', 'Arrived', 'Arrivés'),
  left: () => L('غادروا', 'Left', 'Partis'), cancelled: () => L('ملغى', 'Cancelled', 'Annulé'),
};
/** the colours of a booking: our activity in the colour of its kind, a hall booking grey, a stay sand, the whole centre dark */
function colours(d: CalData, b: CalBooking): { bg: string; fg: string } {
  if (b.whole_centre) return { bg: '#26292E', fg: '#fff' };
  if (b.origin === 'ours') return { bg: d.activityKinds.find((k) => k.id === b.activity_kind_id)?.color || '#B5D4F4', fg: '#26292E' };
  return b.kind === 'stay' ? { bg: '#FAEEDA', fg: '#854F0B' } : { bg: '#D3D1C7', fg: '#2C2C2A' };
}
const kindText = (d: CalData, b: CalBooking) => b.whole_centre ? L('المركز كله', 'Whole centre', 'Tout le centre')
  : b.origin === 'ours' ? biName(d.activityKinds.find((k) => k.id === b.activity_kind_id)?.name ?? '') || L('نشاطنا', 'Our activity', 'Notre activité')
    : b.kind === 'stay' ? L('إقامة', 'Guest stay', 'Séjour') : L('حجز قاعة', 'Hall booking', 'Réservation de salle');
const label = (b: CalBooking) => `${b.origin === 'outside' ? '◆ ' : ''}${b.group_name}${b.subject ? ` · ${b.subject}` : ''}`;
const hours = (it: DayItem) => (it.occ.from === 0 && it.occ.to === 1440 ? '' : `${hm(it.occ.from)}–${hm(it.occ.to)}`);
const nowMinutes = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

/** where a new booking starts: what was selected on the calendar */
export interface NewStart { spaces?: number[]; from?: string; to?: string; t1?: string; t2?: string; stay?: boolean }

// ---------------------------------------------------------------- the page

export function Calendar() {
  // d changes when the program reloads (on the network: someone else changed something): the calendar reads again
  const { s, d } = useApp();
  const [data, setData] = useState<CalData | null>(null);
  const [screen, setScreen] = useState<Screen>('calendar');
  const load = useCallback(async () => {
    try { setData(await s.api.call('cal.get')); } catch (e) { toast(errText(e), true); }
  }, [s]);
  useEffect(() => { void load(); }, [load, d]);
  if (!data) return <p className="muted">…</p>;
  const setup = data.rights.setup || data.rights.whole;
  return (
    <>
      {/* calendar ↔ settings, easy to see both ways (Fouad's first test, 23 November 2026) */}
      {screen === 'settings' && setup ? (
        <div className="page-head">
          <h1><button className="linkish cal-crumb" onClick={() => setScreen('calendar')}>{L('التقويم', 'Calendar', 'Calendrier')}</button> <span className="muted">›</span> {L('الإعدادات', 'Settings', 'Réglages')}</h1>
          <button className="btn primary cal-back" onClick={() => setScreen('calendar')}>{L('رجوع إلى التقويم', 'Back to the calendar', 'Retour au calendrier')}</button>
        </div>
      ) : (
        <div className="page-head">
          <h1>{L('التقويم', 'Calendar', 'Calendrier')}</h1>
          {setup && <button className="btn cal-settings-btn" onClick={() => setScreen('settings')}><span aria-hidden>⚙</span> {L('إعدادات التقويم', 'Calendar settings', 'Réglages du calendrier')}</button>}
        </div>
      )}
      {screen === 'settings' && setup ? <CalSettings data={data} refresh={load} /> : <Board data={data} refresh={load} />}
    </>
  );
}

function usePersonal<T>(key: string, start: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const x = localStorage.getItem(key); return x == null ? start : (JSON.parse(x) as T); } catch { return start; } });
  return [v, (x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* no storage */ } }];
}

function Board({ data, refresh }: { data: CalData; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const today = todayIso();
  const [view, setView] = usePersonal<View>(`cal-view-${s.profile.id}`, 'week');
  // the quick view is kept per person: null = everything, else a category
  const [quick, setQuick] = usePersonal<number | null>(`cal-quick-${s.profile.id}`, null);
  const [area, setArea] = useState<number | null>(null);
  const [anchor, setAnchor] = useState(today);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<{ id: number; day?: string } | null>(null);
  const [win, setWin] = useState<{ booking: CalBooking | null; start?: NewStart } | null>(null);
  const [orgs, setOrgs] = useState(false);
  const [print, setPrint] = useState(false);
  const r = data.rights;
  const canNew = r.programme || r.outside || r.whole;
  const step = (n: number) => setAnchor(view === 'day' ? addDays(anchor, n) : view === 'month' ? (() => { const x = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); })() : addDays(anchor, 7 * n));
  const period = view === 'day' ? fmtDay(anchor) : view === 'month' ? `${monthName(anchor)} ${anchor.slice(0, 4)}` : view === 'week' ? (() => { const w = weekOf(anchor); return `${fmtShort(w[0])} – ${fmtShort(w[6])} ${w[6].slice(0, 4)}`; })() : '';
  const spaces = useMemo(() => spacesShown(data, quick, area), [data, quick, area]);
  const cats = data.categories.filter((c) => c.active);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await refresh(); } catch (e) { toast(errText(e), true); } };
  const startNew = (start?: NewStart) => { if (canNew) setWin({ booking: null, start }); };
  const openItem = (b: CalBooking, day?: string) => setOpen({ id: b.id, day });

  return (
    <>
      <div className="cal-bar">
        <button className="btn small" onClick={() => step(-1)} aria-label="previous">‹</button>
        <button className="btn small" onClick={() => setAnchor(today)}>{L('اليوم', 'Today', 'Aujourd’hui')}</button>
        <button className="btn small" onClick={() => step(1)} aria-label="next">›</button>
        <b className="cal-period">{period}</b>
        <Seg value={view} onChange={setView} options={[
          { value: 'day', label: L('يوم', 'Day', 'Jour') }, { value: 'week', label: L('أسبوع', 'Week', 'Semaine') },
          { value: 'month', label: L('شهر', 'Month', 'Mois') }, { value: 'list', label: L('قائمة', 'List', 'Liste') },
        ]} />
        <select className="inp cal-area-pick" value={area ?? ''} onChange={(e) => setArea(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{L('كل المناطق', 'Every area', 'Toutes les zones')}</option>
          {data.areas.filter((a) => a.active && data.spaces.some((x) => x.building_id === a.id && inCalendar(x))).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input className="inp cal-search" type="search" placeholder={`🔍 ${L('بحث: اسم، جهة، مسؤول، هاتف، مكان…', 'Search: name, organisation, leader, phone, space…', 'Rechercher : nom, organisation, responsable, téléphone, espace…')}`} value={query} onChange={(e) => setQuery(e.target.value)} />
        {canNew && <button className="btn primary small" onClick={() => startNew({ from: view === 'list' ? today : anchor })}>＋ {L('جديد', 'New', 'Nouveau')}</button>}
        <button className="btn ghost small cal-print-btn" onClick={() => setPrint(true)}>🖨 {L('طباعة', 'Print', 'Imprimer')}</button>
        {/* the register of organisations: at the end of the bar, away from "New" (Fouad's first test) */}
        {r.contacts && <button className="btn ghost small cal-orgs-btn" onClick={() => setOrgs(true)}>🏢 {L('الجهات', 'Organisations', 'Organisations')}</button>}
      </div>
      <div className="cal-quick">
        <button className={quick == null ? 'on' : ''} onClick={() => setQuick(null)}>{L('الكل', 'Everything', 'Tout')}</button>
        {cats.map((c) => <button key={c.id} className={quick === c.id ? 'on' : ''} onClick={() => setQuick(c.id)}>{biName(c.name)}</button>)}
      </div>
      {query.trim()
        ? <SearchResults data={data} q={query} today={today} onOpen={(b, d) => openItem(b, d ?? undefined)} />
        : (
          <>
            <TodayStrip data={data} today={today} act={act} onOpen={openItem} onNew={startNew} />
            {view === 'week' && <WeekView data={data} spaces={spaces} days={weekOf(anchor)} today={today} onOpen={openItem} onNew={canNew ? startNew : undefined} />}
            {view === 'day' && <DayView data={data} spaces={spaces} day={anchor} today={today} onOpen={openItem} onNew={canNew ? startNew : undefined} />}
            {view === 'month' && <MonthView data={data} spaces={spaces} quick={quick != null || area != null} anchor={anchor} today={today} onOpen={openItem} onDay={(d) => { setAnchor(d); setView('day'); }} onNew={canNew ? startNew : undefined} />}
            {view === 'list' && <ListView data={data} today={today} onOpen={openItem} />}
          </>
        )}
      {open && data.bookings.some((b) => b.id === open.id) && !win && (
        <BookingSide data={data} b={data.bookings.find((b) => b.id === open.id)!} day={open.day} today={today} act={act} refresh={refresh} onClose={() => setOpen(null)} onChange={(b) => { setOpen(null); setWin({ booking: b }); }} />
      )}
      {win && <BookingWindow data={data} start={win} onClose={() => setWin(null)} refresh={refresh} />}
      {orgs && <OrgRegister data={data} refresh={refresh} onClose={() => setOrgs(false)} />}
      {print && <PrintWindow data={data} anchor={anchor} onClose={() => setPrint(false)} />}
    </>
  );
}

// ---------------------------------------------------------------- the Today strip

type Tile = 'arrive' | 'leave' | 'inuse' | 'free' | 'confirm' | 'prepare';
function TodayStrip({ data, today, act, onOpen, onNew }: { data: CalData; today: string; act: (fn: () => Promise<unknown>) => Promise<void>; onOpen: (b: CalBooking, d?: string) => void; onNew: (s: NewStart) => void }) {
  const { s } = useApp();
  const [tile, setTile] = useState<Tile | null>(null);
  const [now, setNow] = useState(nowMinutes());
  useEffect(() => { const id = window.setInterval(() => setNow(nowMinutes()), 60000); return () => window.clearInterval(id); }, []);
  const f = useMemo(() => todayFigures(data, today, now), [data, today, now]);
  const prep = useMemo(() => prepareOf(data, today), [data, today]);
  const r = data.rights;
  const status = (id: number, st: 'confirmed' | 'arrived' | 'left') => act(async () => {
    const res = await s.api.call('cal.booking.status', { id, status: st });
    if (!res.ok) toast(L('غير ممكن: المكان محجوز', 'Not possible: the space is taken', 'Impossible : l’espace est pris'), true);
  });
  const tiles: { k: Tile; n: number; label: string; red?: boolean }[] = [
    { k: 'arrive', n: f.arrive.length, label: L('يصلون اليوم', 'Arrive today', 'Arrivent aujourd’hui') },
    { k: 'leave', n: f.leave.length, label: L('يغادرون اليوم', 'Leave today', 'Partent aujourd’hui') },
    { k: 'inuse', n: f.inUse.length, label: L('قاعات مستعملة الآن', 'Halls in use now', 'Salles occupées maintenant') },
    { k: 'free', n: f.freeTonight.length, label: L('غرف فارغة الليلة', 'Rooms free tonight', 'Chambres libres ce soir') },
    { k: 'prepare', n: prep.length, label: L('للتحضير اليوم', 'To prepare today', 'À préparer aujourd’hui') },
    { k: 'confirm', n: f.toConfirm.length, label: L('للتأكيد', 'To confirm', 'À confirmer'), red: f.passed > 0 },
  ];
  const row = (b: CalBooking, extra: React.ReactNode, buttons: React.ReactNode) => (
    <tr key={b.id}><td><button className="linkish" onClick={() => { setTile(null); onOpen(b); }}>{label(b)}</button></td><td className="small">{extra}</td><td style={{ textAlign: 'end' }}>{buttons}</td></tr>
  );
  const spaceNames = (b: CalBooking) => data.allocs.filter((a) => a.booking_id === b.id).map((a) => data.spaces.find((x) => x.id === a.room_id)?.name).filter(Boolean).join(', ');
  return (
    <>
      <div className="cal-strip">
        {tiles.map((x) => (
          <button key={x.k} className={`cal-tile${x.red ? ' red' : ''}`} onClick={() => setTile(x.k)}>
            <b>{x.n}</b><span>{x.label}</span>{x.k === 'confirm' && f.passed > 0 && <small>{f.passed} {L('انتهى موعدها', 'date passed', 'date passée')}</small>}
          </button>
        ))}
      </div>
      {tile && (
        <Modal title={tiles.find((x) => x.k === tile)!.label} onClose={() => setTile(null)} narrow>
          <table className="t small"><tbody>
            {tile === 'arrive' && f.arrive.map((b) => row(b, `${spaceNames(b)} · ${b.people} ${L('شخص', 'people', 'personnes')}`, r.arrive && b.status !== 'arrived' && <button className="btn small primary" onClick={() => void status(b.id, 'arrived')}>{L('وصلوا', 'Mark arrived', 'Arrivés')}</button>))}
            {tile === 'leave' && f.leave.map((b) => row(b, spaceNames(b), r.arrive && <button className="btn small" onClick={() => void status(b.id, 'left')}>{L('غادروا', 'Mark left', 'Partis')}</button>))}
            {tile === 'inuse' && f.inUse.map((x, i) => (
              <tr key={i}><td><b>{x.space.name}</b></td><td><button className="linkish" onClick={() => { setTile(null); onOpen(x.b, today); }}>{label(x.b)}</button></td><td className="small" dir="ltr">{hm(x.occ.from)}–{hm(x.occ.to)}</td></tr>
            ))}
            {tile === 'free' && f.freeTonight.map((sp) => (
              <tr key={sp.id}><td><b>{sp.name}</b> <span className="muted">{data.areas.find((a) => a.id === sp.building_id)?.name}</span></td><td className="small">{sp.beds ? `${sp.beds} ${L('سرير', 'beds', 'lits')}` : ''}</td>
                <td style={{ textAlign: 'end' }}>{r.outside && <button className="btn small" onClick={() => { setTile(null); onNew({ spaces: [sp.id], from: today, to: addDays(today, 1), stay: true }); }}>{L('احجز', 'Book', 'Réserver')}</button>}</td></tr>
            ))}
            {tile === 'prepare' && prep.map((x, i) => (
              <tr key={i}>
                <td><b>{x.space.name}</b> <span className="muted">{data.areas.find((a) => a.id === x.space.building_id)?.name}</span></td>
                <td className="small">{x.kind === 'hall' ? `${L('قبل', 'before', 'avant')} ${hm(x.at ?? 0)} · ${x.people} ${L('شخص', 'people', 'personnes')}${x.equipment.length ? ` · ${x.equipment.map((e) => `${e.name} × ${e.qty}`).join('، ')}` : ''}` : x.kind === 'arrive' ? `${L('تجهيز لوصول', 'prepare for the arrival of', 'à préparer pour l’arrivée de')} ${x.people} ${L('شخص', 'people', 'personnes')}` : L('جاهزة من جديد بعد المغادرة', 'ready again after the group leaves', 'de nouveau prête après le départ du groupe')}</td>
                <td style={{ textAlign: 'end' }}><button className="linkish" onClick={() => { setTile(null); onOpen(x.b, today); }}>{label(x.b)}</button></td>
              </tr>
            ))}
            {tile === 'confirm' && f.toConfirm.map((b) => row(b,
              <span className={holdPassed(b, today) ? 'cal-red' : ''}>{fmtDay(nextDate(b, data, today) ?? b.from_day)} · {L('محجوز حتى', 'held until', 'retenu jusqu’au')} {fmtShort(holdDate(b))}{holdPassed(b, today) ? ` · ${L('انتهى الموعد: اتصلوا بهم', 'the date has passed: call them', 'la date est passée : appelez-les')}` : ''}</span>,
              mayChange(r, b) && <button className="btn small primary" onClick={() => void status(b.id, 'confirmed')}>{L('أكّد', 'Confirm', 'Confirmer')}</button>))}
          </tbody></table>
          {(tile === 'arrive' ? f.arrive : tile === 'leave' ? f.leave : tile === 'inuse' ? f.inUse : tile === 'free' ? f.freeTonight : tile === 'prepare' ? prep : f.toConfirm).length === 0 && <p className="muted">{L('لا شيء.', 'Nothing.', 'Rien.')}</p>}
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- selecting on the calendar

/** a rectangle being dragged: rows (spaces) and columns (days, or minutes in the day view) */
interface Drag { r0: number; r1: number; c0: number; c1: number }
function useDrag(onEnd: (g: Drag) => void) {
  const [g, setG] = useState<Drag | null>(null);
  const ref = useRef<Drag | null>(null);
  useEffect(() => {
    if (!g) return;
    const up = () => { const x = ref.current; setG(null); ref.current = null; if (x) onEnd(x); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [g, onEnd]);
  const start = (r: number, c: number) => { const x = { r0: r, r1: r, c0: c, c1: c }; ref.current = x; setG(x); };
  const move = (r: number, c: number) => { if (!ref.current) return; const x = { ...ref.current, r1: r, c1: c }; ref.current = x; setG(x); };
  const box = g ? { r0: Math.min(g.r0, g.r1), r1: Math.max(g.r0, g.r1), c0: Math.min(g.c0, g.c1), c1: Math.max(g.c0, g.c1) } : null;
  return { box, start, move, dragging: !!g };
}

/** the spaces grouped by area (an area can be folded) */
function useAreas(data: CalData, spaces: CalSpace[]) {
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const groups = data.areas.map((a) => ({ a, list: spaces.filter((x) => x.building_id === a.id) })).filter((g) => g.list.length);
  const flip = (id: number) => setFolded((f) => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rows = groups.flatMap((g) => (folded.has(g.a.id) ? [] : g.list));
  return { groups, folded, flip, rows };
}

// ---------------------------------------------------------------- the week

function WeekView({ data, spaces, days, today, onOpen, onNew }: { data: CalData; spaces: CalSpace[]; days: string[]; today: string; onOpen: (b: CalBooking, d?: string) => void; onNew?: (s: NewStart) => void }) {
  const items = useMemo(() => itemsBetween(data, days[0], days[6]), [data, days]);
  const { groups, folded, flip, rows } = useAreas(data, spaces);
  const end = useCallback((g: Drag) => {
    if (!onNew) return;
    const sel = rows.slice(g.r0, g.r1 + 1);
    const stay = sel.length > 0 && sel.every((x) => sleepsIn(x, data.kinds));
    onNew({ spaces: sel.map((x) => x.id), from: days[g.c0], to: stay ? addDays(days[g.c1], 1) : days[g.c1], stay });
  }, [onNew, rows, days, data.kinds]);
  const drag = useDrag(end);
  const outside = days.map((d) => (items.get(d) ?? []).filter((it) => !it.spaces.length && !it.b.whole_centre));
  const inBox = (r: number, c: number) => drag.box && r >= drag.box.r0 && r <= drag.box.r1 && c >= drag.box.c0 && c <= drag.box.c1;
  return (
    <div className="cal-wrap">
      <table className="cal-week">
        <thead>
          <tr>
            <th className="cal-sp" />
            {days.map((d) => { const band = bandOf(data, d); return <th key={d} className={`${d === today ? 'today' : ''}${band ? ' band' : ''}`} title={band?.name}>{wdName(d)}<br /><span className="small">{fmtShort(d)}</span>{band && <div className="cal-band-name">{band.name}</div>}</th>; })}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <AreaRows key={g.a.id} data={data} area={g.a} list={g.list} folded={folded.has(g.a.id)} onFlip={() => flip(g.a.id)} cols={days.length}>
              {g.list.map((sp) => {
                const r = rows.indexOf(sp);
                return (
                  <tr key={sp.id}>
                    <th className="cal-sp" title={inRoomText(data, sp) || undefined} style={{ borderInlineStartColor: colorOf(data.areas, sp.building_id) }}>{sp.name}<div className="small muted">{sleepsIn(sp, data.kinds) ? (sp.beds ? `${sp.beds} ${L('سرير', 'beds', 'lits')}` : '') : sp.capacity ? `${sp.capacity} ${L('شخص', 'people', 'pers.')}` : ''}</div></th>
                    {days.map((d, c) => {
                      const here = (items.get(d) ?? []).filter((it) => it.spaces.includes(sp.id));
                      const shut = shutOf(data, sp.id, d);
                      return (
                        <td key={d} className={`cal-cell${d === today ? ' today' : ''}${shut ? ' shut' : ''}${inBox(r, c) ? ' sel' : ''}${bandOf(data, d) ? ' band' : ''}`}
                          title={shut ? `${L('مغلق', 'Closed', 'Fermé')}: ${shut.reason}` : undefined}
                          onMouseDown={(e) => { if (!onNew || shut || e.button !== 0) return; e.preventDefault(); drag.start(r, c); }}
                          onMouseEnter={() => drag.move(r, c)}>
                          {shut && !here.length && <span className="small">🔧 {shut.reason}</span>}
                          {here.map((it) => <Chip key={it.b.id} data={data} it={it} day={d} days={days} onOpen={onOpen} />)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </AreaRows>
          ))}
          {outside.some((x) => x.length) && (
            <tr>
              <th className="cal-sp">{L('خارج المركز', 'Outside the centre', 'Hors du centre')}</th>
              {days.map((d, c) => <td key={d} className="cal-cell">{outside[c].map((it) => <Chip key={it.b.id} data={data} it={it} day={d} days={days} onOpen={onOpen} />)}</td>)}
            </tr>
          )}
        </tbody>
      </table>
      {!rows.length && !groups.length && <p className="muted">{L('لا أماكن في هذا العرض.', 'No spaces in this view.', 'Aucun espace dans cette vue.')}</p>}
    </div>
  );
}

function AreaRows({ data, area, list, folded, onFlip, cols, children }: { data: CalData; area: CalData['areas'][number]; list: CalSpace[]; folded: boolean; onFlip: () => void; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="cal-arearow"><td colSpan={cols + 1}>
        <button className="linkish" onClick={onFlip}>{folded ? '▸' : '▾'} <i className="host-sw" style={{ background: colorOf(data.areas, area.id), width: 10, height: 10, display: 'inline-block', borderRadius: 3 }} /> <b>{area.name}</b> <span className="muted small">({list.length})</span></button>
      </td></tr>
      {!folded && children}
    </>
  );
}

/** one booking in a cell: a stay or the whole centre as a bar across the days (its name on its first day of the week) */
function Chip({ data, it, day, days, onOpen }: { data: CalData; it: DayItem; day: string; days?: string[]; onOpen: (b: CalBooking, d?: string) => void }) {
  const c = colours(data, it.b);
  const bar = it.b.kind === 'stay' || it.b.whole_centre;
  const first = !bar || day === it.b.from_day || day === days?.[0];
  return (
    <div dir="auto" className={`cal-chip${bar ? ' bar' : ''}${it.b.status === 'option' ? ' option' : ''}`} style={{ background: c.bg, color: c.fg }}
      onMouseDown={(e) => e.stopPropagation()} onClick={() => onOpen(it.b, day)} title={`${label(it.b)} ${hours(it)}`}>
      {first ? <>{hours(it) && <span className="cal-h" dir="ltr">{hm(it.occ.from)} </span>}{label(it.b)}</> : '\u00a0'}
    </div>
  );
}

// ---------------------------------------------------------------- the day: by hours, 08:00–22:00

const D0 = 8 * 60, D1 = 22 * 60;
const pct = (min: number) => `${(((Math.max(D0, Math.min(D1, min)) - D0) / (D1 - D0)) * 100).toFixed(2)}%`;
function DayView({ data, spaces, day, today, onOpen, onNew }: { data: CalData; spaces: CalSpace[]; day: string; today: string; onOpen: (b: CalBooking, d?: string) => void; onNew?: (s: NewStart) => void }) {
  const items = useMemo(() => itemsBetween(data, day, day).get(day) ?? [], [data, day]);
  const { groups, folded, flip, rows } = useAreas(data, spaces);
  const end = useCallback((g: Drag) => {
    if (!onNew) return;
    const a = Math.min(g.c0, g.c1), b = Math.max(g.c0, g.c1);
    const t1 = a, t2 = b > a ? b : a + 60;
    onNew({ spaces: rows.slice(g.r0, g.r1 + 1).map((x) => x.id), from: day, to: day, t1: hm(t1), t2: hm(Math.min(D1, t2)) });
  }, [onNew, rows, day]);
  const drag = useDrag(end);
  const minuteAt = (el: HTMLElement, x: number) => {
    const rc = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    const fr = rtl ? (rc.right - x) / rc.width : (x - rc.left) / rc.width;
    return Math.round((D0 + Math.max(0, Math.min(1, fr)) * (D1 - D0)) / 15) * 15;
  };
  const band = bandOf(data, day);
  const now = day === today ? nowMinutes() : null;
  const outside = items.filter((it) => !it.spaces.length && !it.b.whole_centre);
  const hoursRow = Array.from({ length: (D1 - D0) / 60 + 1 }, (_, i) => D0 + i * 60);
  return (
    <div className="cal-wrap">
      {band && <div className="alert warn small">{L('فترة إغلاق', 'Closed period', 'Période de fermeture')}: {band.name}</div>}
      <div className="cal-day">
        <div className="cal-dayrow head"><div className="cal-sp" /><div className="cal-line">{hoursRow.map((h) => <span key={h} className="cal-hour" style={{ insetInlineStart: pct(h) }}>{hm(h)}</span>)}</div></div>
        {groups.map((g) => (
          <div key={g.a.id}>
            <div className="cal-arearow"><button className="linkish" onClick={() => flip(g.a.id)}>{folded.has(g.a.id) ? '▸' : '▾'} <b>{g.a.name}</b></button></div>
            {!folded.has(g.a.id) && g.list.map((sp) => {
              const r = rows.indexOf(sp);
              const here = items.filter((it) => it.spaces.includes(sp.id));
              const shut = shutOf(data, sp.id, day);
              const selected = drag.box && r >= drag.box.r0 && r <= drag.box.r1;
              return (
                <div key={sp.id} className="cal-dayrow">
                  <div className="cal-sp" title={inRoomText(data, sp) || undefined} style={{ borderInlineStartColor: colorOf(data.areas, sp.building_id) }}>{sp.name}</div>
                  <div className={`cal-line${shut ? ' shut' : ''}`}
                    onMouseDown={(e) => { if (!onNew || shut || e.button !== 0) return; e.preventDefault(); drag.start(r, minuteAt(e.currentTarget, e.clientX)); }}
                    onMouseMove={(e) => drag.dragging && drag.move(r, minuteAt(e.currentTarget, e.clientX))}>
                    {hoursRow.map((h) => <i key={h} className="cal-tick" style={{ insetInlineStart: pct(h) }} />)}
                    {shut && <span className="small cal-shut">🔧 {shut.reason}</span>}
                    {selected && drag.box && <div className="cal-selbox" style={{ insetInlineStart: pct(drag.box.c0), width: `calc(${pct(drag.box.c1)} - ${pct(drag.box.c0)})` }} />}
                    {here.map((it) => {
                      const c = colours(data, it.b);
                      return (
                        <div key={it.b.id} className={`cal-block${it.b.status === 'option' ? ' option' : ''}`} style={{ insetInlineStart: pct(it.occ.from), width: `calc(${pct(it.occ.to)} - ${pct(it.occ.from)})`, background: c.bg, color: c.fg }}
                          onMouseDown={(e) => e.stopPropagation()} onClick={() => onOpen(it.b, day)} title={`${label(it.b)} ${hours(it)}`}>
                          <span dir="ltr" className="cal-h">{hours(it)}</span> {label(it.b)}
                        </div>
                      );
                    })}
                    {now != null && now >= D0 && now <= D1 && <i className="cal-now" style={{ insetInlineStart: pct(now) }} />}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {outside.length > 0 && (
          <div className="cal-dayrow"><div className="cal-sp">{L('خارج المركز', 'Outside the centre', 'Hors du centre')}</div>
            <div className="cal-line free">{outside.map((it) => <Chip key={it.b.id} data={data} it={it} day={day} onOpen={onOpen} />)}</div></div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the month: how busy each day is, and all its events

function MonthView({ data, spaces, quick, anchor, today, onOpen, onDay, onNew }: { data: CalData; spaces: CalSpace[]; quick: boolean; anchor: string; today: string; onOpen: (b: CalBooking, d?: string) => void; onDay: (d: string) => void; onNew?: (s: NewStart) => void }) {
  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const items = useMemo(() => itemsBetween(data, grid[0], grid[grid.length - 1]), [data, grid]);
  const ids = new Set(spaces.map((x) => x.id));
  const end = useCallback((g: Drag) => { if (onNew) onNew({ from: grid[Math.min(g.c0, g.c1)], to: grid[Math.max(g.c0, g.c1)] }); }, [onNew, grid]);
  const drag = useDrag(end);
  const ym = anchor.slice(0, 7);
  return (
    <div className="cal-month">
      {WD.map((w, i) => <div key={i} className="cal-mh">{L(w[0], w[1], w[2])}</div>)}
      {grid.map((d, c) => {
        const all = (items.get(d) ?? []).filter((it) => !quick || it.b.whole_centre || it.spaces.some((x) => ids.has(x)) || (!it.spaces.length && !quick));
        const used = new Set(all.flatMap((it) => it.spaces.filter((x) => ids.has(x)))).size;
        const sel = drag.box && c >= drag.box.c0 && c <= drag.box.c1;
        const band = bandOf(data, d);
        return (
          <div key={d} className={`cal-md${d.slice(0, 7) !== ym ? ' other' : ''}${d === today ? ' today' : ''}${sel ? ' sel' : ''}${band ? ' band' : ''}`} title={band?.name}
            onMouseDown={(e) => { if (!onNew || e.button !== 0) return; e.preventDefault(); drag.start(0, c); }} onMouseEnter={() => drag.move(0, c)}>
            <div className="cal-mn"><button className="linkish" onMouseDown={(e) => e.stopPropagation()} onClick={() => onDay(d)}>{Number(d.slice(8, 10))}</button>{spaces.length > 0 && <span className="host-bar" style={{ width: 40 }}><i style={{ width: `${Math.round((used / spaces.length) * 100)}%` }} /></span>}</div>
            {all.map((it) => <Chip key={it.b.id} data={data} it={it} day={d} days={[d]} onOpen={onOpen} />)}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- the lists and the search

function ListView({ data, today, onOpen }: { data: CalData; today: string; onOpen: (b: CalBooking, d?: string) => void }) {
  const [kind, setKind] = useState<ListKind>('upcoming');
  const rows = useMemo(() => listOf(data, kind, today), [data, kind, today]);
  return (
    <>
      <Tabs value={kind} onChange={setKind} tabs={[
        { value: 'upcoming', label: L('القادمة', 'Upcoming', 'À venir') }, { value: 'house', label: L('في البيت', 'In the house', 'Dans la maison') },
        { value: 'confirm', label: L('للتأكيد', 'To confirm', 'À confirmer') }, { value: 'past', label: L('الماضية', 'Past', 'Passées') },
      ]} />
      <BookingTable data={data} rows={rows} today={today} onOpen={onOpen} />
    </>
  );
}
function SearchResults({ data, q, today, onOpen }: { data: CalData; q: string; today: string; onOpen: (b: CalBooking, d?: string | null) => void }) {
  const rows = useMemo(() => search(data, q, today), [data, q, today]);
  return <><p className="small muted">{rows.length} {L('نتيجة', 'result(s)', 'résultat(s)')}</p><BookingTable data={data} rows={rows} today={today} onOpen={onOpen} /></>;
}
function BookingTable({ data, rows, today, onOpen }: { data: CalData; rows: { b: CalBooking; next: string | null }[]; today: string; onOpen: (b: CalBooking, d?: string) => void }) {
  if (!rows.length) return <p className="muted">{L('لا شيء.', 'Nothing.', 'Rien.')}</p>;
  return (
    <table className="t small">
      <thead><tr><th>{L('التاريخ القادم', 'Next date', 'Prochaine date')}</th><th>{L('الاسم', 'Name', 'Nom')}</th><th>{L('النوع', 'Kind', 'Type')}</th><th>{L('المكان', 'Where', 'Où')}</th><th>{L('الحالة', 'Status', 'Statut')}</th></tr></thead>
      <tbody>
        {rows.map(({ b, next }) => (
          <tr key={b.id} className={b.status === 'cancelled' ? 'off' : ''} style={{ cursor: 'pointer' }} onClick={() => onOpen(b, next ?? undefined)}>
            <td>{next ? fmtDay(next) : '—'}</td>
            <td><b>{label(b)}</b>{b.leader && <span className="muted"> · {b.leader}</span>}</td>
            <td>{kindText(data, b)}</td>
            <td>{whereText(data, b)}</td>
            <td>{STATUS[b.status]()}{b.status === 'option' && <span className={holdPassed(b, today) ? 'cal-red' : 'muted'}> · {L('حتى', 'until', 'jusqu’au')} {fmtShort(holdDate(b))}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
const whereText = (d: CalData, b: CalBooking) => b.whole_centre ? L('كل أماكن المركز', 'Every space of the centre', 'Tous les espaces du centre')
  : b.outside_place ? `${L('خارج المركز', 'Outside the centre', 'Hors du centre')}: ${b.outside_place}`
    : d.allocs.filter((a) => a.booking_id === b.id).map((a) => d.spaces.find((x) => x.id === a.room_id)?.name).filter(Boolean).join(', ');

// ---------------------------------------------------------------- a booking, seen in its side window

/** the days of a booking, in words (the hours are apart: hoursText) */
function daysText(b: CalBooking) {
  if (b.kind === 'stay') return `${fmtDay(b.from_day)} → ${fmtDay(b.to_day)}`;
  if (b.repeat_days) {
    const days = REPEAT_ORDER.filter((x) => b.repeat_days!.split(',').map(Number).includes(x)).map((x) => { const w = WD[(x + 6) % 7]; return L(w[0], w[1], w[2]); }).join(L('، ', ', ', ', '));
    return `${L('كل أسبوع', 'Every week', 'Chaque semaine')}: ${days} · ${fmtShort(b.from_day)} → ${fmtShort(b.to_day)} ${b.to_day.slice(0, 4)}`;
  }
  return `${fmtDay(b.from_day)}${b.to_day !== b.from_day ? ` → ${fmtDay(b.to_day)}` : ''}`;
}
function hoursText(b: CalBooking) {
  if (b.kind === 'stay') { const n = Math.max(1, Math.round((Date.parse(`${b.to_day}T00:00:00Z`) - Date.parse(`${b.from_day}T00:00:00Z`)) / 86400000)); return `${n} ${L('ليلة', n === 1 ? 'night' : 'nights', n === 1 ? 'nuit' : 'nuits')}`; }
  return b.time_from && b.time_to ? `${b.time_from} – ${b.time_to}` : L('اليوم كله', 'The whole day', 'Toute la journée');
}
/** a short day for the buttons: "Wed 25" */
const dayShort = (d: string) => `${wdName(d)} ${Number(d.slice(8, 10))}`;
const minus = (x: Totals, y: Totals): Totals => ({ USD: Math.max(0, Math.round((x.USD - y.USD) * 100) / 100), SYP: Math.max(0, Math.round((x.SYP - y.SYP) * 100) / 100) });

/**
 * A booking, seen in one look (Fouad's first test, 23 November 2026): a coloured head with the name and the state; the big
 * facts (days and hours, spaces, people); who (organisation, person, phone); money (free or price, paid, left) with the
 * services and the equipment; then the buttons in two groups: the whole booking, and only the date that was clicked.
 */
function BookingSide({ data, b, day, today, act, refresh, onClose, onChange }: { data: CalData; b: CalBooking; day?: string; today: string; act: (fn: () => Promise<unknown>) => Promise<void>; refresh: () => Promise<void>; onClose: () => void; onChange: (b: CalBooking) => void }) {
  const { s } = useApp();
  // the windows of money and paper (step 4)
  const [paper, setPaper] = useState<'pay' | 'cancel' | 'money' | 'receipt' | null>(null);
  const printPay = usePayReceipt(data, refresh);
  const printSheet = useBookingSheet(data);
  const r = data.rights;
  const may = mayChange(r, b);
  const c = colours(data, b);
  const priced = seesPrices(r);
  const org = data.orgs.find((o) => o.id === b.org_id);
  const dates = data.dates.filter((x) => x.booking_id === b.id && !x.undone);
  const occ = occurrences(b, data.dates);
  const series = occ.length > 1 && b.kind === 'event';
  const thisDay = day && occ.some((o) => o.day === day && !o.moved) ? day : null;
  const held = data.allocs.filter((a) => a.booking_id === b.id).map((a) => data.spaces.find((x) => x.id === a.room_id)).filter((x): x is CalSpace => !!x);
  const lines = data.lines.filter((l) => l.booking_id === b.id);
  const needs = data.needs.filter((n) => n.booking_id === b.id).map((n) => ({ n, e: data.equip.find((e) => e.id === n.equip_id) })).filter((x) => x.e);
  const total = calTotals(b, lines, data.dates);
  const pays = data.pays.filter((p) => p.booking_id === b.id);
  const paid = received(pays);
  const back = givenBack(pays);
  const left = minus(total, paid);
  const entered = new Set(data.entered ?? []);
  const anyBack = back.USD > 0 || back.SYP > 0;
  const passed = b.status === 'option' && holdPassed(b, today);
  const refused = (res: { ok: boolean }) => { if (!res.ok) toast(L('غير ممكن: المكان محجوز في ذلك الوقت', 'Not possible: the space is held at that time', 'Impossible : l’espace est pris à ce moment'), true); };
  const status = (st: 'option' | 'confirmed' | 'arrived' | 'left') => act(async () => refused(await s.api.call('cal.booking.status', { id: b.id, status: st })));
  const cancelDate = async (following: boolean) => {
    const reason = await promptBox(following ? L('سبب إلغاء هذا التاريخ وما بعده', 'Reason for cancelling this date and the following', 'Raison d’annuler cette date et les suivantes') : L('سبب إلغاء هذا التاريخ', 'Reason for cancelling this date', 'Raison d’annuler cette date'));
    if (reason?.trim() && thisDay) await act(() => s.api.call('cal.date.change', { booking_id: b.id, day: thisDay, action: following ? 'cancel_from' : 'cancel', reason }));
  };
  const moveDate = async () => {
    if (!thisDay) return;
    const to = await promptBox(L('اليوم الجديد (سنة-شهر-يوم)', 'The new day (year-month-day)', 'Le nouveau jour (année-mois-jour)'), thisDay);
    if (!to?.trim()) return;
    const tf = b.time_from ? await promptBox(L('الساعة من', 'From (hour)', 'De (heure)'), b.time_from) : null;
    const tt = b.time_to ? await promptBox(L('إلى', 'To (hour)', 'À (heure)'), b.time_to) : null;
    const reason = await promptBox(L('السبب', 'The reason', 'La raison'));
    if (reason?.trim()) await act(async () => refused(await s.api.call('cal.date.change', { booking_id: b.id, day: thisDay, action: 'move', to_day: to.trim(), time_from: tf, time_to: tt, reason })));
  };
  const cancelAll = () => setPaper('cancel');
  const takeBack = async (id: number) => {
    if (await confirmBox(L('سحب هذه الدفعة؟ (سُجّلت خطأً؛ تبقى ظاهرة مشطوبة)', 'Take back this payment? (recorded by mistake; it stays shown, struck through)', 'Retirer ce paiement ? (enregistré par erreur ; il reste visible, barré)'), true)) await act(() => s.api.call('cal.pay.cancel', { id }));
  };
  const priceText = b.price_state === 'free' ? L('مجاني', 'Free', 'Gratuit')
    : b.price_state === 'unset' ? L('السعر لم يُحدَّد بعد', 'Price not set yet', 'Prix pas encore fixé')
      : b.price_state === 'priced' && b.rate != null ? `${fmtMoney({ USD: b.currency === 'USD' ? b.rate : 0, SYP: b.currency === 'SYP' ? b.rate : 0 })} ${b.price_mode === 'person' ? L('للشخص في الليلة', 'per person per night', 'par personne et par nuit') : b.price_each ? L('لكل تاريخ', 'for each date', 'par date') : L('للحجز كله', 'for the whole booking', 'pour toute la réservation')}` : '';
  const showMoney = (b.price_state != null && b.origin === 'outside') || lines.length > 0 || needs.length > 0 || (priced && pays.length > 0);
  const anyPaid = paid.USD > 0 || paid.SYP > 0;
  const dateButtons = may && series && thisDay && b.status !== 'cancelled';
  return (
    <Modal title={kindText(data, b)} onClose={onClose} narrow>
      <div className="cal-view-head" style={{ background: c.bg, color: c.fg }}>
        <div className="cal-view-name" dir="auto">{b.origin === 'outside' ? '◆ ' : ''}{b.group_name}</div>
        {b.subject && <div className="cal-view-subject" dir="auto">{b.subject}</div>}
        <div className="cal-view-badges">
          <span className={`cal-view-badge st-${b.status}${passed ? ' passed' : ''}`}>
            {STATUS[b.status]()}{b.status === 'option' && ` · ${L('محجوز حتى', 'held until', 'retenu jusqu’au')} ${fmtDay(holdDate(b))}`}
          </span>
          <span className="cal-view-badge plain">{b.origin === 'ours' ? L('نشاطنا', 'Our activity', 'Notre activité') : L('حجز خارجي', 'Outside booking', 'Réservation extérieure')}</span>
          {!!b.private && <span className="cal-view-badge plain">🔒 {L('خاص', 'Private', 'Privé')}</span>}
        </div>
        {passed && <div className="cal-view-alert">{L('انتهى موعد الحجز المؤقت: اتصلوا بهم', 'The hold has passed: call them', 'La date de retenue est passée : appelez-les')}</div>}
      </div>

      <div className="cal-view-block cal-view-facts">
        <div className="cal-view-big"><span className="ic">📅</span><span>{daysText(b)}</span></div>
        <div className="cal-view-big"><span className="ic">🕘</span><span dir="ltr">{hoursText(b)}</span></div>
        <div className="cal-view-big"><span className="ic">📍</span><span>{whereText(data, b) || '—'}</span></div>
        {held.filter((x) => !!inRoomText(data, x)).map((x) => <div key={x.id} className="small muted cal-view-sub">🎛 {x.name}: {inRoomText(data, x)}</div>)}
        {b.people > 0 && <div className="cal-view-big"><span className="ic">👥</span><span>{b.people} {L('شخصاً', 'people', 'personnes')}</span></div>}
      </div>

      {(org || b.leader || b.contact || b.phone) && (
        <div className="cal-view-block">
          <div className="cal-view-label">{L('مَن', 'Who', 'Qui')}</div>
          {org && <div><b>{org.name}</b>{org.note && <div className="small muted">{org.note}</div>}</div>}
          {b.leader && <div>{L('المسؤول', 'Leader', 'Responsable')}: {b.leader}</div>}
          {(b.contact || b.phone) && <div>{b.contact}{b.phone && <> {b.contact ? '· ' : ''}<a className="cal-view-phone" href={`tel:${b.phone.replace(/\s/g, '')}`} dir="ltr">📞 {b.phone}</a></>}</div>}
        </div>
      )}

      {showMoney && (
        <div className="cal-view-block">
          <div className="cal-view-label">{priced ? L('المال', 'Money', 'Argent') : L('الخدمات والتجهيزات', 'Services and equipment', 'Services et équipement')}</div>
          {priced && b.origin === 'outside' && b.price_state != null && (
            <table className="cal-view-money"><tbody>
              <tr><td>{L('السعر', 'Price', 'Prix')}</td><td className={b.price_state === 'unset' ? 'warn' : ''}>{priceText}</td></tr>
              {(total.USD > 0 || total.SYP > 0) && <tr><td>{L('المجموع المتفق عليه', 'Agreed total', 'Total convenu')}</td><td dir="ltr"><b>{fmtMoney(total)}</b></td></tr>}
              {(total.USD > 0 || total.SYP > 0 || anyPaid) && <tr><td>{L('مدفوع', 'Paid', 'Payé')}</td><td dir="ltr">{fmtMoney(paid)}</td></tr>}
              {(total.USD > 0 || total.SYP > 0) && <tr><td>{L('الباقي', 'Left to pay', 'Reste à payer')}</td><td dir="ltr" className={left.USD > 0 || left.SYP > 0 ? 'cal-red' : ''}><b>{fmtMoney(left)}</b></td></tr>}
            </tbody></table>
          )}
          {lines.length > 0 && <div className="cal-view-list"><span className="muted">{L('الخدمات', 'Services', 'Services')}:</span> {lines.map((l) => <span key={l.id}>{l.qty > 1 ? `${l.qty} × ` : ''}{biName(l.label)}{priced && l.amount ? <span className="muted cal-view-amt" dir="ltr">({fmtMoney({ USD: l.currency === 'USD' ? l.amount : 0, SYP: l.currency === 'SYP' ? l.amount : 0 })})</span> : null}</span>)}</div>}
          {needs.length > 0 && <div className="cal-view-list"><span className="muted">{L('التجهيزات', 'Equipment', 'Équipement')}:</span> {needs.map(({ n, e }) => <span key={n.equip_id}>{n.qty > 1 ? `${n.qty} × ` : ''}{biName(e!.name)}</span>)}</div>}
          {priced && pays.length > 0 && (
            <table className="t small cal-pays"><tbody>
              {pays.map((p) => {
                const inBooks = entered.has(p.receipt_no);
                return (
                  <tr key={p.id} className={p.status === 'refused' ? 'off' : ''}>
                    <td dir="ltr">{p.paid_on.slice(8, 10)}/{p.paid_on.slice(5, 7)}</td>
                    <td dir="ltr" className="muted">{p.receipt_no}</td>
                    <td>{p.kind === 'back' ? L('مُعاد', 'Given back', 'Rendu') : METHOD[p.method]?.() ?? p.method}</td>
                    <td className="n" dir="ltr">{p.kind === 'back' ? '−' : ''}{fmtMoney({ USD: p.currency === 'USD' ? p.amount : 0, SYP: p.currency === 'SYP' ? p.amount : 0 })}</td>
                    <td className="small">{p.status === 'refused' ? L('مسحوبة', 'taken back', 'retiré') : inBooks ? `✓ ${L('في الدفاتر', 'in the books', 'dans les livres')}` : L('تنتظر القيد', 'waiting for the books', 'attend les livres')}</td>
                    <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                      {p.kind !== 'back' && p.status !== 'refused' && <button className="btn ghost small" title={L('وصل الاستلام', 'The receipt', 'Le reçu')} onClick={() => void printPay(b, p.id)}>🖨{(p.printed ?? 0) > 0 ? ` ${L('نسخة', 'copy', 'copie')}` : ''}</button>}
                      {r.money && p.kind !== 'back' && p.status !== 'refused' && !inBooks && b.status !== 'cancelled' && <button className="btn ghost small" title={L('سحب (سُجّلت خطأً)', 'Take back (a mistake)', 'Retirer (une erreur)')} onClick={() => void takeBack(p.id)}>✕</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody></table>
          )}
          {priced && b.status === 'cancelled' && (paid.USD > 0 || paid.SYP > 0) && (
            <div className={b.cancel_money ? 'small' : 'small cal-red'}>
              {b.cancel_money == null ? L('قُبض مال ولم يُقرَّر بعد ما يُعاد', 'Money was received: what is given back is not decided yet', 'De l’argent a été reçu : ce qui est rendu n’est pas encore décidé')
                : `${L('نحتفظ بـ', 'Kept', 'Gardé')}: ${fmtMoney({ USD: b.kept_usd ?? 0, SYP: b.kept_syp ?? 0 })} · ${L('يُعاد', 'given back', 'rendu')}: ${anyBack ? fmtMoney(back) : '0'}`}
              {r.money && <button className="btn small" style={{ marginInlineStart: 8 }} onClick={() => setPaper('money')}>{b.cancel_money == null ? L('قرّر', 'Decide', 'Décider') : L('غيّر', 'Change', 'Modifier')}</button>}
            </div>
          )}
          {r.money && b.status !== 'cancelled' && <div><button className="btn small" onClick={() => setPaper('pay')}>＋ {L('دفعة مقبوضة', 'A payment received', 'Un paiement reçu')}</button></div>}
        </div>
      )}

      {(b.note || dates.length > 0 || (b.status === 'cancelled' && b.cancel_reason)) && (
        <div className="cal-view-block">
          {b.note && <div><span className="muted">{L('ملاحظة', 'Note', 'Note')}:</span> {b.note}</div>}
          {b.status === 'cancelled' && b.cancel_reason && <div><span className="muted">{L('سبب الإلغاء', 'Why cancelled', 'Pourquoi annulé')}:</span> {b.cancel_reason}</div>}
          {dates.length > 0 && <div><div className="muted">{L('تواريخ متغيّرة', 'Dates changed', 'Dates changées')}:</div>{dates.map((x) => (
            <div key={x.id} className="small">{fmtDay(x.day)}: {x.action === 'move' ? `${L('نُقل إلى', 'moved to', 'déplacé au')} ${fmtDay(x.to_day ?? x.day)}${x.time_from ? ` ${x.time_from}–${x.time_to}` : ''}` : x.action === 'cancel_from' ? L('أُلغي هو وما بعده', 'cancelled, and the following', 'annulé, et les suivants') : x.taken ? L('لم يُحفظ: المكان كان محجوزاً', 'left out: the space was taken', 'laissé de côté : l’espace était pris') : L('أُلغي', 'cancelled', 'annulé')}{x.reason && !x.taken ? ` (${x.reason})` : ''}
              {may && <button className="btn ghost small" onClick={() => void act(async () => refused(await s.api.call('cal.date.undo', { id: x.id })))}>{L('أعِده', 'Put back', 'Remettre')}</button>}</div>
          ))}</div>}
        </div>
      )}

      <div className="cal-view-actions">
      {(may || (r.arrive && b.kind === 'stay')) && (
          <div className="cal-view-group">
            <div className="cal-view-label">{L('الحجز كله', 'The whole booking', 'Toute la réservation')}</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {may && b.status !== 'cancelled' && <button className="btn primary small" onClick={() => onChange(b)}>✎ {L('عدّل', 'Change', 'Modifier')}</button>}
              {may && b.status === 'option' && <button className="btn small" onClick={() => void status('confirmed')}>✓ {L('أكّد', 'Confirm', 'Confirmer')}</button>}
              {r.arrive && b.kind === 'stay' && (b.status === 'confirmed' || b.status === 'option') && <button className="btn small" onClick={() => void status('arrived')}>{L('وصلوا', 'Mark arrived', 'Arrivés')}</button>}
              {r.arrive && b.kind === 'stay' && b.status === 'arrived' && <button className="btn small" onClick={() => void status('left')}>{L('غادروا', 'Mark left', 'Partis')}</button>}
              {may && b.status === 'cancelled' && <button className="btn small" onClick={() => void status('option')}>{L('أعِده «للتأكيد»', 'Put back "to confirm"', 'Remettre « à confirmer »')}</button>}
              {may && b.status !== 'cancelled' && <button className="btn danger small" onClick={() => cancelAll()}>{L('ألغِ الحجز', 'Cancel the booking', 'Annuler la réservation')}</button>}
            </div>
          </div>
      )}
          {dateButtons && (
            <div className="cal-view-group cal-view-date">
              <div className="cal-view-label">{L('هذا التاريخ فقط', 'Only this date', 'Seulement cette date')} ({dayShort(thisDay!)})</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn small" onClick={() => void moveDate()}>{L('انقل هذا التاريخ', 'Move this date', 'Déplacer cette date')}</button>
                <button className="btn small" onClick={() => void cancelDate(false)}>{L('ألغِ هذا التاريخ فقط', 'Cancel this date only', 'Annuler cette date seulement')}</button>
                {thisDay !== b.from_day && <button className="btn small" onClick={() => void cancelDate(true)}>{L('ألغِ هذا التاريخ وما بعده', 'This date and the following', 'Cette date et les suivantes')}</button>}
              </div>
            </div>
          )}
          {(priced || r.contacts) && b.status !== 'cancelled' && (
            <div className="cal-view-group">
              <div className="cal-view-label">{L('أوراق', 'Paper', 'Papiers')}</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {priced && b.origin === 'outside' && b.price_state !== 'free' && (total.USD > 0 || total.SYP > 0 || pays.length > 0) && <button className="btn small" onClick={() => setPaper('receipt')}>🧾 {L('وصل استلام للحجز كله', 'Receipt of the whole booking', 'Reçu de toute la réservation')}{(b.receipt_printed ?? 0) > 0 ? ` (${L('نسخة', 'copy', 'copie')})` : ''}</button>}
                <button className="btn small" onClick={() => void printSheet(b)}>📄 {L('ورقة الحجز للمجموعة', 'Booking sheet for the group', 'Fiche de réservation')}</button>
              </div>
            </div>
          )}
      </div>
      {paper === 'pay' && <PayWindow data={data} b={b} onClose={() => setPaper(null)} refresh={refresh} />}
      {paper === 'cancel' && <CancelWindow data={data} b={b} onClose={() => setPaper(null)} onDone={async () => { setPaper(null); await refresh(); onClose(); }} />}
      {paper === 'money' && <MoneyWindow data={data} b={b} onClose={() => setPaper(null)} refresh={refresh} />}
      {paper === 'receipt' && <BookingReceipt data={data} b={b} onClose={() => setPaper(null)} refresh={refresh} />}
    </Modal>
  );
}

// ---------------------------------------------------------------- the booking window (step 3: our activity, or an outside booking with its equipment, services and price)

type Who = 'ours' | 'outside' | 'whole';
type Where = 'spaces' | 'outside';
type When = 'once' | 'days' | 'weekly';
interface LineForm { id?: number; service_id: number | null; label: string; qty: string; amount: string; currency: Currency }
interface Form {
  who: Who; stay: boolean; title: string; leader: string; activity_kind_id: number | null; subject: string;
  org_id: number | null; person_id: number | null; people: string;
  where: Where; place: string; spaces: number[];
  when: When; from: string; to: string; repeat: number[]; t1: string; t2: string; allDay: boolean;
  needs: { equip_id: number; qty: string }[];
  lines: LineForm[];
  /** the "free" tick (ticked by default); untick for an amount */
  free: boolean; pmode: 'person' | 'group'; each: boolean; rate: string; currency: Currency;
  status: 'option' | 'confirmed'; hold: string; private: boolean; note: string;
}
const HOUR_LIST = Array.from({ length: (23 - 7) * 4 + 1 }, (_, i) => hm(7 * 60 + i * 15));
const QUICK_HOURS: [string, string, () => string][] = [['09:00', '13:00', () => L('صباحاً', 'Morning', 'Matin')], ['14:00', '18:00', () => L('بعد الظهر', 'Afternoon', 'Après-midi')], ['18:00', '22:00', () => L('مساءً', 'Evening', 'Soir')]];
const numText = (n: number | null | undefined) => (n == null || n === 0 ? '' : String(n));
const amountOf = (x: string) => { const n = parseAmount(x); return Number.isFinite(n) ? n : 0; };
const fmtMoney = (t: Totals) => [t.USD ? `${t.USD.toLocaleString('en', { maximumFractionDigits: 2 })} USD` : '', t.SYP ? `${Math.round(t.SYP).toLocaleString('en')} SYP` : ''].filter(Boolean).join(' + ') || '0';

function formOf(d: CalData, b: CalBooking | null, start: NewStart | undefined, today: string): Form {
  const r = d.rights;
  if (b) {
    return {
      who: b.whole_centre ? 'whole' : b.origin, stay: b.kind === 'stay', title: b.origin === 'ours' ? b.group_name : '', leader: b.leader ?? '', activity_kind_id: b.activity_kind_id, subject: b.subject ?? '',
      org_id: b.org_id, person_id: b.person_id, people: b.people ? String(b.people) : '',
      where: b.outside_place ? 'outside' : 'spaces', place: b.outside_place ?? '', spaces: d.allocs.filter((a) => a.booking_id === b.id).map((a) => a.room_id),
      when: b.repeat_days ? 'weekly' : b.to_day !== b.from_day && b.kind === 'event' ? 'days' : 'once', from: b.from_day, to: b.to_day, repeat: (b.repeat_days ?? '').split(',').filter(Boolean).map(Number),
      t1: b.time_from ?? '10:00', t2: b.time_to ?? '12:00', allDay: !b.time_from,
      needs: d.needs.filter((n) => n.booking_id === b.id).map((n) => ({ equip_id: n.equip_id, qty: String(n.qty) })),
      lines: d.lines.filter((l) => l.booking_id === b.id).map((l) => ({ id: l.id, service_id: l.service_id, label: l.label, qty: String(l.qty), amount: numText(l.amount), currency: l.currency })),
      free: b.price_state !== 'priced', pmode: b.price_mode === 'person' ? 'person' : b.price_mode === 'group' ? 'group' : b.kind === 'stay' ? 'person' : 'group', each: !!b.price_each, rate: numText(b.rate), currency: b.currency,
      status: b.status === 'confirmed' ? 'confirmed' : 'option', hold: b.hold_until ?? holdDate(b), private: !!b.private, note: b.note ?? '',
    };
  }
  const st = start ?? {};
  const stay = !!st.stay && r.outside;
  const who: Who = stay ? 'outside' : r.programme ? 'ours' : r.outside ? 'outside' : 'whole';
  const from = st.from ?? today;
  const to = st.to ?? from;
  const multi = !stay && to > from;
  return {
    who, stay, title: '', leader: '', activity_kind_id: d.activityKinds.find((k) => k.active)?.id ?? null, subject: '', org_id: null, person_id: null, people: '',
    where: 'spaces', place: '', spaces: st.spaces ?? [],
    when: multi ? 'days' : 'once', from, to: stay ? (to > from ? to : addDays(from, 1)) : to, repeat: [((new Date(`${from}T00:00:00Z`).getUTCDay()))],
    t1: st.t1 ?? '10:00', t2: st.t2 ?? '12:00', allDay: false, needs: [], lines: [],
    free: true, pmode: stay ? 'person' : 'group', each: false, rate: '', currency: 'USD',
    status: 'option', hold: addDays(today, 7), private: false, note: '',
  };
}

type SaveResult = { saved: boolean; refused?: string; canSkip?: boolean; takenDays?: string[]; clashes?: { day: string; space: string; name: string }[]; warnings?: { kind: string; days?: string[]; name?: string; people?: number; holds?: number; day?: string; wanted?: number; have?: number; equip_id?: number }[] };

function BookingWindow({ data, start, onClose, refresh }: { data: CalData; start: { booking: CalBooking | null; start?: NewStart }; onClose: () => void; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const today = todayIso();
  const r = data.rights;
  const old = start.booking;
  const [f, setF] = useState<Form>(() => formOf(data, old, start.start, today));
  const [res, setRes] = useState<SaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  // the person agreed to save a weekly series without its taken dates (kept if a warning comes next)
  const [skipOk, setSkipOk] = useState(false);
  const [orgWin, setOrgWin] = useState<{ org: CalOrg | null } | null>(null);
  const set = (x: Partial<Form>) => { setF({ ...f, ...x }); setRes(null); setSkipOk(false); };
  const isStay = f.who === 'outside' && f.stay;
  const outside = f.who === 'outside';
  const persons = data.persons.filter((p) => p.org_id === f.org_id && (p.active || p.id === f.person_id));
  const choosable = (sp: CalSpace) => inCalendar(sp) && (!isStay || sleepsIn(sp, data.kinds)) && (f.who !== 'outside' || !!sp.rentable);
  const whoOptions = [
    r.programme && { value: 'ours' as Who, label: L('نشاطنا', 'Our activity', 'Notre activité') },
    r.outside && { value: 'outside' as Who, label: L('حجز خارجي', 'Outside booking', 'Réservation extérieure') },
    r.whole && { value: 'whole' as Who, label: L('المركز كله', 'Whole centre', 'Tout le centre') },
  ].filter(Boolean) as { value: Who; label: string }[];
  const timed = !isStay && f.who !== 'whole' && !f.allDay;
  const toDay = f.when === 'once' && !isStay ? f.from : f.to;
  const repeatDays = f.when === 'weekly' && !isStay ? f.repeat : null;
  const several = !isStay && (f.when === 'weekly' || toDay > f.from);
  // the price as it will be counted (Director, Coordinator): free, per person per night, the whole booking, each date
  const totals = useMemo(() => {
    const probe = { ...(old ?? {}), id: old?.id ?? -1, kind: isStay ? 'stay' : 'event', status: 'option', from_day: f.from, to_day: toDay, repeat_days: repeatDays?.join(',') || null, time_from: null, time_to: null, people: Number(f.people) || 0,
      price_state: f.free ? 'free' : 'priced', price_mode: f.pmode, price_each: f.each && several ? 1 : 0, rate: amountOf(f.rate), currency: f.currency } as CalBooking;
    return { total: calTotals(probe, f.lines.map((l) => ({ amount: amountOf(l.amount), currency: l.currency })), old ? data.dates : []), dates: occurrences(probe, old ? data.dates : []).length };
  }, [f, old, isStay, toDay, repeatDays, several, data.dates]);

  const save = async (extra: { force?: boolean; without_taken?: boolean } = {}) => {
    setBusy(true);
    try {
      const lines = f.lines.filter((l) => l.label.trim() || l.service_id != null).map((l) => ({ id: l.id, service_id: l.service_id, label: l.label, qty: Number(l.qty) || 1, amount: amountOf(l.amount), currency: l.currency }));
      const needs = f.needs.filter((n) => Number(n.qty) > 0).map((n) => ({ equip_id: n.equip_id, qty: Number(n.qty) }));
      // the price: only the Director and the Coordinator send it; Reception's bookings stay "price not set"
      const price = outside && r.prices ? { free: f.free, price_mode: f.pmode, price_each: f.each && several, rate: f.free ? null : amountOf(f.rate), currency: f.currency } : {};
      const x = (await s.api.call('cal.booking.save', {
        id: old?.id, origin: outside ? 'outside' : 'ours', kind: isStay ? 'stay' : 'event', whole_centre: f.who === 'whole',
        title: f.title, leader: f.leader, activity_kind_id: f.activity_kind_id, subject: f.subject, org_id: f.org_id, person_id: f.person_id, people: Number(f.people) || 0,
        outside_place: f.who === 'ours' && f.where === 'outside' ? f.place : null, spaces: f.who === 'whole' || (f.who === 'ours' && f.where === 'outside') ? [] : f.spaces,
        from_day: f.from, to_day: toDay, repeat_days: repeatDays, time_from: timed ? f.t1 : null, time_to: timed ? f.t2 : null,
        status: f.status, hold_until: f.status === 'option' ? f.hold : null, private: f.private, note: f.note, lines: outside ? lines : [], needs, ...price, ...extra, without_taken: extra.without_taken || skipOk,
      })) as SaveResult;
      if (x.saved) {
        await refresh();
        toast(x.warnings?.length ? L('حُفظ مع تنبيه', 'Saved, with a warning', 'Enregistré, avec un avertissement') : L('حُفظ', 'Saved', 'Enregistré'));
        onClose();
      } else setRes(x);
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const warnText = (w: NonNullable<SaveResult['warnings']>[number]) => w.kind === 'sunday' ? L('يوم أحد: عادة لا حجوزات للقاعات.', 'Sunday: usually no hall bookings.', 'Dimanche : d’habitude pas de réservation de salle.')
    : w.kind === 'period' ? `${L('فترة إغلاق', 'Closed period', 'Période de fermeture')} (${w.name}): ${w.days?.length} ${L('يوم', 'day(s)', 'jour(s)')}.`
      : w.kind === 'capacity' ? `${L('عدد الأشخاص أكبر مما يتسع له المكان', 'More people than the space holds', 'Plus de personnes que l’espace n’en contient')}: ${w.people} / ${w.holds}.`
        : `${L('لا يكفي', 'Not enough', 'Pas assez de')} ${data.equip.find((e) => e.id === w.equip_id)?.name ?? ''} ${w.day ? fmtDay(w.day) : ''}: ${w.wanted} ${L('مطلوب في ذلك الوقت', 'asked at that time', 'demandés à ce moment')}, ${w.have} ${L('في الجرد', 'in the inventory', 'dans l’inventaire')}.`;
  let n = 0;
  const num = () => ++n;
  const equipList = data.equip.filter((e) => e.active || f.needs.some((x) => x.equip_id === e.id));
  const services = data.services.filter((x) => x.active);
  const title = old ? (f.who === 'ours' ? L('نشاطنا', 'Our activity', 'Notre activité') : f.who === 'whole' ? L('المركز كله', 'Whole centre', 'Tout le centre') : L('حجز خارجي', 'Outside booking', 'Réservation extérieure')) : L('حجز جديد', 'New booking', 'Nouvelle réservation');

  return (
    <Modal title={title} onClose={onClose}>
      <div className="cal-win">
        <section>
          <h4>{num()}. {L('من', 'Who', 'Qui')}</h4>
          {!old && whoOptions.length > 1 && <Seg value={f.who} onChange={(v) => set({ who: v, stay: v === 'outside' ? f.stay : false })} options={whoOptions} />}
          {outside && <div style={{ marginTop: 6 }}><Seg value={f.stay ? 'stay' : 'hall'} onChange={(v) => set({ stay: v === 'stay', spaces: [], when: 'once', to: v === 'stay' ? addDays(f.from, 1) : f.from, pmode: v === 'stay' ? 'person' : 'group' })} options={[{ value: 'hall', label: L('حجز قاعة', 'Hall booking', 'Réservation de salle') }, { value: 'stay', label: L('إقامة', 'Guest stay', 'Séjour') }]} /></div>}
          {!outside ? (
            <div className="cal-grid2">
              <Field label={L('نوع النشاط', 'Kind of activity', 'Type d’activité')}>
                <select className="inp" value={f.activity_kind_id ?? ''} onChange={(e) => set({ activity_kind_id: Number(e.target.value) || null })}>{data.activityKinds.filter((k) => k.active || k.id === f.activity_kind_id).map((k) => <option key={k.id} value={k.id}>{biName(k.name)}</option>)}</select>
              </Field>
              <Field label={L('العنوان', 'Title', 'Titre')}><input className="inp" value={f.title} onChange={(e) => set({ title: e.target.value })} /></Field>
              <Field label={L('المسؤول عن النشاط', 'Leader', 'Responsable')}><input className="inp" value={f.leader} onChange={(e) => set({ leader: e.target.value })} /></Field>
              <Field label={L('عدد الأشخاص', 'People', 'Personnes')}><input className="inp" inputMode="numeric" dir="ltr" value={f.people} onChange={(e) => set({ people: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
          ) : (
            <div className="cal-grid2">
              <Field label={L('الجهة', 'Organisation', 'Organisation')}>
                <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <select className="inp" value={f.org_id ?? ''} onChange={(e) => { const id = Number(e.target.value) || null; const p = data.persons.find((q) => q.org_id === id && q.active); set({ org_id: id, person_id: p?.id ?? null }); }}>
                    <option value="">…</option>
                    {data.orgs.filter((o) => o.active || o.id === f.org_id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  {r.orgs && f.org_id != null && <button className="btn small" title={L('الجهة وأشخاصها', 'The organisation and its persons', 'L’organisation et ses responsables')} onClick={() => setOrgWin({ org: data.orgs.find((o) => o.id === f.org_id) ?? null })}>✎</button>}
                  {r.orgs && <button className="btn small" title={L('جهة جديدة', 'New organisation', 'Nouvelle organisation')} onClick={() => setOrgWin({ org: null })}>＋</button>}
                </div>
                {f.org_id != null && data.orgs.find((o) => o.id === f.org_id)?.note && <div className="small muted">{data.orgs.find((o) => o.id === f.org_id)!.note}</div>}
              </Field>
              <Field label={L('الشخص المسؤول لهذا الحجز', 'Person in charge for this booking', 'Responsable pour cette réservation')}>
                <select className="inp" value={f.person_id ?? ''} onChange={(e) => set({ person_id: Number(e.target.value) || null })}>
                  <option value="">—</option>
                  {persons.map((p) => <option key={p.id} value={p.id}>{p.name}{p.phone ? ` · ${p.phone}` : ''}</option>)}
                </select>
              </Field>
              <Field label={L('لأجل (اختياري)', 'What for (optional)', 'Pour quoi (facultatif)')}><input className="inp" placeholder={L('مؤتمر، عشاء…', 'conference, dinner…', 'conférence, dîner…')} value={f.subject} onChange={(e) => set({ subject: e.target.value })} /></Field>
              <Field label={L('عدد الأشخاص', 'People', 'Personnes')}><input className="inp" inputMode="numeric" dir="ltr" value={f.people} onChange={(e) => set({ people: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
          )}
        </section>

        {f.who !== 'whole' && (
          <section>
            <h4>{num()}. {L('أين', 'Where', 'Où')}</h4>
            {f.who === 'ours' && <Seg value={f.where} onChange={(v) => set({ where: v })} options={[{ value: 'spaces', label: L('في المركز', 'In the centre', 'Au centre') }, { value: 'outside', label: L('خارج المركز', 'Outside the centre', 'Hors du centre') }]} />}
            {f.who === 'ours' && f.where === 'outside'
              ? <Field label={L('المكان', 'The place', 'Le lieu')}><input className="inp" placeholder={L('رحلة، مخيّم في الأرض…', 'a trip, a camp at Al-Ard…', 'une sortie, un camp à Al-Ard…')} value={f.place} onChange={(e) => set({ place: e.target.value })} /></Field>
              : (
                <>
                  <div className="cal-pick">
                    {data.areas.filter((a) => a.active).map((a) => {
                      const list = data.spaces.filter((x) => x.building_id === a.id && inCalendar(x) && (!isStay || sleepsIn(x, data.kinds)));
                      if (!list.length) return null;
                      return (
                        <div key={a.id}>
                          <div className="small"><i className="cal-dot" style={{ background: colorOf(data.areas, a.id) }} /> <b>{a.name}</b></div>
                          <div className="cal-chips">
                            {list.map((x) => {
                              const ok = choosable(x);
                              const on = f.spaces.includes(x.id);
                              const inside = inRoomText(data, x);
                              return (
                                <label key={x.id} className={`cal-pickone${on ? ' on' : ''}${ok ? '' : ' off'}`} title={ok ? inside || undefined : L('لنشاطاتنا فقط', 'Ours only', 'Pour nous seulement')}>
                                  <input type="checkbox" disabled={!ok} checked={on} onChange={(e) => set({ spaces: e.target.checked ? [...f.spaces, x.id] : f.spaces.filter((y) => y !== x.id) })} /> {x.name}
                                  <span className="muted small"> {sleepsIn(x, data.kinds) ? (x.beds ? `${x.beds}🛏` : '') : x.capacity ? `${x.capacity}👤` : ''}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {f.spaces.some((id) => { const x = data.spaces.find((q) => q.id === id); return x && inRoomText(data, x); }) && (
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {f.spaces.map((id) => data.spaces.find((q) => q.id === id)).filter((x): x is CalSpace => !!x && !!inRoomText(data, x)).map((x) => <div key={x.id}>🎛 <b>{x.name}</b>: {inRoomText(data, x)}</div>)}
                    </div>
                  )}
                </>
              )}
          </section>
        )}

        <section>
          <h4>{num()}. {L('متى', 'When', 'Quand')}</h4>
          {isStay ? (
            <div className="cal-grid2">
              <Field label={L('يصلون في', 'Arrive on', 'Arrivée le')}><input className="inp" type="date" value={f.from} onChange={(e) => set({ from: e.target.value, to: f.to <= e.target.value ? addDays(e.target.value, 1) : f.to })} /></Field>
              <Field label={L('يغادرون في', 'Leave on', 'Départ le')}><input className="inp" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
            </div>
          ) : (
            <>
              <Seg value={f.when} onChange={(v) => set({ when: v, to: v === 'once' ? f.from : f.to < f.from ? f.from : f.to })} options={[
                { value: 'once', label: L('يوم واحد', 'One day', 'Un jour') }, { value: 'days', label: L('عدة أيام متتالية', 'Several days in a row', 'Plusieurs jours de suite') }, { value: 'weekly', label: L('كل أسبوع', 'Every week', 'Chaque semaine') },
              ]} />
              <div className="cal-grid2" style={{ marginTop: 6 }}>
                <Field label={f.when === 'once' ? L('اليوم', 'Day', 'Jour') : L('من', 'From', 'Du')}><input className="inp" type="date" value={f.from} onChange={(e) => set({ from: e.target.value, to: f.when === 'once' || f.to < e.target.value ? e.target.value : f.to })} /></Field>
                {f.when !== 'once' && <Field label={L('إلى', 'To', 'Au')}><input className="inp" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>}
              </div>
              {f.when === 'weekly' && (
                <div className="host-days" style={{ margin: '6px 0' }}>
                  {REPEAT_ORDER.map((x) => { const w = WD[(x + 6) % 7]; return <button key={x} type="button" className={f.repeat.includes(x) ? 'on' : ''} onClick={() => set({ repeat: f.repeat.includes(x) ? f.repeat.filter((y) => y !== x) : [...f.repeat, x] })}>{L(w[0], w[1], w[2])}</button>; })}
                </div>
              )}
              {f.who !== 'whole' && (
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <label className="small cal-check"><input type="checkbox" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} /> {L('اليوم كله', 'The whole day', 'Toute la journée')}</label>
                  {!f.allDay && <>
                    <select className="inp cal-hour-pick" value={f.t1} onChange={(e) => set({ t1: e.target.value })}>{HOUR_LIST.map((h) => <option key={h}>{h}</option>)}</select>
                    →
                    <select className="inp cal-hour-pick" value={f.t2} onChange={(e) => set({ t2: e.target.value })}>{HOUR_LIST.map((h) => <option key={h}>{h}</option>)}</select>
                    {QUICK_HOURS.map(([a, b, lab]) => <button key={a} type="button" className="btn ghost small" onClick={() => set({ t1: a, t2: b })}>{lab()}</button>)}
                  </>}
                </div>
              )}
            </>
          )}
        </section>

        {f.who !== 'whole' && (
          <section>
            <h4>{num()}. {L('التجهيزات المطلوبة', 'Equipment needed', 'Équipement demandé')}</h4>
            {!equipList.length && <p className="small muted">{L('لا تجهيزات في القائمة بعد (الإعدادات ← القوائم).', 'No equipment on the list yet (Settings → Lists).', 'Pas encore d’équipement dans la liste (Réglages → Listes).')}</p>}
            {f.needs.map((x, i) => (
              <div key={i} className="row cal-line-row">
                <select className="inp" value={x.equip_id} onChange={(e) => set({ needs: f.needs.map((y, j) => (j === i ? { ...y, equip_id: Number(e.target.value) } : y)) })}>
                  {equipList.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.total} {L('في الجرد', 'in the inventory', 'dans l’inventaire')})</option>)}
                </select>
                <input className="inp cal-qty" inputMode="numeric" dir="ltr" value={x.qty} onChange={(e) => set({ needs: f.needs.map((y, j) => (j === i ? { ...y, qty: e.target.value.replace(/\D/g, '') } : y)) })} />
                <button className="btn ghost small" aria-label="remove" onClick={() => set({ needs: f.needs.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            {equipList.length > 0 && <button className="btn small" onClick={() => set({ needs: [...f.needs, { equip_id: equipList.find((e) => !f.needs.some((y) => y.equip_id === e.id))?.id ?? equipList[0].id, qty: '1' }] })}>＋ {L('تجهيز', 'Equipment', 'Équipement')}</button>}
          </section>
        )}

        {outside && (
          <section>
            <h4>{num()}. {L('الخدمات', 'Services', 'Services')}</h4>
            {f.lines.map((l, i) => (
              <div key={i} className="row cal-line-row">
                <select className="inp" value={l.service_id ?? ''} onChange={(e) => { const id = Number(e.target.value) || null; set({ lines: f.lines.map((y, j) => (j === i ? { ...y, service_id: id, label: data.services.find((q) => q.id === id)?.name ?? y.label } : y)) }); }}>
                  <option value="">—</option>
                  {data.services.filter((q) => q.active || q.id === l.service_id).map((q) => <option key={q.id} value={q.id}>{biName(q.name)}</option>)}
                </select>
                <span className="small muted">{L('كم', 'How many', 'Combien')}</span>
                <input className="inp cal-qty" inputMode="numeric" dir="ltr" value={l.qty} onChange={(e) => set({ lines: f.lines.map((y, j) => (j === i ? { ...y, qty: e.target.value.replace(/[^\d.]/g, '') } : y)) })} />
                {r.prices && <>
                  <span className="small muted">{L('المبلغ', 'Amount', 'Montant')}</span>
                  <input className="inp cal-amount" inputMode="decimal" dir="ltr" value={l.amount} onChange={(e) => set({ lines: f.lines.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)) })} />
                  <select className="inp cal-cur" value={l.currency} onChange={(e) => set({ lines: f.lines.map((y, j) => (j === i ? { ...y, currency: e.target.value as Currency } : y)) })}><option>USD</option><option>SYP</option></select>
                </>}
                <button className="btn ghost small" aria-label="remove" onClick={() => set({ lines: f.lines.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            {services.length > 0 && <button className="btn small" onClick={() => set({ lines: [...f.lines, { service_id: services[0].id, label: services[0].name, qty: f.people || '1', amount: '', currency: f.currency }] })}>＋ {L('خدمة', 'Service', 'Service')}</button>}
            {!r.prices && f.lines.length > 0 && <p className="small muted">{L('المبالغ يكتبها المدير أو المنسّق.', 'The amounts are typed by the Director or the Coordinator.', 'Les montants sont saisis par le Directeur ou le Coordinateur.')}</p>}
          </section>
        )}

        {outside && r.prices && (
          <section>
            <h4>{num()}. {L('السعر', 'Price', 'Prix')}</h4>
            {old?.price_state === 'unset' && f.free && <div className="alert warn small">{L('السعر غير محدد بعد (حجز من الاستقبال): قرّر مجاناً أو بسعر.', 'The price is not set yet (made by Reception): decide free or a price.', 'Le prix n’est pas encore fixé (fait par l’accueil) : décidez gratuit ou un prix.')}</div>}
            <label className="cal-check"><input type="checkbox" checked={f.free} onChange={(e) => set({ free: e.target.checked })} /> <b>{L('مجاني', 'Free', 'Gratuit')}</b> <span className="small muted">{L('(يُحسب في التقرير استعمالاً مجانياً لأماكننا)', '(counted in the report as free use of our spaces)', '(compté dans le rapport comme usage gratuit de nos espaces)')}</span></label>
            {!f.free && (
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <input className="inp cal-amount" inputMode="decimal" dir="ltr" placeholder="0" value={f.rate} onChange={(e) => set({ rate: e.target.value })} />
                <select className="inp cal-cur" value={f.currency} onChange={(e) => set({ currency: e.target.value as Currency })}><option>USD</option><option>SYP</option></select>
                <Seg value={isStay ? (f.pmode === 'person' ? 'person' : 'whole') : f.each && several ? 'each' : 'whole'} onChange={(v) => set({ pmode: v === 'person' ? 'person' : 'group', each: v === 'each' })} options={[
                  ...(isStay ? [{ value: 'person', label: L('للشخص في الليلة', 'per person per night', 'par personne et par nuit') }] : []),
                  { value: 'whole', label: L('للحجز كله', 'for the whole booking', 'pour toute la réservation') },
                  ...(several ? [{ value: 'each', label: L('لكل تاريخ', 'each date', 'chaque date') }] : []),
                ]} />
              </div>
            )}
            <div className="cal-total">{L('المجموع المتفق عليه (السعر + الخدمات)', 'Agreed total (price + services)', 'Total convenu (prix + services)')}: <b dir="ltr">{fmtMoney(totals.total)}</b>{!f.free && (f.each || (isStay && f.pmode === 'person')) && <span className="small muted"> · {totals.dates} {isStay ? L('ليلة', 'night(s)', 'nuit(s)') : L('تاريخ', 'date(s)', 'date(s)')}</span>}</div>
            {old && <p className="small muted">{L('كل تغيير في السعر يُحفظ في السجل.', 'Every change of price is kept in the history.', 'Chaque changement de prix est gardé dans l’historique.')}</p>}
          </section>
        )}
        {outside && !r.prices && <p className="small muted">{L('السعر: يحدده المدير أو المنسّق (يُحفظ هذا الحجز «السعر غير محدد»).', 'Price: decided by the Director or the Coordinator (this booking is saved "price not set").', 'Prix : décidé par le Directeur ou le Coordinateur (cette réservation est enregistrée « prix non fixé »).')}</p>}

        <section>
          <h4>{num()}. {L('الحالة', 'Status', 'Statut')}</h4>
          <div className="row" style={{ gap: 8 }}>
            <Seg value={f.status} onChange={(v) => set({ status: v })} options={[{ value: 'option', label: L('للتأكيد', 'To confirm', 'À confirmer') }, { value: 'confirmed', label: L('مؤكَّد', 'Confirmed', 'Confirmé') }]} />
            {f.status === 'option' && <label className="small">{L('محجوز حتى', 'Held until', 'Retenu jusqu’au')} <input className="inp" type="date" value={f.hold} onChange={(e) => set({ hold: e.target.value })} /></label>}
            <label className="small cal-check"><input type="checkbox" checked={f.private} onChange={(e) => set({ private: e.target.checked })} /> {L('خاص (يظهر «محجوز» فقط على الهواتف والشاشة وللفريق)', 'Private (shows only "Reserved" on phones, the TV and to the Team)', 'Privé (seulement « Réservé » sur les téléphones, l’écran et pour l’équipe)')}</label>
          </div>
          <Field label={L('ملاحظة', 'Note', 'Note')}><input className="inp" value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        </section>
      </div>

      {res?.refused === 'taken' && (
        <div className="alert err">
          <b>{res.canSkip ? `${res.takenDays?.length} ${L('تاريخ محجوز من قبل', 'date(s) already taken', 'date(s) déjà prise(s)')}:` : L('غير ممكن: المكان محجوز في ذلك الوقت.', 'Not possible: the space is already held at that time.', 'Impossible : l’espace est déjà pris à ce moment.')}</b>
          <ul>{(res.clashes ?? []).slice(0, 8).map((c, i) => <li key={i}>{fmtDay(c.day)} · {c.space} · {c.name}</li>)}{(res.clashes?.length ?? 0) > 8 && <li>… {(res.clashes?.length ?? 0) - 8} {L('أخرى', 'more', 'autres')}</li>}</ul>
          {!res.clashes?.length && res.takenDays?.length ? <div className="small">{L('المكان مغلق للإصلاح في', 'The space is closed for repairs on', 'L’espace est fermé pour travaux le')} {res.takenDays.map(fmtDay).join(', ')}</div> : null}
          {res.canSkip
            ? <div className="row" style={{ marginTop: 6 }}><button className="btn small" disabled={busy} onClick={() => { setSkipOk(true); void save({ without_taken: true }); }}>{L('احفظ من دون هذه التواريخ', 'Save without these dates', 'Enregistrer sans ces dates')}</button></div>
            : <div className="small">{L('غيّر المكان أو اليوم أو الساعات.', 'Change the space, the day or the hours.', 'Changez l’espace, le jour ou les heures.')}{f.who === 'whole' ? ` ${L('للمركز كله: يجب أولاً نقل نشاطاتنا أو إلغاؤها؛ الحجوزات الخارجية لا تُنقل.', 'For the whole centre, our activities must first be moved or cancelled; outside bookings are not moved.', 'Pour tout le centre, nos activités doivent d’abord être déplacées ou annulées ; les réservations extérieures ne bougent pas.')}` : ''}</div>}
        </div>
      )}
      {res?.refused === 'warnings' && (
        <div className="alert warn">
          <b>{t('انتبه', 'Please check')}</b>
          <ul>{(res.warnings ?? []).map((w, i) => <li key={i}>{warnText(w)}</li>)}</ul>
          <button className="btn small" disabled={busy} onClick={() => void save({ force: true })}>{L('احفظ على كل حال', 'Save anyway', 'Enregistrer quand même')}</button>
        </div>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{t('حفظ', 'Save')}</button>
      </div>
      {orgWin && <OrgWindow data={data} org={orgWin.org} onClose={() => setOrgWin(null)} onSaved={async (id) => {
        await refresh();
        const fresh = await s.api.call('cal.get');
        const p = fresh.persons.find((q) => q.org_id === id && q.active && (orgWin.org == null || q.id === f.person_id)) ?? fresh.persons.find((q) => q.org_id === id && q.active);
        set({ org_id: id, person_id: p?.id ?? null });
      }} />}
    </Modal>
  );
}

// ---------------------------------------------------------------- the organisation window, and the register

interface PersonForm { id?: number; name: string; phone: string; active: boolean }
export function OrgWindow({ data, org, onClose, onSaved }: { data: CalData; org: CalOrg | null; onClose: () => void; onSaved: (id: number) => Promise<void> | void }) {
  const { s } = useApp();
  const [name, setName] = useState(org?.name ?? '');
  const [kind, setKind] = useState<number | null>(org?.kind_id ?? null);
  const [note, setNote] = useState(org?.note ?? '');
  const [active, setActive] = useState(org ? !!org.active : true);
  const [persons, setPersons] = useState<PersonForm[]>(() => (org ? data.persons.filter((p) => p.org_id === org.id).map((p) => ({ id: p.id, name: p.name, phone: p.phone ?? '', active: !!p.active })) : [{ name: '', phone: '', active: true }]));
  const [busy, setBusy] = useState(false);
  const used = org ? data.bookings.filter((b) => b.org_id === org.id).length : 0;
  const save = async () => {
    if (!name.trim()) { toast(L('اكتب اسم الجهة', 'Write the name of the organisation', 'Écrivez le nom de l’organisation'), true); return; }
    setBusy(true);
    try {
      const x = await s.api.call('cal.org.save', { id: org?.id, name, kind_id: kind, note, active, persons: persons.filter((p) => p.id != null || p.name.trim()).map((p) => ({ id: p.id, name: p.name, phone: p.phone, active: p.active })) });
      await onSaved(x.id);
      onClose();
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  return (
    <Modal title={org ? L('الجهة', 'Organisation', 'Organisation') : L('جهة جديدة', 'New organisation', 'Nouvelle organisation')} onClose={onClose} narrow>
      <div className="cal-form">
        <Field label={L('الاسم', 'Name', 'Nom')}><input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={L('النوع', 'Kind', 'Type')}>
          <select className="inp" value={kind ?? ''} onChange={(e) => setKind(Number(e.target.value) || null)}><option value="">—</option>{data.orgKinds.filter((k) => k.active || k.id === kind).map((k) => <option key={k.id} value={k.id}>{biName(k.name)}</option>)}</select>
        </Field>
        <Field label={L('ملاحظة', 'Note', 'Note')}><input className="inp" placeholder={L('تدفع كل شهر، تفضّل القاعة 2…', 'pays each month, prefers Hall 2…', 'paie chaque mois, préfère la salle 2…')} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div>
          <b className="small">{L('الأشخاص المسؤولون', 'Persons in charge', 'Responsables')}</b>
          {persons.map((p, i) => (
            <div key={i} className="row cal-line-row" style={{ opacity: p.active ? 1 : 0.5 }}>
              <input className="inp" placeholder={L('الاسم', 'Name', 'Nom')} value={p.name} onChange={(e) => setPersons(persons.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)))} />
              <input className="inp cal-phone" dir="ltr" placeholder={L('الهاتف', 'Phone', 'Téléphone')} value={p.phone} onChange={(e) => setPersons(persons.map((q, j) => (j === i ? { ...q, phone: e.target.value } : q)))} />
              {p.id != null
                ? <label className="small cal-check" title={L('الشخص لا يُحذف: يُوقف', 'A person is never removed: switched off', 'Une personne n’est jamais supprimée : désactivée')}><input type="checkbox" checked={p.active} onChange={(e) => setPersons(persons.map((q, j) => (j === i ? { ...q, active: e.target.checked } : q)))} /> {L('فعّال', 'active', 'actif')}</label>
                : <button className="btn ghost small" aria-label="remove" onClick={() => setPersons(persons.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <button className="btn small" onClick={() => setPersons([...persons, { name: '', phone: '', active: true }])}>＋ {L('شخص', 'Person', 'Personne')}</button>
        </div>
        {org && <label className="small cal-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {L('في القائمة (أزل العلامة لإخفائها، ولا تُحذف)', 'On the list (untick to hide it; it is never deleted)', 'Dans la liste (décochez pour la cacher ; jamais supprimée)')}</label>}
        {org && <p className="small muted">{used} {L('حجز لهذه الجهة', 'booking(s) for this organisation', 'réservation(s) pour cette organisation')}</p>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{t('حفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

/** the register of the organisations: search, their persons, how many bookings; add or change one */
export function OrgRegister({ data, refresh, onClose }: { data: CalData; refresh: () => Promise<void>; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [win, setWin] = useState<{ org: CalOrg | null } | null>(null);
  const kindName = (id: number | null) => biName(data.orgKinds.find((k) => k.id === id)?.name ?? '');
  const k = q.trim().toLowerCase();
  const rows = data.orgs.filter((o) => !k || o.name.toLowerCase().includes(k) || (o.note ?? '').toLowerCase().includes(k) || data.persons.some((p) => p.org_id === o.id && `${p.name} ${p.phone ?? ''}`.toLowerCase().includes(k)));
  return (
    <Modal title={L('الجهات', 'Organisations', 'Organisations')} onClose={onClose}>
      <div className="row" style={{ marginBottom: 8 }}>
        <input className="inp" style={{ flex: 1 }} type="search" placeholder={`🔍 ${L('اسم، شخص، هاتف…', 'name, person, phone…', 'nom, personne, téléphone…')}`} value={q} onChange={(e) => setQ(e.target.value)} />
        {data.rights.orgs && <button className="btn primary small" onClick={() => setWin({ org: null })}>＋ {L('جهة', 'Organisation', 'Organisation')}</button>}
      </div>
      <table className="t small">
        <thead><tr><th>{L('الجهة', 'Organisation', 'Organisation')}</th><th>{L('النوع', 'Kind', 'Type')}</th><th>{L('الأشخاص', 'Persons', 'Responsables')}</th><th className="n">{L('حجوزات', 'Bookings', 'Réservations')}</th><th /></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className={o.active ? '' : 'off'}>
              <td><b>{o.name}</b>{o.note && <div className="muted">{o.note}</div>}</td>
              <td>{kindName(o.kind_id)}</td>
              <td>{data.persons.filter((p) => p.org_id === o.id && p.active).map((p) => <div key={p.id}>{p.name}{p.phone && <> · <a href={`tel:${p.phone.replace(/\s/g, '')}`} dir="ltr">{p.phone}</a></>}</div>)}</td>
              <td className="n">{data.bookings.filter((b) => b.org_id === o.id && b.status !== 'cancelled').length}</td>
              <td>{data.rights.orgs && <button className="btn ghost small" onClick={() => setWin({ org: o })}>{L('عدّل', 'Edit', 'Modifier')}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="muted">{L('لا شيء.', 'Nothing.', 'Rien.')}</p>}
      {win && <OrgWindow data={data} org={win.org} onClose={() => setWin(null)} onSaved={refresh} />}
    </Modal>
  );
}
