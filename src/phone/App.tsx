// The phone's screens (Fouad, 2026-11-13): link this phone (once, at the centre), its code, my book, a new expense or
// income with the photo of its receipt, and what is waiting / sent / to fix. Everything works with no connection except
// the first link; the phone sends by itself when it finds the server again.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { allPhotos, allRows, delPhoto, delRow, kvDel, kvGet, kvSet, lockKey, newId, openKey, putPhoto, putRow, wipe, type Entry, type Kind, type Link, type Msg, type Pack, type Photo } from './store';
import { api, balance, check, Offline, openFull, Refused, sync, Unlinked } from './sync';

type Lang = 'ar' | 'en' | 'fr';
let lang: Lang = ((): Lang => {
  try { const s = localStorage.getItem('phone-lang'); if (s === 'ar' || s === 'en' || s === 'fr') return s; } catch { /* */ }
  const n = (navigator.language || 'ar').slice(0, 2);
  return n === 'fr' ? 'fr' : n === 'en' ? 'en' : 'ar';
})();
const t = (ar: string, en: string, fr: string) => (lang === 'ar' ? ar : lang === 'fr' ? fr : en);
const tm = (x: Msg) => (lang === 'ar' ? x.ar : lang === 'fr' ? x.fr ?? x.en : x.en);
const num = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
/** the local currency's name (a community: its own, e.g. SYP; LOC is how the community calls it) */
let localName = 'SYP';
/** an amount with its currency; a negative one as −$4.00, not $-4.00 */
const money = (n: number, cur: string) => { const m = n < 0 ? '−' : ''; const v = Math.abs(n); return cur === 'USD' ? `${m}$${num(v, 2)}` : cur === 'EUR' ? `${m}€${num(v, 2)}` : `${m}${num(v)} ${cur === 'LOC' ? localName : cur}`; };
const curLabel = (c: string) => (c === 'LOC' ? localName : c);
/** the currencies of this pack: a community's three, or the centre's dollars and pounds */
const cursOf = (p: Pack) => (p.curs ?? [{ code: 'USD', label: '$' }, { code: 'SYP', label: 'SYP' }]).map((c) => c.code);
/** a heading's or line's name in the phone's language (the communities give all three) */
const nm = (x: { name: string; names?: Msg }) => (x.names ? tm(x.names) : x.name);
/**
 * the lines a book may use (communities): a Jesuit's own pocket only those meant for a person; the house, and
 * "For the house" in a Jesuit's pocket, only the minister's list (Fouad, 15 November 2026)
 */
const linesFor = (p: Pack, bookId: number, type: Kind = 'Exp', forHouse = false) => {
  const k = p.books.find((b) => b.id === bookId)?.kind;
  if (p.kind !== 'community') return p.lines;
  if (type === 'Exp' && (forHouse || k === 'house' || k === 'envelope')) return p.lines.filter((l) => l.house !== false);
  return p.lines.filter((l) => !((k === 'personal' || k === 'personal_bank') && l.scope !== 'P'));
};
/** a community: the econome's cash and bank have no expenses (Fouad, 15 November 2026) */
/** the transfer button's words: the econome gives money, a Jesuit gives back, the minister gives to an envelope */
const giveLabel = (p: Pack, bookId: number) => {
  const k = p.books.find((b) => b.id === bookId)?.kind;
  return k === 'cash' || k === 'bank' ? t('إعطاء مال', 'Give money', "Donner de l'argent") : k === 'personal' || k === 'personal_bank' ? t('إعادة إلى القيم', 'Give back', 'Rendre') : t('تحويل', 'Transfer', 'Transfert');
};
/** a book's name in the phone's language (a community's house, cash and bank are named here, not by the server) */
const bkName = (b: { name: string; kind?: string | null }) =>
  b.kind === 'house' ? t('البيت', 'The house', 'La maison') : b.kind === 'cash' ? t('صندوق الجماعة', 'Community cash', 'Caisse de la communauté') : b.kind === 'bank' ? t('المصرف', 'Bank', 'Banque') : b.name;
const noExpense = (p: Pack, bookId: number) => p.kind === 'community' && ['cash', 'bank', 'economat'].includes(p.books.find((b) => b.id === bookId)?.kind ?? '');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const when = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const errText = (e: unknown) => (e instanceof Offline ? t('لا اتصال بالخادم', 'No connection to the server', 'Pas de connexion au serveur') : e instanceof Refused || e instanceof Unlinked ? tm(e.msg) : String((e as Error)?.message ?? e));

const HOUSES: [string, () => string][] = [
  ['jaramana', () => t('جرمانا', 'Jaramana', 'Jaramana')], ['aleppo', () => t('حلب', 'Aleppo', 'Alep')], ['homs', () => t('حمص', 'Homs', 'Homs')], ['other', () => t('غير ذلك', 'Other', 'Autre')],
  ['jesuits', () => t('جماعات اليسوعيين', 'Jesuit communities', 'Communautés jésuites')],
];

