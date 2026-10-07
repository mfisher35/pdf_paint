import { memo } from 'react';
import type { Annotation } from '../types';
import { shapeColors, strokePoints } from '../draw';
import { LINE_HEIGHT, TEXT_PAD, fontStyle, layoutText } from '../text';

interface Props {
  a: Annotation;
  scale: number;
  hidden?: boolean;
}

/** Pure display of one annotation, positioned in page space * scale. */
export const AnnotationView = memo(function AnnotationView({ a, scale, hidden }: Props) {
  const box: React.CSSProperties = {
    left: a.x * scale,
    top: a.y * scale,
    width: a.w * scale,
    height: a.h * scale,
    visibility: hidden ? 'hidden' : undefined,
  };

  switch (a.type) {
    case 'redact':
      return <div className="ann" style={{ ...box, background: '#000' }} data-id={a.id} />;

    case 'pencil':
    case 'line': {
      const pts = strokePoints(a)
        .map(([x, y]) => `${(x - a.x) * scale},${(y - a.y) * scale}`)
        .join(' ');
      const lw = a.lineWidth * scale;
      return (
        // Only the stroke itself (plus a little slack) is clickable, not its whole bounding box.
        <div className="ann stroke-ann" style={box} data-id={a.id}>
          <svg width={a.w * scale} height={a.h * scale}>
            <polyline points={pts} fill="none" stroke={a.color} strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" />
            <polyline className="hit" points={pts} fill="none" stroke="transparent" strokeWidth={Math.max(lw, 10)} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      );
    }

    case 'rect':
    case 'ellipse': {
      const { stroke, fill } = shapeColors(a);
      const lw = stroke ? a.lineWidth * scale : 0;
      const w = a.w * scale;
      const h = a.h * scale;
      const common = {
        fill: fill ?? 'none',
        stroke: stroke ?? 'none',
        strokeWidth: lw,
      };
      return (
        <div className="ann" style={box} data-id={a.id}>
          <svg width={w} height={h}>
            {a.type === 'rect' ? (
              <rect x={lw / 2} y={lw / 2} width={Math.max(0, w - lw)} height={Math.max(0, h - lw)} {...common} />
            ) : (
              <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - lw / 2)} ry={Math.max(0, h / 2 - lw / 2)} {...common} />
            )}
          </svg>
        </div>
      );
    }

    case 'text': {
      const lines = layoutText(a);
      return (
        <div
          className="ann text-ann"
          data-id={a.id}
          style={{
            ...box,
            background: a.bg ?? undefined,
            color: a.color,
            ...fontStyle(a, scale),
            lineHeight: LINE_HEIGHT,
            textDecoration: a.underline ? 'underline' : undefined,
          }}
        >
          {lines.map((line, i) => (
            <div
              key={i}
              className="line"
              style={{
                left: TEXT_PAD * scale,
                top: (TEXT_PAD + i * a.size * LINE_HEIGHT) * scale,
                height: a.size * LINE_HEIGHT * scale,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      );
    }

    case 'image':
      return (
        <div className="ann" style={box} data-id={a.id}>
          <img src={a.src} alt="" draggable={false} />
        </div>
      );
  }
});
