import { createContext, useContext } from 'react';
import type { Annotation, EditState, ImageAnn, PageEntry, Style, StrokeAnn, TextAnn, Tool } from './types';
import type { HistoryAction } from './history';
import type { PDFDocumentProxy } from './render';
import { layoutText, textHeight } from './text';

export interface TextEditSession {
  id: string;
  /** State before editing began, for a single undo step. */
  before: EditState;
}

export interface EditorApi {
  pdf: PDFDocumentProxy;
  edits: EditState;
  dispatch: (a: HistoryAction) => void;
  zoom: number;
  tool: Tool;
  setTool: (t: Tool) => void;
  style: Style;
  selectedId: string | null;
  select: (id: string | null) => void;
  editing: TextEditSession | null;
  startEditing: (id: string, before?: EditState) => void;
  finishEditing: () => void;
  currentPage: string;
  insertImageAt: (page: string, at?: { x: number; y: number }) => void;
  /** Eyedropper result: set the primary (or secondary) color and go back to the previous tool. */
  pickColor: (color: string, secondary: boolean) => void;
  /**
   * Magic wand result: add `extract` (the picked pixels) over `hole` (secondary color), and select
   * the extract so it can be moved or deleted. Both are dropped again if the extract is left untouched.
   */
  lift: (hole: ImageAnn, extract: ImageAnn) => void;
}

export const EditorContext = createContext<EditorApi | null>(null);
export const useEditor = () => useContext(EditorContext)!;

/** Pointer position in page points; kept outside React state so mouse moves don't re-render the editor. */
type Cursor = { x: number; y: number } | null;
let cursor: Cursor = null;
const cursorListeners = new Set<() => void>();
export const cursorStore = {
  get: () => cursor,
  set(c: Cursor) {
    cursor = c;
    cursorListeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    cursorListeners.add(l);
    return () => cursorListeners.delete(l);
  },
};

/**
 * Outline of a lifted pixel selection (magic wand / marquee), keyed by the extract's id: SVG path data
 * in a w x h coordinate space that's stretched over the annotation's box, so it follows moves and resizes.
 */
export const selectionOutlines = new Map<string, { path: string; w: number; h: number }>();

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Text boxes grow vertically to fit their content. */
export function fitText<T extends Annotation>(a: T): T {
  if (a.type !== 'text') return a;
  const t = a as TextAnn;
  return { ...t, h: textHeight(t, layoutText(t).length) } as T;
}

export function updateAnn(s: EditState, id: string, patch: Partial<Annotation>): EditState {
  return {
    ...s,
    annotations: s.annotations.map((a) => (a.id === id ? fitText({ ...a, ...patch } as Annotation) : a)),
  };
}

/**
 * Build a stroke from page-space points. The box is padded by half the line width
 * so even a perfectly straight line has a selectable, non-zero-size box.
 */
export function makeStroke(
  base: Pick<StrokeAnn, 'id' | 'page' | 'type' | 'color' | 'lineWidth'>,
  pts: [number, number][],
): StrokeAnn {
  const pad = base.lineWidth / 2 + 1;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const w = Math.max(...xs) + pad - x;
  const h = Math.max(...ys) + pad - y;
  return { ...base, x, y, w, h, points: pts.flatMap(([px, py]) => [(px - x) / w, (py - y) / h]) };
}

/** Original PDF pages get stable ids so stored edits keep pointing at them. */
export const srcPageId = (src: number) => `p${src}`;

/**
 * Bring stored edits up to the current shape. Older versions stored pages as
 * plain indices into the PDF and keyed annotations by that index.
 */
export function migrateEdits(raw: unknown, original: PageEntry[]): EditState | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as { pages?: unknown[]; annotations?: Annotation[] };
  if (!Array.isArray(e.pages) || !Array.isArray(e.annotations) || !e.pages.length) return null;
  if (typeof e.pages[0] === 'number') {
    const idx = e.pages as number[];
    if (idx.some((i) => !original[i])) return null;
    return {
      pages: idx.map((i) => original[i]),
      annotations: e.annotations.map((a) => ({ ...a, page: srcPageId(a.page as unknown as number) })),
    };
  }
  const pages = e.pages as PageEntry[];
  if (pages.some((p) => p.src !== null && !original[p.src])) return null;
  return { pages, annotations: e.annotations };
}

export function removeAnn(s: EditState, id: string): EditState {
  return { ...s, annotations: s.annotations.filter((a) => a.id !== id) };
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

/**
 * Load an image file into a data URL that pdf-lib can embed (PNG or JPEG).
 * BMP and anything else the browser can decode gets converted to PNG.
 */
export async function imageFileToDataUrl(file: Blob): Promise<{ src: string; w: number; h: number }> {
  let src = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not decode image'));
    i.src = src;
  });
  if (!/^data:image\/(png|jpeg)/.test(src)) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    src = c.toDataURL('image/png');
  }
  return { src, w: img.naturalWidth, h: img.naturalHeight };
}

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/bmp,.bmp,.jpg,.jpeg,.png';
