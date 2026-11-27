import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import {
  actions,
  documentBus,
  emptyDoc,
  sanitizeHtml,
  tiptapToPlainText,
  wordpadFiles,
  wordpadSchema,
  type LoadedWordpadFile,
  type TextTransformMode,
  type TipTapJSON,
  type WordpadFormat,
} from '../../actions';
import { AiMenu, PreviewPanel, useWordPadAi } from './AiAssistant';
import type { AppProps } from '../../desktop/appRegistry';
import { ConfirmDialog, MessageBox, PromptDialog } from '../../ui/dialogs';
import { editorExtensions } from './extensions';
import { useContextProvider } from '../../ai/context';
import { getWordPadHandle, registerWordPadHandle } from './handle';
import './wordpad.css';

export const DEFAULT_DOC_DIR = 'C:\\My Documents\\';
export const DEFAULT_IMAGE_DIR = 'C:\\My Pictures\\';

interface OpenFile {
  id: string;
  path: string;
  name: string;
  format: WordpadFormat;
}

type Dlg =
  | { kind: 'message'; title: string; text: string }
  | { kind: 'confirm'; title: string; text: string; yes: string; no: string; onYes: () => void; onNo?: () => void }
  | { kind: 'prompt'; title: string; label: string; initial: string; onSubmit: (v: string) => void };

/** Stable string form of a document, so edits and stored copies compare equal when they match. */
const norm = (doc: TipTapJSON): string => JSON.stringify(wordpadSchema.nodeFromJSON(doc).toJSON());

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;
const withDir = (value: string, dir: string): string => {
  const v = value.trim();
  return /[\\/]/.test(v) ? v : dir + v;
};
const formatOfPath = (p: string): string => {
  const name = baseName(p);
  const i = name.lastIndexOf('.');
  return i < 0 ? 'wpd' : name.slice(i + 1).toLowerCase();
};

const toOpenFile = (l: LoadedWordpadFile): OpenFile => ({ id: l.node.id, path: l.path, name: l.node.name, format: l.format });

function Menu({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="wp-menu">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>
        {label}
      </button>
      {open && (
        <ul className="wp-menu-list" role="menu" aria-label={label}>
          {children}
        </ul>
      )}
    </div>
  );
}

