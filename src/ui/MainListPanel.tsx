// Coordinator → Budget lists (Fouad, 2026-11-03; moved out of Homs, 2026-11-07): the main list of headings and lines, kept on this server by the administrator.
// He changes a draft (drag a line or a heading, add, rename, switch off, merge); the codes do not change until
// "Renumber"; "Publish to this server" then gives it to every centre here (each is backed up first, and its rows follow
// their lines). The servers of the other cities take it as a file: there it is only read.
import { useEffect, useRef, useState } from 'react';
import { mainListApi, type ListSummary, type MainListInfo, type MainResult } from '../net';
import { checkMainList, inOrder, listId, MAIN_REQUESTS, newUid, parseMainList, parseRequests, PREFIX, renumber, type MainHeading, type MainLine, type MainList, type MainRequest } from '../io/mainList';
import type { TrxType } from '../domain/types';
import { pickFile, saveFile } from '../platform';
import { Modal, confirmBox, errText, fmtDate, promptBox, t, toast } from './kit';

const TYPES: { v: TrxType; ar: string; en: string }[] = [
  { v: 'Exp', ar: 'نفقة', en: 'Expense' }, { v: 'Income', ar: 'إيراد', en: 'Income' },
  { v: 'Transfer', ar: 'تحويل', en: 'Transfer' }, { v: 'Exchange', ar: 'تصريف', en: 'Exchange' },
];
const typeName = (x: TrxType) => { const y = TYPES.find((z) => z.v === x)!; return t(y.ar, y.en); };
const lower = (x: string) => x.trim().toLowerCase();
/** the draft and the published list say the same (the version and dates aside) */
const same = (a: MainList | null, b: MainList | null) => !!a && !!b && JSON.stringify([a.headings, a.lines, a.merged]) === JSON.stringify([b.headings, b.lines, b.merged]);
const results = (r: MainResult) => r.centres.map((c) => `${c.organisation}: ${c.renamed} ${t('اسماً أو رمزاً', 'renamed')}, ${c.moved} ${t('نُقل', 'moved')}, ${c.merged} ${t('دُمج', 'merged')}`).join(' · ');

/** Lists → Budget sends the administrator here ("Change it in the main list"): Admin opens on this tab. */
let wish = false;
/** the heading or line to show there */
let focus: string | null = null;
export const wishMainList = (uid?: string | null) => { wish = true; focus = uid ?? null; };
export const takeMainListWish = () => { const w = wish; wish = false; return w; };

/**
 * Coordinator → Budget lists (Fouad, 2026-11-07): several lists, one per kind of project (Centres, Centres by activity 2027,
 * Building…). Each database follows one of them (chosen when it is created). Pick a list to change it; ＋ New list
 * starts one empty, as a copy of another, from a list file (a template), or from this database's list.
 */
