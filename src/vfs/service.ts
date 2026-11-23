import { err, ok, type Result } from '../../shared/errors';
import { getDb, ROOT_ID, type NodeMeta, type NodeRecord, type SystemKind, type TrashRecord, type VfsDb } from './db';
import { VfsEmitter, vfsEvents, type VfsEvent, type VfsEventType } from './events';
import { sha256Hex } from './hash';
import { createLogger } from '../log';
import { extOf, formatPath, nameKey, resolveSegments, validateName } from './paths';

export interface CreateArgs {
  parentId: string;
  name: string;
  kind: 'file' | 'folder';
  bytes?: ArrayBuffer;
  mime?: string;
  /** Only `shortcut` may be set, and only inside C:\Program Files. Used by the app shortcut sync. */
  system?: 'shortcut';
}

/** One item in the Recycle Bin, as shown by the Recycle Bin window. */
export interface TrashEntry {
  /** The deleted node. Its `name` is the unique name used inside the bin. */
  node: NodeRecord;
  originalName: string;
  /** Folder the item came from, or undefined when that folder no longer exists. */
  originalFolder: string | undefined;
  deletedAt: number;
}

export interface VfsService {
  /** Creates the root and default folders on first use. Safe to call repeatedly. */
  init(): Promise<void>;
  resolve(path: string, cwd?: string): Promise<Result<NodeRecord>>;
  pathOf(id: string): Promise<string>;
  list(folderId: string): Promise<NodeRecord[]>;
  get(id: string): Promise<NodeRecord | undefined>;
  create(args: CreateArgs): Promise<Result<NodeRecord>>;
  write(id: string, bytes: ArrayBuffer, opts?: { mime?: string }): Promise<Result<NodeRecord>>;
  read(id: string): Promise<Result<{ node: NodeRecord; bytes: ArrayBuffer }>>;
  rename(id: string, name: string): Promise<Result<NodeRecord>>;
  move(id: string, newParentId: string, newName?: string): Promise<Result<NodeRecord>>;
  /** Permanently deletes a node and everything inside it. System nodes are refused. Prefer `trash`. */
  remove(id: string): Promise<Result<{ removedIds: string[] }>>;
  /** Moves a node (with its contents) into C:\Recycle Bin. `path` is where it was. */
  trash(id: string): Promise<Result<{ node: NodeRecord; affectedIds: string[]; path: string }>>;
  /** Moves a trashed item back. Falls back to C:\Desktop and a "(restored)" name when needed. */
  restore(id: string): Promise<Result<{ node: NodeRecord; path: string; relocated: boolean; renamed: boolean }>>;
  /** Permanently deletes one item that is in the Recycle Bin. */
  purge(id: string): Promise<Result<{ removedIds: string[]; name: string }>>;
  /** Permanently deletes everything in the Recycle Bin. */
  emptyBin(): Promise<Result<{ removedIds: string[] }>>;
  /** Items in the Recycle Bin, newest deletion first. */
  listTrash(): Promise<TrashEntry[]>;
  /** True when the node is inside C:\Recycle Bin (the bin folder itself is not "in" the bin). */
  isInBin(id: string): Promise<boolean>;
  updateMeta(id: string, patch: Partial<NodeMeta>): Promise<Result<NodeRecord>>;
  subscribe(fn: (e: VfsEvent) => void): () => void;
}

export const DEFAULT_FOLDERS = ['Desktop', 'My Documents', 'My Pictures'] as const;

/** System folders created under the root. They cannot be renamed, moved or deleted. */
export const SYSTEM_FOLDERS = { programFiles: 'Program Files', recycleBin: 'Recycle Bin' } as const;

/** Shown wherever deleting an application is refused. */
export const APP_PROTECTED_MESSAGE = 'System Applications cannot be deleted';

const newId = (): string => crypto.randomUUID();

