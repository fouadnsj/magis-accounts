// One language at a time in the communities (Fouad, 13 November 2026): the first time on a device, each person
// chooses Arabic, English or French; the screens then speak only that language. It can be changed in the settings.
// The MAGIS centres keep their own choice.
import { useEffect, useState, type ReactNode } from 'react';
import { enterCtyLang, leaveCtyLang, setLang, type LangMode } from '../../i18n';

const CHOICES: { l: LangMode; label: string; hello: string }[] = [
  { l: 'ar', label: 'العربية', hello: 'أهلاً وسهلاً' },
  { l: 'en', label: 'English', hello: 'Welcome' },
  { l: 'fr', label: 'Français', hello: 'Bienvenue' },
];

export function CtyLang({ children, onLang }: { children: ReactNode; onLang: () => void }) {
  const [chosen, setChosen] = useState(() => enterCtyLang());
  useEffect(() => {
    // (again on every mount: a page left and opened again)
    setChosen(enterCtyLang());
    onLang();
    return () => { leaveCtyLang(); onLang(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (chosen) return <>{children}</>;
  return (
    <div className="cty cty-langpick">
      <img src="/brand/jesuits.png" alt="" />
      <p>اختر لغتك · Choose your language · Choisissez votre langue</p>
      <div className="cty-langpick-btns">
        {CHOICES.map((x) => (
          <button key={x.l} type="button" lang={x.l} dir={x.l === 'ar' ? 'rtl' : 'ltr'} onClick={() => { setLang(x.l); setChosen(true); onLang(); }}>
            <b>{x.label}</b><span>{x.hello}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
