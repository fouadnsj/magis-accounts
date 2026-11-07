// Sends of the Province to the centres (Fouad, 2026-11-07), the same rules as a transfer between books: recorded once
// by the Province; only the centre answers (accepted, or "not received" with a word); the Province may correct or cancel
// until it is accepted; then it no longer changes; the months wait for the answer.
import { useEffect, useState } from 'react';
import { provinceApi, sendsApi, type CentreProjects, type ProvinceSendRow } from '../net';
import { partAmount, type NetGrantRow } from '../domain/netGrants';
import type { ProvinceSend } from '../ops';
import { useApp } from '../state';
import { Field, Modal, confirmBox, errText, fmtDate, fmtSyp, fmtUsd, parseAmount, promptBox, t, toast, todayIso } from './kit';

const money = (usd: number, syp: number) => (usd ? `$${fmtUsd(usd)}` : `${fmtSyp(syp)} SYP`);

/** Province account: what was sent, its answers, and "Send to a centre". */
export function ProvinceSends({ onChanged }: { onChanged: () => Promise<void> }) {
  const [rows, setRows] = useState<ProvinceSendRow[] | null>(null);
  const [grants, setGrants] = useState<NetGrantRow[]>([]);
  const [centres, setCentres] = useState<CentreProjects[]>([]);
  const [edit, setEdit] = useState<ProvinceSendRow | 'new' | null>(null);
  const load = async () => {
    try {
      const [r, g, c] = await Promise.all([sendsApi.list(), provinceApi.grants(), provinceApi.projects()]);
      setRows(r);
      setGrants(g);
      setCentres(c);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  useEffect(() => { void load(); }, []);
  if (!rows) return null;
  const status = (r: ProvinceSendRow) => r.received_at ? `✓ ${t('قبله المركز', 'accepted')}` : r.disputed_at ? `⚠ ${t('لم يصل', 'not received')}${r.dispute_note ? `: ${r.dispute_note}` : ''}` : `⏳ ${t('ينتظر جواب المركز', "waiting for the centre's answer")}`;
  return (
    <div style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{t('الإرسال إلى المراكز', 'Sent to the centres')}</h3>
        <button className="btn primary small" disabled={!centres.length} onClick={() => setEdit('new')}>→ {t('أرسل إلى مركز', 'Send to a centre')}</button>
      </div>
      <table className="t" style={{ marginTop: 6 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.trx_id}>
              <td className="nowrap">{fmtDate(r.date)}</td>
              <td>{r.centre_name} › {r.project_name ?? '—'}<div className="muted small">{r.explanation}</div></td>
              <td className="n ltr">{money(r.usd, r.syp)}</td>
              <td className="small">{status(r)}</td>
              <td className="nowrap">{!r.received_at && <>
                <button className="btn small ghost" onClick={() => setEdit(r)}>{t('صحّح', 'Correct')}</button>
                <button className="btn small ghost" onClick={() => void (async () => {
                  if (!(await confirmBox(t('إلغاء هذا الإرسال؟ يختفي من المركز.', 'Cancel this send? It disappears from the centre.'), true))) return;
                  try { await sendsApi.cancel(r.trx_id); await load(); await onChanged(); } catch (e) { toast(errText(e), true); }
                })()}>{t('ألغِ', 'Cancel')}</button>
              </>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td className="muted">{t('لم يُرسل شيء بعد.', 'Nothing sent yet.')}</td></tr>}
        </tbody>
      </table>
      {edit && <SendForm row={edit === 'new' ? null : edit} grants={grants.filter((g) => !g.closed)} centres={centres} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); await load(); await onChanged(); }} />}
    </div>
  );
}

