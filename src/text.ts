import type { FontFamily, TextAnn } from './types';

export const FONTS: FontFamily[] = ['Arial', 'Times New Roman', 'Courier New'];
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

export const CSS_FONT: Record<FontFamily, string> = {
  Arial: 'Arial, Helvetica, sans-serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  'Courier New': '"Courier New", Courier, monospace',
};

/**
 * Distance from the top of a line box to the baseline, as a fraction of font size,
 * for a CSS line-height of LINE_HEIGHT. Derived from each font's ascent/descent.
 */
export const BASELINE: Record<FontFamily, number> = {
  Arial: 0.947,
  'Times New Roman': 0.937,
  'Courier New': 0.866,
};

export const LINE_HEIGHT = 1.2;
/** Inner padding of text boxes, in points. */
export const TEXT_PAD = 2;

export function cssFont(a: Pick<TextAnn, 'font' | 'size' | 'bold' | 'italic'>, scale = 1) {
  return `${a.italic ? 'italic ' : ''}${a.bold ? 'bold ' : ''}${a.size * scale}px ${CSS_FONT[a.font]}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Word-wrap text to the box width using the browser's metrics for the font. */
export function layoutText(a: TextAnn): string[] {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = cssFont(a);
  const maxW = Math.max(1, a.w - TEXT_PAD * 2);
  const width = (s: string) => measureCtx!.measureText(s).width;
  const out: string[] = [];
  for (const para of a.text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      if (!word) continue;
      const candidate = line + word;
      if (width(candidate) <= maxW || !line) {
        line = candidate;
      } else {
        out.push(line.trimEnd());
        line = /^\s+$/.test(word) ? '' : word;
      }
      // Hard-break words that are wider than the box on their own.
      while (width(line) > maxW && line.length > 1) {
        let i = line.length - 1;
        while (i > 1 && width(line.slice(0, i)) > maxW) i--;
        out.push(line.slice(0, i));
        line = line.slice(i);
      }
    }
    out.push(line);
  }
  return out;
}

export function textHeight(a: TextAnn, lineCount: number) {
  return Math.max(1, lineCount) * a.size * LINE_HEIGHT + TEXT_PAD * 2;
}

/** React style props for a text annotation (longhands only, so React can diff them safely). */
export function fontStyle(a: Pick<TextAnn, 'font' | 'size' | 'bold' | 'italic'>, scale = 1) {
  return {
    fontFamily: CSS_FONT[a.font],
    fontSize: a.size * scale,
    fontWeight: a.bold ? 'bold' : 'normal',
    fontStyle: a.italic ? 'italic' : 'normal',
  } as const;
}
