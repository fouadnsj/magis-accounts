// Accommodation and events (Fouad, 22 November 2026): "Rooms by day" — the rooms of the centre's buildings down the page,
// the days across, a coloured cell for each booking. Four tabs: the calendar; the bookings; the payments (suggestions of
// entries, for whoever keeps the calendar); and the buildings, rooms and services. A booking made on a phone with no
// connection waits for a look in a window that shows what it runs into.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { Field, Modal, Select, Tabs, confirmBox, errText, fmtDate, fmtUsd, promptBox, t, toast, todayIso } from './kit';
import { GuideLink } from '../guide/GuideView';
import { useNav } from './Shell';
import {
  addDays, addMonths, bookingTotals, capacity, clashing, colorOf, conflictsOf, daysInMonth, dueOf, heldDays, nightsOf, occupancy, PALETTE, stayAmount, takenOn, toReview,
  type BookingKind, type BookingStatus, type Currency, type HostBooking, type HostData, type HostRoom, type Totals,
} from '../hosting/host';

type Tab = 'calendar' | 'bookings' | 'payments' | 'settings';

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
const roomName = (d: HostData, r: HostRoom) => `${d.buildings.find((b) => b.id === r.building_id)?.name ?? ''} · ${r.name}`;
const phoneLink = (p: string | null) => (p ? <a href={`tel:${p.replace(/\s/g, '')}`} dir="ltr">{p}</a> : null);

