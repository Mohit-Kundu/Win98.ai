import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  actions,
  documentActions,
  htmlToTiptapJson,
  markdownToHtml,
  parseWpd,
  tiptapToPlainText,
  wordpadFiles,
} from '../../src/actions';
import { WordPad } from '../../src/apps/wordpad/WordPad';
import { getWordPadHandle } from '../../src/apps/wordpad/handle';

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
let n = 0;
const uniq = (ext: string) => `C:\\My Documents\\wp-${Date.now()}-${n++}.${ext}`;

async function mkDoc(html: string) {
  const r = await documentActions.createDocument({ path: uniq('wpd'), contentHtml: html });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

async function mkText(ext: string, text: string) {
  const r = await actions.saveFile({ path: uniq(ext), bytes: enc(text), mime: 'text/plain' });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

beforeAll(() => {
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
  // jsdom has no layout; ProseMirror calls these when scrolling the selection into view.
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
});
afterEach(cleanup);

describe('wordpadFiles', () => {
  it('opens .txt and .md as sanitized documents', async () => {
    const t = await mkText('txt', 'one <script>alert(1)</script>\ntwo');
    const lt = await wordpadFiles.load({ fileId: t.fileId });
    expect(lt.ok && lt.value.format).toBe('txt');
    expect(lt.ok && tiptapToPlainText(lt.value.doc)).toBe('one <script>alert(1)</script>\ntwo');

    const m = await mkText('md', '# Title\n- **a**\n- b <img src=x onerror=alert(1)>');
    const lm = await wordpadFiles.load({ fileId: m.fileId });
    if (!lm.ok) throw new Error('load failed');
    expect(lm.value.doc.content?.[0]?.type).toBe('heading');
    // Markup in Markdown is escaped to inert text, never parsed into an image node.
    expect(JSON.stringify(lm.value.doc)).not.toContain('"image"');
    expect(JSON.stringify(lm.value.doc)).toContain('bulletList');
  });

  it('saves .wpd with formatting and .txt as plain text', async () => {
    const doc = htmlToTiptapJson('<h1>Head</h1><p><strong>bold</strong></p>');
    const s = await wordpadFiles.save({ path: uniq('wpd'), doc });
    if (!s.ok) throw new Error(s.error.message);
    const bytes = await wordpadFiles.readBytes(s.value.fileId);
    expect(bytes.ok && parseWpd(bytes.value.bytes).ok).toBe(true);
    const again = await wordpadFiles.save({ path: s.value.path, doc });
    expect(!again.ok && again.error.code).toBe('CONFLICT_OVERWRITE');

    const t = await wordpadFiles.save({ path: uniq('txt'), doc });
    if (!t.ok) throw new Error(t.error.message);
    const loaded = await wordpadFiles.load({ fileId: t.value.fileId });
    expect(loaded.ok && tiptapToPlainText(loaded.value.doc)).toBe('Head\nbold');
  });

  it('converts markdown subset', () => {
    expect(markdownToHtml('## H\ntext *i*')).toBe('<h2>H</h2><p>text <em>i</em></p>');
  });
});

describe('WordPad app', () => {
  it('opens a document, shows content, and toggles bold from the toolbar', async () => {
    const d = await mkDoc('<h1>Report</h1><p>body text</p>');
    render(<WordPad windowId="wp1" launchArgs={{ fileId: d.fileId }} />);
    expect(await screen.findByText('Report')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(d.path);
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(bold);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true'));
  });

  it('shows an Image not found placeholder without altering the document', async () => {
    const d = await mkDoc('<p>x</p>');
    await documentActions.updateDocument({ fileId: d.fileId, mode: 'append', contentHtml: '<p>y</p>' });
    const r = await wordpadFiles.load({ fileId: d.fileId });
    if (!r.ok) throw new Error('load');
    const doc = { ...r.value.doc, content: [...(r.value.doc.content ?? []), { type: 'image', attrs: { vfsId: 'missing-id', alt: null, width: null } }] };
    const s = await wordpadFiles.save({ fileId: d.fileId, doc });
    expect(s.ok).toBe(true);
    render(<WordPad windowId="wp2" launchArgs={{ fileId: d.fileId }} />);
    expect(await screen.findByRole('img', { name: 'Image not found' })).toBeTruthy();
  });

  it('saves edits to the same file through the handle and Save', async () => {
    const d = await mkDoc('<p>hello world</p>');
    render(<WordPad windowId="wp3" launchArgs={{ fileId: d.fileId }} />);
    await screen.findByText('hello world');
    const h = getWordPadHandle('wp3')!;
    expect(h.fileId()).toBe(d.fileId);
    act(() => {
      h.replaceRange(1, 6, 'HOWDY');
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('*'));
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).not.toContain('*'));
    const r = await wordpadFiles.load({ fileId: d.fileId });
    expect(r.ok && tiptapToPlainText(r.value.doc)).toBe('HOWDY world');
  });

  it('reloads on external update when clean, and asks when there are local edits', async () => {
    const d = await mkDoc('<p>first</p>');
    render(<WordPad windowId="wp4" launchArgs={{ fileId: d.fileId }} />);
    await screen.findByText('first');
    await documentActions.updateDocument({ fileId: d.fileId, mode: 'replace', contentHtml: '<p>second</p>' });
    await screen.findByText('second');

    act(() => {
      getWordPadHandle('wp4')!.replaceRange(1, 7, 'mine');
    });
    await screen.findByText('mine');
    await documentActions.updateDocument({ fileId: d.fileId, mode: 'replace', contentHtml: '<p>theirs</p>' });
    const dlg = await screen.findByRole('dialog', { name: 'File Changed' });
    fireEvent.click(within(dlg).getByText('Keep mine'));
    expect(screen.getByText('mine')).toBeTruthy();

    await documentActions.updateDocument({ fileId: d.fileId, mode: 'replace', contentHtml: '<p>theirs2</p>' });
    const dlg2 = await screen.findByRole('dialog', { name: 'File Changed' });
    fireEvent.click(within(dlg2).getByText('Reload'));
    expect(await screen.findByText('theirs2')).toBeTruthy();
  });

  it('warns once before saving as plain text', async () => {
    const f = await mkText('txt', 'plain');
    render(<WordPad windowId="wp5" launchArgs={{ fileId: f.fileId }} />);
    await screen.findByText('plain');
    const save = () => {
      fireEvent.click(screen.getByRole('button', { name: 'File' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Save' }));
    };
    save();
    const dlg = await screen.findByRole('dialog', { name: 'Save As Text' });
    fireEvent.click(within(dlg).getByText('Save'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    save();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
