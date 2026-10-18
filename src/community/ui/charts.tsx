// Charts of the community screens: a ring of where the money went (with the % of each
// part beside it), and columns month by month. Drawn by hand, no library, like MAGIS's
// charts: thin shapes, values written in ink colours, a tap shows the detail.
import { useState } from 'react';

export const SHADES = ['#B8891B', '#5B191D', '#232D53', '#2A6FB0', '#D2691E', '#6b7b4a', '#8A6A1A', '#7a5c8f', '#3f7f7a', '#b25b6e'];

export interface Part { key: string | number; label: string; value: number }

/** A ring: each part's share of the whole, the biggest first; the legend gives the % and the amount. */
export function Ring({ parts, fmt, center, onPick }: { parts: Part[]; fmt: (n: number) => string; center?: string; onPick?: (p: Part) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const total = shown.reduce((n, p) => n + p.value, 0);
  if (!total) return null;
  // the small parts after the 7th are put together, so the ring stays readable
  const big = shown.slice(0, 7);
  const rest = shown.slice(7).reduce((n, p) => n + p.value, 0);
  const slices = rest ? [...big, { key: 'rest', label: '…', value: rest }] : big;
  const R = 54, C = 2 * Math.PI * R;
  let at = 0;
  return (
    <div className="cty-ring">
      <svg viewBox="0 0 140 140" width="150" height="150" role="img">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#f3efe5" strokeWidth="18" />
        {slices.map((p, i) => {
          const len = (p.value / total) * C;
          const el = (
            <circle key={p.key} cx="70" cy="70" r={R} fill="none" stroke={SHADES[i % SHADES.length]} strokeWidth={hover === i ? 22 : 18}
              strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-at} transform="rotate(-90 70 70)"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(p)} style={{ cursor: onPick ? 'pointer' : undefined }} />
          );
          at += len;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" className="cty-ring-big">{hover != null ? `${Math.round((slices[hover].value / total) * 100)}%` : fmt(total)}</text>
        <text x="70" y="84" textAnchor="middle" className="cty-ring-small">{hover != null ? slices[hover].label.slice(0, 18) : center ?? ''}</text>
      </svg>
      <ul className="cty-ring-legend">
        {slices.map((p, i) => (
          <li key={p.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(p)} className={onPick ? 'click' : ''}>
            <i style={{ background: SHADES[i % SHADES.length] }} />
            <span className="cty-ring-label">{p.label}</span>
            <b>{Math.round((p.value / total) * 100)}%</b>
            <span className="muted">{fmt(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Columns, one per month: this period (gold) beside the same month a year before (grey). */
export function Columns({ cols, fmt }: { cols: { label: string; title: string; now: number; before?: number }[]; fmt: (n: number) => string }) {
  const [tip, setTip] = useState<number | null>(null);
  const max = Math.max(1, ...cols.flatMap((c) => [c.now, c.before ?? 0]));
  return (
    <div>
      <div className="cty-cols" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
        {cols.map((c, i) => (
          <div key={c.title} className="cty-col" onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} onClick={() => setTip(tip === i ? null : i)}>
            <div className="cty-col-bars">
              {c.before != null && <i className="before" style={{ height: `${(c.before / max) * 100}%` }} />}
              <i className="now" style={{ height: `${(c.now / max) * 100}%` }} />
            </div>
            <span>{c.label}</span>
          </div>
        ))}
      </div>
      <div className="muted small" style={{ minHeight: 18 }}>{tip != null ? `${cols[tip].title}: ${fmt(cols[tip].now)}${cols[tip].before != null ? ` · ${fmt(cols[tip].before!)}` : ''}` : ''}</div>
    </div>
  );
}
