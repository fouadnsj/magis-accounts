// The heading and the line suggested for an income entry (Fouad, 26 November 2026). Nothing real: invented lists.
import { describe, expect, it } from 'vitest';
import { incomeClassForPay, incomeHeading, onlyIncomeClass, payHint } from '../src/domain/incomeClass';

const H = (id: number, code: string, active = 1) => ({ id, code, active });
const T = (id: number, type: 'Income' | 'Exp' | 'Transfer') => ({ heading_id: id, type });
const Ln = (id: number, heading_id: number, code: string, active = 1) => ({ id, heading_id, code, active });
const centre = {
  headings: [H(1, 'I01'), H(3, 'E02'), H(4, 'E03')],
  headingTypes: [T(1, 'Income'), T(3, 'Income'), T(3, 'Exp'), T(4, 'Exp')],
  lines: [Ln(23, 1, 'I01.1'), Ln(24, 1, 'I01.2'), Ln(28, 1, 'I01.6'), Ln(59, 1, 'I01.8'), Ln(90, 3, 'E02.1')],
};

describe('payHint: what the booking is', () => {
  it('our activity, a guest stay, an outside hall booking; unknown when it does not say', () => {
    expect(payHint({ origin: 'ours', kind: 'event' })).toBe('ours');
    expect(payHint({ origin: 'outside', kind: 'stay' })).toBe('stay');
    expect(payHint({ origin: 'outside', kind: 'event' })).toBe('hall');
    expect(payHint({ origin: 'outside', kind: null })).toBeNull();
    expect(payHint({})).toBeNull();
    expect(payHint(null)).toBeNull();
  });
});

describe('money received from the calendar', () => {
  it('the heading is Income (by its code), the line follows the booking', () => {
    expect(incomeClassForPay(centre, 'stay')).toEqual([1, 23]);
    expect(incomeClassForPay(centre, 'hall')).toEqual([1, 28]);
    expect(incomeClassForPay(centre, 'ours')).toEqual([1, 59]);
  });
  it('an unknown booking: the heading only, the line empty', () => {
    expect(incomeClassForPay(centre, null)).toEqual([1, null]);
  });
  it('a centre without that line: the heading only; a line switched off is not suggested', () => {
    const noLine = { ...centre, lines: centre.lines.filter((l) => l.code !== 'I01.6') };
    expect(incomeClassForPay(noLine, 'hall')).toEqual([1, null]);
    const off = { ...centre, lines: centre.lines.map((l) => (l.code === 'I01.1' ? { ...l, active: 0 } : l)) };
    expect(incomeClassForPay(off, 'stay')).toEqual([1, null]);
  });
  it('a centre with no I01: the first Income heading (never found by name); no Income heading at all: nothing', () => {
    const other = { headings: [H(7, 'X1'), H(8, 'X2')], headingTypes: [T(8, 'Income'), T(7, 'Exp')], lines: [Ln(1, 8, 'X2.1')] };
    expect(incomeHeading(other)).toBe(8);
    expect(incomeClassForPay(other, 'stay')).toEqual([8, null]);
    expect(incomeClassForPay({ headings: [H(7, 'X1')], headingTypes: [T(7, 'Exp')], lines: [] }, 'stay')).toEqual([null, null]);
  });
});

describe('an Income window with only one income heading', () => {
  it('starts on it, and on its only line', () => {
    const one = { headings: [H(1, 'I01'), H(4, 'E03')], headingTypes: [T(1, 'Income'), T(4, 'Exp')], lines: [Ln(23, 1, 'I01.1'), Ln(30, 4, 'E03.1')] };
    expect(onlyIncomeClass(one)).toEqual([1, 23]);
    expect(onlyIncomeClass({ ...one, lines: [Ln(23, 1, 'I01.1'), Ln(24, 1, 'I01.2')] })).toEqual([1, null]);
  });
  it('two income headings (or none): nothing is chosen', () => {
    expect(onlyIncomeClass(centre)).toEqual([null, null]);
    expect(onlyIncomeClass({ headings: [], headingTypes: [], lines: [] })).toEqual([null, null]);
  });
  it('a heading switched off does not count', () => {
    const off = { ...centre, headings: [H(1, 'I01'), H(3, 'E02', 0), H(4, 'E03')] };
    expect(onlyIncomeClass(off)).toEqual([1, null]);
  });
});
