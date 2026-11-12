// The Coordinator (Fouad, 2026-11-07): a space of its own for what the whole network shares, entered only by the
// administrator ("Sign in as administrator" on the first page). It belongs to no database: Homs is one centre like the
// others. The Coordinator sees and manages — the databases (new, with their list of headings and lines; switch off,
// delete, put back), the budget lists, the people and their access — but never changes a centre's records: to do that
// he enters the centre (as its Superior). Each centre keeps its autonomy.
import { useEffect, useState } from 'react';
import { m, tx } from '../i18n';
import { provinceApi, serverManageList, waitingApi, type DbInfo, type DirInfo, type ManagedDb, type Waiting } from '../net';
import { CoordinatorWaiting, type Area } from './CoordinatorWaiting';
import { pickFile, toBase64 } from '../platform';
import { errText, fmtDate, toast } from './kit';
import { BrandFrame, CreateDb, DbCard, HouseOpen } from './Landing';
import { ManageDbs } from './ManageDbs';
import { DirAdmin } from './Directory';
import { Tabs } from './kit';
import { MainListPanel, takeMainListWish } from './MainListPanel';
import { ProvinceBook } from './ProvinceBook';
import { ProvinceGrants } from './ProvinceGrants';

const t3 = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));
type Sec = 'waiting' | 'dbs' | 'grants' | 'province' | 'people' | 'lists';

export function Coordinator({ dbs, dir, onOpen, onCreated, onChanged, onSignOut, onCommunities, signedIn, onBackIn }: {
  dbs: DbInfo[];
  dir: DirInfo;
  /** enter a database (its records are changed there, not here) */
  onOpen: (db: DbInfo) => void;
  onCreated: (slug: string) => void;
  /** a database or a person changed: the server's lists again */
  onChanged: () => Promise<void>;
  onSignOut: () => void;
  /** the Jesuit communities' side, behind its own password */
  onCommunities?: () => void;
  signedIn?: { name: string; db: string } | null;
  onBackIn?: () => void;
}) {
  // sent from a centre's Lists → Budget ("Change it in the list"): open on the budget lists
  const [sec, setSec] = useState<Sec>(() => (takeMainListWish() ? 'lists' : 'waiting'));
  // what is waiting: the first page, and its count on the tab
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const loadWaiting = () => waitingApi.get().then(setWaiting).catch(() => setWaiting({ at: '', count: 0, groups: [] }));
  useEffect(() => { void loadWaiting(); }, []);
  useEffect(() => { if (sec === 'waiting') void loadWaiting(); }, [sec]);
  const [creating, setCreating] = useState(false);
  const isCty = (x: DbInfo) => x.kind === 'community' || x.kind === 'country';
  const centres = dbs.filter((x) => !isCty(x));
  if (creating)
    return (
      <BrandFrame wide invite={false}>
        <CreateDb onCancel={() => setCreating(false)} onCreated={(slug) => { setCreating(false); onCreated(slug); }} />
      </BrandFrame>
    );
  return (
    <HouseOpen dbs={dbs} onOpen={onOpen}>
    <BrandFrame wide invite={false}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>🧭 {t3('المنسّق', 'Coordinator', 'Coordinateur')}</h1>
        <span className="row" style={{ gap: 6 }}>
          {signedIn && onBackIn && <button className="btn small" onClick={onBackIn}>{t3('رجوع إلى', 'Back to', 'Retour à')} {signedIn.db}</button>}
          <button className="btn small ghost" onClick={onSignOut}>{dir.person?.name} · {t3('خروج', 'Sign out', 'Se déconnecter')}</button>
        </span>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        {t3('ما تشترك فيه الشبكة كلها: قواعد البيانات، وقوائم الموازنة، والأشخاص وصلاحياتهم. المنسّق يرى ويدير، ولا يغيّر قيود مركز: لذلك يدخل المركز. كل مركز يبقى مستقلاً.',
          'What the whole network shares: the databases, the budget lists, the people and their access. The Coordinator sees and manages, but never changes a centre\'s records: for that, enter the centre. Each centre keeps its autonomy.',
          "Ce que tout le réseau partage : les bases, les listes du budget, les personnes et leurs accès. Le Coordinateur voit et gère, mais ne change jamais les écritures d'un centre : pour cela, entrez dans le centre. Chaque centre garde son autonomie.")}
      </p>
      <Tabs value={sec} onChange={setSec} tabs={[
        { value: 'waiting', label: `${t3('ما ينتظر', 'What is waiting', 'Ce qui attend')}${waiting?.count ? ` (${waiting.count})` : ''}` },
        { value: 'dbs', label: t3('قواعد البيانات', 'Databases', 'Bases de données') },
        { value: 'grants', label: t3('المنح', 'Grants', 'Subventions') },
        { value: 'province', label: t3('حساب الإقليم', 'Province account', 'Compte de la Province') },
        { value: 'lists', label: t3('قوائم الموازنة', 'Budget lists', 'Listes du budget') },
        { value: 'people', label: t3('الأشخاص والصلاحيات', 'People & access', 'Personnes et accès') },
      ]} />
      {sec === 'waiting' && <div style={{ marginTop: 12 }}><CoordinatorWaiting data={waiting} onGo={(a: Area) => setSec(a)} onRefresh={() => void loadWaiting()} /></div>}
      {sec === 'dbs' && (
        <>
          <div className="db-grid" style={{ marginTop: 12 }}>
            {centres.map((d) => <DbCard key={d.slug} db={d} onOpen={() => onOpen(d)} />)}
            <button className="db-card db-new" onClick={() => setCreating(true)}>
              <div className="db-card-mark"><span>＋</span></div>
              <div className="db-card-text"><b>{t3('قاعدة بيانات جديدة', 'New database', 'Nouvelle base')}</b><span>{t3('مركز، سنة جديدة، مشروع… مع قائمته', 'a centre, a new year, a project… with its list', 'un centre, une nouvelle année, un projet… avec sa liste')}</span></div>
            </button>
          </div>
          {onCommunities && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn small ghost" onClick={onCommunities}><img src="/brand/jesuits.png" alt="" style={{ height: 18, verticalAlign: 'middle' }} /> {t3('جماعات اليسوعيين', 'Jesuit communities', 'Communautés jésuites')} ›</button>
            </div>
          )}
          <Copies onChanged={onChanged} />
          <h3 style={{ marginTop: 18 }}>{t3('إيقاف، حذف، استعادة', 'Switch off, delete, put back', 'Désactiver, supprimer, remettre')}</h3>
          <ManageDbs inline coordinator onClose={() => undefined} onChanged={onChanged} />
        </>
      )}
      {sec === 'grants' && <div style={{ marginTop: 12 }}><ProvinceGrants /></div>}
      {sec === 'province' && <div style={{ marginTop: 12 }}><ProvinceBook /></div>}
      {sec === 'lists' && <div style={{ marginTop: 12 }}><MainListPanel dbs={centres.filter((d) => !d.kind || d.kind === 'centre')} onReload={onChanged} /></div>}
      {sec === 'people' && <div style={{ marginTop: 12 }}><DirAdmin inline onClose={() => undefined} onChanged={onChanged} /></div>}
    </BrandFrame>
    </HouseOpen>
  );
}

