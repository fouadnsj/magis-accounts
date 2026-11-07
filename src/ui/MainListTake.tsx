// Lists → Budget (Fouad, 2026-11-03): a centre takes what it needs from the server's main list of headings and lines
// (on the server), or from its file (a centre on its own computer). What it already has follows the list; what it
// ticks comes in, switched on. Only the administrator changes the main list (Coordinator → Budget lists).
import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { mainListApi } from '../net';
import { parseMainList, type MainList } from '../io/mainList';
import { pickFile } from '../platform';
import { Modal, errText, fmtDate, t, toast } from './kit';
import { useNav } from './Shell';
import { wishMainList } from './MainListPanel';
import { AskModal, MyRequests } from './MainListAsk';

/** The administrator of the server (who changes the main list), and the way to it. */
export function useMainAdmin() {
  const { s, can } = useApp();
  const nav = useNav();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (s.mode === 'server' && can('lists.manage')) mainListApi.get().then((x) => setAdmin(x.admin)).catch(() => setAdmin(false));
  }, [s]);
  // (the lists are changed in the Coordinator, not inside a centre)
  return { admin: admin && !!nav.databases, open: (uid?: string | null) => { wishMainList(uid); nav.databases?.(); } };
}

const lower = (x: string) => x.trim().toLowerCase();

export function MainListTake() {
  const { s, d, can, reload } = useApp();
  const [list, setList] = useState<MainList | null | undefined>(undefined);
  const [open, setOpen] = useState<MainList | null>(null);
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(0);
  const main = useMainAdmin();
  useEffect(() => {
    if (s.mode === 'server') mainListApi.get().then((x) => setList(x.list)).catch(() => setList(null));
    else setList(null);
  }, [s]);
  if (!can('lists.manage') || list === undefined) return null;
  const mine = d.lists.headings.some((h) => h.in_main);
  const fromFile = async () => {
    try {
      const f = await pickFile(['json'], t('اختر ملف القائمة الرئيسية', 'Choose the main list file'));
      if (f) setOpen(parseMainList(new TextDecoder().decode(f.bytes)));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 900, marginBottom: 12, background: '#FBF7EE' }}>
      <b>{t('القائمة الرئيسية للبنود والخطوط', 'The main list of headings and lines')}{list?.title ? ` · ${list.title}` : ''}</b>{' '}
      <span className="muted small">
        {list ? `· ${t('على الخادم: النسخة', 'on the server: version')} ${list.version}${list.published_at ? `, ${fmtDate(list.published_at.slice(0, 10))}` : ''}` : s.mode === 'server' ? `· ${t('لم يُنشرها المدير بعد', 'the administrator has not published it yet')}` : ''}
        {mine ? ` · ${t('هذه القاعدة أخذت منها', 'this database took from it')}` : ''}
      </span>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {list && <button className="btn primary" onClick={() => setOpen(list)}>{t('خذ من القائمة الرئيسية…', 'Take from the main list…')}</button>}
        {main.admin && <button className="btn" onClick={() => main.open()}>✎ {t('غيّر القائمة (المنسّق) →', 'Change the list (Coordinator) →')}</button>}
        {s.mode !== 'server' && <button className="btn" onClick={() => void fromFile()}>⬆ {t('خذ من ملف القائمة الرئيسية…', 'Take from a main list file…')}</button>}
        {!main.admin && (list || mine) && <button className="btn" onClick={() => setAsking(true)}>✉ {t('اطلب بنداً أو خطاً…', 'Ask for a heading or a line…')}</button>}
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>
        {t('تختار البنود والخطوط التي يستعملها هذا المركز. ما جاء منها يأخذ اسمه ورمزه منها؛ هنا يُوقف فقط. خط ناقص؟ اطلبه من المدير.', 'Choose the headings and lines this centre uses. What comes from it takes its name and code from it; here it is only switched off. A line missing? Ask the administrator.')}
      </p>
      <MyRequests list={list} version={sent} />
      {asking && <AskModal list={list} onClose={() => setAsking(false)} onSent={() => { setAsking(false); setSent((x) => x + 1); }} />}
      {open && <TakeModal list={open} onClose={() => setOpen(null)} onDone={async () => { setOpen(null); await reload(); }} />}
    </div>
  );
}

