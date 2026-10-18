// Bringing in a Jesuit's Comptapro FDC (the old Excel monthly sheets): choose the book,
// the year (October →), the file. Each filled cell becomes an entry; twice adds nothing.
import { useState } from 'react';
import { errText, todayIso } from '../../../ui/kit';
import { pickFile, toBase64 } from '../../../platform';
import { tx } from '../../../i18n';
import { yearOf } from '../../domain';
import type { FdcImportResult } from '../../importFdc';
import { useCty, bookLabel, bookName } from '../CtyApp';
import { t3, yearName } from '../text';

export function ImportFdc() {
  const { d, s, reload } = useCty();
  const people = d.books.filter((b) => b.active && (b.cty_kind === 'personal' || b.cty_kind === 'house'));
  const [bookId, setBookId] = useState<number | null>(people[0]?.id ?? null);
  const [year, setYear] = useState(yearOf(todayIso()) - 1);
  const [res, setRes] = useState<FdcImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setErr(null);
    setRes(null);
    const f = await pickFile(['xlsx'], t3('اختر ملف FDC', 'Choose the FDC workbook', 'Choisissez le classeur FDC'));
    if (!f || bookId == null) return;
    setBusy(true);
    try {
      setRes(await s.api.call('cty.import.fdc', { bookId, year, base64: toBase64(f.bytes), fileName: f.name }));
      await reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="desk-narrow">
      <h1>{t3('استيراد ورقة FDC', 'Import an FDC workbook', 'Importer un classeur FDC')}</h1>
      <p className="muted">{t3('ورقة Comptapro الشهرية ليسوعي: كل خانة مملوءة تصبح قيداً في آخر يوم من شهرها. استيرادها مرتين لا يضيف شيئاً.', "A Jesuit's Comptapro monthly sheets: each filled cell becomes one entry on the last day of its month. Importing it twice adds nothing.", "Les feuilles mensuelles Comptapro d'un jésuite : chaque case remplie devient une écriture au dernier jour de son mois. L'importer deux fois n'ajoute rien.")}</p>
      <div className="cty-card">
        <label className="field"><span>{t3('في دفتر', 'Into the book', 'Dans le compte')}</span>
          <select value={bookId ?? ''} onChange={(e) => setBookId(Number(e.target.value))}>
            {people.map((b) => <option key={b.id} value={b.id}>{b.cty_kind === 'house' ? bookLabel(b) : bookName(b)}</option>)}
          </select>
        </label>
        <label className="field"><span>{t3('السنة (تشرين الأول ← أيلول)', 'The year (October → September)', "L'année (octobre → septembre)")}</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 6 }, (_, i) => yearOf(todayIso()) - i).map((y) => <option key={y} value={y}>{yearName(y)}</option>)}
          </select>
        </label>
        <button className="btn primary" disabled={busy || bookId == null} onClick={go}>{busy ? '…' : t3('اختيار الملف…', 'Choose the file…', 'Choisir le fichier…')}</button>
      </div>
      {err && <div className="alert err">{err}</div>}
      {res && (
        <div className="cty-card">
          {res.name && <div>{t3('الاسم في الورقة', 'Name on the sheet', 'Nom sur la feuille')}: <b>{res.name}</b></div>}
          <div>✓ {t3(`أُضيف ${res.added} قيداً`, `${res.added} entries added`, `${res.added} écritures ajoutées`)}{res.skipped ? ` · ${t3(`${res.skipped} موجود سابقاً`, `${res.skipped} already there`, `${res.skipped} déjà présentes`)}` : ''}</div>
          {res.problems.length > 0 && <div className="alert warn">{res.problems.map((p, i) => <div key={i}>{tx(p)}</div>)}</div>}
        </div>
      )}
    </div>
  );
}
