// The Superior's list: every expense that waits for his approval, with what it is,
// what it is worth in dollars against the limit, and what the Jesuit wrote about it.
// He approves, or asks a private question.
import { useCallback, useEffect, useState } from 'react';
import { errText, promptBox, toast } from '../../ui/kit';
import type { ApprovalItem } from '../ops';
import { useCty, Card } from './CtyApp';
import { Thread } from './Notes';
import { accName, dayName, money, moneyCur, t3 } from './text';

export function Approvals() {
  const { d, s, reload } = useCty();
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => s.api.call('cty.approvals').then(setItems).catch((e) => setErr(errText(e))), [s]);
  useEffect(() => { void load(); }, [load, d]);

  const approve = async (it: ApprovalItem) => {
    try {
      await s.api.call('cty.entry.approve', { ids: [it.entry.id] });
      await reload();
      toast(t3('تمّت الموافقة ✓', 'Approved ✓', 'Approuvé ✓'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const ask = async (it: ApprovalItem) => {
    const body = await promptBox(t3('سؤالك (خاص، لصاحب الدفتر فقط)', 'Your question (private, for the keeper of the book only)', 'Votre question (privée, pour le titulaire du compte seulement)'));
    if (!body) return;
    try {
      await s.api.call('cty.note.add', { bookId: it.entry.book_id, entryId: it.entry.id, ym: it.entry.date.slice(0, 7), body });
      await reload();
    } catch (e) {
      toast(errText(e), true);
    }
  };

  return (
    <>
      <h1>{t3('بانتظار موافقتك', 'Waiting for your approval', 'En attente de votre accord')}</h1>
      <p className="muted small">{t3(`الحد: البيت $${d.limits.house}، الشخص $${d.limits.personal}.`, `Limits: house $${d.limits.house}, each person $${d.limits.personal}.`, `Limites : maison ${d.limits.house} $, chaque personne ${d.limits.personal} $.`)}</p>
      {err && <div className="alert err">{err}</div>}
      {items && items.length === 0 && <Card><p className="muted" style={{ margin: 0 }}>✓ {t3('لا شيء ينتظر.', 'Nothing is waiting.', "Rien n'attend.")}</p></Card>}
      {items?.map((it) => {
        const thread = d.notes.filter((n) => n.entry_id === it.entry.id && !n.parent_id);
        return (
          <Card key={it.entry.id} className="cty-approval">
            <div className="cty-approval-head">
              <b>{it.bookKind === 'house' ? t3('البيت', 'House', 'Maison') : it.keeper ?? it.book}</b>
              <span className="muted small">{dayName(it.entry.date)}</span>
            </div>
            <div className="cty-approval-amt">{moneyCur(it.entry.amount, it.entry.cur, d.local)}</div>
            <div className="muted small">
              {it.entry.approval_usd != null ? `≈ $${money(it.entry.approval_usd, 'USD')} · ` : `${t3('لا سعر بعد', 'no rate yet', 'pas encore de taux')} · `}
              {t3('الحد', 'limit', 'limite')} ${it.limit}
            </div>
            <div className="cty-approval-line">{it.account?.code} · {accName(it.account)}</div>
            {it.entry.note ? <blockquote className="cty-quote">“{it.entry.note}”</blockquote> : <p className="muted small">{t3('لم يكتب ملاحظة.', 'No note written.', 'Aucune note écrite.')}</p>}
            {it.entry.claim && <div className="small">↺ {t3('يطالب بها الإقليم', 'to be claimed from the Province', 'à réclamer à la Province')}</div>}
            {it.documents > 0 && <div className="small">📎 {it.documents}</div>}
            {thread.map((r) => <Thread key={r.id} root={r} compact />)}
            <div className="cty-two">
              <button className="btn primary" onClick={() => approve(it)}>✓ {t3('أوافق', 'Approve', 'Approuver')}</button>
              <button className="btn" onClick={() => ask(it)}>? {t3('سؤال', 'Ask', 'Demander')}</button>
            </div>
          </Card>
        );
      })}
    </>
  );
}
