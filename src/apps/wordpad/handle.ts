/**
 * Editor handle for other features (AI assistant, Clippy context provider).
 * Positions are ProseMirror positions in the open document.
 */
export interface WordPadSelection {
  from: number;
  to: number;
  /** Selected text, empty when nothing is selected. */
  text: string;
}

export interface WordPadHandle {
  windowId: string;
  fileId(): string | null;
  path(): string | null;
  getSelection(): WordPadSelection;
  getText(): string;
  /** Select [from, to]. Returns false when the range is invalid. */
  setSelection(from: number, to: number): boolean;
  /** Replace [from, to] with sanitized HTML. Returns false when the range is invalid. */
  replaceRange(from: number, to: number, html: string): boolean;
}

const handles = new Map<string, WordPadHandle>();

export function registerWordPadHandle(handle: WordPadHandle): () => void {
  handles.set(handle.windowId, handle);
  return () => {
    if (handles.get(handle.windowId) === handle) handles.delete(handle.windowId);
  };
}

export function getWordPadHandle(windowId: string): WordPadHandle | undefined {
  return handles.get(windowId);
}
