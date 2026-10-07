import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

// Type-only imports: the pdf.js library itself is loaded on demand by ./pdf.
export type { PDFDocumentProxy };

/**
 * Render a page into a canvas at the given CSS scale. Returns the render task so
 * callers can cancel it. The canvas backing store accounts for devicePixelRatio.
 */
export function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  dpr = window.devicePixelRatio || 1,
): RenderTask {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  return page.render({
    canvas,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  });
}
