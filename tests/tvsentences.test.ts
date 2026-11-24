// The welcome phrases of the TV screen (src/hosting/tvSentences.ts): every one has a source or is marked original, in three languages,
// no testimony, none of the words Fouad does not use, and the order is the same on every screen of a centre for a day.
import { describe, expect, it } from 'vitest';
import { TV_SENTENCES, tvGreeting, tvPhrases } from '../src/hosting/tvSentences';

describe('the TV welcome phrases', () => {
  it('each phrase has its source (or is marked original) and the three languages', () => {
    expect(TV_SENTENCES.length).toBeGreaterThanOrEqual(30);
    const ids = new Set<string>();
    for (const s of TV_SENTENCES) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.msg.ar.length).toBeGreaterThan(5);
      expect(s.msg.en.length).toBeGreaterThan(5);
      expect((s.msg.fr ?? '').length).toBeGreaterThan(5);
      expect(s.source.length).toBeGreaterThan(0);
      expect(s.kind === 'original' ? s.source.startsWith('original') || !!s.fromDoors : s.source.length > 10).toBe(true);
    }
  });

  it('no testimony (a screen at the entrance is seen by everyone), no number, no name, none of the buzzwords', () => {
    for (const s of TV_SENTENCES) {
      expect(s.kind).not.toBe('testimony');
      const all = `${s.msg.ar} ${s.msg.en} ${s.msg.fr}`;
      expect(all).not.toMatch(/\d/);
      expect(all).not.toMatch(/resilien|empower|impact|capacity|résilience|autonomis|renforcement des capacités/i);
    }
  });

  it('a centre’s own sentences are shown only with that centre; every centre has plenty', () => {
    const homs = tvPhrases('homs', '2026-11-26').map((p) => p.en);
    const aleppo = tvPhrases('aleppo', '2026-11-26').map((p) => p.en);
    expect(homs).toContain('Two open hands: the identity of this place rests on welcome.');
    expect(aleppo).not.toContain('Two open hands: the identity of this place rests on welcome.');
    expect(aleppo).toContain('The gates that open only when a person is there.');
    for (const c of ['homs', 'aleppo', 'jaramana', 'alard', 'other', null]) expect(tvPhrases(c, '2026-11-26').length).toBeGreaterThanOrEqual(20);
  });

  it('the same order for the same day and centre (all the screens agree), another one tomorrow', () => {
    const a = tvPhrases('homs', '2026-11-26'), b = tvPhrases('homs', '2026-11-26'), c = tvPhrases('homs', '2026-11-27');
    expect(a).toEqual(b);
    expect(c.map((x) => x.en)).not.toEqual(a.map((x) => x.en));
    expect(new Set(c.map((x) => x.en))).toEqual(new Set(a.map((x) => x.en)));
  });

  it('the greeting follows the hour', () => {
    expect(tvGreeting(9 * 60).en).toBe('Good morning');
    expect(tvGreeting(14 * 60).en).toBe('Welcome');
    expect(tvGreeting(19 * 60).en).toBe('Good evening');
  });
});
