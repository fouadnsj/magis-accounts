// The entry form: the only way a movement enters the register.
// Every rule of validate.ts is checked before saving; warnings need a second click.
import { grantFlows } from '../domain/grants';
import { needsApproval, needsDoc } from '../ops';
import { draftFor, draftKey, dropDraft, keepDraft } from './draft';
import { useEffect, useMemo, useState } from 'react';
import { DocsPanel, uploadPending, type PendingDoc } from './Docs';
import { useApp } from '../state';
import { blankTrx } from '../db/repo';
import { validateTrx } from '../domain/validate';
import { lastTypedRate, rateOn } from '../domain/compute';
import type { Trx, TrxType } from '../domain/types';
import { TYPE_LABEL, tx, type Msg } from '../i18n';
import { Combo, Field, Modal, Msgs, Seg, Select, promptBox, errText, fmtDate, fmtRate, fmtUsd, parseAmount, t, toast, todayIso, type Option } from './kit';

type Cur = 'SYP' | 'USD';

interface FormState {
  type: TrxType;
  date: string;
  bookId: number | null;
  accountId: number | null;
  cityId: number | null;
  headingId: number | null;
  lineId: number | null;
  partyId: number | null;
  explanation: string;
  receipt: string;
  currency: Cur | null;
  amount: string;
  fromBook: number | null;
  toBook: number | null;
  usd: string;
  syp: string;
  /** a transfer from the Superior's (private) book: the grant the money comes from */
  grantId?: string | null;
  /** building sites: the bill's date (empty = the payment date) and the rate typed (empty = the last rate) */
  billDate?: string;
  rate?: string;
}

const remember = (k: string, v: string | number | null) => {
  try {
    if (v == null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, String(v));
  } catch {
    /* ignore */
  }
};
const recall = (k: string) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};

