import { useEffect, useRef, useState } from 'react';
import type { Annotation, EditState, ImageAnn, PageEntry, Tool } from '../types';
import { cursorStore, fitText, makeStroke, newId, selectionOutlines, updateAnn, useEditor } from '../editor';
import { renderPage } from '../render';
import { LINE_HEIGHT, TEXT_PAD, fontStyle } from '../text';
import { paintOrder } from '../draw';
import { floodRegion, pageImage, pixelColor, regionOutline, regionToPng, shapeRegion, type Region } from '../raster';
import { AnnotationView } from './AnnotationView';

/** Set `true` once the element is near the viewport, `false` once it scrolls far away. */
export function useNearViewport(ref: React.RefObject<HTMLElement | null>, margin = '800px') {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return near;
}

/** Renders a PDF page into a canvas while it's near the viewport. */
export function PageCanvas({ src, scale, near }: { src: number | null; scale: number; near: boolean }) {
  const { pdf } = useEditor();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!near || !canvas || src === null) return;
    let task: ReturnType<typeof renderPage> | null = null;
    let cancelled = false;
    pdf.getPage(src + 1).then((p) => {
      if (cancelled) return;
      task = renderPage(p, canvas, scale);
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, src, scale, near]);
  return near && src !== null ? <canvas ref={ref} /> : null;
}

export function PageView({ entry }: { entry: PageEntry }) {
  const { zoom } = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  return (
    <div className="page" ref={ref} data-page={entry.id} style={{ width: entry.w * zoom, height: entry.h * zoom }}>
      <PageCanvas src={entry.src} scale={zoom} near={near} />
      <AnnotationLayer entry={entry} />
    </div>
  );
}

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const ALL_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const DRAW_TOOLS: Tool[] = ['redact', 'rect', 'ellipse', 'text'];
/** Tools that pick up and move the selected object when it's dragged. */
const MOVE_TOOLS: Tool[] = ['select', 'rect-select', 'ellipse-select', 'wand'];
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
/** How far (per RGB channel, 0-255) a pixel may differ from the clicked one and still count as the same area. */
const FILL_TOLERANCE = 32;
const WAND_TOLERANCE = 48;

