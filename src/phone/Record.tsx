// Recording the inventory on the phone, room by room (Fouad, 21 November 2026): a centre full of things, one person with a
// phone. For each object: its name (a tap on a common one, or type), how many, a photo if wanted, the serial number
// (typed, or scanned from its barcode) and, for the valuable ones, the sticker (scanned or typed). It is kept on the
// phone with no connection, and sent with the next sync, where the server gives each item its number.
import { useRef, useState } from 'react';
import { kvGet, kvSet, newId, type Msg, type Pack } from './store';
import { shrinkImage } from '../io/shrink';
import { COMMON_ITEMS, codeFromScan } from '../inventory/inv';
import { Scanner } from './Count';

export interface InvNew {
  key: string;
  item: { name: string; category_id: number | null; place_id: number | null; qty: number; serial: string | null; code: string | null; origin_id: number | null };
  photo: { base64: string; mime: string } | null;
  state: 'waiting' | 'sent' | 'fix';
  error?: Msg | null;
  made_at: string;
  /** the number the server gave it */
  code?: string | null;
}
type Tr = (ar: string, en: string, fr: string) => string;

export const invNews = async () => (await kvGet<InvNew[]>('inv-new')) ?? [];
export const putInvNews = (x: InvNew[]) => kvSet('inv-new', x);

