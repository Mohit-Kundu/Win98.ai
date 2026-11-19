/** Maximum pages rendered in the preview. */
export const MAX_PREVIEW_PAGES = 50;

export interface RenderedPdf {
  /** PNG data URLs, one per page. */
  pages: string[];
  totalPages: number;
}

/** Renders PDF bytes to page images with PDF.js (loaded lazily). Tests may inject a replacement. */
export type PdfRenderer = (bytes: ArrayBuffer) => Promise<RenderedPdf>;

export const renderPdfWithPdfJs: PdfRenderer = async (bytes) => {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    const count = Math.min(doc.numPages, MAX_PREVIEW_PAGES);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1.25 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const canvasContext = canvas.getContext('2d');
      if (!canvasContext) throw new Error('Canvas is not available.');
      await page.render({ canvas, canvasContext, viewport }).promise;
      pages.push(canvas.toDataURL('image/png'));
    }
    return { pages, totalPages: doc.numPages };
  } finally {
    await task.destroy();
  }
};
