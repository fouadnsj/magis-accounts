// The community's colours on the whole page while its screens are open (style.ts).
import { useEffect } from 'react';
import { applyPalette, paletteOf, type CtyStyle } from '../style';

export function usePalette(style: CtyStyle | null | undefined) {
  const color = style?.color ?? null;
  const palette = style?.palette ?? null;
  useEffect(() => applyPalette(paletteOf(color, palette)), [color, palette]);
}
