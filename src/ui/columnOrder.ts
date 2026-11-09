// Columns put in order with the mouse: drag a column's header and drop it on another.
// The order is kept on this device for this person (a choice of display, not data).
import { useState, type DragEvent } from 'react';

export function useColumnOrder(storeKey: string, keys: string[]) {
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(storeKey) ?? 'null');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
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
  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = order.filter((k) => k !== from);
    next.splice(next.indexOf(to) + (order.indexOf(from) < order.indexOf(to) ? 1 : 0), 0, from);
    keep(next);
  };

  /** Spread on a header cell: it can be dragged, and a column can be dropped on it. */
  const drag = (key: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', key);
      e.dataTransfer.effectAllowed = 'move';
      setDragging(key);
    },
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== key) setOver(key);
    },
    onDragLeave: () => over === key && setOver(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging) move(dragging, key);
      setDragging(null);
      setOver(null);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
    className: `col-drag${dragging === key ? ' dragging' : ''}${over === key && dragging !== key ? ' drop-here' : ''}`,
  });

  return { order, drag, reset: () => keep([]), moved: saved.length > 0 };
}
