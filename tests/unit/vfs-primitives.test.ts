import { describe, it, expect } from 'vitest';
import { VfsDb, ROOT_ID, type NodeRecord } from '../../src/vfs/db';
import { sha256Hex } from '../../src/vfs/hash';
import { VfsEmitter, type VfsEvent } from '../../src/vfs/events';
import { resolveSegments, formatPath, nameKey, validateName, extOf } from '../../src/vfs/paths';

describe('paths', () => {
  it('normalizes separators, drive prefix, and dot segments', () => {
    const r = resolveSegments('C:\\My Documents/./a/../b.txt');
    expect(r).toEqual({ ok: true, value: ['My Documents', 'b.txt'] });
  });
  it('resolves relative to cwd', () => {
    expect(resolveSegments('..\\x', ['a', 'b'])).toEqual({ ok: true, value: ['a', 'x'] });
  });
  it('rejects climbing above root', () => {
    for (const p of ['..', 'C:\\..', 'a\\..\\..']) {
      const r = resolveSegments(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('PATH_OUTSIDE_ROOT');
    }
  });
  it('rejects unknown drives and bad segment chars', () => {
    const d = resolveSegments('D:\\x');
    expect(!d.ok && d.error.code).toBe('INVALID_PATH');
    const s = resolveSegments('a\\b*c');
    expect(!s.ok && s.error.code).toBe('INVALID_PATH');
  });
  it('formats paths and compares names case-insensitively', () => {
    expect(formatPath([])).toBe('C:\\');
    expect(formatPath(['My Documents', 'a.txt'])).toBe('C:\\My Documents\\a.txt');
    expect(nameKey('ReadMe.TXT')).toBe(nameKey('readme.txt'));
  });
  it('validates names and extracts extensions', () => {
    expect(validateName('ok name.txt').ok).toBe(true);
    for (const n of ['', '  ', 'a/b', 'a:b', '..', 'x'.repeat(256)]) expect(validateName(n).ok).toBe(false);
    expect(extOf('A.PNG')).toBe('png');
    expect(extOf('noext')).toBeUndefined();
    expect(extOf('.hidden')).toBeUndefined();
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(bytes.buffer as ArrayBuffer)).toBe(await sha256Hex(bytes));
  });
});

describe('VfsEmitter', () => {
  it('delivers events, supports unsubscribe, and isolates listener errors', () => {
    const em = new VfsEmitter();
    const seen: VfsEvent[] = [];
    em.subscribe(() => {
      throw new Error('boom');
    });
    const off = em.subscribe((e) => seen.push(e));
    const e: VfsEvent = { type: 'created', nodeId: 'n1', parentId: ROOT_ID };
    em.emit(e);
    off();
    em.emit(e);
    expect(seen).toEqual([e]);
  });
});

describe('VfsDb', () => {
  it('stores nodes and ArrayBuffer contents and uses the compound index', async () => {
    const db = new VfsDb(`test-${Math.random()}`);
    const now = Date.now();
    const node: NodeRecord = {
      id: 'n1', parentId: ROOT_ID, name: 'a.txt', kind: 'file', ext: 'txt',
      size: 3, createdAt: now, modifiedAt: now, meta: {},
    };
    const bytes = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer;
    await db.transaction('rw', db.nodes, db.contents, async () => {
      await db.nodes.add(node);
      await db.contents.add({ nodeId: 'n1', bytes, mime: 'text/plain' });
    });
    const found = await db.nodes.where('[parentId+name]').equals([ROOT_ID, 'a.txt']).first();
    expect(found?.id).toBe('n1');
    const c = await db.contents.get('n1');
    expect(Array.from(new Uint8Array(c!.bytes))).toEqual([1, 2, 3]);
    await db.settings.put({ key: 'initialized', value: true });
    expect((await db.settings.get('initialized'))?.value).toBe(true);
    db.close();
  });
});
