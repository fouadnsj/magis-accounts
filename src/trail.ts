// "Where am I" (Fouad, 25 November 2026: "he feels lost in the wide app"): the line at the top of every page inside a door,
// "Door › Page › Part" — one small function that every page calls (useTrail) instead of strings copied around.
// The door and the page come from the menus' own names (Shell); a page adds what it shows inside (a tab, a space, an item).
import { createContext, useContext, useEffect, useRef } from 'react';

/** one step of the line; `go` is there when it leads somewhere */
export interface Crumb { label: string; go?: () => void }
/** what a page declares: the steps inside it, and how to come back to its own list */
export interface TrailReg { extra: Crumb[]; pageGo?: () => void }

/**
 * Builds the line: the door, the page (not repeated when it has the door's name), then what the page declared.
 * The last step is where one is, so it leads nowhere; the others lead somewhere when they can:
 * the door to its first page, the page to its list (only when the page declared steps inside it and a way back to its list).
 */
export function buildTrail(door: Crumb | null, page: Crumb | null, reg: TrailReg | null): Crumb[] {
  const extra = reg?.extra ?? [];
  const back = extra.length && reg?.pageGo ? reg.pageGo : undefined;
  const out: Crumb[] = [];
  const same = !!(door && page && page.label === door.label);
  // a page that has the door's own name (Calendar, Inventory) is the door's first page: the door's step also leads back to its list
  if (door) out.push(same && back ? { label: door.label, go: back } : door);
  if (page && !same) out.push(back ? { label: page.label, go: back } : { label: page.label });
  out.push(...extra);
  // the last one is the place itself
  return out.map((c, i) => (i === out.length - 1 ? { label: c.label } : c));
}

export const TrailCtx = createContext<((r: TrailReg | null) => void) | null>(null);

/**
 * A page tells where it is inside itself: `useTrail([{ label: 'Monthly' }])`, or with a way back to its own list.
 * The line is rebuilt only when the labels change.
 */
export function useTrail(extra: Crumb[], pageGo?: () => void) {
  const set = useContext(TrailCtx);
  const latest = useRef({ extra, pageGo });
  latest.current = { extra, pageGo };
  const key = extra.map((c) => c.label).join('␟');
  useEffect(() => {
    if (!latest.current.extra.length) return undefined;
    set?.({ extra: latest.current.extra, pageGo: latest.current.pageGo });
    return () => set?.(null);
  }, [key, set]); // eslint-disable-line react-hooks/exhaustive-deps
}
