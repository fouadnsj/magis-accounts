// The accommodation and events report as an Excel file (22 November 2026): a summary, the months, the buildings, the groups
// and the people (how many bookings each), and the bookings themselves. The amounts only if the person sees them.
import ExcelJS from 'exceljs';
import { nightsOf, report, type HostData, type ReportOpts, type Totals } from '../hosting/host';

const STATUS: Record<string, string> = { option: 'To confirm', confirmed: 'Confirmed', arrived: 'Arrived', left: 'Left', cancelled: 'Cancelled' };
const tot = (x: Totals) => [x.USD ? `USD ${x.USD}` : '', x.SYP ? `SYP ${x.SYP}` : ''].filter(Boolean).join(' + ');

export async function hostWorkbook(data: HostData, o: ReportOpts, organisation: string): Promise<Uint8Array> {
  const r = report(data, o);
  const wb = new ExcelJS.Workbook();
  const head = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const widths = (ws: ExcelJS.Worksheet, w: number[]) => ws.columns.forEach((c, i) => { c.width = w[i] ?? 14; });

  const sm = wb.addWorksheet('Summary');
  sm.addRow(['', organisation]);
  sm.addRow(['Period', `${o.from} → ${o.to}`]);
  sm.addRow(['Type', o.kind === 'all' ? 'Accommodation and events' : o.kind === 'stay' ? 'Accommodation' : 'Events']);
  sm.addRow(['Counted', o.withOptions ? 'Confirmed, arrived, left and to confirm' : 'Confirmed, arrived and left']);
  sm.addRow([]);
  const s = r.summary;
  const lines: (string | number)[][] = [
    ['Bookings', s.bookings], ['Accommodation bookings', s.stays], ['Event bookings', s.events], ['Groups', s.groups], ['Cancelled in the period', s.cancelled],
    ['People (accommodation)', s.people], ['Nights', s.nights], ['Person-nights', s.personNights], ['Bed occupancy %', s.bed.pct],
    ['Event days (sessions)', s.eventDays], ['Hall use %', s.hall.pct],
  ];
  if (data.prices) lines.push(['Agreed amounts', tot(s.amounts.agreed)], ['Payments received in the period', tot(s.amounts.paid)]);
  for (const row of lines) sm.addRow(row);
  sm.getColumn(1).font = { bold: true };
  widths(sm, [34, 40]);

  const mo = wb.addWorksheet('By month');
  mo.addRow(['Month', 'Bookings', 'Nights', 'Person-nights', 'Event days', 'Bed occupancy %']);
  for (const m of r.months) mo.addRow([m.month, m.bookings, m.nights, m.personNights, m.eventDays, m.bedPct]);
  head(mo); widths(mo, [12, 10, 10, 14, 12, 16]);

  const bd = wb.addWorksheet('By building');
  bd.addRow(['Building', 'Bookings', 'Bed-nights used', 'Bed occupancy %', 'Hall days']);
  for (const b of r.buildings) bd.addRow([b.name, b.bookings, b.bedNights, b.bedPct, b.hallDays]);
  head(bd); widths(bd, [26, 10, 16, 16, 12]);

  const gr = wb.addWorksheet('Groups');
  gr.addRow(['Group', 'Bookings', 'Accommodation', 'Events', 'Nights', 'Person-nights', 'Event days', 'People (total)', 'First', 'Last', 'Contact persons', 'Phone', ...(data.prices ? ['Agreed', 'Paid'] : [])]);
  for (const g of r.groups) gr.addRow([g.name, g.bookings, g.stays, g.events, g.nights, g.personNights, g.eventDays, g.people, g.first, g.last, [...g.contacts].join(', '), g.phone ?? '', ...(data.prices ? [tot(g.amounts.agreed), tot(g.amounts.paid)] : [])]);
  head(gr); widths(gr, [28, 10, 14, 8, 8, 14, 11, 14, 11, 11, 28, 16, 18, 18]);

  const pe = wb.addWorksheet('People');
  pe.addRow(['Person in charge', 'Phone', 'Bookings', 'Groups', 'Last']);
  for (const p of r.people) pe.addRow([p.name, p.phone ?? '', p.bookings, [...p.groups].join(', '), p.last]);
  head(pe); widths(pe, [26, 16, 10, 40, 11]);

  const bk = wb.addWorksheet('Bookings');
  const rooms = (id: number) => data.allocs.filter((a) => a.booking_id === id).map((a) => { const rm = data.rooms.find((x) => x.id === a.room_id); return rm ? `${data.buildings.find((b) => b.id === rm.building_id)?.name ?? ''} · ${rm.name}` : ''; }).join(', ');
  bk.addRow(['Code', 'Type', 'Group', 'Contact', 'Phone', 'People', 'From', 'To', 'Nights / days', 'Rooms', 'Status', ...(data.prices ? ['Agreed', 'Paid'] : [])]);
  for (const x of r.rows) {
    // the agreed total of one booking, and what was paid on it in the period
    const one = (from: string, to: string) => report({ ...data, bookings: [x.b] }, { from, to, kind: 'all', withOptions: true }).summary.amounts;
    bk.addRow([x.b.code, x.b.kind === 'stay' ? 'Accommodation' : 'Event', x.b.group_name, x.b.contact ?? '', x.b.phone ?? '', x.b.people, x.b.from_day, x.b.to_day, nightsOf(x.b), rooms(x.b.id), STATUS[x.b.status] ?? x.b.status,
      ...(data.prices ? [tot(one(x.b.from_day, x.b.to_day).agreed), tot(one(o.from, o.to).paid)] : [])]);
  }
  head(bk); widths(bk, [14, 14, 26, 20, 16, 8, 11, 11, 12, 34, 12, 16, 16]);
  wb.title = `${organisation} — hosting report`;
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
