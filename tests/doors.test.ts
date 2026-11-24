// The doors page (24 November 2026): which doors a person sees, the ready-made roles, the warm sentences.
import { describe, expect, it } from 'vitest';
import { ALL_PERMS, withImplied, type Perm } from '../src/perms';
import { DOOR_ORDER, READY_ROLES, doorsOf, type DoorKey } from '../src/doors';
import { SENTENCES, pickSentences, sentencesFor } from '../src/ui/doorSentences';

const ticks = (ps: Perm[]) => (p: Perm) => withImplied(ps).includes(p);
const doorsFor = (ps: Perm[], o: { hasBook?: boolean; inventoryOn?: boolean; hr?: boolean; people?: boolean } = {}) => doorsOf({ can: ticks(ps), hasBook: !!o.hasBook, inventoryOn: o.inventoryOn ?? true, hr: !!o.hr, people: !!o.people });
const role = (k: string) => READY_ROLES.find((r) => r.key === k)!;

describe('which doors a person sees', () => {
  it('the ready-made roles open the doors Fouad named', () => {
    expect(doorsFor(role('director').perms, { hr: true })).toEqual(['accounts', 'calendar', 'inventory', 'hr']);
    expect(doorsFor(role('accountant').perms, { hasBook: true })).toEqual(['accounts', 'calendar']);
    expect(doorsFor(role('reception').perms)).toEqual(['calendar']);
    expect(doorsFor(role('keeper').perms)).toEqual(['inventory']);
    expect(doorsFor(role('coordinator').perms)).toEqual(['calendar', 'inventory']);
  });
  it('the doors come in the page’s order, and a person with nothing has none', () => {
    expect(doorsFor(ALL_PERMS.filter((p) => !p.startsWith('hr.')), { hasBook: true, hr: true, people: true })).toEqual(DOOR_ORDER);
    expect(doorsFor([])).toEqual([]);
    expect(doorsFor(['users.manage'])).toEqual([]);
  });
  it('the fifth door, "Administration", comes from holding the role Administrator or Director, last in the row', () => {
    expect(DOOR_ORDER[DOOR_ORDER.length - 1]).toBe('admin');
    expect(doorsFor(role('director').perms, { people: true })).toEqual(['accounts', 'calendar', 'inventory', 'admin']);
    expect(doorsFor([], { people: true })).toEqual(['admin']);
  });
  it('the inventory door needs the inventory in this database; HR needs a place in an HR database', () => {
    expect(doorsFor(role('keeper').perms, { inventoryOn: false })).toEqual([]);
    expect(doorsFor([], { hr: true })).toEqual(['hr']);
  });
  it('a book holder sees Accounts; an old 0.12 calendar tick alone opens no new door', () => {
    expect(doorsFor(['book.own'], { hasBook: true })).toEqual(['accounts']);
    expect(doorsFor(['hosting.view'])).toEqual([]);
  });
});

