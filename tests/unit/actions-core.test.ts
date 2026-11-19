import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VfsDb } from '../../src/vfs/db';
import { VfsEmitter } from '../../src/vfs/events';
import { createVfsService, type VfsService } from '../../src/vfs/service';
import { createCoreActions } from '../../src/actions/core';
import type { CoreActions } from '../../src/actions/types';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const val = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

let svc: VfsService;
let a: CoreActions;
let launch: ReturnType<typeof vi.fn>;
let n = 0;

beforeEach(async () => {
  svc = createVfsService(new VfsDb(`test-actions-${n++}`), new VfsEmitter());
  await svc.init();
  launch = vi.fn((appId: string) => (appId === 'missing' ? null : `win-${appId}`));
  a = createCoreActions({ vfs: svc, launch: launch as unknown as (id: string, args?: unknown) => string | null });
});

describe('saveFile', () => {
  it('creates a new file by path, then refuses to overwrite without consent', async () => {
    const first = val(await a.saveFile({ path: 'C:\\My Documents\\a b.txt', bytes: bytes('one'), mime: 'text/plain' }));
    expect(first.path).toBe('C:\\My Documents\\a b.txt');
    const clash = await a.saveFile({ path: 'C:\\My Documents\\A B.txt', bytes: bytes('two'), mime: 'text/plain' });
    expect(clash).toMatchObject({ ok: false, error: { code: 'CONFLICT_OVERWRITE' } });
    expect(new TextDecoder().decode(val(await svc.read(first.fileId)).bytes)).toBe('one');
    const over = val(await a.saveFile({ path: 'C:\\My Documents\\a b.txt', bytes: bytes('two'), mime: 'text/plain', overwrite: true }));
    expect(over.fileId).toBe(first.fileId);
    expect(new TextDecoder().decode(val(await svc.read(first.fileId)).bytes)).toBe('two');
  });

  it('requires overwrite when saving by fileId and reports a missing parent', async () => {
    const f = val(await a.saveFile({ path: '\\My Pictures\\p.png', bytes: bytes('x'), mime: 'image/png' }));
    expect(await a.saveFile({ fileId: f.fileId, bytes: bytes('y'), mime: 'image/png' })).toMatchObject({ ok: false, error: { code: 'CONFLICT_OVERWRITE' } });
    expect(await a.saveFile({ path: '\\Nope\\x.txt', bytes: bytes('y'), mime: 'text/plain' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await a.saveFile({ fileId: 'bogus', bytes: bytes('y'), mime: 'text/plain', overwrite: true })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('folder and node actions', () => {
  it('creates, lists, renames, moves, reads metadata, and deletes', async () => {
    const folder = val(await a.createFolder({ path: '\\My Documents\\Projects' }));
    expect(folder.path).toBe('C:\\My Documents\\Projects');
    expect(await a.createFolder({ path: '\\My Documents\\projects' })).toMatchObject({ ok: false, error: { code: 'ALREADY_EXISTS' } });
    const sub = val(await a.createFolder({ parentId: folder.node.id, name: 'Sub' }));

    const listed = val(await a.listFolder({ path: '\\My Documents' }));
    expect(listed.items.map((x) => x.name)).toEqual(['Projects']);
    expect(val(await a.listFolder({ path: 'Projects', cwd: '\\My Documents' })).items.map((x) => x.name)).toEqual(['Sub']);

    const renamed = val(await a.renameNode({ nodeId: sub.node.id, name: 'Renamed' }));
    expect(renamed.node.id).toBe(sub.node.id);
    const moved = val(await a.moveNode({ path: '\\My Documents\\Projects\\Renamed', destinationPath: '\\Desktop' }));
    expect(moved.path).toBe('C:\\Desktop\\Renamed');
    expect(await a.moveNode({ nodeId: folder.node.id, destinationId: moved.node.id })).toMatchObject({ ok: true });

    expect(val(await a.readMetadata({ path: '\\Desktop\\Renamed' })).meta).toEqual({});
    const del = val(await a.deleteNode({ path: '\\Desktop\\Renamed' }));
    expect(del.removedIds.length).toBe(2);
    expect(await a.readMetadata({ path: '\\Desktop\\Renamed' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('returns structured errors for bad input without throwing', async () => {
    expect(await a.listFolder({})).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await a.createFolder({ path: '..\\x' })).toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_ROOT' } });
    expect(await a.createFolder({ path: 'C:\\bad|name' })).toMatchObject({ ok: false, error: { code: 'INVALID_PATH' } });
    expect(await a.renameNode({ path: '\\Desktop', name: 'a/b' })).toMatchObject({ ok: false, error: { code: 'INVALID_NAME' } });
    expect(await a.deleteNode({ nodeId: 'nope' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    // @ts-expect-error deliberately malformed input
    expect(await a.openApplication(undefined)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('converts unexpected exceptions into error results', async () => {
    const boom = createCoreActions({ vfs: { ...svc, get: () => Promise.reject(new Error('db down')) }, launch: () => null });
    const r = await boom.readMetadata({ nodeId: 'x' });
    expect(r).toMatchObject({ ok: false, error: { code: 'WRITE_FAILED' } });
  });
});

describe('openApplication / openFile', () => {
  it('launches apps and reports unknown apps', async () => {
    expect(val(await a.openApplication({ appId: 'paint' }))).toEqual({ windowId: 'win-paint' });
    expect(await a.openApplication({ appId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('opens files in the mapped app with the node id, and folders in explorer', async () => {
    const f = val(await a.saveFile({ path: '\\My Documents\\n.TXT', bytes: bytes('t'), mime: 'text/plain' }));
    expect(val(await a.openFile({ fileId: f.fileId }))).toEqual({ windowId: 'win-wordpad', appId: 'wordpad' });
    expect(launch).toHaveBeenLastCalledWith('wordpad', { fileId: f.fileId });

    const folder = val(await svc.resolve('\\My Documents'));
    expect(val(await a.openFile({ path: '\\My Documents' })).appId).toBe('explorer');
    expect(launch).toHaveBeenLastCalledWith('explorer', { folderId: folder.id });
  });

  it('returns UNSUPPORTED_TYPE for unmapped extensions and unregistered apps', async () => {
    await a.saveFile({ path: '\\Desktop\\x.zip', bytes: bytes('z'), mime: 'application/zip' });
    expect(await a.openFile({ path: '\\Desktop\\x.zip' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_TYPE' } });
    expect(launch).not.toHaveBeenCalled();
    const none = createCoreActions({ vfs: svc, launch: () => null });
    await a.saveFile({ path: '\\Desktop\\y.png', bytes: bytes('p'), mime: 'image/png' });
    expect(await none.openFile({ path: '\\Desktop\\y.png' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_TYPE' } });
    expect(await a.openFile({ path: '\\Desktop\\ghost.png' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
