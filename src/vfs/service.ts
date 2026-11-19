import { err, ok, type Result } from '../../shared/errors';
import { getDb, ROOT_ID, type NodeMeta, type NodeRecord, type VfsDb } from './db';
import { VfsEmitter, vfsEvents, type VfsEvent, type VfsEventType } from './events';
import { sha256Hex } from './hash';
import { extOf, formatPath, nameKey, resolveSegments, validateName } from './paths';

export interface CreateArgs {
  parentId: string;
  name: string;
  kind: 'file' | 'folder';
  bytes?: ArrayBuffer;
  mime?: string;
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
  remove(id: string): Promise<Result<{ removedIds: string[] }>>;
  updateMeta(id: string, patch: Partial<NodeMeta>): Promise<Result<NodeRecord>>;
  subscribe(fn: (e: VfsEvent) => void): () => void;
}

export const DEFAULT_FOLDERS = ['Desktop', 'My Documents', 'My Pictures'] as const;

const newId = (): string => crypto.randomUUID();

const writeFailed = (e: unknown): Result<never> =>
  err('WRITE_FAILED', 'The change could not be saved. Previous content was kept.', {
    cause: e instanceof Error ? e.message : String(e),
  });

const notFound = (what: string): Result<never> => err('NOT_FOUND', `${what} was not found.`);

export function createVfsService(db: VfsDb = getDb(), emitter: VfsEmitter = vfsEvents): VfsService {
  let initPromise: Promise<void> | undefined;

  const init = (): Promise<void> => {
    initPromise ??= db
      .transaction('rw', db.nodes, db.settings, async () => {
        if (await db.settings.get('initialized')) return;
        const now = Date.now();
        if (!(await db.nodes.get(ROOT_ID))) {
          await db.nodes.add({ id: ROOT_ID, parentId: null, name: '', kind: 'folder', size: 0, createdAt: now, modifiedAt: now, meta: {} });
        }
        for (const name of DEFAULT_FOLDERS) {
          await db.nodes.add({ id: newId(), parentId: ROOT_ID, name, kind: 'folder', size: 0, createdAt: now, modifiedAt: now, meta: {} });
        }
        await db.settings.put({ key: 'initialized', value: true });
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

  /** Run a read/write transaction over nodes and contents, mapping thrown errors to WRITE_FAILED. */
  const tx = async <T>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
    try {
      await init();
      return await db.transaction('rw', db.nodes, db.contents, fn);
    } catch (e) {
      return writeFailed(e);
    }
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

    async create({ parentId, name, kind, bytes, mime }) {
      const v = validateName(name);
      if (!v.ok) return v;
      const content = kind === 'file' ? (bytes ?? new ArrayBuffer(0)) : undefined;
      const hash = content ? await sha256Hex(content) : undefined;
      const result = await tx<NodeRecord>(async () => {
        const parent = await db.nodes.get(parentId);
        if (!parent) return notFound('The destination folder');
        if (parent.kind !== 'folder') return err('INVALID_PATH', 'The destination is not a folder.');
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
        const dest = await db.nodes.get(newParentId);
        if (!dest) return notFound('The destination folder');
        if (dest.kind !== 'folder') return err('INVALID_PATH', 'The destination is not a folder.');
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
        const ids = [id];
        for (let i = 0; i < ids.length; i++) {
          const kids = await db.nodes.where('parentId').equals(ids[i]!).primaryKeys();
          ids.push(...kids);
        }
        await db.contents.bulkDelete(ids);
        await db.nodes.bulkDelete(ids);
        removed = node;
        return ok({ removedIds: ids });
      });
      if (result.ok && removed) emit('deleted', removed);
      return result;
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
