// All dropdown lists (the Data and Budget sheets), managed here — never in Excel.
// A value already used is never deleted: it is deactivated, and stays readable
// in old rows while disappearing from the forms.
import { useContext, useEffect, useState } from 'react';
import { useApp } from '../state';
import type { SimpleList } from '../db/repo';
import { TYPES, type Book, type TrxType } from '../domain/types';
import { TYPE_LABEL, tx } from '../i18n';
import { notesOf } from './Cash';
import { pickFile, saveFile } from '../platform';
import type { CommonList } from '../io/commonList';
import { Field, Modal, Select, Tabs, confirmBox, promptBox, errText, fmtDate, fmtSyp, fmtUsd, parseAmount, t, toast } from './kit';
import { GuideCtx, GuideLink, GuideSun } from '../guide/GuideView';

type Tab = 'budget' | 'city' | 'account' | 'party' | 'books' | 'settings';

export function ListsPage() {
  const [tab, setTab] = useState<Tab>('budget');
  return (
    <>
      <div className="page-head"><h1>{t('القوائم', 'Lists')}<GuideLink id="lists" /></h1></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'budget', label: t('الموازنة', 'Budget') },
        { value: 'books', label: t('الدفاتر والأمناء', 'Books & keepers') },
        { value: 'party', label: t('الجهات', 'Parties') },
        { value: 'account', label: t('المشاريع', 'Projects') },
        { value: 'city', label: t('المدن', 'Cities') },
        { value: 'settings', label: t('الإعدادات', 'Settings') },
      ]} />
      {tab === 'budget' && <CommonListPanel />}
      {tab === 'budget' && <BudgetTab />}
      {(tab === 'city' || tab === 'party') && <SimpleTab table={tab} key={tab} />}
      {tab === 'account' && <FundsTab />}
      {tab === 'books' && <BooksTab />}
      {tab === 'settings' && <SettingsTab />}
    </>
  );
}

/** Runs a change, reloads, and shows the error in words if it is refused. */
function useAct() {
  const { reload } = useApp();
  return async (f: () => Promise<unknown>, ok?: string) => {
    try {
      await f();
      await reload();
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(errText(e), true);
      return false;
    }
  };
}

function useCounts() {
  const { d } = useApp();
  const c = { city: new Map<number, number>(), account: new Map<number, number>(), party: new Map<number, number>(), book: new Map<number, number>(), heading: new Map<number, number>(), line: new Map<number, number>() };
  const inc = (m: Map<number, number>, k: number | null) => k != null && m.set(k, (m.get(k) ?? 0) + 1);
  for (const r of d.rows) {
    inc(c.city, r.city_id); inc(c.account, r.account_id); inc(c.party, r.party_id); inc(c.book, r.book_id); inc(c.heading, r.heading_id); inc(c.line, r.line_id);
  }
  return c;
}

// ---------------------------------------------------------------- budget

/** What each button of the common list does (shown under the buttons, and on the button itself). */
const HELP = {
  start: () => t('مرة واحدة، في حمص فقط: تصير قائمة هذه القاعدة القائمة المشتركة، وتقودها (أسماؤها ورموزها هي المرجع).', "Once, in Homs only: this database's list becomes the common list, and it leads it (its names and codes are the reference)."),
  join: () => t('مرة واحدة في كل مركز آخر: تطابق كل بند وخط قديم مع خط مشترك (أو تضيفه كما هو). القيود والموازنة تنتقل مع خطوطها. تُؤخذ نسخة احتياطية أولاً.', 'Once in each other centre: each old heading and line is matched to a common one (or added as it is). The rows and the budget move with their lines. A backup is taken first.'),
  same: () => t('على الخادم، كلما أضاف مركز خطوطاً: تجمع خطوط كل القواعد في القائمة المشتركة وتعطيها لكل قاعدة. لا يُحذف شيء، وما يأتي من مركز آخر يصل موقوفاً.', 'On the server, whenever a centre has added lines: gathers the lines of every database in the common list and gives them to each. Nothing is deleted; what comes from another centre arrives switched off.'),
  save: () => t('لمركز يعمل على حاسوبه: ملف فيه بنود هذه القاعدة وخطوطها، يُحمل إلى القاعدة الأخرى.', 'For a centre that works on its own computer: a file with the headings and lines of this database, to bring to the other database.'),
  take: () => t('يأخذ ملفاً حُفظ في قاعدة أخرى: تُضاف الخطوط الجديدة (موقوفة). ملف من القاعدة القائدة يغيّر الأسماء والرموز أيضاً.', 'Takes a file saved in another database: its new lines are added (switched off). A file from the leading database also changes the names and codes.'),
};

/**
 * One list of headings and lines for every centre (Fouad, 2026-11-01). The first database (Homs, on Fouad's server)
 * starts it and leads it; on the server, "make the lists the same" gathers the new lines of every database in it and
 * gives the common list to each; for a centre on its own computer, the list travels as a file.
 */
