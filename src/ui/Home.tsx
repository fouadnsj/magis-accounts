import { useMemo, useState } from 'react';
import { useApp, useNames } from '../state';
import { holders } from '../domain/reports';
import type { TransferInfo } from '../domain/transfers';
import { TYPE_LABEL, tx } from '../i18n';
import type { TrxType } from '../domain/types';
import { useNav } from './Shell';
import { errText, fmtDate, fmtSyp, fmtUsd, promptBox, t, toast } from './kit';
import { holderBalance } from './Cash';

export function Home() {
  const { s, d, can, myBooks, limited, fileHolder, reload } = useApp();
  const nav = useNav();
  const names = useNames();
  const mainId = d.lists.books.find((b) => b.is_main)?.id ?? null;
  const writes = can('register.edit') || (can('book.own') && myBooks.length > 0);
  const types: TrxType[] = writes ? ['Income', 'Exp', 'Transfer', 'Exchange'] : [];
  if (fileHolder) types.splice(types.indexOf('Transfer'), 1);
  const hint: Record<TrxType, string> = {
    Income: t('مال يدخل', 'money in'),
    Exp: t('مال يخرج', 'money out'),
    Transfer: t('من دفتر إلى دفتر', 'from one book to another'),
    Exchange: t('دولار ← ليرة', 'USD → SYP'),
  };

  const syp = useMemo(() => holders(d.rows, d.lists.books, 'SYP'), [d]);
  const usd = useMemo(() => holders(d.rows, d.lists.books, 'USD'), [d]);
  const toReview = d.rows.filter((r) => r.review).length;
  const noBook = syp[syp.length - 1].shouldHold !== 0 || usd[usd.length - 1].shouldHold !== 0;
  const last = d.rows.reduce<string | null>((m, r) => (r.date && (!m || r.date > m) ? r.date : m), null);
  const unsent = fileHolder ? d.rows.filter((r) => !r.sent_at).length : 0;

  // Transfers: what I must confirm, and what I gave that is waiting or refused.
  const iReceive = (t: TransferInfo) =>
    myBooks.includes(t.to!) || (can('register.edit') && (t.to === mainId || !d.keptBooks.includes(t.to!)));
  const iGave = (t: TransferInfo) => myBooks.includes(t.from!) || (can('register.edit') && t.from === mainId);
  const toConfirm = d.transfers.filter((x) => !x.receivedAt && !x.disputedAt && iReceive(x) && !d.closed.has((x.date ?? '').slice(0, 7)));
  const waiting = d.transfers.filter((x) => !x.receivedAt && !x.disputedAt && iGave(x) && !iReceive(x));
  const disputed = d.transfers.filter((x) => x.disputedAt && (iGave(x) || iReceive(x) || can('register.edit')));

  const showAll = !limited && (can('reports.cash') || can('register.view'));

  return (
    <>
      <div className="page-head">
        <h1>{t('الرئيسية', 'Home')}</h1>
        <span className="muted small">
          {d.rows.length} {t('سطر', 'rows')} · {t('آخر تاريخ', 'last date')} {fmtDate(last)}
        </span>
      </div>

      {types.length > 0 && (
        <div className="big-actions" style={types.length === 3 ? { gridTemplateColumns: 'repeat(3, minmax(0,1fr))' } : undefined}>
          {types.map((ty) => (
            <button key={ty} className={ty} onClick={() => nav.entry(ty)}>
              {tx(TYPE_LABEL[ty])}
              <small>{hint[ty]}</small>
            </button>
          ))}
        </div>
      )}

      {toConfirm.length > 0 && (
        <div className="panel" style={{ borderColor: '#f0d68a', background: '#fffbea' }}>
          <h2>⏳ {t('للتأكيد: هل استلمتَ هذا المال؟', 'To confirm: did you receive this money?')}</h2>
          <TransferList items={toConfirm} names={names} answer onDone={reload} />
        </div>
      )}
      {disputed.length > 0 && (
        <div className="alert err">
          <b>✗ {t('تحويلات قيل إنها لم تصل', 'Transfers marked "not received"')}</b>
          <TransferList items={disputed} names={names} answer={false} onDone={reload} />
        </div>
      )}
      {waiting.length > 0 && (
        <div className="alert info">
          <b>{t('أعطيتَ، وينتظر تأكيد المستلم', 'You gave; waiting for the receiver to confirm')}</b>
          <TransferList items={waiting} names={names} answer={false} onDone={reload} />
        </div>
      )}

      {toReview > 0 && (
        <div className="alert warn row" style={{ justifyContent: 'space-between' }}>
          <span>{t(`${toReview} سطراً بحاجة إلى مراجعة`, `${toReview} rows need review`)}</span>
          <button className="btn small" onClick={() => nav.go('register', { review: true })}>{t('عرضها', 'Show them')}</button>
        </div>
      )}
      {showAll && noBook && <div className="alert err">{t('مبالغ بلا دفتر — صحّح عمود الدفتر', 'Amounts with no book — fix the Book column')}</div>}
      {fileHolder && unsent > 0 && (
        <div className="alert info row" style={{ justifyContent: 'space-between' }}>
          <span>{t(`${unsent} قيداً لم تُرسل إلى المكتب بعد`, `${unsent} entries not yet sent to the office`)}</span>
          <button className="btn small" onClick={() => nav.go('files')}>{t('تصدير', 'Export')}</button>
        </div>
      )}

      {myBooks.length > 0 && (
        <>
          <h2>{t('رصيدي', 'My balance')}</h2>
          <div className="cards" style={{ marginBottom: 18 }}>
            {myBooks.map((id) => {
              const b = holderBalance(d, id, fileHolder);
              return (
                <Balance key={id} title={names.book(id)} syp={b.syp.shouldHold} usd={b.usd.shouldHold} />
              );
            })}
          </div>
        </>
      )}

      {showAll && (
        <>
          <h2>{t('ما يجب أن يحمله كل صندوق', 'What each holder should hold')}</h2>
          <div className="cards">
            {syp.filter((l) => l.book && (l.book.active || l.shouldHold !== 0)).map((l, i) => (
              <Balance key={l.book!.id} title={l.book!.name} sub={l.book!.keeper_name} syp={l.shouldHold} usd={usd[i].shouldHold} />
            ))}
          </div>
        </>
      )}
      {s.mode === 'preview' && null}
    </>
  );
}

