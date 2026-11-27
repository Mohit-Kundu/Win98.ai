import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { actions, type AppError, type Result } from '../../actions';
import { useTrash, type TrashEntry } from '../../actions/vfsHooks';
import { Icon } from '../../desktop/icons';
import { ConfirmDialog, MessageBox } from '../../ui/dialogs';
import { formatSize, formatTime, iconFor, typeLabel } from '../explorer/fileTypes';
import './recycleBin.css';

type Modal =
  | { kind: 'message'; message: string }
  | { kind: 'purge'; entry: TrashEntry }
  | { kind: 'empty' };

/** Message shown after a restore, saying where the item went. */
export function restoreMessage(name: string, r: { path: string; relocated: boolean; renamed: boolean }): string {
  if (r.relocated) return `The original folder of "${name}" no longer exists. It was restored to ${r.path}.`;
  if (r.renamed) return `"${name}" already exists in its original folder. It was restored as ${r.path}.`;
  return `"${name}" was restored to ${r.path}.`;
}

export function RecycleBin() {
  const items = useTrash();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);

  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((e) => e.originalName.toLowerCase().includes(q) || (e.originalFolder ?? '').toLowerCase().includes(q)) : items;
  const selected = items.find((e) => e.node.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId !== null && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const fail = (error: AppError) => setModal({ kind: 'message', message: error.message });
  const check = <T,>(r: Result<T>): r is { ok: true; value: T } => {
    if (!r.ok) fail(r.error);
    return r.ok;
  };

  const restore = async (entry: TrashEntry) => {
    setMenu(null);
    const r = await actions.restoreNode({ nodeId: entry.node.id });
    if (check(r)) setModal({ kind: 'message', message: restoreMessage(entry.originalName, r.value) });
  };

  const purge = async (entry: TrashEntry) => {
    setModal(null);
    check(await actions.purgeNode({ nodeId: entry.node.id }));
  };

  const empty = async () => {
    setModal(null);
    check(await actions.emptyRecycleBin());
  };

  const askPurge = (entry: TrashEntry) => {
    setMenu(null);
    setModal({ kind: 'purge', entry });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!selected) return;
    if (e.key === 'Delete') askPurge(selected);
    else if (e.key === 'Enter') void restore(selected);
  };

  return (
    <div className="bin">
      <div className="bin-toolbar">
        <button type="button" disabled={!selected} onClick={() => selected && void restore(selected)}>
          <BtnIcon kind="restore" />
          Restore
        </button>
        <button type="button" disabled={!selected} onClick={() => selected && askPurge(selected)}>
          <BtnIcon kind="delete" />
          Delete Permanently
        </button>
        <button type="button" disabled={items.length === 0} onClick={() => setModal({ kind: 'empty' })}>
          <BtnIcon kind="empty" />
          Empty Recycle Bin
        </button>
        <input
          type="search"
          className="bin-search"
          aria-label="Search deleted items"
          placeholder="Search..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setQuery(draft)}
        />
        <button type="button" onClick={() => setQuery(draft)}>
          <BtnIcon kind="search" />
          Search
        </button>
      </div>
      <div className="bin-list sunken-panel" role="listbox" aria-label="Deleted items" tabIndex={0} onKeyDown={onKeyDown} onMouseDown={() => setSelectedId(null)}>
        <div className="bin-row bin-head" aria-hidden="true">
          <span />
          <span>Name</span>
          <span>Original Location</span>
          <span>Date Deleted</span>
          <span>Type</span>
          <span>Size</span>
        </div>
        {shown.map((e) => (
          <div
            key={e.node.id}
            role="option"
            aria-selected={selectedId === e.node.id}
            className={`bin-row${selectedId === e.node.id ? ' selected' : ''}`}
            onMouseDown={(ev: MouseEvent) => {
              ev.stopPropagation();
              setSelectedId(e.node.id);
            }}
            onDoubleClick={() => void restore(e)}
            onContextMenu={(ev: MouseEvent) => {
              ev.preventDefault();
              ev.stopPropagation();
              setSelectedId(e.node.id);
              setMenu({ x: ev.clientX, y: ev.clientY });
            }}
          >
            <Icon name={iconFor(e.node)} size={16} />
            <span className="bin-cell">{e.originalName}</span>
            <span className="bin-cell">{e.originalFolder ?? 'Unknown'}</span>
            <span className="bin-cell">{formatTime(e.deletedAt)}</span>
            <span className="bin-cell">{typeLabel(e.node)}</span>
            <span className="bin-cell">{e.node.kind === 'folder' ? '' : formatSize(e.node.size)}</span>
          </div>
        ))}
        {items.length === 0 && <p className="bin-empty">The Recycle Bin is empty.</p>}
        {items.length > 0 && shown.length === 0 && <p className="bin-empty">No items match your search.</p>}
      </div>
      <div className="status-bar">
        <p className="status-bar-field">{shown.length} object(s)</p>
      </div>

      {menu && selected && (
        <BinMenu
          x={menu.x}
          y={menu.y}
          onRestore={() => void restore(selected)}
          onPurge={() => askPurge(selected)}
          onClose={() => setMenu(null)}
        />
      )}

      {modal?.kind === 'message' && <MessageBox title="Recycle Bin" message={modal.message} onClose={() => setModal(null)} />}
      {modal?.kind === 'purge' && (
        <ConfirmDialog
          title="Confirm Delete"
          message={`Are you sure you want to permanently delete "${modal.entry.originalName}"${modal.entry.node.kind === 'folder' ? ' and everything in it' : ''}? This cannot be undone.`}
          onConfirm={() => void purge(modal.entry)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal?.kind === 'empty' && (
        <ConfirmDialog
          title="Empty Recycle Bin"
          message={`Are you sure you want to permanently delete all ${items.length} item(s) in the Recycle Bin? This cannot be undone.`}
          onConfirm={() => void empty()}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}

function BinMenu({ x, y, onRestore, onPurge, onClose }: { x: number; y: number; onRestore: () => void; onPurge: () => void; onClose: () => void }) {
  useEffect(() => {
    window.addEventListener('mousedown', onClose);
    return () => window.removeEventListener('mousedown', onClose);
  }, [onClose]);
  // Portaled: windows use CSS transforms, which would otherwise offset position:fixed.
  return createPortal(
    <ul className="bin-menu" role="menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <li role="none">
        <button type="button" role="menuitem" onClick={onRestore}>
          Restore
        </button>
      </li>
      <li role="none">
        <button type="button" role="menuitem" onClick={onPurge}>
          Delete Permanently
        </button>
      </li>
    </ul>,
    document.body,
  );
}

function BtnIcon({ kind }: { kind: 'restore' | 'delete' | 'empty' | 'search' }) {
  return (
    <svg className="bin-btn-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {kind === 'restore' && (
        <>
          <path d="M2 4h5l1 1h6v8H2z" fill="#ffd84a" stroke="#000" />
          <path d="M8 12V8M6 10l2-2 2 2" fill="none" stroke="#008000" strokeWidth="1.5" />
        </>
      )}
      {kind === 'search' && (
        <>
          <circle cx="6.5" cy="6.5" r="4" fill="#fff" stroke="#000" strokeWidth="1.5" />
          <path d="M9.5 9.5L14 14" stroke="#000" strokeWidth="2" />
        </>
      )}
      {kind === 'delete' && <path d="M3 3l10 10M13 3L3 13" stroke="#c00000" strokeWidth="2.5" fill="none" />}
      {kind === 'empty' && (
        <>
          <path d="M4 5h8l-1 9H5z" fill="#c0c0c0" stroke="#000" />
          <path d="M3 4h10M6 4V2h4v2M7 7v5M9 7v5" fill="none" stroke="#000" />
        </>
      )}
    </svg>
  );
}
