// Report a problem on the phone (inventory step 3, Fouad's baseline 1.1 section 10): one button, what is wrong, where, a photo.
// Kept on the phone with no connection and sent with the next sync; the person then sees here "seen by the keeper" and the new
// state (from the fresh pack). Only the full phone app has it (not the calendar-only phones).
import { useRef, useState } from 'react';
import { kvGet, kvSet, newId, type Msg, type Pack } from './store';
import { shrinkImage } from '../io/shrink';

export interface ProblemNew {
  key: string;
  what: string;
  where: string;
  photo: { base64: string; mime: string } | null;
  state: 'waiting' | 'sent' | 'fix';
  error?: Msg | null;
  made_at: string;
}
type Tr = (ar: string, en: string, fr: string) => string;

export const problemNews = async () => (await kvGet<ProblemNew[]>('inv-problems')) ?? [];
export const putProblemNews = (x: ProblemNew[]) => kvSet('inv-problems', x);

const RESULT = (t: Tr, r: string | null) => (r === 'repair' ? t('يحتاج إصلاحاً', 'Needs repair', 'À réparer') : r === 'broken' ? t('معطّل', 'Broken', 'Cassé') : r === 'nothing' ? t('لا شيء خاطئ', 'Nothing wrong', 'Rien d’anormal') : r === 'good' ? t('سليم / أُصلح', 'Fine / repaired', 'En ordre / réparé') : '');

export function Problem({ pack, tr: t, lang, onClose }: { pack: Pack; tr: Tr; lang: 'ar' | 'en' | 'fr'; onClose: (saved: boolean) => void }) {
  const info = pack.problem!;
  const [what, setWhat] = useState('');
  const [where, setWhere] = useState('');
  const [photo, setPhoto] = useState<{ base64: string; mime: string } | null>(null);
  const [list, setList] = useState<ProblemNew[] | null>(null);
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  if (!loaded.current) { loaded.current = true; void problemNews().then(setList); }
  const waiting = (list ?? []).filter((x) => x.state !== 'sent');

  const save = async () => {
    if (!what.trim()) return setNote(t('اكتب ما المشكلة', 'Write what is wrong', 'Écrivez ce qui ne va pas'));
    const x: ProblemNew = { key: newId(), what: what.trim(), where: where.trim(), photo, state: 'waiting', made_at: new Date().toISOString() };
    const all = [...(await problemNews()), x];
    await putProblemNews(all);
    setList(all);
    setWhat(''); setPhoto(null);
    setNote(t('✓ سيُرسل مع المزامنة التالية', '✓ It will be sent with the next sync', '✓ Il sera envoyé à la prochaine synchronisation'));
  };
  const take = async (f: File | undefined) => { if (f) { try { setPhoto(await shrinkImage(f, 1280, 0.7)); } catch { setNote(t('تعذّر أخذ الصورة', 'The photo could not be taken', 'La photo n’a pas pu être prise')); } } if (file.current) file.current.value = ''; };
  const del = async (k: string) => {
    if (!window.confirm(t('تحذف هذا البلاغ؟', 'Delete this report?', 'Supprimer ce signalement ?'))) return;
    const all = (await problemNews()).filter((x) => x.key !== k);
    await putProblemNews(all); setList(all);
  };

  return (
    <div className="ph-page">
      <header className="ph-top"><div><b>⚠ {t('أبلغ عن مشكلة', 'Report a problem', 'Signaler un problème')}</b><span>{pack.organisation}</span></div><button className="ph-icon" onClick={() => onClose(waiting.length > 0)} aria-label="close">✕</button></header>
      <div className="ph-card">
        <label>{t('ما المشكلة؟', 'What is wrong?', 'Qu’est-ce qui ne va pas ?')}<textarea rows={3} value={what} onChange={(e) => setWhat(e.target.value)} placeholder={t('مثلاً: المروحة لا تدور', 'For example: the fan does not turn', 'Par exemple : le ventilateur ne tourne pas')} /></label>
        <label>{t('أين؟', 'Where?', 'Où ?')}<input list="ph-problem-spaces" value={where} onChange={(e) => setWhere(e.target.value)} placeholder={t('الغرفة أو القاعة…', 'The room or the hall…', 'La salle…')} /></label>
        <datalist id="ph-problem-spaces">{info.spaces.map((x) => <option key={x.id} value={x.name} />)}</datalist>
        <button type="button" className="ph-btn" onClick={() => file.current?.click()}>📷 {photo ? t('صورة ✓', 'Photo ✓', 'Photo ✓') : t('صورة', 'Photo', 'Photo')}</button>
        <input ref={file} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void take(e.target.files?.[0])} />
        <button className="ph-btn gold" onClick={() => void save()}>{t('أرسل', 'Send', 'Envoyer')}</button>
      </div>
      {note && <div className="ph-alert">{note}</div>}
      <ul className="ph-rows">
        {waiting.map((x) => (
          <li key={x.key} className={x.state} onClick={() => void del(x.key)}>
            <div className="l"><b>{x.what}{x.photo ? ' 📎' : ''}</b><span>{x.where}</span>
              {x.state === 'fix' && x.error && <em>{lang === 'ar' ? x.error.ar : lang === 'fr' ? x.error.fr ?? x.error.en : x.error.en}</em>}</div>
            <div className="a">{x.state === 'fix' ? '⚠' : '…'}</div>
          </li>
        ))}
        {info.mine.slice(0, 20).map((x) => (
          <li key={x.id}>
            <div className="l"><b>{x.what}</b><span>{x.where_text ?? ''}</span>
              <span>{x.status === 'seen' ? `✓ ${t('رآه أمين الجرد', 'seen by the keeper', 'vu par le gardien')}${x.result ? ` · ${RESULT(t, x.result)}` : ''}${x.item_name ? ` · ${x.item_name}` : ''}${x.seen_note ? ` · ${x.seen_note}` : ''}` : t('بانتظار أمين الجرد', 'waiting for the keeper', 'en attente du gardien')}</span></div>
          </li>
        ))}
        {!waiting.length && !info.mine.length && <li className="ph-muted ph-empty">{t('لا بلاغات بعد', 'No reports yet', 'Aucun signalement')}</li>}
      </ul>
    </div>
  );
}
