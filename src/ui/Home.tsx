import { useMemo } from 'react';
import { useApp } from '../state';
import { holders } from '../domain/reports';
import { TYPE_LABEL, tx } from '../i18n';
import type { TrxType } from '../domain/types';
import { useNav } from './Shell';
import { fmtDate, fmtSyp, fmtUsd, t } from './kit';
import { holderBalance } from './Cash';

export function Home() {
  const { s, d, myBook } = useApp();
  const nav = useNav();
  const holder = s.install === 'holder';
  const types: TrxType[] = holder ? ['Income', 'Exp', 'Exchange'] : ['Income', 'Exp', 'Transfer', 'Exchange'];
  const hint: Record<TrxType, string> = {
    Income: t('مال يدخل', 'money in'),
    Exp: t('مال يخرج', 'money out'),
    Transfer: t('بين الرئيسي وأمين', 'between Main and a keeper'),
    Exchange: t('دولار ← ليرة', 'USD → SYP'),
  };

  const syp = useMemo(() => holders(d.rows, d.lists.books, 'SYP'), [d]);
  const usd = useMemo(() => holders(d.rows, d.lists.books, 'USD'), [d]);
  const toReview = d.rows.filter((r) => r.review).length;
  const noBook = syp[syp.length - 1].shouldHold !== 0 || usd[usd.length - 1].shouldHold !== 0;
  const last = d.rows.reduce<string | null>((m, r) => (r.date && (!m || r.date > m) ? r.date : m), null);
  const unsent = holder ? d.rows.filter((r) => !r.sent_at).length : 0;

  return (
    <>
      <div className="page-head">
        <h1>{t('الرئيسية', 'Home')}</h1>
        <span className="muted small">
          {d.rows.length} {t('سطر', 'rows')} · {t('آخر تاريخ', 'last date')} {fmtDate(last)}
        </span>
      </div>

      <div className="big-actions" style={holder ? { gridTemplateColumns: 'repeat(3, minmax(0,1fr))' } : undefined}>
        {types.map((ty) => (
          <button key={ty} className={ty} onClick={() => nav.entry(ty)}>
            {tx(TYPE_LABEL[ty])}
            <small>{hint[ty]}</small>
          </button>
        ))}
      </div>

      {toReview > 0 && (
        <div className="alert warn row" style={{ justifyContent: 'space-between' }}>
          <span>{t(`${toReview} سطراً بحاجة إلى مراجعة`, `${toReview} rows need review`)}</span>
          <button className="btn small" onClick={() => nav.go('register', { review: true })}>{t('عرضها', 'Show them')}</button>
        </div>
      )}
      {!holder && noBook && <div className="alert err">{t('مبالغ بلا دفتر — صحّح عمود الدفتر', 'Amounts with no book — fix the Book column')}</div>}
      {holder && unsent > 0 && (
        <div className="alert info row" style={{ justifyContent: 'space-between' }}>
          <span>{t(`${unsent} قيداً لم تُرسل إلى المكتب بعد`, `${unsent} entries not yet sent to the office`)}</span>
          <button className="btn small" onClick={() => nav.go('files')}>{t('تصدير', 'Export')}</button>
        </div>
      )}

      <h2>{holder ? t('رصيدي', 'My balance') : t('ما يجب أن يحمله كل صندوق', 'What each holder should hold')}</h2>
      {holder && myBook != null ? (
        <HolderCards />
      ) : (
        <div className="cards">
          {syp.filter((l) => l.book && (l.book.active || l.shouldHold !== 0)).map((l, i) => (
            <div className="card" key={l.book!.id}>
              <div className="k">{l.book!.name}{l.book!.keeper_name ? ` · ${l.book!.keeper_name}` : ''}</div>
              <div className="v">{fmtSyp(l.shouldHold)} <span className="small muted">SYP</span></div>
              <div className="v2">{fmtUsd(usd[i].shouldHold)} USD</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function HolderCards() {
  const { d, myBook } = useApp();
  const b = holderBalance(d, myBook!);
  return (
    <div className="cards">
      <div className="card">
        <div className="k">{t('ليرة سورية', 'Syrian pounds')}</div>
        <div className="v">{fmtSyp(b.syp.shouldHold)}</div>
      </div>
      <div className="card">
        <div className="k">{t('دولار', 'Dollars')}</div>
        <div className="v">{fmtUsd(b.usd.shouldHold)}</div>
      </div>
    </div>
  );
}