/** A square cursor the size of the eraser at the current zoom. */
function eraserCursor(size: number) {
  const s = Math.round(clamp(size, 4, 120));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><rect x='0.5' y='0.5' width='${s - 1}' height='${s - 1}' fill='white' stroke='black'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${s >> 1} ${s >> 1}, crosshair`;
}

function AnnotationLayer({ entry }: { entry: PageEntry }) {
  const page = entry.id;
  const size = entry;
  const ed = useEditor();
  const { zoom, tool, style, edits, dispatch } = ed;
  const layerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  /** The rectangle / ellipse being dragged out by a marquee select tool. */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number; ellipse: boolean } | null>(null);
  /** Set while a fill / pick / wand click is rendering the page, so clicks don't pile up. */
  const rasterBusy = useRef(false);

  const anns = paintOrder(edits.annotations.filter((a) => a.page === page));
  const selected = anns.find((a) => a.id === ed.selectedId) ?? null;
  const editingAnn = ed.editing ? anns.find((a) => a.id === ed.editing!.id) : undefined;
  const outline = selected ? selectionOutlines.get(selected.id) : undefined;

  const toPt = (e: { clientX: number; clientY: number }) => {
    const r = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  /** Track a drag with window listeners; deltas are in page points. */
  const drag = (
    e: React.PointerEvent,
    onMove: (dx: number, dy: number, ev: PointerEvent) => void,
    onEnd: (moved: boolean) => void,
  ) => {
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved ||= Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 2;
      onMove((ev.clientX - sx) / zoom, (ev.clientY - sy) / zoom, ev);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onEnd(moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startMove = (e: React.PointerEvent, a: Annotation) => {
    const before = edits;
    drag(
      e,
      (dx, dy) => {
        const x = clamp(a.x + dx, Math.min(0, size.w - a.w), Math.max(0, size.w - a.w));
        const y = clamp(a.y + dy, Math.min(0, size.h - a.h), Math.max(0, size.h - a.h));
        dispatch({ type: 'live', fn: (s) => updateAnn(s, a.id, { x, y }) });
      },
      () => dispatch({ type: 'commit', before }),
    );
  };

  const startResize = (e: React.PointerEvent, a: Annotation, h: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    const before = edits;
    drag(
      e,
      (dx, dy, ev) => {
        let x1 = a.x, y1 = a.y, x2 = a.x + a.w, y2 = a.y + a.h;
        if (h.includes('w')) x1 = clamp(x1 + dx, 0, size.w);
        if (h.includes('e')) x2 = clamp(x2 + dx, 0, size.w);
        if (h.includes('n')) y1 = clamp(y1 + dy, 0, size.h);
        if (h.includes('s')) y2 = clamp(y2 + dy, 0, size.h);
        // Shift on a corner keeps the original aspect ratio.
        if (ev.shiftKey && h.length === 2 && a.w > 0 && a.h > 0) {
          const s = Math.max(Math.abs(x2 - x1) / a.w, Math.abs(y2 - y1) / a.h);
          if (h.includes('w')) x1 = x2 - a.w * s; else x2 = x1 + a.w * s;
          if (h.includes('n')) y1 = y2 - a.h * s; else y2 = y1 + a.h * s;
        }
        const box = {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          w: Math.max(2, Math.abs(x2 - x1)),
          h: Math.max(2, Math.abs(y2 - y1)),
        };
        if (a.type === 'text') {
          dispatch({ type: 'live', fn: (s) => updateAnn(s, a.id, { x: box.x, w: Math.max(20, box.w) }) });
        } else {
          dispatch({ type: 'live', fn: (s) => updateAnn(s, a.id, box) });
        }
      },
      () => dispatch({ type: 'commit', before }),
    );
  };

  const makeAnn = (kind: Tool, box: { x: number; y: number; w: number; h: number }): Annotation => {
    const base = { id: newId(), page, ...box };
    switch (kind) {
      case 'redact':
        return { ...base, type: 'redact' };
      case 'text':
        return fitText({
          ...base,
          type: 'text',
          text: '',
          font: style.font,
          size: style.size,
          bold: style.bold,
          italic: style.italic,
          underline: style.underline,
          color: style.primary,
          bg: style.textOpaque ? style.secondary : null,
        });
      default:
        return {
          ...base,
          type: kind === 'ellipse' ? 'ellipse' : 'rect',
          stroke: style.primary,
          fill: style.secondary,
          fillMode: style.fillMode,
          lineWidth: style.lineWidth,
        };
    }
  };

  const startDraw = (e: React.PointerEvent) => {
    const kind = tool;
    const p0 = toPt(e);
    let box = { x: p0.x, y: p0.y, w: 0, h: 0 };
    setDraft(makeAnn(kind, box));
    drag(
      e,
      (dx, dy, ev) => {
        let x2 = clamp(p0.x + dx, 0, size.w);
        let y2 = clamp(p0.y + dy, 0, size.h);
        if (ev.shiftKey && kind !== 'text') {
          // Shift draws squares and circles, like Paint.
          const d = Math.max(Math.abs(x2 - p0.x), Math.abs(y2 - p0.y));
          x2 = clamp(p0.x + Math.sign(x2 - p0.x || 1) * d, 0, size.w);
          y2 = clamp(p0.y + Math.sign(y2 - p0.y || 1) * d, 0, size.h);
        }
        box = { x: Math.min(p0.x, x2), y: Math.min(p0.y, y2), w: Math.abs(x2 - p0.x), h: Math.abs(y2 - p0.y) };
        setDraft(makeAnn(kind, box));
      },
      () => {
        setDraft(null);
        const before = edits;
        if (kind === 'text') {
          // A click (or tiny drag) makes a default-width text box.
          if (box.w < 20) box = { ...box, w: Math.min(220, Math.max(40, size.w - box.x)) };
          const a = makeAnn('text', box);
          dispatch({ type: 'live', fn: (s) => ({ ...s, annotations: [...s.annotations, a] }) });
          ed.startEditing(a.id, before);
          return;
        }
        if (box.w < 3 || box.h < 3) return;
        const a = makeAnn(kind, box);
        dispatch({ type: 'apply', fn: (s) => ({ ...s, annotations: [...s.annotations, a] }) });
        ed.select(a.id);
      },
    );
  };

  /** Pencil (freehand), eraser and line strokes. */
  const startStroke = (e: React.PointerEvent) => {
    const kind = tool as 'pencil' | 'line' | 'eraser';
    const p0 = toPt(e);
    const pts: [number, number][] = [[p0.x, p0.y]];
    const base = kind === 'eraser'
      ? { id: newId(), page, type: kind, color: style.secondary, lineWidth: style.eraserSize }
      : { id: newId(), page, type: kind, color: style.primary, lineWidth: style.lineWidth };
    setDraft(makeStroke(base, pts));
    drag(
      e,
      (dx, dy, ev) => {
        let x = clamp(p0.x + dx, 0, size.w);
        let y = clamp(p0.y + dy, 0, size.h);
        if (kind !== 'line') {
          const [lx, ly] = pts[pts.length - 1];
          if (Math.hypot(x - lx, y - ly) < 0.75) return;
          pts.push([x, y]);
        } else {
          if (ev.shiftKey) {
            // Shift snaps lines to 45° steps, like Paint.
            const ang = Math.round(Math.atan2(y - p0.y, x - p0.x) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(x - p0.x, y - p0.y);
            x = clamp(p0.x + Math.cos(ang) * len, 0, size.w);
            y = clamp(p0.y + Math.sin(ang) * len, 0, size.h);
          }
          pts[1] = [x, y];
        }
        setDraft(makeStroke(base, pts));
      },
      () => {
        setDraft(null);
        if (kind === 'line' && (pts.length < 2 || Math.hypot(pts[1][0] - p0.x, pts[1][1] - p0.y) < 2)) return;
        const a = makeStroke(base, pts);
        dispatch({ type: 'apply', fn: (s) => ({ ...s, annotations: [...s.annotations, a] }) });
        // Lines get selected like shapes; pencil and eraser stay out of the way so you can keep going.
        if (kind === 'line') ed.select(a.id);
      },
    );
  };

  /** Run `fn` with the page's pixels at `pt`, at roughly screen resolution. */
  const withPixels = async (fn: (img: ImageData, px: number, py: number, scale: number) => void, pt: { x: number; y: number }) => {
    if (rasterBusy.current) return;
    rasterBusy.current = true;
    try {
      const scale = clamp(zoom * (window.devicePixelRatio || 1), 2, 4);
      const img = await pageImage(ed.pdf, entry, edits.annotations.filter((a) => a.page === page), scale);
      fn(img, pt.x * scale, pt.y * scale, scale);
    } finally {
      rasterBusy.current = false;
    }
  };

  const regionImage = (region: Region, src: string, scale: number): ImageAnn => ({
    id: newId(), type: 'image', page, src,
    x: region.x / scale, y: region.y / scale, w: region.w / scale, h: region.h / scale,
  });

  /** Paint bucket: recolor the object under the cursor, or flood-fill the pixels there. */
  const fillAt = (pt: { x: number; y: number }, hit: Annotation | undefined, color: string) => {
    if (hit?.type === 'ellipse') {
      // The ellipse's box is clickable but only the inside of the ellipse counts.
      const nx = (pt.x - hit.x - hit.w / 2) / (hit.w / 2);
      const ny = (pt.y - hit.y - hit.h / 2) / (hit.h / 2);
      if (nx * nx + ny * ny > 1) hit = undefined;
    }
    let patch: Partial<Annotation> | null = null;
    if (hit?.type === 'rect' || hit?.type === 'ellipse') {
      patch = hit.fillMode === 'fill' ? { stroke: color } : { fill: color, fillMode: 'outline-fill' };
    } else if (hit?.type === 'text') {
      patch = { bg: color };
    } else if (hit?.type === 'pencil' || hit?.type === 'line' || hit?.type === 'eraser') {
      patch = { color };
    } else if (hit?.type === 'redact') {
      return;
    }
    if (patch) {
      dispatch({ type: 'apply', fn: (s) => updateAnn(s, hit!.id, patch) });
      return;
    }
    withPixels((img, px, py, scale) => {
      if (pixelColor(img, px, py) === color) return;
      const region = floodRegion(img, px, py, FILL_TOLERANCE);
      if (!region) return;
      const a = regionImage(region, regionToPng(region, color), scale);
      dispatch({ type: 'apply', fn: (s) => ({ ...s, annotations: [...s.annotations, a] }) });
    }, pt);
  };

  /** Lift a region of the page into a movable picture, leaving a hole in the secondary color. */
  const liftRegion = (img: ImageData, region: Region, scale: number) => {
    const extract = regionImage(region, regionToPng(region, img), scale);
    selectionOutlines.set(extract.id, { path: regionOutline(region), w: region.w, h: region.h });
    ed.lift(regionImage(region, regionToPng(region, style.secondary), scale), extract);
  };

  /** Magic wand: lift the connected area of similar color under the cursor. */
  const wandAt = (pt: { x: number; y: number }) =>
    withPixels((img, px, py, scale) => {
      const region = floodRegion(img, px, py, WAND_TOLERANCE);
      if (region) liftRegion(img, region, scale);
    }, pt);

  /** Rectangle / ellipse select: drag out a shape, then lift the page pixels inside it. */
  const startMarquee = (e: React.PointerEvent) => {
    const ellipse = tool === 'ellipse-select';
    const p0 = toPt(e);
    let box = { x: p0.x, y: p0.y, w: 0, h: 0 };
    drag(
      e,
      (dx, dy, ev) => {
        let x2 = clamp(p0.x + dx, 0, size.w);
        let y2 = clamp(p0.y + dy, 0, size.h);
        if (ev.shiftKey) {
          const d = Math.max(Math.abs(x2 - p0.x), Math.abs(y2 - p0.y));
          x2 = clamp(p0.x + Math.sign(x2 - p0.x || 1) * d, 0, size.w);
          y2 = clamp(p0.y + Math.sign(y2 - p0.y || 1) * d, 0, size.h);
        }
        box = { x: Math.min(p0.x, x2), y: Math.min(p0.y, y2), w: Math.abs(x2 - p0.x), h: Math.abs(y2 - p0.y) };
        setMarquee({ ...box, ellipse });
      },
      () => {
        if (box.w < 3 || box.h < 3) {
          setMarquee(null);
          return;
        }
        // Keep the marquee up while the page renders, then swap it for the lifted selection.
        withPixels((img, _px, _py, scale) => {
          const region = shapeRegion(img, box, scale, ellipse);
          if (region) liftRegion(img, region, scale);
        }, box).finally(() => setMarquee(null));
      },
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Fill and pick use the secondary color on right-click, like Paint.
    const secondary = e.button === 2 && (tool === 'fill' || tool === 'picker');
    if (e.button !== 0 && !secondary) return;
    if (ed.editing) {
      // First click outside the text box just finishes editing, like Paint.
      if ((e.target as HTMLElement).tagName !== 'TEXTAREA') ed.finishEditing();
      return;
    }
    e.preventDefault();
    const hitId = (e.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id');
    const hit = hitId ? anns.find((a) => a.id === hitId) : undefined;

    if (tool === 'picker') {
      const pt = toPt(e);
      withPixels((img, px, py) => ed.pickColor(pixelColor(img, px, py), secondary), pt);
      return;
    }
    if (tool === 'fill') {
      fillAt(toPt(e), hit, secondary ? style.secondary : style.primary);
      return;
    }
    if (tool === 'wand' && !hit) {
      ed.select(null);
      wandAt(toPt(e));
      return;
    }
    if (tool === 'rect-select' || tool === 'ellipse-select') {
      ed.select(null);
      startMarquee(e);
      return;
    }
    if (tool === 'select' || tool === 'wand') {
      if (hit) {
        ed.select(hit.id);
        startMove(e, hit);
      } else {
        ed.select(null);
      }
      return;
    }
    if (tool === 'text' && hit?.type === 'text') {
      ed.select(hit.id);
      ed.startEditing(hit.id);
      return;
    }
    if (tool === 'image') {
      ed.insertImageAt(page, toPt(e));
      return;
    }
    if (tool === 'pencil' || tool === 'line' || tool === 'eraser') startStroke(e);
    else if (DRAW_TOOLS.includes(tool)) startDraw(e);
  };

  return (
    <div
      ref={layerRef}
      className={`layer tool-${tool}`}
      style={tool === 'eraser' ? { cursor: eraserCursor(style.eraserSize * zoom) } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => cursorStore.set(toPt(e))}
      onPointerLeave={() => cursorStore.set(null)}
    >
      {anns.map((a) => (
        <AnnotationView key={a.id} a={a} scale={zoom} hidden={a.id === editingAnn?.id} />
      ))}
      {draft &&
        (draft.type === 'text' ? (
          <div className="selection" style={{ left: draft.x * zoom, top: draft.y * zoom, width: draft.w * zoom, height: draft.h * zoom }} />
        ) : (
          <AnnotationView a={draft} scale={zoom} />
        ))}
      {marquee && (
        <div className={`marquee${marquee.ellipse ? ' ellipse' : ''}`} style={{ left: marquee.x * zoom, top: marquee.y * zoom, width: marquee.w * zoom, height: marquee.h * zoom }}>
          {marquee.ellipse && (
            <svg className="ants" viewBox={`0 0 ${marquee.w * zoom} ${marquee.h * zoom}`} preserveAspectRatio="none">
              <ellipse className="ants-bg" cx={(marquee.w * zoom) / 2} cy={(marquee.h * zoom) / 2} rx={(marquee.w * zoom) / 2} ry={(marquee.h * zoom) / 2} />
              <ellipse className="ants-fg" cx={(marquee.w * zoom) / 2} cy={(marquee.h * zoom) / 2} rx={(marquee.w * zoom) / 2} ry={(marquee.h * zoom) / 2} />
            </svg>
          )}
        </div>
      )}
      {selected && !editingAnn && (
        <div
          className={`selection${MOVE_TOOLS.includes(tool) ? ' movable' : ''}${outline ? ' shaped' : ''}`}
          style={{ left: selected.x * zoom, top: selected.y * zoom, width: selected.w * zoom, height: selected.h * zoom }}
          onPointerDown={(e) => {
            if (!MOVE_TOOLS.includes(tool) || e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            startMove(e, selected);
          }}
          onDoubleClick={() => selected.type === 'text' && ed.startEditing(selected.id)}
        >
          {outline && (
            <svg className="ants" viewBox={`0 0 ${outline.w} ${outline.h}`} preserveAspectRatio="none">
              <path className="ants-bg" d={outline.path} />
              <path className="ants-fg" d={outline.path} />
            </svg>
          )}
          {(selected.type === 'text' ? (['e', 'w'] as Handle[]) : ALL_HANDLES).map((h) => (
            <div
              key={h}
              className={`handle ${h}`}
              style={{
                left: h.includes('w') ? 0 : h.includes('e') ? '100%' : '50%',
                top: h.includes('n') ? 0 : h.includes('s') ? '100%' : '50%',
              }}
              onPointerDown={(e) => e.button === 0 && startResize(e, selected, h)}
            />
          ))}
        </div>
      )}
      {editingAnn?.type === 'text' && <TextEditor a={editingAnn} />}
    </div>
  );
}

function TextEditor({ a }: { a: Extract<Annotation, { type: 'text' }> }) {
  const { zoom, dispatch, finishEditing } = useEditor();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={a.text}
      spellCheck={false}
      style={{
        left: a.x * zoom,
        top: a.y * zoom,
        width: a.w * zoom,
        height: a.h * zoom,
        padding: TEXT_PAD * zoom,
        ...fontStyle(a, zoom),
        lineHeight: LINE_HEIGHT,
        color: a.color,
        background: a.bg ?? 'transparent',
        textDecoration: a.underline ? 'underline' : undefined,
      }}
      onChange={(e) => {
        const text = e.target.value;
        dispatch({ type: 'live', fn: (s: EditState) => updateAnn(s, a.id, { text }) });
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finishEditing();
      }}
      onBlur={finishEditing}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