export function EntryForm({ start, onClose: close }: { start: TrxType | Trx; onClose: () => void }) {
  const app = useApp();
  const onClose = () => {
    dropDraft();
    close();
  };
  const { d, s, reload, can, writeBooks: myBooks, fileHolder } = app;
  const L = d.lists;
  /** a building-site database: USD and SYP on one row, bill date, typed rate, cancel instead of delete */
  const building = !!L.settings.building;
  const editing = typeof start === 'object' ? start : null;
  const cancelled = !!editing?.cancelled_at;
  const mainId = L.books.find((b) => b.is_main)?.id ?? null;
  /** Without "write in every book", a person writes only in the books he keeps. */
  const restricted = !can('register.edit');

  // The other row of a keeper-to-keeper transfer, and the transfer as a whole.
  const partner = editing?.transfer_group ? d.rows.find((r) => r.transfer_group === editing.transfer_group && r.id !== editing.id) ?? null : null;
  const transfer = editing?.type === 'Transfer' ? d.transfers.find((x) => x.rowIds.includes(editing.id)) ?? null : null;
  const lockedTransfer = !!(restricted && transfer && (transfer.receivedAt || !myBooks.includes(transfer.from!)));
  const bookLocked = !!(restricted && editing?.date && d.bookClosed.has(`${editing.book_id}|${editing.date.slice(0, 7)}`));
  // a row of a book he may not write in: shown, not changed
  const notMine = !!(restricted && editing && editing.type !== 'Transfer' && !myBooks.includes(editing.book_id!));
  const readOnly = !!(fileHolder && editing?.sent_at) || lockedTransfer || bookLocked || notMine || cancelled;

  // a transfer is always under the heading and line "Transfer" (details in the explanation)
  const transferClass = (): [number | null, number | null] => {
    const h = L.headings.find((x) => x.name.toLowerCase() === 'transfer') ?? L.headings.find((x) => L.headingTypes.some((ht) => ht.heading_id === x.id && ht.type === 'Transfer'));
    const l = h ? L.lines.find((x) => x.heading_id === h.id && x.name.toLowerCase() === 'transfer') ?? L.lines.find((x) => x.heading_id === h.id) : undefined;
    return [h?.id ?? null, l?.id ?? null];
  };
  const usual = (type: TrxType) => {
    if (type === 'Transfer') return transferClass();
    // Exchange: the heading and line most often used for that type.
    const count = new Map<string, number>();
    for (const r of d.rows) if (r.type === type && r.heading_id != null && r.line_id != null) {
      const k = `${r.heading_id}|${r.line_id}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    let best: string | null = null;
    for (const [k, c] of count) if (!best || c > count.get(best)!) best = k;
    if (best) return best.split('|').map(Number) as [number, number];
    const h = L.headingTypes.find((x) => x.type === type)?.heading_id ?? null;
    const l = h == null ? null : L.lines.find((x) => x.heading_id === h && x.active)?.id ?? null;
    return [h, l] as [number | null, number | null];
  };

  const initial = (): FormState => {
    if (editing) {
      const tr = editing;
      const base: FormState = {
        type: tr.type ?? 'Exp', date: tr.date ?? '', bookId: tr.book_id, accountId: tr.account_id, cityId: tr.city_id,
        headingId: tr.heading_id, lineId: tr.line_id, partyId: tr.party_id, explanation: tr.explanation ?? '', receipt: tr.receipt ?? '',
        currency: null, amount: '', fromBook: null, toBook: null, usd: '', syp: '', grantId: tr.grant_id ?? null,
      };
      const amt = tr.inc_syp || tr.exp_syp ? ['SYP', tr.inc_syp || tr.exp_syp] : tr.inc_usd || tr.exp_usd ? ['USD', tr.inc_usd || tr.exp_usd] : [null, 0];
      if (tr.type === 'Income' || tr.type === 'Exp' || !tr.type) {
        base.currency = amt[0] as Cur | null;
        base.amount = amt[1] ? String(amt[1]) : '';
      }
      if (building) {
        base.billDate = tr.bill_date ?? '';
        base.rate = tr.rate ? String(tr.rate) : '';
        if (tr.type === 'Income' || tr.type === 'Exp') {
          base.usd = tr.inc_usd || tr.exp_usd ? String(tr.inc_usd || tr.exp_usd) : '';
          base.syp = tr.inc_syp || tr.exp_syp ? String(tr.inc_syp || tr.exp_syp) : '';
        }
      }
      if (tr.type === 'Exchange') {
        base.usd = tr.trf_usd ? String(tr.trf_usd) : '';
        base.syp = tr.trf_syp ? String(tr.trf_syp) : '';
      }
      if (tr.type === 'Transfer') {
        [base.headingId, base.lineId] = transferClass();
        const v = tr.trf_syp || tr.trf_usd;
        base.currency = tr.trf_syp ? 'SYP' : tr.trf_usd ? 'USD' : null;
        base.amount = v ? String(Math.abs(v)) : '';
        if (partner) {
          const out = v < 0 ? tr : partner;
          const inn = v < 0 ? partner : tr;
          base.fromBook = out.book_id;
          base.toBook = inn.book_id;
        } else if (v < 0) {
          base.fromBook = tr.book_id;
          base.toBook = mainId;
        } else {
          base.fromBook = mainId;
          base.toBook = tr.book_id;
        }
      }
      return base;
    }
    const type = start as TrxType;
    const bookId = restricted ? myBooks[0] ?? null : Number(recall('lastBook')) || L.settings.def_book_id || mainId;
    const book = L.books.find((b) => b.id === bookId);
    const [h, l] = type === 'Transfer' || type === 'Exchange' ? usual(type) : [null, null];
    return {
      type, date: recall('lastDate') ?? todayIso(), bookId,
      accountId: Number(recall('lastAccount')) || book?.account_id || L.settings.def_account_id,
      cityId: book?.city_id ?? L.settings.def_city_id,
      headingId: h, lineId: l, partyId: null, explanation: '', receipt: '', currency: null, amount: '',
      fromBook: restricted ? myBooks[0] ?? null : mainId, toBook: null, usd: '', syp: '', billDate: '', rate: '',
    };
  };

  const key = draftKey(app.s);
  const [f, setF] = useState<FormState>(() => (draftFor(key)?.form as FormState | undefined) ?? initial());
  // kept in memory while typing: a sign-out for inactivity does not lose it
  useEffect(() => {
    keepDraft(key, start, f);
  }, [key, start, f]);
  const [errors, setErrors] = useState<Msg[]>([]);
  const [warnings, setWarnings] = useState<Msg[]>([]);
  const [warnAccepted, setWarnAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingDoc[]>([]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setWarnAccepted(false);
    setWarnings([]);
  };

  const opts = <T extends { id: number; name: string; active: number }>(arr: T[], current: number | null): Option[] =>
    arr.filter((x) => x.active || x.id === current).map((x) => ({ value: x.id, label: x.name, off: !x.active }));
  const headingOpts = useMemo(
    () =>
      L.headings
        .filter((h) => L.headingTypes.some((x) => x.heading_id === h.id && x.type === f.type) && (h.active || h.id === f.headingId))
        .map((h) => ({ value: h.id, label: `${h.name}`, off: !h.active })),
    [L, f.type, f.headingId],
  );
  const lineOpts = useMemo(
    () => L.lines.filter((l) => l.heading_id === f.headingId && (l.active || l.id === f.lineId)).map((l) => ({ value: l.id, label: l.name, off: !l.active })),
    [L, f.headingId, f.lineId],
  );
  const bookOpts = opts(L.books, f.bookId);
  // A restricted person writes in, and gives from, his own books only.
  const myBookOpts = restricted ? bookOpts.filter((o) => myBooks.includes(o.value)) : bookOpts;

  const switchType = (type: TrxType) => {
    const [h, l] = type === 'Transfer' || type === 'Exchange' ? usual(type) : [null, null];
    setF((x) => ({ ...x, type, headingId: h, lineId: l }));
    setErrors([]);
    setWarnings([]);
  };

  // ---------------------------------------------------------------- build the row(s)
  const build = (): { rows: Trx[]; deletes: string[]; formErrors: Msg[] } => {
    const formErrors: Msg[] = [];
    const base = (id?: string): Trx => ({
      ...(id ? d.rows.find((r) => r.id === id)! : blankTrx()),
      city_id: f.cityId, account_id: f.accountId, date: f.date || null, type: f.type,
      heading_id: f.headingId, line_id: f.lineId, explanation: f.explanation.trim() || null,
      party_id: f.partyId, receipt: f.receipt.trim() || null,
      inc_syp: 0, exp_syp: 0, inc_usd: 0, exp_usd: 0, trf_syp: 0, trf_usd: 0, review: null,
    });
    const amount = parseAmount(f.amount);
    if (Number.isNaN(amount)) formErrors.push({ ar: 'المبلغ غير مفهوم', en: 'The amount is not a number' });

    if (building && (f.type === 'Income' || f.type === 'Exp')) {
      // a bill may be paid partly in dollars and partly in pounds; the rate: typed, or the last one
      const t1 = base(editing?.id);
      t1.book_id = f.bookId;
      const usd = parseAmount(f.usd) || 0;
      const syp = parseAmount(f.syp) || 0;
      if (Number.isNaN(parseAmount(f.usd)) || Number.isNaN(parseAmount(f.syp))) formErrors.push({ ar: 'المبلغ غير مفهوم', en: 'The amount is not a number' });
      if (f.type === 'Income') Object.assign(t1, { inc_usd: usd, inc_syp: syp });
      else Object.assign(t1, { exp_usd: usd, exp_syp: syp });
      t1.bill_date = f.billDate || f.date || null;
      t1.rate = parseAmount(f.rate ?? '') || preview?.rate || null;
      return { rows: [t1], deletes: [], formErrors };
    }
    if (f.type === 'Income' || f.type === 'Exp') {
      if (!f.currency) formErrors.push({ ar: 'اختر العملة: ليرة أو دولار', en: 'Choose the currency: SYP or USD' });
      const t1 = base(editing?.id);
      t1.book_id = f.bookId;
      const col = `${f.type === 'Income' ? 'inc' : 'exp'}_${(f.currency ?? 'SYP').toLowerCase()}` as 'inc_syp';
      t1[col] = amount || 0;
      return { rows: [t1], deletes: partner ? [partner.id] : [], formErrors };
    }
    if (f.type === 'Exchange') {
      const t1 = base(editing?.id);
      t1.book_id = f.bookId;
      t1.trf_usd = parseAmount(f.usd) || 0;
      t1.trf_syp = parseAmount(f.syp) || 0;
      // an exchange's rate is its own (pounds ÷ dollars)
      if (building) Object.assign(t1, { bill_date: f.billDate || f.date || null, rate: null });
      return { rows: [t1], deletes: partner ? [partner.id] : [], formErrors };
    }
    // Transfer: one row on the keeper's book; two rows (−/+) between two keepers.
    const fromPrivate = !!L.books.find((b) => b.id === f.fromBook)?.private;
    if (!f.currency) formErrors.push({ ar: 'اختر العملة: ليرة أو دولار', en: 'Choose the currency: SYP or USD' });
    if (f.fromBook == null || f.toBook == null) formErrors.push({ ar: 'اختر «من» و«إلى»', en: 'Choose "from" and "to"' });
    else if (f.fromBook === f.toBook) formErrors.push({ ar: '«من» و«إلى» هما نفس الدفتر', en: '"From" and "to" are the same book' });
    if (!(amount > 0)) formErrors.push({ ar: 'أدخل مبلغاً موجباً', en: 'Enter a positive amount' });
    const col = f.currency === 'USD' ? 'trf_usd' : 'trf_syp';
    const ids = [editing?.id, partner?.id].filter(Boolean) as string[];
    const legs: { book: number | null; sign: number }[] =
      f.fromBook === mainId ? [{ book: f.toBook, sign: 1 }]
      : f.toBook === mainId ? [{ book: f.fromBook, sign: -1 }]
      : [{ book: f.fromBook, sign: -1 }, { book: f.toBook, sign: 1 }];
    const group = legs.length === 2 ? editing?.transfer_group ?? crypto.randomUUID() : null;
    const rows = legs.map((leg, i) => {
      const r = base(ids[i]);
      r.book_id = leg.book;
      r[col] = leg.sign * (amount || 0);
      r.transfer_group = group;
      r.grant_id = fromPrivate ? f.grantId ?? null : null;
      return r;
    });
    return { rows, deletes: ids.slice(legs.length), formErrors };
  };

  // money leaving the Superior's (private) book: which grant it comes from (grants in hand)
  const grantChoices = useMemo(() => {
    if (f.type !== 'Transfer' || !L.books.find((b) => b.id === f.fromBook)?.private || !d.grants.length) return null;
    const flows = grantFlows(d.grants, d.grantParts, d.rows, d.comp);
    return d.grants.filter((g) => g.status === 'hand' && ((flows.get(g.id)?.withSup ?? 0) > 0.5 || g.id === f.grantId))
      .map((g) => ({ id: g.id, label: `${L.donors.find((x) => x.id === g.donor_id)?.name ?? ''} · ${g.hand_on} · ${t('مع الرئيس', 'with the Superior')} $${fmtUsd(flows.get(g.id)?.withSup ?? 0)}` }));
  }, [f.type, f.fromBook, f.grantId, d, L]);

  const preview = useMemo(() => {
    if (!f.date) return null;
    const others = d.rows.filter((r) => r.id !== editing?.id);
    const rate = building && f.type !== 'Exchange' ? lastTypedRate(others, f.date, L.settings.usd_rate) : rateOn(others, f.bookId, f.date, L.settings.usd_rate);
    if (f.type === 'Exchange') {
      const u = parseAmount(f.usd);
      const sy = parseAmount(f.syp);
      return { rate, implied: u > 0 && sy > 0 ? sy / u : null };
    }
    return { rate, implied: null };
  }, [d.rows, f.date, f.bookId, f.type, f.usd, f.syp, L.settings.usd_rate, editing?.id, building]);

  const save = async (andNew: boolean) => {
    const { rows, deletes, formErrors } = build();
    const others = d.rows.filter((r) => !rows.some((x) => x.id === r.id) && !deletes.includes(r.id));
    const all = { errors: [...formErrors], warnings: [] as Msg[] };
    for (const r of rows) {
      const before = d.rows.find((x) => x.id === r.id);
      const explainAll = !(before && before.type === r.type && !(before.explanation ?? '').trim());
      const v = validateTrx(r, { lists: L, rows: others, closedMonths: d.closed, today: todayIso(), previousDate: before?.date ?? null, explainAll });
      for (const e of v.errors) if (!all.errors.some((x) => x.en === e.en)) all.errors.push(e);
      for (const w of v.warnings) if (!all.warnings.some((x) => x.en === w.en)) all.warnings.push(w);
    }
    setErrors(all.errors);
    if (all.errors.length) return;
    if (all.warnings.length && !warnAccepted) {
      setWarnings(all.warnings);
      setWarnAccepted(true);
      return;
    }
    // a row already saved that changes (or a leg that goes): say why, for the audit log
    const FIELDS = ['date', 'type', 'book_id', 'account_id', 'city_id', 'heading_id', 'line_id', 'party_id', 'explanation', 'receipt', 'inc_syp', 'exp_syp', 'inc_usd', 'exp_usd', 'trf_syp', 'trf_usd', 'bill_date', 'rate'] as const;
    const changesOld = deletes.some((id) => d.rows.some((x) => x.id === id)) || rows.some((r) => {
      const old = d.rows.find((x) => x.id === r.id);
      return old && FIELDS.some((k) => (old[k] ?? null) !== (r[k] ?? null));
    });
    let reason: string | null = null;
    if (changesOld) {
      reason = await promptBox(t('سبب التعديل (يُحفظ في سجل التعديلات)', 'Reason for the change (kept in the audit log)'), '');
      if (reason == null) return;
      if (!reason.trim()) return toast(t('اكتب السبب', 'Write the reason'), true);
    }
    setBusy(true);
    try {
      await s.api.call('trx.save', { rows, deletes, reason });
      // documents scanned or chosen in the form go with the row (the giver's row for a transfer)
      if (pending.length) {
        try {
          await uploadPending(s.api.call, rows[0].id, pending);
          setPending([]);
        } catch (e) {
          toast(t('حُفظ السطر لكن لا المستند: ', 'The row is saved but not the document: ') + errText(e), true);
        }
      }
      remember('lastDate', f.date);
      if (!restricted) remember('lastBook', f.type === 'Transfer' ? null : f.bookId);
      remember('lastAccount', f.accountId);
      await reload();
      toast(t('حُفظ', 'Saved') + (rows.length > 1 ? ` (${rows.length})` : ''));
      if (andNew) {
        setF((x) => ({ ...x, amount: '', usd: '', syp: '', explanation: '', receipt: '', partyId: null, billDate: '', rate: '', toBook: x.type === 'Transfer' ? null : x.toBook }));
        setWarnings([]);
        setWarnAccepted(false);
        if (editing) onClose();
      } else onClose();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    const ids = [editing.id, ...(partner ? [partner.id] : [])];
    if (editing.date && d.closed.has(editing.date.slice(0, 7))) return toast(t('الشهر مغلق — صحّح بقيد عكسي', 'Month closed — correct with a reversing entry'), true);
    const reason = await promptBox(partner ? t('حذف سطري التحويل كليهما. السبب؟', 'Delete both rows of this transfer. Why?') : t('حذف هذا السطر. السبب؟', 'Delete this row. Why?'), '');
    if (reason == null) return;
    if (!reason.trim()) return toast(t('اكتب السبب', 'Write the reason'), true);
    try {
      await s.api.call('trx.delete', { ids, reason });
    } catch (e) {
      return toast(errText(e), true);
    }
    await reload();
    toast(t('حُذف', 'Deleted'));
    onClose();
  };

  // building sites: a row is cancelled, never deleted (its number and bill code stay)
  const cancel = async () => {
    if (!editing) return;
    const reason = await promptBox(t('إلغاء هذا السطر: يبقى رقمه ورمز فاتورته، ومبالغه تصبح 0. السبب؟', 'Cancel this row: it keeps its number and bill code, its amounts become 0. Why?'), '');
    if (reason == null) return;
    if (!reason.trim()) return toast(t('اكتب السبب', 'Write the reason'), true);
    try {
      await s.api.call('trx.cancel', { id: editing.id, reason });
    } catch (e) {
      return toast(errText(e), true);
    }
    await reload();
    toast(t('أُلغي', 'Cancelled'));
    onClose();
  };

  const addParty = can('lists.manage')
    ? async (name: string) => {
        try {
          const id = await s.api.call('party.add', { name });
          await reload();
          return id;
        } catch (e) {
          toast(errText(e), true);
          return null;
        }
      }
    : undefined;

  // On a holder's own computer (files), transfers are booked by the office.
  const types: TrxType[] = fileHolder || building ? ['Income', 'Exp', 'Exchange'] : ['Income', 'Exp', 'Transfer', 'Exchange'];
  const singleBook = building && L.books.filter((b) => b.active).length <= 1;
  const sypNow = parseAmount(f.syp);
  const rateNow = parseAmount(f.rate ?? '') || preview?.rate || 0;
  const curSeg = <Seg value={f.currency} options={[{ value: 'SYP', label: t('ليرة', 'SYP') }, { value: 'USD', label: t('دولار', 'USD') }]} onChange={(v) => set('currency', v)} />;

  return (
    <Modal
      title={
        <>
          {editing ? t('تعديل', 'Edit') : t('قيد جديد', 'New entry')}
          {editing?.n != null && <span className="muted small"> · N {String(editing.n).padStart(4, '0')}</span>}
          {building && editing && d.comp.get(editing.id) && <span className="muted small ltr"> · {d.comp.get(editing.id)!.billCode}</span>}
        </>
      }
      onClose={onClose}
    >
      {cancelled && (
        <div className="alert info">
          <b>{t('ملغى', 'Cancelled')}</b> · {editing!.cancel_reason} <span className="muted small">({editing!.cancelled_by} · {fmtDate(editing!.cancelled_at!.slice(0, 10))})</span>
        </div>
      )}
      {editing?.review && (
        <div className="alert warn">
          <b>{t('للمراجعة', 'To review')}:</b> <span className="ltr">{editing.review}</span>
        </div>
      )}
      {transfer && (
        <div className={`alert ${transfer.disputedAt ? 'err' : transfer.receivedAt ? 'ok' : 'warn'}`}>
          {transfer.disputedAt
            ? <>✗ {t('قال المستلم إنه لم يصل', 'The receiver says it did not arrive')}{transfer.disputeNote ? `: ${transfer.disputeNote}` : ''}</>
            : transfer.receivedAt
              ? <>✓ {t('أكّد الاستلام', 'Receipt confirmed by')} {transfer.receivedBy} · {fmtDate(transfer.receivedAt.slice(0, 10))}</>
              : <>⏳ {t('ينتظر تأكيد المستلم', 'Waiting for the receiver to confirm')}</>}
        </div>
      )}
      {readOnly && (
        <div className="alert info">
          {fileHolder && editing?.sent_at
            ? t('أُرسل هذا القيد إلى المكتب ولا يمكن تعديله هنا. للتصحيح أضف قيداً جديداً.', 'This entry was sent to the office and cannot be changed here. To correct it, add a new entry.')
            : notMine
              ? t('للقراءة فقط: لا تكتب في هذا الدفتر.', 'Read only: you do not write in this book.')
              : bookLocked
              ? t('أغلقتَ هذا الشهر لدفترك. للتصحيح اطلب من المكتب.', 'You closed this month for your book. Ask the office for a correction.')
              : t('لا يعدّل هذا التحويل إلا من أعطى المال، قبل تأكيد المستلم. اطلب من المكتب.', 'Only the giver can change this transfer, before the receiver confirms. Ask the office.')}
        </div>
      )}

      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <Seg value={f.type} options={types.map((ty) => ({ value: ty, label: tx(TYPE_LABEL[ty]) }))} onChange={switchType} />
        </div>

        <div className="grid4">
          <Field label={building ? t('تاريخ الدفع', 'Payment date') : t('التاريخ', 'Date')}>
            <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          {building && (
            <Field label={t('تاريخ الفاتورة', 'Bill date')}>
              <input type="date" value={f.billDate || f.date} onChange={(e) => set('billDate', e.target.value)} />
            </Field>
          )}
          {singleBook ? null : f.type !== 'Transfer' ? (
            <Field label={t('الدفتر', 'Book')}>
              <Select value={f.bookId} options={myBookOpts} disabled={restricted && myBookOpts.length <= 1} onChange={(v) => {
                const b = L.books.find((x) => x.id === v);
                setF((x) => ({ ...x, bookId: v, accountId: b?.account_id ?? x.accountId, cityId: b?.city_id ?? x.cityId }));
              }} />
            </Field>
          ) : (
            <>
              <Field label={t('من (المعطي)', 'From (giver)')}><Select value={f.fromBook} options={myBookOpts} onChange={(v) => set('fromBook', v)} /></Field>
              <Field label={t('إلى (المستلم)', 'To (receiver)')}><Select value={f.toBook} options={bookOpts.filter((o) => o.value !== f.fromBook)} onChange={(v) => set('toBook', v)} /></Field>
              {grantChoices && (
                <Field label={t('من أي منحة؟', 'From which grant?')} className="span2">
                  <select className="inp" value={f.grantId ?? ''} onChange={(e) => setF((x) => ({ ...x, grantId: e.target.value || null }))}>
                    <option value="">{t('— بلا منحة', '— no grant')}</option>
                    {grantChoices.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
          {!singleBook && (
          <Field label={t('الحساب', 'Account')}>
            <Select value={f.accountId} options={opts(L.accounts, f.accountId)} onChange={(v) => set('accountId', v)} />
          </Field>
          )}
          {f.type !== 'Transfer' && !singleBook && (
            <Field label={t('المدينة', 'City')}>
              <Select value={f.cityId} options={opts(L.cities, f.cityId)} onChange={(v) => set('cityId', v)} />
            </Field>
          )}

          {f.type === 'Transfer' ? (
            <Field label={t('البند والخط', 'Heading and line')} className="span2">
              <div className="muted" style={{ padding: '8px 0' }}>Transfer › Transfer <span className="small">({t('دائماً؛ التفاصيل في الشرح', 'always; details go in the explanation')})</span></div>
            </Field>
          ) : (
            <>
              <Field label={t('بند الموازنة', 'Budget heading')} className="span2">
                <Select value={f.headingId} options={headingOpts} onChange={(v) => setF((x) => ({ ...x, headingId: v, lineId: L.lines.filter((l) => l.heading_id === v && l.active).length === 1 ? L.lines.find((l) => l.heading_id === v && l.active)!.id : null }))} />
              </Field>
              <Field label={building ? t('النوع (مواد، أجور، أخرى)', 'Kind (materials, wages, other)') : t('خط الموازنة', 'Budget line')} className="span2">
                <Select value={f.lineId} options={lineOpts} onChange={(v) => set('lineId', v)} disabled={f.headingId == null} />
              </Field>
            </>
          )}

          {building && (f.type === 'Income' || f.type === 'Exp') && (
            <>
              <Field label={f.type === 'Income' ? t('دولار مقبوض', 'USD received') : t('دولار مدفوع', 'USD paid')}>
                <input className="num" inputMode="decimal" value={f.usd} onChange={(e) => set('usd', e.target.value)} autoFocus={!editing} />
              </Field>
              <Field label={f.type === 'Income' ? t('ليرة مقبوضة', 'SYP received') : t('ليرة مدفوعة', 'SYP paid')}>
                <input className="num" inputMode="decimal" value={f.syp} onChange={(e) => set('syp', e.target.value)} />
              </Field>
              <Field label={t('السعر (فارغ = آخر سعر)', 'Rate (empty = last rate)')}>
                <input className="num" inputMode="decimal" value={f.rate ?? ''} placeholder={preview ? String(Math.round(preview.rate * 100) / 100) : ''} onChange={(e) => set('rate', e.target.value)} />
              </Field>
              <div className="muted small" style={{ alignSelf: 'end', paddingBottom: 8 }}>
                {sypNow > 0 && rateNow > 0 && <>≈ <span className="ltr">{fmtUsd((parseAmount(f.usd) || 0) + sypNow / rateNow)} USD</span></>}
              </div>
            </>
          )}

          {!building && (f.type === 'Income' || f.type === 'Exp' || f.type === 'Transfer') && (
            <>
              <Field label={t('العملة', 'Currency')}>{curSeg}</Field>
              <Field label={f.type === 'Income' ? t('المبلغ المقبوض', 'Amount received') : f.type === 'Exp' ? t('المبلغ المدفوع', 'Amount paid') : t('المبلغ المحوَّل', 'Amount moved')}>
                <input className="num" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} autoFocus={!editing}
                  onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save(true)} />
              </Field>
              <div className="span2 muted small" style={{ alignSelf: 'end', paddingBottom: 8 }}>
                {f.currency === 'SYP' && preview && parseAmount(f.amount) > 0 && (
                  <>≈ <span className="ltr">{fmtUsd(parseAmount(f.amount) / preview.rate)} USD</span> · {t('السعر', 'rate')} <span className="ltr">{fmtRate(preview.rate)}</span></>
                )}
              </div>
              {f.type === 'Exp' && (() => {
                // the controls set by the Superior: document from an amount, approval from an amount
                const usdEq = f.currency === 'USD' ? parseAmount(f.amount) : preview ? parseAmount(f.amount) / preview.rate : 0;
                const S = L.settings;
                const probe = { type: 'Exp', created_at: editing?.created_at ?? new Date().toISOString(), approved_at: null } as Trx;
                const needDoc = needsDoc(S, probe, usdEq);
                const needOk = needsApproval(S, probe, usdEq);
                if (!needDoc && !needOk && !editing?.approved_at) return null;
                return (
                  <div className="span2 small controls-note">
                    {needDoc && <div>📎 {t(`من ${S.doc_required_usd}$: أرفق المستند (الفاتورة) لهذا القيد.`, `From $${S.doc_required_usd}: attach the document (invoice) to this entry.`)}</div>}
                    {needOk && (editing?.approved_at
                      ? <div className="ok">✓ {t('وافق عليه', 'Approved by')} {editing.approved_by} · {fmtDate(editing.approved_at.slice(0, 10))} {t('(يُلغى إن تغيّر المبلغ)', '(cancelled if the amount changes)')}</div>
                      : <div>⏳ {t(`من ${S.approval_usd}$: ينتظر الموافقة قبل إغلاق الشهر.`, `From $${S.approval_usd}: waits for approval before the month can close.`)}</div>)}
                  </div>
                );
              })()}
            </>
          )}

          {f.type === 'Exchange' && (
            <>
              <Field label={t('دولار أعطيته', 'USD given')}>
                <input className="num" inputMode="decimal" value={f.usd} onChange={(e) => set('usd', e.target.value)} autoFocus={!editing} />
              </Field>
              <Field label={t('ليرة قبضتها', 'SYP received')}>
                <input className="num" inputMode="decimal" value={f.syp} onChange={(e) => set('syp', e.target.value)} />
              </Field>
              <div className="span2 small" style={{ alignSelf: 'end', paddingBottom: 8 }}>
                {preview?.implied != null && <>{t('السعر', 'Rate')}: <b className="ltr">{fmtRate(preview.implied)}</b> · </>}
                <span className="muted">{t('آخر سعر', 'last rate')}: <span className="ltr">{fmtRate(preview?.rate)}</span></span>
              </div>
            </>
          )}

          <Field label={`${building ? t('التفاصيل', 'Details') : t('الشرح', 'Explanation')}${f.type === 'Exchange' ? '' : ' *'}`} className="span2">
            <input value={f.explanation} onChange={(e) => set('explanation', e.target.value)} />
          </Field>
          <Field label={building ? t('من (المورّد)', 'From (supplier)') : t('الجهة', 'Party')}>
            <Combo value={f.partyId} options={opts(L.parties, f.partyId)} onChange={(v) => set('partyId', v)} onAdd={addParty} />
          </Field>
          <Field label={building ? t('رقم الفاتورة', 'Bill number') : t('رقم الوصل', 'Receipt')}>
            <input value={f.receipt} onChange={(e) => set('receipt', e.target.value)} />
          </Field>
        </div>

        {f.type === 'Transfer' && f.fromBook != null && f.toBook != null && f.fromBook !== mainId && f.toBook !== mainId && (
          <p className="muted small">{t('بين أمينين: يُكتب سطران (− من الأول، + للثاني).', 'Between two keepers: two rows are written (− from the first, + to the second).')}</p>
        )}
        {f.type === 'Transfer' && !editing && (
          <p className="muted small">{t('يسجّله من يعطي المال، مرة واحدة. يظهر فوراً في دفتر المستلم ليؤكّد أنه استلمه.', 'The giver records it, once. It appears at once in the receiver\'s book, for him to confirm he received it.')}</p>
        )}
      </fieldset>

      <DocsPanel trxId={editing?.id ?? null} pending={pending} setPending={setPending} readOnly={readOnly} />

      <div style={{ marginTop: 14 }}>
        <Msgs errors={errors} warnings={warnings} />
      </div>

      <div className="modal-foot">
        {editing && !readOnly && building && (
          <button className="btn danger" onClick={cancel} style={{ marginInlineEnd: can('users.manage') ? undefined : 'auto' }}>
            {t('إلغاء السطر', 'Cancel row')}
          </button>
        )}
        {editing && (building ? can('users.manage') && !(editing.date && d.closed.has(editing.date.slice(0, 7))) : !readOnly) && (
          <button className="btn danger ghost" onClick={remove} style={{ marginInlineEnd: 'auto' }}>
            {t('حذف', 'Delete')}
          </button>
        )}
        <button className="btn" onClick={onClose}>{t('إغلاق', 'Close')}</button>
        {!readOnly && !editing && (
          <button className="btn" disabled={busy} onClick={() => save(true)} title="Ctrl/⌘ + Enter">
            {warnAccepted && warnings.length ? t('احفظ رغم ذلك وجديد', 'Save anyway & new') : t('احفظ وجديد', 'Save & new')}
          </button>
        )}
        {!readOnly && (
          <button className="btn primary" disabled={busy} onClick={() => save(false)}>
            {warnAccepted && warnings.length ? t('احفظ رغم ذلك', 'Save anyway') : t('احفظ', 'Save')}
          </button>
        )}
      </div>
    </Modal>
  );
}
