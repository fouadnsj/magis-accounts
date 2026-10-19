// "⧉ Duplicate ▾" at the top of an open record (centres and communities): a small menu with two
// choices, away from Delete and Save so one tap cannot do it by mistake (Fouad, 19 October 2026).
import { useRef } from 'react';

export function CopyMenu({ label, same, today, onSame, onToday }: { label: string; same: string; today: string; onSame: () => void; onToday: () => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pick = (f: () => void) => () => { if (ref.current) ref.current.open = false; f(); };
  return (
    <details className="copy-menu" ref={ref}>
      <summary>⧉ {label} ▾</summary>
      <div className="copy-menu-list">
        <button type="button" onClick={pick(onSame)}>{same}</button>
        <button type="button" onClick={pick(onToday)}>{today}</button>
      </div>
    </details>
  );
}
