// What this community charges other communities (it hosted one of their Jesuits…).
// The econome marks it; it travels in the monthly file; the country econome approves
// or refuses, and his decision comes back in the return file.
import { useState } from 'react';
import { errText, parseAmount, promptBox, toast, todayIso } from '../../../ui/kit';
import { CURS, type Cur } from '../../domain';
import { useCty } from '../CtyApp';
import { curName, money, t3 } from '../text';

export function HostCharges() {
  const { d, s, reload } = useCty();
  const [f, setF] = useState({ date: todayIso(), to_uid: d.known[0]?.uid ?? '', to_name: '', person: '', cur: 'LOC' as Cur, amount: '', note: '' });
  const save = async () => {
    try {
      await s.api.call('cty.charge.save', { charge: { ...f, to_uid: f.to_uid || null, amount: parseAmount(f.amount) } });
      setF({ ...f, person: '', amount: '', note: '' });
      await reload();
      toast(t3('سُجّل: يذهب في ملف الشهر', 'Recorded: it goes in the month’s file', 'Enregistré : il part dans le fichier du mois'));
    } catch (e) { toast(errText(e), true); }
  };
  const del = async (id: string) => {
    const reason = await promptBox(t3('سبب الحذف؟', 'Why delete it?', 'Pourquoi le supprimer ?'));
    if (!reason) return;
    try { await s.api.call('cty.charge.delete', { id, reason }); await reload(); } catch (e) { toast(errText(e), true); }
  };
  const status = (x: string) => (x === 'approved' ? <span className="ok">✓ {t3('وافق قيّم البلد', 'approved', 'approuvé')}</span>
    : x === 'refused' ? <span className="desk-alert">✗ {t3('رُفض', 'refused', 'refusé')}</span>
      : <span className="muted">{t3('بانتظار قيّم البلد', 'waiting for the country econome', "en attente de l'économe du pays")}</span>);
  return (
    <>
      <div className="desk-head"><h1>{t3('تكاليف على جماعات أخرى', 'Charges to other communities', 'Charges à d’autres communautés')}</h1></div>
      <p className="muted">{t3('مثلاً: يسوعي من حمص أقام عندنا 3 ليالٍ. نسجّلها هنا، فتذهب في ملف الشهر، ويوافق عليها قيّم البلد.', 'E.g. a Jesuit of Homs stayed 3 nights with us. Record it here: it goes in the month’s file, and the country econome approves it.', "P. ex. un jésuite de Homs a passé 3 nuits chez nous. Enregistrez-le ici : il part dans le fichier du mois, et l'économe du pays l'approuve.")}</p>
      <div className="cty-card">
        <div className="desk-filters" style={{ marginBottom: 0 }}>
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          {d.known.length > 0 ? (
            <select value={f.to_uid} onChange={(e) => setF({ ...f, to_uid: e.target.value })}>
              {d.known.map((k) => <option key={k.uid} value={k.uid}>{k.name}</option>)}
              <option value="">{t3('غيرها…', 'Another…', 'Une autre…')}</option>
            </select>
          ) : null}
          {(!d.known.length || !f.to_uid) && <input placeholder={t3('اسم الجماعة', 'Name of the community', 'Nom de la communauté')} value={f.to_name} onChange={(e) => setF({ ...f, to_name: e.target.value })} />}
          <input placeholder={t3('من؟ (اسم اليسوعي)', 'Who? (the Jesuit)', 'Qui ? (le jésuite)')} value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} />
          <input inputMode="decimal" placeholder={t3('المبلغ', 'Amount', 'Montant')} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ width: 110 }} />
          <select value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value as Cur })}>{CURS.map((c) => <option key={c} value={c}>{curName(c, d.local)}</option>)}</select>
          <input placeholder={t3('الشرح: كم ليلة؟ لماذا؟', 'What: how many nights? why?', 'Quoi : combien de nuits ? pourquoi ?')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ minWidth: 200 }} />
          <button className="btn primary" onClick={save}>{t3('سجّل', 'Record', 'Enregistrer')}</button>
        </div>
        {!d.known.length && <p className="muted small">{t3('قائمة الجماعات تأتي مع أول ملف رجوع من قيّم البلد.', 'The list of communities comes with the first return file from the country econome.', "La liste des communautés arrive avec le premier fichier de retour de l'économe du pays.")}</p>}
      </div>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('التاريخ', 'Date', 'Date')}</th><th>{t3('الجماعة', 'Community', 'Communauté')}</th><th>{t3('من', 'Who', 'Qui')}</th><th>{t3('الشرح', 'What', 'Quoi')}</th><th className="num">{t3('المبلغ', 'Amount', 'Montant')}</th><th>{t3('القرار', 'Decision', 'Décision')}</th><th /></tr></thead>
          <tbody>
            {d.charges.map((c) => (
              <tr key={c.id}>
                <td>{c.date}</td><td>{c.to_name}</td><td>{c.person}</td><td>{c.note}</td>
                <td className="num">{money(c.amount, c.cur)} {curName(c.cur, d.local)}</td>
                <td className="small">{status(c.status)}{c.decision_note && <div className="muted">{c.decision_note}</div>}</td>
                <td>{c.status === 'waiting' && !d.closed.includes(c.date.slice(0, 7)) && <button className="cty-link" onClick={() => del(c.id)}>{t3('حذف', 'delete', 'supprimer')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
