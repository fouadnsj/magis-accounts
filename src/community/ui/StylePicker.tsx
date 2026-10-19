// Choosing the look of a community: one colour, or a set of colours, with a live preview
// (Fouad, 19 October 2026). Used when creating a community or a country, and in Settings.
import { tx } from '../../i18n';
import { PALETTES, paletteFrom, paletteVars, type Palette, type StyleInput } from '../style';
import { t3 } from './text';

const QUICK = ['#B8891B', '#6B7B3A', '#2E7D5B', '#2A6FB0', '#3B4A8C', '#8C2F39', '#C0612B', '#7A4C8F', '#6B6B6B'];

export const DEFAULT_STYLE: StyleInput = { color: PALETTES[0].p.main, palette: null };

/** The palette a choice gives (one colour → its shades). */
export const chosenPalette = (s: StyleInput): Palette => s.palette ?? paletteFrom(s.color);

export function StylePicker({ value, onChange, name, sub }: {
  value: StyleInput;
  onChange: (s: StyleInput) => void;
  /** shown in the preview */
  name: string;
  sub?: string;
}) {
  const set = !!value.palette;
  const p = chosenPalette(value);
  return (
    <div className="sty">
      <div className="sty-pick">
        <div className="cty-seg" style={{ justifyContent: 'flex-start', marginBottom: 10 }}>
          <button type="button" className={!set ? 'on' : ''} onClick={() => onChange({ ...value, palette: null, color: p.main })}>{t3('لون واحد', 'One colour', 'Une couleur')}</button>
          <button type="button" className={set ? 'on' : ''} onClick={() => onChange({ ...value, palette: PALETTES.find((x) => x.p.main === p.main)?.p ?? p })}>{t3('مجموعة ألوان', 'A set of colours', 'Un jeu de couleurs')}</button>
        </div>
        {!set ? (
          <>
            <p className="muted small">{t3('اختر لوناً؛ يصنع البرنامج منه لوناً غامقاً للعناوين ولوناً فاتحاً للخلفيات.', 'Choose a colour; the program makes from it a dark shade for titles and a light one for backgrounds.', 'Choisissez une couleur ; le programme en tire une teinte foncée pour les titres et une claire pour les fonds.')}</p>
            <div className="sty-dots">
              {QUICK.map((c) => (
                <button type="button" key={c} className={value.color.toUpperCase() === c ? 'on' : ''} style={{ background: c }} onClick={() => onChange({ ...value, color: c })} aria-label={c} />
              ))}
              <label className="sty-own" title={t3('لون آخر', 'Another colour', 'Une autre couleur')}>
                <input type="color" value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value })} />
                <span>{t3('لون آخر…', 'Another…', 'Autre…')}</span>
              </label>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">{t3('مجموعة جاهزة من ثلاثة ألوان: الأزرار، العناوين والقائمة، الخلفيات. يمكن تعديل كل لون.', 'A ready set of three colours: buttons, titles and menu, backgrounds. Each colour can be changed.', 'Un jeu de trois couleurs : boutons, titres et menu, fonds. Chaque couleur peut être changée.')}</p>
            <div className="sty-sets">
              {PALETTES.map((x) => (
                <button type="button" key={x.key} className={value.palette?.main === x.p.main && value.palette?.deep === x.p.deep ? 'on' : ''} onClick={() => onChange({ ...value, color: x.p.main, palette: x.p })}>
                  <span className="sty-strip"><i style={{ background: x.p.main }} /><i style={{ background: x.p.deep }} /><i style={{ background: x.p.soft }} /></span>
                  <span>{tx(x.name)}</span>
                </button>
              ))}
            </div>
            <div className="sty-three">
              {([['main', t3('الأزرار', 'Buttons', 'Boutons')], ['deep', t3('العناوين والقائمة', 'Titles and menu', 'Titres et menu')], ['soft', t3('الخلفيات', 'Backgrounds', 'Fonds')]] as [keyof Palette, string][]).map(([k, label]) => (
                <label key={k} className="sty-own">
                  <input type="color" value={p[k]} onChange={(e) => { const np = { ...p, [k]: e.target.value.toUpperCase() }; onChange({ ...value, color: np.main, palette: np }); }} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
      <StylePreview p={p} name={name} sub={sub} />
    </div>
  );
}

/** A small picture of the screens in these colours. */
export function StylePreview({ p, name, sub }: { p: Palette; name: string; sub?: string }) {
  return (
    <div className="sty-preview" style={paletteVars(p) as React.CSSProperties}>
      <div className="muted small" style={{ marginBottom: 6 }}>{t3('معاينة', 'Preview', 'Aperçu')}</div>
      <div className="sty-phone">
        <div className="sty-phone-top">
          <img src="/brand/jesuits.png" alt="" />
          <div><b>{name || t3('اسم الجماعة', 'Name of the community', 'Nom de la communauté')}</b><span>{sub || t3('القيم', 'Econome', 'Économe')}</span></div>
        </div>
        <div className="sty-tabs"><span className="on">{t3('حسابي', 'My account', 'Mon compte')}</span><span>{t3('البيت', 'The house', 'La maison')}</span></div>
        <div className="sty-card">
          <div className="sty-label">{t3('في جيبي', 'In my pocket', 'En poche')}</div>
          <div className="sty-big">1,250,000 <small>SYP</small></div>
        </div>
        <div className="sty-btn">{t3('إعطاء مال', 'Give money', "Donner de l'argent")}</div>
      </div>
      <div className="sty-desk">
        <div className="sty-side"><b>{name || '…'}</b><span className="on">{t3('لوحة القيادة', 'Dashboard', 'Tableau de bord')}</span><span>{t3('السجل', 'Register', 'Registre')}</span></div>
        <div className="sty-desk-main"><div className="sty-h">{t3('لوحة القيادة', 'Dashboard', 'Tableau de bord')}</div><div className="sty-card small" /></div>
      </div>
    </div>
  );
}
