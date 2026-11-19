import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { actions, readPdfFile } from '../../src/actions';
import { buildPreviewDoc, PdfPreview, setPdfRenderer } from '../../src/apps/pdfPreview/PdfPreview';
import { registerApp, unregisterApp } from '../../src/desktop/appRegistry';
import { useWindowStore } from '../../src/store/windows';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

async function save(path: string, data: ArrayBuffer, mime: string) {
  const r = await actions.saveFile({ path, bytes: data, mime, overwrite: true });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.fileId;
}

afterEach(() => {
  cleanup();
  setPdfRenderer(null);
  unregisterApp('pdfPreview');
});

describe('PDF preview', () => {
  it('readPdfFile rejects non-PDF files with UNSUPPORTED_TYPE', async () => {
    const id = await save('C:\\Desktop\\plain.txt', bytes('x'), 'text/plain');
    const r = await readPdfFile(id);
    expect(!r.ok && r.error.code).toBe('UNSUPPORTED_TYPE');
  });

  it('shows rendered pages in a fully sandboxed iframe', async () => {
    const id = await save('C:\\Desktop\\a.pdf', bytes('%PDF-1.4'), 'application/pdf');
    setPdfRenderer(async () => ({ pages: ['data:image/png;base64,AAAA'], totalPages: 3 }));
    render(<PdfPreview windowId="w" launchArgs={{ fileId: id }} />);
    const frame = (await screen.findByTitle('a.pdf preview')) as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('data:image/png;base64,AAAA');
    expect(screen.getByText('Showing 1 of 3 pages')).toBeTruthy();
  });

  it('reports a render failure instead of an empty frame', async () => {
    const id = await save('C:\\Desktop\\bad.pdf', bytes('nope'), 'application/pdf');
    setPdfRenderer(async () => {
      throw new Error('bad');
    });
    render(<PdfPreview windowId="w" launchArgs={{ fileId: id }} />);
    expect((await screen.findByRole('alert')).textContent).toContain('could not be displayed');
  });

  it('only embeds PNG data URLs in the preview document', () => {
    const doc = buildPreviewDoc(['javascript:alert(1)', 'data:image/png;base64,QQ==', 'data:text/html,<script>']);
    expect(doc.match(/<img/g)?.length).toBe(1);
    expect(doc).not.toContain('javascript:');
  });

  it('opening a PDF from actions launches pdfPreview with the node', async () => {
    const id = await save('C:\\Desktop\\open.pdf', bytes('%PDF-1.4'), 'application/pdf');
    useWindowStore.setState({ windows: {}, order: [], focusedId: null });
    registerApp({ id: 'pdfPreview', title: 'PDF Preview', icon: 'document', component: () => null, fileExtensions: ['pdf'], singleInstance: false });
    const r = await actions.openFile({ fileId: id });
    expect(r.ok && r.value.appId).toBe('pdfPreview');
    await waitFor(() =>
      expect(Object.values(useWindowStore.getState().windows).some((w) => w.appId === 'pdfPreview' && (w.launchArgs as { fileId: string }).fileId === id)).toBe(true),
    );
    await actions.deleteNode({ nodeId: id });
  });
});
