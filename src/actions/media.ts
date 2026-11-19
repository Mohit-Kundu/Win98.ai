import { err, ok, type Result } from '../../shared/errors';
import { vfs as sharedVfs, type VfsService } from '../vfs/service';
import { sniffImage } from './png';

export interface ImageFile {
  fileId: string;
  name: string;
  ext: 'png' | 'jpg';
  path: string;
  bytes: ArrayBuffer;
}

/** Read a PNG or JPG file from the VFS. Never throws. */
export async function readImageFile(fileId: string, vfs: VfsService = sharedVfs): Promise<Result<ImageFile>> {
  try {
    if (typeof fileId !== 'string' || fileId === '') return err('VALIDATION', 'An image id is required.');
    const r = await vfs.read(fileId);
    if (!r.ok) return r;
    const { node, bytes } = r.value;
    const kind = node.kind === 'file' ? sniffImage(new Uint8Array(bytes)) : null;
    if (!kind) return err('UNSUPPORTED_TYPE', `"${node.name}" is not a PNG or JPG image.`);
    return ok({ fileId: node.id, name: node.name, ext: kind, path: await vfs.pathOf(node.id), bytes });
  } catch (e) {
    return err('WRITE_FAILED', 'The image could not be read.', { cause: e instanceof Error ? e.message : String(e) });
  }
}
