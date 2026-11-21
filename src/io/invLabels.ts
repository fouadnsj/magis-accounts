// The labels to stick on the objects (Fouad, 21 November 2026): a QR code that holds the label (JAR-0001), and the label
// written under it. A PDF of A4 pages, 3 × 8 labels, to print on plain sticker paper and cut. The QR is drawn as
// vector squares; any phone camera or scanner reads it, and the code is also written for the eye.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import qrcode from 'qrcode-generator';

const MM = 72 / 25.4;

/** the QR's dark squares, row by row (true = dark) */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** A PDF with one label per item: the QR holds `qr` (the label, and what the settings add), the code is written beside it (3 columns × 8 rows on an A4 page). `heading`: a short Latin text over each code (the centre). */
export async function labelsPdf(labels: { code: string; qr: string }[], heading = 'MAGIS'): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const plain = await pdf.embedFont(StandardFonts.Helvetica);
  const W = 210 * MM, H = 297 * MM;
  const cols = 3, rows = 8, cw = 63 * MM, ch = 33 * MM;
  const left = (W - cols * cw) / 2, top = H - 12 * MM;
  const per = cols * rows;
  const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, '?');
  for (let p = 0; p * per < labels.length; p++) {
    const page = pdf.addPage([W, H]);
    labels.slice(p * per, p * per + per).forEach(({ code, qr }, i) => {
      const x = left + (i % cols) * cw, y = top - (Math.floor(i / cols) + 1) * ch;
      page.drawRectangle({ x, y, width: cw, height: ch, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.4 });
      const m = qrMatrix(qr);
      const size = 26 * MM, quiet = 1, cell = size / (m.length + quiet * 2);
      const qx = x + 3 * MM, qy = y + (ch - size) / 2;
      m.forEach((row, r) => row.forEach((dark, c) => {
        if (dark) page.drawRectangle({ x: qx + (c + quiet) * cell, y: qy + size - (r + quiet + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: rgb(0, 0, 0) });
      }));
      page.drawText(safe(heading).slice(0, 18), { x: qx + size + 3 * MM, y: y + ch - 10 * MM, size: 8, font: plain, color: rgb(0.35, 0.35, 0.35) });
      page.drawText(safe(code), { x: qx + size + 3 * MM, y: y + ch / 2 - 5, size: 13, font: bold, color: rgb(0, 0, 0) });
    });
  }
  return pdf.save();
}
