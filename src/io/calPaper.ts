// The calendar's printed pages (baseline 2.1, section 7, step 4): the booking sheet for the group (same look as the receipt,
// the two logos, no amounts for a free booking), the week of one hall (to put on its door), and a short page for a day or a
// week (for the reception or the guard). Arabic and English on every page. The data is already cut to what the person may
// see (forViewer): a private booking is "Reserved", contacts and amounts only for those who receive them.
import { addDays, type Currency, type Totals } from '../hosting/host';
import { calTotals, closedOn, occurrences, periodOn, received, seesPrices, stillDue, type CalBooking, type CalData } from '../hosting/calendar';
import { hm, itemsBetween, weekOf } from '../hosting/calview';
import { newCanvas, pdfDay, pdfMoney, type HouseLook } from './pdfCanvas';

const WD_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WD_AR = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
const wd = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
/** "Wednesday 25/11/2026 · الأربعاء" */
export const dayLine = (d: string) => `${WD_EN[wd(d)]} ${pdfDay(d)}  ·  ${WD_AR[wd(d)]}`;
const short = (d: string) => `${WD_EN[wd(d)].slice(0, 3)} ${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const totalsText = (t: Totals) => (['USD', 'SYP'] as Currency[]).filter((k) => t[k]).map((k) => pdfMoney(t[k], k)).join('  +  ') || '0';

const spaceNames = (d: CalData, b: CalBooking) => b.whole_centre ? 'The whole centre · المركز كله'
  : b.outside_place ? `Outside the centre · خارج المركز: ${b.outside_place}`
    : d.allocs.filter((a) => a.booking_id === b.id).map((a) => { const s = d.spaces.find((x) => x.id === a.room_id); const area = d.areas.find((x) => x.id === s?.building_id); return s ? `${s.name}${area ? ` (${area.name})` : ''}` : ''; }).filter(Boolean).join('  ·  ');
const hoursOf = (b: CalBooking) => (b.kind === 'stay' ? '' : b.time_from && b.time_to ? `${b.time_from} - ${b.time_to}` : 'The whole day · اليوم كله');
const nameOf = (b: CalBooking) => `${b.group_name}${b.subject ? `  ·  ${b.subject}` : ''}`;

// ------------------------------------------------------------------ the booking sheet for the group

export async function bookingSheetPdf(look: HouseLook, d: CalData, b: CalBooking, issuedOn: string): Promise<Uint8Array> {
  const c = await newCanvas(look, { title: `Booking ${b.code}` });
  const { W, M, put, wrap } = c;
  await c.head();
  put('BOOKING SHEET  ·  ورقة الحجز', M, c.y, 15, { bold: true, color: c.accent });
  put(`Ref · المرجع:  ${b.code}`, W - M, c.y + 8, 10, { align: 'right' });
  put(`Date · التاريخ:  ${pdfDay(issuedOn)}`, W - M, c.y - 6, 10, { align: 'right', color: c.muted });
  c.y -= 36;
  const status: Record<string, string> = { option: 'To confirm · للتأكيد', confirmed: 'Confirmed · مؤكَّد', arrived: 'Arrived · وصلوا', left: 'Left · غادروا', cancelled: 'Cancelled · ملغى' };
  const row = (label: string, value: string | null | undefined, size = 11, bold = false) => {
    if (!value) return;
    const ls = wrap(value, W - 2 * M - 150, size, bold);
    c.ensure(ls.length * (size + 3) + 8);
    put(label, M, c.y, 9, { bold: true, color: c.muted });
    ls.forEach((l, i) => put(l, M + 150, c.y - i * (size + 3), size, { bold }));
    c.y -= ls.length * (size + 3) + 8;
  };
  const org = d.orgs.find((o) => o.id === b.org_id);
  row('Group · المجموعة', nameOf(b), 13, true);
  row('Organisation · الجهة', org?.name);
  row('Person in charge · المسؤول', [b.contact, b.phone].filter(Boolean).join('  ·  '));
  row('Leader · المسؤول عن النشاط', b.leader);
  row('State · الحالة', `${status[b.status] ?? b.status}${b.status === 'option' && b.hold_until ? `  (held until ${pdfDay(b.hold_until)})` : ''}`);
  c.y -= 4;
  c.rule(c.y + 6);
  c.y -= 10;
  // when: the days, the hours, and every date of a repeat (moved and cancelled dates as they are now)
  const occ = occurrences({ ...b, status: b.status === 'cancelled' ? 'confirmed' : b.status }, d.dates);
  if (b.kind === 'stay') row('Stay · الإقامة', `${dayLine(b.from_day)}  ->  ${dayLine(b.to_day)}  (${occ.length} night(s) · ليلة)`);
  else {
    row('Hours · الساعات', hoursOf(b));
    const list = occ.map((o) => `${short(o.day)}${o.moved ? ` ${hm(o.from)}-${hm(o.to)}` : ''}`);
    row(occ.length > 1 ? `Dates (${occ.length}) · التواريخ` : 'Date · التاريخ', occ.length === 1 ? dayLine(occ[0].day) : list.join('   '));
  }
  row('Spaces · الأماكن', spaceNames(d, b));
  row('People · الأشخاص', b.people ? String(b.people) : '');
  const lines = d.lines.filter((l) => l.booking_id === b.id);
  row('Services · الخدمات', lines.map((l) => `${l.label}${l.qty > 1 ? ` x ${l.qty}` : ''}`).join('   ·   '));
  row('Equipment · التجهيزات', d.needs.filter((n) => n.booking_id === b.id).map((n) => { const e = d.equip.find((x) => x.id === n.equip_id); return e ? `${e.name}${n.qty > 1 ? ` x ${n.qty}` : ''}` : ''; }).filter(Boolean).join('   ·   '));
  row('Note · ملاحظة', b.note);
  // the amounts: only for a priced booking, and only for who sees them (a free booking: none)
  if (seesPrices(d.rights) && b.price_state === 'priced') {
    const total = calTotals(b, lines, d.dates);
    const got = received(d.pays.filter((p) => p.booking_id === b.id));
    c.y -= 4;
    c.rule(c.y + 6);
    c.y -= 10;
    row('Agreed total · المجموع المتفق عليه', totalsText(total), 11, true);
    row('Paid · المدفوع', totalsText(got));
    row('Still due · المتبقي', totalsText(stillDue(total, got)), 11, true);
  } else if (b.price_state === 'free') row('Price · السعر', 'Free · مجاني');
  c.signatures('For the centre · عن المركز', 'For the group · عن المجموعة');
  c.foot(`${look.organisation}  ·  ${b.code}`);
  return c.save();
}

// ------------------------------------------------------------------ the week of one hall (on its door)

export async function hallWeekPdf(look: HouseLook, d: CalData, spaceId: number, anyDay: string): Promise<Uint8Array> {
  const days = weekOf(anyDay);
  const sp = d.spaces.find((s) => s.id === spaceId);
  const c = await newCanvas(look, { title: `Week ${sp?.name ?? ''} ${days[0]}`, landscape: true, margin: 32 });
  const { W, M, put, wrap } = c;
  await c.head();
  put(sp?.name ?? '', M, c.y + 4, 18, { bold: true, color: c.accent });
  put(`Week · الأسبوع:  ${pdfDay(days[0])}  -  ${pdfDay(days[6])}`, W - M, c.y + 6, 11, { align: 'right' });
  c.y -= 22;
  const items = itemsBetween(d, days[0], days[6]);
  const colW = (W - 2 * M) / 7;
  const top = c.y;
  const bottom = M + 18;
  days.forEach((day, i) => {
    const x = M + i * colW;
    c.page.drawRectangle({ x, y: top - 22, width: colW, height: 22, color: c.tint, borderColor: c.line, borderWidth: 0.6 });
    put(`${WD_EN[i]} ${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`, x + colW / 2, top - 10, 9, { bold: true, align: 'center', color: c.accent });
    put(WD_AR[i], x + colW / 2, top - 19, 7.5, { align: 'center', color: c.muted });
    c.page.drawRectangle({ x, y: bottom, width: colW, height: top - 22 - bottom, borderColor: c.line, borderWidth: 0.6 });
    let y = top - 36;
    const shut = closedOn(d.closed, spaceId, day);
    const band = periodOn(d.periods, day);
    if (shut || band) { put(shut ? 'Closed · مغلق' : `${band!.name}`, x + 5, y, 8.5, { bold: true, color: c.muted }); y -= 14; }
    const mine = (items.get(day) ?? []).filter((it) => it.spaces.includes(spaceId));
    if (!mine.length && !shut) put('Free · فارغ', x + 5, y, 8.5, { color: c.muted });
    for (const it of mine) {
      if (y < bottom + 24) { put('…', x + 5, y, 9); break; }
      const h = it.occ.from === 0 && it.occ.to === 1440 ? 'All day · اليوم كله' : `${hm(it.occ.from)} - ${hm(it.occ.to)}`;
      put(h, x + 5, y, 9, { bold: true });
      y -= 12;
      for (const l of wrap(nameOf(it.b), colW - 10, 8.5).slice(0, 3)) { put(l, x + 5, y, 8.5); y -= 11; }
      if (it.b.status === 'option') { put('to confirm · للتأكيد', x + 5, y, 7.5, { color: c.muted }); y -= 10; }
      y -= 6;
    }
  });
  c.foot(`${look.organisation}  ·  ${sp?.name ?? ''}`);
  return c.save();
}

// ------------------------------------------------------------------ a short page for a day or a week (reception, guard)

export async function shortPagePdf(look: HouseLook, d: CalData, from: string, to: string): Promise<Uint8Array> {
  const c = await newCanvas(look, { title: `Calendar ${from}` });
  const { W, M, put } = c;
  await c.head();
  put(from === to ? 'THE DAY  ·  اليوم' : 'THE WEEK  ·  الأسبوع', M, c.y, 14, { bold: true, color: c.accent });
  put(from === to ? dayLine(from) : `${pdfDay(from)}  -  ${pdfDay(to)}`, W - M, c.y, 11, { align: 'right' });
  c.y -= 26;
  const items = itemsBetween(d, from, to);
  const cH = M, cName = M + 70, cWhere = M + 270, cPeople = W - M - 120, cWho = W - M;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    // a stay holds its nights; on its last day the group leaves: that day is shown too (the guard needs it)
    const leaving = d.bookings.filter((b) => b.kind === 'stay' && b.status !== 'cancelled' && b.to_day === day)
      .map((b) => ({ b, occ: { day, from: 0, to: 1440 }, spaces: d.allocs.filter((a) => a.booking_id === b.id).map((a) => a.room_id), leave: true }));
    const list: { b: CalBooking; occ: { day: string; from: number; to: number }; spaces: number[]; leave?: boolean }[] = [...leaving, ...(items.get(day) ?? [])];
    c.ensure(40);
    c.page.drawRectangle({ x: M, y: c.y - 6, width: W - 2 * M, height: 20, color: c.tint });
    put(dayLine(day), M + 6, c.y, 10.5, { bold: true, color: c.accent });
    const band = periodOn(d.periods, day);
    if (band) put(band.name, W - M - 6, c.y, 9, { align: 'right', color: c.muted });
    c.y -= 22;
    if (!list.length) { put('Nothing booked · لا شيء', M + 6, c.y, 9.5, { color: c.muted }); c.y -= 18; continue; }
    for (const it of list) {
      c.ensure(16);
      const b = it.b;
      const stay = b.kind === 'stay';
      const h = stay ? ('leave' in it && it.leave ? 'Leave · مغادرة' : b.from_day === day ? 'Arrive · وصول' : 'Stay · إقامة') : it.occ.from === 0 && it.occ.to === 1440 ? 'All day' : `${hm(it.occ.from)}-${hm(it.occ.to)}`;
      put(h, cH, c.y, 9, { bold: true });
      put(c.fit(nameOf(b), cWhere - cName - 8, 9.5), cName, c.y, 9.5, { bold: b.status !== 'option' });
      const where = b.whole_centre ? 'Whole centre · المركز كله' : b.outside_place ? `Outside: ${b.outside_place}` : it.spaces.map((id) => d.spaces.find((s) => s.id === id)?.name).filter(Boolean).join(', ');
      put(c.fit(where, cPeople - cWhere - 8, 9), cWhere, c.y, 9);
      if (b.people) put(`${b.people} p.`, cPeople, c.y, 9);
      put(c.fit([b.contact, b.phone].filter(Boolean).join(' '), cWho - cPeople - 40, 8.5), cWho, c.y, 8.5, { align: 'right', color: c.muted });
      c.y -= 13;
      c.rule(c.y + 4);
      c.y -= 4;
    }
    c.y -= 8;
  }
  c.foot(`${look.organisation}  ·  ${pdfDay(from)}${from !== to ? ` - ${pdfDay(to)}` : ''}`);
  return c.save();
}
