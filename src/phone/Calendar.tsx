// The calendar on the phone (Fouad, 22 November 2026): the rooms by day, kept on the phone so it can be read with no
// connection — "is there room on the 14th?" while someone is calling. A booking made here with no connection is always
// "to confirm": it is kept on the phone and sent with the next sync, and the server checks the rooms again. When the
// phone is connected again a window shows each booking sent: confirm it if the rooms are free; if they are taken, change
// the dates or the rooms — and call the person who asked. The phone never has an amount.
import { useEffect, useMemo, useState } from 'react';
import { kvGet, kvSet, newId, type Msg, type Pack } from './store';
import { addDays, addMonths, capacity, clashing, colorOf, conflictsOf, daysInMonth, knownNames, live, nameKey, occupancy, takenOn, type HostAlloc, type HostBooking, type HostRoom } from '../hosting/host';

type Tr = (ar: string, en: string, fr: string) => string;
type HostPackT = NonNullable<Pack['host']>;

export interface HostNew {
  key: string;
  booking: { kind: 'stay' | 'event'; group_name: string; contact: string | null; phone: string | null; people: number; from_day: string; to_day: string; note: string | null; allocs: { room_id: number; beds: number | null }[] };
  state: 'waiting' | 'sent' | 'fix';
  error?: Msg | null;
  made_at: string;
  /** the number the server gave it */
  id?: number | null;
}
export const hostNews = async () => (await kvGet<HostNew[]>('host-new')) ?? [];
export const putHostNews = (x: HostNew[]) => kvSet('host-new', x);

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** the bookings of the pack, and the ones made here and not yet sent (they hold their rooms on the screen, as "to confirm") */
function merged(pack: HostPackT, waiting: HostNew[]) {
  const bookings: HostBooking[] = pack.bookings.map((b) => ({ ...b, repeat_days: b.repeat_days ?? null, time_from: b.time_from ?? null, time_to: b.time_to ?? null, price_mode: null, rate: null, currency: 'USD', note: null, cancel_reason: null, source: 'desk', client_ref: null, created_by: null, created_at: '', updated_at: null }) as HostBooking);
  const allocs: HostAlloc[] = [...pack.allocs];
  let n = 0;
  for (const w of waiting) {
    const id = -(++n);
    bookings.push({ id, code: '📱', kind: w.booking.kind, status: 'option', group_name: w.booking.group_name, contact: w.booking.contact, phone: w.booking.phone, people: w.booking.people, from_day: w.booking.from_day, to_day: w.booking.to_day, repeat_days: null, time_from: null, time_to: null, price_mode: null, rate: null, currency: 'USD', note: w.booking.note, cancel_reason: null, source: 'phone', review: 1, client_ref: w.key, created_by: null, created_at: w.made_at, updated_at: null });
    for (const a of w.booking.allocs) allocs.push({ booking_id: id, room_id: a.room_id, beds: a.beds });
  }
  return { bookings, allocs, rooms: pack.rooms.map((r) => ({ ...r, active: 1, sort: 0, place_id: null }) as HostRoom) };
}

const phoneLink = (p: string | null) => (p ? <a href={`tel:${p.replace(/\s/g, '')}`} dir="ltr">{p}</a> : null);

