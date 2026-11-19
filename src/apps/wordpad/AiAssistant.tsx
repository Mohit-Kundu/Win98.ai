import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { textTransform, type TextTransformMode } from '../../actions';

export const AI_MODES: ReadonlyArray<{ mode: TextTransformMode; label: string }> = [
  { mode: 'generate', label: 'Generate...' },
  { mode: 'rewrite', label: 'Rewrite' },
  { mode: 'summarize', label: 'Summarize' },
  { mode: 'proofread', label: 'Proofread' },
  { mode: 'expand', label: 'Expand' },
];

export interface AiPreview {
  mode: TextTransformMode;
  /** The text that was sent, shown next to the result. */
  original: string;
  /** Result as plain text or limited Markdown. */
  text: string;
  /** Sanitized HTML of the result. */
  html: string;
  /** True when no text was selected, so Accept replaces the whole document. */
  whole: boolean;
}

export type AiState =
  | { phase: 'idle' }
  | { phase: 'loading'; mode: TextTransformMode }
  | ({ phase: 'preview' } & AiPreview);

interface Captured {
  from: number;
  to: number;
  text: string;
  whole: boolean;
}

const docText = (e: Editor, from: number, to: number): string => e.state.doc.textBetween(from, to, '\n');

/**
 * State and actions for the WordPad AI assistant.
 * The range is captured when a request starts and mapped through every later transaction,
 * so it still points at the same text if the user edits elsewhere while waiting.
 */
export function useWordPadAi(editor: Editor | null, onError: (message: string) => void) {
  const [state, setState] = useState<AiState>({ phase: 'idle' });
  const captured = useRef<Captured | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!editor) return;
    const onTr = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map(pos: number, assoc?: number): number } } }) => {
      const c = captured.current;
      if (!c || !transaction.docChanged) return;
      if (c.whole) return;
      c.from = transaction.mapping.map(c.from, 1);
      c.to = Math.max(c.from, transaction.mapping.map(c.to, -1));
    };
    editor.on('transaction', onTr);
    return () => {
      editor.off('transaction', onTr);
    };
  }, [editor]);

  useEffect(() => () => abort.current?.abort(), []);

  const clear = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    captured.current = null;
    setState({ phase: 'idle' });
  }, []);

  const run = useCallback(
    async (mode: TextTransformMode, instruction?: string) => {
      if (!editor || state.phase === 'loading') return;
      const { from, to } = editor.state.selection;
      const whole = from === to;
      const text = whole ? editor.getText({ blockSeparator: '\n' }) : docText(editor, from, to);
      if (mode !== 'generate' && text.trim() === '') {
        onError(whole ? 'The document is empty. Type some text first.' : 'The selection has no text.');
        return;
      }
      if (mode === 'generate' && text.trim() === '' && !instruction?.trim()) return;
      captured.current = whole ? { from: 0, to: editor.state.doc.content.size, text, whole } : { from, to, text, whole };
      const ctl = new AbortController();
      abort.current = ctl;
      setState({ phase: 'loading', mode });
      const r = await textTransform(
        {
          mode,
          ...(text.trim() !== '' ? { text } : {}),
          ...(instruction?.trim() ? { instruction: instruction.trim() } : {}),
        },
        { signal: ctl.signal },
      );
      if (abort.current !== ctl) return; // cancelled or superseded
      abort.current = null;
      if (!r.ok) {
        captured.current = null;
        setState({ phase: 'idle' });
        onError(`The AI request failed. ${r.error.message}`);
        return;
      }
      setState({ phase: 'preview', mode, original: text, text: r.value.text, html: r.value.html, whole });
    },
    [editor, state.phase, onError],
  );

  const accept = useCallback(() => {
    const c = captured.current;
    if (!editor || !c || state.phase !== 'preview') return;
    const from = c.whole ? 0 : c.from;
    const to = c.whole ? editor.state.doc.content.size : c.to;
    const now = c.whole ? editor.getText({ blockSeparator: '\n' }) : docText(editor, from, to);
    if (now !== c.text) {
      onError('The text changed while the AI was working, so the result was not applied. Try again.');
      return; // keep the preview so the user can still copy or reject it
    }
    // A single transaction, so one undo step restores the original.
    // A one-paragraph result replacing part of a paragraph goes in as inline text, not a split block.
    const inline = !c.whole ? /^<p>((?:(?!<\/?(?:p|h[1-6]|ul|ol|li|blockquote)\b).)*)<\/p>$/s.exec(state.html) : null;
    const done = editor.chain().insertContentAt({ from, to }, inline ? inline[1]! : state.html).run();
    if (!done) {
      onError('The result could not be applied.');
      return;
    }
    clear();
  }, [editor, state, onError, clear]);

  return { state, run, accept, reject: clear };
}

export function AiMenu({
  disabled,
  onPick,
  onToggle,
  open,
}: {
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  onPick: (mode: TextTransformMode) => void;
}) {
  return (
    <div className="wp-menu">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>
        AI
      </button>
      {open && (
        <ul className="wp-menu-list" role="menu" aria-label="AI">
          {AI_MODES.map(({ mode, label }) => (
            <li role="none" key={mode}>
              <button type="button" role="menuitem" disabled={disabled} onClick={() => onPick(mode)}>
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PreviewPanel({
  state,
  onAccept,
  onReject,
}: {
  state: AiState;
  onAccept: () => void;
  onReject: () => void;
}) {
  if (state.phase === 'idle') return null;
  if (state.phase === 'loading') {
    return (
      <div className="wp-ai-panel" role="status" aria-label="AI preview">
        <span>Working on {state.mode}...</span>
        <button type="button" onClick={onReject}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="wp-ai-panel" role="region" aria-label="AI preview">
      <div className="wp-ai-title">
        AI preview ({state.mode}) &mdash; {state.whole ? 'replaces the whole document' : 'replaces the selection'}
      </div>
      <div className="wp-ai-cols">
        <div>
          <div className="wp-ai-label">Original</div>
          <pre className="wp-ai-text" aria-label="Original text">
            {state.original}
          </pre>
        </div>
        <div>
          <div className="wp-ai-label">Result</div>
          <pre className="wp-ai-text" aria-label="AI result">
            {state.text}
          </pre>
        </div>
      </div>
      <div className="wp-ai-buttons">
        <button type="button" onClick={onAccept}>
          Accept
        </button>
        <button type="button" onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}
