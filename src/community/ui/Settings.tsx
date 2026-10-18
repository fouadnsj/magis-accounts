// The person's language, and, for the econome, the approval limits and the starting rate.
import { useState } from 'react';
import { errText, parseAmount, toast } from '../../ui/kit';
import { getLang, setLang, type LangMode } from '../../i18n';
import { useCty, Card } from './CtyApp';
import { t3 } from './text';

const LANGS: { l: LangMode; label: string }[] = [
  { l: 'en', label: 'English' },
  { l: 'fr', label: 'Français' },
  { l: 'ar', label: 'العربية' },
  { l: 'both', label: 'عربي · English' },
];

export function SettingsScreen({ onLang, onLogout, onCloseDb, onDatabases }: { onLang: () => void; onLogout: () => void; onCloseDb?: () => void; onDatabases?: () => void }) {
  const { d, s, reload, can, go } = useCty();
  const [house, setHouse] = useState(String(d.limits.house));
  const [personal, setPersonal] = useState(String(d.limits.personal));
  const [rate, setRate] = useState(String(d.limits.startRate));
  const lang = getLang();

  const saveLimits = async () => {
    try {
      await s.api.call('cty.limits.save', { limits: { house: parseAmount(house), personal: parseAmount(personal), startRate: parseAmount(rate) } });
      await reload();
      toast(t3('حُفظ ✓', 'Saved ✓', 'Enregistré ✓'));
    } catch (e) {
      toast(errText(e), true);
    }
  };

  return (
    <>
      <button className="cty-back" onClick={() => go('month')}>‹ {t3('شهري', 'My month', 'Mon mois')}</button>
      <h1>{t3('الإعدادات', 'Settings', 'Réglages')}</h1>
      <Card>
        <div className="cty-label">{t3('اللغة', 'Language', 'Langue')}</div>
        <div className="cty-tiles small">
          {LANGS.map((x) => (
            <button key={x.l} className={lang === x.l ? 'on' : ''} onClick={() => { setLang(x.l); onLang(); }}>{x.label}</button>
          ))}
        </div>
      </Card>
      {can('cty.limits') && (
        <Card>
          <div className="cty-label">{t3('موافقة الرئيس فوق', "The Superior's approval above", "L'accord du Supérieur au-delà de")}</div>
          <label className="field"><span>{t3('دفتر البيت (الوزير)، بالدولار', 'House book (minister), in dollars', 'Compte de la maison (ministre), en dollars')}</span><input inputMode="decimal" value={house} onChange={(e) => setHouse(e.target.value)} /></label>
          <label className="field"><span>{t3('كل دفتر شخصي، بالدولار', 'Each personal book, in dollars', 'Chaque compte personnel, en dollars')}</span><input inputMode="decimal" value={personal} onChange={(e) => setPersonal(e.target.value)} /></label>
          <label className="field"><span>{t3('السعر قبل أول صرافة: ليرة للدولار', 'Rate before the first exchange: pounds for $1', 'Taux avant le premier change : livres pour 1 $')}</span><input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
          <p className="muted small">{t3('0 = بلا حد. الليرة واليورو بسعر آخر صرافة.', '0 = no limit. Pounds and euros at the rate of the last exchange.', '0 = sans limite. Livres et euros au taux du dernier change.')}</p>
          <button className="btn primary" onClick={saveLimits}>{t3('احفظ', 'Save', 'Enregistrer')}</button>
        </Card>
      )}
      <Card>
        <div className="cty-tiles small">
          {onDatabases && <button onClick={onDatabases}>{t3('كل قواعد البيانات', 'All databases', 'Toutes les bases')}</button>}
          {onCloseDb && <button onClick={onCloseDb}>{t3('إغلاق الملف', 'Close the file', 'Fermer le fichier')}</button>}
          <button onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
        </div>
      </Card>
    </>
  );
}
