import type { TipTapJSON } from './format';

/** Emitted after an action changes a stored document, so an open WordPad editor can reload. */
export interface DocumentUpdate {
  fileId: string;
  doc: TipTapJSON;
  source: 'create' | 'update' | 'insertImage';
}

export type DocumentListener = (u: DocumentUpdate) => void;

export class DocumentBus {
  private listeners = new Set<DocumentListener>();
  subscribe(fn: DocumentListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  emit(u: DocumentUpdate): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(u);
      } catch {
        // A faulty listener must not break the others or the action.
      }
    }
  }
}

export const documentBus = new DocumentBus();
