import type { Annotation, ShapeAnn, StrokeAnn } from './types';
import { BASELINE, LINE_HEIGHT, TEXT_PAD, cssFont, layoutText } from './text';

/** Redactions always sit on top of everything else. */
export function paintOrder(anns: Annotation[]) {
  return [...anns.filter((a) => a.type !== 'redact'), ...anns.filter((a) => a.type === 'redact')];
}

export function shapeColors(a: ShapeAnn) {
  return {
    stroke: a.fillMode === 'fill' ? null : a.stroke,
    fill: a.fillMode === 'outline' ? null : a.fillMode === 'fill' ? a.stroke : a.fill,
  };
}

/** A stroke's points in page space. A single point (a click) is doubled so it draws as a dot. */
export function strokePoints(a: StrokeAnn): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < a.points.length; i += 2) {
    pts.push([a.x + a.points[i] * a.w, a.y + a.points[i + 1] * a.h]);
  }
  return pts.length === 1 ? [pts[0], pts[0]] : pts;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    imageCache.set(src, p);
  }
  return p;
}

/** Draw annotations onto a 2D canvas whose coordinate system is page points * scale. Used when flattening pages. */
export async function drawAnnotations(ctx: CanvasRenderingContext2D, anns: Annotation[], scale: number) {
  for (const a of paintOrder(anns)) {
    ctx.save();
    ctx.scale(scale, scale);
    switch (a.type) {
      case 'redact':
        ctx.fillStyle = '#000';
        ctx.fillRect(a.x, a.y, a.w, a.h);
        break;
      case 'pencil':
      case 'line':
      case 'eraser':
        ctx.beginPath();
        strokePoints(a).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.lineWidth;
        ctx.lineCap = a.type === 'eraser' ? 'square' : 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        break;
      case 'rect':
      case 'ellipse': {
        const { stroke, fill } = shapeColors(a);
        const inset = stroke ? a.lineWidth / 2 : 0;
        ctx.beginPath();
        if (a.type === 'rect') {
          ctx.rect(a.x + inset, a.y + inset, a.w - inset * 2, a.h - inset * 2);
        } else {
          ctx.ellipse(
            a.x + a.w / 2, a.y + a.h / 2,
            Math.max(0, a.w / 2 - inset), Math.max(0, a.h / 2 - inset),
            0, 0, Math.PI * 2,
          );
        }
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = a.lineWidth;
          ctx.stroke();
        }
        break;
      }
      case 'text': {
        if (a.bg) {
          ctx.fillStyle = a.bg;
          ctx.fillRect(a.x, a.y, a.w, a.h);
        }
        ctx.font = cssFont(a);
        ctx.fillStyle = a.color;
        ctx.textBaseline = 'alphabetic';
        layoutText(a).forEach((line, i) => {
          const bx = a.x + TEXT_PAD;
          const by = a.y + TEXT_PAD + i * a.size * LINE_HEIGHT + a.size * BASELINE[a.font];
          ctx.fillText(line, bx, by);
          if (a.underline && line) {
            const lw = Math.max(0.5, a.size / 16);
            ctx.fillRect(bx, by + a.size * 0.1, ctx.measureText(line).width, lw);
          }
        });
        break;
      }
      case 'image':
        ctx.drawImage(await loadImage(a.src), a.x, a.y, a.w, a.h);
        break;
    }
    ctx.restore();
  }
}
