// Documents attached to a register row: scan with the phone camera (pages are
// gathered into ONE PDF), or attach an existing PDF or photo. Stored under the
// row's Bill_Code; opened again from the row.
import { useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { useApp } from '../state';
import type { AttachmentRow } from '../ops';
import { toBase64, saveFile } from '../platform';
import { Modal, confirmBox, errText, t, toast } from './kit';

/** Something waiting to be stored when the row is saved. */
export type PendingDoc = { kind: 'page'; jpeg: Uint8Array; preview: string } | { kind: 'file'; bytes: Uint8Array; mime: string; name: string };

const A4 = { w: 595.28, h: 841.89 };

/** A photo, made lighter and (as a "scan") black-and-white with more contrast. */
async function processPhoto(file: File, scan: boolean): Promise<{ jpeg: Uint8Array; preview: string }> {
  const bmp = await createImageBitmap(file); // follows the photo's orientation
  const max = 1700;
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * r);
  const h = Math.round(bmp.height * r);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  if (scan) {
    const img = ctx.getImageData(0, 0, w, h);
    const p = img.data;
    for (let i = 0; i < p.length; i += 4) {
      const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      const v = Math.max(0, Math.min(255, (g - 128) * 1.4 + 128 + 18)); // whiter paper, darker ink
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }
  const blob = await new Promise<Blob>((res) => cv.toBlob((b) => res(b!), 'image/jpeg', 0.72));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), preview: URL.createObjectURL(blob) };
}

/** Several pages (JPEG) into one PDF, each fitted on an A4 page. */
export async function pagesToPdf(pages: Uint8Array[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const jpg of pages) {
    const img = await pdf.embedJpg(jpg);
    const landscape = img.width > img.height;
    const pw = landscape ? A4.h : A4.w;
    const ph = landscape ? A4.w : A4.h;
    const page = pdf.addPage([pw, ph]);
    const s = Math.min((pw - 36) / img.width, (ph - 36) / img.height);
    page.drawImage(img, { x: (pw - img.width * s) / 2, y: (ph - img.height * s) / 2, width: img.width * s, height: img.height * s });
  }
  return pdf.save();
}

/** Stores everything waiting, on this row: all scanned pages as ONE PDF, each file as it is. */
export async function uploadPending(call: ReturnType<typeof useApp>['s']['api']['call'], trxId: string, pending: PendingDoc[]) {
  const pages = pending.filter((p): p is Extract<PendingDoc, { kind: 'page' }> => p.kind === 'page');
  if (pages.length) await call('doc.add', { trxId, base64: toBase64(await pagesToPdf(pages.map((p) => p.jpeg))), mime: 'application/pdf' });
  for (const f of pending) if (f.kind === 'file') await call('doc.add', { trxId, base64: toBase64(f.bytes), mime: f.mime });
}

