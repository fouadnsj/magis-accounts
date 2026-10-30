// The HR database, stage 1 (Fouad, 30 October 2026): people, agreements, stipend letters, code of conduct, the vault and its log.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type Running } from '../server/server';
import { hourlyFromMonthly, hourlyWithThirteenth, monthlyFromRate, monthlyHours, yearlyCost } from '../src/hr/pay';

let srv: Running;
let base: string;
let dir: string;
let cookie = '';

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-hr-'));
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
  srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'serve', httpPort: 0 }, log: () => undefined });
  base = `http://127.0.0.1:${srv.httpPort}`;
}, 60000);
afterAll(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(url: string, body?: unknown, ck = cookie) {
  const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie().find((c) => c.startsWith('magis_sid='));
  if (set && !ck) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null), set: set ? set.split(';')[0] : null };
}
const op = (name: string, args: unknown = {}, ck = cookie) => call(`/api/op/${name}`, args, ck);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');

describe('HR database', () => {
  it('people, papers, conduct, vault with its log, reader limits, alerts', async () => {
    const made = await call('/api/dbs/create', { organisation: 'HR', centre: 'other', kind: 'hr' });
    const slug = made.body.slug;
    expect((await call('/api/setup/hr', { db: slug, organisation: 'HR', people: [{ name: 'Fouad', password: 'fouad-hr-1' }], mustChange: false })).status).toBe(200);
    const profiles = (await call(`/api/profiles?db=${slug}`)).body;
    const login = await call('/api/login', { db: slug, profileId: profiles[0].id, password: 'fouad-hr-1' }, '');
    cookie = login.set!;
    const keeper = cookie;
    expect(login.status).toBe(200);

    const pid = (await op('hr.person.save', { name: 'Salma', father_name: 'Ahmad', national_id: '01234567890', birth_place: 'Aleppo', birth_date: '1999-04-02', address: 'Aleppo', role: 'Reception', started: '2026-01-01' })).body.id;
    expect(pid).toBeGreaterThan(0);

    // alerts: no agreement, code of conduct not signed (once there is a version)
    const d0 = (await op('hr.data', { today: '2026-11-15' })).body;
    expect(d0.alerts.map((a: { kind: string }) => a.kind)).toEqual(['agreement_missing']);

    // a yearly agreement, ending on 31 December: "ending" within 60 days; its scan arrives later
    const ag = (await op('hr.paper.save', { personId: pid, kind: 'agreement', start: '2026-01-01', end: '2026-12-31', amount: 180, currency: 'USD' })).body.id;
    const kinds = (await op('hr.data', { today: '2026-11-15' })).body.alerts.map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(['agreement_ending', 'unsigned_paper']);
    expect((await op('hr.file.add', { kind: 'paper', id: ag, base64: PNG, mime: 'image/png', name: 'Salma agreement.png' })).status).toBe(200);
    // the next year's agreement removes the "ending" alert
    await op('hr.paper.save', { personId: pid, kind: 'agreement', start: '2027-01-01', end: '2027-12-31' });
    expect((await op('hr.data', { today: '2026-11-15' })).body.alerts.map((a: { kind: string }) => a.kind)).toEqual(['unsigned_paper']);

    // a stipend letter must say which service
    expect((await op('hr.paper.save', { personId: pid, kind: 'stipend', amount: 50 })).status).toBe(400);
    expect((await op('hr.paper.save', { personId: pid, kind: 'stipend', service: 'Workshop animation', amount: 50, paidOn: '2026-10-15' })).status).toBe(200);

    // the code of conduct: a version, signed by the person
    const cv = (await op('hr.conduct.save', { version: '1.0', validFrom: '2026-01-01' })).body.id;
    expect((await op('hr.data', { today: '2026-11-15' })).body.alerts.some((a: { kind: string }) => a.kind === 'conduct_unsigned')).toBe(true);
    expect((await op('hr.conduct.sign', { conductId: cv, personId: pid, signedOn: '2026-02-01' })).status).toBe(200);
    expect((await op('hr.conduct.sign', { conductId: cv, personId: pid, signedOn: '2026-02-02' })).status).toBe(400); // already
    expect((await op('hr.data', { today: '2026-11-15' })).body.alerts.some((a: { kind: string }) => a.kind === 'conduct_unsigned')).toBe(false);

    // the vault: add, expiry alert, opening is logged
    const doc = (await op('hr.vault.add', { personId: pid, label: 'ID card', expiresOn: '2026-11-20', base64: PNG, mime: 'image/png', name: 'id.png' })).body.id;
    expect((await op('hr.vault.add', { personId: pid, label: 'x', base64: PNG, mime: 'text/html' })).status).toBe(400); // only PDF or pictures
    expect((await op('hr.data', { today: '2026-11-15' })).body.alerts.some((a: { kind: string; days: number }) => a.kind === 'doc_expiring' && a.days === 5)).toBe(true);
    const got = await op('hr.file.get', { kind: 'doc', id: doc });
    expect(got.body.base64).toBe(PNG);
    const log = (await op('hr.access.list')).body as { action: string; what: string }[];
    expect(log.map((l) => `${l.action} ${l.what}`)).toEqual(expect.arrayContaining(['open doc', 'add doc', 'open doc'.replace('open', 'add')]));
    expect(log.filter((l) => l.action === 'open' && l.what === 'doc')).toHaveLength(1);

    // a reader (hr.view only): sees people and papers, never the vault, cannot change anything
    expect((await op('user.save', { name: 'Reader', access_id: 2, books: [], pin: 'reader-pass-1' })).status).toBe(200);
    const rp = (await call(`/api/profiles?db=${slug}`)).body.find((p: { name: string }) => p.name === 'Reader');
    const rl = await call('/api/login', { db: slug, profileId: rp.id, password: 'reader-pass-1' }, '');
    const rc = rl.set!;
    expect((await op('profile.setPin', { id: rp.id, pin: 'reader-own-2' }, rc)).status).toBe(200); // the first password is replaced
    const rd = (await op('hr.data', {}, rc)).body;
    expect(rd.people).toHaveLength(1);
    expect(rd.docs).toBeNull();
    expect((await op('hr.file.get', { kind: 'doc', id: doc }, rc)).status).toBe(400);
    expect((await op('hr.person.save', { name: 'Nope' }, rc)).status).toBe(400);
    expect((await op('hr.access.list', {}, rc)).status).toBe(400);
    expect((await op('hr.file.get', { kind: 'paper', id: ag }, rc)).status).toBe(200); // a reader may open a signed paper

    cookie = keeper; // (the reader's sign-in replaced it)
    // the person leaves: inactive, no longer in the alerts
    await op('hr.person.save', { id: pid, name: 'Salma', ended: '2026-10-31' });
    expect((await op('hr.data', { today: '2026-12-05' })).body.alerts).toEqual([]);
  });

  it('pay rules: true hourly rate, grades give a monthly stipend, weekly hours differ per person', async () => {
    // the Director of the scale: 300 a month for 42 hours a week is 1.65 an hour (not 7.14)
    expect(hourlyFromMonthly(300, 42)).toBe(1.65);
    expect(hourlyFromMonthly(180, 30)).toBe(1.38);
    expect(hourlyFromMonthly(250, null)).toBeNull();
    expect(hourlyWithThirteenth(300, 42, 13)).toBe(1.79);
    expect(monthlyHours(40)).toBeCloseTo(173.33, 2);
    // (an hourly rate gives a monthly stipend: kept as a reference; the scale itself is by monthly amount)
    expect(monthlyFromRate(1.15, 48, 5)).toBe(240);
    expect(monthlyFromRate(1.15, 36, 5)).toBe(180);
    expect(monthlyFromRate(1.4, 30, 5)).toBe(180);
    expect(yearlyCost(180, 13)).toBe(2340);

    const made = await call('/api/dbs/create', { organisation: 'HR pay', centre: 'other', kind: 'hr' });
    const slug = made.body.slug;
    await call('/api/setup/hr', { db: slug, organisation: 'HR pay', people: [{ name: 'Fouad', password: 'fouad-hr-1' }], mustChange: false });
    const profiles = (await call(`/api/profiles?db=${slug}`)).body;
    const login = await call('/api/login', { db: slug, profileId: profiles[0].id, password: 'fouad-hr-1' }, '');
    const ck = login.set!;
    const pid = (await op('hr.person.save', { name: 'Guard One' }, ck)).body.id;

    expect((await op('hr.grade.seed', { year: 2027 }, ck)).status).toBe(200);
    expect((await op('hr.grade.seed', { year: 2027 }, ck)).status).toBe(400); // only into an empty scale
    let d = (await op('hr.pay.data', {}, ck)).body;
    expect(d.grades.map((g: { name: string; monthly_usd: number }) => [g.name, g.monthly_usd])).toEqual([['Centre Director', 300], ['Workshop Coordinator', 250], ['Guard & logistics', 230], ['Accountant', 250], ['Reception', 180], ['IT', 180], ['Cleaner', 180], ['Cook', 200], ['Academic Coordinator', 250], ['Media', 200]]);
    expect(d.settings).toEqual({ paymentsPerYear: 13, roundTo: 5, maxWeekly: 40 });

    // a pay needs a position or an amount; the weekly hours only give the hourly cost
    expect((await op('hr.pay.save', { personId: pid, validFrom: '2027-01-01' }, ck)).status).toBe(400);
    expect((await op('hr.pay.save', { personId: pid, validFrom: '2027-01-01', gradeId: 1, weeklyHours: 48 }, ck)).status).toBe(200);
    // a change of hours later keeps the history
    expect((await op('hr.pay.save', { personId: pid, validFrom: '2027-07-01', gradeId: 1, weeklyHours: 40 }, ck)).status).toBe(200);
    d = (await op('hr.pay.data', {}, ck)).body;
    expect(d.pays.map((p: { valid_from: string; weekly_hours: number }) => [p.valid_from, p.weekly_hours])).toEqual([['2027-01-01', 48], ['2027-07-01', 40]]);

    // a grade in use cannot be deleted; an unused one can
    expect((await op('hr.grade.delete', { id: 1 }, ck)).status).toBe(400);
    expect((await op('hr.grade.delete', { id: 4 }, ck)).status).toBe(200);
    // a new year's rate on an existing grade
    expect((await op('hr.grade.save', { id: 1, name: 'Centre Director', monthlyUsd: 320 }, ck)).status).toBe(200);
    expect((await op('hr.grade.save', { id: 1, name: 'Centre Director', monthlyUsd: 0 }, ck)).status).toBe(400);
    expect((await op('hr.grade.save', { name: 'Cook', monthlyUsd: 210 }, ck)).status).toBe(400); // exists already

    // hours of a month, then removed
    expect((await op('hr.hours.save', { personId: pid, ym: '2027-03', hours: 190 }, ck)).status).toBe(200);
    expect((await op('hr.hours.save', { personId: pid, ym: '2027-03', hours: 200, note: 'extra week' }, ck)).status).toBe(200);
    expect((await op('hr.pay.data', {}, ck)).body.hours).toEqual([expect.objectContaining({ ym: '2027-03', hours: 200, note: 'extra week' })]);
    expect((await op('hr.hours.save', { personId: pid, ym: '2027-03', hours: null }, ck)).status).toBe(200);
    expect((await op('hr.pay.data', {}, ck)).body.hours).toEqual([]);

    // a reader never sees pay
    expect((await op('user.save', { name: 'Reader', access_id: 2, books: [], pin: 'reader-pass-1' }, ck)).status).toBe(200);
    const rp = (await call(`/api/profiles?db=${slug}`)).body.find((p: { name: string }) => p.name === 'Reader');
    const rl = await call('/api/login', { db: slug, profileId: rp.id, password: 'reader-pass-1' }, '');
    await op('profile.setPin', { id: rp.id, pin: 'reader-own-2' }, rl.set!);
    expect((await op('hr.pay.data', {}, rl.set!)).status).toBe(400);
    expect((await op('hr.pay.save', { personId: pid, validFrom: '2027-01-01', monthlyUsd: 99 }, rl.set!)).status).toBe(400);
  });

  it('payroll: a run per month, bonus lines, approval, paid, voucher of totals only', async () => {
    const made = await call('/api/dbs/create', { organisation: 'HR run', centre: 'other', kind: 'hr' });
    const slug = made.body.slug;
    await call('/api/setup/hr', { db: slug, organisation: 'HR run', people: [{ name: 'Fouad', password: 'fouad-hr-1' }], mustChange: false });
    const profiles = (await call(`/api/profiles?db=${slug}`)).body;
    const ck = (await call('/api/login', { db: slug, profileId: profiles[0].id, password: 'fouad-hr-1' }, '')).set!;
    const mk = async (name: string, extra: object) => (await op('hr.person.save', { name, started: '2026-01-01', ...extra }, ck)).body.id as number;
    const g = await mk('Guard One', { account: 'CJF', budget_line: 'Staff - Guards' });
    const r = await mk('Reception One', { account: 'CJF', budget_line: 'Staff - Reception' });
    const l = await mk('Left Long Ago', { ended: '2026-02-01' });
    await op('hr.grade.seed', { year: 2026 }, ck);
    await op('hr.pay.save', { personId: g, validFrom: '2026-01-01', gradeId: 3, weeklyHours: 48 }, ck);   // Guard & logistics: 230
    await op('hr.pay.save', { personId: r, validFrom: '2026-01-01', gradeId: 5, weeklyHours: 30 }, ck);   // Reception: 180 (the reference of the position)
    await op('hr.pay.save', { personId: l, validFrom: '2026-01-01', monthlyUsd: 100, weeklyHours: 20 }, ck);
    await op('hr.hours.save', { personId: g, ym: '2026-11', hours: 205 }, ck);
    // a stipend letter paid in November, in pounds
    await op('hr.paper.save', { personId: r, kind: 'stipend', service: 'Workshop', amount: 650000, currency: 'SYP', paidOn: '2026-11-12' }, ck);

    expect((await op('hr.run.create', { ym: '2026-11', kind: 'monthly', rateSyp: 0 }, ck)).status).toBe(400);
    const created = await op('hr.run.create', { ym: '2026-11', kind: 'monthly', rateSyp: 13000 }, ck);
    expect(created.status).toBe(200);
    expect((await op('hr.run.create', { ym: '2026-11', kind: 'monthly', rateSyp: 13000 }, ck)).status).toBe(400); // one per month and kind
    const runId = created.body.id;
    let got = (await op('hr.run.get', { id: runId }, ck)).body;
    // the person who left in February is not in November's run; the letter is a line of its own
    expect(got.lines.map((x: { person_name: string; total_usd: number; label: string | null }) => [x.person_name, x.total_usd, x.label])).toEqual([
      ['Guard One', 230, null], ['Reception One', 180, null], ['Reception One', 50, 'Stipend: Workshop'],
    ]);
    expect(got.lines[0].hours_worked).toBe(205);
    expect(got.lines[2]).toMatchObject({ paid_in: 'SYP', amount_paid: 650000 });

    // an occasional bonus on a line; paying the guard in pounds rounds to 1,000
    const gl = got.lines[0].id;
    expect((await op('hr.run.line.save', { id: gl, bonusUsd: 20, paidIn: 'SYP' }, ck)).body).toEqual({ total: 250, paid: 3250000 });
    expect((await op('hr.run.line.add', { runId, personId: r, label: 'Eid bonus', bonusUsd: 15 }, ck)).status).toBe(200);
    expect((await op('hr.run.voucher', { id: runId }, ck)).status).toBe(400); // approve first

    expect((await op('hr.run.approve', { id: runId }, ck)).status).toBe(200);
    expect((await op('hr.run.line.save', { id: gl, bonusUsd: 99 }, ck)).status).toBe(400); // approved: closed
    expect((await op('hr.run.delete', { id: runId }, ck)).status).toBe(400);
    expect((await op('hr.run.paid', { id: runId, paidOn: '2026-11-30' }, ck)).status).toBe(200);
    expect((await op('hr.run.reopen', { id: runId }, ck)).status).toBe(400); // paid

    // the voucher: totals by account, budget line and currency; no names
    const v = (await op('hr.run.voucher', { id: runId }, ck)).body;
    expect(JSON.stringify(v)).not.toContain('Guard One');
    expect(v.rows).toEqual([
      { account: 'CJF', budget_line: 'Staff - Guards', target: null, paid_in: 'SYP', total_usd: 250, amount_paid: 3250000 },
      { account: 'CJF', budget_line: 'Staff - Reception', target: null, paid_in: 'SYP', total_usd: 50, amount_paid: 650000 },
      { account: 'CJF', budget_line: 'Staff - Reception', target: null, paid_in: 'USD', total_usd: 195, amount_paid: 195 },
    ]);
    expect(v.total_usd).toBe(495);

    // the 13th payment is a run of its own
    expect((await op('hr.run.create', { ym: '2026-12', kind: 'thirteenth', rateSyp: 13000 }, ck)).status).toBe(200);
    const th = (await op('hr.run.list', {}, ck)).body;
    expect(th.map((x: { ym: string; kind: string; status: string; total_usd: number }) => [x.ym, x.kind, x.status, x.total_usd])).toEqual([['2026-12', 'thirteenth', 'draft', 410], ['2026-11', 'monthly', 'paid', 495]]);
  });

  it('insurance with its reminder; split by donor or project in the voucher and the donor report', async () => {
    const { splitAmount, allocOn } = await import('../src/hr/stage4');
    expect(splitAmount(100, [{ pct: 33.33 }, { pct: 33.33 }, { pct: 33.34 }])).toEqual([33.33, 33.33, 33.34]);
    expect(splitAmount(10, [{ pct: 33.33 }, { pct: 66.67 }]).reduce((a, b) => a + b, 0)).toBeCloseTo(10, 5); // the parts always add up
    expect(splitAmount(3380000, [{ pct: 50 }, { pct: 50 }], 0)).toEqual([1690000, 1690000]);
    expect(allocOn([{ person_id: 1, valid_from: '2026-01-01', target: 'A', pct: 100 }, { person_id: 1, valid_from: '2026-07-01', target: 'B', pct: 100 }], 1, '2026-08-01')[0].target).toBe('B');

    const made = await call('/api/dbs/create', { organisation: 'HR four', centre: 'other', kind: 'hr' });
    const slug = made.body.slug;
    await call('/api/setup/hr', { db: slug, organisation: 'HR four', people: [{ name: 'Fouad', password: 'fouad-hr-1' }], mustChange: false });
    const profiles = (await call(`/api/profiles?db=${slug}`)).body;
    const ck = (await call('/api/login', { db: slug, profileId: profiles[0].id, password: 'fouad-hr-1' }, '')).set!;
    const pid = (await op('hr.person.save', { name: 'Salma', started: '2026-01-01', account: 'CJF', budget_line: 'Staff' }, ck)).body.id;
    await op('hr.pay.save', { personId: pid, validFrom: '2026-01-01', monthlyUsd: 200, weeklyHours: 40 }, ck);

    // insurance: the person and a family member; the end date raises a reminder
    expect((await op('hr.ins.save', { personId: pid, amountUsd: 120, endDate: '2026-12-31' }, ck)).status).toBe(200);
    expect((await op('hr.ins.save', { personId: pid, memberName: 'Her mother', relation: 'mother', amountUsd: 150, endDate: '2027-06-30' }, ck)).status).toBe(200);
    expect((await op('hr.ins.save', { personId: pid, amountUsd: -1 }, ck)).status).toBe(400);
    const ins = (await op('hr.ins.list', {}, ck)).body;
    expect(ins.map((x: { member_name: string | null; amount_usd: number }) => [x.member_name, x.amount_usd])).toEqual([[null, 120], ['Her mother', 150]]);
    const al = (await op('hr.data', { today: '2026-11-20' }, ck)).body.alerts.filter((a: { kind: string }) => a.kind === 'insurance_ending');
    expect(al).toHaveLength(1); // only the one ending within 60 days
    expect(al[0].days).toBe(41);

    // the split must make 100%
    expect((await op('hr.alloc.save', { personId: pid, validFrom: '2026-01-01', parts: [{ target: 'Donor A', pct: 60 }, { target: 'Project B', pct: 30 }] }, ck)).status).toBe(400);
    expect((await op('hr.alloc.save', { personId: pid, validFrom: '2026-01-01', parts: [{ target: 'Donor A', pct: 60 }, { target: 'donor a', pct: 40 }] }, ck)).status).toBe(400);
    expect((await op('hr.alloc.save', { personId: pid, validFrom: '2026-01-01', parts: [{ target: 'Donor A', pct: 60 }, { target: 'Project B', pct: 40 }] }, ck)).status).toBe(200);

    const run = (await op('hr.run.create', { ym: '2026-10', kind: 'monthly', rateSyp: 13000 }, ck)).body.id;
    await op('hr.run.approve', { id: run }, ck);
    const v = (await op('hr.run.voucher', { id: run }, ck)).body;
    expect(v.rows.map((r: { target: string; total_usd: number; amount_paid: number }) => [r.target, r.total_usd, r.amount_paid])).toEqual([['Donor A', 120, 120], ['Project B', 80, 80]]);
    expect(v.total_usd).toBe(200);
    expect(JSON.stringify(v)).not.toContain('Salma');

    // from July the split changes; the report follows the date of each month
    await op('hr.alloc.save', { personId: pid, validFrom: '2026-11-01', parts: [{ target: 'Donor A', pct: 100 }] }, ck);
    const run2 = (await op('hr.run.create', { ym: '2026-11', kind: 'monthly', rateSyp: 13000 }, ck)).body.id;
    await op('hr.run.approve', { id: run2 }, ck);
    expect((await op('hr.alloc.report', { year: 2026 }, ck)).body).toEqual([
      { ym: '2026-10', target: 'Donor A', total_usd: 120 }, { ym: '2026-10', target: 'Project B', total_usd: 80 }, { ym: '2026-11', target: 'Donor A', total_usd: 200 },
    ]);
    expect((await op('hr.alloc.delete', { personId: pid, validFrom: '2026-11-01' }, ck)).status).toBe(200);
    expect((await op('hr.alloc.list', {}, ck)).body).toHaveLength(2);

    // a reader sees none of it
    await op('user.save', { name: 'Reader', access_id: 2, books: [], pin: 'reader-pass-1' }, ck);
    const rp = (await call(`/api/profiles?db=${slug}`)).body.find((p: { name: string }) => p.name === 'Reader');
    const rc = (await call('/api/login', { db: slug, profileId: rp.id, password: 'reader-pass-1' }, '')).set!;
    await op('profile.setPin', { id: rp.id, pin: 'reader-own-2' }, rc);
    expect((await op('hr.ins.list', {}, rc)).status).toBe(400);
    expect((await op('hr.alloc.report', { year: 2026 }, rc)).status).toBe(400);
    expect((await op('hr.data', { today: '2026-11-20' }, rc)).body.alerts.some((a: { kind: string }) => a.kind === 'insurance_ending')).toBe(false);
  });

  it('first and last name, lists from a centre budget, insurance in two currencies with the family apart, Word documents', async () => {
    const { agreementDoc, stipendDoc, payslipsDoc } = await import('../src/hr/docs');
    const made = await call('/api/dbs/create', { organisation: 'HR five', centre: 'other', kind: 'hr' });
    const slug = made.body.slug;
    await call('/api/setup/hr', { db: slug, organisation: 'HR five', people: [{ name: 'Fouad', password: 'fouad-hr-1' }], mustChange: false });
    const profiles = (await call(`/api/profiles?db=${slug}`)).body;
    const ck = (await call('/api/login', { db: slug, profileId: profiles[0].id, password: 'fouad-hr-1' }, '')).set!;

    // a centre with a budget: its account, its heading and lines are copied into the HR lists (names and codes only)
    const centre = await call('/api/dbs/create', { organisation: 'MAGIS Five', centre: 'homs' });
    await call('/api/setup/new', { db: centre.body.slug, organisation: 'MAGIS Five', supName: 'Boss', supPin: 'boss-five-1', comName: 'Clerk', comPin: 'clerk-five-1' });
    const imp = await fetch(`${base}/api/hr/import-lists`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ from: centre.body.slug }) });
    expect(imp.status).toBe(200);
    expect((await imp.json()).centres).toBe(1);
    expect((await (await fetch(`${base}/api/hr/sources`, { headers: { Cookie: ck } })).json()).map((x: { slug: string }) => x.slug)).toContain(centre.body.slug);
    const lists = (await op('hr.data', {}, ck)).body.lists as { kind: string; name: string; code: string | null }[];
    expect(lists.some((x) => x.kind === 'centre' && x.name === 'MAGIS Five')).toBe(true);

    // first and last name make the full name; the role, centre and account must come from the lists
    const id = (await op('hr.person.save', { first_name: 'Salma', last_name: 'Haddad', father_name: 'Ahmad', national_id: '01234567890', address: 'Aleppo', centre: 'MAGIS Five' }, ck)).body.id;
    let person = (await op('hr.data', {}, ck)).body.people.find((x: { id: number }) => x.id === id);
    expect([person.name, person.first_name, person.last_name]).toEqual(['Salma Haddad', 'Salma', 'Haddad']);
    expect((await op('hr.person.save', { id, first_name: 'Salma', last_name: 'Haddad', centre: 'Somewhere else' }, ck)).status).toBe(400);
    await op('hr.list.save', { kind: 'account', name: 'CJF' }, ck);
    expect((await op('hr.person.save', { id, first_name: 'Salma', last_name: 'Haddad', account: 'CJF' }, ck)).status).toBe(200);
    expect((await op('hr.person.save', { id, first_name: 'Salma', last_name: 'Haddad', account: 'XYZ' }, ck)).status).toBe(400);
    await op('hr.grade.seed', {}, ck);
    expect((await op('hr.person.save', { id, first_name: 'Salma', last_name: 'Haddad', role: 'Reception' }, ck)).status).toBe(200);
    expect((await op('hr.person.save', { id, first_name: 'Salma', last_name: 'Haddad', role: 'Astronaut' }, ck)).status).toBe(400);

    // (a save replaces the whole card: the full data again)
    expect((await op('hr.person.save', { id, first_name: 'Salma', last_name: 'Haddad', father_name: 'Ahmad', national_id: '01234567890', address: 'Aleppo', centre: 'MAGIS Five', account: 'CJF', role: 'Reception' }, ck)).status).toBe(200);
    // insurance in either currency; the family is kept apart from the staff member's own
    await op('hr.ins.save', { personId: id, amountUsd: 120, currency: 'USD', endDate: '2027-06-30' }, ck);
    await op('hr.ins.save', { personId: id, memberName: 'Her mother', relation: 'mother', amountUsd: 1500000, currency: 'SYP' }, ck);
    await op('hr.ins.save', { personId: id, memberName: 'Her brother', amountUsd: 90 }, ck);
    const ins = (await op('hr.ins.list', {}, ck)).body as { member_name: string | null; currency: string; paid_by: string }[];
    expect(ins.map((x) => [x.member_name, x.currency, x.paid_by])).toEqual([[null, 'USD', 'centre'], ['Her brother', 'USD', 'staff'], ['Her mother', 'SYP', 'staff']]);

    // the names in Arabic too: the Arabic text of the agreement takes them, the English text the English ones
    expect((await op('hr.person.save', { id, first_name: 'Salma', last_name: 'Haddad', father_name: 'Ahmad', first_name_ar: 'سلمى', last_name_ar: 'حداد', father_name_ar: 'أحمد', address_ar: 'حلب، العزيزية', national_id: '01234567890', address: 'Aleppo, Azizieh', centre: 'MAGIS Five', account: 'CJF', role: 'Reception' }, ck)).status).toBe(200);
    person = (await op('hr.data', {}, ck)).body.people.find((x: { id: number }) => x.id === id);
    expect(person.name_ar).toBe('سلمى حداد');
    expect(person.name).toBe('Salma Haddad');

    // the Word files are real .docx (a zip) holding the person's data, with the centre mark and the Jesuit logo
    const { default: JSZip } = await import('jszip');
    const zipOf = async (bytes: Uint8Array) => JSZip.loadAsync(bytes);
    const textOf = async (bytes: Uint8Array) => (await (await zipOf(bytes)).file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, '');
    const headerText = async (bytes: Uint8Array) => (await Promise.all(Object.keys((await zipOf(bytes)).files).filter((f) => /word\/header\d*\.xml/.test(f)).map(async (f) => (await (await zipOf(bytes)).file(f)!.async('string')).replace(/<[^>]+>/g, '')))).join(' ');
    const centreItem = (await op('hr.data', {}, ck)).body.lists.find((x: { kind: string; name: string }) => x.kind === 'centre' && x.name === 'MAGIS Five');
    expect(centreItem.code).toBe('homs'); // the centre's mark comes from the centre database
    const png = (f: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', f)));
    const head = { centre: centreItem, mark: png('mark-homs.png'), jesuit: png('jesuits.png') };
    const ctx = { person, head, maxWeekly: 40 };
    const agBytes = await agreementDoc(ctx, { id: 1, person_id: id, kind: 'agreement', start_date: '2027-01-01', end_date: '2027-12-31', service: null, amount: 100, currency: 'USD', paid_on: null, note: null, file_name: null, size: null, created_at: '', position: 'Reception', weekly_hours: 30 });
    const agreement = await textOf(agBytes);
    expect(agreement).toContain('اتفاقية تطوع');
    expect(agreement).toContain('سلمى حداد');          // Arabic name in the Arabic text
    expect(agreement).toContain('أحمد');
    expect(agreement).toContain('حلب، العزيزية');
    expect(agreement).toContain('Salma Haddad');       // English name in the English text
    expect(agreement).toContain('01234567890');
    expect(agreement).toContain('01-01-2027');
    expect(agreement).toContain('$100 USD');
    expect(agreement).toContain('الرهبانية اليسوعية – حمص'); // the first party of the centre (Homs: no text of its own yet)
    expect(Object.keys((await zipOf(agBytes)).files).filter((f) => f.startsWith('word/media/')).length).toBeGreaterThanOrEqual(2); // the two logos
    expect(await headerText(agBytes)).toContain('Society of Jesus');
    const letter = await textOf(await stipendDoc(ctx, { id: 2, person_id: id, kind: 'stipend', start_date: '2026-10-01', end_date: null, service: 'Workshop animation', amount: 650000, currency: 'SYP', paid_on: '2026-10-15', note: null, file_name: null, size: null, created_at: '', position: null, weekly_hours: null }));
    expect(letter).toContain('رسالة مكافأة لمرة واحدة');
    expect(letter).toContain('Workshop animation');
    expect(letter).toContain('650,000 SYP');
    const run = { id: 1, ym: '2026-11', kind: 'monthly', rate_syp: 13000, status: 'approved', note: null, created_by: null, approved_at: null, approved_by: null, paid_on: null, paid_by: null, lines: 1, total_usd: 180 } as const;
    const slips = await textOf(await payslipsDoc(run, [{ id: 1, run_id: 1, person_id: id, person_name: 'Salma Haddad', national_id: '01234567890', role: 'Reception', label: null, paper_id: null, weekly_hours: 30, hours_worked: null, base_usd: 180, bonus_usd: 0, deduction_usd: 0, total_usd: 180, paid_in: 'USD', amount_paid: 180, account: null, budget_line: null, note: null }], [person], () => head));
    expect(slips).toContain('سلمى حداد');
    expect(slips).toContain('Salma Haddad');
    expect(slips).toContain('Payslip');
    expect(slips).toContain('180 USD');

    // a centre's own heading: who signs, in both languages
    expect((await op('hr.list.save', { id: centreItem.id, kind: 'centre', name: 'MAGIS Five', code: 'homs', party_ar: 'دير الآباء اليسوعيين في حمص', rep_ar: 'الأب س', rep_en: 'Fr S', city_ar: 'حمص', city_en: 'Homs' }, ck)).status).toBe(200);
    expect((await op('hr.list.save', { id: centreItem.id, kind: 'centre', name: 'MAGIS Five', code: 'mars' }, ck)).status).toBe(400);
    const c2 = (await op('hr.data', {}, ck)).body.lists.find((x: { id: number }) => x.id === centreItem.id);
    const ag2 = await textOf(await agreementDoc({ person, head: { ...head, centre: c2 }, maxWeekly: 40 }, { id: 1, person_id: id, kind: 'agreement', start_date: '2027-01-01', end_date: '2027-12-31', service: null, amount: 100, currency: 'USD', paid_on: null, note: null, file_name: null, size: null, created_at: '', position: null, weekly_hours: null }));
    expect(ag2).toContain('دير الآباء اليسوعيين في حمص يمثله في هذا العقد الأب س');
    expect(ag2).toContain('represented in this agreement by Fr S');
  });

  it('the agreement fixes the stipend at its beginning; it changes from a date; the hourly cost follows', async () => {
    const made = await call('/api/dbs/create', { organisation: 'HR six', centre: 'other', kind: 'hr' });
    const slug = made.body.slug;
    await call('/api/setup/hr', { db: slug, organisation: 'HR six', people: [{ name: 'Fouad', password: 'fouad-hr-1' }], mustChange: false });
    const profiles = (await call(`/api/profiles?db=${slug}`)).body;
    const ck = (await call('/api/login', { db: slug, profileId: profiles[0].id, password: 'fouad-hr-1' }, '')).set!;
    await op('hr.grade.seed', {}, ck);
    const pid = (await op('hr.person.save', { first_name_ar: 'ريم', last_name_ar: 'خوري', started: '2027-01-01' }, ck)).body.id;
    expect((await op('hr.data', {}, ck)).body.people.find((p: { id: number }) => p.id === pid).name).toBe('ريم خوري'); // an Arabic name only is enough

    // the agreement: position Reception (reference 180), but this person is agreed at 170 for 25 hours a week
    expect((await op('hr.paper.save', { personId: pid, kind: 'agreement', start: '2027-01-01', end: '2027-12-31', position: 'Astronaut', amount: 170 }, ck)).status).toBe(400);
    const ag = (await op('hr.paper.save', { personId: pid, kind: 'agreement', start: '2027-01-01', end: '2027-12-31', position: 'Reception', amount: 170, weeklyHours: 25 }, ck)).body.id;
    let pd = (await op('hr.pay.data', {}, ck)).body;
    expect(pd.pays.map((p: { valid_from: string; monthly_usd: number; weekly_hours: number; paper_id: number }) => [p.valid_from, p.monthly_usd, p.weekly_hours, p.paper_id])).toEqual([['2027-01-01', 170, 25, ag]]);
    expect((await op('hr.data', {}, ck)).body.people.find((p: { id: number }) => p.id === pid).role).toBe('Reception');
    // the agreement's line follows the agreement, and cannot be changed or deleted on its own
    await op('hr.paper.save', { id: ag, personId: pid, kind: 'agreement', start: '2027-01-01', end: '2027-12-31', position: 'Reception', amount: 175, weeklyHours: 25 }, ck);
    pd = (await op('hr.pay.data', {}, ck)).body;
    expect(pd.pays).toHaveLength(1);
    expect(pd.pays[0].monthly_usd).toBe(175);
    expect((await op('hr.pay.delete', { id: pd.pays[0].id }, ck)).status).toBe(400);

    // in the middle of the year: 190 from 1 July, 30 hours
    expect((await op('hr.pay.save', { personId: pid, validFrom: '2027-07-01', gradeId: pd.pays[0].grade_id, monthlyUsd: 190, weeklyHours: 30, note: 'more hours' }, ck)).status).toBe(200);
    const { payOn } = await import('../src/hr/pay');
    pd = (await op('hr.pay.data', {}, ck)).body;
    const march = payOn(pd, pid, '2027-03-31')!, august = payOn(pd, pid, '2027-08-31')!;
    expect([march.monthly, march.weekly, march.hourly]).toEqual([175, 25, 1.62]); // 175 x 12 / (25 x 52)
    expect([august.monthly, august.weekly, august.hourly]).toEqual([190, 30, 1.46]);
    // the payroll of each month takes the stipend of that month
    const r3 = (await op('hr.run.create', { ym: '2027-03', kind: 'monthly', rateSyp: 13000 }, ck)).body.id;
    const r8 = (await op('hr.run.create', { ym: '2027-08', kind: 'monthly', rateSyp: 13000 }, ck)).body.id;
    expect((await op('hr.run.get', { id: r3 }, ck)).body.lines[0].total_usd).toBe(175);
    expect((await op('hr.run.get', { id: r8 }, ck)).body.lines[0].total_usd).toBe(190);
    // deleting the agreement removes its line (the change of July stays)
    await op('hr.paper.delete', { id: ag }, ck);
    expect((await op('hr.pay.data', {}, ck)).body.pays.map((p: { valid_from: string }) => p.valid_from)).toEqual(['2027-07-01']);
  });

  it('the staff list for the budget: by centre, position and amount, the months and the 13th in proportion, no names', async () => {
    const made = await call('/api/dbs/create', { organisation: 'HR seven', centre: 'other', kind: 'hr' });
    const slug = made.body.slug;
    await call('/api/setup/hr', { db: slug, organisation: 'HR seven', people: [{ name: 'Fouad', password: 'fouad-hr-1' }], mustChange: false });
    const profiles = (await call(`/api/profiles?db=${slug}`)).body;
    const ck = (await call('/api/login', { db: slug, profileId: profiles[0].id, password: 'fouad-hr-1' }, '')).set!;
    await op('hr.grade.seed', {}, ck);
    await op('hr.list.save', { kind: 'centre', name: 'MAGIS Aleppo', code: 'aleppo' }, ck);
    const mk = async (name: string, amount: number, start = '2027-01-01') => {
      const id = (await op('hr.person.save', { first_name: name, centre: 'MAGIS Aleppo', started: start }, ck)).body.id;
      await op('hr.paper.save', { personId: id, kind: 'agreement', start, end: '2027-12-31', position: 'Reception', amount, weeklyHours: 30 }, ck);
      return id;
    };
    await mk('Secret One', 180);
    await mk('Secret Two', 180);
    const late = await mk('Secret Three', 180, '2027-07-01'); // 6 months
    await op('hr.pay.save', { personId: late, validFrom: '2027-10-01', monthlyUsd: 200, weeklyHours: 30 }, ck); // 3 at 180, 3 at 200
    const r = (await op('hr.budget.staff', { year: 2027 }, ck)).body;
    expect(JSON.stringify(r)).not.toContain('Secret');
    expect(r.rows.map((x: { position: string; monthly: number; months: number; people: number; times: number; total: number }) => [x.position, x.monthly, x.months, x.people, x.times, x.total])).toEqual([
      ['Reception', 200, 3, 1, 3.25, 650],
      ['Reception', 180, 12, 2, 13, 4680],
      ['Reception', 180, 3, 1, 3.25, 585],
    ]);
  });

  it('a person can be deleted, with everything about them, unless already paid in an approved run', async () => {
    const made = await call('/api/dbs/create', { organisation: 'HR eight', centre: 'other', kind: 'hr' });
    const slug = made.body.slug;
    await call('/api/setup/hr', { db: slug, organisation: 'HR eight', people: [{ name: 'Fouad', password: 'fouad-hr-1' }], mustChange: false });
    const profiles = (await call(`/api/profiles?db=${slug}`)).body;
    const ck = (await call('/api/login', { db: slug, profileId: profiles[0].id, password: 'fouad-hr-1' }, '')).set!;
    await op('hr.grade.seed', {}, ck);
    const mk = async (name: string) => {
      const id = (await op('hr.person.save', { first_name: name, started: '2026-01-01' }, ck)).body.id as number;
      await op('hr.paper.save', { personId: id, kind: 'agreement', start: '2026-01-01', end: '2026-12-31', position: 'Cook', amount: 200, weeklyHours: 36 }, ck);
      await op('hr.ins.save', { personId: id, amountUsd: 100 }, ck);
      return id;
    };
    const mistake = await mk('Typed by mistake');
    const paid = await mk('Already paid');
    const run = (await op('hr.run.create', { ym: '2026-10', kind: 'monthly', rateSyp: 13000 }, ck)).body.id;
    expect((await op('hr.run.get', { id: run }, ck)).body.lines).toHaveLength(2);
    // in a draft run: the person goes, with their line
    expect((await op('hr.person.delete', { id: mistake }, ck)).status).toBe(200);
    const d = (await op('hr.data', {}, ck)).body;
    expect(d.people.map((p: { id: number }) => p.id)).toEqual([paid]);
    expect(d.papers.every((p: { person_id: number }) => p.person_id === paid)).toBe(true);
    expect((await op('hr.pay.data', {}, ck)).body.pays.every((p: { person_id: number }) => p.person_id === paid)).toBe(true);
    expect((await op('hr.ins.list', {}, ck)).body).toHaveLength(1);
    expect((await op('hr.run.get', { id: run }, ck)).body.lines).toHaveLength(1);
    // once approved, the history stays: refused
    await op('hr.run.approve', { id: run }, ck);
    expect((await op('hr.person.delete', { id: paid }, ck)).status).toBe(400);
    expect((await op('hr.access.list', {}, ck)).body.some((l: { action: string; what: string; detail: string }) => l.action === 'delete' && l.what === 'person' && l.detail === 'Typed by mistake')).toBe(true);
  });

  it('an approved payroll goes into the centre accounts: totals per account, line and currency, no names; and can be taken back', async () => {
    // a centre with an account, a city and a salary heading of two lines (like Homs: lines by position)
    const centre = (await call('/api/dbs/create', { organisation: 'MAGIS Nine', centre: 'homs' })).body.slug;
    await call('/api/setup/new', { db: centre, organisation: 'MAGIS Nine', supName: 'Boss', supPin: 'boss-nine-1', comName: 'Clerk', comPin: 'clerk-nine-1' });
    const bossId = (await call(`/api/profiles?db=${centre}`)).body.find((p: { name: string }) => p.name === 'Boss').id;
    const boss = (await call('/api/login', { db: centre, profileId: bossId, password: 'boss-nine-1' }, '')).set!;
    await op('list.add', { table: 'account', name: 'Center' }, boss);
    await op('list.add', { table: 'city', name: 'Homs' }, boss);
    const hid = (await op('heading.add', { name: 'Salary', types: ['Exp'] }, boss)).body;
    const headingId = typeof hid === 'number' ? hid : hid?.id ?? (await op('data', {}, boss)).body.lists.headings.find((h: { name: string }) => h.name === 'Salary').id;
    await op('line.add', { headingId, name: 'Reception' }, boss);
    await op('line.add', { headingId, name: 'Cleaner' }, boss);

    const made = await call('/api/dbs/create', { organisation: 'HR nine', centre: 'other', kind: 'hr' });
    const slug = made.body.slug;
    await call('/api/setup/hr', { db: slug, organisation: 'HR nine', people: [{ name: 'Fouad', password: 'fouad-hr-1' }], mustChange: false });
    const hrId = (await call(`/api/profiles?db=${slug}`)).body[0].id;
    const ck = (await call('/api/login', { db: slug, profileId: hrId, password: 'fouad-hr-1' }, '')).set!;
    const post = async (url: string, body: unknown) => { const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    expect((await post('/api/hr/import-lists', { from: centre })).status).toBe(200);
    // a line switched off in the centre leaves the HR list at the next copy
    await op('line.add', { headingId, name: 'Old line by name' }, boss);
    expect((await post('/api/hr/import-lists', { from: centre })).status).toBe(200);
    const oldLine = (await op('data', {}, boss)).body.lists.lines.find((l: { name: string }) => l.name === 'Old line by name');
    await op('list.setActive', { table: 'budget_line', id: oldLine.id, active: false }, boss);
    expect((await post('/api/hr/import-lists', { from: centre })).status).toBe(200);
    expect((await op('hr.data', {}, ck)).body.lists.some((x: { name: string }) => x.name === 'Old line by name')).toBe(false);
    const c = (await op('hr.data', {}, ck)).body.lists.find((x: { kind: string; name: string }) => x.kind === 'centre' && x.name === 'MAGIS Nine');
    expect([c.salary_heading, c.account]).toEqual(['Salary', 'Center']); // found by itself
    // the positions can come from the salary lines of the budget (never an insurance line)
    await op('line.add', { headingId, name: 'Health insurance (all staff)' }, boss);
    expect((await post('/api/hr/import-lists', { from: centre })).status).toBe(200);
    const found = await (await fetch(`${base}/api/hr/positions-from-budget`, { headers: { Cookie: ck } })).json();
    expect(found.map((x: { name: string }) => x.name).sort()).toEqual(['Cleaner', 'Reception']);
    expect(found.every((x: { exists: boolean; centres: string[] }) => !x.exists && x.centres[0] === 'MAGIS Nine')).toBe(true);
    await op('hr.grade.seed', {}, ck);
    const mk = async (first: string, role: string, amount: number) => {
      const id = (await op('hr.person.save', { first_name: first, centre: 'MAGIS Nine', role, started: '2026-01-01' }, ck)).body.id;
      await op('hr.paper.save', { personId: id, kind: 'agreement', start: '2026-01-01', end: '2026-12-31', position: role, amount, weeklyHours: 30 }, ck);
      return id;
    };
    await mk('Nadia', 'Reception', 180);
    await mk('Rami', 'Reception', 170);
    const cl = await mk('Hanan', 'Cleaner', 150);
    const run = (await op('hr.run.create', { ym: '2026-10', kind: 'monthly', rateSyp: 13000 }, ck)).body.id;
    const lines = (await op('hr.run.get', { id: run }, ck)).body.lines;
    await op('hr.run.line.save', { id: lines.find((l: { person_id: number }) => l.person_id === cl).id, paidIn: 'SYP' }, ck);
    expect((await post('/api/hr/send-run', { runId: run })).status).toBe(400); // approve first
    await op('hr.run.approve', { id: run }, ck);
    const sent = await post('/api/hr/send-run', { runId: run });
    expect(sent.status).toBe(200);
    expect(sent.body.sent).toEqual([{ centre, rows: 2, total_usd: 500 }]);
    // in the centre's register: two expenses, with the right line, account and currency, and no names
    const rows = ((await op('data', {}, boss)).body.rows as { explanation: string; exp_usd: number; exp_syp: number; line_id: number; source_file: string }[]).filter((r) => r.source_file === `hr-run:${run}`);
    const data = (await op('data', {}, boss)).body;
    const lineName = (id: number) => data.lists.lines.find((l: { id: number }) => l.id === id).name;
    expect(rows.map((r) => [lineName(r.line_id), r.exp_usd, r.exp_syp]).sort()).toEqual([['Cleaner', 0, 1950000], ['Reception', 350, 0]]);
    expect(JSON.stringify(rows)).not.toMatch(/Nadia|Rami|Hanan/);
    expect(rows[0].explanation).toContain('Stipends 2026-10');
    // sent once only; a sent run cannot be reopened; taken back, the rows leave the centre
    expect((await post('/api/hr/send-run', { runId: run })).body.sent).toEqual([]);
    expect((await op('hr.run.get', { id: run }, ck)).body.sent).toHaveLength(1);
    expect((await op('hr.run.reopen', { id: run }, ck)).status).toBe(400);
    expect((await post('/api/hr/take-back', { runId: run, centre })).body.removed).toBe(2);
    expect(((await op('data', {}, boss)).body.rows as { source_file: string }[]).filter((r) => r.source_file === `hr-run:${run}`)).toHaveLength(0);
    // a line or account of another centre on the card is not used: the centre's own (guessed) ones are
    const { lineFor, accountFor } = await import('../src/hr/link');
    const lists = (await op('hr.data', {}, ck)).body.lists;
    const stray = { centre: 'MAGIS Nine', budget_line: 'E99.1 · Somewhere else', account: 'Other centre', role: 'Cleaner', first_name: 'X', first_name_ar: null, name: 'X' };
    expect(lineFor(lists, stray).line?.name).toBe('Cleaner');
    // several salary headings; the position found word by word, the shortest line first
    const two = [
      { id: 1, kind: 'centre', name: 'C', code: 'aleppo', heading: null, source: 'c', salary_heading: 'Implementation staff | Operational staff', account: 'CEI' },
      { id: 2, kind: 'line', name: 'Health insurance (IT and media staff)', code: 'E02.8', heading: 'Implementation staff', source: 'c' },
      { id: 3, kind: 'line', name: 'IT person', code: 'E02.6', heading: 'Implementation staff', source: 'c' },
      { id: 4, kind: 'line', name: 'Centre Director', code: 'E03.1', heading: 'Operational staff', source: 'c' },
      { id: 5, kind: 'line', name: 'English courses', code: 'E04.1', heading: 'Activities', source: 'c' },
    ] as never;
    expect(lineFor(two, { centre: 'C', role: 'IT', budget_line: null, first_name: null, first_name_ar: null, name: 'x' }).line?.code).toBe('E02.6');
    expect(lineFor(two, { centre: 'C', role: 'Centre Director', budget_line: null, first_name: null, first_name_ar: null, name: 'x' }).line?.code).toBe('E03.1');
    expect(lineFor(two, { centre: 'C', role: 'Media', budget_line: null, first_name: null, first_name_ar: null, name: 'x' }).line).toBeNull(); // no "Media person" line here, and never the insurance line
    expect(accountFor(lists, stray)).toBe('Center');
    // a person without a line that fits says what is missing
    await mk('Odd', 'Cook', 200);
    const run2 = (await op('hr.run.create', { ym: '2026-11', kind: 'monthly', rateSyp: 13000 }, ck)).body.id;
    await op('hr.run.approve', { id: run2 }, ck);
    const bad = await post('/api/hr/send-run', { runId: run2 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.en).toContain('Odd: budget line');
    // one centre at a time: a centre with nobody in this run sends nothing
    expect((await post('/api/hr/send-run', { runId: run2, centre: 'no-such-centre' })).body.sent).toEqual([]);
  });
});
