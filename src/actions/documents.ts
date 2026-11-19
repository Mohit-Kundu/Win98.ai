import { DOMParser as PMDOMParser, Fragment, Slice } from '@tiptap/pm/model';
import { err, ok, type Result } from '../../shared/errors';
import type { VfsService } from '../vfs/service';
import { extOf } from '../vfs/paths';
import { decodeBase64, encodeBlankPng, sniffImage } from './png';
import type { CoreActions, NodeRecord } from './types';
import { documentBus, type DocumentBus } from './wordpad/documentBus';
import {
  checkDoc,
  emptyDoc,
  htmlToTiptapJson,
  parseWpd,
  sanitizeHtml,
  serializeWpd,
  tiptapToPlainText,
  WPD_EXT,
  WPD_MIME,
  wordpadSchema,
  type TipTapJSON,
} from './wordpad/format';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BLANK_PIXELS = 2048 * 2048;

export type ImagePosition = 'end' | { afterHeading: string } | { pos: number };

export interface CreateDocumentInput {
  path: string;
  cwd?: string;
  contentHtml?: string;
  contentJson?: unknown;
  overwrite?: boolean;
}
export interface UpdateDocumentInput {
  fileId: string;
  mode: 'replace' | 'append' | 'replaceSelection' | 'replaceSection';
  contentHtml: string;
  /** ProseMirror positions, required for replaceSelection. */
  range?: { from: number; to: number };
  /** Heading text, required for replaceSection. */
  section?: string;
}
export interface InsertImageInput {
  documentId: string;
  imageId: string;
  position: ImagePosition;
  alt?: string;
}
export interface CreateDrawingInput {
  path: string;
  cwd?: string;
  width?: number;
  height?: number;
  imageBase64?: string;
  overwrite?: boolean;
}
export interface UpdateDrawingInput {
  fileId: string;
  imageBase64: string;
}

export interface ReadDocumentInput {
  fileId?: string;
  path?: string;
  cwd?: string;
}

export interface DocumentActions {
  /** Read a WordPad, TXT, or MD file as plain text. */
  readDocument(i: ReadDocumentInput): Promise<Result<{ fileId: string; path: string; text: string }>>;
  createDocument(i: CreateDocumentInput): Promise<Result<{ fileId: string; path: string }>>;
  updateDocument(i: UpdateDocumentInput): Promise<Result<{ fileId: string }>>;
  insertImageIntoDocument(i: InsertImageInput): Promise<Result<{ documentId: string }>>;
  createDrawing(i: CreateDrawingInput): Promise<Result<{ fileId: string; path: string }>>;
  updateDrawing(i: UpdateDrawingInput): Promise<Result<{ fileId: string }>>;
}

export interface DocumentDeps {
  vfs: VfsService;
  core: Pick<CoreActions, 'saveFile'>;
  bus?: DocumentBus;
}

async function guard<T>(body: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await body();
  } catch (e) {
    return err('WRITE_FAILED', 'The operation failed unexpectedly.', { cause: e instanceof Error ? e.message : String(e) });
  }
}

const lastExt = (path: string): string | undefined => extOf(path.split(/[\\/]/).pop() ?? '');

const headingText = (n: TipTapJSON): string => tiptapToPlainText({ type: 'doc', content: [n] }).trim().toLowerCase();
const isHeading = (n: TipTapJSON): boolean => n.type === 'heading';
const levelOf = (n: TipTapJSON): number => Number((n.attrs as { level?: number } | undefined)?.level ?? 1);

function findHeading(content: TipTapJSON[], text: string): number {
  const want = text.trim().toLowerCase();
  return content.findIndex((n) => isHeading(n) && headingText(n) === want);
}

/** Index after the last node that belongs to the section started by the heading at `idx`. */
function sectionEnd(content: TipTapJSON[], idx: number): number {
  const level = levelOf(content[idx]!);
  let end = idx + 1;
  while (end < content.length && !(isHeading(content[end]!) && levelOf(content[end]!) <= level)) end++;
  return end;
}

function htmlToSlice(html: string): Slice {
  const body = new DOMParser().parseFromString(sanitizeHtml(html), 'text/html').body;
  return PMDOMParser.fromSchema(wordpadSchema).parseSlice(body);
}