export function Hosting() {
  const { s, can, d, reload } = useApp();
  const keeps = can('hosting.keep');
  const books = can('hosting.book') || keeps;
  const [tab, setTab] = useState<Tab>('calendar');
  const [data, setData] = useState<HostData | null>(null);
  const [edit, setEdit] = useState<{ booking: HostBooking | null; room?: number; day?: string } | null>(null);
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
        { value: 'payments', label: `${t('الدفعات', 'Payments')}${toEnter ? ` (${toEnter})` : ''}`, hidden: !keeps },
        { value: 'settings', label: t('المباني والغرف', 'Buildings and rooms'), hidden: !keeps },
      ]} />
      {!data ? <p className="muted">…</p> : (
        <>
          {waiting.length > 0 && books && (
            <div className="panel" style={{ borderColor: 'var(--warn, #c9a227)' }}>
              <b>{waiting.length}</b> {t('حجز من الهاتف ينتظر نظرة', 'booking(s) made on a phone wait for a look')} <button className="btn small" onClick={() => setReview(true)}>{t('انظر', 'Look')}</button>
            </div>
          )}
          {tab === 'calendar' && <CalendarTab data={data} books={books} onOpen={(b) => setEdit({ booking: b })} onNew={(room, day) => setEdit({ booking: null, room, day })} />}
          {tab === 'bookings' && <BookingsTab data={data} books={books} onOpen={(b) => setEdit({ booking: b })} onNew={() => setEdit({ booking: null })} />}
          {tab === 'payments' && keeps && <PaymentsTab data={data} refresh={both} />}
          {tab === 'settings' && keeps && <SettingsTab data={data} refresh={both} />}
          {edit && <BookingEditor data={data} start={edit} onClose={() => setEdit(null)} refresh={both} />}
          {review && waiting.length > 0 && <ReviewBox data={data} onClose={() => setReview(false)} refresh={both} onChange={(b) => { setReview(false); setEdit({ booking: b }); }} />}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- the calendar: rooms by day, by month, by year

type View = 'rooms' | 'month' | 'year';

function CalendarTab({ data, books, onOpen, onNew }: { data: HostData; books: boolean; onOpen: (b: HostBooking) => void; onNew: (room: number, day: string) => void }) {
  const [view, setView] = useState<View>('rooms');
  const [from, setFrom] = useState(todayIso());
  const [span, setSpan] = useState(14);
  const [building, setBuilding] = useState<number | null>(null);
  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(from, i)), [from, span]);
  const rooms = data.rooms.filter((r) => r.active && (building == null || r.building_id === building));
  const today = todayIso();
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
        <Select value={building} options={data.buildings.filter((b) => b.active).map((b) => ({ value: b.id, label: b.name }))} onChange={setBuilding} placeholder={t('كل المباني', 'All buildings')} />
        {books && <button className="btn primary small" onClick={() => onNew(0, view === 'rooms' ? from : today)}>＋ {t('حجز', 'Booking')}</button>}
      </div>
      <div className="host-key small">
        {data.buildings.filter((b) => b.active).map((b) => <span key={b.id} className="host-sw"><i style={{ background: colorOf(data.buildings, b.id) }} />{b.name}</span>)}
        <span className="host-cell option" style={{ ['--hc' as string]: '#888' }}>{t('للتأكيد', 'To confirm')}</span><span className="host-cell confirmed" style={{ ['--hc' as string]: '#555' }}>{t('مؤكَّد', 'Confirmed')}</span>
        <span className="host-cell arrived" style={{ ['--hc' as string]: '#555' }}>{t('وصلوا', 'Arrived')}</span><span className="host-cell left">{t('غادروا', 'Left')}</span><span className="host-cell clash">{t('تداخل', 'Clash')}</span>
      </div>
      {view === 'rooms' && (rooms.length === 0 ? <p className="muted">{t('لا غرف بعد: أضفها في «المباني والغرف».', 'No rooms yet: add them in "Buildings and rooms".')}</p> : (
        <div className="tbl-wrap host-wrap">
          <table className="host-grid">
            <thead>
              <tr>
                <th className="host-room">{t('الغرفة', 'Room')}</th>
                {days.map((dy) => <th key={dy} className={dy === today ? 'today' : dy.slice(8) === '01' ? 'first' : ''}><small>{dayShort(dy)}</small><br />{dy.slice(8)}{dy.slice(8) === '01' ? <small>/{dy.slice(5, 7)}</small> : null}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.buildings.filter((b) => rooms.some((r) => r.building_id === b.id)).map((b) => (
                <BuildingRows key={b.id} data={data} building={b.id} rooms={rooms.filter((r) => r.building_id === b.id)} days={days} books={books} onOpen={onOpen} onNew={onNew} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {view === 'month' && <MonthView data={data} month={from.slice(0, 7)} rooms={rooms} onDay={(d) => pick(d, 'rooms')} onOpen={onOpen} />}
      {view === 'year' && <YearView data={data} year={from.slice(0, 4)} rooms={rooms} onMonth={(ym) => pick(`${ym}-01`, 'month')} />}
    </>
  );
}

function BuildingRows({ data, building, rooms, days, books, onOpen, onNew }: { data: HostData; building: number; rooms: HostRoom[]; days: string[]; books: boolean; onOpen: (b: HostBooking) => void; onNew: (room: number, day: string) => void }) {
  const color = colorOf(data.buildings, building);
  const name = data.buildings.find((b) => b.id === building)?.name ?? '';
  return (
    <>
      <tr className="host-building"><td colSpan={days.length + 1} style={{ borderInlineStart: `6px solid ${color}` }}>{name}</td></tr>
      {rooms.map((r) => (
        <tr key={r.id}>
          <th className="host-room" style={{ borderInlineStart: `6px solid ${color}` }}>{r.name}{r.kind === 'bedroom' ? <small> · {r.beds}</small> : r.kind === 'hall' ? <small> · {t('قاعة', 'hall')}</small> : null}</th>
          {days.map((dy) => {
            const taken = takenOn(r, dy, data.bookings, data.allocs);
            const beds = taken.reduce((n, x) => n + x.beds, 0);
            if (!taken.length) return <td key={dy} className="host-free" onClick={() => books && onNew(r.id, dy)} />;
            const first = taken[0].booking;
            const cls = beds > capacity(r) ? 'clash' : first.status;
            const label = taken.length > 1 ? `${taken.length}` : first.group_name.slice(0, 8);
            const tip = taken.map((x) => `${x.booking.group_name}${x.booking.time_from ? ` ${x.booking.time_from}–${x.booking.time_to ?? ''}` : ''} · ${STATUS_LABEL[x.booking.status]()}${r.beds > 1 ? ` · ${x.beds}/${r.beds}` : ''}`).join('\n');
            return <td key={dy} className={`host-cell ${cls}`} style={{ ['--hc' as string]: color }} title={tip} onClick={() => onOpen(first)}>{cls === 'arrived' ? '✓ ' : ''}{label}{r.beds > 1 && taken.length === 1 ? <small> {taken[0].beds}</small> : null}</td>;
          })}
        </tr>
      ))}
    </>
  );
}

/** a month: each day with how full the rooms are and the groups present; a click opens the rooms of that week */
function MonthView({ data, month, rooms, onDay, onOpen }: { data: HostData; month: string; rooms: HostRoom[]; onDay: (d: string) => void; onOpen: (b: HostBooking) => void }) {
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
          <div key={d} className={`host-md ${d === today ? 'today' : ''}`} onClick={() => onDay(d)}>
            <div className="host-mn"><b>{Number(d.slice(8))}</b>{pct > 0 && <small>{pct}%</small>}</div>
            <div className="host-bar"><i style={{ width: `${pct}%` }} /></div>
            {groups.slice(0, 3).map((g) => <span key={g.id} className={`host-chip ${g.status}`} style={{ ['--hc' as string]: firstBuilding(g) }} onClick={(e) => { e.stopPropagation(); onOpen(g); }} title={g.group_name}>{g.kind === 'event' ? '▸ ' : ''}{g.group_name}</span>)}
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
  const [q, setQ] = useState('');
  const list = data.bookings.filter((b) => (st === 'all' ? b.status !== 'cancelled' || false : b.status === st) && (!q.trim() || `${b.group_name} ${b.contact ?? ''} ${b.code}`.toLowerCase().includes(q.trim().toLowerCase())));
  const sorted = [...list].sort((a, b) => b.from_day.localeCompare(a.from_day));
  const names = (id: number) => data.allocs.filter((a) => a.booking_id === id).map((a) => { const r = data.rooms.find((x) => x.id === a.room_id); return r ? roomName(data, r) : ''; }).join('، ');
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <select value={st} onChange={(e) => setSt(e.target.value as BookingStatus | 'all')}>
          <option value="all">{t('الكل (من دون الملغى)', 'All (not cancelled)')}</option>
          {(['option', 'confirmed', 'arrived', 'left', 'cancelled'] as BookingStatus[]).map((x) => <option key={x} value={x}>{STATUS_LABEL[x]()}</option>)}
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
                <td>{b.code}{b.review ? ' 📱' : ''}</td><td><b>{b.group_name}</b>{b.kind === 'event' ? <small> · {t('نشاط', 'event')}</small> : null}</td>
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

// ---------------------------------------------------------------- one booking

interface Line { id?: number; service_id: number | null; label: string; qty: string; amount: string; currency: Currency }

function BookingEditor({ data, start, onClose, refresh }: { data: HostData; start: { booking: HostBooking | null; room?: number; day?: string }; onClose: () => void; refresh: () => Promise<void> }) {
  const { s, can } = useApp();
  const keeps = can('hosting.keep');
  const b = start.booking;
  const [f, setF] = useState(() => ({
    kind: (b?.kind ?? 'stay') as BookingKind, group_name: b?.group_name ?? '', contact: b?.contact ?? '', phone: b?.phone ?? '', people: String(b?.people ?? ''),
    from_day: b?.from_day ?? start.day ?? todayIso(), to_day: b?.to_day ?? addDays(start.day ?? todayIso(), 1),
    price_mode: (b?.price_mode ?? 'person') as 'person' | 'group', rate: b?.rate != null ? String(b.rate) : '', currency: (b?.currency ?? 'USD') as Currency, note: b?.note ?? '', time_from: b?.time_from ?? '', time_to: b?.time_to ?? '',
  }));
  // an event may repeat every week on chosen weekdays between its first and last day (never a stay)
  const [rep, setRep] = useState<Set<number>>(() => new Set((b?.repeat_days ?? '').split(',').filter(Boolean).map(Number)));
  const [again, setAgain] = useState(!!b?.repeat_days);
  const [payForm, setPayForm] = useState<{ amount: string; currency: Currency; paid_on: string; method: string } | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [allocs, setAllocs] = useState<Map<number, number | null>>(() => {
    const m = new Map<number, number | null>();
    for (const a of data.allocs.filter((x) => x.booking_id === b?.id)) m.set(a.room_id, a.beds);
    if (!b && start.room) m.set(start.room, null);
    return m;
  });
  const [lines, setLines] = useState<Line[]>(() => data.lines.filter((l) => l.booking_id === b?.id).map((l) => ({ id: l.id, service_id: l.service_id, label: l.label, qty: String(l.qty), amount: String(l.amount), currency: l.currency })));
  const [busy, setBusy] = useState(false);
  const readOnly = !(can('hosting.book') || keeps);
  const people = Number(f.people) || 0;
  const repeatDays = f.kind === 'event' && again && rep.size ? [...rep].sort().join(',') : null;
  const hours = f.kind === 'event' ? { time_from: f.time_from || null, time_to: f.time_to || null } : { time_from: null, time_to: null };
  const probe = { id: b?.id ?? -1, kind: f.kind, from_day: f.from_day, to_day: f.to_day, repeat_days: repeatDays, ...hours };
  const asked = [...allocs].map(([room_id, beds]) => ({ booking_id: b?.id ?? -1, room_id, beds }));
  const dates = /^\d{4}-\d{2}-\d{2}$/.test(f.from_day) && /^\d{4}-\d{2}-\d{2}$/.test(f.to_day) && (f.kind === 'stay' ? f.to_day > f.from_day : f.to_day >= f.from_day);
  const clashes = dates ? conflictsOf(probe, asked, data, 'any') : [];
  const sure = dates ? conflictsOf(probe, asked, data, 'sure') : [];
  const by = (id: number) => data.bookings.find((x) => x.id === id)?.group_name ?? '';
  const priced = { kind: f.kind, from_day: f.from_day, to_day: f.to_day, repeat_days: repeatDays, people, price_mode: f.price_mode, rate: f.rate === '' ? null : Number(f.rate) };
  const total: Totals = dates && data.prices ? bookingTotals({ ...priced, currency: f.currency }, lines.map((l) => ({ amount: Number(l.amount) || 0, currency: l.currency }))) : { USD: 0, SYP: 0 };
  const pays = data.pays.filter((p) => p.booking_id === b?.id);
  const due = dueOf(total, pays);

  const body = () => ({
    id: b?.id, kind: f.kind, group_name: f.group_name, contact: f.contact, phone: f.phone, people, from_day: f.from_day, to_day: f.to_day, note: f.note, repeat_days: repeatDays ? repeatDays.split(',').map(Number) : null, ...hours,
    price_mode: f.rate === '' ? null : f.price_mode, rate: f.rate === '' ? null : Number(f.rate), currency: f.currency,
    allocs: [...allocs].map(([room_id, beds]) => ({ room_id, beds })),
    lines: lines.filter((l) => l.label.trim() || l.service_id).map((l) => ({ id: l.id, service_id: l.service_id, label: l.label, qty: Number(l.qty) || 1, amount: Number(l.amount) || 0, currency: l.currency })),
  });
  const save = async (status?: BookingStatus, reason?: string | null) => {
    setBusy(true);
    try {
      const r = await s.api.call('host.booking.save', body());
      if (status && status !== b?.status) await s.api.call('host.booking.status', { id: r.id, status, reason });
      await refresh();
      onClose();
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
      <div className="grid2">
        <Field label={t('النوع', 'Kind')}>
          <select value={f.kind} disabled={readOnly} onChange={(e) => set('kind', e.target.value as BookingKind)}>
            <option value="stay">{t('إقامة', 'Stay (nights)')}</option><option value="event">{t('نشاط في قاعة', 'Event in a hall (days)')}</option>
          </select>
        </Field>
        <Field label={t('المجموعة', 'Group')}><input className="inp" disabled={readOnly} value={f.group_name} onChange={(e) => set('group_name', e.target.value)} autoFocus={!b} /></Field>
        <Field label={t('الشخص للاتصال', 'Contact person')}><input className="inp" disabled={readOnly} value={f.contact} onChange={(e) => set('contact', e.target.value)} /></Field>
        <Field label={t('الهاتف', 'Phone')}><input className="inp" style={{ direction: 'ltr' }} disabled={readOnly} value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={f.kind === 'stay' ? t('الوصول', 'Arrival') : t('اليوم الأول', 'First day')}><input className="inp" type="date" disabled={readOnly} value={f.from_day} onChange={(e) => set('from_day', e.target.value)} /></Field>
        <Field label={f.kind === 'stay' ? t('المغادرة', 'Leaving') : t('اليوم الأخير', 'Last day')}><input className="inp" type="date" disabled={readOnly} value={f.to_day} onChange={(e) => set('to_day', e.target.value)} /></Field>
        {f.kind === 'event' && <Field label={t('من الساعة', 'From (hour)')}><input className="inp" type="time" disabled={readOnly} value={f.time_from} onChange={(e) => set('time_from', e.target.value)} /></Field>}
        {f.kind === 'event' && <Field label={t('إلى الساعة', 'To (hour)')}><input className="inp" type="time" disabled={readOnly} value={f.time_to} onChange={(e) => set('time_to', e.target.value)} /></Field>}
        <Field label={t('عدد الأشخاص', 'Number of people')}><input className="inp" type="number" min={0} disabled={readOnly} value={f.people} onChange={(e) => set('people', e.target.value)} /></Field>
        <Field label={t('ملاحظة', 'Note')}><input className="inp" disabled={readOnly} value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
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
                    <label><input type="checkbox" disabled={readOnly} checked={on} onChange={(e) => setAllocs((m) => { const n = new Map(m); if (e.target.checked) n.set(r.id, null); else n.delete(r.id); return n; })} /> {r.name} {r.beds ? <small>({r.beds} {t('سرير', 'beds')})</small> : <small>({t('قاعة', 'hall')})</small>}</label>
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
      {sure.length > 0 && <p className="small" style={{ color: 'var(--err)' }}>{t('لا يمكن التأكيد: الغرف محجوزة لمجموعة مؤكَّدة في هذه الأيام. غيّر التواريخ أو الغرف.', 'It cannot be confirmed: the rooms are taken by a confirmed group on these days. Change the dates or the rooms.')}</p>}

      <h3 style={{ margin: '10px 0 4px' }}>{t('الخدمات', 'Services')}</h3>
      {lines.map((l, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 4, alignItems: 'center' }}>
          <Select value={l.service_id} options={data.services.filter((x) => x.active || x.id === l.service_id).map((x) => ({ value: x.id, label: x.name }))} placeholder={t('خدمة…', 'Service…')} disabled={readOnly}
            onChange={(v) => setLines((xs) => xs.map((x, k) => (k === i ? { ...x, service_id: v, label: data.services.find((s2) => s2.id === v)?.name ?? x.label } : x)))} />
          <input className="inp" type="number" min={0} style={{ width: 70 }} title={t('الكمية', 'Quantity')} disabled={readOnly} value={l.qty} onChange={(e) => setLines((xs) => xs.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} />
          {data.prices && <input className="inp" inputMode="decimal" style={{ width: 90 }} title={t('المبلغ المتفق عليه', 'Agreed amount')} disabled={!keeps} value={l.amount} onChange={(e) => setLines((xs) => xs.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} />}
          {data.prices && <select style={{ width: 80 }} title={t('العملة', 'Currency')} disabled={!keeps} value={l.currency} onChange={(e) => setLines((xs) => xs.map((x, k) => (k === i ? { ...x, currency: e.target.value as Currency } : x)))}><option value="USD">USD</option><option value="SYP">SYP</option></select>}
          {!readOnly && <button className="btn ghost small" onClick={() => setLines((xs) => xs.filter((_, k) => k !== i))}>✕</button>}
        </div>
      ))}
      {!readOnly && <button className="btn small" onClick={() => setLines((xs) => [...xs, { service_id: null, label: '', qty: '1', amount: '0', currency: f.currency }])}>＋ {t('خدمة', 'Service')}</button>}

      {data.prices && (
        <>
          <h3 style={{ margin: '12px 0 4px' }}>{t('المبلغ المتفق عليه', 'Agreed amount')}</h3>
          <div className="grid2">
            <Field label={t('الحساب', 'Priced')}>
              <select value={f.price_mode} disabled={!keeps} onChange={(e) => set('price_mode', e.target.value as 'person' | 'group')}>
                <option value="person">{t('للشخص في الليلة', 'Per person per night')}</option><option value="group">{t('سعر ثابت للمجموعة', 'A fixed price for the group')}</option>
              </select>
            </Field>
            <Field label={f.price_mode === 'person' ? t('السعر للشخص/ليلة', 'Rate per person/night') : t('سعر المجموعة', 'Price of the group')}>
              <div className="row" style={{ gap: 6 }}>
                <input className="inp" inputMode="decimal" disabled={!keeps} value={f.rate} onChange={(e) => set('rate', e.target.value)} />
                <select value={f.currency} disabled={!keeps} onChange={(e) => set('currency', e.target.value as Currency)}><option value="USD">USD</option><option value="SYP">SYP</option></select>
              </div>
            </Field>
          </div>
          {dates && <p className="small">{f.kind === 'stay' ? t('الإقامة', 'Stay') : t('النشاط', 'Event')}: <b>{money(stayAmount(priced), f.currency)}</b> · {t('المجموع', 'Total')}: <b>{fmtTotals(total)}</b>{b && <> · {t('المتبقي', 'Due')}: <b>{fmtTotals(due)}</b></>}</p>}
          {b && pays.length > 0 && (
            <table className="t small"><tbody>
              {pays.map((p) => (
                <tr key={p.id}><td>{p.receipt_no}</td><td>{fmtDate(p.paid_on)}</td><td className="n">{money(p.amount, p.currency)}</td>
                  <td>{p.status === 'refused' ? t('مرفوضة', 'refused') : data.entered.includes(p.receipt_no) ? `✓ ${t('قيد', 'entered')}` : t('تنتظر المحاسب', 'waits for the accountant')}</td></tr>
              ))}
            </tbody></table>
          )}
          {b && keeps && <button className="btn small" onClick={() => addPay()}>＋ {t('دفعة مقبوضة', 'A payment received')}</button>}
        </>
      )}

      <div className="modal-foot" style={{ flexWrap: 'wrap' }}>
        {b && keeps && !pays.length && <button className="btn ghost" onClick={() => void remove()}>{t('حذف', 'Delete')}</button>}
        {b && b.status !== 'cancelled' && !readOnly && <button className="btn" onClick={() => void cancel()}>{t('إلغاء الحجز', 'Cancel the booking')}</button>}
        <button className="btn" onClick={onClose}>{t('إغلاق', 'Close')}</button>
        {!readOnly && <button className="btn" disabled={busy || !f.group_name.trim() || !dates} onClick={() => void save()}>{t('احفظ', 'Save')}</button>}
        {!readOnly && (!b || b.status === 'option') && <button className="btn primary" disabled={busy || !f.group_name.trim() || !dates || !allocs.size || sure.length > 0} onClick={() => void save('confirmed')}>{t('احفظ وأكّد', 'Save and confirm')}</button>}
        {!readOnly && b?.status === 'confirmed' && <button className="btn primary" disabled={busy} onClick={() => void save('arrived')}>{t('وصلوا', 'They arrived')}</button>}
        {!readOnly && b?.status === 'arrived' && <button className="btn primary" disabled={busy} onClick={() => void save('left')}>{t('غادروا', 'They left')}</button>}
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

// ---------------------------------------------------------------- payments: suggestions of entries

function PaymentsTab({ data, refresh }: { data: HostData; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const nav = useNav();
  const [show, setShow] = useState<'todo' | 'all'>('todo');
  const rows = data.pays.map((p) => ({ p, b: data.bookings.find((x) => x.id === p.booking_id), state: p.status === 'refused' ? 'refused' : data.entered.includes(p.receipt_no) ? 'entered' : 'todo' as const }))
    .filter((r) => show === 'all' || r.state === 'todo');
  const makeEntry = (p: (typeof data.pays)[number], b?: HostBooking) => nav.entry({
    preset: true, type: 'Income', date: p.paid_on,
    prefill: { amount: p.amount, currency: p.currency, explanation: `${b?.group_name ?? ''} · ${b?.code ?? ''}`.trim(), receipt: p.receipt_no },
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
              <td>{p.receipt_no}</td><td>{fmtDate(p.paid_on)}</td><td>{b?.group_name} <small className="muted">{b?.code}</small></td><td className="n">{money(p.amount, p.currency)}</td>
              <td>{state === 'entered' ? `✓ ${t('قيد في السجل', 'entered')}` : state === 'refused' ? t('مرفوضة', 'refused') : t('تنتظر', 'waiting')}</td>
              <td>
                {state === 'todo' && <><button className="btn primary small" onClick={() => makeEntry(p, b)}>{t('اجعلها قيداً', 'Make the entry')}</button> <button className="btn ghost small" onClick={() => void refuse(p.id, true)}>{t('ارفض', 'Refuse')}</button></>}
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
  const [room, setRoom] = useState<{ id?: number; building_id: number; name: string; beds: string; kind: string; active: boolean } | null>(null);
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
            <button className="btn small" onClick={() => setRoom({ building_id: b.id, name: '', beds: '2', kind: 'bedroom', active: true })}>＋ {t('غرفة', 'Room')}</button>
            <table className="t small"><tbody>
              {data.rooms.filter((r) => r.building_id === b.id).map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td>{r.name}</td><td>{r.kind === 'hall' ? t('قاعة', 'Hall') : r.kind === 'other' ? t('أخرى', 'Other') : t('غرفة نوم', 'Bedroom')}</td><td className="n">{r.beds || ''} {r.beds ? t('سرير', 'beds') : ''}</td>
                  <td><button className="btn ghost small" onClick={() => setRoom({ id: r.id, building_id: r.building_id, name: r.name, beds: String(r.beds), kind: r.kind, active: !!r.active })}>{t('عدّل', 'Edit')}</button></td>
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
      {room && (
        <Modal title={room.id ? t('غرفة', 'Room') : t('غرفة جديدة', 'New room')} onClose={() => setRoom(null)} narrow>
          <Field label={t('الاسم', 'Name')}><input className="inp" autoFocus value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} /></Field>
          <Field label={t('النوع', 'Kind')}>
            <select value={room.kind} onChange={(e) => setRoom({ ...room, kind: e.target.value })}><option value="bedroom">{t('غرفة نوم', 'Bedroom')}</option><option value="hall">{t('قاعة', 'Hall')}</option><option value="other">{t('أخرى', 'Other')}</option></select>
          </Field>
          <Field label={t('عدد الأسرّة', 'Number of beds')}><input className="inp" type="number" min={0} value={room.beds} onChange={(e) => setRoom({ ...room, beds: e.target.value })} /></Field>
          {room.id && <label className="small"><input type="checkbox" checked={room.active} onChange={(e) => setRoom({ ...room, active: e.target.checked })} /> {t('قيد الاستعمال', 'In use')}</label>}
          <div className="modal-foot">
            <button className="btn" onClick={() => setRoom(null)}>{t('إلغاء', 'Cancel')}</button>
            <button className="btn primary" disabled={!room.name.trim()} onClick={() => void act(async () => { await s.api.call('host.room.save', { ...room, beds: Number(room.beds) || 0 }); setRoom(null); })}>{t('احفظ', 'Save')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
