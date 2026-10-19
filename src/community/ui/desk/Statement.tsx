// The community's account at the économat, as the country econome keeps it (from his
// last return file): claims accepted, charges between communities, payments, cotisations.
// Each line visible; each currency apart. > 0 the Province owes the community, < 0 it owes.
import { useState } from 'react';
import { errText, parseAmount, promptBox, toast, todayIso } from '../../../ui/kit';
import { CURS, yearOf, type Cur, type Money } from '../../domain';
import { compareSides, type Comparison as Cmp, type MoveKind, type MoveStatus, type SideLine } from '../../ledger';
import type { ProvinceLine } from '../../files';
import { useCty } from '../CtyApp';
import { curName, money, t3, yearName } from '../text';

export const kindName = (k: string): string =>
  k === 'claim' ? t3('مطالبة مقبولة', 'Claim accepted', 'Réclamation acceptée')
    : k === 'host' ? t3('استضافة لجماعة أخرى', 'Hosting for another community', "Accueil pour une autre communauté")
      : k === 'charged' ? t3('تكلفة من جماعة أخرى', 'Charged by another community', 'Facturé par une autre communauté')
        : k === 'paid_by_cty' ? t3('دفعته الجماعة', 'Paid by the community', 'Payé par la communauté')
          : k === 'paid_to_cty' ? t3('دُفع للجماعة', 'Paid to the community', 'Payé à la communauté')
            : k === 'cotisation' ? t3('مساهمة', 'Cotisation', 'Cotisation') : t3('غير ذلك', 'Other', 'Autre');

export const statusName = (s: string | undefined): string =>
  s === 'promised' ? t3('موعود', 'Promised', 'Promis') : s === 'on_the_way' ? t3('في الطريق', 'On the way', 'En route') : t3('استُلم', 'Received', 'Reçu');

/** The two sides of the money with the Province, compared in plain words. */
export function Comparison({ cmp, local, countrySays, communitySays }: { cmp: Cmp; local: string; countrySays: string; communitySays: string }) {
  const line = (l: SideLine) => `${l.date} · ${kindName(l.kind)} · ${money(l.amount, l.cur)} ${curName(l.cur, local)} · ${l.note}`;
  const nothing = !cmp.matched.length && !cmp.onlyCountry.length && !cmp.onlyCommunity.length;
  return (
    <div className="cty-card">
      <div className="cty-label">{t3('هل يتفق الطرفان؟', 'Do both sides agree?', 'Les deux côtés sont-ils d’accord ?')}</div>
      {nothing && <p className="muted small">{t3('لا حركات بعد.', 'No movements yet.', 'Aucun mouvement encore.')}</p>}
      {cmp.matched.map((x) => (
        <div key={x.country.id} className="cty-office"><span>✓ {line(x.country)}</span>{!x.sameStatus && <span className="desk-alert small">{countrySays}: {statusName(x.country.status)} · {communitySays}: {statusName(x.community.status)}</span>}</div>
      ))}
      {cmp.onlyCountry.map((x) => <div key={x.id} className="cty-office"><span>⚠ {line(x)}</span><span className="desk-alert small">{t3(`سجّله ${countrySays} فقط`, `only ${countrySays} recorded this`, `seul ${countrySays} l’a noté`)}</span></div>)}
      {cmp.onlyCommunity.map((x) => <div key={x.id} className="cty-office"><span>⚠ {line(x)}</span><span className="desk-alert small">{t3(`سجّله ${communitySays} فقط`, `only ${communitySays} recorded this`, `seul ${communitySays} l’a noté`)}</span></div>)}
      {!nothing && !cmp.onlyCountry.length && !cmp.onlyCommunity.length && cmp.matched.every((x) => x.sameStatus) && <p className="ok small">{t3('الطرفان متفقان ✓', 'Both sides agree ✓', 'Les deux côtés sont d’accord ✓')}</p>}
    </div>
  );
}

const PROV_KINDS: MoveKind[] = ['paid_to_cty', 'paid_by_cty', 'cotisation', 'other'];
export const provKindName = (k: string) => k === 'paid_to_cty' ? t3('الإقليم أعطانا مالاً', 'The Province gave us money', 'La Province nous a donné de l’argent') : k === 'paid_by_cty' ? t3('دفعنا للإقليم', 'We paid the Province', 'Nous avons payé la Province') : kindName(k);

