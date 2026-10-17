// Compare the register with a backup: each book's balance then and now, and every
// row added, changed or deleted since — with "Put back as it was" for one row
// (a reason is asked, and kept in the audit log). Nothing else is touched.
import { useEffect, useMemo, useState } from 'react';
import { useApp, useNames } from '../state';
import type { BackupFile } from '../ops';
import type { Trx } from '../domain/types';
import { holders } from '../domain/reports';
import { compareRows, type EntryField } from '../domain/compare';
import { TYPE_LABEL, tx } from '../i18n';
import { Modal, Select, errText, fmtDate, fmtSyp, fmtUsd, promptBox, t, toast } from './kit';

const FIELD_LABEL: Record<EntryField, () => string> = {
  date: () => t('التاريخ', 'Date'), type: () => t('النوع', 'Type'), book_id: () => t('الدفتر', 'Book'), account_id: () => t('الحساب', 'Account'),
  city_id: () => t('المدينة', 'City'), heading_id: () => t('البند', 'Heading'), line_id: () => t('الخط', 'Line'), party_id: () => t('الجهة', 'Party'),
  explanation: () => t('الشرح', 'Explanation'), receipt: () => t('الوصل', 'Receipt'),
  inc_syp: () => 'Inc SYP', exp_syp: () => 'Exp SYP', inc_usd: () => 'Inc USD', exp_usd: () => 'Exp USD', trf_syp: () => 'Trf SYP', trf_usd: () => 'Trf USD',
};

