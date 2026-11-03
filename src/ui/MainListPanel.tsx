// Admin → Main list (Fouad, 2026-11-03): the main list of headings and lines, kept on this server by the administrator.
// He changes a draft (drag a line or a heading, add, rename, switch off, merge); the codes do not change until
// "Renumber"; "Publish to this server" then gives it to every centre here (each is backed up first, and its rows follow
// their lines). The servers of the other cities take it as a file: there it is only read.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { mainListApi, type MainListInfo, type MainResult } from '../net';
import { checkMainList, inOrder, newUid, parseMainList, PREFIX, renumber, type MainHeading, type MainLine, type MainList } from '../io/mainList';
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

export function MainListPanel() {
  const { s, reload } = useApp();
  const [info, setInfo] = useState<MainListInfo | null>(null);
  const [draft, setDraft] = useState<MainList | null>(null);
  const [showOff, setShowOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState<{ kind: 'heading' | 'line'; uid: string } | null>(null);
  const drag = useRef<{ kind: 'heading' | 'line'; uid: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const load = async () => {
    try {
      const x = await mainListApi.get();
      setInfo(x);
      setDraft(x.draft ?? x.list);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  useEffect(() => { void load(); }, [s]);
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
    mainListApi.saveDraft(next).catch((e) => { toast(errText(e), true); void load(); });
  };
  const takeFile = () => run(async () => {
    const f = await pickFile(['json'], t('اختر ملف القائمة الرئيسية', 'Choose the main list file'));
    if (!f) return null;
    const list = parseMainList(new TextDecoder().decode(f.bytes));
    if (!(await confirmBox(t(`تأخذ النسخة ${list.version} من القائمة الرئيسية (من ${list.from ?? ''}). كل مركز على هذا الخادم يتبعها، بعد نسخة احتياطية.`, `This takes version ${list.version} of the main list (from ${list.from ?? ''}). Every centre on this server follows it, after a backup.`)))) return null;
    const r = await mainListApi.takeFile(list);
    await load();
    await reload();
    return `${t('أُخذت القائمة الرئيسية', 'The main list was taken')} · ${results(r)}`;
  });
  const saveAsFile = () => run(async () => {
    const pub = info!.list!;
    const path = await saveFile(`main-list-v${pub.version}.json`, ['json'], new TextEncoder().encode(JSON.stringify(pub, null, 1)), t('احفظ القائمة الرئيسية', 'Save the main list'));
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

  // nothing yet: start it from this database (Homs), or take the file of another server
  if (!draft) {
    return (
      <div className="panel" style={{ maxWidth: 820 }}>
        <h2 style={{ marginTop: 0 }}>{t('القائمة الرئيسية للبنود والخطوط', 'The main list of headings and lines')}</h2>
        <p>{t('لا قائمة رئيسية على هذا الخادم بعد.', 'There is no main list on this server yet.')}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={busy} onClick={() => void run(async () => {
            if (!(await confirmBox(t(`تبدأ القائمة الرئيسية نسخةً من قائمة «${s.organisation}». تعمل عليها مسودة، ثم تنشرها.`, `The main list starts as a copy of the list of "${s.organisation}". You work on it as a draft, then publish it.`)))) return null;
            await mainListApi.start();
            await load();
            return t('بدأت المسودة', 'The draft has started');
          })}>{t(`ابدأها من قائمة «${s.organisation}»`, `Start it from the list of "${s.organisation}"`)}</button>
          <button className="btn" disabled={busy} onClick={() => void takeFile()}>⬆ {t('خذ ملف قائمة رئيسية (من خادم آخر)', 'Take a main list file (from another server)')}</button>
        </div>
        {help}
      </div>
    );
  }

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
      await mainListApi.saveDraft(renumber(draft));
    }
    const p = await mainListApi.preview();
    const lines = p.centres.map((c) => `• ${c.organisation}: ${c.renamed} ${t('اسم أو رمز يتغير', 'names or codes change')}, ${c.moved} ${t('خط ينتقل', 'lines move')}, ${c.merged} ${t('دمج', 'merges')}, ${c.rows} ${t('قيداً ينتقل', 'rows move')}`);
    if (!(await confirmBox(`${t(`تُنشر النسخة ${(pub?.version ?? 0) + 1} على هذا الخادم. كل مركز يُنسخ احتياطياً أولاً، ثم يتبعها:`, `Version ${(pub?.version ?? 0) + 1} is published on this server. Each centre is backed up first, then follows it:`)}\n${lines.join('\n') || '—'}`))) return null;
    const r = await mainListApi.publish();
    await load();
    await reload();
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
        <b>{t('القائمة الرئيسية للبنود والخطوط', 'The main list of headings and lines')}</b>{' '}
        <span className="muted small">
          · {pub ? t(`منشورة: النسخة ${pub.version}، ${fmtDate(pub.published_at!.slice(0, 10))}`, `published: version ${pub.version}, ${fmtDate(pub.published_at!.slice(0, 10))}`) : t('لم تُنشر بعد', 'not published yet')}
          {pub?.from ? ` · ${t('بدأت من', 'started from')} ${pub.from}` : ''}
          {!readOnly && (changed ? ` · ${t('في المسودة تغييرات لم تُنشر', 'the draft has changes not yet published')}` : ` · ${t('المسودة مثل المنشورة', 'the draft is the same as the published list')}`)}
          {readOnly ? ` · ${t('من خادم آخر: تُقرأ هنا فقط', 'from another server: read only here')}` : ''}
        </span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {!readOnly && <button className="btn" disabled={busy} onClick={() => void addHeading()}>＋ {t('بند', 'Heading')}</button>}
          {!readOnly && <button className="btn" disabled={busy || inOrder(draft)} title={t('رموز نظيفة بترتيب القائمة', 'Clean codes in the order of the list')} onClick={() => change(renumber(draft))}>{t('أعد الترقيم', 'Renumber')}</button>}
          {!readOnly && <button className="btn primary" disabled={busy || !changed} onClick={() => void publish()}>{t('انشر على هذا الخادم', 'Publish to this server')}</button>}
          {!readOnly && pub && changed && <button className="btn ghost" disabled={busy} onClick={() => void run(async () => {
            if (!(await confirmBox(t('تُرمى تغييرات المسودة وتعود كالمنشورة.', 'The changes of the draft are thrown away; it becomes the published list again.'), true))) return null;
            await mainListApi.discard();
            await load();
            return null;
          })}>{t('ارمِ المسودة', 'Throw away the draft')}</button>}
          {pub && <button className="btn" disabled={busy} onClick={() => void saveAsFile()}>⬇ {t('احفظ المنشورة ملفاً (للخوادم الأخرى)', 'Save the published list as a file (for the other servers)')}</button>}
          {readOnly && <button className="btn" disabled={busy} onClick={() => void takeFile()}>⬆ {t('خذ ملفاً أحدث', 'Take a newer file')}</button>}
          <label className="small" style={{ marginInlineStart: 'auto' }}><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> {t('إظهار الموقوف', 'Show switched off')}</label>
        </div>
        {help}
      </div>

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
function MoveOrMerge({ list, what, onClose, onMove, onMerge }: { list: MainList; what: { kind: 'heading' | 'line'; uid: string }; onClose: () => void; onMove: (headingUid: string) => void; onMerge: (into: string) => void }) {
  const [q, setQ] = useState('');
  const me = what.kind === 'line' ? list.lines.find((l) => l.uid === what.uid)! : list.headings.find((h) => h.uid === what.uid)!;
  const hit = (x: string) => !q.trim() || x.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <Modal title={`${what.kind === 'line' ? t('نقل أو دمج', 'Move or merge') : t('دمج البند', 'Merge the heading')}: ${me.name}`} onClose={onClose}>
      <input className="input" autoFocus placeholder={t('ابحث…', 'Search…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {list.headings.filter((h) => h.uid !== what.uid).map((h) => {
          const lines = what.kind === 'line' ? list.lines.filter((l) => l.heading_uid === h.uid && l.uid !== what.uid && hit(l.name)) : [];
          if (!hit(h.name) && !lines.length) return null;
          return (
            <div key={h.uid} style={{ marginBottom: 6 }}>
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <span className="code">{h.code}</span> <b>{h.name}</b>
                {what.kind === 'line'
                  ? (h.uid !== (me as MainLine).heading_uid && <button className="btn small" onClick={() => onMove(h.uid)}>{t('انقله إلى هنا', 'Move it here')}</button>)
                  : <button className="btn small" onClick={() => onMerge(h.uid)}>{t('ادمجه هنا', 'Merge into this one')}</button>}
              </div>
              {lines.map((l) => (
                <div key={l.uid} className="row" style={{ gap: 6, alignItems: 'center', paddingInlineStart: 24 }}>
                  <span className="code small">{l.code}</span> {l.name}
                  <button className="btn small ghost" onClick={() => onMerge(l.uid)}>{t('ادمجه في هذا الخط', 'Merge into this line')}</button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
