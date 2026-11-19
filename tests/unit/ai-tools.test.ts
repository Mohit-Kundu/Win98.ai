import { describe, it, expect, beforeEach } from 'vitest';
import { VfsDb } from '../../src/vfs/db';
import { VfsEmitter } from '../../src/vfs/events';
import { createVfsService, type VfsService } from '../../src/vfs/service';
import { createCoreActions } from '../../src/actions/core';
import { createDocumentActions } from '../../src/actions/documents';
import { createImageActions } from '../../src/actions/images';
import { createExecuteCommand } from '../../src/actions/command';
import { createOrganizeService } from '../../src/actions/organize';
import { createSearchService } from '../../src/actions/search';
import { createSearchIndex } from '../../src/actions/searchIndex';
import { DocumentBus } from '../../src/actions/wordpad/documentBus';
import { ToolRegistry, isDestructive, toFunctionDeclaration, type ToolContext } from '../../src/ai/registry';
import { coreTools, registerCoreTools, capText, MAX_TEXT_BYTES } from '../../src/ai/tools';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

let svc: VfsService;
let ctx: ToolContext;
let reg: ToolRegistry;
let imageCalls: number;
let n = 0;

beforeEach(async () => {
  svc = createVfsService(new VfsDb(`test-tools-${n++}`), new VfsEmitter());
  await svc.init();
  const core = createCoreActions({ vfs: svc, launch: () => 'w1' });
  const docs = createDocumentActions({ vfs: svc, core, bus: new DocumentBus() });
  imageCalls = 0;
  const images = createImageActions({
    ai: {
      generateImage: async () => {
        imageCalls++;
        return { ok: true, value: { mimeType: 'image/png', dataBase64: b64(PNG) } };
      },
    },
    drawings: docs,
  });
  const { searchFiles } = createSearchService({ vfs: svc, index: createSearchIndex({ vfs: svc }) });
  const { organizeFiles } = createOrganizeService({ vfs: svc });
  ctx = { actions: { ...core, ...docs, ...images, searchFiles, organizeFiles, executeCommand: createExecuteCommand(core) }, signal: new AbortController().signal };
  reg = new ToolRegistry();
  registerCoreTools(reg);
});

// Run a tool the way the Orchestrator does: validate with Zod, then call the handler.
async function run(name: string, args: unknown) {
  const tool = reg.get(name)!;
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) throw new Error(`invalid args for ${name}: ${parsed.error.message}`);
  return tool.handler(parsed.data, ctx);
}
const val = async (name: string, args: unknown) => {
  const r = await run(name, args);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value as Record<string, unknown>;
};

describe('tool registration', () => {
  it('registers the expected tools with valid Gemini declarations, idempotently', () => {
    registerCoreTools(reg);
    expect(reg.list().map((t) => t.name).sort()).toEqual(coreTools.map((t) => t.name).sort());
    expect(reg.list()).toHaveLength(18);
    for (const t of reg.list()) {
      const d = toFunctionDeclaration(t);
      expect(JSON.stringify(d.parametersJsonSchema)).not.toMatch(/additionalProperties|\$ref|\$schema/);
    }
  });

  it('scopes update_drawing to paint and run_command to cmd', () => {
    const names = (app?: string) => reg.toolsFor(app).map((t) => t.name);
    expect(names('wordpad')).not.toContain('run_command');
    expect(names('wordpad')).not.toContain('update_drawing');
    expect(names('cmd')).toContain('run_command');
    expect(names('paint')).toContain('update_drawing');
    expect(names()).toContain('generate_image');
  });

  it('computes destructive predicates', () => {
    const d = (name: string, args: unknown) => isDestructive(reg.get(name)!, args);
    expect(d('delete_node', { path: 'C:\\x' })).toBe(true);
    expect(d('update_document', { mode: 'replace' })).toBe(true);
    expect(d('update_document', { mode: 'replaceSelection' })).toBe(true);
    expect(d('update_document', { mode: 'append' })).toBe(false);
    expect(d('create_document', { path: 'a', overwrite: true })).toBe(true);
    expect(d('create_document', { path: 'a' })).toBe(false);
    expect(d('generate_image', { prompt: 'x', overwrite: true })).toBe(true);
    expect(d('update_drawing', {})).toBe(true);
    expect(d('create_folder', {})).toBe(false);
  });
});

