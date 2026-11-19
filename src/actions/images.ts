import type { GenerateImageRequest, GenerateImageResponse } from '../../shared/api-contracts';
import { err, ok, type Result } from '../../shared/errors';
import type { CreateDrawingInput } from './documents';
import { decodeBase64, sniffImage } from './png';

export const DEFAULT_IMAGE_FOLDER = 'C:\\My Pictures';

export interface GenerateImageInput {
  prompt: string;
  /** Target PNG path. Defaults to a file in C:\My Pictures named after the prompt. */
  path?: string;
  cwd?: string;
  aspect?: GenerateImageRequest['aspect'];
  overwrite?: boolean;
  signal?: AbortSignal;
}

export interface ImageActions {
  /** Ask the AI proxy for an image and save it as a PNG. Returns only the node id and path. */
  generateImage(i: GenerateImageInput): Promise<Result<{ fileId: string; path: string }>>;
}

export interface ImageDeps {
  ai: { generateImage(req: GenerateImageRequest, opts?: { signal?: AbortSignal }): Promise<Result<GenerateImageResponse>> };
  drawings: { createDrawing(i: CreateDrawingInput): Promise<Result<{ fileId: string; path: string }>> };
  /** Re-encodes non-PNG image bytes to PNG. Defaults to a browser canvas implementation. */
  toPng?: (bytes: Uint8Array) => Promise<Uint8Array | null>;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function canvasToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
    const bmp = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer]));
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

function defaultPath(prompt: string): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image';
  return `${DEFAULT_IMAGE_FOLDER}\\${slug}.png`;
}

export interface ImageDataActions {
  /** Ask the AI proxy for an image and return it as base64 PNG without saving anything. */
  generateImageData(i: { prompt: string; aspect?: GenerateImageRequest['aspect']; signal?: AbortSignal }): Promise<Result<{ mimeType: 'image/png'; dataBase64: string }>>;
}

export function createImageActions({ ai, drawings, toPng = canvasToPng }: ImageDeps): ImageActions & ImageDataActions {
  return {
    async generateImageData(i) {
      if (typeof i?.prompt !== 'string' || i.prompt.trim() === '') return err('VALIDATION', 'An image prompt is required.');
      const res = await ai.generateImage({ prompt: i.prompt, aspect: i.aspect }, { signal: i.signal });
      if (!res.ok) return res;
      let bytes = decodeBase64(res.value.dataBase64);
      if (!bytes || !sniffImage(bytes)) return err('AI_FAILED', 'The AI service returned an unreadable image.');
      if (sniffImage(bytes) !== 'png') {
        const png = await toPng(bytes);
        if (!png || sniffImage(png) !== 'png') return err('AI_FAILED', 'The generated image could not be converted to PNG.');
        bytes = png;
      }
      return ok({ mimeType: 'image/png' as const, dataBase64: toBase64(bytes) });
    },
    async generateImage(i) {
      if (typeof i?.prompt !== 'string' || i.prompt.trim() === '') return err('VALIDATION', 'An image prompt is required.');
      const res = await ai.generateImage({ prompt: i.prompt, aspect: i.aspect }, { signal: i.signal });
      if (!res.ok) return res;
      let bytes = decodeBase64(res.value.dataBase64);
      if (!bytes || !sniffImage(bytes)) return err('AI_FAILED', 'The AI service returned an unreadable image.');
      if (sniffImage(bytes) !== 'png') {
        const png = await toPng(bytes);
        if (!png || sniffImage(png) !== 'png') return err('AI_FAILED', 'The generated image could not be converted to PNG.');
        bytes = png;
      }
      const saved = await drawings.createDrawing({
        path: i.path?.trim() ? i.path : defaultPath(i.prompt),
        cwd: i.cwd,
        imageBase64: toBase64(bytes),
        overwrite: i.overwrite,
      });
      return saved.ok ? ok({ fileId: saved.value.fileId, path: saved.value.path }) : saved;
    },
  };
}
