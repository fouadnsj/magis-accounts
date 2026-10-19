// One total in dollars: everything converted at the rate of the last exchange (never typed).
// It gives the econome and the Superior a single figure for the whole.
import { useMemo } from 'react';
import { todayIso } from '../../ui/kit';
import { ratesAt, totalUsd, type Money, type Rates } from '../domain';
import { useCty } from './CtyApp';
import { money, t3 } from './text';

export function useRates(): Rates {
  const { d } = useCty();
  return useMemo(() => ratesAt(d.entries, todayIso(), d.limits.startRate), [d.entries, d.limits.startRate]);
}

/** "≈ $1,234 in all" with a note if a currency has no rate yet. */
export function AllUsd({ m, label }: { m: Money; label?: string }) {
  const r = useRates();
  const t = totalUsd(m, r);
  return (
    <span className="cty-allusd" title={t3('كل العملات محوّلة إلى دولار بسعر آخر صرافة', 'All currencies converted to dollars at the rate of the last exchange', 'Toutes les monnaies converties en dollars au taux du dernier change')}>
      {label ?? t3('المجموع', 'In all', 'En tout')} ≈ <b>${money(t.usd, 'USD')}</b>{t.missing && <i> ({t3('دون اليورو: لا سعر', 'euros left out: no rate', 'euros exclus : pas de taux')})</i>}
    </span>
  );
}