function TakeModal({ list, onClose, onDone }: { list: MainList; onClose: () => void; onDone: () => Promise<void> }) {
  const { s, d } = useApp();
  const L = d.lists;
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  // already here: by identity, or of the same name (it becomes the list's)
  const hereH = (uid: string, name: string) => L.headings.find((h) => h.uid === uid || lower(h.name) === lower(name));
  const hereL = (uid: string, name: string, headingUid: string) => {
    const hh = list.headings.find((h) => h.uid === headingUid)!;
    const h = hereH(hh.uid, hh.name);
    return L.lines.find((l) => l.merged_into == null && (l.uid === uid || (h && l.heading_id === h.id && lower(l.name) === lower(name))));
  };
  const toggle = (uids: string[], on: boolean) => setPick((p) => { const n = new Set(p); for (const u of uids) on ? n.add(u) : n.delete(u); return n; });
  const hit = (x: string) => !q.trim() || x.toLowerCase().includes(q.trim().toLowerCase());
  const take = async () => {
    setBusy(true);
    try {
      const r = await s.api.call('main.take', { list, take: [...pick] });
      toast(t(`أُخذ ${r.added}، وتغيّر اسم أو رمز ${r.renamed}`, `${r.added} taken, ${r.renamed} renamed`));
      await onDone();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${t('خذ من القائمة الرئيسية', 'Take from the main list')} · ${t('النسخة', 'version')} ${list.version}`} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>{t('علّم ما يستعمله هذا المركز. ما هو هنا من قبل معلَّم؛ يأخذ اسم القائمة ورمزها. تُؤخذ نسخة احتياطية أولاً.', 'Tick what this centre uses. What is already here is ticked; it takes the name and code of the list. A backup is taken first.')}</p>
      <input className="inp" placeholder={t('ابحث…', 'Search…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <div style={{ maxHeight: 460, overflow: 'auto' }}>
        {list.headings.filter((h) => h.active).map((h) => {
          const lines = list.lines.filter((l) => l.heading_uid === h.uid && l.active && (hit(l.name) || hit(h.name)));
          if (!lines.length && !hit(h.name)) return null;
          const free = lines.filter((l) => !hereL(l.uid, l.name, h.uid)).map((l) => l.uid);
          const hHere = !!hereH(h.uid, h.name);
          const all = free.length > 0 && free.every((u) => pick.has(u));
          return (
            <div key={h.uid} style={{ marginBottom: 8 }}>
              <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={hHere || all || pick.has(h.uid)} disabled={hHere && !free.length}
                  onChange={(e) => (free.length ? toggle(free, e.target.checked) : toggle([h.uid], e.target.checked))} />
                <span className="code">{h.code}</span> <b>{h.name}</b>
                {hHere && <span className="muted small">· {t('هنا', 'here')}</span>}
              </label>
              {lines.map((l) => {
                const here = !!hereL(l.uid, l.name, h.uid);
                return (
                  <label key={l.uid} className="row" style={{ gap: 6, alignItems: 'center', paddingInlineStart: 26 }}>
                    <input type="checkbox" checked={here || pick.has(l.uid)} disabled={here} onChange={(e) => toggle([l.uid], e.target.checked)} />
                    <span className="code small">{l.code}</span> {l.name}
                    {here && <span className="muted small">· {t('هنا', 'here')}</span>}
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy} onClick={() => void take()}>
          {pick.size ? t(`خذ ${pick.size}`, `Take ${pick.size}`) : t('حدّث ما هنا فقط', 'Only update what is here')}
        </button>
      </div>
    </Modal>
  );
}
