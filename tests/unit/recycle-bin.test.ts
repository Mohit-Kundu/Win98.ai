import Dexie from 'dexie';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VfsDb, ROOT_ID } from '../../src/vfs/db';
import { VfsEmitter, type VfsEvent } from '../../src/vfs/events';
import { APP_PROTECTED_MESSAGE, createVfsService, type VfsService } from '../../src/vfs/service';
import { createCoreActions } from '../../src/actions/core';
import { createAppShortcutSync } from '../../src/actions/appShortcuts';
import { createExecuteCommand, type ExecuteCommand } from '../../src/actions/command';
import { createSearchIndex } from '../../src/actions/searchIndex';
import type { CoreActions } from '../../src/actions/types';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const val = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

let db: VfsDb;
let svc: VfsService;
let events: VfsEvent[];
let n = 0;

beforeEach(async () => {
  db = new VfsDb(`test-bin-${n++}`);
  svc = createVfsService(db, new VfsEmitter());
  await svc.init();
  events = [];
  svc.subscribe((e) => events.push(e));
});

const folderId = async (path: string) => val(await svc.resolve(path)).id;
const makeFile = async (path: string, name: string, content = 'x') =>
  val(await svc.create({ parentId: await folderId(path), name, kind: 'file', bytes: bytes(content), mime: 'text/plain' }));
const makeFolder = async (path: string, name: string) => val(await svc.create({ parentId: await folderId(path), name, kind: 'folder' }));

describe('system folders and the v2 upgrade', () => {
  it('adds Program Files and Recycle Bin to a profile created before the bin existed', async () => {
    const name = `test-bin-v1-${n++}`;
    const old = new Dexie(name);
    old.version(1).stores({ nodes: 'id, parentId, [parentId+name], ext, modifiedAt', contents: 'nodeId', settings: 'key' });
    const now = Date.now();
    const base = { size: 0, createdAt: now, modifiedAt: now, meta: {}, kind: 'folder' };
    await old.table('nodes').bulkAdd([
      { ...base, id: ROOT_ID, parentId: null, name: '' },
      { ...base, id: 'docs', parentId: ROOT_ID, name: 'My Documents' },
      { ...base, id: 'file', parentId: 'docs', name: 'keep.txt', kind: 'file' },
    ]);
    await old.table('settings').put({ key: 'initialized', value: true });
    old.close();

    const upgraded = createVfsService(new VfsDb(name), new VfsEmitter());
    await upgraded.init();
    const names = (await upgraded.list(ROOT_ID)).map((x) => x.name);
    expect(names).toEqual(['My Documents', 'Program Files', 'Recycle Bin']);
    expect((await upgraded.get('file'))?.name).toBe('keep.txt');
    expect(await upgraded.listTrash()).toEqual([]);
    // Running init again does not duplicate the folders.
    await createVfsService(new VfsDb(name), new VfsEmitter()).init();
    expect((await upgraded.list(ROOT_ID)).length).toBe(3);
  });

  it('refuses to rename, move or delete system folders', async () => {
    const bin = await folderId('C:\\Recycle Bin');
    const pf = await folderId('C:\\Program Files');
    const docs = await folderId('C:\\My Documents');
    expect(await svc.rename(bin, 'Trash')).toMatchObject({ ok: false, error: { code: 'PROTECTED' } });
    expect(await svc.move(pf, docs)).toMatchObject({ ok: false, error: { code: 'PROTECTED' } });
    expect(await svc.trash(bin)).toMatchObject({ ok: false, error: { code: 'PROTECTED' } });
    expect(await svc.remove(pf)).toMatchObject({ ok: false, error: { code: 'PROTECTED' } });
  });

  it('keeps files out of the system folders', async () => {
    const f = await makeFile('C:\\My Documents', 'a.txt');
    expect(await svc.move(f.id, await folderId('C:\\Recycle Bin'))).toMatchObject({ ok: false, error: { code: 'PROTECTED' } });
    expect(await svc.move(f.id, await folderId('C:\\Program Files'))).toMatchObject({ ok: false, error: { code: 'PROTECTED' } });
    const made = await svc.create({ parentId: await folderId('C:\\Program Files'), name: 'x.txt', kind: 'file' });
    expect(made).toMatchObject({ ok: false, error: { code: 'PROTECTED' } });
  });
});

