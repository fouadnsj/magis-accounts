// The inventory on paper (baseline 1.1, sections 5 and 8, step 4): the sheet of a space to put on its door, a list for counting
// space by space, the labels of a space, and the report for a donor ("what a project bought": a PDF with photos, and an Excel).
// The pages are drawn in io/invPaper.ts (the house look of the calendar's receipts); the rules are in inventory/report.ts.
import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Field, Modal, biName, errText, toast, todayIso } from './kit';
import { m, tx } from '../i18n';
import { saveFile } from '../platform';
import { labelsPdf } from '../io/invLabels';
import { useHouseLook } from './CalPaper';
import { useEntries, labelsOf } from './Inventory';
import { INV_AREA, type MapSpace } from '../inventory/map';
import { countingPlan, itemsOfSpace, placeLabel, projectReport, type BoughtFor } from '../inventory/report';
import type { InvData } from '../inventory/inv';

const L = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));
const savePdf = async (name: string, bytes: Uint8Array) => (await saveFile(name, ['pdf'], bytes, L('احفظ الملف', 'Save the file', 'Enregistrer le fichier'))) !== null;
const lastCountOf = (items: { counted_on: string | null }[]) => items.reduce<string | null>((a, i) => (i.counted_on && (!a || i.counted_on > a) ? i.counted_on : a), null);

/** the sheet for the door, the counting list and the labels of ONE space (its page) */
export function SpacePrint({ inv, sp }: { inv: InvData; sp: MapSpace }) {
  const look = useHouseLook();
  const here = itemsOfSpace(inv.items, sp);
  const area = inv.areas.find((a) => a.id === sp.building_id);
  const areaName = area && area.name !== INV_AREA ? area.name : '';
  const run = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { toast(errText(e), true); } };
  const door = () => run(async () => {
    const { spaceSheetPdf } = await import('../io/invPaper');
    const bytes = await spaceSheetPdf(await look(), { space: sp.name, area: areaName, items: here, categories: inv.categories, lastCount: lastCountOf(here), fixed: sp.fixed }, todayIso());
    await savePdf(`door-sheet_${sp.name.replace(/[^\w.-]+/g, '_')}.pdf`, bytes);
  });
  const count = () => run(async () => {
    const { countingListPdf } = await import('../io/invPaper');
    const bytes = await countingListPdf(await look(), [{ area: areaName, space: sp.name, lastCount: lastCountOf(here), items: here }], todayIso());
    await savePdf(`counting-list_${sp.name.replace(/[^\w.-]+/g, '_')}.pdf`, bytes);
  });
  const labels = () => run(async () => {
    const codes = labelsOf(inv, here);
    if (!codes.length) return void toast(L('لا أغراض لطباعة رموزها', 'No items to print labels for', 'Pas d’objets à étiqueter'), true);
    if (await saveFile(`labels_${sp.name.replace(/[^\w.-]+/g, '_')}.pdf`, ['pdf'], await labelsPdf(codes, inv.prefix), L('احفظ الملصقات', 'Save the labels', 'Enregistrer les étiquettes'))) toast(`${codes.length} ✓`);
  });
  return (
    <>
      <button className="btn" onClick={() => void door()}>🖨 {L('ورقة الباب', 'Sheet for the door', 'Feuille pour la porte')}</button>
      {inv.rights.keep && <button className="btn" disabled={!here.length} onClick={() => void count()}>☑ {L('قائمة للعدّ', 'Counting list', 'Liste de comptage')}</button>}
      {inv.rights.keep && <button className="btn" disabled={!here.length} onClick={() => void labels()}>🏷 {L('ملصقات', 'Labels', 'Étiquettes')}</button>}
    </>
  );
}