export function createDocumentActions({ vfs, core, bus = documentBus }: DocumentDeps): DocumentActions {
  const loadDoc = async (fileId: unknown, what: string): Promise<Result<{ node: NodeRecord; doc: TipTapJSON }>> => {
    if (typeof fileId !== 'string' || fileId === '') return err('VALIDATION', `A ${what} id is required.`);
    const r = await vfs.read(fileId);
    if (!r.ok) return r;
    if (r.value.node.kind !== 'file' || r.value.node.ext !== WPD_EXT) {
      return err('UNSUPPORTED_TYPE', `"${r.value.node.name}" is not a WordPad document.`);
    }
    const doc = parseWpd(r.value.bytes);
    return doc.ok ? ok({ node: r.value.node, doc: doc.value }) : doc;
  };

  const storeDoc = async (fileId: string, doc: TipTapJSON, source: 'update' | 'insertImage'): Promise<Result<{ fileId: string }>> => {
    try {
      checkDoc(doc);
    } catch {
      return err('VALIDATION', 'The change would produce an invalid document.');
    }
    const w = await vfs.write(fileId, serializeWpd(doc), { mime: WPD_MIME });
    if (!w.ok) return w;
    bus.emit({ fileId, doc, source });
    return ok({ fileId });
  };

  const readImageBytes = (b64: unknown, expected?: 'png' | 'jpg'): Result<{ bytes: Uint8Array; kind: 'png' | 'jpg' }> => {
    if (typeof b64 !== 'string') return err('VALIDATION', 'Image data is required.');
    const bytes = decodeBase64(b64);
    if (!bytes) return err('VALIDATION', 'The image data is not valid base64.');
    if (bytes.length > MAX_IMAGE_BYTES) return err('TOO_LARGE', 'The image is larger than 20 MB.');
    const kind = sniffImage(bytes);
    if (!kind) return err('UNSUPPORTED_TYPE', 'The image data is not a PNG or JPEG image.');
    if (expected && kind !== expected) return err('UNSUPPORTED_TYPE', `The image data is ${kind.toUpperCase()}, but the file is ${expected.toUpperCase()}.`);
    return ok({ bytes, kind });
  };

  return {
    readDocument: (i) =>
      guard(async () => {
        let id = i?.fileId;
        if (!id) {
          if (typeof i?.path !== 'string' || i.path.trim() === '') return err('VALIDATION', 'A document id or path is required.');
          const node = await vfs.resolve(i.path, i.cwd);
          if (!node.ok) return node;
          id = node.value.id;
        }
        const r = await vfs.read(id);
        if (!r.ok) return r;
        const { node, bytes } = r.value;
        const ext = node.ext === undefined ? '' : node.ext;
        let text: string;
        if (node.kind === 'file' && ext === WPD_EXT) {
          const doc = parseWpd(bytes);
          if (!doc.ok) return doc;
          text = tiptapToPlainText(doc.value);
        } else if (node.kind === 'file' && (ext === 'txt' || ext === 'md')) {
          text = new TextDecoder().decode(bytes);
        } else {
          return err('UNSUPPORTED_TYPE', `"${node.name}" is not a WordPad, TXT, or MD document.`);
        }
        return ok({ fileId: node.id, path: await vfs.pathOf(node.id), text });
      }),

    createDocument: (i) =>
      guard(async () => {
        if (typeof i?.path !== 'string' || i.path.trim() === '') return err('VALIDATION', 'A document path is required.');
        let path = i.path;
        const ext = lastExt(path);
        if (!ext) path += `.${WPD_EXT}`;
        else if (ext !== WPD_EXT) return err('UNSUPPORTED_TYPE', `WordPad documents use the .${WPD_EXT} extension, not .${ext}.`);

        let doc: TipTapJSON;
        if (i.contentJson !== undefined) {
          try {
            doc = checkDoc(i.contentJson);
          } catch {
            return err('VALIDATION', 'The document content is not valid.');
          }
        } else if (typeof i.contentHtml === 'string') {
          doc = htmlToTiptapJson(i.contentHtml);
        } else {
          doc = emptyDoc();
        }
        const saved = await core.saveFile({ path, cwd: i.cwd, bytes: serializeWpd(doc), mime: WPD_MIME, overwrite: i.overwrite });
        if (saved.ok) bus.emit({ fileId: saved.value.fileId, doc, source: 'create' });
        return saved;
      }),

    updateDocument: (i) =>
      guard(async () => {
        const loaded = await loadDoc(i?.fileId, 'document');
        if (!loaded.ok) return loaded;
        if (typeof i.contentHtml !== 'string') return err('VALIDATION', 'Replacement content is required.');
        const { doc } = loaded.value;
        const content = doc.content ?? [];
        const fresh = htmlToTiptapJson(i.contentHtml).content ?? [];
        let next: TipTapJSON;

        switch (i.mode) {
          case 'replace':
            next = { type: 'doc', content: fresh };
            break;
          case 'append':
            next = { type: 'doc', content: [...content, ...fresh] };
            break;
          case 'replaceSection': {
            if (typeof i.section !== 'string' || i.section.trim() === '') return err('VALIDATION', 'A section heading is required.');
            const idx = findHeading(content, i.section);
            if (idx < 0) return err('NOT_FOUND', `The section "${i.section}" was not found.`);
            const end = sectionEnd(content, idx);
            next = { type: 'doc', content: [...content.slice(0, idx + 1), ...fresh, ...content.slice(end)] };
            break;
          }
          case 'replaceSelection': {
            const node = wordpadSchema.nodeFromJSON(doc);
            const from = i.range?.from;
            const to = i.range?.to;
            if (!Number.isInteger(from) || !Number.isInteger(to) || from! < 0 || to! < from! || to! > node.content.size) {
              return err('VALIDATION', 'The selection range is outside the document.');
            }
            try {
              next = node.replace(from!, to!, htmlToSlice(i.contentHtml)).toJSON() as TipTapJSON;
            } catch {
              return err('VALIDATION', 'The replacement does not fit at the selected range.');
            }
            break;
          }
          default:
            return err('VALIDATION', 'Unknown update mode.');
        }
        if (!next.content || next.content.length === 0) next = emptyDoc();
        return storeDoc(loaded.value.node.id, next, 'update');
      }),

    insertImageIntoDocument: (i) =>
      guard(async () => {
        const loaded = await loadDoc(i?.documentId, 'document');
        if (!loaded.ok) return loaded;
        if (typeof i.imageId !== 'string' || i.imageId === '') return err('VALIDATION', 'An image id is required.');
        const image = await vfs.get(i.imageId);
        if (!image) return err('NOT_FOUND', 'The image was not found.', { id: i.imageId });
        if (image.kind !== 'file' || !['png', 'jpg', 'jpeg'].includes(image.ext ?? '')) {
          return err('UNSUPPORTED_TYPE', `"${image.name}" is not a PNG or JPG image.`);
        }
        const imageNode: TipTapJSON = { type: 'image', attrs: { vfsId: image.id, alt: i.alt ?? null, width: null } };
        const { doc } = loaded.value;
        const content = doc.content ?? [];
        let next: TipTapJSON;
        const pos = i.position;

        if (pos === 'end') {
          next = { type: 'doc', content: [...content, imageNode] };
        } else if (typeof pos === 'object' && pos !== null && 'afterHeading' in pos) {
          const idx = findHeading(content, String(pos.afterHeading));
          if (idx < 0) return err('NOT_FOUND', `The heading "${pos.afterHeading}" was not found.`);
          next = { type: 'doc', content: [...content.slice(0, idx + 1), imageNode, ...content.slice(idx + 1)] };
        } else if (typeof pos === 'object' && pos !== null && 'pos' in pos) {
          const node = wordpadSchema.nodeFromJSON(doc);
          const p = pos.pos;
          if (!Number.isInteger(p) || p < 0 || p > node.content.size) return err('VALIDATION', 'The position is outside the document.');
          try {
            const slice = new Slice(Fragment.from(wordpadSchema.nodeFromJSON(imageNode)), 0, 0);
            next = node.replace(p, p, slice).toJSON() as TipTapJSON;
          } catch {
            return err('VALIDATION', 'An image cannot be placed at that position.');
          }
        } else {
          return err('VALIDATION', 'Unknown image position.');
        }
        const r = await storeDoc(loaded.value.node.id, next, 'insertImage');
        return r.ok ? ok({ documentId: r.value.fileId }) : r;
      }),

    createDrawing: (i) =>
      guard(async () => {
        if (typeof i?.path !== 'string' || i.path.trim() === '') return err('VALIDATION', 'A drawing path is required.');
        let path = i.path;
        const ext = lastExt(path);
        if (!ext) path += '.png';
        else if (ext !== 'png') return err('UNSUPPORTED_TYPE', `Drawings are saved as PNG, not .${ext}.`);

        let bytes: ArrayBuffer;
        if (i.imageBase64 !== undefined) {
          const img = readImageBytes(i.imageBase64, 'png');
          if (!img.ok) return img;
          bytes = img.value.bytes.slice().buffer as ArrayBuffer;
        } else {
          const w = i.width ?? 640;
          const h = i.height ?? 480;
          if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > MAX_BLANK_PIXELS) {
            return err('VALIDATION', 'The drawing size is invalid.');
          }
          bytes = await encodeBlankPng(w, h);
        }
        return core.saveFile({ path, cwd: i.cwd, bytes, mime: 'image/png', overwrite: i.overwrite });
      }),

    updateDrawing: (i) =>
      guard(async () => {
        if (typeof i?.fileId !== 'string' || i.fileId === '') return err('VALIDATION', 'A drawing id is required.');
        const node = await vfs.get(i.fileId);
        if (!node) return err('NOT_FOUND', 'The drawing was not found.', { id: i.fileId });
        const ext = node.ext === 'jpeg' ? 'jpg' : node.ext;
        if (node.kind !== 'file' || (ext !== 'png' && ext !== 'jpg')) return err('UNSUPPORTED_TYPE', `"${node.name}" is not a PNG or JPG image.`);
        const img = readImageBytes(i.imageBase64, ext);
        if (!img.ok) return img;
        const w = await vfs.write(node.id, img.value.bytes.slice().buffer as ArrayBuffer, { mime: ext === 'png' ? 'image/png' : 'image/jpeg' });
        return w.ok ? ok({ fileId: node.id }) : w;
      }),
  };
}
