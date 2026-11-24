// The inventory (Fouad, 21 November 2026): what the centre owns, where it is, its state — kept by the finance, linked
// to the purchases of the register. Four tabs: the items; the purchases still to register (the control); the count;
// and the settings (categories, places, which budget lines are inventory purchases, labels, import and export).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import { Field, Modal, Select, Tabs, confirmBox, errText, fmtDate, fmtUsd, promptBox, t, toast, todayIso, type Option } from './kit';
import { GuideLink } from '../guide/GuideView';
import { pickFile, saveFile } from '../platform';
import { inventoryTemplate, inventoryWorkbook, readTable } from '../io/invFile';
import { labelsPdf } from '../io/invLabels';
import { shrinkImage } from '../io/shrink';
import {
  blankLabelCodes, COMMON_ITEMS, CONDITIONS, inUse, invEntries, itemTotal, pendingEntries, QR_FIELDS, qrText, tableToImport,
  type InvCondition, type InvData, type InvImportRow, type InvItem,
} from '../inventory/inv';
import { holderRefOf, type HrPick } from '../inventory/map';
import type { Trx } from '../domain/types';

type Tab = 'items' | 'register' | 'quick' | 'count' | 'settings';

export const COND_LABEL: Record<InvCondition, () => string> = { good: () => t('جيد', 'Good'), repair: () => t('يحتاج إصلاحاً', 'Needs repair'), broken: () => t('معطّل', 'Broken') };
const originName = (inv: InvData, i: Pick<InvItem, 'origin_id' | 'origin'>) => inv.origins.find((o) => o.id === i.origin_id)?.name ?? i.origin;
/** the labels of items: the QR holds the label and what the settings add */
export const labelsOf = (inv: InvData, list: InvItem[]) => {
  const cat = new Map(inv.categories.map((c) => [c.id, c.name.split(' · ')[0]]));
  const place = new Map(inv.places.map((p) => [p.id, p.name]));
  return list.filter(inUse).map((i) => ({ code: i.code, qr: qrText(i, inv.qr, { category: i.category_id ? cat.get(i.category_id) : null, place: i.place_id ? place.get(i.place_id) : null }) }));
};
export const MOVE_LABEL: Record<string, () => string> = {
  added: () => t('أُضيف', 'Added'), moved: () => t('نُقل', 'Moved'), given: () => t('سُلّم لشخص', 'Given to'), returned: () => t('أُرجع', 'Returned'),
  repair: () => t('يحتاج إصلاحاً', 'Needs repair'), repaired: () => t('أُصلح', 'Repaired'), broken: () => t('تعطّل', 'Broken'), counted: () => t('عُدّ', 'Counted'),
  disposed: () => t('أُخرج', 'Taken out'), lost: () => t('فُقد', 'Lost'), split: () => t('قُسّمت المجموعة', 'Group split'),
};

/** the purchases the inventory works with (a keeper who does not see every book gets those on inventory lines from the server) */
export function useEntries() {
  const { d } = useApp();
  return useMemo(() => invEntries(d), [d.rows, d.comp, d.inv]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Inventory() {
  const { s, can, d, reload } = useApp();
  const manage = can('inventory.manage');
  const [tab, setTab] = useState<Tab>('items');
  const [inv, setInv] = useState<InvData | null>(null);
  const load = useCallback(async () => {
    try { setInv(await s.api.call('inv.get')); } catch (e) { toast(errText(e), true); }
  }, [s]);
  useEffect(() => { void load(); }, [load, d.inv]);
  const both = async () => { await reload(); await load(); };
  const er = useEntries();
  const pending = useMemo(() => pendingEntries(er.rows, d.lists, d.inv), [er, d.lists, d.inv]);

  return (
    <>
      <div className="page-head"><h1>{t('الجرد', 'Inventory')}<GuideLink id="inventory" /></h1></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'items', label: t('الأغراض', 'Items') },
        { value: 'register', label: `${t('مشتريات تُسجَّل', 'To register')}${pending.length ? ` (${pending.length})` : ''}` },
        { value: 'quick', label: t('تسجيل سريع', 'Quick add'), hidden: !manage },
        { value: 'count', label: t('العدّ', 'Count'), hidden: !manage },
        { value: 'settings', label: t('الإعدادات', 'Settings'), hidden: !manage },
      ]} />
      {!inv ? <p className="muted">…</p> : (
        <>
          {tab === 'items' && <ItemsTab inv={inv} manage={manage} refresh={both} />}
          {tab === 'register' && <RegisterTab inv={inv} manage={manage} pending={pending} refresh={both} />}
          {tab === 'quick' && manage && <QuickAdd inv={inv} refresh={both} />}
          {tab === 'count' && manage && <CountTab inv={inv} refresh={both} />}
          {tab === 'settings' && manage && <SettingsTab inv={inv} refresh={both} />}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- items

const catOptions = (inv: InvData, withOff = false): Option[] => inv.categories.filter((c) => c.active || withOff).map((c) => ({ value: c.id, label: c.name, off: !c.active }));
const placeOptions = (inv: InvData): Option[] => inv.places.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }));

