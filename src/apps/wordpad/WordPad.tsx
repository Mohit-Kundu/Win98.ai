import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
    }
  };

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
  const tool = (label: string, text: string, active: boolean, fn: (e: Editor) => void, disabled = false) => (
    <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled || !editor} onClick={() => editor && fn(editor)}>
      {text}
    </button>
  );

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
        {([1, 2, 3] as const).map((level) => (
          <span key={level}>
            {tool(`Heading ${level}`, `H${level}`, !!editor?.isActive('heading', { level }), (e) => e.chain().focus().toggleHeading({ level }).run())}
          </span>
        ))}
        {tool('Bullet list', '\u2022', !!editor?.isActive('bulletList'), (e) => e.chain().focus().toggleBulletList().run())}
        {tool('Undo', '\u21B6', false, (e) => e.chain().focus().undo().run(), !canUndo)}
        {tool('Redo', '\u21B7', false, (e) => e.chain().focus().redo().run(), !canRedo)}
      </div>
      <div className="wp-page">
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
