// My own colour and page background (Fouad, 22 November 2026): "give the users the possibility to change the colour, it makes
// the pages more comfortable". Kept on the person's own login, so it follows him on every computer. What he sees changes at
// once while he chooses; "Cancel" puts everything back.
import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { MY_COLOURS, PAGE_BG, deepOf, type CentreStyle, type MyLook } from '../brand';
import { tx } from '../i18n';
import { Modal, errText, t, toast } from './kit';

const same = (a: string | null, b: string | null) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

export function MyLookWindow({ base, saved, onPreview, onSaved, onClose }: {
  /** the house's own style (the default) */
  base: CentreStyle;
  saved: MyLook;
  onPreview: (l: MyLook) => void;
  onSaved: (l: MyLook) => void;
  onClose: () => void;
}) {
  const { s } = useApp();
  const [draft, setDraft] = useState<MyLook>(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => { onPreview(draft); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = () => { onPreview(saved); onClose(); };
  const save = async () => {
    setBusy(true);
    try {
      await s.api.call('me.look.save', { color: draft.color, bg: draft.bg });
      onSaved(draft);
      toast(t('حُفظ لونك', 'Your colour is saved'));
      onClose();
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const swatch = (color: string | null, label: string) => {
    const on = same(draft.color, color);
    const shown = color ?? base.deep;
    return (
      <button key={color ?? 'default'} type="button" onClick={() => setDraft({ ...draft, color })} title={label} aria-pressed={on}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 78, padding: 6, background: 'transparent', border: on ? '2px solid var(--ink, #26292E)' : '2px solid transparent', borderRadius: 8, cursor: 'pointer' }}>
        <span style={{ width: 44, height: 44, borderRadius: '50%', background: color ? deepOf(color) : shown, boxShadow: '0 0 0 1px rgba(0,0,0,.15) inset' }} />
        <small style={{ lineHeight: 1.2, textAlign: 'center' }}>{label}</small>
      </button>
    );
  };
  const bgCard = (key: string | null, color: string, label: string) => {
    const on = (draft.bg ?? null) === key;
    return (
      <button key={key ?? 'default'} type="button" onClick={() => setDraft({ ...draft, bg: key })} aria-pressed={on}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 96, padding: 6, background: 'transparent', border: on ? '2px solid var(--ink, #26292E)' : '2px solid transparent', borderRadius: 8, cursor: 'pointer' }}>
        <span style={{ width: 80, height: 40, borderRadius: 6, background: color, boxShadow: '0 0 0 1px rgba(0,0,0,.18) inset' }} />
        <small style={{ lineHeight: 1.2, textAlign: 'center' }}>{label}</small>
      </button>
    );
  };
  const custom = draft.color && !MY_COLOURS.some((c) => same(c.color, draft.color)) ? draft.color : null;
  return (
    <Modal title={`🎨 ${t('لوني', 'My colour')}`} onClose={cancel}>
      <p className="small muted">{t('يغيّر لون القائمة والأزرار وخلفية الصفحات عندك أنت فقط، وينتقل معك إلى كل حاسوب. التغيير يظهر فوراً.', 'This changes the menu, the buttons and the page background for you only, on every computer you use. You see it at once.')}</p>
      <h3 style={{ margin: '10px 0 4px' }}>{t('لون القائمة والأزرار', 'Colour of the menu and the buttons')}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {swatch(null, t('لون المركز', "The house's own"))}
        {MY_COLOURS.map((c) => swatch(c.color, tx(c.name)))}
        {custom && swatch(custom, custom)}
      </div>
      <div className="row" style={{ marginTop: 6, gap: 8, alignItems: 'center' }}>
        <label className="small">{t('أو اختر لوناً', 'Or pick any colour')}: <input type="color" value={draft.color ?? base.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} style={{ width: 56, height: 34, padding: 2, verticalAlign: 'middle' }} /></label>
      </div>
      <h3 style={{ margin: '14px 0 4px' }}>{t('خلفية الصفحات', 'Page background')}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {bgCard(null, '#FDFCF9', t('المعتادة', 'Usual'))}
        {Object.entries(PAGE_BG).map(([k, v]) => bgCard(k, v.color, tx(v.name)))}
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={() => setDraft({ color: null, bg: null })}>↺ {t('الأصل', 'Back to the usual')}</button>
        <button className="btn" onClick={cancel}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}
