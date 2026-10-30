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
    // grade 1 (1.15) for a guard of 48 hours: 239 rounded to 240; the cleaner of 36 hours: 179 rounded to 180
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
    expect(d.grades.map((g: { name: string; rates: Record<string, number> }) => [g.name, g.rates['2027']])).toEqual([['Grade 1', 1.15], ['Grade 2', 1.3], ['Grade 3', 1.4], ['Grade 4', 1.65]]);
    expect(d.settings).toEqual({ paymentsPerYear: 13, roundTo: 5, maxWeekly: 40 });

    // a pay needs a grade or an amount; a grade needs weekly hours
    expect((await op('hr.pay.save', { personId: pid, validFrom: '2027-01-01' }, ck)).status).toBe(400);
    expect((await op('hr.pay.save', { personId: pid, validFrom: '2027-01-01', gradeId: 1 }, ck)).status).toBe(400);
    expect((await op('hr.pay.save', { personId: pid, validFrom: '2027-01-01', gradeId: 1, weeklyHours: 48 }, ck)).status).toBe(200);
    // a change of hours later keeps the history
    expect((await op('hr.pay.save', { personId: pid, validFrom: '2027-07-01', gradeId: 1, weeklyHours: 40 }, ck)).status).toBe(200);
    d = (await op('hr.pay.data', {}, ck)).body;
    expect(d.pays.map((p: { valid_from: string; weekly_hours: number }) => [p.valid_from, p.weekly_hours])).toEqual([['2027-01-01', 48], ['2027-07-01', 40]]);

    // a grade in use cannot be deleted; an unused one can
    expect((await op('hr.grade.delete', { id: 1 }, ck)).status).toBe(400);
    expect((await op('hr.grade.delete', { id: 4 }, ck)).status).toBe(200);
    // a new year's rate on an existing grade
    expect((await op('hr.grade.save', { id: 1, name: 'Grade 1', rates: { '2028': 1.2 } }, ck)).status).toBe(200);
    expect((await op('hr.grade.save', { id: 1, name: 'Grade 1', rates: { '2028': 0 } }, ck)).status).toBe(400);

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
    await op('hr.pay.save', { personId: g, validFrom: '2026-01-01', gradeId: 1, weeklyHours: 48 }, ck);   // 240
    await op('hr.pay.save', { personId: r, validFrom: '2026-01-01', gradeId: 3, weeklyHours: 30 }, ck);   // 180
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
      ['Guard One', 240, null], ['Reception One', 180, null], ['Reception One', 50, 'Stipend: Workshop'],
    ]);
    expect(got.lines[0].hours_worked).toBe(205);
    expect(got.lines[2]).toMatchObject({ paid_in: 'SYP', amount_paid: 650000 });

    // an occasional bonus on a line; paying the guard in pounds rounds to 1,000
    const gl = got.lines[0].id;
    expect((await op('hr.run.line.save', { id: gl, bonusUsd: 20, paidIn: 'SYP' }, ck)).body).toEqual({ total: 260, paid: 3380000 });
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
      { account: 'CJF', budget_line: 'Staff - Guards', paid_in: 'SYP', total_usd: 260, amount_paid: 3380000 },
      { account: 'CJF', budget_line: 'Staff - Reception', paid_in: 'SYP', total_usd: 50, amount_paid: 650000 },
      { account: 'CJF', budget_line: 'Staff - Reception', paid_in: 'USD', total_usd: 195, amount_paid: 195 },
    ]);
    expect(v.total_usd).toBe(505);

    // the 13th payment is a run of its own
    expect((await op('hr.run.create', { ym: '2026-12', kind: 'thirteenth', rateSyp: 13000 }, ck)).status).toBe(200);
    const th = (await op('hr.run.list', {}, ck)).body;
    expect(th.map((x: { ym: string; kind: string; status: string; total_usd: number }) => [x.ym, x.kind, x.status, x.total_usd])).toEqual([['2026-12', 'thirteenth', 'draft', 420], ['2026-11', 'monthly', 'paid', 505]]);
  });
});
