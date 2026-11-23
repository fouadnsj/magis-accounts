// The pages of the calendar and its receipts, drawn with pdf-lib (taken out of the 0.12 receipt, 23 November 2026, so the
// receipt of a booking, the receipt of one payment, the booking sheet and the printed pages share one look: the two logos,
// the name of the house, Arabic and English). The Arabic font of the project has no Latin letters or digits, so a text is
// cut into Arabic runs (drawn glyph by glyph with Amiri, shaped and in the right order) and the rest (Helvetica).
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Currency } from '../hosting/host';

export type Color = ReturnType<typeof rgb>;
/** what every page of the house carries */
export interface HouseLook {
  organisation: string;
  /** the Arabic line under the name (empty: "Society of Jesus · الرهبنة اليسوعية") */
  titleAr?: string;
  /** PNG bytes: the Jesuits' logo and the centre's */
  logos: { jesuit?: Uint8Array | null; centre?: Uint8Array | null };
  /** TrueType files of Amiri (regular and bold) */
  fonts: { arabic: Uint8Array; arabicBold: Uint8Array };
  /** the accent colour of the centre (#rrggbb) */
  accent?: string;
}

const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
interface Run { text: string; ar: boolean }
/** the little of fontkit that is used here */
interface FkFont { unitsPerEm: number; layout(text: string): { glyphs: { path?: { commands: unknown[]; transform(a: number, b: number, c: number, d: number, e: number, f: number): { toSVG(): string } } }[]; positions: { xAdvance: number; xOffset: number; yOffset: number }[] } }

function runsOf(text: string): Run[] {
  const raw: Run[] = [];
  for (const ch of text) {
    const ar = AR.test(ch);
    const last = raw[raw.length - 1];
    if (last && last.ar === ar) last.text += ch; else raw.push({ text: ch, ar });
  }
  // spaces between two Arabic runs belong to the Arabic; a dash or other sign between them is drawn by Helvetica (the Arabic font has no Latin signs)
  const joined = raw.map((r, i) => (!r.ar && /^\s+$/.test(r.text) && raw[i - 1]?.ar && raw[i + 1]?.ar ? { text: r.text, ar: true } : r));
  const out: Run[] = [];
  for (const r of joined) { const l = out[out.length - 1]; if (l && l.ar === r.ar) l.text += r.text; else out.push({ ...r }); }
  return out;
}
/** an Arabic text reads from the right: the runs are laid out in the opposite order */
const rtl = (text: string) => { for (const ch of text) { if (AR.test(ch)) return true; if (/[A-Za-z0-9]/.test(ch)) return false; } return false; };
/** what Helvetica (WinAnsi) can write */
const win = (s: string) => s.replace(/→/g, '-').replace(/×/g, 'x').replace(/[−–]/g, '-').replace(/[^ -~ -ÿ—‘’“”•€…]/g, '?');

