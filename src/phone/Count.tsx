// Counting the inventory on the phone (Fouad, 21 November 2026): the keeper walks through a room with the phone, with no
// connection, and ticks what he sees — by touch, by scanning the QR label (where the phone can), or by typing the label.
// The count is kept on the phone and sent with the next sync. A photo of an item can be taken here too.
import { useEffect, useMemo, useRef, useState } from 'react';
import { kvGet, kvSet, newId, type Pack } from './store';
import { shrinkImage } from '../io/shrink';

export interface InvCount { key: string; ids: number[]; placeId: number | null; date: string; sent: boolean }
export interface InvPhoto { key: string; itemId: number; mime: string; base64: string; sent: boolean }
type Tr = (ar: string, en: string, fr: string) => string;

export const invCounts = async () => (await kvGet<InvCount[]>('inv-counts')) ?? [];
export const invPhotos = async () => (await kvGet<InvPhoto[]>('inv-photos')) ?? [];

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function Count({ pack, tr: t, onClose }: { pack: Pack; tr: Tr; onClose: (saved: boolean) => void }) {
  const inv = pack.inv!;
  const [place, setPlace] = useState<number | 'all' | 'none'>(inv.places[0]?.id ?? 'all');
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [scan, setScan] = useState(false);
  const [photoFor, setPhotoFor] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const items = useMemo(() => inv.items.filter((i) => place === 'all' || (place === 'none' ? i.place_id == null : i.place_id === place)), [inv, place]);
  const year = `${new Date().getFullYear() - 1}${today().slice(4)}`;
  const byCode = useMemo(() => new Map(inv.items.map((i) => [i.code.toLowerCase(), i])), [inv]);

  const toggle = (id: number) => setSeen((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const mark = (code: string) => {
    const it = byCode.get(code.trim().toLowerCase());
    if (!it) return setNote(t(`الرمز ${code} غير موجود في الجرد`, `The label ${code} is not in the inventory`, `L'étiquette ${code} n'est pas dans l'inventaire`));
    setSeen((x) => new Set(x).add(it.id));
    setNote(`✓ ${it.code} · ${it.name}${it.place_id !== (place === 'all' || place === 'none' ? null : place) && place !== 'all' ? ` — ${t('مكانه المسجَّل مختلف', 'its place on record is different', 'son lieu enregistré est différent')}` : ''}`);
    try { navigator.vibrate?.(60); } catch { /* */ }
  };

  const save = async () => {
    if (!seen.size) return;
    const list = await invCounts();
    list.push({ key: newId(), ids: [...seen], placeId: typeof place === 'number' ? place : null, date: today(), sent: false });
    await kvSet('inv-counts', list);
    onClose(true);
  };
  const takePhoto = async (f: File | undefined) => {
    const id = photoFor;
    setPhotoFor(null);
    if (!f || id == null) return;
    try {
      const x = await shrinkImage(f, 1280, 0.7);
      const list = await invPhotos();
      list.push({ key: newId(), itemId: id, ...x, sent: false });
      await kvSet('inv-photos', list);
      setNote(t('الصورة محفوظة وتُرسل مع المزامنة', 'Photo kept, it goes with the next sync', 'Photo gardée, elle part avec la prochaine synchronisation'));
    } catch { setNote(t('تعذّر أخذ الصورة', 'The photo could not be taken', "La photo n'a pas pu être prise")); }
    if (file.current) file.current.value = '';
  };

  return (
    <div className="ph-page">
      <header className="ph-top"><div><b>📦 {t('عدّ الجرد', 'Count the inventory', "Compter l'inventaire")}</b><span>{pack.organisation}</span></div><button className="ph-icon" onClick={() => onClose(false)} aria-label="close">✕</button></header>
      <div className="ph-chips">
        {inv.places.map((p) => <button key={p.id} className={place === p.id ? 'on' : ''} onClick={() => { setPlace(p.id); setSeen(new Set()); }}>{p.name}</button>)}
        <button className={place === 'none' ? 'on' : ''} onClick={() => { setPlace('none'); setSeen(new Set()); }}>{t('بلا مكان', 'No place', 'Sans lieu')}</button>
        <button className={place === 'all' ? 'on' : ''} onClick={() => { setPlace('all'); setSeen(new Set()); }}>{t('الكل', 'All', 'Tous')}</button>
      </div>
      <div className="ph-two">
        {'BarcodeDetector' in window && <button className="ph-btn" onClick={() => setScan(true)}>📷 {t('امسح الرمز', 'Scan a label', 'Scanner une étiquette')}</button>}
        <button className="ph-btn" onClick={() => setSeen(new Set(items.map((i) => i.id)))}>✓ {t('الكل موجود', 'All present', 'Tout est là')}</button>
      </div>
      <form className="ph-card" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { mark(typed); setTyped(''); } }}>
        <label>{t('أو اكتب الرمز', 'Or type the label', "Ou tapez l'étiquette")}<input className="ph-in ltr" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="JAR-0001" autoCapitalize="characters" /></label>
      </form>
      {note && <div className="ph-alert">{note}</div>}
      <ul className="ph-rows">
        {items.map((i) => (
          <li key={i.id} className={seen.has(i.id) ? 'sent' : ''} onClick={() => toggle(i.id)}>
            <div className="l"><b>{seen.has(i.id) ? '✓ ' : ''}{i.name}{i.qty > 1 ? ` ×${i.qty}` : ''}</b>
              <span><span className="ltr">{i.code}</span>{i.serial ? <> · <span className="ltr">{i.serial}</span></> : null} · <i style={{ color: !i.counted_on || i.counted_on < year ? '#b3402a' : undefined, fontStyle: 'normal' }}>{i.counted_on ? i.counted_on : t('لم يُعدّ', 'never counted', 'jamais compté')}</i></span></div>
            <button className="ph-icon" onClick={(e) => { e.stopPropagation(); setPhotoFor(i.id); setTimeout(() => file.current?.click(), 0); }} aria-label="photo">📷</button>
          </li>
        ))}
        {!items.length && <li className="ph-muted ph-empty">{t('لا أغراض هنا', 'No items here', 'Aucun objet ici')}</li>}
      </ul>
      <input ref={file} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void takePhoto(e.target.files?.[0])} />
      <button className="ph-btn gold" disabled={!seen.size} onClick={() => void save()}>{t('احفظ العدّ', 'Save the count', 'Enregistrer le comptage')} ({seen.size})</button>
      {scan && <Scanner tr={t} onCode={mark} onClose={() => setScan(false)} />}
    </div>
  );
}

