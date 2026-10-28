import type { EditState } from './types';
import type { PDFDocumentProxy } from './render';
import { rasterizePage } from './raster';

/** Pixels per point for printing: 200 DPI. */
const PRINT_SCALE = 200 / 72;

/**
 * Print the document as the user sees it. Each page is rendered to an image and laid out
 * one per sheet in a hidden frame, which prints the same way in browsers and desktop webviews.
 */
export async function printPages(pdf: PDFDocumentProxy, edits: EditState) {
  const urls: string[] = [];
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  const cleanup = () => {
    frame.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
  try {
    const pages: { url: string; w: number; h: number }[] = [];
    for (const p of edits.pages) {
      const canvas = await rasterizePage(pdf, p, edits.annotations.filter((a) => a.page === p.id), PRINT_SCALE);
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Rendering failed.'))), 'image/png'));
      const url = URL.createObjectURL(blob);
      urls.push(url);
      pages.push({ url, w: p.w, h: p.h });
    }
    document.body.appendChild(frame);
    const fd = frame.contentDocument!;
    fd.open();
    fd.write(`<!DOCTYPE html><html><head><style>
      @page { margin: 0; }
      html, body { margin: 0; padding: 0; }
      .sheet { break-after: page; display: flex; align-items: center; justify-content: center; width: 100vw; height: 100vh; overflow: hidden; }
      .sheet:last-child { break-after: auto; }
      img { max-width: 100%; max-height: 100%; }
    </style></head><body>${pages.map((p) => `<div class="sheet"><img src="${p.url}"></div>`).join('')}</body></html>`);
    fd.close();
    const win = frame.contentWindow!;
    await Promise.all([...fd.images].map((img) => img.decode().catch(() => {})));
    win.addEventListener('afterprint', () => setTimeout(cleanup, 0), { once: true });
    win.focus();
    win.print();
    // Some webviews never fire afterprint; don't leave the frame around forever.
    setTimeout(cleanup, 60_000);
  } catch (e) {
    cleanup();
    throw e;
  }
}
