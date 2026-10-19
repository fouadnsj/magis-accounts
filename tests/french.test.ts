// French for the MAGIS centres' screens (i18n-fr.ts): exact texts and texts with a number inside.
import { describe, expect, it } from 'vitest';
import { frOf, m, txIn } from '../src/i18n';

describe('French', () => {
  it('finds the French of a centre text, also with numbers and names inside', () => {
    expect(frOf('Month closing')).toBe('Clôture des mois');
    expect(frOf('40 rows need review')).toBe('40 lignes à vérifier');
    expect(frOf('Close 2026-09 — Roula')).toBe('Clôturer 2026-09 — Roula');
    expect(frOf('From $50: attach the document (invoice) to this entry.')).toBe('À partir de 50 $ : joignez le document (facture) à cette écriture.');
    expect(frOf('A text nobody wrote')).toBe('A text nobody wrote');
  });
  it('a text with its own French keeps it; the other modes do not change', () => {
    expect(txIn(m('شهري', 'Monthly', 'Par mois'), 'fr')).toBe('Par mois');
    expect(txIn(m('شهرياً', 'Monthly'), 'fr')).toBe('Mensuel');
    expect(txIn(m('شهرياً', 'Monthly'), 'en')).toBe('Monthly');
    expect(txIn(m('شهرياً', 'Monthly'), 'both')).toBe('شهرياً · Monthly');
  });
});
