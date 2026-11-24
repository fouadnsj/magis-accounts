// The calendar's settings (Fouad, 23 November 2026: the Excel file is not practical — the spaces and the lists are typed
// in the program). Three tabs: the areas and their spaces; the lists (kinds of space and their categories, kinds of
// activity, kinds of organisation); the closings (closed periods of the centre, spaces closed for repairs).
// Nothing is deleted: a line is switched off, a closing is cancelled with a reason.
import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { Field, Modal, Tabs, biName, confirmBox, errText, fmtDate, promptBox, t, toast } from './kit';
import { colorOf, PALETTE } from '../hosting/host';
import { categoryOf, inCalendar, sleepsIn, type CalData, type CalSpace } from '../hosting/calendar';
import { alwaysInRoom } from '../inventory/map';
import { phoneWhere } from '../net';
import { PHONE_ROLES, ROLE_NAME, type CalPhoneInfo, type PhoneRole } from '../hosting/calphone';

type Tab = 'spaces' | 'lists' | 'closings' | 'phones';

interface SpaceForm { id?: number; building_id: number; name: string; kind_id: number | null; floor: string; capacity: string; beds: string; rentable: boolean; bookable: boolean; fixed: string; note: string; category_id: number | null; active: boolean }

export function CalSettings({ data, refresh }: { data: CalData; refresh: () => Promise<void> }) {
  const { s, can } = useApp();
  const [tab, setTab] = useState<Tab>('spaces');
  // the calendar phones are linked by the Director (set-up) or whoever manages the users; only on a server
  const phones = s.mode === 'server' && (data.rights.setup || can('users.manage'));
  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'spaces', label: t('المناطق والأماكن', 'Areas and spaces') },
        { value: 'lists', label: t('القوائم', 'Lists') },
        { value: 'closings', label: t('الإغلاق', 'Closings') },
        ...(phones ? [{ value: 'phones' as Tab, label: t('هواتف التقويم', 'Calendar phones') }] : []),
      ]} />
      {tab === 'spaces' && <SpacesTab data={data} refresh={refresh} />}
      {tab === 'lists' && <ListsTab data={data} refresh={refresh} />}
      {tab === 'closings' && <ClosingsTab data={data} refresh={refresh} />}
      {tab === 'phones' && phones && <PhonesTab />}
    </>
  );
}

const useAct = (refresh: () => Promise<void>) => async (fn: () => Promise<unknown>) => {
  try { await fn(); await refresh(); return true; } catch (e) { toast(errText(e), true); return false; }
};
export const kindLabel = (d: CalData, s: Pick<CalSpace, 'kind_id'>) => biName(d.kinds.find((k) => k.id === s.kind_id)?.name ?? '');
/** "always in the room": the inventory's items of that space shown in the calendar, or the text typed here */
export function inRoomText(d: CalData, sp: CalSpace): string {
  const x = alwaysInRoom(sp, d.inRoom ?? []);
  return x.items.length ? x.items.map((i) => (i.qty > 1 ? `${i.qty} ${i.name}` : i.name)).join(' · ') : x.typed ?? '';
}
export const catLabel = (d: CalData, id: number | null) => biName(d.categories.find((c) => c.id === id)?.name ?? '');
const NO_CAT = () => t('بلا فئة (ليس في التقويم)', 'No category (not in the calendar)');

// ---------------------------------------------------------------- areas and spaces

