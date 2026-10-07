import {
  PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb,
  LineCapStyle, LineJoinStyle, concatTransformationMatrix, lineTo, moveTo, popGraphicsState, pushGraphicsState,
  setLineCap, setLineJoin, setLineWidth, setStrokingColor, stroke,
} from 'pdf-lib';
import type { Annotation, EditState, PageEntry, PageSize, TextAnn } from './types';
import { BASELINE, LINE_HEIGHT, TEXT_PAD, layoutText } from './text';
import { drawAnnotations, paintOrder, shapeColors, strokePoints } from './draw';
import type { PDFDocumentProxy } from './render';

type Matrix = [number, number, number, number, number, number];

/** Compose two PDF matrices: apply m1 first, then m2. */
function compose(m1: Matrix, m2: Matrix): Matrix {
  return [
    m2[0] * m1[0] + m2[2] * m1[1],
    m2[1] * m1[0] + m2[3] * m1[1],
    m2[0] * m1[2] + m2[2] * m1[3],
    m2[1] * m1[2] + m2[3] * m1[3],
    m2[0] * m1[4] + m2[2] * m1[5] + m2[4],
    m2[1] * m1[4] + m2[3] * m1[5] + m2[5],
  ];
}

function invert([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function color(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const FONT_MAP: Record<TextAnn['font'], StandardFonts[]> = {
  // [regular, bold, italic, bold-italic]
  Arial: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  'Times New Roman': [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  'Courier New': [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

/** Standard PDF fonts only cover WinAnsi; replace anything else so export never throws. */
function encodable(font: PDFFont, s: string) {
  let out = '';
  for (const ch of s) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

export interface ExportOptions {
  /** Rasterize pages containing redactions so the covered content is truly removed. */
  flattenRedacted: boolean;
}

export async function exportPdf(
  srcBytes: Uint8Array,
  pdfDoc: PDFDocumentProxy,
  transforms: number[][],
  edits: EditState,
  opts: ExportOptions,
): Promise<Uint8Array> {
  const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();

  const byPage = new Map<string, Annotation[]>();
  for (const a of edits.annotations) {
    if (!byPage.has(a.page)) byPage.set(a.page, []);
    byPage.get(a.page)!.push(a);
  }
  const flatten = (p: PageEntry) =>
    opts.flattenRedacted && (byPage.get(p.id) ?? []).some((a) => a.type === 'redact');

  // Copy each source page once in a single batch so they share resources (fonts etc.).
  // Pasted duplicates need their own copy, since one page object can't appear twice.
  const fromSrc = edits.pages.filter((p) => p.src !== null && !flatten(p));
  const firstUse = new Map<number, PageEntry>();
  for (const p of fromSrc) if (!firstUse.has(p.src!)) firstUse.set(p.src!, p);
  const firsts = [...firstUse.values()];
  const copiedById = new Map<string, PDFPage>();
  (await out.copyPages(src, firsts.map((p) => p.src!))).forEach((pg, i) => copiedById.set(firsts[i].id, pg));
  for (const p of fromSrc) {
    if (!copiedById.has(p.id)) copiedById.set(p.id, (await out.copyPages(src, [p.src!]))[0]);
  }

  const fonts = new Map<StandardFonts, Promise<PDFFont>>();
  const getFont = (name: StandardFonts) => {
    if (!fonts.has(name)) fonts.set(name, out.embedFont(name));
    return fonts.get(name)!;
  };
  const images = new Map<string, Promise<PDFImage>>();
  const getImage = (src: string) => {
    if (!images.has(src)) {
      images.set(src, src.startsWith('data:image/png') ? out.embedPng(src) : out.embedJpg(src));
    }
    return images.get(src)!;
  };

  for (const p of edits.pages) {
    const anns = byPage.get(p.id) ?? [];
    if (flatten(p)) {
      await addRasterizedPage(out, pdfDoc, p, anns);
      continue;
    }
    // Blank pages are unrotated, so their viewport transform is just the y-flip.
    const page = p.src === null ? out.addPage([p.w, p.h]) : out.addPage(copiedById.get(p.id)!);
    const transform = (p.src === null ? [1, 0, 0, -1, 0, p.h] : transforms[p.src]) as Matrix;
    if (anns.length) await drawVector(page, anns, p, transform, getFont, getImage);
  }

  return out.save();
}

/**
 * Append every page of `extra` to the end of `base`. The base's own pages keep their
 * indices, so existing PageEntry.src values stay valid against the returned bytes.
 */
export async function appendPdf(base: Uint8Array, extra: Uint8Array) {
  const doc = await PDFDocument.load(base, { ignoreEncryption: true });
  const add = await PDFDocument.load(extra, { ignoreEncryption: true });
  // Re-saving an encrypted file without its key would corrupt its content.
  if (doc.isEncrypted) throw new Error('PDFs cannot be inserted into a password-protected document.');
  if (add.isEncrypted) throw new Error('Password-protected PDFs cannot be inserted.');
  const pages = await doc.copyPages(add, add.getPageIndices());
  for (const pg of pages) doc.addPage(pg);
  return { bytes: await doc.save(), added: pages.length };
}

async function addRasterizedPage(out: PDFDocument, pdfDoc: PDFDocumentProxy, p: PageEntry, anns: Annotation[]) {
  const SCALE = 3; // 216 DPI
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(p.w * SCALE);
  canvas.height = Math.ceil(p.h * SCALE);
  if (p.src !== null) {
    const page = await pdfDoc.getPage(p.src + 1);
    const viewport = page.getViewport({ scale: SCALE });
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
  } else {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  await drawAnnotations(canvas.getContext('2d')!, anns, SCALE);
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
  const img = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
  const pg = out.addPage([p.w, p.h]);
  pg.drawImage(img, { x: 0, y: 0, width: p.w, height: p.h });
}

async function drawVector(
  page: PDFPage,
  anns: Annotation[],
  size: PageSize,
  viewportTransform: Matrix,
  getFont: (n: StandardFonts) => Promise<PDFFont>,
  getImage: (src: string) => Promise<PDFImage>,
) {
  const H = size.h;
  // Our drawing space: y-up, origin at bottom-left of the *displayed* page (rotation applied).
  // Map it to PDF user space: flip to y-down viewport space, then invert the viewport transform.
  const m = compose([1, 0, 0, -1, 0, H], invert(viewportTransform));
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));

  for (const a of paintOrder(anns)) {
    const yUp = H - a.y - a.h;
    switch (a.type) {
      case 'redact':
        page.drawRectangle({ x: a.x, y: yUp, width: a.w, height: a.h, color: rgb(0, 0, 0) });
        break;
      case 'pencil':
      case 'line': {
        const [first, ...rest] = strokePoints(a);
        page.pushOperators(
          pushGraphicsState(),
          setStrokingColor(color(a.color)),
          setLineWidth(a.lineWidth),
          setLineCap(LineCapStyle.Round),
          setLineJoin(LineJoinStyle.Round),
          moveTo(first[0], H - first[1]),
          ...rest.map(([x, y]) => lineTo(x, H - y)),
          stroke(),
          popGraphicsState(),
        );
        break;
      }
      case 'rect':
      case 'ellipse': {
        const { stroke, fill } = shapeColors(a);
        const inset = stroke ? a.lineWidth / 2 : 0;
        const common = {
          color: fill ? color(fill) : undefined,
          borderColor: stroke ? color(stroke) : undefined,
          borderWidth: stroke ? a.lineWidth : 0,
        };
        if (a.type === 'rect') {
          page.drawRectangle({
            x: a.x + inset, y: yUp + inset,
            width: Math.max(0, a.w - inset * 2), height: Math.max(0, a.h - inset * 2),
            ...common,
          });
        } else {
          page.drawEllipse({
            x: a.x + a.w / 2, y: yUp + a.h / 2,
            xScale: Math.max(0, a.w / 2 - inset), yScale: Math.max(0, a.h / 2 - inset),
            ...common,
          });
        }
        break;
      }
      case 'text': {
        if (a.bg) page.drawRectangle({ x: a.x, y: yUp, width: a.w, height: a.h, color: color(a.bg) });
        const font = await getFont(FONT_MAP[a.font][(a.bold ? 1 : 0) + (a.italic ? 2 : 0)]);
        layoutText(a).forEach((raw, i) => {
          const line = encodable(font, raw);
          const x = a.x + TEXT_PAD;
          const y = H - (a.y + TEXT_PAD + i * a.size * LINE_HEIGHT + a.size * BASELINE[a.font]);
          if (line) page.drawText(line, { x, y, size: a.size, font, color: color(a.color) });
          if (a.underline && line) {
            const lw = Math.max(0.5, a.size / 16);
            page.drawRectangle({
              x, y: y - a.size * 0.1 - lw,
              width: font.widthOfTextAtSize(line, a.size), height: lw,
              color: color(a.color),
            });
          }
        });
        break;
      }
      case 'image':
        page.drawImage(await getImage(a.src), { x: a.x, y: yUp, width: a.w, height: a.h });
        break;
    }
  }

  page.pushOperators(popGraphicsState());
}
