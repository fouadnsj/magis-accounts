// The calendar phone (baseline 2.1, section 4; step 5). Linked once at the centre by a manager (a name, a role, a link code);
// it opens with a short code of 4 digits, then straight on Today. Read only. It keeps 1 month back and 6 months ahead, says
// when it was last updated, and never receives prices or payments (the server cuts them; see src/hosting/calphone.ts). With
// no connection it shows what it kept. The view it was left on (Today, Week or Spaces, and the day) is kept.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { gDel, gGet, gSet, lockKey, openKey, type Link, type Msg } from './store';
import { addDays, colorOf } from '../hosting/host';
import { inCalendar, type CalBooking, type CalData, type CalSpace } from '../hosting/calendar';
import { hm, itemsBetween, prepareOf, mondayOf, shutOf, bandOf, todayFigures, type DayItem } from '../hosting/calview';
import { ROLE_NAME, type CalPhonePack } from '../hosting/calphone';

type Tr = (ar: string, en: string, fr: string) => string;
type Lang = 'ar' | 'en' | 'fr';
export interface CalPhoneProps { lang: Lang; t: Tr; tm: (m: Msg) => string; langPick: ReactNode; installHint: ReactNode }

/** what the phone keeps for the link (its key is locked by the code of this phone) */
interface CalLink { link: Link; org: string; name: string; role: string }
type View = 'today' | 'week' | 'spaces';
interface Last { view: View; day: string }

const LINK = 'calphone-link', PACK = 'calphone-pack', LAST = 'calphone-last';
class Offline extends Error {}
class Refused extends Error { constructor(public msg: Msg, public out: boolean) { super(msg.en); } }

