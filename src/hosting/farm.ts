// Al-Ard's farm: the first headings and lines of its books (Fouad, 22 November 2026: "this list just a starter", to be
// changed later in the database). Income: farm sales, and what is not farm (camps). Expenses: the running costs of the land.
import type { TrxType } from '../domain/types';

export interface FarmHeading { name: string; types: TrxType[]; lines: string[] }

export const FARM_LIST: FarmHeading[] = [
  {
    name: 'مبيعات زراعية · Farm sales',
    types: ['Income'],
    lines: ['زيتون مائدة · Table olives', 'زيت زيتون · Olive oil', 'سفرجل · Quince', 'عنب · Grapes', 'مشمش · Apricots', 'لوز · Almonds'],
  },
  {
    name: 'واردات غير زراعية · Non-farm income',
    types: ['Income'],
    lines: ['مخيمات · Camps'],
  },
  {
    name: 'المصاريف التشغيلية · Running costs',
    types: ['Exp'],
    lines: [
      'رواتب ثابتة · Fixed salaries',
      'صيانة آلات ومعدات · Machine and equipment maintenance',
      'محروقات · Fuel',
      'طاقة بديلة · Alternative energy',
      'عمالة يومية مختلفة · Daily labour',
      'عمالة موسمية (تقليم…) · Seasonal labour (pruning…)',
      'أسمدة زراعية (عضوية وكيماوية، أرضية وورقية) · Fertilizers (organic and chemical, soil and leaf)',
      'مبيدات حشرية · Insecticides',
    ],
  },
];
