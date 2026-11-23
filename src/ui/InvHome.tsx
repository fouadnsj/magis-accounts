// The new MAGIS Inventory (baseline 1.1 §4, step 2): the screens. Home = the map of the centre (the calendar's areas and
// spaces, and the stores that are never booked): a card per space with a photo, how many items, the value (only for who
// sees the values), the last count and what needs attention; the figures on top; the quick views (by place, by category,
// all items, with staff). A space has its page (photos, the list, Count this space, Move items); an item has its page
// (photos, details, history, the links to the books and to the calendar). The rules: inventory/map.ts and inventory/inv.ts.
// The 0.12 inventory screen (Inventory.tsx) stays; its item window, photos and "to register" list are used here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { Field, Modal, biName, confirmBox, errText, fmtDate, fmtUsd as fmtNum, t, toast, todayIso } from './kit';
import { m, tx } from '../i18n';
import { saveFile } from '../platform';
import { labelsPdf } from '../io/invLabels';
import { inUse, itemTotal, pendingEntries, type InvData, type InvItem } from '../inventory/inv';
import { INV_AREA, findByLabel, groupOf, inRoomOf, invMap, itemAsks, spaceOfPlace, type MapCard, type MapSpace } from '../inventory/map';
import { addDays } from '../hosting/host';
import type { CalData } from '../hosting/calendar';
import { hm, itemsBetween } from '../hosting/calview';
import { COND_LABEL, ItemModal, MOVE_LABEL, Photos, RegisterTab, labelsOf, useEntries } from './Inventory';

const L = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));
/** an amount in dollars, with its sign */
const fmtUsd = (n: number | null | undefined) => (n == null ? '' : Math.abs(n) < 0.005 ? '$0' : `$${fmtNum(n)}`);
type View = 'map' | 'place' | 'category' | 'all' | 'staff' | 'register' | 'attention';
type Screen = { k: 'home' } | { k: 'space'; id: number } | { k: 'item'; id: number };

// ---------------------------------------------------------------- photos (fetched once, kept while the page is open)

const photoCache = new Map<string, string>();
function usePhoto(id: string | null | undefined): string | null {
  const { s } = useApp();
  const [src, setSrc] = useState<string | null>(id ? photoCache.get(id) ?? null : null);
  useEffect(() => {
    if (!id) { setSrc(null); return; }
    if (photoCache.has(id)) { setSrc(photoCache.get(id)!); return; }
    let live = true;
    s.api.call('inv.photo.get', { id }).then((r: { mime: string; base64: string }) => {
      const u = `data:${r.mime};base64,${r.base64}`;
      photoCache.set(id, u);
      if (live) setSrc(u);
    }).catch(() => { /* a missing file: the card shows its sign */ });
    return () => { live = false; };
  }, [id, s]);
  return src;
}
function Thumb({ id, sign, h = 70 }: { id: string | null | undefined; sign: string; h?: number }) {
  const src = usePhoto(id);
  return <div className="inv-ph" style={{ height: h }}>{src ? <img src={src} alt="" /> : <span>{sign}</span>}</div>;
}

// ---------------------------------------------------------------- the section

export function InventoryHome() {
  const { s, can, d, reload } = useApp();
  const [inv, setInv] = useState<InvData | null>(null);
  const [cal, setCal] = useState<CalData | null>(null);
  const [screen, setScreen] = useState<Screen>({ k: 'home' });
  const [view, setView] = useState<View>('map');
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    try { setInv(await s.api.call('inv.get')); } catch (e) { toast(errText(e), true); }
    if (can('cal.view')) { try { setCal(await s.api.call('cal.get')); } catch { setCal(null); } }
  }, [s, can]);
  useEffect(() => { void load(); }, [load, d.inv]);
  const refresh = async () => { await reload(); await load(); };
  const er = useEntries();
  const pending = useMemo(() => pendingEntries(er.rows, d.lists, d.inv), [er, d.lists, d.inv]);

  if (!inv) return <p className="muted">…</p>;
  const go = (x: Screen) => { setScreen(x); window.scrollTo(0, 0); };
  const home = () => go({ k: 'home' });
  return (
    <>
      <div className="page-head"><h1>{L('الجرد', 'Inventory', 'Inventaire')}</h1></div>
      {screen.k === 'space' && <SpacePage inv={inv} cal={cal} spaceId={screen.id} go={go} back={home} refresh={refresh} />}
      {screen.k === 'item' && <ItemPage inv={inv} cal={cal} itemId={screen.id} go={go} back={home} refresh={refresh} />}
      {screen.k === 'home' && <Home inv={inv} view={view} setView={setView} q={q} setQ={setQ} go={go} pending={pending.length} refresh={refresh} pendingRows={pending} />}
    </>
  );
}

