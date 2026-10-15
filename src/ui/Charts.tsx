// Small charts, drawn by hand (no library): horizontal bars and month columns.
// Rules (dataviz guidance): one unit per chart, thin bars with a 4px rounded end,
// value at the tip, a tooltip on hover, text in ink colours (never the bar colour),
// a legend whenever two series are shown. Income blue, expenses orange — a pair
// checked for colour-blind readers.
import { useState, type ReactNode } from 'react';

export const INCOME = '#2A6FB0';
export const EXPENSE = '#D2691E';

export interface Bar {
  key: string | number;
  label: string;
  value: number;
}

function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = (e: React.MouseEvent, body: ReactNode) => setTip({ x: e.clientX, y: e.clientY, body });
  const node = tip ? <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.body}</div> : null;
  return { show, hide: () => setTip(null), node };
}

/** Horizontal bars, largest first. Click a bar to open it (e.g. a heading → its lines). */
export function BarList({ bars, color, fmt, onPick, unit, empty }: {
  bars: Bar[]; color: string; fmt: (n: number) => string; onPick?: (b: Bar) => void; unit: string; empty: string;
}) {
  const tip = useTip();
  const shown = bars.filter((b) => Math.abs(b.value) > 0.004).sort((a, b) => b.value - a.value);
  const max = Math.max(...shown.map((b) => b.value), 0);
  const total = shown.reduce((a, b) => a + b.value, 0);
  if (!shown.length) return <p className="muted small">{empty}</p>;
  return (
    <div className="barlist">
      {shown.map((b) => (
        <div
          key={b.key}
          className={`bar-row ${onPick ? 'click' : ''}`}
          onClick={() => onPick?.(b)}
          onMouseMove={(e) => tip.show(e, <><b>{b.label}</b><div className="ltr">{fmt(b.value)} {unit} · {total ? Math.round((b.value / total) * 100) : 0}%</div></>)}
          onMouseLeave={tip.hide}
        >
          <div className="bar-label" title={b.label}>{b.label}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${max > 0 ? Math.max(0.5, (b.value / max) * 100) : 0}%`, background: color }} />
            <span className="bar-value">{fmt(b.value)}</span>
          </div>
        </div>
      ))}
      {tip.node}
    </div>
  );
}

/** Income and expenses per month, side by side, on one scale. */
export function MonthColumns({ months, fmt, unit }: { months: { label: string; income: number; expense: number }[]; fmt: (n: number) => string; unit: string }) {
  const tip = useTip();
  const W = 720;
  const H = 230;
  const pad = { l: 56, r: 8, t: 10, b: 28 };
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  // clean ticks: 0, step, 2·step… (step = 1, 2 or 5 × a power of ten)
  const raw = max / 4;
  const p10 = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * p10).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / Math.max(1, months.length);
  const bw = Math.min(16, (slot - 8) / 2);
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const bar = (x: number, v: number, c: string) => {
    const h = Math.max(0, plotH - (y(v) - pad.t));
    if (h <= 0) return null;
    const r = Math.min(4, h, bw / 2);
    // rounded at the data end (top), square at the baseline
    return <path d={`M${x},${pad.t + plotH} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + bw - r} Q${x + bw},${y(v)} ${x + bw},${y(v) + r} V${pad.t + plotH} Z`} fill={c} />;
  };
  return (
    <div className="month-cols">
      <div className="legend">
        <span><i style={{ background: INCOME }} /> {'إيرادات · Income'}</span>
        <span><i style={{ background: EXPENSE }} /> {'نفقات · Expenses'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ direction: 'ltr' }}>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tv)} y2={y(tv)} stroke="#ECE7DC" strokeWidth={1} />
            <text x={pad.l - 6} y={y(tv) + 4} textAnchor="end" fontSize="10" fill="#8A8577">{fmt(tv)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const x0 = pad.l + i * slot + (slot - (bw * 2 + 2)) / 2;
          return (
            <g key={m.label}
              onMouseMove={(e) => tip.show(e, <><b>{m.label}</b><div className="ltr"><i className="dot" style={{ background: INCOME }} /> {fmt(m.income)} {unit}</div><div className="ltr"><i className="dot" style={{ background: EXPENSE }} /> {fmt(m.expense)} {unit}</div></>)}
              onMouseLeave={tip.hide}>
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={plotH} fill="transparent" />
              {bar(x0, m.income, INCOME)}
              {bar(x0 + bw + 2, m.expense, EXPENSE)}
              <text x={pad.l + i * slot + slot / 2} y={H - 10} textAnchor="middle" fontSize="10" fill="#5d6b7a">{m.label}</text>
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} stroke="#C9C2B3" strokeWidth={1} />
      </svg>
      {tip.node}
    </div>
  );
}
