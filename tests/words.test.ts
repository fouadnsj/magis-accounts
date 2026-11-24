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

// S5 of the review before 0.13.0: the counted noun follows the LAST group of the number; a feminine noun (ليرة) turns the
// numbers 1, 2 and 3 to 19 round. The table is what the program writes on a receipt.
const TABLE: [number, 'USD' | 'SYP', string, string][] = [
  [0, 'USD', 'صفر دولارات أمريكية', 'Zero US dollars only'],
  [1, 'USD', 'دولار أمريكي واحد', 'One US dollar only'],
  [2, 'USD', 'دولاران أمريكيان', 'Two US dollars only'],
  [3, 'USD', 'ثلاثة دولارات أمريكية', 'Three US dollars only'],
  [10, 'USD', 'عشرة دولارات أمريكية', 'Ten US dollars only'],
  [11, 'USD', 'أحد عشر دولاراً أمريكياً', 'Eleven US dollars only'],
  [12, 'USD', 'اثنا عشر دولاراً أمريكياً', 'Twelve US dollars only'],
  [100, 'USD', 'مئة دولار أمريكي', 'One hundred US dollars only'],
  [101, 'USD', 'مئة ودولار أمريكي واحد', 'One hundred and one US dollars only'],
  [102, 'USD', 'مئة ودولاران أمريكيان', 'One hundred and two US dollars only'],
  [200, 'USD', 'مئتا دولار أمريكي', 'Two hundred US dollars only'],
  [250, 'USD', 'مئتان وخمسون دولاراً أمريكياً', 'Two hundred and fifty US dollars only'],
  [1000, 'USD', 'ألف دولار أمريكي', 'One thousand US dollars only'],
  [1001, 'USD', 'ألف ودولار أمريكي واحد', 'One thousand and one US dollars only'],
  [2000, 'USD', 'ألفا دولار أمريكي', 'Two thousand US dollars only'],
  [3000, 'USD', 'ثلاثة آلاف دولار أمريكي', 'Three thousand US dollars only'],
  [11000, 'USD', 'أحد عشر ألف دولار أمريكي', 'Eleven thousand US dollars only'],
  [1250, 'USD', 'ألف ومئتان وخمسون دولاراً أمريكياً', 'One thousand two hundred and fifty US dollars only'],
  [1250.5, 'USD', 'ألف ومئتان وخمسون دولاراً أمريكياً وخمسون سنتاً', 'One thousand two hundred and fifty US dollars and fifty cents only'],
  [0.5, 'USD', 'خمسون سنتاً', 'Fifty cents only'],
  [1.999, 'USD', 'دولاران أمريكيان', 'Two US dollars only'],
  [1000000, 'USD', 'مليون دولار أمريكي', 'One million US dollars only'],
  [2000000, 'USD', 'مليونا دولار أمريكي', 'Two million US dollars only'],
  [2200000, 'SYP', 'مليونان ومئتا ألف ليرة سورية', 'Two million two hundred thousand Syrian pounds only'],
  [0, 'SYP', 'صفر ليرات سورية', 'Zero Syrian pounds only'],
  [1, 'SYP', 'ليرة سورية واحدة', 'One Syrian pound only'],
  [2, 'SYP', 'ليرتان سوريتان', 'Two Syrian pounds only'],
  [3, 'SYP', 'ثلاث ليرات سورية', 'Three Syrian pounds only'],
  [10, 'SYP', 'عشر ليرات سورية', 'Ten Syrian pounds only'],
  [11, 'SYP', 'إحدى عشرة ليرةً سوريةً', 'Eleven Syrian pounds only'],
  [12, 'SYP', 'اثنتا عشرة ليرةً سوريةً', 'Twelve Syrian pounds only'],
  [13, 'SYP', 'ثلاث عشرة ليرةً سوريةً', 'Thirteen Syrian pounds only'],
  [21, 'SYP', 'إحدى وعشرون ليرةً سوريةً', 'Twenty-one Syrian pounds only'],
  [22, 'SYP', 'اثنتان وعشرون ليرةً سوريةً', 'Twenty-two Syrian pounds only'],
  [102, 'SYP', 'مئة وليرتان سوريتان', 'One hundred and two Syrian pounds only'],
  [200, 'SYP', 'مئتا ليرة سورية', 'Two hundred Syrian pounds only'],
  [1000, 'SYP', 'ألف ليرة سورية', 'One thousand Syrian pounds only'],
  [2000, 'SYP', 'ألفا ليرة سورية', 'Two thousand Syrian pounds only'],
  [11000, 'SYP', 'أحد عشر ألف ليرة سورية', 'Eleven thousand Syrian pounds only'],
  [11001, 'SYP', 'أحد عشر ألفاً وليرة سورية واحدة', 'Eleven thousand and one Syrian pounds only'],
  [1250, 'SYP', 'ألف ومئتان وخمسون ليرةً سوريةً', 'One thousand two hundred and fifty Syrian pounds only'],
  [1250.75, 'SYP', 'ألف ومئتان وخمسون ليرةً سوريةً وخمسة وسبعون قرشاً', 'One thousand two hundred and fifty Syrian pounds and seventy-five piastres only'],
  [1500000, 'SYP', 'مليون وخمسمئة ألف ليرة سورية', 'One million five hundred thousand Syrian pounds only'],
];
describe('the amount in words: the table of the receipt', () => {
  for (const [n, cur, ar, en] of TABLE) {
    it(`${n} ${cur}`, () => {
      expect(amountWords(n, cur)).toEqual({ ar: `فقط ${ar} لا غير`, en });
    });
  }
});
