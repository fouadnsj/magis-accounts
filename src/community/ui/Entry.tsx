// Writing an entry, in as few taps as possible:
//   1. the amount (the currency is the last one used; one tap changes it),
//   2. the heading (large tiles, the most used first),
//   3. the line (the detail of that heading),
//   4. save.
// "Same as last time" fills everything from a recent entry. The date is today, the
// note and the claim are optional. A changed or deleted entry asks a reason.
import { useEffect, useMemo, useRef, useState } from 'react';
import { confirmBox, errText, parseAmount, promptBox, toast, todayIso } from '../../ui/kit';
import { CURS, leafAccounts, usdValue, type CtyAccount, type CtyBook, type CtyEntry, type Cur, type EntryType } from '../domain';
import type { ClaimReason } from '../chart';
import { useCty, bookName } from './CtyApp';
import { accName, curName, money, moneyCur, t3 } from './text';

export interface EntryStart {
  kind: EntryType;
  /** an existing entry, to change or delete */
  edit?: CtyEntry;
}

const ICONS: [string, string][] = [
  ['611', '🍞'], ['612', '📚'], ['613', '👕'], ['614', '⚕️'], ['615', '🤲'], ['616', '🕯️'],
  ['6201', '🚗'], ['6202', '🪑'], ['6203', '🧰'], ['6205', '🚌'], ['6206', '🏠'], ['6207', '👥'], ['6208', '⛪'], ['6209', '📑'], ['6210', '☎️'],
  ['631', '💡'], ['632', '💧'], ['633', '🔥'], ['634', '📡'], ['635', '🛡️'], ['636', '⚙️'],
  ['641', '🤝'], ['642', '🧾'], ['643', '🤝'], ['651', '🏗️'], ['652', '✈️'], ['653', '🏗️'], ['659', '•'], ['671', '🏦'],
  ['711', '🧓'], ['712', '💼'], ['713', '✝️'], ['714', '✍️'], ['716', '⛪'], ['717', '🙏'], ['718', '🛏️'], ['719', '•'],
  ['721', '🎁'], ['722', '🎁'], ['723', '🛒'], ['724', '•'], ['73', '🏛️'],
];
const iconOf = (code: string) => ICONS.find(([p]) => code.startsWith(p))?.[1] ?? '•';

const lastCurKey = (id: number) => `cty-cur-${id}`;
function lastCur(id: number): Cur {
  try {
    const v = localStorage.getItem(lastCurKey(id));
    return (CURS as readonly string[]).includes(v ?? '') ? (v as Cur) : 'LOC';
  } catch {
    return 'LOC';
  }
}
function keepCur(id: number, c: Cur) {
  try { localStorage.setItem(lastCurKey(id), c); } catch { /* no storage */ }
}

/** Which lines a book offers: a personal book the personal lines; the house and the econome's books all. */
export function offered(accounts: CtyAccount[], book: CtyBook, type: 'Income' | 'Exp') {
  const ok = (a: CtyAccount) => a.active && a.type === type && (book.cty_kind !== 'personal' || a.scope === 'P');
  const leaves = leafAccounts(accounts).filter(ok);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const headingOfLeaf = (a: CtyAccount): CtyAccount => {
    let h = a;
    while (h.parent_id != null && byId.get(h.parent_id)?.parent_id != null) h = byId.get(h.parent_id)!;
    return h;
  };
  const headings = new Map<number, { heading: CtyAccount; lines: CtyAccount[] }>();
  for (const l of leaves) {
    const h = headingOfLeaf(l);
    const g = headings.get(h.id) ?? { heading: h, lines: [] };
    if (l.id !== h.id) g.lines.push(l);
    headings.set(h.id, g);
  }
  return [...headings.values()];
}

