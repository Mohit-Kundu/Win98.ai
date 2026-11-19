import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export type MenuCommand = 'open' | 'rename' | 'move' | 'delete' | 'properties' | 'retry';

const ITEMS: Array<{ cmd: MenuCommand; label: string }> = [
  { cmd: 'open', label: 'Open' },
  { cmd: 'rename', label: 'Rename' },
  { cmd: 'move', label: 'Move to...' },
  { cmd: 'delete', label: 'Delete' },
  { cmd: 'properties', label: 'Properties' },
];
const RETRY_ITEM = { cmd: 'retry' as const, label: 'Retry analysis' };

export function ContextMenu({ x, y, canRetry = false, onCommand, onClose }: {
  x: number;
  y: number;
  /** Show "Retry analysis" (the selected file has an AI metadata error). */
  canRetry?: boolean;
  onCommand: (cmd: MenuCommand) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);
  // Portaled: windows use CSS transforms, which would otherwise offset position:fixed.
  return createPortal(
    <ul className="explorer-menu" role="menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      {(canRetry ? [...ITEMS, RETRY_ITEM] : ITEMS).map((i) => (
        <li key={i.cmd} role="none">
          <button type="button" role="menuitem" onClick={() => onCommand(i.cmd)}>
            {i.label}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
