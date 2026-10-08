import type { FillMode, Style, Tool } from '../types';
import { TOOL_ICONS, TOOL_NAMES } from './icons';

// Laid out in Paint's order: two columns, top to bottom.
const TOOLS: Tool[] = [
  'rect-select', 'ellipse-select', 'select', 'wand', 'eraser', 'fill', 'picker', 'image', 'redact', 'pencil', 'text', 'line', 'rect', 'ellipse',
];
const FILL_MODES: FillMode[] = ['outline', 'outline-fill', 'fill'];
const LINE_WIDTHS = [1, 2, 3, 5, 8];
/** Eraser sizes in points, drawn as Paint's four growing squares. */
const ERASER_SIZES = [4, 8, 14, 22];

interface Props {
  tool: Tool;
  style: Style;
  onTool: (t: Tool) => void;
  onStyle: (patch: Partial<Style>) => void;
}

export function ToolBox({ tool, style, onTool, onStyle }: Props) {
  return (
    <div className="toolbox">
      <div className="tools">
        {TOOLS.map((t) => (
          <button key={t} className={`tool${tool === t ? ' active' : ''}`} title={TOOL_NAMES[t]} onClick={() => onTool(t)}>
            {TOOL_ICONS[t]}
          </button>
        ))}
      </div>
      <div className="tool-options">
        {(tool === 'rect' || tool === 'ellipse') && (
          <>
            {FILL_MODES.map((m) => (
              <div key={m} className={`opt${style.fillMode === m ? ' active' : ''}`} onClick={() => onStyle({ fillMode: m })} title={m}>
                <FillPreview mode={m} active={style.fillMode === m} />
              </div>
            ))}
            <div style={{ height: 4 }} />
            <WidthOptions value={style.lineWidth} onChange={(lineWidth) => onStyle({ lineWidth })} />
          </>
        )}
        {(tool === 'pencil' || tool === 'line') && (
          <WidthOptions value={style.lineWidth} onChange={(lineWidth) => onStyle({ lineWidth })} />
        )}
        {tool === 'text' && (
          <>
            <div className={`opt${style.textOpaque ? ' active' : ''}`} style={{ height: 26 }} title="Opaque background (uses secondary color)" onClick={() => onStyle({ textOpaque: true })}>
              <TextBgPreview opaque active={style.textOpaque} />
            </div>
            <div className={`opt${!style.textOpaque ? ' active' : ''}`} style={{ height: 26 }} title="Transparent background" onClick={() => onStyle({ textOpaque: false })}>
              <TextBgPreview opaque={false} active={!style.textOpaque} />
            </div>
          </>
        )}
        {tool === 'eraser' &&
          ERASER_SIZES.map((size, i) => (
            <div
              key={size}
              className={`opt${style.eraserSize === size ? ' active' : ''}`}
              style={{ height: 6 + i * 2 + 6 }}
              title={`${size}pt eraser`}
              onClick={() => onStyle({ eraserSize: size })}
            >
              <div style={{ width: 4 + i * 2, height: 4 + i * 2, background: style.eraserSize === size ? '#fff' : '#000' }} />
            </div>
          ))}
        {tool === 'fill' && <div className="note">Right-click: 2nd color</div>}
        {tool === 'picker' && <div className="note">Right-click: 2nd color</div>}
        {tool === 'wand' && <div className="note">Click a shape</div>}
        {(tool === 'rect-select' || tool === 'ellipse-select') && <div className="note">Drag to select</div>}
        {tool === 'redact' && <div className="note">Drag to black out</div>}
        {tool === 'image' && <div className="note">Click page to place</div>}
      </div>
    </div>
  );
}

function WidthOptions({ value, onChange }: { value: number; onChange: (w: number) => void }) {
  return LINE_WIDTHS.map((w) => (
    <div
      key={w}
      className={`opt${value === w ? ' active' : ''}`}
      style={{ height: w + 6 }}
      onClick={() => onChange(w)}
      title={`${w}pt line`}
    >
      <div style={{ width: 28, height: w, background: value === w ? '#fff' : '#000' }} />
    </div>
  ));
}

function FillPreview({ mode, active }: { mode: FillMode; active: boolean }) {
  const fg = active ? '#fff' : '#000';
  return (
    <svg width="28" height="12" style={{ shapeRendering: 'crispEdges' }}>
      <rect
        x="0.5" y="0.5" width="27" height="11"
        fill={mode === 'outline' ? 'none' : mode === 'fill' ? fg : '#808080'}
        stroke={mode === 'fill' ? 'none' : fg}
      />
    </svg>
  );
}

function TextBgPreview({ opaque, active }: { opaque: boolean; active: boolean }) {
  return (
    <svg width="30" height="22" style={{ shapeRendering: 'crispEdges' }}>
      <circle cx="10" cy="11" r="7" fill="#00f" />
      {opaque && <rect x="12" y="6" width="14" height="12" fill={active ? '#ccc' : '#fff'} />}
      <text x="13" y="16" fontSize="11" fontWeight="bold" fill={active ? '#fff' : '#000'}>A</text>
    </svg>
  );
}