/** a list for counting, space by space: choose the spaces (all by default), one page each */
export function CountListWindow({ inv, onClose }: { inv: InvData; onClose: () => void }) {
  const look = useHouseLook();
  const plan = useMemo(() => countingPlan(inv), [inv]);
  const [on, setOn] = useState<Set<number>>(() => new Set(plan.map((x) => x.space.id)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: number) => setOn((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = plan.filter((x) => on.has(x.space.id));
  const go = async () => {
    setBusy(true);
    try {
      const { countingListPdf } = await import('../io/invPaper');
      const bytes = await countingListPdf(await look(), chosen.map((x) => ({ area: x.area.name === INV_AREA ? '' : x.area.name, space: x.space.name, lastCount: lastCountOf(x.items), items: x.items })), todayIso());
      if (await savePdf(`counting-list_${todayIso()}.pdf`, bytes)) onClose();
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const areas = [...new Set(plan.map((x) => x.area.id))];
  return (
    <Modal title={`☑ ${L('قائمة للعدّ', 'List for counting', 'Liste de comptage')}`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>{L('صفحة لكل مكان: الرمز والغرض والعدد، ومربّع تضع فيه علامة على ما تراه. ثم سجّل العدّ في الجرد (أو على الهاتف).', 'One page per space: label, item, quantity and a box to tick what you see. Then record the count in the inventory (or on the phone).', 'Une page par espace : étiquette, objet, quantité et une case à cocher. Puis enregistrez le comptage dans l’inventaire (ou sur le téléphone).')}</p>
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn small" onClick={() => setOn(new Set(plan.map((x) => x.space.id)))}>{L('الكل', 'All', 'Tous')}</button>
        <button className="btn small" onClick={() => setOn(new Set())}>{L('لا شيء', 'None', 'Aucun')}</button>
      </div>
      {areas.map((aid) => (
        <div key={aid} style={{ marginBottom: 6 }}>
          <b className="small">{biName(plan.find((x) => x.area.id === aid)!.area.name)}</b>
          {plan.filter((x) => x.area.id === aid).map((x) => (
            <label key={x.space.id} className="small cal-check" style={{ display: 'block' }}><input type="checkbox" checked={on.has(x.space.id)} onChange={() => toggle(x.space.id)} /> {x.space.name} <span className="muted">({x.items.length})</span></label>
          ))}
        </div>
      ))}
      {!plan.length && <p className="muted">{L('لا أغراض بعد.', 'No items yet.', 'Pas encore d’objets.')}</p>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{L('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={busy || !chosen.length} onClick={() => void go()}>{L('حضّر الصفحات', 'Prepare the pages', 'Préparer les pages')} ({chosen.length})</button>
      </div>
    </Modal>
  );
}

const monthNow = () => todayIso().slice(0, 7);
const monthsBack = (n: number) => { const d = new Date(`${todayIso()}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };

/** What a project bought: for the donor, a PDF with photos and an Excel (items bought on the lines funded by the project, in the months chosen) */
export function DonorReportWindow({ inv, onClose }: { inv: InvData; onClose: () => void }) {
  const { s, d } = useApp();
  const look = useHouseLook();
  const er = useEntries();
  const projects = d.lists.accounts.filter((a) => !a.outside_budget);
  const [account, setAccount] = useState<number | null>(projects[0]?.id ?? null);
  const proj = projects.find((a) => a.id === account);
  const [from, setFrom] = useState(() => proj?.start_date?.slice(0, 7) ?? monthsBack(11));
  const [to, setTo] = useState(() => proj?.end_date?.slice(0, 7) ?? monthNow());
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const pick = (id: number) => { const a = projects.find((x) => x.id === id); setAccount(id); setFrom(a?.start_date?.slice(0, 7) ?? monthsBack(11)); setTo(a?.end_date?.slice(0, 7) ?? monthNow()); setWaiting(null); };
  // the donor(s) of the project, from its grants (only for who sees the grants)
  const donor = (id: number) => [...new Set(d.grantParts.filter((p) => p.account_id === id).map((p) => { const g = d.grants.find((x) => x.id === p.grant_id); const n = d.lists.donors.find((x) => x.id === g?.donor_id)?.name; return n ? `${n}${g?.reference ? ` ${g.reference}` : ''}` : ''; }).filter(Boolean))].join(' | ');

  const build = async () => {
    const r = (await s.api.call('inv.report.project', { account_id: account!, from, to })) as { project: string; found: BoughtFor[]; waiting: number };
    setWaiting(r.waiting);
    const lines = new Map(d.lists.lines.map((l) => [l.id, l.name]));
    const heads = new Map(d.lists.headings.map((h) => [h.id, h.name]));
    const parties = new Map(d.lists.parties.map((p) => [p.id, p.name]));
    const by = new Map(r.found.map((f) => [f.trx_id, f]));
    const rep = projectReport({
      found: r.found, items: inv.items, categories: inv.categories, photos: inv.photos, areas: inv.areas, spaces: inv.spaces,
      entry: (id) => { const f = by.get(id); return { bill: er.bill(id), supplier: f?.party_id != null ? parties.get(f.party_id) ?? '' : '', heading: f?.heading_id != null ? heads.get(f.heading_id) ?? '' : '', line: f?.line_id != null ? lines.get(f.line_id) ?? '' : '' }; },
      spaceName: (pid) => placeLabel(inv, pid, INV_AREA),
    });
    return { r, rep, head: { project: r.project, donor: donor(account!), period: { from, to }, issuedOn: todayIso() } };
  };
  const pdf = async () => {
    setBusy('pdf');
    try {
      const { rep, head } = await build();
      // the first photo of each item (only those in the report)
      const photos = new Map<string, { bytes: Uint8Array; mime: string }>();
      for (const row of rep.rows) {
        if (!row.photo) continue;
        try { const p = (await s.api.call('inv.photo.get', { id: row.photo })) as { mime: string; base64: string }; photos.set(row.photo, { mime: p.mime, bytes: Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0)) }); } catch { /* a missing file */ }
      }
      const { projectReportPdf } = await import('../io/invPaper');
      if (await savePdf(`what-${head.project.replace(/[^\w.-]+/g, '_')}-bought_${from}_${to}.pdf`, await projectReportPdf(await look(), head, rep, photos))) toast(`${rep.items} ✓`);
    } catch (e) { toast(errText(e), true); } finally { setBusy(null); }
  };
  const xlsx = async () => {
    setBusy('xlsx');
    try {
      const { rep, head } = await build();
      const { projectReportXlsx } = await import('../io/invPaper');
      if ((await saveFile(`what-${head.project.replace(/[^\w.-]+/g, '_')}-bought_${from}_${to}.xlsx`, ['xlsx'], await projectReportXlsx({ ...head, organisation: s.organisation ?? '' }, rep), L('احفظ الملف', 'Save the file', 'Enregistrer le fichier'))) !== null) toast(`${rep.items} ✓`);
    } catch (e) { toast(errText(e), true); } finally { setBusy(null); }
  };
  return (
    <Modal title={`📄 ${L('ما اشتراه مشروع (للمانح)', 'What a project bought (for the donor)', 'Ce qu’un projet a acheté (pour le bailleur)')}`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>{L('الأغراض المشتراة على بنود الموازنة التي يموّلها المشروع في الفترة المختارة، مع الصور والأماكن والقيم. PDF بالصور للمانح، وExcel.', 'The items bought on the budget lines the project funds, in the months chosen, with photos, spaces and values: a PDF with photos for the donor, and an Excel.', 'Les objets achetés sur les lignes budgétaires financées par le projet, pendant les mois choisis, avec photos, espaces et valeurs : un PDF avec photos pour le bailleur, et un Excel.')}</p>
      <div className="grid2">
        <Field label={L('المشروع', 'Project', 'Projet')} className="span2">
          <select value={account ?? ''} onChange={(e) => pick(Number(e.target.value))}>{projects.map((a) => <option key={a.id} value={a.id}>{biName(a.name)}</option>)}</select>
        </Field>
        <Field label={L('من شهر', 'From month', 'Du mois')}><input className="inp" type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={L('إلى شهر', 'To month', 'Au mois')}><input className="inp" type="month" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {account != null && donor(account) && <p className="small muted">{L('المانح', 'Donor', 'Bailleur')}: {donor(account)}</p>}
      {waiting != null && waiting > 0 && <p className="small" style={{ color: 'var(--err)' }}>⚠ {waiting} {L('مشتريات لهذا المشروع في الفترة لم تُسجَّل غرضاً بعد: لن تظهر في التقرير.', 'purchases of this project in the period are not yet listed as items: they are not in the report.', 'achats de ce projet pendant la période ne sont pas encore des objets : ils ne sont pas dans le rapport.')}</p>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{L('إغلاق', 'Close', 'Fermer')}</button>
        <button className="btn" disabled={!!busy || account == null || from > to} onClick={() => void xlsx()}>{busy === 'xlsx' ? '…' : '⬇ Excel'}</button>
        <button className="btn primary" disabled={!!busy || account == null || from > to} onClick={() => void pdf()}>{busy === 'pdf' ? '…' : `📄 ${L('حضّر الـPDF بالصور', 'Prepare the PDF with photos', 'Préparer le PDF avec photos')}`}</button>
      </div>
    </Modal>
  );
}