export function MainListPanel({ dbs, onReload }: {
  /** the centres' databases on this server (a new list can start from one of their lists) */
  dbs: { slug: string; organisation: string }[];
  /** after a publish: what the screens show again */
  onReload?: () => Promise<void>;
}) {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const load = async (pick?: string) => {
    try {
      const x = await mainListApi.lists();
      setAdmin(x.admin);
      setLists(x.lists);
      setSel((cur) => pick ?? cur ?? (x.lists.some((l) => l.id === x.mine) ? x.mine : x.lists[0]?.id ?? null));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  useEffect(() => { void load(); }, []);
  if (!lists) return <p className="muted">…</p>;
  if (!admin) return <p className="muted">{t('القوائم الرئيسية للمدير فقط.', 'The main lists are for the administrator only.')}</p>;
  const takeFile = async () => {
    try {
      const f = await pickFile(['json'], t('اختر ملف القائمة', 'Choose the list file'));
      if (!f) return;
      const list = parseMainList(new TextDecoder().decode(f.bytes));
      if (!(await confirmBox(t(`تأخذ النسخة ${list.version} من «${list.title ?? list.from ?? ''}» من خادم آخر. كل قاعدة تتبعها هنا تُنسخ احتياطياً ثم تتبعها.`, `This takes version ${list.version} of "${list.title ?? list.from ?? ''}" from another server. Each database here following it is backed up, then follows it.`)))) return;
      const r = await mainListApi.takeFile(list);
      await load(listId(list));
      await onReload?.();
      toast(`${t('أُخذت القائمة', 'The list was taken')} · ${results(r)}`);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div style={{ maxWidth: 980 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <b>{t('القوائم:', 'Lists:')}</b>
        {lists.map((l) => (
          <button key={l.id} className={`chip ${sel === l.id ? 'on' : ''}`} onClick={() => setSel(l.id)} title={l.centres.join(', ')}>
            {l.title}{l.version ? ` · v${l.version}` : ` · ${t('مسودة', 'draft')}`}{l.centres.length ? ` · ${l.centres.length} ${t('قاعدة', 'db')}` : ''}
          </button>
        ))}
        <button className="btn small" onClick={() => setMaking(true)}>＋ {t('قائمة جديدة…', 'New list…')}</button>
        <button className="btn small ghost" onClick={() => void takeFile()}>⬆ {t('خذ ملف قائمة من خادم آخر', 'Take a list file from another server')}</button>
      </div>
      {!lists.length && <p className="muted">{t('لا قائمة على هذا الخادم بعد. ابدأ الأولى (المراكز) من قائمة هذه القاعدة.', 'No list on this server yet. Start the first one (Centres) from the list of this database.')}</p>}
      {sel && lists.some((l) => l.id === sel) && <OneList key={sel} id={sel} onReload={onReload} title={lists.find((l) => l.id === sel)!.title} centres={lists.find((l) => l.id === sel)!.centres} onChanged={() => void load()} />}
      {making && <NewList lists={lists} dbs={dbs} first={!lists.length} onClose={() => setMaking(false)} onMade={(id) => { setMaking(false); void load(id); }} />}
    </div>
  );
}

/** ＋ New list: its name, and where it starts from. */
function NewList({ lists, dbs, first, onClose, onMade }: { lists: ListSummary[]; dbs: { slug: string; organisation: string }[]; first: boolean; onClose: () => void; onMade: (id: string) => void }) {
  const [title, setTitle] = useState(first ? 'Centres' : '');
  const [from, setFrom] = useState<'empty' | 'db' | 'list' | 'file'>(first ? 'db' : 'file');
  const [source, setSource] = useState(lists[0]?.id ?? '');
  const [dbSource, setDbSource] = useState(dbs.find((d) => /homs/i.test(d.organisation))?.slug ?? dbs[0]?.slug ?? '');
  const [file, setFile] = useState<MainList | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const r = await mainListApi.newList({ title: title.trim(), from, source: from === 'db' ? dbSource : source, list: file ?? undefined });
      toast(t('بدأت مسودة القائمة الجديدة', 'The draft of the new list has started'));
      onMade(r.id);
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  const opt = (v: typeof from, label: string) => (
    <label className="row" style={{ gap: 6 }}><input type="radio" checked={from === v} onChange={() => setFrom(v)} /> {label}</label>
  );
  return (
    <Modal title={t('قائمة جديدة', 'A new list')} onClose={onClose} narrow>
      <label className="small">{t('اسمها (مثلاً: المراكز حسب النشاط 2027، البناء، المزرعة)', 'Its name (e.g. Centres by activity 2027, Building, Farm)')}</label>
      <input className="inp" autoFocus style={{ width: '100%', marginBottom: 10 }} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ display: 'grid', gap: 6 }}>
        {opt('file', t('من ملف قائمة (نموذج)', 'From a list file (a template)'))}
        {from === 'file' && (
          <div style={{ paddingInlineStart: 24 }}>
            <button className="btn small" onClick={() => void (async () => {
              try {
                const f = await pickFile(['json'], t('اختر ملف القائمة', 'Choose the list file'));
                if (!f) return;
                const l = parseMainList(new TextDecoder().decode(f.bytes));
                setFile(l);
                if (!title.trim() && l.title) setTitle(l.title);
              } catch (e) {
                toast(errText(e), true);
              }
            })()}>⬆ {t('اختر الملف…', 'Choose the file…')}</button>
            {file && <span className="muted small"> {file.title ?? ''} · {file.headings.length} {t('بنداً', 'headings')}, {file.lines.length} {t('خطاً', 'lines')}</span>}
          </div>
        )}
        {lists.length > 0 && opt('list', t('نسخة من قائمة أخرى', 'A copy of another list'))}
        {from === 'list' && (
          <select className="inp" style={{ marginInlineStart: 24 }} value={source} onChange={(e) => setSource(e.target.value)}>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
          </select>
        )}
        {opt('db', dbs.length ? t('قائمة قاعدة مركز', "The list of a centre's database") : t('قائمة هذه القاعدة', 'The list of this database'))}
        {from === 'db' && (
          <select className="inp" style={{ marginInlineStart: 24 }} value={dbSource} onChange={(e) => setDbSource(e.target.value)}>
            {dbs.map((d) => <option key={d.slug} value={d.slug}>{d.organisation}</option>)}
          </select>
        )}
        {opt('empty', t('فارغة', 'Empty'))}
      </div>
      <p className="muted small">{t('تبدأ مسودة: رتّبها، ثم «انشر». عند إنشاء قاعدة جديدة تختار قائمتها.', 'It starts as a draft: arrange it, then "Publish". When you create a new database, you choose its list.')}</p>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy || !title.trim() || (from === 'file' && !file)} onClick={() => void make()}>{t('ابدأ', 'Start')}</button>
      </div>
    </Modal>
  );
}

/** One list: its draft, the requests asked of it, Renumber, Publish, its file. */
function OneList({ id, title, centres, onChanged, onReload }: { id: string; title: string; centres: string[]; onChanged: () => void; onReload?: () => Promise<void> }) {
  const [info, setInfo] = useState<MainListInfo | null>(null);
  const [draft, setDraft] = useState<MainList | null>(null);
  const [showOff, setShowOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState<{ kind: 'heading' | 'line'; uid: string } | null>(null);
  const drag = useRef<{ kind: 'heading' | 'line'; uid: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const load = async () => {
    try {
      const x = await mainListApi.get(id);
      setInfo(x);
      setDraft(x.draft ?? x.list);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  useEffect(() => { void load(); }, []);
  // sent from Lists → Budget: that heading or line, in view and marked
  const [mark, setMark] = useState<string | null>(null);
  useEffect(() => {
    if (!draft || !focus) return;
    const uid = focus;
    focus = null;
    // (shown even when it is switched off for everyone)
    if ([...draft.headings, ...draft.lines].some((x) => x.uid === uid && !x.active)) setShowOff(true);
    setMark(uid);
    setTimeout(() => document.getElementById(`ml-${uid}`)?.scrollIntoView({ block: 'center' }), 250);
  }, [draft]);
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    try {
      const msg = await f();
      if (msg) toast(msg);
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  /** every change is saved at once in the draft (nothing reaches the centres before "Publish") */
  const change = (next: MainList) => {
    try {
      checkMainList(next);
    } catch (e) {
      toast(errText(e), true);
      return;
    }
    setDraft(next);
    mainListApi.saveDraft(id, next).catch((e) => { toast(errText(e), true); void load(); });
  };
  const saveAsFile = () => run(async () => {
    const pub = info!.list!;
    const path = await saveFile(`list-${id}-v${pub.version}.json`, ['json'], new TextEncoder().encode(JSON.stringify(pub, null, 1)), t('احفظ القائمة الرئيسية', 'Save the main list'));
    return path ? `${t('حُفظ', 'Saved')}: ${path}` : null;
  });

  if (!info) return <p className="muted">…</p>;
  if (!info.admin) return <p className="muted">{t('القائمة الرئيسية للمدير فقط.', 'The main list is for the administrator only.')}</p>;

  const help = (
    <ul className="muted small" style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
      <li>{t('تعمل على مسودة: لا يصل شيء إلى المراكز قبل «انشر على هذا الخادم». الرموز لا تتغير حتى «أعد الترقيم».', 'You work on a draft: nothing reaches the centres before "Publish to this server". The codes do not change until "Renumber".')}</li>
      <li>{t('اسحب خطاً لتغيير ترتيبه أو لوضعه تحت بند آخر (أو استعمل ↑ ↓). اسحب بنداً لتغيير ترتيبه.', 'Drag a line to change its order or to put it under another heading (or use ↑ ↓). Drag a heading to change its order.')}</li>
      <li>{t('نقل خط أو دمجه ينقل قيوده القديمة معه في كل مركز، حتى في الأشهر المغلقة.', 'Moving or merging a line moves its old rows with it in every centre, even in closed months.')}</li>
      <li>{t('كل مركز يأخذ ما يحتاجه من القوائم ← الموازنة، ويوقف لنفسه ما لا يستعمله.', 'Each centre takes what it needs in Lists → Budget, and switches off for itself what it does not use.')}</li>
    </ul>
  );

  if (!draft) return <p className="muted">…</p>;

  const pub = info.list;
  const readOnly = !info.editable;
  const H = draft.headings;
  const L = draft.lines;
  const linesOf = (hu: string) => L.filter((l) => l.heading_uid === hu);
  const nextHeadingCode = (type: TrxType) => {
    const p = PREFIX[type];
    const used = new Set(H.map((h) => h.code));
    for (let i = 1; ; i++) { const c = `${p}${String(i).padStart(2, '0')}`; if (!used.has(c)) return c; }
  };
  const nextLineCode = (h: MainHeading) => {
    const used = new Set(L.map((l) => l.code));
    for (let i = 1; ; i++) { const c = `${h.code}.${i}`; if (!used.has(c)) return c; }
  };
  const put = (list: MainLine[], l: MainLine, before: string | null) => {
    const rest = list.filter((x) => x.uid !== l.uid);
    const at = before ? rest.findIndex((x) => x.uid === before) : -1;
    if (at < 0) {
      // at the end of its heading
      const last = rest.map((x) => x.heading_uid).lastIndexOf(l.heading_uid);
      rest.splice(last < 0 ? rest.length : last + 1, 0, l);
    } else rest.splice(at, 0, l);
    return rest;
  };
  const moveLine = (uid: string, toHeading: string, before: string | null) => {
    const l = L.find((x) => x.uid === uid)!;
    if (before === uid) return;
    if (l.heading_uid !== toHeading && linesOf(toHeading).some((x) => lower(x.name) === lower(l.name)))
      return toast(t(`«${l.name}» موجود في ذلك البند: ادمجه بدل نقله`, `"${l.name}" is already under that heading: merge it instead`), true);
    change({ ...draft, lines: put(L, { ...l, heading_uid: toHeading }, before) });
  };
  const moveHeading = (uid: string, before: string | null) => {
    if (before === uid) return;
    const h = H.find((x) => x.uid === uid)!;
    const rest = H.filter((x) => x.uid !== uid);
    const at = before ? rest.findIndex((x) => x.uid === before) : -1;
    rest.splice(at < 0 ? rest.length : at, 0, h);
    change({ ...draft, headings: rest });
  };
  const step = <X extends { uid: string },>(arr: X[], uid: string, d: -1 | 1, keep: (x: X) => boolean) => {
    const sib = arr.filter(keep);
    const i = sib.findIndex((x) => x.uid === uid);
    const j = i + d;
    if (j < 0 || j >= sib.length) return null;
    return d < 0 ? sib[j].uid : (sib[j + 1]?.uid ?? null);
  };
  const lineUp = (l: MainLine, d: -1 | 1) => {
    const sib = linesOf(l.heading_uid);
    const i = sib.findIndex((x) => x.uid === l.uid);
    if (i + d < 0 || i + d >= sib.length) return;
    moveLine(l.uid, l.heading_uid, step(L, l.uid, d, (x) => x.heading_uid === l.heading_uid));
  };
  const headingUp = (h: MainHeading, d: -1 | 1) => {
    const i = H.findIndex((x) => x.uid === h.uid);
    if (i + d < 0 || i + d >= H.length) return;
    moveHeading(h.uid, d < 0 ? H[i - 1].uid : (H[i + 2]?.uid ?? null));
  };
  const rename = async (kind: 'heading' | 'line', uid: string) => {
    const x = kind === 'heading' ? H.find((y) => y.uid === uid)! : L.find((y) => y.uid === uid)!;
    const name = (await promptBox(t('الاسم الجديد', 'The new name'), x.name))?.trim();
    if (!name || name === x.name) return;
    if (kind === 'heading') change({ ...draft, headings: H.map((y) => (y.uid === uid ? { ...y, name } : y)) });
    else change({ ...draft, lines: L.map((y) => (y.uid === uid ? { ...y, name } : y)) });
  };
  const toggle = (kind: 'heading' | 'line', uid: string) => {
    if (kind === 'heading') change({ ...draft, headings: H.map((y) => (y.uid === uid ? { ...y, active: y.active ? 0 : 1 } : y)) });
    else change({ ...draft, lines: L.map((y) => (y.uid === uid ? { ...y, active: y.active ? 0 : 1 } : y)) });
  };
  const addHeading = async () => {
    const name = (await promptBox(t('اسم البند الجديد (نفقة)', 'The name of the new heading (expense)')))?.trim();
    if (!name) return;
    change({ ...draft, headings: [...H, { uid: newUid(), code: nextHeadingCode('Exp'), name, types: ['Exp'], active: 1 }] });
  };
  const addLine = async (h: MainHeading) => {
    const name = (await promptBox(t(`خط جديد في «${h.name}»`, `A new line under "${h.name}"`)))?.trim();
    if (!name) return;
    change({ ...draft, lines: put(L, { uid: newUid(), heading_uid: h.uid, code: nextLineCode(h), name, is_project_fund: 0, active: 1 }, null) });
  };
  const setTypes = (h: MainHeading, v: TrxType) => {
    const types = h.types.includes(v) ? h.types.filter((x) => x !== v) : [...h.types, v];
    if (!types.length) return;
    change({ ...draft, headings: H.map((y) => (y.uid === h.uid ? { ...y, types } : y)) });
  };
  const at = () => new Date().toISOString().slice(0, 10);
  const mergeLine = (list: MainList, from: string, into: string): MainList =>
    ({ ...list, lines: list.lines.filter((x) => x.uid !== from), merged: [...list.merged, { kind: 'line', from, into, at: at() }] });
  const doMerge = async (into: string) => {
    if (!merging) return;
    if (merging.kind === 'line') {
      const f = L.find((x) => x.uid === merging.uid)!;
      const i = L.find((x) => x.uid === into)!;
      if (!(await confirmBox(t(`«${f.name}» يُدمج في «${i.name}»: في كل مركز تنتقل قيوده ومبالغ موازنته إليه، ويبقى القديم موقوفاً. يصل عند النشر.`, `"${f.name}" is merged into "${i.name}": in every centre its rows and budget amounts move to it, and the old one stays switched off. It reaches the centres when you publish.`)))) return;
      change(mergeLine(draft, f.uid, i.uid));
    } else {
      const f = H.find((x) => x.uid === merging.uid)!;
      const i = H.find((x) => x.uid === into)!;
      if (!(await confirmBox(t(`البند «${f.name}» يُدمج في «${i.name}»: خطوطه تنتقل إليه (خط بالاسم نفسه يُدمج)، مع قيودها في كل مركز. يصل عند النشر.`, `The heading "${f.name}" is merged into "${i.name}": its lines go under it (a line of the same name is merged), with their rows in every centre. It reaches the centres when you publish.`)))) return;
      let next: MainList = draft;
      for (const l of linesOf(f.uid)) {
        const twin = linesOf(i.uid).find((x) => lower(x.name) === lower(l.name));
        next = twin ? mergeLine(next, l.uid, twin.uid) : { ...next, lines: next.lines.map((x) => (x.uid === l.uid ? { ...x, heading_uid: i.uid } : x)) };
      }
      next = {
        ...next,
        headings: next.headings.filter((x) => x.uid !== f.uid).map((x) => (x.uid === i.uid ? { ...x, types: [...new Set([...x.types, ...f.types])] } : x)),
        merged: [...next.merged, { kind: 'heading', from: f.uid, into: i.uid, at: at() }],
      };
      // (the lines in the order of their headings)
      next = { ...next, lines: next.headings.flatMap((h) => next.lines.filter((x) => x.heading_uid === h.uid)) };
      change(next);
    }
    setMerging(null);
  };
  const publish = () => run(async () => {
    if (!inOrder(draft) && (await confirmBox(t('الرموز ليست بترتيب القائمة. أعد الترقيم أولاً؟', 'The codes are not in the order of the list. Renumber first?')))) {
      change(renumber(draft));
      await mainListApi.saveDraft(id, renumber(draft));
    }
    const p = await mainListApi.preview(id);
    const lines = p.centres.map((c) => `• ${c.organisation}: ${c.renamed} ${t('اسم أو رمز يتغير', 'names or codes change')}, ${c.moved} ${t('خط ينتقل', 'lines move')}, ${c.merged} ${t('دمج', 'merges')}, ${c.rows} ${t('قيداً ينتقل', 'rows move')}`);
    if (!(await confirmBox(`${t(`تُنشر النسخة ${(pub?.version ?? 0) + 1} على هذا الخادم. كل مركز يُنسخ احتياطياً أولاً، ثم يتبعها:`, `Version ${(pub?.version ?? 0) + 1} is published on this server. Each centre is backed up first, then follows it:`)}\n${lines.join('\n') || '—'}`))) return null;
    const r = await mainListApi.publish(id);
    await load();
    await onReload?.();
    onChanged();
    return `${t(`نُشرت النسخة ${r.list.version}`, `Version ${r.list.version} published`)} · ${results(r)}`;
  });

  const changed = !same(draft, pub);
  const onDrop = (target: { kind: 'heading' | 'line'; uid: string; heading: string }) => {
    const d = drag.current;
    drag.current = null;
    setOver(null);
    if (!d || readOnly) return;
    if (d.kind === 'line') moveLine(d.uid, target.heading, target.kind === 'line' ? target.uid : null);
    else if (target.kind === 'heading') moveHeading(d.uid, target.uid);
  };
  const dragProps = (kind: 'heading' | 'line', uid: string, heading: string) => readOnly ? {} : {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { drag.current = { kind, uid }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', uid); e.stopPropagation(); },
    onDragOver: (e: React.DragEvent) => { if (drag.current && (drag.current.kind === 'line' || kind === 'heading')) { e.preventDefault(); setOver(uid); } },
    onDragLeave: () => setOver((o) => (o === uid ? null : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); onDrop({ kind, uid, heading }); },
    onDragEnd: () => { drag.current = null; setOver(null); },
  };

  return (
    <div style={{ maxWidth: 980 }}>
      <div className="panel" style={{ marginBottom: 12, background: '#FBF7EE' }}>
        <b>{title}</b>{' '}
        {!readOnly && <button className="btn small ghost" title={t('أعد تسمية القائمة', 'Rename the list')} onClick={() => void run(async () => {
          const n = (await promptBox(t('اسم القائمة', 'The name of the list'), title))?.trim();
          if (!n || n === title) return null;
          await mainListApi.rename(id, n);
          onChanged();
          return null;
        })}>✎</button>}{' '}
        <span className="muted small">
          · {pub ? t(`منشورة: النسخة ${pub.version}، ${fmtDate(pub.published_at!.slice(0, 10))}`, `published: version ${pub.version}, ${fmtDate(pub.published_at!.slice(0, 10))}`) : t('لم تُنشر بعد', 'not published yet')}
          {pub?.from ? ` · ${t('بدأت من', 'started from')} ${pub.from}` : ''}
          {!readOnly && (changed ? ` · ${t('في المسودة تغييرات لم تُنشر', 'the draft has changes not yet published')}` : ` · ${t('المسودة مثل المنشورة', 'the draft is the same as the published list')}`)}
          {readOnly ? ` · ${t('من خادم آخر: تُقرأ هنا فقط', 'from another server: read only here')}` : ''}
          {` · ${t('تتبعها', 'followed by')}: ${centres.join(', ') || t('لا قاعدة بعد', 'no database yet')}`}
        </span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {!readOnly && <button className="btn" disabled={busy} onClick={() => void addHeading()}>＋ {t('بند', 'Heading')}</button>}
          {!readOnly && <button className="btn" disabled={busy || inOrder(draft)} title={t('رموز نظيفة بترتيب القائمة', 'Clean codes in the order of the list')} onClick={() => change(renumber(draft))}>{t('أعد الترقيم', 'Renumber')}</button>}
          {!readOnly && <button className="btn primary" disabled={busy || !changed} onClick={() => void publish()}>{t('انشر على هذا الخادم', 'Publish to this server')}</button>}
          {!readOnly && pub && changed && <button className="btn ghost" disabled={busy} onClick={() => void run(async () => {
            if (!(await confirmBox(t('تُرمى تغييرات المسودة وتعود كالمنشورة.', 'The changes of the draft are thrown away; it becomes the published list again.'), true))) return null;
            await mainListApi.discard(id);
            await load();
            return null;
          })}>{t('ارمِ المسودة', 'Throw away the draft')}</button>}
          {pub && <button className="btn" disabled={busy} onClick={() => void saveAsFile()}>⬇ {t('احفظ المنشورة ملفاً (للخوادم الأخرى)', 'Save the published list as a file (for the other servers)')}</button>}
          <label className="small" style={{ marginInlineStart: 'auto' }}><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> {t('إظهار الموقوف', 'Show switched off')}</label>
        </div>
        {help}
      </div>

      <Requests id={id} draft={draft} readOnly={readOnly} onDraft={setDraft} />

      {H.filter((h) => showOff || h.active).map((h, hi) => (
        <div key={h.uid} id={`ml-${h.uid}`} className="panel" style={{ marginBottom: 8, padding: '8px 12px', opacity: h.active ? 1 : 0.6, outline: over === h.uid ? '2px dashed var(--brand)' : mark === h.uid ? '2px solid var(--gold)' : undefined }} {...dragProps('heading', h.uid, h.uid)}>
          <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {!readOnly && <span className="muted" style={{ cursor: 'grab' }} title={t('اسحب', 'Drag')}>⠿</span>}
            <span className="code">{h.code}</span> <b>{h.name}</b>
            {!h.active && <span className="muted small">({t('موقوف للجميع', 'switched off for everyone')})</span>}
            <span className="row" style={{ gap: 4 }}>
              {TYPES.map((x) => (h.types.includes(x.v) || !readOnly) && (
                <button key={x.v} className={`chip ${h.types.includes(x.v) ? 'on' : ''}`} disabled={readOnly} onClick={() => setTypes(h, x.v)}>{typeName(x.v)}</button>
              ))}
            </span>
            {!readOnly && (
              <span className="row" style={{ gap: 2, marginInlineStart: 'auto' }}>
                <button className="btn small ghost" disabled={hi === 0} onClick={() => headingUp(h, -1)}>↑</button>
                <button className="btn small ghost" onClick={() => headingUp(h, 1)}>↓</button>
                <button className="btn small ghost" onClick={() => void addLine(h)}>＋ {t('خط', 'Line')}</button>
                <button className="btn small ghost" onClick={() => void rename('heading', h.uid)}>✎</button>
                <button className="btn small ghost" title={t('ادمجه في بند آخر', 'Merge it into another heading')} onClick={() => setMerging({ kind: 'heading', uid: h.uid })}>⇢ {t('دمج', 'Merge')}</button>
                <button className="btn small ghost" onClick={() => toggle('heading', h.uid)}>{h.active ? t('أوقف', 'Switch off') : t('فعّل', 'Switch on')}</button>
              </span>
            )}
          </div>
          <table className="t" style={{ marginTop: 6 }}>
            <tbody>
              {linesOf(h.uid).filter((l) => showOff || l.active).map((l, li, arr) => (
                <tr key={l.uid} id={`ml-${l.uid}`} className={l.active ? '' : 'off'} style={{ outline: over === l.uid ? '2px dashed var(--brand)' : undefined, background: mark === l.uid ? '#FFF3D6' : undefined }} {...dragProps('line', l.uid, h.uid)}>
                  <td style={{ width: 20 }}>{!readOnly && <span className="muted" style={{ cursor: 'grab' }}>⠿</span>}</td>
                  <td style={{ width: 90 }}><span className="code">{l.code}</span></td>
                  <td>{l.name}{!l.active && <span className="small muted"> · {t('موقوف للجميع', 'switched off for everyone')}</span>}</td>
                  {!readOnly && (
                    <td className="n" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn small ghost" disabled={li === 0} onClick={() => lineUp(l, -1)}>↑</button>
                      <button className="btn small ghost" disabled={li === arr.length - 1} onClick={() => lineUp(l, 1)}>↓</button>
                      <button className="btn small ghost" onClick={() => void rename('line', l.uid)}>✎</button>
                      <button className="btn small ghost" title={t('انقله إلى بند آخر أو ادمجه في خط', 'Move it to another heading, or merge it into a line')} onClick={() => setMerging({ kind: 'line', uid: l.uid })}>⇢</button>
                      <button className="btn small ghost" onClick={() => toggle('line', l.uid)}>{l.active ? t('أوقف', 'Switch off') : t('فعّل', 'Switch on')}</button>
                    </td>
                  )}
                </tr>
              ))}
              {!linesOf(h.uid).length && <tr><td colSpan={4} className="muted small">{t('لا خطوط. اسحب خطاً إلى هنا.', 'No lines. Drag a line here.')}</td></tr>}
            </tbody>
          </table>
        </div>
      ))}

      {merging && <MoveOrMerge list={draft} what={merging} onClose={() => setMerging(null)}
        onMove={(hu) => { moveLine(merging.uid, hu, null); setMerging(null); }} onMerge={(into) => void doMerge(into)} />}
    </div>
  );
}

/** A line: move it under another heading, or merge it into a line. A heading: merge it into another heading. */
function MoveOrMerge({ list, what, pickOnly, onClose, onMove, onMerge }: { list: MainList; what: { kind: 'heading' | 'line'; uid: string }; /** a request: just pick the one that exists */ pickOnly?: 'heading' | 'line'; onClose: () => void; onMove: (headingUid: string) => void; onMerge: (into: string) => void }) {
  const [q, setQ] = useState('');
  const me = pickOnly ? { name: t('اختر الموجود', 'Choose the one that exists'), heading_uid: '' } as MainLine
    : what.kind === 'line' ? list.lines.find((l) => l.uid === what.uid)! : list.headings.find((h) => h.uid === what.uid)!;
  const hit = (x: string) => !q.trim() || x.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <Modal title={pickOnly ? me.name : `${what.kind === 'line' ? t('نقل أو دمج', 'Move or merge') : t('دمج البند', 'Merge the heading')}: ${me.name}`} onClose={onClose}>
      <input className="input" autoFocus placeholder={t('ابحث…', 'Search…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {list.headings.filter((h) => h.uid !== what.uid).map((h) => {
          const lines = (pickOnly ? pickOnly === 'line' : what.kind === 'line') ? list.lines.filter((l) => l.heading_uid === h.uid && l.uid !== what.uid && hit(l.name)) : [];
          if (!hit(h.name) && !lines.length) return null;
          return (
            <div key={h.uid} style={{ marginBottom: 6 }}>
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <span className="code">{h.code}</span> <b>{h.name}</b>
                {pickOnly === 'line' ? null : pickOnly === 'heading' ? <button className="btn small" onClick={() => onMerge(h.uid)}>{t('هذا', 'This one')}</button>
                  : what.kind === 'line'
                  ? (h.uid !== (me as MainLine).heading_uid && <button className="btn small" onClick={() => onMove(h.uid)}>{t('انقله إلى هنا', 'Move it here')}</button>)
                  : <button className="btn small" onClick={() => onMerge(h.uid)}>{t('ادمجه هنا', 'Merge into this one')}</button>}
              </div>
              {lines.map((l) => (
                <div key={l.uid} className="row" style={{ gap: 6, alignItems: 'center', paddingInlineStart: 24 }}>
                  <span className="code small">{l.code}</span> {l.name}
                  <button className="btn small ghost" onClick={() => onMerge(l.uid)}>{pickOnly ? t('هذا', 'This one') : t('ادمجه في هذا الخط', 'Merge into this line')}</button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** The centres' requests: Add (to the draft), Use this one instead, or Refuse. On another city's server, they are only gathered into a file for the administrator. */
function Requests({ id, draft, readOnly, onDraft }: { id: string; draft: MainList; readOnly: boolean; onDraft: (x: MainList) => void }) {
  const [rows, setRows] = useState<MainRequest[]>([]);
  const [adding, setAdding] = useState<MainRequest | null>(null);
  const [pointing, setPointing] = useState<MainRequest | null>(null);
  const load = () => mainListApi.requests(id).then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); }, []);
  const open = rows.filter((r) => r.status === 'open');
  const done = rows.filter((r) => r.status !== 'open').reverse();
  const answer = async (a: Parameters<typeof mainListApi.answer>[0]) => {
    try {
      const x = await mainListApi.answer(a);
      if (x.draft) onDraft(x.draft);
      await load();
      toast(t('أُجيب الطلب', 'The request is answered'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const fromFile = async () => {
    try {
      const f = await pickFile(['json'], t('اختر ملف الطلبات', 'Choose the file of requests'));
      if (!f) return;
      const x = await mainListApi.importRequests(parseRequests(new TextDecoder().decode(f.bytes)));
      await load();
      toast(t(`${x.added} طلباً جديداً`, `${x.added} new requests`));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const toFile = async () => {
    const path = await saveFile(`requests-${new Date().toISOString().slice(0, 10)}.json`, ['json'], new TextEncoder().encode(JSON.stringify({ kind: MAIN_REQUESTS, requests: open }, null, 1)), t('احفظ الطلبات', 'Save the requests'));
    if (path) toast(`${t('حُفظ', 'Saved')}: ${path}`);
  };
  const who = (r: MainRequest) => `${r.organisation} · ${r.by} · ${fmtDate(r.at.slice(0, 10))}`;
  const what = (r: MainRequest) => <>{r.kind === 'line' ? <span className="muted">{t('خط', 'Line')} · {r.heading_name} › </span> : <span className="muted">{t('بند', 'Heading')} ({typeName(r.type ?? 'Exp')}) · </span>}<b>{r.name}</b></>;
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>{t('طلبات المراكز', "The centres' requests")}</b>
        {open.length > 0 && <span className="badge">{open.length}</span>}
        <span className="row" style={{ gap: 6, marginInlineStart: 'auto' }}>
          {!readOnly && <button className="btn small" onClick={() => void fromFile()}>⬆ {t('خذ ملف طلبات', 'Take a file of requests')}</button>}
          {readOnly && open.length > 0 && <button className="btn small" onClick={() => void toFile()}>⬇ {t('احفظ الطلبات ملفاً (للمدير)', 'Save the requests as a file (for the administrator)')}</button>}
        </span>
      </div>
      {!open.length && <p className="muted small" style={{ margin: '6px 0 0' }}>{t('لا طلبات تنتظر.', 'No request is waiting.')}</p>}
      {open.map((r) => (
        <div key={r.id} style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}>
          <div className="muted small">{who(r)}</div>
          <div>{what(r)}{r.why ? <span className="muted"> — {r.why}</span> : null}</div>
          {!readOnly && (
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              <button className="btn small primary" onClick={() => setAdding(r)}>＋ {t('أضف', 'Add')}</button>
              <button className="btn small" onClick={() => setPointing(r)}>{t('استعمل هذا بدلاً منه…', 'Use this one instead…')}</button>
              <button className="btn small ghost" onClick={() => void (async () => {
                const note = await promptBox(t('لماذا؟ (جملة واحدة للمركز)', 'Why? (one sentence for the centre)'));
                if (note != null) await answer({ id: r.id, how: 'refuse', note });
              })()}>{t('ارفض', 'Refuse')}</button>
            </div>
          )}
        </div>
      ))}
      {done.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="small muted">{t(`أُجيب (${done.length})`, `Answered (${done.length})`)}</summary>
          {done.slice(0, 30).map((r) => (
            <div key={r.id} className="small" style={{ padding: '3px 0' }}>
              {what(r)} <span className="muted">· {who(r)} · {r.status === 'added' ? t('أُضيف', 'added') : r.status === 'same' ? `${t('موجود', 'exists')}: ${r.answer_name}` : t('رُفض', 'refused')}{r.note ? ` — ${r.note}` : ''}</span>
            </div>
          ))}
        </details>
      )}
      {adding && <AddAnswer r={adding} draft={draft} onClose={() => setAdding(null)} onAdd={async (name, hu) => { await answer({ id: adding.id, how: 'add', name, heading_uid: hu }); setAdding(null); }} />}
      {pointing && <MoveOrMerge list={draft} what={{ kind: pointing.kind, uid: '' }} pickOnly={pointing.kind}
        onClose={() => setPointing(null)} onMove={(hu) => { void answer({ id: pointing.id, how: 'same', uid: hu }); setPointing(null); }}
        onMerge={(uid) => { void answer({ id: pointing.id, how: 'same', uid }); setPointing(null); }} />}
    </div>
  );
}

/** "Add": the name (as asked, or corrected) and, for a line, its heading. It goes into the draft. */
function AddAnswer({ r, draft, onClose, onAdd }: { r: MainRequest; draft: MainList; onClose: () => void; onAdd: (name: string, headingUid: string | null) => Promise<void> }) {
  const [name, setName] = useState(r.name);
  const [hu, setHu] = useState<string | null>(r.heading_uid);
  return (
    <Modal title={t('أضف إلى المسودة', 'Add to the draft')} onClose={onClose} narrow>
      <p className="muted small" style={{ marginTop: 0 }}>{t('يدخل المسودة؛ يصل إلى المراكز حين تنشر.', 'It goes into the draft; it reaches the centres when you publish.')}</p>
      <label className="small">{t('الاسم', 'Name')}</label>
      <input className="inp" style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} />
      {r.kind === 'line' && (
        <>
          <label className="small">{t('تحت البند', 'Under the heading')}</label>
          <select className="inp" style={{ width: '100%' }} value={hu ?? ''} onChange={(e) => setHu(e.target.value || null)}>
            {draft.headings.map((h) => <option key={h.uid} value={h.uid}>{h.code} {h.name}</option>)}
          </select>
        </>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={!name.trim() || (r.kind === 'line' && !hu)} onClick={() => void onAdd(name.trim(), hu)}>＋ {t('أضف', 'Add')}</button>
      </div>
    </Modal>
  );
}
