// Writing an entry, in as few taps as possible:
//   1. the amount (the currency is the last one used; one tap changes it),
//   2. the heading (large tiles, the most used first),
//   3. the line (the detail of that heading),
//   4. save.
// "Same as last time" fills everything from a recent entry. The date is today, the
// note and the claim are optional. A changed or deleted entry asks a reason.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyMenu } from '../../ui/CopyMenu';
import { confirmBox, errText, parseAmount, promptBox, toast, todayIso } from '../../ui/kit';
import { CURS, accountBooks, leafAccounts, usdValue, type CtyAccount, type CtyBook, type CtyEntry, type Cur, type EntryType } from '../domain';
import type { ClaimReason } from '../chart';
import { useCty, bookName, partLabel } from './CtyApp';
import { accName, curCode, curLong, curName, money, moneyCur, t3, triName } from './text';
import { BOOK_ICON, iconOf, tintOf } from './icons';

export interface EntryStart {
  kind: EntryType;
  /** an existing entry, to change or delete */
  edit?: CtyEntry;
  /** a copy of this entry: opens like an edit but is saved as a NEW entry (nothing is saved until he presses Save) */
  copy?: CtyEntry;
  /** the date of the copy (the same date, or today) */
  date?: string;
  /** a new entry in this book (the econome's desk; an envelope); otherwise the book on screen */
  bookId?: number;
  /** a transfer to this book (give to an envelope, put back in the house) */
  toBookId?: number;
}

const KIND_ICON: Record<EntryType, string> = { Exp: '－', Income: '＋', Exchange: '⇄', Transfer: '↔' };

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
  const ok = (a: CtyAccount) => a.active && a.type === type && ((book.cty_kind !== 'personal' && book.cty_kind !== 'personal_bank') || a.scope === 'P');
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

