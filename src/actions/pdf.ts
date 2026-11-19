import { err, ok, type Result } from '../../shared/errors';
import { vfs as sharedVfs, type VfsService } from '../vfs/service';
import { extensionOf } from './associations';

export interface PdfFile {
  fileId: string;
  name: string;
  path: string;
  bytes: ArrayBuffer;
}

/** Read a PDF file from the VFS. Never throws. */
export async function readPdfFile(fileId: string, vfs: VfsService = sharedVfs): Promise<Result<PdfFile>> {
  try {
    if (typeof fileId !== 'string' || fileId === '') return err('VALIDATION', 'A PDF id is required.');
    const r = await vfs.read(fileId);
    if (!r.ok) return r;
    const { node, bytes } = r.value;
    if (node.kind !== 'file' || extensionOf(node.name) !== 'pdf') {
      return err('UNSUPPORTED_TYPE', `"${node.name}" is not a PDF file.`);
    }
    return ok({ fileId: node.id, name: node.name, path: await vfs.pathOf(node.id), bytes });
  } catch (e) {
    return err('WRITE_FAILED', 'The PDF could not be read.', { cause: e instanceof Error ? e.message : String(e) });
  }
}