/** One holder's cash: pounds and dollars side by side, the same size. */
export function Balance({ title, sub, syp, usd }: { title: string; sub?: string | null; syp: number; usd: number }) {
  return (
    <div className="card balance">
      <div className="k">{title}{sub ? <span className="muted"> · {sub}</span> : null}</div>
      <div className="balance-row">
        <div className={syp < 0 ? 'neg' : ''}><span>{t('ل.س', 'SYP')}</span><b>{fmtSyp(syp)}</b></div>
        <div className={usd < 0 ? 'neg' : ''}><span>{t('دولار', 'USD')}</span><b>{fmtUsd(usd)}</b></div>
      </div>
    </div>
  );
}

/** A short list of transfers; with `answer`, the receiver's two buttons. */
export function TransferList({ items, names, answer, onDone }: { items: TransferInfo[]; names: ReturnType<typeof useNames>; answer: boolean; onDone: () => Promise<void> }) {
  const { s } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const reply = async (x: TransferInfo, ok: boolean) => {
    let note: string | null = null;
    if (!ok) {
      note = await promptBox(t('ماذا حدث؟ (مثلاً: وصلني أقل، لم يصل شيء)', 'What happened? (e.g. received less, nothing arrived)'), '');
      if (note == null) return;
    }
    setBusy(x.key);
    try {
      await s.api.call('transfer.answer', { id: x.rowIds[0], ok, note });
      await onDone();
      toast(ok ? t('شكراً — أُكِّد الاستلام', 'Thank you — receipt confirmed') : t('أُبلغ المكتب', 'The office is told'));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <table className="t" style={{ background: 'transparent' }}>
      <tbody>
        {items.map((x) => (
          <tr key={x.key}>
            <td className="nowrap">{fmtDate(x.date)}</td>
            <td>{names.book(x.from)} → {names.book(x.to)}</td>
            <td className="n"><b>{x.currency === 'SYP' ? fmtSyp(x.amount) : fmtUsd(x.amount)}</b> {x.currency}</td>
            <td className="small muted">{x.explanation}{x.disputeNote ? ` — ${x.disputeNote}` : ''}{x.createdBy ? ` · ${x.createdBy}` : ''}</td>
            {answer && (
              <td className="nowrap right">
                <button className="btn small primary" disabled={busy === x.key} onClick={() => reply(x, true)}>✓ {t('استلمت', 'Received')}</button>{' '}
                <button className="btn small danger" disabled={busy === x.key} onClick={() => reply(x, false)}>✗ {t('لم يصل', 'Not received')}</button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
