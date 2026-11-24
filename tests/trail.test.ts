// "Where am I" line (25 November 2026): Door › Page › Part, from the menus' names and what a page says it shows inside.
import { describe, expect, it } from 'vitest';
import { buildTrail } from '../src/trail';

const labels = (t: { label: string }[]) => t.map((c) => c.label);
const door = (go = () => undefined) => ({ label: 'Accounts', go });

describe('buildTrail', () => {
  it('door › page, the page being the place (no link)', () => {
    const t = buildTrail(door(), { label: 'Reports' }, null);
    expect(labels(t)).toEqual(['Accounts', 'Reports']);
    expect(t[0].go).toBeTypeOf('function');
    expect(t[1].go).toBeUndefined();
  });
  it('door › page › tab: the page leads back to its list when it says how', () => {
    let back = 0;
    const t = buildTrail(door(), { label: 'Reports' }, { extra: [{ label: 'Monthly' }], pageGo: () => { back++; } });
    expect(labels(t)).toEqual(['Accounts', 'Reports', 'Monthly']);
    t[1].go!();
    expect(back).toBe(1);
    expect(t[2].go).toBeUndefined();
  });
  it('a page with the door\'s own name is not said twice, and the door then leads back to the list', () => {
    let back = 0;
    const t = buildTrail({ label: 'Inventory', go: () => undefined }, { label: 'Inventory' }, { extra: [{ label: 'Spaces' }, { label: 'Sample Bedroom 3' }], pageGo: () => { back++; } });
    expect(labels(t)).toEqual(['Inventory', 'Spaces', 'Sample Bedroom 3']);
    t[0].go!();
    expect(back).toBe(1);
  });
  it('the page alone (no door)', () => {
    expect(labels(buildTrail(null, { label: 'Guide' }, null))).toEqual(['Guide']);
  });
});
