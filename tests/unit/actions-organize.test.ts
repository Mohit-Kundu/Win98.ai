import { beforeEach, describe, expect, it } from 'vitest';
import type { OrganizeRequest } from '../../shared/api-contracts';
import { err, ok, type Result } from '../../shared/errors';
import { createCoreActions } from '../../src/actions/core';
import { createOrganizeService, sanitizeDestination, type OrganizeService } from '../../src/actions/organize';
import { ToolRegistry, isDestructive, type ToolContext } from '../../src/ai/registry';
import { registerCoreTools } from '../../src/ai/tools';
import { VfsDb } from '../../src/vfs/db';
import { VfsEmitter } from '../../src/vfs/events';
import { createVfsService, type VfsService } from '../../src/vfs/service';

let n = 0;
let vfs: VfsService;
let svc: OrganizeService;
let requests: OrganizeRequest[];
let reply: (req: OrganizeRequest) => Result<{ moves: Array<{ fileId: string; destination: string }> }>;

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

async function file(path: string): Promise<string> {
  const core = createCoreActions({ vfs, launch: () => 'w' });
  const r = await core.saveFile({ path, bytes: bytes('secret body'), mime: 'text/plain' });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.fileId;
}
const pathOf = async (id: string) => vfs.pathOf(id);

beforeEach(async () => {
  vfs = createVfsService(new VfsDb(`test-organize-${n++}`), new VfsEmitter());
  await vfs.init();
  requests = [];
  reply = () => ok({ moves: [] });
  svc = createOrganizeService({
    vfs,
    ai: {
      organize: async (req) => {
        requests.push(req);
        return reply(req);
      },
    },
  });
});

describe('sanitizeDestination', () => {
  it('keeps folder paths under C:\\ and cleans names', () => {
    expect(sanitizeDestination('C:\\My Documents\\Reports')).toEqual(['My Documents', 'Reports']);
    expect(sanitizeDestination('/Reports/2024')).toEqual(['Reports', '2024']);
    expect(sanitizeDestination('C:\\Bad*Name?\\ok.')).toEqual(['BadName', 'ok']);
  });
  it('rejects traversal, other drives, and empty paths', () => {
    expect(sanitizeDestination('C:\\My Documents\\..\\..\\x')).toBeUndefined();
    expect(sanitizeDestination('..\\x')).toBeUndefined();
    expect(sanitizeDestination('D:\\x')).toBeUndefined();
    expect(sanitizeDestination('C:\\')).toBeUndefined();
    expect(sanitizeDestination('')).toBeUndefined();
  });
});

describe('proposeOrganization', () => {
  it('sends names and metadata, never content, and lists existing folders', async () => {
    const id = await file('C:\\Desktop\\ml.txt');
    await vfs.updateMeta(id, { title: 'ML notes', category: 'Technology/AI', tags: ['ml'] });
    await svc.proposeOrganization({ fileIds: [id] });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).not.toContain('secret body');
    expect(requests[0]!.files[0]).toMatchObject({ id, name: 'ml.txt', type: 'txt', title: 'ML notes', category: 'Technology/AI' });
    expect(requests[0]!.folders).toEqual(expect.arrayContaining(['C:\\Desktop', 'C:\\My Documents', 'C:\\My Pictures']));
  });

  it('reuses existing folders case-insensitively and marks new ones', async () => {
    const a = await file('C:\\Desktop\\a.txt');
    const b = await file('C:\\Desktop\\b.txt');
    reply = () =>
      ok({
        moves: [
          { fileId: a, destination: 'c:\\my documents' },
          { fileId: b, destination: 'C:\\MY DOCUMENTS\\Reports' },
        ],
      });
    const desktop = await vfs.resolve('C:\\Desktop');
    if (!desktop.ok) throw new Error('no desktop');
    const r = await svc.proposeOrganization({ folderId: desktop.value.id });
    expect(r.ok && r.value.moves.map((m) => [m.name, m.destination, m.newFolder])).toEqual([
      ['a.txt', 'C:\\My Documents', false],
      ['b.txt', 'C:\\My Documents\\Reports', true],
    ]);
  });

  it('drops traversal, unknown ids, duplicates, and no-op moves', async () => {
    const a = await file('C:\\Desktop\\a.txt');
    const b = await file('C:\\Desktop\\b.txt');
    const c = await file('C:\\My Documents\\c.txt');
    reply = () =>
      ok({
        moves: [
          { fileId: a, destination: 'C:\\My Documents\\..\\..\\Windows' },
          { fileId: 'nope', destination: 'C:\\My Documents' },
          { fileId: b, destination: 'C:\\My Pictures' },
          { fileId: b, destination: 'C:\\My Documents' },
          { fileId: c, destination: 'c:\\my documents' },
        ],
      });
    const r = await svc.proposeOrganization({ fileIds: [a, b, c] });
    expect(r.ok && r.value.moves.map((m) => [m.name, m.destination])).toEqual([['b.txt', 'C:\\My Pictures']]);
    expect(r.ok && [r.value.rejected, r.value.unchanged]).toEqual([3, 1]);
    // Proposing changes nothing.
    expect(await pathOf(b)).toBe('C:\\Desktop\\b.txt');
  });

  it('returns structured errors for no files and AI failure', async () => {
    const none = await svc.proposeOrganization({ fileIds: [] });
    expect(!none.ok && none.error.code).toBe('VALIDATION');
    const id = await file('C:\\Desktop\\a.txt');
    reply = () => err('AI_UNAVAILABLE', 'down');
    const down = await svc.proposeOrganization({ fileIds: [id] });
    expect(!down.ok && down.error.code).toBe('AI_UNAVAILABLE');
  });
});

