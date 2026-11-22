// Apps consume live VFS data through this re-export so they never import src/vfs directly.
export { useFolder, useNode, useTrash } from '../vfs/hooks';
export type { NodeRecord, NodeMeta } from '../vfs/db';
export type { TrashEntry } from '../vfs/service';
export { APP_PROTECTED_MESSAGE } from '../vfs/service';
