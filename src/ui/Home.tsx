import { useMemo, useState } from 'react';
import { useApp, useIcons, useNames } from '../state';
import { holders } from '../domain/reports';
import type { TransferInfo } from '../domain/transfers';
import { TYPE_LABEL, tx } from '../i18n';
import type { TrxType } from '../domain/types';
import { useNav } from './Shell';
import { errText, fmtDate, fmtSyp, fmtUsd, promptBox, t, toast } from './kit';
import { holderBalance } from './Cash';
import { needsApproval } from '../ops';
import { PersonIcon } from './icons';
import { rateOn } from '../domain/compute';
import { Envelopes } from './Envelopes';

/** The sign of each kind of movement on its button. */
export const TYPE_ICON: Record<TrxType, string> = { Exp: '−', Income: '+', Transfer: '⇄', Exchange: '💱' };

export function Home() {
  const { s, d, can, myBooks, writeBooks, limited, fileHolder, reload } = useApp();
  const nav = useNav();
  const names = useNames();
  const mainId = d.lists.books.find((b) => b.is_main)?.id ?? null;
  const writes = can('register.edit') || can('register.main') || (can('book.own') && myBooks.length > 0);
  // four equal buttons, as on the communities' home (Fouad, 19 October 2026)
  const types: TrxType[] = writes ? ['Exp', 'Income', 'Transfer', 'Exchange'] : [];
  if (fileHolder) types.splice(types.indexOf('Transfer'), 1);
  const hint: Record<TrxType, string> = {
    Income: t('مال يدخل', 'money in'),
    Exp: t('مال يخرج', 'money out'),
    Transfer: t('من دفتر إلى دفتر', 'from one book to another'),
    Exchange: t('دولار ← ليرة', 'USD → SYP'),
  };

  const syp = useMemo(() => holders(d.rows, d.shownBooks, 'SYP'), [d]);
  const usd = useMemo(() => holders(d.rows, d.shownBooks, 'USD'), [d]);
  const toReview = d.rows.filter((r) => r.review).length;
  const noBook = syp[syp.length - 1].shouldHold !== 0 || usd[usd.length - 1].shouldHold !== 0;
  const last = d.rows.reduce<string | null>((m, r) => (r.date && (!m || r.date > m) ? r.date : m), null);
  const unsent = fileHolder ? d.rows.filter((r) => !r.sent_at).length : 0;

  // Transfers: what I must confirm, and what I gave that is waiting or refused.
  const iReceive = (t: TransferInfo) =>
    myBooks.includes(t.to!) || ((can('register.edit') || can('register.main')) && t.to === mainId) || (can('register.edit') && !d.keptBooks.includes(t.to!));
  const iGave = (t: TransferInfo) => myBooks.includes(t.from!) || ((can('register.edit') || can('register.main')) && t.from === mainId);
  const toConfirm = d.transfers.filter((x) => !x.receivedAt && !x.disputedAt && iReceive(x) && !d.closed.has((x.date ?? '').slice(0, 7)));
  const waiting = d.transfers.filter((x) => !x.receivedAt && !x.disputedAt && iGave(x) && !iReceive(x));
  const disputed = d.transfers.filter((x) => x.disputedAt && (iGave(x) || iReceive(x) || can('register.edit')));

  const showAll = !limited && (can('reports.cash') || can('register.view'));
  // today's rate (the last exchange), for one total in dollars on each card
  const rateNow = useMemo(() => rateOn(d.rows, null, new Date().toISOString().slice(0, 10), d.lists.settings.usd_rate), [d.rows, d.lists.settings.usd_rate]);

  // per book: when it last changed, and its last closed month
  const lastChange = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of d.rows) {
      if (r.book_id == null) continue;
      const at = r.updated_at || r.created_at;
      if (at && (!m.has(r.book_id) || at > m.get(r.book_id)!)) m.set(r.book_id, at);
    }
    return m;
  }, [d.rows]);
  const lastClosed = (bookId: number, isMain: boolean) => {
    const yms = isMain ? [...d.closed] : d.bookMonths.filter((x) => x.book_id === bookId).map((x) => x.ym);
    return yms.sort().pop() ?? null;
  };

  // Large expenses waiting for approval (shown to whoever approves)
  const S = d.lists.settings;
  const approver = !!S.approval_on && (S.approval_profile_id ? s.profile.access_id === S.approval_profile_id : can('users.manage'));
  const toApprove = approver
    ? d.rows.filter((r) => needsApproval(S, r, d.comp.get(r.id)?.expUsdTot ?? 0) && !d.closed.has((r.date ?? '').slice(0, 7)))
    : [];

  // Months not yet closed: before this month, for my books; and for the office
  const thisMonth = new Date().toISOString().slice(0, 7);
  const openBookMonths = myBooks.flatMap((b) =>
    [...new Set(d.rows.filter((r) => r.book_id === b && r.date && r.date.slice(0, 7) < thisMonth).map((r) => r.date!.slice(0, 7)))]
      .filter((ym) => !d.bookClosed.has(`${b}|${ym}`) && !d.closed.has(ym)).map((ym) => ({ b, ym })));
  const openOffice = can('month.close')
    ? [...new Set(d.rows.filter((r) => r.date && r.date.slice(0, 7) < thisMonth).map((r) => r.date!.slice(0, 7)))].filter((ym) => !d.closed.has(ym)).sort()
    : [];

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
              <span className="big-icon" aria-hidden="true">{TYPE_ICON[ty]}</span>
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

      {toApprove.length > 0 && <ApproveList rows={toApprove} />}

      {openBookMonths.length > 0 && (
        <div className="alert warn row" style={{ justifyContent: 'space-between' }}>
          <span>🔓 {t('أشهر لم تُغلق بعد لدفترك', 'Months not yet closed for your book')}: {openBookMonths.map((x) => `${x.ym}${myBooks.length > 1 ? ` (${names.book(x.b)})` : ''}`).join('، ')}</span>
          <button className="btn small" onClick={() => nav.go('admin')}>{t('إغلاق', 'Close')}</button>
        </div>
      )}
      {openOffice.length > 0 && (
        <div className="alert info row" style={{ justifyContent: 'space-between' }}>
          <span>🔓 {t('أشهر لم يغلقها المكتب بعد', 'Months the office has not closed yet')}: <span className="ltr">{openOffice.join(', ')}</span></span>
          <button className="btn small" onClick={() => nav.go('admin')}>{t('إغلاق الأشهر', 'Month closing')}</button>
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
          <h2>{t('حالة دفتري', 'My book status')}</h2>
          <div className="cards" style={{ marginBottom: 18 }}>
            {myBooks.filter((id) => d.lists.books.find((x) => x.id === id)?.parent_id == null).map((id) => {
              const b = holderBalance(d, id, fileHolder);
              const main = !!d.lists.books.find((x) => x.id === id)?.is_main;
              return (
                <Balance key={id} rate={rateNow} title={names.book(id)} syp={b.syp.shouldHold} usd={b.usd.shouldHold} main={main} lastChange={lastChange.get(id) ?? null} lastClosed={lastClosed(id, main)} onOpen={() => nav.go('register', { book: id })} />
              );
            })}
          </div>
        </>
      )}

      {/* envelopes for every book he writes in: his own, Main for those who write there, even a private book */}
          {!fileHolder && [...new Set([...myBooks, ...writeBooks, ...(can('register.edit') && mainId != null ? [mainId] : [])])].filter((id) => d.lists.books.find((x) => x.id === id)?.parent_id == null).map((id) => (
            <Envelopes key={`env${id}`} bookId={id} onEntry={nav.entry} />
          ))}

      {showAll && (
        <>
          <h2>{t('حالة الدفاتر', 'Book status')}</h2>
          <p className="muted small" style={{ marginTop: -6 }}>{t('ما يجب أن يحمله كل صندوق الآن.', 'What each holder should hold now.')}</p>
          <div className="cards">
            {syp.filter((l) => l.book && (l.book.active || l.shouldHold !== 0)).map((l, i) => (
              <Balance key={l.book!.id} rate={rateNow} title={l.book!.name} sub={l.book!.keeper_name} syp={l.shouldHold} usd={usd[i].shouldHold}
                main={!!l.book!.is_main} lastChange={lastChange.get(l.book!.id) ?? null} lastClosed={lastClosed(l.book!.id, !!l.book!.is_main)} onOpen={() => nav.go('register', { book: l.book!.id })} />
            ))}
          </div>
        </>
      )}
      {s.mode === 'preview' && null}
    </>
  );
}