export function CalendarPage({ pack, tr: t, onClose }: { pack: Pack; tr: Tr; onClose: (saved: boolean) => void }) {
  const host = pack.host!;
  const [from, setFrom] = useState(today());
  const [news, setNews] = useState<HostNew[] | null>(null);
  const [form, setForm] = useState<{ room?: number; day?: string } | null>(null);
  const [view, setView] = useState<HostBooking | null>(null);
  const [building, setBuilding] = useState<number | null>(null);
  // today, the week, or the month (the day view answers "is there room today?")
  const [mode, setMode] = useState<'day' | 'week' | 'month'>('day');
  const reload = () => void hostNews().then(setNews);
  useEffect(reload, []);
  const waiting = (news ?? []).filter((x) => x.state !== 'sent');
  const data = useMemo(() => merged(host, waiting), [host, news]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const rooms = data.rooms.filter((r) => building == null || r.building_id === building);
  // (every hook stays above the early returns below: opening a booking must not change their number)
  const occ = useMemo(() => occupancy(data, new Set(rooms.map((r) => r.id))), [data, rooms]); // eslint-disable-line react-hooks/exhaustive-deps
  const bName = (id: number) => host.buildings.find((b) => b.id === id)?.name ?? '';
  const roomsOf = (id: number) => data.allocs.filter((a) => a.booking_id === id).map((a) => { const r = data.rooms.find((x) => x.id === a.room_id); return r ? `${bName(r.building_id)} · ${r.name}` : ''; }).join('، ');
  const STATUS: Record<string, string> = { option: t('للتأكيد', 'To confirm', 'À confirmer'), confirmed: t('مؤكَّد', 'Confirmed', 'Confirmée'), arrived: t('وصلوا', 'Arrived', 'Arrivés'), left: t('غادروا', 'Left', 'Partis'), cancelled: t('ملغى', 'Cancelled', 'Annulée') };

  if (form) return <BookingForm pack={pack} tr={t} start={form} waiting={waiting} onClose={(saved) => { setForm(null); reload(); if (saved) onClose(true); }} />;
  if (view) {
    return (
      <div className="ph-page">
        <header className="ph-top"><div><b>{view.group_name}</b><span>{view.code} · {STATUS[view.status]}</span></div><button className="ph-icon" onClick={() => setView(null)} aria-label="close">✕</button></header>
        <section className="ph-card">
          <div>{view.from_day} → {view.to_day} · {view.people} {t('شخص', 'people', 'personnes')}</div>
          <div className="ph-muted">{roomsOf(view.id)}</div>
          {(view.contact || view.phone) && <div>☎ {view.contact} {phoneLink(view.phone)}</div>}
          {view.id < 0 && <div className="ph-muted">📱 {t('لم يُرسل بعد: ينتظر الاتصال بالمركز', 'Not sent yet: it waits for the connection to the centre', 'Pas encore envoyée : elle attend la connexion au centre')}</div>}
        </section>
        <button className="ph-btn" onClick={() => setView(null)}>{t('رجوع', 'Back', 'Retour')}</button>
      </div>
    );
  }
  const step = (n: number) => setFrom(mode === 'day' ? addDays(from, n) : mode === 'week' ? addDays(from, 7 * n) : addMonths(from, n));
  const wd = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
  const wdLong = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const stays = data.bookings.filter((b) => live(b) && b.kind === 'stay');
  const arrivals = stays.filter((b) => b.from_day === from && data.allocs.some((a) => a.booking_id === b.id && rooms.some((r) => r.id === a.room_id)));
  const departures = stays.filter((b) => b.to_day === from && data.allocs.some((a) => a.booking_id === b.id && rooms.some((r) => r.id === a.room_id)));
  const usedToday = occ.days.get(from);
  const bookingChip = (b: HostBooking, extra?: string) => <button key={b.id} type="button" className={`ph-chip2 ${b.status}`} onClick={() => setView(b)}>{b.kind === 'event' ? '▸ ' : ''}{b.group_name}{b.people ? ` · ${b.people}` : ''}{extra ? ` · ${extra}` : ''}</button>;
  return (
    <div className="ph-page">
      <header className="ph-top"><div><b>📅 {t('التقويم', 'Calendar', 'Calendrier')}</b><span>{pack.organisation}</span></div><button className="ph-icon" onClick={() => onClose(false)} aria-label="close">✕</button></header>
      <div className="ph-seg">
        {(['day', 'week', 'month'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); if (m === 'day' && mode !== 'month') setFrom(today()); }}>{m === 'day' ? t('اليوم', 'Day', 'Jour') : m === 'week' ? t('أسبوع', 'Week', 'Semaine') : t('شهر', 'Month', 'Mois')}</button>)}
      </div>
      <div className="ph-chips">
        <button onClick={() => step(-1)}>‹</button>
        <button onClick={() => setFrom(today())}>{t('اليوم', 'Today', "Aujourd'hui")}</button>
        <button onClick={() => step(1)}>›</button>
        {host.buildings.length > 1 && host.buildings.map((b) => <button key={b.id} className={building === b.id ? 'on' : ''} onClick={() => setBuilding(building === b.id ? null : b.id)}>{b.name}</button>)}
      </div>

      {mode === 'day' && (
        <>
          <section className="ph-card">
            <b>{wdLong(from)}{from === today() ? ` · ${t('اليوم', 'today', "aujourd'hui")}` : ''}</b>
            <span className="ph-muted">{usedToday ? `${usedToday.used} / ${occ.total} ${t('سرير مشغول', 'beds taken', 'lits pris')} · ${usedToday.groups.length} ${t('حجز', 'booking(s)', 'réservation(s)')}` : `0 / ${occ.total} ${t('سرير مشغول', 'beds taken', 'lits pris')}`}</span>
            {arrivals.length > 0 && <div><small className="ph-muted">{t('يصلون اليوم', 'Arriving', 'Arrivées')}</small><div className="ph-chip-row">{arrivals.map((b) => bookingChip(b))}</div></div>}
            {departures.length > 0 && <div><small className="ph-muted">{t('يغادرون اليوم', 'Leaving', 'Départs')}</small><div className="ph-chip-row">{departures.map((b) => bookingChip(b))}</div></div>}
          </section>
          {host.buildings.filter((b) => rooms.some((r) => r.building_id === b.id)).map((b) => (
            <section key={b.id} className="ph-card" style={{ borderInlineStart: `5px solid ${colorOf(host.buildings, b.id)}` }}>
              <b>{b.name}</b>
              {rooms.filter((r) => r.building_id === b.id).map((r) => {
                const taken = takenOn(r, from, data.bookings, data.allocs);
                const beds = taken.reduce((n, x) => n + x.beds, 0);
                return (
                  <div key={r.id} className="ph-room">
                    <span className="ph-room-name">{r.name}{r.beds > 0 ? <small> · {beds}/{r.beds}</small> : r.capacity ? <small> · {r.capacity}</small> : null}</span>
                    {taken.length ? <span className="ph-chip-row">{taken.map((x) => bookingChip(x.booking, r.beds > 1 ? `${x.beds}` : undefined))}</span>
                      : <button type="button" className="ph-free" disabled={!host.book} onClick={() => setForm({ room: r.id, day: from })}>{t('حرّة', 'free', 'libre')}{host.book ? ' ＋' : ''}</button>}
                  </div>
                );
              })}
            </section>
          ))}
          {!rooms.length && <div className="ph-card ph-muted">{t('لا غرف', 'No rooms', 'Aucune chambre')}</div>}
        </>
      )}

      {mode === 'week' && (
        <div className="ph-cal">
          <table>
            <thead><tr><th>{t('الغرفة', 'Room', 'Chambre')}</th>{days.map((d) => <th key={d} className={d === today() ? 'today' : ''} onClick={() => { setFrom(d); setMode('day'); }}><small>{wd(d)}</small><br />{d.slice(8)}</th>)}</tr></thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <th style={{ borderInlineStart: `5px solid ${colorOf(host.buildings, r.building_id)}` }}>{r.name}{r.beds > 0 ? <small> · {r.beds}</small> : r.capacity ? <small> · {r.capacity}</small> : null}</th>
                  {days.map((d) => {
                    const taken = takenOn(r, d, data.bookings, data.allocs);
                    if (!taken.length) return <td key={d} className="free" onClick={() => host.book && setForm({ room: r.id, day: d })} />;
                    const beds = taken.reduce((n, x) => n + x.beds, 0);
                    const first = taken[0].booking;
                    return <td key={d} className={beds > capacity(r) ? 'clash' : first.status} style={{ ['--hc' as string]: colorOf(host.buildings, r.building_id) }} onClick={() => setView(first)}>{taken.length > 1 ? taken.length : first.group_name.slice(0, 5)}</td>;
                  })}
                </tr>
              ))}
              {!rooms.length && <tr><td colSpan={8} className="ph-muted">{t('لا غرف', 'No rooms', 'Aucune chambre')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {mode === 'month' && (() => {
        const ym = from.slice(0, 7);
        const lead = new Date(`${ym}-01T00:00:00Z`).getUTCDay();
        const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: daysInMonth(ym) }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)];
        return (
          <section className="ph-card">
            <b>{monthLabel(ym)}</b>
            <div className="ph-month">
              {Array.from({ length: 7 }, (_, i) => <div key={i} className="ph-mh">{wd(`2026-11-${String(22 + i)}`).slice(0, 2)}</div>)}
              {cells.map((d, i) => {
                if (!d) return <div key={`o${i}`} className="ph-md off" />;
                const o = occ.days.get(d);
                const pct = o && occ.total ? Math.min(100, Math.round((o.used / occ.total) * 100)) : 0;
                return (
                  <button key={d} type="button" className={`ph-md ${d === today() ? 'today' : ''}`} onClick={() => { setFrom(d); setMode('day'); }} style={o ? { background: `color-mix(in srgb, var(--navy) ${Math.round(14 + pct * 0.6)}%, #fff)`, color: pct > 45 ? '#fff' : undefined } : undefined}>
                    <b>{Number(d.slice(8))}</b>
                    <small>{o ? o.groups.length : ''}</small>
                  </button>
                );
              })}
            </div>
            <p className="ph-muted">{t('الرقم الصغير = عدد الحجوزات، واللون = امتلاء الأسرّة. اضغط يوماً لتراه.', 'The small number = bookings, the colour = how full the beds are. Tap a day to see it.', 'Le petit nombre = réservations, la couleur = lits pris. Touchez un jour pour le voir.')}</p>
          </section>
        );
      })()}
      <p className="ph-muted">{t('كما في آخر مزامنة', 'as of the last sync', 'à la dernière synchronisation')}{mode === 'week' ? ` · ${t('المخطَّط = للتأكيد', 'hatched = to confirm', 'hachuré = à confirmer')}` : ''}</p>
      {host.book && <button className="ph-btn gold" onClick={() => setForm(mode === 'month' ? {} : { day: from })}>＋ {t('حجز', 'A booking', 'Une réservation')}</button>}
      {waiting.length > 0 && (
        <section className="ph-card">
          <b>{t('حجوزات في الهاتف', 'Bookings on this phone', 'Réservations sur ce téléphone')}</b>
          {waiting.map((w) => (
            <div key={w.key} className="ph-row">
              <span>{w.booking.group_name} · {w.booking.from_day} → {w.booking.to_day}</span>
              <small>{w.state === 'fix' ? `⚠ ${(w.error?.en ?? '')}` : `📱 ${t('ينتظر الإرسال', 'waiting to be sent', 'en attente')}`}</small>
              <button className="ph-btn danger" onClick={async () => { if (window.confirm(t('احذف هذا الحجز؟', 'Delete this booking?', 'Supprimer cette réservation ?'))) { await putHostNews((await hostNews()).filter((x) => x.key !== w.key)); reload(); } }}>{t('احذف', 'Delete', 'Supprimer')}</button>
            </div>
          ))}
        </section>
      )}
      <button className="ph-btn" onClick={() => onClose(false)}>{t('رجوع', 'Back', 'Retour')}</button>
    </div>
  );
}

