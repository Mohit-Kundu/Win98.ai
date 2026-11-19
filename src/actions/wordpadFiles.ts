import { err, ok, type Result } from '../../shared/errors';
import { vfs as sharedVfs, type VfsService } from '../vfs/service';
import { extOf } from '../vfs/paths';
import { createCoreActions } from './core';
import type { CoreActions, NodeRecord } from './types';
import {
  checkDoc,
  htmlToTiptapJson,
  parseWpd,
  serializeWpd,
  tiptapToPlainText,
  WPD_EXT,
  WPD_MIME,
  type TipTapJSON,
} from './wordpad/format';

export type WordpadFormat = 'wpd' | 'txt' | 'md';

export interface LoadedWordpadFile {
  node: NodeRecord;
  path: string;
  doc: TipTapJSON;
  format: WordpadFormat;
}

export interface SaveWordpadInput {
  /** Existing file to update in place (the user's own open file, so no overwrite prompt). */
  fileId?: string;
  /** New target path. A missing extension becomes `.wpd`. Existing targets need `overwrite: true`. */
  path?: string;
  doc: TipTapJSON;
  overwrite?: boolean;
}

export interface WordpadFiles {
  /** Raw bytes of a file, for rendering images in the editor. */
  readBytes(fileId: string): Promise<Result<{ node: NodeRecord; bytes: ArrayBuffer }>>;
  /** Open a `.wpd`, `.txt`, or `.md` file as a sanitized WordPad document. */
  load(i: { fileId?: string; path?: string }): Promise<Result<LoadedWordpadFile>>;
  save(i: SaveWordpadInput): Promise<Result<{ fileId: string; path: string; format: WordpadFormat }>>;
  /** Notify when the stored file is updated, renamed, or deleted by any writer. */
  subscribe(fileId: string, fn: (type: 'updated' | 'renamed' | 'deleted') => void): () => void;
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

const inlineMd = (s: string): string =>
  escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

/** Small Markdown subset (headings, bullets, bold, italic). The result is sanitized by the caller. */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) out.push('</ul>');
    inList = false;
  };
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (li) {
      if (!inList) out.push('<ul>');
      inList = true;
      out.push(`<li><p>${inlineMd(li[1]!)}</p></li>`);
      continue;
    }
    closeList();
    if (h) out.push(`<h${h[1]!.length}>${inlineMd(h[2]!)}</h${h[1]!.length}>`);
    else if (line.trim() !== '') out.push(`<p>${inlineMd(line)}</p>`);
  }
  closeList();
  return out.join('');
}

const formatOf = (ext: string | undefined): WordpadFormat | null => (ext === 'wpd' || ext === 'txt' || ext === 'md' ? ext : null);

export interface WordpadFilesDeps {
  vfs: VfsService;
  core: Pick<CoreActions, 'saveFile'>;
}

export function createWordpadFiles({ vfs, core }: WordpadFilesDeps): WordpadFiles {
  const toBuffer = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

  return {
    readBytes: async (fileId) => {
      try {
        return await vfs.read(fileId);
      } catch {
        return err('NOT_FOUND', 'The file could not be read.');
      }
    },

    load: async (i) => {
      try {
        let node: NodeRecord | undefined;
        if (i.fileId !== undefined) {
          node = await vfs.get(i.fileId);
          if (!node) return err('NOT_FOUND', 'The file was not found.', { id: i.fileId });
        } else if (i.path !== undefined) {
          const r = await vfs.resolve(i.path);
          if (!r.ok) return r;
          node = r.value;
        } else {
          return err('VALIDATION', 'Provide a file id or a path.');
        }
        if (node.kind !== 'file') return err('INVALID_PATH', `"${node.name}" is a folder.`);
        const format = formatOf(node.ext);
        if (!format) return err('UNSUPPORTED_TYPE', `WordPad cannot open .${node.ext ?? ''} files ("${node.name}").`);
        const read = await vfs.read(node.id);
        if (!read.ok) return read;
        const path = await vfs.pathOf(node.id);
        let doc: TipTapJSON;
        if (format === 'wpd') {
          const parsed = parseWpd(read.value.bytes);
          if (!parsed.ok) return parsed;
          doc = parsed.value;
        } else {
          const text = new TextDecoder().decode(read.value.bytes);
          doc = htmlToTiptapJson(format === 'md' ? markdownToHtml(text) : textToHtml(text));
        }
        return ok({ node: read.value.node, path, doc, format });
      } catch (e) {
        return err('WRITE_FAILED', 'The file could not be opened.', { cause: e instanceof Error ? e.message : String(e) });
      }
    },

    save: async (i) => {
      try {
        try {
          checkDoc(i.doc);
        } catch {
          return err('VALIDATION', 'The document is not valid and was not saved.');
        }
        let ext: string | undefined;
        let path = i.path;
        if (i.fileId !== undefined) {
          const node = await vfs.get(i.fileId);
          if (!node) return err('NOT_FOUND', 'The file was not found.', { id: i.fileId });
          ext = node.ext;
        } else if (path !== undefined && path.trim() !== '') {
          ext = extOf(path.split(/[\\/]/).pop() ?? '');
          if (!ext) {
            path += `.${WPD_EXT}`;
            ext = WPD_EXT;
          }
        } else {
          return err('VALIDATION', 'Provide a file id or a path to save to.');
        }
        const format = formatOf(ext);
        if (!format) return err('UNSUPPORTED_TYPE', `WordPad saves .wpd, .txt, and .md files, not .${ext}.`);
        const text = format === 'wpd' ? '' : tiptapToPlainText(i.doc);
        const saved = await core.saveFile({
          fileId: i.fileId,
          path: i.fileId === undefined ? path : undefined,
          bytes: format === 'wpd' ? serializeWpd(i.doc) : toBuffer(text),
          mime: format === 'wpd' ? WPD_MIME : format === 'md' ? 'text/markdown' : 'text/plain',
          overwrite: i.fileId !== undefined ? true : i.overwrite,
        });
        return saved.ok ? ok({ ...saved.value, format }) : saved;
      } catch (e) {
        return err('WRITE_FAILED', 'The file could not be saved.', { cause: e instanceof Error ? e.message : String(e) });
      }
    },

    subscribe: (fileId, fn) =>
      vfs.subscribe((e) => {
        if (e.nodeId !== fileId) return;
        if (e.type === 'updated') fn('updated');
        else if (e.type === 'renamed') fn('renamed');
        else if (e.type === 'deleted') fn('deleted');
      }),
  };
}

/** WordPad file actions bound to the shared VFS. */
export const wordpadFiles = createWordpadFiles({
  vfs: sharedVfs,
  core: createCoreActions({ vfs: sharedVfs, launch: () => null }),
});
