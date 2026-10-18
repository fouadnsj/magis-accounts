// All dropdown lists (the Data and Budget sheets), managed here — never in Excel.
// A value already used is never deleted: it is deactivated, and stays readable
// in old rows while disappearing from the forms.
import { useState } from 'react';
import { useApp } from '../state';
import type { SimpleList } from '../db/repo';
import { TYPES, type Book, type TrxType } from '../domain/types';
import { TYPE_LABEL, tx } from '../i18n';
import { Field, Modal, Select, Tabs, confirmBox, promptBox, errText, fmtSyp, fmtUsd, parseAmount, t, toast } from './kit';

type Tab = 'budget' | 'city' | 'account' | 'party' | 'books' | 'donors' | 'settings';

export function ListsPage() {
  const { can } = useApp();
  const [tab, setTab] = useState<Tab>('budget');
  return (
    <>
      <div className="page-head"><h1>{t('القوائم', 'Lists')}</h1></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'budget', label: t('الموازنة', 'Budget') },
        { value: 'books', label: t('الدفاتر والأمناء', 'Books & keepers') },
        { value: 'party', label: t('الجهات', 'Parties') },
        { value: 'account', label: t('الحسابات', 'Accounts') },
        { value: 'donors', label: t('المانحون', 'Donors'), hidden: !can('lists.donors') },
        { value: 'city', label: t('المدن', 'Cities') },
        { value: 'settings', label: t('الإعدادات', 'Settings') },
      ]} />
      {tab === 'budget' && <BudgetTab />}
      {(tab === 'city' || tab === 'account' || tab === 'party') && <SimpleTab table={tab} key={tab} />}
      {tab === 'books' && <BooksTab />}
      {tab === 'donors' && can('lists.donors') && <DonorsTab />}
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
        <thead><tr><th>{t('الدفتر', 'Book')}</th><th>{t('الأمين', 'Keeper')}</th><th>{t('المدينة', 'City')}</th><th>{t('الحساب', 'Account')}</th><th className="n">{t('افتتاحي ل.س', 'Opening SYP')}</th><th className="n">{t('افتتاحي $', 'Opening USD')}</th><th className="n">{t('سطور', 'Rows')}</th><th /></tr></thead>
        <tbody>
          {L.books.map((b) => (
            <tr key={b.id} className={b.active ? '' : 'off'}>
              <td><b>{b.name}</b>{b.is_main ? <span className="muted small"> · {t('رئيسي', 'main')}</span> : null}{b.private ? <span className="muted small"> · 🔒 {t('خاص', 'private')}</span> : null}</td>
              <td>{b.keeper_name}</td><td>{name(L.cities, b.city_id)}</td><td>{name(L.accounts, b.account_id)}</td>
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
        <Field label={t('الحساب (افتراضي)', 'Account (default)')}><Select value={b.account_id ?? null} options={opts(d.lists.accounts)} onChange={(v) => setB({ ...b, account_id: v })} /></Field>
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

// ---------------------------------------------------------------- donors (Sup)

function DonorsTab() {
  const { s, d, reload } = useApp();
  const act = useAct();
  const [name, setName] = useState('');
  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <div className="alert info small">{t('سرّي — يراه الرئيس فقط.', 'Confidential — only the Superior sees this.')}</div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="inp" style={{ flex: 1 }} placeholder={t('مانح جديد', 'New donor')} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={!name.trim()} onClick={async () => (await act(() => s.api.call('donor.save', { name, default_project_id: null }), t('أضيف', 'Added'))) && setName('')}>＋</button>
      </div>
      <table className="t">
        <thead><tr><th>{t('المانح', 'Donor')}</th><th /></tr></thead>
        <tbody>
          {d.lists.donors.map((x) => (
            <tr key={x.id} className={x.active ? '' : 'off'}>
              <td>{x.name}</td>
              <td className="nowrap right">
                <button className="btn small ghost" onClick={async () => {
                  const n = await promptBox(t('الاسم الجديد', 'New name'), x.name);
                  if (n && n !== x.name) void act(() => s.api.call('donor.save', { id: x.id, name: n, default_project_id: x.default_project_id }));
                }}>✎</button>
                {x.active
                  ? <button className="btn small ghost" title={t('حذف (أو إيقاف إن كان مستعملاً)', 'Delete (or deactivate if used)')} onClick={async () => {
                      // a donor with grants or budget allocations is only deactivated: they stay in the history
                      if (!(await confirmBox(t(`حذف المانح «${x.name}»؟`, `Delete the donor "${x.name}"?`), true))) return;
                      try {
                        await s.api.call('list.delete', { table: 'donor', id: x.id });
                        await reload();
                        toast(t('حُذف', 'Deleted'));
                      } catch {
                        if (await confirmBox(t(`لـ«${x.name}» منح أو تخصيصات في الموازنة: لا يُحذف. إيقافه بدلاً من ذلك؟ (يبقى في السجل ويختفي من القوائم)`, `"${x.name}" has grants or budget allocations: it cannot be deleted. Deactivate it instead? (it stays in the history and leaves the lists)`)))
                          await act(() => s.api.call('list.setActive', { table: 'donor', id: x.id, active: false }), t('أوقف', 'Deactivated'));
                      }
                    }}>✕</button>
                  : <button className="btn small ghost" onClick={() => act(() => s.api.call('list.setActive', { table: 'donor', id: x.id, active: true }))}>↺</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
        <Field label={t('الحساب الافتراضي', 'Default account')}><Select value={st.def_account_id} options={opt(d.lists.accounts)} onChange={(v) => act(() => s.api.call('settings.save', { def_account_id: v }))} /></Field>
        <Field label={t('الدفتر الافتراضي', 'Default book')}><Select value={st.def_book_id} options={opt(d.lists.books)} onChange={(v) => act(() => s.api.call('settings.save', { def_book_id: v }))} /></Field>
        <Field label={t('بداية السنة المالية (لا تواريخ قبلها)', 'Fiscal year start (no dates before it)')}>
          <input type="date" value={fs} onChange={(e) => setFs(e.target.value)} onBlur={() => fs !== (st.fiscal_start ?? '') && act(() => s.api.call('settings.save', { fiscal_start: fs || null }), t('حُفظ', 'Saved'))} />
        </Field>
      </div>
    </div>
  );
}
