// The Superior's questions and comments, and the answers. Private: only the Jesuit
// whose book it is and the Superior see them (the server sends nothing to others).
import { useEffect, useState } from 'react';
import { errText, toast } from '../../ui/kit';
import type { CtyNote } from '../ops';
import { useCty, Card, bookName } from './CtyApp';
import { accName, dayName, moneyCur, monthName, t3 } from './text';

export function NotesScreen() {
  const { d, s, reload } = useCty();
  const roots = d.notes.filter((n) => !n.parent_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  // opening the page marks what others wrote as read
  useEffect(() => {
    const ids = d.notes.filter((n) => !n.read_at && n.author_id !== s.profile.id).map((n) => n.id);
    if (ids.length) s.api.call('cty.note.read', { ids }).then(reload).catch(() => undefined);
  }, [d.notes, s, reload]);

  return (
    <>
      <h1>{t3('ملاحظات', 'Notes', 'Notes')}</h1>
      <p className="muted small">🔒 {t3('خاصة: لا يراها إلا صاحب الدفتر والرئيس.', 'Private: only the keeper of the book and the Superior see them.', 'Privées : seuls le titulaire du compte et le Supérieur les voient.')}</p>
      {roots.length === 0 && <p className="muted">{t3('لا ملاحظات.', 'No notes.', 'Aucune note.')}</p>}
      {roots.map((r) => <Thread key={r.id} root={r} />)}
    </>
  );
}

export function Thread({ root, compact }: { root: CtyNote; compact?: boolean }) {
  const { d, s, reload } = useCty();
  const [answer, setAnswer] = useState('');
  const replies = d.notes.filter((n) => n.parent_id === root.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const entry = root.entry_id ? d.entries.find((e) => e.id === root.entry_id) : undefined;
  const book = d.books.find((b) => b.id === root.book_id);
  const send = async () => {
    try {
      await s.api.call('cty.note.add', { bookId: root.book_id, parentId: root.id, body: answer });
      setAnswer('');
      await reload();
      toast(t3('أُرسل', 'Sent', 'Envoyé'));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return (
    <Card className="cty-thread">
      {!compact && (
        <div className="muted small">
          {bookName(book)}
          {root.ym && ` · ${monthName(root.ym)}`}
          {entry && ` · ${dayName(entry.date)} · ${accName(d.accounts.find((a) => a.id === entry.account_id))} · ${moneyCur(entry.amount, entry.cur, d.local)}`}
        </div>
      )}
      {[root, ...replies].map((n) => (
        <div key={n.id} className={`cty-msg ${n.author_id === s.profile.id ? 'me' : ''}`}>
          <b>{n.author}</b> <span className="muted small">{dayName(n.created_at.slice(0, 10))}</span>
          <div>{n.body}</div>
        </div>
      ))}
      <div className="cty-reply">
        <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t3('اكتب جواباً…', 'Write an answer…', 'Écrire une réponse…')} />
        <button className="btn" disabled={!answer.trim()} onClick={send}>{t3('أرسل', 'Send', 'Envoyer')}</button>
      </div>
    </Card>
  );
}
