import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { documentActions } from '../../src/actions';
import { WordPad } from '../../src/apps/wordpad/WordPad';
import { getWordPadHandle } from '../../src/apps/wordpad/handle';

let n = 0;
async function mkDoc(html: string) {
  const r = await documentActions.createDocument({ path: `C:\\My Documents\\ai-${Date.now()}-${n++}.wpd`, contentHtml: html });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const ORIGINAL = 'alpha beta gamma\nsecond para';
const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

/** Stub only the network edge. The reply mirrors the mock proxy: `[mode] text`. */
function stubProxy(opts: { fail?: boolean; gate?: Promise<void> } = {}) {
  const calls: Array<{ mode: string; text?: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { mode: string; text?: string };
      calls.push(body);
      await opts.gate;
      if (opts.fail) return json(502, { error: { code: 'AI_FAILED', message: 'The AI service failed.' } });
      return json(200, { text: `[${body.mode}] ${body.text ?? ''}` });
    }),
  );
  return calls;
}

beforeAll(() => {
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(id: string) {
  const d = await mkDoc('<p>alpha beta gamma</p><p>second para</p>');
  render(<WordPad windowId={id} launchArgs={{ fileId: d.fileId }} />);
  await screen.findByText('second para');
  return getWordPadHandle(id)!;
}

const pick = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'AI' }));
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
};

describe('WordPad AI assistant', () => {
  it('shows a preview and leaves the document unchanged on Reject', async () => {
    const calls = stubProxy();
    const h = await open('ai1');
    act(() => void h.setSelection(7, 11));
    pick('Rewrite');
    const panel = await screen.findByRole('region', { name: 'AI preview' });
    expect(calls).toEqual([{ mode: 'rewrite', text: 'beta' }]);
    expect(within(panel).getByLabelText('AI result').textContent).toBe('[rewrite] beta');
    expect(h.getText()).toBe(ORIGINAL);
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject' }));
    expect(screen.queryByRole('region', { name: 'AI preview' })).toBeNull();
    expect(h.getText()).toBe(ORIGINAL);
    expect(screen.getByRole('status').textContent).not.toContain('*');
  });

  it('Accept replaces only the selection, in one undo step', async () => {
    stubProxy();
    const h = await open('ai2');
    act(() => void h.setSelection(7, 11));
    pick('Rewrite');
    const accept = await screen.findByRole('button', { name: 'Accept' });
    // ProseMirror history groups changes made within 500 ms; wait so the document load is a separate step.
    await new Promise((r) => setTimeout(r, 600));
    fireEvent.click(accept);
    await waitFor(() => expect(h.getText()).toBe('alpha [rewrite] beta gamma\nsecond para'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo', hidden: false }));
    await waitFor(() => expect(h.getText()).toBe(ORIGINAL));
  });

  it('Accept replaces the whole document when nothing is selected', async () => {
    const calls = stubProxy();
    const h = await open('ai3');
    act(() => void h.setSelection(1, 1));
    pick('Summarize');
    const panel = await screen.findByRole('region', { name: 'AI preview' });
    expect(calls[0]).toEqual({ mode: 'summarize', text: ORIGINAL });
    expect(panel.textContent).toContain('whole document');
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(h.getText()).toBe(`[summarize] alpha beta gamma\nsecond para`));
  });

  it('keeps the document unchanged and reports an error when the request fails', async () => {
    stubProxy({ fail: true });
    const h = await open('ai4');
    act(() => void h.setSelection(7, 11));
    pick('Expand');
    const dlg = await screen.findByRole('dialog');
    expect(dlg.textContent).toContain('The AI request failed');
    expect(screen.queryByRole('region', { name: 'AI preview' })).toBeNull();
    expect(h.getText()).toBe(ORIGINAL);
  });

  it('maps the captured range through edits made while waiting', async () => {
    let release!: () => void;
    stubProxy({ gate: new Promise<void>((r) => (release = r)) });
    const h = await open('ai5');
    act(() => void h.setSelection(7, 11));
    pick('Rewrite');
    await screen.findByText(/Working on rewrite/);
    act(() => void h.replaceRange(1, 1, 'ZZ '));
    release();
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(h.getText()).toBe('ZZ alpha [rewrite] beta gamma\nsecond para'));
  });

  it('refuses Accept when the captured text changed', async () => {
    let release!: () => void;
    stubProxy({ gate: new Promise<void>((r) => (release = r)) });
    const h = await open('ai6');
    act(() => void h.setSelection(7, 11));
    pick('Rewrite');
    await screen.findByText(/Working on rewrite/);
    act(() => void h.replaceRange(8, 10, 'XX'));
    release();
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    const dlg = await screen.findByRole('dialog');
    expect(dlg.textContent).toContain('text changed');
    expect(h.getText()).toBe('alpha bXXa gamma\nsecond para');
  });
});
