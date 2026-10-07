import { useEffect, useRef, useState } from 'react';
import type { Annotation, EditState, PageEntry, Tool } from '../types';
import { cursorStore, fitText, makeStroke, newId, updateAnn, useEditor } from '../editor';
import { renderPage } from '../render';
import { LINE_HEIGHT, TEXT_PAD, fontStyle } from '../text';
import { paintOrder } from '../draw';
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
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function AnnotationLayer({ entry }: { entry: PageEntry }) {
  const page = entry.id;
  const size = entry;
  const ed = useEditor();
  const { zoom, tool, style, edits, dispatch } = ed;
  const layerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);

  const anns = paintOrder(edits.annotations.filter((a) => a.page === page));
  const selected = anns.find((a) => a.id === ed.selectedId) ?? null;
  const editingAnn = ed.editing ? anns.find((a) => a.id === ed.editing!.id) : undefined;

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

  /** Pencil (freehand) and line strokes. */
  const startStroke = (e: React.PointerEvent) => {
    const kind = tool as 'pencil' | 'line';
    const p0 = toPt(e);
    const pts: [number, number][] = [[p0.x, p0.y]];
    const base = { id: newId(), page, type: kind, color: style.primary, lineWidth: style.lineWidth };
    setDraft(makeStroke(base, pts));
    drag(
      e,
      (dx, dy, ev) => {
        let x = clamp(p0.x + dx, 0, size.w);
        let y = clamp(p0.y + dy, 0, size.h);
        if (kind === 'pencil') {
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
        // Lines get selected like shapes; pencil stays out of the way so you can keep sketching.
        if (kind === 'line') ed.select(a.id);
      },
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (ed.editing) {
      // First click outside the text box just finishes editing, like Paint.
      if ((e.target as HTMLElement).tagName !== 'TEXTAREA') ed.finishEditing();
      return;
    }
    e.preventDefault();
    const hitId = (e.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id');
    const hit = hitId ? anns.find((a) => a.id === hitId) : undefined;

    if (tool === 'select') {
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
    if (tool === 'pencil' || tool === 'line') startStroke(e);
    else if (DRAW_TOOLS.includes(tool)) startDraw(e);
  };

  return (
    <div
      ref={layerRef}
      className={`layer tool-${tool}`}
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
      {selected && !editingAnn && (
        <div
          className={`selection${tool === 'select' ? ' movable' : ''}`}
          style={{ left: selected.x * zoom, top: selected.y * zoom, width: selected.w * zoom, height: selected.h * zoom }}
          onPointerDown={(e) => {
            if (tool !== 'select' || e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            startMove(e, selected);
          }}
          onDoubleClick={() => selected.type === 'text' && ed.startEditing(selected.id)}
        >
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
