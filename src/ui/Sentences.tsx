// The page "Sentences" of the door Administration (Fouad, 26 November 2026): ONE pool of warm sentences for the whole centre. The doors page
// (the line under the name of the centre and the line of each door) and the TV screen draw from it. The Administrator and the Director
// (the same rule as People and Roles) can switch a sentence off, edit it, choose where it appears, restore the original, or write their own.
import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { Field, Modal, confirmBox, errText, t, toast } from './kit';
import { GuideLink } from '../guide/GuideView';
import { m, tx, type Msg } from '../i18n';
import { doorName } from './Doors';
import { PLACES, SENTENCE_LENGTH, TV_PHRASE_MAX, TV_PHRASE_MIN, type Place, type PoolItem } from '../sentencePool';

const KIND_NAME: Record<string, Msg> = {
  charter: m('الميثاق', 'The charter', 'La charte'), logo: m('شرح الرموز', 'The logos', 'Les logos'), note: m('الورقة التعريفية', 'The concept note', 'La note de présentation'),
  app: m('الصفحة الأولى', 'The first page', 'La première page'), testimony: m('شهادة', 'A testimony', 'Un témoignage'), original: m('أصلية', 'Original', 'Originale'), centre: m('كتبها المركز', 'Written by the centre', 'Écrite par le centre'),
};
const placeName = (p: Place): string => tx(p === 'centre' ? m('سطر المركز', 'The centre’s line', 'La ligne du centre') : p === 'tv' ? m('الشاشة', 'The TV', 'L’écran') : doorName(p));

interface Form { key: string | null; id: number | null; ar: string; en: string; fr: string; places: Place[]; isNew: boolean; testimony: boolean }