describe('the ready-made roles', () => {
  it('use only known ticks', () => {
    for (const r of READY_ROLES) for (const p of r.perms) expect(ALL_PERMS, `${r.key}: ${p}`).toContain(p);
  });
  it('follow the calendar baseline (section 3)', () => {
    const cal = (k: string) => withImplied(role(k).perms).filter((p) => p.startsWith('cal.')).sort();
    expect(cal('director')).toEqual(['cal.view', 'cal.contacts', 'cal.programme', 'cal.outside', 'cal.orgs', 'cal.arrive', 'cal.prices', 'cal.money', 'cal.whole', 'cal.setup', 'cal.history'].sort());
    expect(cal('coordinator')).toEqual(['cal.view', 'cal.contacts', 'cal.programme', 'cal.outside', 'cal.orgs', 'cal.prices', 'cal.money'].sort());
    expect(cal('reception')).toEqual(['cal.view', 'cal.contacts', 'cal.outside', 'cal.orgs', 'cal.arrive'].sort());
    // reception never sees prices or payments, and never books the whole centre or sets up spaces
    for (const p of ['cal.prices', 'cal.money', 'cal.whole', 'cal.setup', 'cal.history', 'cal.programme'] as Perm[]) expect(withImplied(role('reception').perms)).not.toContain(p);
    expect(cal('accountant')).toEqual(['cal.view']);
  });
  it('follow the inventory baseline (section 2): only the keeper changes it; the Coordinator looks without the values', () => {
    const inv = (k: string) => withImplied(role(k).perms).filter((p) => p.startsWith('inventory.')).sort();
    expect(inv('keeper')).toEqual(['inventory.manage', 'inventory.values', 'inventory.view']);
    expect(inv('director')).toEqual(['inventory.values', 'inventory.view']);
    expect(inv('coordinator')).toEqual(['inventory.view']);
    expect(inv('reception')).toEqual([]);
    expect(inv('accountant')).toEqual([]);
  });
  it('have a name in two languages, "Arabic · English", and a sentence about them', () => {
    const names = new Set(READY_ROLES.map((r) => r.name));
    expect(names.size).toBe(READY_ROLES.length);
    for (const r of READY_ROLES) {
      expect(r.name.split(' · ')).toHaveLength(2);
      expect(r.about.ar && r.about.en && r.about.fr).toBeTruthy();
    }
  });
});

describe('the warm sentences', () => {
  it('each has Arabic, English and French, a source, and a unique id', () => {
    const ids = new Set<string>();
    for (const s of SENTENCES) {
      expect(ids.has(s.id), s.id).toBe(false);
      ids.add(s.id);
      expect(s.msg.ar.trim().length, s.id).toBeGreaterThan(5);
      expect(s.msg.en.trim().length, s.id).toBeGreaterThan(5);
      expect((s.msg.fr ?? '').trim().length, s.id).toBeGreaterThan(5);
      expect(s.source.trim().length, s.id).toBeGreaterThan(3);
      expect(/[؀-ۿ]/.test(s.msg.ar), s.id).toBe(true);
    }
  });
  it('an original says so; a testimony shows no name; nothing speaks the NGO language Fouad refuses', () => {
    for (const s of SENTENCES) {
      if (s.kind === 'original') expect(s.source).toBe('original');
      else expect(s.source).not.toBe('original');
      if (s.kind === 'testimony') expect(s.by, s.id).toBeTruthy();
      for (const w of ['resilience', 'empower', 'impact', 'capacity-building', 'invoice', 'clean']) expect(`${s.msg.en} ${s.msg.fr}`.toLowerCase(), s.id).not.toContain(w);
    }
  });
  it('every door and the heading of every house has several sentences to draw from', () => {
    for (const centre of ['jaramana', 'aleppo', 'homs', 'alard', 'other']) {
      expect(sentencesFor('centre', centre).length, `heading ${centre}`).toBeGreaterThanOrEqual(2);
      for (const d of DOOR_ORDER) expect(sentencesFor(d as DoorKey, centre).length, `${d} ${centre}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('a sentence of one centre’s logo is shown only with that centre', () => {
    for (const s of SENTENCES.filter((x) => x.centre)) {
      for (const c of ['jaramana', 'aleppo', 'homs', 'alard', 'other']) {
        const all = [...DOOR_ORDER, 'centre' as const].flatMap((slot) => sentencesFor(slot, c));
        expect(all.includes(s), `${s.id} with ${c}`).toBe(s.centre === c && all.includes(s));
      }
    }
  });
  it('the page draws one for each slot, never the same twice, and not the one of the last visit', () => {
    for (let i = 0; i < 60; i++) {
      const seen: Record<string, string> = {};
      let first: ReturnType<typeof pickSentences> | null = null;
      for (let visit = 0; visit < 4; visit++) {
        const slots = ['centre', ...DOOR_ORDER] as (DoorKey | 'centre')[];
        const got = pickSentences(slots, 'homs', seen);
        const ids = slots.map((s) => got[s].id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const s of slots) { if (first) expect(got[s].id, `${s} visit ${visit}`).not.toBe(seen[s]); seen[s] = got[s].id; }
        first = got;
      }
    }
  });
});
