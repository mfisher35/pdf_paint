import type { FontFamily, Style } from '../types';
import { FONTS, FONT_SIZES } from '../text';

interface Props {
  style: Style;
  onStyle: (patch: Partial<Style>) => void;
}

/** The "Fonts" toolbar Paint shows while the text tool is active. */
export function FontBar({ style, onStyle }: Props) {
  const sizes = FONT_SIZES.includes(style.size) ? FONT_SIZES : [...FONT_SIZES, style.size].sort((a, b) => a - b);
  return (
    <div className="fontbar">
      <span>Fonts</span>
      <select value={style.font} onChange={(e) => onStyle({ font: e.target.value as FontFamily })} style={{ width: 150 }}>
        {FONTS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
        ))}
      </select>
      <select value={style.size} onChange={(e) => onStyle({ size: Number(e.target.value) })} style={{ width: 50 }}>
        {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <button onMouseDown={(e) => e.preventDefault()} className={`toggle${style.bold ? ' on' : ''}`} title="Bold" onClick={() => onStyle({ bold: !style.bold })}>
        <b>B</b>
      </button>
      <button onMouseDown={(e) => e.preventDefault()} className={`toggle${style.italic ? ' on' : ''}`} title="Italic" onClick={() => onStyle({ italic: !style.italic })}>
        <i style={{ fontFamily: 'Times New Roman', fontSize: 13 }}>I</i>
      </button>
      <button onMouseDown={(e) => e.preventDefault()} className={`toggle${style.underline ? ' on' : ''}`} title="Underline" onClick={() => onStyle({ underline: !style.underline })}>
        <u>U</u>
      </button>
    </div>
  );
}
