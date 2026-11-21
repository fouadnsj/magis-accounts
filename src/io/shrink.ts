// A picture made smaller before it is kept or sent (Fouad, 21 November 2026): 1280 points at most, JPEG.
export async function shrinkImage(file: File, max = 1280, quality = 0.75): Promise<{ base64: string; mime: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('image')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return { base64: c.toDataURL('image/jpeg', quality).split(',')[1], mime: 'image/jpeg' };
  } finally { URL.revokeObjectURL(url); }
}
