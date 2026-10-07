import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { Annotation, EditState, PageEntry, Style, Tool } from './types';
import { historyReducer } from './history';
import type { PDFDocumentProxy } from './render';
import { clearStored, loadStoredDoc, loadStoredEdits, storeDoc, storeEdits } from './persist';
import {
  EditorContext, IMAGE_ACCEPT, cursorStore, fitText, imageFileToDataUrl, migrateEdits, newId, removeAnn, srcPageId, updateAnn,
  type EditorApi, type TextEditSession,
} from './editor';
import { MenuBar, type Menu } from './components/MenuBar';
import { ToolBox } from './components/ToolBox';
import { ColorBox } from './components/ColorBox';
import { FontBar } from './components/FontBar';
import { Thumbnails, type PageActions } from './components/Thumbnails';
import { PageView } from './components/PageView';
import { Dialog } from './components/Dialog';

interface LoadedDoc {
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  transforms: number[][];
  destroy: () => void;
}

const DEFAULT_STYLE: Style = {
  primary: '#000000',
  secondary: '#ffffff',
  fillMode: 'outline',
  lineWidth: 2,
  font: 'Arial',
  size: 14,
  bold: false,
  italic: false,
  underline: false,
  textOpaque: false,
};

const EMPTY: EditState = { annotations: [], pages: [] };
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const TOOL_KEYS: Record<string, Tool> = { s: 'select', r: 'redact', p: 'pencil', l: 'line', b: 'rect', e: 'ellipse', t: 'text', i: 'image' };
const TOOL_HINTS: Record<Tool, string> = {
  select: 'Click an object to select it. Drag to move, drag handles to resize (Shift keeps proportions).',
  redact: 'Drag to draw a black redaction box. Saving can remove the text underneath for good.',
  pencil: 'Drag to draw freehand. Pick a thickness in the tool box.',
  line: 'Drag to draw a straight line. Shift snaps to 45°.',
  rect: 'Drag to draw a rectangle. Shift draws a square.',
  ellipse: 'Drag to draw an ellipse. Shift draws a circle.',
  text: 'Click or drag to make a text box, then type. Click a text box to edit it.',
  image: 'Click the page to insert a JPG, PNG or BMP picture. You can also drop or paste one.',
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

export default function App() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: EMPTY, future: [] });
  const edits = history.present;
  const [tool, setTool] = useState<Tool>('select');
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TextEditSession | null>(null);
  const [zoom, setZoom] = useState(1);
  const [currentPageRaw, setCurrentPage] = useState('');
  // Fall back to the first page if the current one was deleted (e.g. by undo).
  const currentPage = edits.pages.some((p) => p.id === currentPageRaw) ? currentPageRaw : (edits.pages[0]?.id ?? '');
  const [dialog, setDialog] = useState<'save' | 'about' | { error: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageTarget = useRef<{ page: string; at?: { x: number; y: number } }>({ page: '' });
  const clipboard = useRef<Annotation | null>(null);
  const [pageClipboard, setPageClipboard] = useState<{ entry: PageEntry; anns: Annotation[] } | null>(null);
  const sidebarHasFocus = () => !!document.activeElement?.closest('.sidebar');
  // Refs so event handlers always see the latest values.
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const editingRef = useRef(editing);
  const selected = edits.annotations.find((a) => a.id === selectedId) ?? null;

  // ---------- Loading & persistence ----------

  const loadBytes = useCallback(async (name: string, bytes: Uint8Array, restored?: EditState) => {
    const { openPdf } = await import('./pdf');
    const { doc: pdf, sizes, transforms, destroy } = await openPdf(bytes);
    doc?.destroy();
    const pages: PageEntry[] = sizes.map((s, i) => ({ id: srcPageId(i), src: i, ...s }));
    const valid = migrateEdits(restored, pages);
    dispatch({ type: 'reset', present: valid ?? { annotations: [], pages } });
    setPageClipboard(null);
    setSelectedId(null);
    setEditing(null);
    editingRef.current = null;
    setCurrentPage((valid?.pages ?? pages)[0]?.id ?? '');
    setDoc({ name, bytes, pdf, transforms, destroy });
    // Fit page width (capped at 150%) once the workspace is laid out.
    requestAnimationFrame(() => {
      const ws = workspaceRef.current;
      ws?.scrollTo(0, 0);
      const maxW = Math.max(...sizes.map((s) => s.w));
      if (ws) setZoom(Math.min(1.5, Math.max(0.25, (ws.clientWidth - 56) / maxW)));
    });
  }, [doc]);

  useEffect(() => {
    // Warm up the lazily loaded PDF libraries so opening and saving don't wait on a download.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1));
    idle(() => {
      import('./pdf').catch(() => {});
      import('./export').catch(() => {});
    });
    (async () => {
      try {
        const stored = await loadStoredDoc();
        if (stored) await loadBytes(stored.name, stored.bytes, await loadStoredEdits());
      } catch {
        await clearStored();
      } finally {
        setRestoring(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave edits to IndexedDB.
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => storeEdits(edits).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [edits, doc]);

  const openFile = async (file: File) => {
    setBusy('Opening…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await loadBytes(file.name, bytes);
      await storeDoc({ name: file.name, bytes }).catch(() => {});
      await storeEdits({ annotations: [], pages: [] }).catch(() => {});
    } catch (e) {
      setDialog({ error: `Could not open "${file.name}". ${e instanceof Error ? e.message : ''}` });
    } finally {
      setBusy(null);
    }
  };

  const closeDoc = async () => {
    doc?.destroy();
    setDoc(null);
    dispatch({ type: 'reset', present: EMPTY });
    setSelectedId(null);
    await clearStored();
  };

  // ---------- Selection, style & text editing ----------

  const styleFrom = (a: Annotation): Partial<Style> => {
    if (a.type === 'rect' || a.type === 'ellipse') {
      return { primary: a.stroke, secondary: a.fill, fillMode: a.fillMode, lineWidth: a.lineWidth };
    }
    if (a.type === 'pencil' || a.type === 'line') return { primary: a.color, lineWidth: a.lineWidth };
    if (a.type === 'text') {
      return {
        primary: a.color, font: a.font, size: a.size, bold: a.bold, italic: a.italic, underline: a.underline,
        textOpaque: a.bg !== null, ...(a.bg ? { secondary: a.bg } : {}),
      };
    }
    return {};
  };

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    const a = id && editsRef.current.annotations.find((x) => x.id === id);
    if (a) setStyle((s) => ({ ...s, ...styleFrom(a) }));
  }, []);

  const startEditing = useCallback((id: string, before?: EditState) => {
    const session = { id, before: before ?? editsRef.current };
    editingRef.current = session;
    setEditing(session);
    select(id);
  }, [select]);

  const finishEditing = useCallback(() => {
    const s = editingRef.current;
    if (!s) return;
    editingRef.current = null;
    setEditing(null);
    const a = editsRef.current.annotations.find((x) => x.id === s.id);
    if (a?.type === 'text' && !a.text.trim()) {
      setSelectedId(null);
      if (!s.before.annotations.some((x) => x.id === s.id)) {
        // A brand-new box that never got text: drop it without an undo step.
        dispatch({ type: 'live', fn: () => s.before });
        return;
      }
      dispatch({ type: 'live', fn: (st) => removeAnn(st, s.id) });
    }
    dispatch({ type: 'commit', before: s.before });
  }, []);

  const updateStyle = (patch: Partial<Style>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    if (!selected) return;
    let p: Partial<Annotation> | null = null;
    if (selected.type === 'rect' || selected.type === 'ellipse') {
      p = { stroke: next.primary, fill: next.secondary, fillMode: next.fillMode, lineWidth: next.lineWidth };
    } else if (selected.type === 'pencil' || selected.type === 'line') {
      p = { color: next.primary, lineWidth: next.lineWidth };
    } else if (selected.type === 'text') {
      p = {
        color: next.primary, font: next.font, size: next.size, bold: next.bold, italic: next.italic,
        underline: next.underline, bg: next.textOpaque ? next.secondary : null,
      };
    }
    if (p) {
      const fn = (s: EditState) => updateAnn(s, selected.id, p);
      dispatch(editingRef.current ? { type: 'live', fn } : { type: 'apply', fn });
    }
  };

  const changeTool = (t: Tool) => {
    finishEditing();
    setTool(t);
    // A new tool starts fresh, so palette/option clicks don't restyle the last object drawn.
    if (t !== tool && t !== 'select') setSelectedId(null);
    if (t === 'image') pickImage(currentPage);
  };

  // ---------- Images ----------

  const pickImage = (page: string, at?: { x: number; y: number }) => {
    imageTarget.current = { page, at };
    imageInput.current!.value = '';
    imageInput.current!.click();
  };

  const pageEntry = (id: string) => editsRef.current.pages.find((p) => p.id === id);

  const insertImageFile = async (file: Blob, page: string, at?: { x: number; y: number }) => {
    const size = pageEntry(page);
    if (!doc || !size) return;
    try {
      const img = await imageFileToDataUrl(file);
      // Treat pixels as 96 DPI, then shrink to fit within 60% of the page.
      let w = img.w * 0.75;
      let h = img.h * 0.75;
      const k = Math.min(1, (size.w * 0.6) / w, (size.h * 0.6) / h);
      w *= k;
      h *= k;
      const cx = at?.x ?? size.w / 2;
      const cy = at?.y ?? size.h / 2;
      const a: Annotation = {
        id: newId(), type: 'image', page, src: img.src, w, h,
        x: Math.min(Math.max(0, cx - w / 2), size.w - w),
        y: Math.min(Math.max(0, cy - h / 2), size.h - h),
      };
      dispatch({ type: 'apply', fn: (s) => ({ ...s, annotations: [...s.annotations, a] }) });
      setSelectedId(a.id);
      setTool('select');
    } catch {
      setDialog({ error: 'That picture could not be read. Use a JPG, PNG or BMP file.' });
    }
  };

  // ---------- Edit operations ----------

  const deleteSelected = () => {
    if (!selected) return;
    dispatch({ type: 'apply', fn: (s) => removeAnn(s, selected.id) });
    setSelectedId(null);
  };

  const pasteAnn = (src: Annotation, page = currentPage) => {
    const size = pageEntry(page);
    if (!doc || !size) return;
    const off = src.page === page ? 12 : 0;
    const a = fitText({
      ...src, id: newId(), page,
      x: Math.min(src.x + off, Math.max(0, size.w - src.w)),
      y: Math.min(src.y + off, Math.max(0, size.h - src.h)),
    });
    dispatch({ type: 'apply', fn: (s) => ({ ...s, annotations: [...s.annotations, a] }) });
    setSelectedId(a.id);
    clipboard.current = a;
  };

  const undo = () => {
    finishEditing();
    dispatch({ type: 'undo' });
  };
  const redo = () => {
    finishEditing();
    dispatch({ type: 'redo' });
  };

  // ---------- Pages ----------

  const gotoPage = (p: string) => {
    setCurrentPage(p);
    workspaceRef.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView({ block: 'start' });
  };

  const movePage = (p: string, delta: number) => {
    dispatch({
      type: 'apply',
      fn: (s) => {
        const i = s.pages.findIndex((x) => x.id === p);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= s.pages.length) return s;
        const pages = [...s.pages];
        [pages[i], pages[j]] = [pages[j], pages[i]];
        return { ...s, pages };
      },
    });
    requestAnimationFrame(() => gotoPage(p));
  };

  const reorderPage = (p: string, toIndex: number) => {
    dispatch({
      type: 'apply',
      fn: (s) => {
        const from = s.pages.findIndex((x) => x.id === p);
        if (from < 0) return s;
        const pages = s.pages.filter((x) => x.id !== p);
        pages.splice(toIndex > from ? toIndex - 1 : toIndex, 0, s.pages[from]);
        return pages.every((x, i) => x === s.pages[i]) ? s : { ...s, pages };
      },
    });
  };

  const deletePage = (p: string) => {
    const pages = editsRef.current.pages;
    const i = pages.findIndex((x) => x.id === p);
    if (pages.length <= 1 || i < 0) return;
    finishEditing();
    if (selected?.page === p) setSelectedId(null);
    dispatch({
      type: 'apply',
      fn: (s) => ({
        pages: s.pages.filter((x) => x.id !== p),
        annotations: s.annotations.filter((a) => a.page !== p),
      }),
    });
    setCurrentPage((pages[i + 1] ?? pages[i - 1]).id);
  };

  /** Insert a page (with its annotations) after `afterId`, or at the start when null. */
  const insertPage = (entry: PageEntry, anns: Annotation[], afterId: string | null) => {
    finishEditing();
    const id = newId();
    const copy = { ...entry, id };
    const newAnns = anns.map((a) => ({ ...a, id: newId(), page: id }));
    dispatch({
      type: 'apply',
      fn: (s) => {
        const pages = [...s.pages];
        pages.splice(afterId === null ? 0 : pages.findIndex((x) => x.id === afterId) + 1, 0, copy);
        return { pages, annotations: [...s.annotations, ...newAnns] };
      },
    });
    setCurrentPage(id);
    requestAnimationFrame(() => {
      workspaceRef.current?.querySelector(`[data-page="${id}"]`)?.scrollIntoView({ block: 'start' });
      document.querySelector(`.thumb.active`)?.scrollIntoView({ block: 'nearest' });
    });
  };

  const copyPage = (p: string) => {
    const entry = pageEntry(p);
    if (entry) setPageClipboard({ entry, anns: editsRef.current.annotations.filter((a) => a.page === p) });
  };

  const pageActions: PageActions = {
    goto: gotoPage,
    move: movePage,
    reorder: reorderPage,
    remove: deletePage,
    copy: copyPage,
    cut: (p) => {
      if (editsRef.current.pages.length <= 1) return;
      copyPage(p);
      deletePage(p);
    },
    paste: (after) => pageClipboard && insertPage(pageClipboard.entry, pageClipboard.anns, after),
    insertBlank: (after) => {
      // New pages match the size of the page they follow.
      const like = (after && pageEntry(after)) || editsRef.current.pages[0];
      insertPage({ id: '', src: null, w: like?.w ?? 612, h: like?.h ?? 792 }, [], after);
    },
    canPaste: !!pageClipboard,
  };

  const onScroll = () => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const line = ws.scrollTop + ws.clientHeight * 0.3;
    let cur = edits.pages[0]?.id;
    for (const el of ws.querySelectorAll<HTMLElement>('[data-page]')) {
      if (el.offsetTop <= line) cur = el.dataset.page!;
      else break;
    }
    if (cur && cur !== currentPage) setCurrentPage(cur);
  };

  // ---------- Zoom ----------

  const applyZoom = (z: number) => {
    const ws = workspaceRef.current;
    const ratio = ws ? ws.scrollTop / Math.max(1, ws.scrollHeight) : 0;
    setZoom(Math.min(4, Math.max(0.25, z)));
    requestAnimationFrame(() => {
      if (ws) ws.scrollTop = ratio * ws.scrollHeight;
    });
  };
  const zoomStep = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((z) => z > zoom + 0.001) : [...ZOOMS].reverse().find((z) => z < zoom - 0.001);
    applyZoom(next ?? zoom);
  };
  const fitWidth = () => {
    const ws = workspaceRef.current;
    if (!ws || !doc) return;
    applyZoom((ws.clientWidth - 56) / Math.max(...edits.pages.map((p) => p.w)));
  };

  // ---------- Save ----------

  const save = async (fileName: string, flattenRedacted: boolean) => {
    if (!doc) return;
    finishEditing();
    setDialog(null);
    setBusy('Saving…');
    try {
      const { exportPdf } = await import('./export');
      const bytes = await exportPdf(doc.bytes, doc.pdf, doc.transforms, editsRef.current, { flattenRedacted });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setDialog({ error: `Saving failed. ${e instanceof Error ? e.message : ''}` });
    } finally {
      setBusy(null);
    }
  };

  // ---------- Keyboard, clipboard, drag & drop ----------

  const handlers = useRef({ onKey: (_: KeyboardEvent) => {}, onPaste: (_: ClipboardEvent) => {} });
  handlers.current.onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'o') {
      e.preventDefault();
      pdfInput.current?.click();
      return;
    }
    if (!doc || isTyping(e.target) || dialog) return;
    if (sidebarHasFocus()) {
      // Clipboard and Delete act on pages while the page list has focus.
      if (mod && k === 'c') { e.preventDefault(); pageActions.copy(currentPage); return; }
      if (mod && k === 'x') { e.preventDefault(); pageActions.cut(currentPage); return; }
      if (mod && k === 'v') { e.preventDefault(); pageActions.paste(currentPage); return; }
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); deletePage(currentPage); return; }
      if (k === 'arrowup' || k === 'arrowdown') {
        e.preventDefault();
        const next = edits.pages[pageIdx + (k === 'arrowup' ? -1 : 1)];
        if (next) {
          gotoPage(next.id);
          requestAnimationFrame(() => document.querySelector('.thumb.active')?.scrollIntoView({ block: 'nearest' }));
        }
        return;
      }
    }
    if (mod && k === 's') { e.preventDefault(); setDialog('save'); }
    else if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && (k === 'c' || k === 'x') && selected) {
      clipboard.current = selected;
      if (k === 'x') deleteSelected();
    }
    else if (mod && k === 'd' && selected) { e.preventDefault(); pasteAnn({ ...selected, page: selected.page }, selected.page); }
    else if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomStep(1); }
    else if (mod && k === '-') { e.preventDefault(); zoomStep(-1); }
    else if (mod && k === '0') { e.preventDefault(); applyZoom(1); }
    else if ((k === 'delete' || k === 'backspace') && selected) { e.preventDefault(); deleteSelected(); }
    else if (k === 'escape') setSelectedId(null);
    else if (k === 'enter' && selected?.type === 'text') { e.preventDefault(); startEditing(selected.id); }
    else if (k.startsWith('arrow') && selected) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0;
      const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
      dispatch({ type: 'apply', fn: (s) => updateAnn(s, selected.id, { x: selected.x + dx, y: selected.y + dy }) });
    }
    else if (!mod && !e.altKey && TOOL_KEYS[k]) changeTool(TOOL_KEYS[k]);
  };
  handlers.current.onPaste = (e) => {
    if (!doc || isTyping(e.target) || editingRef.current) return;
    if (sidebarHasFocus()) return; // handled as a page paste on keydown
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      insertImageFile(file, currentPage);
    } else if (clipboard.current) {
      e.preventDefault();
      pasteAnn(clipboard.current);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handlers.current.onKey(e);
    const onPaste = (e: ClipboardEvent) => handlers.current.onPaste(e);
    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      openFile(file);
    } else if (doc && (file.type.startsWith('image/') || /\.(bmp|png|jpe?g)$/i.test(file.name))) {
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
      if (pageEl) {
        const r = pageEl.getBoundingClientRect();
        insertImageFile(file, pageEl.dataset.page!, { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom });
      } else {
        insertImageFile(file, currentPage);
      }
    }
  };

  // ---------- Menus ----------

  const pageIdx = edits.pages.findIndex((p) => p.id === currentPage);
  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Open…', shortcut: 'Ctrl+O', onClick: () => pdfInput.current?.click() },
        { label: 'Save as PDF…', shortcut: 'Ctrl+S', disabled: !doc, onClick: () => setDialog('save') },
        'sep',
        { label: 'Close Document', disabled: !doc, onClick: closeDoc },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !history.past.length, onClick: undo },
        { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !history.future.length, onClick: redo },
        'sep',
        { label: 'Cut', shortcut: 'Ctrl+X', disabled: !selected, onClick: () => { clipboard.current = selected; deleteSelected(); } },
        { label: 'Copy', shortcut: 'Ctrl+C', disabled: !selected, onClick: () => { clipboard.current = selected; } },
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: !doc || !clipboard.current, onClick: () => clipboard.current && pasteAnn(clipboard.current) },
        { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !selected, onClick: () => selected && pasteAnn(selected, selected.page) },
        { label: 'Clear Selection', shortcut: 'Del', disabled: !selected, onClick: deleteSelected },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', shortcut: 'Ctrl++', disabled: !doc, onClick: () => zoomStep(1) },
        { label: 'Zoom Out', shortcut: 'Ctrl+-', disabled: !doc, onClick: () => zoomStep(-1) },
        { label: 'Actual Size', shortcut: 'Ctrl+0', disabled: !doc, onClick: () => applyZoom(1) },
        { label: 'Fit Width', disabled: !doc, onClick: fitWidth },
      ],
    },
    {
      label: 'Image',
      items: [
        { label: 'Insert Picture…', disabled: !doc, onClick: () => pickImage(currentPage) },
        'sep',
        { label: 'Bring to Front', disabled: !selected, onClick: () => selected && dispatch({ type: 'apply', fn: (s) => ({ ...s, annotations: [...removeAnn(s, selected.id).annotations, selected] }) }) },
        { label: 'Send to Back', disabled: !selected, onClick: () => selected && dispatch({ type: 'apply', fn: (s) => ({ ...s, annotations: [selected, ...removeAnn(s, selected.id).annotations] }) }) },
      ],
    },
    {
      label: 'Page',
      items: [
        { label: 'New Blank Page', disabled: !doc, onClick: () => pageActions.insertBlank(currentPage) },
        'sep',
        { label: 'Cut Page', disabled: !doc || edits.pages.length <= 1, onClick: () => pageActions.cut(currentPage) },
        { label: 'Copy Page', disabled: !doc, onClick: () => pageActions.copy(currentPage) },
        { label: 'Paste Page After', disabled: !doc || !pageClipboard, onClick: () => pageActions.paste(currentPage) },
        'sep',
        { label: 'Move Page Up', disabled: !doc || pageIdx <= 0, onClick: () => movePage(currentPage, -1) },
        { label: 'Move Page Down', disabled: !doc || pageIdx >= edits.pages.length - 1, onClick: () => movePage(currentPage, 1) },
        'sep',
        { label: 'Delete Page', disabled: !doc || edits.pages.length <= 1, onClick: () => deletePage(currentPage) },
      ],
    },
    { label: 'Help', items: [{ label: 'About PDF Paint', onClick: () => setDialog('about') }] },
  ];

  const api: EditorApi | null = useMemo(
    () =>
      doc && {
        pdf: doc.pdf, edits, dispatch, zoom, tool, setTool, style, selectedId, select,
        editing, startEditing, finishEditing, currentPage, insertImageAt: pickImage,
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, edits, zoom, tool, style, selectedId, editing, currentPage],
  );

  const showFontBar = doc && (tool === 'text' || selected?.type === 'text');

  return (
    <div
      className={`window${busy ? ' busy' : ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => e.relatedTarget === null && setDragOver(false)}
      onDrop={onDrop}
      onContextMenu={(e) => !isTyping(e.target) && e.preventDefault()}
    >
      <div className="title-bar">
        <PaintIcon />
        <span className="title">{doc ? doc.name : 'untitled'} - PDF Paint</span>
        <span className="controls">
          <span>_</span>
          <span>□</span>
          <span style={{ marginLeft: 2, fontWeight: 'bold' }} onClick={doc ? closeDoc : undefined}>✕</span>
        </span>
      </div>
      <MenuBar menus={menus} />

      {doc && api ? (
        <EditorContext.Provider value={api}>
          <div className="body">
            <Thumbnails actions={pageActions} />
            <ToolBox tool={tool} style={style} onTool={changeTool} onStyle={updateStyle} />
            <div className="main">
              {showFontBar && <FontBar style={style} onStyle={updateStyle} />}
              <div
                className="workspace"
                ref={workspaceRef}
                onScroll={onScroll}
                // Clicking the document hands keyboard shortcuts back to the drawing objects.
                onPointerDownCapture={() => sidebarHasFocus() && (document.activeElement as HTMLElement).blur()}
              >
                <div className="pages">
                  {edits.pages.map((p) => (
                    <PageView key={p.id} entry={p} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <ColorBox
            primary={style.primary}
            secondary={style.secondary}
            onPrimary={(c) => updateStyle({ primary: c })}
            onSecondary={(c) => updateStyle({ secondary: c })}
          />
        </EditorContext.Provider>
      ) : (
        <div className="body">
          <div className="workspace welcome" ref={workspaceRef}>
            {!restoring && <Welcome onOpen={() => pdfInput.current?.click()} />}
          </div>
        </div>
      )}

      <div className="statusbar">
        <div>{busy ?? (doc ? TOOL_HINTS[tool] : 'Open a PDF to get started. Your file never leaves this browser.')}</div>
        <CursorStatus />
        <div>{selected ? `${Math.round(selected.w)} × ${Math.round(selected.h)} pt` : ''}</div>
        <div>{doc ? `Page ${pageIdx + 1} of ${edits.pages.length} · ${Math.round(zoom * 100)}%` : ''}</div>
      </div>

      <input
        ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) openFile(f);
        }}
      />
      <input
        ref={imageInput} type="file" accept={IMAGE_ACCEPT} hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) insertImageFile(f, imageTarget.current.page, imageTarget.current.at);
          else if (tool === 'image') setTool('select');
        }}
      />

      {dialog === 'save' && doc && (
        <SaveDialog
          defaultName={doc.name.replace(/\.pdf$/i, '') + '-edited.pdf'}
          hasRedactions={edits.annotations.some((a) => a.type === 'redact' && edits.pages.some((p) => p.id === a.page))}
          onSave={save}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'about' && (
        <Dialog title="About PDF Paint" onClose={() => setDialog(null)}>
          <p><b>PDF Paint</b> — a Windows 98 Paint-style PDF editor.</p>
          <p>Your PDF is opened and stored only in this browser (IndexedDB). Nothing is uploaded.</p>
          <div className="buttons"><button className="btn" onClick={() => setDialog(null)}>OK</button></div>
        </Dialog>
      )}
      {dialog && typeof dialog === 'object' && (
        <Dialog title="PDF Paint" onClose={() => setDialog(null)}>
          <p>{dialog.error}</p>
          <div className="buttons"><button className="btn" autoFocus onClick={() => setDialog(null)}>OK</button></div>
        </Dialog>
      )}
      {dragOver && <div className="big-drop">Drop a PDF to open it, or a picture to insert it</div>}
    </div>
  );
}

function CursorStatus() {
  const c = useSyncExternalStore(cursorStore.subscribe, cursorStore.get);
  return <div>{c ? `${Math.round(c.x)}, ${Math.round(c.y)} pt` : ''}</div>;
}

function Welcome({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="dialog">
      <div className="title-bar"><span className="title">Open a PDF</span></div>
      <div className="content">
        <div className="dropzone">
          <b>Drag a PDF file here</b>
          <br />or
        </div>
        <div className="buttons" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={onOpen}>Open…</button>
        </div>
        <p style={{ color: '#333' }}>
          The file stays on your computer: it's loaded in the browser and kept in local browser storage so your
          work survives a refresh.
        </p>
      </div>
    </div>
  );
}

function SaveDialog({ defaultName, hasRedactions, onSave, onClose }: {
  defaultName: string;
  hasRedactions: boolean;
  onSave: (name: string, flatten: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [flatten, setFlatten] = useState(true);
  return (
    <Dialog title="Save As" onClose={onClose}>
      <form
        style={{ display: 'contents' }}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name.trim() || defaultName, hasRedactions && flatten);
        }}
      >
        <div className="field">
          <label htmlFor="fname">File name:</label>
          <input id="fname" type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {hasRedactions && (
          <label className="check">
            <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
            <span>
              Permanently remove content under redactions.
              <br />
              <span style={{ color: '#444' }}>
                Pages with redactions are flattened to images, so the hidden text can't be copied or recovered.
                Without this, the black boxes only cover the content.
              </span>
            </span>
          </label>
        )}
        <div className="buttons">
          <button className="btn" type="submit">Save</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

const PaintIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" style={{ shapeRendering: 'crispEdges', flex: 'none' }}>
    <rect x="1" y="1" width="11" height="14" fill="#fff" stroke="#000" />
    <rect x="3" y="4" width="7" height="1" fill="#000" />
    <rect x="3" y="7" width="7" height="1" fill="#000" />
    <rect x="3" y="10" width="5" height="1" fill="#000" />
    <path d="M9 13 L14 4 L15.5 5 L10.5 14 Z" fill="#ff0" stroke="#000" strokeWidth="0.7" />
  </svg>
);