export function CompareModal({ backup, onClose }: { backup: BackupFile; onClose: () => void }) {
  const { s, d, reload } = useApp();
  const names = useNames();
  const [then, setThen] = useState<Trx[] | null>(null);
  const [book, setBook] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    s.api.call('backup.compare', { path: backup.path }).then(setThen).catch((e) => toast(errText(e), true));
  }, [s, backup.path]);

  const now = useMemo(() => d.rows.filter((r) => !r.private_book), [d.rows]);
  const diff = useMemo(() => (then ? compareRows(then.filter((r) => !r.private_book), now) : null), [then, now]);
  const inBook = (r: Trx) => book == null || r.book_id === book;

  // each book's balance: then (from the backup) and now
  const balances = useMemo(() => {
    if (!then) return [];
    const bs = d.shownBooks;
    const tS = holders(then, bs, 'SYP'), tU = holders(then, bs, 'USD');
    const nS = holders(d.rows, bs, 'SYP'), nU = holders(d.rows, bs, 'USD');
    return bs.map((b, i) => ({ b, syp: [tS[i].shouldHold, nS[i].shouldHold], usd: [tU[i].shouldHold, nU[i].shouldHold] }))
      .filter((x) => Math.abs(x.syp[1] - x.syp[0]) >= 0.5 || Math.abs(x.usd[1] - x.usd[0]) >= 0.005 || x.b.active);
  }, [then, d]);

  const show = (f: EntryField, r: Trx): string => {
    const v = r[f];
    if (v == null || v === '') return '—';
    switch (f) {
      case 'date': return fmtDate(v as string);
      case 'type': return tx(TYPE_LABEL[v as Trx['type'] & string]);
      case 'book_id': return names.book(v as number);
      case 'account_id': return names.account(v as number);
      case 'city_id': return names.city(v as number);
      case 'heading_id': return names.heading(v as number);
      case 'line_id': return names.line(v as number);
      case 'party_id': return names.party(v as number);
      case 'inc_syp': case 'exp_syp': case 'trf_syp': return fmtSyp(v as number);
      case 'inc_usd': case 'exp_usd': case 'trf_usd': return fmtUsd(v as number);
      default: return String(v);
    }
  };
  const amount = (r: Trx) => [r.inc_syp && `+${fmtSyp(r.inc_syp)} SYP`, r.inc_usd && `+${fmtUsd(r.inc_usd)} USD`, r.exp_syp && `−${fmtSyp(r.exp_syp)} SYP`, r.exp_usd && `−${fmtUsd(r.exp_usd)} USD`, r.trf_syp && `${fmtSyp(r.trf_syp)} SYP`, r.trf_usd && `${fmtUsd(r.trf_usd)} USD`].filter(Boolean).join(' · ');
  const label = (r: Trx) => `${r.n == null ? '' : `N${String(r.n).padStart(4, '0')} · `}${fmtDate(r.date)} · ${names.book(r.book_id)} · ${names.line(r.line_id)}`;

  const putBack = async (id: string, what: string) => {
    const reason = await promptBox(t(`${what}. السبب؟ (يُحفظ في سجل التعديلات)`, `${what}. Why? (kept in the audit log)`), '');
    if (reason == null) return;
    if (!reason.trim()) return toast(t('اكتب السبب', 'Write the reason'), true);
    setBusy(id);
    try {
      await s.api.call('trx.putBack', { path: backup.path, id, reason });
      await reload();
      toast(t('أُعيد كما كان', 'Put back as it was'));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(null);
    }
  };

  const changed = diff?.changed.filter((x) => inBook(x.after) || inBook(x.before)) ?? [];
  const deleted = diff?.deleted.filter(inBook) ?? [];
  const added = diff?.added.filter(inBook) ?? [];

  return (
    <Modal title={t('مقارنة مع نسخة احتياطية', 'Compare with a backup')} onClose={onClose}>
      <p className="muted small">{t('النسخة', 'Backup')}: <span className="code">{backup.name}</span> · {new Date(backup.modified).toLocaleString('en-GB')}</p>
      {!diff ? <p className="muted">…</p> : (
        <>
          <h3>{t('رصيد كل دفتر: حينها والآن', "Each book's balance: then and now")}</h3>
          <table className="t">
            <thead><tr><th>{t('الدفتر', 'Book')}</th><th className="n">SYP {t('حينها', 'then')}</th><th className="n">SYP {t('الآن', 'now')}</th><th className="n">Δ</th><th className="n">USD {t('حينها', 'then')}</th><th className="n">USD {t('الآن', 'now')}</th><th className="n">Δ</th></tr></thead>
            <tbody>
              {balances.map(({ b, syp, usd }) => {
                const dS = syp[1] - syp[0], dU = usd[1] - usd[0];
                return (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td className="n">{fmtSyp(syp[0])}</td><td className="n">{fmtSyp(syp[1])}</td><td className={`n ${Math.abs(dS) >= 0.5 ? 'bad' : 'muted'}`}><b>{Math.abs(dS) >= 0.5 ? fmtSyp(dS) : '—'}</b></td>
                    <td className="n">{fmtUsd(usd[0])}</td><td className="n">{fmtUsd(usd[1])}</td><td className={`n ${Math.abs(dU) >= 0.005 ? 'bad' : 'muted'}`}><b>{Math.abs(dU) >= 0.005 ? fmtUsd(dU) : '—'}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="row" style={{ justifyContent: 'space-between', margin: '14px 0 6px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{t('ما تغيّر منذ النسخة', 'What changed since the backup')}: {changed.length + deleted.length + added.length}</h3>
            <div style={{ minWidth: 200 }}><Select value={book} placeholder={t('كل الدفاتر', 'All books')} options={d.shownBooks.map((b) => ({ value: b.id, label: b.name }))} onChange={setBook} /></div>
          </div>
          {!changed.length && !deleted.length && !added.length && <div className="alert ok">{t('لا فرق: السجل كما كان.', 'No difference: the register is as it was.')}</div>}

          {changed.map((x) => (
            <div key={x.after.id} className="diff-row">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span><span className="pill st-promised">{t('تغيّر', 'Changed')}</span> {label(x.after)}</span>
                <button className="btn small" disabled={busy === x.after.id} onClick={() => putBack(x.after.id, t('إعادة السطر كما كان', 'Put the row back as it was'))}>↺ {t('كما كان', 'As it was')}</button>
              </div>
              <table className="t diff-t">
                <tbody>
                  {x.fields.map((f) => (
                    <tr key={f}><td className="muted small">{FIELD_LABEL[f]()}</td><td className="was">{show(f, x.before)}</td><td>→</td><td className="is">{show(f, x.after)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {deleted.map((r) => (
            <div key={r.id} className="diff-row">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span><span className="pill st-requested">{t('حُذف', 'Deleted')}</span> {label(r)} · <span className="ltr">{amount(r)}</span> · {r.explanation}</span>
                <button className="btn small" disabled={busy === r.id} onClick={() => putBack(r.id, t('إعادة السطر المحذوف', 'Bring the deleted row back'))}>↺ {t('إعادته', 'Bring back')}</button>
              </div>
            </div>
          ))}
          {added.map((r) => (
            <div key={r.id} className="diff-row">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span><span className="pill st-received">{t('أضيف', 'Added')}</span> {label(r)} · <span className="ltr">{amount(r)}</span> · {r.explanation}{r.type ? '' : ''}</span>
                <button className="btn small ghost" disabled={busy === r.id} onClick={() => putBack(r.id, t('حذف هذا السطر (لم يكن في النسخة)', 'Delete this row (it was not in the backup)'))}>✕ {t('حذفه', 'Remove')}</button>
              </div>
            </div>
          ))}
          <p className="muted small">{t('كل إعادة تُسجَّل في سجل التعديلات مع السبب. الأشهر المغلقة لا تُغيَّر.', 'Each put-back is recorded in the audit log with its reason. Closed months are not changed.')}</p>
        </>
      )}
    </Modal>
  );
}