/** A booking: new (kept on the phone, "to confirm") or changed (the phone is connected: it goes straight to the centre). */
export function BookingForm({ pack, tr: t, start, waiting, editing, onSave, onClose }: {
  pack: Pack; tr: Tr; start: { room?: number; day?: string }; waiting: HostNew[]; editing?: HostBooking;
  onSave?: (b: HostNew['booking']) => Promise<void>; onClose: (saved: boolean) => void;
}) {
  const host = pack.host!;
  const d0 = editing?.from_day ?? start.day ?? today();
  const [f, setF] = useState({ kind: (editing?.kind ?? 'stay') as 'stay' | 'event', group_name: editing?.group_name ?? '', contact: editing?.contact ?? '', phone: editing?.phone ?? '', people: String(editing?.people ?? ''), from_day: d0, to_day: editing?.to_day ?? addDays(d0, 1), note: '' });
  const [rooms, setRooms] = useState<Map<number, number | null>>(() => {
    const m = new Map<number, number | null>();
    if (editing) for (const a of host.allocs.filter((x) => x.booking_id === editing.id)) m.set(a.room_id, a.beds);
    else if (start.room) m.set(start.room, null);
    return m;
  });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const data = useMemo(() => merged(host, waiting), [host, waiting]);
  // the groups and people already known: complete the name, and fill the contact of a known group
  const known = useMemo(() => knownNames(data.bookings), [host]);
  const typeGroup = (v: string) => { const g = known.groups.get(nameKey(v)); setF((x) => ({ ...x, group_name: v, ...(!editing && g && !x.contact.trim() && !x.phone.trim() ? { contact: g.contact ?? '', phone: g.phone ?? '' } : {}) })); };
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(f.from_day) && /^\d{4}-\d{2}-\d{2}$/.test(f.to_day) && (f.kind === 'stay' ? f.to_day > f.from_day : f.to_day >= f.from_day);
  const probe = { id: editing?.id ?? -999, kind: f.kind, from_day: f.from_day, to_day: f.to_day };
  const asked = [...rooms].map(([room_id, beds]) => ({ booking_id: probe.id, room_id, beds }));
  const hit = ok ? conflictsOf(probe, asked, data, 'any') : [];
  const by = (id: number) => data.bookings.find((x) => x.id === id)?.group_name ?? '';

  const save = async () => {
    if (!f.group_name.trim()) return setNote(t('اكتب اسم المجموعة', 'Write the name of the group', 'Écrivez le nom du groupe'));
    if (!ok) return setNote(t('التواريخ غير صحيحة', 'The dates are not valid', 'Dates invalides'));
    const booking = { kind: f.kind, group_name: f.group_name.trim(), contact: f.contact.trim() || null, phone: f.phone.trim() || null, people: Math.max(0, Math.round(Number(f.people) || 0)), from_day: f.from_day, to_day: f.to_day, note: f.note.trim() || null, allocs: [...rooms].map(([room_id, beds]) => ({ room_id, beds })) };
    setBusy(true);
    try {
      if (onSave) await onSave(booking);
      else await putHostNews([...(await hostNews()), { key: newId(), booking, state: 'waiting', made_at: new Date().toISOString() }]);
      onClose(true);
    } catch (e) { setNote((e as { msg?: Msg }).msg?.en ?? (e as Error).message ?? 'Error'); setBusy(false); }
  };
  return (
    <div className="ph-page">
      <header className="ph-top"><div><b>{editing ? t('غيّر الحجز', 'Change the booking', 'Modifier la réservation') : t('حجز جديد', 'New booking', 'Nouvelle réservation')}</b><span>{pack.organisation}</span></div><button className="ph-icon" onClick={() => onClose(false)} aria-label="close">✕</button></header>
      <section className="ph-card">
        <label>{t('المجموعة', 'Group', 'Groupe')}<input list="ph-groups" value={f.group_name} onChange={(e) => typeGroup(e.target.value)} autoFocus /></label>
        <datalist id="ph-groups">{[...known.groups.values()].map((g) => <option key={g.name} value={g.name} />)}</datalist><datalist id="ph-people">{[...known.people.values()].map((p) => <option key={p.name} value={p.name} />)}</datalist>
        <label>{t('الشخص المسؤول', 'Person in charge', 'Responsable')}<input list="ph-people" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></label>
        <label>{t('الهاتف', 'Phone', 'Téléphone')}<input type="tel" className="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label>{t('النوع', 'Kind', 'Type')}<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'stay' | 'event' })}><option value="stay">{t('إقامة', 'Stay (nights)', 'Séjour (nuits)')}</option><option value="event">{t('نشاط في قاعة', 'Event in a hall (days)', 'Activité dans une salle (jours)')}</option></select></label>
        <label>{f.kind === 'stay' ? t('الوصول', 'Arrival', 'Arrivée') : t('اليوم الأول', 'First day', 'Premier jour')}<input type="date" value={f.from_day} onChange={(e) => setF({ ...f, from_day: e.target.value })} /></label>
        <label>{f.kind === 'stay' ? t('المغادرة', 'Leaving', 'Départ') : t('اليوم الأخير', 'Last day', 'Dernier jour')}<input type="date" value={f.to_day} onChange={(e) => setF({ ...f, to_day: e.target.value })} /></label>
        <label>{t('عدد الأشخاص', 'Number of people', 'Nombre de personnes')}<input type="number" inputMode="numeric" min={0} value={f.people} onChange={(e) => setF({ ...f, people: e.target.value })} /></label>
        <label>{t('ملاحظة', 'Note', 'Note')}<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      </section>
      <section className="ph-card">
        <b>{t('الغرف', 'Rooms', 'Chambres')}</b>
        {host.buildings.map((b) => (
          <div key={b.id}>
            <small className="ph-muted">{b.name}</small>
            {host.rooms.filter((r) => r.building_id === b.id).map((r) => {
              const on = rooms.has(r.id);
              const mine = hit.filter((c) => c.room_id === r.id);
              return (
                <div key={r.id} className="ph-pick">
                  <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={on} onChange={(e) => setRooms((m) => { const n = new Map(m); if (e.target.checked) n.set(r.id, null); else n.delete(r.id); return n; })} /> {r.name} <small>{r.beds ? `(${r.beds})` : r.capacity ? `(${r.capacity} ${t('شخصاً', 'people', 'pers.')})` : `(${t('قاعة', 'hall', 'salle')})`}</small></label>
                  {on && r.beds > 1 && f.kind === 'stay' && <input type="number" inputMode="numeric" min={1} max={r.beds} placeholder={t('كلها', 'all', 'tous')} style={{ width: 90 }} value={rooms.get(r.id) ?? ''} onChange={(e) => setRooms((m) => new Map(m).set(r.id, e.target.value === '' ? null : Number(e.target.value)))} />}
                  {on && mine.length > 0 && <small className="warn">⚠ {t('محجوزة', 'taken', 'prise')}: {[...new Set(clashing(mine))].map(by).join('، ')}</small>}
                </div>
              );
            })}
          </div>
        ))}
      </section>
      {!editing && <p className="ph-muted">{t('يبقى الحجز «للتأكيد» في الهاتف حتى يفحصه المركز عند الاتصال.', 'The booking stays "to confirm" on the phone until the centre checks it at the connection.', 'La réservation reste « à confirmer » sur le téléphone jusqu’à ce que le centre la vérifie à la connexion.')}</p>}
      {note && <div className="ph-alert">{note}</div>}
      <button className="ph-btn gold" disabled={busy} onClick={() => void save()}>{editing ? t('احفظ التغيير', 'Save the change', 'Enregistrer') : t('احفظ في الهاتف', 'Keep on the phone', 'Garder sur le téléphone')}</button>
      <button className="ph-btn" onClick={() => onClose(false)}>{t('إلغاء', 'Cancel', 'Annuler')}</button>
    </div>
  );
}

