// Problems reported (inventory step 3, Fouad's baseline 1.1 sections 3 and 10): ONE button "Report a problem" for anyone of the
// centre: what is wrong, where, a photo. It goes to the keeper's list (a tile and a list in the new inventory); the keeper sets
// the state of the item concerned, or "nothing wrong"; the person then sees "seen by the keeper" and the new state.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { Field, Modal, errText, fmtDate, toast } from './kit';
import { m, tx } from '../i18n';
import { shrinkImage } from '../io/shrink';
import { inUse, type InvData, type InvItem } from '../inventory/inv';
import { keeperOrder, problemSaid, type InvProblem, type ProblemResult, type ProblemSpace } from '../inventory/problems';
import { spaceOfPlace } from '../inventory/map';

const L = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));

export const RESULT_LABEL: Record<ProblemResult, () => string> = {
  repair: () => L('يحتاج إصلاحاً', 'Needs repair', 'À réparer'),
  broken: () => L('معطّل', 'Broken', 'Cassé'),
  nothing: () => L('لا شيء خاطئ', 'Nothing wrong', 'Rien d’anormal'),
  good: () => L('سليم / أُصلح', 'Fine / repaired', 'En ordre / réparé'),
};

/** what the person who reported reads: waiting, or seen by the keeper with the new state */
export function SaidBadge({ p }: { p: Pick<InvProblem, 'status' | 'result' | 'seen_at' | 'item_name'> }) {
  const said = problemSaid(p);
  if (said === 'waiting') return <span className="inv-dot w">{L('بانتظار أمين الجرد', 'waiting for the keeper', 'en attente du gardien')}</span>;
  return (
    <span className={`inv-dot ${said === 'nothing' || said === 'good' ? 'ok' : 'e'}`}>
      ✓ {L('رآه أمين الجرد', 'seen by the keeper', 'vu par le gardien')}{p.result ? ` · ${RESULT_LABEL[p.result]()}` : ''}{p.item_name ? ` · ${p.item_name}` : ''}
    </span>
  );
}

// ---------------------------------------------------------------- photos (kept while the page is open)

