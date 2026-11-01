import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { SheetPage } from './sheetDrawing';
const mm = 72 / 25.4;
export async function createSheetPdf(pages: SheetPage[], fontBytes: Uint8Array) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Full embedding avoids dropped glyphs in fontkit's Japanese TrueType subsetting.
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const supported = new Set(font.getCharacterSet());
  const missing = new Set(pages.flatMap(page => page.shapes.flatMap(s => s.kind === 'text' ? [...s.text].filter(c => !supported.has(c.codePointAt(0)!)) : [])));
  if (missing.size) throw new Error(`PDF用フォントにない文字があります：${[...missing].join(' ')}。スコアシート情報で文字を置き換えるか、印刷用画面を使ってください。`);
  pdf.setTitle('バスケットボール スコアシート（部内記録用）');
  pdf.setProducer('basketball-record');
  for (const model of pages) {
    const page = pdf.addPage([210 * mm, 297 * mm]);
    for (const s of model.shapes) {
      const color = rgb(parseInt(s.color.slice(1, 3), 16) / 255, parseInt(s.color.slice(3, 5), 16) / 255, parseInt(s.color.slice(5, 7), 16) / 255);
      if (s.kind === 'text') {
        const natural = font.widthOfTextAtSize(s.text, s.size * mm);
        const size = natural > s.width * mm ? s.size * mm * s.width * mm / natural : s.size * mm;
        page.drawText(s.text, { x: s.x * mm, y: (297 - s.y) * mm, size, font, color });
      } else if (s.kind === 'line') page.drawLine({ start: { x: s.x * mm, y: (297 - s.y) * mm }, end: { x: s.x2 * mm, y: (297 - s.y2) * mm }, thickness: s.weight * mm, color });
      else page.drawCircle({ x: s.x * mm, y: (297 - s.y) * mm, size: s.radius * mm, borderWidth: s.weight * mm, borderColor: color, ...(s.filled ? { color } : {}) });
    }
  }
  return pdf.save();
}
