// Accommodation and events (Fouad, 22 November 2026): "Rooms by day" — the rooms of the centre's buildings down the page,
// the days across, a coloured cell for each booking. Four tabs: the calendar; the bookings; the payments (suggestions of
// entries, for whoever keeps the calendar); and the buildings, rooms and services. A booking made on a phone with no
// connection waits for a look in a window that shows what it runs into.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { Field, Modal, Select, Tabs, biName, confirmBox, errText, fmtDate, fmtUsd, promptBox, t, toast, todayIso } from './kit';
import { saveFile } from '../platform';
import { hostWorkbook } from '../io/hostFile';
import { convertReceipt, initialRows, receiptPdf, receiptTotals, rowAmount, type ReceiptRow } from '../io/hostReceipt';
import { RECEIPT_TITLE_AR, brandStyle } from '../brand';
import { GuideLink } from '../guide/GuideView';
import { useNav } from './Shell';
import {
  addDays, addMonths, bookingTotals, capacity, clashing, colorOf, conflictsOf, daysInMonth, dueOf, equipmentLoad, heldDays, knownNames, live, nameKey, nightsOf, occupancy, PALETTE, report, shortagesFor, stayAmount, takenOn, toReview,
  type BookingKind, type BookingStatus, type Currency, type Shortage, type HostAlloc, type HostAsset, type HostBooking, type HostData, type HostRoom, type Totals,
} from '../hosting/host';

type Tab = 'calendar' | 'bookings' | 'equipment' | 'report' | 'payments' | 'settings';
/** where a new booking starts: the rooms and the days picked on the calendar (the last night is `to` minus one day) */
interface NewStart { rooms?: number[]; from?: string; to?: string }