export function App() {
  const [, redraw] = useState(0);
  const [link, setLink] = useState<Link | null | undefined>(undefined); // undefined: still reading the phone's storage
  const [key, setKey] = useState<string | null>(null); // the server's key, open while the phone is unlocked
  const [pack, setPack] = useState<Pack | null>(null);
  useEffect(() => { void (async () => { setPack((await kvGet<Pack>('pack')) ?? null); setLink((await kvGet<Link>('link')) ?? null); })(); }, []);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; });
  const setLang = (l: Lang) => { lang = l; try { localStorage.setItem('phone-lang', l); } catch { /* */ } redraw((n) => n + 1); };
  // the phone locks again after five minutes out of sight
  useEffect(() => {
    let hidden = 0;
    const f = () => { if (document.hidden) hidden = Date.now(); else if (hidden && Date.now() - hidden > 5 * 60e3) setKey(null); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);

  if (link === undefined) return <div className="ph-center">…</div>;
  if (!link) return <Setup lang={lang} setLang={setLang} oldPack={pack} onDone={(l, k, p) => { setLink(l); setKey(k); setPack(p); }} />;
  if (!key || !pack) return <Lock link={link} pack={pack} onOpen={setKey} onForget={async () => { await wipe(); setPack(null); setLink(null); }} />;
  return <Home pack={pack} setPack={setPack} keyOf={key} lang={lang} setLang={setLang} onLock={() => setKey(null)}
    onUnlink={async (all) => { if (all) { await wipe(); setPack(null); } else await kvDel('link'); setKey(null); setLink(null); }} />;
}

function LangPick({ lang: l, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return <div className="ph-lang">{(['ar', 'en', 'fr'] as Lang[]).map((x) => <button key={x} className={x === l ? 'on' : ''} onClick={() => setLang(x)}>{x === 'ar' ? 'عربي' : x === 'en' ? 'English' : 'Français'}</button>)}</div>;
}

// ---------------------------------------------------------------- linking this phone (once, at the centre)
function Setup({ lang: l, setLang, oldPack, onDone }: { lang: Lang; setLang: (l: Lang) => void; oldPack: Pack | null; onDone: (l: Link, key: string, p: Pack) => void }) {
  const [house, setHouse] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [device, setDevice] = useState(/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Phone');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [choose, setChoose] = useState<{ dbs: { slug: string; organisation: string }[]; dir: boolean } | null>(null);
  const [got, setGot] = useState<{ key: string; pack: Pack } | null>(null);
  const [code, setCode] = useState('');
  const [code2, setCode2] = useState('');
  // an iPhone keeps the home-screen app apart from Safari: a phone linked in Safari is not linked in the icon
  const [here, setHere] = useState(false);
  const iosSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone;

  const pair = async (enter?: () => Promise<{ mustChange: boolean }>) => {
    if (enter && (await enter()).mustChange) throw new Refused({ ar: 'غيّر كلمة السر على الحاسوب أولاً', en: 'Change your password on the computer first', fr: "Changez d'abord votre mot de passe sur l'ordinateur" });
    const r = await api.pair(`${device.trim() || 'Phone'}`);
    await api.logout();
    // a phone that still holds somebody's rows is linked again by that person only
    const waiting = (await allRows()).some((x) => x.state !== 'sent');
    if (oldPack && waiting && (oldPack.user !== r.pack.user || oldPack.organisation !== r.pack.organisation))
      throw new Refused({ ar: `في هذا الهاتف سطور لـ ${oldPack.user} (${oldPack.organisation}) لم تُرسل`, en: `This phone holds rows of ${oldPack.user} (${oldPack.organisation}) not sent yet`, fr: `Ce téléphone garde des lignes de ${oldPack.user} (${oldPack.organisation}) pas encore envoyées` });
    setGot({ key: r.key, pack: r.pack });
  };
  const signIn = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.signin(house, name.trim(), password);
      if (r.mustChange && !r.dir) throw new Refused({ ar: 'غيّر كلمة السر على الحاسوب أولاً', en: 'Change your password on the computer first', fr: "Changez d'abord votre mot de passe sur l'ordinateur" });
      const dbs = (await api.hello()).dbs.filter((d) => d.kind === (house === 'jesuits' ? 'community' : 'centre'));
      if (!dbs.length) throw new Refused({ ar: 'لا حساب مركز لك هنا', en: "You have no centre's accounts here", fr: "Vous n'avez pas de comptes de centre ici" });
      if (dbs.length === 1) await pair(r.dir ? () => api.enterDir(dbs[0].slug) : r.db === dbs[0].slug ? undefined : () => api.enterRing(dbs[0].slug));
      else setChoose({ dbs, dir: !!r.dir });
    } catch (e) { setErr(errText(e)); await api.logout(); }
    setBusy(false);
  };
  const pick = async (slug: string) => {
    setBusy(true); setErr(null);
    try { await pair(choose!.dir ? () => api.enterDir(slug) : () => api.enterRing(slug)); } catch (e) { setErr(errText(e)); await api.logout(); setChoose(null); }
    setBusy(false);
  };
  const finish = async () => {
    if (!/^\d{4,8}$/.test(code)) return setErr(t('الرمز: من 4 إلى 8 أرقام', 'The code: 4 to 8 digits', 'Le code : 4 à 8 chiffres'));
    if (code !== code2) return setErr(t('الرمزان مختلفان', 'The two codes are not the same', 'Les deux codes sont différents'));
    setBusy(true);
    const l = await lockKey(got!.key, code);
    await kvSet('link', l); await kvSet('pack', got!.pack);
    onDone(l, got!.key, got!.pack);
  };

  return (
    <div className="ph-page">
      <div className="ph-brand"><img src="/brand/magis-sun.png" alt="" /><h1>MAGIS</h1><p>{t('تسجيل الحركات بعيداً عن المركز', 'Recording away from the centre', 'Enregistrer loin du centre')}</p></div>
      <LangPick lang={l} setLang={setLang} />
      {err && <div className="ph-alert">{err}</div>}
      {got ? (
        <div className="ph-card">
          <b>{got.pack.organisation} · {got.pack.user}</b>
          <p className="ph-muted">{t('اختر رمزاً لهذا الهاتف. تفتح به التطبيق كل مرة؛ لا يعرفه الخادم.', 'Choose a code for this phone. You open the app with it each time; the server does not know it.', "Choisissez un code pour ce téléphone. Vous ouvrez l'application avec lui ; le serveur ne le connaît pas.")}</p>
          <label>{t('الرمز (4 إلى 8 أرقام)', 'Code (4 to 8 digits)', 'Code (4 à 8 chiffres)')}<input type="password" inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
          <label>{t('الرمز مرة ثانية', 'The code again', 'Le code encore')}<input type="password" inputMode="numeric" autoComplete="off" value={code2} onChange={(e) => setCode2(e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
          <button className="ph-btn gold" disabled={busy} onClick={finish}>{t('ابدأ', 'Start', 'Commencer')}</button>
        </div>
      ) : choose ? (
        <div className="ph-card">
          <b>{t('أي حسابات؟', 'Which accounts?', 'Quels comptes ?')}</b>
          {choose.dbs.map((d) => <button key={d.slug} className="ph-btn" disabled={busy} onClick={() => pick(d.slug)}>{d.organisation}</button>)}
        </div>
      ) : iosSafari && !here ? (
        <div className="ph-card">
          <b>{t('أولاً: على الشاشة الرئيسية', 'First: on the home screen', "D'abord : sur l'écran d'accueil")}</b>
          <p className="ph-muted">{t('اضغط زر المشاركة ⬆ في الأسفل، ثم «إضافة إلى الشاشة الرئيسية». بعدها افتح MAGIS من أيقونته واربطه هناك: ما يُربط في Safari يبقى في Safari.', 'Tap the Share button ⬆ at the bottom, then "Add to Home Screen". Then open MAGIS from its icon and link it there: what is linked in Safari stays in Safari.', "Touchez le bouton Partager ⬆ en bas, puis « Sur l'écran d'accueil ». Ensuite ouvrez MAGIS par son icône et reliez-le là : ce qui est relié dans Safari reste dans Safari.")}</p>
          <button className="ph-btn" onClick={() => setHere(true)}>{t('اربط هنا مع ذلك', 'Link here anyway', 'Relier ici quand même')}</button>
        </div>
      ) : (
        <div className="ph-card">
          <b>{t('اربط هذا الهاتف', 'Link this phone', 'Relier ce téléphone')}</b>
          <p className="ph-muted">{t('مرة واحدة، وأنت على شبكة المركز. بعدها يعمل الهاتف بلا اتصال.', "Once, while you are on the centre's network. After that the phone works with no connection.", 'Une fois, sur le réseau du centre. Ensuite le téléphone travaille sans connexion.')}</p>
          <label>{t('البيت', 'House', 'Maison')}
            <select value={house} onChange={(e) => setHouse(e.target.value)}><option value="">—</option>{HOUSES.map(([k, f]) => <option key={k} value={k}>{f()}</option>)}</select>
          </label>
          <label>{t('اسمك', 'Your name', 'Votre nom')}<input value={name} autoCapitalize="off" autoCorrect="off" onChange={(e) => setName(e.target.value)} /></label>
          <label>{t('كلمة السر', 'Password', 'Mot de passe')}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label>{t('اسم هذا الهاتف', 'A name for this phone', 'Un nom pour ce téléphone')}<input value={device} onChange={(e) => setDevice(e.target.value)} /></label>
          <button className="ph-btn gold" disabled={busy || !house || !name.trim() || !password} onClick={signIn}>{busy ? '…' : t('اربط', 'Link', 'Relier')}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the code
function Lock({ link, pack, onOpen, onForget }: { link: Link; pack: Pack | null; onOpen: (key: string) => void; onForget: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const tries = useRef(0);
  useEffect(() => { if (wait <= 0) return; const h = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(h); }, [wait]);
  const open = async () => {
    setBusy(true); setErr(null);
    const k = await openKey(link, code);
    setBusy(false);
    if (k) return onOpen(k);
    setCode('');
    tries.current++;
    if (tries.current >= 5) { tries.current = 0; setWait(30); }
    setErr(t('الرمز غير صحيح', 'The code is not right', "Le code n'est pas juste"));
  };
  const forget = async () => {
    const n = (await allRows()).filter((r) => r.state !== 'sent').length;
    const warn = n ? t(`في الهاتف ${n} سطراً لم يُرسل: ستضيع. `, `${n} rows on this phone are not sent: they will be lost. `, `${n} lignes de ce téléphone ne sont pas envoyées : elles seront perdues. `) : '';
    if (window.confirm(warn + t('انسَ كل ما في هذا الهاتف وابدأ من جديد؟', 'Forget everything on this phone and start again?', 'Tout oublier sur ce téléphone et recommencer ?'))) await onForget();
  };
  return (
    <div className="ph-page">
      <div className="ph-brand"><img src="/brand/magis-sun.png" alt="" /><h1>{pack?.organisation ?? 'MAGIS'}</h1><p>{pack?.user}</p></div>
      {err && <div className="ph-alert">{err}</div>}
      <div className="ph-card">
        <label>{t('رمز هذا الهاتف', "This phone's code", 'Le code de ce téléphone')}
          <input type="password" inputMode="numeric" autoComplete="off" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={(e) => { if (e.key === 'Enter' && code.length >= 4 && !wait) void open(); }} />
        </label>
        <button className="ph-btn gold" disabled={busy || code.length < 4 || wait > 0} onClick={open}>{wait > 0 ? t(`انتظر ${wait} ث`, `Wait ${wait} s`, `Attendez ${wait} s`) : t('افتح', 'Open', 'Ouvrir')}</button>
      </div>
      <button className="ph-linkbtn" onClick={forget}>{t('نسيتُ الرمز', 'I forgot the code', "J'ai oublié le code")}</button>
    </div>
  );
}

// ---------------------------------------------------------------- my book
type Net = { state: 'idle' | 'busy' | 'ok' | 'offline' | 'out'; text?: string };

function Home({ pack, setPack, keyOf, lang: l, setLang, onLock, onUnlink }: { pack: Pack; setPack: (p: Pack) => void; keyOf: string; lang: Lang; setLang: (l: Lang) => void; onLock: () => void; onUnlink: (all: boolean) => Promise<void> }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [bookId, setBookId] = useState<number>(() => pack.books[0]?.id ?? 0);
  const [tab, setTab] = useState<'waiting' | 'fix' | 'sent'>('waiting');
  const [form, setForm] = useState<{ type: Kind; row?: Entry } | null>(null);
  const [menu, setMenu] = useState(false);
  const [net, setNet] = useState<Net>({ state: 'idle' });
  const running = useRef(false);
  const load = useCallback(async () => { setRows(await allRows()); setPhotos(await allPhotos()); }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!pack.books.some((b) => b.id === bookId)) setBookId(pack.books[0]?.id ?? 0); }, [pack, bookId]);

  const doSync = useCallback(async (quiet = false) => {
    if (running.current) return;
    running.current = true;
    if (!quiet) setNet({ state: 'busy' });
    try {
      const r = await sync(keyOf);
      setPack(r.pack);
      setNet({ state: 'ok', text: r.result.refused ? t(`${r.result.refused} للتصحيح`, `${r.result.refused} to fix`, `${r.result.refused} à corriger`) : undefined });
      if (r.result.refused) setTab('fix');
    } catch (e) {
      if (e instanceof Unlinked) setNet({ state: 'out', text: tm(e.msg) });
      else if (e instanceof Offline) setNet({ state: 'offline' });
      else setNet({ state: 'offline', text: errText(e) });
    }
    running.current = false;
    await load();
  }, [keyOf, setPack, load]);
  // by itself: on opening, when the connection comes back, and every minute while something waits
  useEffect(() => {
    void doSync(true);
    const on = () => void doSync(true);
    window.addEventListener('online', on);
    const h = setInterval(() => { if (!document.hidden) void doSync(true); }, 60e3);
    return () => { window.removeEventListener('online', on); clearInterval(h); };
  }, [doSync]);

  localName = pack.curs?.find((c) => c.code === 'LOC')?.label ?? 'SYP';
  const bal = balance(pack, rows, bookId);
  const mine = rows.filter((r) => r.book_id === bookId || pack.books.length <= 1);
  // the numbers count the book on screen; each book's button carries its own (Fouad, 2026-11-13: "2 waiting, I can't see them")
  const count = (s: Entry['state']) => mine.filter((r) => r.state === s).length;
  const unsent = (id: number) => rows.filter((r) => r.book_id === id && r.state !== 'sent').length;
  const shown = mine.filter((r) => r.state === tab).sort((a, b) => (tab === 'sent' ? (b.sent_at ?? '').localeCompare(a.sent_at ?? '') : b.made_at.localeCompare(a.made_at))).slice(0, 100);
  const lineName = (r: Entry) => {
    if (r.type === 'Transfer') { const b = [...(pack.targets ?? []), ...pack.books].find((x) => x.id === r.to_book_id); return `→ ${b ? bkName(b) : '?'}`; }
    const x = pack.lines.find((y) => y.id === r.line_id) ?? pack.headings.find((h) => h.id === r.heading_id); return x ? nm(x) : r.type === 'Exchange' ? t('صرافة', 'Exchange', 'Change') : '';
  };
  const daysLeft = Math.floor((Date.parse(pack.validUntil) - Date.now()) / 86_400_000);

  if (form) return <RowForm pack={pack} type={form.type} row={form.row} bookId={bookId} photos={photos.filter((p) => p.trxId === form.row?.id)} onClose={async (saved) => { setForm(null); await load(); if (saved) { setTab('waiting'); void doSync(true); } }} />;
  return (
    <div className="ph-page">
      <header className="ph-top">
        <div><b>{pack.organisation}</b><span>{pack.user}</span></div>
        <button className="ph-icon" onClick={() => setMenu(!menu)} aria-label="menu">☰</button>
      </header>
      {menu && (
        <div className="ph-card">
          <LangPick lang={l} setLang={setLang} />
          <p className="ph-muted">{t('هذا الهاتف', 'This phone', 'Ce téléphone')}: <b>{pack.phone.name}</b> · {t('يجب أن يتصل بالمركز قبل', 'must reach the centre before', 'doit joindre le centre avant le')} <b className="ltr">{pack.validUntil.slice(0, 10)}</b></p>
          <button className="ph-btn" onClick={onLock}>🔒 {t('اقفل', 'Lock', 'Verrouiller')}</button>
          <button className="ph-btn danger" onClick={async () => {
            const n = rows.filter((r) => r.state !== 'sent').length;
            if (n) return window.alert(t(`في الهاتف ${n} سطراً لم يُرسل. أرسلها أو احذفها أولاً.`, `${n} rows on this phone are not sent. Send or delete them first.`, `${n} lignes de ce téléphone ne sont pas envoyées. Envoyez-les ou supprimez-les d'abord.`));
            if (window.confirm(t('افصل هذا الهاتف وانسَ ما فيه؟', 'Unlink this phone and forget what is on it?', 'Délier ce téléphone et oublier ce qu’il contient ?'))) await onUnlink(true);
          }}>{t('افصل هذا الهاتف', 'Unlink this phone', 'Délier ce téléphone')}</button>
        </div>
      )}

      {net.state === 'out' && (
        <div className="ph-alert">
          {net.text}
          <p>{t('السطور التي كتبتها باقية في الهاتف.', 'The rows you wrote stay on the phone.', 'Les lignes écrites restent sur le téléphone.')}</p>
          <button className="ph-btn" onClick={() => void onUnlink(false)}>{t('اربط الهاتف من جديد', 'Link the phone again', 'Relier le téléphone à nouveau')}</button>
        </div>
      )}
      {net.state !== 'out' && daysLeft <= 7 && <div className="ph-alert">{daysLeft < 0 ? t('مرّ أكثر من 30 يوماً: اتصل بشبكة المركز.', "More than 30 days: connect to the centre's network.", 'Plus de 30 jours : connectez-vous au réseau du centre.') : t(`بقي ${daysLeft} يوماً قبل وجوب الاتصال بالمركز.`, `${daysLeft} days left before the phone must reach the centre.`, `Il reste ${daysLeft} jours avant que le téléphone doive joindre le centre.`)}</div>}

      {pack.books.length > 1 && <div className="ph-chips">{pack.books.map((b) => <button key={b.id} className={b.id === bookId ? 'on' : ''} onClick={() => setBookId(b.id)}>{bkName(b)}{unsent(b.id) ? <i>{unsent(b.id)}</i> : null}</button>)}</div>}
      {!pack.books.length ? <div className="ph-alert">{t('لا دفتر لك للكتابة فيه.', 'You have no book to write in.', "Vous n'avez pas de livre où écrire.")}</div> : (
        <section className="ph-balance">
          <small>{(() => { const b = pack.books.find((x) => x.id === bookId); return b ? bkName(b) : ''; })()}</small>
          <div className="ph-amounts">{cursOf(pack).filter((c, i) => i < 2 || bal.bal[c]).map((c) => <span key={c} className="ltr">{c === 'USD' || c === 'EUR' ? money(bal.bal[c] ?? 0, c) : <>{num(bal.bal[c] ?? 0)} <i>{curLabel(c)}</i></>}</span>)}</div>
          <p>{t('كما في آخر مزامنة', 'as of the last sync', 'à la dernière synchronisation')} <span className="ltr">{when(pack.asOf)}</span>{bal.waiting ? ` · ${t(`مع ${bal.waiting} سطراً ينتظر هنا`, bal.waiting === 1 ? 'with 1 row waiting here' : `with ${bal.waiting} rows waiting here`, bal.waiting === 1 ? 'avec 1 ligne en attente ici' : `avec ${bal.waiting} lignes en attente ici`)}` : ''}</p>
        </section>
      )}

      <div className="ph-two">
        <button className="ph-big exp" disabled={!pack.books.length || noExpense(pack, bookId)} onClick={() => setForm({ type: 'Exp' })}><b>−</b>{t('نفقة', 'Expense', 'Dépense')}</button>
        <button className="ph-big inc" disabled={!pack.books.length} onClick={() => setForm({ type: 'Income' })}><b>+</b>{t('إيراد', 'Income', 'Recette')}</button>
      </div>
      {pack.kind === 'community' && (
        <button className="ph-big trf" disabled={!pack.books.length} onClick={() => setForm({ type: 'Transfer' })}><span>↔ {giveLabel(pack, bookId)}</span></button>
      )}
      {(pack.kind === 'community' || pack.headings.some((h) => h.types.includes('Exchange'))) && (
        <button className="ph-big exc" disabled={!pack.books.length} onClick={() => setForm({ type: 'Exchange' })}><span>⇄ {pack.kind === 'community' ? t('صرافة', 'Exchange', 'Change') : t('تصريف: دولار ← ليرة', 'Exchange: dollars → pounds', 'Change : dollars → livres')}</span></button>
      )}

      {/* the full program while connected (Fouad, 14 November 2026); with no connection the phone stays as it is */}
      {net.state === 'ok' && (
        <button className="ph-btn" onClick={async () => { try { await openFull(keyOf); } catch (e) { setNet({ state: 'offline', text: errText(e) }); } }}>
          🖥 {t('البرنامج الكامل', 'The full program', 'Le programme complet')}
        </button>
      )}
      <button className={`ph-sync ${net.state}`} onClick={() => void doSync()} disabled={net.state === 'busy'}>
        {net.state === 'busy' ? t('يُرسل…', 'Sending…', 'Envoi…')
          : net.state === 'offline' ? `⚠ ${net.text ?? t('لا اتصال بالخادم', 'No connection to the server', 'Pas de connexion au serveur')} — ${t('حاول من جديد', 'try again', 'réessayer')}`
          : `↻ ${t('أرسل الآن', 'Send now', 'Envoyer maintenant')}${net.state === 'ok' ? ` · ✓${net.text ? ` ${net.text}` : ''}` : ''}`}
      </button>

      <div className="ph-tabs">
        <button className={tab === 'waiting' ? 'on' : ''} onClick={() => setTab('waiting')}>{t('ينتظر', 'Waiting', 'En attente')}{count('waiting') ? <i>{count('waiting')}</i> : null}</button>
        <button className={tab === 'fix' ? 'on' : ''} onClick={() => setTab('fix')}>{t('للتصحيح', 'To fix', 'À corriger')}{count('fix') ? <i className="red">{count('fix')}</i> : null}</button>
        <button className={tab === 'sent' ? 'on' : ''} onClick={() => setTab('sent')}>{t('أُرسل', 'Sent', 'Envoyé')}</button>
      </div>
      <ul className="ph-rows">
        {!shown.length && <li className="ph-muted ph-empty">{tab === 'waiting' ? t('لا شيء ينتظر', 'Nothing is waiting', 'Rien en attente') : tab === 'fix' ? t('لا شيء للتصحيح', 'Nothing to fix', 'Rien à corriger') : t('لا شيء بعد', 'Nothing yet', 'Rien encore')}</li>}
        {shown.map((r) => (
          <li key={r.id} onClick={() => r.state !== 'sent' && setForm({ type: r.type, row: r })} className={r.state}>
            <div className="l"><b>{r.explanation || '—'}</b><span><span className="ltr">{r.date}</span> · {lineName(r)}{photos.some((p) => p.trxId === r.id) ? ' · 📎' : ''}</span>{r.state === 'fix' && r.error && <em>{tm(r.error)}</em>}</div>
            {r.type === 'Exchange'
              ? <div className="a ltr exc">−{money(r.amount, r.currency)}<br />+{money(r.amount2 ?? r.syp ?? 0, r.cur2 ?? 'SYP')}</div>
              : <div className={`a ${r.type === 'Income' ? 'inc' : 'exp'} ltr`}>{r.type === 'Income' ? '+' : '−'}{money(r.amount, r.currency)}</div>}
          </li>
        ))}
      </ul>
      {tab !== 'sent' && shown.length > 0 && <p className="ph-muted ph-hint">{t('اضغط على سطر لتغييره أو حذفه.', 'Tap a row to change or delete it.', 'Touchez une ligne pour la modifier ou la supprimer.')}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- a new expense or income
/** a photo made smaller (1600 points at most, JPEG) so that it goes through a slow connection */
async function shrink(file: File): Promise<{ base64: string; mime: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('image')); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return { base64: c.toDataURL('image/jpeg', 0.72).split(',')[1], mime: 'image/jpeg' };
  } finally { URL.revokeObjectURL(url); }
}

function RowForm({ pack, type, row, bookId, photos, onClose }: { pack: Pack; type: Kind; row?: Entry; bookId: number; photos: Photo[]; onClose: (saved: boolean) => Promise<void> }) {
  const [f, setF] = useState(() => ({
    book_id: row?.book_id ?? bookId, date: row?.date ?? today(), amount: row ? String(row.amount) : '', currency: row?.currency ?? (pack.kind === 'community' && type !== 'Exchange' ? 'LOC' : 'USD'),
    cur2: row?.cur2 ?? 'LOC', amount2: row?.amount2 ? String(row.amount2) : '',
    heading_id: row?.heading_id ?? 0, line_id: row?.line_id ?? 0, explanation: row?.explanation ?? '', receipt: row?.receipt ?? '',
    syp: row?.syp ? String(row.syp) : '',
    for_house: !!row?.for_house,
    to_book_id: row?.to_book_id ?? 0,
  }));
  const ex = type === 'Exchange';
  const cty = pack.kind === 'community';
  const id = useMemo(() => row?.id ?? newId(), [row]);
  const [pics, setPics] = useState<Photo[]>(photos);
  const [errs, setErrs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  // a photo seen full screen, and the question before removing anything (Fouad on his iPhone, 2026-11-13)
  const [view, setView] = useState<Photo | null>(null);
  const [ask, setAsk] = useState<{ text: string; yes: string; act: () => void | Promise<void> } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const pocket = ['personal', 'personal_bank'].includes(pack.books.find((b) => b.id === f.book_id)?.kind ?? '');
  const houseChoice = cty && type === 'Exp' && pocket;
  const usable = linesFor(pack, f.book_id, type, houseChoice && f.for_house);
  const headings = pack.headings.filter((h) => h.types.includes(type) && usable.some((l) => l.heading_id === h.id));
  const lines = usable.filter((x) => x.heading_id === f.heading_id);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  // an exchange has (usually) one heading with one line: chosen by the phone, not shown
  const exOnly = ex && (cty || (headings.length === 1 && pack.lines.filter((x) => x.heading_id === headings[0].id).length === 1));
  // a transfer (a community): no heading; to whom — the econome's cash first for a Jesuit giving back
  const tr = type === 'Transfer';
  const fromKind = pack.books.find((b) => b.id === f.book_id)?.kind ?? '';
  const targets = [...(pack.targets ?? []), ...pack.books.filter((b) => b.kind === 'envelope' && fromKind === 'house').map((b) => ({ id: b.id, name: b.name, kind: b.kind ?? null }))]
    .filter((b, i, all) => b.id !== f.book_id && all.findIndex((x) => x.id === b.id) === i)
    .sort((a, b) => (fromKind === 'personal' || fromKind === 'personal_bank' ? Number(b.kind === 'cash') - Number(a.kind === 'cash') : 0));
  useEffect(() => {
    if (exOnly && !cty && !f.heading_id) set({ heading_id: headings[0].id, line_id: pack.lines.find((x) => x.heading_id === headings[0].id)!.id });
  }, [exOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  const toNum = (v: string) => Number(v.replace(/,/g, ''));
  const rate = ex && !cty && toNum(f.amount) > 0 && toNum(f.syp) > 0 ? toNum(f.syp) / toNum(f.amount) : 0;
  const lastRate = pack.books.find((b) => b.id === f.book_id)?.rate ?? pack.rate;
  const farRate = rate > 0 && lastRate > 0 && Math.abs(rate - lastRate) / lastRate > (pack.tolerance ?? 0.25);

  const addPhoto = async (fl: File | undefined) => {
    if (!fl) return;
    setBusy(true);
    try { const s = await shrink(fl); setPics((x) => [...x, { key: newId(), trxId: id, mime: s.mime, base64: s.base64, sent: false }]); }
    catch { setErrs([{ ar: 'تعذّرت قراءة الصورة', en: 'The photo could not be read', fr: "La photo n'a pas pu être lue" }]); }
    setBusy(false);
    if (file.current) file.current.value = '';
  };
  const save = async () => {
    const amount = toNum(f.amount);
    const e: Entry = { id, book_id: f.book_id, date: f.date, type, heading_id: f.heading_id, line_id: f.line_id, explanation: f.explanation.trim(), receipt: f.receipt.trim(), amount, currency: ex && !cty ? 'USD' : f.currency, ...(ex && !cty ? { syp: toNum(f.syp) } : {}), ...(ex && cty ? { cur2: f.cur2, amount2: toNum(f.amount2), heading_id: 0, line_id: 0 } : {}), ...(houseChoice && f.for_house ? { for_house: 1 } : {}), ...(tr ? { to_book_id: f.to_book_id || null, heading_id: 0, line_id: 0 } : {}), state: 'waiting', error: null, made_at: row?.made_at ?? new Date().toISOString() };
    const bad = check(pack, e);
    if (bad.length) return setErrs(bad);
    setBusy(true);
    await putRow(e);
    for (const p of photos) if (!pics.some((x) => x.key === p.key)) await delPhoto(p.key);
    for (const p of pics) await putPhoto(p);
    await onClose(true);
  };
  const remove = () => setAsk({
    text: t('حذف هذا السطر وصوره من الهاتف؟ لا رجوع عن ذلك.', 'Delete this row and its photos from the phone? This cannot be undone.', 'Supprimer cette ligne et ses photos du téléphone ? Impossible de revenir en arrière.'),
    yes: t('نعم، احذف', 'Yes, delete', 'Oui, supprimer'),
    act: async () => { for (const p of photos) await delPhoto(p.key); await delRow(id); await onClose(false); },
  });
  const dropPhoto = (p: Photo) => setAsk({
    text: t('إزالة هذه الصورة؟ تُزال حين تضغط «احفظ في الهاتف».', 'Remove this photo? It goes when you tap "Save on the phone".', 'Retirer cette photo ? Elle part quand vous touchez « Enregistrer sur le téléphone ».'),
    yes: t('نعم، أزل', 'Yes, remove', 'Oui, retirer'),
    act: () => { setPics((x) => x.filter((y) => y.key !== p.key)); setView(null); },
  });

  return (
    <div className="ph-page">
      <header className="ph-top">
        <button className="ph-icon" onClick={() => void onClose(false)} aria-label="back">{lang === 'ar' ? '→' : '←'}</button>
        <div className="mid"><b className={type === 'Exp' ? 'exp' : type === 'Income' ? 'inc' : 'exc'}>{type === 'Exp' ? t('نفقة', 'Expense', 'Dépense') : type === 'Income' ? t('إيراد', 'Income', 'Recette') : type === 'Transfer' ? giveLabel(pack, f.book_id) : t('تصريف', 'Exchange', 'Change')}</b></div>
        <span style={{ width: 40 }} />
      </header>
      {row?.state === 'fix' && row.error && <div className="ph-alert">{t('رفضه الخادم', 'The server refused it', 'Le serveur l’a refusé')}: {tm(row.error)}</div>}
      {errs.length > 0 && <div className="ph-alert">{errs.map((x, i) => <div key={i}>{tm(x)}</div>)}</div>}
      <div className="ph-card">
        {pack.books.length > 1 && <label>{t('الدفتر', 'Book', 'Livre')}<select value={f.book_id} onChange={(e) => set({ book_id: Number(e.target.value), heading_id: 0, line_id: 0 })}>{pack.books.filter((b) => type !== 'Exp' || !noExpense(pack, b.id)).map((b) => <option key={b.id} value={b.id}>{bkName(b)}</option>)}</select></label>}
        {houseChoice && (
          <div className="ph-forwho">
            <button type="button" className={!f.for_house ? 'on' : ''} onClick={() => set({ for_house: false, heading_id: 0, line_id: 0 })}>👤 {t('شخصي', 'For me', 'Pour moi')}</button>
            <button type="button" className={f.for_house ? 'on house' : ''} onClick={() => set({ for_house: true, heading_id: 0, line_id: 0 })}>🏠 {t('للبيت', 'For the house', 'Pour la maison')}</button>
            {f.for_house && <small>{t('من جيبك، وتُحسب مع نفقات البيت', 'From your pocket, counted with the house expenses', 'De votre poche, comptée avec la maison')}</small>}
          </div>
        )}
        {ex && cty ? (
          <>
            {/* a community: any currency for any other (pounds, dollars and euros) */}
            <label>{t('أعطيتُ', 'I gave', "J'ai donné")}
              <div className="ph-amount"><input inputMode="decimal" className="ltr" placeholder="0" value={f.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.,]/g, '') })} />
                <div className="ph-cur">{cursOf(pack).map((c) => <button key={c} type="button" className={f.currency === c ? 'on' : ''} onClick={() => set({ currency: c })}>{curLabel(c)}</button>)}</div></div>
            </label>
            <label>{t('استلمتُ', 'I received', "J'ai reçu")}
              <div className="ph-amount"><input inputMode="decimal" className="ltr" placeholder="0" value={f.amount2} onChange={(e) => set({ amount2: e.target.value.replace(/[^\d.,]/g, '') })} />
                <div className="ph-cur">{cursOf(pack).map((c) => <button key={c} type="button" className={f.cur2 === c ? 'on' : ''} onClick={() => set({ cur2: c })}>{curLabel(c)}</button>)}</div></div>
            </label>
            {toNum(f.amount) > 0 && toNum(f.amount2) > 0 && f.currency !== f.cur2 && (f.currency === 'LOC' || f.cur2 === 'LOC') && (
              <p className="ph-muted">{t('السعر', 'Rate', 'Taux')}: <b className="ltr">{num(f.currency === 'LOC' ? toNum(f.amount) / toNum(f.amount2) : toNum(f.amount2) / toNum(f.amount))}</b> {localName} / 1 {curLabel(f.currency === 'LOC' ? f.cur2 : f.currency)}</p>
            )}
          </>
        ) : ex ? (
          <>
            <label>{t('الدولارات المدفوعة', 'Dollars given', 'Dollars donnés')}
              <div className="ph-amount"><input inputMode="decimal" className="ltr" placeholder="0" value={f.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.,]/g, '') })} /><div className="ph-cur"><button type="button" className="on">USD</button></div></div>
            </label>
            <label>{t('الليرات المقبوضة', 'Pounds received', 'Livres reçues')}
              <div className="ph-amount"><input inputMode="decimal" className="ltr" placeholder="0" value={f.syp} onChange={(e) => set({ syp: e.target.value.replace(/[^\d.,]/g, '') })} /><div className="ph-cur"><button type="button" className="on">SYP</button></div></div>
            </label>
            {rate > 0 && <p className={farRate ? 'ph-alert' : 'ph-muted'}>{t('السعر', 'Rate', 'Taux')}: <b className="ltr">{num(rate)}</b> SYP / $1{farRate ? ` — ${t(`بعيد عن آخر سعر (${num(lastRate)}): تحقّق من الأصفار`, `far from the last rate (${num(lastRate)}): check the zeros`, `loin du dernier taux (${num(lastRate)}) : vérifiez les zéros`)}` : ''}</p>}
          </>
        ) : (
        <label>{t('المبلغ', 'Amount', 'Montant')}
          <div className="ph-amount">
            <input inputMode="decimal" className="ltr" placeholder="0" value={f.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.,]/g, '') })} />
            <div className="ph-cur">{cursOf(pack).map((c) => <button key={c} type="button" className={f.currency === c ? 'on' : ''} onClick={() => set({ currency: c })}>{curLabel(c)}</button>)}</div>
          </div>
        </label>
        )}
        <label>{t('التاريخ', 'Date', 'Date')}<input type="date" className="ltr" value={f.date} max={today()} onChange={(e) => set({ date: e.target.value })} /></label>
        {tr && (
          <label>{t('لمن؟', 'To whom?', 'À qui ?')}
            <select value={f.to_book_id} onChange={(e) => set({ to_book_id: Number(e.target.value) })}>
              <option value={0}>—</option>{targets.map((b) => <option key={b.id} value={b.id}>{bkName(b)}</option>)}
            </select>
          </label>
        )}
        {!exOnly && !tr && <>
        <label>{t('البند', 'Heading', 'Rubrique')}
          <select value={f.heading_id} onChange={(e) => { const h = Number(e.target.value); const ls = usable.filter((x) => x.heading_id === h); set({ heading_id: h, line_id: ls.length === 1 ? ls[0].id : 0 }); }}>
            <option value={0}>—</option>{headings.map((h) => <option key={h.id} value={h.id}>{h.code ? `${h.code} · ` : ''}{nm(h)}</option>)}
          </select>
        </label>
        <label>{t('الخط', 'Line', 'Ligne')}
          <select value={f.line_id} disabled={!f.heading_id} onChange={(e) => set({ line_id: Number(e.target.value) })}>
            <option value={0}>—</option>{lines.map((x) => <option key={x.id} value={x.id}>{x.code ? `${x.code} · ` : ''}{nm(x)}</option>)}
          </select>
        </label>
        </>}
        <label>{type === 'Exp' ? t('الشرح: على ماذا؟', 'Explanation: what for?', 'Explication : pour quoi ?') : type === 'Income' ? t('الشرح: من أين؟', 'Explanation: where from?', "Explication : d'où ?") : t('الشرح: أين أو مع مَن؟ (اختياري)', 'Explanation: where, or with whom? (optional)', 'Explication : où, ou avec qui ? (facultatif)')}
          <textarea rows={2} value={f.explanation} onChange={(e) => set({ explanation: e.target.value })} />
        </label>
        <label>{t('رقم الإيصال (إن وُجد)', 'Receipt number (if any)', 'Numéro du reçu (s’il y en a un)')}<input className="ltr" value={f.receipt} onChange={(e) => set({ receipt: e.target.value })} /></label>
        <div className="ph-photos">
          {pics.map((p) => (
            <div key={p.key} className="ph-photo">
              {p.base64 ? <img src={`data:${p.mime};base64,${p.base64}`} alt="" onClick={() => setView(p)} /> : <span>📎</span>}
            </div>
          ))}
          {pics.length < 3 && <button type="button" className="ph-addphoto" disabled={busy} onClick={() => file.current?.click()}>📷<span>{t('صورة الإيصال', 'Photo of the receipt', 'Photo du reçu')}</span></button>}
          <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void addPhoto(e.target.files?.[0])} />
        </div>
      </div>
      <button className="ph-btn gold" disabled={busy} onClick={save}>{t('احفظ في الهاتف', 'Save on the phone', 'Enregistrer sur le téléphone')}</button>
      {row && <button className="ph-btn danger" disabled={busy} onClick={remove}>{t('احذف', 'Delete', 'Supprimer')}</button>}
      {view && (
        <div className="ph-viewer" onClick={() => setView(null)}>
          <img src={`data:${view.mime};base64,${view.base64}`} alt="" />
          <div className="bar" onClick={(e) => e.stopPropagation()}>
            <button className="ph-btn" onClick={() => setView(null)}>{t('إغلاق', 'Close', 'Fermer')}</button>
            {!view.sent && <button className="ph-btn danger" onClick={() => dropPhoto(view)}>{t('أزل الصورة', 'Remove the photo', 'Retirer la photo')}</button>}
          </div>
        </div>
      )}
      {ask && (
        <div className="ph-ask">
          <div className="ph-card">
            <b>{ask.text}</b>
            <button className="ph-btn danger" onClick={async () => { const a = ask; setAsk(null); await a.act(); }}>{ask.yes}</button>
            <button className="ph-btn" onClick={() => setAsk(null)}>{t('لا', 'No', 'Non')}</button>
          </div>
        </div>
      )}
      <p className="ph-muted ph-foot">{t('يُرسل إلى الخادم حين يجده الهاتف، والخادم يتحقق منه.', 'It goes to the server when the phone finds it, and the server checks it.', 'Elle part au serveur quand le téléphone le trouve, et le serveur la vérifie.')}</p>
    </div>
  );
}