export function SentencesPage() {
  const { s } = useApp();
  const [list, setList] = useState<PoolItem[] | null>(null);
  const [minutes, setMinutes] = useState('5');
  const [savedMin, setSavedMin] = useState('5');
  const [lang, setLang] = useState('en');
  const [show, setShow] = useState<'all' | Place>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const load = async () => {
    try {
      const r = (await s.api.call('sentence.get')) as { minutes: number; lang: string; items: PoolItem[] };
      setList(r.items); setMinutes(String(r.minutes)); setSavedMin(String(r.minutes)); setLang(r.lang);
    } catch (e) { toast(errText(e), true); setList([]); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, done?: string) => { try { await fn(); await load(); if (done) toast(done); } catch (e) { toast(errText(e), true); } };
  if (!list) return null;
  const idOf = (p: PoolItem) => p.key ?? `c${p.id}`;
  const shown = list.find((p) => idOf(p) === sel) ?? list.find((p) => p.active) ?? list[0];
  const rows = list.filter((p) => show === 'all' || p.places.includes(show));
  const toggle = (p: PoolItem) => act(() => s.api.call('sentence.save', p.key ? { key: p.key, active: !p.active } : { id: p.id, active: !p.active }));
  const restore = async (p: PoolItem) => {
    if (!(await confirmBox(t('إرجاع الجملة ومواضعها إلى الأصل؟', 'Put the sentence and its places back to the original?')))) return;
    await act(() => s.api.call('sentence.save', { key: p.key, restore: true, restorePlaces: true }));
  };
  const remove = async (p: PoolItem) => {
    if (!(await confirmBox(t('حذف هذه الجملة؟ لا يمكن التراجع.', 'Delete this sentence? This cannot be undone.'), true))) return;
    await act(() => s.api.call('sentence.delete', { id: p.id! }));
  };
  const save = async () => {
    if (!form) return;
    const body = { ar: form.ar, en: form.en, fr: form.fr, places: form.places };
    try {
      if (form.isNew) await s.api.call('sentence.save', body); else await s.api.call('sentence.save', form.key ? { key: form.key, ...body } : { id: form.id, ...body });
      setForm(null); await load();
    } catch (e) { toast(errText(e), true); }
  };
  const tick = (p: Place) => form && setForm({ ...form, places: form.places.includes(p) ? form.places.filter((x) => x !== p) : [...form.places, p] });
  const on = list.filter((p) => p.active).length;
  return (
    <>
      <div className="page-head"><h1>{tx(m('العبارات', 'Sentences', 'Phrases'))}<GuideLink id="people" /></h1></div>
      <div className="panel">
        <p className="small muted">{t('الجمل الدافئة التي تظهر في أبواب المركز وعلى شاشة المدخل، من مجموعة واحدة للمركز كله. أطفئ جملة أو عدّلها أو حدّد أين تظهر أو اكتب جملتك. الجمل الأصلية مأخوذة من الميثاق ومن شروح الرموز والورقة التعريفية؛ وشهادات الأشخاص لا تظهر أبداً على الشاشة. العربية أولاً وتحتها لغة أخرى.', 'The warm sentences shown on the doors of the centre and on the screen at the entrance, from ONE pool for the whole centre. Switch one off, edit it, choose where it appears, or write your own. The original ones come from the charter, the explanation of the logos and the concept note; a person\'s testimony never appears on the screen. Arabic first, another language under it.')}</p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' }}>
          <b>📺 {t('الشاشة', 'The TV')}:</b>
          <span>{t('تتبدّل العبارة كل', 'the phrase changes every')}</span>
          <input className="inp" type="number" min={TV_PHRASE_MIN} max={TV_PHRASE_MAX} style={{ width: 70 }} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <span>{t('دقيقة (1 إلى 15)', 'minutes (1 to 15)')}</span>
          {minutes !== savedMin && <button className="btn small primary" onClick={() => void act(() => s.api.call('sentence.minutes', { minutes: Number(minutes) }), t('حُفظت المدة', 'Saved'))}>{t('حفظ', 'Save')}</button>}
          <span style={{ marginInlineStart: 14 }}>{t('اللغة تحت العربية', 'language under the Arabic')}</span>
          <select className="inp" style={{ width: 'auto' }} value={lang} onChange={(e) => void act(() => s.api.call('sentence.lang', { lang: e.target.value }), t('حُفظت اللغة', 'Saved'))}>
            <option value="en">English</option><option value="fr">Français</option><option value="ar">{t('العربية فقط', 'Arabic only')}</option>
          </select>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' }}>
          <span>{t('اعرض', 'Show')}</span>
          <select className="inp" style={{ width: 'auto' }} value={show} onChange={(e) => setShow(e.target.value as 'all' | Place)}>
            <option value="all">{t('كل الجمل', 'All the sentences')}</option>
            {PLACES.map((p) => <option key={p} value={p}>{placeName(p)}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <span className="small muted">{on} / {list.length} {t('مفعّلة', 'on')}</span>
          <button className="btn small" onClick={() => setForm({ key: null, id: null, ar: '', en: '', fr: '', places: [...PLACES], isNew: true, testimony: false })}>＋ {t('اكتب جملة', 'Write a sentence')}</button>
        </div>
        {shown && (
          <div className="tvprev" aria-label="preview">
            <div className="small" style={{ opacity: .7 }}>{t('معاينة', 'Preview')}</div>
            <div className="a" dir="rtl">{shown.ar}</div>
            <div className="e" dir="ltr">{shown.en || shown.fr}</div>
          </div>
        )}
        <table className="t small" style={{ marginTop: 10 }}>
          <thead><tr><th style={{ width: 60 }}>{t('مفعّلة', 'On')}</th><th>{t('الجملة', 'Sentence')}</th><th>{t('المصدر والمواضع', 'Source and places')}</th><th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={idOf(p)} className={`${p.active ? '' : 'off'} ${shown && idOf(shown) === idOf(p) ? 'sel' : ''}`} onClick={() => setSel(idOf(p))} style={{ cursor: 'pointer' }}>
                <td><input type="checkbox" checked={p.active} onChange={() => void toggle(p)} onClick={(e) => e.stopPropagation()} aria-label={t('تفعيل', 'On')} /></td>
                <td>
                  <div dir="rtl" style={{ fontSize: 16, fontWeight: 600 }}>{p.ar || '—'}</div>
                  {p.en && <div dir="ltr" className="muted">{p.en}</div>}
                  {p.fr && p.fr !== p.en && <div dir="ltr" className="muted" style={{ fontStyle: 'italic' }}>{p.fr}</div>}
                  {p.edited && <span className="pill" style={{ background: '#fff4d6' }}>{t('معدّلة', 'edited')}</span>}
                </td>
                <td className="muted">
                  <b>{tx(KIND_NAME[p.kind])}</b>{p.kind !== 'centre' && <div>{p.source}</div>}
                  <div>{p.places.length ? p.places.map(placeName).join(' · ') : <i>{t('لا موضع', 'nowhere')}</i>}{p.placesEdited ? ' ✎' : ''}</div>
                </td>
                <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost small" onClick={() => setForm({ key: p.key, id: p.id, ar: p.ar, en: p.en, fr: p.fr, places: p.places, isNew: false, testimony: p.kind === 'testimony' })}>{t('عدّل', 'Edit')}</button>
                  {(p.edited || p.placesEdited) && <button className="btn ghost small" onClick={() => void restore(p)}>{t('الأصل', 'Restore the original')}</button>}
                  {!p.key && <button className="btn ghost small" onClick={() => void remove(p)}>{t('احذف', 'Delete')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {form && (
          <Modal title={form.isNew ? t('جملة جديدة', 'A new sentence') : t('عدّل الجملة', 'Edit the sentence')} onClose={() => setForm(null)}>
            <p className="small muted">{t('اكتب بلغة واحدة على الأقل. تظهر العربية أولاً وتحتها اللغة الأخرى. الجملة التي تكتبها مسؤوليتك.', 'Write in at least one language. Arabic shows first, the other language under it. A sentence you write is your own responsibility.')}</p>
            <div className="cal-form">
              <Field label="العربية"><textarea className="inp" dir="rtl" rows={2} maxLength={SENTENCE_LENGTH} autoFocus value={form.ar} onChange={(e) => setForm({ ...form, ar: e.target.value })} /></Field>
              <Field label="English"><textarea className="inp" dir="ltr" rows={2} maxLength={SENTENCE_LENGTH} value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} /></Field>
              <Field label="Français"><textarea className="inp" dir="ltr" rows={2} maxLength={SENTENCE_LENGTH} value={form.fr} onChange={(e) => setForm({ ...form, fr: e.target.value })} /></Field>
            </div>
            <div style={{ marginTop: 8 }}>
              <b className="small">{t('أين تظهر', 'Where it appears')}</b>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                {PLACES.filter((p) => !(form.testimony && p === 'tv')).map((p) => (
                  <label key={p} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={form.places.includes(p)} onChange={() => tick(p)} /> {placeName(p)}</label>
                ))}
              </div>
            </div>
            <div className="tvprev" style={{ marginTop: 10 }}>
              <div className="a" dir="rtl">{form.ar}</div>
              <div className="e" dir="ltr">{form.en || form.fr}</div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setForm(null)}>{t('إلغاء', 'Cancel')}</button>
              <button className="btn primary" disabled={!form.ar.trim() && !form.en.trim() && !form.fr.trim()} onClick={() => void save()}>{t('حفظ', 'Save')}</button>
            </div>
          </Modal>
        )}
      </div>
    </>
  );
}
