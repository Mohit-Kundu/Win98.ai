import { useState } from 'react';
import { useFolder } from '../../actions/vfsHooks';
import { Icon } from '../../desktop/icons';
import { iconFor } from './fileTypes';

function TreeNode({ id, name, selectedId, onSelect, defaultOpen }: {
  id: string;
  name: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen === true);
  const children = useFolder(open ? id : null).filter((n) => n.system !== 'recycleBin');
  const folders = children.filter((n) => n.kind === 'folder');
  const files = children.filter((n) => n.kind !== 'folder');
  return (
    <li role="treeitem" aria-expanded={open} aria-selected={selectedId === id}>
      <button type="button" className="explorer-tree-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`} onClick={() => setOpen(!open)}>
        {open ? '-' : '+'}
      </button>
      <button
        type="button"
        className={`explorer-tree-label${selectedId === id ? ' selected' : ''}`}
        onClick={() => onSelect(id)}
      >
        <Icon name="folder" size={16} /> {name}
      </button>
      {open && children.length > 0 && (
        <ul role="group">
          {folders.map((c) => (
            <TreeNode key={c.id} id={c.id} name={c.name} selectedId={selectedId} onSelect={onSelect} />
          ))}
          {files.map((f) => (
            <li key={f.id} role="treeitem" aria-selected={false}>
              <span className="explorer-tree-file">
                <Icon name={iconFor(f)} size={16} /> {f.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Folder navigation tree rooted at C:\ (98.css tree-view). */
export function FolderTree({ rootId, selectedId, onSelect }: {
  rootId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="tree-view explorer-tree" role="tree" aria-label="Folders">
      <TreeNode id={rootId} name="C:\" selectedId={selectedId} onSelect={onSelect} defaultOpen />
    </ul>
  );
}
