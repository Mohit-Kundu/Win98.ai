import { z } from 'zod';
import type { NodeRecord } from '../../actions/types';

/** Result caps so tool output stays small for the model (design: 50 entries, 4 KB text). */
export const MAX_LIST_ENTRIES = 50;
export const MAX_TEXT_BYTES = 4096;
/** Upper bound for model-written HTML in create_document and update_document (64 KB). */
export const MAX_CONTENT_HTML = 64 * 1024;

const enc = new TextEncoder();

/** Truncate text to at most `maxBytes` UTF-8 bytes without splitting a character. */
export function capText(text: string, maxBytes = MAX_TEXT_BYTES): { text: string; truncated: boolean } {
  if (enc.encode(text).length <= maxBytes) return { text, truncated: false };
  let cut = text.slice(0, maxBytes);
  while (cut.length > 0 && enc.encode(cut).length > maxBytes) cut = cut.slice(0, -1);
  // Do not leave half of a surrogate pair at the end.
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return { text: cut, truncated: true };
}

export const contentHtmlSchema = z
  .string()
  .max(MAX_CONTENT_HTML, 'contentHtml must be at most 64 KB.')
  .describe('HTML using only p, h1-h3, ul, ol, li, strong, em, u, br, blockquote, and a tags.');

export const pathSchema = (what: string) => z.string().min(1).describe(what);

export const overwriteSchema = z
  .boolean()
  .optional()
  .describe('Set true to replace an existing file. The user is asked to confirm. Without it, an existing file causes an error.');

export interface NodeSummary {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  ext?: string;
  size: number;
  createdAt: number;
  modifiedAt: number;
}

export function summarizeNode(n: NodeRecord): NodeSummary {
  return { id: n.id, name: n.name, kind: n.kind, ext: n.ext, size: n.size, createdAt: n.createdAt, modifiedAt: n.modifiedAt };
}