/** the camera, looking for QR codes (where the phone's browser can: Chrome on Android); each code found is given once */
function Scanner({ tr: t, onCode, onClose }: { tr: Tr; onCode: (c: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    const last = { code: '', at: 0 };
    (async () => {
      try {
        const Det = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const det = new Det({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const loop = async () => {
          if (stop || !video.current) return;
          try {
            const r = await det.detect(video.current);
            const v = r[0]?.rawValue;
            if (v && (v !== last.code || Date.now() - last.at > 2500)) { last.code = v; last.at = Date.now(); onCode(v); }
          } catch { /* a frame not ready */ }
          setTimeout(loop, 350);
        };
        void loop();
      } catch { setErr(t('الكاميرا غير متاحة (اسمح بها، وتحتاج اتصالاً آمناً)', 'The camera is not available (allow it; it needs the secure connection)', "La caméra n'est pas disponible (autorisez-la ; il faut la connexion sécurisée)")); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((x) => x.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="ph-viewer" style={{ flexDirection: 'column', gap: 12 }}>
      {err ? <div className="ph-alert">{err}</div> : <video ref={video} playsInline muted style={{ width: '92vw', maxHeight: '70vh', borderRadius: 12, background: '#000' }} />}
      <button className="ph-btn" onClick={onClose}>{t('تم', 'Done', 'Terminé')}</button>
    </div>
  );
}
