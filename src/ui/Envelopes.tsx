// A book holder's envelopes (Fouad, 19 October 2026): money he hands to a helper (a facilitator,
// the cleaner…). Each envelope shows what is left in it, and three buttons: Give (from his book),
// Spent (the helper's expense), Put back (what is left comes back). Shown on the phone and on Home.
import { useMemo } from 'react';
import { useApp } from '../state';
import { holders } from '../domain/reports';
import { errText, fmtSyp, fmtUsd, promptBox, t, toast } from './kit';
import type { EntryStart } from './EntryForm';

export function Envelopes({ bookId, onEntry, compact }: { bookId: number; onEntry: (x: EntryStart) => void; compact?: boolean }) {
  const { s, d, reload, can, writeBooks } = useApp();
  const envs = d.lists.books.filter((b) => b.parent_id === bookId && b.active);
  const mayWrite = writeBooks.includes(bookId) || can('register.edit');
  const left = useMemo(() => {
    const syp = holders(d.rows, envs, 'SYP');
    const usd = holders(d.rows, envs, 'USD');
    return new Map(envs.map((e, i) => [e.id, { syp: syp[i].shouldHold, usd: usd[i].shouldHold }]));
  }, [d.rows, envs]);
  if (!envs.length && !mayWrite) return null;

  const add = async () => {
    const helper = await promptBox(t('اسم المساعد (مثلاً: المنشّط، عامل التنظيف)', "The helper's name (e.g. the facilitator, the cleaner)"), '');
    if (!helper?.trim()) return;
    try {
      await s.api.call('envelope.save', { parentId: bookId, helper });
      await reload();
      toast(t('صُنع الظرف', 'Envelope made'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const rename = async (id: number, old: string) => {
    const helper = await promptBox(t('اسم المساعد', "The helper's name"), old);
    if (!helper?.trim() || helper === old) return;
    try {
      await s.api.call('envelope.save', { id, parentId: bookId, helper });
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const off = async (id: number, helper: string) => {
    try {
      await s.api.call('envelope.save', { id, parentId: bookId, helper, active: 0 });
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };

  return (
    <div className={compact ? 'cty-card' : 'panel'}>
      <div className={compact ? 'cty-label' : ''} style={compact ? undefined : { fontWeight: 650, marginBottom: 6 }}>✉ {t('الأظرف', 'Envelopes')}</div>
      <p className="muted small" style={{ marginTop: 0 }}>{t('مال تعطيه لمساعد (منشّط، عامل تنظيف…): يبقى في دفترك ويراه المكتب.', 'Money you hand to a helper (a facilitator, the cleaner…): it stays in your book and the office sees it.')}</p>
      {envs.map((e) => {
        const l = left.get(e.id) ?? { syp: 0, usd: 0 };
        const empty = Math.abs(l.syp) < 0.5 && Math.abs(l.usd) < 0.005;
        return (
          <div key={e.id} className="env-row">
            <div className="env-head">
              <b>{e.keeper_name ?? e.name}</b>
              <span className="ltr env-left">{t('باقٍ', 'Left')}: <b>{fmtSyp(l.syp)}</b> {t('ل.س', 'SYP')}{l.usd ? <> · <b>{fmtUsd(l.usd)}</b> $</> : null}</span>
            </div>
            {mayWrite && (
              <div className="env-btns">
                <button className="btn small" onClick={() => onEntry({ preset: true, type: 'Transfer', fromBook: bookId, toBook: e.id, bookId })}>↦ {t('أعطِ', 'Give')}</button>
                <button className="btn small" onClick={() => onEntry({ preset: true, type: 'Exp', bookId: e.id })}>− {t('صُرف', 'Spent')}</button>
                <button className="btn small" disabled={empty} onClick={() => onEntry({ preset: true, type: 'Transfer', fromBook: e.id, toBook: bookId, bookId: e.id })}>↤ {t('أعاد', 'Put back')}</button>
                <button className="btn small ghost" onClick={() => rename(e.id, e.keeper_name ?? '')} title={t('الاسم', 'Name')}>✎</button>
                {empty && <button className="btn small ghost" onClick={() => off(e.id, e.keeper_name ?? '')} title={t('إيقاف الظرف', 'Switch the envelope off')}>✕</button>}
              </div>
            )}
          </div>
        );
      })}
      {mayWrite && <button className="btn small" style={{ marginTop: 8 }} onClick={add}>＋ {t('ظرف لمساعد', 'An envelope for a helper')}</button>}
    </div>
  );
}