export const pdfMoney = (n: number, c: Currency) => (c === 'SYP' ? `SYP ${Math.round(n).toLocaleString('en-US')}` : `USD ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const pdfDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const hex = (h: string | undefined) => { const m = /^#?([0-9a-f]{6})$/i.exec(h ?? ''); const v = m ? parseInt(m[1], 16) : 0x5a1a1a; return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); };

/** A4 portrait (receipts, sheets) or landscape (the week of a hall) */
export async function newCanvas(look: HouseLook, o: { title: string; landscape?: boolean; margin?: number }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(o.title);
  pdf.setCreator('MAGIS Accounts');
  const lat = await pdf.embedFont(StandardFonts.Helvetica);
  const latB = await pdf.embedFont(StandardFonts.HelveticaBold);
  // The Arabic is drawn by this program, glyph by glyph, as vector shapes: the font's own engine joins the letters and
  // places each one (Amiri moves letters with positioning rules that a PDF text string cannot carry)
  const fk = [fontkit.create(look.fonts.arabic), fontkit.create(look.fonts.arabicBold)] as unknown as FkFont[];
  const W = o.landscape ? 841.89 : 595.28, H = o.landscape ? 595.28 : 841.89, M = o.margin ?? 42;
  const c = {
    pdf, W, H, M,
    accent: hex(look.accent), ink: rgb(0.13, 0.12, 0.11), muted: rgb(0.42, 0.4, 0.37), line: rgb(0.85, 0.82, 0.76), tint: rgb(0.97, 0.95, 0.9),
    page: pdf.addPage([W, H]) as PDFPage,
    y: H - M,
    /** what is drawn again at the top of a new page (the header of a table) */
    onNewPage: undefined as (() => void) | undefined,
    latOf: (bold: boolean): PDFFont => (bold ? latB : lat),
    arWidth(text: string, size: number, bold: boolean) { const f = fk[bold ? 1 : 0]; return f.layout(text).positions.reduce((n, p) => n + p.xAdvance, 0) * (size / f.unitsPerEm); },
    runWidth(r: Run, size: number, bold: boolean) { return r.ar ? c.arWidth(r.text, size, bold) : c.latOf(bold).widthOfTextAtSize(win(r.text), size); },
    widthOf(text: string, size: number, bold = false) { return runsOf(text).reduce((n, r) => n + c.runWidth(r, size, bold), 0); },
    /** one Arabic run: its glyphs, in the order they stand on the line, each a vector shape at the font's own position */
    drawArabic(text: string, cx: number, py: number, size: number, bold: boolean, color: Color) {
      const f = fk[bold ? 1 : 0];
      const sc = size / f.unitsPerEm;
      const run = f.layout(text);
      let gx = cx;
      run.glyphs.forEach((g, i) => {
        const pos = run.positions[i];
        const path = g.path;
        if (path && path.commands.length) c.page.drawSvgPath(path.transform(1, 0, 0, -1, 0, 0).toSVG(), { x: gx + pos.xOffset * sc, y: py - pos.yOffset * sc, scale: sc, color, borderWidth: 0 });
        gx += pos.xAdvance * sc;
      });
    },
    /** writes a text at x (left), or ending at x (right), or centred on x */
    put(text: string, px: number, py: number, size: number, op: { bold?: boolean; align?: 'left' | 'right' | 'center'; color?: Color } = {}) {
      if (!text) return;
      const runs = runsOf(text);
      const ordered = rtl(text) ? [...runs].reverse() : runs;
      const total = c.widthOf(text, size, op.bold);
      let cx = op.align === 'right' ? px - total : op.align === 'center' ? px - total / 2 : px;
      for (const r of ordered) {
        const col = op.color ?? c.ink;
        if (r.ar) c.drawArabic(r.text, cx, py, size, !!op.bold, col);
        else c.page.drawText(win(r.text), { x: cx, y: py, size, font: c.latOf(!!op.bold), color: col });
        cx += c.runWidth(r, size, !!op.bold);
      }
    },
    wrap(text: string, maxW: number, size: number, bold = false): string[] {
      const out: string[] = [];
      let cur = '';
      for (const w of text.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${w}` : w;
        if (cur && c.widthOf(next, size, bold) > maxW) { out.push(cur); cur = w; } else cur = next;
      }
      if (cur) out.push(cur);
      return out.length ? out : [''];
    },
    /** a text cut to fit a width (…) */
    fit(text: string, maxW: number, size: number, bold = false) {
      if (c.widthOf(text, size, bold) <= maxW) return text;
      let t = text;
      while (t.length > 1 && c.widthOf(`${t}…`, size, bold) > maxW) t = t.slice(0, -1);
      return `${t}…`;
    },
    rule(yy: number, color?: Color, x0 = M, x1 = W - M) { c.page.drawLine({ start: { x: x0, y: yy }, end: { x: x1, y: yy }, thickness: 0.7, color: color ?? c.line }); },
    newPage() { c.page = pdf.addPage([W, H]); c.y = H - M; c.onNewPage?.(); },
    ensure(need: number) { if (c.y - need < M + 30) c.newPage(); },
    /** the two logos and the name of the house; leaves y under the line */
    async head() {
      const png = async (b?: Uint8Array | null): Promise<PDFImage | null> => { try { return b ? await pdf.embedPng(b) : null; } catch { return null; } };
      const [lj, lc] = [await png(look.logos.jesuit), await png(look.logos.centre)];
      const fit = (img: PDFImage, maxH: number, maxW: number) => { const s = Math.min(maxH / img.height, maxW / img.width); return { w: img.width * s, h: img.height * s }; };
      const top = c.y;
      let hMax = 0;
      const lh = o.landscape ? 44 : 58;
      if (lj) { const d = fit(lj, lh, 120); c.page.drawImage(lj, { x: M, y: top - d.h, width: d.w, height: d.h }); hMax = Math.max(hMax, d.h); }
      if (lc) { const d = fit(lc, lh, 120); c.page.drawImage(lc, { x: W - M - d.w, y: top - d.h, width: d.w, height: d.h }); hMax = Math.max(hMax, d.h); }
      c.put(look.organisation, W / 2, top - 22, 15, { bold: true, align: 'center', color: c.accent });
      if (look.titleAr) c.put(look.titleAr, W / 2, top - 39, 11, { align: 'center', color: c.muted });
      else c.put('Society of Jesus  ·  الرهبنة اليسوعية', W / 2, top - 38, 9.5, { align: 'center', color: c.muted });
      c.y = top - Math.max(hMax, 44) - 16;
      c.rule(c.y, c.accent);
      c.y -= 30;
    },
    /** a big pale "COPY · نسخة" across the page (a receipt printed again) */
    copyMark() {
      for (const p of pdf.getPages()) {
        const size = 70, text = 'COPY';
        p.drawText(text, { x: W / 2 - latB.widthOfTextAtSize(text, size) / 2 + 40, y: H / 2 - 120, size, font: latB, color: rgb(0.85, 0.2, 0.2), opacity: 0.16, rotate: degrees(35) });
      }
      const first = pdf.getPages()[0];
      const keep = c.page;
      c.page = first;
      c.put('COPY · نسخة', W - M, H - M + 14, 10, { bold: true, align: 'right', color: rgb(0.75, 0.15, 0.15) });
      c.page = keep;
    },
    /** two places to sign, side by side */
    signatures(left: string, right: string) {
      c.ensure(70);
      c.y -= 30;
      const w = (W - 2 * M - 40) / 2;
      for (const [x, label] of [[M, left], [M + w + 40, right]] as [number, string][]) {
        c.put(label, x, c.y, 9, { bold: true, color: c.muted });
        c.page.drawLine({ start: { x, y: c.y - 34 }, end: { x: x + w, y: c.y - 34 }, thickness: 0.7, color: c.ink });
        c.put('Name and signature · الاسم والتوقيع', x, c.y - 46, 8, { color: c.muted });
      }
      c.y -= 60;
    },
    /** the foot of every page */
    foot(left: string) {
      const pages = pdf.getPages();
      const keep = c.page;
      pages.forEach((p, i) => {
        c.page = p;
        c.put(`${left}${pages.length > 1 ? `  ·  ${i + 1}/${pages.length}` : ''}`, W / 2, M - 10, 8, { align: 'center', color: c.muted });
      });
      c.page = keep;
    },
    save: () => pdf.save(),
  };
  return c;
}
export type Canvas = Awaited<ReturnType<typeof newCanvas>>;
