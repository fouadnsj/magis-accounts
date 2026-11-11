// Coordinator → Grants (Fouad, 2026-11-07): the Coordinator manages the grants entirely. A grant (donor, contract,
// amount, dates) is split between projects in the centres — a sum or a percentage each; its money arrives on the
// Province's account ("Money in", linked to the grant), and is then sent to the centres (next step).
import { useEffect, useState } from 'react';
import { provinceApi, type CentreProjects } from '../net';
import { newUid } from '../io/mainList';
import { partAmount, type NetGrantPart, type NetGrantRow } from '../domain/netGrants';
import { Field, Modal, confirmBox, errText, fmtDate, fmtUsd, parseAmount, promptBox, t, toast } from './kit';
import { saveFile } from '../platform';

const cur = (c: string) => (c === 'EUR' ? '€' : '$');

export function ProvinceGrants() {
  const [grants, setGrants] = useState<NetGrantRow[] | null>(null);
  const [centres, setCentres] = useState<CentreProjects[]>([]);
  const [edit, setEdit] = useState<NetGrantRow | 'new' | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const load = async () => {
    try {
      const [g, c] = await Promise.all([provinceApi.grants(), provinceApi.projects()]);
      setGrants(g);
      setCentres(c);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  useEffect(() => { void load(); }, []);
  if (!grants) return <p className="muted">…</p>;
  return (
    <div style={{ maxWidth: 1000 }}>
      <p className="muted small" style={{ marginTop: 0 }}>{t('المنسّق يدير المنح كلها: المنحة وتقسيمها على مشاريع المراكز (مبلغ أو نسبة). مالها يصل إلى حساب الإقليم («دخل» مع المنحة)، ثم يُرسل إلى المراكز.', "The Coordinator manages the grants entirely: the grant and its split between the centres' projects (a sum or a percentage). Its money arrives on the Province's account (\"Money in\" with the grant), then is sent to the centres.")}</p>
      <button className="btn primary" onClick={() => setEdit('new')}>＋ {t('منحة', 'Grant')}</button>
      <table className="t" style={{ marginTop: 12 }}>
        <thead><tr><th>{t('المانح · العقد', 'Donor · contract')}</th><th>{t('المدة', 'Period')}</th><th className="n">{t('المنحة', 'Grant')}</th><th>{t('التقسيم', 'Split')}</th><th className="n">{t('وصل', 'Received')}</th><th /></tr></thead>
        <tbody>
          {grants.map((g) => {
            const planned = g.parts.reduce((a, p) => a + partAmount(g, p), 0);
            return (
              <tr key={g.id} className={g.closed ? 'off' : ''}>
                <td><b>{g.donor}</b>{g.reference ? <span className="muted"> · {g.reference}</span> : null}{g.closed ? <span className="pill" style={{ marginInlineStart: 6 }}>{t('مغلقة', 'closed')}</span> : null}</td>
                <td className="small nowrap">{g.start_date ? fmtDate(g.start_date) : '…'} → {g.end_date ? fmtDate(g.end_date) : '…'}</td>
                <td className="n ltr">{cur(g.currency)}{fmtUsd(g.amount)}</td>
                <td className="small">
                  {g.parts.map((p, i) => <div key={i}>{p.centre_name} › {p.project_name ?? '—'}: <span className="ltr">{cur(g.currency)}{fmtUsd(partAmount(g, p))}{p.pct != null ? ` (${p.pct}%)` : ''}</span></div>)}
                  {Math.abs(g.amount - planned) > 0.5 && <div className="muted">{t('لم يُقسَّم بعد', 'Not split yet')}: {cur(g.currency)}{fmtUsd(g.amount - planned)}</div>}
                </td>
                <td className="n ltr small">{g.received_usd ? `$${fmtUsd(g.received_usd)}` : ''}{g.received_syp ? <div>{fmtUsd(g.received_syp)} SYP</div> : null}{!g.received_usd && !g.received_syp ? <span className="muted">{t('موعودة', 'promised')}</span> : null}</td>
                <td className="nowrap"><button className="btn small" onClick={() => setReport(g.id)}>📄 {t('التقرير', 'Report')}</button> <button className="btn small ghost" onClick={() => setEdit(g)}>{t('تعديل', 'Edit')}</button></td>
              </tr>
            );
          })}
          {!grants.length && <tr><td colSpan={6} className="muted">{t('لا منح بعد.', 'No grants yet.')}</td></tr>}
        </tbody>
      </table>
      {report && <GrantReportView id={report} onClose={() => setReport(null)} />}
      {edit && <GrantForm grant={edit === 'new' ? null : edit} centres={centres} onReload={load} onClose={() => setEdit(null)} />}
    </div>
  );
}

function GrantForm({ grant, centres, onClose, onReload }: { grant: NetGrantRow | null; centres: CentreProjects[]; onClose: () => void; onReload: () => Promise<void> }) {
  const [donor, setDonor] = useState(grant?.donor ?? '');
  const [reference, setReference] = useState(grant?.reference ?? '');
  const [amount, setAmount] = useState(grant ? String(grant.amount) : '');
  const [currency, setCurrency] = useState<'USD' | 'EUR'>(grant?.currency ?? 'USD');
  const [start, setStart] = useState(grant?.start_date ?? '');
  const [end, setEnd] = useState(grant?.end_date ?? '');
  const [note, setNote] = useState(grant?.note ?? '');
  const [closed, setClosed] = useState(!!grant?.closed);
  // the split: a sum or a percentage for the whole grant
  const [byPct, setByPct] = useState(!!grant?.parts.length && grant.parts.every((p) => p.pct != null));
  const [parts, setParts] = useState<(NetGrantPart & { v: string })[]>((grant?.parts ?? []).map((p) => ({ ...p, v: String(p.pct ?? p.amount ?? '') })));
  const [busy, setBusy] = useState(false);
  const total = parseAmount(amount);
  const value = (p: { v: string }) => parseAmount(p.v);
  const planned = parts.reduce((a, p) => a + (byPct ? (total * value(p)) / 100 : value(p)), 0);
  const projectsOf = (slug: string) => centres.find((c) => c.slug === slug)?.projects.filter((x) => x.active && !x.outside_budget) ?? [];
  const setPart = (i: number, x: Partial<NetGrantPart & { v: string }>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...x } : p)));
  const newProject = async (i: number) => {
    const p = parts[i];
    const name = (await promptBox(t('اسم المشروع الجديد في هذا المركز', 'The name of the new project in this centre'), `${donor} ${reference}`.trim()))?.trim();
    if (!name) return;
    try {
      const r = await provinceApi.newProject({ centre: p.centre, name, start_date: start || null, end_date: end || null });
      await onReload();
      setPart(i, { project_id: r.id, project_name: name });
      toast(t('أُنشئ المشروع في المركز', 'The project was made in the centre'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await provinceApi.saveGrant({
        id: grant?.id ?? newUid(), donor, reference: reference || null, amount: total, currency, start_date: start || null, end_date: end || null, note: note || null, closed: closed ? 1 : 0,
        parts: parts.map((p) => ({ centre: p.centre, centre_name: null, project_id: p.project_id, project_name: null, amount: byPct ? null : value(p), pct: byPct ? value(p) : null })),
      });
      await onReload();
      toast(t('حُفظت', 'Saved'));
      onClose();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={grant ? `${t('المنحة', 'Grant')}: ${grant.donor}` : t('منحة جديدة', 'A new grant')} onClose={onClose}>
      <div className="grid2">
        <Field label={t('المانح', 'Donor')}><input value={donor} onChange={(e) => setDonor(e.target.value)} autoFocus /></Field>
        <Field label={t('رقم العقد', 'Contract number')}><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label={t('المبلغ', 'Amount')}>
          <div className="row" style={{ gap: 6 }}>
            <input className="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <select value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'EUR')}><option>USD</option><option>EUR</option></select>
          </div>
        </Field>
        <Field label={t('ملاحظة', 'Note')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label={t('البداية', 'Start')}><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={t('النهاية', 'End')}><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>

      <h3 style={{ marginBottom: 4 }}>{t('التقسيم على مشاريع المراكز', "The split between the centres' projects")}</h3>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <button className={`chip ${!byPct ? 'on' : ''}`} onClick={() => setByPct(false)}>{t('بالمبلغ', 'By sum')}</button>
        <button className={`chip ${byPct ? 'on' : ''}`} onClick={() => setByPct(true)}>{t('بالنسبة %', 'By %')}</button>
      </div>
      <table className="t">
        <tbody>
          {parts.map((p, i) => (
            <tr key={i}>
              <td><select value={p.centre} onChange={(e) => setPart(i, { centre: e.target.value, project_id: null })}>
                {centres.map((c) => <option key={c.slug} value={c.slug}>{c.organisation}</option>)}
              </select></td>
              <td>
                <select value={p.project_id ?? ''} onChange={(e) => setPart(i, { project_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— {t('المشروع', 'project')} —</option>
                  {projectsOf(p.centre).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>{' '}
                <button className="btn small ghost" title={t('مشروع جديد في هذا المركز', 'A new project in this centre')} onClick={() => void newProject(i)}>＋</button>
              </td>
              <td><input className="ltr" style={{ width: 110 }} value={p.v} onChange={(e) => setPart(i, { v: e.target.value })} /> {byPct ? '%' : cur(currency)}</td>
              <td><button className="btn small ghost" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn small" style={{ marginTop: 6 }} disabled={!centres.length} onClick={() => setParts((ps) => [...ps, { centre: centres[0].slug, centre_name: null, project_id: null, project_name: null, amount: null, pct: null, v: '' }])}>＋ {t('جزء', 'Part')}</button>
      {total > 0 && <p className={`small ${planned > total + 0.5 ? 'alert err' : 'muted'}`}>{t('مقسَّم', 'Split')}: {cur(currency)}{fmtUsd(planned)} / {cur(currency)}{fmtUsd(total)}{planned < total - 0.5 ? ` · ${t('باقٍ', 'left')} ${cur(currency)}${fmtUsd(total - planned)}` : ''}</p>}
      {grant && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> {t('المنحة مغلقة (انتهت)', 'The grant is closed (finished)')}</label>}

      <div className="modal-foot">
        {grant && !grant.received_usd && !grant.received_syp && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={() => void (async () => {
          if (!(await confirmBox(t('حذف هذه المنحة؟', 'Delete this grant?'), true))) return;
          try { await provinceApi.deleteGrant(grant.id); await onReload(); onClose(); } catch (e) { toast(errText(e), true); }
        })()}>{t('حذف', 'Delete')}</button>}
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy || !donor.trim() || !(total > 0) || planned > total + 0.5} onClick={() => void save()}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

/** One grant across the centres: what each part planned, received and spent; by activity and by line; its Excel. */
export function GrantReportView({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof provinceApi.report>> | null>(null);
  const [lines, setLines] = useState(false);
  useEffect(() => { provinceApi.report(id).then(setData).catch((e) => toast(errText(e), true)); }, [id]);
  if (!data) return <Modal title="…" onClose={onClose}><p className="muted">…</p></Modal>;
  const { grant: g, report: r } = data;
  const centres = r.parts.map((p) => p.centre_name);
  const usd = (n: number) => `$${fmtUsd(n)}`;
  const excel = async () => {
    try {
      const { grantXlsx } = await import('../io/grantExcel');
      const path = await saveFile(`${`${g.donor} ${g.reference ?? ''}`.trim().replace(/[^\p{L}\p{N}]+/gu, '-')}.xlsx`, ['xlsx'], await grantXlsx(g, r), t('احفظ ملف Excel', 'Save the Excel file'));
      if (path) toast(`${t('حُفظ', 'Saved')}: ${path}`);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const table = (rows: typeof r.byHeading, withLine: boolean) => (
    <table className="t" style={{ marginTop: 6 }}>
      <thead><tr><th>{t('النشاط', 'Activity')}</th>{withLine && <th>{t('الخط', 'Line')}</th>}<th className="n">{t('الموازنة', 'Budget')}</th><th className="n">{t('صُرف', 'Spent')}</th>{centres.map((c, i) => <th key={i} className="n small">{c}</th>)}<th className="n">{t('باقٍ', 'Left')}</th></tr></thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.key}><td>{x.heading}</td>{withLine && <td>{x.line}</td>}<td className="n ltr">{usd(x.budget)}</td><td className="n ltr">{usd(x.spent)}</td>{centres.map((c, i) => <td key={i} className="n ltr small">{usd(x.byCentre[c] ?? 0)}</td>)}<td className="n ltr">{usd(x.budget - x.spent)}</td></tr>
        ))}
        {!rows.length && <tr><td colSpan={5} className="muted">{t('لا خطوط للمشاريع بعد.', 'The projects have no lines yet.')}</td></tr>}
      </tbody>
    </table>
  );
  return (
    <Modal title={`${g.donor}${g.reference ? ` · ${g.reference}` : ''}`} onClose={onClose}>
      <div className="muted small">{g.start_date ? fmtDate(g.start_date) : '…'} → {g.end_date ? fmtDate(g.end_date) : '…'}</div>
      <div className="cards" style={{ marginTop: 8 }}>
        <div className="card"><div className="k">{t('المنحة', 'Grant')}</div><div className="v ltr">{cur(g.currency)}{fmtUsd(g.amount)}</div></div>
        <div className="card"><div className="k">{t('وصل إلى الإقليم', 'Received by the Province')}</div><div className="v ltr">{usd(g.received_usd)}</div></div>
        <div className="card"><div className="k">{t('أُرسل إلى المراكز', 'Sent to the centres')}</div><div className="v ltr">{usd(r.total.sent_usd)}</div>{r.total.sent_syp ? <div className="ltr small">+ {fmtUsd(r.total.sent_syp)} SYP</div> : null}<div className="muted small">{t('قُبل', 'accepted')} {usd(r.total.accepted_usd)}</div></div>
        <div className="card"><div className="k">{t('صُرف', 'Spent')}</div><div className="v ltr">{usd(r.total.spent)}</div><div className="muted small">{t('من موازنة', 'of a budget of')} {usd(r.total.budget)}</div></div>
      </div>
      <h3>{t('حسب المركز', 'By centre')}</h3>
      <table className="t">
        <thead><tr><th>{t('المركز › المشروع', 'Centre › project')}</th><th className="n">{t('مخطط', 'Planned')}</th><th className="n">{t('أُرسل', 'Sent')}</th><th className="n">{t('الموازنة', 'Budget')}</th><th className="n">{t('صُرف', 'Spent')}</th></tr></thead>
        <tbody>
          {r.parts.map((p, i) => (
            <tr key={i}><td>{p.centre_name} › {p.project_name ?? '—'}{p.copy_at && <div className="muted small">{t('نسخة بتاريخ', 'copy of')} {fmtDate(p.copy_at.slice(0, 10))}</div>}</td>
              <td className="n ltr">{cur(g.currency)}{fmtUsd(p.planned)}</td><td className="n ltr">{usd(p.sent_usd)}{p.sent_syp ? <div className="small">+ {fmtUsd(p.sent_syp)} SYP</div> : null}{(p.sent_usd !== p.accepted_usd || p.sent_syp !== p.accepted_syp) && <div className="muted small">{t('قُبل', 'accepted')} {usd(p.accepted_usd)}{p.accepted_syp ? ` + ${fmtUsd(p.accepted_syp)} SYP` : ''}</div>}</td>
              <td className="n ltr">{usd(p.budget)}</td><td className="n ltr">{usd(p.spent)}</td></tr>
          ))}
        </tbody>
      </table>
      <h3>{t('حسب النشاط', 'By activity')}</h3>
      {table(r.byHeading, false)}
      <button className="link small" onClick={() => setLines((x) => !x)}>{lines ? '▾' : '▸'} {t('حسب الخط', 'By line')}</button>
      {lines && table(r.byLine, true)}
      <div className="modal-foot">
        <button className="btn" onClick={() => void excel()}>⬇ Excel</button>
        <button className="btn primary" onClick={onClose}>{t('إغلاق', 'Close')}</button>
      </div>
    </Modal>
  );
}
