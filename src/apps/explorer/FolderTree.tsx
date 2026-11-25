import { useState } from 'react';
import { useFolder } from '../../actions/vfsHooks';
import { Icon, type IconName } from '../../desktop/icons';
import { listApps } from '../../desktop/appRegistry';
import { shortcutName } from '../../actions/appShortcuts';
import { iconFor } from './fileTypes';

/** Application shortcuts use their desktop icon; other files use the type icon. */
function treeIconFor(node: Parameters<typeof iconFor>[0] & { name: string }) {
  if (node.ext === 'lnk') {
    const app = listApps().find((a) => shortcutName(a.title).toLowerCase() === node.name.toLowerCase());
    if (app) return app.icon;
  }
  return iconFor(node);
}

function TreeNode({ id, name, selectedId, onSelect, defaultOpen, icon = 'folder' }: {
  icon?: IconName;
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
        <Icon name={icon} size={16} /> {name}
      </button>
      {open && children.length > 0 && (
        <ul role="group">
          {folders.map((c) => (
            <TreeNode key={c.id} id={c.id} name={c.name} selectedId={selectedId} onSelect={onSelect} />
          ))}
          {files.map((f) => (
            <li key={f.id} role="treeitem" aria-selected={false}>
              <span className="explorer-tree-file">
                <Icon name={treeIconFor(f)} size={16} /> {f.name}
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
      <TreeNode id={rootId} name="C:\" selectedId={selectedId} onSelect={onSelect} defaultOpen icon="drive" />
    </ul>
  );
}
