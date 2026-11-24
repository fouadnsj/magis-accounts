// Quick add in the new inventory (Fouad's first test, 23 November 2026, inventory comment 1): the table of the 0.12
// inventory (Enter = the next row, the common names, the origin, blank labels, the Excel template), brought to the map.
// From a space, the space is already chosen and the table opens with the usual items of its kind (a bedroom: bed,
// cupboard…), the quantity empty: the keeper types the numbers and saves once; a row left empty or at 0 is skipped.
// From the map's home, the space is chosen on each row. The category ticks apply: "serial number" shows the serial box,
// "valuable" says that a photo and a label are still to add. The ready lists are edited in the inventory's settings.
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useApp } from '../state';
import { Select, biName, errText, toast, type Option } from './kit';
import { getLang, m, tx } from '../i18n';
import { COMMON_ITEMS, commonName, type InvData } from '../inventory/inv';
import { QUICK_MAX, quickBadQty, quickInRooms, quickRooms, quickToSave, readyOf, type MapKind, type MapSpace, type QuickRow } from '../inventory/map';
import { blankLabels, invTemplate } from './Inventory';

const L = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));
const num = (x: string) => { const n = Number(x.replace(',', '.')); return x.trim() === '' || !Number.isFinite(n) ? null : n; };
const catOptions = (inv: InvData): Option[] => inv.categories.filter((c) => c.active).map((c) => ({ value: c.id, label: biName(c.name) }));

interface Row extends QuickRow { key: number; ready: boolean }
let nextKey = 1;
const blankRow = (from?: Partial<QuickRow>): Row => ({ key: nextKey++, ready: false, name: '', category_id: from?.category_id ?? null, place_id: from?.place_id ?? null, qty: '', serial: '', value: '' });

/** the category an item of this name already has in the centre (the latest one), when the ready list gives none */
const usualCategory = (inv: InvData, name: string) => {
  const n = name.trim().toLowerCase();
  return [...inv.items].reverse().find((i) => i.name.trim().toLowerCase() === n && i.category_id != null)?.category_id ?? null;
};

