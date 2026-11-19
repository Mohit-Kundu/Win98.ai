import { useEffect, useState } from 'react';
import { readPdfFile } from '../../actions';
import type { AppProps } from '../../desktop/appRegistry';
import { renderPdfWithPdfJs, type PdfRenderer } from './renderPdf';

/** Swappable for tests, because jsdom has no canvas. */
let renderer: PdfRenderer = renderPdfWithPdfJs;
export function setPdfRenderer(r: PdfRenderer | null): void {
  renderer = r ?? renderPdfWithPdfJs;
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Static HTML for the sandboxed frame: page images only, no scripts. Only `data:image/png` sources are accepted. */
export function buildPreviewDoc(pages: string[]): string {
  const imgs = pages
    .filter((p) => p.startsWith('data:image/png;base64,'))
    .map((p, i) => `<img alt="Page ${i + 1}" src="${escapeAttr(p)}">`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#808080}img{display:block;max-width:100%;margin:4px auto;background:#fff}</style>${imgs}`;
}

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; doc: string; shown: number; total: number; name: string };

/** Read-only PDF preview. Pages are rendered by PDF.js into images shown in a fully sandboxed iframe. */
export function PdfPreview({ launchArgs }: AppProps) {
  const fileId = (launchArgs as { fileId?: unknown } | undefined)?.fileId;
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (typeof fileId !== 'string') return setState({ kind: 'error', message: 'No PDF file was specified.' });
      const file = await readPdfFile(fileId);
      if (cancelled) return;
      if (!file.ok) return setState({ kind: 'error', message: file.error.message });
      try {
        const out = await renderer(file.value.bytes);
        if (cancelled) return;
        setState({ kind: 'ready', doc: buildPreviewDoc(out.pages), shown: out.pages.length, total: out.totalPages, name: file.value.name });
      } catch {
        if (!cancelled) setState({ kind: 'error', message: 'This PDF could not be displayed.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (state.kind === 'loading') return <p style={{ padding: 8 }}>Loading...</p>;
  if (state.kind === 'error') return <p role="alert" style={{ padding: 8 }}>{state.message}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <iframe title={`${state.name} preview`} sandbox="" srcDoc={state.doc} style={{ flex: 1, border: 0, width: '100%' }} />
      <div className="status-bar">
        <p className="status-bar-field">
          {state.shown < state.total ? `Showing ${state.shown} of ${state.total} pages` : `${state.total} page(s)`}
        </p>
      </div>
    </div>
  );
}
