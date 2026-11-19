import type { AppError, ErrorCode, Result } from '../../shared/errors';
import type { NodeMeta, NodeRecord } from '../vfs/db';

export type { AppError, ErrorCode, Result, NodeMeta, NodeRecord };

/** Identify a VFS node by stable id or by path (paths may be relative to `cwd`). `id` wins when both are given. */
export interface NodeTarget {
  id?: string;
  path?: string;
  cwd?: string;
}

/** Launch arguments passed to apps opened by openFile. Apps read these from `launchArgs`. */
export interface FileLaunchArgs {
  fileId: string;
}
export interface FolderLaunchArgs {
  folderId: string;
}

export interface OpenApplicationInput {
  appId: string;
  launchArgs?: unknown;
}
export interface OpenFileInput {
  fileId?: string;
  path?: string;
  cwd?: string;
}
export interface SaveFileInput {
  /** Existing file to replace. Requires `overwrite: true`. */
  fileId?: string;
  /** Target path. Created when missing; replaced only with `overwrite: true`. */
  path?: string;
  cwd?: string;
  bytes: ArrayBuffer;
  mime: string;
  overwrite?: boolean;
}
export interface ListFolderInput {
  folderId?: string;
  path?: string;
  cwd?: string;
}
export type CreateFolderInput =
  | { path: string; cwd?: string; parentId?: undefined; name?: undefined }
  | { parentId: string; name: string; path?: undefined; cwd?: undefined };
export interface NodeInput {
  nodeId?: string;
  path?: string;
  cwd?: string;
}
export interface RenameNodeInput extends NodeInput {
  name: string;
}
export interface MoveNodeInput extends NodeInput {
  destinationId?: string;
  destinationPath?: string;
  newName?: string;
}

export interface NodeInfo {
  node: NodeRecord;
  path: string;
}

/** Public core actions (Req 9.1) plus the internal actions used by Explorer, CMD, and tools. */
export interface CoreActions {
  openApplication(i: OpenApplicationInput): Promise<Result<{ windowId: string }>>;
  openFile(i: OpenFileInput): Promise<Result<{ windowId: string; appId: string }>>;
  saveFile(i: SaveFileInput): Promise<Result<{ fileId: string; path: string }>>;
  listFolder(i: ListFolderInput): Promise<Result<{ folder: NodeInfo; items: NodeRecord[] }>>;
  createFolder(i: CreateFolderInput): Promise<Result<NodeInfo>>;
  readMetadata(i: NodeInput): Promise<Result<NodeInfo & { meta: NodeMeta }>>;
  deleteNode(i: NodeInput): Promise<Result<{ removedIds: string[]; path: string }>>;
  renameNode(i: RenameNodeInput): Promise<Result<NodeInfo>>;
  moveNode(i: MoveNodeInput): Promise<Result<NodeInfo>>;
}
