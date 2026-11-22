import { err, ok, type Result } from '../../shared/errors';
import { appForFileName } from './associations';
import type { CoreActions, NodeInfo, NodeRecord } from './types';
import type { VfsService } from '../vfs/service';
import { formatPath, resolveSegments } from '../vfs/paths';

export interface CoreDeps {
  vfs: VfsService;
  /** Opens an app window. Returns the window id, or null when the app is not registered. */
  launch: (appId: string, launchArgs?: unknown) => string | null;
}

/** Run an action body so that it never throws. */
async function guard<T>(body: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await body();
  } catch (e) {
    return err('WRITE_FAILED', 'The operation failed unexpectedly.', {
      cause: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Reads the app id from an application shortcut (`{"appId":"paint"}`). */
function shortcutTarget(bytes: ArrayBuffer): string | undefined {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { appId?: unknown };
    return typeof parsed.appId === 'string' && parsed.appId !== '' ? parsed.appId : undefined;
  } catch {
    return undefined;
  }
}

export function createCoreActions({ vfs, launch }: CoreDeps): CoreActions {
  const resolveTarget = async (
    t: { id?: string; path?: string; cwd?: string },
    what = 'item',
  ): Promise<Result<NodeRecord>> => {
    if (t.id !== undefined) {
      const node = await vfs.get(t.id);
      return node ? ok(node) : err('NOT_FOUND', `The ${what} was not found.`, { id: t.id });
    }
    if (t.path !== undefined) return vfs.resolve(t.path, t.cwd);
    return err('VALIDATION', `Provide an id or a path for the ${what}.`);
  };

  const info = async (node: NodeRecord): Promise<NodeInfo> => ({ node, path: await vfs.pathOf(node.id) });

  /** Split a path into its parent folder node and final name. */
  const resolveParent = async (path: string, cwd?: string): Promise<Result<{ parent: NodeRecord; name: string }>> => {
    let cwdSegs: string[] = [];
    if (cwd) {
      const c = resolveSegments(cwd);
      if (!c.ok) return c;
      cwdSegs = c.value;
    }
    const segs = resolveSegments(path, cwdSegs);
    if (!segs.ok) return segs;
    const name = segs.value[segs.value.length - 1];
    if (name === undefined) return err('INVALID_PATH', 'The path does not name a file or folder.', { path });
    const parent = await vfs.resolve(formatPath(segs.value.slice(0, -1)));
    if (!parent.ok) return parent;
    if (parent.value.kind !== 'folder') return err('INVALID_PATH', 'The parent of the path is not a folder.', { path });
    return ok({ parent: parent.value, name });
  };

  return {
    openApplication: (i) =>
      guard(async () => {
        if (typeof i?.appId !== 'string' || i.appId === '') return err('VALIDATION', 'An application id is required.');
        const windowId = launch(i.appId, i.launchArgs);
        return windowId
          ? ok({ windowId })
          : err('NOT_FOUND', `The application "${i.appId}" is not available.`, { appId: i.appId });
      }),

    openFile: (i) =>
      guard(async () => {
        const target = await resolveTarget({ id: i?.fileId, path: i?.path, cwd: i?.cwd }, 'file');
        if (!target.ok) return target;
        const node = target.value;
        if (node.system === 'shortcut') {
          const read = await vfs.read(node.id);
          if (!read.ok) return read;
          const targetApp = shortcutTarget(read.value.bytes);
          if (!targetApp) return err('UNSUPPORTED_TYPE', `The shortcut "${node.name}" is damaged.`);
          const windowId = launch(targetApp);
          return windowId
            ? ok({ windowId, appId: targetApp })
            : err('NOT_FOUND', `The application "${targetApp}" is not available.`, { appId: targetApp });
        }
        let appId: string;
        let launchArgs: unknown;
        if (node.kind === 'folder') {
          appId = 'explorer';
          launchArgs = { folderId: node.id };
        } else {
          const app = appForFileName(node.name);
          if (!app.ok) return app;
          appId = app.value;
          launchArgs = { fileId: node.id };
        }
        const windowId = launch(appId, launchArgs);
        if (!windowId) {
          return err('UNSUPPORTED_TYPE', `No application is available to open "${node.name}".`, { appId });
        }
        return ok({ windowId, appId });
      }),

    saveFile: (i) =>
      guard(async () => {
        // toString check works across realms (instanceof fails for buffers from another JS realm).
        if (Object.prototype.toString.call(i?.bytes) !== '[object ArrayBuffer]' || typeof i.mime !== 'string') {
          return err('VALIDATION', 'File bytes and a MIME type are required.');
        }
        const overwrite = i.overwrite === true;
        const existing =
          i.fileId !== undefined || i.path !== undefined
            ? await resolveTarget({ id: i.fileId, path: i.path, cwd: i.cwd }, 'file')
            : err('VALIDATION', 'Provide a file id or a path to save to.');
        if (existing.ok) {
          const node = existing.value;
          if (node.kind !== 'file') return err('INVALID_PATH', `"${node.name}" is a folder.`);
          if (!overwrite) {
            return err('CONFLICT_OVERWRITE', `"${node.name}" already exists. Confirm to overwrite it.`, { fileId: node.id });
          }
          const w = await vfs.write(node.id, i.bytes, { mime: i.mime });
          if (!w.ok) return w;
          return ok({ fileId: node.id, path: await vfs.pathOf(node.id) });
        }
        // Only a missing final path (not a bad id or validation failure) falls through to creation.
        if (i.fileId !== undefined || i.path === undefined || existing.error.code !== 'NOT_FOUND') return existing;
        const where = await resolveParent(i.path, i.cwd);
        if (!where.ok) return where;
        const created = await vfs.create({ parentId: where.value.parent.id, name: where.value.name, kind: 'file', bytes: i.bytes, mime: i.mime });
        if (!created.ok) return created;
        return ok({ fileId: created.value.id, path: await vfs.pathOf(created.value.id) });
      }),

    listFolder: (i) =>
      guard(async () => {
        const target = await resolveTarget({ id: i?.folderId, path: i?.path, cwd: i?.cwd }, 'folder');
        if (!target.ok) return target;
        if (target.value.kind !== 'folder') return err('INVALID_PATH', `"${target.value.name}" is not a folder.`);
        return ok({ folder: await info(target.value), items: await vfs.list(target.value.id) });
      }),

    createFolder: (i) =>
      guard(async () => {
        let parentId: string;
        let name: string;
        if (i?.path !== undefined) {
          const where = await resolveParent(i.path, i.cwd);
          if (!where.ok) return where;
          parentId = where.value.parent.id;
          name = where.value.name;
        } else if (i?.parentId !== undefined && i.name !== undefined) {
          parentId = i.parentId;
          name = i.name;
        } else {
          return err('VALIDATION', 'Provide a path, or a parent id and a name.');
        }
        const r = await vfs.create({ parentId, name, kind: 'folder' });
        return r.ok ? ok(await info(r.value)) : r;
      }),

    readMetadata: (i) =>
      guard(async () => {
        const t = await resolveTarget({ id: i?.nodeId, path: i?.path, cwd: i?.cwd });
        if (!t.ok) return t;
        return ok({ ...(await info(t.value)), meta: t.value.meta });
      }),

    deleteNode: (i) =>
      guard(async () => {
        const t = await resolveTarget({ id: i?.nodeId, path: i?.path, cwd: i?.cwd });
        if (!t.ok) return t;
        const path = await vfs.pathOf(t.value.id);
        // Already in the Recycle Bin: this is the "delete permanently" path.
        if (await vfs.isInBin(t.value.id)) {
          const purged = await vfs.purge(t.value.id);
          if (!purged.ok) return purged;
          return ok({ removedIds: purged.value.removedIds, path, permanent: true as boolean });
        }
        const r = await vfs.trash(t.value.id);
        if (!r.ok) return r;
        return ok({ removedIds: r.value.affectedIds, path: r.value.path, permanent: false as boolean });
      }),

    listRecycleBin: () =>
      guard(async () => ok(await vfs.listTrash())),

    restoreNode: (i) =>
      guard(async () => {
        const t = await resolveTarget({ id: i?.nodeId, path: i?.path, cwd: i?.cwd });
        if (!t.ok) return t;
        return vfs.restore(t.value.id);
      }),

    purgeNode: (i) =>
      guard(async () => {
        const t = await resolveTarget({ id: i?.nodeId, path: i?.path, cwd: i?.cwd });
        if (!t.ok) return t;
        return vfs.purge(t.value.id);
      }),

    emptyRecycleBin: () => guard(() => vfs.emptyBin()),

    renameNode: (i) =>
      guard(async () => {
        if (typeof i?.name !== 'string') return err('INVALID_NAME', 'A new name is required.');
        const t = await resolveTarget({ id: i.nodeId, path: i.path, cwd: i.cwd });
        if (!t.ok) return t;
        const r = await vfs.rename(t.value.id, i.name);
        return r.ok ? ok(await info(r.value)) : r;
      }),

    moveNode: (i) =>
      guard(async () => {
        const t = await resolveTarget({ id: i?.nodeId, path: i?.path, cwd: i?.cwd });
        if (!t.ok) return t;
        const dest = await resolveTarget({ id: i.destinationId, path: i.destinationPath, cwd: i.cwd }, 'destination folder');
        if (!dest.ok) return dest;
        const r = await vfs.move(t.value.id, dest.value.id, i.newName);
        return r.ok ? ok(await info(r.value)) : r;
      }),
  };
}