describe('trash, restore, purge and empty', () => {
  it('moves a file to the bin and back, keeping content and id', async () => {
    const f = await makeFile('C:\\My Documents', 'a.txt', 'hello');
    events.length = 0;
    const t = val(await svc.trash(f.id));
    expect(t.path).toBe('C:\\My Documents\\a.txt');
    expect(events).toEqual([{ type: 'deleted', nodeId: f.id, parentId: f.parentId }]);
    expect(await svc.resolve('C:\\My Documents\\a.txt')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await svc.isInBin(f.id)).toBe(true);
    const listed = await svc.listTrash();
    expect(listed.map((e) => [e.originalName, e.originalFolder])).toEqual([['a.txt', 'C:\\My Documents']]);
    expect(new TextDecoder().decode(val(await svc.read(f.id)).bytes)).toBe('hello');

    const r = val(await svc.restore(f.id));
    expect(r).toMatchObject({ path: 'C:\\My Documents\\a.txt', relocated: false, renamed: false });
    expect(await svc.listTrash()).toEqual([]);
    expect(await svc.isInBin(f.id)).toBe(false);
  });

  it('moves a folder with everything inside and restores it intact', async () => {
    const folder = await makeFolder('C:\\My Documents', 'Proj');
    const child = val(await svc.create({ parentId: folder.id, name: 'c.txt', kind: 'file', bytes: bytes('c') }));
    const t = val(await svc.trash(folder.id));
    expect(t.affectedIds.sort()).toEqual([folder.id, child.id].sort());
    expect(await svc.isInBin(child.id)).toBe(true);
    expect((await svc.listTrash()).map((e) => e.originalName)).toEqual(['Proj']);
    expect(val(await svc.restore(folder.id)).path).toBe('C:\\My Documents\\Proj');
    expect(await svc.pathOf(child.id)).toBe('C:\\My Documents\\Proj\\c.txt');
  });

  it('keeps two deleted items with the same name', async () => {
    const a = await makeFile('C:\\Desktop', 'same.txt', 'one');
    val(await svc.trash(a.id));
    const b = await makeFile('C:\\Desktop', 'same.txt', 'two');
    val(await svc.trash(b.id));
    const listed = await svc.listTrash();
    expect(listed.map((e) => e.originalName)).toEqual(['same.txt', 'same.txt']);
    expect(new Set(listed.map((e) => e.node.name)).size).toBe(2);
    expect(val(await svc.restore(a.id)).renamed).toBe(false);
    // The second one now clashes with the first and gets a suffix.
    const second = val(await svc.restore(b.id));
    expect(second).toMatchObject({ path: 'C:\\Desktop\\same (restored).txt', renamed: true, relocated: false });
  });

  it('restores to C:\\Desktop when the original folder is gone', async () => {
    const folder = await makeFolder('C:\\My Documents', 'Gone');
    const f = val(await svc.create({ parentId: folder.id, name: 'a.txt', kind: 'file', bytes: bytes('a') }));
    val(await svc.trash(f.id));
    val(await svc.remove(folder.id));
    const r = val(await svc.restore(f.id));
    expect(r).toMatchObject({ path: 'C:\\Desktop\\a.txt', relocated: true });
    expect((await svc.listTrash()).length).toBe(0);
  });

  it('restores to C:\\Desktop when the original folder is itself in the bin', async () => {
    const folder = await makeFolder('C:\\My Documents', 'Outer');
    const f = val(await svc.create({ parentId: folder.id, name: 'a.txt', kind: 'file' }));
    val(await svc.trash(f.id));
    val(await svc.trash(folder.id));
    expect(val(await svc.restore(f.id))).toMatchObject({ path: 'C:\\Desktop\\a.txt', relocated: true });
  });

  it('refuses to trash something that is already in the bin', async () => {
    const f = await makeFile('C:\\Desktop', 'a.txt');
    val(await svc.trash(f.id));
    expect(await svc.trash(f.id)).toMatchObject({ ok: false, error: { code: 'INVALID_MOVE' } });
  });

  it('does not let a stale editor write to a deleted file', async () => {
    const f = await makeFile('C:\\Desktop', 'a.txt', 'old');
    val(await svc.trash(f.id));
    expect(await svc.write(f.id, bytes('new'))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(new TextDecoder().decode(val(await svc.read(f.id)).bytes)).toBe('old');
  });

  it('purge deletes one item for good, and only top-level bin items', async () => {
    const folder = await makeFolder('C:\\Desktop', 'F');
    const child = val(await svc.create({ parentId: folder.id, name: 'c.txt', kind: 'file', bytes: bytes('c') }));
    const other = await makeFile('C:\\Desktop', 'o.txt');
    val(await svc.trash(folder.id));
    val(await svc.trash(other.id));
    expect(await svc.purge(child.id)).toMatchObject({ ok: false, error: { code: 'INVALID_PATH' } });
    const p = val(await svc.purge(folder.id));
    expect(p.removedIds.sort()).toEqual([folder.id, child.id].sort());
    expect(await svc.get(child.id)).toBeUndefined();
    expect((await svc.listTrash()).map((e) => e.originalName)).toEqual(['o.txt']);
  });

  it('emptyBin deletes everything in the bin and nothing else', async () => {
    const keep = await makeFile('C:\\Desktop', 'keep.txt');
    const a = await makeFile('C:\\Desktop', 'a.txt');
    const folder = await makeFolder('C:\\Desktop', 'F');
    const c = val(await svc.create({ parentId: folder.id, name: 'c.txt', kind: 'file', bytes: bytes('c') }));
    val(await svc.trash(a.id));
    val(await svc.trash(folder.id));
    const r = val(await svc.emptyBin());
    expect(r.removedIds.sort()).toEqual([a.id, folder.id, c.id].sort());
    expect(await svc.listTrash()).toEqual([]);
    expect(await svc.get(c.id)).toBeUndefined();
    expect(await svc.get(keep.id)).toBeDefined();
  });

  it('rolls back a failed trash: the item stays put and no event is emitted', async () => {
    const f = await makeFile('C:\\Desktop', 'a.txt');
    events.length = 0;
    // The trash row is written after the node moves. Failing it must undo the move.
    const spy = vi.spyOn(db.trash, 'put').mockRejectedValueOnce(new Error('boom'));
    const r = await svc.trash(f.id);
    spy.mockRestore();
    expect(r).toMatchObject({ ok: false, error: { code: 'WRITE_FAILED' } });
    expect(await svc.pathOf(f.id)).toBe('C:\\Desktop\\a.txt');
    expect(await svc.listTrash()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('trashing a missing id fails with NOT_FOUND', async () => {
    expect(await svc.trash('missing')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('search index', () => {
  it('forgets deleted files, finds them again once restored, and ignores the bin', async () => {
    const index = createSearchIndex({ vfs: svc });
    await index.ready();
    const folder = await makeFolder('C:\\Desktop', 'Zebras');
    const f = val(await svc.create({ parentId: folder.id, name: 'quokka.txt', kind: 'file', bytes: bytes('wombat'), mime: 'text/plain' }));
    await index.ready();
    const names = () => index.search('quokka').map((m) => m.doc.name);
    expect(names()).toEqual(['quokka.txt']);
    val(await svc.trash(folder.id));
    await index.ready();
    expect(names()).toEqual([]);
    expect(index.search('').map((m) => m.doc.name)).not.toContain('Recycle Bin');
    val(await svc.restore(folder.id));
    await index.ready();
    expect(names()).toEqual(['quokka.txt']);
    expect(await svc.get(f.id)).toBeDefined();
    index.stop();
  });
});

describe('core actions', () => {
  let a: CoreActions;
  let launch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    launch = vi.fn((appId: string) => `win-${appId}`);
    a = createCoreActions({ vfs: svc, launch: launch as unknown as (id: string, args?: unknown) => string | null });
  });

  it('deleteNode moves to the bin, and deleting from the bin is permanent', async () => {
    const f = await makeFile('C:\\Desktop', 'a.txt');
    const first = val(await a.deleteNode({ path: 'C:\\Desktop\\a.txt' }));
    expect(first).toMatchObject({ path: 'C:\\Desktop\\a.txt', permanent: false, removedIds: [f.id] });
    expect(val(await a.listRecycleBin()).map((e) => e.originalName)).toEqual(['a.txt']);
    const second = val(await a.deleteNode({ nodeId: f.id }));
    expect(second.permanent).toBe(true);
    expect(await svc.get(f.id)).toBeUndefined();
  });

  it('restoreNode, purgeNode and emptyRecycleBin work through ids', async () => {
    const a1 = await makeFile('C:\\Desktop', 'a.txt');
    const b1 = await makeFile('C:\\Desktop', 'b.txt');
    await a.deleteNode({ nodeId: a1.id });
    await a.deleteNode({ nodeId: b1.id });
    expect(val(await a.restoreNode({ nodeId: a1.id })).path).toBe('C:\\Desktop\\a.txt');
    expect(val(await a.purgeNode({ nodeId: b1.id })).name).toBe('b.txt');
    expect(await a.restoreNode({ nodeId: 'nope' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await a.deleteNode({ nodeId: a1.id });
    val(await a.emptyRecycleBin());
    expect(val(await a.listRecycleBin())).toEqual([]);
  });

  describe('application shortcuts', () => {
    const apps = () => [
      { id: 'paint', title: 'Paint' },
      { id: 'cmd', title: 'Command Prompt' },
    ];

    it('creates one shortcut per app, once', async () => {
      const sync = createAppShortcutSync({ vfs: svc, apps });
      await sync();
      await sync();
      const items = val(await a.listFolder({ path: 'C:\\Program Files' })).items;
      expect(items.map((x) => x.name).sort()).toEqual(['Command Prompt.lnk', 'Paint.lnk']);
      expect(items.every((x) => x.system === 'shortcut')).toBe(true);
    });

    it('refuses to delete, rename or overwrite a shortcut with the exact message', async () => {
      await createAppShortcutSync({ vfs: svc, apps })();
      const del = await a.deleteNode({ path: 'C:\\Program Files\\Paint.lnk' });
      expect(del).toMatchObject({ ok: false, error: { code: 'PROTECTED_APP', message: 'System Applications cannot be deleted' } });
      expect(APP_PROTECTED_MESSAGE).toBe('System Applications cannot be deleted');
      expect(await a.renameNode({ path: 'C:\\Program Files\\Paint.lnk', name: 'x.lnk' })).toMatchObject({ ok: false, error: { code: 'PROTECTED_APP' } });
      expect(await a.saveFile({ path: 'C:\\Program Files\\Paint.lnk', bytes: bytes('{}'), mime: 'application/json', overwrite: true })).toMatchObject({
        ok: false,
        error: { code: 'PROTECTED_APP' },
      });
      expect(await svc.resolve('C:\\Program Files\\Paint.lnk')).toMatchObject({ ok: true });
      expect(val(await a.listRecycleBin())).toEqual([]);
    });

    it('opening a shortcut launches its application', async () => {
      await createAppShortcutSync({ vfs: svc, apps })();
      expect(val(await a.openFile({ path: 'C:\\Program Files\\Paint.lnk' }))).toEqual({ windowId: 'win-paint', appId: 'paint' });
      expect(launch).toHaveBeenLastCalledWith('paint');
    });

    it('does not index shortcuts', async () => {
      const index = createSearchIndex({ vfs: svc });
      await createAppShortcutSync({ vfs: svc, apps })();
      await index.ready();
      expect(index.search('paint').map((m) => m.doc.name)).toEqual([]);
      index.stop();
    });
  });
});

describe('CMD del, rd and restore', () => {
  let exec: ExecuteCommand;
  const run = async (line: string, cwd = 'C:\\') => {
    const r = await exec({ line, cwd });
    if (!r.ok) throw new Error(r.error.message);
    return r.value.output.join('\n');
  };

  beforeEach(async () => {
    exec = createExecuteCommand(createCoreActions({ vfs: svc, launch: () => null }));
    await createAppShortcutSync({ vfs: svc, apps: () => [{ id: 'paint', title: 'Paint' }] })();
  });

  it('del moves a file to the bin and restore brings it back', async () => {
    await makeFile('C:\\Desktop', 'note.txt');
    expect(await run('del note.txt', 'C:\\Desktop')).toBe('');
    expect(await run('dir', 'C:\\Desktop')).not.toContain('note.txt');
    expect(await run('restore')).toContain('note.txt');
    expect(await run('restore note.txt')).toBe('Restored to C:\\Desktop\\note.txt');
    expect(await run('dir', 'C:\\Desktop')).toContain('note.txt');
    expect(await run('restore')).toBe('The Recycle Bin is empty.');
  });

  it('rd moves a folder, and del/rd check the kind of item', async () => {
    await makeFolder('C:\\Desktop', 'Stuff');
    await makeFile('C:\\Desktop', 'f.txt');
    expect(await run('del Stuff', 'C:\\Desktop')).toContain('Use RD');
    expect(await run('rd f.txt', 'C:\\Desktop')).toContain('invalid');
    expect(await run('rd Stuff', 'C:\\Desktop')).toBe('');
    expect(await run('restore Stuff')).toBe('Restored to C:\\Desktop\\Stuff');
  });

  it('refuses to delete an application and reports missing items', async () => {
    expect(await run('del "C:\\Program Files\\Paint.lnk"')).toBe('System Applications cannot be deleted');
    expect(await run('del nothing.txt')).toContain('nothing.txt');
    expect(await run('restore nothing.txt')).toContain('no item named nothing.txt');
    expect(await run('del')).toContain('Usage');
  });
});