function SendForm({ row, grants, centres, onClose, onDone }: { row: ProvinceSendRow | null; grants: NetGrantRow[]; centres: CentreProjects[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [date, setDate] = useState(row?.date ?? todayIso());
  const [grant, setGrant] = useState(row?.grant_id ?? '');
  const [centre, setCentre] = useState(row?.centre ?? centres[0]?.slug ?? '');
  const [project, setProject] = useState<number | null>(row?.project_id ?? null);
  const [cur, setCur] = useState<'USD' | 'SYP'>(row && !row.usd ? 'SYP' : 'USD');
  const [amount, setAmount] = useState(row ? String(row.usd || row.syp) : '');
  const [busy, setBusy] = useState(false);
  const g = grants.find((x) => x.id === grant);
  const projects = centres.find((c) => c.slug === centre)?.projects.filter((x) => x.active) ?? [];
  const n = parseAmount(amount);
  return (
    <Modal title={row ? t('صحّح الإرسال', 'Correct the send') : t('أرسل إلى مركز', 'Send to a centre')} onClose={onClose} narrow>
      <Field label={t('التاريخ', 'Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={t('المنحة', 'Grant')}>
        <select value={grant} onChange={(e) => setGrant(e.target.value)}>
          <option value="">— {t('بلا منحة', 'no grant')} —</option>
          {grants.map((x) => <option key={x.id} value={x.id}>{x.donor}{x.reference ? ` · ${x.reference}` : ''}</option>)}
        </select>
      </Field>
      {g && g.parts.length > 0 && (
        <div className="small" style={{ marginBottom: 8 }}>
          {t('أجزاء المنحة:', "The grant's parts:")}{' '}
          {g.parts.map((p, i) => (
            <button key={i} className={`chip ${centre === p.centre && project === p.project_id ? 'on' : ''}`} onClick={() => { setCentre(p.centre); setProject(p.project_id); }}>
              {p.centre_name} › {p.project_name ?? '—'} ({g.currency === 'EUR' ? '€' : '$'}{fmtUsd(partAmount(g, p))})
            </button>
          ))}
        </div>
      )}
      <Field label={t('المركز', 'Centre')}>
        <select value={centre} onChange={(e) => { setCentre(e.target.value); setProject(null); }}>
          {centres.map((c) => <option key={c.slug} value={c.slug}>{c.organisation}</option>)}
        </select>
      </Field>
      <Field label={t('المشروع', 'Project')}>
        <select value={project ?? ''} onChange={(e) => setProject(e.target.value ? Number(e.target.value) : null)}>
          <option value="">—</option>
          {projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <Field label={t('المبلغ', 'Amount')}>
        <div className="row" style={{ gap: 6 }}>
          <input className="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select value={cur} onChange={(e) => setCur(e.target.value as 'USD' | 'SYP')}><option>USD</option><option>SYP</option></select>
        </div>
      </Field>
      <p className="muted small">{t('يظهر في المركز «ينتظر جوابه». حتى يقبله، يبقى شهرك وشهره مفتوحين.', 'It appears in the centre, waiting for its answer. Until it accepts, your month and its month stay open.')}</p>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy || !(n > 0) || !centre || !project} onClick={() => void (async () => {
          setBusy(true);
          try {
            await sendsApi.send({ id: row?.trx_id, date, centre, project_id: project, grant_id: grant || null, cur, amount: n });
            toast(t('أُرسل', 'Sent'));
            await onDone();
          } catch (e) {
            toast(errText(e), true);
          } finally {
            setBusy(false);
          }
        })()}>{row ? t('صحّح', 'Correct') : t('أرسل', 'Send')}</button>
      </div>
    </Modal>
  );
}

/** In the centre (Grants page): the money sent by the Province, to accept or to say "not received". */
export function ProvinceReceived() {
  const { s, d, can, reload } = useApp();
  const [rows, setRows] = useState<ProvinceSend[]>([]);
  const load = () => s.api.call('province.sends', {}).then(setRows).catch(() => setRows([]));
  useEffect(() => { if (s.mode === 'server') void load(); }, [s]);
  if (!rows.length) return null;
  const project = (id: number | null) => d.lists.accounts.find((a) => a.id === id)?.name ?? '—';
  const answer = async (r: ProvinceSend, ok: boolean) => {
    let note: string | null = null;
    if (!ok) {
      note = (await promptBox(t('ماذا وصل؟ (جملة للإقليم)', 'What arrived? (a sentence for the Province)')))?.trim() ?? null;
      if (note == null) return;
    } else if (!(await confirmBox(t(`قبول ${money(r.usd, r.syp)} للمشروع «${project(r.project_id)}»؟ يدخل دفتر المنح.`, `Accept ${money(r.usd, r.syp)} for the project "${project(r.project_id)}"? It enters the grants book.`)))) return;
    try {
      await sendsApi.answer(r.id, ok, note);
      await load();
      await reload();
      toast(ok ? t('قُبل', 'Accepted') : t('أُبلغ الإقليم', 'The Province was told'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <b>{t('من الإقليم', 'From the Province')}</b>
      <table className="t" style={{ marginTop: 6 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{fmtDate(r.date)}</td>
              <td>{r.donor ?? ''}{r.reference ? ` · ${r.reference}` : ''} › <b>{project(r.project_id)}</b></td>
              <td className="n ltr">{money(r.usd, r.syp)}</td>
              <td className="small">{r.status === 'accepted' ? `✓ ${t('قُبل', 'accepted')}` : r.status === 'disputed' ? `⚠ ${t('قلنا: لم يصل', 'we said: not received')}${r.note ? ` (${r.note})` : ''}` : `⏳ ${t('ينتظر جوابنا', 'waiting for our answer')}`}</td>
              <td className="nowrap">{r.status !== 'accepted' && can('lists.donors') && <>
                <button className="btn small primary" onClick={() => void answer(r, true)}>{t('اقبل', 'Accept')}</button>{' '}
                {r.status === 'waiting' && <button className="btn small ghost" onClick={() => void answer(r, false)}>{t('لم يصل', 'Not received')}</button>}
              </>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
