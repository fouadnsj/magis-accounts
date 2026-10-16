// Signs the person out after some minutes without activity (a click, typing,
// scrolling). One minute before, a message offers to stay. The screen's own
// automatic checks never count as activity.
import { useEffect, useRef, useState } from 'react';
import { t } from './kit';

const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

export function IdleGuard({ minutes, onTimeout, touch }: {
  minutes: number;
  onTimeout: () => void;
  /** server: tells the server the person is still there */
  touch?: () => Promise<unknown>;
}) {
  const last = useRef(Date.now());
  const lastTouch = useRef(Date.now());
  const [left, setLeft] = useState<number | null>(null); // seconds before sign-out, while warning
  const limit = Math.max(1, minutes) * 60e3;

  const active = () => {
    last.current = Date.now();
    setLeft(null);
    // the server counts only what the person does: tell it, at most once a minute
    if (touch && Date.now() - lastTouch.current > 60e3) {
      lastTouch.current = Date.now();
      touch().catch(() => undefined);
    }
  };

  useEffect(() => {
    for (const e of EVENTS) window.addEventListener(e, active, { capture: true, passive: true });
    const timer = window.setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= limit) onTimeout();
      else if (idle >= limit - 60e3) setLeft(Math.ceil((limit - idle) / 1000));
      else setLeft(null);
    }, 1000);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, active, { capture: true });
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, onTimeout]);

  if (left == null) return null;
  return (
    <div className="idle-warning" role="alertdialog">
      <div className="panel">
        <h2>{t('ما زلتَ هنا؟', 'Still there?')}</h2>
        <p>{t(`سيُسجَّل خروجك بعد ${left} ثانية لعدم النشاط.`, `You will be signed out in ${left} seconds (no activity).`)}</p>
        <p className="muted small">{t('ما تكتبه الآن لا يضيع: تجده بعد الدخول من جديد.', 'What you are typing is not lost: you find it after signing in again.')}</p>
        <div className="modal-foot">
          <button className="btn primary" onClick={active}>{t('البقاء متصلاً', 'Stay signed in')}</button>
        </div>
      </div>
    </div>
  );
}
