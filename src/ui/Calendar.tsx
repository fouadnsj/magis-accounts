// The MAGIS Calendar (baseline 2.1, step 2): the laptop screen. The rules are in hosting/calendar.ts, the operations
// cal.* in hosting/calops.ts. Step 2 begins with the settings (the spaces and lists are typed here, 23 November 2026).
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state';
import { errText, t, toast } from './kit';
import type { CalData } from '../hosting/calendar';
import { CalSettings } from './CalSettings';

type Screen = 'calendar' | 'settings';

export function Calendar() {
  const { s } = useApp();
  const [data, setData] = useState<CalData | null>(null);
  const [screen, setScreen] = useState<Screen>('calendar');
  const load = useCallback(async () => {
    try { setData(await s.api.call('cal.get')); } catch (e) { toast(errText(e), true); }
  }, [s]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <p className="muted">…</p>;
  const setup = data.rights.setup || data.rights.whole;
  return (
    <>
      <div className="page-head">
        <h1>{t('التقويم', 'Calendar')}</h1>
        {setup && (screen === 'calendar'
          ? <button className="btn" onClick={() => setScreen('settings')}>⚙ {t('الإعدادات', 'Settings')}</button>
          : <button className="btn" onClick={() => setScreen('calendar')}>‹ {t('التقويم', 'Calendar')}</button>)}
      </div>
      {screen === 'settings' && setup ? <CalSettings data={data} refresh={load} /> : <p className="muted">{t('التقويم: قيد البناء (الخطوة 2).', 'The calendar: being built (step 2).')}</p>}
    </>
  );
}