export function Record({ pack, tr: t, lang, onClose }: { pack: Pack; tr: Tr; lang: 'ar' | 'en' | 'fr'; onClose: (saved: boolean) => void }) {
  const inv = pack.inv!;
  const [place, setPlace] = useState<number | null>(inv.places[0]?.id ?? null);
  const [cat, setCat] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [serial, setSerial] = useState('');
  const [code, setCode] = useState('');
  const [photo, setPhoto] = useState<{ base64: string; mime: string } | null>(null);
  const [origin, setOrigin] = useState<number | null>(inv.origins.find((o) => /old|قديم/i.test(o.name))?.id ?? inv.origins[0]?.id ?? null);
  const [scan, setScan] = useState<'code' | 'serial' | null>(null);
  const [list, setList] = useState<InvNew[] | null>(null);
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  if (!loaded.current) { loaded.current = true; void invNews().then(setList); }
  const mine = (list ?? []).filter((x) => x.state !== 'sent' || Date.now() - Date.parse(x.made_at) < 6 * 3600e3).sort((a, b) => b.made_at.localeCompare(a.made_at));
  const serialCat = inv.categories.find((c) => c.id === cat)?.serial === 1;
  const placeName = inv.places.find((p) => p.id === place)?.name;

  const save = async () => {
    if (!name.trim()) return setNote(t('اكتب اسم الغرض', 'Write the name of the item', "Écrivez le nom de l'objet"));
    const x: InvNew = { key: newId(), item: { name: name.trim(), category_id: cat, place_id: place, qty: Math.max(1, Math.round(Number(qty) || 1)), serial: serial.trim() || null, code: codeFromScan(code) || null, origin_id: origin }, photo, state: 'waiting', made_at: new Date().toISOString() };
    const all = [...(await invNews()), x];
    await putInvNews(all);
    setList(all);
    setName(''); setQty('1'); setSerial(''); setCode(''); setPhoto(null);
    setNote(`✓ ${x.item.name}${x.item.qty > 1 ? ` ×${x.item.qty}` : ''}`);
    try { navigator.vibrate?.(40); } catch { /* */ }
  };
  const del = async (k: string) => {
    if (!window.confirm(t('تحذف هذا السطر؟', 'Delete this row?', 'Supprimer cette ligne ?'))) return;
    const all = (await invNews()).filter((x) => x.key !== k);
    await putInvNews(all); setList(all);
  };
  const take = async (f: File | undefined) => { if (f) { try { setPhoto(await shrinkImage(f, 1280, 0.7)); } catch { setNote(t('تعذّر أخذ الصورة', 'The photo could not be taken', "La photo n'a pas pu être prise")); } } if (file.current) file.current.value = ''; };
  const hasScan = 'BarcodeDetector' in window;
  const waiting = (list ?? []).filter((x) => x.state === 'waiting').length;

  return (
    <div className="ph-page">
      <header className="ph-top"><div><b>➕ {t('تسجيل الأغراض', 'Record items', 'Enregistrer des objets')}</b><span>{pack.organisation}</span></div><button className="ph-icon" onClick={() => onClose(waiting > 0)} aria-label="close">✕</button></header>
      <div className="ph-chips">
        {inv.places.map((p) => <button key={p.id} className={place === p.id ? 'on' : ''} onClick={() => setPlace(p.id)}>{p.name}</button>)}
        <button className={place == null ? 'on' : ''} onClick={() => setPlace(null)}>{t('بلا مكان', 'No place', 'Sans lieu')}</button>
      </div>
      {!inv.places.length && <div className="ph-alert">{t('أضف الغرف من الحاسوب (الجرد ← الإعدادات ← الأماكن) لتسجّل غرفة غرفة.', 'Add the rooms on the computer (Inventory → Settings → Places) to record room by room.', 'Ajoutez les pièces sur l’ordinateur (Inventaire → Réglages → Lieux) pour enregistrer pièce par pièce.')}</div>}

      <div className="ph-card">
        <div className="ph-chips">
          {COMMON_ITEMS.map((c) => <button key={c.en} onClick={() => setName(c[lang])}>{c[lang]}</button>)}
        </div>
        <label>{t('الاسم', 'Name', 'Nom')}<input list="inv-names" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('كرسي، طاولة…', 'Chair, table…', 'Chaise, table…')} /></label>
        <datalist id="inv-names">{inv.names.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="ph-two">
          <label>{t('العدد', 'How many', 'Combien')}<input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 5))} /></label>
          <label>{t('الصنف', 'Category', 'Catégorie')}
            <select value={cat ?? ''} onChange={(e) => setCat(e.target.value === '' ? null : Number(e.target.value))}><option value="">—</option>{inv.categories.map((c) => <option key={c.id} value={c.id}>{c.name.split(' · ')[0]}</option>)}</select>
          </label>
        </div>
        {(serialCat || serial) && (
          <label>{t('الرقم التسلسلي', 'Serial number', 'Numéro de série')}
            <span className="ph-two" style={{ gap: 6 }}><input className="ltr" value={serial} onChange={(e) => setSerial(e.target.value)} />{hasScan && <button type="button" className="ph-btn" onClick={() => setScan('serial')}>📷</button>}</span>
          </label>
        )}
        <label>{t('ملصق (للغالي فقط)', 'Sticker (valuable ones only)', 'Étiquette (objets de valeur seulement)')}
          <span className="ph-two" style={{ gap: 6 }}><input className="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="JAR-V001" autoCapitalize="characters" />{hasScan && <button type="button" className="ph-btn" onClick={() => setScan('code')}>📷</button>}</span>
        </label>
        {!serialCat && !serial && <button type="button" className="ph-btn" onClick={() => setSerial(' ')}>{t('＋ رقم تسلسلي', '＋ Serial number', '＋ Numéro de série')}</button>}
        <div className="ph-two">
          <button type="button" className="ph-btn" onClick={() => file.current?.click()}>📷 {photo ? t('صورة ✓', 'Photo ✓', 'Photo ✓') : t('صورة', 'Photo', 'Photo')}</button>
          <select value={origin ?? ''} onChange={(e) => setOrigin(e.target.value === '' ? null : Number(e.target.value))}>{inv.origins.map((o) => <option key={o.id} value={o.id}>{o.name.split(' · ')[0]}</option>)}</select>
        </div>
        <input ref={file} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void take(e.target.files?.[0])} />
        <button className="ph-btn gold" onClick={() => void save()}>{t('احفظ والتالي', 'Save & next', 'Enregistrer et suivant')}{placeName ? ` · ${placeName}` : ''}</button>
      </div>
      {note && <div className="ph-alert">{note}</div>}

      <ul className="ph-rows">
        {mine.slice(0, 60).map((x) => (
          <li key={x.key} className={x.state} onClick={() => x.state !== 'sent' && void del(x.key)}>
            <div className="l"><b>{x.item.name}{x.item.qty > 1 ? ` ×${x.item.qty}` : ''}{x.photo ? ' 📎' : ''}</b>
              <span>{inv.places.find((p) => p.id === x.item.place_id)?.name ?? ''}{x.code ? <> · <span className="ltr">{x.code}</span></> : x.item.code ? <> · <span className="ltr">{x.item.code}</span></> : ''}{x.item.serial ? <> · <span className="ltr">{x.item.serial}</span></> : ''}</span>
              {x.state === 'fix' && x.error && <em>{lang === 'ar' ? x.error.ar : lang === 'fr' ? x.error.fr ?? x.error.en : x.error.en}</em>}</div>
            <div className="a">{x.state === 'sent' ? '✓' : x.state === 'fix' ? '⚠' : '…'}</div>
          </li>
        ))}
        {!mine.length && <li className="ph-muted ph-empty">{t('لم تسجّل شيئاً بعد', 'Nothing recorded yet', 'Rien d’enregistré')}</li>}
      </ul>
      {waiting > 0 && <p className="ph-muted ph-hint">{t(`${waiting} تنتظر الإرسال. اضغط سطراً لحذفه.`, `${waiting} waiting to be sent. Tap a row to delete it.`, `${waiting} en attente d’envoi. Touchez une ligne pour la supprimer.`)}</p>}
      {scan && <Scanner tr={t} once formats={scan === 'code' ? ['qr_code'] : ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'qr_code', 'data_matrix']} onCode={(v) => (scan === 'code' ? setCode(codeFromScan(v)) : setSerial(v.trim()))} onClose={() => setScan(null)} />}
    </div>
  );
}
