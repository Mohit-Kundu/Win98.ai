import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VfsDb, ROOT_ID } from '../../src/vfs/db';
import { VfsEmitter, type VfsEvent } from '../../src/vfs/events';
import { createVfsService, type VfsService } from '../../src/vfs/service';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

let db: VfsDb;
let svc: VfsService;
let events: VfsEvent[];
let n = 0;

beforeEach(async () => {
  db = new VfsDb(`test-vfs-${n++}`);
  const emitter = new VfsEmitter();
  svc = createVfsService(db, emitter);
  events = [];
  await svc.init();
  svc.subscribe((e) => events.push(e));
});

const mustOk = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

describe('VFS service', () => {
  it('creates default folders once', async () => {
    const names = (await svc.list(ROOT_ID)).map((n) => n.name);
    expect(names).toEqual(['Desktop', 'My Documents', 'My Pictures', 'Program Files', 'Recycle Bin']);
    const again = createVfsService(db, new VfsEmitter());
    await again.init();
    expect((await again.list(ROOT_ID)).length).toBe(5);
    expect(mustOk(await svc.resolve('C:\\My Documents')).kind).toBe('folder');
  });

  it('creates, reads, writes with hash and metadata kept separate', async () => {
    const docs = mustOk(await svc.resolve('\\My Documents'));
    const f = mustOk(await svc.create({ parentId: docs.id, name: 'a.txt', kind: 'file', bytes: bytes('hi'), mime: 'text/plain' }));
    expect(f.ext).toBe('txt');
    expect(f.size).toBe(2);
    expect(f.contentHash).toHaveLength(64);
    const w = mustOk(await svc.write(f.id, bytes('hello'), { mime: 'text/plain' }));
    expect(w.contentHash).not.toBe(f.contentHash);
    expect(text(mustOk(await svc.read(f.id)).bytes)).toBe('hello');
    expect(events.map((e) => e.type)).toEqual(['created', 'updated']);
    const m = mustOk(await svc.updateMeta(f.id, { title: 'T', tags: ['x'] }));
    expect(m.meta.title).toBe('T');
    expect(events.at(-1)?.type).toBe('metaChanged');
  });

  it('rejects duplicate names case-insensitively and invalid names', async () => {
    const docs = mustOk(await svc.resolve('\\My Documents'));
    mustOk(await svc.create({ parentId: docs.id, name: 'Report.txt', kind: 'file' }));
    const dup = await svc.create({ parentId: docs.id, name: 'report.TXT', kind: 'file' });
    expect(!dup.ok && dup.error.code).toBe('ALREADY_EXISTS');
    const bad = await svc.create({ parentId: docs.id, name: 'a?b', kind: 'file' });
    expect(!bad.ok && bad.error.code).toBe('INVALID_NAME');
  });

  it('keeps ids stable across rename and move and resolves paths with spaces', async () => {
    const docs = mustOk(await svc.resolve('\\My Documents'));
    const pics = mustOk(await svc.resolve('\\My Pictures'));
    const f = mustOk(await svc.create({ parentId: docs.id, name: 'a.txt', kind: 'file', bytes: bytes('x') }));
    const r = mustOk(await svc.rename(f.id, 'My File.md'));
    expect(r.id).toBe(f.id);
    expect(r.ext).toBe('md');
    const m = mustOk(await svc.move(f.id, pics.id));
    expect(m.id).toBe(f.id);
    expect(await svc.pathOf(f.id)).toBe('C:\\My Pictures\\My File.md');
    expect(mustOk(await svc.resolve('my pictures\\my file.MD', '\\')).id).toBe(f.id);
    expect(events.map((e) => e.type).slice(-2)).toEqual(['renamed', 'moved']);
  });

  it('rejects moving a folder into itself or a descendant', async () => {
    const docs = mustOk(await svc.resolve('\\My Documents'));
    const sub = mustOk(await svc.create({ parentId: docs.id, name: 'sub', kind: 'folder' }));
    for (const dest of [docs.id, sub.id]) {
      const r = await svc.move(docs.id, dest);
      expect(!r.ok && r.error.code).toBe('INVALID_MOVE');
    }
  });

  it('removes folders recursively with one event, and fails on missing ids', async () => {
    const docs = mustOk(await svc.resolve('\\My Documents'));
    const sub = mustOk(await svc.create({ parentId: docs.id, name: 'sub', kind: 'folder' }));
    const f = mustOk(await svc.create({ parentId: sub.id, name: 'a.txt', kind: 'file', bytes: bytes('x') }));
    events.length = 0;
    const r = mustOk(await svc.remove(sub.id));
    expect(r.removedIds.sort()).toEqual([sub.id, f.id].sort());
    expect(await db.contents.get(f.id)).toBeUndefined();
    expect(events).toEqual([{ type: 'deleted', nodeId: sub.id, parentId: docs.id }]);
    const again = await svc.remove(sub.id);
    expect(!again.ok && again.error.code).toBe('NOT_FOUND');
  });

  it('rejects traversal outside root', async () => {
    const r = await svc.resolve('..\\..');
    expect(!r.ok && r.error.code).toBe('PATH_OUTSIDE_ROOT');
  });

  it('rolls back and emits nothing when a write fails mid-transaction', async () => {
    const docs = mustOk(await svc.resolve('\\My Documents'));
    const f = mustOk(await svc.create({ parentId: docs.id, name: 'a.txt', kind: 'file', bytes: bytes('old') }));
    events.length = 0;
    const spy = vi.spyOn(db.nodes, 'put').mockRejectedValueOnce(new Error('boom'));
    const r = await svc.write(f.id, bytes('new'));
    spy.mockRestore();
    expect(!r.ok && r.error.code).toBe('WRITE_FAILED');
    expect(text(mustOk(await svc.read(f.id)).bytes)).toBe('old');
    expect(events).toEqual([]);
  });

  it('persists across a reopened database', async () => {
    const docs = mustOk(await svc.resolve('\\My Documents'));
    const f = mustOk(await svc.create({ parentId: docs.id, name: 'a.txt', kind: 'file', bytes: bytes('keep') }));
    db.close();
    const db2 = new VfsDb(db.name);
    const svc2 = createVfsService(db2, new VfsEmitter());
    expect(text(mustOk(await svc2.read(f.id)).bytes)).toBe('keep');
    expect((await svc2.list(ROOT_ID)).length).toBe(5);
  });
});