export function EntrySheet({ start, onClose }: { start: EntryStart; onClose: () => void }) {
  const { d, book, s, reload } = useCty();
  const edit = start.edit;
  const [kind, setKind] = useState<EntryType>(start.kind);
  const [stage, setStage] = useState<'amount' | 'heading' | 'line' | 'save'>(edit ? 'save' : 'amount');
  const [amount, setAmount] = useState(edit ? String(edit.amount) : '');
  const [cur, setCur] = useState<Cur>(edit?.cur ?? lastCur(s.profile.id));
  const [amount2, setAmount2] = useState(edit?.amount2 ? String(edit.amount2) : '');
  const [cur2, setCur2] = useState<Cur>(edit?.cur2 ?? (cur === 'LOC' ? 'USD' : 'LOC'));
  const [heading, setHeading] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(edit?.account_id ?? null);
  const [toBook, setToBook] = useState<number | null>(edit?.to_book_id ?? null);
  const [date, setDate] = useState(edit?.date ?? todayIso());
  const [note, setNote] = useState(edit?.note ?? '');
  const [claim, setClaim] = useState<ClaimReason | null>(edit?.claim ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (stage === 'amount') setTimeout(() => amountRef.current?.focus(), 50);
  }, [stage, kind]);

  const n = parseAmount(amount);
  const n2 = parseAmount(amount2);
  const isLine = kind === 'Exp' || kind === 'Income';
  const groups = useMemo(() => (isLine ? offered(d.accounts, book, kind as 'Income' | 'Exp') : []), [d.accounts, book, kind, isLine]);

  // the most used headings of this book first (last 12 months)
  const order = useMemo(() => {
    const since = `${Number(todayIso().slice(0, 4)) - 1}${todayIso().slice(4)}`;
    const count = new Map<number, number>();
    for (const e of d.entries) {
      if (e.book_id !== book.id || e.type !== kind || e.date < since) continue;
      const g = groups.find((x) => x.heading.id === e.account_id || x.lines.some((l) => l.id === e.account_id));
      if (g) count.set(g.heading.id, (count.get(g.heading.id) ?? 0) + 1);
    }
    return [...groups].sort((a, b) => (count.get(b.heading.id) ?? 0) - (count.get(a.heading.id) ?? 0) || a.heading.sort - b.heading.sort);
  }, [groups, d.entries, book.id, kind]);

  // "same as last time": the last different lines used in this book
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: CtyEntry[] = [];
    for (const e of [...d.entries].reverse()) {
      if (e.book_id !== book.id || e.type !== kind || !e.account_id) continue;
      const k = `${e.account_id}|${e.cur}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
      if (out.length >= 4) break;
    }
    return out;
  }, [d.entries, book.id, kind]);

  const acc = d.accounts.find((a) => a.id === accountId);
  const chooseLine = (a: CtyAccount) => {
    setAccountId(a.id);
    if (kind === 'Exp' && !edit) setClaim(a.claim ?? null);
    setStage('save');
  };

  // will the Superior be asked?
  const limit = book.cty_kind === 'house' ? d.limits.house : book.cty_kind === 'personal' ? d.limits.personal : 0;
  const usd = kind === 'Exp' && n > 0 ? usdValue(d.entries, cur, n, date, d.limits.startRate) : null;
  const asksSuperior = kind === 'Exp' && limit > 0 && n > 0 && (usd == null || usd >= limit) && !s.profile.perms.includes('cty.month_seen');

  // where money can be given: the econome's cash first, then the others
  const targets = d.books.filter((b) => b.active && b.id !== book.id).sort((a, b) => (a.cty_kind === 'cash' ? -1 : b.cty_kind === 'cash' ? 1 : 0));

  const save = async () => {
    setErr(null);
    let reason: string | null = null;
    if (edit) {
      reason = await promptBox(t3('سبب التعديل؟', 'Why this change?', 'Pourquoi ce changement ?'));
      if (!reason) return;
    }
    setBusy(true);
    try {
      await s.api.call('cty.entry.save', {
        entry: {
          id: edit?.id, book_id: edit?.book_id ?? book.id, date, type: kind, cur, amount: n,
          account_id: isLine ? accountId : null,
          to_book_id: kind === 'Transfer' ? toBook : null,
          cur2: kind === 'Exchange' ? cur2 : null, amount2: kind === 'Exchange' ? n2 : null,
          note, claim: kind === 'Exp' ? claim : null,
        },
        reason,
      });
      keepCur(s.profile.id, cur);
      await reload();
      toast(asksSuperior ? t3('حُفظ. سيُطلب رأي الرئيس.', 'Saved. The Superior will be asked.', 'Enregistré. Le Supérieur sera consulté.') : t3('حُفظ ✓', 'Saved ✓', 'Enregistré ✓'));
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!edit) return;
    if (!(await confirmBox(t3('حذف هذا القيد؟', 'Delete this entry?', 'Supprimer cette écriture ?'), true))) return;
    const reason = await promptBox(t3('سبب الحذف؟', 'Why delete it?', 'Pourquoi la supprimer ?'));
    if (!reason) return;
    try {
      await s.api.call('cty.entry.delete', { id: edit.id, reason });
      await reload();
      onClose();
    } catch (e) {
      setErr(errText(e));
    }
  };

  const sameAsLast = (e: CtyEntry) => {
    setAmount(String(e.amount));
    setCur(e.cur);
    setAccountId(e.account_id);
    setClaim(e.claim);
    setNote('');
    setStage('save');
  };

  const kinds: { k: EntryType; label: string }[] = [
    { k: 'Exp', label: t3('صرفتُ', 'I spent', "J'ai dépensé") },
    { k: 'Income', label: t3('قبضتُ', 'I received', "J'ai reçu") },
    { k: 'Exchange', label: t3('صرافة', 'Exchange', 'Change') },
    { k: 'Transfer', label: t3('أعطيتُ', 'I gave', "J'ai donné") },
  ];
  const readOnly = edit && !(d.kept.includes(edit.book_id) || s.profile.perms.includes('cty.write_all'));

  return (
    <div className="cty-sheet" role="dialog">
      <div className="cty-sheet-head">
        <button className="cty-icon" onClick={onClose} aria-label="close">✕</button>
        {edit ? <b>{t3('القيد', 'The entry', "L'écriture")}</b> : (
          <div className="cty-kinds">
            {kinds.map((x) => (
              <button key={x.k} className={kind === x.k ? 'on' : ''} onClick={() => { setKind(x.k); setStage('amount'); setAccountId(null); setHeading(null); }}>{x.label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="cty-sheet-body">
        {err && <div className="alert err">{err}</div>}

        {/* 1 · the amount (and, for an exchange, what came back; for a gift, to whom) */}
        {(stage === 'amount' || edit) && (
          <>
            <AmountInput refEl={amountRef} label={kind === 'Exchange' ? t3('أعطيتُ', 'I gave', "J'ai donné") : t3('المبلغ', 'Amount', 'Montant')} value={amount} onChange={setAmount} cur={cur} onCur={setCur} local={d.local} onEnter={() => isLine && n > 0 && !edit && setStage('heading')} />
            {kind === 'Exchange' && (
              <AmountInput label={t3('استلمتُ', 'I received', "J'ai reçu")} value={amount2} onChange={setAmount2} cur={cur2} onCur={setCur2} local={d.local} />
            )}
            {kind === 'Exchange' && n > 0 && n2 > 0 && cur !== cur2 && (
              <p className="muted small">{t3('السعر', 'Rate', 'Taux')}: 1 {curName(cur === 'LOC' ? cur2 : cur, d.local)} = {money(cur === 'LOC' ? n / n2 : n2 / n, 'LOC')} {curName('LOC', d.local)}</p>
            )}
            {kind === 'Transfer' && (
              <>
                <div className="cty-label">{t3('إلى', 'To', 'À')}</div>
                <div className="cty-tiles small">
                  {targets.map((b) => (
                    <button key={b.id} className={toBook === b.id ? 'on' : ''} onClick={() => setToBook(b.id)}>{bookName(b)}</button>
                  ))}
                </div>
              </>
            )}
            {!edit && isLine && recent.length > 0 && n === 0 && (
              <>
                <div className="cty-label">{t3('مثل المرة الماضية', 'Same as last time', 'Comme la dernière fois')}</div>
                <div className="cty-chips">
                  {recent.map((e) => (
                    <button key={e.id} onClick={() => sameAsLast(e)}>{accName(d.accounts.find((a) => a.id === e.account_id))} · {moneyCur(e.amount, e.cur, d.local)}</button>
                  ))}
                </div>
              </>
            )}
            {!edit && isLine && (
              <button className="btn primary cty-wide" disabled={!(n > 0)} onClick={() => setStage('heading')}>{t3('التالي', 'Next', 'Suivant')} ›</button>
            )}
          </>
        )}

        {/* 2 · the heading */}
        {!edit && stage === 'heading' && (
          <>
            <Summary />
            <div className="cty-tiles">
              {order.map(({ heading: h, lines }) => (
                <button key={h.id} onClick={() => (lines.length ? (setHeading(h.id), setStage('line')) : chooseLine(h))}>
                  <span className="cty-tile-icon">{iconOf(h.code)}</span>
                  <span>{accName(h)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* 3 · the line */}
        {!edit && stage === 'line' && heading != null && (
          <>
            <Summary />
            <button className="cty-back" onClick={() => setStage('heading')}>‹ {accName(d.accounts.find((a) => a.id === heading))}</button>
            <div className="cty-tiles">
              {order.find((g) => g.heading.id === heading)!.lines.map((l) => (
                <button key={l.id} onClick={() => chooseLine(l)}><span>{accName(l)}</span><small className="muted">{l.code}</small></button>
              ))}
            </div>
          </>
        )}

        {/* 4 · save (with what is optional) */}
        {(stage === 'save' || (!isLine && stage === 'amount') || edit) && (
          <>
            {!edit && isLine && <Summary />}
            {edit && isLine && (
              <label className="field">
                <span>{t3('البند', 'Line', 'Ligne')}</span>
                <select value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value) || null)}>
                  {groups.map((g) => (
                    <optgroup key={g.heading.id} label={accName(g.heading)}>
                      {(g.lines.length ? g.lines : [g.heading]).map((l) => <option key={l.id} value={l.id}>{l.code} · {accName(l)}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            {asksSuperior && (
              <div className="alert info">
                ⏳ {usd == null
                  ? t3('لا نعرف السعر بعد: سيُطلب رأي الرئيس.', 'No rate known yet: the Superior will be asked.', 'Pas encore de taux : le Supérieur sera consulté.')
                  : t3(`نحو $${money(usd, 'USD')}، فوق $${limit}: سيُطلب رأي الرئيس.`, `About $${money(usd, 'USD')}, above $${limit}: the Superior will be asked.`, `Environ ${money(usd, 'USD')} $, au-delà de ${limit} $ : le Supérieur sera consulté.`)}
              </div>
            )}
            {!readOnly && (
              <button className="btn primary cty-wide cty-save" disabled={busy || !(n > 0) || (isLine && !accountId) || (kind === 'Transfer' && !toBook) || (kind === 'Exchange' && !(n2 > 0))} onClick={save}>
                {busy ? '…' : t3('احفظ', 'Save', 'Enregistrer')}
              </button>
            )}
            <details className="cty-more" open={!!edit}>
              <summary>{t3('التاريخ، ملاحظة، مطالبة…', 'Date, note, claim…', 'Date, note, réclamation…')}</summary>
              <label className="field"><span>{t3('التاريخ', 'Date', 'Date')}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="field"><span>{t3('ملاحظة (اختيارية)', 'Note (optional)', 'Note (facultative)')}</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t3('مثلاً: لماذا؟ لمن؟', 'e.g. why? for whom?', 'p. ex. pourquoi ? pour qui ?')} /></label>
              {kind === 'Exp' && (
                <label className="cty-check">
                  <input type="checkbox" checked={!!claim} onChange={(e) => setClaim(e.target.checked ? acc?.claim ?? 'other' : null)} />
                  <span>{t3('أطالب الإقليم بها', 'To claim from the Province', 'À réclamer à la Province')}</span>
                  {claim && (
                    <select value={claim} onChange={(e) => setClaim(e.target.value as ClaimReason)}>
                      <option value="health">{t3('صحة', 'Health', 'Santé')}</option>
                      <option value="scholastic">{t3('إقامة دارس', 'A scholastic’s stay', 'Séjour d’un scolastique')}</option>
                      <option value="provincial">{t3('بطلب من الإقليمي', 'Asked by the Provincial', 'Demandé par le Provincial')}</option>
                      <option value="other">{t3('غير ذلك', 'Other', 'Autre')}</option>
                    </select>
                  )}
                </label>
              )}
            </details>
            {edit && !readOnly && <button className="btn ghost danger cty-wide" onClick={remove}>{t3('حذف…', 'Delete…', 'Supprimer…')}</button>}
          </>
        )}
      </div>
    </div>
  );

  function Summary() {
    return (
      <div className="cty-summary">
        <b>{moneyCur(n, cur, d.local)}</b>
        {acc && <span> · {accName(acc)}</span>}
        <button className="cty-link" onClick={() => setStage('amount')}>{t3('تغيير', 'change', 'changer')}</button>
      </div>
    );
  }
}

function AmountInput({ label, value, onChange, cur, onCur, local, onEnter, refEl }: {
  label: string; value: string; onChange: (v: string) => void; cur: Cur; onCur: (c: Cur) => void; local: string;
  onEnter?: () => void; refEl?: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="cty-amount">
      <div className="cty-label">{label}</div>
      <input ref={refEl} inputMode="decimal" value={value} placeholder="0" onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} />
      <div className="cty-curs">
        {CURS.map((c) => <button key={c} className={c === cur ? 'on' : ''} onClick={() => onCur(c)}>{curName(c, local)}</button>)}
      </div>
    </div>
  );
}
