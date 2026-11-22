import type { AppError, ErrorCode, Result } from '../../shared/errors';
import type { NodeMeta, NodeRecord } from '../vfs/db';
import type { TrashEntry } from '../vfs/service';

export type { AppError, ErrorCode, Result, NodeMeta, NodeRecord, TrashEntry };

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
  /**
   * Moves the item to the Recycle Bin. An item already in the bin is deleted permanently (`permanent: true`).
   * Application shortcuts are refused with PROTECTED_APP.
   */
  deleteNode(i: NodeInput): Promise<Result<{ removedIds: string[]; path: string; permanent?: boolean }>>;
  renameNode(i: RenameNodeInput): Promise<Result<NodeInfo>>;
  moveNode(i: MoveNodeInput): Promise<Result<NodeInfo>>;
  /** Items in the Recycle Bin, newest first. */
  listRecycleBin(): Promise<Result<TrashEntry[]>>;
  /** Moves a Recycle Bin item back to where it came from, or to C:\Desktop when that is not possible. */
  restoreNode(i: NodeInput): Promise<Result<{ node: NodeRecord; path: string; relocated: boolean; renamed: boolean }>>;
  /** Permanently deletes one Recycle Bin item. */
  purgeNode(i: NodeInput): Promise<Result<{ removedIds: string[]; name: string }>>;
  /** Permanently deletes everything in the Recycle Bin. */
  emptyRecycleBin(): Promise<Result<{ removedIds: string[] }>>;
}
