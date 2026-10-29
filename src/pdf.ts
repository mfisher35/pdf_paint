import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageSize } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const { TextLayer } = pdfjs;

// Served by the pdfjs-assets plugin in vite.config.ts. Without wasmUrl, CCITT/JBIG2 images
// (the text layer of most scanned PDFs) silently fail to decode and are dropped.
const assets = new URL(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}pdfjs/`, location.href).href;

export async function openPdf(bytes: Uint8Array) {
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    wasmUrl: `${assets}wasm/`,
    cMapUrl: `${assets}cmaps/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
  });
  const doc = await task.promise;
  const sizes: PageSize[] = [];
  const transforms: number[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
    sizes.push({ w: vp.width, h: vp.height });
    transforms.push(vp.transform);
  }
  return { doc, sizes, transforms, destroy: () => task.destroy() };
}