const STATUS_LABEL: Record<BookingStatus, () => string> = {
  option: () => t('للتأكيد', 'To confirm'), confirmed: () => t('مؤكَّد', 'Confirmed'), arrived: () => t('وصلوا', 'Arrived'),
  left: () => t('غادروا', 'Left'), cancelled: () => t('ملغى', 'Cancelled'),
};
const money = (n: number, c: Currency) => (c === 'SYP' ? `${Math.round(n).toLocaleString('en')} ل.س` : fmtUsd(n));
/** what an amount comes to, in each currency that has something: "$60.00 · 50,000 ل.س" */
const fmtTotals = (x: Totals) => [x.USD ? money(x.USD, 'USD') : '', x.SYP ? money(x.SYP, 'SYP') : ''].filter(Boolean).join(' · ') || '—';
const weekday = (i: number) => new Date(Date.UTC(2026, 10, 22 + i)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayShort = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
/** the kind of a room, in the current language; and what the inventory holds in it (projector, sound system, chairs…) */
const kindName = (d: HostData, r: HostRoom) => biName(d.kinds.find((k) => k.id === r.kind_id)?.name ?? '') || (r.kind === 'bedroom' ? t('غرفة نوم', 'Bedroom') : t('قاعة', 'Hall'));
const assetsOf = (d: HostData, r: HostRoom): HostAsset[] => d.assets.filter((a) => a.room_id === r.id);
const assetText = (xs: HostAsset[]) => xs.map((a) => (a.qty > 1 ? `${a.qty} ${a.name}` : a.name)).join(' · ');
/** the shortages of equipment, one line per piece of equipment: the days and who asks for it too */
function shortageLines(d: Pick<HostData, 'equip' | 'bookings'>, xs: Shortage[]) {
  const by = new Map<number, Shortage[]>();
  for (const x of xs) by.set(x.equip_id, [...(by.get(x.equip_id) ?? []), x]);
  return [...by].map(([id, list]) => {
    const e = d.equip.find((q) => q.id === id);
    const worst = [...list].sort((a, b) => b.wanted - a.wanted)[0];
    const others = [...new Set(list.flatMap((x) => x.with))].map((i) => d.bookings.find((b) => b.id === i)?.group_name).filter(Boolean);
    return { id, name: e?.name ?? '', days: list.length, first: list[0].day, wanted: worst.wanted, have: worst.have, others: others as string[] };
  });
}
const roomName = (d: HostData, r: HostRoom) => `${d.buildings.find((b) => b.id === r.building_id)?.name ?? ''} · ${r.name}`;
const phoneLink = (p: string | null) => (p ? <a href={`tel:${p.replace(/\s/g, '')}`} dir="ltr">{p}</a> : null);

export function Hosting() {
  const { s, can, d, reload } = useApp();
  const keeps = can('hosting.keep');
  // the prices and the payments are their own tick (keeping the calendar has them too)
  const priced = can('hosting.prices') || keeps;
  const books = can('hosting.book') || priced;
  const [tab, setTab] = useState<Tab>('calendar');
  const [data, setData] = useState<HostData | null>(null);
  const [edit, setEdit] = useState<{ booking: HostBooking | null; start?: NewStart } | null>(null);
  // clicking a booking shows its information in a side window; changing it needs "Modify" (to avoid mistakes)
  const [viewId, setViewId] = useState<number | null>(null);
  const [review, setReview] = useState<boolean>((d.host?.review ?? 0) > 0);
  const load = useCallback(async () => {
    try { setData(await s.api.call('host.get')); } catch (e) { toast(errText(e), true); }
  }, [s]);
  useEffect(() => { void load(); }, [load, d.host]);
  const both = async () => { await reload(); await load(); };
  const waiting = useMemo(() => (data ? toReview(data) : []), [data]);
  const toEnter = data ? data.pays.filter((p) => p.status === 'suggested' && !data.entered.includes(p.receipt_no)).length : 0;

  return (
    <>
      <div className="page-head"><h1>{t('الإقامة والتقويم', 'Accommodation and calendar')}<GuideLink id="hosting" /></h1></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'calendar', label: t('التقويم', 'Calendar') },
        { value: 'bookings', label: t('الحجوزات', 'Bookings') },
        { value: 'equipment', label: t('التجهيزات', 'Equipment'), hidden: !data?.equip.some((e) => e.active) && !keeps },
        { value: 'report', label: t('تقارير', 'Reports') },
        { value: 'payments', label: `${t('الدفعات', 'Payments')}${toEnter ? ` (${toEnter})` : ''}`, hidden: !priced },
        { value: 'settings', label: t('المباني والغرف', 'Buildings and rooms'), hidden: !keeps },
      ]} />
      {!data ? <p className="muted">…</p> : (
        <>
          {waiting.length > 0 && books && (
            <div className="panel" style={{ borderColor: 'var(--warn, #c9a227)' }}>
              <b>{waiting.length}</b> {t('حجز من الهاتف ينتظر نظرة', 'booking(s) made on a phone wait for a look')} <button className="btn small" onClick={() => setReview(true)}>{t('انظر', 'Look')}</button>
            </div>
          )}
          {tab === 'calendar' && <CalendarTab data={data} books={books} onOpen={(b) => setViewId(b.id)} onNew={(start) => setEdit({ booking: null, start })} />}
          {tab === 'bookings' && <BookingsTab data={data} books={books} onOpen={(b) => setViewId(b.id)} onNew={() => setEdit({ booking: null })} />}
          {tab === 'equipment' && <EquipmentTab data={data} onOpen={(b) => setViewId(b.id)} />}
          {tab === 'report' && <ReportTab data={data} onOpen={(b) => setViewId(b.id)} />}
          {tab === 'payments' && priced && <PaymentsTab data={data} refresh={both} />}
          {tab === 'settings' && keeps && <SettingsTab data={data} refresh={both} />}
          {viewId != null && !edit && data.bookings.some((x) => x.id === viewId) && <BookingView data={data} booking={data.bookings.find((x) => x.id === viewId)!} canChange={books} onClose={() => setViewId(null)} onModify={(b) => { setViewId(null); setEdit({ booking: b }); }} refresh={both} />}
          {edit && <BookingEditor data={data} start={edit} onClose={() => setEdit(null)} refresh={both} />}
          {review && waiting.length > 0 && <ReviewBox data={data} onClose={() => setReview(false)} refresh={both} onChange={(b) => { setReview(false); setEdit({ booking: b }); }} />}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- the calendar: rooms by day, by month, by year

type View = 'rooms' | 'month' | 'year';

function CalendarTab({ data: everything, books, onOpen, onNew }: { data: HostData; books: boolean; onOpen: (b: HostBooking) => void; onNew: (start: NewStart) => void }) {
  const [view, setView] = useState<View>('rooms');
  // the type of booking shown: stays, events, or both
  const [kind, setKind] = useState<BookingKind | 'all'>('all');
  const data = useMemo(() => (kind === 'all' ? everything : { ...everything, bookings: everything.bookings.filter((b) => b.kind === kind) }), [everything, kind]);
  const [from, setFrom] = useState(todayIso());
  const [span, setSpan] = useState(14);
  const [building, setBuilding] = useState<number | null>(null);
  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(from, i)), [from, span]);
  const rooms = data.rooms.filter((r) => r.active && (building == null || r.building_id === building));
  const today = todayIso();
  // dragging over free days (and rooms) starts a booking with them already chosen
  const order = useMemo(() => data.buildings.flatMap((b) => rooms.filter((r) => r.building_id === b.id)), [data.buildings, rooms]);
  const [drag, setDrag] = useState<{ r: number; d: number } | null>(null);
  const [hov, setHov] = useState<{ r: number; d: number } | null>(null);
  const sel = drag && hov ? { r0: Math.min(drag.r, hov.r), r1: Math.max(drag.r, hov.r), d0: Math.min(drag.d, hov.d), d1: Math.max(drag.d, hov.d) } : null;
  useEffect(() => {
    if (!drag) return;
    const up = () => {
      const h = hov ?? drag;
      const r0 = Math.min(drag.r, h.r), r1 = Math.max(drag.r, h.r), d0 = Math.min(drag.d, h.d), d1 = Math.max(drag.d, h.d);
      setDrag(null); setHov(null);
      // the last day picked is a night: the leaving day is the next one
      onNew({ rooms: order.slice(r0, r1 + 1).map((r) => r.id), from: days[d0], to: addDays(days[d1], 1) });
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [drag, hov, order, days, onNew]);
  const step = (n: number) => setFrom(view === 'rooms' ? addDays(from, 7 * n) : view === 'month' ? addMonths(from, n) : addMonths(from, 12 * n));
  const pick = (d: string, v: View) => { setFrom(d); setView(v); };
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <div className="tabs" style={{ margin: 0 }}>
          {(['rooms', 'month', 'year'] as View[]).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v === 'rooms' ? t('الغرف حسب اليوم', 'Rooms by day') : v === 'month' ? t('شهري', 'Month') : t('سنوي', 'Year')}</button>)}
        </div>
        <button className="btn small" onClick={() => step(-1)}>‹</button>
        <button className="btn small" onClick={() => setFrom(today)}>{t('اليوم', 'Today')}</button>
        <button className="btn small" onClick={() => step(1)}>›</button>
        {view === 'rooms' && <input className="inp" type="date" style={{ width: 150 }} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />}
        {view === 'month' && <b>{monthName(from.slice(0, 7))}</b>}
        {view === 'year' && <b>{from.slice(0, 4)}</b>}
        {view === 'rooms' && (
          <select value={span} onChange={(e) => setSpan(Number(e.target.value))}>
            <option value={7}>{t('أسبوع', '1 week')}</option><option value={14}>{t('أسبوعان', '2 weeks')}</option><option value={31}>{t('شهر', '1 month')}</option>
          </select>
        )}
        <select value={kind} onChange={(e) => setKind(e.target.value as BookingKind | 'all')} title={t('نوع الحجز', 'Type of booking')}>
          <option value="all">{t('كل الأنواع', 'All types')}</option><option value="stay">{t('إقامة', 'Accommodation')}</option><option value="event">{t('أنشطة', 'Events')}</option>
        </select>
        <Select value={building} options={data.buildings.filter((b) => b.active).map((b) => ({ value: b.id, label: b.name }))} onChange={setBuilding} placeholder={t('كل المباني', 'All buildings')} />
        {books && <button className="btn primary small" onClick={() => onNew({ from: view === 'rooms' ? from : today })}>＋ {t('حجز', 'Booking')}</button>}
      </div>
      <div className="host-key small">
        {data.buildings.filter((b) => b.active).map((b) => <span key={b.id} className="host-sw"><i style={{ background: colorOf(data.buildings, b.id) }} />{b.name}</span>)}
        <span className="host-cell option" style={{ ['--hc' as string]: '#888' }}>{t('للتأكيد', 'To confirm')}</span><span className="host-cell confirmed" style={{ ['--hc' as string]: '#555' }}>{t('مؤكَّد', 'Confirmed')}</span>
        <span className="host-cell arrived" style={{ ['--hc' as string]: '#555' }}>{t('وصلوا', 'Arrived')}</span><span className="host-cell left">{t('غادروا', 'Left')}</span><span className="host-cell clash">{t('تداخل', 'Clash')}</span>
      </div>
      {view === 'rooms' && books && rooms.length > 0 && <p className="small muted">{t('اسحب على الأيام (وعلى عدة غرف) لبدء حجز بها.', 'Drag over the days (and over several rooms) to start a booking with them.')}</p>}
      {view === 'rooms' && (rooms.length === 0 ? <p className="muted">{t('لا غرف بعد: أضفها في «المباني والغرف».', 'No rooms yet: add them in "Buildings and rooms".')}</p> : (
        <div className="tbl-wrap host-wrap">
          <table className={`host-grid ${drag ? 'dragging' : ''}`}>
            <thead>
              <tr>
                <th className="host-room">{t('الغرفة', 'Room')}</th>
                {days.map((dy) => <th key={dy} className={dy === today ? 'today' : dy.slice(8) === '01' ? 'first' : ''}><small>{dayShort(dy)}</small><br />{dy.slice(8)}{dy.slice(8) === '01' ? <small>/{dy.slice(5, 7)}</small> : null}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.buildings.filter((b) => rooms.some((r) => r.building_id === b.id)).map((b) => (
                <BuildingRows key={b.id} data={data} building={b.id} rooms={rooms.filter((r) => r.building_id === b.id)} days={days} books={books} onOpen={onOpen} order={order} sel={sel} onDown={(r, d) => { setDrag({ r, d }); setHov({ r, d }); }} onEnter={(r, d) => drag && setHov({ r, d })} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {view === 'month' && <MonthView data={data} month={from.slice(0, 7)} rooms={rooms} books={books} onDay={(d) => pick(d, 'rooms')} onOpen={onOpen} onNew={onNew} />}
      {view === 'year' && <YearView data={data} year={from.slice(0, 4)} rooms={rooms} onMonth={(ym) => pick(`${ym}-01`, 'month')} />}
    </>
  );
}

function BuildingRows({ data, building, rooms, days, books, onOpen, order, sel, onDown, onEnter }: { data: HostData; building: number; rooms: HostRoom[]; days: string[]; books: boolean; onOpen: (b: HostBooking) => void; order: HostRoom[]; sel: { r0: number; r1: number; d0: number; d1: number } | null; onDown: (r: number, d: number) => void; onEnter: (r: number, d: number) => void }) {
  const color = colorOf(data.buildings, building);
  const name = data.buildings.find((b) => b.id === building)?.name ?? '';
  return (
    <>
      <tr className="host-building"><td colSpan={days.length + 1} style={{ borderInlineStart: `6px solid ${color}` }}>{name}</td></tr>
      {rooms.map((r) => (
        <tr key={r.id}>
          <th className="host-room" style={{ borderInlineStart: `6px solid ${color}` }}>{r.name}{r.kind === 'bedroom' ? <small> · {r.beds}</small> : <small title={assetText(assetsOf(data, r))}> · {r.capacity ? `${r.capacity} ${t('شخص', 'p.')}` : kindName(data, r)}</small>}</th>
          {days.map((dy, di) => {
            const ri = order.findIndex((x) => x.id === r.id);
            const picked = !!sel && ri >= sel.r0 && ri <= sel.r1 && di >= sel.d0 && di <= sel.d1;
            const taken = takenOn(r, dy, data.bookings, data.allocs);
            const beds = taken.reduce((n, x) => n + x.beds, 0);
            if (!taken.length) return <td key={dy} className={`host-free ${picked ? 'sel' : ''}`} onMouseDown={(e) => { if (books && e.button === 0) { e.preventDefault(); onDown(ri, di); } }} onMouseEnter={() => onEnter(ri, di)} />;
            const first = taken[0].booking;
            const cls = beds > capacity(r) ? 'clash' : first.status;
            const label = taken.length > 1 ? `${taken.length}` : first.group_name.slice(0, 8);
            const tip = taken.map((x) => `${x.booking.group_name}${x.booking.time_from ? ` ${x.booking.time_from}–${x.booking.time_to ?? ''}` : ''} · ${STATUS_LABEL[x.booking.status]()}${r.beds > 1 ? ` · ${x.beds}/${r.beds}` : ''}`).join('\n');
            return <td key={dy} className={`host-cell ${cls} ${picked ? 'sel' : ''}`} style={{ ['--hc' as string]: color }} title={tip} onMouseEnter={() => onEnter(ri, di)} onClick={() => onOpen(first)}>{cls === 'arrived' ? '✓ ' : ''}{label}{r.beds > 1 && taken.length === 1 ? <small> {taken[0].beds}</small> : null}</td>;
          })}
        </tr>
      ))}
    </>
  );
}

/** a month: each day with how full the rooms are and the groups present; a click opens the rooms of that week */
function MonthView({ data, month, rooms, books, onDay, onOpen, onNew }: { data: HostData; month: string; rooms: HostRoom[]; books: boolean; onDay: (d: string) => void; onOpen: (b: HostBooking) => void; onNew: (start: NewStart) => void }) {
  const [a, setA] = useState<string | null>(null);
  const [z, setZ] = useState<string | null>(null);
  const lo = a && z ? (a < z ? a : z) : null, hi = a && z ? (a < z ? z : a) : null;
  useEffect(() => {
    if (!a) return;
    const up = () => { const x = z ?? a; const f = a < x ? a : x, l = a < x ? x : a; setA(null); setZ(null); if (f === l) onDay(f); else onNew({ from: f, to: addDays(l, 1) }); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [a, z, onDay, onNew]);
  const occ = useMemo(() => occupancy(data, new Set(rooms.map((r) => r.id))), [data, rooms]);
  const n = daysInMonth(month);
  const lead = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const today = todayIso();
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const firstBuilding = (b: HostBooking) => { const a = data.allocs.find((x) => x.booking_id === b.id); const r = data.rooms.find((x) => x.id === a?.room_id); return r ? colorOf(data.buildings, r.building_id) : '#888'; };
  return (
    <div className="host-month">
      {Array.from({ length: 7 }, (_, i) => <div key={i} className="host-mh">{weekday(i)}</div>)}
      {cells.map((d, i) => {
        if (!d) return <div key={i} className="host-md off" />;
        const o = occ.days.get(d);
        const pct = o && occ.total ? Math.min(100, Math.round((o.used / occ.total) * 100)) : 0;
        const groups = o?.groups ?? [];
        return (
          <div key={d} className={`host-md ${d === today ? 'today' : ''} ${lo && hi && d >= lo && d <= hi ? 'sel' : ''}`} onMouseDown={(e) => { if (books && e.button === 0) { e.preventDefault(); setA(d); setZ(d); } }} onMouseEnter={() => a && setZ(d)} onClick={() => { if (!books) onDay(d); }}>
            <div className="host-mn"><b>{Number(d.slice(8))}</b>{pct > 0 && <small>{pct}%</small>}</div>
            <div className="host-bar"><i style={{ width: `${pct}%` }} /></div>
            {groups.slice(0, 3).map((g) => <span key={g.id} className={`host-chip ${g.status}`} style={{ ['--hc' as string]: firstBuilding(g) }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onOpen(g); }} title={g.group_name}>{g.kind === 'event' ? '▸ ' : ''}{g.group_name}</span>)}
            {groups.length > 3 && <small className="muted">+{groups.length - 3}</small>}
          </div>
        );
      })}
    </div>
  );
}

/** a year: twelve small months, each day shaded by how full the rooms are; a click opens the month */
function YearView({ data, year, rooms, onMonth }: { data: HostData; year: string; rooms: HostRoom[]; onMonth: (ym: string) => void }) {
  const occ = useMemo(() => occupancy(data, new Set(rooms.map((r) => r.id))), [data, rooms]);
  const today = todayIso();
  return (
    <div className="host-year">
      {Array.from({ length: 12 }, (_, mi) => {
        const ym = `${year}-${String(mi + 1).padStart(2, '0')}`;
        const lead = new Date(`${ym}-01T00:00:00Z`).getUTCDay();
        const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: daysInMonth(ym) }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)];
        return (
          <div key={ym} className="host-ym" onClick={() => onMonth(ym)}>
            <b>{monthName(ym).replace(/\s?\d{4}/, '')}</b>
            <div className="host-yg">
              {cells.map((d, i) => {
                if (!d) return <i key={i} className="off" />;
                const o = occ.days.get(d);
                const pct = o && occ.total ? Math.min(1, o.used / occ.total) : 0;
                return <i key={d} className={d === today ? 'today' : ''} title={o ? `${d} · ${o.groups.map((g) => g.group_name).join('، ')}` : d} style={pct > 0 ? { background: `color-mix(in srgb, var(--centre) ${Math.round(25 + pct * 75)}%, #fff)` } : undefined} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- the bookings

function BookingsTab({ data, books, onOpen, onNew }: { data: HostData; books: boolean; onOpen: (b: HostBooking) => void; onNew: () => void }) {
  const [st, setSt] = useState<BookingStatus | 'all'>('all');
  const [kind, setKind] = useState<BookingKind | 'all'>('all');
  const [q, setQ] = useState('');
  const list = data.bookings.filter((b) => (kind === 'all' || b.kind === kind) && (st === 'all' ? b.status !== 'cancelled' || false : b.status === st) && (!q.trim() || `${b.group_name} ${b.contact ?? ''} ${b.code}`.toLowerCase().includes(q.trim().toLowerCase())));
  const sorted = [...list].sort((a, b) => b.from_day.localeCompare(a.from_day));
  // the bookings whose equipment does not suffice (with the others that meet them)
  const bad = useMemo(() => new Set(data.bookings.filter((b) => live(b) && data.needs.some((n) => n.booking_id === b.id) && shortagesFor(b, data.needs.filter((n) => n.booking_id === b.id), data).length > 0).map((b) => b.id)), [data]);
  const names = (id: number) => data.allocs.filter((a) => a.booking_id === id).map((a) => { const r = data.rooms.find((x) => x.id === a.room_id); return r ? roomName(data, r) : ''; }).join('، ');
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <select value={st} onChange={(e) => setSt(e.target.value as BookingStatus | 'all')}>
          <option value="all">{t('الكل (من دون الملغى)', 'All (not cancelled)')}</option>
          {(['option', 'confirmed', 'arrived', 'left', 'cancelled'] as BookingStatus[]).map((x) => <option key={x} value={x}>{STATUS_LABEL[x]()}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as BookingKind | 'all')} title={t('نوع الحجز', 'Type of booking')}>
          <option value="all">{t('كل الأنواع', 'All types')}</option><option value="stay">{t('إقامة', 'Accommodation')}</option><option value="event">{t('أنشطة', 'Events')}</option>
        </select>
        <input className="inp" style={{ width: 200 }} placeholder={t('بحث', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} />
        {books && <button className="btn primary small" onClick={onNew}>＋ {t('حجز', 'Booking')}</button>}
      </div>
      <div className="tbl-wrap"><table className="t small">
        <thead><tr><th>{t('الرمز', 'Code')}</th><th>{t('المجموعة', 'Group')}</th><th>{t('من', 'From')}</th><th>{t('إلى', 'To')}</th><th className="n">{t('أشخاص', 'People')}</th><th>{t('الغرف', 'Rooms')}</th><th>{t('الحالة', 'Status')}</th>{data.prices && <><th className="n">{t('المبلغ', 'Total')}</th><th className="n">{t('المتبقي', 'Due')}</th></>}</tr></thead>
        <tbody>
          {sorted.map((b) => {
            const total = bookingTotals(b, data.lines.filter((l) => l.booking_id === b.id));
            return (
              <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(b)}>
                <td>{b.code}{b.review ? ' 📱' : ''}{bad.has(b.id) ? <span title={t('التجهيزات المطلوبة لا تكفي', 'Not enough equipment')}> ⚠</span> : null}</td><td><b>{b.group_name}</b>{b.kind === 'event' ? <small> · {t('نشاط', 'event')}</small> : null}</td>
                <td>{fmtDate(b.from_day)}</td><td>{fmtDate(b.to_day)}</td><td className="n">{b.people}</td><td>{names(b.id)}</td>
                <td><span className={`host-badge ${b.status}`}>{STATUS_LABEL[b.status]()}</span></td>
                {data.prices && <><td className="n">{total.USD || total.SYP ? fmtTotals(total) : ''}</td><td className="n">{total.USD || total.SYP ? fmtTotals(dueOf(total, data.pays.filter((p) => p.booking_id === b.id))) : ''}</td></>}
              </tr>
            );
          })}
          {!sorted.length && <tr><td colSpan={9} className="muted">{t('لا حجوزات', 'No bookings')}</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

// ---------------------------------------------------------------- the receipt (وصل استلام) of a group, adjusted in a window before it is exported

type EditRow = ReceiptRow & { id: number; /** the stay (or the hall) line, priced per person */ perPerson?: boolean; stay?: boolean };

/** Opens with everything the booking holds; the number of people, the nights, the meals and every line can be changed, the amounts follow, then it is written as a PDF. */
/** what the receipt window reads (the 0.12 page gives its data; the new calendar gives its own, step 4) */
export type ReceiptData = Pick<HostData, 'pays' | 'lines' | 'allocs' | 'rooms' | 'buildings' | 'needs' | 'equip'>;
export function ReceiptWindow({ data, booking: b, onClose, printed, onPrinted, rows0, nights: givenNights }: {
  data: ReceiptData; booking: HostBooking; onClose: () => void;
  /** printed before: the mark "copy" */ printed?: number; onPrinted?: () => Promise<void>;
  /** the calendar gives its own first lines (a price for each date) and its own count of dates (moved and cancelled ones) */
  rows0?: ReceiptRow[]; nights?: number;
}) {
  const { s } = useApp();
  const ev = b.kind === 'event';
  const nights0 = givenNights ?? Math.max(1, heldDays(b).length);
  const [people, setPeople] = useState(String(b.people));
  const [nights, setNights] = useState(String(nights0));
  const [date, setDate] = useState(todayIso());
  const [ref, setRef] = useState(b.code);
  const [name, setName] = useState(b.group_name);
  const [contact, setContact] = useState(b.contact ?? '');
  const [phone, setPhone] = useState(b.phone ?? '');
  const [note, setNote] = useState('');
  const [showRooms, setShowRooms] = useState(true);
  const [showEquip, setShowEquip] = useState(true);
  const pays = data.pays.filter((p) => p.booking_id === b.id && p.status !== 'refused' && p.kind !== 'back');
  const [payOn, setPayOn] = useState<Set<number>>(() => new Set(pays.map((p) => p.id)));
  // one currency for the whole receipt (USD, or SYP at a rate), or each amount as it is
  const [asCur, setAsCur] = useState<'as' | Currency>('as');
  const [rate, setRate] = useState(() => { try { return localStorage.getItem('magis-receipt-rate') ?? ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<EditRow[]>(() => {
    let n = 0;
    const base = rows0 ?? initialRows(b, nights0, data.lines.filter((l) => l.booking_id === b.id).map((l) => ({ label: l.label, qty: l.qty, amount: l.amount, currency: l.currency })));
    return base.map((r, i) => ({ ...r, id: ++n, stay: i === 0 && b.rate != null && !!b.price_mode, perPerson: i === 0 && b.rate != null && b.price_mode === 'person' }));
  });
  let nextId = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const num = (v: string) => Math.max(0, Number(v) || 0);

  // changing the people or the nights: the stay line follows, and so does any line that counted the same people (the meals)
  const changePeople = (v: string) => {
    const p0 = num(people), p1 = num(v), n = num(nights);
    setPeople(v);
    setRows((rs) => rs.map((r) => (r.perPerson ? { ...r, qty: p1 * n, sub: `${p1} people x ${n} ${ev ? 'day(s)' : 'night(s)'}` } : !r.stay && p0 > 0 && r.qty === p0 ? { ...r, qty: p1 } : r)));
  };
  const changeNights = (v: string) => {
    const p = num(people), n = num(v);
    setNights(v);
    setRows((rs) => rs.map((r) => (r.perPerson ? { ...r, qty: p * n, sub: `${p} people x ${n} ${ev ? 'day(s)' : 'night(s)'}` } : r)));
  };
  const set = (id: number, patch: Partial<EditRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const cur = b.currency;
  const counted = pays.filter((p) => payOn.has(p.id));
  const rateNum = Number(rate) || 0;
  const conv = asCur !== 'as' && rateNum > 0 ? { to: asCur, rate: rateNum } : null;
  const shown = conv ? convertReceipt(rows, counted, conv) : { rows, payments: counted, changed: false };
  const tot = receiptTotals(shown.rows, shown.payments);
  const needRate = asCur !== 'as' && !(rateNum > 0);
  const where = data.allocs.filter((a) => a.booking_id === b.id).map((a) => ({ a, r: data.rooms.find((x) => x.id === a.room_id) })).filter((x): x is { a: HostAlloc; r: HostRoom } => !!x.r)
    .map(({ a, r }) => `${data.buildings.find((x) => x.id === r.building_id)?.name ?? ''} · ${r.name}${r.kind === 'bedroom' ? ` (${a.beds ?? r.beds} beds)` : r.capacity ? ` (up to ${r.capacity} people)` : ''}`);
  const equip = data.needs.filter((n) => n.booking_id === b.id).map((n) => `${data.equip.find((e) => e.id === n.equip_id)?.name ?? ''} x ${n.qty}`);

  // the PDF as it is now (used by the preview and by the export)
  const build = async (): Promise<Uint8Array> => {
    const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
    // the Arabic title under the name: the one set in Admin → Appearance, else the house's usual one
    const custom = await s.api.call('brand.get').then((x) => x.receipt_title).catch(() => null);
    const st = brandStyle({ centre: s.centre ?? 'other', color: s.brandColor, logo: s.brandLogo });
    const [arabic, arabicBold, jesuit, centre] = await Promise.all([get('/fonts/amiri-arabic-400.ttf'), get('/fonts/amiri-arabic-700.ttf'), get('/brand/jesuits.png').catch(() => null), st.mark ? get(st.mark).catch(() => null) : Promise.resolve(null)]);
    return receiptPdf({
      organisation: s.organisation ?? '', titleAr: custom || RECEIPT_TITLE_AR[s.centre ?? ''], logos: { jesuit, centre }, fonts: { arabic, arabicBold }, accent: st.deep,
      issuedOn: date, ref, kind: b.kind, billedTo: { name, contact, phone }, from_day: b.from_day, to_day: b.to_day, people: num(people), nights: num(nights), repeats: !!b.repeat_days,
      rooms: showRooms ? where : [], equipment: showEquip ? equip : [], rows: shown.rows.map(({ label, sub, qty, unit, currency }) => ({ label, sub, qty, unit, currency })),
      payments: shown.payments.map((p) => ({ paid_on: p.paid_on, receipt_no: p.receipt_no, amount: p.amount, currency: p.currency })), conversion: conv && shown.changed ? conv : undefined, note,
      copy: (printed ?? 0) > 0,
    });
  };
  const rememberRate = () => { if (conv) { try { localStorage.setItem('magis-receipt-rate', String(rateNum)); } catch { /* the rate is only remembered for next time */ } } };
  const exportPdf = async () => {
    if (needRate) { toast(t('اكتب سعر الصرف', 'Write the exchange rate'), true); return; }
    setBusy(true);
    try {
      rememberRate();
      const saved = await saveFile(`receipt_${ref.replace(/[^A-Za-z0-9-]+/g, '')}_${todayIso()}.pdf`, ['pdf'], await build(), t('احفظ وصل الاستلام', 'Save the receipt'));
      if (saved !== null) await onPrinted?.();
      onClose();
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  // a look at the receipt before saving it: the same PDF, shown in the window; "Back" keeps everything typed
  const [view, setView] = useState<string | null>(null);
  useEffect(() => () => { if (view) URL.revokeObjectURL(view); }, [view]);
  const preview = async () => {
    if (needRate) { toast(t('اكتب سعر الصرف', 'Write the exchange rate'), true); return; }
    setBusy(true);
    try { const bytes = await build(); setView(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };

  if (view) {
    return (
      <Modal title={`${t('معاينة وصل الاستلام', 'Preview of the receipt')} · ${b.group_name}`} onClose={() => setView(null)}>
        <iframe title="receipt" src={view} style={{ width: '100%', height: '68vh', minHeight: 360, border: '1px solid var(--line, #ccc)', borderRadius: 6 }} />
        <div className="modal-foot">
          <button className="btn" onClick={() => setView(null)}>{t('رجوع للتعديل', 'Back to edit')}</button>
          <button className="btn primary" disabled={busy} onClick={() => void exportPdf()}>{t('احفظ PDF', 'Export PDF')}</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`${t('وصل استلام', 'Receipt')} · ${b.group_name}`} onClose={onClose}>
      <div className="grid2">
        <Field label={t('التاريخ', 'Date')}><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('المرجع', 'Reference')}><input className="inp" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label={t('إلى (المجموعة)', 'Billed to (group)')}><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('الشخص المسؤول', 'Person in charge')}><input className="inp" value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
        <Field label={t('الهاتف', 'Phone')}><input className="inp" style={{ direction: 'ltr' }} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <span />
        <Field label={t('عدد الأشخاص', 'Number of people')}><input className="inp" type="number" min={0} value={people} onChange={(e) => changePeople(e.target.value)} /></Field>
        <Field label={ev ? t('عدد الأيام', 'Number of days') : t('عدد الليالي', 'Number of nights')}><input className="inp" type="number" min={0} value={nights} onChange={(e) => changeNights(e.target.value)} /></Field>
      </div>
      <p className="small muted">{t('تغيير الأشخاص أو الليالي يعدّل سطر الإقامة، وكل سطر كان يحسب العدد نفسه (الوجبات).', 'Changing the people or the nights changes the stay line, and any line that counted the same people (the meals).')}</p>

      <h3 style={{ margin: '10px 0 4px' }}>{t('البنود', 'Lines')}</h3>
      <table className="t small host-rcpt"><thead><tr><th>{t('البيان', 'Description')}</th><th className="n">{t('العدد', 'Qty')}</th><th className="n">{t('السعر', 'Price')}</th><th>{t('العملة', 'Cur.')}</th><th className="n">{t('المبلغ', 'Amount')}</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><input className="inp" value={r.label} onChange={(e) => set(r.id, { label: e.target.value })} />{r.sub ? <small className="muted">{r.sub}</small> : null}</td>
              <td><input className="inp" type="number" min={0} style={{ width: 80 }} value={r.qty} onChange={(e) => set(r.id, { qty: Number(e.target.value) || 0, ...(r.perPerson ? { sub: undefined, perPerson: false } : {}) })} /></td>
              <td><input className="inp" type="number" min={0} step="any" style={{ width: 100 }} value={r.unit} onChange={(e) => set(r.id, { unit: Number(e.target.value) || 0 })} /></td>
              <td><select value={r.currency} onChange={(e) => set(r.id, { currency: e.target.value as Currency })}><option value="USD">USD</option><option value="SYP">SYP</option></select></td>
              <td className="n"><b>{money(rowAmount(r), r.currency)}</b></td>
              <td><button className="btn ghost small" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>✕</button></td>
            </tr>
          ))}
        </tbody></table>
      <button className="btn small" onClick={() => setRows((rs) => [...rs, { id: nextId++, label: '', qty: 1, unit: 0, currency: cur }])}>＋ {t('بند', 'Add a line')}</button>

      <h3 style={{ margin: '12px 0 4px' }}>{t('عملة الوصل', 'Currency of the receipt')}</h3>
      <div className="small">
        <label><input type="radio" name="rc-cur" checked={asCur === 'as'} onChange={() => setAsCur('as')} /> {t('كل مبلغ بعملته', 'Each amount in its own currency')}</label>{' '}
        <label><input type="radio" name="rc-cur" checked={asCur === 'USD'} onChange={() => setAsCur('USD')} /> {t('الكل بالدولار', 'All in USD')}</label>{' '}
        <label><input type="radio" name="rc-cur" checked={asCur === 'SYP'} onChange={() => setAsCur('SYP')} /> {t('الكل بالليرة السورية', 'All in SYP')}</label>
      </div>
      {asCur !== 'as' && (
        <div className="small" style={{ marginTop: 6 }}>
          <label>1 USD = <input className="inp" type="number" min={0} step="any" style={{ width: 120, direction: 'ltr' }} value={rate} onChange={(e) => setRate(e.target.value)} /> SYP</label>
          <span className="muted"> · {needRate ? t('اكتب سعر الصرف المعتمد', 'Write the rate you agree on') : t('يُطبع سعر الصرف على الوصل', 'The rate is printed on the receipt')}</span>
        </div>
      )}

      <h3 style={{ margin: '12px 0 4px' }}>{t('ما يظهر', 'What is shown')}</h3>
      <div className="small">
        <label><input type="checkbox" checked={showRooms} onChange={(e) => setShowRooms(e.target.checked)} /> {t('الغرف', 'The rooms')}</label>{' '}
        <label><input type="checkbox" checked={showEquip} onChange={(e) => setShowEquip(e.target.checked)} /> {t('التجهيزات', 'The equipment')}</label>
      </div>
      {pays.length > 0 && (
        <div className="small" style={{ marginTop: 6 }}>
          <b>{t('الدفعات المقبوضة', 'Payments received')}</b>
          {pays.map((p) => <label key={p.id} style={{ display: 'block' }}><input type="checkbox" checked={payOn.has(p.id)} onChange={(e) => setPayOn((x) => { const n = new Set(x); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} /> {fmtDate(p.paid_on)} · {p.receipt_no} · {money(p.amount, p.currency)}</label>)}
        </div>
      )}
      <Field label={t('ملاحظة في أسفل الوصل (طريقة الدفع، شكر…)', 'A note at the foot (how to pay, a thank-you…)')}><textarea className="inp" rows={2} style={{ width: '100%' }} value={note} onChange={(e) => setNote(e.target.value)} /></Field>

      {/* the totals and the buttons stay at the bottom of the window while the rest scrolls */}
      <div className="host-rcpt-foot">
        <div className="host-rcpt-tot">
          <span><small>{t('المجموع', 'Total')}</small> <b>{fmtTotals(tot.total)}</b></span>
          {counted.length > 0 && <span><small>{t('المدفوع', 'Paid')}</small> {fmtTotals(tot.paid)}</span>}
          {counted.length > 0 && <span><small>{t('المتبقي', 'Balance due')}</small> <b>{fmtTotals(tot.due)}</b></span>}
        </div>
      <div className="modal-foot" style={{ marginTop: 8 }}>
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn" disabled={busy || !name.trim() || needRate} onClick={() => void preview()}>{t('معاينة', 'Preview')}</button>
        <button className="btn primary" disabled={busy || !name.trim() || needRate} onClick={() => void exportPdf()}>{t('احفظ PDF', 'Export PDF')}</button>
      </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- the booking's information, in a side window (who, where, when, what they need)

/** Read only: a click on a booking shows this; the form to change it opens only with "Modify". The amounts only for those who see prices. */
function BookingView({ data, booking: b, canChange, onClose, onModify, refresh }: { data: HostData; booking: HostBooking; canChange: boolean; onClose: () => void; onModify: (b: HostBooking) => void; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(false);
  // the two things reception does most, in one click: they arrived, they left (anything else needs Modify)
  const mark = async (status: BookingStatus) => {
    setBusy(true);
    try { await s.api.call('host.booking.status', { id: b.id, status }); await refresh(); toast(status === 'arrived' ? t('سُجّل وصولهم', 'Marked as arrived') : t('سُجّلت مغادرتهم', 'Marked as left')); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const rooms = data.allocs.filter((a) => a.booking_id === b.id).map((a) => ({ a, r: data.rooms.find((x) => x.id === a.room_id) })).filter((x): x is { a: (typeof data.allocs)[number]; r: HostRoom } => !!x.r);
  // a hall (a meeting space) is shown first, then the bedrooms together with their beds
  const halls = rooms.filter(({ r }) => r.kind !== 'bedroom');
  const sleeping = rooms.filter(({ r }) => r.kind === 'bedroom');
  const bedsTotal = sleeping.reduce((n, { a, r }) => n + (a.beds ?? r.beds), 0);
  const byBuilding = [...sleeping.reduce((m, x) => { const k = data.buildings.find((bd) => bd.id === x.r.building_id)?.name ?? ''; m.set(k, [...(m.get(k) ?? []), x]); return m; }, new Map<string, typeof sleeping>())];
  const needs = data.needs.filter((n) => n.booking_id === b.id).map((n) => ({ n, e: data.equip.find((x) => x.id === n.equip_id) }));
  const lines = data.lines.filter((l) => l.booking_id === b.id);
  const short = shortageLines(data, shortagesFor(b, data.needs.filter((n) => n.booking_id === b.id), data));
  const total = data.prices ? bookingTotals(b, lines) : { USD: 0, SYP: 0 };
  const days = heldDays(b).length;
  const pays = data.pays.filter((p) => p.booking_id === b.id);
  // one line = an icon and the information itself (no headings: the icon says what it is)
  const line = (icon: string, body: React.ReactNode, key?: string) => <div key={key} className="host-vl"><span className="host-vi" aria-hidden="true">{icon}</span><div>{body}</div></div>;
  const long = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const sameDay = b.from_day === b.to_day;
  return (
    <aside className="host-drawer" role="dialog" aria-label={b.group_name}>
      <header>
        <div>
          <h2>{b.group_name}</h2>
          <span className={`host-badge ${b.status}`}>{STATUS_LABEL[b.status]()}</span>
          <small className="muted"> · {b.kind === 'event' ? t('نشاط', 'Event') : t('إقامة', 'Stay')}{b.source === 'phone' ? ' · 📱' : ''}</small>
          <div className="host-hdate">📅 {sameDay ? long(b.from_day) : `${long(b.from_day)} → ${long(b.to_day)}`}{b.kind === 'stay' ? <small className="muted"> · {days} {t('ليلة', 'night(s)')}</small> : b.repeat_days ? <small className="muted"> · {days} {t('جلسة', 'session(s)')}</small> : !sameDay ? <small className="muted"> · {days} {t('يوم', 'day(s)')}</small> : null}</div>
          {b.cancel_reason && <div className="small muted">{b.cancel_reason}</div>}
        </div>
        <button className="btn ghost small" onClick={onClose} aria-label="close">✕</button>
      </header>

      <div className="host-vbody">
        {/* what matters first: the rooms booked (a hall with bedrooms, mostly) and the equipment they need */}
        {halls.map(({ a, r }) => line('🏛', <>
          <b>{r.name}</b> <span className="muted">· {data.buildings.find((x) => x.id === r.building_id)?.name}</span>
          <div className="small muted">{kindName(data, r)}{r.capacity ? ` · ${t('حتى', 'up to')} ${r.capacity} ${t('شخصاً', 'people')}` : ''}{a.beds ? ` · ${a.beds}` : ''}</div>
        </>, `h${r.id}`))}
        {sleeping.length > 0 && line('🛏', <>
          <b>{sleeping.length === 1 ? sleeping[0].r.name : `${sleeping.length} ${t('غرف نوم', 'bedrooms')}`}</b> <span className="muted">· {bedsTotal} {t('سرير', 'beds')}{b.people ? ` ${t('لـ', 'for')} ${b.people} ${t('شخصاً', 'people')}` : ''}</span>
          {byBuilding.map(([bd, rs]) => <div key={bd} className="small muted">{bd}: {rs.map(({ a, r }) => `${r.name} (${a.beds ?? r.beds})`).join('، ')}</div>)}
        </>)}
        {rooms.length === 0 && line('🏛', <span className="muted">{t('لم تُحدَّد غرف بعد', 'No room chosen yet')}</span>)}

        {needs.length > 0 && line('🎛', <div className="host-chips">{needs.map(({ n, e }) => <span key={n.equip_id} className="host-chip2">{e?.name ?? '?'}{n.qty > 1 ? ` × ${n.qty}` : ''}</span>)}</div>)}
        {short.map((x) => <div key={x.id} className="host-warn">⚠ <b>{x.name}</b>: {x.wanted} {t('مطلوب والجرد يحوي', 'asked for, the inventory holds')} {x.have}{x.others.length ? ` — ${t('تطلبه أيضاً', 'also asked by')} ${x.others.join('، ')}` : ''}</div>)}

        <hr />

        {line('👥', <><b>{b.people}</b> {t('شخصاً', 'people')}</>)}
        {(b.contact || b.phone) && line('👤', <>{b.contact}{b.contact && b.phone ? ' · ' : ''}{phoneLink(b.phone)}</>)}
        {b.kind === 'event' && b.time_from && line('🕐', <span dir="ltr"><b>{b.time_from}{b.time_to ? ` – ${b.time_to}` : ''}</b></span>)}
        {b.repeat_days && line('🔁', <>{t('كل', 'Every')} {b.repeat_days.split(',').map((d) => weekday(Number(d))).join('، ')}</>)}
        {lines.length > 0 && line('🍽', <div className="host-chips">{lines.map((l) => <span key={l.id} className="host-chip2">{l.label}{l.qty !== 1 ? ` × ${l.qty}` : ''}{data.prices && l.amount ? ` · ${money(l.amount, l.currency)}` : ''}</span>)}</div>)}

        {b.note && <div className="host-note">📝 {b.note}</div>}

        {data.prices && (b.rate != null || lines.length > 0 || pays.length > 0) && (
          <>
            <hr />
            {line('💰', <>
              <b>{fmtTotals(total)}</b>{b.rate != null ? <span className="muted"> · {b.price_mode === 'group' ? t('سعر ثابت', 'fixed price') : `${money(b.rate, b.currency)} ${t('للشخص/ليلة', 'per person/night')}`}</span> : null}
              <div className="small muted">{t('المتبقي', 'Still due')}: {fmtTotals(dueOf(total, pays))}</div>
            </>)}
          </>
        )}
      </div>

      <div className="host-vfoot">
        {canChange && <button className="btn" disabled={busy} onClick={() => onModify(b)}>{t('عدّل', 'Modify')}</button>}
        {canChange && b.kind === 'stay' && b.status === 'confirmed' && <button className="btn primary" disabled={busy} onClick={() => void mark('arrived')}>{t('وصلوا', 'Arrived')}</button>}
        {canChange && b.kind === 'stay' && b.status === 'arrived' && <button className="btn primary" disabled={busy} onClick={() => void mark('left')}>{t('غادروا', 'Left')}</button>}
        {data.prices && (b.rate != null || lines.length > 0) && <button className="btn" disabled={busy} onClick={() => setReceipt(true)}>{t('وصل استلام', 'Receipt')}</button>}
        <button className="btn ghost" onClick={onClose}>{t('إغلاق', 'Close')}</button>
      </div>
      {receipt && <ReceiptWindow data={data} booking={b} onClose={() => setReceipt(false)} />}
    </aside>
  );
}

// ---------------------------------------------------------------- one booking

interface Line { id?: number; service_id: number | null; label: string; qty: string; amount: string; currency: Currency }

function BookingEditor({ data, start, onClose, refresh }: { data: HostData; start: { booking: HostBooking | null; start?: NewStart }; onClose: () => void; refresh: () => Promise<void> }) {
  const { s, can } = useApp();
  const keeps = can('hosting.keep');
  const canPrice = can('hosting.prices') || keeps;
  const b = start.booking;
  const [f, setF] = useState(() => ({
    kind: (b?.kind ?? 'stay') as BookingKind, group_name: b?.group_name ?? '', contact: b?.contact ?? '', phone: b?.phone ?? '', people: String(b?.people ?? ''),
    from_day: b?.from_day ?? start.start?.from ?? todayIso(), to_day: b?.to_day ?? start.start?.to ?? addDays(start.start?.from ?? todayIso(), 1),
    price_mode: (b?.price_mode ?? 'person') as 'person' | 'group', rate: b?.rate != null ? String(b.rate) : '', currency: (b?.currency ?? 'USD') as Currency, note: b?.note ?? '', time_from: b?.time_from ?? '', time_to: b?.time_to ?? '',
  }));
  // an event may repeat every week on chosen weekdays between its first and last day (never a stay)
  const [rep, setRep] = useState<Set<number>>(() => new Set((b?.repeat_days ?? '').split(',').filter(Boolean).map(Number)));
  const [again, setAgain] = useState(!!b?.repeat_days);
  const [payForm, setPayForm] = useState<{ amount: string; currency: Currency; paid_on: string; method: string } | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // the groups and the people already known: complete the name, and fill the contact of a known group
  const known = useMemo(() => knownNames(data.bookings), [data.bookings]);
  const gk = known.groups.get(nameKey(f.group_name));
  const pk = known.people.get(nameKey(f.contact));
  const typeGroup = (v: string) => setF((x) => {
    const g = known.groups.get(nameKey(v));
    return { ...x, group_name: v, ...(!b && g && !x.contact.trim() && !x.phone.trim() ? { contact: g.contact ?? '', phone: g.phone ?? '' } : {}) };
  });
  const typeContact = (v: string) => setF((x) => {
    const p = known.people.get(nameKey(v));
    return { ...x, contact: v, ...(!b && p && !x.phone.trim() ? { phone: p.phone ?? '' } : {}) };
  });
  const [allocs, setAllocs] = useState<Map<number, number | null>>(() => {
    const m = new Map<number, number | null>();
    for (const a of data.allocs.filter((x) => x.booking_id === b?.id)) m.set(a.room_id, a.beds);
    if (!b) for (const r of start.start?.rooms ?? []) m.set(r, null);
    return m;
  });
  // the equipment the group asks for (chosen from the list taken from the inventory)
  const [needs, setNeeds] = useState<{ equip_id: number | null; qty: string }[]>(() => data.needs.filter((n) => n.booking_id === b?.id).map((n) => ({ equip_id: n.equip_id, qty: String(n.qty) })));
  const [lines, setLines] = useState<Line[]>(() => data.lines.filter((l) => l.booking_id === b?.id).map((l) => ({ id: l.id, service_id: l.service_id, label: l.label, qty: String(l.qty), amount: String(l.amount), currency: l.currency })));
  const [busy, setBusy] = useState(false);
  const readOnly = !(can('hosting.book') || canPrice);
  const people = Number(f.people) || 0;
  const repeatDays = f.kind === 'event' && again && rep.size ? [...rep].sort().join(',') : null;
  const hours = f.kind === 'event' ? { time_from: f.time_from || null, time_to: f.time_to || null } : { time_from: null, time_to: null };
  const probe = { id: b?.id ?? -1, kind: f.kind, from_day: f.from_day, to_day: f.to_day, repeat_days: repeatDays, ...hours };
  const asked = [...allocs].map(([room_id, beds]) => ({ booking_id: b?.id ?? -1, room_id, beds }));
  const dates = /^\d{4}-\d{2}-\d{2}$/.test(f.from_day) && /^\d{4}-\d{2}-\d{2}$/.test(f.to_day) && (f.kind === 'stay' ? f.to_day > f.from_day : f.to_day >= f.from_day);
  const clashes = dates ? conflictsOf(probe, asked, data, 'any') : [];
  const sure = dates ? conflictsOf(probe, asked, data, 'sure') : [];
  const by = (id: number) => data.bookings.find((x) => x.id === id)?.group_name ?? '';
  // the meeting spaces chosen hold this many people in all (0: no capacity given)
  const capTotal = [...allocs.keys()].map((id) => data.rooms.find((r) => r.id === id)).filter((r): r is HostRoom => !!r && r.kind !== 'bedroom').reduce((n, r) => n + (r.capacity || 0), 0);
  const priced = { kind: f.kind, from_day: f.from_day, to_day: f.to_day, repeat_days: repeatDays, people, price_mode: f.price_mode, rate: f.rate === '' ? null : Number(f.rate) };
  const total: Totals = dates && data.prices ? bookingTotals({ ...priced, currency: f.currency }, lines.map((l) => ({ amount: Number(l.amount) || 0, currency: l.currency }))) : { USD: 0, SYP: 0 };
  const pays = data.pays.filter((p) => p.booking_id === b?.id);
  const due = dueOf(total, pays);

  const needsOk = needs.filter((n) => n.equip_id != null && Number(n.qty) >= 1).map((n) => ({ equip_id: n.equip_id as number, qty: Math.round(Number(n.qty)) }));
  // would the others that meet this booking and this booking ask for more than the inventory holds?
  const short = dates && needsOk.length ? shortagesFor(probe, needsOk, data) : [];
  const body = () => ({
    id: b?.id, kind: f.kind, group_name: f.group_name, contact: f.contact, phone: f.phone, people, from_day: f.from_day, to_day: f.to_day, note: f.note, repeat_days: repeatDays ? repeatDays.split(',').map(Number) : null, ...hours,
    price_mode: f.rate === '' ? null : f.price_mode, rate: f.rate === '' ? null : Number(f.rate), currency: f.currency,
    allocs: [...allocs].map(([room_id, beds]) => ({ room_id, beds })),
    needs: needsOk,
    lines: lines.filter((l) => l.label.trim() || l.service_id).map((l) => ({ id: l.id, service_id: l.service_id, label: l.label, qty: Number(l.qty) || 1, amount: Number(l.amount) || 0, currency: l.currency })),
  });
  const save = async (status?: BookingStatus, reason?: string | null) => {
    // confirming with equipment that does not exist in the stock asked: say so first
    if (status === 'confirmed' && short.length && !(await confirmBox(`${t('التجهيزات لا تكفي:', 'Not enough equipment:')} ${shortageLines(data, short).map((x) => `${x.name} (${x.wanted}/${x.have})`).join('، ')}. ${t('أكّد مع ذلك؟', 'Confirm anyway?')}`))) return;
    setBusy(true);
    try {
      const r = await s.api.call('host.booking.save', body());
      if (status && status !== b?.status) await s.api.call('host.booking.status', { id: r.id, status, reason });
      await refresh();
      onClose();
      if (r.shortages?.length) toast(`${t('تنبيه: التجهيزات لا تكفي', 'Careful: not enough equipment')}: ${shortageLines(data, r.shortages).map((x) => x.name).join('، ')}`, true);
      if (!status && r.conflicts) toast(t('تنبيه: الغرف محجوزة لمجموعة أخرى (للتأكيد فقط)', 'Careful: the rooms are also held by another group (not confirmed yet)'));
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const cancel = async () => {
    const why = await promptBox(t('سبب الإلغاء؟', 'Why is it cancelled?'));
    if (why == null) return;
    await save('cancelled', why);
  };
  const addPay = () => setPayForm({ amount: due[f.currency] > 0 ? String(due[f.currency]) : due.USD > 0 ? String(due.USD) : due.SYP > 0 ? String(due.SYP) : '', currency: due[f.currency] > 0 ? f.currency : due.USD > 0 ? 'USD' : due.SYP > 0 ? 'SYP' : f.currency, paid_on: todayIso(), method: 'cash' });
  const savePay = async () => {
    if (!payForm) return;
    try { await s.api.call('host.pay.add', { booking_id: b!.id, amount: Number(payForm.amount), currency: payForm.currency, paid_on: payForm.paid_on, method: payForm.method }); toast(t('سُجّلت الدفعة: تنتظر المحاسب ليجعلها قيداً', 'Payment recorded: it waits for the accountant to make the entry')); setPayForm(null); await refresh(); } catch (e) { toast(errText(e), true); }
  };
  const remove = async () => {
    if (!b || !(await confirmBox(t('حذف هذا الحجز؟', 'Delete this booking?'), true))) return;
    try { await s.api.call('host.booking.delete', { id: b.id }); await refresh(); onClose(); } catch (e) { toast(errText(e), true); }
  };
  const rooms = data.rooms.filter((r) => r.active || allocs.has(r.id));

  return (
    <Modal title={b ? `${b.code} · ${b.group_name}` : t('حجز جديد', 'New booking')} onClose={onClose}>
      {b && <p className="small"><span className={`host-badge ${b.status}`}>{STATUS_LABEL[b.status]()}</span>{b.source === 'phone' ? ` · 📱 ${t('من الهاتف', 'from a phone')}` : ''}{b.cancel_reason ? ` · ${b.cancel_reason}` : ''}</p>}
      <datalist id="host-groups">{[...known.groups.values()].map((g) => <option key={g.name} value={g.name} />)}</datalist>
      <datalist id="host-people">{[...known.people.values()].map((p) => <option key={p.name} value={p.name} />)}</datalist>
      <div className="grid2">
        <Field label={t('النوع', 'Kind')}>
          <select value={f.kind} disabled={readOnly} onChange={(e) => set('kind', e.target.value as BookingKind)}>
            <option value="stay">{t('إقامة', 'Stay (nights)')}</option><option value="event">{t('نشاط في قاعة', 'Event in a hall (days)')}</option>
          </select>
        </Field>
        <Field label={t('المجموعة', 'Group')}><input className="inp" list="host-groups" disabled={readOnly} value={f.group_name} onChange={(e) => typeGroup(e.target.value)} autoFocus={!b} />{gk && <small className="muted">{gk.count} {t('حجزاً سابقاً', 'earlier booking(s)')} · {t('آخرها', 'last')} {fmtDate(gk.last)}</small>}</Field>
        <Field label={t('الشخص المسؤول', 'Person in charge')}><input className="inp" list="host-people" disabled={readOnly} value={f.contact} onChange={(e) => typeContact(e.target.value)} />{pk && <small className="muted">{pk.count} {t('حجزاً سابقاً', 'earlier booking(s)')} · {t('آخرها', 'last')} {fmtDate(pk.last)}</small>}</Field>
        <Field label={t('الهاتف', 'Phone')}><input className="inp" style={{ direction: 'ltr' }} disabled={readOnly} value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={f.kind === 'stay' ? t('الوصول', 'Arrival') : t('اليوم الأول', 'First day')}><input className="inp" type="date" disabled={readOnly} value={f.from_day} onChange={(e) => set('from_day', e.target.value)} /></Field>
        <Field label={f.kind === 'stay' ? t('المغادرة', 'Leaving') : t('اليوم الأخير', 'Last day')}><input className="inp" type="date" disabled={readOnly} value={f.to_day} onChange={(e) => set('to_day', e.target.value)} /></Field>
        {f.kind === 'event' && <Field label={t('من الساعة', 'From (hour)')}><input className="inp" type="time" disabled={readOnly} value={f.time_from} onChange={(e) => set('time_from', e.target.value)} /></Field>}
        {f.kind === 'event' && <Field label={t('إلى الساعة', 'To (hour)')}><input className="inp" type="time" disabled={readOnly} value={f.time_to} onChange={(e) => set('time_to', e.target.value)} /></Field>}
        <Field label={t('عدد الأشخاص', 'Number of people')}><input className="inp" type="number" min={0} disabled={readOnly} value={f.people} onChange={(e) => set('people', e.target.value)} /></Field>
      </div>
      {f.kind === 'event' && (
        <div className="small" style={{ margin: '6px 0' }}>
          <label><input type="checkbox" disabled={readOnly} checked={again} onChange={(e) => setAgain(e.target.checked)} /> {t('يتكرر كل أسبوع بين التاريخين', 'Repeats every week between the two dates')}</label>
          {again && (
            <span className="host-days">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => <button key={i} type="button" disabled={readOnly} className={rep.has(i) ? 'on' : ''} onClick={() => setRep((x) => { const n = new Set(x); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>{weekday(i)}</button>)}
            </span>
          )}
        </div>
      )}
      {dates && <p className="small muted">{f.kind === 'stay' ? `${nightsOf(probe)} ${t('ليلة', 'night(s)')}` : `${heldDays(probe).length} ${again && rep.size ? t('جلسة', 'session(s)') : t('يوم', 'day(s)')}`}</p>}

      <h3 style={{ margin: '10px 0 4px' }}>{t('الغرف', 'Rooms')}</h3>
      <div className="host-pick">
        {data.buildings.map((bd) => {
          const rs = rooms.filter((r) => r.building_id === bd.id);
          if (!rs.length) return null;
          return (
            <div key={bd.id}><b className="small">{bd.name}</b>
              {rs.map((r) => {
                const on = allocs.has(r.id);
                const mine = dates ? clashes.filter((c) => c.room_id === r.id) : [];
                return (
                  <div key={r.id} className="host-pick-row">
                    <label><input type="checkbox" disabled={readOnly} checked={on} onChange={(e) => setAllocs((m) => { const n = new Map(m); if (e.target.checked) n.set(r.id, null); else n.delete(r.id); return n; })} /> {r.name} {r.beds ? <small>({r.beds} {t('سرير', 'beds')})</small> : <small>({kindName(data, r)}{r.capacity ? ` · ${t('حتى', 'up to')} ${r.capacity} ${t('شخصاً', 'people')}` : ''})</small>}</label>
                    {assetsOf(data, r).length > 0 && <small className="muted host-assets" title={t('من الجرد', 'from the inventory')}>🎛 {assetText(assetsOf(data, r))}</small>}
                    {on && r.beds > 1 && f.kind === 'stay' && (
                      <input className="inp" type="number" min={1} max={r.beds} style={{ width: 70 }} placeholder={t('كلها', 'all')} disabled={readOnly} value={allocs.get(r.id) ?? ''}
                        onChange={(e) => setAllocs((m) => new Map(m).set(r.id, e.target.value === '' ? null : Number(e.target.value)))} />
                    )}
                    {on && mine.length > 0 && <span className="small" style={{ color: 'var(--err)' }}>⚠ {t('محجوزة', 'taken')}: {[...new Set(clashing(mine))].map(by).join('، ')}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {people > 0 && capTotal > 0 && people > capTotal && <p className="small" style={{ color: 'var(--err)' }}>⚠ {t(`عدد الأشخاص (${people}) أكبر من سعة القاعات المختارة (${capTotal})`, `${people} people, but the rooms chosen hold ${capTotal}`)}</p>}
      {sure.length > 0 && <p className="small" style={{ color: 'var(--err)' }}>{t('لا يمكن التأكيد: الغرف محجوزة لمجموعة مؤكَّدة في هذه الأيام. غيّر التواريخ أو الغرف.', 'It cannot be confirmed: the rooms are taken by a confirmed group on these days. Change the dates or the rooms.')}</p>}

      {(data.equip.some((e) => e.active) || needs.length > 0) && (
        <>
          <h3 style={{ margin: '10px 0 4px' }}>{t('التجهيزات المطلوبة', 'Equipment asked for')}</h3>
          {needs.map((n, i) => {
            const e = data.equip.find((x) => x.id === n.equip_id);
            return (
              <div key={i} className="row" style={{ gap: 6, marginBottom: 4, alignItems: 'center' }}>
                <Select value={n.equip_id} options={data.equip.filter((x) => x.active || x.id === n.equip_id).map((x) => ({ value: x.id, label: `${x.name} (${x.total})` }))} placeholder={t('تجهيز من الجرد…', 'Equipment (from the inventory)…')} disabled={readOnly}
                  onChange={(v) => setNeeds((xs) => xs.map((x, k) => (k === i ? { ...x, equip_id: v } : x)))} />
                <input className="inp" type="number" min={1} style={{ width: 70 }} title={t('العدد', 'How many')} disabled={readOnly} value={n.qty} onChange={(ev) => setNeeds((xs) => xs.map((x, k) => (k === i ? { ...x, qty: ev.target.value } : x)))} />
                {e && <small className="muted">{e.total} {t('في الجرد', 'in the inventory')}</small>}
                {!readOnly && <button className="btn ghost small" onClick={() => setNeeds((xs) => xs.filter((_, k) => k !== i))}>✕</button>}
              </div>
            );
          })}
          {!readOnly && <button className="btn small" onClick={() => setNeeds((xs) => [...xs, { equip_id: null, qty: '1' }])}>＋ {t('تجهيز', 'Equipment')}</button>}
          {shortageLines(data, short).map((x) => (
            <p key={x.id} className="small" style={{ color: 'var(--err)', margin: '4px 0' }}>⚠ {x.name}: {x.wanted} {t('مطلوب', 'asked for')}, {t('والموجود في الجرد', 'the inventory holds')} {x.have}{x.days > 1 ? ` (${x.days} ${t('أيام', 'days')}, ${t('من', 'from')} ${fmtDate(x.first)})` : ` (${fmtDate(x.first)})`}{x.others.length ? ` — ${t('تطلبه أيضاً', 'also asked by')}: ${x.others.join('، ')}` : ''}</p>
          ))}
        </>
      )}

      <h3 style={{ margin: '10px 0 4px' }}>{t('ملاحظة', 'Note')}</h3>
      <textarea className="inp" rows={2} disabled={readOnly} style={{ width: '100%', resize: 'vertical' }} value={f.note} onChange={(e) => set('note', e.target.value)}
        placeholder={t('مثلاً: يحتاجون غرفة هادئة، يصلون متأخرين، وجبات نباتية…', 'e.g. needs a quiet room, arrives late, vegetarian meals…')} />

      <h3 style={{ margin: '10px 0 4px' }}>{t('الخدمات', 'Services')}</h3>
      {lines.map((l, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 4, alignItems: 'center' }}>
          {l.service_id == null && l.label.trim() ? <input className="inp" style={{ minWidth: 150 }} disabled={readOnly} value={l.label} onChange={(e) => setLines((xs) => xs.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} /> : null}
          {!(l.service_id == null && l.label.trim()) && <Select value={l.service_id} options={data.services.filter((x) => x.active || x.id === l.service_id).map((x) => ({ value: x.id, label: x.name }))} placeholder={t('خدمة…', 'Service…')} disabled={readOnly}
            onChange={(v) => setLines((xs) => xs.map((x, k) => (k === i ? { ...x, service_id: v, label: data.services.find((s2) => s2.id === v)?.name ?? x.label } : x)))} />}
          <input className="inp" type="number" min={0} style={{ width: 70 }} title={t('الكمية', 'Quantity')} disabled={readOnly} value={l.qty} onChange={(e) => setLines((xs) => xs.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} />
          {data.prices && <input className="inp" inputMode="decimal" style={{ width: 90 }} title={t('المبلغ المتفق عليه', 'Agreed amount')} disabled={!canPrice} value={l.amount} onChange={(e) => setLines((xs) => xs.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} />}
          {data.prices && <select style={{ width: 80 }} title={t('العملة', 'Currency')} disabled={!canPrice} value={l.currency} onChange={(e) => setLines((xs) => xs.map((x, k) => (k === i ? { ...x, currency: e.target.value as Currency } : x)))}><option value="USD">USD</option><option value="SYP">SYP</option></select>}
          {!readOnly && <button className="btn ghost small" onClick={() => setLines((xs) => xs.filter((_, k) => k !== i))}>✕</button>}
        </div>
      ))}
      {!readOnly && <button className="btn small" onClick={() => setLines((xs) => [...xs, { service_id: null, label: '', qty: '1', amount: '0', currency: f.currency }])}>＋ {t('خدمة', 'Service')}</button>}

      {data.prices && (
        <>
          <h3 style={{ margin: '12px 0 4px' }}>{t('المبلغ المتفق عليه', 'Agreed amount')}</h3>
          <div className="grid2">
            <Field label={t('الحساب', 'Priced')}>
              <select value={f.price_mode} disabled={!canPrice} onChange={(e) => set('price_mode', e.target.value as 'person' | 'group')}>
                <option value="person">{t('للشخص في الليلة', 'Per person per night')}</option><option value="group">{t('سعر ثابت للمجموعة', 'A fixed price for the group')}</option>
              </select>
            </Field>
            <Field label={f.price_mode === 'person' ? t('السعر للشخص/ليلة', 'Rate per person/night') : t('سعر المجموعة', 'Price of the group')}>
              <div className="row" style={{ gap: 6 }}>
                <input className="inp" inputMode="decimal" disabled={!canPrice} value={f.rate} onChange={(e) => set('rate', e.target.value)} />
                <select value={f.currency} disabled={!canPrice} onChange={(e) => set('currency', e.target.value as Currency)}><option value="USD">USD</option><option value="SYP">SYP</option></select>
              </div>
            </Field>
          </div>
          {dates && <p className="small">{f.kind === 'stay' ? t('الإقامة', 'Stay') : t('النشاط', 'Event')}: <b>{money(stayAmount(priced), f.currency)}</b> · {t('المجموع', 'Total')}: <b>{fmtTotals(total)}</b>{b && <> · {t('المتبقي', 'Due')}: <b>{fmtTotals(due)}</b></>}</p>}
          {b && pays.length > 0 && (
            <table className="t small"><tbody>
              {pays.map((p) => (
                <tr key={p.id}><td>{p.receipt_no}{p.kind === 'back' && <small className="muted"> · {t('مُعاد', 'given back')}</small>}</td><td>{fmtDate(p.paid_on)}</td><td className="n">{p.kind === 'back' ? '−' : ''}{money(p.amount, p.currency)}</td>
                  <td>{p.status === 'refused' ? t('مرفوضة', 'refused') : data.entered.includes(p.receipt_no) ? `✓ ${t('قيد', 'entered')}` : t('تنتظر المحاسب', 'waits for the accountant')}</td></tr>
              ))}
            </tbody></table>
          )}
          {b && canPrice && <button className="btn small" onClick={() => addPay()}>＋ {t('دفعة مقبوضة', 'A payment received')}</button>}
        </>
      )}

      {!readOnly && (!b || b.status === 'option') && <p className="small muted">{t('«للتأكيد»: يحجز الأيام (مخطَّط في التقويم) لكنه ليس نهائياً. «أكّد الحجز»: يصير مؤكَّداً.', '"To confirm" holds the days (hatched on the calendar) but is not final. "Confirm the booking" makes it confirmed.')}</p>}
      <div className="modal-foot" style={{ flexWrap: 'wrap' }}>
        {b && keeps && !pays.length && <button className="btn ghost" onClick={() => void remove()}>{t('حذف', 'Delete')}</button>}
        {b && b.status !== 'cancelled' && !readOnly && <button className="btn" onClick={() => void cancel()}>{t('إلغاء الحجز', 'Cancel the booking')}</button>}
        <button className="btn" onClick={onClose}>{t('إغلاق', 'Close')}</button>
        {!readOnly && <button className="btn" disabled={busy || !f.group_name.trim() || !dates} onClick={() => void save()}>{!b || b.status === 'option' ? t('احفظ «للتأكيد»', 'Save as "to confirm"') : t('احفظ التغييرات', 'Save the changes')}</button>}
        {!readOnly && (!b || b.status === 'option') && <button className="btn primary" disabled={busy || !f.group_name.trim() || !dates || !allocs.size || sure.length > 0} onClick={() => void save('confirmed')}>{t('أكّد الحجز', 'Confirm the booking')}</button>}
        {!readOnly && b?.kind === 'stay' && b.status === 'confirmed' && <button className="btn primary" disabled={busy} onClick={() => void save('arrived')}>{t('وصلوا', 'They arrived')}</button>}
        {!readOnly && b?.kind === 'stay' && b.status === 'arrived' && <button className="btn primary" disabled={busy} onClick={() => void save('left')}>{t('غادروا', 'They left')}</button>}
        {!readOnly && b?.status === 'cancelled' && <button className="btn" disabled={busy} onClick={() => void save('option')}>{t('أعده للتأكيد', 'Back to "to confirm"')}</button>}
      </div>
      {payForm && (
        <Modal title={t('دفعة مقبوضة', 'A payment received')} onClose={() => setPayForm(null)} narrow>
          <div className="grid2">
            <Field label={t('المبلغ', 'Amount')}><input className="inp" inputMode="decimal" autoFocus value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></Field>
            <Field label={t('العملة', 'Currency')}><select value={payForm.currency} onChange={(e) => setPayForm({ ...payForm, currency: e.target.value as Currency })}><option value="USD">USD</option><option value="SYP">SYP</option></select></Field>
            <Field label={t('التاريخ', 'Date')}><input className="inp" type="date" value={payForm.paid_on} onChange={(e) => setPayForm({ ...payForm, paid_on: e.target.value })} /></Field>
            <Field label={t('الطريقة', 'Method')}><select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}><option value="cash">{t('نقداً', 'Cash')}</option><option value="transfer">{t('حوالة', 'Transfer')}</option><option value="other">{t('أخرى', 'Other')}</option></select></Field>
          </div>
          <p className="small muted">{t('المتبقي', 'Still due')}: {fmtTotals(due)}</p>
          <div className="modal-foot"><button className="btn" onClick={() => setPayForm(null)}>{t('إلغاء', 'Cancel')}</button><button className="btn primary" disabled={!(Number(payForm.amount) > 0)} onClick={() => void savePay()}>{t('سجّل', 'Record')}</button></div>
        </Modal>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- bookings made on a phone

/** What the phones sent: each one with the days it runs into; confirm what is free, move what is not — and call. */
function ReviewBox({ data, onClose, refresh, onChange }: { data: HostData; onClose: () => void; refresh: () => Promise<void>; onChange: (b: HostBooking) => void }) {
  const { s } = useApp();
  const list = toReview(data);
  const roomsOf = (id: number) => data.allocs.filter((a) => a.booking_id === id).map((a) => { const r = data.rooms.find((x) => x.id === a.room_id); return r ? roomName(data, r) : ''; }).join('، ');
  const confirm = async (b: HostBooking) => {
    try { await s.api.call('host.booking.status', { id: b.id, status: 'confirmed' }); await refresh(); toast(t('أُكّد الحجز', 'Booking confirmed')); } catch (e) { toast(errText(e), true); }
  };
  const keepOption = async (b: HostBooking) => {
    try { await s.api.call('host.booking.status', { id: b.id, status: 'option' }); await refresh(); } catch (e) { toast(errText(e), true); }
  };
  return (
    <Modal title={t('حجوزات من الهاتف', 'Bookings made on a phone')} onClose={onClose}>
      <p className="small">{t('سُجّلت هذه الحجوزات بلا اتصال، فهي «للتأكيد» حتى تُفحص. أكّد ما لا تعارض فيه، وغيّر التواريخ أو الغرف لما فيه تعارض، وتذكّر أن تتصل بصاحب الطلب.', 'These were made with no connection, so each is "to confirm" until checked. Confirm those with no clash; for a clash change the dates or the rooms — and remember to call the person who asked.')}</p>
      {list.length === 0 && <p className="muted">{t('لا شيء ينتظر', 'Nothing is waiting')}</p>}
      {list.map(({ booking: b, conflicts, clashWith }) => (
        <div key={b.id} className="panel" style={{ padding: 10, marginBottom: 8, borderColor: conflicts.length ? 'var(--err)' : undefined }}>
          <b>{b.group_name}</b> · {fmtDate(b.from_day)} → {fmtDate(b.to_day)} · {b.people} {t('شخص', 'people')}<br />
          <span className="small muted">{roomsOf(b.id) || t('بلا غرف', 'no rooms')}</span>
          {(b.contact || b.phone) && <div className="small">☎ {b.contact} {phoneLink(b.phone)}</div>}
          {conflicts.length === 0 ? (
            <p className="small" style={{ color: 'var(--ok, #2e7d32)', margin: '6px 0' }}>✓ {t('لا تعارض: الغرف حرّة في هذه الأيام', 'No clash: the rooms are free on these days')}</p>
          ) : (
            <p className="small" style={{ color: 'var(--err)', margin: '6px 0' }}>⚠ {t('تعارض مع', 'Clash with')}: {clashWith.map((o) => `${o.group_name} (${fmtDate(o.from_day)} → ${fmtDate(o.to_day)})`).join('، ')}. {t('غيّر التواريخ أو الغرف، واتصل بصاحب الطلب.', 'Change the dates or the rooms, and call the person who asked.')}</p>
          )}
          <div className="row" style={{ gap: 6 }}>
            {conflicts.length === 0 && roomsOf(b.id) && <button className="btn primary small" onClick={() => void confirm(b)}>{t('أكّد', 'Confirm')}</button>}
            <button className="btn small" onClick={() => onChange(b)}>{t('غيّر التواريخ أو الغرف', 'Change dates or rooms')}</button>
            <button className="btn ghost small" title={t('يبقى «للتأكيد» ويختفي من هنا', 'It stays "to confirm" and leaves this list')} onClick={() => void keepOption(b)}>{t('أبقِه للتأكيد', 'Keep as "to confirm"')}</button>
          </div>
        </div>
      ))}
      <div className="modal-foot"><button className="btn" onClick={onClose}>{t('إغلاق', 'Close')}</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------- the busiest months and days (a dynamic view)

/** the months as bars (choose what they show), the busiest marked; click a month: its days, the busiest days, the weekday pattern */
function BusyView({ r, onOpen }: { r: ReturnType<typeof report>; onOpen: (b: HostBooking) => void }) {
  const [metric, setMetric] = useState<'bed' | 'people' | 'bookings'>('bed');
  const [sel, setSel] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const value = (m: (typeof r.months)[number]) => (metric === 'bed' ? m.bedPct : metric === 'people' ? m.personNights : m.bookings);
  const label = (v: number) => (metric === 'bed' ? `${v}%` : String(v));
  const max = Math.max(0, ...r.months.map(value));
  const busiest = max > 0 ? r.months.find((m) => value(m) === max) : null;
  const ranked = [...r.months].filter((m) => value(m) > 0).sort((x, y) => value(y) - value(x)).slice(0, 3);
  const days = sel ? r.days.filter((x) => x.day.startsWith(sel)) : r.days;
  const heat = (x: (typeof r.days)[number]) => (x.bedPct > 0 ? `color-mix(in srgb, var(--centre) ${Math.round(20 + Math.min(100, x.bedPct) * 0.8)}%, #fff)` : x.events ? 'color-mix(in srgb, var(--brand-2) 12%, #fff)' : undefined);
  const top = [...days].filter((x) => x.stays + x.events > 0).sort((x, y) => y.bedPct - x.bedPct || y.people - x.people || y.events - x.events).slice(0, 5);
  const wmax = Math.max(0, ...(sel ? [0, 1, 2, 3, 4, 5, 6].map((w) => { const xs = days.filter((x) => x.weekday === w); return xs.length ? xs.reduce((n, x) => n + x.bedPct, 0) / xs.length : 0; }) : r.weekdays.map((w) => w.bedPct)));
  const wday = [0, 1, 2, 3, 4, 5, 6].map((w) => { const xs = days.filter((x) => x.weekday === w); return { w, pct: xs.length ? Math.round((xs.reduce((n, x) => n + x.bedPct, 0) / xs.length) * 10) / 10 : 0, busy: xs.filter((x) => x.stays + x.events > 0).length }; });
  const lead = sel ? new Date(`${sel}-01T00:00:00Z`).getUTCDay() : 0;
  const picked = day ? r.days.find((x) => x.day === day) : null;
  return (
    <>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{t('الأشهر الأكثر ازدحاماً', 'Busiest months')}</h3>
        <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
          <option value="bed">{t('إشغال الأسرّة %', 'Bed occupancy %')}</option><option value="people">{t('شخص-ليلة', 'Person-nights')}</option><option value="bookings">{t('عدد الحجوزات', 'Number of bookings')}</option>
        </select>
        {sel && <button className="btn ghost small" onClick={() => { setSel(null); setDay(null); }}>✕ {monthName(sel)}</button>}
      </div>
      {busiest ? <p className="small">★ {t('الأكثر ازدحاماً', 'Busiest')}: <b>{monthName(busiest.month)}</b> ({label(value(busiest))}){ranked.length > 1 && <> · {ranked.slice(1).map((m) => `${monthName(m.month).replace(/\s?\d{4}/, '')} ${label(value(m))}`).join(' · ')}</>}. {t('اضغط شهراً لترى أيامه.', 'Click a month to see its days.')}</p> : <p className="muted small">{t('لا شيء في هذه الفترة', 'Nothing in this period')}</p>}
      <div className="host-bars">
        {r.months.map((m) => {
          const v = value(m);
          return (
            <button key={m.month} type="button" className={`host-bar2 ${sel === m.month ? 'on' : ''} ${busiest?.month === m.month ? 'top' : ''}`} onClick={() => { setSel(sel === m.month ? null : m.month); setDay(null); }} title={`${monthName(m.month)}: ${label(v)}`}>
              <small>{v ? label(v) : ''}</small>
              <i style={{ height: `${max ? Math.max(v ? 4 : 0, (v / max) * 100) : 0}%` }} />
              <span>{busiest?.month === m.month ? '★ ' : ''}{monthName(m.month).replace(/\s?\d{4}/, '').slice(0, 3)}</span>
            </button>
          );
        })}
      </div>
      {sel && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{monthName(sel)}</h3>
          <div className="host-month host-heat">
            {Array.from({ length: 7 }, (_, i) => <div key={i} className="host-mh">{weekday(i)}</div>)}
            {[...Array<null>(lead).fill(null), ...days].map((x, i) => x ? (
              <div key={x.day} className={`host-md ${day === x.day ? 'sel' : ''}`} style={{ background: heat(x), minHeight: 54 }} onClick={() => setDay(day === x.day ? null : x.day)} title={x.groups.map((g) => g.group_name).join('، ')}>
                <div className="host-mn"><b>{Number(x.day.slice(8))}</b>{x.bedPct > 0 && <small>{x.bedPct}%</small>}</div>
                <small>{x.people ? `${x.people} ${t('شخص', 'p.')}` : ''}{x.events ? ` ▸${x.events}` : ''}</small>
              </div>
            ) : <div key={`o${i}`} className="host-md off" />)}
          </div>
          {picked && (
            <p className="small"><b>{fmtDate(picked.day)}</b>: {picked.groups.length ? picked.groups.map((g) => <button key={g.id} type="button" className="btn ghost small" onClick={() => onOpen(g)}>{g.kind === 'event' ? '▸ ' : ''}{g.group_name} ({g.people})</button>) : t('لا أحد', 'nobody')}</p>
          )}
        </div>
      )}
      <div className="host-two">
        <div>
          <h4>{t('أكثر الأيام ازدحاماً', 'Busiest days')}{sel ? ` · ${monthName(sel)}` : ''}</h4>
          <table className="t small"><tbody>
            {top.map((x) => <tr key={x.day} style={{ cursor: 'pointer' }} onClick={() => { setSel(x.day.slice(0, 7)); setDay(x.day); }}><td>{weekday(x.weekday)} {fmtDate(x.day)}</td><td className="n">{x.bedPct ? `${x.bedPct}%` : ''}</td><td className="n">{x.people ? `${x.people} ${t('شخص', 'people')}` : ''}</td><td>{x.events ? `▸ ${x.events} ${t('نشاط', 'event(s)')}` : ''}</td><td className="muted">{x.groups.slice(0, 3).map((g) => g.group_name).join('، ')}</td></tr>)}
            {!top.length && <tr><td className="muted">—</td></tr>}
          </tbody></table>
        </div>
        <div>
          <h4>{t('الأسبوع: متوسط الإشغال لكل يوم', 'Week: average occupancy by weekday')}{sel ? ` · ${monthName(sel)}` : ''}</h4>
          <div className="host-wd">
            {wday.map((w) => (
              <div key={w.w} title={`${weekday(w.w)}: ${w.pct}% · ${w.busy} ${t('يوماً مشغولاً', 'busy days')}`}>
                <small>{w.pct ? `${w.pct}%` : ''}</small>
                <i style={{ height: `${wmax ? Math.max(w.pct ? 4 : 0, (w.pct / wmax) * 100) : 0}%` }} />
                <span>{weekday(w.w)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="tbl-wrap"><table className="t small"><thead><tr><th>{t('الشهر', 'Month')}</th><th className="n">{t('حجوزات', 'Bookings')}</th><th className="n">{t('ليالٍ', 'Nights')}</th><th className="n">{t('شخص-ليلة', 'Person-nights')}</th><th className="n">{t('أيام أنشطة', 'Event days')}</th><th className="n">{t('إشغال الأسرّة', 'Bed %')}</th></tr></thead>
        <tbody>{r.months.map((m) => <tr key={m.month} style={{ cursor: 'pointer' }} onClick={() => { setSel(m.month); setDay(null); }}><td>{busiest?.month === m.month ? '★ ' : ''}{monthName(m.month)}</td><td className="n">{m.bookings || ''}</td><td className="n">{m.nights || ''}</td><td className="n">{m.personNights || ''}</td><td className="n">{m.eventDays || ''}</td><td className="n">{m.bedPct ? `${m.bedPct}%` : ''}</td></tr>)}</tbody></table></div>
    </>
  );
}

// ---------------------------------------------------------------- equipment: what is asked for, day by day, against what the inventory holds

function EquipmentTab({ data, onOpen }: { data: HostData; onOpen: (b: HostBooking) => void }) {
  const [from, setFrom] = useState(todayIso());
  const [span, setSpan] = useState(14);
  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(from, i)), [from, span]);
  const rows = useMemo(() => equipmentLoad(data, days[0], days[days.length - 1]).filter((r) => r.equip.active || r.days.size > 0), [data, days]);
  const today = todayIso();
  const over = rows.flatMap((r) => [...r.days].filter(([, x]) => x.wanted > r.equip.total).map(([day, x]) => ({ equip: r.equip, day, ...x }))).sort((a, b) => a.day.localeCompare(b.day));
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <button className="btn small" onClick={() => setFrom(addDays(from, -7))}>‹</button>
        <button className="btn small" onClick={() => setFrom(today)}>{t('اليوم', 'Today')}</button>
        <button className="btn small" onClick={() => setFrom(addDays(from, 7))}>›</button>
        <input className="inp" type="date" style={{ width: 150 }} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <select value={span} onChange={(e) => setSpan(Number(e.target.value))}><option value={7}>{t('أسبوع', '1 week')}</option><option value={14}>{t('أسبوعان', '2 weeks')}</option><option value={31}>{t('شهر', '1 month')}</option></select>
      </div>
      <p className="small muted">{t('كل خانة: كم مطلوب في ذلك اليوم من كل التجهيزات، مقابل ما في الجرد (الأغراض قيد الاستعمال وبحالة جيدة). أحمر = المطلوب أكثر من الموجود.', 'Each cell: how many are asked for that day, against what the inventory holds (items in use and in good condition). Red = more asked for than exist.')}</p>
      {rows.length === 0 ? <p className="muted">{t('لا تجهيزات بعد: يختارها من يمسك التقويم من الجرد في «المباني والغرف».', 'No equipment yet: whoever keeps the calendar chooses it from the inventory in "Buildings and rooms".')}</p> : (
        <div className="tbl-wrap host-wrap">
          <table className="host-grid">
            <thead><tr><th className="host-room">{t('التجهيز', 'Equipment')}</th>{days.map((dy) => <th key={dy} className={dy === today ? 'today' : dy.slice(8) === '01' ? 'first' : ''}><small>{dayShort(dy)}</small><br />{dy.slice(8)}{dy.slice(8) === '01' ? <small>/{dy.slice(5, 7)}</small> : null}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.equip.id}>
                  <th className="host-room">{r.equip.name}<small> · {r.equip.total}</small></th>
                  {days.map((dy) => {
                    const x = r.days.get(dy);
                    if (!x) return <td key={dy} />;
                    const cls = x.wanted > r.equip.total ? 'over' : x.wanted === r.equip.total ? 'full' : 'ok';
                    return <td key={dy} className={`host-eq ${cls}`} title={x.bookings.map((b) => `${b.group_name} (${data.needs.find((n) => n.booking_id === b.id && n.equip_id === r.equip.id)?.qty})`).join('\n')} onClick={() => onOpen(x.bookings[0])}>{x.wanted}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {over.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--err)', marginTop: 12 }}>
          <b>⚠ {t('أيام لا تكفي فيها التجهيزات', 'Days when the equipment is not enough')}</b>
          <table className="t small"><tbody>
            {over.map((x) => (
              <tr key={`${x.equip.id}-${x.day}`}>
                <td>{fmtDate(x.day)}</td><td>{x.equip.name}</td><td className="n">{x.wanted} / {x.equip.total}</td>
                <td>{x.bookings.map((b) => <button key={b.id} type="button" className="btn ghost small" onClick={() => onOpen(b)}>{b.group_name} ({data.needs.find((n) => n.booking_id === b.id && n.equip_id === x.equip.id)?.qty}){b.status === 'option' ? ` · ${t('للتأكيد', 'to confirm')}` : ''}</button>)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- reports

/** accommodation and events over a period: totals, months, buildings, and how many bookings each group and each person made */
function ReportTab({ data, onOpen }: { data: HostData; onOpen: (b: HostBooking) => void }) {
  const { s } = useApp();
  const year = todayIso().slice(0, 4);
  const [preset, setPreset] = useState<'year' | 'last' | 'all' | 'custom'>('year');
  const [custom, setCustom] = useState({ from: `${year}-01-01`, to: `${year}-12-31` });
  const [kind, setKind] = useState<BookingKind | 'all'>('all');
  const [withOptions, setWithOptions] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const span = useMemo(() => {
    if (preset === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
    if (preset === 'last') return { from: `${Number(year) - 1}-01-01`, to: `${Number(year) - 1}-12-31` };
    if (preset === 'all') {
      const live = data.bookings.filter((b) => b.status !== 'cancelled');
      return { from: live.map((b) => b.from_day).sort()[0] ?? `${year}-01-01`, to: live.map((b) => b.to_day).sort().reverse()[0] ?? `${year}-12-31` };
    }
    return custom;
  }, [preset, custom, data.bookings, year]);
  const opts = { ...span, kind, withOptions };
  const r = useMemo(() => report(data, opts), [data, span.from, span.to, kind, withOptions]); // eslint-disable-line react-hooks/exhaustive-deps
  const sm = r.summary;
  const groups = r.groups.filter((g) => !q.trim() || `${g.name} ${[...g.contacts].join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
  const people = r.people.filter((p) => !q.trim() || `${p.name} ${[...p.groups].join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
  const exportXlsx = async () => {
    try { await saveFile(`hosting_${span.from}_${span.to}.xlsx`, ['xlsx'], await hostWorkbook(data, opts, s.organisation ?? ''), t('احفظ التقرير', 'Save the report')); } catch (e) { toast(errText(e), true); }
  };
  const card = (label: string, v: React.ReactNode, sub?: React.ReactNode) => <div className="panel host-card"><small className="muted">{label}</small><b>{v}</b>{sub && <small>{sub}</small>}</div>;
  const bookingsOf = (ids: number[]) => data.bookings.filter((b) => ids.includes(b.id));
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}>
          <option value="year">{t('هذه السنة', 'This year')}</option><option value="last">{t('السنة الماضية', 'Last year')}</option><option value="all">{t('كل المدة', 'All time')}</option><option value="custom">{t('فترة محددة', 'Choose the dates')}</option>
        </select>
        {preset === 'custom' && <><input className="inp" type="date" style={{ width: 150 }} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /><input className="inp" type="date" style={{ width: 150 }} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></>}
        <select value={kind} onChange={(e) => setKind(e.target.value as BookingKind | 'all')}><option value="all">{t('إقامة وأنشطة', 'Accommodation and events')}</option><option value="stay">{t('إقامة', 'Accommodation')}</option><option value="event">{t('أنشطة', 'Events')}</option></select>
        <label className="small"><input type="checkbox" checked={withOptions} onChange={(e) => setWithOptions(e.target.checked)} /> {t('مع «للتأكيد»', 'Include "to confirm"')}</label>
        <input className="inp" style={{ width: 180 }} placeholder={t('بحث في المجموعات والأشخاص', 'Search groups and people')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn small" onClick={() => void exportXlsx()}>Excel</button>
      </div>
      <p className="small muted">{fmtDate(span.from)} → {fmtDate(span.to)} · {withOptions ? t('المؤكَّد والوصول والمغادرة و«للتأكيد»', 'confirmed, arrived, left and to confirm') : t('المؤكَّد والوصول والمغادرة', 'confirmed, arrived and left')}</p>
      <div className="host-cards">
        {card(t('الحجوزات', 'Bookings'), sm.bookings, `${sm.stays} ${t('إقامة', 'stays')} · ${sm.events} ${t('أنشطة', 'events')}`)}
        {card(t('المجموعات', 'Groups'), sm.groups, sm.cancelled ? `${sm.cancelled} ${t('ملغاة', 'cancelled')}` : undefined)}
        {kind !== 'event' && card(t('الليالي', 'Nights'), sm.nights, `${sm.personNights} ${t('شخص-ليلة', 'person-nights')} · ${sm.people} ${t('شخصاً', 'people')}`)}
        {kind !== 'event' && card(t('إشغال الأسرّة', 'Bed occupancy'), `${sm.bed.pct}%`, `${sm.bed.used} / ${sm.bed.avail} ${t('سرير-ليلة', 'bed-nights')}`)}
        {kind !== 'stay' && card(t('أيام الأنشطة', 'Event days'), sm.eventDays, `${t('استعمال القاعات', 'hall use')} ${sm.hall.pct}%`)}
        {data.prices && card(t('المتفق عليه', 'Agreed'), fmtTotals(sm.amounts.agreed), `${t('المقبوض في الفترة', 'received in the period')}: ${fmtTotals(sm.amounts.paid)}`)}
      </div>

      <BusyView r={r} onOpen={onOpen} />

      <h3>{t('حسب المبنى', 'By building')}</h3>
      <div className="tbl-wrap"><table className="t small"><thead><tr><th>{t('المبنى', 'Building')}</th><th className="n">{t('حجوزات', 'Bookings')}</th><th className="n">{t('سرير-ليلة', 'Bed-nights')}</th><th className="n">{t('إشغال الأسرّة', 'Bed %')}</th><th className="n">{t('أيام القاعات', 'Hall days')}</th></tr></thead>
        <tbody>{r.buildings.map((b) => <tr key={b.id}><td><i className="host-sw-big" style={{ background: colorOf(data.buildings, b.id) }} />{b.name}</td><td className="n">{b.bookings || ''}</td><td className="n">{b.bedNights || ''}</td><td className="n">{b.bedPct ? `${b.bedPct}%` : ''}</td><td className="n">{b.hallDays || ''}</td></tr>)}</tbody></table></div>

      <h3>{t('المجموعات', 'Groups')} <small className="muted">({groups.length})</small></h3>
      <div className="tbl-wrap"><table className="t small"><thead><tr><th>{t('المجموعة', 'Group')}</th><th className="n">{t('حجوزات', 'Bookings')}</th><th className="n">{t('إقامة', 'Stays')}</th><th className="n">{t('أنشطة', 'Events')}</th><th className="n">{t('شخص-ليلة', 'Person-nights')}</th><th>{t('الأشخاص المسؤولون', 'People in charge')}</th><th>{t('آخر زيارة', 'Last')}</th>{data.prices && <th className="n">{t('المتفق عليه', 'Agreed')}</th>}</tr></thead>
        <tbody>
          {groups.map((g) => {
            const key = `g:${nameKey(g.name)}`;
            return (
              <Fragment key={key}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === key ? null : key)}>
                  <td><b>{open === key ? '▾' : '▸'} {g.name}</b></td><td className="n">{g.bookings}</td><td className="n">{g.stays || ''}</td><td className="n">{g.events || ''}</td><td className="n">{g.personNights || ''}</td><td>{[...g.contacts].join('، ')} {g.phone ? <small dir="ltr" className="muted">{g.phone}</small> : null}</td><td>{fmtDate(g.last)}</td>{data.prices && <td className="n">{fmtTotals(g.amounts.agreed)}</td>}
                </tr>
                {open === key && bookingsOf(g.ids).map((b) => <tr key={`${key}-${b.id}`} className="host-sub" onClick={() => onOpen(b)}><td colSpan={data.prices ? 8 : 7}>{b.code} · {b.kind === 'event' ? t('نشاط', 'event') : t('إقامة', 'stay')} · {fmtDate(b.from_day)} → {fmtDate(b.to_day)} · {b.people} {t('شخص', 'people')} · <span className={`host-badge ${b.status}`}>{STATUS_LABEL[b.status]()}</span></td></tr>)}
              </Fragment>
            );
          })}
          {!groups.length && <tr><td colSpan={8} className="muted">{t('لا شيء في هذه الفترة', 'Nothing in this period')}</td></tr>}
        </tbody></table></div>

      <h3>{t('الأشخاص المسؤولون', 'People in charge')} <small className="muted">({people.length})</small></h3>
      <div className="tbl-wrap"><table className="t small"><thead><tr><th>{t('الشخص', 'Person')}</th><th>{t('الهاتف', 'Phone')}</th><th className="n">{t('حجوزات', 'Bookings')}</th><th>{t('المجموعات', 'Groups')}</th><th>{t('آخر حجز', 'Last')}</th></tr></thead>
        <tbody>
          {people.map((p) => <tr key={p.name}><td><b>{p.name}</b></td><td dir="ltr">{p.phone}</td><td className="n">{p.bookings}</td><td>{[...p.groups].join('، ')}</td><td>{fmtDate(p.last)}</td></tr>)}
          {!people.length && <tr><td colSpan={5} className="muted">{t('لا شيء في هذه الفترة', 'Nothing in this period')}</td></tr>}
        </tbody></table></div>
    </>
  );
}

// ---------------------------------------------------------------- payments: suggestions of entries

function PaymentsTab({ data, refresh }: { data: HostData; refresh: () => Promise<void> }) {
  const { s, can } = useApp();
  // only someone who writes entries can make one; the others see where each payment stands
  const writes = can('register.edit') || can('register.main') || can('book.own');
  const nav = useNav();
  const [show, setShow] = useState<'todo' | 'all'>('todo');
  const rows = data.pays.map((p) => ({ p, b: data.bookings.find((x) => x.id === p.booking_id), state: p.status === 'refused' ? 'refused' : data.entered.includes(p.receipt_no) ? 'entered' : 'todo' as const }))
    .filter((r) => show === 'all' || r.state === 'todo');
  // money received → an income; money given back after a cancellation (calendar step 4) → an expense
  const makeEntry = (p: (typeof data.pays)[number], b?: HostBooking) => nav.entry({
    preset: true, type: p.kind === 'back' ? 'Exp' : 'Income', date: p.paid_on,
    prefill: { amount: p.amount, currency: p.currency, explanation: `${p.kind === 'back' ? 'Given back · مُعاد: ' : ''}${b?.group_name ?? ''} · ${b?.code ?? ''}`.trim(), receipt: p.receipt_no },
  });
  const refuse = async (id: number, on: boolean) => {
    try { await s.api.call('host.pay.refuse', { id, on }); await refresh(); } catch (e) { toast(errText(e), true); }
  };
  return (
    <>
      <p className="small muted">{t('كل دفعة تُسجَّل على حجز هي «اقتراح قيد». المحاسب يجعلها قيد دخل في السجل (يختار الدفتر والبند)، أو يرفضها. رقم الوصل يُكتب على القيد فيرتبط بالدفعة.', 'Each payment recorded on a booking is a suggestion of an entry. The accountant makes it an Income entry in the register (choosing the book and the line) or refuses it. The receipt number goes on the entry, which is how the two are linked.')}</p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <select value={show} onChange={(e) => setShow(e.target.value as 'todo' | 'all')}><option value="todo">{t('تنتظر القيد', 'Waiting for an entry')}</option><option value="all">{t('الكل', 'All')}</option></select>
      </div>
      <div className="tbl-wrap"><table className="t small">
        <thead><tr><th>{t('الوصل', 'Receipt')}</th><th>{t('التاريخ', 'Date')}</th><th>{t('الحجز', 'Booking')}</th><th className="n">{t('المبلغ', 'Amount')}</th><th>{t('الحالة', 'State')}</th><th /></tr></thead>
        <tbody>
          {rows.map(({ p, b, state }) => (
            <tr key={p.id}>
              <td>{p.receipt_no}{p.kind === 'back' && <small className="muted"> · {t('مُعاد', 'given back')}</small>}</td><td>{fmtDate(p.paid_on)}</td><td>{b?.group_name} <small className="muted">{b?.code}</small></td><td className="n">{money(p.amount, p.currency)}</td>
              <td>{state === 'entered' ? `✓ ${t('قيد في السجل', 'entered')}` : state === 'refused' ? t('مرفوضة', 'refused') : t('تنتظر', 'waiting')}</td>
              <td>
                {state === 'todo' && <>{writes && <button className="btn primary small" onClick={() => makeEntry(p, b)}>{t('اجعلها قيداً', 'Make the entry')}</button>} <button className="btn ghost small" onClick={() => void refuse(p.id, true)}>{t('ارفض', 'Refuse')}</button></>}
                {state === 'refused' && <button className="btn ghost small" onClick={() => void refuse(p.id, false)}>{t('أعدها', 'Restore')}</button>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="muted">{t('لا دفعات', 'No payments')}</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

// ---------------------------------------------------------------- buildings, rooms, services

function SettingsTab({ data, refresh }: { data: HostData; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const [room, setRoom] = useState<{ id?: number; building_id: number; name: string; beds: string; capacity: string; kind_id: number | null; active: boolean } | null>(null);
  const [kindForm, setKindForm] = useState<{ id?: number; name: string; sleeps: boolean; active: boolean; used: boolean } | null>(null);
  // the equipment that bookings may ask for: names chosen from the inventory
  const [invNames, setInvNames] = useState<{ name: string; total: number; good: number }[]>([]);
  const [pick, setPick] = useState('');
  useEffect(() => { void s.api.call('host.equip.options').then(setInvNames).catch(() => setInvNames([])); }, [s, data.equip.length]);
  const firstKind = (sleeps: boolean) => data.kinds.find((k) => k.active && !!k.sleeps === sleeps)?.id ?? null;
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await refresh(); } catch (e) { toast(errText(e), true); } };
  const addBuilding = async () => {
    const n = await promptBox(t('اسم المبنى', 'Name of the building'));
    if (n?.trim()) await act(() => s.api.call('host.building.save', { name: n }));
  };
  const rename = async (id: number, old: string, active: boolean) => {
    const n = await promptBox(t('اسم المبنى', 'Name of the building'), old);
    if (n?.trim()) await act(() => s.api.call('host.building.save', { id, name: n, active }));
  };
  const addService = async () => {
    const n = await promptBox(t('اسم الخدمة (وجبة، استراحة، تدفئة…)', 'Name of the service (a meal, a break, heating…)'));
    if (n?.trim()) await act(() => s.api.call('host.service.save', { name: n }));
  };
  return (
    <>
      <div className="panel">
        <h3 style={{ margin: 0 }}>{t('التجهيزات التي يمكن طلبها', 'Equipment a booking can ask for')}</h3>
        <p className="small muted">{t('تُختار من أسماء الأغراض في الجرد (جهاز عرض، سبّورة، مكبّرات صوت، كراسٍ…). عددها يُحسب من الجرد (الأغراض قيد الاستعمال وبحالة جيدة)، فإن طلبت حجوزات متزامنة أكثر منه يُنبَّه إلى ذلك قبل أن يقع.', 'Chosen from the names of the items in the inventory (video projector, whiteboard, speakers, chairs…). How many exist is counted live from the inventory (items in use and in good condition): when overlapping bookings ask for more, the program warns before it happens.')}</p>
        <table className="t small"><tbody>
          {data.equip.map((e) => (
            <tr key={e.id} style={{ opacity: e.active ? 1 : 0.5 }}><td>{e.name}</td><td className="n">{e.total} {t('في الجرد', 'in the inventory')}</td>
              <td><button className="btn ghost small" onClick={() => void act(() => s.api.call('host.equip.save', { id: e.id, active: !e.active }))}>{e.active ? t('أوقف', 'Switch off') : t('أعد', 'Switch on')}</button></td></tr>
          ))}
        </tbody></table>
        <div className="row" style={{ gap: 6, marginTop: 6, alignItems: 'center' }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t('اختر غرضاً من الجرد…', 'Choose an item of the inventory…')}</option>
            {invNames.filter((x) => !data.equip.some((e) => e.name.toLowerCase() === x.name.trim().toLowerCase())).map((x) => <option key={x.name} value={x.name}>{x.name} ({x.good}{x.good !== x.total ? ` / ${x.total}` : ''})</option>)}
          </select>
          <button className="btn small" disabled={!pick} onClick={() => void act(async () => { await s.api.call('host.equip.save', { name: pick }); setPick(''); })}>＋ {t('أضف', 'Add')}</button>
        </div>
        {!invNames.length && <p className="small muted">{t('الجرد فارغ: سجّل الأغراض فيه أولاً.', 'The inventory is empty: list the items there first.')}</p>}
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ margin: 0 }}>{t('أنواع الغرف', 'Kinds of room')}</h3><button className="btn small" onClick={() => setKindForm({ name: '', sleeps: false, active: true, used: false })}>＋ {t('نوع', 'Kind')}</button></div>
        <p className="small muted">{t('نوع «فيه أسرّة» تُحسب فيه الأسرّة (غرفة نوم)؛ والأنواع الأخرى (قاعة، صف…) لها سعة: أكبر عدد من الأشخاص.', 'A kind "with beds" counts beds (a bedroom); the others (hall, classroom…) have a capacity: the most people they hold.')}</p>
        <table className="t small"><tbody>
          {data.kinds.map((k) => (
            <tr key={k.id} style={{ opacity: k.active ? 1 : 0.5 }}><td>{biName(k.name)}</td><td>{k.sleeps ? t('فيه أسرّة', 'with beds') : t('سعة (أشخاص)', 'capacity (people)')}</td><td>{data.rooms.filter((r) => r.kind_id === k.id).length} {t('غرفة', 'room(s)')}</td>
              <td><button className="btn ghost small" onClick={() => setKindForm({ id: k.id, name: k.name, sleeps: !!k.sleeps, active: !!k.active, used: data.rooms.some((r) => r.kind_id === k.id) })}>{t('عدّل', 'Edit')}</button></td></tr>
          ))}
        </tbody></table>
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ margin: 0 }}>{t('المباني والغرف', 'Buildings and rooms')}</h3><button className="btn primary small" onClick={() => void addBuilding()}>＋ {t('مبنى', 'Building')}</button></div>
        <p className="small muted">{t('كل غرفة هي أيضاً «مكان» في الجرد، فتُسجَّل فيها الأغراض.', 'Each room is also a "place" of the inventory, so the things in it are listed there.')}</p>
        {data.buildings.map((b) => (
          <div key={b.id} style={{ marginBottom: 10 }}>
            <i className="host-sw-big" style={{ background: colorOf(data.buildings, b.id) }} />
            <b>{b.name}{b.active ? '' : ' ✕'}</b>
            <input type="color" className="host-color" title={t('لون المبنى في التقويم', 'Colour of the building on the calendar')} value={colorOf(data.buildings, b.id)} onChange={(e) => void act(() => s.api.call('host.building.save', { id: b.id, name: b.name, active: !!b.active, color: e.target.value }))} />
            {PALETTE.map((c) => <button key={c} type="button" className="host-pal" style={{ background: c }} aria-label={c} onClick={() => void act(() => s.api.call('host.building.save', { id: b.id, name: b.name, active: !!b.active, color: c }))} />)}
            <button className="btn ghost small" onClick={() => void rename(b.id, b.name, b.active === 1)}>{t('اسم', 'Rename')}</button>
            <button className="btn ghost small" onClick={() => void act(() => s.api.call('host.building.save', { id: b.id, name: b.name, active: !b.active }))}>{b.active ? t('أوقف', 'Switch off') : t('أعد', 'Switch on')}</button>
            <button className="btn small" onClick={() => setRoom({ building_id: b.id, name: '', beds: '2', capacity: '', kind_id: firstKind(true), active: true })}>＋ {t('غرفة', 'Room')}</button>
            <table className="t small"><tbody>
              {data.rooms.filter((r) => r.building_id === b.id).map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td>{r.name}</td><td>{kindName(data, r)}</td><td className="n">{r.kind === 'bedroom' ? `${r.beds} ${t('سرير', 'beds')}` : r.capacity ? `${t('حتى', 'up to')} ${r.capacity} ${t('شخصاً', 'people')}` : ''}</td><td className="small muted">{r.kind === 'bedroom' ? '' : assetsOf(data, r).length ? `🎛 ${assetText(assetsOf(data, r))}` : t('لا أغراض في الجرد', 'nothing in the inventory yet')}</td>
                  <td><button className="btn ghost small" onClick={() => setRoom({ id: r.id, building_id: r.building_id, name: r.name, beds: String(r.beds), capacity: String(r.capacity || ''), kind_id: r.kind_id, active: !!r.active })}>{t('عدّل', 'Edit')}</button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
        {!data.buildings.length && <p className="muted">{t('ابدأ بإضافة مبنى.', 'Start by adding a building.')}</p>}
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ margin: 0 }}>{t('الخدمات', 'Services')}</h3><button className="btn small" onClick={() => void addService()}>＋ {t('خدمة', 'Service')}</button></div>
        <p className="small muted">{t('وجبات واستراحات وتجهيزات وتدفئة…: تُضاف إلى الحجز بمبلغها المتفق عليه.', 'Meals, breaks, logistics, heating…: added to a booking with their agreed amount.')}</p>
        <table className="t small"><tbody>
          {data.services.map((x) => (
            <tr key={x.id} style={{ opacity: x.active ? 1 : 0.5 }}><td>{x.name}</td>
              <td><button className="btn ghost small" onClick={async () => { const n = await promptBox(t('الاسم', 'Name'), x.name); if (n?.trim()) await act(() => s.api.call('host.service.save', { id: x.id, name: n, active: !!x.active })); }}>{t('اسم', 'Rename')}</button>
                <button className="btn ghost small" onClick={() => void act(() => s.api.call('host.service.save', { id: x.id, name: x.name, active: !x.active }))}>{x.active ? t('أوقف', 'Switch off') : t('أعد', 'Switch on')}</button></td></tr>
          ))}
        </tbody></table>
      </div>
      {kindForm && (
        <Modal title={kindForm.id ? t('نوع غرفة', 'Kind of room') : t('نوع جديد', 'New kind of room')} onClose={() => setKindForm(null)} narrow>
          <Field label={t('الاسم (عربي · English)', 'Name (Arabic · English)')}><input className="inp" autoFocus value={kindForm.name} onChange={(e) => setKindForm({ ...kindForm, name: e.target.value })} /></Field>
          <label className="small" style={{ display: 'block', margin: '6px 0' }}><input type="checkbox" disabled={kindForm.used} checked={kindForm.sleeps} onChange={(e) => setKindForm({ ...kindForm, sleeps: e.target.checked })} /> {t('فيه أسرّة (ينام فيه أشخاص)', 'Has beds (people sleep there)')}{kindForm.used ? ` — ${t('مستعمل في غرف: لا يتغيّر', 'used by rooms: it cannot change')}` : ''}</label>
          {kindForm.id && <label className="small" style={{ display: 'block' }}><input type="checkbox" checked={kindForm.active} onChange={(e) => setKindForm({ ...kindForm, active: e.target.checked })} /> {t('قيد الاستعمال', 'In use')}</label>}
          <div className="modal-foot">
            <button className="btn" onClick={() => setKindForm(null)}>{t('إلغاء', 'Cancel')}</button>
            <button className="btn primary" disabled={!kindForm.name.trim()} onClick={() => void act(async () => { await s.api.call('host.kind.save', { id: kindForm.id, name: kindForm.name, sleeps: kindForm.sleeps, active: kindForm.active }); setKindForm(null); })}>{t('احفظ', 'Save')}</button>
          </div>
        </Modal>
      )}
      {room && (
        <Modal title={room.id ? t('غرفة', 'Room') : t('غرفة جديدة', 'New room')} onClose={() => setRoom(null)} narrow>
          <Field label={t('الاسم', 'Name')}><input className="inp" autoFocus value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} /></Field>
          <Field label={t('النوع', 'Kind')}>
            <select value={room.kind_id ?? ''} onChange={(e) => setRoom({ ...room, kind_id: Number(e.target.value) || null })}>
              {data.kinds.filter((k) => k.active || k.id === room.kind_id).map((k) => <option key={k.id} value={k.id}>{biName(k.name)}{k.sleeps ? ` · ${t('فيه أسرّة', 'with beds')}` : ''}</option>)}
            </select>
          </Field>
          {data.kinds.find((k) => k.id === room.kind_id)?.sleeps
            ? <Field label={t('عدد الأسرّة', 'Number of beds')}><input className="inp" type="number" min={0} value={room.beds} onChange={(e) => setRoom({ ...room, beds: e.target.value })} /></Field>
            : <>
                <Field label={t('السعة: أكبر عدد من الأشخاص', 'Capacity: the most people it holds')}><input className="inp" type="number" min={0} value={room.capacity} onChange={(e) => setRoom({ ...room, capacity: e.target.value })} /></Field>
                <p className="small muted">🎛 {t('ما فيها من تجهيزات (جهاز عرض، صوت، ميكروفونات، كراسٍ…) يأتي من الجرد: سجّلها في مكان «', 'What it holds (projector, sound system, microphones, chairs…) comes from the Inventory: list the items in the place "')}{data.buildings.find((x) => x.id === room.building_id)?.name} · {room.name || '…'}{t('».', '".')}</p>
              </>}
          {room.id && <label className="small"><input type="checkbox" checked={room.active} onChange={(e) => setRoom({ ...room, active: e.target.checked })} /> {t('قيد الاستعمال', 'In use')}</label>}
          <div className="modal-foot">
            <button className="btn" onClick={() => setRoom(null)}>{t('إلغاء', 'Cancel')}</button>
            <button className="btn primary" disabled={!room.name.trim()} onClick={() => void act(async () => { await s.api.call('host.room.save', { ...room, beds: Number(room.beds) || 0, capacity: Number(room.capacity) || 0 }); setRoom(null); })}>{t('احفظ', 'Save')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