async function call<T>(url: string, body: unknown, key?: string): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) }); } catch { throw new Offline(); }
  const json = (await r.json().catch(() => null)) as { error?: Msg } | null;
  if (r.ok) return json as T;
  if (!json) throw new Offline();
  throw new Refused(json.error ?? { ar: 'خطأ في الخادم', en: 'Server error', fr: 'Erreur du serveur' }, r.status === 401);
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (iso: string) => { const d = new Date(iso); return `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function CalPhone(p: CalPhoneProps) {
  const { tm } = p;
  const [link, setLink] = useState<CalLink | null | undefined>(undefined); // undefined: still reading
  const [pack, setPack] = useState<CalPhonePack | null>(null);
  const [key, setKey] = useState<string | null>(null); // the server's key, open while the phone is unlocked
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { void (async () => { setLink((await gGet<CalLink>(LINK)) ?? null); setPack((await gGet<CalPhonePack>(PACK)) ?? null); })(); }, []);
  // the phone locks again after five minutes out of sight
  useEffect(() => {
    let hidden = 0;
    const f = () => { if (document.hidden) hidden = Date.now(); else if (hidden && Date.now() - hidden > 5 * 60e3) setKey(null); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  const forget = useCallback(async (why?: string) => { await gDel(LINK); await gDel(PACK); await gDel(LAST); setLink(null); setPack(null); setKey(null); setNote(why ?? null); }, []);

  if (link === undefined) return <div className="ph-center">…</div>;
  if (!link) return <LinkScreen {...p} note={note} onDone={async (l, k, pk) => { await gSet(LINK, l); await gSet(PACK, pk); setNote(null); setLink(l); setPack(pk); setKey(k); }} />;
  if (!key || !pack) return <LockScreen {...p} link={link} onOpen={setKey} onForget={() => forget()} />;
  return <Calendar {...p} link={link} pack={pack} setPack={setPack} keyOf={key} onLock={() => setKey(null)} onCut={(m) => forget(tm(m))} />;
}

// ---------------------------------------------------------------- linking (once, at the centre)
function LinkScreen({ t, tm, langPick, installHint, note, onDone }: CalPhoneProps & { note: string | null; onDone: (l: CalLink, key: string, pack: CalPhonePack) => Promise<void> }) {
  const [code, setCode] = useState('');
  const [c1, setC1] = useState('');
  const [c2, setC2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = code.replace(/[^A-Za-z0-9]/g, '').length >= 8 && /^\d{4}$/.test(c1) && c1 === c2;
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await call<{ key: string; pack: CalPhonePack }>('/api/calphone/link', { code });
      await onDone({ link: await lockKey(r.key, c1), org: r.pack.organisation, name: r.pack.phone.name, role: r.pack.phone.role }, r.key, r.pack);
    } catch (e) { setErr(e instanceof Offline ? t('لا اتصال بالمركز: افتح الصفحة وأنت على شبكة المركز', 'No connection to the centre: open this page on the centre\'s network', 'Pas de connexion au centre : ouvrez cette page sur le réseau du centre') : e instanceof Refused ? tm(e.msg) : String((e as Error).message)); }
    setBusy(false);
  };
  return (
    <div className="ph-page">
      <div className="ph-brand"><img src="/brand/magis-sun.png" alt="" /><h1>{t('التقويم', 'Calendar', 'Calendrier')}</h1><p>{t('هاتف التقويم: للقراءة فقط', 'Calendar phone: read only', 'Téléphone du calendrier : lecture seule')}</p></div>
      {langPick}
      {installHint}
      {note && <div className="ph-alert">{note}</div>}
      {err && <div className="ph-alert">{err}</div>}
      <div className="ph-card">
        <p className="ph-muted">{t('في المركز، يعطيك المسؤول رمز ربط (يعمل مرة واحدة ولمدة قصيرة). اكتبه هنا ثم اختر رمزاً من 4 أرقام لفتح هذا الهاتف.', 'At the centre, the manager gives you a link code (it works once, for a short time). Type it here, then choose a code of 4 digits to open this phone.', 'Au centre, le responsable vous donne un code de liaison (il ne sert qu’une fois, peu de temps). Tapez-le ici, puis choisissez un code de 4 chiffres pour ouvrir ce téléphone.')}</p>
        <label>{t('رمز الربط', 'Link code', 'Code de liaison')}
          <input className="ltr" autoCapitalize="characters" autoCorrect="off" autoComplete="off" placeholder="XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 9))} />
        </label>
        <label>{t('رمز هذا الهاتف (4 أرقام)', 'The code of this phone (4 digits)', 'Le code de ce téléphone (4 chiffres)')}
          <input type="password" inputMode="numeric" autoComplete="off" value={c1} onChange={(e) => setC1(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </label>
        <label>{t('أعده', 'Once more', 'Encore une fois')}
          <input type="password" inputMode="numeric" autoComplete="off" value={c2} onChange={(e) => setC2(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </label>
        {c1.length === 4 && c2.length === 4 && c1 !== c2 && <div className="ph-alert">{t('الرمزان مختلفان', 'The two codes differ', 'Les deux codes diffèrent')}</div>}
        <button className="ph-btn gold" disabled={!ok || busy} onClick={go}>{busy ? '…' : t('اربط', 'Link', 'Relier')}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the code of this phone
function LockScreen({ t, langPick, link, onOpen, onForget }: CalPhoneProps & { link: CalLink; onOpen: (key: string) => void; onForget: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState(false);
  const [wait, setWait] = useState(0);
  const [sure, setSure] = useState(false);
  const tries = useRef(0);
  useEffect(() => { if (wait <= 0) return; const h = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(h); }, [wait]);
  const open = async (c: string) => {
    const k = await openKey(link.link, c);
    if (k) return onOpen(k);
    setCode(''); setErr(true);
    tries.current++;
    if (tries.current >= 5) { tries.current = 0; setWait(30); }
  };
  const change = (v: string) => { const c = v.replace(/\D/g, '').slice(0, 4); setCode(c); setErr(false); if (c.length === 4 && !wait) void open(c); };
  return (
    <div className="ph-page">
      <div className="ph-brand"><img src="/brand/magis-sun.png" alt="" /><h1>{link.org || 'MAGIS'}</h1><p>{link.name}</p></div>
      {langPick}
      {err && <div className="ph-alert">{t('الرمز غير صحيح', 'The code is not right', 'Le code n’est pas juste')}</div>}
      <div className="ph-card">
        <label>{t('رمز هذا الهاتف', 'The code of this phone', 'Le code de ce téléphone')}
          <input type="password" inputMode="numeric" autoComplete="off" autoFocus disabled={wait > 0} value={code} onChange={(e) => change(e.target.value)} />
        </label>
        {wait > 0 && <div className="ph-muted">{t(`انتظر ${wait} ث`, `Wait ${wait} s`, `Attendez ${wait} s`)}</div>}
      </div>
      {!sure ? <button className="ph-linkbtn" onClick={() => setSure(true)}>{t('نسيتُ الرمز', 'I forgot the code', 'J’ai oublié le code')}</button> : (
        <div className="ph-card">
          <p>{t('انسَ هذا الهاتف واطلب رمز ربط جديداً من المركز؟', 'Forget this phone and ask the centre for a new link code?', 'Oublier ce téléphone et demander un nouveau code de liaison au centre ?')}</p>
          <button className="ph-btn gold" onClick={() => void onForget()}>{t('نعم، انسَ هذا الهاتف', 'Yes, forget this phone', 'Oui, oublier ce téléphone')}</button>
          <button className="ph-linkbtn" onClick={() => setSure(false)}>{t('إلغاء', 'Cancel', 'Annuler')}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the calendar
function Calendar({ t, tm, lang, langPick, link, pack, setPack, keyOf, onLock, onCut }: CalPhoneProps & { link: CalLink; pack: CalPhonePack; setPack: (p: CalPhonePack) => void; keyOf: string; onLock: () => void; onCut: (m: Msg) => void }) {
  const d: CalData = pack.data;
  const contacts = d.rights.contacts;
  const [view, setView] = useState<View>('today');
  const [day, setDay] = useState(localDay());
  const [open, setOpen] = useState<CalBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ready = useRef(false);
  // the last view is kept (and the day, only until the next morning)
  useEffect(() => { void gGet<Last>(LAST).then((l) => { if (l?.view) setView(l.view); if (l?.day && l.day >= localDay()) setDay(l.day); ready.current = true; }); }, []);
  useEffect(() => { if (ready.current) void gSet(LAST, { view, day } satisfies Last); }, [view, day]);
  const refresh = useCallback(async () => {
    setBusy(true); setMsg(null);
    try { const fresh = await call<CalPhonePack>('/api/calphone/pack', {}, keyOf); await gSet(PACK, fresh); setPack(fresh); }
    catch (e) {
      if (e instanceof Refused && e.out) onCut(e.msg);
      else setMsg(e instanceof Offline ? t('لا اتصال: هذه آخر نسخة محفوظة', 'No connection: this is the last copy kept', 'Pas de connexion : voici la dernière copie gardée') : e instanceof Refused ? tm(e.msg) : String((e as Error).message));
    }
    setBusy(false);
  }, [keyOf, setPack, onCut, t, tm]);
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loc = lang === 'ar' ? 'ar-u-nu-latn' : lang === 'fr' ? 'fr' : 'en-GB';
  const dayLong = (x: string) => new Date(`${x}T00:00:00Z`).toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const dayShort = (x: string) => new Date(`${x}T00:00:00Z`).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  const name = (s: string) => { const parts = s.split(' · '); if (parts.length !== 2) return s; const [a, b] = /[؀-ۿ]/.test(parts[0]) ? parts : [parts[1], parts[0]]; return lang === 'ar' ? a : b; };
  const spaceName = (id: number) => name(d.spaces.find((s) => s.id === id)?.name ?? '');
  const today = localDay();
  const inWindow = (x: string) => x >= pack.from && x <= pack.to;
  const items = useMemo(() => itemsBetween(d, pack.from, pack.to), [d, pack.from, pack.to]);
  const hours = (it: DayItem) => (it.b.kind === 'stay' ? '' : it.occ.from === 0 && it.occ.to >= 1440 ? t('اليوم كله', 'All day', 'Toute la journée') : `${hm(it.occ.from)}–${hm(it.occ.to)}`);
  const where = (it: DayItem) => (it.b.outside_place ? it.b.outside_place : it.spaces.map(spaceName).filter(Boolean).join(' · '));
  const STATUS: Record<string, string> = { option: t('للتأكيد', 'To confirm', 'À confirmer'), confirmed: t('مؤكَّد', 'Confirmed', 'Confirmée'), arrived: t('وصلوا', 'Arrived', 'Arrivés'), left: t('غادروا', 'Left', 'Partis') };

  /** the colour of a booking is the colour of its area (the first space it holds); outside the centre: grey; the whole centre: dark */
  const areaId = (it: DayItem) => d.spaces.find((s) => s.id === it.spaces[0])?.building_id;
  const colorFor = (it: DayItem) => (it.b.whole_centre ? '#23263a' : areaId(it) != null ? colorOf(d.areas, areaId(it)!) : '#6b7280');
  const areaName = (it: DayItem) => name(d.areas.find((a) => a.id === areaId(it))?.name ?? '');
  /** a small tag: our own activities are plain; an outside booking or a stay gets one */
  const tagOf = (b: CalBooking) => (b.origin === 'ours' ? '' : b.kind === 'stay' ? t('إقامة', 'Stay', 'Séjour') : t('حجز', 'Booking', 'Réservation'));
  const row = (it: DayItem, withDay?: string) => {
    const tag = tagOf(it.b);
    return (
      <button key={`${it.b.id}-${it.occ.day}-${it.occ.from}`} type="button" className={`ph-cal-row ac ${it.b.status}`} style={{ ['--ac' as string]: colorFor(it) }} onClick={() => setOpen(it.b)}>
        <span className="ph-cal-when ltr">{withDay ? dayShort(withDay) : hours(it) || (it.b.kind === 'stay' ? '🛏' : '')}</span>
        <span className="ph-cal-what">
          <b>{it.b.group_name}</b>
          <small>{[withDay ? hours(it) : '', where(it), it.b.people ? `${it.b.people} ${t('شخص', 'people', 'pers.')}` : ''].filter(Boolean).join(' · ')}</small>
          {(tag || it.b.status === 'option' || it.b.status === 'arrived' || it.b.status === 'left' || areaName(it)) && (
            <span className="ph-tags">
              {areaName(it) && <em className="ph-tag area">{areaName(it)}</em>}
              {tag && <em className="ph-tag">{tag}</em>}
              {it.b.status !== 'confirmed' && STATUS[it.b.status] && <em className={`ph-tag st-${it.b.status}`}>{STATUS[it.b.status]}</em>}
            </span>
          )}
        </span>
      </button>
    );
  };
  const band = bandOf(d, day);

  if (open) return <Detail {...{ t, tm, lang, d, b: open, contacts, spaceName, dayLong, name }} onBack={() => setOpen(null)} />;

  const step = (n: number) => { const next = addDays(day, view === 'week' ? 7 * n : n); setDay(next); };
  const today0 = view === 'week' ? mondayOf(day) : day;
  return (
    <div className="ph-page">
      <header className="ph-top">
        <div><b>📅 {t('التقويم', 'Calendar', 'Calendrier')}</b><span>{pack.organisation}{' · '}{tm(ROLE_NAME[pack.phone.role] as Msg)}</span></div>
        <button className="ph-icon" onClick={onLock} aria-label="lock">🔒</button>
      </header>
      <div className="ph-seg">
        {(['today', 'week', 'spaces'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => { setView(v); if (v === 'today' && day < today) setDay(today); }}>{v === 'today' ? t('اليوم', 'Today', 'Aujourd’hui') : v === 'week' ? t('الأسبوع', 'Week', 'Semaine') : t('الأماكن', 'Spaces', 'Espaces')}</button>)}
      </div>
      <div className="ph-chips">
        <button disabled={!inWindow(addDays(day, view === 'week' ? -7 : -1))} onClick={() => step(-1)}>‹</button>
        <button onClick={() => setDay(today)}>{t('اليوم', 'Today', 'Aujourd’hui')}</button>
        <button disabled={!inWindow(addDays(day, view === 'week' ? 7 : 1))} onClick={() => step(1)}>›</button>
        <button onClick={() => void refresh()} disabled={busy}>{busy ? '…' : '↻'}</button>
      </div>
      {msg && <div className="ph-alert">{msg}</div>}
      <div className="ph-muted">{t('آخر تحديث', 'Updated', 'Mis à jour')} <span className="ltr">{stamp(pack.asOf)}</span> · {t('من', 'from', 'du')} <span className="ltr">{pack.from}</span> {t('إلى', 'to', 'au')} <span className="ltr">{pack.to}</span></div>
      {!inWindow(day) && <div className="ph-alert">{t('هذا اليوم خارج ما يحفظه الهاتف', 'This day is outside what the phone keeps', 'Ce jour est hors de ce que le téléphone garde')}</div>}

      {view === 'today' && <TodayView {...{ t, d, day, today, items, row, dayLong, band, spaceName, name }} />}

      {view === 'week' && (
        <>
          <b className="ph-week-h">{dayShort(today0)} → {dayShort(addDays(today0, 6))}</b>
          {Array.from({ length: 7 }, (_, i) => addDays(today0, i)).map((x) => {
            const list = items.get(x) ?? [];
            const pd = bandOf(d, x);
            return (
              <section key={x} className={`ph-weekday${x === today ? ' today' : ''}${x < today ? ' past' : ''}`}>
                <button type="button" className="ph-weekday-h" onClick={() => { setDay(x); setView('today'); }}>
                  <span>{dayLong(x)}</span>
                  <small>{x === today ? t('اليوم', 'Today', 'Aujourd’hui') : list.length ? `${list.length}` : ''}</small>
                </button>
                {pd && <div className="ph-weekday-band">⛔ {pd.name}</div>}
                <div className="ph-weekday-b">
                  {list.length ? list.map((it) => row(it)) : <div className="ph-weekday-empty">{t('لا شيء — يوم فارغ', 'Nothing planned — an empty day', 'Rien de prévu — journée libre')}</div>}
                </div>
              </section>
            );
          })}
        </>
      )}

      {view === 'spaces' && <SpacesView {...{ t, d, day, items, dayLong, band, name, spaceName, setOpen }} />}

      <button className="ph-linkbtn" onClick={() => { setView('today'); setDay(today); }}>{t('إلى اليوم', 'Back to today', 'Retour à aujourd’hui')}</button>
      {langPick}
      <div className="ph-muted" style={{ textAlign: 'center' }}>{link.name}</div>
    </div>
  );
}

function TodayView({ t, d, day, today, items, row, dayLong, band, spaceName, name }: { t: Tr; d: CalData; day: string; today: string; items: Map<string, DayItem[]>; row: (it: DayItem) => ReactNode; dayLong: (x: string) => string; band: ReturnType<typeof bandOf>; spaceName: (id: number) => string; name: (s: string) => string }) {
  const list = items.get(day) ?? [];
  const now = new Date();
  const fig = useMemo(() => todayFigures(d, day, day === today ? now.getHours() * 60 + now.getMinutes() : -1), [d, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const prep = useMemo(() => prepareOf(d, day), [d, day]);
  const stays = list.filter((x) => x.b.kind === 'stay'), events = list.filter((x) => x.b.kind !== 'stay');
  void spaceName;
  return (
    <>
      <section className="ph-card">
        <b>{dayLong(day)}{day === today ? ` · ${t('اليوم', 'today', 'aujourd’hui')}` : ''}</b>
        {band && <div className="ph-alert">⛔ {band.name}</div>}
        <div className="ph-cal-figs">
          <span>↘ {t('يصلون', 'Arriving', 'Arrivées')} <b>{fig.arrive.length}</b></span>
          <span>↗ {t('يغادرون', 'Leaving', 'Départs')} <b>{fig.leave.length}</b></span>
          <span>🛏 {t('حرّة الليلة', 'Free tonight', 'Libres ce soir')} <b>{fig.freeTonight.length}</b></span>
        </div>
      </section>
      {events.length > 0 && <section className="ph-card"><b>{t('النشاطات والحجوزات', 'Activities and bookings', 'Activités et réservations')}</b>{events.map((it) => row(it))}</section>}
      {stays.length > 0 && <section className="ph-card"><b>{t('الضيوف في البيت', 'Guests in the house', 'Hôtes dans la maison')}</b>{stays.map((it) => row(it))}</section>}
      {prep.length > 0 && (
        <section className="ph-card">
          <b>🧹 {t('للتحضير', 'To prepare', 'À préparer')}{day === today ? ` ${t('اليوم', 'today', 'aujourd’hui')}` : ''}</b>
          {prep.map((x, i) => (
            <div key={i} className="ph-cal-row">
              <span className="ph-cal-when ltr">{x.kind === 'hall' ? hm(x.at ?? 0) : x.kind === 'arrive' ? '↘' : '↗'}</span>
              <span className="ph-cal-what"><b>{name(x.space.name)}</b><small>{x.kind === 'hall' ? [x.b.group_name, x.people ? `${x.people} ${t('شخص', 'people', 'pers.')}` : '', ...x.equipment.map((e) => `${e.name} × ${e.qty}`)].filter(Boolean).join(' · ') : x.kind === 'arrive' ? `${t('تجهيز لوصول', 'for the arrival of', 'pour l’arrivée de')} ${x.b.group_name}${x.people ? ` · ${x.people}` : ''}` : t('جاهزة من جديد بعد المغادرة', 'ready again after the group leaves', 'de nouveau prête après le départ')}</small></span>
            </div>
          ))}
        </section>
      )}
      {!list.length && <section className="ph-card ph-muted">{t('لا شيء في هذا اليوم', 'Nothing on this day', 'Rien ce jour-là')}</section>}
    </>
  );
}

function SpacesView({ t, d, day, items, dayLong, band, name, spaceName, setOpen }: { t: Tr; d: CalData; day: string; items: Map<string, DayItem[]>; dayLong: (x: string) => string; band: ReturnType<typeof bandOf>; name: (s: string) => string; spaceName: (id: number) => string; setOpen: (b: CalBooking) => void }) {
  void spaceName;
  const list = items.get(day) ?? [];
  const spaces = d.spaces.filter(inCalendar);
  const areas = d.areas.filter((a) => spaces.some((s) => s.building_id === a.id));
  const state = (s: CalSpace) => {
    const shut = shutOf(d, s.id, day);
    const users = list.filter((it) => it.spaces.includes(s.id));
    return { shut, users };
  };
  return (
    <>
      <b>{dayLong(day)}</b>
      {band && <div className="ph-alert">⛔ {band.name}</div>}
      {areas.map((a) => (
        <section key={a.id} className="ph-card" style={{ borderInlineStart: `6px solid ${colorOf(d.areas, a.id)}` }}>
          <b>{name(a.name)}</b>
          {spaces.filter((s) => s.building_id === a.id).map((s) => {
            const { shut, users } = state(s);
            return (
              <div key={s.id} className="ph-room">
                <span className="ph-room-name">{name(s.name)}{s.beds > 0 ? <small> · 🛏 {s.beds}</small> : s.capacity ? <small> · {s.capacity}</small> : null}</span>
                {shut ? <span className="ph-muted">⛔ {shut.reason}</span>
                  : users.length ? <span className="ph-chip-row">{users.map((it) => <button key={`${it.b.id}-${it.occ.from}`} type="button" className={`ph-chip2 ${it.b.status}`} style={{ ['--ac' as string]: a.color || colorOf(d.areas, a.id) }} onClick={() => setOpen(it.b)}>{it.b.group_name}{it.b.kind === 'stay' ? '' : ` · ${hm(it.occ.from)}`}</button>)}</span>
                    : <span className="ph-free">{t('حرّة', 'free', 'libre')}</span>}
              </div>
            );
          })}
        </section>
      ))}
      {!areas.length && <section className="ph-card ph-muted">{t('لا أماكن', 'No spaces', 'Aucun espace')}</section>}
    </>
  );
}

function Detail({ t, lang, d, b, contacts, spaceName, dayLong, onBack }: { t: Tr; tm: (m: Msg) => string; lang: Lang; d: CalData; b: CalBooking; contacts: boolean; spaceName: (id: number) => string; dayLong: (x: string) => string; name: (s: string) => string; onBack: () => void }) {
  void lang;
  const org = b.org_id != null ? d.orgs.find((o) => o.id === b.org_id) : undefined;
  const spaces = b.outside_place ? b.outside_place : b.whole_centre ? t('كل المركز', 'The whole centre', 'Tout le centre') : d.allocs.filter((a) => a.booking_id === b.id).map((a) => spaceName(a.room_id)).filter(Boolean).join(' · ');
  const needs = d.needs.filter((n) => n.booking_id === b.id).map((n) => `${d.equip.find((e) => e.id === n.equip_id)?.name ?? ''} × ${n.qty}`);
  const tel = (p: string | null) => (p ? <a href={`tel:${p.replace(/\s/g, '')}`} dir="ltr">{p}</a> : null);
  const STATUS: Record<string, string> = { option: t('للتأكيد', 'To confirm', 'À confirmer'), confirmed: t('مؤكَّد', 'Confirmed', 'Confirmée'), arrived: t('وصلوا', 'Arrived', 'Arrivés'), left: t('غادروا', 'Left', 'Partis') };
  return (
    <div className="ph-page">
      <header className="ph-top"><div><b>{b.group_name}</b><span>{STATUS[b.status] ?? b.status}</span></div><button className="ph-icon" onClick={onBack} aria-label="close">✕</button></header>
      <section className="ph-card">
        {b.subject && <div>{b.subject}</div>}
        <div className="ltr">{b.from_day}{b.to_day !== b.from_day ? ` → ${b.to_day}` : ''}{b.kind !== 'stay' && b.time_from && b.time_to ? ` · ${b.time_from}–${b.time_to}` : ''}</div>
        <div className="ph-muted">{dayLong(b.from_day)}</div>
        {spaces && <div>📍 {spaces}</div>}
        {b.people ? <div>👥 {b.people} {t('شخص', 'people', 'personnes')}</div> : null}
        {b.leader && !b.private && <div>🎓 {b.leader}</div>}
        {contacts && org && <div>🏢 {org.name}</div>}
        {contacts && (b.contact || b.phone) && <div>☎ {b.contact} {tel(b.phone)}</div>}
        {needs.length > 0 && <div>🎛 {needs.join('، ')}</div>}
        {b.note?.trim() && <div className="ph-muted" style={{ whiteSpace: 'pre-wrap' }}>📝 {b.note}</div>}
      </section>
      <button className="ph-btn" onClick={onBack}>{t('رجوع', 'Back', 'Retour')}</button>
    </div>
  );
}