function SpacesTab({ data, refresh }: { data: CalData; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const act = useAct(refresh);
  const [form, setForm] = useState<SpaceForm | null>(null);
  const addArea = async () => {
    const n = await promptBox(t('اسم المنطقة (مبنى أو قسم من المركز)', 'Name of the area (a building or part of the centre)'));
    if (n?.trim()) await act(() => s.api.call('cal.area.save', { name: n }));
  };
  const areaSave = (id: number, x: { name: string; active: boolean; color?: string | null }) => act(() => s.api.call('cal.area.save', { id, ...x }));
  const firstKind = data.kinds.find((k) => k.active && !k.sleeps && k.category_id != null)?.id ?? data.kinds.find((k) => k.active && !k.sleeps)?.id ?? data.kinds[0]?.id ?? null;
  const open = (sp: CalSpace) => setForm({ id: sp.id, building_id: sp.building_id, name: sp.name, kind_id: sp.kind_id, floor: sp.floor ?? '', capacity: sp.capacity ? String(sp.capacity) : '', beds: sp.beds ? String(sp.beds) : '', rentable: !!sp.rentable, bookable: sp.bookable !== 0, fixed: sp.fixed ?? '', note: sp.note ?? '', category_id: sp.category_id, active: !!sp.active });
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{t('المناطق والأماكن', 'Areas and spaces')}</h3>
        <button className="btn primary small" onClick={() => void addArea()}>＋ {t('منطقة', 'Area')}</button>
      </div>
      <p className="small muted">{t('المنطقة مبنى أو قسم من المركز، لها لون في التقويم. المكان قاعة أو صف أو مطبخ أو غرفة نوم… غرفة النوم لها أسرّة، وغيرها له سعة (عدد الأشخاص). كل مكان هو أيضاً «مكان» في الجرد.', 'An area is a building or a part of the centre, with its colour on the calendar. A space is a hall, a classroom, a kitchen, a bedroom… A bedroom has beds, any other space a capacity (how many people). Each space is also a "place" of the inventory.')}</p>
      {data.areas.map((a) => {
        const list = data.spaces.filter((x) => x.building_id === a.id);
        return (
          <div key={a.id} className="cal-area" style={{ opacity: a.active ? 1 : 0.55 }}>
            <div className="row" style={{ gap: 6 }}>
              <i className="host-sw-big" style={{ background: colorOf(data.areas, a.id) }} />
              <b>{a.name}</b>{!a.active && <span className="small muted">({t('متوقفة', 'switched off')})</span>}
              <input type="color" className="host-color" title={t('لون المنطقة في التقويم', 'Colour of the area on the calendar')} value={colorOf(data.areas, a.id)} onChange={(e) => void areaSave(a.id, { name: a.name, active: !!a.active, color: e.target.value })} />
              {PALETTE.map((c) => <button key={c} type="button" className="host-pal" style={{ background: c }} aria-label={c} onClick={() => void areaSave(a.id, { name: a.name, active: !!a.active, color: c })} />)}
              <button className="btn ghost small" onClick={async () => { const n = await promptBox(t('اسم المنطقة', 'Name of the area'), a.name); if (n?.trim()) await areaSave(a.id, { name: n, active: !!a.active }); }}>{t('اسم', 'Rename')}</button>
              <button className="btn ghost small" onClick={() => void areaSave(a.id, { name: a.name, active: !a.active })}>{a.active ? t('أوقف', 'Switch off') : t('أعد', 'Switch on')}</button>
              <span style={{ flex: 1 }} />
              <button className="btn small" onClick={() => setForm({ building_id: a.id, name: '', kind_id: firstKind, floor: '', capacity: '', beds: '', rentable: true, bookable: true, fixed: '', note: '', category_id: null, active: true })}>＋ {t('مكان', 'Space')}</button>
            </div>
            {list.length > 0 && (
              <table className="t small" style={{ marginTop: 6 }}>
                <thead><tr><th>{t('المكان', 'Space')}</th><th>{t('النوع', 'Kind')}</th><th>{t('الفئة', 'Category')}</th><th>{t('الطابق', 'Floor')}</th><th className="n">{t('السعة / الأسرّة', 'Capacity / beds')}</th><th>{t('يُحجز', 'Can be booked')}</th><th>{t('للتأجير', 'Rentable')}</th><th>{t('دائماً فيه', 'Always in it')}</th><th /></tr></thead>
                <tbody>
                  {list.map((sp) => (
                    <tr key={sp.id} className={sp.active ? '' : 'off'}>
                      <td><b>{sp.name}</b>{sp.note && <div className="muted">{sp.note}</div>}</td>
                      <td>{kindLabel(data, sp)}</td>
                      <td className={categoryOf(sp, data.kinds) == null ? 'muted' : ''}>{categoryOf(sp, data.kinds) == null ? t('بلا فئة', 'No category') : catLabel(data, categoryOf(sp, data.kinds))}</td>
                      <td>{sp.floor ?? ''}</td>
                      <td className="n">{sleepsIn(sp, data.kinds) ? (sp.beds ? `${sp.beds} ${t('سرير', 'beds')}` : '—') : sp.capacity ? `${sp.capacity} ${t('شخصاً', 'people')}` : '—'}</td>
                      <td>{sp.bookable !== 0 ? t('نعم', 'Yes') : t('الجرد فقط', 'Inventory only')}</td>
                      <td>{sp.bookable === 0 ? '' : sp.rentable ? t('نعم', 'Yes') : t('لنا فقط', 'Ours only')}</td>
                      <td className="muted">{inRoomText(data, sp)}</td>
                      <td><button className="btn ghost small" onClick={() => open(sp)}>{t('عدّل', 'Edit')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!list.length && <p className="small muted">{t('لا مكان بعد في هذه المنطقة.', 'No space in this area yet.')}</p>}
          </div>
        );
      })}
      {!data.areas.length && <p className="muted">{t('ابدأ بإضافة منطقة، ثم أماكنها.', 'Start with an area, then its spaces.')}</p>}
      {form && <SpaceWindow data={data} form={form} onClose={() => setForm(null)} refresh={refresh} />}
    </div>
  );
}

function SpaceWindow({ data, form: start, onClose, refresh }: { data: CalData; form: SpaceForm; onClose: () => void; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const [f, setF] = useState<SpaceForm>(start);
  const [busy, setBusy] = useState(false);
  const kind = data.kinds.find((k) => k.id === f.kind_id);
  const beds = !!kind?.sleeps;
  const save = async () => {
    if (!f.name.trim()) { toast(t('اكتب اسم المكان', 'Write the name of the space'), true); return; }
    setBusy(true);
    try {
      await s.api.call('cal.space.save', { id: f.id, building_id: f.building_id, name: f.name, kind_id: f.kind_id, beds: Number(f.beds) || 0, capacity: Number(f.capacity) || 0, floor: f.floor, rentable: f.rentable, bookable: f.bookable, fixed: f.fixed, note: f.note, category_id: f.category_id, active: f.active });
      await refresh();
      onClose();
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  return (
    <Modal title={f.id ? t('مكان', 'Space') : t('مكان جديد', 'New space')} onClose={onClose} narrow>
      <div className="cal-form">
        <Field label={t('المنطقة', 'Area')}>
          <select className="inp" value={f.building_id} onChange={(e) => setF({ ...f, building_id: Number(e.target.value) })}>{data.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </Field>
        <Field label={t('اسم المكان', 'Name of the space')}><input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('النوع', 'Kind')}>
          <select className="inp" value={f.kind_id ?? ''} onChange={(e) => {
            // a new space of a kind with no category (a store, an office) starts as "cannot be booked"
            const k = data.kinds.find((x) => x.id === Number(e.target.value));
            setF({ ...f, kind_id: Number(e.target.value), bookable: f.id == null && k && k.category_id == null && f.category_id == null ? false : f.bookable });
          }}>
            {data.kinds.filter((k) => k.active || k.id === f.kind_id).map((k) => <option key={k.id} value={k.id}>{biName(k.name)}</option>)}
          </select>
        </Field>
        {beds
          ? <Field label={t('الأسرّة', 'Beds')}><input className="inp" inputMode="numeric" dir="ltr" value={f.beds} onChange={(e) => setF({ ...f, beds: e.target.value.replace(/\D/g, '') })} /></Field>
          : <Field label={t('السعة (عدد الأشخاص)', 'Capacity (people)')}><input className="inp" inputMode="numeric" dir="ltr" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value.replace(/\D/g, '') })} /></Field>}
        <Field label={t('الطابق', 'Floor')}><input className="inp" value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} /></Field>
        <Field label={t('الفئة (العرض السريع)', 'Category (quick view)')}>
          <select className="inp" value={f.category_id ?? ''} onChange={(e) => setF({ ...f, category_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{t('فئة النوع', "The kind's category")}{kind ? ` (${kind.category_id ? catLabel(data, kind.category_id) : NO_CAT()})` : ''}</option>
            {data.categories.filter((c) => c.active || c.id === f.category_id).map((c) => <option key={c.id} value={c.id}>{biName(c.name)}</option>)}
          </select>
        </Field>
        <Field label={t('ما هو دائماً فيه (يُقرأ من الجرد حين تُسجَّل أغراضه فيه)', 'What is always in it (read from the inventory once its items are listed there)')}><input className="inp" placeholder={t('جهاز عرض، 40 كرسياً…', 'projector, 40 chairs…')} value={f.fixed} onChange={(e) => setF({ ...f, fixed: e.target.value })} /></Field>
        <Field label={t('ملاحظة', 'Note')}><input className="inp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <label className="small cal-check"><input type="checkbox" checked={f.bookable} onChange={(e) => setF({ ...f, bookable: e.target.checked })} /> {t('يُحجز: يظهر في التقويم (المخزن والمكتب لا يُحجزان: يظهران في الجرد فقط)', 'Can be booked: shown in the calendar (a store or an office cannot be booked: they are only in the inventory)')}</label>
        {f.bookable && <label className="small cal-check"><input type="checkbox" checked={f.rentable} onChange={(e) => setF({ ...f, rentable: e.target.checked })} /> {t('قابل للتأجير: يمكن أن تحجزه جهة خارجية', 'Rentable: an outside group may book it')}</label>}
        {f.id != null && <label className="small cal-check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t('قيد الاستعمال (أزل العلامة لإيقافه، ولا يُحذف)', 'In use (untick to switch it off; it is never deleted)')}</label>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{t('حفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- the lists

function ListsTab({ data, refresh }: { data: CalData; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const act = useAct(refresh);
  const [kindForm, setKindForm] = useState<{ id?: number; name: string; sleeps: boolean; category_id: number | null; active: boolean; used: boolean } | null>(null);
  const nameHint = t('الاسم (عربي · English)، مثال: ملعب · Playground', 'Name (Arabic · English), e.g. ملعب · Playground');
  const simple = (op: 'cal.category.save' | 'cal.okind.save' | 'cal.akind.save' | 'cal.service.save', title: string, rows: { id: number; name: string; active: number; color?: string | null }[], withColor = false, count?: (id: number) => number) => (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button className="btn small" onClick={async () => { const n = await promptBox(nameHint); if (n?.trim()) await act(() => s.api.call(op, { name: n })); }}>＋ {t('أضف', 'Add')}</button>
      </div>
      <table className="t small" style={{ marginTop: 6 }}><tbody>
        {rows.map((x) => (
          <tr key={x.id} className={x.active ? '' : 'off'}>
            {withColor && <td style={{ width: 40 }}><input type="color" className="host-color" value={x.color || '#cccccc'} onChange={(e) => void act(() => s.api.call(op, { id: x.id, name: x.name, active: !!x.active, color: e.target.value }))} /></td>}
            <td>{biName(x.name)}</td>
            {count && <td className="muted">{count(x.id)}</td>}
            <td style={{ textAlign: 'end' }}>
              <button className="btn ghost small" onClick={async () => { const n = await promptBox(nameHint, x.name); if (n?.trim()) await act(() => s.api.call(op, { id: x.id, name: n, active: !!x.active })); }}>{t('اسم', 'Rename')}</button>
              <button className="btn ghost small" onClick={() => void act(() => s.api.call(op, { id: x.id, name: x.name, active: !x.active }))}>{x.active ? t('أوقف', 'Switch off') : t('أعد', 'Switch on')}</button>
            </td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
  const saveKind = async () => {
    if (!kindForm?.name.trim()) return;
    if (await act(() => s.api.call('cal.kind.save', { id: kindForm.id, name: kindForm.name, sleeps: kindForm.sleeps, category_id: kindForm.category_id, active: kindForm.active }))) setKindForm(null);
  };
  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>{t('أنواع الأماكن', 'Kinds of space')}</h3>
          <button className="btn small" onClick={() => setKindForm({ name: '', sleeps: false, category_id: data.categories[0]?.id ?? null, active: true, used: false })}>＋ {t('نوع', 'Kind')}</button>
        </div>
        <p className="small muted">{t('نوع «فيه أسرّة» (غرفة نوم) تُعدّ فيه الأسرّة؛ الأنواع الأخرى لها سعة. كل نوع في فئة: هي العروض السريعة في التقويم (القاعات، الغرف…). نوع بلا فئة (مستودع، مكتب) لا يظهر في العروض السريعة.', 'A kind "with beds" (bedroom) counts beds; the other kinds have a capacity. Each kind is in a category: the quick views of the calendar (Halls, Rooms…). A kind with no category (a store, an office) is not in the quick views.')}</p>
        <table className="t small"><thead><tr><th>{t('النوع', 'Kind')}</th><th>{t('الفئة', 'Category')}</th><th /><th className="n">{t('أماكن', 'Spaces')}</th><th /></tr></thead><tbody>
          {data.kinds.map((k) => {
            const used = data.spaces.filter((x) => x.kind_id === k.id).length;
            return (
              <tr key={k.id} className={k.active ? '' : 'off'}>
                <td>{biName(k.name)}</td><td className={k.category_id == null ? 'muted' : ''}>{k.category_id == null ? NO_CAT() : catLabel(data, k.category_id)}</td><td className="muted">{k.sleeps ? t('فيه أسرّة', 'with beds') : t('سعة', 'capacity')}</td><td className="n">{used}</td>
                <td style={{ textAlign: 'end' }}><button className="btn ghost small" onClick={() => setKindForm({ id: k.id, name: k.name, sleeps: !!k.sleeps, category_id: k.category_id, active: !!k.active, used: used > 0 })}>{t('عدّل', 'Edit')}</button></td>
              </tr>
            );
          })}
        </tbody></table>
      </div>
      {simple('cal.category.save', t('الفئات (العروض السريعة)', 'Categories (quick views)'), data.categories, false, (id) => data.kinds.filter((k) => k.category_id === id).length)}
      {simple('cal.akind.save', t('أنواع نشاطاتنا', 'Kinds of our activities'), data.activityKinds, true)}
      {simple('cal.okind.save', t('أنواع الجهات', 'Kinds of organisation'), data.orgKinds)}
      {simple('cal.service.save', t('الخدمات (وجبات، استراحة قهوة، تدفئة…)', 'Services (meals, coffee break, heating…)'), data.services)}
      <EquipList data={data} refresh={refresh} />
      {kindForm && (
        <Modal title={kindForm.id ? t('نوع مكان', 'Kind of space') : t('نوع جديد', 'New kind of space')} onClose={() => setKindForm(null)} narrow>
          <div className="cal-form">
            <Field label={t('الاسم (عربي · English)', 'Name (Arabic · English)')}><input className="inp" autoFocus value={kindForm.name} onChange={(e) => setKindForm({ ...kindForm, name: e.target.value })} /></Field>
            <Field label={t('الفئة', 'Category')}>
              <select className="inp" value={kindForm.category_id ?? ''} onChange={(e) => setKindForm({ ...kindForm, category_id: e.target.value ? Number(e.target.value) : null })}>
                {data.categories.filter((c) => c.active || c.id === kindForm.category_id).map((c) => <option key={c.id} value={c.id}>{biName(c.name)}</option>)}
                <option value="">{NO_CAT()}</option>
              </select>
              {kindForm.category_id == null && <div className="small muted">{t('أماكن هذا النوع لا تظهر في العروض السريعة (القاعات، الغرف…): مستودع، مكتب، غرفة تخزين.', 'Spaces of this kind never appear in the quick views (Halls, Rooms…): a store, an office, a storage room.')}</div>}
            </Field>
            <label className="small cal-check"><input type="checkbox" disabled={kindForm.used} checked={kindForm.sleeps} onChange={(e) => setKindForm({ ...kindForm, sleeps: e.target.checked })} /> {t('فيه أسرّة (ينام فيه أشخاص)', 'Has beds (people sleep there)')}{kindForm.used ? ` — ${t('مستعمل في أماكن: لا يتغيّر', 'used by spaces: it cannot change')}` : ''}</label>
            {kindForm.id != null && <label className="small cal-check"><input type="checkbox" checked={kindForm.active} onChange={(e) => setKindForm({ ...kindForm, active: e.target.checked })} /> {t('قيد الاستعمال', 'In use')}</label>}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setKindForm(null)}>{t('إلغاء', 'Cancel')}</button>
            <button className="btn primary" onClick={() => void saveKind()}>{t('حفظ', 'Save')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- closed periods and spaces closed for repairs

function ClosingsTab({ data, refresh }: { data: CalData; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const act = useAct(refresh);
  const [period, setPeriod] = useState<{ id?: number; name: string; from_day: string; to_day: string } | null>(null);
  const [repair, setRepair] = useState<{ room_id: number | null; from_day: string; to_day: string; reason: string; hit?: { name: string; days: string[] }[] } | null>(null);
  const space = (id: number) => { const x = data.spaces.find((q) => q.id === id); return x ? `${data.areas.find((a) => a.id === x.building_id)?.name ?? ''} · ${x.name}` : ''; };
  const cancel = async (op: 'cal.period.cancel' | 'cal.space.reopen', id: number) => {
    const r = await promptBox(t('السبب', 'The reason'));
    if (r?.trim()) await act(() => s.api.call(op, { id, reason: r }));
  };
  const savePeriod = async () => {
    if (period && (await act(() => s.api.call('cal.period.save', period)))) setPeriod(null);
  };
  const saveRepair = async (force: boolean) => {
    if (!repair?.room_id) { toast(t('اختر المكان', 'Choose the space'), true); return; }
    try {
      const r = await s.api.call('cal.space.close', { room_id: repair.room_id, from_day: repair.from_day, to_day: repair.to_day, reason: repair.reason, force });
      if (!r.saved) { setRepair({ ...repair, hit: r.bookings }); return; }
      await refresh();
      setRepair(null);
    } catch (e) { toast(errText(e), true); }
  };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      {data.rights.setup && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{t('فترات إغلاق المركز', 'Closed periods of the centre')}</h3>
            <button className="btn small" onClick={() => setPeriod({ name: '', from_day: today, to_day: today })}>＋ {t('فترة', 'Period')}</button>
          </div>
          <p className="small muted">{t('عطلة، شهر آب…: شريط ملوّن وتنبيه في التقويم، ويبقى الحجز ممكناً.', 'Holidays, August…: a coloured band and a warning on the calendar; booking stays possible.')}</p>
          <table className="t small"><tbody>
            {data.periods.map((p) => (
              <tr key={p.id} className={p.cancelled ? 'off' : ''}>
                <td><b>{p.name}</b></td><td dir="ltr">{fmtDate(p.from_day)} → {fmtDate(p.to_day)}</td>
                <td className="muted">{p.cancelled ? `${t('أُلغيت', 'cancelled')}: ${p.cancel_reason ?? ''}` : ''}</td>
                <td style={{ textAlign: 'end' }}>{!p.cancelled && <><button className="btn ghost small" onClick={() => setPeriod({ id: p.id, name: p.name, from_day: p.from_day, to_day: p.to_day })}>{t('عدّل', 'Edit')}</button><button className="btn ghost small" onClick={() => void cancel('cal.period.cancel', p.id)}>{t('ألغِ', 'Cancel it')}</button></>}</td>
              </tr>
            ))}
          </tbody></table>
          {!data.periods.length && <p className="small muted">{t('لا فترة إغلاق.', 'No closed period.')}</p>}
        </div>
      )}
      {data.rights.whole && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{t('أماكن مغلقة للإصلاح', 'Spaces closed for repairs')}</h3>
            <button className="btn small" onClick={() => setRepair({ room_id: null, from_day: today, to_day: today, reason: '' })}>＋ {t('أغلق مكاناً', 'Close a space')}</button>
          </div>
          <p className="small muted">{t('دهان، إصلاح…: لا يمكن حجز المكان في هذه الأيام.', 'Painting, repairs…: the space cannot be booked on those days.')}</p>
          <table className="t small"><tbody>
            {data.closed.map((c) => (
              <tr key={c.id} className={c.cancelled ? 'off' : ''}>
                <td><b>{space(c.room_id)}</b></td><td dir="ltr">{fmtDate(c.from_day)} → {fmtDate(c.to_day)}</td><td>{c.reason}</td>
                <td className="muted">{c.cancelled ? `${t('أُعيد فتحه', 'reopened')}: ${c.cancel_reason ?? ''}` : ''}</td>
                <td style={{ textAlign: 'end' }}>{!c.cancelled && <button className="btn ghost small" onClick={() => void cancel('cal.space.reopen', c.id)}>{t('أعد فتحه', 'Reopen')}</button>}</td>
              </tr>
            ))}
          </tbody></table>
          {!data.closed.length && <p className="small muted">{t('لا مكان مغلق.', 'No space is closed.')}</p>}
        </div>
      )}
      {period && (
        <Modal title={t('فترة إغلاق', 'Closed period')} onClose={() => setPeriod(null)} narrow>
          <div className="cal-form">
            <Field label={t('الاسم', 'Name')}><input className="inp" autoFocus placeholder={t('عطلة الصيف', 'Summer holidays')} value={period.name} onChange={(e) => setPeriod({ ...period, name: e.target.value })} /></Field>
            <Field label={t('من', 'From')}><input className="inp" type="date" value={period.from_day} onChange={(e) => setPeriod({ ...period, from_day: e.target.value })} /></Field>
            <Field label={t('إلى', 'To')}><input className="inp" type="date" value={period.to_day} onChange={(e) => setPeriod({ ...period, to_day: e.target.value })} /></Field>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setPeriod(null)}>{t('إلغاء', 'Cancel')}</button>
            <button className="btn primary" onClick={() => void savePeriod()}>{t('حفظ', 'Save')}</button>
          </div>
        </Modal>
      )}
      {repair && (
        <Modal title={t('إغلاق مكان للإصلاح', 'Close a space for repairs')} onClose={() => setRepair(null)} narrow>
          <div className="cal-form">
            <Field label={t('المكان', 'Space')}>
              <select className="inp" value={repair.room_id ?? ''} onChange={(e) => setRepair({ ...repair, room_id: Number(e.target.value) || null, hit: undefined })}>
                <option value="">…</option>
                {data.areas.map((a) => <optgroup key={a.id} label={a.name}>{data.spaces.filter((x) => x.building_id === a.id && inCalendar(x)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
              </select>
            </Field>
            <Field label={t('من', 'From')}><input className="inp" type="date" value={repair.from_day} onChange={(e) => setRepair({ ...repair, from_day: e.target.value, hit: undefined })} /></Field>
            <Field label={t('إلى', 'To')}><input className="inp" type="date" value={repair.to_day} onChange={(e) => setRepair({ ...repair, to_day: e.target.value, hit: undefined })} /></Field>
            <Field label={t('السبب', 'Reason')}><input className="inp" placeholder={t('دهان', 'Painting')} value={repair.reason} onChange={(e) => setRepair({ ...repair, reason: e.target.value })} /></Field>
          </div>
          {repair.hit && (
            <div className="alert warn">
              <b>{t('حجوزات موجودة في هذا المكان في تلك الأيام:', 'Bookings already in this space on those days:')}</b>
              <ul>{repair.hit.map((h, i) => <li key={i}>{h.name} — <span dir="ltr">{h.days.map(fmtDate).join(', ')}</span></li>)}</ul>
              <div className="small">{t('البرنامج لا ينقلها. أغلق المكان على كل حال؟', 'The program does not move them. Close the space anyway?')}</div>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setRepair(null)}>{t('إلغاء', 'Cancel')}</button>
            {repair.hit
              ? <button className="btn danger" onClick={async () => { if (await confirmBox(t('أغلق المكان مع وجود هذه الحجوزات؟', 'Close the space with these bookings in it?'), true)) await saveRepair(true); }}>{t('أغلق على كل حال', 'Close anyway')}</button>
              : <button className="btn primary" onClick={() => void saveRepair(false)}>{t('أغلق', 'Close it')}</button>}
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- the equipment a booking may ask for

/** chosen from the names the inventory holds; how many exist is counted from the inventory (in use, in good condition) */
function EquipList({ data, refresh }: { data: CalData; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const act = useAct(refresh);
  const [names, setNames] = useState<{ name: string; total: number; good: number }[]>([]);
  const [pick, setPick] = useState('');
  useEffect(() => { void s.api.call('cal.equip.options').then(setNames).catch(() => setNames([])); }, [s, data.equip.length]);
  return (
    <div className="panel">
      <h3 style={{ margin: 0 }}>{t('التجهيزات التي يمكن طلبها', 'Equipment a booking can ask for')}</h3>
      <p className="small muted">{t('تُختار من أسماء الأغراض في الجرد. إن طلبت حجوزات في الوقت نفسه أكثر مما في الجرد، ينبّه البرنامج.', 'Chosen from the names of the items in the inventory. When bookings at the same time ask for more than the inventory holds, the program warns.')}</p>
      <table className="t small"><tbody>
        {data.equip.map((e) => (
          <tr key={e.id} className={e.active ? '' : 'off'}><td>{e.name}</td><td className="n">{e.total} {t('في الجرد', 'in the inventory')}</td>
            <td style={{ textAlign: 'end' }}><button className="btn ghost small" onClick={() => void act(() => s.api.call('cal.equip.save', { id: e.id, active: !e.active }))}>{e.active ? t('أوقف', 'Switch off') : t('أعد', 'Switch on')}</button></td></tr>
        ))}
      </tbody></table>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <select className="inp" style={{ width: 'auto' }} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{t('اختر غرضاً من الجرد…', 'Choose an item of the inventory…')}</option>
          {names.filter((x) => !data.equip.some((e) => e.name.toLowerCase() === x.name.trim().toLowerCase())).map((x) => <option key={x.name} value={x.name}>{x.name} ({x.good})</option>)}
        </select>
        <button className="btn small" disabled={!pick} onClick={() => void act(async () => { await s.api.call('cal.equip.save', { name: pick }); setPick(''); })}>＋ {t('أضف', 'Add')}</button>
      </div>
      {!names.length && <p className="small muted">{t('الجرد فارغ: سجّل الأغراض فيه أولاً.', 'The inventory is empty: list the items there first.')}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- the calendar phones (step 5)
function PhonesTab() {
  const { s } = useApp();
  const [list, setList] = useState<CalPhoneInfo[] | null>(null);
  const [where, setWhere] = useState<string[]>([]);
  const [form, setForm] = useState<{ id?: string; name: string; role: PhoneRole } | null>(null);
  const [made, setMade] = useState<{ name: string; code: string } | null>(null);
  const load = async () => { try { setList(await s.api.call('cal.phone.list')); } catch { setList([]); } };
  useEffect(() => { void load(); phoneWhere().then((w) => setWhere(w.app), () => setWhere([])); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const role = (r: PhoneRole) => t(ROLE_NAME[r].ar, ROLE_NAME[r].en);
  const save = async () => {
    if (!form) return;
    try {
      if (form.id) { await s.api.call('cal.phone.edit', { id: form.id, name: form.name, role: form.role }); setForm(null); }
      else { const r = await s.api.call('cal.phone.add', { name: form.name, role: form.role }); setMade({ name: form.name, code: r.code }); setForm(null); }
      await load();
    } catch (e) { toast(errText(e), true); }
  };
  const cut = async (p: CalPhoneInfo) => {
    if (!(await confirmBox(t(`إيقاف الهاتف «${p.name}»؟ لا يرى التقويم بعدها، ويُربط هاتف جديد برمز جديد إن لزم.`, `Cut off the phone "${p.name}"? It sees nothing after that; a new link code links it again if needed.`), true))) return;
    try { await s.api.call('cal.phone.cut', { id: p.id }); await load(); toast(t('أُوقف', 'Cut off')); } catch (e) { toast(errText(e), true); }
  };
  if (!list) return null;
  const state = (p: CalPhoneInfo) => p.revoked_at ? t(`أوقفه ${p.revoked_by ?? ''}`, `cut off by ${p.revoked_by ?? ''}`) : p.waiting ? t('ينتظر الربط (الرمز يعمل مرة واحدة)', 'waiting to be linked (the code works once)') : !p.linked_at ? t('انتهى رمز الربط: اربطه من جديد', 'the link code ran out: link it again') : p.last_sync ? p.last_sync.slice(0, 16).replace('T', ' ') : '—';
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>📱 {t('هواتف التقويم', 'Calendar phones')}</h3>
        <button className="btn small" onClick={() => setForm({ name: '', role: 'team' })}>＋ {t('اربط هاتفاً', 'Link a phone')}</button>
      </div>
      <p className="small muted">{t('هاتف للقراءة فقط: اليوم والأسبوع والأماكن، شهر للخلف و6 أشهر للأمام. لا يستلم أسعاراً ولا دفعات؛ والأسماء وأرقام الهواتف فقط على هاتف الاستقبال والمنسّق والمدير.', 'A read-only phone: Today, Week and Spaces, 1 month back and 6 months ahead. It never receives prices or payments; the contacts (person and phone) only reach Reception, Coordinator and Director phones.')}</p>
      {where.length > 0 && <p className="small">{t('على الهاتف، وهو على شبكة المركز: افتح', "On the phone, on the centre's network, open")} {where.map((a) => <b key={a} className="ltr" style={{ marginInlineEnd: 8 }}>{a}#calendar</b>)}</p>}
      <table className="t small">
        <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('الدور', 'Role')}</th><th>{t('رُبط', 'Linked')}</th><th>{t('آخر تحديث', 'Last update')}</th><th /></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} className={p.revoked_at ? 'off' : ''}>
              <td><b>{p.name}</b></td><td>{role(p.role)}</td><td dir="ltr">{p.linked_at ? p.linked_at.slice(0, 10) : '—'}</td><td>{state(p)}</td>
              <td style={{ textAlign: 'end' }}>{!p.revoked_at && <><button className="btn ghost small" onClick={() => setForm({ id: p.id, name: p.name, role: p.role })}>{t('عدّل', 'Edit')}</button><button className="btn ghost small" onClick={() => void cut(p)}>{t('أوقف', 'Cut off')}</button></>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && <p className="small muted">{t('لا هاتف مربوط بعد.', 'No phone is linked yet.')}</p>}
      {form && (
        <Modal title={form.id ? t('هاتف التقويم', 'Calendar phone') : t('اربط هاتفاً', 'Link a phone')} onClose={() => setForm(null)} narrow>
          <div className="cal-form">
            <Field label={t('الاسم', 'Name')}><input className="inp" autoFocus placeholder={t('هاتف الاستقبال', 'Reception phone')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('الدور', 'Role')}>
              <select className="inp" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as PhoneRole })}>
                {PHONE_ROLES.map((r) => <option key={r} value={r}>{role(r)}</option>)}
              </select>
            </Field>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setForm(null)}>{t('إلغاء', 'Cancel')}</button>
            <button className="btn primary" onClick={() => void save()}>{form.id ? t('حفظ', 'Save') : t('أعطني رمز الربط', 'Give me the link code')}</button>
          </div>
        </Modal>
      )}
      {made && (
        <Modal title={t('رمز الربط', 'Link code')} onClose={() => setMade(null)} narrow>
          <p>{t(`للهاتف «${made.name}». يعمل مرة واحدة ولمدة 30 دقيقة. اكتبه على الهاتف ثم اختر رمزاً من 4 أرقام.`, `For the phone "${made.name}". It works once, for 30 minutes. Type it on the phone, then choose a code of 4 digits.`)}</p>
          <div className="ltr" style={{ fontSize: 34, fontWeight: 700, letterSpacing: 4, textAlign: 'center', margin: '14px 0' }}>{made.code}</div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={() => setMade(null)}>{t('تم', 'Done')}</button></div>
        </Modal>
      )}
    </div>
  );
}

