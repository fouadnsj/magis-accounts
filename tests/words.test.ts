// The amount of a receipt in words (calendar step 4): Arabic and English.
import { describe, expect, it } from 'vitest';
import { amountWords, arWords, enWords } from '../src/hosting/words';

describe('the amount in words', () => {
  it('English', () => {
    expect(enWords(0)).toBe('zero');
    expect(enWords(15)).toBe('fifteen');
    expect(enWords(150)).toBe('one hundred and fifty');
    expect(enWords(1250)).toBe('one thousand two hundred and fifty');
    expect(enWords(1005)).toBe('one thousand and five');
    expect(enWords(2500000)).toBe('two million five hundred thousand');
  });
  it('Arabic', () => {
    expect(arWords(5)).toBe('خمسة');
    expect(arWords(21)).toBe('واحد وعشرون');
    expect(arWords(150)).toBe('مئة وخمسون');
    expect(arWords(1250)).toBe('ألف ومئتان وخمسون');
    expect(arWords(2000)).toBe('ألفان');
    expect(arWords(3000)).toBe('ثلاثة آلاف');
    expect(arWords(15000)).toBe('خمسة عشر ألفاً');
    expect(arWords(250000)).toBe('مئتان وخمسون ألفاً');
    expect(arWords(2500000)).toBe('مليونان وخمسمئة ألف');
  });
  it('with the currency', () => {
    expect(amountWords(150, 'USD')).toEqual({ ar: 'فقط مئة وخمسون دولاراً أمريكياً لا غير', en: 'One hundred and fifty US dollars only' });
    expect(amountWords(1, 'USD').ar).toBe('فقط دولار أمريكي واحد لا غير');
    expect(amountWords(70.5, 'USD')).toEqual({ ar: 'فقط سبعون دولاراً أمريكياً وخمسون سنتاً لا غير', en: 'Seventy US dollars and fifty cents only' });
    expect(amountWords(500000, 'SYP')).toEqual({ ar: 'فقط خمسمئة ألف ليرة سورية لا غير', en: 'Five hundred thousand Syrian pounds only' });
    expect(amountWords(5, 'SYP').ar).toBe('فقط خمس ليرات سورية لا غير');
    expect(amountWords(3, 'USD').ar).toBe('فقط ثلاثة دولارات أمريكية لا غير');
  });
});
