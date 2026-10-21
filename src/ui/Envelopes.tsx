// Envelopes (Fouad, 19–21 October 2026): money handed to a helper (a facilitator, the cleaner…).
// One section for all the books a person writes in: it lists the envelopes that exist, each with
// what is left in it and three buttons — Give (from the book), Spent (the helper's expense),
// Put back (what is left comes back) — and ONE button to make a new one (it asks for which book
// when there are several). Shown on the phone and on Home.
import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { holders } from '../domain/reports';
import { errText, fmtSyp, fmtUsd, promptBox, t, toast } from './kit';
import type { EntryStart } from './EntryForm';

export function Envelopes({ bookIds, onEntry, compact }: { bookIds: number[]; onEntry: (x: EntryStart) => void; compact?: boolean }) {
  const { s, d, reload, can, writeBooks } = useApp();
  // the books he may hand money out of: those he writes in (or any, with "writes in every book")
  const mayWrite = (id: number) => writeBooks.includes(id) || can('register.edit');
  const parents = bookIds.filter((id) => d.lists.books.some((b) => b.id === id && b.parent_id == null));
  const envs = d.lists.books.filter((b) => b.parent_id != null && parents.includes(b.parent_id) && b.active);
  const addable = parents.filter(mayWrite);
  const [target, setTarget] = useState<number | null>(null);
  const targetId = target != null && addable.includes(target) ? target : addable[0] ?? null;
  const left = useMemo(() => {
    const syp = holders(d.rows, envs, 'SYP');
    const usd = holders(d.rows, envs, 'USD');
    return new Map(envs.map((e, i) => [e.id, { syp: syp[i].shouldHold, usd: usd[i].shouldHold }]));
  }, [d.rows, envs]);
  if (!envs.length && !addable.length) return null;
  const bookName = (id: number | null | undefined) => d.lists.books.find((b) => b.id === id)?.name ?? '';
  const several = parents.length > 1;

  const add = async () => {
    if (targetId == null) return;
    const helper = await promptBox(t('اسم المساعد (مثلاً: المنشّط، عامل التنظيف)', "The helper's name (e.g. the facilitator, the cleaner)"), '');
    if (!helper?.trim()) return;
    try {
      await s.api.call('envelope.save', { parentId: targetId, helper });
      await reload();
      toast(t('صُنع الظرف', 'Envelope made'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const rename = async (id: number, parentId: number, old: string) => {
    const helper = await promptBox(t('اسم المساعد', "The helper's name"), old);
    if (!helper?.trim() || helper === old) return;
    try {
      await s.api.call('envelope.save', { id, parentId, helper });
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const off = async (id: number, parentId: number, helper: string) => {
    try {
      await s.api.call('envelope.save', { id, parentId, helper, active: 0 });
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };

  return (
    <div className={compact ? 'cty-card' : 'panel'}>
      <div className={compact ? 'cty-label' : ''} style={compact ? undefined : { fontWeight: 650, marginBottom: 6 }}>✉ {t('الأظرف', 'Envelopes')}</div>
      {envs.map((e) => {
        const l = left.get(e.id) ?? { syp: 0, usd: 0 };
        const empty = Math.abs(l.syp) < 0.5 && Math.abs(l.usd) < 0.005;
        const parent = e.parent_id as number;
        const may = mayWrite(parent);
        return (
          <div key={e.id} className="env-row">
            <div className="env-head">
              <b>{e.keeper_name ?? e.name}{several && <span className="muted small"> · {bookName(parent)}</span>}</b>
              <span className="ltr env-left">{t('باقٍ', 'Left')}: <b>{fmtSyp(l.syp)}</b> {t('ل.س', 'SYP')}{l.usd ? <> · <b>{fmtUsd(l.usd)}</b> $</> : null}</span>
            </div>
            {may && (
              <div className="env-btns">
                <button className="btn small" onClick={() => onEntry({ preset: true, type: 'Transfer', fromBook: parent, toBook: e.id, bookId: parent })}>↦ {t('أعطِ', 'Give')}</button>
                <button className="btn small" onClick={() => onEntry({ preset: true, type: 'Exp', bookId: e.id })}>− {t('صُرف', 'Spent')}</button>
                <button className="btn small" disabled={empty} onClick={() => onEntry({ preset: true, type: 'Transfer', fromBook: e.id, toBook: parent, bookId: e.id })}>↤ {t('أعاد', 'Put back')}</button>
                <button className="btn small ghost" onClick={() => rename(e.id, parent, e.keeper_name ?? '')} title={t('الاسم', 'Name')}>✎</button>
                {empty && <button className="btn small ghost" onClick={() => off(e.id, parent, e.keeper_name ?? '')} title={t('إيقاف الظرف', 'Switch the envelope off')}>✕</button>}
              </div>
            )}
          </div>
        );
      })}
      {addable.length > 0 && (
        <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          {addable.length > 1 && (
            <select className="inp" style={{ width: 'auto' }} value={targetId ?? ''} onChange={(e) => setTarget(Number(e.target.value))} aria-label={t('الدفتر', 'Book')}>
              {addable.map((id) => <option key={id} value={id}>{bookName(id)}</option>)}
            </select>
          )}
          <button className="btn small" onClick={add}>＋ {t('ظرف لمساعد', 'An envelope for a helper')}</button>
        </div>
      )}
    </div>
  );
}
