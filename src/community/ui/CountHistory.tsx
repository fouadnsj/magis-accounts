// The history of the counts of an account (Fouad, 21 October 2026): every count saved by hand and
// every closing, with date AND hour, who counted, the banknotes, what the book said at that moment
// and the difference — useful when there is a mistake. Shown on the month screen, and to the
// econome / Superior on each member's month.
import { useEffect, useState } from 'react';
import { type Cur } from '../domain';
import type { CtyCountLog } from '../ops';
import { useCty, Card } from './CtyApp';
import { curName, money, monthName, t3 } from './text';

const dateHour = (at: string) => {
  const dt = new Date(at);
  if (Number.isNaN(dt.getTime())) return at.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
};

export function CountHistory({ bookId }: { bookId: number }) {
  const { s, d } = useCty();
  const [rows, setRows] = useState<CtyCountLog[] | null>(null);
  useEffect(() => {
    s.api.call('cty.count.history', { bookId }).then(setRows).catch(() => setRows([]));
  }, [s.api, bookId]);
  if (!rows) return null;
  const key = { LOC: 'loc', USD: 'usd', EUR: 'eur' } as const;
  return (
    <Card>
      <details>
        <summary className="cty-label" style={{ cursor: 'pointer' }}>🧮 {t3('سجل العدّ', 'History of the counts', 'Historique des comptages')} ({rows.length})</summary>
        {rows.length === 0 && <p className="muted small">{t3('لا عدّ محفوظاً بعد. كل عدّ تحفظه يبقى هنا بتاريخه وساعته.', 'No count saved yet. Every count you save stays here with its date and hour.', 'Aucun comptage enregistré. Chaque comptage enregistré reste ici avec sa date et son heure.')}</p>}
        {rows.map((r) => {
          const curs = (['LOC', 'USD', 'EUR'] as Cur[]).filter((c) => r[`counted_${key[c]}` as 'counted_loc'] || (r[`held_${key[c]}` as 'held_loc'] ?? 0));
          let detail: Record<string, Record<string, number>> = {};
          try { detail = r.detail ? JSON.parse(r.detail) : {}; } catch { /* totals only */ }
          return (
            <details key={r.id} className="cty-count-row">
              <summary>
                <b>{dateHour(r.at)}</b> · {r.who ?? ''} · {r.kind === 'close' ? `🔒 ${t3('إغلاق', 'Closing', 'Clôture')} ${r.ym ? monthName(r.ym) : ''}` : t3('عدّ', 'Count', 'Comptage')}
                {curs.map((c) => {
                  const counted = r[`counted_${key[c]}` as 'counted_loc'];
                  const held = r[`held_${key[c]}` as 'held_loc'];
                  const diff = held == null ? null : Math.round((counted - held) * 100) / 100;
                  return <span key={c} className="cty-count-cur"> · {money(counted, c)} {curName(c, d.local)} {diff == null ? '' : diff === 0 ? <span className="ok">✓</span> : <span className="bad">({money(diff, c)})</span>}</span>;
                })}
              </summary>
              <div className="cty-count-body">
                {curs.map((c) => {
                  const notes = Object.entries(detail[c] ?? {});
                  const held = r[`held_${key[c]}` as 'held_loc'];
                  return (
                    <div key={c} style={{ marginBottom: 6 }}>
                      <b>{curName(c, d.local)}</b> · {t3('الدفتر', 'Book', 'Compte')}: {held == null ? '—' : money(held, c)} · {t3('المعدود', 'Counted', 'Compté')}: {money(r[`counted_${key[c]}` as 'counted_loc'], c)}
                      {notes.length > 0 && <div className="muted small">{notes.map(([face, q]) => (face === 'other' ? `${t3('فراطة / غير ذلك', 'Coins / other', 'Pièces / autre')} ${money(q, c)}` : `${money(Number(face), c)} × ${q}`)).join(' · ')}</div>}
                    </div>
                  );
                })}
                {r.note && <div className="alert warn"><b>{t3('السبب', 'Reason', 'Raison')}:</b> {r.note}</div>}
              </div>
            </details>
          );
        })}
      </details>
    </Card>
  );
}
