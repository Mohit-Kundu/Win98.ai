/** Browser-side extractors used by the MetadataService. Tests inject replacements. */

/** Pages read for text extraction. */
export const MAX_EXTRACT_PAGES = 50;
/** Stored `meta.extractedText` cap (Design: 200 KB). */
export const MAX_EXTRACTED_CHARS = 200_000;
/** Longest side of an image sent for analysis. */
export const MAX_IMAGE_SIDE = 1024;
/** Largest raw image sent when downscaling is not possible. */
const MAX_RAW_IMAGE_BYTES = 1_000_000;

export type PdfTextExtractor = (bytes: ArrayBuffer) => Promise<string>;
export type ImagePreparer = (bytes: ArrayBuffer, mime: string) => Promise<string>;

/** Extract plain text from a PDF with PDF.js (loaded lazily). Throws when the PDF cannot be read. */
export const extractPdfText: PdfTextExtractor = async (bytes) => {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    let total = 0;
    const count = Math.min(doc.numPages, MAX_EXTRACT_PAGES);
    for (let n = 1; n <= count && total < MAX_EXTRACTED_CHARS; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const line = content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim();
      if (line) {
        parts.push(line);
        total += line.length + 1;
      }
    }
    return parts.join('\n').slice(0, MAX_EXTRACTED_CHARS);
  } finally {
    await task.destroy();
  }
};

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Downscale an image to at most 1024 px on the long side and return it as base64 PNG. */
export const prepareImageForAnalysis: ImagePreparer = async (bytes, mime) => {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const url = canvas.toDataURL('image/png');
    const b64 = url.slice(url.indexOf(',') + 1);
    if (!b64) throw new Error('Could not encode the image.');
    return b64;
  } catch (e) {
    // Without a canvas, send the original only when it is small.
    if (bytes.byteLength <= MAX_RAW_IMAGE_BYTES) return bytesToBase64(new Uint8Array(bytes));
    throw e;
  }
};
