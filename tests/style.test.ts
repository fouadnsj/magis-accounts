// A community's look and place (Fouad, 19 October 2026): one colour or a set of colours,
// its address and city; only the Administrator changes them; country names in three languages.
import { describe, expect, it } from 'vitest';
import { runOp } from '../src/ops';
import { getMeta } from '../src/db/repo';
import { PALETTES, paletteFrom, paletteOf, whiteContrast } from '../src/community/style';
import { currencyOf, sameCountry } from '../src/community/places';
import { nodeDb } from './nodeDb';
import { makeCommunity } from './ctyHelpers';

describe('community style', () => {
  it('keeps the colours, address and city chosen at creation, and shows them in its data', async () => {
    const db = nodeDb();
    const ctx = await makeCommunity(db, 'Demo community', ['Paul', 'Marc'], { admin: 'Paul' }, { style: { color: '#2E7D5B', palette: PALETTES[2].p, address: '1 Demo street', city: 'Homs' } });
    expect(await getMeta(db, 'brand_color')).toBe('#2E7D5B');
    expect(await getMeta(db, 'address')).toBe('1 Demo street');
    const d = await runOp(ctx.Paul, 'cty.data', {}) as { style: { palette: string; city: string } };
    expect(JSON.parse(d.style.palette)).toEqual(PALETTES[2].p);
    expect(d.style.city).toBe('Homs');
  });

  it('only the Administrator changes them; a wrong colour is refused', async () => {
    const db = nodeDb();
    const ctx = await makeCommunity(db, 'Demo community', ['Paul', 'Marc'], { admin: 'Paul', econome: 'Marc', minister: 'Marc', superior: 'Marc' });
    await expect(runOp(ctx.Econome, 'cty.style.save', { color: '#123456' })).rejects.toThrow();
    await expect(runOp(ctx.Admin, 'cty.style.save', { color: 'red' })).rejects.toThrow();
    await runOp(ctx.Admin, 'cty.style.save', { color: '#123456', palette: null, address: 'New street' });
    expect(await getMeta(db, 'brand_color')).toBe('#123456');
    expect(await getMeta(db, 'brand_palette')).toBeNull();
    expect(await getMeta(db, 'address')).toBe('New street');
  });

  it('one colour gives readable shades; a broken value falls back on gold', () => {
    const p = paletteFrom('#FFF59D'); // a very light yellow
    expect(whiteContrast(p.main)).toBeGreaterThanOrEqual(3);
    expect(whiteContrast(p.deep)).toBeGreaterThanOrEqual(4.5);
    expect(paletteOf(null, 'not json')).toEqual(PALETTES[0].p);
  });

  it('a country is the same in Arabic, English and French', () => {
    expect(sameCountry('سوريا', 'Syria')).toBe(true);
    expect(sameCountry('Syrie', 'syria')).toBe(true);
    expect(sameCountry('Liban', 'Syria')).toBe(false);
    expect(sameCountry('Atlantis', 'atlantis')).toBe(true);
    expect(currencyOf('مصر')).toBe('EGP');
  });
});
