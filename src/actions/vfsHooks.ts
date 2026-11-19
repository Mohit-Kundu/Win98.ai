// Apps consume live VFS data through this re-export so they never import src/vfs directly.
export { useFolder, useNode } from '../vfs/hooks';
export type { NodeRecord, NodeMeta } from '../vfs/db';
