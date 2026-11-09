// Columns put in order with the mouse: press on a column's header, move, release on another.
// Done with plain mouse (pointer) events, not the browser's drag-and-drop: in the desktop
// app (Tauri) the window keeps drag-and-drop for files, so a dragged header never arrives.
// The order is kept on this device for this person (a choice of display, not data).
import { useEffect, useRef, useState, type PointerEvent } from 'react';

/** Press–move–release on headers marked data-col; calls onMove(from, to) on release. */
export function useColumnDrag(onMove: (from: string, to: string) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const start = useRef<{ key: string; x: number; y: number; moved: boolean } | null>(null);
  /** a header released after a drag must not also be "clicked" (it would sort) */
  const justDragged = useRef(false);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  useEffect(() => {
    const keyAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('[data-col]') as HTMLElement | null)?.dataset.col ?? null;
    const move = (e: globalThis.PointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
      if (!s.moved) {
        s.moved = true;
        setDragging(s.key);
        document.body.classList.add('col-dragging');
      }
      setOver(keyAt(e.clientX, e.clientY));
    };
    const up = (e: globalThis.PointerEvent) => {
      const s = start.current;
      start.current = null;
      document.body.classList.remove('col-dragging');
      if (!s?.moved) return;
      const to = keyAt(e.clientX, e.clientY);
      if (to && to !== s.key) moveRef.current(s.key, to);
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      setDragging(null);
      setOver(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  /** Spread on a header cell. Add its own classes after `className`. */
  const drag = (key: string) => ({
    'data-col': key,
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      start.current = { key, x: e.clientX, y: e.clientY, moved: false };
    },
    className: `col-drag${dragging === key ? ' dragging' : ''}${over === key && dragging && dragging !== key ? ' drop-here' : ''}`,
  });
  return { drag, wasDragged: () => justDragged.current };
}

/** Where a column dropped on another goes: in that one's place. */
export function moveKey(order: string[], from: string, to: string): string[] {
  if (from === to) return order;
  const next = order.filter((k) => k !== from);
  next.splice(next.indexOf(to) + (order.indexOf(from) < order.indexOf(to) ? 1 : 0), 0, from);
  return next;
}

export function useColumnOrder(storeKey: string, keys: string[]) {
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(storeKey) ?? 'null');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  // the saved order, then any column it does not know yet, in its usual place
  const order = [...saved.filter((k) => keys.includes(k)), ...keys.filter((k) => !saved.includes(k))];
  const keep = (next: string[]) => {
    setSaved(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {
      /* kept for this visit only */
    }
  };
  const { drag } = useColumnDrag((from, to) => keep(moveKey(order, from, to)));
  return { order, drag, reset: () => keep([]), moved: saved.length > 0 };
}