/** The approver's list: large expenses waiting for approval. */
function ApproveList({ rows }: { rows: import('../domain/types').Trx[] }) {
  const { s, d, reload } = useApp();
  const names = useNames();
  const icons = useIcons();
  const [busy, setBusy] = useState(false);
  const approve = async (ids: string[]) => {
    setBusy(true);
    try {
      await s.api.call('trx.approve', { ids });
      await reload();
      toast(t('تمت الموافقة', 'Approved'));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" style={{ borderColor: '#f0d68a', background: '#fffbea' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>✓ {t('نفقات كبيرة تنتظر موافقتك', 'Large expenses waiting for your approval')}</h2>
        {rows.length > 1 && <button className="btn small primary" disabled={busy} onClick={() => approve(rows.map((r) => r.id))}>{t(`الموافقة على الكل (${rows.length})`, `Approve all (${rows.length})`)}</button>}
      </div>
      <table className="t" style={{ background: 'transparent' }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{fmtDate(r.date)}</td>
              <td>{names.book(r.book_id)}</td>
              <td>{icons.line(r.line_id)} {names.line(r.line_id)}<div className="muted small">{r.explanation}</div></td>
              <td className="n nowrap"><b>{r.exp_usd ? `${fmtUsd(r.exp_usd)} USD` : `${fmtSyp(r.exp_syp)} SYP`}</b><div className="muted small">≈ ${fmtUsd(d.comp.get(r.id)?.expUsdTot ?? 0)}</div></td>
              <td className="small muted">{d.attachments.some((a) => a.trx_id === r.id) ? '📎' : t('بلا مستند', 'no document')}</td>
              <td className="right"><button className="btn small primary" disabled={busy} onClick={() => approve([r.id])}>✓ {t('موافقة', 'Approve')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One book: who holds it, pounds and dollars side by side, when it last changed, its last closed month. */
export function Balance({ title, sub, syp, usd, main, lastChange, lastClosed, onOpen, rate }: {
  title: string; sub?: string | null; syp: number; usd: number; main?: boolean; lastChange?: string | null; lastClosed?: string | null;
  /** today's rate (SYP for $1): gives the one total in dollars */
  rate?: number;
  /** open this book's register */
  onOpen?: () => void;
}) {
  const when = lastChange ? new Date(lastChange) : null;
  return (
    <div className={`card balance ${onOpen ? 'clickable' : ''}`} onClick={onOpen} role={onOpen ? 'button' : undefined}
      title={onOpen ? t('افتح سجل هذا الدفتر', "Open this book's register") : undefined}>
      <div className="balance-head">
        <PersonIcon kind={main ? 'office' : 'holder'} />
        <div>
          <div className="balance-title">{title}</div>
          {sub ? <div className="muted small">{sub}</div> : null}
        </div>
      </div>
      <div className="balance-row">
        <div className={syp < 0 ? 'neg' : ''}><span>{t('ل.س', 'SYP')}</span><b>{fmtSyp(syp)}</b></div>
        <div className={usd < 0 ? 'neg' : ''}><span>{t('دولار', 'USD')}</span><b>{fmtUsd(usd)}</b></div>
      </div>
      {rate ? <div className="balance-usd muted small">≈ <b className="ltr">{fmtUsd(usd + syp / rate)} $</b> {t('الكل بالدولار', 'all in dollars')}</div> : null}
      {(lastChange !== undefined || lastClosed !== undefined) && (
        <div className="balance-foot">
          <span title={lastChange ?? ''}>✎ {t('آخر تعديل', 'Last change')}: <span className="ltr">{when ? `${fmtDate(lastChange!.slice(0, 10))} ${when.toTimeString().slice(0, 5)}` : '—'}</span></span>
          <span>🔒 {t('آخر شهر مغلق', 'Last month closed')}: <span className="ltr">{lastClosed ?? '—'}</span></span>
        </div>
      )}
      {onOpen && <div className="balance-open">{t('السجل ›', 'Register ›')}</div>}
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