export function EntrySheet({ start, onClose, onCopy }: { start: EntryStart; onClose: () => void; /** open a copy of the entry being looked at */ onCopy?: (s: EntryStart) => void }) {
  const { d, book: shown, s, reload } = useCty();
  const edit = start.edit;
  const copy = start.copy;
  const src = edit ?? copy;
  /** an edit or a copy: the whole entry is shown, not the step-by-step */
  const editLike = !!src;
  // a copy of someone else's entry goes to the book on screen (he writes in his own)
  const srcBookId = copy && !d.kept.includes(copy.book_id) ? undefined : src?.book_id;
  const main = d.books.find((b) => b.id === (srcBookId ?? start.bookId)) ?? shown;
  // (an envelope on screen is the house account's: its group starts from the house)
  // one account may be several books (pocket + bank, house + envelopes): we only say from where
  const group = accountBooks(d.books, main).filter((b) => d.kept.includes(b.id) || b.id === main.id);
  const [pocketId, setPocketId] = useState<number>(main.id);
  const book = d.books.find((b) => b.id === pocketId) ?? main;
  const [kind, setKind] = useState<EntryType>(start.kind);
  const [stage, setStage] = useState<'amount' | 'heading' | 'line' | 'save'>(editLike ? 'save' : 'amount');
  const [amount, setAmount] = useState(src ? String(src.amount) : '');
  const [cur, setCur] = useState<Cur>(src?.cur ?? lastCur(s.profile.id));
  const [amount2, setAmount2] = useState(src?.amount2 ? String(src.amount2) : '');
  const [cur2, setCur2] = useState<Cur>(src?.cur2 ?? (cur === 'LOC' ? 'USD' : 'LOC'));
  const [heading, setHeading] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(src?.account_id ?? null);
  const [toBook, setToBook] = useState<number | null>(src?.to_book_id ?? start.toBookId ?? null);
  const [date, setDate] = useState(copy ? start.date ?? copy.date : edit?.date ?? todayIso());
  const [note, setNote] = useState(copy ? '' : edit?.note ?? '');
  const [claim, setClaim] = useState<ClaimReason | null>(src?.claim ?? null);
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

  // the most used headings and lines first (last 12 months; the house counts with its envelopes)
  const { order, frequent } = useMemo(() => {
    const since = `${Number(todayIso().slice(0, 4)) - 1}${todayIso().slice(4)}`;
    const mine = new Set(accountBooks(d.books, book).map((b) => b.id));
    const count = new Map<number, number>();
    const lineCount = new Map<number, number>();
    for (const e of d.entries) {
      if (!mine.has(e.book_id) || e.type !== kind || e.date < since || !e.account_id) continue;
      lineCount.set(e.account_id, (lineCount.get(e.account_id) ?? 0) + 1);
      const g = groups.find((x) => x.heading.id === e.account_id || x.lines.some((l) => l.id === e.account_id));
      if (g) count.set(g.heading.id, (count.get(g.heading.id) ?? 0) + 1);
    }
    const lc = (a: CtyAccount) => lineCount.get(a.id) ?? 0;
    const order = [...groups]
      .map((g) => ({ ...g, lines: [...g.lines].sort((a, b) => lc(b) - lc(a) || a.sort - b.sort) }))
      .sort((a, b) => (count.get(b.heading.id) ?? 0) - (count.get(a.heading.id) ?? 0) || a.heading.sort - b.heading.sort);
    const all = groups.flatMap((g) => (g.lines.length ? g.lines : [g.heading]));
    const frequent = all.filter((a) => lc(a) > 0).sort((a, b) => lc(b) - lc(a)).slice(0, 6);
    return { order, frequent };
  }, [groups, d.entries, d.books, book, kind]);

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
  const limit = book.cty_kind === 'house' || book.cty_kind === 'envelope' ? d.limits.house : book.cty_kind === 'personal' || book.cty_kind === 'personal_bank' ? d.limits.personal : 0;
  const usd = kind === 'Exp' && n > 0 ? usdValue(d.entries, cur, n, date, d.limits.startRate) : null;
  const asksSuperior = kind === 'Exp' && limit > 0 && n > 0 && (usd == null || usd >= limit) && !s.profile.perms.includes('cty.month_seen');

  // where money goes: the other books of the same account first (bank, envelopes), then the
  // econome's cash (giving back), then anyone else only if asked
  const cashBook = d.books.find((b) => b.active && b.cty_kind === 'cash');
  const siblings = group.filter((b) => b.id !== book.id);
  const [others, setOthers] = useState(false);
  const targets = d.books.filter((b) => b.active && b.id !== book.id && !siblings.some((x) => x.id === b.id) && b.cty_kind !== 'personal_bank' && b.cty_kind !== 'envelope');
  const cashToo = cashBook && cashBook.id !== book.id && !siblings.some((x) => x.id === cashBook.id);
  useEffect(() => {
    // giving back is the usual move of a Jesuit: the econome's cash is chosen already
    if (kind === 'Transfer' && !edit && toBook == null && cashToo && !d.kept.includes(cashBook!.id) && book.cty_kind === 'personal') setToBook(cashBook!.id);
  }, [kind, edit, toBook, cashToo, cashBook, d.kept, book.cty_kind]);

  // a copy cannot be saved until something differs from the entry it copies
  const sigNow = JSON.stringify([kind, book.id, date, cur, n, accountId, toBook, kind === 'Exchange' ? cur2 : null, kind === 'Exchange' ? n2 : null, (note.trim() || (copy?.note ?? '').trim())]);
  const sigCopy = copy ? JSON.stringify([copy.type, main.id, copy.date, copy.cur, copy.amount, copy.account_id, copy.to_book_id ?? null, copy.type === 'Exchange' ? copy.cur2 : null, copy.type === 'Exchange' ? copy.amount2 : null, (copy.note ?? '').trim()]) : null;
  const unchangedCopy = !!copy && sigNow === sigCopy;
  /** open a copy; a transfer sends money again, so ask first */
  const makeCopy = async (when: string | undefined) => {
    if (!edit || !onCopy) return;
    if (edit.type === 'Transfer' && !(await confirmBox(t3('نسخ تحويل يرسل المال مرة أخرى، ويجب أن يؤكّد المستلم النسخة. متابعة؟', 'Duplicating a transfer sends money again, and the receiver must confirm the copy. Continue?', 'Dupliquer un transfert envoie de l’argent une deuxième fois, et le destinataire doit confirmer la copie. Continuer ?')))) return;
    onCopy({ kind: edit.type as EntryType, copy: edit, date: when ?? edit.date });
  };

  const save = async () => {
    setErr(null);
    // a copy that looks exactly like an entry already there: ask before saving a double
    if (copy) {
      const twin = d.entries.find((x) => x.book_id === book.id && x.type === kind && x.date === date && x.cur === cur && x.amount === n && (x.account_id ?? null) === (accountId ?? null) && (x.to_book_id ?? null) === (kind === 'Transfer' ? toBook : null));
      if (twin && !(await confirmBox(t3('يوجد قيد مطابق في اليوم نفسه (المبلغ والبند والدفتر). أحفظه رغم ذلك؟', 'An identical entry already exists on that day (same amount, line and account). Save it anyway?', 'Une écriture identique existe déjà ce jour-là (même montant, ligne et compte). L’enregistrer quand même ?'), true))) return;
    }
    let reason: string | null = null;
    if (edit) {
      reason = await promptBox(t3('سبب التعديل؟', 'Why this change?', 'Pourquoi ce changement ?'));
      if (!reason) return;
    }
    setBusy(true);
    try {
      await s.api.call('cty.entry.save', {
        entry: {
          id: edit?.id, book_id: book.id, date, type: kind, cur, amount: n,
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
    { k: 'Transfer', label: t3('تحويل', 'Transfer', 'Transfert') },
  ];
  const readOnly = edit && !d.kept.includes(edit.book_id);

  return (
    <div className="cty-sheet" role="dialog">
      <div className="cty-sheet-head">
        <button className="cty-icon" onClick={onClose} aria-label="close">✕</button>
        {editLike ? <span><b>{edit ? t3('القيد', 'The entry', "L'écriture") : t3('نسخة من القيد', 'A copy of the entry', "Une copie de l'écriture")}</b>
          {edit && onCopy && (
            <CopyMenu label={t3('نسخ', 'Duplicate', 'Dupliquer')} same={t3('نسخ بالتاريخ نفسه', 'Duplicate (same date)', 'Dupliquer (même date)')} today={t3('نسخ لليوم', 'Duplicate for today', "Dupliquer pour aujourd'hui")}
              onSame={() => makeCopy(undefined)} onToday={() => makeCopy(todayIso())} />
          )}</span> : (
          <div className="cty-kinds">
            {kinds.map((x) => (
              <button key={x.k} className={`k-${x.k} ${kind === x.k ? 'on' : ''}`} onClick={() => { setKind(x.k); setStage('amount'); setAccountId(null); setHeading(null); }}>{KIND_ICON[x.k]} {x.label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="cty-sheet-title">
        <b>{s.profile.name}</b> · {triName(s.profile.access_name)} — {BOOK_ICON[main.cty_kind ?? ''] ?? ''} {main.cty_kind === 'personal' || main.cty_kind === 'personal_bank' ? t3('دفترك', 'his own account', 'son compte') : bookName(main)}
      </div>
      <div className="cty-sheet-body">
        {err && <div className="alert err">{err}</div>}
        {copy && (
          <div className={`copy-banner ${unchangedCopy ? '' : 'ok'}`}>
            <b>⧉ {t3('نسخة', 'COPY', 'COPIE')}</b> — {t3('لم تُحفظ بعد.', 'not saved yet.', 'pas encore enregistrée.')}{' '}
            {unchangedCopy ? t3('غيّر شيئاً واحداً على الأقل (المبلغ أو التاريخ أو البند أو الملاحظة) ثم احفظ.', 'Change at least one thing (amount, date, line or note), then Save.', 'Changez au moins une chose (montant, date, ligne ou note), puis enregistrez.') : t3('راجعها ثم احفظ.', 'Check it, then Save.', 'Vérifiez, puis enregistrez.')}
          </div>
        )}
        {!editLike && isLine && <div className="cty-step">{stage === 'amount' ? t3('1 · كم؟', '1 · How much?', '1 · Combien ?') : stage === 'heading' ? t3('2 · أي نوع؟', '2 · Which category?', '2 · Quelle catégorie ?') : stage === 'line' ? t3('3 · بالتفصيل', '3 · Which one exactly?', '3 · Laquelle exactement ?') : t3('4 · احفظ', '4 · Save', '4 · Enregistrer')}</div>}

        {/* 1 · the amount (and, for an exchange, what came back; for a gift, to whom) */}
        {(stage === 'amount' || editLike) && (
          <>
            {group.length > 1 && !editLike && (
              <>
                <div className="cty-label">{kind === 'Income' ? t3('قُبض في', 'Received in', 'Reçu dans') : kind === 'Transfer' ? t3('من', 'From', 'De') : t3('دُفع من', 'Paid from', 'Payé depuis')}</div>
                <div className="cty-tiles small">
                  {group.map((b) => <button key={b.id} className={pocketId === b.id ? 'on' : ''} onClick={() => { setPocketId(b.id); setToBook(null); setAccountId(null); }}>{BOOK_ICON[b.cty_kind ?? ''] ?? ''} {partLabel(b)}</button>)}
                </div>
              </>
            )}
            <AmountInput refEl={amountRef} label={kind === 'Exchange' ? t3('أعطيتُ', 'I gave', "J'ai donné") : t3('المبلغ', 'Amount', 'Montant')} value={amount} onChange={setAmount} cur={cur} onCur={setCur} local={d.local} onEnter={() => isLine && n > 0 && !editLike && setStage('heading')} />
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
                  {siblings.map((b) => <button key={b.id} className={toBook === b.id ? 'on' : ''} onClick={() => setToBook(b.id)}>{BOOK_ICON[b.cty_kind ?? ''] ?? ''} {partLabel(b)}</button>)}
                  {cashToo && <button className={toBook === cashBook!.id ? 'on' : ''} onClick={() => setToBook(cashBook!.id)}>💰 {t3('صندوق القيم', "The econome's cash", "La caisse de l'économe")}</button>}
                  {(others || (!siblings.length && !cashToo)) && targets.filter((b) => b.id !== cashBook?.id).map((b) => (
                    <button key={b.id} className={toBook === b.id ? 'on' : ''} onClick={() => setToBook(b.id)}>{bookName(b)}</button>
                  ))}
                </div>
                {!others && targets.length > 0 && <button className="cty-link" onClick={() => setOthers(true)}>{t3('إلى شخص آخر…', 'To someone else…', 'À quelqu’un d’autre…')}</button>}
                <p className="muted small">{siblings.some((b) => b.id === toBook) ? t3('بين دفاترك: لا حاجة إلى تأكيد.', 'Between your own books: no confirmation needed.', 'Entre vos propres comptes : pas de confirmation.') : t3('من يستلم يؤكّد أنه استلم.', 'The one who receives confirms he received it.', 'Celui qui reçoit confirme qu’il a reçu.')}</p>
              </>
            )}
            {!editLike && isLine && recent.length > 0 && n === 0 && (
              <>
                <div className="cty-label">{t3('مثل المرة الماضية', 'Same as last time', 'Comme la dernière fois')}</div>
                <div className="cty-chips">
                  {recent.map((e) => (
                    <button key={e.id} onClick={() => sameAsLast(e)}>{accName(d.accounts.find((a) => a.id === e.account_id))} · {moneyCur(e.amount, e.cur, d.local)}</button>
                  ))}
                </div>
              </>
            )}
            {!editLike && isLine && (
              <button className="btn primary cty-wide" disabled={!(n > 0)} onClick={() => setStage('heading')}>{t3('التالي', 'Next', 'Suivant')} ›</button>
            )}
          </>
        )}

        {/* 2 · the heading */}
        {!editLike && stage === 'heading' && (
          <>
            <Summary />
            {frequent.length > 0 && (
              <>
                <div className="cty-label">{t3('الأكثر استعمالاً', 'Most used', 'Les plus utilisés')}</div>
                <div className="cty-chips">
                  {frequent.map((a) => <button key={a.id} onClick={() => chooseLine(a)}>{iconOf(a.code)} {accName(a)}</button>)}
                </div>
                <div className="cty-label">{t3('كل البنود', 'All categories', 'Toutes les catégories')}</div>
              </>
            )}
            <div className="cty-tiles">
              {order.map(({ heading: h, lines }) => (
                <button key={h.id} className="cty-tint" style={{ background: tintOf(h.code)[0], borderColor: tintOf(h.code)[1] }} onClick={() => (lines.length ? (setHeading(h.id), setStage('line')) : chooseLine(h))}>
                  <span className="cty-tile-icon">{iconOf(h.code)}</span>
                  <span>{accName(h)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* 3 · the line */}
        {!editLike && stage === 'line' && heading != null && (
          <>
            <Summary />
            <button className="cty-back" onClick={() => setStage('heading')}>‹ {accName(d.accounts.find((a) => a.id === heading))}</button>
            <div className="cty-tiles">
              {order.find((g) => g.heading.id === heading)!.lines.map((l) => (
                <button key={l.id} className="cty-tint" style={{ background: tintOf(l.code)[0], borderColor: tintOf(l.code)[1] }} onClick={() => chooseLine(l)}><span className="cty-tile-icon">{iconOf(l.code)}</span><span>{accName(l)}</span></button>
              ))}
            </div>
          </>
        )}

        {/* 4 · save (with what is optional) */}
        {(stage === 'save' || (!isLine && stage === 'amount') || editLike) && (
          <>
            {!editLike && isLine && <Summary />}
            {editLike && isLine && (
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
              <button className="btn primary cty-wide cty-save" disabled={busy || unchangedCopy || !(n > 0) || (isLine && !accountId) || (kind === 'Transfer' && !toBook) || (kind === 'Exchange' && !(n2 > 0))} onClick={save}>
                {busy ? '…' : t3('احفظ', 'Save', 'Enregistrer')}
              </button>
            )}
            <details className="cty-more" open={editLike}>
              <summary>{t3('التاريخ، ملاحظة، مطالبة…', 'Date, note, claim…', 'Date, note, réclamation…')}</summary>
              <label className="field"><span>{t3('التاريخ', 'Date', 'Date')}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="field"><span>{t3('ملاحظة (اختيارية)', 'Note (optional)', 'Note (facultative)')}</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={copy?.note || t3('مثلاً: لماذا؟ لمن؟', 'e.g. why? for whom?', 'p. ex. pourquoi ? pour qui ?')} /></label>
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
      <div className="cty-amount-row">
        <input ref={refEl} inputMode="decimal" value={value} placeholder="0" onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} />
        <span className={`cty-cur-badge c-${cur}`}>{curCode(cur, local)}</span>
      </div>
      <div className="cty-curs wide">
        {CURS.map((c) => (
          <button key={c} className={`c-${c} ${c === cur ? 'on' : ''}`} onClick={() => onCur(c)}>
            <b>{curName(c, local)}</b>
            <small>{curLong(c, local)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The econome gives money from the community's cash to a Jesuit (or to the house). The
 * Jesuit then sees "the econome gave you … · received?" and confirms with one tap.
 */
export function GiveSheet({ onClose }: { onClose: () => void }) {
  const { d, s, reload } = useCty();
  const sources = d.books.filter((b) => b.active && (b.cty_kind === 'cash' || b.cty_kind === 'bank') && d.kept.includes(b.id));
  const [from, setFrom] = useState<number | null>(sources[0]?.id ?? null);
  const people = d.books.filter((b) => b.active && (b.cty_kind === 'personal' || b.cty_kind === 'house'));
  const [to, setTo] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [cur, setCur] = useState<Cur>('LOC');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayIso());
  const [err, setErr] = useState<string | null>(null);
  const n = parseAmount(amount);
  const save = async () => {
    setErr(null);
    try {
      await s.api.call('cty.entry.save', { entry: { book_id: from!, to_book_id: to!, date, type: 'Transfer', cur, amount: n, note } });
      await reload();
      toast(t3('أُعطي. ينتظر تأكيد من استلم.', 'Given. Waiting for the receiver to confirm.', 'Donné. En attente de la confirmation de celui qui reçoit.'));
      onClose();
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <div className="cty-sheet" role="dialog">
      <div className="cty-sheet-head"><button className="cty-icon" onClick={onClose}>✕</button><b>{t3('إعطاء مال', 'Give money', 'Donner de l’argent')}</b></div>
      <div className="cty-sheet-body">
        {err && <div className="alert err">{err}</div>}
        {sources.length > 1 && (
          <div className="cty-curs" style={{ justifyContent: 'flex-start' }}>
            {sources.map((b) => <button key={b.id} className={from === b.id ? 'on' : ''} onClick={() => setFrom(b.id)}>{bookName(b)}</button>)}
          </div>
        )}
        <div className="cty-label" style={{ marginTop: 10 }}>{t3('لمن؟', 'To whom?', 'À qui ?')}</div>
        <div className="cty-tiles small">
          {people.map((b) => <button key={b.id} className={to === b.id ? 'on' : ''} onClick={() => setTo(b.id)}>{bookName(b)}</button>)}
        </div>
        <AmountInput label={t3('المبلغ', 'Amount', 'Montant')} value={amount} onChange={setAmount} cur={cur} onCur={setCur} local={d.local} />
        <label className="field"><span>{t3('ملاحظة (اختيارية)', 'Note (optional)', 'Note (facultative)')}</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="field"><span>{t3('التاريخ', 'Date', 'Date')}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button className="btn primary cty-wide cty-save" disabled={!from || !to || !(n > 0)} onClick={save}>{t3('أعطِ', 'Give', 'Donner')}</button>
      </div>
    </div>
  );
}