// ---------------------------------------------------------------- home: figures, quick views, the map

function Home({ inv, view, setView, q, setQ, go, pending, pendingRows, refresh }: {
  inv: InvData; view: View; setView: (v: View) => void; q: string; setQ: (s: string) => void; go: (x: Screen) => void; pending: number; pendingRows: ReturnType<typeof pendingEntries>; refresh: () => Promise<void>;
}) {
  const r = inv.rights;
  const [open, setOpen] = useState(false);
  const live = inv.items.filter(inUse);
  const map = useMemo(() => invMap(inv, { values: r.values }), [inv, r.values]);
  const attention = live.filter((i) => i.condition !== 'good').length;
  const staff = live.filter((i) => i.holder).length;
  const asks = live.filter((i) => itemAsks(i, inv.categories, inv.photos).length).length;
  const value = live.reduce((a, i) => a + itemTotal(i), 0);
  const found = q.trim() ? searchItems(inv, q) : null;

  const tile = (n: string | number, label: string, v: View | null, red = false) => (
    <button className={`cal-tile${red ? ' red' : ''}${v && view === v ? ' on' : ''}`} onClick={() => v && setView(view === v ? 'map' : v)} disabled={!v}>
      <b>{n}</b><span>{label}</span>
    </button>
  );
  return (
    <>
      <div className="cal-strip">
        {tile(live.length, `${L('غرضاً', 'items', 'objets')} · ${live.reduce((a, i) => a + i.qty, 0)} ${L('قطعة', 'units', 'unités')}`, 'all')}
        {r.values && tile(fmtUsd(value), L('القيمة (مشتراة أو مقدَّرة)', 'value (bought or estimated)', 'valeur (achat ou estimation)'), null)}
        {r.keep && tile(pending, L('مشتريات تُسجَّل', 'purchases to register', 'achats à enregistrer'), 'register', pending > 0)}
        {tile(attention, L('تحتاج إصلاحاً أو معطّلة', 'to repair or broken', 'à réparer ou cassés'), 'attention', attention > 0)}
        {tile(staff, L('مع الموظفين', 'with staff', 'chez le personnel'), 'staff')}
        {r.keep && asks > 0 && tile(asks, L('ينقصها صورة أو رقم تسلسلي', 'without a photo or a serial', 'sans photo ni n° de série'), 'attention', true)}
      </div>
      <div className="cal-bar row" style={{ marginBottom: 8 }}>
        <div className="cal-quick" style={{ margin: 0 }}>
          {([['map', L('الخريطة', 'Map', 'Plan')], ['place', L('حسب المكان', 'By place', 'Par lieu')], ['category', L('حسب الصنف', 'By category', 'Par catégorie')], ['all', L('كل الأغراض', 'All items', 'Tous les objets')], ['staff', L('مع الموظفين', 'With staff', 'Chez le personnel')]] as [View, string][]).map(([v, label]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{label}</button>
          ))}
        </div>
        <input className="inp cal-search" placeholder={L('بحث: رمز، اسم، رقم تسلسلي، شخص…', 'Search: label, name, serial, person…', 'Chercher : étiquette, nom, n° de série, personne…')} value={q} onChange={(e) => setQ(e.target.value)} />
        {r.keep && <button className="btn primary" onClick={() => setOpen(true)}>＋ {L('غرض', 'Item', 'Objet')}</button>}
      </div>
      {found ? <ItemTable inv={inv} items={found} go={go} />
        : view === 'map' ? <MapView inv={inv} map={map} go={go} />
        : view === 'register' && r.keep ? <RegisterTab inv={inv} manage pending={pendingRows} refresh={refresh} />
        : <ListView inv={inv} view={view} go={go} />}
      {open && <ItemModal inv={inv} item={null} manage onClose={() => setOpen(false)} refresh={refresh} />}
    </>
  );
}

function searchItems(inv: InvData, q: string): InvItem[] {
  const s = q.trim().toLowerCase();
  const byLabel = findByLabel(inv.items, q);
  const rest = inv.items.filter((i) => !byLabel.includes(i) && [i.code, i.name, i.brand, i.model, i.serial, i.holder, i.note].some((x) => (x ?? '').toLowerCase().includes(s)));
  return [...byLabel, ...rest];
}