export function DocsPanel({ trxId, pending, setPending, readOnly }: { trxId: string | null; pending: PendingDoc[]; setPending: (p: PendingDoc[]) => void; readOnly: boolean }) {
  const { s, d, reload } = useApp();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState(true);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ name: string; url: string; mime: string; bytes: Uint8Array } | null>(null);
  const docs = trxId ? d.attachments.filter((a) => a.trx_id === trxId) : [];

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const added: PendingDoc[] = [];
      for (const f of Array.from(files)) added.push({ kind: 'page', ...(await processPhoto(f, scan)) });
      setPending([...pending, ...added]);
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: PendingDoc[] = [];
    for (const f of Array.from(files)) {
      // a photo chosen from the phone becomes a page of the PDF; a PDF is kept as it is
      if (f.type.startsWith('image/')) added.push({ kind: 'page', ...(await processPhoto(f, scan)) });
      else if (f.type === 'application/pdf') added.push({ kind: 'file', bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type, name: f.name });
      else toast(t('PDF أو صورة فقط', 'PDF or picture only'), true);
    }
    setPending([...pending, ...added]);
  };

  const open = async (a: AttachmentRow) => {
    try {
      const r = await s.api.call('doc.get', { id: a.id });
      const bytes = Uint8Array.from(atob(r.base64), (ch) => ch.charCodeAt(0));
      setViewing({ name: r.name, mime: r.mime, bytes, url: URL.createObjectURL(new Blob([bytes], { type: r.mime })) });
    } catch (e) {
      toast(errText(e), true);
    }
  };

  const remove = async (a: AttachmentRow) => {
    if (!(await confirmBox(t(`إزالة «${a.name}» من هذا السطر؟`, `Remove "${a.name}" from this row?`), true))) return;
    try {
      await s.api.call('doc.delete', { id: a.id });
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };

  const pages = pending.filter((p) => p.kind === 'page') as Extract<PendingDoc, { kind: 'page' }>[];
  const files = pending.filter((p) => p.kind === 'file') as Extract<PendingDoc, { kind: 'file' }>[];

  return (
    <div className="docs">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>📎 {t('المستندات', 'Documents')}</b>
        {!readOnly && (
          <div className="row">
            <label className="row small muted"><input type="checkbox" checked={scan} onChange={(e) => setScan(e.target.checked)} /> {t('مسح (أبيض وأسود)', 'Scan look (black & white)')}</label>
            <button type="button" className="btn small" disabled={busy} onClick={() => camera.current?.click()}>📷 {t('تصوير', 'Camera')}</button>
            <button type="button" className="btn small" disabled={busy} onClick={() => picker.current?.click()}>📄 {t('ملف', 'File')}</button>
          </div>
        )}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} />
      <input ref={picker} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />

      {docs.length > 0 && (
        <div className="docs-list">
          {docs.map((a) => (
            <div key={a.id} className="doc-chip">
              <button type="button" className="btn small ghost" onClick={() => open(a)}>{a.mime === 'application/pdf' ? '📄' : '🖼'} {a.name}</button>
              <span className="muted small">{Math.round(a.size / 1024)} KB</span>
              {!readOnly && <button type="button" className="btn small ghost" onClick={() => remove(a)}>✕</button>}
            </div>
          ))}
        </div>
      )}

      {(pages.length > 0 || files.length > 0) && (
        <div className="docs-pending">
          {pages.length > 0 && (
            <>
              <div className="small muted">{t(`${pages.length} صفحة — تُجمع في ملف PDF واحد عند الحفظ`, `${pages.length} page(s) — gathered into one PDF when you save`)}</div>
              <div className="pages">
                {pages.map((p, i) => (
                  <div key={i} className="page-thumb">
                    <img src={p.preview} alt="" />
                    <button type="button" onClick={() => setPending(pending.filter((x) => x !== p))}>✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
          {files.map((f, i) => (
            <div key={i} className="doc-chip">📄 {f.name} <button type="button" className="btn small ghost" onClick={() => setPending(pending.filter((x) => x !== f))}>✕</button></div>
          ))}
          <div className="small warn">{t('يُحفظ مع السطر عند الضغط على «احفظ».', 'Stored with the row when you press "Save".')}</div>
        </div>
      )}
      {!docs.length && !pending.length && <div className="small muted">{t('لا مستند. صوّر الفاتورة أو أرفق ملفاً.', 'No document. Photograph the bill or attach a file.')}</div>}

      {viewing && (
        <Modal title={viewing.name} onClose={() => { URL.revokeObjectURL(viewing.url); setViewing(null); }}>
          {viewing.mime === 'application/pdf'
            ? <iframe src={viewing.url} title={viewing.name} style={{ width: '100%', height: '70vh', border: '1px solid var(--line)', borderRadius: 8 }} />
            : <img src={viewing.url} alt={viewing.name} style={{ maxWidth: '100%' }} />}
          <div className="modal-foot">
            <a className="btn" href={viewing.url} target="_blank" rel="noreferrer">{t('فتح في نافذة', 'Open in a new window')}</a>
            <button className="btn primary" onClick={() => saveFile(viewing.name, [viewing.name.split('.').pop() ?? 'pdf'], viewing.bytes, t('حفظ المستند', 'Save the document'))}>{t('تنزيل', 'Download')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
