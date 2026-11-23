// The calendar's Excel list (baseline 2.1, section 7, step 4): every booking with a date in the period, one row each, and
// for who sees the money a second sheet with the payments (received and given back, with their receipt numbers and whether
// they are already in the books). The data is already cut to what the person may see (forViewer).
import ExcelJS from 'exceljs';
import { calTotals, givenBack, occurrences, received, seesPrices, stillDue, type CalBooking, type CalData } from '../hosting/calendar';

const STATUS: Record<string, string> = { option: 'To confirm', confirmed: 'Confirmed', arrived: 'Arrived', left: 'Left', cancelled: 'Cancelled' };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRICE: Record<string, string> = { free: 'Free', unset: 'Price not set', priced: 'Priced' };

/** the bookings that have a date in [from, to] (a cancelled one: by its first and last day) */
export function bookingsIn(d: CalData, from: string, to: string): CalBooking[] {
  return d.bookings.filter((b) => {
    if (b.status === 'cancelled') return b.from_day <= to && b.to_day >= from;
    return occurrences(b, d.dates).some((o) => o.day >= from && o.day <= to);
  }).sort((x, y) => x.from_day.localeCompare(y.from_day) || x.id - y.id);
}

export async function calWorkbook(d: CalData, from: string, to: string, organisation: string): Promise<Uint8Array> {
  const priced = seesPrices(d.rights);
  const wb = new ExcelJS.Workbook();
  const head = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };

  const ws = wb.addWorksheet('Bookings');
  const cols: [string, number][] = [
    ['Code', 14], ['Ours / outside', 13], ['Kind', 16], ['Name', 28], ['Subject', 22], ['Organisation', 24], ['Person', 18], ['Phone', 15], ['Leader', 18],
    ['From', 12], ['To', 12], ['Every week on', 16], ['Hours', 13], ['Dates', 7], ['Spaces', 30], ['People', 8], ['Status', 12], ['Held until', 12], ['Private', 8], ['Note', 30],
  ];
  if (priced) cols.push(['Price', 14], ['Total USD', 11], ['Total SYP', 13], ['Paid USD', 11], ['Paid SYP', 13], ['Given back USD', 14], ['Given back SYP', 14], ['Still due USD', 13], ['Still due SYP', 13]);
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  head(ws);
  const kind = (b: CalBooking) => b.whole_centre ? 'Whole centre'
    : b.origin === 'ours' ? (d.activityKinds.find((k) => k.id === b.activity_kind_id)?.name ?? 'Our activity')
      : b.kind === 'stay' ? 'Guest stay' : 'Hall booking';
  for (const b of bookingsIn(d, from, to)) {
    const spaces = b.whole_centre ? 'Every space' : b.outside_place ? `Outside: ${b.outside_place}` : d.allocs.filter((a) => a.booking_id === b.id).map((a) => d.spaces.find((s) => s.id === a.room_id)?.name).filter(Boolean).join(', ');
    const row: (string | number | null)[] = [
      b.code, b.origin === 'ours' ? 'Ours' : 'Outside', kind(b), b.group_name, b.subject, d.orgs.find((o) => o.id === b.org_id)?.name ?? null, b.contact, b.phone, b.leader,
      b.from_day, b.to_day, b.repeat_days ? b.repeat_days.split(',').map((x) => WD[Number(x)]).join(', ') : null,
      b.kind === 'stay' ? null : b.time_from && b.time_to ? `${b.time_from}-${b.time_to}` : 'All day',
      occurrences({ ...b, status: b.status === 'cancelled' ? 'confirmed' : b.status }, d.dates).length, spaces, b.people || null, STATUS[b.status] ?? b.status,
      b.status === 'option' ? b.hold_until : null, b.private ? 'yes' : null, b.note,
    ];
    if (priced) {
      const pays = d.pays.filter((p) => p.booking_id === b.id);
      const total = b.status === 'cancelled' ? { USD: 0, SYP: 0 } : calTotals(b, d.lines.filter((l) => l.booking_id === b.id), d.dates);
      const got = received(pays), back = givenBack(pays), due = stillDue(total, got);
      const n = (x: number) => (x ? x : null);
      row.push(b.price_state ? PRICE[b.price_state] : null, n(total.USD), n(total.SYP), n(got.USD), n(got.SYP), n(back.USD), n(back.SYP), n(due.USD), n(due.SYP));
    }
    ws.addRow(row);
  }

  if (priced) {
    const ps = wb.addWorksheet('Payments');
    ps.columns = [['Receipt', 14], ['Date', 12], ['Booking', 14], ['Name', 28], ['Received / given back', 20], ['Amount', 12], ['Currency', 9], ['Paid by', 10], ['In the books', 12], ['Refused', 9]].map(([header, width]) => ({ header: header as string, width: width as number }));
    head(ps);
    const entered = new Set(d.entered ?? []);
    for (const p of d.pays.filter((x) => x.paid_on >= from && x.paid_on <= to)) {
      const b = d.bookings.find((x) => x.id === p.booking_id);
      ps.addRow([p.receipt_no, p.paid_on, b?.code ?? '', b?.group_name ?? '', p.kind === 'back' ? 'Given back' : 'Received', p.kind === 'back' ? -p.amount : p.amount, p.currency, p.method, entered.has(p.receipt_no) ? 'yes' : null, p.status === 'refused' ? 'yes' : null]);
    }
  }

  const info = wb.addWorksheet('About');
  info.addRows([[organisation], ['Calendar · التقويم'], ['From', from], ['To', to], ['Made on', new Date().toISOString().slice(0, 10)]]);
  info.getColumn(1).width = 16;
  info.getColumn(2).width = 20;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