function MapView({ inv, map, go }: { inv: InvData; map: ReturnType<typeof invMap>; go: (x: Screen) => void }) {
  const r = inv.rights;
  if (!map.areas.length) return <p className="muted">{L('لا أماكن بعد: تُضاف المناطق والأماكن في إعدادات التقويم، والمخازن في قوائم الجرد.', 'No spaces yet: the areas and spaces are added in the calendar\'s settings, the stores in the inventory\'s lists.', 'Pas encore d’espaces : les zones et espaces s’ajoutent dans les réglages du calendrier, les réserves dans les listes de l’inventaire.')}</p>;
  return (
    <>
      {map.areas.map(({ area, spaces }) => {
        const items = spaces.reduce((n, c) => n + c.items, 0);
        const val = spaces.reduce((n, c) => n + (c.value ?? 0), 0);
        return (
          <section key={area.id} className="inv-area">
            <div className="inv-ah"><i style={{ background: area.color ?? 'var(--line)' }} />{biName(area.name)}
              <small>{spaces.length} {L('مكاناً', 'spaces', 'espaces')} · {items} {L('غرضاً', 'items', 'objets')}{r.values ? ` · ${fmtUsd(val)}` : ''}</small></div>
            <div className="inv-cards">{spaces.map((c) => <SpaceCard key={c.space.id} c={c} inv={inv} onOpen={() => go({ k: 'space', id: c.space.id })} />)}</div>
          </section>
        );
      })}
      {map.unplaced > 0 && <p className="small muted">{map.unplaced} {L('غرضاً بلا مكان بعد: انظر «كل الأغراض».', 'items without a place yet: see "All items".', 'objets sans lieu : voir « Tous les objets ».')}</p>}
    </>
  );
}

