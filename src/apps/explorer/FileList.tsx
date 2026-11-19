import type { KeyboardEvent, MouseEvent } from 'react';
import type { NodeRecord } from '../../actions/vfsHooks';
import { Icon } from '../../desktop/icons';
import { formatSize, formatTime, iconFor, typeLabel } from './fileTypes';

export function FileList({ items, selectedId, onSelect, onOpen, onContextMenu, onKeyDown }: {
  items: NodeRecord[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (node: NodeRecord) => void;
  onContextMenu: (node: NodeRecord, x: number, y: number) => void;
  onKeyDown: (e: KeyboardEvent) => void;
}) {
  return (
    <div
      className="explorer-list sunken-panel"
      role="listbox"
      aria-label="Files"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={() => onSelect(null)}
    >
      <div className="explorer-row explorer-head" aria-hidden="true">
        <span />
        <span>Name</span>
        <span>Size</span>
        <span>Type</span>
        <span>Modified</span>
      </div>
      {items.map((n) => (
        <div
          key={n.id}
          role="option"
          aria-selected={selectedId === n.id}
          className={`explorer-row${selectedId === n.id ? ' selected' : ''}`}
          onMouseDown={(e: MouseEvent) => {
            e.stopPropagation();
            onSelect(n.id);
          }}
          onDoubleClick={() => onOpen(n)}
          onContextMenu={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(n.id);
            onContextMenu(n, e.clientX, e.clientY);
          }}
        >
          <Icon name={iconFor(n)} size={16} />
          <span className="explorer-name">
            {n.name}
            {n.meta.aiStatus === 'error' && (
              <span
                className="explorer-ai-error"
                role="img"
                aria-label="AI analysis failed"
                title={`AI analysis failed${n.meta.aiError ? `: ${n.meta.aiError}` : ''}. Right-click and choose Retry analysis.`}
              >
                {' '}
                ⚠
              </span>
            )}
          </span>
          <span>{n.kind === 'folder' ? '' : formatSize(n.size)}</span>
          <span>{typeLabel(n)}</span>
          <span>{formatTime(n.modifiedAt)}</span>
        </div>
      ))}
      {items.length === 0 && <p className="explorer-empty">This folder is empty.</p>}
    </div>
  );
}
