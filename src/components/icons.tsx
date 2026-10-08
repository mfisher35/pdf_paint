import type { Tool } from '../types';

const S = (props: { children: React.ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 16 16">{props.children}</svg>
);

export const TOOL_ICONS: Record<Tool, React.ReactNode> = {
  select: (
    <S>
      <rect x="1.5" y="2.5" width="12" height="10" fill="none" stroke="#000" strokeDasharray="2 1" />
      <path d="M9 7 L9 15 L11 13 L12.5 16 L14 15.3 L12.6 12.4 L15 12.2 Z" fill="#fff" stroke="#000" strokeWidth="0.8" />
    </S>
  ),
  'rect-select': (
    <S>
      <rect x="1.5" y="2.5" width="13" height="11" fill="none" stroke="#000" strokeDasharray="2 2" />
    </S>
  ),
  'ellipse-select': (
    <S>
      <ellipse cx="8" cy="8" rx="6.5" ry="5" fill="none" stroke="#000" strokeDasharray="2 1.5" style={{ shapeRendering: 'auto' }} />
    </S>
  ),
  wand: (
    <S>
      <path d="M2 14 L10 6" stroke="#000" strokeWidth="2" style={{ shapeRendering: 'auto' }} />
      <path d="M2 14 L4 12" stroke="#fff" strokeWidth="1" style={{ shapeRendering: 'auto' }} />
      <path d="M12 1 L12.7 3.3 L15 4 L12.7 4.7 L12 7 L11.3 4.7 L9 4 L11.3 3.3 Z" fill="#ff0" stroke="#000" strokeWidth="0.6" />
    </S>
  ),
  eraser: (
    <S>
      <path d="M1.5 10.5 L7.5 4.5 L14.5 4.5 L8.5 10.5 Z" fill="#ffff80" stroke="#000" />
      <path d="M1.5 10.5 L8.5 10.5 L8.5 13.5 L1.5 13.5 Z" fill="#ff80c0" stroke="#000" />
      <path d="M8.5 13.5 L14.5 7.5 L14.5 4.5 L8.5 10.5 Z" fill="#c0a000" stroke="#000" />
    </S>
  ),
  fill: (
    <S>
      <path d="M2 8 L7 3 L12 8 L7 13 Z" fill="#fff" stroke="#000" />
      <path d="M2 8 L12 8 L7 13 Z" fill="#808080" />
      <path d="M7 3 L5 1" stroke="#000" />
      <path d="M12 8 Q15 10 14 14 L13 14 Q13 11 12 9 Z" fill="#00f" />
    </S>
  ),
  picker: (
    <S>
      <path d="M2 14 L2 12 L9 5 L11 7 L4 14 Z" fill="#fff" stroke="#000" />
      <path d="M8 4 L12 8 M10 6 L13 3 A1.4 1.4 0 0 0 11 1 Z" fill="#000" stroke="#000" strokeWidth="1.5" />
    </S>
  ),
  redact: (
    <S>
      <rect x="1" y="3" width="14" height="10" fill="#fff" stroke="#808080" />
      <rect x="2" y="5" width="12" height="2" fill="#000" />
      <rect x="2" y="9" width="8" height="2" fill="#000" />
    </S>
  ),
  pencil: (
    <S>
      <path d="M2 14 L3.5 10 L11 2.5 L13.5 5 L6 12.5 Z" fill="#ffff80" stroke="#000" />
      <path d="M11 2.5 L13.5 5 L14.5 4 L12 1.5 Z" fill="#ff8080" stroke="#000" />
      <path d="M2 14 L3 11 L5 13 Z" fill="#000" />
    </S>
  ),
  line: (
    <S>
      <path d="M2 13 L14 3" stroke="#000" strokeWidth="1.5" style={{ shapeRendering: 'auto' }} />
    </S>
  ),
  rect: (
    <S>
      <rect x="2.5" y="3.5" width="11" height="9" fill="none" stroke="#000" />
    </S>
  ),
  ellipse: (
    <S>
      <ellipse cx="8" cy="8" rx="6" ry="4.5" fill="none" stroke="#000" style={{ shapeRendering: 'auto' }} />
    </S>
  ),
  text: (
    <S>
      <path d="M3 14 L7 2 L9 2 L13 14 L11 14 L10 11 L6 11 L5 14 Z M6.6 9 L9.4 9 L8 4.6 Z" fill="#000" />
    </S>
  ),
  image: (
    <S>
      <rect x="1.5" y="2.5" width="13" height="11" fill="#fff" stroke="#000" />
      <rect x="2" y="3" width="12" height="7" fill="#80c0ff" />
      <circle cx="11" cy="5.5" r="1.5" fill="#ff0" />
      <path d="M2 13 L6 7 L9 11 L11 9 L14 13 Z" fill="#008000" />
    </S>
  ),
};

export const TOOL_NAMES: Record<Tool, string> = {
  select: 'Select / Move (S)',
  'rect-select': 'Rectangle Select (M)',
  'ellipse-select': 'Ellipse Select (O)',
  wand: 'Magic Wand (W)',
  eraser: 'Eraser (X)',
  fill: 'Fill With Color (F)',
  picker: 'Pick Color (K)',
  redact: 'Redact (R)',
  pencil: 'Pencil (P)',
  line: 'Line (L)',
  rect: 'Rectangle (B)',
  ellipse: 'Ellipse (E)',
  text: 'Text (T)',
  image: 'Insert Picture (I)',
};

/** The default 28-color palette from Windows 98 Paint. */
export const PAINT_PALETTE = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080',
  '#800080', '#808040', '#004040', '#0080ff', '#004080', '#8000ff', '#804000',
  '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff',
  '#ff00ff', '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#ff8040',
];
