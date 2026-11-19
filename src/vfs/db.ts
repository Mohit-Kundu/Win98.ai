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
  meta: NodeMeta;
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

  constructor(name = 'win98-ai-vfs') {
    super(name);
    this.version(1).stores({
      nodes: 'id, parentId, [parentId+name], ext, modifiedAt',
      contents: 'nodeId',
      settings: 'key',
    });
  }
}

let instance: VfsDb | undefined;

/** Shared database instance used by the VFS service. */
export function getDb(): VfsDb {
  instance ??= new VfsDb();
  return instance;
}