export function WordPad({ windowId, launchArgs }: AppProps) {
  useContextProvider('wordpad', windowId, () => {
    const h = getWordPadHandle(windowId);
    if (!h) return undefined;
    const sel = h.getSelection();
    return {
      app: 'wordpad',
      fileId: h.fileId() ?? undefined,
      path: h.path() ?? undefined,
      selection: sel.from === sel.to ? undefined : sel,
      docTextExcerpt: h.getText().slice(0, 2000),
    };
  });
  const initialId = (launchArgs as { fileId?: string } | undefined)?.fileId ?? null;
  const [file, setFile] = useState<OpenFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [margins, setMargins] = useState<Margins>({ left: 0, right: 0 });
  const savedRef = useRef(norm(emptyDoc()));
  const fileRef = useRef<OpenFile | null>(null);
  const warnedRef = useRef(false);
  const savingRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  fileRef.current = file;

  const editor = useEditor({
    extensions: editorExtensions,
    content: emptyDoc(),
    shouldRerenderOnTransaction: true,
    autofocus: 'end',
    editorProps: { attributes: { role: 'textbox', 'aria-label': 'Document', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: e }) => setDirty(norm(e.getJSON()) !== savedRef.current),
  });
  editorRef.current = editor;

  const showError = (text: string) => setDlg({ kind: 'message', title: 'WordPad', text });
  const closeThen = (fn: () => void) => () => {
    setDlg(null);
    fn();
  };

  /** Replace the editor content without marking the document as edited. */
  const applyDoc = useCallback(
    (doc: TipTapJSON) => {
      const e = editorRef.current;
      if (!e) return;
      e.commands.setContent(doc, { emitUpdate: false });
      savedRef.current = norm(e.getJSON());
      setDirty(false);
    },
    [],
  );

  const handleExternal = useCallback(
    (loaded: { doc: TipTapJSON; format: WordpadFormat; file?: OpenFile }) => {
      const e = editorRef.current;
      if (!e) return;
      if (loaded.file) setFile(loaded.file);
      const incoming = norm(loaded.doc);
      const current = norm(e.getJSON());
      if (incoming === savedRef.current) return;
      if (loaded.format !== 'wpd' && tiptapToPlainText(loaded.doc) === tiptapToPlainText(e.getJSON())) {
        savedRef.current = current;
        setDirty(false);
        return;
      }
      if (current === savedRef.current) {
        applyDoc(loaded.doc);
        return;
      }
      setDlg({
        kind: 'confirm',
        title: 'File Changed',
        text: 'This document was changed elsewhere, and you have unsaved changes. Reload it and lose your changes?',
        yes: 'Reload',
        no: 'Keep mine',
        onYes: () => {
          setDlg(null);
          applyDoc(loaded.doc);
        },
      });
    },
    [applyDoc],
  );

  // Initial load from launch arguments.
  useEffect(() => {
    if (!editor || !initialId) return;
    let cancelled = false;
    void wordpadFiles.load({ fileId: initialId }).then((r) => {
      if (cancelled) return;
      if (!r.ok) return showError(r.error.message);
      setFile(toOpenFile(r.value));
      applyDoc(r.value.doc);
    });
    return () => {
      cancelled = true;
    };
  }, [editor, initialId, applyDoc]);

  // Reload when the stored file changes, and show live updates from actions (Clippy, tools).
  const fileId = file?.id ?? null;
  useEffect(() => {
    if (!editor || !fileId) return;
    const unsubVfs = wordpadFiles.subscribe(fileId, (type) => {
      if (type === 'deleted' || savingRef.current) return;
      void wordpadFiles.load({ fileId }).then((r) => {
        if (r.ok && !savingRef.current) handleExternal({ doc: r.value.doc, format: r.value.format, file: toOpenFile(r.value) });
      });
    });
    const unsubBus = documentBus.subscribe((u) => {
      if (u.fileId === fileId) handleExternal({ doc: u.doc, format: fileRef.current?.format ?? 'wpd' });
    });
    return () => {
      unsubVfs();
      unsubBus();
    };
  }, [editor, fileId, handleExternal]);

  // Handle for the AI assistant and the Clippy context provider.
  useEffect(() => {
    if (!editor) return;
    return registerWordPadHandle({
      windowId,
      fileId: () => fileRef.current?.id ?? null,
      path: () => fileRef.current?.path ?? null,
      getSelection: () => {
        const { from, to } = editor.state.selection;
        return { from, to, text: editor.state.doc.textBetween(from, to, '\n') };
      },
      getText: () => editor.getText({ blockSeparator: '\n' }),
      setSelection: (from, to) => {
        if (from < 0 || to < from || to > editor.state.doc.content.size) return false;
        return editor.commands.setTextSelection({ from, to });
      },
      replaceRange: (from, to, html) => {
        if (from < 0 || to < from || to > editor.state.doc.content.size) return false;
        return editor.chain().insertContentAt({ from, to }, sanitizeHtml(html)).run();
      },
    });
  }, [editor, windowId]);

  const ai = useWordPadAi(editor, showError);
  const pickAi = (mode: TextTransformMode) => {
    setMenu(null);
    if (mode !== 'generate') return void ai.run(mode);
    setDlg({
      kind: 'prompt',
      title: 'Generate',
      label: 'What should the AI write?',
      initial: '',
      onSubmit: (v) => {
        setDlg(null);
        if (v.trim() !== '') void ai.run('generate', v);
      },
    });
  };

  const doSave = async (target: { fileId?: string; path?: string; overwrite?: boolean }) => {
    if (!editor) return;
    const doc = editor.getJSON();
    const prev = savedRef.current;
    savingRef.current = true;
    savedRef.current = norm(doc);
    const r = await wordpadFiles.save({ ...target, doc });
    savingRef.current = false;
    if (!r.ok) {
      savedRef.current = prev;
      setDirty(norm(editor.getJSON()) !== prev);
      if (r.error.code === 'CONFLICT_OVERWRITE') {
        setDlg({
          kind: 'confirm',
          title: 'Confirm Save',
          text: `${r.error.message.replace(' Confirm to overwrite it.', '')} Do you want to replace it?`,
          yes: 'Yes',
          no: 'No',
          onYes: closeThen(() => void doSave({ ...target, overwrite: true })),
        });
      } else {
        showError(`The document was not saved. ${r.error.message}`);
      }
      return;
    }
    setFile({ id: r.value.fileId, path: r.value.path, name: baseName(r.value.path), format: r.value.format });
    setDirty(norm(editor.getJSON()) !== savedRef.current);
  };

  /** One-time warning before a save that drops formatting (.txt and .md store plain text). */
  const withLossyWarning = (ext: string, go: () => void) => {
    if ((ext === 'txt' || ext === 'md') && !warnedRef.current) {
      setDlg({
        kind: 'confirm',
        title: 'Save As Text',
        text: `Saving as .${ext} keeps plain text only. Formatting such as bold, headings, bullets, and images will be lost. Save anyway?`,
        yes: 'Save',
        no: 'Cancel',
        onYes: closeThen(() => {
          warnedRef.current = true;
          go();
        }),
      });
    } else {
      go();
    }
  };

  const saveAs = () =>
    setDlg({
      kind: 'prompt',
      title: 'Save As',
      label: 'File name:',
      initial: file?.path ?? `${DEFAULT_DOC_DIR}Untitled.wpd`,
      onSubmit: (v) => {
        setDlg(null);
        if (v.trim() === '') return;
        const path = withDir(v, DEFAULT_DOC_DIR);
        withLossyWarning(formatOfPath(path), () => void doSave({ path }));
      },
    });

  const save = () => {
    setMenu(null);
    if (!file) return saveAs();
    withLossyWarning(file.format, () => void doSave({ fileId: file.id }));
  };

  const confirmDiscard = (then: () => void) => {
    if (!dirty) return then();
    setDlg({
      kind: 'confirm',
      title: 'WordPad',
      text: 'Discard your unsaved changes?',
      yes: 'Discard',
      no: 'Cancel',
      onYes: closeThen(then),
    });
  };

  const newDoc = () => {
    setMenu(null);
    confirmDiscard(() => {
      setFile(null);
      applyDoc(emptyDoc());
    });
  };

  const openDoc = () => {
    setMenu(null);
    confirmDiscard(() =>
      setDlg({
        kind: 'prompt',
        title: 'Open',
        label: 'File name:',
        initial: DEFAULT_DOC_DIR,
        onSubmit: (v) => {
          setDlg(null);
          void wordpadFiles.load({ path: withDir(v, DEFAULT_DOC_DIR) }).then((r) => {
            if (!r.ok) return showError(r.error.message);
            setFile(toOpenFile(r.value));
            applyDoc(r.value.doc);
          });
        },
      }),
    );
  };

  const insertImage = () => {
    setMenu(null);
    setDlg({
      kind: 'prompt',
      title: 'Insert Image',
      label: 'Image file:',
      initial: DEFAULT_IMAGE_DIR,
      onSubmit: (v) => {
        setDlg(null);
        void actions.readMetadata({ path: withDir(v, DEFAULT_IMAGE_DIR) }).then((r) => {
          if (!r.ok) return showError(r.error.message);
          const n = r.value.node;
          if (n.kind !== 'file' || !['png', 'jpg', 'jpeg'].includes(n.ext ?? '')) {
            return showError(`"${n.name}" is not a PNG or JPG image.`);
          }
          editor?.chain().focus().insertContent({ type: 'image', attrs: { vfsId: n.id, alt: n.name, width: null } }).run();
        });
      },
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
      return;
    }
    // Inside the editor, TipTap already binds Ctrl+Z / Ctrl+Y. Cover focus on toolbar or menus.
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !editor) return;
    const target = e.target as HTMLElement;
    if (target.closest('.ProseMirror') || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      editor.chain().focus().undo().run();
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      editor.chain().focus().redo().run();
    }
  };

  // Close the open menu when the user presses anywhere outside a menu.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.wp-menu')) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menu]);

  const toggle = (name: string) => setMenu((m) => (m === name ? null : name));
  const item = (label: string, onClick: () => void, disabled = false) => (
    <li role="none" key={label}>
      <button type="button" role="menuitem" disabled={disabled} onClick={onClick}>
        {label}
      </button>
    </li>
  );
  const run = (fn: (e: Editor) => void) => () => {
    setMenu(null);
    if (editor) fn(editor);
  };
  const tool = (label: string, text: ReactNode, active: boolean, fn: (e: Editor) => void, disabled = false) => (
    <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled || !editor} onClick={() => editor && fn(editor)}>
      {text}
    </button>
  );

  const fontAttrs = (editor?.getAttributes('fontStyle') ?? {}) as { family?: string | null; size?: string | null };
  const setFontAttr = (key: 'family' | 'size', value: string) => {
    if (!editor) return;
    const next = { family: fontAttrs.family ?? null, size: fontAttrs.size ?? null, [key]: value };
    editor.chain().focus().setMark('fontStyle', next).run();
  };
  const activeLevel = ([1, 2, 3] as const).find((l) => editor?.isActive('heading', { level: l })) ?? 0;
  const styleLabel = STYLES.find((x) => x.level === activeLevel)?.label ?? 'Normal text';
  const canUndo = editor?.can().undo() ?? false;
  const canRedo = editor?.can().redo() ?? false;

  return (
    <div className="wordpad" onKeyDown={onKeyDown}>
      <div className="wp-menubar" role="menubar">
        <Menu label="File" open={menu === 'file'} onToggle={() => toggle('file')}>
          {item('New', newDoc)}
          {item('Open...', openDoc)}
          {item('Save', save)}
          {item('Save As...', () => {
            setMenu(null);
            saveAs();
          })}
        </Menu>
        <Menu label="Edit" open={menu === 'edit'} onToggle={() => toggle('edit')}>
          {item('Undo', run((e) => e.chain().focus().undo().run()), !canUndo)}
          {item('Redo', run((e) => e.chain().focus().redo().run()), !canRedo)}
        </Menu>
        <Menu label="Insert" open={menu === 'insert'} onToggle={() => toggle('insert')}>
          {item('Image...', insertImage)}
        </Menu>
        <AiMenu open={menu === 'ai'} onToggle={() => toggle('ai')} disabled={!editor || ai.state.phase !== 'idle'} onPick={pickAi} />
      </div>
      <div className="wp-toolbar" role="toolbar" aria-label="Formatting">
        {tool('Bold', 'B', !!editor?.isActive('bold'), (e) => e.chain().focus().toggleBold().run())}
        {tool('Italic', 'I', !!editor?.isActive('italic'), (e) => e.chain().focus().toggleItalic().run())}
        {tool('Underline', 'U', !!editor?.isActive('underline'), (e) => e.chain().focus().toggleUnderline().run())}
        <select
          className="wp-font"
          aria-label="Font"
          title="Font"
          disabled={!editor}
          value={fontAttrs.family ?? DEFAULT_FONT}
          onChange={(e) => setFontAttr('family', e.target.value)}
        >
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          className="wp-font-size"
          aria-label="Font size"
          title="Font size"
          disabled={!editor}
          value={fontAttrs.size ?? String(DEFAULT_SIZE)}
          onChange={(e) => setFontAttr('size', e.target.value)}
        >
          {FONT_SIZES.map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
        <Menu label={styleLabel} open={menu === 'style'} onToggle={() => toggle('style')}>
          {STYLES.map(({ label, level }) => {
            const active = level === 0 ? !activeLevel : activeLevel === level;
            return (
              <li role="none" key={label}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={`wp-style-item wp-style-${level}`}
                  disabled={!editor}
                  onClick={run((e) => {
                    const c = e.chain().focus();
                    if (level === 0) c.setParagraph().run();
                    else c.setHeading({ level }).run();
                  })}
                >
                  <span className="wp-style-check">{active ? '\u2713' : ''}</span>
                  {label}
                </button>
              </li>
            );
          })}
        </Menu>
        {tool('Bullet list', <ListIcon numbered={false} />, !!editor?.isActive('bulletList'), (e) => e.chain().focus().toggleBulletList().run())}
        {tool('Numbered list', <ListIcon numbered />, !!editor?.isActive('orderedList'), (e) => e.chain().focus().toggleOrderedList().run())}
        {tool('Undo', <ArrowIcon />, false, (e) => e.chain().focus().undo().run(), !canUndo)}
        {tool('Redo', <ArrowIcon flip />, false, (e) => e.chain().focus().redo().run(), !canRedo)}
      </div>
      <Ruler margins={margins} onChange={setMargins} />
      <div
        className="wp-page"
        style={{ paddingLeft: PAGE_PAD + margins.left, paddingRight: PAGE_PAD + margins.right }}
        onMouseDown={(e) => {
          // Clicking the padding or blank area below the text should still place the caret.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            editor?.commands.focus('end');
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>
      <PreviewPanel state={ai.state} onAccept={ai.accept} onReject={ai.reject} />
      <div className="wp-status" role="status">
        {file ? file.path : 'Untitled'}
        {dirty ? ' *' : ''}
      </div>
      {dlg?.kind === 'message' && <MessageBox title={dlg.title} message={dlg.text} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'confirm' && (
        <ConfirmDialog
          title={dlg.title}
          message={dlg.text}
          confirmLabel={dlg.yes}
          cancelLabel={dlg.no}
          onConfirm={dlg.onYes}
          onCancel={() => {
            setDlg(null);
            dlg.onNo?.();
          }}
        />
      )}
      {dlg?.kind === 'prompt' && (
        <PromptDialog title={dlg.title} label={dlg.label} initialValue={dlg.initial} onSubmit={dlg.onSubmit} onCancel={() => setDlg(null)} />
      )}
    </div>
  );
}

/** 16x16 curved arrow like the Win98 WordPad undo icon; `flip` mirrors it for redo. */
function ArrowIcon({ flip = false }: { flip?: boolean }) {
  return (
    <svg className="wp-arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M5 2 L1 6 L5 10 L5 7.5 C9 7 11.5 8.5 12 12 C13 8 11 4.5 5 4.5 Z" fill="currentColor" />
    </svg>
  );
}
/** 16x16 list icon: bullets or tiny 1-2-3 digits on the left, three text lines on the right. */
function ListIcon({ numbered }: { numbered: boolean }) {
  return (
    <svg className="wp-list-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      {numbered ? (
        <g fontFamily="Arial, sans-serif" fontSize="5" fontWeight="700">
          <text x="0" y="5">1</text>
          <text x="0" y="10">2</text>
          <text x="0" y="15">3</text>
        </g>
      ) : (
        <g>
          <circle cx="2" cy="3.5" r="1.6" />
          <circle cx="2" cy="8" r="1.6" />
          <circle cx="2" cy="12.5" r="1.6" />
        </g>
      )}
      <rect x="6" y="2.5" width="9" height="2" />
      <rect x="6" y="7" width="9" height="2" />
      <rect x="6" y="11.5" width="9" height="2" />
    </svg>
  );
}
const STYLES = [
  { label: 'Normal text', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
] as const;
const FONTS = ['Arial', 'Comic Sans MS', 'Courier New', 'Tahoma', 'Times New Roman', 'Verdana'];
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const DEFAULT_FONT = 'Times New Roman';
const DEFAULT_SIZE = 10;
const PX_PER_INCH = 96;
const RULER_INCHES = 12;
const PAGE_PAD = 8;
const MIN_TEXT_WIDTH = 96;

interface Margins {
  /** Extra left margin in px, added to the base page padding. */
  left: number;
  /** Extra right margin in px, added to the base page padding. */
  right: number;
}

/** Inch ruler with draggable left and right margin markers. */
function Ruler({ margins, onChange }: { margins: Margins; onChange: (m: Margins) => void }) {
  const scaleRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ side: 'left' | 'right'; startX: number; start: number } | null>(null);
  const step = PX_PER_INCH / 8;
  const ticks = [];
  for (let i = 0; i <= RULER_INCHES * 8; i++) {
    const left = i * step;
    if (i % 8 === 0) {
      if (i > 0) {
        ticks.push(
          <span key={i} className="wp-ruler-num" style={{ left }}>
            {i / 8}
          </span>,
        );
      }
    } else {
      const kind = i % 4 === 0 ? 'half' : i % 2 === 0 ? 'quarter' : 'eighth';
      ticks.push(<span key={i} className={`wp-ruler-tick wp-ruler-${kind}`} style={{ left }} />);
    }
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const width = scaleRef.current?.getBoundingClientRect().width || 0;
    const other = d.side === 'left' ? margins.right : margins.left;
    const max = Math.max(0, width - other - MIN_TEXT_WIDTH);
    const dx = e.clientX - d.startX;
    const raw = d.start + (d.side === 'left' ? dx : -dx);
    const snapped = Math.round(raw / (PX_PER_INCH / 8)) * (PX_PER_INCH / 8);
    onChange({ ...margins, [d.side]: Math.min(max, Math.max(0, snapped)) });
  };
  const marker = (side: 'left' | 'right') => (
    <div
      className={`wp-ruler-marker wp-ruler-marker-${side}`}
      role="slider"
      aria-label={`${side === 'left' ? 'Left' : 'Right'} margin`}
      aria-valuemin={0}
      aria-valuenow={margins[side]}
      title={`${side === 'left' ? 'Left' : 'Right'} margin`}
      style={side === 'left' ? { left: margins.left } : { right: margins.right }}
      onPointerDown={(e) => {
        e.preventDefault();
        drag.current = { side, startX: e.clientX, start: margins[side] };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
  return (
    <div className="wp-ruler" data-testid="wp-ruler">
      <div className="wp-ruler-scale" ref={scaleRef}>
        <div className="wp-ruler-ticks" aria-hidden="true">
          {ticks}
        </div>
        {marker('left')}
        {marker('right')}
      </div>
    </div>
  );
}