/** What the community itself records of the money with the Province, compared with the country econome's side. */
function OurSide() {
  const { s, d, reload } = useCty();
  const mayWrite = d.books.some((b) => b.cty_kind === 'cash' && d.kept.includes(b.id));
  const [f, setF] = useState({ date: todayIso(), kind: 'paid_to_cty' as MoveKind, cur: 'LOC' as Cur, amount: '', note: '', status: 'received' as MoveStatus });
  const save = async () => {
    try { await s.api.call('cty.province.save', { line: { ...f, amount: parseAmount(f.amount) } }); setF({ ...f, amount: '', note: '' }); await reload(); toast(t3('سُجّل ✓', 'Recorded ✓', 'Enregistré ✓')); } catch (e) { toast(errText(e), true); }
  };
  const advance = async (x: ProvinceLine) => {
    const next: MoveStatus = x.status === 'promised' ? 'on_the_way' : 'received';
    try { await s.api.call('cty.province.save', { line: { ...x, status: next } }); await reload(); } catch (e) { toast(errText(e), true); }
  };
  const del = async (x: ProvinceLine) => {
    const reason = await promptBox(t3('سبب الحذف؟', 'Why delete it?', 'Pourquoi le supprimer ?'));
    if (!reason) return;
    try { await s.api.call('cty.province.delete', { id: x.id, reason }); await reload(); } catch (e) { toast(errText(e), true); }
  };
  const theirs: SideLine[] = d.statement.filter((l) => l.id.startsWith('move:')).map((l) => ({ id: l.id, date: l.date, kind: l.kind as MoveKind, cur: l.cur, amount: Math.abs(l.amount), note: l.note ?? '', status: (l.status ?? 'received') as MoveStatus }));
  const cmp = compareSides(theirs, d.province.map((x) => ({ ...x })));
  return (
    <>
      <div className="cty-card">
        <div className="cty-label">{t3('ما سجّلناه نحن', 'What we recorded ourselves', 'Ce que nous avons noté nous-mêmes')}</div>
        <p className="muted small">{t3('سجّل هنا المال بينكم وبين الإقليم: إعانة وعدوا بها أو وصلت، أو مبلغاً دفعتموه، أو مساهمة. يرى قيم البلد ما سجّلتم ويقارنه بما سجّله هو.', 'Record here the money between you and the Province: a grant promised or received, a payment you made, a cotisation. The country econome sees what you recorded and compares it with his own record.', 'Notez ici l’argent entre vous et la Province : une aide promise ou reçue, un paiement fait, une cotisation. L’économe du pays voit ce que vous avez noté et le compare avec le sien.')}</p>
        {mayWrite && (
          <div className="desk-filters" style={{ marginBottom: 8 }}>
            <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as MoveKind })}>{PROV_KINDS.map((k) => <option key={k} value={k}>{provKindName(k)}</option>)}</select>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as MoveStatus })}>{(['promised', 'on_the_way', 'received'] as MoveStatus[]).map((x) => <option key={x} value={x}>{statusName(x)}</option>)}</select>
            <input inputMode="decimal" placeholder={t3('المبلغ', 'Amount', 'Montant')} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ width: 110 }} />
            <select value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value as Cur })}>{CURS.map((c) => <option key={c} value={c}>{curName(c, d.local)}</option>)}</select>
            <input placeholder={t3('الشرح', 'What', 'Quoi')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ minWidth: 200 }} />
            <button className="btn primary" onClick={save}>{t3('سجّل', 'Record', 'Enregistrer')}</button>
          </div>
        )}
        {d.province.length === 0 ? <p className="muted small">{t3('لا شيء بعد.', 'Nothing yet.', 'Rien encore.')}</p> : (
          <table className="desk-table">
            <tbody>
              {[...d.province].reverse().map((x) => (
                <tr key={x.id}>
                  <td>{x.date}</td><td>{provKindName(x.kind)}</td><td className="desk-note">{x.note}</td>
                  <td className="num">{money(x.amount, x.cur)} {curName(x.cur, d.local)}</td>
                  <td><span className="cty-pill modify">{statusName(x.status)}</span></td>
                  <td>{mayWrite && x.status !== 'received' && <button className="cty-link" onClick={() => advance(x)}>→ {statusName(x.status === 'promised' ? 'on_the_way' : 'received')}</button>} {mayWrite && <button className="cty-link" onClick={() => del(x)}>{t3('حذف', 'delete', 'supprimer')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Comparison cmp={cmp} local={d.local} countrySays={t3('قيم البلد', 'the country econome', 'l’économe du pays')} communitySays={t3('أنتم', 'you', 'vous')} />
    </>
  );
}

export function Statement() {
  const { d } = useCty();
  const total: Money = { LOC: 0, USD: 0, EUR: 0 };
  const expected: Money = { LOC: 0, USD: 0, EUR: 0 };
  // only what is received counts; the rest is expected
  for (const l of d.statement) (l.status && l.status !== 'received' ? expected : total)[l.cur] += l.amount;
  const years = [...new Set(d.statement.map((l) => yearOf(l.date)))].sort((a, b) => b - a);
  return (
    <>
      <div className="desk-head"><h1>{t3('الحساب عند الإيكونوماتو', 'Account at the économat', "Compte à l'économat")}</h1></div>
      <div className="cty-card cty-explain">
        <b>{t3('ما هذا؟', 'What is this?', "Qu'est-ce que c'est ?")}</b>
        <p>{t3('هذا حساب جماعتكم عند خزينة الإقليم (الإيكونوماتو)، كما يمسكه قيم البلد. فيه ما للجماعة على الإقليم (مطالبات قُبلت، استضافة إخوة من جماعات أخرى) وما عليها (مساهمات، تكاليف إخوتنا عند غيرنا، مال استلمته).', 'This is your community’s account with the Province treasury (the économat), as the country econome keeps it. It shows what the Province owes the community (claims accepted, brothers of other communities hosted) and what the community owes (cotisations, our brothers’ stays elsewhere, money it received).', "C'est le compte de votre communauté auprès de la trésorerie de la Province (l'économat), tel que l'économe du pays le tient. Il montre ce que la Province doit à la communauté (réclamations acceptées, frères d'autres communautés accueillis) et ce que la communauté doit (cotisations, séjours de nos frères ailleurs, argent reçu).")}</p>
        <p className="muted small">＋ {t3('للجماعة', 'in the community’s favour', 'en faveur de la communauté')} · − {t3('على الجماعة', 'the community owes', 'la communauté doit')}</p>
      </div>
      <p className="muted">{d.lastReturnAt ? `${t3('كما أرسله قيم البلد في', 'As the country econome sent it on', "Tel que l'économe du pays l'a envoyé le")} ${d.lastReturnAt.slice(0, 10)}.` : t3('لم يصل ملف رجوع بعد (صفحة «شهر الجماعة»).', "No return file yet (page “Consolidated month”).", 'Pas encore de fichier de retour (page « Mois consolidé »).')}</p>
      <div className="desk-cards">
        {CURS.filter((c) => c === 'LOC' || total[c]).map((c) => (
          <div key={c} className="cty-card desk-card">
            <div className="cty-label">{curName(c, d.local)}</div>
            <div className="desk-bal"><b className={total[c] < 0 ? 'desk-alert' : ''}>{money(total[c], c)}</b></div>
            {expected[c] !== 0 && <div className="small" style={{ color: '#8a5a10' }}>{t3('متوقَّع', 'Expected', 'Attendu')}: {money(expected[c], c)}</div>}
            <div className="small muted">{total[c] > 0 ? t3('للجماعة', 'in the community’s favour', 'en faveur de la communauté') : total[c] < 0 ? t3('على الجماعة أن تدفع', 'the community must pay', 'la communauté doit payer') : t3('متوازن', 'balanced', 'équilibré')}</div>
          </div>
        ))}
      </div>
      <OurSide />
      {years.map((y) => (
        <div key={y} className="cty-card desk-scroll">
          <div className="cty-label">{yearName(y)}</div>
          <table className="desk-table">
            <thead><tr><th>{t3('التاريخ', 'Date', 'Date')}</th><th>{t3('النوع', 'Kind', 'Type')}</th><th>{t3('الشرح', 'What', 'Quoi')}</th>{CURS.map((c) => <th key={c} className="num">{curName(c, d.local)}</th>)}</tr></thead>
            <tbody>
              {d.statement.filter((l) => yearOf(l.date) === y).map((l) => (
                <tr key={l.id}><td>{l.date}</td><td>{kindName(l.kind)}{l.status && l.status !== 'received' ? <span className={`cty-pill modify`} style={{ marginInlineStart: 6 }}>{statusName(l.status)}</span> : null}</td><td className="desk-note">{l.note}</td>{CURS.map((c) => <td key={c} className={`num ${l.cur === c ? (l.amount < 0 ? 'out' : 'in') : ''}`}>{l.cur === c ? money(l.amount, c) : ''}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
