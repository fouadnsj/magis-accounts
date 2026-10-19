// The language of the screens, chosen by each person (kept on this device):
// Arabic · English (as MAGIS always was), English, French, Arabic.
import { LANG_MODES, getLang, setLang, type LangMode } from '../i18n';

const NAMES: Record<LangMode, string> = { both: 'عربي · English', en: 'English', fr: 'Français', ar: 'العربية' };

export function LangPick({ onChange, compact }: { onChange: () => void; compact?: boolean }) {
  return (
    <select className={compact ? 'lang-pick compact' : 'lang-pick'} value={getLang()} aria-label="Language · Langue · اللغة"
      onChange={(e) => { setLang(e.target.value as LangMode); onChange(); }}>
      {LANG_MODES.map((l) => <option key={l} value={l}>{compact ? `🌐 ${NAMES[l]}` : NAMES[l]}</option>)}
    </select>
  );
}
