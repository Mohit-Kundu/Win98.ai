import { err, ok, type Result } from '../../shared/errors';

/** Pure file-type rules. No VFS access, so apps and actions may both import this module. */

export type FileAppId = 'paint' | 'wordpad' | 'pdfPreview';

const EXT_TO_APP: Record<string, FileAppId> = {
  png: 'paint',
  jpg: 'paint',
  jpeg: 'paint',
  wpd: 'wordpad',
  txt: 'wordpad',
  md: 'wordpad',
  pdf: 'pdfPreview',
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const ALLOWED_UPLOAD = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
} as const;

export type UploadExt = keyof typeof ALLOWED_UPLOAD;

/** Lowercase extension without the dot, or '' when the name has none. */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

/** Map a file name to the application that opens it (case-insensitive extension). */
export function appForFileName(name: string): Result<FileAppId> {
  const ext = extensionOf(name);
  const app = Object.hasOwn(EXT_TO_APP, ext) ? EXT_TO_APP[ext] : undefined;
  if (!app) {
    return err('UNSUPPORTED_TYPE', `Files of type ".${ext}" are not supported.`, { ext });
  }
  return ok(app);
}

/** Validate an upload by name and size. Allowed: pdf, txt, md, png, jpg, jpeg up to 20 MB. */
export function validateUpload(name: string, size: number): Result<{ ext: UploadExt }> {
  const ext = extensionOf(name);
  if (!Object.hasOwn(ALLOWED_UPLOAD, ext)) {
    return err(
      'UNSUPPORTED_TYPE',
      `Files of type ".${ext}" are not supported. Allowed types: PDF, TXT, MD, PNG, JPG, JPEG.`,
      { ext },
    );
  }
  if (!Number.isFinite(size) || size < 0 || size > MAX_UPLOAD_BYTES) {
    return err('TOO_LARGE', 'The file is larger than the 20 MB upload limit.', { size });
  }
  return ok({ ext: ext as UploadExt });
}
