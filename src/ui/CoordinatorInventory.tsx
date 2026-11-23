// Coordinator → Inventory (Fouad, 21 November 2026): what each centre owns, as totals. Reads only: the items, their
// places and the purchases stay in the centre's own database, which the Coordinator enters to see them.
import { useEffect, useState } from 'react';
import { m, tx } from '../i18n';
import { inventoryApi, type CentreInventory } from '../net';
import { errText, fmtDate, toast } from './kit';

const t3 = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));

export function CoordinatorInventory() {
  const [rows, setRows] = useState<CentreInventory[] | null>(null);
  useEffect(() => { inventoryApi.get().then((x) => setRows(x.centres)).catch((e) => { toast(errText(e), true); setRows([]); }); }, []);
  if (!rows) return <p className="muted">…</p>;
  const sum = (f: (x: CentreInventory) => number) => rows.reduce((a, x) => a + f(x), 0);
  const red = (n: number) => (n ? { color: 'var(--err)', fontWeight: 600 } : undefined);
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>{t3('ما يملكه كل مركز، أرقاماً فقط. الأغراض نفسها في قاعدة المركز.', "What each centre owns, as totals. The items themselves are in the centre's own database.", "Ce que chaque centre possède, en totaux. Les objets sont dans la base du centre.")}</p>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr>
            <th>{t3('المركز', 'Centre', 'Centre')}</th><th className="n">{t3('الأغراض', 'Items', 'Objets')}</th><th className="n">{t3('القطع', 'Units', 'Unités')}</th>
            <th className="n">{t3('مشتريات لم تُسجَّل', 'Purchases not registered', 'Achats non enregistrés')}</th><th className="n">{t3('تحتاج انتباهاً', 'Need attention', 'À surveiller')}</th>
            <th className="n">{t3('بلا رقم تسلسلي', 'No serial', 'Sans série')}</th><th className="n">{t3('لم تُعدّ منذ سنة', 'Not counted for a year', 'Non comptés depuis un an')}</th><th>{t3('آخر عدّ', 'Last count', 'Dernier comptage')}</th>
          </tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.slug}>
                <td><b>{x.organisation}</b>{!x.lines && <div className="small" style={{ color: 'var(--err)' }}>{t3('لم تُحدَّد بنود الجرد', 'No inventory lines chosen', "Pas de lignes d'inventaire choisies")}</div>}</td>
                <td className="n">{x.items}</td><td className="n">{x.units}</td>
                <td className="n" style={red(x.toRegister)}>{x.toRegister}</td><td className="n" style={red(x.attention)}>{x.attention}</td>
                <td className="n" style={red(x.noSerial)}>{x.noSerial}</td><td className="n" style={red(x.uncounted)}>{x.uncounted}</td>
                <td className="small">{x.lastCount ? fmtDate(x.lastCount) : '—'}</td>
              </tr>
            ))}
            {rows.length > 1 && (
              <tr className="total"><td>{t3('الكل', 'All centres', 'Tous les centres')}</td><td className="n">{sum((x) => x.items)}</td><td className="n">{sum((x) => x.units)}</td>
                <td className="n">{sum((x) => x.toRegister)}</td><td className="n">{sum((x) => x.attention)}</td><td className="n">{sum((x) => x.noSerial)}</td><td className="n">{sum((x) => x.uncounted)}</td><td /></tr>
            )}
            {!rows.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 18 }}>{t3('لا مراكز', 'No centres', 'Aucun centre')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
