// What the calendar's laptop screen shows (step 2): weeks from Monday, the Today strip, the lists and the search.
import { describe, expect, it } from 'vitest';
import { itemsBetween, listOf, monthGrid, mondayOf, search, spacesShown, todayFigures, weekOf } from '../src/hosting/calview';
import { calRights, type CalBooking, type CalData, type CalSpace } from '../src/hosting/calendar';

const bk = (x: Partial<CalBooking> & { id: number }): CalBooking => ({
  code: `B${x.id}`, kind: 'event', status: 'confirmed', group_name: `G${x.id}`, contact: null, phone: null, people: 0, from_day: '2027-03-01', to_day: '2027-03-01', repeat_days: null,
  time_from: null, time_to: null, price_mode: null, rate: null, currency: 'USD', note: null, cancel_reason: null, source: 'desk', review: 0, client_ref: null, created_by: null,
  created_at: '2027-02-27T10:00:00.000Z', updated_at: null, origin: 'outside', activity_kind_id: null, leader: null, org_id: null, person_id: null, subject: null, private: 0,
  whole_centre: 0, outside_place: null, hold_until: null, price_state: 'unset', price_each: 0, cancel_money: null, kept_usd: null, kept_syp: null, cancelled_by: null, cancelled_at: null, ...x,
});
const sp = (id: number, kind_id: number, x: Partial<CalSpace> = {}): CalSpace => ({ id, building_id: 1, name: `S${id}`, beds: kind_id === 1 ? 3 : 0, kind: kind_id === 1 ? 'bedroom' : 'hall', kind_id, capacity: 0, active: 1, sort: 0, place_id: null, floor: null, rentable: 1, bookable: 1, fixed: null, note: null, category_id: null, ...x });
const data = (bookings: CalBooking[], allocs: [number, number][]): CalData => ({
  areas: [], spaces: [sp(1, 1), sp(2, 1), sp(3, 2, { name: 'Hall A' }), sp(4, 2, { category_id: 3 })], categories: [], activityKinds: [], orgKinds: [],
  kinds: [{ id: 1, name: 'Bedroom', sleeps: 1, active: 1, sort: 1, category_id: 2 }, { id: 2, name: 'Hall', sleeps: 0, active: 1, sort: 2, category_id: 1 }],
  orgs: [{ id: 1, name: 'Test choir', kind_id: null, note: 'pays monthly', active: 1, created_by: null, created_at: 'x', updated_at: null }],
  persons: [{ id: 1, org_id: 1, name: 'Person A', phone: '0911 222', active: 1, sort: 1 }],
  bookings, allocs: allocs.map(([b, r]) => ({ booking_id: b, room_id: r, beds: null })), dates: [], closed: [], periods: [], equip: [], needs: [], lines: [], pays: [], services: [], rights: calRights(['cal.view', 'cal.contacts']),
});

describe('the laptop screen', () => {
  it('the week starts on Monday; a month shows whole weeks', () => {
    expect(mondayOf('2027-03-07')).toBe('2027-03-01'); // a Sunday belongs to the week of the Monday before
    expect(weekOf('2027-03-03')).toEqual(['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06', '2027-03-07']);
    const g = monthGrid('2027-03-15');
    expect([g[0], g[g.length - 1], g.length % 7]).toEqual(['2027-03-01', '2027-04-04', 0]);
  });
  it('a space that cannot be booked (a store) is never in the calendar: not in the views, not in the Today counts', () => {
    const d = data([], []);
    d.spaces.push(sp(5, 2, { name: 'Store', bookable: 0 }), sp(6, 1, { name: 'Old room', bookable: 0 }));
    expect(spacesShown(d, null, null).map((s) => s.id)).toEqual([1, 2, 3, 4]);
    expect(todayFigures(d, '2027-03-01', 600).freeTonight.map((s) => s.id)).toEqual([1, 2]);
  });
  it('the quick views: a category from the kind, or the space\'s own', () => {
    const d = data([], []);
    expect(spacesShown(d, 2, null).map((s) => s.id)).toEqual([1, 2]);
    expect(spacesShown(d, 1, null).map((s) => s.id)).toEqual([3]);
    expect(spacesShown(d, 3, null).map((s) => s.id)).toEqual([4]);
  });
  it('the Today strip: arrive, leave, halls in use now, rooms free tonight, to confirm (date passed in red)', () => {
    const d = data([
      bk({ id: 1, kind: 'stay', from_day: '2027-03-01', to_day: '2027-03-03' }),
      bk({ id: 2, kind: 'stay', from_day: '2027-02-27', to_day: '2027-03-01', status: 'arrived' }),
      bk({ id: 3, time_from: '10:00', time_to: '12:00' }),
      bk({ id: 4, status: 'option', from_day: '2027-03-10', to_day: '2027-03-10' }),
    ], [[1, 1], [2, 2], [3, 3], [4, 3]]);
    const f = todayFigures(d, '2027-03-01', 11 * 60);
    expect(f.arrive.map((b) => b.id)).toEqual([1]);
    expect(f.leave.map((b) => b.id)).toEqual([2]);
    expect(f.inUse.map((x) => [x.space.id, x.b.id])).toEqual([[3, 3]]);
    expect(f.freeTonight.map((s) => s.id)).toEqual([2]); // room 1 holds group 1 tonight; group 2 leaves this morning
    expect(f.toConfirm.map((b) => b.id)).toEqual([4]);
    expect(f.passed).toBe(0);
    expect(todayFigures(d, '2027-03-08', 9 * 60).passed).toBe(1); // held 7 days from 27 February
    expect(todayFigures(d, '2027-03-01', 13 * 60).inUse).toEqual([]);
  });
  it('the dates of a week, and the lists', () => {
    const d = data([bk({ id: 1, from_day: '2027-03-01', to_day: '2027-03-28', repeat_days: '1' }), bk({ id: 2, from_day: '2027-02-01', to_day: '2027-02-01' }), bk({ id: 3, status: 'cancelled' })], [[1, 3]]);
    const w = itemsBetween(d, '2027-03-08', '2027-03-14');
    expect([...w.keys()]).toEqual(['2027-03-08']);
    expect(w.get('2027-03-08')![0].spaces).toEqual([3]);
    expect(listOf(d, 'upcoming', '2027-03-05').map((x) => [x.b.id, x.next])).toEqual([[1, '2027-03-08']]);
    expect(listOf(d, 'past', '2027-03-05').map((x) => x.b.id)).toEqual([3, 2]);
  });
  it('search: names, organisations, phones, spaces; every word must be found', () => {
    const d = data([bk({ id: 1, group_name: 'Test choir', org_id: 1, from_day: '2027-03-10', to_day: '2027-03-10' }), bk({ id: 2, group_name: 'Club', leader: 'Rima', from_day: '2027-03-11', to_day: '2027-03-11' })], [[1, 3]]);
    expect(search(d, 'choir', '2027-03-01').map((x) => x.b.id)).toEqual([1]);
    expect(search(d, '0911', '2027-03-01').map((x) => x.b.id)).toEqual([1]);
    expect(search(d, 'hall a', '2027-03-01').map((x) => x.b.id)).toEqual([1]);
    expect(search(d, 'rima', '2027-03-01')[0].next).toBe('2027-03-11');
    expect(search(d, 'choir rima', '2027-03-01')).toEqual([]);
  });
});
