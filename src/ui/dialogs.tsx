import { useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './dialogs.css';

/** Win98-styled modal shell, portaled to <body> so window transforms do not clip it. */
export function ModalDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="ui-modal-backdrop" onMouseDown={(e) => e.stopPropagation()}>
      <div className="window ui-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div className="window-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Informational or error message with a single OK button. */
export function MessageBox({ title = 'Message', message, onClose }: { title?: string; message: string; onClose: () => void }) {
  return (
    <ModalDialog title={title} onClose={onClose}>
      <p role="alert">{message}</p>
      <div className="ui-modal-buttons">
        <button type="button" autoFocus onClick={onClose}>
          OK
        </button>
      </div>
    </ModalDialog>
  );
}

/** Yes/No confirmation. Used before destructive operations and overwrites. */
export function ConfirmDialog({
  title = 'Confirm',
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  onConfirm,
  onCancel,
}: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalDialog title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="ui-modal-buttons">
        <button type="button" autoFocus onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </ModalDialog>
  );
}

/** Single-line text prompt (new folder name, rename, destination path). */
export function PromptDialog({
  title,
  label,
  initialValue = '',
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(value);
  };
  return (
    <ModalDialog title={title} onClose={onCancel}>
      <form onSubmit={submit}>
        <div className="field-row-stacked">
          <label htmlFor="ui-prompt-input">{label}</label>
          <input id="ui-prompt-input" type="text" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="ui-modal-buttons">
          <button type="submit">OK</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
