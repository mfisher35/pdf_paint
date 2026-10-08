export type Tool =
  | 'select' | 'rect-select' | 'ellipse-select' | 'wand' | 'eraser' | 'fill' | 'picker' | 'redact' | 'pencil' | 'line' | 'rect' | 'ellipse' | 'text' | 'image';
export type FillMode = 'outline' | 'outline-fill' | 'fill';
export type FontFamily = 'Arial' | 'Times New Roman' | 'Courier New';

/** All geometry is in PDF points, relative to the top-left of the (unscaled) page viewport. */
interface Base {
  id: string;
  /** Id of the PageEntry this annotation sits on. */
  page: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RedactAnn extends Base {
  type: 'redact';
}

/**
 * Freehand pencil stroke or straight line (a line is just a two-point stroke).
 * An eraser stroke is a pencil stroke with a square brush, painted in the secondary color like Paint's eraser.
 */
export interface StrokeAnn extends Base {
  type: 'pencil' | 'line' | 'eraser';
  /** Flat [x0, y0, x1, y1, ...] as fractions of the box, so moving/resizing just changes the box. */
  points: number[];
  color: string;
  lineWidth: number;
}

export interface ShapeAnn extends Base {
  type: 'rect' | 'ellipse';
  stroke: string;
  fill: string;
  fillMode: FillMode;
  lineWidth: number;
}

export interface TextAnn extends Base {
  type: 'text';
  text: string;
  font: FontFamily;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  /** Background color when "opaque" mode is on, null for transparent. */
  bg: string | null;
}

export interface ImageAnn extends Base {
  type: 'image';
  /** data: URL, always PNG or JPEG (BMP is converted to PNG on insert). */
  src: string;
}

export type Annotation = RedactAnn | StrokeAnn | ShapeAnn | TextAnn | ImageAnn;

export interface PageSize {
  w: number;
  h: number;
}

export interface PageEntry {
  id: string;
  /** Index of the page in the original PDF, or null for a blank inserted page. */
  src: number | null;
  /** Displayed size in points (rotation applied). */
  w: number;
  h: number;
}

export interface EditState {
  annotations: Annotation[];
  /** Pages in display order. */
  pages: PageEntry[];
}

export interface Style {
  primary: string;
  secondary: string;
  fillMode: FillMode;
  lineWidth: number;
  eraserSize: number;
  font: FontFamily;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textOpaque: boolean;
}
