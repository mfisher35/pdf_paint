import { useRef, useState } from 'react';
import { PAINT_PALETTE } from './icons';

const STORAGE_KEY = 'pdfpaint:palette';

function loadPalette() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(p) && p.length === PAINT_PALETTE.length) return p as string[];
  } catch {
    /* storage unavailable */
  }
  return PAINT_PALETTE;
}

interface Props {
  primary: string;
  secondary: string;
  onPrimary: (c: string) => void;
  onSecondary: (c: string) => void;
}

export function ColorBox({ primary, secondary, onPrimary, onSecondary }: Props) {
  const [palette, setPalette] = useState(loadPalette);
  const picker = useRef<HTMLInputElement>(null);
  const editing = useRef<number>(0);

  const editColor = (i: number) => {
    editing.current = i;
    picker.current!.value = palette[i];
    picker.current!.click();
  };

  return (
    <div className="colorbox">
      <div className="current-colors" title="Primary (outline / text) and secondary (fill / text background)">
        <div className="swatch primary" style={{ background: primary }} />
        <div className="swatch secondary" style={{ background: secondary }} />
      </div>
      <div className="palette">
        {palette.map((c, i) => (
          <div
            key={i}
            className="cell"
            title={`${c}\nLeft-click: primary · Right-click: secondary · Double-click: edit`}
            onClick={() => onPrimary(c)}
            onContextMenu={(e) => {
              e.preventDefault();
              onSecondary(c);
            }}
            onDoubleClick={() => editColor(i)}
          >
            <div style={{ background: c }} />
          </div>
        ))}
      </div>
      <input
        ref={picker}
        type="color"
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
        onChange={(e) => {
          const c = e.target.value;
          const next = palette.map((p, i) => (i === editing.current ? c : p));
          setPalette(next);
          onPrimary(c);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            /* storage unavailable */
          }
        }}
      />
      <span className="hint">Left-click = outline/text color · Right-click = fill/background · Double-click = edit color</span>
    </div>
  );
}