describe('organizeFiles', () => {
  it('creates missing folders and moves files, keeping ids', async () => {
    const a = await file('C:\\Desktop\\a.txt');
    const r = await svc.organizeFiles({ moves: [{ fileId: a, destinationPath: 'C:\\My Documents\\New\\Deep' }] });
    expect(r.ok && r.value.moved.map((m) => m.to)).toEqual(['C:\\My Documents\\New\\Deep\\a.txt']);
    expect(await pathOf(a)).toBe('C:\\My Documents\\New\\Deep\\a.txt');
  });

  it('reports partial failures per move and still applies the others', async () => {
    const a = await file('C:\\Desktop\\a.txt');
    const b = await file('C:\\Desktop\\b.txt');
    await file('C:\\My Pictures\\b.txt'); // name clash
    const r = await svc.organizeFiles({
      moves: [
        { fileId: b, destinationPath: 'C:\\My Pictures' },
        { fileId: a, destinationPath: 'C:\\My Documents' },
        { fileId: a, destinationPath: 'C:\\..\\x' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.moved.map((m) => m.fileId)).toEqual([a]);
    expect(r.value.failed.map((f) => f.fileId)).toEqual([b, a]);
    expect(r.value.failed[0]!.code).toBe('ALREADY_EXISTS');
    expect(await pathOf(b)).toBe('C:\\Desktop\\b.txt');
  });

  it('rejects an empty move list', async () => {
    const r = await svc.organizeFiles({ moves: [] });
    expect(!r.ok && r.error.code).toBe('VALIDATION');
  });
});

describe('organize_files tool', () => {
  let reg: ToolRegistry;
  let ctx: ToolContext;
  beforeEach(() => {
    reg = new ToolRegistry();
    registerCoreTools(reg);
    const core = createCoreActions({ vfs, launch: () => 'w' });
    ctx = { actions: { ...core, organizeFiles: svc.organizeFiles } as unknown as ToolContext['actions'], signal: new AbortController().signal };
  });

  it('is destructive and lists each move in the confirmation text', () => {
    const tool = reg.get('organize_files')!;
    const args = tool.input.parse({
      moves: [
        { path: 'C:\\Desktop\\a.txt', destinationPath: 'C:\\My Documents' },
        { fileId: 'abc', destinationPath: 'C:\\My Pictures' },
      ],
    });
    expect(isDestructive(tool, args)).toBe(true);
    const text = tool.describeForConfirm!(args);
    expect(text).toContain('a.txt \u2192 C:\\My Documents');
    expect(text).toContain('item abc \u2192 C:\\My Pictures');
  });

  it('requires a source for every move', () => {
    const tool = reg.get('organize_files')!;
    expect(tool.input.safeParse({ moves: [{ destinationPath: 'C:\\x' }] }).success).toBe(false);
    expect(tool.input.safeParse({ moves: [] }).success).toBe(false);
  });

  it('moves files, and reports a partly failed batch as an error', async () => {
    const a = await file('C:\\Desktop\\a.txt');
    const b = await file('C:\\Desktop\\b.txt');
    const tool = reg.get('organize_files')!;
    const good = await tool.handler(tool.input.parse({ moves: [{ fileId: a, destinationPath: 'C:\\My Documents' }] }), ctx);
    expect(good.ok).toBe(true);
    const mixed = await tool.handler(
      tool.input.parse({ moves: [{ fileId: b, destinationPath: 'C:\\My Pictures' }, { path: 'C:\\Desktop\\missing.txt', destinationPath: 'C:\\My Pictures' }] }),
      ctx,
    );
    expect(!mixed.ok && mixed.error.code).toBe('WRITE_FAILED');
    expect(await pathOf(b)).toBe('C:\\My Pictures\\b.txt');
  });
});
