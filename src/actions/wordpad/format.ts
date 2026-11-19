import { getSchema, Node as TipTapNode, mergeAttributes, type JSONContent } from '@tiptap/core';
import { generateJSON } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import DOMPurify from 'dompurify';
import { err, ok, type Result } from '../../../shared/errors';

/** WordPad document format (Design: "WordPad document representation"). */
export const WPD_EXT = 'wpd';
export const WPD_MIME = 'application/vnd.win98ai.wordpad+json';

export type TipTapJSON = JSONContent;
export interface WordPadFile {
  version: 1;
  doc: TipTapJSON;
}

/** Block image node that stores only the stable VFS node id. `src` is never stored. */
export const VfsImage = TipTapNode.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      vfsId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-vfs-id'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.vfsId ? { 'data-vfs-id': String(attrs.vfsId) } : {}),
      },
      alt: { default: null },
      width: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-vfs-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },
});

/** StarterKit covers paragraphs, headings, lists, bold, italic, underline, links, and history. */
export const wordpadExtensions = [StarterKit, VfsImage];

export const wordpadSchema = getSchema(wordpadExtensions);

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'u', 'br', 'blockquote', 'a'],
  ALLOWED_ATTR: ['href'],
  ALLOWED_URI_REGEXP: /^(https?:|mailto:)/i,
};

/** Allow-list sanitizer for any HTML before it reaches a document (Req 7.6, 12.3). */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG) as unknown as string;
}

export const emptyDoc = (): TipTapJSON => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/** Sanitize, then convert HTML to a TipTap document using the WordPad schema. */
export function htmlToTiptapJson(html: string): TipTapJSON {
  const json = generateJSON(sanitizeHtml(html), wordpadExtensions) as TipTapJSON;
  return json.content && json.content.length > 0 ? json : emptyDoc();
}

/** Plain text of a document: blocks separated by newlines, images skipped. */
export function tiptapToPlainText(doc: TipTapJSON): string {
  const lines: string[] = [];
  const inline = (n: TipTapJSON): string => {
    if (n.type === 'text') return n.text ?? '';
    if (n.type === 'hardBreak') return '\n';
    return (n.content ?? []).map(inline).join('');
  };
  const walk = (n: TipTapJSON): void => {
    if (n.type === 'image') return;
    const kids = n.content ?? [];
    const hasBlockChild = kids.some((k) => k.type !== 'text' && k.type !== 'hardBreak');
    if (n.type === 'doc' || hasBlockChild) {
      kids.forEach(walk);
    } else if (n.type === 'text') {
      lines.push(n.text ?? '');
    } else {
      lines.push(inline(n));
    }
  };
  walk(doc);
  return lines.join('\n');
}

/** Throws when the JSON does not conform to the WordPad schema. */
export function checkDoc(doc: unknown): TipTapJSON {
  if (typeof doc !== 'object' || doc === null || (doc as TipTapJSON).type !== 'doc') {
    throw new Error('Not a document.');
  }
  wordpadSchema.nodeFromJSON(doc).check();
  return doc as TipTapJSON;
}

export function serializeWpd(doc: TipTapJSON): ArrayBuffer {
  const file: WordPadFile = { version: 1, doc };
  return new TextEncoder().encode(JSON.stringify(file)).buffer as ArrayBuffer;
}

export function parseWpd(bytes: ArrayBuffer): Result<TipTapJSON> {
  try {
    const file = JSON.parse(new TextDecoder().decode(bytes)) as Partial<WordPadFile>;
    if (file.version !== 1) return err('VALIDATION', 'Unsupported WordPad document version.');
    return ok(checkDoc(file.doc));
  } catch {
    return err('VALIDATION', 'The file is not a valid WordPad document.');
  }
}
