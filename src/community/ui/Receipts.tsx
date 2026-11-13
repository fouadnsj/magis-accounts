// Receipts on a community entry (Fouad, 13 November 2026: "apply what we made on the MAGIS db"): a photo taken with
// the phone (made lighter), or a picture or PDF chosen; seen full screen; removing one asks first. A new entry keeps its
// photos until it is saved; an entry already saved takes them at once.
import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmBox, errText, toast } from '../../ui/kit';
import { toBase64 } from '../../platform';
import type { CtyDoc } from '../ops';
import { useCty } from './CtyApp';
import { t3 } from './text';

export interface PendingReceipt { key: string; mime: string; bytes: Uint8Array; url: string }

/** a photo made lighter (1600 points at most, JPEG), so that it goes through a slow connection */
async function lighter(file: File): Promise<{ bytes: Uint8Array; mime: string }> {
  if (file.type === 'application/pdf') return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type };
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise<Blob>((res) => cv.toBlob((b) => res(b!), 'image/jpeg', 0.75));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' };
}

/** Stores the photos of a new entry, once it is saved. */
export async function uploadReceipts(call: ReturnType<typeof useCty>['s']['api']['call'], entryId: string, pending: PendingReceipt[]) {
  for (const p of pending) await call('cty.doc.add', { entryId, base64: toBase64(p.bytes), mime: p.mime });
}

export function Receipts({ entryId, pending, setPending, readOnly }: { entryId: string | null; pending: PendingReceipt[]; setPending: (p: PendingReceipt[]) => void; readOnly: boolean }) {
  const { s } = useCty();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<CtyDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{ name: string; mime: string; url: string; remove: () => void } | null>(null);
  const load = useCallback(async () => { if (entryId) try { setDocs(await s.api.call('cty.doc.list', { entryId })); } catch { setDocs([]); } }, [s, entryId]);
  useEffect(() => { void load(); }, [load]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const made: PendingReceipt[] = [];
      for (const f of Array.from(files)) {
        if (!f.type.startsWith('image/') && f.type !== 'application/pdf') { toast(t3('صورة أو PDF فقط', 'A picture or a PDF only', 'Une image ou un PDF seulement'), true); continue; }
        const x = await lighter(f);
        made.push({ key: crypto.randomUUID(), ...x, url: URL.createObjectURL(new Blob([x.bytes], { type: x.mime })) });
      }
      if (entryId) { for (const p of made) await s.api.call('cty.doc.add', { entryId, base64: toBase64(p.bytes), mime: p.mime }); await load(); }
      else setPending([...pending, ...made]);
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const ask = () => confirmBox(t3('إزالة هذه الصورة من القيد؟', 'Remove this receipt from the entry?', 'Retirer ce reçu de l’écriture ?'), true);
  const openDoc = async (d: CtyDoc) => {
    try {
      const r = await s.api.call('cty.doc.get', { id: d.id });
      const bytes = Uint8Array.from(atob(r.base64), (ch) => ch.charCodeAt(0));
      setView({ name: r.name, mime: r.mime, url: URL.createObjectURL(new Blob([bytes], { type: r.mime })), remove: async () => {
        if (!(await ask())) return;
        try { await s.api.call('cty.doc.delete', { id: d.id }); setView(null); await load(); } catch (e) { toast(errText(e), true); }
      } });
    } catch (e) { toast(errText(e), true); }
  };
  const openPending = (p: PendingReceipt) => setView({ name: '', mime: p.mime, url: p.url, remove: async () => { if (await ask()) { setPending(pending.filter((x) => x.key !== p.key)); setView(null); } } });

  return (
    <div className="cty-receipts">
      <div className="cty-label">📎 {t3('الإيصال', 'The receipt', 'Le reçu')}</div>
      <div className="cty-receipt-row">
        {docs.map((d) => <button key={d.id} type="button" className="cty-receipt" onClick={() => void openDoc(d)}>{d.mime === 'application/pdf' ? '📄' : '🖼'}<small>{d.name}</small></button>)}
        {pending.map((p) => <button key={p.key} type="button" className="cty-receipt" onClick={() => openPending(p)}>{p.mime === 'application/pdf' ? '📄' : <img src={p.url} alt="" />}</button>)}
        {!readOnly && <button type="button" className="cty-receipt add" disabled={busy} onClick={() => camera.current?.click()}>📷<small>{t3('صوّر', 'Photo', 'Photo')}</small></button>}
        {!readOnly && <button type="button" className="cty-receipt add" disabled={busy} onClick={() => picker.current?.click()}>📄<small>{t3('ملف', 'File', 'Fichier')}</small></button>}
      </div>
      {pending.length > 0 && <p className="muted small">{t3('تُحفظ مع القيد عند الضغط على «احفظ».', 'Stored with the entry when you press "Save".', 'Gardées avec l’écriture quand vous touchez « Enregistrer ».')}</p>}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
      <input ref={picker} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
      {view && (
        <div className="cty-viewer" onClick={() => setView(null)}>
          {view.mime === 'application/pdf' ? <iframe src={view.url} title={view.name} onClick={(e) => e.stopPropagation()} /> : <img src={view.url} alt="" />}
          <div className="bar" onClick={(e) => e.stopPropagation()}>
            <button className="btn" onClick={() => setView(null)}>{t3('إغلاق', 'Close', 'Fermer')}</button>
            {!readOnly && <button className="btn danger" onClick={view.remove}>{t3('أزل الإيصال', 'Remove the receipt', 'Retirer le reçu')}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