const log = createLogger('vfs');
const writeFailed = (e: unknown): Result<never> => {
  log.error('write failed', { cause: e instanceof Error ? e.message : String(e) });
  return err('WRITE_FAILED', 'The change could not be saved. Previous content was kept.', {
    cause: e instanceof Error ? e.message : String(e),
  });
};

const notFound = (what: string): Result<never> => err('NOT_FOUND', `${what} was not found.`);

export function createVfsService(db: VfsDb = getDb(), emitter: VfsEmitter = vfsEvents): VfsService {
  let initPromise: Promise<void> | undefined;

  /** Create (or mark) the system folders. Runs on every init so profiles from before v2 get them too. */
  const ensureSystemFolders = async (now: number): Promise<void> => {
    const kids = await db.nodes.where('parentId').equals(ROOT_ID).toArray();
    for (const kind of Object.keys(SYSTEM_FOLDERS) as Array<'programFiles' | 'recycleBin'>) {
      const name = SYSTEM_FOLDERS[kind];
      const existing = kids.find((k) => k.system === kind) ?? kids.find((k) => k.kind === 'folder' && nameKey(k.name) === nameKey(name));
      if (!existing) {
        await db.nodes.add({ id: newId(), parentId: ROOT_ID, name, kind: 'folder', size: 0, createdAt: now, modifiedAt: now, meta: {}, system: kind });
      } else if (existing.system !== kind) {
        await db.nodes.put({ ...existing, system: kind });
      }
    }
  };

  const init = (): Promise<void> => {
    initPromise ??= db
      .transaction('rw', db.nodes, db.settings, async () => {
        const now = Date.now();
        if (!(await db.settings.get('initialized'))) {
          if (!(await db.nodes.get(ROOT_ID))) {
            await db.nodes.add({ id: ROOT_ID, parentId: null, name: '', kind: 'folder', size: 0, createdAt: now, modifiedAt: now, meta: {} });
          }
          for (const name of DEFAULT_FOLDERS) {
            await db.nodes.add({ id: newId(), parentId: ROOT_ID, name, kind: 'folder', size: 0, createdAt: now, modifiedAt: now, meta: {} });
          }
          await db.settings.put({ key: 'initialized', value: true });
        }
        await ensureSystemFolders(now);
      })
      .catch((e: unknown) => {
        initPromise = undefined;
        throw e;
      });
    return initPromise;
  };

  const emit = (type: VfsEventType, node: Pick<NodeRecord, 'id' | 'parentId'>): void => {
    emitter.emit({ type, nodeId: node.id, parentId: node.parentId });
  };

  /** Find a child by case-insensitive name. Must run inside a transaction for consistency. */
  const findChild = async (parentId: string, name: string): Promise<NodeRecord | undefined> => {
    const key = nameKey(name);
    const kids = await db.nodes.where('parentId').equals(parentId).toArray();
    return kids.find((k) => nameKey(k.name) === key);
  };

  const segmentsOf = async (id: string): Promise<string[] | undefined> => {
    const out: string[] = [];
    let cur = await db.nodes.get(id);
    if (!cur) return undefined;
    while (cur && cur.id !== ROOT_ID) {
      out.unshift(cur.name);
      cur = cur.parentId === null ? undefined : await db.nodes.get(cur.parentId);
      if (!cur) return undefined;
    }
    return out;
  };

  const walk = async (segments: readonly string[]): Promise<NodeRecord | undefined> => {
    let cur = await db.nodes.get(ROOT_ID);
    for (const seg of segments) {
      if (!cur || cur.kind !== 'folder') return undefined;
      cur = await findChild(cur.id, seg);
    }
    return cur;
  };

  /** Run a read/write transaction over nodes, contents and trash, mapping thrown errors to WRITE_FAILED. */
  const tx = async <T>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
    try {
      await init();
      return await db.transaction('rw', db.nodes, db.contents, db.trash, fn);
    } catch (e) {
      return writeFailed(e);
    }
  };

  const systemFolder = async (kind: SystemKind): Promise<NodeRecord | undefined> => {
    const kids = await db.nodes.where('parentId').equals(ROOT_ID).toArray();
    return kids.find((k) => k.system === kind);
  };

  /** True when `node` is the bin or sits anywhere below it. */
  const inOrIsBin = async (node: NodeRecord): Promise<boolean> => {
    let cur: NodeRecord | undefined = node;
    while (cur) {
      if (cur.system === 'recycleBin') return true;
      cur = cur.parentId === null ? undefined : await db.nodes.get(cur.parentId);
    }
    return false;
  };

  const inBin = async (node: NodeRecord): Promise<boolean> => node.system !== 'recycleBin' && (await inOrIsBin(node));

  /** Refuse changes to system nodes and to anything in the Recycle Bin. */
  const protection = async (node: NodeRecord, verb: 'deleted' | 'changed'): Promise<Result<never> | undefined> => {
    if (node.system === 'shortcut') {
      return err('PROTECTED_APP', verb === 'deleted' ? APP_PROTECTED_MESSAGE : 'System Applications cannot be changed');
    }
    if (node.system) return err('PROTECTED', `"${node.name}" is a system folder and cannot be ${verb}.`);
    if (verb === 'changed' && (await inBin(node))) {
      return err('PROTECTED', 'Items in the Recycle Bin cannot be changed. Restore them first.');
    }
    return undefined;
  };

  /** Ids of a node and all its descendants, the node first. */
  const subtreeIds = async (id: string): Promise<string[]> => {
    const ids = [id];
    for (let i = 0; i < ids.length; i++) {
      ids.push(...(await db.nodes.where('parentId').equals(ids[i]!).primaryKeys()));
    }
    return ids;
  };

  /** First free name in a folder: `name`, then `base <tag(1)>.ext`, `base <tag(2)>.ext`, and so on. */
  const freeName = async (parentId: string, name: string, kind: 'file' | 'folder', tag: (n: number) => string): Promise<string> => {
    if (!(await findChild(parentId, name))) return name;
    const ext = kind === 'file' ? extOf(name) : undefined;
    const base = ext ? name.slice(0, -(ext.length + 1)) : name;
    const tail = ext ? `.${name.slice(-ext.length)}` : '';
    for (let n = 1; n < 10_000; n++) {
      const candidate = `${base} ${tag(n)}${tail}`;
      if (!(await findChild(parentId, candidate))) return candidate;
    }
    throw new Error('No free name found.');
  };

  return {
    init,

    async resolve(path, cwd) {
      try {
        await init();
        let cwdSegments: string[] = [];
        if (cwd) {
          const c = resolveSegments(cwd);
          if (!c.ok) return c;
          cwdSegments = c.value;
        }
        const segs = resolveSegments(path, cwdSegments);
        if (!segs.ok) return segs;
        const node = await walk(segs.value);
        return node ? ok(node) : err('NOT_FOUND', `The path "${path}" was not found.`, { path });
      } catch (e) {
        return err('NOT_FOUND', 'The path could not be resolved.', { cause: String(e) });
      }
    },

    async pathOf(id) {
      await init();
      const segs = await segmentsOf(id);
      return segs ? formatPath(segs) : '';
    },

    async list(folderId) {
      await init();
      const kids = await db.nodes.where('parentId').equals(folderId).toArray();
      return kids.sort((a, b) =>
        a.kind === b.kind ? nameKey(a.name).localeCompare(nameKey(b.name)) : a.kind === 'folder' ? -1 : 1,
      );
    },

    async get(id) {
      await init();
      return db.nodes.get(id);
    },

    async create({ parentId, name, kind, bytes, mime, system }) {
      const v = validateName(name);
      if (!v.ok) return v;
      const content = kind === 'file' ? (bytes ?? new ArrayBuffer(0)) : undefined;
      const hash = content ? await sha256Hex(content) : undefined;
      const result = await tx<NodeRecord>(async () => {
        const parent = await db.nodes.get(parentId);
        if (!parent) return notFound('The destination folder');
        if (parent.kind !== 'folder') return err('INVALID_PATH', 'The destination is not a folder.');
        if (system === 'shortcut' ? parent.system !== 'programFiles' : parent.system || (await inOrIsBin(parent))) {
          return err('PROTECTED', `Items cannot be created in "${parent.name}".`);
        }
        if (await findChild(parentId, name)) {
          return err('ALREADY_EXISTS', `"${name}" already exists in this folder.`);
        }
        const now = Date.now();
        const ext = kind === 'file' ? extOf(name) : undefined;
        const node: NodeRecord = {
          id: newId(),
          parentId,
          name,
          kind,
          size: content?.byteLength ?? 0,
          createdAt: now,
          modifiedAt: now,
          meta: {},
          ...(ext ? { ext } : {}),
          ...(hash ? { contentHash: hash } : {}),
          ...(content ? { mime: mime ?? 'application/octet-stream' } : {}),
          ...(system ? { system } : {}),
        };
        await db.nodes.add(node);
        if (content) await db.contents.put({ nodeId: node.id, bytes: content, mime: node.mime! });
        return ok(node);
      });
      if (result.ok) emit('created', result.value);
      return result;
    },

    async write(id, bytes, opts) {
      const hash = await sha256Hex(bytes);
      const result = await tx<NodeRecord>(async () => {
        const node = await db.nodes.get(id);
        if (!node) return notFound('The file');
        if (node.kind !== 'file') return err('INVALID_PATH', 'A folder cannot hold content.');
        // A deleted file is gone from the user's point of view. Do not let a stale editor change it.
        if (await inBin(node)) return notFound('The file');
        const guarded = await protection(node, 'changed');
        if (guarded) return guarded;
        const mime = opts?.mime ?? node.mime ?? 'application/octet-stream';
        const updated: NodeRecord = { ...node, mime, size: bytes.byteLength, contentHash: hash, modifiedAt: Date.now() };
        await db.contents.put({ nodeId: id, bytes, mime });
        await db.nodes.put(updated);
        return ok(updated);
      });
      if (result.ok) emit('updated', result.value);
      return result;
    },

    async read(id) {
      try {
        await init();
        const node = await db.nodes.get(id);
        if (!node) return notFound('The file');
        if (node.kind !== 'file') return err('INVALID_PATH', 'A folder has no content to read.');
        const c = await db.contents.get(id);
        return ok({ node, bytes: c?.bytes ?? new ArrayBuffer(0) });
      } catch (e) {
        return err('NOT_FOUND', 'The file could not be read.', { cause: String(e) });
      }
    },

    async rename(id, name) {
      const v = validateName(name);
      if (!v.ok) return v;
      const result = await tx<NodeRecord>(async () => {
        const node = await db.nodes.get(id);
        if (!node || node.parentId === null) return notFound('The item');
        const guarded = await protection(node, 'changed');
        if (guarded) return guarded;
        const clash = await findChild(node.parentId, name);
        if (clash && clash.id !== id) return err('ALREADY_EXISTS', `"${name}" already exists in this folder.`);
        const ext = node.kind === 'file' ? extOf(name) : undefined;
        const { ext: _old, ...rest } = node;
        void _old;
        const updated: NodeRecord = { ...rest, name, modifiedAt: Date.now(), ...(ext ? { ext } : {}) };
        await db.nodes.put(updated);
        return ok(updated);
      });
      if (result.ok) emit('renamed', result.value);
      return result;
    },

    async move(id, newParentId, newName) {
      if (newName !== undefined) {
        const v = validateName(newName);
        if (!v.ok) return v;
      }
      const result = await tx<NodeRecord>(async () => {
        const node = await db.nodes.get(id);
        if (!node || node.parentId === null) return notFound('The item');
        const guarded = await protection(node, 'changed');
        if (guarded) return guarded;
        const dest = await db.nodes.get(newParentId);
        if (!dest) return notFound('The destination folder');
        if (dest.kind !== 'folder') return err('INVALID_PATH', 'The destination is not a folder.');
        if (dest.system || (await inOrIsBin(dest))) return err('PROTECTED', `Items cannot be moved into "${dest.name}".`);
        // Walk up from the destination: reaching `id` means the destination is the node or its descendant.
        let cur: NodeRecord | undefined = dest;
        while (cur) {
          if (cur.id === id) return err('INVALID_MOVE', 'An item cannot be moved into itself or one of its subfolders.');
          cur = cur.parentId === null ? undefined : await db.nodes.get(cur.parentId);
        }
        const name = newName ?? node.name;
        const clash = await findChild(newParentId, name);
        if (clash && clash.id !== id) return err('ALREADY_EXISTS', `"${name}" already exists in the destination folder.`);
        const ext = node.kind === 'file' ? extOf(name) : undefined;
        const { ext: _old, ...rest } = node;
        void _old;
        const updated: NodeRecord = { ...rest, parentId: newParentId, name, modifiedAt: Date.now(), ...(ext ? { ext } : {}) };
        await db.nodes.put(updated);
        return ok(updated);
      });
      if (result.ok) emit('moved', result.value);
      return result;
    },

    async remove(id) {
      let removed: NodeRecord | undefined;
      const result = await tx<{ removedIds: string[] }>(async () => {
        const node = await db.nodes.get(id);
        if (!node) return notFound('The item');
        if (node.parentId === null) return err('INVALID_PATH', 'The root folder cannot be deleted.');
        if (node.system) {
          const guarded = await protection(node, 'deleted');
          if (guarded) return guarded;
        }
        const ids = await subtreeIds(id);
        await db.contents.bulkDelete(ids);
        await db.nodes.bulkDelete(ids);
        await db.trash.bulkDelete(ids);
        removed = node;
        return ok({ removedIds: ids });
      });
      if (result.ok && removed) emit('deleted', removed);
      return result;
    },

    async trash(id) {
      let originalParentId: string | null = null;
      const result = await tx<{ node: NodeRecord; affectedIds: string[]; path: string }>(async () => {
        const node = await db.nodes.get(id);
        if (!node) return notFound('The item');
        if (node.parentId === null) return err('INVALID_PATH', 'The root folder cannot be deleted.');
        const guarded = await protection(node, 'deleted');
        if (guarded) return guarded;
        const bin = await systemFolder('recycleBin');
        if (!bin) return err('WRITE_FAILED', 'The Recycle Bin is not available.');
        if (await inBin(node)) return err('INVALID_MOVE', 'The item is already in the Recycle Bin.');
        const path = formatPath((await segmentsOf(id)) ?? []);
        const affectedIds = await subtreeIds(id);
        const name = await freeName(bin.id, node.name, node.kind, (n) => `(${n + 1})`);
        const ext = node.kind === 'file' ? extOf(name) : undefined;
        const { ext: _old, ...rest } = node;
        void _old;
        const updated: NodeRecord = { ...rest, parentId: bin.id, name, ...(ext ? { ext } : {}) };
        await db.nodes.put(updated);
        await db.trash.put({ nodeId: id, originalParentId: node.parentId, originalName: node.name, deletedAt: Date.now() });
        originalParentId = node.parentId;
        return ok({ node: updated, affectedIds, path });
      });
      // Subscribers see this as a deletion from the original folder.
      if (result.ok && originalParentId !== null) emit('deleted', { id, parentId: originalParentId });
      return result;
    },

    async restore(id) {
      const result = await tx<{ node: NodeRecord; path: string; relocated: boolean; renamed: boolean }>(async () => {
        const row = await db.trash.get(id);
        const node = await db.nodes.get(id);
        if (!row || !node) {
          if (row) await db.trash.delete(id);
          return notFound('The item');
        }
        let parent = await db.nodes.get(row.originalParentId);
        let relocated = false;
        if (!parent || parent.kind !== 'folder' || parent.system || (await inOrIsBin(parent))) {
          const desktop = await findChild(ROOT_ID, 'Desktop');
          parent = desktop && desktop.kind === 'folder' ? desktop : await db.nodes.get(ROOT_ID);
          relocated = true;
        }
        if (!parent) return notFound('The destination folder');
        const name = await freeName(parent.id, row.originalName, node.kind, (n) => (n === 1 ? '(restored)' : `(restored ${n})`));
        const ext = node.kind === 'file' ? extOf(name) : undefined;
        const { ext: _old, ...rest } = node;
        void _old;
        const updated: NodeRecord = { ...rest, parentId: parent.id, name, ...(ext ? { ext } : {}) };
        await db.nodes.put(updated);
        await db.trash.delete(id);
        return ok({ node: updated, path: formatPath((await segmentsOf(id)) ?? []), relocated, renamed: name !== row.originalName });
      });
      if (result.ok) emit('created', result.value.node);
      return result;
    },

    async purge(id) {
      let emitted: { id: string; parentId: string | null } | undefined;
      const result = await tx<{ removedIds: string[]; name: string }>(async () => {
        const row = await db.trash.get(id);
        const node = await db.nodes.get(id);
        if (!row) return err('INVALID_PATH', 'Only items directly in the Recycle Bin can be deleted permanently.');
        const ids = node ? await subtreeIds(id) : [id];
        await db.contents.bulkDelete(ids);
        await db.nodes.bulkDelete(ids);
        await db.trash.bulkDelete(ids);
        emitted = { id, parentId: node?.parentId ?? null };
        return ok({ removedIds: ids, name: row.originalName });
      });
      if (result.ok && emitted) emit('deleted', emitted);
      return result;
    },

    async emptyBin() {
      const tops: Array<{ id: string; parentId: string | null }> = [];
      const result = await tx<{ removedIds: string[] }>(async () => {
        const rows: TrashRecord[] = await db.trash.toArray();
        const all: string[] = [];
        for (const row of rows) {
          const node = await db.nodes.get(row.nodeId);
          all.push(...(node ? await subtreeIds(row.nodeId) : [row.nodeId]));
          tops.push({ id: row.nodeId, parentId: node?.parentId ?? null });
        }
        await db.contents.bulkDelete(all);
        await db.nodes.bulkDelete(all);
        await db.trash.clear();
        return ok({ removedIds: all });
      });
      if (result.ok) for (const t of tops) emit('deleted', t);
      return result;
    },

    async listTrash() {
      await init();
      const rows = await db.trash.toArray();
      const out: TrashEntry[] = [];
      for (const row of rows) {
        const node = await db.nodes.get(row.nodeId);
        if (!node) continue;
        const parent = await db.nodes.get(row.originalParentId);
        const segs =
          parent && parent.kind === 'folder' && !parent.system && !(await inOrIsBin(parent)) ? await segmentsOf(parent.id) : undefined;
        out.push({ node, originalName: row.originalName, originalFolder: segs ? formatPath(segs) : undefined, deletedAt: row.deletedAt });
      }
      return out.sort((a, b) => b.deletedAt - a.deletedAt);
    },

    async isInBin(id) {
      await init();
      const node = await db.nodes.get(id);
      return node ? inBin(node) : false;
    },

    async updateMeta(id, patch) {
      const result = await tx<NodeRecord>(async () => {
        const node = await db.nodes.get(id);
        if (!node) return notFound('The item');
        const updated: NodeRecord = { ...node, meta: { ...node.meta, ...patch } };
        await db.nodes.put(updated);
        return ok(updated);
      });
      if (result.ok) emit('metaChanged', result.value);
      return result;
    },

    subscribe(fn) {
      return emitter.subscribe(fn);
    },
  };
}

/** Application-wide VFS service backed by the shared database. */
export const vfs: VfsService = createVfsService();
