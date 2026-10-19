// Settings: the person's language; for the Superior, the people and their roles; for the
// econome (his control panel): closing by quarter or month, a bank or not, the banknotes
// counted at closing, and the Superior's approval limits.
import { useState } from 'react';
import { errText, parseAmount, toast } from '../../ui/kit';
import { getLang, setLang, type LangMode } from '../../i18n';
import { CURS, type Cur } from '../domain';
import { useCty, Card } from './CtyApp';
import { PeopleScreen } from './People';
import { curName, t3 } from './text';
import type { Palette, StyleInput } from '../style';
import { DEFAULT_STYLE, StylePicker } from './StylePicker';
import { GateCard } from './CtyGate';

const LANGS: { l: LangMode; label: string }[] = [
  { l: 'en', label: 'English' },
  { l: 'fr', label: 'Français' },
  { l: 'ar', label: 'العربية' },
  { l: 'both', label: 'عربي · English' },
];

export function SettingsScreen({ onLang, onLogout, onCloseDb, onDatabases, inDesk }: { onLang: () => void; onLogout: () => void; onCloseDb?: () => void; onDatabases?: () => void; inDesk?: boolean }) {
  const { d, s, reload, can, go } = useCty();
  const [people, setPeople] = useState(false);
  const lang = getLang();
  if (people) return <><button className="cty-back" onClick={() => setPeople(false)}>‹ {t3('الإعدادات', 'Settings', 'Réglages')}</button><PeopleScreen /></>;

  return (
    <>
      {!inDesk && <button className="cty-back" onClick={() => go('month')}>‹ {t3('شهري', 'My month', 'Mon mois')}</button>}
      <h1>{t3('الإعدادات', 'Settings', 'Réglages')}</h1>
      <Card>
        <div className="cty-label">{t3('اللغة', 'Language', 'Langue')}</div>
        <div className="cty-tiles small">
          {LANGS.map((x) => <button key={x.l} className={lang === x.l ? 'on' : ''} onClick={() => { setLang(x.l); onLang(); }}>{x.label}</button>)}
        </div>
      </Card>
      {!inDesk && (can('users.manage') || can('cty.view_all')) && (
        <Card>
          <button className="btn cty-wide" onClick={() => setPeople(true)}>👥 {t3('الأشخاص والأدوار', 'People and roles', 'Personnes et rôles')}</button>
        </Card>
      )}
      {can('users.manage') && <LookCard key={JSON.stringify(d.style)} />}
      {can('users.manage') && s.mode !== 'preview' && <GateCard server={s.mode === 'server'} />}
      {(can('cty.limits') || can('users.manage')) && <ControlPanel key={JSON.stringify(d.settings) + JSON.stringify(d.limits)} />}
      {!inDesk && (
        <Card>
          <div className="cty-tiles small">
            {onDatabases && <button onClick={onDatabases}>{t3('كل قواعد البيانات', 'All databases', 'Toutes les bases')}</button>}
            {onCloseDb && <button onClick={onCloseDb}>{t3('إغلاق الملف', 'Close the file', 'Fermer le fichier')}</button>}
            <button onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
          </div>
        </Card>
      )}
    </>
  );

  /** The community's colours, address and city (the Administrator). */
  function LookCard() {
    const st = d.style ?? { color: null, palette: null, address: null, city: null, country: null };
    const [style, setStyle] = useState<StyleInput>(() => {
      let palette: Palette | null = null;
      try { palette = st.palette ? JSON.parse(st.palette) as Palette : null; } catch { /* old value */ }
      return { color: st.color ?? DEFAULT_STYLE.color, palette };
    });
    const [address, setAddress] = useState(st.address ?? '');
    const [city, setCity] = useState(st.city ?? '');
    const [busy, setBusy] = useState(false);
    const save = async () => {
      setBusy(true);
      try {
        await s.api.call('cty.style.save', { ...style, address, city });
        toast(t3('حُفظ', 'Saved', 'Enregistré'));
        await reload();
      } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
    };
    return (
      <Card>
        <div className="cty-label">{t3('الجماعة: العنوان والألوان', 'The community: address and colours', 'La communauté : adresse et couleurs')}</div>
        <div className="grid2" style={{ marginBottom: 10 }}>
          <label className="field span2"><span>{t3('العنوان', 'Address', 'Adresse')}</span><input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
          <label className="field"><span>{t3('المدينة', 'City', 'Ville')}</span><input value={city} onChange={(e) => setCity(e.target.value)} /></label>
        </div>
        <StylePicker value={style} onChange={setStyle} name={s.organisation} sub={[city, st.country].filter(Boolean).join(' · ')} />
        <button className="btn primary cty-wide" disabled={busy} onClick={save}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </Card>
    );
  }

  /** The econome's control panel. */
  function ControlPanel() {
    const [period, setPeriod] = useState(d.settings.closePeriod);
    const [bank, setBank] = useState(d.settings.hasBank);
    const [notes, setNotes] = useState<Record<Cur, string>>(Object.fromEntries(CURS.map((c) => [c, d.settings.notes[c].join(', ')])) as Record<Cur, string>);
    const [house, setHouse] = useState(String(d.limits.house));
    const [personal, setPersonal] = useState(String(d.limits.personal));
    const [rate, setRate] = useState(String(d.limits.startRate));
    const save = async () => {
      try {
        await s.api.call('cty.settings.save', {
          closePeriod: period, hasBank: bank,
          notes: Object.fromEntries(CURS.map((c) => [c, notes[c].split(/[,،\s]+/).map((x) => parseAmount(x)).filter((x) => x > 0)])) as Record<Cur, number[]>,
        });
        if (can('cty.limits')) await s.api.call('cty.limits.save', { limits: { house: parseAmount(house), personal: parseAmount(personal), startRate: parseAmount(rate) } });
        await reload();
        toast(t3('حُفظ ✓', 'Saved ✓', 'Enregistré ✓'));
      } catch (e) { toast(errText(e), true); }
    };
    return (
      <Card>
        <div className="cty-label">{t3('لوحة القيم', "The econome's control panel", "Le tableau de bord de l'économe")}</div>
        <div className="cty-label" style={{ marginTop: 8 }}>{t3('إغلاق الحسابات', 'Closing the accounts', 'Clôture des comptes')}</div>
        <div className="cty-seg" style={{ justifyContent: 'flex-start' }}>
          <button className={period === 'quarter' ? 'on' : ''} onClick={() => setPeriod('quarter')}>{t3('كل فصل', 'Every quarter', 'Chaque trimestre')}</button>
          <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>{t3('كل شهر', 'Every month', 'Chaque mois')}</button>
        </div>
        <label className="cty-check"><input type="checkbox" checked={bank} onChange={(e) => setBank(e.target.checked)} /><span>{t3('للجماعة حساب في المصرف', 'The community has a bank account', 'La communauté a un compte en banque')}</span></label>
        <div className="cty-label" style={{ marginTop: 12 }}>{t3('الأوراق النقدية للعدّ', 'Banknotes for counting', 'Billets pour compter')}</div>
        {CURS.map((c) => (
          <label key={c} className="field"><span>{curName(c, d.local)}</span><input dir="ltr" value={notes[c]} onChange={(e) => setNotes({ ...notes, [c]: e.target.value })} /></label>
        ))}
        {can('cty.limits') && (
          <>
            <div className="cty-label" style={{ marginTop: 12 }}>{t3('موافقة الرئيس فوق', "The Superior's approval above", "L'accord du Supérieur au-delà de")}</div>
            <div className="grid2">
              <label className="field"><span>{t3('دفتر البيت ($)', 'House book ($)', 'Compte de la maison ($)')}</span><input inputMode="decimal" value={house} onChange={(e) => setHouse(e.target.value)} /></label>
              <label className="field"><span>{t3('كل دفتر شخصي ($)', 'Each personal book ($)', 'Chaque compte personnel ($)')}</span><input inputMode="decimal" value={personal} onChange={(e) => setPersonal(e.target.value)} /></label>
            </div>
            <label className="field"><span>{t3('السعر قبل أول صرافة: ليرة للدولار', 'Rate before the first exchange: pounds for $1', 'Taux avant le premier change : livres pour 1 $')}</span><input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
          </>
        )}
        <button className="btn primary cty-wide" onClick={save}>{t3('احفظ', 'Save', 'Enregistrer')}</button>
      </Card>
    );
  }
}
