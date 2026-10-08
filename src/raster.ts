import type { Annotation, PageEntry } from './types';
import type { PDFDocumentProxy } from './render';
import { drawAnnotations } from './draw';

/** Render a page with its annotations onto a white canvas at `scale` pixels per point. */
export async function rasterizePage(pdf: PDFDocumentProxy, p: PageEntry, anns: Annotation[], scale: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(p.w * scale);
  canvas.height = Math.ceil(p.h * scale);
  if (p.src !== null) {
    const page = await pdf.getPage(p.src + 1);
    await page.render({ canvas, viewport: page.getViewport({ scale }), background: '#ffffff' }).promise;
  } else {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  await drawAnnotations(canvas.getContext('2d')!, anns, scale);
  return canvas;
}

/** The last page image, so repeated fill / pick / wand clicks on an unchanged page skip re-rendering. */
let cached: { pdf: PDFDocumentProxy; p: PageEntry; anns: Annotation[]; scale: number; img: Promise<ImageData> } | null = null;

/** Pixels of a page as the user sees it (PDF + annotations). */
export function pageImage(pdf: PDFDocumentProxy, p: PageEntry, anns: Annotation[], scale: number): Promise<ImageData> {
  const c = cached;
  if (
    c && c.pdf === pdf && c.p === p && c.scale === scale &&
    c.anns.length === anns.length && c.anns.every((a, i) => a === anns[i])
  ) {
    return c.img;
  }
  const img = rasterizePage(pdf, p, anns, scale).then((canvas) =>
    canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height),
  );
  cached = { pdf, p, anns, scale, img };
  img.catch(() => cached?.img === img && (cached = null));
  return img;
}

export function pixelColor(img: ImageData, x: number, y: number) {
  const px = Math.min(img.width - 1, Math.max(0, Math.floor(x)));
  const py = Math.min(img.height - 1, Math.max(0, Math.floor(y)));
  const i = (py * img.width + px) * 4;
  return '#' + [0, 1, 2].map((k) => img.data[i + k].toString(16).padStart(2, '0')).join('');
}

/** A pixel mask cropped to its bounding box, in image pixels. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  mask: Uint8Array;
}

/**
 * Flood-fill from (sx, sy): every pixel connected to it whose channels are all within
 * `tolerance` of the seed color. The result is grown by one pixel into anti-aliased edge
 * pixels (ones only partway to the boundary color), so fills don't leave a halo but don't
 * eat into the boundary itself either.
 */
export function floodRegion(img: ImageData, sx: number, sy: number, tolerance: number): Region | null {
  const { width: W, height: H, data } = img;
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  const s = (sy * W + sx) * 4;
  const [r0, g0, b0] = [data[s], data[s + 1], data[s + 2]];
  const near = (p: number, t: number) => {
    const i = p * 4;
    return Math.abs(data[i] - r0) <= t && Math.abs(data[i + 1] - g0) <= t && Math.abs(data[i + 2] - b0) <= t;
  };
  const match = (p: number) => near(p, tolerance);
  const edge = Math.max(128, tolerance);

  // Scanline fill.
  const full = new Uint8Array(W * H);
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  const stack = [sy * W + sx];
  while (stack.length) {
    const p = stack.pop()!;
    if (full[p]) continue;
    const y = (p / W) | 0;
    const row = y * W;
    let l = p - row;
    let r = l;
    while (l > 0 && !full[row + l - 1] && match(row + l - 1)) l--;
    while (r < W - 1 && !full[row + r + 1] && match(row + r + 1)) r++;
    full.fill(1, row + l, row + r + 1);
    if (l < minX) minX = l;
    if (r > maxX) maxX = r;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= H) continue;
      let run = false;
      for (let x = l; x <= r; x++) {
        const q = ny * W + x;
        const ok = !full[q] && match(q);
        if (ok && !run) stack.push(q);
        run = ok;
      }
    }
  }

  // Crop to the bounding box plus a 1px border, and grow into edge pixels.
  const x0 = Math.max(0, minX - 1), y0 = Math.max(0, minY - 1);
  const x1 = Math.min(W - 1, maxX + 1), y1 = Math.min(H - 1, maxY + 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * W + x;
      let on = full[p];
      if (!on && !near(p, edge)) continue;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < W && full[yy * W + xx]) {
            on = 1;
            break;
          }
        }
      }
      mask[(y - y0) * w + (x - x0)] = on;
    }
  }
  return { x: x0, y: y0, w, h, mask };
}

