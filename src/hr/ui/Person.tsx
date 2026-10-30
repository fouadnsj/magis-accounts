// A person's page (Fouad, 30 October 2026). Its heading is the heading of their documents: the mark of their centre,
// their names in Arabic and English, the Jesuit logo. Then: who they are (both languages), their agreement and stipend
// (fixed by the agreement, changed from a date when needed), their stipend letters, insurance, documents, code of conduct.
import { useState } from 'react';
import type { Session } from '../../state';
import { Field, Modal, confirmBox, fmtDate, toast, todayIso } from '../../ui/kit';
import { saveFile } from '../../platform';
import { t3 } from '../../community/ui/text';
import type { HrData, HrPaper, HrPerson } from '../hr';
import type { HrPay, HrPayData } from '../payOps';
import { hourlyFromMonthly, payOn, yearlyCost } from '../pay';
import { agreementDoc, stipendDoc } from '../docs';
import { InsurancePage } from './Stage4';
import { TwoNames, centreOf, centreVars, chooseScan, fail, headOf, markOf, openScan, usd } from './common';

type Tab = 'identity' | 'agreement' | 'letters' | 'insurance' | 'documents' | 'conduct';

interface P { s: Session; d: HrData; pd: HrPayData | null; reload: () => Promise<void>; manage: boolean; vault: boolean; pay: boolean }

