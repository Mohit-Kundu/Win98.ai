import Dexie, { type Table } from 'dexie';

export const ROOT_ID = 'root';

export interface NodeMeta {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  notes?: string;
  extractedText?: string;
  aiHash?: string;
  aiStatus?: 'none' | 'pending' | 'ok' | 'error';
  aiError?: string;
  aiEditedFields?: Array<'title' | 'description' | 'category' | 'tags'>;
}

export interface NodeRecord {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'file' | 'folder';
  mime?: string;
  ext?: string;
  size: number;
  createdAt: number;
  modifiedAt: number;
  contentHash?: string;
  /** Marks nodes the user cannot rename, move or delete. */
  system?: SystemKind;
  meta: NodeMeta;
}

/** `programFiles` and `recycleBin` are the system folders. `shortcut` is an application shortcut. */
export type SystemKind = 'programFiles' | 'recycleBin' | 'shortcut';

/** One row per item moved to the Recycle Bin. Only the top deleted node has a row. */
export interface TrashRecord {
  nodeId: string;
  originalParentId: string;
  originalName: string;
  deletedAt: number;
}

export interface ContentRecord {
  nodeId: string;
  bytes: ArrayBuffer;
  mime: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export class VfsDb extends Dexie {
  nodes!: Table<NodeRecord, string>;
  contents!: Table<ContentRecord, string>;
  settings!: Table<SettingRecord, string>;
  trash!: Table<TrashRecord, string>;

  constructor(name = 'win98-ai-vfs') {
    super(name);
    this.version(1).stores({
      nodes: 'id, parentId, [parentId+name], ext, modifiedAt',
      contents: 'nodeId',
      settings: 'key',
    });
    // v2 adds the Recycle Bin metadata table. Existing tables are unchanged.
    this.version(2).stores({
      trash: 'nodeId, deletedAt',
    });
  }
}

let instance: VfsDb | undefined;

/** Shared database instance used by the VFS service. */
export function getDb(): VfsDb {
  instance ??= new VfsDb();
  return instance;
}
