// A centre asks the administrator for a heading or a line (Fouad, 2026-11-03): it does not add one itself. Before
// sending, it sees the lines that look the same ("is it one of these?"). Meanwhile its rows wait on a line it chose;
// once the answer is published and the line taken, they can move to it. A centre on its own computer sends its
// request as a file.
import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { mainListApi } from '../net';
import { MAIN_REQUESTS, newUid, similar, type MainList, type MainRequest } from '../io/mainList';
import type { TrxType } from '../domain/types';
import { saveFile } from '../platform';
import { Field, Modal, Select, errText, fmtDate, fmtUsd, t, toast } from './kit';

const STATUS = {
  open: () => t('ينتظر جواب المدير', 'waiting for the administrator'),
  added: () => t('أُضيف إلى القائمة الرئيسية', 'added to the main list'),
  same: () => t('موجود: استعمل', 'it exists: use'),
  refused: () => t('رُفض', 'refused'),
};

export function AskModal({ list, onClose, onSent }: { list: MainList | null; onClose: () => void; onSent: () => void }) {
  const { s, d } = useApp();
  const L = d.lists;
  const [kind, setKind] = useState<'line' | 'heading'>('line');
  const [name, setName] = useState('');
  const [heading, setHeading] = useState<string | null>(null);
  const [type, setType] = useState<TrxType>('Exp');
  const [why, setWhy] = useState('');
  // the line its rows wait on: "Other / Unallocated" when there is one
  const other = L.lines.find((l) => l.active && /other|unallocated|divers/i.test(l.name) && L.headings.find((h) => h.id === l.heading_id && /other|unallocated/i.test(h.name)));
  const [meanwhile, setMeanwhile] = useState<number | null>(other?.id ?? null);
  const [busy, setBusy] = useState(false);
  // the headings of the main list (on the server), else those this database took from it
  const heads = list ? list.headings.filter((h) => h.active).map((h) => ({ uid: h.uid, name: `${h.code} ${h.name}` }))
    : L.headings.filter((h) => h.active && h.in_main && h.uid).map((h) => ({ uid: h.uid!, name: `${h.code} ${h.name}` }));
  const like = name.trim().length >= 3 ? (list ? similar(list, name) : L.lines.filter((l) => l.in_main && l.active && name.toLowerCase().split(/\s+/).some((w) => w.length >= 3 && l.name.toLowerCase().includes(w))).map((l) => ({ uid: l.uid!, name: l.name, heading: L.headings.find((h) => h.id === l.heading_id)?.name ?? null, code: l.code })).slice(0, 12)) : [];
  const ok = name.trim() && (kind === 'heading' || heading);
  const send = async () => {
    setBusy(true);
    try {
      const r = { kind, name: name.trim(), heading_uid: kind === 'line' ? heading : null, type: kind === 'heading' ? type : null, why: why.trim(), meanwhile_line_uid: L.lines.find((l) => l.id === meanwhile)?.uid ?? null };
      if (s.mode === 'server') {
        await mainListApi.ask(r);
        toast(t('أُرسل الطلب إلى المدير', 'The request was sent to the administrator'));
      } else {
        // on its own computer: the request as a file, for the administrator
        const full: MainRequest = {
          ...r, id: newUid(), heading_name: heads.find((h) => h.uid === heading)?.name ?? null, centre: s.organisation, organisation: s.organisation,
          server: null, by: s.profile.name, at: new Date().toISOString(), status: 'open', answer_uid: null, answer_name: null, note: null, answered_at: null,
        };
        const path = await saveFile(`request-${s.organisation.replace(/[^\p{L}\p{N}]+/gu, '-')}-${new Date().toISOString().slice(0, 10)}.json`, ['json'],
          new TextEncoder().encode(JSON.stringify({ kind: MAIN_REQUESTS, requests: [full] }, null, 1)), t('احفظ الطلب', 'Save the request'));
        if (!path) return;
        toast(`${t('حُفظ الطلب: أرسله إلى المدير', 'The request was saved: send it to the administrator')} · ${path}`);
      }
      onSent();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('اطلب من المدير بنداً أو خطاً', 'Ask the administrator for a heading or a line')} onClose={onClose}>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <button className={`chip ${kind === 'line' ? 'on' : ''}`} onClick={() => setKind('line')}>{t('خط', 'A line')}</button>
        <button className={`chip ${kind === 'heading' ? 'on' : ''}`} onClick={() => setKind('heading')}>{t('بند', 'A heading')}</button>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <Field label={t('الاسم', 'Name')}><input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {kind === 'line'
          ? <Field label={t('تحت البند', 'Under the heading')}><select className="inp" value={heading ?? ''} onChange={(e) => setHeading(e.target.value || null)}>
              <option value="">—</option>{heads.map((h) => <option key={h.uid} value={h.uid}>{h.name}</option>)}</select></Field>
          : <Field label={t('النوع', 'Type')}><select className="inp" value={type} onChange={(e) => setType(e.target.value as TrxType)}>
              <option value="Exp">{t('نفقة', 'Expense')}</option><option value="Income">{t('إيراد', 'Income')}</option>
              <option value="Transfer">{t('تحويل', 'Transfer')}</option><option value="Exchange">{t('تصريف', 'Exchange')}</option></select></Field>}
        <Field label={t('لماذا؟ (جملة واحدة)', 'Why? (one sentence)')}><input className="inp" value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
        {kind === 'line' && (
          <Field label={t('في الانتظار، تُسجَّل القيود على', 'Meanwhile, the rows are recorded on')}>
            <div style={{ minWidth: 220 }}><Select value={meanwhile} onChange={setMeanwhile} placeholder="—"
              options={L.lines.filter((l) => l.active && l.merged_into == null).map((l) => ({ value: l.id, label: `${l.code} ${l.name}` }))} /></div>
          </Field>
        )}
      </div>
      {like.length > 0 && (
        <div className="panel" style={{ background: '#FBF7EE', marginTop: 8 }}>
          <b className="small">{t('هل هو واحد من هذه؟ إن كان كذلك فلا حاجة للطلب: خذه من القائمة الرئيسية.', 'Is it one of these? If so, no request is needed: take it from the main list.')}</b>
          <ul className="small" style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
            {like.map((x) => <li key={x.uid}><span className="code">{x.code}</span> {x.heading ? `${x.heading} › ` : ''}<b>{x.name}</b></li>)}
          </ul>
        </div>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!ok || busy} onClick={() => void send()}>
          {s.mode === 'server' ? t('أرسل الطلب', 'Send the request') : t('احفظ الطلب ملفاً', 'Save the request as a file')}
        </button>
      </div>
    </Modal>
  );
}

/** This centre's requests (on the server), their answers, and "Take it" once the answer is published. */
export function MyRequests({ list, version }: { list: MainList | null; version: number }) {
  const { s, d, reload } = useApp();
  const [rows, setRows] = useState<MainRequest[]>([]);
  const [moving, setMoving] = useState<MainRequest | null>(null);
  useEffect(() => {
    if (s.mode === 'server') mainListApi.requests().then(setRows).catch(() => setRows([]));
  }, [s, version]);
  if (!rows.length) return null;
  const published = (uid: string | null) => !!uid && !!list && [...list.headings, ...list.lines].some((x) => x.uid === uid);
  const here = (uid: string | null) => !!uid && [...d.lists.headings, ...d.lists.lines].some((x) => x.uid === uid && x.active);
  const take = async (r: MainRequest) => {
    if (!list || !r.answer_uid) return;
    try {
      await s.api.call('main.take', { list, take: [r.answer_uid] });
      await reload();
      toast(t('أُخذ', 'Taken'));
      if (r.kind === 'line' && r.meanwhile_line_uid) setMoving(r);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div style={{ marginTop: 10 }}>
      <b className="small">{t('طلبات هذا المركز', "This centre's requests")}</b>
      <table className="t" style={{ marginTop: 4 }}>
        <tbody>
          {[...rows].reverse().slice(0, 15).map((r) => (
            <tr key={r.id}>
              <td className="small nowrap">{fmtDate(r.at.slice(0, 10))}</td>
              <td>{r.kind === 'line' ? `${r.heading_name ?? ''} › ` : ''}<b>{r.name}</b>{r.why ? <div className="muted small">{r.why}</div> : null}</td>
              <td className="small">
                {STATUS[r.status]()}{r.answer_name && r.status !== 'added' ? ` «${r.answer_name}»` : ''}{r.note ? <div className="muted">{r.note}</div> : null}
                {r.status === 'added' && !published(r.answer_uid) && <div className="muted">{t('يصل حين ينشر المدير القائمة', 'it arrives when the administrator publishes the list')}</div>}
              </td>
              <td className="nowrap">
                {(r.status === 'added' || r.status === 'same') && published(r.answer_uid) && (here(r.answer_uid)
                  ? (r.kind === 'line' && r.meanwhile_line_uid ? <button className="btn small ghost" onClick={() => setMoving(r)}>{t('انقل القيود المنتظرة…', 'Move the waiting rows…')}</button> : <span className="muted small">✓ {t('هنا', 'here')}</span>)
                  : <button className="btn small" onClick={() => void take(r)}>{t('خذه', 'Take it')}</button>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {moving && <MoveRowsModal r={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

/** The rows that waited on another line: ticked ones move to the line now taken. */
function MoveRowsModal({ r, onClose }: { r: MainRequest; onClose: () => void }) {
  const { s, d, reload } = useApp();
  const from = d.lists.lines.find((l) => l.uid === r.meanwhile_line_uid);
  const to = d.lists.lines.find((l) => l.uid === r.answer_uid && l.merged_into == null);
  const rows = from ? d.rows.filter((x) => x.line_id === from.id) : [];
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const move = async () => {
    setBusy(true);
    try {
      const x = await s.api.call('main.moveRows', { ids: [...pick], toLineId: to!.id });
      toast(t(`نُقل ${x.moved} قيداً`, `${x.moved} rows moved`));
      await reload();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('انقل القيود المنتظرة', 'Move the waiting rows')} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>{from && to ? t(`من «${from.name}» إلى «${to.name}». علّم القيود التي تخص الخط الجديد.`, `From "${from.name}" to "${to.name}". Tick the rows that belong to the new line.`) : t('الخط غير موجود هنا.', 'The line is not here.')}</p>
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        <table className="t">
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td><input type="checkbox" checked={pick.has(x.id)} onChange={(e) => setPick((p) => { const n = new Set(p); e.target.checked ? n.add(x.id) : n.delete(x.id); return n; })} /></td>
                <td className="nowrap">{x.date ? fmtDate(x.date) : ''}</td>
                <td>{x.explanation}</td>
                <td className="n">{fmtUsd(d.comp.get(x.id)?.expUsdTot ?? 0)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td className="muted">{t('لا قيود على ذلك الخط.', 'No rows on that line.')}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('لاحقاً', 'Later')}</button>
        <button className="btn primary" disabled={!pick.size || !to || busy} onClick={() => void move()}>{t(`انقل ${pick.size}`, `Move ${pick.size}`)}</button>
      </div>
    </Modal>
  );
}