describe('file tools', () => {
  it('creates, lists, renames, moves, and deletes through actions', async () => {
    const made = await val('create_folder', { path: 'C:\\My Documents\\AI Research' });
    expect(made.path).toBe('C:\\My Documents\\AI Research');
    await val('create_folder', { path: 'C:\\My Documents\\Other' });
    const listed = await val('list_folder', { path: 'C:\\My Documents' });
    expect((listed.items as unknown[]).length).toBe(2);
    await val('rename_node', { path: 'C:\\My Documents\\Other', newName: 'Renamed' });
    await val('move_node', { path: 'C:\\My Documents\\Renamed', destinationPath: 'C:\\My Documents\\AI Research' });
    expect((await val('read_file_metadata', { path: 'C:\\My Documents\\AI Research\\Renamed' })).kind).toBe('folder');
    await val('delete_node', { fileId: made.id });
    const miss = await run('list_folder', { path: 'C:\\My Documents\\AI Research' });
    expect(miss.ok).toBe(false);
  });

  it('search_files returns ranked hits with ids, honors filters, and validates arguments', async () => {
    await val('create_document', { path: 'C:\\My Documents\\ml.wpd', contentHtml: '<p>machine learning primer</p>' });
    await val('create_folder', { path: 'C:\\My Documents\\Other' });
    const r = await val('search_files', { text: 'machine learning' });
    const hits = r.hits as Array<{ id: string; path: string; type: string }>;
    expect(hits.map((h) => h.path)).toEqual(['C:\\My Documents\\ml.wpd']);
    expect(hits[0]?.type).toBe('wpd');
    expect(typeof hits[0]?.id).toBe('string');
    expect(((await val('search_files', { type: 'folder', text: 'other' })).hits as unknown[]).length).toBe(1);
    expect(((await val('search_files', { text: 'machine', createdBefore: '2000-01-01' })).hits as unknown[]).length).toBe(0);
    expect(((await val('search_files', { text: 'machine', createdBefore: '2999-01-01' })).hits as unknown[]).length).toBe(1);
    const t = reg.get('search_files')!;
    expect(t.input.safeParse({}).success).toBe(false);
    expect(t.input.safeParse({ text: 'x', createdAfter: 'not a date' }).success).toBe(false);
    expect(isDestructive(t, { text: 'x' })).toBe(false);
  });

  it('caps list_folder at 50 entries', async () => {
    for (let i = 0; i < 55; i++) await val('create_folder', { path: `C:\\My Documents\\f${i}` });
    const r = await val('list_folder', { path: 'C:\\My Documents' });
    expect(r.total).toBe(55);
    expect(r.truncated).toBe(true);
    expect((r.items as unknown[]).length).toBe(50);
  });

  it('rejects calls without a target at validation', () => {
    expect(reg.get('delete_node')!.input.safeParse({}).success).toBe(false);
  });

  it('runs commands and opens files and apps', async () => {
    await val('create_folder', { path: 'C:\\Projects' });
    const out = await val('run_command', { line: 'dir', cwd: 'C:\\' });
    expect(String(out.output)).toContain('Projects');
    expect((await val('open_application', { appId: 'paint' })).windowId).toBe('w1');
    const doc = await val('create_document', { path: 'C:\\My Documents\\a.wpd', contentHtml: '<p>x</p>' });
    expect((await val('open_file', { fileId: doc.fileId })).appId).toBeTruthy();
  });
});

describe('document and image tools', () => {
  it('runs the report flow with ids passed between calls', async () => {
    const doc = await val('create_document', {
      path: 'C:\\My Documents\\Report on AI.wpd',
      contentHtml: '<h1>Report</h1><h2>Data Centers</h2><p>Racks.</p>',
    });
    expect(doc.path).toBe('C:\\My Documents\\Report on AI.wpd');
    const img = await val('generate_image', { prompt: 'A modern data center', path: 'C:\\My Pictures\\data-center.png' });
    expect(Object.keys(img).sort()).toEqual(['fileId', 'path']);
    await val('insert_image_into_document', { documentId: doc.fileId, imageId: img.fileId, position: { afterHeading: 'Data Centers' }, alt: 'x' });
    const read = await val('read_document', { path: 'C:\\My Documents\\Report on AI.wpd' });
    expect(read.fileId).toBe(doc.fileId);
    expect(String(read.text)).toContain('Racks.');
    const raw = JSON.parse(new TextDecoder().decode((await svc.read(doc.fileId as string)).ok ? ((await svc.read(doc.fileId as string)) as { value: { bytes: ArrayBuffer } }).value.bytes : new ArrayBuffer(0)));
    expect(JSON.stringify(raw)).toContain(img.fileId as string);
  });

  it('reports overwrite conflicts instead of overwriting, and allows explicit overwrite', async () => {
    await val('generate_image', { prompt: 'a cat', path: 'C:\\My Pictures\\cat.png' });
    const again = await run('generate_image', { prompt: 'a cat', path: 'C:\\My Pictures\\cat.png' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('CONFLICT_OVERWRITE');
    await val('generate_image', { prompt: 'a cat', path: 'C:\\My Pictures\\cat.png', overwrite: true });
    expect(imageCalls).toBe(3);
  });

  it('defaults the image path into My Pictures', async () => {
    const img = await val('generate_image', { prompt: 'Sunny Day!' });
    expect(img.path).toBe('C:\\My Pictures\\sunny-day.png');
  });

  it('updates documents and enforces the 64 KB contentHtml limit', async () => {
    const doc = await val('create_document', { path: 'C:\\My Documents\\b.wpd', contentHtml: '<p>one</p>' });
    await val('update_document', { fileId: doc.fileId, mode: 'append', contentHtml: '<p>two</p>' });
    await val('update_document', { fileId: doc.fileId, mode: 'replace', contentHtml: '<p>[rewritten] done</p>' });
    expect(String((await val('read_document', { fileId: doc.fileId })).text)).toBe('[rewritten] done');
    const big = '<p>' + 'a'.repeat(64 * 1024) + '</p>';
    expect(reg.get('create_document')!.input.safeParse({ path: 'x.wpd', contentHtml: big }).success).toBe(false);
  });

  it('creates and updates drawings', async () => {
    const d = await val('create_drawing', { path: 'C:\\My Pictures\\d.png', width: 4, height: 4 });
    expect((await val('update_drawing', { fileId: d.fileId, imageBase64: b64(PNG) })).fileId).toBe(d.fileId);
  });

  it('caps read_document text at 4 KB', async () => {
    const doc = await val('create_document', { path: 'C:\\My Documents\\long.wpd', contentHtml: `<p>${'é'.repeat(5000)}</p>` });
    const r = await val('read_document', { fileId: doc.fileId });
    expect(r.truncated).toBe(true);
    expect(new TextEncoder().encode(String(r.text)).length).toBeLessThanOrEqual(MAX_TEXT_BYTES);
    expect(capText('short')).toEqual({ text: 'short', truncated: false });
  });
});