/**
 * The window after a connection: each booking just sent, with its status. Free rooms: confirm. Rooms taken: change the
 * dates or the rooms, and call the person who asked.
 */
export function HostReview({ pack, ids, tr: t, onConfirm, onChange, onClose }: {
  pack: Pack; ids: number[]; tr: Tr; onConfirm: (id: number) => Promise<void>; onChange: (id: number, b: HostNew['booking']) => Promise<void>; onClose: () => void;
}) {
  const host = pack.host!;
  const [changing, setChanging] = useState<HostBooking | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [err, setErr] = useState('');
  const data = useMemo(() => merged(host, []), [host]);
  const rows = ids.map((id) => data.bookings.find((b) => b.id === id)).filter((b): b is HostBooking => !!b && b.status === 'option');
  const roomsOf = (id: number) => data.allocs.filter((a) => a.booking_id === id).map((a) => data.rooms.find((x) => x.id === a.room_id)?.name ?? '').join('، ');
  if (changing) return <BookingForm pack={pack} tr={t} start={{}} waiting={[]} editing={changing} onSave={(b) => onChange(changing.id, b)} onClose={(saved) => { if (saved) setDone((x) => new Set(x).add(changing.id)); setChanging(null); }} />;
  return (
    <div className="ph-page">
      <header className="ph-top"><div><b>📅 {t('حجوزات أُرسلت', 'Bookings sent', 'Réservations envoyées')}</b><span>{pack.organisation}</span></div><button className="ph-icon" onClick={onClose} aria-label="close">✕</button></header>
      <p className="ph-muted">{t('هذه الحجوزات «للتأكيد» حتى تؤكّدها. أكّد ما لا تعارض فيه؛ وما فيه تعارض غيّر تاريخه أو غرفته، وتذكّر أن تتصل بصاحب الطلب.', 'These bookings are "to confirm" until you confirm them. Confirm those with no clash; for a clash change the dates or the rooms — and remember to call the person who asked.', 'Ces réservations sont « à confirmer » jusqu’à ce que vous les confirmiez. Confirmez celles sans conflit ; pour un conflit changez les dates ou les chambres — et pensez à appeler la personne qui a demandé.')}</p>
      {err && <div className="ph-alert">{err}</div>}
      {rows.length === 0 && <div className="ph-card">{t('لا شيء ينتظر', 'Nothing is waiting', 'Rien n’attend')} ✓</div>}
      {rows.map((b) => {
        const cs = conflictsOf(b, data.allocs.filter((a) => a.booking_id === b.id), data, 'sure');
        const clash = [...new Set(clashing(cs))].map((i) => data.bookings.find((x) => x.id === i)).filter((x): x is HostBooking => !!x);
        return (
          <section key={b.id} className="ph-card" style={cs.length ? { borderColor: '#c62828' } : undefined}>
            <b>{b.group_name}</b>
            <div>{b.from_day} → {b.to_day} · {b.people} {t('شخص', 'people', 'personnes')}</div>
            <div className="ph-muted">{roomsOf(b.id)}</div>
            {(b.contact || b.phone) && <div>☎ {b.contact} {phoneLink(b.phone)}</div>}
            {cs.length === 0
              ? <div style={{ color: '#2e7d32' }}>✓ {t('لا تعارض: الغرف حرّة', 'No clash: the rooms are free', 'Pas de conflit : les chambres sont libres')}</div>
              : <div className="warn">⚠ {t('تعارض مع', 'Clash with', 'Conflit avec')}: {clash.map((x) => `${x.group_name} (${x.from_day} → ${x.to_day})`).join('، ')}<br />{t('غيّر التواريخ أو الغرف، واتصل بصاحب الطلب.', 'Change the dates or the rooms, and call the person who asked.', 'Changez les dates ou les chambres, et appelez la personne qui a demandé.')}</div>}
            {cs.length === 0 && roomsOf(b.id) && <button className="ph-btn gold" onClick={async () => { try { await onConfirm(b.id); setDone((x) => new Set(x).add(b.id)); setErr(''); } catch (e) { setErr((e as { msg?: Msg }).msg?.en ?? (e as Error).message); } }}>{t('أكّد', 'Confirm', 'Confirmer')}</button>}
            <button className="ph-btn" onClick={() => setChanging(b)}>{t('غيّر التواريخ أو الغرف', 'Change dates or rooms', 'Changer dates ou chambres')}</button>
            {done.has(b.id) && <small className="ph-muted">✓</small>}
          </section>
        );
      })}
      <button className="ph-btn" onClick={onClose}>{t('تم', 'Done', 'Terminé')}</button>
    </div>
  );
}