function ItemsTab({ inv, manage, refresh }: { inv: InvData; manage: boolean; refresh: () => Promise<void> }) {
  const { d } = useApp();
  const er = useEntries();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<number | null>(null);
  const [place, setPlace] = useState<number | null>(null);
  const [view, setView] = useState<'use' | 'attention' | 'noserial' | 'novalue' | 'noplace' | 'out' | 'all'>('use');
  const [open, setOpen] = useState<InvItem | 'new' | null>(null);
  const catName = new Map(inv.categories.map((c) => [c.id, c.name]));
  const placeName = new Map(inv.places.map((p) => [p.id, p.name]));
  const serialCat = new Set(inv.categories.filter((c) => c.serial).map((c) => c.id));
  const needSerial = (i: InvItem) => inUse(i) && i.category_id != null && serialCat.has(i.category_id) && !i.serial;

  const rows = inv.items.filter((i) => {
    if (view === 'use' && !inUse(i)) return false;
    if (view === 'out' && inUse(i)) return false;
    if (view === 'attention' && !(inUse(i) && i.condition !== 'good')) return false;
    if (view === 'noserial' && !needSerial(i)) return false;
    if (view === 'novalue' && !(inUse(i) && i.value_usd == null)) return false;
    if (view === 'noplace' && !(inUse(i) && i.place_id == null)) return false;
    if (cat != null && i.category_id !== cat) return false;
    if (place != null && i.place_id !== place) return false;
    const s = q.trim().toLowerCase();
    return !s || [i.code, i.name, i.brand, i.model, i.serial, i.holder, i.note].some((x) => (x ?? '').toLowerCase().includes(s));
  });
  const live = inv.items.filter(inUse);
  const noSerial = live.filter(needSerial).length;
  const attention = live.filter((i) => i.condition !== 'good').length;

  const exportXlsx = async () => {
    try {
      const parties = new Map(d.lists.parties.map((p) => [p.id, p.name]));
      const bytes = await inventoryWorkbook({ items: inv.items, categories: inv.categories, places: inv.places, origins: inv.origins, parties, bill: (id) => er.bill(id), organisation: '' });
      await saveFile(`inventory_${todayIso()}.xlsx`, ['xlsx'], bytes, t('احفظ الجرد', 'Save the inventory'));
    } catch (e) { toast(errText(e), true); }
  };

  const labels = async (list: InvItem[]) => {
    const codes = labelsOf(inv, list);
    if (!codes.length) return toast(t('لا أغراض لطباعة رموزها', 'No items to print labels for'), true);
    try {
      await saveFile(`labels_${todayIso()}.pdf`, ['pdf'], await labelsPdf(codes, inv.prefix), t('احفظ ملصقات الجرد', 'Save the labels'));
      toast(`${codes.length} ${t('ملصقاً', 'labels')} ✓`);
    } catch (e) { toast(errText(e), true); }
  };
  const photoOf = new Set(inv.photos.map((p) => p.item_id));

  return (
    <>
      <div className="row" style={{ gap: 18, marginBottom: 10 }}>
        <div><b>{live.length}</b> <span className="muted small">{t('غرضاً', 'items')} · {live.reduce((a, i) => a + i.qty, 0)} {t('قطعة', 'units')}</span></div>
        {inv.totals && <div><b>{fmtUsd(inv.totals.all)}</b> <span className="muted small">{t('القيمة (مشتراة أو مقدَّرة)', 'value (bought or estimated)')}</span></div>}
        {attention > 0 && <div className="small" style={{ color: 'var(--err)' }}>⚠ {attention} {t('تحتاج انتباهاً', 'need attention')}</div>}
        {noSerial > 0 && <div className="small" style={{ color: 'var(--err)' }}>⚠ {noSerial} {t('بلا رقم تسلسلي', 'without a serial number')}</div>}
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="inp" style={{ maxWidth: 240 }} placeholder={t('بحث: رمز، اسم، رقم تسلسلي، شخص…', 'Search: label, name, serial, person…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={cat} options={catOptions(inv, true)} onChange={setCat} placeholder={t('كل الأصناف', 'All categories')} />
        <Select value={place} options={placeOptions(inv)} onChange={setPlace} placeholder={t('كل الأماكن', 'All places')} />
        <div className="chips">
          {([['use', t('في الخدمة', 'In use')], ['attention', t('تحتاج انتباهاً', 'Need attention')], ['noserial', t('بلا رقم تسلسلي', 'No serial')], ['novalue', `${t('بلا قيمة', 'No value')} (${live.filter((i) => i.value_usd == null).length})`], ['noplace', `${t('بلا مكان', 'No place')} (${live.filter((i) => i.place_id == null).length})`], ['out', t('خرجت', 'Out')], ['all', t('الكل', 'All')]] as const).map(([k, l]) => (
            <button key={k} className={`chip ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => void exportXlsx()}>⬇ Excel</button>
        <button className="btn" title={t('ملصقات QR للأغراض المعروضة', 'QR labels for the items shown')} onClick={() => void labels(rows)}>🏷 {t('ملصقات', 'Labels')} ({rows.filter(inUse).length})</button>
        {manage && <button className="btn primary" onClick={() => setOpen('new')}>＋ {t('غرض (هدية، قديم…)', 'Item (gift, old…)')}</button>}
      </div>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr>
            <th>{t('الرمز', 'Label')}</th><th>{t('الغرض', 'Item')}</th><th>{t('الصنف', 'Category')}</th><th>{t('المكان', 'Place')}</th><th className="n">{t('العدد', 'Qty')}</th>
            <th>{t('الرقم التسلسلي', 'Serial')}</th><th>{t('الحالة', 'State')}</th><th>{t('عند', 'With')}</th><th className="n">{t('القيمة $', 'Value $')}</th><th>{t('الأصل', 'Origin')}</th>
          </tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className={`click ${inUse(i) ? '' : 'off'}`} onClick={() => setOpen(i)}>
                <td><b>{i.code}</b></td>
                <td>{i.name}{photoOf.has(i.id) ? ' 📷' : ''}{(i.brand || i.model) && <div className="muted small">{[i.brand, i.model].filter(Boolean).join(' ')}</div>}</td>
                <td className="small">{i.category_id ? catName.get(i.category_id)?.split(' · ')[0] : ''}</td>
                <td className="small">{i.place_id ? placeName.get(i.place_id) : ''}</td>
                <td className="n">{i.qty}</td>
                <td className="small" style={{ direction: 'ltr' }}>{i.serial ?? (needSerial(i) ? <span style={{ color: 'var(--err)' }}>—</span> : '')}</td>
                <td className="small" style={{ color: i.condition === 'good' ? undefined : 'var(--err)' }}>{inUse(i) ? COND_LABEL[i.condition]() : i.status === 'lost' ? t('مفقود', 'Lost') : t('أُخرج', 'Out')}</td>
                <td className="small">{i.holder}</td>
                <td className="n">{i.value_usd != null ? fmtUsd(itemTotal(i)) : ''}</td>
                <td className="small">{originName(inv, i).split(' · ')[0]}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 18 }}>{inv.items.length ? t('لا شيء بهذا الفلتر', 'Nothing with this filter') : t('لم يُسجَّل شيء بعد. ابدأ من «مشتريات تُسجَّل» أو من «الإعدادات ← استيراد».', 'Nothing yet. Start with "To register" or "Settings → Import".')}</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <ItemModal inv={inv} item={open === 'new' ? null : open} manage={manage} onClose={() => setOpen(null)} refresh={refresh} />}
    </>
  );
}

interface Form {
  name: string; category_id: number | null; place_id: number | null; qty: string; brand: string; model: string; serial: string; condition: InvCondition; holder: string;
  origin_id: number | null; acquired_on: string; value: string; value_note: string; note: string;
}
const blank = (): Form => ({ name: '', category_id: null, place_id: null, qty: '1', brand: '', model: '', serial: '', condition: 'good', holder: '', origin_id: null, acquired_on: '', value: '', value_note: '', note: '' });
const fromItem = (i: InvItem): Form => ({
  name: i.name, category_id: i.category_id, place_id: i.place_id, qty: String(i.qty), brand: i.brand ?? '', model: i.model ?? '', serial: i.serial ?? '', condition: i.condition,
  holder: i.holder ?? '', origin_id: i.origin_id, acquired_on: i.acquired_on ?? '', value: i.value_usd != null ? String(i.value_usd) : '', value_note: i.value_note ?? '', note: i.note ?? '',
});
const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };

export function ItemModal({ inv, item, manage, onClose, refresh, people, start }: { inv: InvData; item: InvItem | null; manage: boolean; onClose: () => void; refresh: () => Promise<void>; /** the people of the centre in MAGIS HR (on a server) */ people?: HrPick[]; /** a new item: its space already chosen */ start?: { place_id: number | null } }) {
  const { s } = useApp();
  const er = useEntries();
  const [f, setF] = useState<Form>(item ? fromItem(item) : { ...blank(), place_id: start?.place_id ?? null });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const ro = !manage || (item != null && !inUse(item));
  const serialExpected = f.category_id != null && inv.categories.find((c) => c.id === f.category_id)?.serial === 1;
  const history = item ? inv.moves.filter((x) => x.item_id === item.id).sort((a, b) => b.id - a.id) : [];
  const placeName = new Map(inv.places.map((p) => [p.id, p.name]));
  const entry: Trx | undefined = item?.trx_id ? er.rows.find((r) => r.id === item.trx_id) : undefined;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); await refresh(); if (done) toast(done); onClose(); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const payload = () => ({
    name: f.name, category_id: f.category_id, place_id: f.place_id, qty: Number(f.qty), brand: f.brand, model: f.model, serial: serialExpected || item?.serial ? f.serial : '', condition: f.condition, holder: f.holder,
    // the person of HR (null: typed by hand); without the list of HR (not on a server) the item keeps what it had
    ...(people?.length ? { holder_ref: holderRefOf(f.holder, people) } : {}),
    origin_id: f.origin_id, acquired_on: f.acquired_on || null, value_usd: num(f.value), value_note: f.value_note, note: f.note,
  });
  const save = () => run(() => (item ? s.api.call('inv.item.save', { id: item.id, ...payload() }) : s.api.call('inv.item.add', payload())), t('حُفظ', 'Saved'));
  const out = async (status: 'disposed' | 'lost') => {
    const why = await promptBox(status === 'lost' ? t('كيف فُقد؟', 'How was it lost?') : t('لماذا يخرج من الجرد؟ (تالف، مُنح، …)', 'Why does it leave the inventory? (worn out, given away…)'), '');
    if (why == null || !item) return;
    await run(() => s.api.call('inv.item.out', { id: item.id, status, why }), t('أُخرج من الجرد', 'Taken out of the inventory'));
  };
  const del = async () => {
    if (!item || !(await confirmBox(t('تحذف هذا الغرض؟ (أُدخل بالخطأ، ولا تاريخ له)', 'Delete this item? (entered by mistake, it has no history)'), true))) return;
    await run(() => s.api.call('inv.item.delete', { id: item.id }));
  };

  return (
    <Modal title={item ? `${item.code} · ${item.name}` : t('غرض جديد', 'New item')} onClose={onClose}>
      {item && !inUse(item) && <p className="small" style={{ color: 'var(--err)' }}>{item.status === 'lost' ? t('مفقود', 'Lost') : t('أُخرج من الجرد', 'Taken out of the inventory')} · {fmtDate(item.disposed_on)} · {item.disposed_why}</p>}
      <div className="grid2">
        <Field label={t('الاسم', 'Name')}><input className="inp" disabled={ro} value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus={!item} /></Field>
        <Field label={t('الصنف', 'Category')}><Select value={f.category_id} options={catOptions(inv)} onChange={(v) => set('category_id', v)} disabled={ro} /></Field>
        <Field label={t('الماركة', 'Brand')}><input className="inp" disabled={ro} value={f.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
        <Field label={t('الطراز', 'Model')}><input className="inp" disabled={ro} value={f.model} onChange={(e) => set('model', e.target.value)} /></Field>
        {/* the serial number only where it is needed: a category with the tick (Fouad's first test, comment 2) */}
        {(serialExpected || !!item?.serial) && <Field className={serialExpected ? 'need' : ''} label={serialExpected ? t('الرقم التسلسلي (مطلوب لهذا الصنف)', 'Serial number (expected for this category)') : t('الرقم التسلسلي', 'Serial number')} bad={serialExpected && !f.serial.trim() && Number(f.qty) === 1}>
          <input className="inp" style={{ direction: 'ltr' }} disabled={ro} value={f.serial} onChange={(e) => set('serial', e.target.value)} />
        </Field>}
        <Field label={t('العدد', 'Quantity')}><input className="inp" type="number" min={1} disabled={ro} value={f.qty} onChange={(e) => set('qty', e.target.value)} /></Field>
        <Field label={t('المكان', 'Place')}><Select value={f.place_id} options={placeOptions(inv)} onChange={(v) => set('place_id', v)} disabled={ro} /></Field>
        <Field label={t('عند شخص (إن وُجد)', 'With a person (if any)')}>
          <input className="inp" disabled={ro} list={people?.length ? 'inv-hr-people' : undefined} value={f.holder} onChange={(e) => set('holder', e.target.value)} placeholder={people?.length ? t('اختر من الموارد البشرية…', 'Choose from HR…') : ''} />
          {people?.length ? <datalist id="inv-hr-people">{people.filter((p) => p.left == null).map((p) => <option key={p.ref} value={p.name}>{p.name_ar ?? ''}</option>)}</datalist> : null}
          {people?.length && f.holder.trim() ? <span className="small muted">{holderRefOf(f.holder, people) ? `✓ ${t('من الموارد البشرية', 'from HR')}` : t('مكتوب باليد (ليس في الموارد البشرية)', 'typed by hand (not in HR)')}</span> : null}
        </Field>
        <Field label={t('الحالة', 'State')}>
          <select value={f.condition} disabled={ro} onChange={(e) => set('condition', e.target.value as InvCondition)}>{CONDITIONS.map((c) => <option key={c} value={c}>{COND_LABEL[c]()}</option>)}</select>
        </Field>
        {item?.trx_id ? (
          <Field label={t('الأصل', 'Origin')}><div className="small">{t('مشترى', 'Bought')} · {entry ? `${fmtDate(entry.date)} · ${er.bill(entry.id)}` : t('قيد في السجل', 'entry of the register')}</div></Field>
        ) : (
          <Field label={t('الأصل', 'Origin')}>
            <Select value={f.origin_id} disabled={ro} onChange={(v) => set('origin_id', v)} options={inv.origins.filter((o) => !o.bought && (o.active || o.id === f.origin_id)).map((o) => ({ value: o.id, label: o.name, off: !o.active }))} placeholder={t('اختر…', 'Choose…')} />
          </Field>
        )}
        <Field label={t('التاريخ', 'Date')}><input className="inp" type="date" disabled={ro || !!item?.trx_id} value={f.acquired_on} onChange={(e) => set('acquired_on', e.target.value)} /></Field>
        <Field label={item?.trx_id ? t('قيمة الوحدة $ (من القيد)', 'Unit value $ (from the entry)') : t('قيمة الوحدة $ (مقدَّرة)', 'Unit value $ (estimated)')}>
          <input className="inp" disabled={ro} value={f.value} onChange={(e) => set('value', e.target.value)} inputMode="decimal" />
        </Field>
        {!item?.trx_id && <Field label={t('كيف قُدّرت القيمة؟', 'How was the value estimated?')}><input className="inp" disabled={ro} value={f.value_note} onChange={(e) => set('value_note', e.target.value)} /></Field>}
        <Field label={t('ملاحظة', 'Note')} className="span2"><input className="inp" disabled={ro} value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
      </div>
      {item && <Photos item={item} inv={inv} manage={manage && inUse(item)} refresh={refresh} />}
      {history.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="small">{t('السجل', 'History')} ({history.length})</summary>
          <table className="t small"><tbody>
            {history.map((h) => <tr key={h.id}><td>{fmtDate(h.on_date)}</td><td>{(MOVE_LABEL[h.kind] ?? (() => h.kind))()}</td><td>{h.place_id ? placeName.get(h.place_id) : ''} {h.holder ?? ''}</td><td className="muted">{h.note}</td><td className="muted">{h.who}</td></tr>)}
          </tbody></table>
        </details>
      )}
      <div className="modal-foot">
        {item && manage && inUse(item) && <button className="btn danger small" onClick={() => void out('disposed')} style={{ marginInlineEnd: 'auto' }}>{t('إخراج من الجرد', 'Take out')}</button>}
        {item && manage && inUse(item) && <button className="btn danger small" onClick={() => void out('lost')}>{t('مفقود', 'Lost')}</button>}
        {item && manage && !inUse(item) && <button className="btn" onClick={() => void run(() => s.api.call('inv.item.back', { id: item.id }))}>{t('أعده إلى الجرد', 'Put back in the list')}</button>}
        {item && manage && history.every((h) => h.kind === 'added') && <button className="btn danger small" onClick={() => void del()}>{t('حذف', 'Delete')}</button>}
        {item && <button className="btn" onClick={async () => { try { await saveFile(`label_${item.code}.pdf`, ['pdf'], await labelsPdf(labelsOf(inv, [item]), inv.prefix), t('احفظ الملصق', 'Save the label')); } catch (e) { toast(errText(e), true); } }}>🏷 {t('ملصق', 'Label')}</button>}
        <button className="btn" onClick={onClose}>{t('إغلاق', 'Close')}</button>
        {!ro && <button className="btn primary" disabled={busy} onClick={() => void save()}>{t('احفظ', 'Save')}</button>}
      </div>
    </Modal>
  );
}

/** the photos of an item: small pictures, taken here or chosen; opened one at a time */
export function Photos({ item, inv, manage, refresh }: { item: InvItem; inv: InvData; manage: boolean; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const mine = inv.photos.filter((p) => p.item_id === item.id);
  const [pics, setPics] = useState<Record<string, string>>({});
  const [big, setBig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      for (const p of mine) {
        if (pics[p.id]) continue;
        try { const r = await s.api.call('inv.photo.get', { id: p.id }); if (live) setPics((x) => ({ ...x, [p.id]: `data:${r.mime};base64,${r.base64}` })); } catch { /* a missing file */ }
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.map((p) => p.id).join(',')]);
  const add = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { const x = await shrinkImage(f); await s.api.call('inv.photo.add', { itemId: item.id, ...x }); await refresh(); } catch (e) { toast(errText(e), true); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  if (!mine.length && !manage) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="small muted">{t('الصور', 'Photos')} ({mine.length})</div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        {mine.map((p) => (
          <div key={p.id} style={{ position: 'relative' }}>
            {pics[p.id] ? <img src={pics[p.id]} alt="" style={{ height: 72, borderRadius: 6, cursor: 'zoom-in' }} onClick={() => setBig(pics[p.id])} /> : <span className="muted">…</span>}
            {manage && <button className="btn ghost small" style={{ position: 'absolute', top: 0, insetInlineEnd: 0, background: '#fffc' }} onClick={async () => { if (await confirmBox(t('تحذف الصورة؟', 'Remove the photo?'), true)) { try { await s.api.call('inv.photo.delete', { id: p.id }); await refresh(); } catch (e) { toast(errText(e), true); } } }}>✕</button>}
          </div>
        ))}
        {manage && (
          <>
            <input ref={input} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void add(e.target.files?.[0])} />
            <button className="btn small" disabled={busy} onClick={() => input.current?.click()}>📷 {busy ? '…' : t('أضف صورة', 'Add a photo')}</button>
          </>
        )}
      </div>
      {big && <div className="overlay" onClick={() => setBig(null)} style={{ zIndex: 60 }}><img src={big} alt="" style={{ maxWidth: '92vw', maxHeight: '88vh', margin: 'auto', borderRadius: 8 }} /></div>}
    </div>
  );
}

// ---------------------------------------------------------------- the purchases still to register

export function RegisterTab({ inv, manage, pending, refresh }: { inv: InvData; manage: boolean; pending: Trx[]; refresh: () => Promise<void> }) {
  const { s, d } = useApp();
  const er = useEntries();
  const [entry, setEntry] = useState<Trx | null>(null);
  const party = new Map(d.lists.parties.map((p) => [p.id, p.name]));
  const line = new Map(d.lists.lines.map((l) => [l.id, l]));
  const skipped = inv.skips.map((x) => ({ skip: x, row: er.rows.find((r) => r.id === x.trx_id) })).filter((x) => x.row);
  const skip = async (r: Trx) => {
    const reason = await promptBox(t('لماذا ليس غرضاً؟ (إصلاح، توصيل، …)', 'Why is it not an item? (a repair, a delivery…)'), '');
    if (reason == null) return;
    try { await s.api.call('inv.skip', { trx_id: r.id, reason }); await refresh(); } catch (e) { toast(errText(e), true); }
  };
  return (
    <>
      {!inv.sources.length && <p className="small" style={{ color: 'var(--err)' }}>{t('لم تُحدَّد بعد بنود الجرد: من «الإعدادات» اختر البنود التي مشترياتها غرض (أثاث، معدات).', 'No inventory lines chosen yet: in "Settings" tick the budget headings whose purchases are items (furniture, equipment).')}</p>}
      <p className="muted small" style={{ marginTop: 0 }}>{t('كل مصروف على بند أثاث أو معدات يجب أن يصير غرضاً في الجرد (أو يُعلَّم «ليس غرضاً»).', 'Every expense on a furniture or equipment line must become an item in the inventory (or be marked "not an item").')}</p>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>{t('التاريخ', 'Date')}</th><th>{t('البيان', 'Explanation')}</th><th>{t('الجهة', 'Party')}</th><th>{t('البند', 'Line')}</th><th className="n">{t('المبلغ $', 'Amount $')}</th><th>{t('الفاتورة', 'Bill')}</th><th /></tr></thead>
          <tbody>
            {pending.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.date)}</td><td>{r.explanation}</td><td className="small">{r.party_id ? party.get(r.party_id) : ''}</td>
                <td className="small">{r.line_id ? line.get(r.line_id)?.name : ''}</td>
                <td className="n">{fmtUsd(er.usd(r.id))}</td><td className="small">{er.bill(r.id)}</td>
                <td className="n">{manage && <><button className="btn primary small" onClick={() => setEntry(r)}>{t('سجّل', 'Register')}</button> <button className="btn small" onClick={() => void skip(r)}>{t('ليس غرضاً', 'Not an item')}</button></>}</td>
              </tr>
            ))}
            {!pending.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 18 }}>✓ {t('كل المشتريات مسجَّلة', 'Every purchase is registered')}</td></tr>}
          </tbody>
        </table>
      </div>
      {skipped.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary className="small">{t('عُلّمت «ليست غرضاً»', 'Marked "not an item"')} ({skipped.length})</summary>
          <table className="t small"><tbody>
            {skipped.map(({ skip: k, row }) => (
              <tr key={k.trx_id}><td>{fmtDate(row!.date)}</td><td>{row!.explanation}</td><td className="n">{fmtUsd(er.usd(row!.id))}</td><td className="muted">{k.reason}</td>
                <td>{manage && <button className="btn small" onClick={async () => { try { await s.api.call('inv.unskip', { trx_id: k.trx_id }); await refresh(); } catch (e) { toast(errText(e), true); } }}>{t('تراجع', 'Undo')}</button>}</td></tr>
            ))}
          </tbody></table>
        </details>
      )}
      {entry && <RegisterModal inv={inv} entry={entry} onClose={() => setEntry(null)} refresh={refresh} />}
    </>
  );
}

interface Line { name: string; category_id: number | null; place_id: number | null; qty: string; serial: string; brand: string; model: string; value: string; edited: boolean }

function RegisterModal({ inv, entry, onClose, refresh }: { inv: InvData; entry: Trx; onClose: () => void; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const er = useEntries();
  const total = er.usd(entry.id);
  const mk = (name = ''): Line => ({ name, category_id: null, place_id: null, qty: '1', serial: '', brand: '', model: '', value: '', edited: false });
  const [lines, setLines] = useState<Line[]>([mk(entry.explanation ?? '')]);
  const [busy, setBusy] = useState(false);
  const units = lines.reduce((a, l) => a + (Number(l.qty) || 0), 0) || 1;
  // a value not written by hand is the entry's total shared by the units
  const unit = (l: Line) => (l.edited ? num(l.value) ?? 0 : Math.round((total / units) * 100) / 100);
  const listed = Math.round(lines.reduce((a, l) => a + unit(l) * (Number(l.qty) || 0), 0) * 100) / 100;
  const serialCat = new Set(inv.categories.filter((c) => c.serial).map((c) => c.id));
  const set = (i: number, p: Partial<Line>) => setLines((xs) => xs.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const missing = lines.filter((l) => l.category_id != null && serialCat.has(l.category_id) && Number(l.qty) === 1 && !l.serial.trim()).length;

  const save = async () => {
    setBusy(true);
    try {
      await s.api.call('inv.register', { trx_id: entry.id, items: lines.map((l) => ({ name: l.name, category_id: l.category_id, place_id: l.place_id, qty: Number(l.qty), serial: l.category_id != null && serialCat.has(l.category_id) ? l.serial : '', brand: l.brand, model: l.model, value_usd: unit(l) })) });
      await refresh();
      toast(t('سُجّل في الجرد ✓', 'Registered in the inventory ✓'));
      onClose();
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('سجّل مشتريات في الجرد', 'Register a purchase in the inventory')} onClose={onClose}>
      <p className="small" style={{ marginTop: 0 }}><b>{fmtDate(entry.date)}</b> · {entry.explanation} · <b>{fmtUsd(total)}</b> · {er.bill(entry.id)}</p>
      {lines.map((l, i) => (
        <div key={i} className="panel" style={{ padding: 10, marginBottom: 8 }}>
          <div className="grid2">
            <Field label={t('الغرض', 'Item')}><input className="inp" value={l.name} onChange={(e) => set(i, { name: e.target.value })} /></Field>
            <Field label={t('الصنف', 'Category')}><Select value={l.category_id} options={catOptions(inv)} onChange={(v) => set(i, { category_id: v })} /></Field>
            <Field label={t('العدد', 'Quantity')}><input className="inp" type="number" min={1} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} /></Field>
            <Field label={t('المكان', 'Place')}><Select value={l.place_id} options={placeOptions(inv)} onChange={(v) => set(i, { place_id: v })} /></Field>
            {l.category_id != null && serialCat.has(l.category_id) && <Field className="need" bad={!l.serial.trim() && Number(l.qty) === 1} label={t('الرقم التسلسلي (حاسوب واحد لكل سطر)', 'Serial number (one row per laptop)')}><input className="inp" style={{ direction: 'ltr' }} value={l.serial} onChange={(e) => set(i, { serial: e.target.value })} /></Field>}
            <Field label={t('قيمة الوحدة $', 'Unit value $')}><input className="inp" inputMode="decimal" value={l.edited ? l.value : String(unit(l))} onChange={(e) => set(i, { value: e.target.value, edited: true })} /></Field>
          </div>
          {lines.length > 1 && <button className="btn ghost small" onClick={() => setLines((xs) => xs.filter((_, k) => k !== i))}>✕ {t('أزل السطر', 'Remove this row')}</button>}
        </div>
      ))}
      <button className="btn small" onClick={() => setLines((xs) => [...xs, mk()])}>＋ {t('غرض آخر في الفاتورة نفسها', 'Another item of the same bill')}</button>
      <p className="small" style={{ color: Math.abs(listed - total) > 0.5 ? 'var(--err)' : undefined }}>
        {t('المسجَّل', 'Listed')}: {fmtUsd(listed)} / {fmtUsd(total)}{Math.abs(listed - total) > 0.5 ? ` — ${t('الفرق قد يكون توصيلاً أو شيئاً ليس غرضاً', 'the difference may be delivery or something that is not an item')}` : ' ✓'}
        {missing > 0 && <> · <span style={{ color: 'var(--err)' }}>{missing} {t('بلا رقم تسلسلي', 'without a serial number')}</span></>}
      </p>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy || lines.some((l) => !l.name.trim())} onClick={() => void save()}>{t('سجّل', 'Register')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- quick add (a table, like Excel)

/** blank numbered labels, stuck on the valuable items while walking room by room (the Quick add) */
export async function blankLabels(inv: InvData) {
  const n = Number(await promptBox(t('كم ملصقاً فارغاً تطبع؟ (للأغراض الغالية)', 'How many blank labels to print? (for the valuable items)'), '48'));
  if (!(n >= 1 && n <= 960)) return;
  try {
    const codes = blankLabelCodes(inv.items.map((i) => i.code), inv.prefix, n);
    await saveFile(`blank-labels_${codes[0]}-${codes[codes.length - 1]}.pdf`, ['pdf'], await labelsPdf(codes.map((c) => ({ code: c, qr: c })), inv.prefix), t('احفظ الملصقات الفارغة', 'Save the blank labels'));
    toast(`${codes[0]} → ${codes[codes.length - 1]}`);
  } catch (e) { toast(errText(e), true); }
}
/** the Excel table to fill on paper or on a computer, then import */
export async function invTemplate(inv: InvData) {
  try { await saveFile('inventory-template.xlsx', ['xlsx'], await inventoryTemplate(inv.categories.filter((c) => c.active), inv.places.filter((p) => p.active)), t('احفظ القالب', 'Save the template')); } catch (e) { toast(errText(e), true); }
}

interface Quick { name: string; category_id: number | null; place_id: number | null; qty: string; serial: string; value: string }
const quickRow = (from?: Quick): Quick => ({ name: '', category_id: from?.category_id ?? null, place_id: from?.place_id ?? null, qty: '1', serial: '', value: '' });

/** Many items at once, in a table: Enter in the last box makes the next row (same category and place). Labels are only for the valuable ones. */
function QuickAdd({ inv, refresh }: { inv: InvData; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const [rows, setRows] = useState<Quick[]>(() => Array.from({ length: 8 }, () => quickRow()));
  const [origin, setOrigin] = useState<number | null>(inv.origins.find((o) => !o.bought && o.active && /old|قديم/i.test(o.name))?.id ?? inv.origins.find((o) => !o.bought && o.active)?.id ?? null);
  const [busy, setBusy] = useState(false);
  const filled = rows.filter((r) => r.name.trim());
  const set = (i: number, p: Partial<Quick>) => setRows((xs) => xs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const names = [...new Set([...inv.items.map((i) => i.name), ...COMMON_ITEMS.map((c) => c.en)])];
  const serialCat = new Set(inv.categories.filter((c) => c.serial).map((c) => c.id));
  const save = async () => {
    setBusy(true);
    try {
      const r = await s.api.call('inv.item.many', { origin_id: origin, items: filled.map((x) => ({ name: x.name, category_id: x.category_id, place_id: x.place_id, qty: Number(x.qty) || 1, serial: x.category_id != null && serialCat.has(x.category_id) ? x.serial : '', value_usd: num(x.value) })) });
      await refresh();
      toast(`${r.ids.length} ${t('غرضاً سُجّل ✓', 'items recorded ✓')}`);
      setRows(Array.from({ length: 8 }, () => quickRow(filled[filled.length - 1])));
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const blanks = () => blankLabels(inv);
  const template = () => invTemplate(inv);
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>{t('سطر لكل غرض، أو سطر لكل مجموعة (20 كرسياً = العدد 20). Enter في آخر خانة يفتح سطراً جديداً بالصنف والمكان نفسيهما. الملصق للأغراض الغالية فقط، والقيمة تُكتب لاحقاً.', 'One line per object, or one line per group (20 chairs = Qty 20). Enter in the last box opens the next row with the same category and place. Labels only for the valuable ones; the value can be written later.')}</p>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small">{t('المصدر', 'Origin')}:</span>
        <Select value={origin} options={inv.origins.filter((o) => !o.bought && o.active).map((o) => ({ value: o.id, label: o.name }))} onChange={setOrigin} />
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => void blanks()}>🏷 {t('ملصقات فارغة مرقّمة', 'Blank numbered labels')}</button>
        <button className="btn small" onClick={() => void template()}>⬇ {t('قالب Excel', 'Excel template')}</button>
      </div>
      <datalist id="inv-quick-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="tbl-wrap"><table className="t">
        <thead><tr><th>{t('الغرض', 'Item')}</th><th>{t('الصنف', 'Category')}</th><th>{t('المكان', 'Place')}</th><th className="n">{t('العدد', 'Qty')}</th><th>{t('الرقم التسلسلي', 'Serial')}</th><th className="n">{t('القيمة $', 'Value $')}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input className="inp" list="inv-quick-names" value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
              <td><Select value={r.category_id} options={catOptions(inv)} onChange={(v) => set(i, { category_id: v })} /></td>
              <td><Select value={r.place_id} options={placeOptions(inv)} onChange={(v) => set(i, { place_id: v })} /></td>
              <td><input className="inp" style={{ width: 60 }} inputMode="numeric" value={r.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/\D/g, '') })} /></td>
              <td>{r.category_id != null && serialCat.has(r.category_id) && <input className="inp" style={{ direction: 'ltr', background: !r.serial ? '#fff4e0' : undefined }} value={r.serial} onChange={(e) => set(i, { serial: e.target.value })} />}</td>
              <td><input className="inp" style={{ width: 90 }} inputMode="decimal" value={r.value} onChange={(e) => set(i, { value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter' && i === rows.length - 1) { setRows((xs) => [...xs, quickRow(r)]); setTimeout(() => (e.currentTarget.closest('tbody')?.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus(), 30); } }} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => setRows((xs) => [...xs, ...Array.from({ length: 5 }, () => quickRow(xs[xs.length - 1]))])}>＋ {t('5 أسطر', '5 rows')}</button>
        <button className="btn small" disabled={!filled.length} onClick={() => setRows((xs) => xs.map((r, i) => (i === 0 ? r : { ...r, category_id: xs[0].category_id, place_id: xs[0].place_id })))}>{t('انسخ صنف ومكان السطر الأول للكل', 'Copy row 1\'s category and place to all')}</button>
        <span style={{ flex: 1 }} />
        <button className="btn primary" disabled={busy || !filled.length} onClick={() => void save()}>{t('سجّل', 'Record')} {filled.length || ''}</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- the count

function CountTab({ inv, refresh }: { inv: InvData; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const places = inv.places.filter((p) => p.active);
  const [place, setPlace] = useState<number | 'none' | 'all'>(places[0]?.id ?? 'all');
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const live = inv.items.filter(inUse);
  const items = live.filter((i) => place === 'all' || (place === 'none' ? i.place_id == null : i.place_id === place));
  const year = `${new Date().getFullYear() - 1}${todayIso().slice(4)}`;
  const toggle = (id: number) => setSeen((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pick = (p: number | 'none' | 'all') => { setPlace(p); setSeen(new Set()); };
  const save = async () => {
    if (!seen.size) return;
    try { await s.api.call('inv.count', { ids: [...seen], placeId: typeof place === 'number' ? place : null }); setSeen(new Set()); await refresh(); toast(t('حُفظ العدّ ✓', 'Count saved ✓')); } catch (e) { toast(errText(e), true); }
  };
  const addPlace = async () => {
    const name = await promptBox(t('اسم المكان (غرفة، قاعة، مكتب…)', 'Name of the place (room, hall, office…)'), '');
    if (!name?.trim()) return;
    try { const r = await s.api.call('inv.list.save', { table: 'place', name }); await refresh(); if (r.id) pick(r.id); } catch (e) { toast(errText(e), true); }
  };
  const n = (f: (i: InvItem) => boolean) => live.filter(f).length;
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>{t('اختر المكان، ضع علامة على ما تراه فعلاً، ثم احفظ. ما لا تراه يبقى غير معدود (افتحه وعلّمه مفقوداً إن لزم).', 'Choose a place, tick what you really see, then save. What you do not see stays uncounted (open it and mark it lost if needed).')}</p>
      {!places.length && (
        <div className="alert warn row" style={{ justifyContent: 'space-between' }}>
          <span>{t('لا أماكن بعد: أضف الغرف والقاعات لتعدّ غرفة غرفة. (الأماكن تُدار أيضاً في «الإعدادات».)', 'No places yet: add the rooms and halls to count room by room. (Places are also managed in "Settings".)')}</span>
          <button className="btn primary small" onClick={() => void addPlace()}>＋ {t('أضف مكاناً', 'Add a place')}</button>
        </div>
      )}
      <div className="chips" style={{ marginBottom: 10 }}>
        {places.map((p) => <button key={p.id} className={`chip ${place === p.id ? 'on' : ''}`} onClick={() => pick(p.id)}>{p.name} ({n((i) => i.place_id === p.id)})</button>)}
        <button className={`chip ${place === 'none' ? 'on' : ''}`} onClick={() => pick('none')}>{t('بلا مكان', 'No place')} ({n((i) => i.place_id == null)})</button>
        <button className={`chip ${place === 'all' ? 'on' : ''}`} onClick={() => pick('all')}>{t('الكل', 'All')} ({live.length})</button>
        {places.length > 0 && <button className="chip" onClick={() => void addPlace()}>＋</button>}
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn small" onClick={() => setSeen(new Set(items.map((i) => i.id)))}>{t('الكل موجود', 'All present')}</button>
        <button className="btn primary" disabled={!seen.size} onClick={() => void save()}>{t('احفظ العدّ', 'Save the count')} ({seen.size})</button>
      </div>
      <div className="tbl-wrap"><table className="t"><tbody>
        {items.map((i) => (
          <tr key={i.id} className="click" onClick={() => toggle(i.id)}>
            <td style={{ width: 30 }}><input type="checkbox" readOnly checked={seen.has(i.id)} /></td>
            <td><b>{i.code}</b></td><td>{i.name}{i.serial && <span className="muted small" style={{ direction: 'ltr' }}> · {i.serial}</span>}</td>
            <td className="n">{i.qty}</td>
            <td className="small" style={{ color: !i.counted_on || i.counted_on < year ? 'var(--err)' : undefined }}>{i.counted_on ? `${t('آخر عدّ', 'Last count')} ${fmtDate(i.counted_on)}` : t('لم يُعدّ', 'Never counted')}</td>
          </tr>
        ))}
        {!items.length && <tr><td className="muted" style={{ textAlign: 'center', padding: 18 }}>{t('لا شيء هنا', 'Nothing here')}</td></tr>}
      </tbody></table></div>
    </>
  );
}

// ---------------------------------------------------------------- settings

export function SettingsTab({ inv, refresh }: { inv: InvData; refresh: () => Promise<void> }) {
  const { s, d } = useApp();
  const [preview, setPreview] = useState<{ rows: InvImportRow[]; unknown: string[]; name: string } | null>(null);
  const act = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); await refresh(); if (ok) toast(ok); } catch (e) { toast(errText(e), true); } };
  const isSource = (kind: 'heading' | 'line', ref: number) => inv.sources.some((x) => x.kind === kind && x.ref === ref);
  const addName = async (table: 'category' | 'place' | 'origin') => {
    const name = await promptBox(table === 'category' ? t('اسم الصنف (عربي · English)', 'Category name (Arabic · English)') : table === 'origin' ? t('مصدر جديد (هدية من…، صنعه الشباب…)', 'A new origin (a gift from…, made by the youth…)') : t('اسم المكان (غرفة، قاعة…)', 'Name of the place (room, hall…)'), '');
    if (name?.trim()) await act(() => s.api.call('inv.list.save', { table, name }));
  };
  const rename = async (table: 'category' | 'place' | 'origin', id: number, old: string, serial?: number, active?: number) => {
    const name = await promptBox(t('الاسم', 'Name'), old);
    if (name?.trim() && name !== old) await act(() => s.api.call('inv.list.save', { table, id, name, serial: !!serial, active: active !== 0 }));
  };
  const pickImport = async () => {
    const f = await pickFile(['csv', 'xlsx'], t('اختر ملف الجرد (Snipe-IT CSV أو Excel)', 'Choose the inventory file (Snipe-IT CSV or Excel)'));
    if (!f) return;
    try {
      const x = tableToImport(await readTable(f.bytes, f.name));
      if (!x.rows.length) return toast(t('لم أجد صفوفاً (الصف الأول عناوين: Name, Asset Tag, Category, Serial…)', 'No rows found (first row = headers: Name, Asset Tag, Category, Serial…)'), true);
      setPreview({ ...x, name: f.name });
    } catch (e) { toast(errText(e), true); }
  };
  return (
    <>
      <div className="panel">
        <b>{t('بنود الجرد', 'Inventory lines')}</b>
        <p className="muted small" style={{ margin: '4px 0 8px' }}>{t('كل مصروف على بند مُعلَّم هنا يجب أن يُسجَّل غرضاً. علّم العنوان كله أو بنداً واحداً.', 'Every expense on a ticked heading or line must be registered as an item. Tick the whole heading or a single line.')}</p>
        {d.lists.headings.filter((h) => h.active).map((h) => (
          <details key={h.id} open={isSource('heading', h.id)}>
            <summary><label onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={isSource('heading', h.id)} onChange={(e) => void act(() => s.api.call('inv.source', { kind: 'heading', ref: h.id, on: e.target.checked }))} /> <b>{h.code}</b> {h.name}</label></summary>
            <div style={{ paddingInlineStart: 28 }}>
              {d.lists.lines.filter((l) => l.heading_id === h.id && l.active).map((l) => (
                <div key={l.id} className="small"><label><input type="checkbox" checked={isSource('heading', h.id) || isSource('line', l.id)} disabled={isSource('heading', h.id)} onChange={(e) => void act(() => s.api.call('inv.source', { kind: 'line', ref: l.id, on: e.target.checked }))} /> {l.code} {l.name}</label></div>
              ))}
            </div>
          </details>
        ))}
      </div>
      <div className="grid2">
        <div className="panel">
          <div className="row"><b>{t('الأصناف', 'Categories')}</b><span style={{ flex: 1 }} /><button className="btn small" onClick={() => void addName('category')}>＋ {t('صنف', 'Category')}</button></div>
          {inv.categories.map((c) => (
            <div key={c.id} className="row small" style={{ opacity: c.active ? 1 : 0.5 }}>
              <span style={{ flex: 1 }}>{c.name}</span>
              <label title={t('رقم تسلسلي مطلوب', 'Serial number expected')}><input type="checkbox" checked={!!c.serial} onChange={(e) => void act(() => s.api.call('inv.list.save', { table: 'category', id: c.id, name: c.name, serial: e.target.checked, active: !!c.active }))} /> S/N</label>
              <label title={t('غرض ثمين: تُطلب له صورة وملصق', 'Valuable: a photo and a label are asked for')}><input type="checkbox" checked={!!c.valuable} onChange={(e) => void act(() => s.api.call('inv.list.save', { table: 'category', id: c.id, name: c.name, serial: !!c.serial, valuable: e.target.checked, active: !!c.active }))} /> {t('ثمين', 'Valuable')}</label>
              <label title={t('يظهر في التقويم «دائماً في المكان»', 'Shown in the calendar as "always in the room"')}><input type="checkbox" checked={!!c.in_calendar} onChange={(e) => void act(() => s.api.call('inv.list.save', { table: 'category', id: c.id, name: c.name, serial: !!c.serial, in_calendar: e.target.checked, active: !!c.active }))} /> {t('في التقويم', 'In calendar')}</label>
              <button className="btn ghost small" onClick={() => void rename('category', c.id, c.name, c.serial, c.active)}>✎</button>
              <button className="btn ghost small" onClick={() => void act(() => s.api.call('inv.list.save', { table: 'category', id: c.id, name: c.name, serial: !!c.serial, active: !c.active }))}>{c.active ? '⏻' : '↺'}</button>
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="row"><b>{t('الأماكن (غرف، قاعات…)', 'Places (rooms, halls…)')}</b><span style={{ flex: 1 }} /><button className="btn small" onClick={() => void addName('place')}>＋ {t('مكان', 'Place')}</button></div>
          {inv.places.map((p) => (
            <div key={p.id} className="row small" style={{ opacity: p.active ? 1 : 0.5 }}>
              <span style={{ flex: 1 }}>{p.name}</span>
              <button className="btn ghost small" onClick={() => void rename('place', p.id, p.name, undefined, p.active)}>✎</button>
              <button className="btn ghost small" onClick={() => void act(() => s.api.call('inv.list.save', { table: 'place', id: p.id, name: p.name, active: !p.active }))}>{p.active ? '⏻' : '↺'}</button>
            </div>
          ))}
          {!inv.places.length && <p className="muted small">{t('أضف الغرف والقاعات.', 'Add the rooms and halls.')}</p>}
        </div>
      </div>
      <div className="panel">
        <div className="row"><b>{t('مصدر الأغراض', 'Origins of the items')}</b><span style={{ flex: 1 }} /><button className="btn small" onClick={() => void addName('origin')}>＋ {t('مصدر', 'Origin')}</button></div>
        <p className="muted small" style={{ margin: '4px 0' }}>{t('«مشترى» يصنعه قيد الشراء تلقائياً. الباقي قائمتك: هدية، قديم، من مانح…', '"Bought" is made by a purchase entry, by itself. The rest is your list: gift, old, from a donor…')}</p>
        {inv.origins.map((o) => (
          <div key={o.id} className="row small" style={{ opacity: o.active ? 1 : 0.5 }}>
            <span style={{ flex: 1 }}>{o.name}{o.bought ? ` · ${t('من قيد الشراء', 'from a purchase entry')}` : ''}</span>
            <button className="btn ghost small" onClick={() => void rename('origin', o.id, o.name, undefined, o.active)}>✎</button>
            {!o.bought && <button className="btn ghost small" onClick={() => void act(() => s.api.call('inv.list.save', { table: 'origin', id: o.id, name: o.name, active: !o.active }))}>{o.active ? '⏻' : '↺'}</button>}
          </div>
        ))}
      </div>
      <div className="panel">
        <b>{t('ماذا يحمل الـQR', 'What the QR holds')}</b>
        <p className="muted small" style={{ margin: '4px 0' }}>{t('يحمل الـQR دائماً رمز الغرض (ليجده المسح). أضف ما تريد: كل إضافة تجعل الرمز أكبر وأصعب قراءةً على ملصق صغير.', 'The QR always holds the item\'s label (so a scan finds it). Add what you want: each addition makes the code denser and harder to read on a small sticker.')}</p>
        <div className="row small">
          <label><input type="checkbox" checked disabled /> {t('الرمز', 'Label')}</label>
          {QR_FIELDS.map((f) => (
            <label key={f}><input type="checkbox" checked={inv.qr.includes(f)} onChange={(e) => void act(() => s.api.call('inv.qr', { fields: e.target.checked ? [...inv.qr, f] : inv.qr.filter((x) => x !== f) }))} /> {({ name: t('الاسم', 'Name'), serial: t('الرقم التسلسلي', 'Serial number'), category: t('الصنف', 'Category'), place: t('المكان', 'Place'), date: t('تاريخ الشراء', 'Date') } as Record<string, string>)[f]}</label>
          ))}
        </div>
        <p className="small" style={{ margin: '6px 0 0' }}>{t('مثال', 'Example')}: <b style={{ direction: 'ltr', display: 'inline-block' }}>{qrText({ code: `${inv.prefix}-0001`, name: 'Laptop Dell', serial: 'SN12345', acquired_on: '2026-11-03' }, inv.qr, { category: 'IT equipment', place: 'Office' })}</b></p>
      </div>
      <div className="panel">
        <b>{t('الرمز على الغرض', 'The label on the object')}</b>
        <div className="row small" style={{ marginTop: 6 }}>
          <span>{t('البادئة', 'Prefix')}: <b>{inv.prefix}</b> → {inv.prefix}-0001</span>
          <button className="btn small" onClick={async () => { const p = await promptBox(t('البادئة (2–6 حروف لاتينية)', 'Prefix (2–6 letters)'), inv.prefix); if (p) await act(() => s.api.call('inv.prefix', { prefix: p })); }}>{t('غيّر', 'Change')}</button>
        </div>
      </div>
      <div className="panel">
        <b>{t('استيراد', 'Import')}</b>
        <p className="muted small" style={{ margin: '4px 0 8px' }}>{t('ملف CSV من Snipe-IT أو جدول Excel (الصف الأول عناوين). الرمز أو الرقم التسلسلي المستعمل لا يُكرَّر. تُنشأ الأصناف والأماكن الجديدة. القيم تُعتبر بالدولار.', 'A Snipe-IT CSV or an Excel table (first row = headers). A label or serial already used is never doubled. New categories and places are made. Values are taken as USD.')}</p>
        <button className="btn" onClick={() => void pickImport()}>⬆ {t('اختر ملفاً', 'Choose a file')}</button>
      </div>
      {preview && (
        <Modal title={t('استيراد الجرد', 'Import the inventory')} onClose={() => setPreview(null)}>
          <p>{preview.name}: <b>{preview.rows.length}</b> {t('صفاً', 'rows')}</p>
          {preview.unknown.length > 0 && <p className="small muted">{t('أعمدة لم أفهمها (تُهمل)', 'Columns not understood (ignored)')}: {preview.unknown.join(', ')}</p>}
          <div className="tbl-wrap" style={{ maxHeight: 240 }}><table className="t small"><tbody>
            {preview.rows.slice(0, 8).map((r, i) => <tr key={i}><td>{r.code}</td><td>{r.name}</td><td>{r.category}</td><td>{r.place}</td><td>{r.serial}</td><td className="n">{r.value_usd ?? ''}</td></tr>)}
          </tbody></table></div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setPreview(null)}>{t('إلغاء', 'Cancel')}</button>
            <button className="btn primary" onClick={() => void act(async () => { const r = await s.api.call('inv.import', { rows: preview.rows }); setPreview(null); toast(`${r.added} ${t('أُضيف', 'added')}${r.skipped.length ? ` · ${r.skipped.length} ${t('تُخطّي', 'skipped')}` : ''}`); if (r.skipped.length) window.console.info(r.skipped.join('\n')); })}>{t('استورد', 'Import')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