const cache = new Map<number, string>();
function useProblemPhoto(p: Pick<InvProblem, 'id' | 'has_photo'>): string | null {
  const { s } = useApp();
  const [src, setSrc] = useState<string | null>(cache.get(p.id) ?? null);
  useEffect(() => {
    if (!p.has_photo) return;
    if (cache.has(p.id)) { setSrc(cache.get(p.id)!); return; }
    let live = true;
    s.api.call('inv.problem.photo', { id: p.id }).then((r: { mime: string; base64: string }) => {
      const u = `data:${r.mime};base64,${r.base64}`;
      cache.set(p.id, u);
      if (live) setSrc(u);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [p.id, p.has_photo, s]);
  return src;
}
function PhotoBox({ p, h = 90 }: { p: Pick<InvProblem, 'id' | 'has_photo'>; h?: number }) {
  const src = useProblemPhoto(p);
  const [big, setBig] = useState(false);
  if (!p.has_photo) return null;
  return (
    <>
      {src ? <img src={src} alt="" style={{ height: h, borderRadius: 6, cursor: 'zoom-in' }} onClick={() => setBig(true)} /> : <span className="muted">…</span>}
      {big && src && <div className="overlay" onClick={() => setBig(false)} style={{ zIndex: 70 }}><img src={src} alt="" style={{ maxWidth: '92vw', maxHeight: '88vh', margin: 'auto', borderRadius: 8 }} /></div>}
    </>
  );
}

// ---------------------------------------------------------------- the button, for everyone

/** The one button. `compact`: a small one for the light phone window. */
export function ReportButton({ compact, className }: { compact?: boolean; className?: string }) {
  const { d } = useApp();
  const [open, setOpen] = useState(false);
  if (!d.problems?.on) return null;
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>⚠ {compact ? L('بلاغ', 'Report', 'Signaler') : L('أبلغ عن مشكلة', 'Report a problem', 'Signaler un problème')}</button>
      {open && <ReportModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function ReportModal({ onClose, where }: { onClose: () => void; where?: string }) {
  const { s, reload } = useApp();
  const [what, setWhat] = useState('');
  const [place, setPlace] = useState(where ?? '');
  const [photo, setPhoto] = useState<{ base64: string; mime: string } | null>(null);
  const [spaces, setSpaces] = useState<ProblemSpace[]>([]);
  const [mine, setMine] = useState<InvProblem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const loadMine = () => s.api.call('inv.problem.list').then((r: { problems: InvProblem[] }) => setMine(r.problems.filter((x) => x.mine))).catch(() => setMine([]));
  useEffect(() => { void s.api.call('inv.problem.spaces').then((x: ProblemSpace[]) => setSpaces(x)).catch(() => undefined); void loadMine(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const take = async (f: File | undefined) => { if (f) { try { setPhoto(await shrinkImage(f, 1280, 0.7)); } catch { toast(L('تعذّر أخذ الصورة', 'The photo could not be taken', 'La photo n’a pas pu être prise'), true); } } if (file.current) file.current.value = ''; };
  const send = async () => {
    setBusy(true);
    try {
      await s.api.call('inv.problem.report', { what, where: place, photo, key: crypto.randomUUID() });
      toast(L('أُرسل ✓ سيراه أمين الجرد', 'Sent ✓ the keeper will see it', 'Envoyé ✓ le gardien le verra'));
      setWhat(''); setPhoto(null);
      await loadMine(); await reload();
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  return (
    <Modal title={`⚠ ${L('أبلغ عن مشكلة', 'Report a problem', 'Signaler un problème')}`} onClose={onClose}>
      <Field label={L('ما المشكلة؟', 'What is wrong?', 'Qu’est-ce qui ne va pas ?')}>
        <textarea rows={3} value={what} onChange={(e) => setWhat(e.target.value)} autoFocus placeholder={L('مثلاً: المروحة لا تدور', 'For example: the fan does not turn', 'Par exemple : le ventilateur ne tourne pas')} />
      </Field>
      <Field label={L('أين؟', 'Where?', 'Où ?')}>
        <input className="inp" list="inv-problem-spaces" value={place} onChange={(e) => setPlace(e.target.value)} placeholder={L('الغرفة أو القاعة…', 'The room or the hall…', 'La salle…')} />
        <datalist id="inv-problem-spaces">{spaces.map((x) => <option key={x.id} value={x.name} />)}</datalist>
      </Field>
      <div className="row" style={{ marginBottom: 6 }}>
        <input ref={file} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void take(e.target.files?.[0])} />
        <button className="btn small" onClick={() => file.current?.click()}>📷 {photo ? L('صورة ✓', 'Photo ✓', 'Photo ✓') : L('أضف صورة', 'Add a photo', 'Ajouter une photo')}</button>
        {photo && <button className="btn ghost small" onClick={() => setPhoto(null)}>✕</button>}
      </div>
      {mine && mine.length > 0 && (
        <>
          <div className="small muted" style={{ marginTop: 10 }}>{L('بلاغاتي', 'My reports', 'Mes signalements')}</div>
          <ul className="inv-tl">
            {mine.slice(0, 8).map((p) => (
              <li key={p.id}><b>{p.what}</b>
                <small>{fmtDate(p.reported_at.slice(0, 10))}{p.where_text ? ` · ${p.where_text}` : ''} · <SaidBadge p={p} />{p.seen_note ? ` · ${p.seen_note}` : ''}</small></li>
            ))}
          </ul>
        </>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{L('إغلاق', 'Close', 'Fermer')}</button>
        <button className="btn primary" disabled={busy || !what.trim()} onClick={() => void send()}>{L('أرسل', 'Send', 'Envoyer')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- the keeper's list

export function ProblemsView({ inv, problems, refresh, openItem }: { inv: InvData; problems: InvProblem[] | null; refresh: () => Promise<void>; openItem: (id: number) => void }) {
  const [open, setOpen] = useState<InvProblem | null>(null);
  if (!problems) return <p className="muted">…</p>;
  if (!problems.length) return <p className="muted">{L('لا بلاغات.', 'No problems reported.', 'Aucun problème signalé.')}</p>;
  return (
    <>
      <div className="table-wrap"><table className="t">
        <thead><tr><th /><th>{L('ما المشكلة', 'What', 'Quoi')}</th><th>{L('أين', 'Where', 'Où')}</th><th>{L('من', 'From', 'De')}</th><th>{L('متى', 'When', 'Quand')}</th><th>{L('الحالة', 'State', 'État')}</th></tr></thead>
        <tbody>{keeperOrder(problems).map((p) => (
          <tr key={p.id} className="click" onClick={() => setOpen(p)}>
            <td style={{ width: 70 }}><PhotoBox p={p} h={44} /></td>
            <td>{p.what}</td><td>{p.where_text ?? ''}</td><td>{p.reported_by}</td><td>{fmtDate(p.reported_at.slice(0, 10))}</td>
            <td><SaidBadge p={p} /></td>
          </tr>
        ))}</tbody>
      </table></div>
      {open && <AnswerModal inv={inv} p={open} onClose={() => setOpen(null)} refresh={refresh} openItem={openItem} />}
    </>
  );
}

/** the keeper has seen it: which item (if any), and the state: needs repair / broken / nothing wrong */
function AnswerModal({ inv, p, onClose, refresh, openItem }: { inv: InvData; p: InvProblem; onClose: () => void; refresh: () => Promise<void>; openItem: (id: number) => void }) {
  const { s } = useApp();
  const space = inv.spaces.find((x) => x.id === p.space_id) ?? null;
  const [item, setItem] = useState<number | null>(p.item_id);
  const [result, setResult] = useState<ProblemResult>(p.result ?? 'repair');
  const [note, setNote] = useState(p.seen_note ?? '');
  const [busy, setBusy] = useState(false);
  // the items of the space first, then the others
  const live = inv.items.filter(inUse);
  const here = space?.place_id != null ? live.filter((i) => i.place_id === space.place_id) : [];
  const other = live.filter((i) => !here.includes(i));
  const opt = (i: InvItem) => <option key={i.id} value={i.id}>{i.code} · {i.name}{i.qty > 1 ? ` ×${i.qty}` : ''}{i.condition !== 'good' ? ` (${i.condition})` : ''}</option>;
  const save = async () => {
    setBusy(true);
    try { await s.api.call('inv.problem.answer', { id: p.id, result, item_id: item, note }); await refresh(); toast(L('حُفظ ✓ سيرى صاحب البلاغ ذلك', 'Saved ✓ the person will see it', 'Enregistré ✓ la personne le verra')); onClose(); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const sp = item != null ? spaceOfPlace(inv.spaces, inv.items.find((i) => i.id === item)?.place_id) : null;
  return (
    <Modal title={`⚠ ${p.what.slice(0, 50)}`} onClose={onClose}>
      <p style={{ marginTop: 0 }}><b>{p.what}</b></p>
      <p className="small muted">{p.reported_by} · {fmtDate(p.reported_at.slice(0, 10))}{p.where_text ? ` · ${p.where_text}` : ''}</p>
      <PhotoBox p={p} h={160} />
      <div className="grid2" style={{ marginTop: 10 }}>
        <Field label={L('الغرض المعني (إن وُجد)', 'The item concerned (if any)', 'L’objet concerné (s’il y en a un)')}>
          <select value={item ?? ''} onChange={(e) => setItem(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {here.length > 0 && <optgroup label={space?.name ?? ''}>{here.map(opt)}</optgroup>}
            <optgroup label={L('أغراض أخرى', 'Other items', 'Autres objets')}>{other.map(opt)}</optgroup>
          </select>
        </Field>
        <Field label={L('الحالة', 'State', 'État')}>
          <select value={result} onChange={(e) => setResult(e.target.value as ProblemResult)}>
            {(['repair', 'broken', 'nothing', 'good'] as ProblemResult[]).map((r) => <option key={r} value={r}>{RESULT_LABEL[r]()}</option>)}
          </select>
        </Field>
        <Field label={L('ملاحظة لصاحب البلاغ (اختياري)', 'A word for the person (optional)', 'Un mot pour la personne (facultatif)')} className="span2"><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      {item != null && result !== 'nothing' && <p className="small muted">{L('ستُسجَّل حالة الغرض في سجلّه.', 'The item\'s state is written in its history.', 'L’état de l’objet est écrit dans son historique.')}{sp ? ` · ${sp.name}` : ''}</p>}
      <div className="modal-foot">
        {item != null && <button className="btn" style={{ marginInlineEnd: 'auto' }} onClick={() => { onClose(); openItem(item); }}>{L('افتح الغرض', 'Open the item', 'Ouvrir l’objet')}</button>}
        <button className="btn" onClick={onClose}>{L('إغلاق', 'Close', 'Fermer')}</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{p.status === 'seen' ? L('حدّث', 'Update', 'Mettre à jour') : L('رأيته', 'Seen', 'Vu')}</button>
      </div>
    </Modal>
  );
}
