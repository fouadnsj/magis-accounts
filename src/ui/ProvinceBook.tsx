// Coordinator → Province account (Fouad, 2026-11-07): the account of the Province, where the money of the grants
// arrives. The Coordinator records what comes in (in dollars or pounds), exchanges dollars for pounds, and (next) sends
// to the centres. Its balance in USD and SYP, its rows, and its months, closed like a centre's.
import { useEffect, useState } from 'react';
import { provinceApi, type ProvinceData } from '../net';
import type { NetGrantRow } from '../domain/netGrants';
import { ProvinceSends } from './ProvinceSends';
import { blankTrx } from '../db/repo';
import type { Trx } from '../domain/types';
import { Field, Modal, confirmBox, errText, fmtDate, fmtRate, fmtSyp, fmtUsd, parseAmount, promptBox, t, toast, todayIso } from './kit';

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function ProvinceBook() {
  const [d, setD] = useState<ProvinceData | null>(null);
  const [form, setForm] = useState<'in' | 'exchange' | null>(null);
  const [grants, setGrants] = useState<NetGrantRow[]>([]);
  const load = async () => {
    try {
      setD(await provinceApi.get());
      setGrants(await provinceApi.grants());
    } catch (e) {
      toast(errText(e), true);
    }
  };
  useEffect(() => { void load(); }, []);
  if (!d) return <p className="muted">…</p>;
  const L = d.lists;
  const heading = (name: string) => L.headings.find((h) => h.name === name);
  const linesOf = (name: string) => L.lines.filter((l) => l.heading_id === heading(name)?.id && l.active);
  const save = async (row: Trx) => {
    await provinceApi.op('trx.save', { rows: [row] });
    await load();
  };
  const rows = [...d.rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.n ?? 0) - (a.n ?? 0));
  // the months: those with rows, and this one
  const months = [...new Set([todayIso().slice(0, 7), ...d.rows.map((r) => r.date?.slice(0, 7)).filter((x): x is string => !!x)])].sort().reverse();
  const closed = new Set(d.closed);
  const kind = (r: Trx) => r.type === 'Income' ? t('دخل', 'Money in') : r.type === 'Exchange' ? t('تصريف', 'Exchange') : r.type === 'Transfer' ? t('إرسال', 'Sent') : r.type;
  // (a send is a transfer from the Province account to "Sent to the centres": money going out)
  const usd = (r: Trx) => r.inc_usd - r.exp_usd - (r.type === 'Exchange' ? r.trf_usd : 0) - (r.type === 'Transfer' ? r.trf_usd : 0);
  const syp = (r: Trx) => r.inc_syp - r.exp_syp + (r.type === 'Exchange' ? r.trf_syp : 0) - (r.type === 'Transfer' ? r.trf_syp : 0);
  const signed = (n: number, f: (x: number) => string) => (n ? `${n > 0 ? '+' : '−'}${f(Math.abs(n))}` : '');

  return (
    <div style={{ maxWidth: 980 }}>
      <p className="muted small" style={{ marginTop: 0 }}>{t('حساب الإقليم: يصل إليه مال المنح. تسجّل ما يدخل، وتصرّف الدولار إلى ليرات، ثم ترسل إلى المراكز. يُغلق شهره كشهر المركز.', "The Province's account: the money of the grants arrives here. Record what comes in, exchange dollars for pounds, then send them to the centres. Its months close like a centre's.")}</p>
      <div className="cards">
        <div className="card"><div className="k">{t('الرصيد بالدولار', 'Balance in USD')}</div><div className="v ltr">${fmtUsd(d.balance.usd)}</div></div>
        <div className="card"><div className="k">{t('الرصيد بالليرة', 'Balance in SYP')}</div><div className="v ltr">{fmtSyp(d.balance.syp)} SYP</div></div>
      </div>
      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <button className="btn primary" onClick={() => setForm('in')}>＋ {t('دخل (منحة، مال)', 'Money in (a grant, money)')}</button>
        <button className="btn" onClick={() => setForm('exchange')}>⇄ {t('تصريف دولار ← ليرة', 'Exchange USD → SYP')}</button>
      </div>

      <table className="t">
        <thead><tr><th>{t('التاريخ', 'Date')}</th><th>{t('النوع', 'Kind')}</th><th>{t('الشرح', 'Explanation')}</th><th className="n">USD</th><th className="n">SYP</th><th className="n">{t('السعر', 'Rate')}</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{r.date ? fmtDate(r.date) : ''}</td>
              <td>{kind(r)}</td>
              <td>{r.explanation}</td>
              <td className="n ltr">{signed(usd(r), fmtUsd)}</td>
              <td className="n ltr">{signed(syp(r), fmtSyp)}</td>
              <td className="n ltr small">{r.type === 'Exchange' && r.trf_usd ? fmtRate(r.trf_syp / r.trf_usd) : ''}</td>
              <td className="nowrap">{r.date && !closed.has(r.date.slice(0, 7)) && r.type !== 'Transfer' && (
                <button className="btn small ghost" title={t('حذف', 'Delete')} onClick={() => void (async () => {
                  const reason = await promptBox(t('لماذا يُحذف؟', 'Why is it deleted?'));
                  if (!reason?.trim()) return;
                  try {
                    await provinceApi.op('trx.delete', { ids: [r.id], reason });
                    await load();
                  } catch (e) {
                    toast(errText(e), true);
                  }
                })()}>✕</button>
              )}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="muted">{t('لا حركة بعد.', 'Nothing recorded yet.')}</td></tr>}
        </tbody>
      </table>

      <ProvinceSends onChanged={load} />

      <h3 style={{ marginTop: 18 }}>{t('الأشهر', 'Months')}</h3>
      <table className="t" style={{ maxWidth: 520 }}>
        <tbody>
          {months.map((ym) => (
            <tr key={ym}>
              <td className="ltr">{ym}</td>
              <td>{closed.has(ym) ? `🔒 ${t('مغلق', 'closed')}` : t('مفتوح', 'open')}</td>
              <td className="right">
                {closed.has(ym)
                  ? <button className="btn small ghost" onClick={() => void (async () => {
                      if (!(await confirmBox(t(`إعادة فتح ${ym}؟`, `Reopen ${ym}?`)))) return;
                      try { await provinceApi.op('month.reopen', { ym }); await load(); } catch (e) { toast(errText(e), true); }
                    })()}>{t('أعد الفتح', 'Reopen')}</button>
                  : <button className="btn small" onClick={() => void (async () => {
                      if (!(await confirmBox(t(`إغلاق ${ym}؟ لا تتغير حركاته بعد ذلك.`, `Close ${ym}? Its rows no longer change.`)))) return;
                      try { await provinceApi.op('month.close', { ym }); await load(); toast(t('أُغلق', 'Closed')); } catch (e) { toast(errText(e), true); }
                    })()}>{t('أغلق', 'Close')}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {form === 'in' && <MoneyIn lines={linesOf('Income')} grants={grants.filter((g) => !g.closed)} onClose={() => setForm(null)} onSave={async (x) => {
        await save({ ...blankTrx(), id: newId(), type: 'Income', date: x.date, book_id: d.bookId, city_id: L.cities[0]?.id ?? null, heading_id: heading('Income')!.id, line_id: x.line, explanation: x.explanation, grant_id: x.grant,
          inc_usd: x.cur === 'USD' ? x.amount : 0, inc_syp: x.cur === 'SYP' ? x.amount : 0 });
        setForm(null);
      }} />}
      {form === 'exchange' && <Exchange onClose={() => setForm(null)} onSave={async (x) => {
        const line = linesOf('Exchange')[0];
        await save({ ...blankTrx(), id: newId(), type: 'Exchange', date: x.date, book_id: d.bookId, city_id: L.cities[0]?.id ?? null, heading_id: heading('Exchange')!.id, line_id: line?.id ?? null, explanation: x.explanation || null,
          trf_usd: x.usd, trf_syp: x.syp });
        setForm(null);
      }} />}
    </div>
  );
}

function MoneyIn({ lines, grants, onClose, onSave }: { lines: { id: number; name: string }[]; grants: NetGrantRow[]; onClose: () => void; onSave: (x: { date: string; cur: 'USD' | 'SYP'; amount: number; line: number; explanation: string; grant: string | null }) => Promise<void> }) {
  const [grant, setGrant] = useState<string>('');
  const [date, setDate] = useState(todayIso());
  const [cur, setCur] = useState<'USD' | 'SYP'>('USD');
  const [amount, setAmount] = useState('');
  const [line, setLine] = useState(lines[0]?.id ?? 0);
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const n = parseAmount(amount);
  return (
    <Modal title={t('دخل إلى حساب الإقليم', "Money in, on the Province's account")} onClose={onClose} narrow>
      <Field label={t('التاريخ', 'Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={t('المبلغ', 'Amount')}>
        <div className="row" style={{ gap: 6 }}>
          <input className="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          <select value={cur} onChange={(e) => setCur(e.target.value as 'USD' | 'SYP')}><option>USD</option><option>SYP</option></select>
        </div>
      </Field>
      <Field label={t('المنحة', 'Grant')}>
        <select value={grant} onChange={(e) => {
          setGrant(e.target.value);
          const g = grants.find((x) => x.id === e.target.value);
          if (g) { setExplanation(`${g.donor}${g.reference ? ` · ${g.reference}` : ''}`); setLine(lines.find((l) => l.name === 'Grant')?.id ?? line); }
        }}>
          <option value="">— {t('ليست منحة', 'not a grant')} —</option>
          {grants.map((g) => <option key={g.id} value={g.id}>{g.donor}{g.reference ? ` · ${g.reference}` : ''}</option>)}
        </select>
      </Field>
      <Field label={t('ما هو', 'What it is')}><select value={line} onChange={(e) => setLine(Number(e.target.value))}>{lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <Field label={t('من أين؟ (المانح، المنحة…)', 'From where? (donor, grant…)')}><input value={explanation} onChange={(e) => setExplanation(e.target.value)} /></Field>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy || !(n > 0) || !explanation.trim() || !line} onClick={() => void (async () => {
          setBusy(true);
          try { await onSave({ date, cur, amount: n, line, explanation: explanation.trim(), grant: grant || null }); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
        })()}>{t('سجّل', 'Record')}</button>
      </div>
    </Modal>
  );
}

function Exchange({ onClose, onSave }: { onClose: () => void; onSave: (x: { date: string; usd: number; syp: number; explanation: string }) => Promise<void> }) {
  const [date, setDate] = useState(todayIso());
  const [usd, setUsd] = useState('');
  const [syp, setSyp] = useState('');
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const u = parseAmount(usd);
  const sp = parseAmount(syp);
  return (
    <Modal title={t('تصريف دولار إلى ليرة', 'Exchange dollars for pounds')} onClose={onClose} narrow>
      <Field label={t('التاريخ', 'Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={t('الدولارات المدفوعة', 'Dollars given')}><input className="ltr" value={usd} onChange={(e) => setUsd(e.target.value)} autoFocus /></Field>
      <Field label={t('الليرات المقبوضة', 'Pounds received')}><input className="ltr" value={syp} onChange={(e) => setSyp(e.target.value)} /></Field>
      {u > 0 && sp > 0 && <p className="muted small ltr">{t('السعر', 'Rate')}: {fmtRate(sp / u)}</p>}
      <Field label={t('الشرح (اختياري)', 'Explanation (optional)')}><input value={explanation} onChange={(e) => setExplanation(e.target.value)} /></Field>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button className="btn primary" disabled={busy || !(u > 0) || !(sp > 0)} onClick={() => void (async () => {
          setBusy(true);
          try { await onSave({ date, usd: u, syp: sp, explanation: explanation.trim() }); } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
        })()}>{t('سجّل', 'Record')}</button>
      </div>
    </Modal>
  );
}
