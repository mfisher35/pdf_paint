import { Fragment, useEffect, useRef, useState } from 'react';
import type { PageEntry } from '../types';
import { useEditor } from '../editor';
import { paintOrder } from '../draw';
import { AnnotationView } from './AnnotationView';
import { PageCanvas, useNearViewport } from './PageView';

const THUMB_W = 120;

export interface PageActions {
  goto: (id: string) => void;
  move: (id: string, delta: number) => void;
  reorder: (id: string, toIndex: number) => void;
  insertBlank: (afterId: string | null) => void;
  insertPdf: (afterId: string | null) => void;
  /** Ask whether to add a blank page or insert a PDF after `afterId` (at the start when null). */
  add: (afterId: string | null) => void;
  cut: (id: string) => void;
  copy: (id: string) => void;
  paste: (afterId: string | null) => void;
  remove: (id: string) => void;
  canPaste: boolean;
  /** The gap between thumbnails picked as an insertion point (index of the page after it), or null. */
  gap: number | null;
  setGap: (gap: number | null) => void;
  /** Where a paste or added page goes: after this page id, or at the start when null. */
  target: () => string | null;
}

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" style={{ shapeRendering: 'crispEdges' }}>{children}</svg>
);
const ICONS = {
  add: <Icon><path d="M5 1h2v4h4v2H7v4H5V7H1V5h4z" fill="#000" /></Icon>,
  cut: (
    <Icon>
      <path d="M3 0l3 6M9 0L6 6" stroke="#000" fill="none" />
      <circle cx="3" cy="9" r="2" fill="none" stroke="#000" style={{ shapeRendering: 'auto' }} />
      <circle cx="9" cy="9" r="2" fill="none" stroke="#000" style={{ shapeRendering: 'auto' }} />
    </Icon>
  ),
  copy: (
    <Icon>
      <rect x="0.5" y="0.5" width="6" height="8" fill="#fff" stroke="#000" />
      <rect x="4.5" y="3.5" width="6" height="8" fill="#fff" stroke="#000" />
    </Icon>
  ),
  paste: (
    <Icon>
      <rect x="0.5" y="1.5" width="8" height="10" fill="#c08040" stroke="#000" />
      <rect x="2.5" y="0.5" width="4" height="2" fill="#c0c0c0" stroke="#000" />
      <rect x="4.5" y="4.5" width="7" height="7" fill="#fff" stroke="#000" />
    </Icon>
  ),
  remove: <Icon><path d="M2 2l8 8M10 2l-8 8" stroke="#000" strokeWidth="2" style={{ shapeRendering: 'auto' }} /></Icon>,
};

