import type { Result } from '../../actions';

/**
 * Programmatic canvas API for a Paint window. Task 9.1 (AI image generation)
 * uses it to place images on the canvas. Loading never changes the canvas on failure.
 */
export interface PaintController {
  /** Replace the canvas with the image stored in the VFS. `asNewDrawing` detaches from the file so Save asks for a name. */
  loadImageFromFileId(fileId: string, opts?: { asNewDrawing?: boolean }): Promise<Result<{ width: number; height: number }>>;
  /** Replace the canvas with a base64 (or data URL) PNG/JPEG image, as an unsaved new drawing. */
  loadImageFromBase64(base64: string, opts?: { keepHistory?: boolean }): Promise<Result<{ width: number; height: number }>>;
}

const controllers = new Map<string, PaintController>();

export function registerPaintController(windowId: string, c: PaintController): () => void {
  controllers.set(windowId, c);
  return () => {
    if (controllers.get(windowId) === c) controllers.delete(windowId);
  };
}

export function getPaintController(windowId: string): PaintController | undefined {
  return controllers.get(windowId);
}
