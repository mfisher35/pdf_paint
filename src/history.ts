import type { EditState } from './types';

export interface History {
  past: EditState[];
  present: EditState;
  future: EditState[];
}

export type HistoryAction =
  | { type: 'reset'; present: EditState }
  /** Discrete edit: records an undo step. */
  | { type: 'apply'; fn: (s: EditState) => EditState }
  /** Live edit during a drag: no undo step. */
  | { type: 'live'; fn: (s: EditState) => EditState }
  /** End of a drag: record `before` as an undo step if anything changed. */
  | { type: 'commit'; before: EditState }
  | { type: 'undo' }
  | { type: 'redo' };

const LIMIT = 200;

export function historyReducer(h: History, action: HistoryAction): History {
  switch (action.type) {
    case 'reset':
      return { past: [], present: action.present, future: [] };
    case 'apply': {
      const next = action.fn(h.present);
      if (next === h.present) return h;
      return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
    }
    case 'live':
      return { ...h, present: action.fn(h.present) };
    case 'commit':
      if (action.before === h.present) return h;
      return { past: [...h.past, action.before].slice(-LIMIT), present: h.present, future: [] };
    case 'undo':
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    case 'redo':
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  }
}