/**
 * Copies of centres from other servers (Fouad, 2026-11-07): a backup sent by that centre (e.g. Aleppo), brought here
 * read only — nobody signs in to it; the grants' reports count it, with its date. A newer backup updates it.
 */
function Copies({ onChanged }: { onChanged: () => Promise<void> }) {
  const [copies, setCopies] = useState<ManagedDb[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => serverManageList().then((x) => setCopies(x.dbs.filter((d) => d.copy))).catch(() => setCopies([]));
  useEffect(() => { void load(); }, []);
  const bring = async (slug?: string) => {
    const f = await pickFile(['db'], t3('اختر النسخة الاحتياطية (.db)', 'Choose the backup (.db)', 'Choisissez la sauvegarde (.db)'));
    if (!f) return;
    setBusy(true);
    try {
      const r = await provinceApi.copy(toBase64(f.bytes), slug);
      toast(`${r.organisation ?? ''}: ${slug ? t3('حُدّثت النسخة', 'the copy is updated', 'la copie est à jour') : t3('أُحضرت النسخة', 'the copy is here', 'la copie est arrivée')}`);
      await load();
      await onChanged();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>{t3('نسخ من خوادم أخرى', 'Copies from other servers', "Copies d'autres serveurs")}</b>
        <button className="btn small" disabled={busy} onClick={() => void bring()}>⬆ {t3('أحضر نسخة من خادم آخر…', 'Bring a copy from another server…', "Apporter une copie d'un autre serveur…")}</button>
      </div>
      <p className="muted small" style={{ margin: '4px 0 6px' }}>{t3('نسخة احتياطية يرسلها مركز على خادم آخر (مثل حلب). للقراءة فقط: لا يدخلها أحد؛ تقارير المنح تحسبها بتاريخها.', 'A backup sent by a centre on another server (e.g. Aleppo). Read only: nobody signs in to it; the grants\' reports count it, with its date.', "Une sauvegarde envoyée par un centre sur un autre serveur (par ex. Alep). En lecture seule : personne n'y entre ; les rapports des subventions la comptent, avec sa date.")}</p>
      {copies.map((c) => (
        <div key={c.slug} className="row" style={{ gap: 8, alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--line)' }}>
          <b>{c.organisation}</b>
          <span className="muted small">{t3('نسخة بتاريخ', 'copy of', 'copie du')} {fmtDate(c.copy!.at.slice(0, 10))}{c.list ? ` · ${c.list}` : ''}</span>
          <button className="btn small ghost" style={{ marginInlineStart: 'auto' }} disabled={busy} onClick={() => void bring(c.slug)}>⬆ {t3('حدّث النسخة…', 'Update the copy…', 'Mettre à jour la copie…')}</button>
        </div>
      ))}
    </div>
  );
}