export function QuickAddRoom({ inv, space, back, refresh }: { inv: InvData; space: MapSpace | null; back: () => void; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const lang = getLang();
  const start = (sp: MapSpace | null): Row[] => {
    if (!sp) return Array.from({ length: 8 }, () => blankRow());
    const ready = readyOf(sp, inv.ready).map((r): Row => {
      const name = commonName(r.name, lang);
      return { ...blankRow({ place_id: sp.place_id }), ready: true, name, category_id: r.category_id ?? usualCategory(inv, name) };
    });
    return [...ready, ...Array.from({ length: ready.length ? 3 : 8 }, () => blankRow({ place_id: sp.place_id }))];
  };
  // the room being filled: it changes with "Record and next room"; the other rooms ticked get the same list ("Same in several rooms")
  const [cur, setCur] = useState<MapSpace | null>(space);
  const [ticked, setTicked] = useState<number[]>([]);
  const [saved, setSaved] = useState(0);
  const [rows, setRows] = useState<Row[]>(() => start(space));
  const [origin, setOrigin] = useState<number | null>(inv.origins.find((o) => !o.bought && o.active && /old|قديم/i.test(o.name))?.id ?? inv.origins.find((o) => !o.bought && o.active)?.id ?? null);
  const [busy, setBusy] = useState(false);
  const cat = useMemo(() => new Map(inv.categories.map((c) => [c.id, c])), [inv.categories]);
  const names = useMemo(() => [...new Set([...COMMON_ITEMS.map((c) => commonName(c.en, lang)), ...inv.items.map((i) => i.name)])], [inv.items, lang]);
  const spaces = inv.areas.filter((a) => a.active).map((a) => ({ a, list: inv.spaces.filter((x) => x.building_id === a.id && x.active && x.place_id != null) })).filter((x) => x.list.length);
  const kind: MapKind | undefined = cur?.kind_id != null ? inv.kinds.find((k) => k.id === cur.kind_id) : undefined;
  const bad = rows.filter(quickBadQty);
  const values = inv.rights.values;
  // room after room: the rooms of the same area and kind, in the map's order
  const walk = cur ? quickRooms(cur, inv.spaces) : [];
  const at = cur ? walk.findIndex((x) => x.id === cur.id) : -1;
  const next = at >= 0 ? walk[at + 1] ?? null : null;
  // the same list in several rooms: the spaces of the same kind (any area); a space without a kind: the spaces of its own area without a kind
  const sameKind = cur ? inv.spaces.filter((x) => x.id !== cur.id && x.active && x.place_id != null && (cur.kind_id != null ? x.kind_id === cur.kind_id : x.building_id === cur.building_id && x.kind_id == null)) : [];
  const sameByArea = inv.areas.map((a) => ({ a, list: sameKind.filter((x) => x.building_id === a.id).sort((p, q) => p.sort - q.sort || p.id - q.id) })).filter((g) => g.list.length);
  const tickedSpaces = sameKind.filter((x) => ticked.includes(x.id));
  const multi = tickedSpaces.length > 0;
  const askSerial = (id: number | null) => id != null && !!cat.get(id)?.serial;
  const many = cur ? quickInRooms(rows, [cur.place_id!, ...tickedSpaces.map((x) => x.place_id!)], askSerial) : null;
  const toSave = many ? many.items : quickToSave(rows);
  const skipped = many ? many.skipped : [];
  const counted = quickToSave(rows).filter((r) => !skipped.includes(r));

  const set = (key: number, p: Partial<Row>) => setRows((xs) => xs.map((r) => {
    if (r.key !== key) return r;
    const n = { ...r, ...p };
    // a row typed by hand (not from the ready list) counts one when the name is written and no number yet
    if (p.name !== undefined && !r.ready && !r.name.trim() && p.name.trim() && r.qty === '') n.qty = '1';
    if (p.name !== undefined && n.category_id == null) n.category_id = usualCategory(inv, p.name);
    return n;
  }));
  // Enter: the same box of the next row (a new row after the last, with the same category and space)
  const enter = (e: KeyboardEvent<HTMLElement>, i: number, col: string) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const tbody = (e.currentTarget as HTMLElement).closest('tbody');
    const box = (k: number) => tbody?.querySelectorAll(`[data-col="${col}"]`)[k] as HTMLElement | undefined;
    // the next row is there: at once (what is typed next goes into it); after the last one, a new row first
    if (i < rows.length - 1) box(i + 1)?.focus();
    else { setRows((xs) => [...xs, blankRow(xs[xs.length - 1])]); setTimeout(() => box(i + 1)?.focus(), 30); }
  };
  const save = async (goNext: boolean) => {
    if (bad.length) return toast(L('عدد غير صحيح في بعض الأسطر (عدد كامل فقط).', 'Some rows have a number that is not right (whole numbers only).', 'Certaines lignes ont un nombre incorrect (nombres entiers seulement).'), true);
    if (!toSave.length) return;
    if (toSave.length > QUICK_MAX) return toast(L(`أكثر من ${QUICK_MAX} غرضاً دفعة واحدة: قلّل الأماكن أو الأسطر.`, `More than ${QUICK_MAX} items in one go: tick fewer rooms or write fewer rows.`, `Plus de ${QUICK_MAX} objets d’un coup : cochez moins de pièces ou écrivez moins de lignes.`), true);
    setBusy(true);
    try {
      const r = await s.api.call('inv.item.many', {
        origin_id: origin,
        items: toSave.map((x) => ({ name: x.name.trim(), category_id: x.category_id, place_id: x.place_id, qty: Number(x.qty), serial: x.category_id != null && cat.get(x.category_id)?.serial ? x.serial : '', value_usd: values ? num(x.value) : null })),
      }) as { ids: number[] };
      await refresh();
      const rooms = 1 + tickedSpaces.length;
      toast(`${r.ids.length} ${L('غرضاً سُجّل ✓', 'items recorded ✓', 'objets enregistrés ✓')}${rooms > 1 ? ` · ${rooms} ${L('أماكن', 'rooms', 'pièces')}` : ''}${skipped.length ? ` · ${L('لم يُنسخ (رقم تسلسلي)', 'not copied (serial number)', 'non copié (n° de série)')}: ${skipped.map((x) => x.name.trim()).join('، ')}` : ''}`);
      if (cur && goNext && next && !multi) { setSaved((n) => n + 1); goTo(next); }
      else if (cur) back();
      else setRows(Array.from({ length: 8 }, () => blankRow(toSave[toSave.length - 1])));
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  /** open another room of the walk with its ready list (the numbers empty); the origin stays as chosen */
  const goTo = (sp: MapSpace) => { setCur(sp); setTicked([]); setRows(start(sp)); };

  return (
    <>
      <div className="cal-bar row" style={{ marginBottom: 10 }}>
        <button className="btn small" onClick={back}>‹ {space ? space.name : L('الخريطة', 'Map', 'Plan')}</button>
        <h2 style={{ margin: 0 }}>⚡ {L('تسجيل سريع', 'Quick add', 'Ajout rapide')}{cur ? ` · ${cur.name}` : ''}</h2>
        {kind && <span className="muted">{biName(kind.name)}</span>}
        {at >= 0 && walk.length > 1 && <span className="muted small">· {L(`المكان ${at + 1} من ${walk.length}`, `room ${at + 1} of ${walk.length}`, `pièce ${at + 1} sur ${walk.length}`)}</span>}
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        {cur
          ? L('الأغراض المعتادة لهذا النوع من الأماكن جاهزة: اكتب العدد فقط، ثم سجّل مرة واحدة. السطر الفارغ أو بالعدد 0 لا يُسجَّل. Enter ينقلك إلى السطر التالي.', 'The usual items of this kind of space are ready: write only how many, then record once. A row left empty or at 0 is skipped. Enter goes to the next row.', 'Les objets habituels de ce type d’espace sont prêts : écrivez seulement combien, puis enregistrez une fois. Une ligne vide ou à 0 est ignorée. Entrée passe à la ligne suivante.')
          : L('سطر لكل غرض أو لكل مجموعة (20 كرسياً = العدد 20)، والمكان في كل سطر. Enter ينقلك إلى السطر التالي.', 'One row per object or per group (20 chairs = Qty 20), the space on each row. Enter goes to the next row.', 'Une ligne par objet ou par groupe (20 chaises = Qté 20), l’espace sur chaque ligne. Entrée passe à la ligne suivante.')}
        {cur && !readyOf(cur, inv.ready).length && <> {L('لا قائمة جاهزة لهذا النوع بعد (إعدادات الجرد).', 'No ready list for this kind yet (the inventory\'s settings).', 'Pas encore de liste prête pour ce type (réglages de l’inventaire).')}</>}
      </p>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small">{L('المصدر', 'Origin', 'Origine')}:</span>
        <Select value={origin} options={inv.origins.filter((o) => !o.bought && o.active).map((o) => ({ value: o.id, label: biName(o.name) }))} onChange={setOrigin} />
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => void blankLabels(inv)}>🏷 {L('ملصقات فارغة مرقّمة', 'Blank numbered labels', 'Étiquettes vierges numérotées')}</button>
        <button className="btn small" onClick={() => void invTemplate(inv)}>⬇ {L('قالب Excel', 'Excel template', 'Modèle Excel')}</button>
      </div>
      {cur && sameKind.length > 0 && (
        <details className="panel" style={{ margin: '0 0 8px' }} open={multi}>
          <summary><b>{L('نفس القائمة في عدة أماكن', 'Same in several rooms', 'Pareil dans plusieurs pièces')}</b> <span className="muted small">{multi ? `· ${1 + tickedSpaces.length} ${L('أماكن', 'rooms', 'pièces')}` : `· ${L('اختياري', 'optional', 'facultatif')}`}</span></summary>
          <p className="muted small" style={{ margin: '4px 0' }}>{L('ما تكتبه مرة واحدة يُسجَّل في كل مكان تؤشّر عليه، دفعة واحدة (كلها أو لا شيء).', 'What you write once is recorded in each room you tick, all in one go (all of them or none).', 'Ce que vous écrivez une fois est enregistré dans chaque pièce cochée, d’un coup (toutes ou aucune).')}</p>
          <div className="row" style={{ marginBottom: 4 }}>
            <label className="small"><input type="checkbox" checked disabled /> {cur.name} <span className="muted">({L('هذا المكان', 'this one', 'celle-ci')})</span></label>
            <span style={{ flex: 1 }} />
            <button className="btn small" onClick={() => setTicked(sameKind.map((x) => x.id))}>{L('كل', 'Select all', 'Tout cocher')}{kind ? ` · ${biName(kind.name)}` : ''}</button>
            <button className="btn small" disabled={!multi} onClick={() => setTicked([])}>{L('هذا المكان فقط', 'Only this room', 'Cette pièce seule')}</button>
          </div>
          {sameByArea.map(({ a, list }) => (
            <div key={a.id} className="row small" style={{ flexWrap: 'wrap', gap: '4px 14px', marginBottom: 2 }}>
              {sameByArea.length > 1 && <b>{biName(a.name)}:</b>}
              {list.map((x) => <label key={x.id}><input type="checkbox" checked={ticked.includes(x.id)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, x.id] : t.filter((i) => i !== x.id)))} /> {x.name}</label>)}
            </div>
          ))}
        </details>
      )}
      <datalist id="inv-quick-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="table-wrap"><table className="t inv-quick">
        <thead><tr>
          <th>{L('الغرض', 'Item', 'Objet')}</th><th>{L('الصنف', 'Category', 'Catégorie')}</th>{!space && <th>{L('المكان', 'Space', 'Espace')}</th>}
          <th className="num">{L('العدد', 'Qty', 'Qté')}</th><th>{L('الرقم التسلسلي', 'Serial', 'N° de série')}</th>{values && <th className="num">{L('قيمة الوحدة $', 'Unit value $', 'Valeur unité $')}</th>}<th />
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const c = r.category_id != null ? cat.get(r.category_id) : undefined;
            const isCounted = counted.includes(r);
            return (
              <tr key={r.key} className={r.ready && !isCounted ? 'muted' : ''}>
                <td><input className="inp" data-col="name" list="inv-quick-names" value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} onKeyDown={(e) => enter(e, i, 'name')} /></td>
                <td><Select value={r.category_id} options={catOptions(inv)} onChange={(v) => set(r.key, { category_id: v })} /></td>
                {!space && <td>
                  <select data-col="space" value={r.place_id ?? ''} onChange={(e) => set(r.key, { place_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">{L('اختر…', 'Choose…', 'Choisir…')}</option>
                    {spaces.map(({ a, list }) => <optgroup key={a.id} label={biName(a.name)}>{list.map((x) => <option key={x.id} value={x.place_id!}>{x.name}</option>)}</optgroup>)}
                  </select>
                </td>}
                <td className="num"><input className={`inp${quickBadQty(r) ? ' bad' : ''}`} data-col="qty" style={{ width: 70 }} inputMode="numeric" placeholder="0" value={r.qty} onFocus={(e) => e.target.select()} onChange={(e) => set(r.key, { qty: e.target.value.trim() })} onKeyDown={(e) => enter(e, i, 'qty')} /></td>
                <td>{c?.serial ? <input className={`inp need${!r.serial.trim() && Number(r.qty) === 1 ? ' bad' : ''}`} data-col="serial" style={{ direction: 'ltr' }} placeholder={L('حاسوب واحد لكل سطر', 'one row per laptop', 'une ligne par ordinateur')} value={r.serial} onChange={(e) => set(r.key, { serial: e.target.value })} onKeyDown={(e) => enter(e, i, 'serial')} /> : null}</td>
                {values && <td className="num"><input className="inp" data-col="value" style={{ width: 90 }} inputMode="decimal" value={r.value} onChange={(e) => set(r.key, { value: e.target.value })} onKeyDown={(e) => enter(e, i, 'value')} /></td>}
                <td className="small">{skipped.includes(r) ? <span className="inv-dot e" title={L('رقم تسلسلي واحد لا يُنسخ إلى عدة أماكن', 'One serial number cannot be copied to several rooms', 'Un numéro de série ne se copie pas dans plusieurs pièces')}>⛔</span> : c?.valuable && r.name.trim() ? <span className="inv-dot w" title={L('غرض ثمين: تُطلب صورة وملصق لاحقاً', 'Valuable: a photo and a label to add later', 'Objet de valeur : photo et étiquette à ajouter')}>📷🏷</span> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {rows.some((r) => r.name.trim() && r.category_id != null && cat.get(r.category_id)?.valuable) && <p className="small muted" style={{ margin: '6px 0 0' }}>📷🏷 {L('غرض ثمين: تُطلب له صورة وملصق لاحقاً (من صفحة الغرض).', 'valuable: a photo and a label are asked for later (on the item\'s page).', 'objet de valeur : photo et étiquette demandées plus tard (sur la page de l’objet).')}</p>}
      {skipped.length > 0 && <p className="small" style={{ margin: '6px 0 0', color: 'var(--bad, #b3261e)' }}>⛔ {L(`«${skipped.map((x) => x.name.trim()).join('، ')}» يحتاج رقماً تسلسلياً خاصاً في كل مكان، فلن يُسجَّل هنا. سجّله في كل مكان على حدة (أزل التأشير عن الأماكن الأخرى)، أو اتركه.`, `“${skipped.map((x) => x.name.trim()).join('”, “')}” needs its own serial number in each room, so it is skipped here. Record it room by room (untick the other rooms), or leave it out.`, `« ${skipped.map((x) => x.name.trim()).join(' », « ')} » demande son propre n° de série dans chaque pièce : ignoré ici. Enregistrez-le pièce par pièce (décochez les autres), ou laissez-le.`)}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => setRows((xs) => [...xs, ...Array.from({ length: 5 }, () => blankRow(xs[xs.length - 1]))])}>＋ {L('5 أسطر', '5 rows', '5 lignes')}</button>
        <span style={{ flex: 1 }} />
        {cur && <button className="btn" onClick={back}>{saved > 0 ? L('انتهيت', 'Done', 'Terminé') : L('إلغاء', 'Cancel', 'Annuler')}</button>}
        {cur && next && !multi && (
          toSave.length
            ? <button className="btn" disabled={busy} onClick={() => void save(true)}>{L('سجّل والمكان التالي', 'Record and next room', 'Enregistrer et pièce suivante')} ›</button>
            : <button className="btn" onClick={() => { setSaved((n) => n + 1); goTo(next); }}>{L('المكان التالي', 'Next room', 'Pièce suivante')} ›</button>
        )}
        <button className="btn primary" disabled={busy || !toSave.length} onClick={() => void save(false)}>
          {multi ? `${L('سجّل في', 'Record in', 'Enregistrer dans')} ${1 + tickedSpaces.length} ${L('أماكن', 'rooms', 'pièces')}` : `${L('سجّل', 'Record', 'Enregistrer')} ${toSave.length || ''}`}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- the ready lists (in the inventory's settings)

/** The usual items of each kind of space: the Quick add of a space opens with them. */
export function ReadyLists({ inv, refresh }: { inv: InvData; refresh: () => Promise<void> }) {
  const lang = getLang();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="panel">
      <b>{L('القوائم الجاهزة حسب نوع المكان', 'Ready lists by kind of space', 'Listes prêtes par type d’espace')}</b>
      <p className="muted small" style={{ margin: '4px 0 8px' }}>{L('«تسجيل سريع» في مكان يفتح بأغراض نوعه المعتادة، والعدد فارغ. غيّر القوائم كما تشاء. (أنواع الأماكن تُدار في إعدادات التقويم.)', 'The Quick add of a space opens with the usual items of its kind, the number empty. Change the lists as you like. (The kinds of space are managed in the calendar\'s settings.)', 'L’ajout rapide d’un espace s’ouvre avec les objets habituels de son type, le nombre vide. Modifiez les listes à votre gré. (Les types d’espace se gèrent dans les réglages du calendrier.)')}</p>
      {inv.kinds.filter((k) => k.active).map((k) => {
        const list = inv.ready.filter((r) => r.kind_id === k.id).sort((a, b) => a.sort - b.sort || a.id - b.id);
        const used = inv.spaces.filter((x) => x.kind_id === k.id && x.active).length;
        return (
          <details key={k.id} open={open === k.id} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpen(k.id); else if (open === k.id) setOpen(null); }}>
            <summary><b>{biName(k.name)}</b> <span className="muted small">({used} {L('مكاناً', 'spaces', 'espaces')}) · {list.length ? list.map((r) => commonName(r.name, lang)).join('، ') : '—'}</span></summary>
            {open === k.id && <ReadyEditor inv={inv} kind={k} list={list} refresh={refresh} />}
          </details>
        );
      })}
    </div>
  );
}

function ReadyEditor({ inv, kind, list, refresh }: { inv: InvData; kind: MapKind; list: InvData['ready']; refresh: () => Promise<void> }) {
  const { s } = useApp();
  const lang = getLang();
  const [rows, setRows] = useState(() => list.map((r) => ({ name: commonName(r.name, lang), category_id: r.category_id })));
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const names = [...new Set([...COMMON_ITEMS.map((c) => commonName(c.en, lang)), ...inv.items.map((i) => i.name)])];
  const changed = JSON.stringify(rows) !== JSON.stringify(list.map((r) => ({ name: commonName(r.name, lang), category_id: r.category_id })));
  const push = () => {
    const n = add.trim();
    if (!n || rows.some((r) => r.name.trim().toLowerCase() === n.toLowerCase())) { setAdd(''); return; }
    setRows((xs) => [...xs, { name: n, category_id: usualCategory(inv, n) }]);
    setAdd('');
  };
  const move = (i: number, d: number) => setRows((xs) => { const j = i + d; if (j < 0 || j >= xs.length) return xs; const n = [...xs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const save = async () => {
    setBusy(true);
    try { await s.api.call('inv.ready.save', { kind_id: kind.id, items: rows }); await refresh(); toast(L('حُفظت القائمة ✓', 'List saved ✓', 'Liste enregistrée ✓')); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  return (
    <div style={{ padding: '6px 0 10px', paddingInlineStart: 18 }}>
      <table className="t small"><tbody>
        {rows.map((r, i) => (
          <tr key={`${i}-${r.name}`}>
            <td style={{ width: 54 }}><button className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button className="btn ghost small" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button></td>
            <td>{r.name}</td>
            <td><Select value={r.category_id} options={catOptions(inv)} onChange={(v) => setRows((xs) => xs.map((x, k) => (k === i ? { ...x, category_id: v } : x)))} placeholder={L('بلا صنف', 'No category', 'Sans catégorie')} /></td>
            <td style={{ width: 30 }}><button className="btn ghost small" onClick={() => setRows((xs) => xs.filter((_, k) => k !== i))}>✕</button></td>
          </tr>
        ))}
        {!rows.length && <tr><td className="muted">{L('القائمة فارغة', 'The list is empty', 'La liste est vide')}</td></tr>}
      </tbody></table>
      <div className="row" style={{ marginTop: 6 }}>
        <input className="inp" style={{ maxWidth: 220 }} list="inv-ready-names" placeholder={L('أضف غرضاً…', 'Add an item…', 'Ajouter un objet…')} value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); push(); } }} />
        <datalist id="inv-ready-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <button className="btn small" disabled={!add.trim()} onClick={push}>＋</button>
        <span style={{ flex: 1 }} />
        <button className="btn primary small" disabled={busy || !changed} onClick={() => void save()}>{L('احفظ القائمة', 'Save the list', 'Enregistrer la liste')}</button>
      </div>
    </div>
  );
}