/** PNG of a region: either a solid color, or the region's own pixels cut out of `img`. Transparent elsewhere. */
export function regionToPng(region: Region, paint: string | ImageData) {
  const canvas = document.createElement('canvas');
  canvas.width = region.w;
  canvas.height = region.h;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(region.w, region.h);
  const n = typeof paint === 'string' ? parseInt(paint.slice(1), 16) : 0;
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) {
      const m = y * region.w + x;
      if (!region.mask[m]) continue;
      const o = m * 4;
      if (typeof paint === 'string') {
        out.data.set(rgb, o);
      } else {
        const i = ((region.y + y) * paint.width + region.x + x) * 4;
        out.data.set(paint.data.subarray(i, i + 3), o);
      }
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}

/** A rectangle or ellipse (given in points) as a region of an image rendered at `scale`. */
export function shapeRegion(
  img: ImageData,
  box: { x: number; y: number; w: number; h: number },
  scale: number,
  ellipse: boolean,
): Region | null {
  const x0 = Math.max(0, Math.floor(box.x * scale)), y0 = Math.max(0, Math.floor(box.y * scale));
  const x1 = Math.min(img.width, Math.ceil((box.x + box.w) * scale));
  const y1 = Math.min(img.height, Math.ceil((box.y + box.h) * scale));
  const w = x1 - x0, h = y1 - y0;
  if (w < 1 || h < 1) return null;
  const mask = new Uint8Array(w * h);
  if (!ellipse) {
    mask.fill(1);
  } else {
    const cx = (box.x + box.w / 2) * scale, cy = (box.y + box.h / 2) * scale;
    const rx = (box.w / 2) * scale, ry = (box.h / 2) * scale;
    for (let y = 0; y < h; y++) {
      const ny = (y0 + y + 0.5 - cy) / ry;
      for (let x = 0; x < w; x++) {
        const nx = (x0 + x + 0.5 - cx) / rx;
        if (nx * nx + ny * ny <= 1) mask[y * w + x] = 1;
      }
    }
  }
  return { x: x0, y: y0, w, h, mask };
}

/**
 * SVG path data tracing the boundary of a region's mask, in the region's pixel coordinates
 * (0..w, 0..h). Each closed loop is one subpath, so dashes run continuously around it.
 */
export function regionOutline(region: Region) {
  const { w, h, mask } = region;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Unit edges between on and off pixels, directed clockwise around the on pixels.
  // Stored per start vertex as a bitmask of directions: 1 right, 2 down, 4 left, 8 up.
  const W1 = w + 1;
  const out = new Uint8Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (!on(x, y - 1)) out[y * W1 + x] |= 1;
      if (!on(x + 1, y)) out[y * W1 + x + 1] |= 2;
      if (!on(x, y + 1)) out[(y + 1) * W1 + x + 1] |= 4;
      if (!on(x - 1, y)) out[(y + 1) * W1 + x] |= 8;
    }
  }
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const parts: string[] = [];
  for (let v = 0; v < out.length; v++) {
    while (out[v]) {
      let x = v % W1, y = (v / W1) | 0;
      let d = out[v] & 1 ? 0 : out[v] & 2 ? 1 : out[v] & 4 ? 2 : 3;
      parts.push(`M${x} ${y}`);
      let prev = -1;
      for (;;) {
        out[y * W1 + x] &= ~(1 << d);
        if (prev !== -1 && d !== prev) parts.push(`L${x} ${y}`);
        prev = d;
        x += DX[d];
        y += DY[d];
        const bits = out[y * W1 + x];
        if (!bits) break;
        // Prefer turning right, then straight, then left, so pinch points split into separate loops.
        d = [(d + 1) & 3, d, (d + 3) & 3, (d + 2) & 3].find((n) => bits & (1 << n))!;
      }
      parts.push('Z');
    }
  }
  return parts.join('');
}
