// Coordinator → What is waiting (Fouad, 2026-11-12): the first page. What needs the administrator, from every centre, the
// Province account and the grants — each group with the place to go. Nothing here changes anything.
import { m, tx } from '../i18n';
import type { Waiting, WaitingGroup, WaitingItem } from '../net';
import { fmtSyp, fmtUsd } from './kit';

const t3 = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));
export type Area = WaitingGroup['area'];

const TITLE: Record<string, () => string> = {
  requests: () => t3('طلبات المراكز: بند أو خط', 'Requests from the centres: a heading or a line', 'Demandes des centres : une rubrique ou une ligne'),
  sends: () => t3('إرسالات تنتظر جواب المركز، أو «لم يصل»', "Sends waiting for the centre's answer, or \"not received\"", 'Envois en attente de la réponse du centre, ou « pas reçu »'),
  months: () => t3('أشهر لم تُغلق', 'Months not closed', 'Mois non clôturés'),
  copies: () => t3('نسخ قديمة (30 يوماً فأكثر)', 'Copies getting old (30 days or more)', 'Copies qui vieillissent (30 jours ou plus)'),
  unsent: () => t3('مال في حساب الإقليم لم يُرسل بعد', 'Money in the Province account, not yet sent', 'Argent sur le compte de la Province, pas encore envoyé'),
  ending: () => t3('منح تنتهي قريباً', 'Grants ending soon', 'Subventions qui se terminent bientôt'),
  unsplit: () => t3('منح لم تُقسَّم كلها على المراكز', 'Grants not fully split between the centres', 'Subventions pas entièrement réparties entre les centres'),
  notready: () => t3('مشاريع لا تستقبل إرسالاً بعد', 'Projects that cannot receive a send yet', 'Projets qui ne peuvent pas encore recevoir un envoi'),
  loose: () => t3('دخل في حساب الإقليم بلا منحة', 'Money in without a grant', 'Entrées sur le compte sans subvention'),
};
const GO: Record<Area, () => string> = {
  lists: () => t3('قوائم الموازنة', 'Budget lists', 'Listes du budget'),
  province: () => t3('حساب الإقليم', 'Province account', 'Compte de la Province'),
  grants: () => t3('المنح', 'Grants', 'Subventions'),
  dbs: () => t3('قواعد البيانات', 'Databases', 'Bases de données'),
};

const money = (x: WaitingItem) => [x.usd ? `$${fmtUsd(x.usd)}` : '', x.syp ? `${fmtSyp(x.syp)} SYP` : ''].filter(Boolean).join(' + ');

/** the small words after an item: its age, its money, its note */
function Detail({ g, x }: { g: string; x: WaitingItem }) {
  const bits: string[] = [];
  if (g === 'ending' && x.days != null) bits.push(x.days < 0 ? t3(`انتهت منذ ${-x.days} يوماً`, `ended ${-x.days} days ago`, `terminée il y a ${-x.days} jours`) : t3(`تنتهي بعد ${x.days} يوماً`, `ends in ${x.days} days`, `se termine dans ${x.days} jours`));
  else if (g === 'months') bits.push(x.note ?? '');
  else {
    if (x.days != null) bits.push(t3(`منذ ${x.days} يوماً`, `${x.days} days`, `${x.days} jours`));
    if (g === 'notready') bits.push(`${x.note?.includes('dates') ? t3('بلا تواريخ', 'no dates', 'sans dates') : ''}${x.note?.includes('+') ? ' · ' : ''}${x.note?.includes('line') ? t3('بلا خط في الموازنة', 'no budget line', 'sans ligne de budget') : ''}${x.note === 'project' ? t3('بلا مشروع', 'no project', 'sans projet') : ''}`);
    else if (g === 'ending') bits.push(x.note ?? '');
    else if (x.note && g !== 'unsplit') bits.push(x.note);
  }
  const mo = money(x);
  if (mo) bits.unshift(mo);
  const text = bits.filter(Boolean).join(' · ');
  return text ? <span className="muted small"> — <span className="ltr">{text}</span></span> : null;
}

export function CoordinatorWaiting({ data, onGo, onRefresh }: { data: Waiting | null; onGo: (a: Area) => void; onRefresh: () => void }) {
  if (!data) return <p className="muted">…</p>;
  return (
    <div style={{ maxWidth: 980 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span className="muted small">{data.count ? t3(`${data.count} شيئاً ينتظر`, `${data.count} things are waiting`, `${data.count} choses attendent`) : ''}</span>
        <button className="btn small ghost" style={{ marginInlineStart: 'auto' }} onClick={onRefresh}>↻ {t3('حدّث', 'Refresh', 'Actualiser')}</button>
      </div>
      {!data.groups.length && (
        <div className="panel" style={{ textAlign: 'center' }}>
          <b>✓ {t3('لا شيء ينتظر', 'Nothing is waiting', 'Rien n’attend')}</b>
          <div className="muted small">{t3('لا طلبات، ولا إرسالات بلا جواب، ولا أشهر مفتوحة، ولا نسخ قديمة.', 'No requests, no unanswered sends, no open months, no old copies.', 'Aucune demande, aucun envoi sans réponse, aucun mois ouvert, aucune copie ancienne.')}</div>
        </div>
      )}
      {data.groups.map((g) => (
        <div key={g.key} className="panel" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <b>{(TITLE[g.key] ?? (() => g.key))()}</b>
            <span className="badge">{g.items.length}</span>
            <button className="btn small" style={{ marginInlineStart: 'auto' }} onClick={() => onGo(g.area)}>{GO[g.area]()} ›</button>
          </div>
          <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
            {g.items.slice(0, 8).map((x, i) => (
              <li key={i}>
                {g.key === 'sends' && <span>{x.state === 'disputed' ? '⚠ ' : '⏳ '}</span>}
                {g.key === 'loose' ? t3(`${x.text} حركة`, `${x.text} rows`, `${x.text} lignes`) : x.text}
                <Detail g={g.key} x={x} />
              </li>
            ))}
            {g.items.length > 8 && <li className="muted small">+ {g.items.length - 8}</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}
