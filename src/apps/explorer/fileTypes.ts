import type { IconName } from '../../desktop/icons';
import type { NodeRecord } from '../../actions/vfsHooks';

const TYPE_LABELS: Record<string, string> = {
  png: 'PNG Image',
  jpg: 'JPEG Image',
  jpeg: 'JPEG Image',
  wpd: 'WordPad Document',
  txt: 'Text Document',
  md: 'Markdown Document',
  pdf: 'PDF Document',
  lnk: 'Application Shortcut',
};

export function typeLabel(node: Pick<NodeRecord, 'kind' | 'ext'>): string {
  if (node.kind === 'folder') return 'File Folder';
  const ext = node.ext ?? '';
  return TYPE_LABELS[ext] ?? (ext ? `${ext.toUpperCase()} File` : 'File');
}

export function iconFor(node: Pick<NodeRecord, 'kind' | 'ext'>): IconName {
  if (node.kind === 'folder') return 'folder';
  if (node.ext === 'png' || node.ext === 'jpg' || node.ext === 'jpeg') return 'paint';
  if (node.ext === 'lnk') return 'app';
  return 'document';
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Join a folder path (e.g. `C:\` or `C:\My Documents`) and a child name. */
export function joinPath(folderPath: string, name: string): string {
  return folderPath.endsWith('\\') ? folderPath + name : `${folderPath}\\${name}`;
}

/** Parent folder path of a node path (`C:\A\b.txt` -> `C:\A`). */
export function parentPath(path: string): string {
  const i = path.lastIndexOf('\\');
  if (i <= 2) return 'C:\\';
  return path.slice(0, i);
}
