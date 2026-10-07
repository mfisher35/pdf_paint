import { get, set, del } from 'idb-keyval';
import type { EditState } from './types';

// Everything stays in this browser's IndexedDB; nothing is uploaded anywhere.
export interface StoredDoc {
  name: string;
  bytes: Uint8Array;
}

export const loadStoredDoc = () => get<StoredDoc>('pdfpaint:doc');
export const loadStoredEdits = () => get<EditState>('pdfpaint:edits');
export const storeDoc = (doc: StoredDoc) => set('pdfpaint:doc', doc);
export const storeEdits = (edits: EditState) => set('pdfpaint:edits', edits);
export const clearStored = () => Promise.all([del('pdfpaint:doc'), del('pdfpaint:edits')]);