function CommonListPanel() {
  const { s, can, reload } = useApp();
  const openGuide = useContext(GuideCtx);
  const [state, setState] = useState<'lead' | 'yes' | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState<CommonList | null>(null);
  const load = () => s.api.call('common.status', {}).then((x) => setState(x.state)).catch(() => setState(null));
  useEffect(() => { void load(); }, [s]);
  const boss = can('users.manage');
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    try {
      const msg = await f();
      if (msg) toast(msg);
      await reload();
      await load();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  if (state === undefined) return null;
  return (
    <div className="panel" style={{ maxWidth: 900, marginBottom: 12, background: '#FBF7EE' }}>
      <b>{t('القائمة المشتركة لكل المراكز', 'The common list of every centre')}</b>{' '}
      <span className="muted small">
        {state === 'lead' ? t('· هذه القاعدة تقودها: أسماؤها ورموزها هي المرجع', "· this database leads it: its names and codes are the reference")
          : state === 'yes' ? t('· هذه القاعدة فيها', '· this database is in it')
          : t('· هذه القاعدة ليست فيها بعد', '· this database is not in it yet')}
      </span>
      <p className="muted small" style={{ margin: '6px 0' }}>{t('بنود وخطوط واحدة لكل المراكز. يضيف المركز خطاً فيصير للجميع، ويوقف ما لا يستعمله لنفسه فقط.', 'One set of headings and lines for every centre. A centre adds a line and it is for everyone; it switches off what it does not use, for itself only.')}</p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {!state && boss && (
          <button className="btn primary" disabled={busy} title={HELP.start()} onClick={() => void run(async () => {
            if (!(await confirmBox(t('تصير قائمة هذه القاعدة القائمة المشتركة، وتقودها. افعل هذا في حمص فقط. المراكز الأخرى تنضم بعد مطابقة خطوطها.', "This database's list becomes the common list, and it leads it. Do this in Homs only. The other centres join after their lines are matched.")))) return null;
            await s.api.call('common.start', {});
            return t('بدأت القائمة المشتركة', 'The common list has started');
          })}>{t('ابدأ القائمة المشتركة من هذه القاعدة', 'Start the common list from this database')}</button>
        )}
        {!state && boss && (
          <button className="btn primary" disabled={busy} title={HELP.join()} onClick={() => void run(async () => {
            // the common list: from the database that leads it on this server, else from a file
            let list: CommonList | null = null;
            if (s.mode === 'server') list = await fetch('/api/common-list/lead', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
            if (!list) {
              const f = await pickFile(['json'], t('اختر ملف القائمة المشتركة', 'Choose the common list file'));
              if (!f) return null;
              list = JSON.parse(new TextDecoder().decode(f.bytes)) as CommonList;
            }
            setJoining(list);
            return null;
          })}>{t('انضم إلى القائمة المشتركة…', 'Join the common list…')}</button>
        )}
        {state && boss && s.mode === 'server' && (
          <button className="btn primary" disabled={busy} title={HELP.same()} onClick={() => void run(async () => {
            const r = await fetch('/api/common-list/sync', { method: 'POST', credentials: 'same-origin' });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error?.en ?? 'Error');
            const parts = (j.centres as { organisation: string; gave: number; took: number }[]).map((x) => `${x.organisation}: +${x.took}${x.gave ? ` (${t('أعطت', 'gave')} ${x.gave})` : ''}`);
            return `${t('القوائم صارت واحدة', 'The lists are the same')} · ${parts.join(' · ')}`;
          })}>{t('اجعل القوائم واحدة على هذا الخادم', 'Make the lists the same on this server')}</button>
        )}
        {state && (
          <button className="btn" disabled={busy} title={HELP.save()} onClick={() => void run(async () => {
            const list = await s.api.call('common.export', {});
            const path = await saveFile(`common-list-${new Date().toISOString().slice(0, 10)}.json`, ['json'], new TextEncoder().encode(JSON.stringify(list, null, 1)), t('احفظ القائمة المشتركة', 'Save the common list'));
            return path ? `${t('حُفظ', 'Saved')}: ${path}` : null;
          })}>⬇ {t('احفظ القائمة ملفاً', 'Save the list as a file')}</button>
        )}
        {state && boss && (
          <button className="btn" disabled={busy} title={HELP.take()} onClick={() => void run(async () => {
            const f = await pickFile(['json'], t('اختر ملف القائمة المشتركة', 'Choose the common list file'));
            if (!f) return null;
            const r = await s.api.call('common.import', { text: new TextDecoder().decode(f.bytes) });
            return t(`أُضيف ${r.headings} بنداً و${r.lines} خطاً، وتغيّر اسم ${r.renamed}`, `${r.headings} headings and ${r.lines} lines added, ${r.renamed} renamed`);
          })}>⬆ {t('خذ ملف قائمة', 'Take a list file')}</button>
        )}
      </div>
      <ul className="muted small" style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
        {!state && boss && <li><b>{t('ابدأ القائمة المشتركة', 'Start the common list')}</b>: {HELP.start()}</li>}
        {!state && boss && <li><b>{t('انضم إلى القائمة المشتركة', 'Join the common list')}</b>: {HELP.join()}</li>}
        {state && boss && s.mode === 'server' && <li><b>{t('اجعل القوائم واحدة', 'Make the lists the same')}</b>: {HELP.same()}</li>}
        {state && <li><b>{t('احفظ القائمة ملفاً', 'Save the list as a file')}</b>: {HELP.save()}</li>}
        {state && boss && <li><b>{t('خذ ملف قائمة', 'Take a list file')}</b>: {HELP.take()}</li>}
      </ul>
      <button className="link small" style={{ marginTop: 6 }} onClick={() => openGuide('common')}><GuideSun /> {t('الخطوات كلها في «الدليل»', 'All the steps in the Guide')}</button>
      {joining && <JoinModal list={joining} onClose={() => setJoining(null)} onDone={async () => { setJoining(null); await reload(); await load(); }} />}
    </div>
  );
}

/**
 * Joining the common list (Fouad, 2026-11-01): each old heading and line of this database is matched to a common one
 * (proposed by name; Income, Transfer and Exchange by their type), or added to the common list as it is. Lines going
 * to the same common line are merged: their rows, budget amounts and items move. A backup is taken first.
 */
function JoinModal({ list, onClose, onDone }: { list: CommonList; onClose: () => void; onDone: () => Promise<void> }) {
  const { s, d } = useApp();
  const counts = useCounts();
  const L = d.lists;
  const low = (x: string) => x.trim().toLowerCase();
  const typesOf = (id: number) => L.headingTypes.filter((x) => x.heading_id === id).map((x) => x.type);
  const [hm, setHm] = useState<Record<number, string | null>>(() => Object.fromEntries(L.headings.map((h) => {
    const ts = typesOf(h.id);
    const byName = list.headings.find((c) => low(c.name) === low(h.name));
    const byType = ts.length === 1 && ts[0] !== 'Exp' ? list.headings.find((c) => c.types.length === 1 && c.types[0] === ts[0]) : undefined;
    return [h.id, (byName ?? byType)?.uid ?? null];
  })));
  const [lm, setLm] = useState<Record<number, string | null>>(() => Object.fromEntries(L.lines.map((l) => {
    const h = L.headings.find((x) => x.id === l.heading_id)!;
    const target = hm[h.id];
    const same = list.lines.find((c) => c.heading_uid === target && low(c.name) === low(l.name)) ?? list.lines.find((c) => low(c.name) === low(l.name));
    return [l.id, same?.uid ?? null];
  })));
  const [busy, setBusy] = useState(false);
  const lineOptions = list.headings.map((h) => ({ h, lines: list.lines.filter((l) => l.heading_uid === h.uid) })).filter((g) => g.lines.length);
  const LineSelect = ({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) => (
    <select className="inp small" style={{ minWidth: 240 }} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">＋ {t('أضفه إلى القائمة المشتركة كما هو', 'Add it to the common list as it is')}</option>
      {lineOptions.map((g) => <optgroup key={g.h.uid} label={`${g.h.code} ${g.h.name}`}>{g.lines.map((l) => <option key={l.uid} value={l.uid}>{l.name}</option>)}</optgroup>)}
    </select>
  );
  const shown = L.headings.filter((h) => L.lines.some((l) => l.heading_id === h.id) || counts.heading.get(h.id));
  const go = async () => {
    const merged = Object.values(lm).filter(Boolean).length;
    if (!(await confirmBox(t(`انضمام هذه القاعدة إلى القائمة المشتركة: ${merged} خطاً يصير خطاً مشتركاً، والباقي يُضاف كما هو. تنتقل القيود معها. تُؤخذ نسخة احتياطية أولاً.`, `This database joins the common list: ${merged} lines become common lines, the others are added as they are. The rows move with them. A backup is taken first.`)))) return;
    setBusy(true);
    try {
      const r = await s.api.call('common.join', { list, headings: hm, lines: lm });
      toast(t(`انضمت: ${r.matched} خطاً طوبق، ${r.kept} أضيف، ${r.added} جاء من القائمة المشتركة`, `Joined: ${r.matched} lines matched, ${r.kept} added, ${r.added} came from the common list`));
      await onDone();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t(`الانضمام إلى القائمة المشتركة (من ${list.from ?? ''})`, `Join the common list (from ${list.from ?? ''})`)} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>{t('لكل بند وخط من بنود هذه القاعدة: اختر ما يصيره في القائمة المشتركة، أو «أضفه كما هو». عدة خطوط إلى خط واحد تُدمج فيه (رواتب كل شخص → خط الوظيفة). القيود تبقى بتواريخها ومبالغها؛ يتغير بندها وخطها فقط.', 'For each heading and line of this database: choose what it becomes in the common list, or "add it as it is". Several lines to one line are merged into it (a salary per person → the line of the position). The rows keep their dates and amounts; only their heading and line change.')}</p>
      <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
        <table className="t">
          <tbody>
            {shown.flatMap((h) => {
              const ls = L.lines.filter((l) => l.heading_id === h.id);
              return [
                <tr key={`h${h.id}`} className="group">
                  <td><b>{h.code} {h.name}</b> <span className="muted small">{typesOf(h.id).join(' · ')}</span></td>
                  <td className="n muted small">{counts.heading.get(h.id) ?? 0}</td>
                  <td>
                    <select className="inp small" style={{ minWidth: 240 }} value={hm[h.id] ?? ''} onChange={(e) => setHm({ ...hm, [h.id]: e.target.value || null })}>
                      <option value="">＋ {t('بند جديد في القائمة المشتركة', 'A new heading in the common list')}</option>
                      {list.headings.map((c) => <option key={c.uid} value={c.uid}>{c.code} {c.name}</option>)}
                    </select>
                    {ls.length > 1 && (
                      <div className="small" style={{ marginTop: 4 }}>
                        {t('كل خطوطه →', 'All its lines →')}{' '}
                        <LineSelect value={null} onChange={(v) => setLm({ ...lm, ...Object.fromEntries(ls.map((l) => [l.id, v])) })} />
                      </div>
                    )}
                  </td>
                </tr>,
                ...ls.map((l) => (
                  <tr key={l.id} className={l.active ? '' : 'off'}>
                    <td style={{ paddingInlineStart: 22 }}>{l.code} {l.name}{!l.active && <span className="small muted"> · {t('موقوف', 'deactivated')}</span>}</td>
                    <td className="n muted small">{counts.line.get(l.id) ?? 0}</td>
                    <td><LineSelect value={lm[l.id] ?? null} onChange={(v) => setLm({ ...lm, [l.id]: v })} /></td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="modal-foot">
        <span className="muted small" style={{ flex: 1 }}>{t(`${Object.values(lm).filter(Boolean).length} خطاً يُطابَق، ${Object.values(lm).filter((x) => !x).length} يُضاف كما هو`, `${Object.values(lm).filter(Boolean).length} lines matched, ${Object.values(lm).filter((x) => !x).length} added as they are`)}</span>
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy} onClick={go}>{busy ? '…' : t('انضم', 'Join')}</button>
      </div>
    </Modal>
  );
}

function BudgetTab() {
  const { s, d } = useApp();
  const act = useAct();
  const counts = useCounts();
  const L = d.lists;
  const [sel, setSel] = useState<number | null>(L.headings[0]?.id ?? null);
  const [newHeading, setNewHeading] = useState('');
  const [newHeadingType, setNewHeadingType] = useState<TrxType>('Exp');
  const [newLine, setNewLine] = useState('');
  const [showOff, setShowOff] = useState(false);
  const h = L.headings.find((x) => x.id === sel);
  const types = (id: number) => L.headingTypes.filter((x) => x.heading_id === id).map((x) => x.type);
  const lines = L.lines.filter((l) => l.heading_id === sel && (showOff || l.active)).sort((a, b) => a.name.localeCompare(b.name));

  const rename = async (table: 'heading' | 'budget_line', id: number, old: string) => {
    const name = await promptBox(t('الاسم الجديد', 'New name'), old);
    if (name && name !== old) await act(() => s.api.call('list.rename', { table: table, id: id, name: name }), t('تمت إعادة التسمية', 'Renamed'));
  };
  const remove = async (table: 'heading' | 'budget_line', id: number, used: number) => {
    if (used) {
      if (await confirmBox(t(`مستعمل في ${used} سطراً. إيقافه بدل حذفه؟`, `Used in ${used} rows. Deactivate it instead?`)))
        await act(() => s.api.call('list.setActive', { table: table, id: id, active: false }), t('أوقف', 'Deactivated'));
      return;
    }
    if (await confirmBox(t('حذف نهائي؟ (لم يُستعمل قط)', 'Delete for good? (never used)'), true)) await act(() => s.api.call('list.delete', { table: table, id: id }), t('حُذف', 'Deleted'));
  };

  return (
    <div className="split">
      <div className="panel" style={{ padding: 0 }}>
        <div className="list-pick">
          {L.headings.filter((x) => showOff || x.active).map((x) => (
            <button key={x.id} className={`${sel === x.id ? 'on' : ''} ${x.active ? '' : 'off'}`} onClick={() => setSel(x.id)}>
              <span><span className="code">{x.code}</span> {x.name}</span>
              <span className="small muted">{types(x.id).map((ty) => tx(TYPE_LABEL[ty]).split(' · ').pop()).join(', ')}</span>
            </button>
          ))}
        </div>
        <div style={{ padding: 10, borderTop: '1px solid var(--line)' }}>
          <div className="row">
            <input className="inp" style={{ flex: 1 }} placeholder={t('بند جديد', 'New heading')} value={newHeading} onChange={(e) => setNewHeading(e.target.value)} />
            <select className="inp" style={{ width: 110 }} value={newHeadingType} onChange={(e) => setNewHeadingType(e.target.value as TrxType)}>
              {TYPES.map((ty) => <option key={ty} value={ty}>{tx(TYPE_LABEL[ty]).split(' · ').pop()}</option>)}
            </select>
            <button className="btn" disabled={!newHeading.trim()} onClick={async () => {
              if (await act(() => s.api.call('heading.add', { name: newHeading, types: [newHeadingType] }), t('أضيف', 'Added'))) setNewHeading('');
            }}>＋</button>
          </div>
          <label className="row small muted" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> {t('إظهار الموقوف', 'Show deactivated')}
          </label>
        </div>
      </div>

      {h && (
        <div className="panel">
          <div className="page-head" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}><span className="code">{h.code}</span> {h.name} {!h.active && <span className="muted small">({t('موقوف', 'deactivated')})</span>}</h2>
            <div className="row">
              <button className="btn small" onClick={() => rename('heading', h.id, h.name)}>{t('إعادة تسمية', 'Rename')}</button>
              {h.active
                ? <button className="btn small" onClick={() => remove('heading', h.id, (counts.heading.get(h.id) ?? 0) + L.lines.filter((l) => l.heading_id === h.id).length)}>{t('إيقاف / حذف', 'Deactivate / delete')}</button>
                : <button className="btn small" onClick={() => act(() => s.api.call('list.setActive', { table: 'heading', id: h.id, active: true }))}>{t('تفعيل', 'Reactivate')}</button>}
            </div>
          </div>
          <p className="muted small">{counts.heading.get(h.id) ?? 0} {t('سطراً في السجل', 'rows in the register')}</p>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="small muted">{t('يظهر مع النوع:', 'Offered for type:')}</span>
            <div className="chips">
              {TYPES.map((ty) => {
                const on = types(h.id).includes(ty);
                return (
                  <button key={ty} className={`chip ${on ? 'on' : ''}`} onClick={() => {
                    const next = on ? types(h.id).filter((x) => x !== ty) : [...types(h.id), ty];
                    void act(() => s.api.call('heading.types', { id: h.id, types: next }));
                  }}>{tx(TYPE_LABEL[ty])}</button>
                );
              })}
            </div>
          </div>

          <table className="t">
            <thead><tr><th>{t('الرمز', 'Code')}</th><th>{t('الخط', 'Line')}</th><th className="n">{t('سطور', 'Rows')}</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className={l.active ? '' : 'off'}>
                  <td className="code">{l.code}</td>
                  <td>{l.name}</td>
                  <td className="n">{counts.line.get(l.id) ?? 0}</td>
                  <td className="nowrap">
                    <button className="btn small ghost" onClick={() => rename('budget_line', l.id, l.name)}>✎</button>
                    {l.active
                      ? <button className="btn small ghost" onClick={() => remove('budget_line', l.id, counts.line.get(l.id) ?? 0)}>✕</button>
                      : <button className="btn small ghost" onClick={() => act(() => s.api.call('list.setActive', { table: 'budget_line', id: l.id, active: true }))}>↺</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <input className="inp" style={{ flex: 1 }} placeholder={t('خط جديد في هذا البند', 'New line under this heading')} value={newLine} onChange={(e) => setNewLine(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newLine.trim() && (await act(() => s.api.call('line.add', { headingId: h.id, name: newLine }), t('أضيف', 'Added')))) setNewLine('');
              }} />
            <button className="btn primary" disabled={!newLine.trim()} onClick={async () => {
              if (await act(() => s.api.call('line.add', { headingId: h.id, name: newLine }), t('أضيف', 'Added'))) setNewLine('');
            }}>＋ {t('خط', 'Line')}</button>
          </div>
          <p className="muted small">{t('الرمز يُعطى مرة واحدة ولا يتغير أبداً، فتبقى رموز السطور القديمة كما هي.', 'A code is given once and never changes, so old rows keep their code.')}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- simple lists

function SimpleTab({ table }: { table: SimpleList }) {
  const { s, d } = useApp();
  const act = useAct();
  const counts = useCounts();
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const arr = { city: d.lists.cities, account: d.lists.accounts, project: d.lists.projects, party: d.lists.parties }[table];
  const used = (id: number) => counts[table as 'city'].get(id) ?? 0;
  const shown = arr.filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="inp" style={{ flex: 1 }} placeholder={t('اسم جديد', 'New name')} value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={async (e) => e.key === 'Enter' && name.trim() && (await act(() => s.api.call('list.add', { table: table, name: name }), t('أضيف', 'Added'))) && setName('')} />
        <button className="btn primary" disabled={!name.trim()} onClick={async () => (await act(() => s.api.call('list.add', { table: table, name: name }), t('أضيف', 'Added'))) && setName('')}>＋ {t('إضافة', 'Add')}</button>
        {arr.length > 12 && <input className="inp" style={{ width: 160 }} placeholder={t('بحث…', 'Search…')} value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
      <table className="t">
        <thead><tr><th>{t('الاسم', 'Name')}</th><th className="n">{t('مستعمل', 'Used')}</th><th /></tr></thead>
        <tbody>
          {shown.map((x) => (
            <tr key={x.id} className={x.active ? '' : 'off'}>
              <td>{x.name}{!x.active && <span className="small"> · {t('موقوف', 'deactivated')}</span>}</td>
              <td className="n">{used(x.id)}</td>
              <td className="nowrap right">
                <button className="btn small ghost" title="↑" onClick={() => act(() => s.api.call('list.move', { table: table, id: x.id, dir: -1 }))}>▲</button>
                <button className="btn small ghost" title="↓" onClick={() => act(() => s.api.call('list.move', { table: table, id: x.id, dir: 1 }))}>▼</button>
                <button className="btn small ghost" onClick={async () => {
                  const n = await promptBox(t('الاسم الجديد', 'New name'), x.name);
                  if (n && n !== x.name) void act(() => s.api.call('list.rename', { table: table, id: x.id, name: n }), t('تمت إعادة التسمية', 'Renamed'));
                }}>✎</button>
                {x.active ? (
                  <button className="btn small ghost" onClick={async () => {
                    if (used(x.id)) {
                      if (await confirmBox(t('مستعمل. إيقافه؟ (يبقى في السطور القديمة ويختفي من القوائم)', 'In use. Deactivate it? (stays on old rows, leaves the dropdowns)')))
                        await act(() => s.api.call('list.setActive', { table: table, id: x.id, active: false }));
                    } else if (await confirmBox(t('حذف نهائي؟', 'Delete for good?'), true)) await act(() => s.api.call('list.delete', { table: table, id: x.id }));
                  }}>✕</button>
                ) : (
                  <button className="btn small ghost" onClick={() => act(() => s.api.call('list.setActive', { table: table, id: x.id, active: true }))}>↺</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- funds

/**
 * The funds (Fouad, 2026-11-01): each grant's share in this centre is one fund; a fund without
 * a grant is private money (the Jesuit foundation…). Only who keeps the grants adds or changes them.
 */
function FundsTab() {
  const { s, d, can } = useApp();
  const act = useAct();
  const counts = useCounts();
  const [name, setName] = useState('');
  const edit = can('lists.donors');
  const used = (id: number) => counts.account.get(id) ?? 0;
  const money = (n: number, cur: string) => `${cur === 'EUR' ? '€' : '$'}${fmtUsd(n)}`;
  const grantOf = (id: number) => {
    const p = d.grantParts.find((x) => x.account_id === id);
    const g = p && d.grants.find((x) => x.id === p.grant_id);
    return g && p ? { g, here: p.amount } : null;
  };
  const add = async () => (await act(() => s.api.call('list.add', { table: 'account', name }), t('أضيف', 'Added'))) && setName('');
  const [merging, setMerging] = useState<{ id: number; name: string } | null>(null);
  const [dating, setDating] = useState<{ id: number; name: string; start_date?: string | null; end_date?: string | null } | null>(null);
  return (
    <div className="panel" style={{ maxWidth: 900 }}>
      <p className="muted small" style={{ marginTop: 0 }}>{t('حصة كل منحة في هذا المركز مشروع. المشروع بلا منحة مال خاص. مشروع المنحة يُنشأ من صفحة المنح.', "Each grant's share in this centre is a project. A project without a grant is private money. A grant's project is made from the Grants page.")}</p>
      {edit && (
        <div className="row" style={{ marginBottom: 10 }}>
          <input className="inp" style={{ flex: 1 }} placeholder={t('مشروع خاص جديد', 'New private project')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void add()} />
          <button className="btn primary" disabled={!name.trim()} onClick={add}>＋ {t('إضافة', 'Add')}</button>
        </div>
      )}
      <table className="t">
        <thead><tr><th>{t('المشروع', 'Project')}</th><th>{t('المنحة', 'Grant')}</th><th>{t('المدة', 'Dates')}</th><th className="n">{t('الحصة هنا', 'Share here')}</th><th className="n">{t('مستعمل', 'Used')}</th>{edit && <th />}</tr></thead>
        <tbody>
          {d.lists.accounts.map((x) => {
            const gr = grantOf(x.id);
            return (
              <tr key={x.id} className={x.active ? '' : 'off'}>
                <td>{x.name}{!x.active && <span className="small"> · {t('موقوف', 'deactivated')}</span>}{x.outside_budget ? <span className="small muted"> · {t('خارج الموازنة', 'outside the budget')}</span> : null}</td>
                <td>{gr ? <>{d.lists.donors.find((y) => y.id === gr.g.donor_id)?.name ?? ''}{gr.g.reference ? <span className="muted"> · {gr.g.reference}</span> : null}</> : edit ? <span className="muted">{t('خاص', 'Private')}</span> : ''}</td>
                <td className="small nowrap">
                  {x.start_date || x.end_date ? <span className="ltr">{fmtDate(x.start_date ?? null) || '…'} → {fmtDate(x.end_date ?? null) || '…'}</span> : <span className="muted">—</span>}
                  {edit && <button className="btn small ghost" title={t('مدة المشروع', "The project's dates")} onClick={() => setDating(x)}>✎</button>}
                </td>
                <td className="n ltr">{gr ? money(gr.here, gr.g.currency) : ''}</td>
                <td className="n">{used(x.id)}</td>
                {edit && (
                  <td className="nowrap right">
                    {can('lists.manage') && x.active ? <button className="btn small ghost" title={t('دمجه في مشروع آخر', 'Merge it into another project')} onClick={() => setMerging(x)}>⇢ {t('دمج', 'Merge')}</button> : null}
                    {can('lists.manage') && <button className="btn small ghost" title={t('خارج الموازنة (مثل الدير): ما يُصرف منه ليس من موازنة المركز', 'Outside the budget (like Deir): what it spends is not in the centre\'s budget')} onClick={() => act(() => s.api.call('account.setOutside', { id: x.id, outside: !x.outside_budget }))}>{x.outside_budget ? t('إلى الموازنة', 'Into the budget') : t('خارج الموازنة', 'Outside the budget')}</button>}
                    <button className="btn small ghost" title="↑" onClick={() => act(() => s.api.call('list.move', { table: 'account', id: x.id, dir: -1 }))}>▲</button>
                    <button className="btn small ghost" title="↓" onClick={() => act(() => s.api.call('list.move', { table: 'account', id: x.id, dir: 1 }))}>▼</button>
                    <button className="btn small ghost" onClick={async () => {
                      const n = await promptBox(t('الاسم الجديد', 'New name'), x.name);
                      if (n && n !== x.name) void act(() => s.api.call('list.rename', { table: 'account', id: x.id, name: n }), t('تمت إعادة التسمية', 'Renamed'));
                    }}>✎</button>
                    {x.active ? (
                      <button className="btn small ghost" onClick={async () => {
                        if (gr) return toast(t('لهذا المشروع منحة: غيّرها من صفحة المنح', 'This project has a grant: change it from the Grants page'), true);
                        if (used(x.id)) {
                          if (await confirmBox(t('مستعمل. إيقافه؟ (يبقى في السطور القديمة ويختفي من القوائم)', 'In use. Deactivate it? (stays on old rows, leaves the dropdowns)')))
                            await act(() => s.api.call('list.setActive', { table: 'account', id: x.id, active: false }));
                        } else if (await confirmBox(t('حذف نهائي؟', 'Delete for good?'), true)) await act(() => s.api.call('list.delete', { table: 'account', id: x.id }));
                      }}>✕</button>
                    ) : (
                      <button className="btn small ghost" onClick={() => act(() => s.api.call('list.setActive', { table: 'account', id: x.id, active: true }))}>↺</button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {edit && <p className="muted small">{t('الحسابات القديمة (مثل الشبكة والبناء) تُدمج في مشروع آخر بزر «دمج»: كل ما كُتب عليها ينتقل إليه.', 'Old accounts (like Network or Building) are merged into another project with "Merge": everything written on them moves to it.')}</p>}
      {merging && <MergeModal from={merging} onClose={() => setMerging(null)} onDone={() => setMerging(null)} />}
      {dating && <DatesModal p={dating} onClose={() => setDating(null)} />}
    </div>
  );
}

/** A project's dates (a grant's period): outside them, its lines' expenses are not funded (Fouad, 2026-11-02). */
function DatesModal({ p, onClose }: { p: { id: number; name: string; start_date?: string | null; end_date?: string | null }; onClose: () => void }) {
  const { s } = useApp();
  const act = useAct();
  const [start, setStart] = useState(p.start_date ?? '');
  const [end, setEnd] = useState(p.end_date ?? '');
  return (
    <Modal narrow title={t(`مدة «${p.name}»`, `The dates of "${p.name}"`)} onClose={onClose}>
      <div className="grid2">
        <Field label={t('البداية', 'Start')}><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={t('النهاية', 'End')}><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <p className="muted small">{t('خارج هذين التاريخين، نفقات خطوط المشروع غير ممولة. فارغ = بلا حد.', "Outside these dates, the expenses on the project's lines are not funded. Empty = no limit.")}</p>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" onClick={async () => { if (await act(() => s.api.call('account.setDates', { id: p.id, start_date: start || null, end_date: end || null }), t('حُفظ', 'Saved'))) onClose(); }}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}

/** One project merged into another: the register, the budget lines, its grant and the defaults move; it is switched off. */
function MergeModal({ from, onClose, onDone }: { from: { id: number; name: string }; onClose: () => void; onDone: () => void }) {
  const { s, d, reload } = useApp();
  const [into, setInto] = useState<number | null>(null);
  const target = d.lists.accounts.find((a) => a.id === into);
  const go = async () => {
    if (!target || !(await confirmBox(t(`دمج «${from.name}» في «${target.name}»؟ تُؤخذ نسخة احتياطية أولاً.`, `Merge "${from.name}" into "${target.name}"? A backup is taken first.`), true))) return;
    try {
      const r = await s.api.call('account.merge', { from: from.id, into: target.id });
      toast(t(`دُمج: انتقل ${r.rows} قيداً`, `Merged: ${r.rows} rows moved`));
      await reload();
      onDone();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <Modal narrow title={t(`دمج «${from.name}»`, `Merge "${from.name}"`)} onClose={onClose}>
      <Field label={t('في المشروع', 'Into the project')}>
        <Select value={into} options={d.lists.accounts.filter((a) => a.active && a.id !== from.id).map((a) => ({ value: a.id, label: a.name }))} onChange={setInto} />
      </Field>
      <p className="muted small">{t(`قيوده في السجل، وخطوط الموازنة ومنحته (إن كانت له) تنتقل. ثم يُوقف «${from.name}».`, `Its rows in the register, its budget lines and its grant (if it has one) move. Then "${from.name}" is switched off.`)}</p>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={into == null} onClick={go}>{t('دمج', 'Merge')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- books

function BooksTab() {
  const { s, d, can } = useApp();
  const act = useAct();
  const counts = useCounts();
  const [edit, setEdit] = useState<Partial<Book> | null>(null);
  const L = d.lists;
  const name = (arr: { id: number; name: string }[], id: number | null) => arr.find((x) => x.id === id)?.name ?? '';
  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
        <p className="muted small" style={{ margin: 0 }}>{t('«Main» هو الصندوق الرئيسي. كل دفتر آخر هو النقد الذي يحمله أمين.', '"Main" is the main fund. Every other book is the cash one keeper holds.')}</p>
        <button className="btn primary" onClick={() => setEdit({ name: '' })}>＋ {t('دفتر جديد', 'New book')}</button>
      </div>
      <table className="t">
        <thead><tr><th>{t('الدفتر', 'Book')}</th><th>{t('الأمين', 'Keeper')}</th><th>{t('المدينة', 'City')}</th><th className="n">{t('افتتاحي ل.س', 'Opening SYP')}</th><th className="n">{t('افتتاحي $', 'Opening USD')}</th><th className="n">{t('سطور', 'Rows')}</th><th /></tr></thead>
        <tbody>
          {L.books.map((b) => (
            <tr key={b.id} className={b.active ? '' : 'off'}>
              <td><b>{b.name}</b>{b.is_main ? <span className="muted small"> · {t('رئيسي', 'main')}</span> : null}{b.private ? <span className="muted small"> · 🔒 {t('خاص', 'private')}</span> : null}</td>
              <td>{b.keeper_name}</td><td>{name(L.cities, b.city_id)}</td>
              <td className="n">{fmtSyp(b.opening_syp)}</td><td className="n">{fmtUsd(b.opening_usd)}</td><td className="n">{counts.book.get(b.id) ?? 0}</td>
              <td className="nowrap right">
                <button className="btn small ghost" onClick={() => setEdit(b)}>✎</button>
                {!b.is_main && can('users.manage') && (
                  <button className="btn small ghost" title={t('خاص: يراه أمينه فقط (والآخرون يرون تحويلاته فقط)', 'Private: only its keeper sees it (others see only its transfers)')}
                    onClick={() => act(() => s.api.call('book.setPrivate', { id: b.id, private: !b.private }), b.private ? t('لم يعد خاصاً', 'No longer private') : t('صار خاصاً', 'Now private'))}>
                    {b.private ? '🔓' : '🔒'}
                  </button>
                )}
                {!b.is_main && (b.active
                  ? <button className="btn small ghost" onClick={async () => (await confirmBox(t('إيقاف هذا الدفتر؟', 'Deactivate this book?'))) && act(() => s.api.call('list.setActive', { table: 'book', id: b.id, active: false }))}>✕</button>
                  : <button className="btn small ghost" onClick={() => act(() => s.api.call('list.setActive', { table: 'book', id: b.id, active: true }))}>↺</button>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && <BookModal book={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function BookModal({ book, onClose }: { book: Partial<Book>; onClose: () => void }) {
  const { s, d } = useApp();
  const act = useAct();
  const [b, setB] = useState({ ...book, opening_syp: book.opening_syp ?? 0, opening_usd: book.opening_usd ?? 0 });
  const [os, setOs] = useState(String(b.opening_syp || ''));
  const [ou, setOu] = useState(String(b.opening_usd || ''));
  const opts = (arr: { id: number; name: string; active: number }[]) => arr.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name }));
  return (
    <Modal title={book.id ? t('تعديل دفتر', 'Edit book') : t('دفتر جديد', 'New book')} onClose={onClose} narrow>
      <div className="grid2">
        <Field label={t('اسم الدفتر', 'Book name')}><input value={b.name ?? ''} disabled={!!b.is_main} onChange={(e) => setB({ ...b, name: e.target.value })} /></Field>
        <Field label={t('الأمين', 'Keeper')}><input value={b.keeper_name ?? ''} onChange={(e) => setB({ ...b, keeper_name: e.target.value })} /></Field>
        <Field label={t('المدينة (افتراضي)', 'City (default)')}><Select value={b.city_id ?? null} options={opts(d.lists.cities)} onChange={(v) => setB({ ...b, city_id: v })} /></Field>
        <Field label={t('رصيد افتتاحي ل.س', 'Opening SYP')}><input className="num" value={os} onChange={(e) => setOs(e.target.value)} /></Field>
        <Field label={t('رصيد افتتاحي $', 'Opening USD')}><input className="num" value={ou} onChange={(e) => setOu(e.target.value)} /></Field>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" onClick={async () => {
          const ok = await act(() => s.api.call('book.save', { ...b, name: b.name ?? '', opening_syp: parseAmount(os) || 0, opening_usd: parseAmount(ou) || 0 }), t('حُفظ', 'Saved'));
          if (ok) onClose();
        }}>{t('احفظ', 'Save')}</button>
      </div>
    </Modal>
  );
}


// ---------------------------------------------------------------- spending rules (ProjectMap)

// ---------------------------------------------------------------- settings

function SettingsTab() {
  const { s, d } = useApp();
  const act = useAct();
  const st = d.lists.settings;
  const [rate, setRate] = useState(String(st.usd_rate));
  const [tol, setTol] = useState(String(Math.round(st.exchange_tolerance * 100)));
  const [fs, setFs] = useState(st.fiscal_start ?? '');
  const notes = notesOf(st);
  const [nSyp, setNSyp] = useState(notes.SYP.join(', '));
  const [nUsd, setNUsd] = useState(notes.USD.join(', '));
  const saveNotes = (key: 'count_notes_syp' | 'count_notes_usd', txt: string) => {
    const v = notesOf({ count_notes_syp: null, count_notes_usd: null, [key]: txt })[key === 'count_notes_syp' ? 'SYP' : 'USD'].join(', ');
    if (v !== notes[key === 'count_notes_syp' ? 'SYP' : 'USD'].join(', ')) void act(() => s.api.call('settings.save', { [key]: v }), t('حُفظ', 'Saved'));
  };
  const opt = (arr: { id: number; name: string; active: number }[]) => arr.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name }));
  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <div className="grid2">
        <Field label={t('سعر الصرف الاحتياطي (ل.س لكل دولار)', 'Fallback exchange rate (SYP per USD)')}>
          <input className="num" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={() => {
            const v = parseAmount(rate);
            if (v > 0 && v !== st.usd_rate) void act(() => s.api.call('settings.save', { usd_rate: v }), t('حُفظ', 'Saved'));
          }} />
        </Field>
        <Field label={t('تنبيه التصريف إن ابتعد السعر أكثر من (%)', 'Exchange warning if rate is off by more than (%)')}>
          <input className="num" value={tol} onChange={(e) => setTol(e.target.value)} onBlur={() => {
            const v = parseAmount(tol);
            if (v > 0 && v / 100 !== st.exchange_tolerance) void act(() => s.api.call('settings.save', { exchange_tolerance: v / 100 }), t('حُفظ', 'Saved'));
          }} />
        </Field>
        <Field label={t('المدينة الافتراضية', 'Default city')}><Select value={st.def_city_id} options={opt(d.lists.cities)} onChange={(v) => act(() => s.api.call('settings.save', { def_city_id: v }))} /></Field>
        <Field label={t('الدفتر الافتراضي', 'Default book')}><Select value={st.def_book_id} options={opt(d.lists.books)} onChange={(v) => act(() => s.api.call('settings.save', { def_book_id: v }))} /></Field>
        <Field label={t('بداية السنة المالية (لا تواريخ قبلها)', 'Fiscal year start (no dates before it)')}>
          <input type="date" value={fs} onChange={(e) => setFs(e.target.value)} onBlur={() => fs !== (st.fiscal_start ?? '') && act(() => s.api.call('settings.save', { fiscal_start: fs || null }), t('حُفظ', 'Saved'))} />
        </Field>
        <Field label={t('فئات الأوراق النقدية للعدّ — ليرة (افصل بفاصلة)', 'Banknotes for counting — SYP (separate with commas)')}>
          <input className="num ltr" value={nSyp} onChange={(e) => setNSyp(e.target.value)} onBlur={() => saveNotes('count_notes_syp', nSyp)} />
        </Field>
        <Field label={t('فئات الأوراق النقدية للعدّ — دولار (افصل بفاصلة)', 'Banknotes for counting — USD (separate with commas)')}>
          <input className="num ltr" value={nUsd} onChange={(e) => setNUsd(e.target.value)} onBlur={() => saveNotes('count_notes_usd', nUsd)} />
        </Field>
      </div>
    </div>
  );
}