export function Thumbnails({ actions }: { actions: PageActions }) {
  const { edits, currentPage } = useEditor();
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const dragging = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const idx = edits.pages.findIndex((p) => p.id === currentPage);
  const single = edits.pages.length <= 1;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const focusList = () => listRef.current?.focus({ preventScroll: true });

  const gapSet = actions.gap !== null;
  const buttons: [keyof typeof ICONS, string, boolean, () => void][] = [
    ['add', gapSet ? 'Add a page at the marked spot' : 'Add a page after this one', false, () => actions.add(actions.target())],
    ['cut', 'Cut page (Ctrl+X)', single, () => actions.cut(currentPage)],
    ['copy', 'Copy page (Ctrl+C)', false, () => actions.copy(currentPage)],
    ['paste', gapSet ? 'Paste page at the marked spot (Ctrl+V)' : 'Paste page after this one (Ctrl+V)', !actions.canPaste, () => actions.paste(actions.target())],
    ['remove', 'Delete page (Del)', single, () => actions.remove(currentPage)],
  ];

  return (
    <div className="sidebar">
      <div className="panel-title">
        <span>Pages ({edits.pages.length})</span>
        <span className="mini">
          <button title="Move page up" disabled={idx <= 0} onClick={() => actions.move(currentPage, -1)}>▲</button>
          <button title="Move page down" disabled={idx < 0 || idx >= edits.pages.length - 1} onClick={() => actions.move(currentPage, 1)}>▼</button>
        </span>
      </div>
      <div className="page-tools">
        {buttons.map(([icon, title, disabled, onClick]) => (
          <button key={icon} title={title} disabled={disabled} onClick={() => { onClick(); focusList(); }}>
            {ICONS[icon]}
          </button>
        ))}
      </div>
      <div className="thumbs" ref={listRef} tabIndex={0} onDragLeave={() => setDrop(null)}>
        {edits.pages.map((p, i) => (
          <Fragment key={p.id}>
            <Gap index={i} actions={actions} />
            <div
              className={`thumb${p.id === currentPage ? ' active' : ''}${drop?.index === i ? (drop.after ? ' drop-after' : ' drop-before') : ''}`}
              draggable
              onClick={() => {
                actions.setGap(null);
                actions.goto(p.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                actions.goto(p.id);
                focusList();
                setMenu({ x: e.clientX, y: e.clientY, id: p.id });
              }}
              onDragStart={(e) => {
                dragging.current = p.id;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (dragging.current === null) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDrop({ index: i, after: e.clientY > r.top + r.height / 2 });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging.current !== null && drop) actions.reorder(dragging.current, drop.index + (drop.after ? 1 : 0));
                dragging.current = null;
                setDrop(null);
              }}
              onDragEnd={() => {
                dragging.current = null;
                setDrop(null);
              }}
            >
              <Thumb entry={p} />
              <span className="num">{i + 1}</span>
            </div>
          </Fragment>
        ))}
        <Gap index={edits.pages.length} actions={actions} />
        <button
          className="add-page"
          title="Add a page at the end"
          onClick={() => actions.add(edits.pages[edits.pages.length - 1].id)}
        >
          +
        </button>
      </div>
      {menu && (
        <div className="dropdown context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          {(
            [
              ['New Blank Page', '', false, () => actions.insertBlank(menu.id)],
              ['Insert PDF…', '', false, () => actions.insertPdf(menu.id)],
              'sep',
              ['Cut Page', 'Ctrl+X', single, () => actions.cut(menu.id)],
              ['Copy Page', 'Ctrl+C', false, () => actions.copy(menu.id)],
              ['Paste Page After', 'Ctrl+V', !actions.canPaste, () => actions.paste(menu.id)],
              ['Delete Page', 'Del', single, () => actions.remove(menu.id)],
              'sep',
              ['Move Up', '', idx <= 0, () => actions.move(menu.id, -1)],
              ['Move Down', '', idx >= edits.pages.length - 1, () => actions.move(menu.id, 1)],
            ] as const
          ).map((it, j) =>
            it === 'sep' ? (
              <div key={j} className="sep" />
            ) : (
              <div
                key={j}
                className={`item${it[2] ? ' disabled' : ''}`}
                onClick={() => {
                  if (it[2]) return;
                  setMenu(null);
                  it[3]();
                }}
              >
                <span>{it[0]}</span>
                <span>{it[1]}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** The space between two thumbnails; clicking it marks it as where the next pasted page goes. */
function Gap({ index, actions }: { index: number; actions: PageActions }) {
  return (
    <div
      className={`gap${actions.gap === index ? ' active' : ''}`}
      title="Click to paste a page here"
      onClick={() => actions.setGap(actions.gap === index ? null : index)}
    />
  );
}

function Thumb({ entry }: { entry: PageEntry }) {
  const { edits } = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref, '300px');
  const scale = THUMB_W / Math.max(entry.w, entry.h * 0.8);
  const anns = paintOrder(edits.annotations.filter((a) => a.page === entry.id));
  return (
    <div className="frame" ref={ref} style={{ width: entry.w * scale, height: entry.h * scale }}>
      <PageCanvas src={entry.src} scale={scale} near={near} />
      {anns.map((a) => (
        <AnnotationView key={a.id} a={a} scale={scale} />
      ))}
    </div>
  );
}
