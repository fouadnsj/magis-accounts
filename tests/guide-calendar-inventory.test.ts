// The guide sections of the new Calendar and the new Inventory (24 November 2026): in the accounts' guide, in three languages,
// with the words Fouad asked for ("Receipt", never invoice; "prepare", never clean).
import { describe, expect, it } from 'vitest';
import { ACCOUNTS_GUIDE } from '../src/guide/content';
import { CALENDAR_GUIDE, INVENTORY_GUIDE } from '../src/guide/calendarInventory';

describe('guide: calendar and inventory', () => {
  it('both sections are in the accounts guide, with unique ids', () => {
    const ids = ACCOUNTS_GUIDE.map((x) => x.id);
    expect(ids).toContain('calendar');
    expect(ids).toContain('inventory-new');
    expect(new Set(ids).size).toBe(ids.length);
  });
  for (const sec of [CALENDAR_GUIDE, INVENTORY_GUIDE]) {
    it(`${sec.id}: every title and text in Arabic, English and French`, () => {
      expect(sec.steps.length).toBeGreaterThan(8);
      for (const x of [sec.title, sec.intro, ...sec.steps.flatMap((st) => [st.title, st.text])]) {
        expect(x.ar.length).toBeGreaterThan(1);
        expect(x.en.length).toBeGreaterThan(1);
        expect((x.fr ?? '').length).toBeGreaterThan(1);
        expect(/[؀-ۿ]/.test(x.ar)).toBe(true);
      }
    });
    it(`${sec.id}: no "invoice" and no "clean"`, () => {
      const all = JSON.stringify(sec).toLowerCase();
      expect(all).not.toMatch(/invoice|clean|facture|nettoy/);
    });
  }
  it('the calendar says Receipt', () => {
    expect(JSON.stringify(CALENDAR_GUIDE)).toContain('Receipt');
  });
});