export function PersonPage({ person, onBack, onCreated, ...x }: P & { person: HrPerson | null; onBack: () => void; onCreated: (id: number) => void }) {
  const [tab, setTab] = useState<Tab>('identity');
  const { key } = centreOf(x.d, person);
  const tabs: [Tab, string][] = [
    ['identity', t3('الهوية', 'Identity', 'Identité')],
    ['agreement', t3('الاتفاقية والمكافأة', 'Agreement & stipend', 'Accord et gratification')],
    ['letters', t3('رسائل المكافأة', 'Stipend letters', 'Lettres de gratification')],
    ...(x.pay ? [['insurance', t3('التأمين الصحي', 'Health insurance', 'Assurance maladie')] as [Tab, string]] : []),
    ...(x.vault ? [['documents', t3('الوثائق', 'Documents', 'Documents')] as [Tab, string]] : []),
    ['conduct', t3('مدونة السلوك', 'Code of conduct', 'Code de conduite')],
  ];
  return (
    <div style={centreVars(key)}>
      <button className="link" onClick={onBack}>‹ {t3('الأشخاص', 'People', 'Personnes')}</button>
      <div className="hr-sheet" style={{ marginTop: 8 }}>
        <div className="hr-sheet-top">
          <img src={markOf(key)} alt="" />
          <div className="mid">
            {person ? <TwoNames p={person} big /> : <span className="hr-names big"><b>{t3('شخص جديد', 'New person', 'Nouvelle personne')}</b></span>}
            {person && <div className="sub">{[person.role, person.centre].filter(Boolean).join(' · ') || '—'}{!person.active ? ` · ${t3('غادر', 'left', 'parti')} ${fmtDate(person.ended)}` : ''}</div>}
          </div>
          <img className="jesuit" src="/brand/jesuits.png" alt="" />
        </div>
        {person && <div className="hr-tabs">{tabs.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</div>}
      </div>
      {(!person || tab === 'identity') && <Identity {...x} person={person} onCreated={onCreated} />}
      {person && tab === 'agreement' && <Agreement {...x} person={person} />}
      {person && tab === 'letters' && <Letters {...x} person={person} />}
      {person && tab === 'insurance' && <InsurancePage s={x.s} hr={x.d} only={person.id} />}
      {person && tab === 'documents' && <Vault {...x} person={person} />}
      {person && tab === 'conduct' && <Conduct {...x} person={person} />}
    </div>
  );
}

// ---------------------------------------------------------------- who they are, in Arabic and English

function Identity({ s, d, reload, manage, person, onCreated }: P & { person: HrPerson | null; onCreated: (id: number) => void }) {
  const [f, setF] = useState<Partial<HrPerson>>(person ? { ...person, first_name: person.first_name ?? (person.name_ar ? null : person.name) } : { active: 1 });
  const set = (k: keyof HrPerson) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const inp = (k: keyof HrPerson, o: { dir?: 'rtl' | 'ltr'; type?: string } = {}) => <input dir={o.dir} type={o.type} value={(f[k] as string | null) ?? ''} onChange={set(k)} disabled={!manage} />;
  const list = (kind: 'centre' | 'account' | 'line') => d.lists.filter((x) => x.kind === kind).map((x) => { const v = kind === 'line' && x.code ? `${x.code} · ${x.name}` : x.name; return { value: v, label: kind === 'line' && x.heading ? `${v} (${x.heading})` : v }; });
  const save = async () => {
    try {
      const r = await s.api.call('hr.person.save', { ...(f as HrPerson), name: f.first_name ?? f.first_name_ar ?? '' });
      toast(t3('حُفظ', 'Saved', 'Enregistré'));
      await reload();
      if (!person) onCreated(r.id);
    } catch (e) { fail(e); }
  };
  return (
    <div className="hr-panel">
      <div className="hr-two">
        <div dir="rtl">
          <h4>العربية</h4>
          <div className="grid2">
            <Field label="الاسم الأول">{inp('first_name_ar', { dir: 'rtl' })}</Field>
            <Field label="الكنية">{inp('last_name_ar', { dir: 'rtl' })}</Field>
            <Field label="اسم الأب">{inp('father_name_ar', { dir: 'rtl' })}</Field>
            <Field label="مكان الولادة">{inp('birth_place', { dir: 'rtl' })}</Field>
            <Field label="العنوان (الموطن المختار)" className="span2">{inp('address_ar', { dir: 'rtl' })}</Field>
          </div>
        </div>
        <div dir="ltr">
          <h4>English</h4>
          <div className="grid2">
            <Field label="First name">{inp('first_name', { dir: 'ltr' })}</Field>
            <Field label="Last name">{inp('last_name', { dir: 'ltr' })}</Field>
            <Field label="Father's name">{inp('father_name', { dir: 'ltr' })}</Field>
            <Field label="Phone">{inp('phone', { dir: 'ltr' })}</Field>
            <Field label="Address (chosen domicile)" className="span2">{inp('address', { dir: 'ltr' })}</Field>
          </div>
        </div>
      </div>
      <div className="grid2" style={{ marginTop: 14 }}>
        <Field label={t3('الرقم الوطني', 'National number', 'Numéro national')}>{inp('national_id', { dir: 'ltr' })}</Field>
        <Field label={t3('تاريخ الولادة', 'Date of birth', 'Date de naissance')}>{inp('birth_date', { type: 'date' })}</Field>
        <Pick label={t3('المركز (شعاره على الوثائق)', 'Centre (its mark on the documents)', 'Centre (son logo sur les documents)')} value={f.centre ?? ''} options={list('centre')} onChange={(v) => setF({ ...f, centre: v })} disabled={!manage} />
        <Pick label={t3('الوظيفة (من سلّم الرواتب)', 'Position (from the scale)', "Poste (de l'échelle)")} value={f.role ?? ''} options={d.positions.map((p) => ({ value: p, label: p }))} onChange={(v) => setF({ ...f, role: v })} disabled={!manage} />
        <Pick label={t3('الحساب في المحاسبة', 'Account in Accounts', 'Compte en comptabilité')} value={f.account ?? ''} options={list('account')} onChange={(v) => setF({ ...f, account: v })} disabled={!manage} />
        <Pick label={t3('بند الموازنة', 'Budget line', 'Ligne budgétaire')} value={f.budget_line ?? ''} options={list('line')} onChange={(v) => setF({ ...f, budget_line: v })} disabled={!manage} />
        <Field label={t3('بدأ في', 'Started', 'Début')}>{inp('started', { type: 'date' })}</Field>
        <Field label={t3('غادر في (فارغ إن كان مستمراً)', 'Left on (empty if still here)', 'Parti le (vide si toujours là)')}>{inp('ended', { type: 'date' })}</Field>
        <Field label={t3('ملاحظة', 'Note', 'Note')} className="span2">{inp('note')}</Field>
      </div>
      {manage && <div className="modal-foot"><button className="btn primary" disabled={!(f.first_name?.trim() || f.first_name_ar?.trim())} onClick={save}>{person ? t3('حفظ', 'Save', 'Enregistrer') : t3('إنشاء', 'Create', 'Créer')}</button></div>}
    </div>
  );
}

/** A choice from a stored list. An old value no longer in the list is kept as an option, so nothing is lost. */
export function Pick({ label, value, options, onChange, disabled }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  const all = value && !options.some((o) => o.value === value) ? [{ value, label: value }, ...options] : options;
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{all.length ? '—' : t3('— القائمة فارغة: املأها من «القوائم» —', '— the list is empty: fill it in "Lists" —', '— liste vide : remplissez-la dans « Listes » —')}</option>
        {all.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

// ---------------------------------------------------------------- the agreement fixes the stipend; it can change from a date

async function makeDoc(d: HrData, pd: HrPayData | null, person: HrPerson, p: HrPaper) {
  try {
    const ctx = { person, head: await headOf(d, person), maxWeekly: pd?.settings.maxWeekly ?? 40 };
    const bytes = p.kind === 'agreement' ? await agreementDoc(ctx, p) : await stipendDoc(ctx, p);
    const who = (person.name || person.name_ar || 'person').replace(/[^\w؀-ۿ]+/g, '_');
    await saveFile(`${p.kind === 'agreement' ? 'Volunteer-agreement' : 'Stipend-letter'}_${who}_${p.start_date ?? p.paid_on ?? ''}.docx`, ['docx'], bytes, 'Word');
  } catch (e) { fail(e); }
}

function Agreement({ s, d, pd, reload, manage, pay, person }: P & { person: HrPerson }) {
  const [form, setForm] = useState<HrPaper | 'new' | null>(null);
  const [change, setChange] = useState(false);
  const today = todayIso();
  const agreements = d.papers.filter((x) => x.person_id === person.id && x.kind === 'agreement');
  const now = pd ? payOn(pd, person.id, today) : null;
  const lines = pd ? pd.pays.filter((x) => x.person_id === person.id).sort((a, b) => a.valid_from.localeCompare(b.valid_from) || a.id - b.id) : [];
  const fromAgreement = (l: HrPay) => (l.paper_id ? agreements.find((a) => a.id === l.paper_id) : undefined);
  const amountOf = (l: HrPay) => l.monthly_usd ?? pd?.grades.find((g) => g.id === l.grade_id)?.monthly_usd ?? null;
  return (
    <>
      {pay && pd && (
        <div className="hr-panel" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <b>{t3('المكافأة اليوم', 'The stipend today', "La gratification aujourd'hui")}</b>
            {manage && now && <button className="btn" onClick={() => setChange(true)}>{t3('تغيير المكافأة ابتداءً من تاريخ…', 'Change the stipend from a date…', 'Changer la gratification à partir d’une date…')}</button>}
          </div>
          {now?.monthly != null ? (
            <div className="hr-stats">
              <div><small>{t3('شهرياً', 'Monthly', 'Mensuel')}</small><span className="hr-big">{usd(now.monthly)}</span> USD</div>
              <div><small>{t3('ساعات الأسبوع', 'Hours a week', 'Heures par semaine')}</small><span className="hr-big">{now.weekly ?? '—'}</span>{now.weekly && now.weekly > (pd.settings.maxWeekly) ? <span className="desk-alert"> ⚠ &gt; {pd.settings.maxWeekly}</span> : null}</div>
              <div><small>{t3('تكلفة الساعة', 'Cost of an hour', "Coût d'une heure")}</small><span className="hr-big">{usd(now.hourly)}</span> USD</div>
              <div><small>{t3(`سنوياً (×${pd.settings.paymentsPerYear})`, `Yearly (×${pd.settings.paymentsPerYear})`, `Annuel (×${pd.settings.paymentsPerYear})`)}</small><span className="hr-big">{usd(yearlyCost(now.monthly, pd.settings.paymentsPerYear))}</span> USD</div>
            </div>
          ) : <p className="muted">{t3('لا مكافأة بعد: تُحدَّد في الاتفاقية.', 'No stipend yet: it is fixed in the agreement.', "Pas encore de gratification : elle est fixée dans l'accord.")}</p>}
          {lines.length > 0 && (
            <ul className="hr-timeline">
              {lines.map((l) => {
                const ag = fromAgreement(l);
                const amount = amountOf(l);
                return (
                  <li key={l.id} className={now?.pay.id === l.id ? 'now' : ''}>
                    <div className="when">{fmtDate(l.valid_from)} · {ag ? t3('الاتفاقية', 'the agreement', "l'accord") : `${t3('تغيير', 'change', 'changement')}${l.note ? ` — ${l.note}` : ''}`}</div>
                    <b>{usd(amount)} USD</b> · {l.weekly_hours ?? '—'} {t3('س/أسبوع', 'h/week', 'h/sem')} · {t3('الساعة', 'hour', 'heure')} {usd(amount != null ? hourlyFromMonthly(amount, l.weekly_hours) : null)}
                    {manage && !ag && <button className="link" style={{ marginInlineStart: 10 }} onClick={async () => { if (await confirmBox(t3('حذف هذا التغيير؟', 'Delete this change?', 'Supprimer ce changement ?'), true)) { try { await s.api.call('hr.pay.delete', { id: l.id }); await reload(); } catch (e) { fail(e); } } }}>✕</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div className="hr-panel">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <b>{t3('اتفاقيات التطوع السنوية', 'Yearly volunteer agreements', 'Accords annuels de bénévolat')}</b>
          {manage && <button className="btn gold" onClick={() => setForm('new')}>＋ {t3('اتفاقية جديدة', 'New agreement', 'Nouvel accord')}</button>}
        </div>
        <table className="desk-table" style={{ marginTop: 8 }}>
          <tbody>
            {agreements.map((p) => (
              <tr key={p.id}>
                <td><b>{fmtDate(p.start_date)} → {fmtDate(p.end_date)}</b><div className="muted small">{[p.position, p.amount != null ? `${usd(p.amount)} ${p.currency}` : null, p.weekly_hours ? `${p.weekly_hours} ${t3('س/أسبوع', 'h/week', 'h/sem')}` : null].filter(Boolean).join(' · ')}</div></td>
                <td className="right nowrap">
                  <button className="btn small" onClick={() => makeDoc(d, pd, person, p)}>📄 Word</button>{' '}
                  {p.file_name ? <button className="btn small" onClick={() => openScan(s, 'paper', p.id)}>📎 {t3('الموقّعة', 'Signed', 'Signé')}</button> : <span className="desk-alert small">{t3('بلا نسخة موقّعة', 'not signed yet', 'pas encore signé')}</span>}{' '}
                  {manage && <button className="btn small" onClick={() => setForm(p)}>{t3('تعديل', 'Edit', 'Modifier')}</button>}
                </td>
              </tr>
            ))}
            {!agreements.length && <tr><td className="muted">{t3('لا اتفاقية بعد.', 'No agreement yet.', "Pas encore d'accord.")}</td></tr>}
          </tbody>
        </table>
      </div>
      {form && <AgreementModal s={s} d={d} pd={pd} person={person} paper={form === 'new' ? null : form} onClose={() => setForm(null)} reload={reload} />}
      {change && pd && now && <ChangeModal s={s} pd={pd} person={person} now={now} onClose={() => setChange(false)} reload={reload} />}
    </>
  );
}

function AgreementModal({ s, d, pd, person, paper, onClose, reload }: { s: Session; d: HrData; pd: HrPayData | null; person: HrPerson; paper: HrPaper | null; onClose: () => void; reload: () => Promise<void> }) {
  // a new agreement starts on the 1st of January of next year by default (they are yearly), from the person's position
  const y = new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0);
  const last = d.papers.filter((x) => x.person_id === person.id && x.kind === 'agreement')[0];
  const refOf = (pos: string) => pd?.grades.find((g) => g.name === pos)?.monthly_usd ?? null;
  const pos0 = paper?.position ?? last?.position ?? person.role ?? '';
  const [f, setF] = useState({
    start: paper?.start_date ?? `${y}-01-01`, end: paper?.end_date ?? `${y}-12-31`, position: pos0,
    amount: paper?.amount != null ? String(paper.amount) : last?.amount != null ? String(last.amount) : refOf(pos0) != null ? String(refOf(pos0)) : '',
    currency: (paper?.currency ?? 'USD') as 'USD' | 'SYP', weekly: paper?.weekly_hours != null ? String(paper.weekly_hours) : last?.weekly_hours != null ? String(last.weekly_hours) : '', note: paper?.note ?? '',
  });
  const hourly = f.amount !== '' && f.currency === 'USD' ? hourlyFromMonthly(Number(f.amount), Number(f.weekly) || null) : null;
  const save = async () => {
    try {
      await s.api.call('hr.paper.save', { id: paper?.id ?? null, personId: person.id, kind: 'agreement', start: f.start || null, end: f.end || null, amount: f.amount === '' ? null : Number(f.amount), currency: f.currency, position: f.position || null, weeklyHours: f.weekly === '' ? null : Number(f.weekly), note: f.note || null });
      toast(t3('حُفظ', 'Saved', 'Enregistré'));
      await reload();
      onClose();
    } catch (e) { fail(e); }
  };
  return (
    <Modal title={t3('اتفاقية تطوع سنوية', 'Yearly volunteer agreement', 'Accord annuel de bénévolat')} onClose={onClose}>
      <p className="muted small">{t3('المكافأة تُحدَّد هنا في بداية الاتفاقية. إن تغيّرت خلال السنة: «تغيير المكافأة ابتداءً من تاريخ».', 'The stipend is fixed here, at the beginning of the agreement. If it changes during the year: "Change the stipend from a date".', "La gratification est fixée ici, au début de l'accord. Si elle change dans l'année : « Changer la gratification à partir d'une date ».")}</p>
      <div className="grid2">
        <Field label={t3('من', 'From', 'Du')}><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label={t3('إلى', 'To', 'Au')}><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        <Pick label={t3('الوظيفة', 'Position', 'Poste')} value={f.position} options={(pd?.grades ?? d.positions.map((name, i) => ({ id: i, name, monthly_usd: null }))).map((g) => ({ value: g.name, label: g.monthly_usd != null ? `${g.name} · ${usd(g.monthly_usd)} USD` : g.name }))} onChange={(v) => setF({ ...f, position: v, amount: f.amount === '' || Number(f.amount) === refOf(f.position) ? String(refOf(v) ?? '') : f.amount })} />
        <Field label={t3('ساعات الأسبوع المتفق عليها', 'Agreed hours a week', 'Heures par semaine convenues')}><input inputMode="decimal" value={f.weekly} onChange={(e) => setF({ ...f, weekly: e.target.value })} /></Field>
        <Field label={t3('المكافأة الشهرية', 'Monthly stipend', 'Gratification mensuelle')}><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t3('العملة', 'Currency', 'Devise')}><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'SYP' })}><option value="USD">USD</option><option value="SYP">SYP</option></select></Field>
      </div>
      {hourly != null && <p className="ok">{t3('تكلفة الساعة', 'Cost of an hour', "Coût d'une heure")}: <b>{usd(hourly)} USD</b> <span className="muted small">({t3('شهري × 12 ÷ (ساعات الأسبوع × 52)', 'monthly × 12 ÷ (hours a week × 52)', 'mensuel × 12 ÷ (heures par semaine × 52)')})</span>{Number(f.weekly) > (pd?.settings.maxWeekly ?? 40) ? <span className="desk-alert"> · ⚠ {t3('أكثر من حد الاتفاقية', "above the agreement's maximum", "au-dessus du maximum de l'accord")} ({pd?.settings.maxWeekly ?? 40})</span> : null}</p>}
      <Field label={t3('ملاحظة', 'Note', 'Note')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div className="modal-foot">
        {paper && <button className="btn danger" onClick={async () => { if (await confirmBox(t3('حذف هذه الاتفاقية؟', 'Delete this agreement?', 'Supprimer cet accord ?'), true)) { try { await s.api.call('hr.paper.delete', { id: paper.id }); await reload(); onClose(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        {paper && <button className="btn" onClick={async () => { const x = await chooseScan(t3('اختر النسخة الموقّعة', 'Choose the signed copy', 'Choisissez la copie signée')); if (x) { try { await s.api.call('hr.file.add', { kind: 'paper', id: paper.id, ...x }); toast(t3('أُرفقت', 'Attached', 'Jointe')); await reload(); } catch (e) { fail(e); } } }}>📎 {paper.file_name ? t3('استبدال النسخة الموقّعة', 'Replace the signed copy', 'Remplacer la copie signée') : t3('إرفاق النسخة الموقّعة', 'Attach the signed copy', 'Joindre la copie signée')}</button>}
        <button className="btn primary" disabled={!f.start} onClick={save}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

function ChangeModal({ s, pd, person, now, onClose, reload }: { s: Session; pd: HrPayData; person: HrPerson; now: NonNullable<ReturnType<typeof payOn>>; onClose: () => void; reload: () => Promise<void> }) {
  const [f, setF] = useState({ from: todayIso().slice(0, 8) + '01', amount: now.monthly != null ? String(now.monthly) : '', weekly: now.weekly != null ? String(now.weekly) : '', note: '' });
  const hourly = f.amount !== '' ? hourlyFromMonthly(Number(f.amount), Number(f.weekly) || null) : null;
  return (
    <Modal title={t3('تغيير المكافأة ابتداءً من تاريخ', 'Change the stipend from a date', "Changer la gratification à partir d'une date")} onClose={onClose} narrow>
      <p className="muted small">{t3('تبقى المكافأة السابقة في التاريخ. الكشوف التالية تأخذ الجديدة.', 'The earlier stipend stays in the history. The next payroll runs take the new one.', "L'ancienne gratification reste dans l'historique. Les paies suivantes prennent la nouvelle.")}</p>
      <Field label={t3('ابتداءً من', 'From', 'À partir du')}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
      <div className="grid2">
        <Field label={t3('المكافأة الشهرية (USD)', 'Monthly stipend (USD)', 'Gratification mensuelle (USD)')}><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t3('ساعات الأسبوع', 'Hours a week', 'Heures par semaine')}><input inputMode="decimal" value={f.weekly} onChange={(e) => setF({ ...f, weekly: e.target.value })} /></Field>
      </div>
      <Field label={t3('السبب', 'Why', 'Pourquoi')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      {hourly != null && <p className="ok">{t3('تكلفة الساعة', 'Cost of an hour', "Coût d'une heure")}: <b>{usd(hourly)} USD</b></p>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
        <button className="btn primary" disabled={!f.from || f.amount === ''} onClick={async () => {
          try { await s.api.call('hr.pay.save', { personId: person.id, validFrom: f.from, gradeId: now.pay.grade_id, monthlyUsd: Number(f.amount), weeklyHours: f.weekly === '' ? null : Number(f.weekly), note: f.note || null }); toast(t3('حُفظ', 'Saved', 'Enregistré')); await reload(); onClose(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
      <p className="muted small">{pd.settings.paymentsPerYear}× · {t3('الدفعة الثالثة عشرة بدل الضمان', 'the 13th is instead of social security', 'le 13e remplace la sécurité sociale')}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- one-time stipend letters

function Letters({ s, d, pd, reload, manage, person }: P & { person: HrPerson }) {
  const [form, setForm] = useState<HrPaper | 'new' | null>(null);
  const letters = d.papers.filter((x) => x.person_id === person.id && x.kind === 'stipend');
  return (
    <div className="hr-panel">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <b>{t3('رسائل المكافأة لمرة واحدة', 'One-time stipend letters', 'Lettres de gratification uniques')}</b>
        {manage && <button className="btn gold" onClick={() => setForm('new')}>＋ {t3('رسالة مكافأة', 'Stipend letter', 'Lettre de gratification')}</button>}
      </div>
      <table className="desk-table" style={{ marginTop: 8 }}>
        <tbody>
          {letters.map((p) => (
            <tr key={p.id}>
              <td><b>{p.service}</b><div className="muted small">{[p.amount != null ? `${usd(p.amount)} ${p.currency}` : null, p.paid_on ? `${t3('دُفعت', 'paid', 'payée')} ${fmtDate(p.paid_on)}` : null].filter(Boolean).join(' · ')}</div></td>
              <td className="right nowrap">
                <button className="btn small" onClick={() => makeDoc(d, pd, person, p)}>📄 Word</button>{' '}
                {p.file_name ? <button className="btn small" onClick={() => openScan(s, 'paper', p.id)}>📎</button> : null}{' '}
                {manage && <button className="btn small" onClick={() => setForm(p)}>{t3('تعديل', 'Edit', 'Modifier')}</button>}
              </td>
            </tr>
          ))}
          {!letters.length && <tr><td className="muted">{t3('لا شيء بعد.', 'Nothing yet.', 'Rien pour le moment.')}</td></tr>}
        </tbody>
      </table>
      {form && <LetterModal s={s} person={person} paper={form === 'new' ? null : form} onClose={() => setForm(null)} reload={reload} />}
    </div>
  );
}

function LetterModal({ s, person, paper, onClose, reload }: { s: Session; person: HrPerson; paper: HrPaper | null; onClose: () => void; reload: () => Promise<void> }) {
  const [f, setF] = useState({ service: paper?.service ?? '', start: paper?.start_date ?? todayIso(), paidOn: paper?.paid_on ?? '', amount: paper?.amount != null ? String(paper.amount) : '', currency: (paper?.currency ?? 'USD') as 'USD' | 'SYP', note: paper?.note ?? '' });
  return (
    <Modal title={t3('رسالة مكافأة لمرة واحدة', 'One-time stipend letter', 'Lettre de gratification unique')} onClose={onClose} narrow>
      <Field label={t3('الخدمة التي تخصها المكافأة', 'The service this stipend is for', 'Le service concerné')}><input value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} /></Field>
      <div className="grid2">
        <Field label={t3('من', 'From', 'Du')}><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label={t3('تاريخ الدفع', 'Paid on', 'Payé le')}><input type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
        <Field label={t3('المبلغ', 'Amount', 'Montant')}><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t3('العملة', 'Currency', 'Devise')}><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'SYP' })}><option value="USD">USD</option><option value="SYP">SYP</option></select></Field>
      </div>
      <div className="modal-foot">
        {paper && <button className="btn danger" onClick={async () => { if (await confirmBox(t3('حذف؟', 'Delete?', 'Supprimer ?'), true)) { try { await s.api.call('hr.paper.delete', { id: paper.id }); await reload(); onClose(); } catch (e) { fail(e); } } }}>{t3('حذف', 'Delete', 'Supprimer')}</button>}
        {paper && <button className="btn" onClick={async () => { const x = await chooseScan(t3('اختر النسخة الموقّعة', 'Choose the signed copy', 'Choisissez la copie signée')); if (x) { try { await s.api.call('hr.file.add', { kind: 'paper', id: paper.id, ...x }); await reload(); } catch (e) { fail(e); } } }}>📎</button>}
        <button className="btn primary" disabled={!f.service.trim()} onClick={async () => {
          try { await s.api.call('hr.paper.save', { id: paper?.id ?? null, personId: person.id, kind: 'stipend', service: f.service, start: f.start || null, paidOn: f.paidOn || null, amount: f.amount === '' ? null : Number(f.amount), currency: f.currency, note: f.note || null }); await reload(); onClose(); } catch (e) { fail(e); }
        }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- the vault and the code of conduct

function Vault({ s, d, reload, person }: P & { person: HrPerson }) {
  const [form, setForm] = useState(false);
  const [label, setLabel] = useState('');
  const [exp, setExp] = useState('');
  const [file, setFile] = useState<{ base64: string; mime: string; name: string } | null>(null);
  const docs = (d.docs ?? []).filter((x) => x.person_id === person.id);
  return (
    <div className="hr-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}><b>{t3('خزانة الوثائق', 'Document vault', 'Coffre des documents')}</b><button className="btn gold" onClick={() => setForm(true)}>＋ {t3('وثيقة', 'Add a document', 'Ajouter un document')}</button></div>
      <p className="muted small">{t3('كل فتح لوثيقة يُسجَّل باسمك.', 'Every opening of a document is logged with your name.', 'Chaque ouverture est notée à votre nom.')}</p>
      <table className="desk-table"><tbody>
        {docs.map((x) => (
          <tr key={x.id}>
            <td><b>{x.label}</b>{x.expires_on ? <span className="muted small"> · {t3('ينتهي', 'expires', 'expire')} {fmtDate(x.expires_on)}</span> : null}</td>
            <td className="right nowrap"><button className="btn small" onClick={() => openScan(s, 'doc', x.id)}>👁 {t3('فتح', 'Open', 'Ouvrir')}</button>{' '}<button className="btn small danger" onClick={async () => { if (await confirmBox(t3('إزالة هذه الوثيقة؟ يبقى الملف على القرص وفي السجل.', 'Remove this document? The file stays on the disk and in the log.', 'Retirer ce document ? Le fichier reste sur le disque et dans le journal.'), true)) { try { await s.api.call('hr.vault.delete', { id: x.id }); await reload(); } catch (e) { fail(e); } } }}>✕</button></td>
          </tr>
        ))}
        {!docs.length && <tr><td className="muted">{t3('لا وثائق.', 'No documents.', 'Aucun document.')}</td></tr>}
      </tbody></table>
      {form && (
        <Modal title={t3('وثيقة جديدة', 'New document', 'Nouveau document')} onClose={() => setForm(false)} narrow>
          <Field label={t3('ما هي (هوية، شهادة…)', 'What it is (ID card, certificate…)', "De quoi il s'agit (pièce d'identité, diplôme…)")}><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label={t3('تاريخ الانتهاء (إن وُجد)', 'Expiry date (if any)', "Date d'expiration (s'il y en a une)")}><input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></Field>
          <div className="row" style={{ gap: 8 }}><button className="btn" onClick={async () => setFile(await chooseScan(t3('اختر الملف', 'Choose the file', 'Choisissez le fichier')))}>📎 {t3('اختيار الملف…', 'Choose the file…', 'Choisir le fichier…')}</button>{file && <span className="ok">✓ {file.name}</span>}</div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setForm(false)}>{t3('إلغاء', 'Cancel', 'Annuler')}</button>
            <button className="btn primary" disabled={!label.trim() || !file} onClick={async () => { try { await s.api.call('hr.vault.add', { personId: person.id, label, expiresOn: exp || null, ...file! }); setForm(false); setLabel(''); setExp(''); setFile(null); await reload(); } catch (e) { fail(e); } }}>{t3('حفظ', 'Save', 'Enregistrer')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Conduct({ s, d, reload, manage, person }: P & { person: HrPerson }) {
  const latest = d.conducts[0];
  const sign = latest ? d.signs.find((x) => x.person_id === person.id && x.conduct_id === latest.id) : null;
  return (
    <div className="hr-panel">
      <b>{t3('مدونة السلوك', 'Code of conduct', 'Code de conduite')}</b>
      {!latest ? <p className="muted">{t3('لم تُدخل نسخة بعد (صفحة مدونة السلوك).', 'No version entered yet (code of conduct page).', 'Aucune version saisie (page Code de conduite).')}</p>
        : sign ? <p className="ok">✓ {t3(`وقّع النسخة ${latest.version} في ${fmtDate(sign.signed_on)}`, `Signed version ${latest.version} on ${fmtDate(sign.signed_on)}`, `A signé la version ${latest.version} le ${fmtDate(sign.signed_on)}`)}{sign.file_name ? <> · <button className="link" onClick={() => openScan(s, 'sign', sign.id)}>📎</button></> : null}</p>
          : (
            <p className="desk-alert">{t3(`لم يوقّع النسخة ${latest.version}`, `Has not signed version ${latest.version}`, `N'a pas signé la version ${latest.version}`)}
              {manage && <button className="btn small primary" style={{ marginInlineStart: 10 }} onClick={async () => { try { await s.api.call('hr.conduct.sign', { conductId: latest.id, personId: person.id, signedOn: todayIso() }); await reload(); } catch (e) { fail(e); } }}>{t3('سجّل التوقيع اليوم', 'Record signed today', "Noter signé aujourd'hui")}</button>}
            </p>
          )}
      {sign && manage && <button className="btn small" onClick={async () => { const x = await chooseScan(t3('اختر النسخة الموقّعة', 'Choose the signed copy', 'Choisissez la copie signée')); if (x) { try { await s.api.call('hr.file.add', { kind: 'sign', id: sign.id, ...x }); await reload(); } catch (e) { fail(e); } } }}>📎 {t3('إرفاق النسخة الموقّعة', 'Attach the signed copy', 'Joindre la copie signée')}</button>}
    </div>
  );
}
