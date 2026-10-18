// The chart of codes: family > heading > line, with the names in three languages.
// The econome (cty.chart) changes a code or a name, adds a line, switches one off.
// Past entries follow: they point to the line, not to its number.
import { useState } from 'react';
import { errText, promptBox, toast } from '../../../ui/kit';
import type { CtyAccount } from '../../domain';
import type { AccountInput } from '../../ops';
import { useCty } from '../CtyApp';
import { t3 } from '../text';

/** The community's chart: read only, kept by the country econome (who sends it in the return file). */
export function Chart() {
  const { d, s, reload, can } = useCty();
  return (
    <ChartTable
      accounts={d.accounts} used={new Set(d.entries.map((e) => e.account_id))} may={can('cty.chart')}
      note={t3('يحفظ قيّم البلد الدليل ويرسله مع ملف الرجوع (لاحقاً الإقليم).', 'The country econome keeps the chart and sends it with the return file (later the Province).', "L'économe du pays tient le plan et l'envoie avec le fichier de retour (plus tard la Province).")}
      save={async (account, reason) => { await s.api.call('cty.account.save', { account, reason }); await reload(); }}
    />
  );
}

/** The chart of codes as a table; editable when `may`. */
export function ChartTable({ accounts, used, may, note, save: send }: {
  accounts: CtyAccount[]; used: Set<number | null>; may: boolean; note?: string;
  save: (account: AccountInput, reason: string | null) => Promise<void>;
}) {
  const d = { accounts };
  const [edit, setEdit] = useState<AccountInput | null>(null);
  const [filter, setFilter] = useState('');
  const depth = (a: CtyAccount) => { let n = 0; for (let p = a.parent_id; p != null; p = d.accounts.find((x) => x.id === p)?.parent_id ?? null) n++; return n; };
  const word = filter.trim().toLowerCase();
  const shown = d.accounts.filter((a) => !word || [a.code, a.name_en, a.name_fr, a.name_ar].join(' ').toLowerCase().includes(word));

  const save = async () => {
    if (!edit) return;
    let reason: string | null = null;
    if (edit.id) {
      reason = await promptBox(t3('سبب التعديل؟', 'Why this change?', 'Pourquoi ce changement ?'));
      if (!reason) return;
    }
    try {
      await send(edit, reason);
      setEdit(null);
      toast(t3('حُفظ ✓', 'Saved ✓', 'Enregistré ✓'));
    } catch (e) { toast(errText(e), true); }
  };

  return (
    <>
      <div className="desk-head">
        <h1>{t3('دليل الحسابات', 'Chart of codes', 'Plan des comptes')}</h1>
        <input placeholder={t3('بحث…', 'Search…', 'Chercher…')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {note && <p className="muted">{note}</p>}
      {!may && <p className="muted small">{t3('للقراءة فقط.', 'Read only.', 'Lecture seule.')}</p>}
      <p className="muted small">P = {t3('دفتر شخصي والبيت', 'personal book and house', 'compte personnel et maison')} · H = {t3('البيت فقط', 'house only', 'maison seulement')}</p>
      <div className="cty-card desk-scroll">
        <table className="desk-table">
          <thead><tr><th>{t3('الرمز', 'Code', 'Code')}</th><th>English</th><th>Français</th><th>العربية</th><th>P/H</th><th>↺</th><th /></tr></thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} className={`${depth(a) === 0 ? 'fdc-total' : depth(a) === 1 ? 'fdc-head' : ''} ${a.active ? '' : 'off'}`}>
                <td style={{ paddingInlineStart: 6 + depth(a) * 14 }}>{a.code}</td>
                <td>{a.name_en}</td><td>{a.name_fr}</td><td dir="rtl">{a.name_ar}</td>
                <td>{a.scope}</td><td>{a.claim ? '↺' : ''}</td>
                <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  {may && <button className="cty-link" onClick={() => setEdit({ ...a })}>{t3('تعديل', 'edit', 'modifier')}</button>}
                  {may && depth(a) < 2 && <button className="cty-link" onClick={() => setEdit({ code: '', parent_id: a.id, name_en: '', name_fr: '', name_ar: '' })}>＋ {t3('بند', 'line', 'ligne')}</button>}
                  {used.has(a.id) && <span className="muted small" title={t3('مستعمل', 'used', 'utilisé')}>•</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="cty-sheet" role="dialog">
          <div className="cty-sheet-head"><button className="cty-icon" onClick={() => setEdit(null)}>✕</button><b>{edit.id ? t3('تعديل بند', 'Change a line', 'Modifier une ligne') : t3('بند جديد', 'New line', 'Nouvelle ligne')}</b></div>
          <div className="cty-sheet-body">
            {edit.parent_id != null && <p className="muted">{t3('تحت', 'Under', 'Sous')}: {d.accounts.find((x) => x.id === edit.parent_id)?.code} {d.accounts.find((x) => x.id === edit.parent_id)?.name_en}</p>}
            <label className="field"><span>{t3('الرمز', 'Code', 'Code')}</span><input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></label>
            <label className="field"><span>English</span><input value={edit.name_en} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></label>
            <label className="field"><span>Français</span><input value={edit.name_fr} onChange={(e) => setEdit({ ...edit, name_fr: e.target.value })} /></label>
            <label className="field"><span>العربية</span><input dir="rtl" value={edit.name_ar} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} /></label>
            <label className="field"><span>{t3('في أي دفتر', 'In which books', 'Dans quels comptes')}</span>
              <select value={edit.scope ?? d.accounts.find((x) => x.id === edit.parent_id)?.scope ?? 'H'} onChange={(e) => setEdit({ ...edit, scope: e.target.value as 'P' | 'H' })}>
                <option value="P">P · {t3('دفتر شخصي والبيت', 'personal book and house', 'compte personnel et maison')}</option>
                <option value="H">H · {t3('البيت فقط', 'house only', 'maison seulement')}</option>
              </select>
            </label>
            {edit.id && (
              <label className="cty-check"><input type="checkbox" checked={edit.active !== 0} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /><span>{t3('مستعمل (ألغِ التحديد لإيقافه، لا يُحذف أبداً)', 'In use (untick to switch it off; never deleted)', 'En usage (décocher pour le désactiver ; jamais supprimé)')}</span></label>
            )}
            <button className="btn primary cty-wide" onClick={save}>{t3('احفظ', 'Save', 'Enregistrer')}</button>
          </div>
        </div>
      )}
    </>
  );
}