function SpaceCard({ c, inv, onOpen }: { c: MapCard; inv: InvData; onOpen: () => void }) {
  const counted = c.lastCount ? `${L('عُدّ', 'counted', 'compté')} ${fmtDate(c.lastCount)}` : c.items ? L('لم يُعدّ', 'not counted', 'pas compté') : '';
  return (
    <button className="inv-card" onClick={onOpen}>
      <Thumb id={c.photo} sign={c.bookable ? '🚪' : '📦'} />
      <div className="inv-bd">
        <b>{c.space.name}</b>
        <small>{c.items} {L('غرضاً', 'items', 'objets')}{inv.rights.values && c.value != null ? ` · ${fmtUsd(c.value)}` : ''}</small>
        <div className="inv-dots">
          {counted && <span className={`inv-dot ${c.lastCount ? 'ok' : 'w'}`}>{counted}</span>}
          {c.attention > 0 && <span className="inv-dot e">{c.attention} {L('تحتاج انتباهاً', 'need attention', 'à voir')}</span>}
          {!c.bookable && <span className="inv-dot b">{L('لا يُحجز', 'not booked', 'pas réservé')}</span>}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------- the lists (quick views)

function ListView({ inv, view, go }: { inv: InvData; view: View; go: (x: Screen) => void }) {
  const live = inv.items.filter(inUse);
  if (view === 'staff') {
    const list = live.filter((i) => i.holder);
    return list.length ? <ItemTable inv={inv} items={list} go={go} withHolder /> : <p className="muted">{L('لا شيء مع الموظفين الآن.', 'Nothing is with a staff member now.', 'Rien chez le personnel en ce moment.')}</p>;
  }
  if (view === 'attention') {
    const list = live.filter((i) => i.condition !== 'good' || itemAsks(i, inv.categories, inv.photos).length);
    return list.length ? <ItemTable inv={inv} items={list} go={go} withAsks /> : <p className="muted">{L('لا شيء يحتاج انتباهاً.', 'Nothing needs attention.', 'Rien à voir.')}</p>;
  }
  if (view === 'all') return <ItemTable inv={inv} items={inv.items} go={go} withOut />;
  // grouped: by place (the spaces of the map, in its order) or by category
  const groups: { key: string; title: string; items: InvItem[] }[] = [];
  if (view === 'place') {
    for (const a of inv.areas) for (const sp of inv.spaces.filter((x) => x.building_id === a.id)) {
      const items = live.filter((i) => sp.place_id != null && i.place_id === sp.place_id);
      if (items.length) groups.push({ key: `s${sp.id}`, title: placeText(inv, sp.place_id), items });
    }
    const none = live.filter((i) => i.place_id == null || !spaceOfPlace(inv.spaces, i.place_id));
    if (none.length) groups.push({ key: 'none', title: L('بلا مكان', 'Without a place', 'Sans lieu'), items: none });
  } else {
    for (const c of inv.categories) { const items = live.filter((i) => i.category_id === c.id); if (items.length) groups.push({ key: `c${c.id}`, title: biName(c.name), items }); }
    const none = live.filter((i) => i.category_id == null);
    if (none.length) groups.push({ key: 'none', title: L('بلا صنف', 'Without a category', 'Sans catégorie'), items: none });
  }
  if (!groups.length) return <p className="muted">{L('لا أغراض بعد.', 'No items yet.', 'Pas encore d’objets.')}</p>;
  return <>{groups.map((g) => <section key={g.key} className="inv-area"><div className="inv-ah">{g.title}<small>{g.items.length}</small></div><ItemTable inv={inv} items={g.items} go={go} hidePlace={view === 'place'} /></section>)}</>;
}

/** the name of an item's space, as the map gives it */
export function placeText(inv: InvData, placeId: number | null): string {
  const sp = spaceOfPlace(inv.spaces, placeId);
  if (!sp) return inv.places.find((p) => p.id === placeId)?.name ?? '';
  const a = inv.areas.find((x) => x.id === sp.building_id);
  return a && a.name !== INV_AREA ? `${biName(a.name)} · ${sp.name}` : sp.name;
}

function ItemTable({ inv, items, go, withHolder, withOut, withAsks, hidePlace }: { inv: InvData; items: InvItem[]; go: (x: Screen) => void; withHolder?: boolean; withOut?: boolean; withAsks?: boolean; hidePlace?: boolean }) {
  const cat = new Map(inv.categories.map((c) => [c.id, biName(c.name)]));
  const first = new Map<number, string>();
  for (const p of inv.photos) if (!first.has(p.item_id)) first.set(p.item_id, p.id);
  const lastHolder = (i: InvItem) => inv.moves.filter((x) => x.item_id === i.id && x.kind === 'given').sort((a, b) => b.id - a.id)[0]?.on_date ?? null;
  return (
    <div className="table-wrap"><table className="t">
      <thead><tr>
        <th />{<th>{L('الرمز', 'Label', 'Étiquette')}</th>}<th>{L('الاسم', 'Name', 'Nom')}</th><th>{L('الصنف', 'Category', 'Catégorie')}</th>
        {!hidePlace && <th>{L('المكان', 'Space', 'Espace')}</th>}<th>{L('العدد', 'Qty', 'Qté')}</th><th>{L('الحالة', 'State', 'État')}</th>
        {withHolder && <th>{L('مع', 'With', 'Chez')}</th>}{withHolder && <th>{L('منذ', 'Since', 'Depuis')}</th>}
        {withAsks && <th>{L('ينقصه', 'Missing', 'Manque')}</th>}
        {inv.rights.values && <th className="num">{L('القيمة', 'Value', 'Valeur')}</th>}
      </tr></thead>
      <tbody>{items.map((i) => {
        const asks = itemAsks(i, inv.categories, inv.photos);
        return (
          <tr key={i.id} className={inUse(i) ? 'click' : 'click muted'} onClick={() => go({ k: 'item', id: i.id })}>
            <td style={{ width: 44 }}><MiniThumb id={first.get(i.id)} /></td>
            <td className="mono">{i.code}</td><td>{i.name}{!inUse(i) && withOut ? ` · ${i.status === 'lost' ? L('مفقود', 'lost', 'perdu') : L('أُخرج', 'taken out', 'sorti')}` : ''}</td>
            <td className="muted">{i.category_id ? cat.get(i.category_id) : ''}</td>
            {!hidePlace && <td>{placeText(inv, i.place_id)}</td>}
            <td>{i.qty > 1 ? `×${i.qty}` : '1'}</td>
            <td className={i.condition === 'good' ? '' : 'bad'}>{COND_LABEL[i.condition]()}</td>
            {withHolder && <td>{i.holder}</td>}{withHolder && <td>{fmtDate(lastHolder(i))}</td>}
            {withAsks && <td className="small">{asks.map((a) => (a === 'photo' ? L('صورة', 'photo', 'photo') : L('رقم تسلسلي', 'serial', 'n° de série'))).join(' · ')}</td>}
            {inv.rights.values && <td className="num">{i.value_usd != null ? fmtUsd(itemTotal(i)) : ''}</td>}
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}
function MiniThumb({ id }: { id: string | undefined }) {
  const src = usePhoto(id);
  return src ? <img src={src} alt="" className="inv-mini" /> : null;
}

// ---------------------------------------------------------------- a space

function SpacePage({ inv, cal, spaceId, go, back, refresh }: { inv: InvData; cal: CalData | null; spaceId: number; go: (x: Screen) => void; back: () => void; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const r = inv.rights;
  const sp = inv.spaces.find((x) => x.id === spaceId);
  const [moving, setMoving] = useState(false);
  if (!sp) return <p className="muted">{L('المكان غير موجود', 'Space not found', 'Espace introuvable')} · <button className="btn small" onClick={back}>‹</button></p>;
  const area = inv.areas.find((a) => a.id === sp.building_id);
  const here = inv.items.filter((i) => inUse(i) && sp.place_id != null && i.place_id === sp.place_id);
  const first = new Map<number, string>();
  for (const p of inv.photos) if (!first.has(p.item_id)) first.set(p.item_id, p.id);
  const lastCount = here.reduce<string | null>((m2, i) => (i.counted_on && (!m2 || i.counted_on > m2) ? i.counted_on : m2), null);
  const attention = here.filter((i) => i.condition !== 'good');
  const always = inRoomOf([sp], here, inv.categories);
  // this week in this space (who may see the calendar)
  const today = todayIso();
  const week = cal && sp.bookable ? [...itemsBetween(cal, today, addDays(today, 6)).entries()].flatMap(([day, xs]) => xs.filter((x) => x.spaces.includes(sp.id)).map((x) => ({ day, x }))) : [];

  const count = async () => {
    if (!here.length || !(await confirmBox(L(`عُدّت الأغراض الـ${here.length} في هذا المكان اليوم؟`, `All ${here.length} items of this space were seen today?`, `Les ${here.length} objets de cet espace ont été vus aujourd’hui ?`)))) return;
    try { await s.api.call('inv.count', { ids: here.map((i) => i.id), placeId: sp.place_id }); await refresh(); toast(L('عُدّ ✓', 'Counted ✓', 'Compté ✓')); } catch (e) { toast(errText(e), true); }
  };
  return (
    <>
      <div className="cal-bar row" style={{ marginBottom: 10 }}>
        <button className="btn small" onClick={back}>‹ {L('الخريطة', 'Map', 'Plan')}</button>
        <h2 style={{ margin: 0 }}>{sp.name}</h2>
        <span className="muted">{area ? biName(area.name) : ''}{sp.floor ? ` · ${sp.floor}` : ''}</span>
        {!sp.bookable && <span className="inv-dot b">{L('لا يُحجز: في الجرد فقط', 'not booked: inventory only', 'pas réservé : inventaire seulement')}</span>}
        <span style={{ flex: 1 }} />
        {r.keep && <button className="btn" disabled={!here.length} onClick={() => void count()}>✔ {L('عُدّ هذا المكان', 'Count this space', 'Compter cet espace')}</button>}
        {r.keep && <button className="btn" disabled={!here.length} onClick={() => setMoving(true)}>↪ {L('انقل أغراضاً…', 'Move items…', 'Déplacer des objets…')}</button>}
      </div>
      <div className="inv-two">
        <div>
          {here.length ? (
            <div className="inv-items">{here.map((i) => (
              <button key={i.id} className="inv-card" onClick={() => go({ k: 'item', id: i.id })}>
                <Thumb id={first.get(i.id)} sign="▫" h={58} />
                <div className="inv-bd"><b>{i.name}{i.qty > 1 ? ` ×${i.qty}` : ''}</b><small>{i.code} · <span className={i.condition === 'good' ? '' : 'bad'}>{COND_LABEL[i.condition]()}</span></small></div>
              </button>
            ))}</div>
          ) : <p className="muted">{L('لا أغراض مسجّلة في هذا المكان.', 'No items listed in this space.', 'Aucun objet listé dans cet espace.')}</p>}
          {here.length > 0 && <div style={{ marginTop: 12 }}><ItemTable inv={inv} items={here} go={go} hidePlace /></div>}
        </div>
        <ul className="inv-facts">
          <li><span>{L('الأغراض', 'Items', 'Objets')}</span>{here.length} · {here.reduce((n, i) => n + i.qty, 0)} {L('قطعة', 'units', 'unités')}</li>
          {r.values && <li><span>{L('القيمة', 'Value', 'Valeur')}</span>{fmtUsd(here.reduce((n, i) => n + itemTotal(i), 0))}</li>}
          <li><span>{L('آخر عدّ', 'Last count', 'Dernier comptage')}</span>{lastCount ? fmtDate(lastCount) : L('لم يُعدّ', 'not counted', 'pas compté')}</li>
          <li><span>{L('انتباه', 'Attention', 'À voir')}</span>{attention.length ? attention.map((i) => `${i.name} (${COND_LABEL[i.condition]()})`).join('، ') : '—'}</li>
          {sp.bookable ? <li><span>{L('دائماً في المكان', 'Always in the room', 'Toujours dans la salle')}</span>{always.length ? always.map((x) => (x.qty > 1 ? `${x.name} ×${x.qty}` : x.name)).join('، ') : (sp.fixed || '—')}</li> : null}
          {week.length > 0 && <li><span>{L('هذا الأسبوع', 'This week', 'Cette semaine')}</span><div>{week.slice(0, 8).map(({ day, x }) => <div key={`${day}-${x.b.id}`}>{fmtDate(day)} · {x.b.group_name}{x.b.time_from ? ` ${hm(x.occ.from)}` : ''}</div>)}</div></li>}
        </ul>
      </div>
      {moving && <MoveModal inv={inv} items={here} from={sp} onClose={() => setMoving(false)} refresh={refresh} />}
    </>
  );
}

/** move items of a space (all of an item, or part of a group, which then splits) to another space of the map */
function MoveModal({ inv, items, from, onClose, refresh }: { inv: InvData; items: InvItem[]; from: MapSpace | null; onClose: () => void; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const [to, setTo] = useState<number | null>(null);
  const [qty, setQty] = useState<Record<number, string>>(() => (items.length === 1 && items[0].qty === 1 ? { [items[0].id]: '1' } : {}));
  const [busy, setBusy] = useState(false);
  const chosen = items.filter((i) => Number(qty[i.id]) > 0);
  const tooMany = chosen.filter((i) => !Number.isInteger(Number(qty[i.id])) || Number(qty[i.id]) > i.qty);
  const save = async () => {
    if (to == null || !chosen.length) return;
    if (tooMany.length) return toast(`${L('العدد أكبر مما هو موجود:', 'More than there is:', 'Plus qu’il n’y en a :')} ${tooMany.map((i) => `${i.code} (${i.qty})`).join(', ')}`, true);
    setBusy(true);
    try {
      const parts: string[] = [];
      for (const i of chosen) {
        const n = Math.round(Number(qty[i.id]));
        const r = (await s.api.call('inv.item.move', { id: i.id, space_id: to, qty: n })) as { moves?: string };
        if (r.moves) parts.push(r.moves);
      }
      await refresh();
      toast(parts.length ? `${L('نُقل ✓ — أجزاء جديدة:', 'Moved ✓ — new parts:', 'Déplacé ✓ — nouvelles parties :')} ${parts.join(', ')}` : L('نُقل ✓', 'Moved ✓', 'Déplacé ✓'));
      onClose();
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  return (
    <Modal title={`↪ ${L('نقل أغراض', 'Move items', 'Déplacer des objets')}${from ? ` · ${from.name}` : ''}`} onClose={onClose}>
      <Field label={L('إلى المكان', 'To the space', 'Vers l’espace')}>
        <select value={to ?? ''} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{L('اختر…', 'Choose…', 'Choisir…')}</option>
          {inv.areas.filter((a) => a.active).map((a) => <optgroup key={a.id} label={biName(a.name)}>{inv.spaces.filter((x) => x.building_id === a.id && x.active && x.id !== from?.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
        </select>
      </Field>
      <p className="small muted">{L('اكتب كم ينتقل من كل غرض. جزء من مجموعة يصبح غرضاً بالرمز نفسه مع حرف (A يبقى، B ينتقل).', 'Write how many of each item move. Part of a group becomes an item of its own, the same label with a letter (A stays, B moves).', 'Écrivez combien de chaque objet partent. Une partie d’un groupe devient un objet, la même étiquette avec une lettre (A reste, B part).')}</p>
      <table className="t"><tbody>{items.map((i) => (
        <tr key={i.id}>
          <td className="mono">{i.code}</td><td>{i.name}</td><td className="muted">/ {i.qty}</td>
          <td style={{ width: 90 }}><input className={`inp${tooMany.includes(i) ? ' bad' : ''}`} type="number" min={0} max={i.qty} value={qty[i.id] ?? ''} placeholder="0" onFocus={(e) => e.target.select()} onChange={(e) => setQty((x) => ({ ...x, [i.id]: e.target.value }))} /></td>
          <td>{i.qty > 1 && <button className="btn small ghost" onClick={() => setQty((x) => ({ ...x, [i.id]: String(i.qty) }))}>{L('الكل', 'All', 'Tout')}</button>}</td>
        </tr>
      ))}</tbody></table>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{L('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={busy || to == null || !chosen.length} onClick={() => void save()}>{L('انقل', 'Move', 'Déplacer')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- an item

function ItemPage({ inv, cal, itemId, go, back, refresh }: { inv: InvData; cal: CalData | null; itemId: number; go: (x: Screen) => void; back: () => void; refresh: () => Promise<void> }) {
  const { d } = useApp();
  const er = useEntries();
  const r = inv.rights;
  const [edit, setEdit] = useState(false);
  const [moving, setMoving] = useState(false);
  const item = inv.items.find((i) => i.id === itemId);
  if (!item) return <p className="muted">{L('الغرض غير موجود', 'Item not found', 'Objet introuvable')} · <button className="btn small" onClick={back}>‹</button></p>;
  const sp = spaceOfPlace(inv.spaces, item.place_id);
  const cat = inv.categories.find((c) => c.id === item.category_id);
  const asks = itemAsks(item, inv.categories, inv.photos);
  // its history, and the history of the group it was split from (before the split)
  const chain: InvItem[] = [];
  for (let x: InvItem | undefined = item; x; x = x.split_from ? inv.items.find((y) => y.id === x!.split_from) : undefined) { chain.push(x); if (chain.length > 20) break; }
  const history = inv.moves.filter((mv) => chain.some((c) => c.id === mv.item_id)).filter((mv) => mv.item_id === item.id || !item.split_from || mv.at <= item.created_at).sort((a, b) => (b.on_date.localeCompare(a.on_date) || b.id - a.id));
  const parts = inv.items.filter((i) => i.id !== item.id && groupOf(i.code).toLowerCase() === groupOf(item.code).toLowerCase() && i.code !== item.code);
  // the books
  const entry = item.trx_id ? er.rows.find((x) => x.id === item.trx_id) : undefined;
  const supplier = item.party_id != null ? d.lists.parties.find((p) => p.id === item.party_id)?.name : null;
  const line = entry?.line_id != null ? d.lists.lines.find((l) => l.id === entry.line_id) : null;
  const heading = entry?.heading_id != null ? d.lists.headings.find((h) => h.id === entry.heading_id) : null;
  // the calendar: the bookings to come that ask for equipment of this name
  const today = todayIso();
  const asked = (() => {
    if (!cal) return [];
    const eq = cal.equip.filter((e) => e.name.trim().toLowerCase() === item.name.trim().toLowerCase()).map((e) => e.id);
    if (!eq.length) return [];
    const ids = new Set(cal.needs.filter((n) => eq.includes(n.equip_id)).map((n) => n.booking_id));
    const out: { day: string; name: string; time: string | null; id: number }[] = [];
    for (const [day, xs] of itemsBetween(cal, today, addDays(today, 60))) for (const x of xs) if (ids.has(x.b.id)) out.push({ day, name: x.b.group_name, time: x.b.time_from ? hm(x.occ.from) : null, id: x.b.id });
    return out.sort((a, b) => a.day.localeCompare(b.day)).slice(0, 6);
  })();
  const label = async () => { try { await saveFile(`label_${item.code}.pdf`, ['pdf'], await labelsPdf(labelsOf(inv, [item]), inv.prefix), t('احفظ الملصق', 'Save the label')); } catch (e) { toast(errText(e), true); } };

  return (
    <>
      <div className="cal-bar row" style={{ marginBottom: 10 }}>
        <button className="btn small" onClick={() => (sp ? go({ k: 'space', id: sp.id }) : back())}>‹ {sp ? sp.name : L('الخريطة', 'Map', 'Plan')}</button>
        <h2 style={{ margin: 0 }}>{item.name}{item.qty > 1 ? ` ×${item.qty}` : ''} · <span className="mono">{item.code}</span></h2>
        {cat && <span className="muted">{biName(cat.name)}</span>}
        <span style={{ flex: 1 }} />
        {r.keep && inUse(item) && <button className="btn" onClick={() => setMoving(true)}>↪ {L('انقل', 'Move', 'Déplacer')}</button>}
        {r.keep && <button className="btn" onClick={() => setEdit(true)}>✎ {L('غيّر', 'Change', 'Modifier')}</button>}
        <button className="btn" onClick={() => void label()}>🏷 {L('ملصق', 'Label', 'Étiquette')}</button>
      </div>
      {!inUse(item) && <p className="bad small">{item.status === 'lost' ? L('مفقود', 'Lost', 'Perdu') : L('أُخرج من الجرد', 'Taken out of the inventory', 'Sorti de l’inventaire')} · {fmtDate(item.disposed_on)} · {item.disposed_why}</p>}
      {r.keep && asks.length > 0 && <p className="small" style={{ color: 'var(--warn)' }}>⚠ {L('غرض ثمين: ينقصه', 'Valuable item, still missing:', 'Objet de valeur, il manque :')} {asks.map((a) => (a === 'photo' ? L('صورة', 'a photo', 'une photo') : L('رقم تسلسلي', 'the serial number', 'le n° de série'))).join(' · ')}</p>}
      <div className="inv-two">
        <div>
          <Photos item={item} inv={inv} manage={r.keep && inUse(item)} refresh={refresh} />
          <ul className="inv-facts" style={{ marginTop: 12 }}>
            <li><span>{L('المكان', 'Space', 'Espace')}</span>{placeText(inv, item.place_id) || '—'}</li>
            {item.holder && <li><span>{L('مع', 'With', 'Chez')}</span>{item.holder}</li>}
            {(item.brand || item.model) && <li><span>{L('الماركة · الطراز', 'Brand · model', 'Marque · modèle')}</span>{[item.brand, item.model].filter(Boolean).join(' ')}</li>}
            {item.serial && <li><span>{L('الرقم التسلسلي', 'Serial', 'N° de série')}</span><span className="mono">{item.serial}</span></li>}
            <li><span>{L('الحالة', 'State', 'État')}</span><span className={item.condition === 'good' ? '' : 'bad'}>{COND_LABEL[item.condition]()}</span></li>
            {r.values && <li><span>{L('القيمة', 'Value', 'Valeur')}</span>{item.value_usd != null ? `${fmtUsd(item.value_usd)}${item.qty > 1 ? ` × ${item.qty} = ${fmtUsd(itemTotal(item))}` : ''} ${item.trx_id ? L('(من الشراء)', '(from the purchase)', '(de l’achat)') : item.value_note ? `(${item.value_note})` : L('(مقدَّرة)', '(estimated)', '(estimée)')}` : '—'}</li>}
            <li><span>{L('الأصل', 'Origin', 'Origine')}</span>{biName(inv.origins.find((o) => o.id === item.origin_id)?.name ?? item.origin)}{item.acquired_on ? ` · ${fmtDate(item.acquired_on)}` : ''}</li>
            {item.note && <li><span>{L('ملاحظة', 'Note', 'Note')}</span>{item.note}</li>}
            {parts.length > 0 && <li><span>{L('أجزاء المجموعة', 'Parts of the group', 'Parties du groupe')}</span><div>{parts.map((p) => <button key={p.id} className="btn ghost small" onClick={() => go({ k: 'item', id: p.id })}>{p.code} ×{p.qty} · {placeText(inv, p.place_id)}</button>)}</div></li>}
          </ul>
          <div className="inv-links">
            <div className="inv-lk fin">
              <b>💵 {L('الحسابات', 'The books', 'Les comptes')}</b>
              {item.trx_id ? (entry ? <>
                {L('اشتُري', 'Bought', 'Acheté')} {fmtDate(entry.date)} · {L('الفاتورة', 'bill', 'facture')} <span className="mono">{er.bill(entry.id)}</span>
                {supplier ? <> · {supplier}</> : null}
                {(heading || line) && <div>{[heading?.name, line?.name].filter(Boolean).join(' › ')}</div>}
                {r.values && <div>{fmtUsd(er.usd(entry.id))} {L('للقيد كله', 'for the whole entry', 'pour toute l’écriture')}</div>}
              </> : L('مشترى بقيد في السجل', 'Bought by an entry of the register', 'Acheté par une écriture du registre')) : L('ليس من شراء في السجل', 'Not from a purchase of the register', 'Pas d’un achat du registre')}
            </div>
            <div className="inv-lk cal">
              <b>📅 {L('التقويم', 'The calendar', 'Le calendrier')}</b>
              {!cal ? L('لمن يرى التقويم', 'For who sees the calendar', 'Pour qui voit le calendrier')
                : asked.length ? asked.map((x) => <div key={`${x.id}-${x.day}`}>{fmtDate(x.day)}{x.time ? ` ${x.time}` : ''} · {x.name}</div>)
                : L('لا حجز قادم يطلبه', 'No booking to come asks for it', 'Aucune réservation à venir ne le demande')}
              {cat?.in_calendar ? <div className="small">{L('يظهر «دائماً في المكان»', 'Shown as "always in the room"', 'Affiché « toujours dans la salle »')}</div> : null}
            </div>
          </div>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>{L('السجل', 'History', 'Historique')}</div>
          <ul className="inv-tl">{history.map((h) => (
            <li key={h.id}><b>{(MOVE_LABEL[h.kind] ?? (() => h.kind))()}{h.item_id !== item.id ? ` · ${inv.items.find((x) => x.id === h.item_id)?.code ?? ''}` : ''}</b>
              <small>{fmtDate(h.on_date)}{h.place_id ? ` · ${placeText(inv, h.place_id)}` : ''}{h.holder ? ` · ${h.holder}` : ''}{h.note ? ` · ${h.note}` : ''}{h.who ? ` · ${h.who}` : ''}</small></li>
          ))}</ul>
        </div>
      </div>
      {edit && <ItemModal inv={inv} item={item} manage={r.keep} onClose={() => setEdit(false)} refresh={refresh} />}
      {moving && <MoveModal inv={inv} items={[item]} from={sp} onClose={() => setMoving(false)} refresh={refresh} />}
    </>
  );
}
